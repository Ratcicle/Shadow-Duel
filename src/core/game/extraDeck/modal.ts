/**
 * modal.js
 *
 * Extra Deck modal methods extracted from Game.js.
 * Handles extra deck viewing UI.
 *
 * Methods: openExtraDeckModal, closeExtraDeckModal
 */

import { isAI } from "../../Player.js";
import {
  SUMMON_MODES,
  SUMMON_ORIGINS,
} from "../summon/transaction.js";
import { checkSpecialSummonEligibility } from "../summon/eligibility.js";
import type {
  BattlePosition,
  BattlePositionInput,
  ExtraDeckProcedureMaterial,
  ExtraDeckSummonProcedure,
  FusionMaterialDefinition,
  GameCard,
} from "../../contracts/cards.js";
import type {
  MaybePromise,
  MoveCardOptions,
  MoveCardResult,
  PreparedSummon,
  PreparedSummonInput,
  SummonExecutionResult,
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
import type { CanonicalZone } from "../../contracts/zones.js";

type SupportedProcedureType = ExtraDeckSummonProcedure["type"];

interface RuntimeMaterialRequirement {
  readonly count?: number;
  readonly allowedZones?: readonly CanonicalZone[];
  readonly archetype?: string;
  readonly cardKind?: GameCard["cardKind"];
  readonly name?: string;
  readonly type?: GameCard["type"];
  readonly attribute?: GameCard["attribute"];
  readonly minLevel?: number;
  readonly maxLevel?: number;
  readonly zone?: CanonicalZone;
}

interface MaterialEntry {
  card: GameCard;
  zone: CanonicalZone;
}

interface ExtraDeckCheckOptions {
  checkActionWindow?: boolean;
  silent?: boolean;
}

interface ExtraDeckPerformOptions extends ExtraDeckCheckOptions {
  materials?: GameCard[];
  position?: BattlePosition;
}

interface AscensionPerformOptions extends ExtraDeckCheckOptions {
  material?: GameCard;
}

interface ProcedureCheckSuccess {
  ok: true;
  candidates: GameCard[];
  requiredCount: number;
  procedure: ExtraDeckSummonProcedure;
  materialCombos: GameCard[][] | null;
  materialEntries: MaterialEntry[];
}

interface ProcedureCheckFailure {
  ok: false;
  reason?: string | null;
  candidates?: GameCard[];
  materialCombos?: GameCard[][] | null;
  materialEntries?: MaterialEntry[];
}

type ProcedureCheckResult = ProcedureCheckSuccess | ProcedureCheckFailure;

interface AscensionCheckSuccess {
  ok: true;
  type: "ascension";
  candidates: GameCard[];
  requiredCount: 1;
}

interface AscensionCheckFailure {
  ok: false;
  reason: string;
  candidates?: GameCard[];
}

type AscensionCheckResult = AscensionCheckSuccess | AscensionCheckFailure;

interface GenericExtraDeckCheck {
  ok: boolean;
  reason?: string | null;
  type?: "procedure" | "ascension" | "synchro" | "none";
}

interface MaterialSelectionCandidate extends RawSelectionCandidate {
  key: string;
  cardRef: GameCard & SelectionCardReference;
  zone: CanonicalZone;
}

interface MaterialSelectionRequirement extends RawSelectionRequirement {
  id: "extra_deck_materials";
  candidates: MaterialSelectionCandidate[];
}

interface MaterialSelectionContract extends RawSelectionContract {
  requirements: [MaterialSelectionRequirement];
  ui: { allowCancel: true; message: string };
}

interface AscensionSelectionCandidate extends RawSelectionCandidate {
  key: string;
  cardRef: GameCard & SelectionCardReference;
}

interface AscensionSelectionRequirement extends RawSelectionRequirement {
  id: "ascension_material";
  candidates: AscensionSelectionCandidate[];
}

interface AscensionSelectionContract extends RawSelectionContract {
  kind: "choice";
  message: string;
  requirements: [AscensionSelectionRequirement];
}

interface ExtraDeckSelectionSessionInput
  extends Omit<SelectionSessionInput, "execute"> {
  execute?: (
    selections: SelectionResult,
  ) => MaybePromise<SummonExecutionResult>;
}

interface ExtraDeckUiPort {
  log?(message: string): void;
  renderExtraDeckModal(
    cards: GameCard[],
    options: {
      isSummonable(card: GameCard): boolean;
      getDisabledReason(card: GameCard): string | null;
      onCardClick(card: GameCard): Promise<void>;
    },
  ): void;
  toggleExtraDeckModal(open: boolean): void;
}

interface ExtraDeckHost {
  turn: string;
  ui: ExtraDeckUiPort;
  autoSelector?: {
    select?(
      contract: RawSelectionContract,
      context: { owner: GamePlayer; selectionKind: "extra_deck_materials" },
    ): { selections?: SelectionResult } | null;
  };
  canStartAction?(input: {
    actor: GamePlayer;
    kind: "extra_deck_summon" | "ascension_summon";
    phaseReq: readonly ("main1" | "main2")[];
    silent: boolean;
  }): { ok: boolean; reason?: string };
  canPlaceCardOnField?(
    card: GameCard,
    player: GamePlayer,
    options: MoveCardOptions,
  ): MoveCardResult;
  canUseAsAscensionMaterial?(
    player: GamePlayer,
    card: GameCard,
  ): { ok: boolean; reason?: string };
  checkAscensionRequirements?(
    player: GamePlayer,
    ascensionCard: GameCard,
    material: GameCard,
  ): { ok: boolean; reason?: string };
  canSummonExtraDeckCardByProcedure(
    card: GameCard,
    player: GamePlayer | null | undefined,
    options?: ExtraDeckCheckOptions,
  ): ProcedureCheckResult;
  canSummonAscensionCardFromExtraDeck(
    card: GameCard,
    player: GamePlayer | null | undefined,
    options?: ExtraDeckCheckOptions,
  ): AscensionCheckResult;
  canSummonSynchroCard?(
    player: GamePlayer | null | undefined,
    card: GameCard,
    options?: ExtraDeckCheckOptions,
  ): GenericExtraDeckCheck;
  canSummonExtraDeckCard?(
    card: GameCard,
    player: GamePlayer,
    options?: ExtraDeckCheckOptions,
  ): GenericExtraDeckCheck;
  performExtraDeckSummonProcedure(
    card: GameCard,
    player: GamePlayer,
    options?: ExtraDeckPerformOptions,
  ): Promise<SummonExecutionResult>;
  performAscensionSummonFromExtraDeck(
    card: GameCard,
    player: GamePlayer,
    options?: AscensionPerformOptions,
  ): Promise<SummonExecutionResult>;
  performSynchroSummonFromExtraDeck(
    card: GameCard,
    player: GamePlayer,
  ): Promise<SummonExecutionResult>;
  performAscensionSummon(
    player: GamePlayer,
    material: GameCard,
    card: GameCard,
  ): Promise<SummonExecutionResult>;
  createPreparedSummon(input: PreparedSummonInput): PreparedSummon;
  executeSummonTransaction(prepared: PreparedSummon): Promise<SummonExecutionResult>;
  moveCard(
    card: GameCard,
    player: GamePlayer,
    zone: "field",
    options: MoveCardOptions,
  ): MaybePromise<MoveCardResult | SummonExecutionResult>;
  buildSelectionCandidateKey?(
    candidate: RawSelectionCandidate,
    index: number,
  ): string;
  startTargetSelectionSession(
    input: SelectionSessionInput | ExtraDeckSelectionSessionInput,
  ): unknown;
  closeExtraDeckModal?(): void;
  updateBoard?(): MaybePromise<unknown>;
}

const SUPPORTED_PROCEDURE_TYPES: ReadonlySet<SupportedProcedureType> = new Set([
  "graveyard_banish_fusion",
  "contact_fusion",
]);

function asArray<Value>(
  value: Value | readonly Value[] | null | undefined,
  fallback: readonly Value[] = [],
): readonly Value[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return fallback;
  return [value as Value];
}

function cardHasArchetype(
  card: GameCard | null | undefined,
  archetype: string | null | undefined,
): boolean {
  if (!archetype) return true;
  const archetypes = Array.isArray(card?.archetypes)
    ? card.archetypes
    : card?.archetype
      ? [card.archetype]
      : [];
  return archetypes.includes(archetype);
}

function cardMatchesRequirement(
  card: GameCard | null | undefined,
  requirement: RuntimeMaterialRequirement = {},
  materialZone: CanonicalZone | null = null,
): boolean {
  if (!card) return false;
  if (requirement.cardKind && card.cardKind !== requirement.cardKind) return false;
  if (requirement.archetype && !cardHasArchetype(card, requirement.archetype)) {
    return false;
  }
  if (requirement.type && card.type !== requirement.type) return false;
  if (requirement.name && card.name !== requirement.name) return false;
  if (requirement.attribute) {
    const expected = String(requirement.attribute).toLowerCase();
    if (String(card.attribute || "").toLowerCase() !== expected) return false;
  }
  if (requirement.minLevel !== undefined && (card.level || 0) < requirement.minLevel) {
    return false;
  }
  if (requirement.maxLevel !== undefined && (card.level || 0) > requirement.maxLevel) {
    return false;
  }
  const allowedZones = requirement.allowedZones
    ? asArray(requirement.allowedZones)
    : null;
  if (allowedZones && materialZone && !allowedZones.includes(materialZone)) {
    return false;
  }
  return true;
}

function getPlayerZoneCards(
  player: GamePlayer | null | undefined,
  zone: CanonicalZone,
): GameCard[] {
  if (!player) return [];
  const value = Reflect.get(player, zone);
  return Array.isArray(value)
    ? value.filter(
        (card): card is GameCard => Boolean(card && typeof card === "object"),
      )
    : [];
}

function getProcedureMaterials(
  player: GamePlayer | null | undefined,
  procedure: ExtraDeckSummonProcedure | null | undefined,
): GameCard[] {
  const materialReq = procedure?.materials?.[0] || null;
  if (!player || !materialReq) return [];
  const zone = materialReq.zone || "graveyard";
  const list = getPlayerZoneCards(player, zone);
  return list.filter((card) => cardMatchesRequirement(card, materialReq, zone));
}

function expandMaterialRequirements(
  requirements: readonly RuntimeMaterialRequirement[] = [],
): RuntimeMaterialRequirement[] {
  const expanded: RuntimeMaterialRequirement[] = [];
  for (const requirement of requirements) {
    const count = Number(requirement?.count || 1);
    for (let index = 0; index < Math.max(1, count); index += 1) {
      expanded.push(requirement || {});
    }
  }
  return expanded;
}

function findMaterialCombos(
  requirements: readonly RuntimeMaterialRequirement[] = [],
  materialEntries: readonly MaterialEntry[] = [],
): GameCard[][] {
  const expanded = expandMaterialRequirements(requirements);
  if (expanded.length === 0 || materialEntries.length < expanded.length) {
    return [];
  }

  const combos: GameCard[][] = [];
  const search = (
    reqIndex: number,
    picked: MaterialEntry[],
    remaining: readonly MaterialEntry[],
  ): void => {
    if (reqIndex >= expanded.length) {
      combos.push(picked.map((entry) => entry.card));
      return;
    }

    const requirement = expanded[reqIndex];
    for (let index = 0; index < remaining.length; index += 1) {
      const entry = remaining[index];
      if (!cardMatchesRequirement(entry.card, requirement, entry.zone)) {
        continue;
      }
      search(
        reqIndex + 1,
        [...picked, entry],
        [...remaining.slice(0, index), ...remaining.slice(index + 1)],
      );
    }
  };

  search(0, [], materialEntries);
  return combos;
}

function getContactFusionMaterialEntries(
  card: GameCard | null | undefined,
  player: GamePlayer | null | undefined,
): MaterialEntry[] {
  const requirements = card?.fusionMaterials || [];
  const allowedZones = new Set<CanonicalZone>();
  for (const requirement of requirements) {
    for (const zone of asArray<CanonicalZone>(
      requirement?.allowedZones,
      ["field"],
    )) {
      allowedZones.add(zone);
    }
  }
  if (allowedZones.size === 0) allowedZones.add("field");

  const entries = [];
  for (const zone of allowedZones) {
    const list = getPlayerZoneCards(player, zone);
    for (const material of list) {
      entries.push({ card: material, zone });
    }
  }
  return entries;
}

function uniqueCards(cards: readonly GameCard[] = []): GameCard[] {
  const seen = new Set<GameCard>();
  const unique: GameCard[] = [];
  for (const card of cards) {
    if (!card || seen.has(card)) continue;
    seen.add(card);
    unique.push(card);
  }
  return unique;
}

function materialSelectionMatchesCombo(
  materials: readonly GameCard[] = [],
  combos: readonly (readonly GameCard[])[] = [],
): boolean {
  if (!Array.isArray(materials) || !Array.isArray(combos)) return false;
  return combos.some((combo) => {
    if (!Array.isArray(combo) || combo.length !== materials.length) return false;
    const remaining = [...combo];
    for (const material of materials) {
      const index = remaining.indexOf(material);
      if (index < 0) return false;
      remaining.splice(index, 1);
    }
    return true;
  });
}

function getDefaultMaterialDestination(
  procedure: ExtraDeckSummonProcedure,
): CanonicalZone {
  if (procedure?.materialDestination) return procedure.materialDestination;
  return procedure?.type === "contact_fusion" ? "graveyard" : "banished";
}

function getDefaultMaterialSourceZone(
  procedure: ExtraDeckSummonProcedure,
): CanonicalZone {
  if (procedure?.type === "contact_fusion") return "field";
  return procedure?.materials?.[0]?.zone || "graveyard";
}

function isAscensionExtraDeckCard(
  card: GameCard | null | undefined,
): card is GameCard & { monsterType: "ascension" } {
  return Boolean(
    card &&
    card.cardKind === "monster" &&
    card.monsterType === "ascension" &&
    card.ascension &&
    typeof card.ascension === "object"
  );
}

function isSynchroExtraDeckCard(
  card: GameCard | null | undefined,
): card is GameCard & { monsterType: "synchro" } {
  return Boolean(
    card &&
    card.cardKind === "monster" &&
    card.monsterType === "synchro"
  );
}

function buildAscensionMaterialCandidates(
  game: ExtraDeckHost | null | undefined,
  ascensionCard: GameCard | null | undefined,
  player: GamePlayer | null | undefined,
): GameCard[] {
  if (!game || !isAscensionExtraDeckCard(ascensionCard) || !player) {
    return [];
  }
  const materials: GameCard[] = [];
  for (const material of player.field || []) {
    if (!material) continue;
    const materialCheck = game.canUseAsAscensionMaterial?.(player, material);
    if (materialCheck?.ok !== true) continue;
    const requirementCheck = game.checkAscensionRequirements?.(
      player,
      ascensionCard,
      material,
    );
    if (requirementCheck?.ok === true) {
      materials.push(material);
    }
  }
  return materials;
}

function buildAscensionMaterialSelectionContract(
  ascensionCard: GameCard,
  player: GamePlayer,
  materials: readonly GameCard[],
  game: ExtraDeckHost,
): AscensionSelectionContract {
  const owner = player.id === "player" ? "player" : "opponent";
  const candidates = materials
    .map((material) => {
      const zoneIndex = player.field.indexOf(material);
      const candidate: Omit<AscensionSelectionCandidate, "key"> = {
        name: material.name,
        owner,
        controller: player.id,
        zone: "field",
        zoneIndex,
        atk: material.atk || 0,
        def: material.def || 0,
        level: material.level || 0,
        cardKind: material.cardKind,
        cardRef: material,
      };
      return candidate;
    })
    .map((cand, idx) => ({
      ...cand,
      key:
        game.buildSelectionCandidateKey?.(cand, idx) ||
        `${cand.zoneIndex}:${idx}`,
    }));

  return {
    kind: "choice",
    message: `Select Ascension material for ${ascensionCard.name}.`,
    requirements: [
      {
        id: "ascension_material",
        min: 1,
        max: 1,
        zones: ["field"],
        owner,
        filters: {},
        allowSelf: true,
        distinct: true,
        candidates,
      },
    ],
    ui: { useFieldTargeting: true, allowCancel: true },
    metadata: {
      context: "extra_deck_ascension_material",
      sourceCard: ascensionCard,
    },
  };
}

export function canSummonExtraDeckCardByProcedure(
  this: ExtraDeckHost,
  card: GameCard | null | undefined,
  player: GamePlayer | null | undefined,
  options: ExtraDeckCheckOptions = {},
): ProcedureCheckResult {
  const procedure = card?.extraDeckSummonProcedure;
  if (!card || !player || !procedure) {
    return { ok: false, reason: "No summon procedure." };
  }
  if (!SUPPORTED_PROCEDURE_TYPES.has(procedure.type)) {
    return { ok: false, reason: "Unsupported summon procedure." };
  }
  if (
    options.checkActionWindow !== false &&
    typeof this.canStartAction === "function"
  ) {
    const actionCheck = this.canStartAction({
      actor: player,
      kind: "extra_deck_summon",
      phaseReq: ["main1", "main2"],
      silent: options.silent !== false,
    });
    if (!actionCheck.ok) {
      return {
        ok: false,
        reason: actionCheck.reason || "This card cannot be summoned now.",
      };
    }
  }
  const eligibility = checkSpecialSummonEligibility(card, {
    summonProcedure: procedure.type,
    fromZone: "extraDeck",
  });
  if (!eligibility.ok) {
    return { ok: false, reason: eligibility.reason || "Summon procedure is not allowed." };
  }
  let requiredCount = 0;
  let candidates: GameCard[] = [];
  let materialCombos: GameCard[][] | null = null;
  let materialEntries: MaterialEntry[] = [];
  let fieldCheckExclusions: GameCard[] = [];

  if (procedure.type === "contact_fusion") {
    const requirements: readonly FusionMaterialDefinition[] =
      card.fusionMaterials || [];
    materialEntries = getContactFusionMaterialEntries(card, player);
    materialCombos = findMaterialCombos(requirements, materialEntries);
    requiredCount = expandMaterialRequirements(requirements).length;
    candidates = uniqueCards(materialCombos.flat());
    fieldCheckExclusions = materialCombos[0] || [];
  } else {
    const materialReq: ExtraDeckProcedureMaterial =
      procedure.materials?.[0] || { count: 0 };
    requiredCount = Number(materialReq.count || 0);
    candidates = getProcedureMaterials(player, procedure);
    materialEntries = candidates.map((material) => ({
      card: material,
      zone: materialReq.zone || "graveyard",
    }));
  }

  if (
    candidates.length < requiredCount ||
    (materialCombos && materialCombos.length === 0)
  ) {
    const zoneLabel =
      procedure.type === "contact_fusion" ? "on the field" : "in the Graveyard";
    return {
      ok: false,
      reason: `Need ${requiredCount} valid material(s) ${zoneLabel}.`,
      candidates,
      materialCombos,
      materialEntries,
    };
  }
  const fieldCheck = this.canPlaceCardOnField?.(card, player, {
    isFacedown: false,
    excludeCards: fieldCheckExclusions,
    summonMethod: (procedure.type === "contact_fusion"
      ? "fusion"
      : procedure.type) as MoveCardOptions["summonMethod"],
    summonProcedure: procedure.type,
    silent: options.silent !== false,
  });
  if (fieldCheck?.ok === false) {
    return {
      ...fieldCheck,
      candidates,
      materialCombos,
      materialEntries,
    } as ProcedureCheckFailure;
  }
  return {
    ok: true,
    candidates,
    requiredCount,
    procedure,
    materialCombos,
    materialEntries,
  };
}

export function canSummonAscensionCardFromExtraDeck(
  this: ExtraDeckHost,
  card: GameCard | null | undefined,
  player: GamePlayer | null | undefined,
  options: ExtraDeckCheckOptions = {},
): AscensionCheckResult {
  if (!isAscensionExtraDeckCard(card) || !player) {
    return { ok: false, reason: "No Ascension summon procedure." };
  }
  if (
    options.checkActionWindow !== false &&
    typeof this.canStartAction === "function"
  ) {
    const actionCheck = this.canStartAction({
      actor: player,
      kind: "ascension_summon",
      phaseReq: ["main1", "main2"],
      silent: options.silent !== false,
    });
    if (!actionCheck.ok) {
      return {
        ok: false,
        reason: actionCheck.reason || "This card cannot be summoned now.",
      };
    }
  }

  const candidates = buildAscensionMaterialCandidates(this, card, player);
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: "No valid Ascension material on the field.",
      candidates,
    };
  }

  const fieldChecks = candidates.map((material) => ({
    material,
    check: this.canPlaceCardOnField?.(card, player, {
      isFacedown: false,
      excludeCards: [material],
      summonMethod: "ascension",
      summonProcedure: "ascension",
      silent: options.silent !== false,
    }) || { ok: true },
  }));
  const validAfterFieldChecks = fieldChecks
    .filter(({ check }) => check?.ok !== false)
    .map(({ material }) => material);
  if (validAfterFieldChecks.length === 0) {
    const reason =
      fieldChecks.find(({ check }) => check?.reason)?.check?.reason ||
      "Cannot place Ascension monster on the field.";
    return { ok: false, reason, candidates };
  }

  return {
    ok: true,
    type: "ascension",
    candidates: validAfterFieldChecks,
    requiredCount: 1,
  };
}

