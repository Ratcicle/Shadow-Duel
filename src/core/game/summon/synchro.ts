import { isAI } from "../../Player.js";
import { SUMMON_MODES, SUMMON_ORIGINS } from "./transaction.js";
import { checkSpecialSummonEligibility } from "./eligibility.js";
import type {
  BattlePosition,
  BattlePositionInput,
  GameCard,
  SynchroDefinition,
} from "../../contracts/cards.js";
import type { CardFilter } from "../../contracts/effects.js";
import type {
  DeferredCardToGraveTriggerPackage,
  MaybePromise,
  MoveCardOptions,
  MoveCardResult,
  PreparedSummon,
  PreparedSummonInput,
  SummonExecutionResult,
  SummonTransaction,
  ZoneOpFailure,
  ZoneOpOptions,
} from "../../contracts/gameRuntime.js";
import type { GamePlayer } from "../../contracts/player.js";
import type {
  RawSelectionCandidate,
  RawSelectionContract,
  RawSelectionRequirement,
  SelectionCardReference,
  SelectionResult,
  SelectionSessionInput,
} from "../../contracts/selection.js";

interface RuntimeSynchroFilter
  extends Omit<CardFilter, "cardId" | "cardName"> {
  readonly id?: number | readonly number[];
  readonly cardId?: number | readonly number[];
  readonly cardName?: string | readonly string[];
  readonly faceUp?: boolean;
}

interface RuntimeSynchroMaterialFilters {
  readonly all?: RuntimeSynchroFilter;
  readonly tuner?: RuntimeSynchroFilter;
  readonly nonTuner?: RuntimeSynchroFilter;
  readonly non_tuner?: RuntimeSynchroFilter;
}

interface RuntimeSynchroConfig {
  tunerCount: number;
  nonTunerMin: number;
  nonTunerMax: number;
  materialFilters: RuntimeSynchroMaterialFilters;
  position: BattlePositionInput;
}

interface RuntimeSynchroDefinition
  extends Omit<SynchroDefinition, "materialFilters"> {
  readonly materialFilters?: RuntimeSynchroMaterialFilters;
}

interface SynchroMaterialRoleEntry {
  card: GameCard;
  role: "tuner" | "nonTuner";
}

interface SynchroMaterialMetadata {
  instanceId: number | string | null;
  cardId: number | null;
  name: string | null;
  level: number;
  isTuner: boolean;
  ownerId: string | null;
  controllerId: string | null;
  usedOnTurn: number | null;
}

interface SynchroMaterialFollowup {
  synchroSummonContextId?: string | null;
  ownerId?: string | null;
  source?: GameCard | null;
  sourceName?: string | null;
  actions?: readonly unknown[];
}

interface SynchroDeferredTriggerPackage
  extends DeferredCardToGraveTriggerPackage {
  entries?: readonly unknown[];
  onComplete?: (() => void) | null;
  orderRule?: string | null;
}

interface SynchroFlowResult {
  ok?: boolean;
  success?: boolean;
  needsSelection?: boolean;
  selectionContract?: unknown;
  reason?: string | null;
}

interface SynchroContinuationResolution {
  ok?: boolean;
  needsSelection?: boolean;
}

interface SynchroTriggerContinuation {
  stage: "after_summon" | "material_triggers";
  synchroSummonContextId: string;
  summonedCard: GameCard;
  playerId: string | null;
  actionContext: unknown;
  deferredTriggerPackages?: SynchroDeferredTriggerPackage[];
}

interface SynchroEffectEnginePort {
  isEffectNegated?(card: GameCard): boolean;
  cardMatchesFilters?(card: GameCard, filters: CardFilter): boolean;
  chooseSpecialSummonPosition?(
    card: GameCard,
    player: GamePlayer,
    options: { position: BattlePositionInput },
  ): Promise<BattlePosition>;
}

type SynchroMaterialCheck =
  | { ok: true }
  | { ok: false; reason: string };

type SynchroSummonCheck =
  | {
      ok: false;
      reason?: string | null;
      type: "synchro";
      candidates?: GameCard[];
      materialCombos?: GameCard[][];
      code?: string | null;
    }
  | {
      ok: true;
      type: "synchro";
      candidates: GameCard[];
      materialCombos: GameCard[][];
      requiredCount: null;
    };

interface SynchroCheckOptions {
  checkActionWindow?: boolean;
  silent?: boolean;
}

interface PerformSynchroOptions extends SynchroCheckOptions {
  position?: BattlePositionInput;
  synchroSummonContextId?: string;
  actionContext?: unknown;
  summonOrigin?: PreparedSummonInput["summonOrigin"];
}

interface ExtraDeckSynchroOptions extends SynchroCheckOptions {
  materials?: GameCard[];
}

interface SynchroSelectionCandidate extends RawSelectionCandidate {
  key: string;
  cardRef: GameCard & SelectionCardReference;
}

interface SynchroSelectionRequirement extends RawSelectionRequirement {
  id: "synchro_materials";
  candidates: SynchroSelectionCandidate[];
}

interface SynchroSelectionContract extends RawSelectionContract {
  message: string;
  requirements: [SynchroSelectionRequirement];
}

interface SynchroSelectionSessionInput
  extends Omit<SelectionSessionInput, "execute" | "selectionContract"> {
  selectionContract: SynchroSelectionContract;
  execute?: (
    selections: SelectionResult,
  ) => MaybePromise<SummonExecutionResult>;
}

interface SynchroHost {
  player: GamePlayer;
  bot: GamePlayer;
  turnCounter: number;
  synchroSummonContextCounter: number;
  pendingSynchroMaterialFollowups: SynchroMaterialFollowup[];
  pendingSynchroMaterialTriggerContinuation: SynchroTriggerContinuation | null;
  effectEngine?: SynchroEffectEnginePort;
  ui: { log?(message: string): void };
  canUseAsSynchroMaterial(
    player: GamePlayer,
    card: GameCard,
  ): SynchroMaterialCheck;
  getSynchroMaterialCombos(
    player: GamePlayer,
    card: GameCard,
  ): GameCard[][];
  canSummonSynchroCard(
    player: GamePlayer,
    card: GameCard,
    options?: SynchroCheckOptions,
  ): SynchroSummonCheck;
  performSynchroSummon(
    player: GamePlayer,
    materials: GameCard[],
    card: GameCard,
    options?: PerformSynchroOptions,
  ): Promise<SummonExecutionResult>;
  canStartAction?(input: {
    actor: GamePlayer;
    kind: "synchro_summon";
    phaseReq: readonly ("main1" | "main2")[];
    silent: boolean;
  }): { ok: boolean; reason?: string };
  canPlaceCardOnField?(
    card: GameCard,
    player: GamePlayer,
    options: MoveCardOptions,
  ): MoveCardResult;
  createPreparedSummon(input: PreparedSummonInput): PreparedSummon;
  executeSummonTransaction(input: PreparedSummon): Promise<SummonExecutionResult>;
  moveCard(
    card: GameCard,
    player: GamePlayer,
    zone: "field" | "graveyard",
    options: MoveCardOptions,
  ): MaybePromise<MoveCardResult>;
  runZoneOp<Result>(
    label: string,
    operation: () => MaybePromise<Result>,
    options: ZoneOpOptions,
  ): MaybePromise<Result | ZoneOpFailure>;
  resolveEventEntries?(
    eventName: "card_to_grave",
    payload: unknown,
    entries: readonly unknown[],
    options: { orderRule: string; onComplete: (() => void) | null },
  ): MaybePromise<SynchroFlowResult>;
  applyPendingSynchroMaterialFollowups?(
    card: GameCard,
    player: GamePlayer,
    followups: readonly SynchroMaterialFollowup[],
    options: { actionContext: unknown; summonMethod: "synchro"; summonProcedure: "synchro" },
  ): MaybePromise<SynchroFlowResult>;
  getOpponent?(player: GamePlayer): GamePlayer | null;
  buildSelectionCandidateKey?(
    candidate: RawSelectionCandidate,
    index: number,
  ): string;
  startTargetSelectionSession(
    input: SelectionSessionInput | SynchroSelectionSessionInput,
  ): unknown;
  closeExtraDeckModal?(): void;
  updateBoard?(): MaybePromise<unknown>;
}

function runtimeSynchroDefinition(
  card: GameCard | null | undefined,
): RuntimeSynchroDefinition | null {
  return card?.synchro ?? null;
}

function getCardInstanceId(
  card: GameCard | null | undefined,
): number | string | null {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? null;
}

function isSynchroExtraDeckCard(
  card: GameCard | null | undefined,
): card is GameCard & { monsterType: "synchro" } {
  return Boolean(
    card &&
    card.cardKind === "monster" &&
    card.monsterType === "synchro",
  );
}

function isTuner(card: GameCard | null | undefined): boolean {
  return card?.isTuner === true;
}

function normalizeRoleRules(
  value: readonly CardFilter[] | CardFilter | null | undefined,
): CardFilter[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is CardFilter => Boolean(entry && typeof entry === "object"),
    );
  }
  return typeof value === "object" ? [value as CardFilter] : [];
}

function materialEffectsAreActive(
  game: SynchroHost,
  card: GameCard | null | undefined,
): boolean {
  if (!card || card.isFacedown) return false;
  if (typeof game.effectEngine?.isEffectNegated === "function") {
    return !game.effectEngine.isEffectNegated(card);
  }
  return card.effectsNegated !== true;
}