export function canSummonExtraDeckCard(
  this: ExtraDeckHost,
  card: GameCard | null | undefined,
  player: GamePlayer | null | undefined,
  options: ExtraDeckCheckOptions = {},
): GenericExtraDeckCheck {
  if (card?.extraDeckSummonProcedure) {
    const procedureCheck = this.canSummonExtraDeckCardByProcedure(
      card,
      player,
      options,
    );
    if (procedureCheck.ok) {
      return { ...procedureCheck, type: "procedure" };
    }
    if (!isAscensionExtraDeckCard(card)) {
      return { ...procedureCheck, type: "procedure" };
    }
  }

  if (isAscensionExtraDeckCard(card)) {
    return this.canSummonAscensionCardFromExtraDeck(card, player, options);
  }

  if (isSynchroExtraDeckCard(card)) {
    return this.canSummonSynchroCard?.(player, card, options) || {
      ok: false,
      reason: "No Synchro summon procedure.",
      type: "synchro",
    };
  }

  return { ok: false, reason: null, type: "none" };
}

function buildMaterialSelectionContract(
  card: GameCard,
  candidates: readonly GameCard[],
  count: number,
  procedure: ExtraDeckSummonProcedure,
  materialEntries: readonly MaterialEntry[] = [],
): MaterialSelectionContract {
  const defaultZone = getDefaultMaterialSourceZone(procedure);
  const getMaterialZone = (material: GameCard): CanonicalZone =>
    materialEntries.find((entry) => entry.card === material)?.zone || defaultZone;
  return {
    requirements: [
      {
        id: "extra_deck_materials",
        candidates: candidates.map((material, index) => ({
          key: `${getMaterialZone(material)}_${material.instanceId || material.id}_${index}`,
          cardRef: material,
          name: material.name,
          image: material.image,
          atk: material.atk,
          def: material.def,
          zone: getMaterialZone(material),
          owner: material.owner,
        })),
        min: count,
        max: count,
        label: `Select ${count} Fusion Materials`,
      },
    ],
    ui: {
      allowCancel: true,
      message: `Select materials for ${card.name}`,
    },
  };
}

export async function performExtraDeckSummonProcedure(
  this: ExtraDeckHost,
  cardOrIndex: GameCard | number,
  player: GamePlayer | null | undefined,
  options: ExtraDeckPerformOptions = {},
): Promise<SummonExecutionResult> {
  const extraDeck = player?.extraDeck || [];
  const card =
    typeof cardOrIndex === "number" ? extraDeck[cardOrIndex] : cardOrIndex;
  if (!card || !player) return { success: false, reason: "missing_card" };

  const check = this.canSummonExtraDeckCardByProcedure(card, player, {
    silent: false,
    checkActionWindow: !Array.isArray(options.materials),
  });
  if (!check.ok) {
    this.ui?.log?.(check.reason || "Cannot summon this card.");
    return { success: false, reason: check.reason || "procedure_unavailable" };
  }

  const procedure = check.procedure;
  const requiredCount = check.requiredCount;
  let materials = Array.isArray(options.materials) ? options.materials : null;

  if (!materials) {
    const contract = buildMaterialSelectionContract(
      card,
      check.candidates,
      requiredCount,
      procedure,
      check.materialEntries,
    );

    if (isAI(player)) {
      const auto = this.autoSelector?.select?.(contract, {
        owner: player,
        selectionKind: "extra_deck_materials",
      });
      const keys = auto?.selections?.extra_deck_materials || [];
      materials = keys
        .map((key) =>
          contract.requirements[0].candidates.find((cand) => cand.key === key)
            ?.cardRef,
        )
        .filter((material): material is GameCard => Boolean(material));
      if (
        check.materialCombos &&
        !materialSelectionMatchesCombo(materials, check.materialCombos)
      ) {
        materials = check.materialCombos[0] || [];
      }
    } else {
      this.startTargetSelectionSession({
        kind: "extra_deck_summon",
        card,
        owner: player,
        selectionContract: contract,
        message: contract.ui.message,
        execute: (selections) => {
          const keys = selections?.extra_deck_materials || [];
          const selected = keys
            .map((key) =>
              contract.requirements[0].candidates.find((cand) => cand.key === key)
                ?.cardRef,
            )
            .filter((material): material is GameCard => Boolean(material));
          void this.performExtraDeckSummonProcedure(card, player, {
            materials: selected,
          });
          return { success: true, needsSelection: false };
        },
      });
      return { success: false, needsSelection: true, selectionContract: contract };
    }
  }

  if (!Array.isArray(materials) || materials.length !== requiredCount) {
    return { success: false, reason: "invalid_material_count" };
  }
  const candidateSet = new Set(check.candidates);
  if (materials.some((material) => !candidateSet.has(material))) {
    return { success: false, reason: "invalid_materials" };
  }
  if (
    check.materialCombos &&
    !materialSelectionMatchesCombo(materials, check.materialCombos)
  ) {
    return { success: false, reason: "invalid_materials" };
  }

  const position = options.position || "attack";
  const prepared = this.createPreparedSummon({
    card,
    controller: player,
    sourceZone: "extraDeck",
    summonOrigin: SUMMON_ORIGINS.PROCEDURE,
    summonMode: SUMMON_MODES.SUMMON,
    summonMethod: procedure.summonMethod || "fusion",
    summonProcedure: procedure.type,
    position,
    costPayments: materials.map((material) => {
      const materialEntry = check.materialEntries?.find(
        (entry) => entry.card === material,
      );
      const materialDestination = getDefaultMaterialDestination(procedure);
      return {
        card: material,
        owner: player,
        fromZone:
          materialEntry?.zone || getDefaultMaterialSourceZone(procedure),
        toZone: materialDestination,
        kind: "extra_deck_material",
        contextLabel: "extra_deck_summon_material",
        options: {
          awaitCardToGraveEvent: materialDestination === "graveyard",
          awaitCardMovedEvent: true,
        },
      };
    }),
    perform: async (transaction) =>
      await this.moveCard(card, player, "field", {
        fromZone: "extraDeck",
        position,
        isFacedown: false,
        resetAttackFlags: true,
        summonMethodOverride: procedure.summonMethod || "fusion",
        summonProcedure: procedure.type,
        summonOrigin: SUMMON_ORIGINS.PROCEDURE,
        summonTransaction: transaction,
        contextLabel: "extra_deck_summon_procedure",
        awaitCardMovedEvent: true,
      }),
  });
  const result = await this.executeSummonTransaction(prepared);
  if (result?.success === false) {
    return result;
  }
  this.closeExtraDeckModal?.();
  this.ui?.log?.(`${card.name} was Fusion Summoned.`);
  this.updateBoard?.();
  return { ...result, success: true };
}