function getCardLevel(card: GameCard | null | undefined): number {
  const level = Number(card?.level || 0);
  return Number.isFinite(level) ? level : 0;
}

function uniqueCards(cards: readonly GameCard[] = []): GameCard[] {
  const seen = new Set<number | string | GameCard>();
  const result: GameCard[] = [];
  for (const card of cards) {
    if (!card) continue;
    const key = getCardInstanceId(card) || card;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(card);
  }
  return result;
}

function sameCardSet(
  left: readonly GameCard[] = [],
  right: readonly GameCard[] = [],
): boolean {
  if (left.length !== right.length) return false;
  const remaining = [...right];
  for (const card of left) {
    const index = remaining.indexOf(card);
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}

function selectionMatchesCombo(
  materials: readonly GameCard[] = [],
  combos: readonly (readonly GameCard[])[] = [],
): boolean {
  return combos.some((combo) => sameCardSet(materials, combo));
}

function getSynchroConfig(
  card: GameCard | null | undefined,
): RuntimeSynchroConfig {
  const config = runtimeSynchroDefinition(card);
  return {
    tunerCount: Number.isFinite(Number(config?.tunerCount))
      ? Math.max(1, Number(config?.tunerCount))
      : 1,
    nonTunerMin: Number.isFinite(Number(config?.nonTunerMin))
      ? Math.max(1, Number(config?.nonTunerMin))
      : 1,
    nonTunerMax: Number.isFinite(Number(config?.nonTunerMax))
      ? Math.max(1, Number(config?.nonTunerMax))
      : Infinity,
    materialFilters: config?.materialFilters || {},
    position: config?.position || "choice",
  };
}

function valueMatchesFilter<Value>(
  value: Value,
  filterValue: Value | readonly Value[] | null | undefined,
): boolean {
  if (filterValue === undefined || filterValue === null) return true;
  const requiredValues: readonly Value[] = Array.isArray(filterValue)
    ? filterValue
    : [filterValue as Value];
  return requiredValues.includes(value);
}

function cardMatchesSimpleSynchroFilter(
  card: GameCard | null | undefined,
  filters: RuntimeSynchroFilter = {},
): boolean {
  if (!card) return false;
  const idFilter = filters.cardId ?? filters.id;
  if (!valueMatchesFilter(card.id, idFilter)) return false;
  if (!valueMatchesFilter(card.name, filters.name || filters.cardName)) {
    return false;
  }
  if (!valueMatchesFilter(card.cardKind, filters.cardKind)) return false;
  if (!valueMatchesFilter(card.monsterType, filters.monsterType)) return false;
  if (filters.isTuner !== undefined) {
    if ((card.isTuner === true) !== Boolean(filters.isTuner)) return false;
  }
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  if (filters.type && !valueMatchesFilter(card.type, filters.type)) {
    return false;
  }
  if (filters.attribute && !valueMatchesFilter(card.attribute, filters.attribute)) {
    return false;
  }
  if (filters.minLevel !== undefined && getCardLevel(card) < filters.minLevel) {
    return false;
  }
  if (filters.maxLevel !== undefined && getCardLevel(card) > filters.maxLevel) {
    return false;
  }
  if (
    (filters.requireFaceup === true || filters.faceUp === true) &&
    card.isFacedown
  ) {
    return false;
  }
  return true;
}

function cardMatchesSynchroFilter(
  game: SynchroHost,
  card: GameCard,
  filters: RuntimeSynchroFilter | null | undefined,
): boolean {
  if (!filters || Object.keys(filters).length === 0) return true;
  if (game.effectEngine?.cardMatchesFilters) {
    return game.effectEngine.cardMatchesFilters(card, filters as CardFilter);
  }
  return cardMatchesSimpleSynchroFilter(card, filters);
}

function materialPassesSynchroFilters(
  game: SynchroHost,
  card: GameCard,
  role: SynchroMaterialRoleEntry["role"],
  materialFilters: RuntimeSynchroMaterialFilters = {},
): boolean {
  if (!cardMatchesSynchroFilter(game, card, materialFilters.all || {})) {
    return false;
  }
  const roleFilters =
    role === "tuner"
      ? materialFilters.tuner || {}
      : materialFilters.nonTuner || materialFilters.non_tuner || {};
  return cardMatchesSynchroFilter(game, card, roleFilters);
}

function canTreatAsSynchroNonTuner(
  game: SynchroHost,
  card: GameCard,
  synchroCard: GameCard,
): boolean {
  if (!isTuner(card)) return true;
  if (!materialEffectsAreActive(game, card)) return false;

  const rules = normalizeRoleRules(card?.synchroMaterialRoles?.nonTunerFor);
  if (rules.length === 0) return false;

  return rules.some((rule) => cardMatchesSynchroFilter(game, synchroCard, rule));
}

function getSynchroMaterialRoleEntries(
  game: SynchroHost,
  card: GameCard,
  synchroCard: GameCard,
  config: RuntimeSynchroConfig,
): SynchroMaterialRoleEntry[] {
  const entries: SynchroMaterialRoleEntry[] = [];
  if (
    isTuner(card) &&
    materialPassesSynchroFilters(
      game,
      card,
      "tuner",
      config.materialFilters,
    )
  ) {
    entries.push({ card, role: "tuner" });
  }

  if (
    canTreatAsSynchroNonTuner(game, card, synchroCard) &&
    materialPassesSynchroFilters(
      game,
      card,
      "nonTuner",
      config.materialFilters,
    )
  ) {
    entries.push({ card, role: "nonTuner" });
  }

  return entries;
}

function roleGroupsShareCards(
  left: readonly SynchroMaterialRoleEntry[] = [],
  right: readonly SynchroMaterialRoleEntry[] = [],
): boolean {
  const used = new Set(
    left.map((entry) => getCardInstanceId(entry.card) || entry.card),
  );
  return right.some((entry) =>
    used.has(getCardInstanceId(entry.card) || entry.card),
  );
}

function dedupeSynchroCombos(
  combos: readonly (readonly GameCard[])[] = [],
): GameCard[][] {
  const seen = new Set<string>();
  const result: GameCard[][] = [];
  for (const combo of combos) {
    const instanceIds = combo.map((card) => getCardInstanceId(card));
    if (instanceIds.some((id) => id === null)) {
      result.push([...combo]);
      continue;
    }
    const key = instanceIds.map(String).sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push([...combo]);
  }
  return result;
}

function buildCombinations<Value>(
  cards: readonly Value[],
  minSize: number,
  maxSize: number,
): Value[][] {
  const result: Value[][] = [];
  const limit = Math.min(cards.length, maxSize);
  const search = (start: number, picked: Value[]) => {
    if (picked.length >= minSize) {
      result.push([...picked]);
    }
    if (picked.length >= limit) return;
    for (let index = start; index < cards.length; index += 1) {
      const candidate = cards[index];
      if (candidate === undefined) continue;
      picked.push(candidate);
      search(index + 1, picked);
      picked.pop();
    }
  };
  search(0, []);
  return result;
}

function captureSynchroMaterialMetadata(
  card: GameCard,
  player: GamePlayer,
  game: SynchroHost,
): SynchroMaterialMetadata {
  return {
    instanceId: getCardInstanceId(card),
    cardId: card?.id ?? null,
    name: card?.name || null,
    level: getCardLevel(card),
    isTuner: isTuner(card),
    ownerId: card?.owner || player?.id || null,
    controllerId: player?.id || card?.controller || card?.owner || null,
    usedOnTurn: Number.isFinite(Number(game?.turnCounter))
      ? Number(game.turnCounter)
      : null,
  };
}

function nextSynchroSummonContextId(game: SynchroHost | null): string {
  if (!game) return `synchro_${Math.random().toString(36).slice(2, 9)}`;
  const next = Number(game.synchroSummonContextCounter || 0) + 1;
  game.synchroSummonContextCounter = next;
  return `synchro_${game.turnCounter || 0}_${next}`;
}

function takeSynchroMaterialFollowups(
  game: SynchroHost | null,
  contextId: string | null | undefined,
): SynchroMaterialFollowup[] {
  if (!game || !contextId) return [];
  const followups = Array.isArray(game.pendingSynchroMaterialFollowups)
    ? game.pendingSynchroMaterialFollowups
    : [];
  const matching: SynchroMaterialFollowup[] = [];
  const remaining: SynchroMaterialFollowup[] = [];
  for (const entry of followups) {
    if (entry?.synchroSummonContextId === contextId) {
      matching.push(entry);
    } else {
      remaining.push(entry);
    }
  }
  game.pendingSynchroMaterialFollowups = remaining;
  return matching;
}

interface SynchroMoveResult extends MoveCardResult {
  deferredCardToGraveTriggerPackage?: SynchroDeferredTriggerPackage;
}

function appendDeferredSynchroMaterialTriggerPackage(
  packages: SynchroDeferredTriggerPackage[],
  moveResult: SynchroMoveResult | null | undefined,
): void {
  const triggerPackage = moveResult?.deferredCardToGraveTriggerPackage || null;
  if (!triggerPackage || triggerPackage.collectedOnly !== true) return;
  if (!Array.isArray(triggerPackage.entries)) return;
  packages.push(triggerPackage);
}

function getPlayerById(
  game: SynchroHost | null,
  playerId: string | null | undefined,
  fallback: GamePlayer | null = null,
): GamePlayer | null {
  if (!game || !playerId) return fallback;
  if (game.player?.id === playerId) return game.player;
  if (game.bot?.id === playerId) return game.bot;
  return fallback;
}

async function applySynchroMaterialFollowupsForContext(
  game: SynchroHost,
  synchroSummonContextId: string,
  synchroCard: GameCard,
  player: GamePlayer,
  actionContext: unknown,
): Promise<SynchroFlowResult> {
  const followups = takeSynchroMaterialFollowups(
    game,
    synchroSummonContextId,
  );
  if (followups.length === 0) {
    return { ok: true, needsSelection: false };
  }

  const followupResult =
    await game.applyPendingSynchroMaterialFollowups?.(
      synchroCard,
      player,
      followups,
      {
        actionContext,
        summonMethod: "synchro",
        summonProcedure: "synchro",
      },
    );
  if (followupResult?.needsSelection) {
    return followupResult;
  }
  if (followupResult?.success === false) {
    return {
      ok: false,
      needsSelection: false,
      reason: followupResult.reason || "synchro_material_followup_failed",
    };
  }
  return { ok: true, needsSelection: false };
}

async function resolveDeferredSynchroMaterialTriggers(
  game: SynchroHost,
  packages: readonly SynchroDeferredTriggerPackage[],
  synchroSummonContextId: string,
  synchroCard: GameCard,
  player: GamePlayer,
  actionContext: unknown,
): Promise<SynchroFlowResult> {
  const entries = packages.flatMap((entryPackage) =>
    Array.isArray(entryPackage?.entries) ? entryPackage.entries : [],
  );
  if (entries.length > 0) {
    const onCompleteHandlers = packages
      .map((entryPackage) => entryPackage?.onComplete)
      .filter((handler): handler is () => void => typeof handler === "function");
    const orderRules = packages
      .map((entryPackage) => entryPackage?.orderRule)
      .filter(Boolean);
    const payload = {
      player,
      opponent: game.getOpponent?.(player) || null,
      contextLabel: "synchro_material",
      actionContext,
      deferredSynchroMaterialTriggers: true,
      synchroSummonContextId,
      synchroSummonedCard: synchroCard,
    };
    const triggerResult = await game.resolveEventEntries?.(
      "card_to_grave",
      payload,
      entries,
      {
        orderRule: orderRules.join(" -> "),
        onComplete:
          onCompleteHandlers.length > 0
            ? () => {
                for (const handler of onCompleteHandlers) handler();
              }
            : null,
      },
    );
    if (triggerResult?.needsSelection) {
      game.pendingSynchroMaterialTriggerContinuation = {
        stage: "material_triggers",
        synchroSummonContextId,
        summonedCard: synchroCard,
        playerId: player?.id || null,
        actionContext,
      };
      return triggerResult;
    }
  }

  game.pendingSynchroMaterialTriggerContinuation = null;
  return await applySynchroMaterialFollowupsForContext(
    game,
    synchroSummonContextId,
    synchroCard,
    player,
    actionContext,
  );
}

export async function finishPendingSynchroMaterialTriggerContinuation(
  this: SynchroHost,
  resolutionResult: SynchroContinuationResolution | null = null,
  eventName: "after_summon" | "card_to_grave" | string | null = null,
): Promise<SynchroFlowResult | null> {
  const pending = this.pendingSynchroMaterialTriggerContinuation;
  if (!pending || resolutionResult?.needsSelection) return null;
  if (resolutionResult && resolutionResult.ok === false) return null;
  if (eventName && eventName !== "after_summon" && eventName !== "card_to_grave") {
    return null;
  }

  const player = getPlayerById(this, pending.playerId, null);
  const synchroCard = pending.summonedCard || null;
  if (!player || !synchroCard || !pending.synchroSummonContextId) {
    this.pendingSynchroMaterialTriggerContinuation = null;
    return null;
  }

  if (pending.stage === "after_summon") {
    const packages = Array.isArray(pending.deferredTriggerPackages)
      ? pending.deferredTriggerPackages
      : [];
    this.pendingSynchroMaterialTriggerContinuation = null;
    return await resolveDeferredSynchroMaterialTriggers(
      this,
      packages,
      pending.synchroSummonContextId,
      synchroCard,
      player,
      pending.actionContext || {},
    );
  }

  this.pendingSynchroMaterialTriggerContinuation = null;
  return await applySynchroMaterialFollowupsForContext(
    this,
    pending.synchroSummonContextId,
    synchroCard,
    player,
    pending.actionContext || {},
  );
}

function buildSynchroMaterialSelectionContract(
  game: SynchroHost,
  card: GameCard,
  player: GamePlayer,
  candidates: readonly GameCard[],
): SynchroSelectionContract {
  const owner = player.id === "player" ? "player" : "opponent";
  const decorated = candidates
    .map((material, index) => {
      const zoneIndex = player.field.indexOf(material);
      const candidate: Omit<SynchroSelectionCandidate, "key"> = {
        name: material.name,
        owner,
        controller: player.id,
        zone: "field",
        zoneIndex,
        atk: material.atk || 0,
        def: material.def || 0,
        level: getCardLevel(material),
        cardKind: material.cardKind,
        cardRef: material,
      };
      return {
        ...candidate,
        key:
          game.buildSelectionCandidateKey?.(candidate, index) ||
          `${player.id}:field:${zoneIndex}:${material.id || index}`,
      };
    });

  return {
    kind: "choice",
    message: `Select Synchro materials for ${card.name}.`,
    requirements: [
      {
        id: "synchro_materials",
        min: 2,
        max: decorated.length,
        zones: ["field"],
        owner,
        filters: {
          cardKind: "monster",
          faceUp: true,
        },
        allowSelf: true,
        distinct: true,
        candidates: decorated,
        label: "Synchro Materials",
      },
    ],
    ui: { useFieldTargeting: true, allowCancel: true },
    metadata: {
      context: "extra_deck_synchro_materials",
      sourceCard: card,
    },
  };
}

export function canUseAsSynchroMaterial(
  this: SynchroHost,
  player: GamePlayer | null | undefined,
  materialCard: GameCard | null | undefined,
): SynchroMaterialCheck {
  if (!player || !materialCard) {
    return { ok: false, reason: "Missing material." };
  }
  if (!Array.isArray(player.field) || !player.field.includes(materialCard)) {
    return { ok: false, reason: "Synchro materials must be on the field." };
  }
  if (materialCard.cardKind !== "monster") {
    return { ok: false, reason: "Synchro materials must be monsters." };
  }
  if (materialCard.isFacedown) {
    return { ok: false, reason: "Synchro materials must be face-up." };
  }
  return { ok: true };
}

export function getSynchroMaterialCombos(
  this: SynchroHost,
  player: GamePlayer | null | undefined,
  synchroCard: GameCard | null | undefined,
): GameCard[][] {
  if (!player || !isSynchroExtraDeckCard(synchroCard)) return [];
  const targetLevel = getCardLevel(synchroCard);
  if (targetLevel <= 0) return [];

  const config = getSynchroConfig(synchroCard);
  const materialRoleEntries = (player.field || []).flatMap((card) => {
    const materialCheck = this.canUseAsSynchroMaterial?.(player, card) || {
      ok: false,
    };
    if (materialCheck.ok !== true) return [];
    return getSynchroMaterialRoleEntries(
      this,
      card,
      synchroCard,
      config,
    );
  });

  const tuners = materialRoleEntries.filter((entry) => entry.role === "tuner");
  const nonTuners = materialRoleEntries.filter(
    (entry) => entry.role === "nonTuner",
  );
  const tunerCombos = buildCombinations(
    tuners,
    config.tunerCount,
    config.tunerCount,
  );
  const nonTunerCombos = buildCombinations(
    nonTuners,
    config.nonTunerMin,
    config.nonTunerMax,
  );

  const combos: GameCard[][] = [];
  for (const tunerGroup of tunerCombos) {
    if (tunerGroup.length !== config.tunerCount) continue;
    for (const nonTunerGroup of nonTunerCombos) {
      const nonTunerCount = nonTunerGroup.length;
      if (
        nonTunerCount < config.nonTunerMin ||
        nonTunerCount > config.nonTunerMax
      ) {
        continue;
      }
      if (roleGroupsShareCards(tunerGroup, nonTunerGroup)) continue;

      const combo = [...tunerGroup, ...nonTunerGroup].map(
        (entry) => entry.card,
      );
      const totalLevel = combo.reduce((sum, card) => sum + getCardLevel(card), 0);
      if (totalLevel === targetLevel) {
        combos.push(combo);
      }
    }
  }
  return dedupeSynchroCombos(combos);
}

export function canSummonSynchroCard(
  this: SynchroHost,
  player: GamePlayer | null | undefined,
  synchroCard: GameCard | null | undefined,
  options: SynchroCheckOptions = {},
): SynchroSummonCheck {
  if (!player || !isSynchroExtraDeckCard(synchroCard)) {
    return { ok: false, reason: "No Synchro summon procedure.", type: "synchro" };
  }
  const eligibility = checkSpecialSummonEligibility(synchroCard, {
    summonProcedure: "synchro",
    fromZone: "extraDeck",
  });
  if (!eligibility.ok) {
    return {
      ok: false,
      reason: eligibility.reason || "This card cannot be Synchro Summoned.",
      type: "synchro",
    };
  }
  if (
    options.checkActionWindow !== false &&
    typeof this.canStartAction === "function"
  ) {
    const actionCheck = this.canStartAction({
      actor: player,
      kind: "synchro_summon",
      phaseReq: ["main1", "main2"],
      silent: options.silent !== false,
    });
    if (!actionCheck.ok) {
      return {
        ok: false,
        reason: actionCheck.reason || "This card cannot be summoned now.",
        type: "synchro",
      };
    }
  }

  const materialCombos = this.getSynchroMaterialCombos?.(
    player,
    synchroCard,
  ) || [];
  if (materialCombos.length === 0) {
    return {
      ok: false,
      reason: "Need exactly 1 Tuner and 1 or more non-Tuners with matching total Levels.",
      type: "synchro",
      candidates: [],
      materialCombos,
    };
  }

  const fieldCheck = this.canPlaceCardOnField?.(synchroCard, player, {
    isFacedown: false,
    excludeCards: materialCombos[0],
    summonMethod: "synchro",
    summonProcedure: "synchro",
    silent: options.silent !== false,
  });
  if (fieldCheck?.ok === false) {
    return {
      ...fieldCheck,
      type: "synchro",
      candidates: uniqueCards(materialCombos.flat()),
      materialCombos,
    } as SynchroSummonCheck;
  }

  return {
    ok: true,
    type: "synchro",
    candidates: uniqueCards(materialCombos.flat()),
    materialCombos,
    requiredCount: null,
  };
}

export async function performSynchroSummon(
  this: SynchroHost,
  player: GamePlayer | null | undefined,
  materials: GameCard[] | null | undefined,
  synchroCard: GameCard | null | undefined,
  options: PerformSynchroOptions = {},
): Promise<SummonExecutionResult> {
  if (!player || !synchroCard || !Array.isArray(materials)) {
    return { success: false, reason: "invalid_synchro_summon" };
  }

  const check = this.canSummonSynchroCard(player, synchroCard, {
    silent: false,
    checkActionWindow: options.checkActionWindow !== false,
  });
  if (!check.ok) {
    this.ui?.log?.(check.reason || "Cannot Synchro Summon this card.");
    return { success: false, reason: check.reason || "synchro_unavailable" };
  }
  if (!selectionMatchesCombo(materials, check.materialCombos)) {
    this.ui?.log?.("Invalid Synchro materials.");
    return { success: false, reason: "invalid_synchro_materials" };
  }

  const positionPref = options.position || getSynchroConfig(synchroCard).position;
  const resolvedPosition =
    positionPref === "choice" &&
    typeof this.effectEngine?.chooseSpecialSummonPosition === "function"
      ? await this.effectEngine.chooseSpecialSummonPosition(synchroCard, player, {
          position: positionPref,
        })
      : positionPref === "defense"
        ? "defense"
        : "attack";

  const materialMetadata = materials.map((card) =>
    captureSynchroMaterialMetadata(card, player, this),
  );
  const synchroSummonContextId =
    options.synchroSummonContextId || nextSynchroSummonContextId(this);
  const synchroActionContext = {
    ...(options.actionContext || {}),
    synchroSummonContextId,
    synchroSummonCardId: synchroCard.id ?? null,
    synchroSummonCardName: synchroCard.name || null,
  };

  const summonOrigin =
    options.summonOrigin === SUMMON_ORIGINS.EFFECT_RESOLUTION
      ? SUMMON_ORIGINS.EFFECT_RESOLUTION
      : SUMMON_ORIGINS.PROCEDURE;
  const deferredMaterialTriggerPackages: SynchroDeferredTriggerPackage[] = [];
  const prepared = this.createPreparedSummon({
    card: synchroCard,
    controller: player,
    sourceZone: "extraDeck",
    summonOrigin,
    summonMode: SUMMON_MODES.SUMMON,
    summonMethod: "synchro",
    summonProcedure: "synchro",
    position: resolvedPosition,
    costPayments: materials.map((material) => ({
      card: material,
      owner: player,
      fromZone: "field",
      toZone: "graveyard",
      kind: "synchro_material",
      pay: async () => {
        const moveResult = await this.moveCard(material, player, "graveyard", {
          fromZone: "field",
          contextLabel: "synchro_material",
          awaitCardToGraveEvent: true,
          awaitCardMovedEvent: true,
          deferCardToGraveTriggerResolution: true,
          wasDestroyed: false,
          actionContext: synchroActionContext,
        });
        appendDeferredSynchroMaterialTriggerPackage(
          deferredMaterialTriggerPackages,
          moveResult,
        );
        if (moveResult?.success === false) {
          takeSynchroMaterialFollowups(this, synchroSummonContextId);
        }
        return moveResult;
      },
    })),
    perform: async (transaction) =>
      await this.runZoneOp(
        "SYNCHRO_SUMMON",
        async () => {
          const postMaterialLimitCheck = this.canPlaceCardOnField?.(
            synchroCard,
            player,
            {
              isFacedown: false,
              summonMethod: "synchro",
              summonProcedure: "synchro",
            },
          );
          if (postMaterialLimitCheck?.ok === false) {
            takeSynchroMaterialFollowups(this, synchroSummonContextId);
            return {
              success: false,
              reason:
                postMaterialLimitCheck.reason ||
                "Cannot place Synchro monster on the field.",
            };
          }

          const summonResult = await this.moveCard(
            synchroCard,
            player,
            "field",
            {
              fromZone: "extraDeck",
              position: resolvedPosition,
              isFacedown: false,
              resetAttackFlags: true,
              summonMethodOverride: "synchro",
              summonProcedure: "synchro",
              summonOrigin,
              summonTransaction: transaction,
              contextLabel: "synchro_summon",
              actionContext: synchroActionContext,
              synchroMaterialFollowups: takeSynchroMaterialFollowups(
                this,
                synchroSummonContextId,
              ),
            },
          );
          if (summonResult?.success === false) {
            return {
              success: false,
              reason: summonResult.reason || "Synchro summon failed.",
            };
          }

          synchroCard.synchroMaterials = materialMetadata;
          if (summonResult.needsSelection) {
            this.pendingSynchroMaterialTriggerContinuation = {
              stage: "after_summon",
              synchroSummonContextId,
              summonedCard: synchroCard,
              playerId: player?.id || null,
              actionContext: synchroActionContext,
              deferredTriggerPackages: deferredMaterialTriggerPackages,
            };
            return {
              success: true,
              needsSelection: true,
              selectionContract: summonResult.selectionContract,
            };
          }
          const deferredTriggerResult =
            await resolveDeferredSynchroMaterialTriggers(
              this,
              deferredMaterialTriggerPackages,
              synchroSummonContextId,
              synchroCard,
              player,
              synchroActionContext,
            );
          if (deferredTriggerResult?.needsSelection) {
            return {
              success: true,
              needsSelection: true,
              selectionContract: deferredTriggerResult.selectionContract,
            };
          }
          return { success: true, needsSelection: false };
        },
        {
          contextLabel: "synchro_summon",
          card: synchroCard,
          fromZone: "extraDeck",
          toZone: "field",
        },
      ),
  });
  const result = await this.executeSummonTransaction(prepared);

  if (result?.success) {
    this.closeExtraDeckModal?.();
    this.ui?.log?.(
      `${player.name || player.id} Synchro Summoned ${synchroCard.name}.`,
    );
    this.updateBoard?.();
  } else if (result?.reason) {
    this.ui?.log?.(result.reason);
  }

  return (
    result || {
      success: false,
      needsSelection: false,
      reason: "Synchro summon failed.",
    }
  );
}

export async function performSynchroSummonFromExtraDeck(
  this: SynchroHost,
  cardOrIndex: GameCard | number,
  player: GamePlayer | null | undefined,
  options: ExtraDeckSynchroOptions = {},
): Promise<SummonExecutionResult> {
  const extraDeck = player?.extraDeck || [];
  const card =
    typeof cardOrIndex === "number" ? extraDeck[cardOrIndex] : cardOrIndex;
  if (!card || !player) return { success: false, reason: "missing_card" };

  const check = this.canSummonSynchroCard(player, card, {
    silent: false,
    checkActionWindow: !Array.isArray(options.materials),
  });
  if (!check.ok) {
    this.ui?.log?.(check.reason || "Cannot Synchro Summon this card.");
    return { success: false, reason: check.reason || "synchro_unavailable" };
  }

  let materials = Array.isArray(options.materials) ? options.materials : null;
  if (!materials) {
    if (isAI(player)) {
      materials = check.materialCombos[0] || [];
    } else {
      const selectionContract = buildSynchroMaterialSelectionContract(
        this,
        card,
        player,
        check.candidates,
      );
      this.closeExtraDeckModal?.();
      this.startTargetSelectionSession({
        kind: "synchro",
        card,
        owner: player,
        selectionContract,
        message: selectionContract.message,
        execute: async (selections) => {
          const keys = selections?.synchro_materials || [];
          const selected = keys
            .map((key) =>
              selectionContract.requirements[0].candidates.find(
                (candidate) => candidate.key === key,
              )?.cardRef,
            )
            .filter((candidate): candidate is GameCard => Boolean(candidate));
          return await this.performSynchroSummon(player, selected, card, {
            checkActionWindow: false,
          });
        },
      });
      return { success: false, needsSelection: true, selectionContract };
    }
  }

  return await this.performSynchroSummon(player, materials, card, {
    checkActionWindow: !Array.isArray(options.materials),
  });
}