export async function performAscensionSummonFromExtraDeck(
  this: ExtraDeckHost,
  cardOrIndex: GameCard | number,
  player: GamePlayer | null | undefined,
  options: AscensionPerformOptions = {},
): Promise<SummonExecutionResult> {
  const extraDeck = player?.extraDeck || [];
  const card =
    typeof cardOrIndex === "number" ? extraDeck[cardOrIndex] : cardOrIndex;
  if (!card || !player) return { success: false, reason: "missing_card" };

  const check = this.canSummonAscensionCardFromExtraDeck(card, player, {
    silent: false,
    checkActionWindow: !options.material,
  });
  if (!check.ok) {
    this.ui?.log?.(check.reason || "Cannot Ascension Summon this card.");
    return { success: false, reason: check.reason || "ascension_unavailable" };
  }

  const materials = check.candidates || [];
  const material =
    options.material || (materials.length === 1 ? materials[0] : null);
  if (material) {
    this.closeExtraDeckModal?.();
    return await this.performAscensionSummon(player, material, card);
  }

  const selectionContract = buildAscensionMaterialSelectionContract(
    card,
    player,
    materials,
    this,
  );
  this.closeExtraDeckModal?.();
  this.startTargetSelectionSession({
    kind: "ascension",
    card,
    selectionContract,
    message: selectionContract.message,
    execute: async (selections) => {
      const key = (selections?.ascension_material || [])[0];
      const chosen =
        selectionContract.requirements[0].candidates.find(
          (candidate) => candidate.key === key,
        )?.cardRef || null;
      if (!chosen) {
        return {
          success: false,
          needsSelection: false,
          reason: "No Ascension material selected.",
        };
      }
      return await this.performAscensionSummon(player, chosen, card);
    },
  });
  return {
    success: false,
    needsSelection: true,
    selectionContract,
  };
}

/**
 * Opens the Extra Deck modal for a player.
 * @param player - The player whose Extra Deck to show
 */
export function openExtraDeckModal(
  this: ExtraDeckHost,
  player: GamePlayer,
): void {
  const activePlayer = this.turn === player?.id;
  const canUseProcedures = activePlayer && !isAI(player);
  const availability = new Map();
  for (const card of player?.extraDeck || []) {
    const check = this.canSummonExtraDeckCard?.(card, player, {
      silent: true,
    }) || { ok: false, reason: null };
    if (check.type !== "none" || check.reason) {
      availability.set(card, check);
    }
  }
  this.ui.renderExtraDeckModal(player.extraDeck, {
    isSummonable: (card) => canUseProcedures && availability.get(card)?.ok === true,
    getDisabledReason: (card) => availability.get(card)?.reason || null,
    onCardClick: async (card) => {
      if (!canUseProcedures) return;
      const check = availability.get(card);
      if (check?.ok !== true) return;
      if (check.type === "ascension") {
        await this.performAscensionSummonFromExtraDeck(card, player);
      } else if (check.type === "synchro") {
        await this.performSynchroSummonFromExtraDeck(card, player);
      } else {
        await this.performExtraDeckSummonProcedure(card, player);
      }
    },
  });
  this.ui.toggleExtraDeckModal(true);
}

/**
 * Closes the Extra Deck modal.
 */
export function closeExtraDeckModal(this: ExtraDeckHost): void {
  this.ui?.toggleExtraDeckModal?.(false);
}
