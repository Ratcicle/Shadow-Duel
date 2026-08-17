/**
 * destructionReplacement.js
 *
 * Destruction replacement-effect resolution extracted from Game.js.
 * Original `resolveDestructionWithReplacement` was 370 lines with three
 * inner closures (`formatReplacementText`, `matchesTargetFilters`,
 * `tryReplacement`). Those have been lifted to module-private helpers
 * that receive a destruction context object instead of capturing scope.
 *
 * Public method (bound via prototype on Game):
 *  - resolveDestructionWithReplacement
 */

import {
  canUseOncePerDuelEffect,
  markOncePerDuelEffectUsed,
} from "../../effects/triggers/registration.js";
import { getCardDisplayName, getUIText } from "../../i18n.js";
import type {
  ActionReplacementEffect,
  CardAction,
} from "../../contracts/actions.js";
import type { ResolvedTargetMap } from "../../contracts/actionRuntime.js";
import type { GameCard } from "../../contracts/cards.js";
import type {
  CardFilter,
  EffectDefinition,
  EffectTarget,
} from "../../contracts/effects.js";
import type {
  MaybePromise,
  MoveCardResult,
} from "../../contracts/gameRuntime.js";
import type { GamePlayer } from "../../contracts/player.js";
import type {
  RawSelectionCandidate,
  SelectionResult,
} from "../../contracts/selection.js";
import type { SelectionCandidateKey } from "../../contracts/primitives.js";
import type {
  CanonicalZone,
  ZoneInput,
} from "../../contracts/zones.js";

type ReplacementOwnerRule = "self" | "opponent" | "any" | "both" | "either";

interface RuntimeReplacementEffect extends ActionReplacementEffect {
  readonly allowFacedown?: boolean;
  readonly appliesTo?: ReplacementOwnerRule;
  readonly causedByOwner?: ReplacementOwnerRule;
  readonly costZones?: readonly ZoneInput[];
  readonly destroyedByOwner?: ReplacementOwnerRule;
  readonly sourceController?: ReplacementOwnerRule;
  readonly sourceOwner?: ReplacementOwnerRule;
  readonly targetCards?: readonly GameCard[];
  readonly targetInstanceIds?: readonly string[];
  readonly targetZone?: CanonicalZone;
}

interface ReplacementSourceCard {
  name: string;
  owner: string;
  isFacedown: boolean;
  instanceId?: number | string | null;
  fieldPresenceId?: number | string | null;
  equippedTo?: GameCard | null;
  equipTarget?: GameCard | number | string | null;
}

interface RuntimeReplacementEffectDefinition {
  readonly id?: string;
  readonly actions?: readonly CardAction[];
  readonly targets?: readonly EffectTarget[];
  readonly requireFaceup?: boolean;
  readonly requireZone?: CanonicalZone;
  readonly oncePerTurn?: boolean;
  readonly oncePerTurnName?: string;
  readonly oncePerDuel?: boolean;
  readonly oncePerDuelLimit?: number;
  readonly oncePerDuelName?: string;
  readonly replacementEffect: RuntimeReplacementEffect;
}

interface ReplacementActionResult {
  success?: boolean;
  executed?: boolean;
  needsSelection?: boolean;
  selectionContract?: unknown;
  reason?: string | null;
}

type ReplacementActionExecutionResult =
  | boolean
  | null
  | undefined
  | ReplacementActionResult;

interface ReplacementEffectEnginePort {
  applyActions(
    actions: readonly CardAction[],
    context: unknown,
    targets: unknown,
  ): MaybePromise<ReplacementActionExecutionResult>;
  cardMatchesFilters?(card: GameCard, filters: CardFilter): boolean;
  checkActionPreviewRequirements?(
    actions: readonly CardAction[],
    context: unknown,
  ): { ok: boolean; reason?: string };
  findCardZone?(
    owner: GamePlayer,
    card: ReplacementSourceCard,
  ): CanonicalZone | null;
}

interface ReplacementUiPort {
  log(message: string): void;
  showConfirmPrompt?(
    message: string,
    metadata: {
      kind: "destruction_replacement";
      cardName: string;
    },
  ): MaybePromise<boolean>;
}

interface ReplacementSelectionCandidate extends RawSelectionCandidate {
  cardRef: GameCard;
}

interface ReplacementSelectionSessionInput {
  kind: "destruction_replacement_target";
  card: ReplacementSourceCard;
  selectionContract: unknown;
  resolve(value: GameCard[]): void;
  autoAdvanceOnMax: true;
  preventCancel: true;
  execute(selections: SelectionResult): {
    success: true;
    needsSelection: false;
  };
}

interface LegacyCardSelectionInput {
  owner: "player";
  zone: ZoneInput;
  min: number;
  max: number;
  filter(card: GameCard): boolean;
  message: string;
}

interface ReplacementMoveOptions {
  fromZone: ZoneInput;
  awaitEvents: true;
  sourceCard: ReplacementSourceCard;
  effectId: string | null;
  contextLabel: "destruction_replacement_cost";
}

interface ReplacementDestroyOptions {
  cause: string;
  sourceCard: GameCard;
  opponent: GamePlayer | null;
  fromZone: "spellTrap";
}

interface TemporaryReplacementEntry {
  ownerId: string;
  sourceName?: string | null;
  replacementEffect: RuntimeReplacementEffect;
  expiresOnTurn?: number | null;
  usesRemaining?: number;
  usesPerTarget?: boolean;
  usedTargetKeys?: string[];
  usedTargetCards?: GameCard[];
}

interface DestructionReplacementHost {
  player: GamePlayer;
  bot: GamePlayer;
  turnCounter: number;
  temporaryReplacementEffects: Array<TemporaryReplacementEntry | null | undefined>;
  effectEngine?: ReplacementEffectEnginePort | null;
  ui: ReplacementUiPort;
  getOpponent(player: GamePlayer): GamePlayer | null;
  getZone?(player: GamePlayer, zone: ZoneInput): GameCard[] | null;
  buildSelectionCandidateKey?(
    candidate: RawSelectionCandidate,
    fallbackIndex?: number,
  ): SelectionCandidateKey;
  startTargetSelectionSession?(input: ReplacementSelectionSessionInput): void;
  askPlayerToSelectCards?(
    input: LegacyCardSelectionInput,
  ): MaybePromise<GameCard[] | null | undefined>;
  moveCard(
    card: GameCard,
    player: GamePlayer,
    destination: CanonicalZone,
    options: ReplacementMoveOptions,
  ): MaybePromise<MoveCardResult | boolean | null | undefined>;
  destroyCard(
    card: GameCard,
    options: ReplacementDestroyOptions,
  ): MaybePromise<{ destroyed?: boolean } | null | undefined>;
  canUseOncePerTurn(
    card: ReplacementSourceCard,
    player: GamePlayer,
    effect: RuntimeReplacementEffectDefinition,
  ): { ok: boolean; reason?: string };
  markOncePerTurnUsed(
    card: ReplacementSourceCard,
    player: GamePlayer,
    effect: RuntimeReplacementEffectDefinition,
  ): void;
  isBattleDestructionPreventionNegated?(
    card: GameCard,
    context: {
      owner: GamePlayer;
      preventionSourceOwner: GamePlayer;
      preventionSourceCard: ReplacementSourceCard;
      fromZone: CanonicalZone | null;
    },
  ): boolean;
}

interface ReplacementContext {
  card: GameCard;
  cause: string;
  fromZone: CanonicalZone | null;
  ownerPlayer: GamePlayer;
  sourceCard: GameCard | null;
  sourcePlayer: GamePlayer | null;
}

interface ReplacementDecisionInput {
  game: DestructionReplacementHost;
  player: GamePlayer;
  sourceCard: ReplacementSourceCard;
  effect: RuntimeReplacementEffectDefinition;
  replacementEffect: RuntimeReplacementEffect;
  targetCard: GameCard;
  cause: string;
  fromZone: CanonicalZone | null;
  context: ReplacementContext;
  kind: "destruction";
}

interface ReplacementStrategy {
  shouldUseReplacementEffect?(
    input: ReplacementDecisionInput,
  ): MaybePromise<boolean | { use?: boolean; shouldUse?: boolean }>;
}

interface ReplacementCostCandidate {
  card: GameCard;
  zone: ZoneInput;
}

interface ReplacementCostMoveInput {
  game: DestructionReplacementHost;
  cards: readonly GameCard[];
  costOwner: GamePlayer;
  costZones: readonly ZoneInput[];
  candidateEntries: readonly ReplacementCostCandidate[];
  costDestination: ZoneInput | null | undefined;
  sourceCard: ReplacementSourceCard;
  effect: RuntimeReplacementEffectDefinition;
}

interface ReplacementCostMoveResult extends MoveCardResult {
  success: boolean;
}

interface RuntimeReplacementTarget extends EffectTarget {
  readonly message?: string;
}

interface HumanReplacementSelectionInput {
  game: DestructionReplacementHost;
  sourceCard: ReplacementSourceCard;
  targetSpec: RuntimeReplacementTarget;
  targetOwner: GamePlayer;
  candidates: readonly GameCard[];
  zones: readonly ZoneInput[];
  minCount: number;
  maxCount: number;
}

interface ReplacementActionContextExtra {
  preview?: boolean;
  isPreview?: boolean;
  activationContext?: {
    source: ReplacementSourceCard;
    player: GamePlayer;
    preview?: boolean;
    isPreview?: boolean;
  };
}

interface ReplacementResolutionResult extends ReplacementActionResult {
  replaced: boolean;
}

interface DestructionReplacementOptions {
  cause?: string;
  reason?: string;
  fromZone?: CanonicalZone | null;
  sourceCard?: GameCard | null;
  source?: GameCard | null;
  sourcePlayer?: GamePlayer | null;
}

function isReplacementActionResult(
  value: ReplacementActionExecutionResult | MoveCardResult,
): value is ReplacementActionResult {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function valuesAreStrictlyEqual(left: unknown, right: unknown): boolean {
  return left === right;
}

function isReplacementStrategy(value: unknown): value is ReplacementStrategy {
  if (!value || typeof value !== "object") return false;
  const method = Reflect.get(value, "shouldUseReplacementEffect");
  return method === undefined || typeof method === "function";
}

function hasRuntimeReplacementEffect(
  effect: EffectDefinition,
): effect is EffectDefinition & RuntimeReplacementEffectDefinition {
  return "replacementEffect" in effect && effect.replacementEffect != null;
}

function getPlayerZone(
  player: GamePlayer,
  zone: ZoneInput,
): GameCard[] | null {
  if (zone === "deck") return player.deck;
  if (zone === "hand") return player.hand;
  if (zone === "field") return player.field;
  if (zone === "graveyard") return player.graveyard;
  if (zone === "spellTrap") return player.spellTrap;
  if (zone === "extraDeck") return player.extraDeck;
  if (zone === "banished") return player.banished;
  return null;
}

function getCostKindLabel(
  cardKind: CardFilter["cardKind"] | "card" = "card",
  count = 1,
) {
  const plurality = count > 1 ? "Plural" : "Singular";
  const key =
    cardKind === "monster"
      ? `ui.replacement.monster${plurality}`
      : cardKind === "spell"
        ? `ui.replacement.spell${plurality}`
        : cardKind === "trap"
          ? `ui.replacement.trap${plurality}`
          : `ui.replacement.card${plurality}`;
  return getUIText(key);
}

function getCostTypeDescription(costFilters: CardFilter, count: number) {
  if (costFilters.archetype) {
    const baseType = getCostKindLabel(costFilters.cardKind || "card", count);
    return `"${costFilters.archetype}" ${baseType}`;
  }

  if (costFilters.cardKind) {
    return getCostKindLabel(costFilters.cardKind, count);
  }

  return getCostKindLabel("card", count);
}

function formatReplacementText(
  text: string | null | undefined,
  targetCardName: string,
  sourceCardName: string | null | undefined,
) {
  if (!text) return text;
  return text
    .replace("{target}", targetCardName)
    .replace("{source}", sourceCardName || "");
}

function getReplacementTargetKey(
  card: GameCard | null | undefined,
): string | null {
  if (!card) return null;
  if (card.instanceId !== undefined && card.instanceId !== null) {
    return `instance:${card.instanceId}`;
  }
  if (card.fieldPresenceId !== undefined && card.fieldPresenceId !== null) {
    return `presence:${card.fieldPresenceId}`;
  }
  return null;
}

function matchesTargetFilters(
  game: DestructionReplacementHost,
  target: GameCard,
  filters: CardFilter | null | undefined,
): boolean {
  if (!filters || Object.keys(filters).length === 0) return true;
  if (game.effectEngine?.cardMatchesFilters) {
    return game.effectEngine.cardMatchesFilters(target, filters);
  }

  const nameFilter = filters.name || filters.cardName;
  if (nameFilter && target.name !== nameFilter) return false;
  if (filters.cardKind) {
    const requiredKinds = Array.isArray(filters.cardKind)
      ? filters.cardKind
      : [filters.cardKind];
    if (!requiredKinds.some((cardKind) => cardKind === target.cardKind)) {
      return false;
    }
  }
  if (filters.subtype) {
    const requiredSubtypes = Array.isArray(filters.subtype)
      ? filters.subtype
      : [filters.subtype];
    if (!requiredSubtypes.some((subtype) => subtype === target.subtype)) {
      return false;
    }
  }
  if (filters.archetype) {
    const archetypes = Array.isArray(target.archetypes)
      ? target.archetypes
      : target.archetype
        ? [target.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  return true;
}

function getRelativePlayer(
  game: DestructionReplacementHost,
  sourceOwner: GamePlayer | null | undefined,
  ownerRule: ReplacementOwnerRule | null | undefined,
): GamePlayer | null {
  if (!sourceOwner || !ownerRule || ownerRule === "any") return null;
  if (ownerRule === "self") return sourceOwner;
  if (ownerRule === "opponent") {
    return typeof game.getOpponent === "function"
      ? game.getOpponent(sourceOwner)
      : null;
  }
  return null;
}

function matchesReplacementSourceOwner(
  game: DestructionReplacementHost,
  replacement: RuntimeReplacementEffect,
  sourceOwner: GamePlayer,
  ctx: ReplacementContext | null | undefined,
): boolean {
  const ownerRule =
    replacement.sourceOwner ||
    replacement.sourceController ||
    replacement.causedByOwner ||
    replacement.destroyedByOwner ||
    "any";
  if (ownerRule === "any") return true;

  const destructionSourcePlayer = ctx?.sourcePlayer || null;
  if (!destructionSourcePlayer) return false;

  const expectedOwner = getRelativePlayer(game, sourceOwner, ownerRule);
  return expectedOwner ? destructionSourcePlayer === expectedOwner : false;
}

function getReplacementStrategy(
  game: DestructionReplacementHost,
  player: GamePlayer | null | undefined,
): ReplacementStrategy | null {
  if (!player) return null;
  if (isReplacementStrategy(player.strategy)) return player.strategy;
  if (game.bot === player && isReplacementStrategy(game.bot.strategy)) {
    return game.bot.strategy;
  }
  if (game.player === player && isReplacementStrategy(game.player.strategy)) {
    return game.player.strategy;
  }
  return null;
}

async function shouldUseAiReplacementEffect({
  game,
  player,
  sourceCard,
  effect,
  replacementEffect,
  targetCard,
  cause,
  fromZone,
  context,
  kind,
}: ReplacementDecisionInput): Promise<boolean> {
  if (player?.controllerType === "human") return true;
  const strategy = getReplacementStrategy(game, player);
  if (typeof strategy?.shouldUseReplacementEffect !== "function") return true;

  const decision = await strategy.shouldUseReplacementEffect({
    game,
    player,
    sourceCard,
    effect,
    replacementEffect,
    targetCard,
    cause,
    fromZone,
    context,
    kind,
  });

  if (decision === false) return false;
  if (decision && typeof decision === "object") {
    if (decision.use === false || decision.shouldUse === false) return false;
  }
  return true;
}

function getCardZoneIndex(
  game: DestructionReplacementHost,
  owner: GamePlayer | null | undefined,
  zoneName: ZoneInput | null | undefined,
  card: GameCard | null | undefined,
): number {
  if (!owner || !zoneName || !card) return -1;
  if (zoneName === "fieldSpell") {
    return owner.fieldSpell === card ? 0 : -1;
  }
  const zone = game.getZone?.(owner, zoneName) || getPlayerZone(owner, zoneName) || [];
  return Array.isArray(zone) ? zone.indexOf(card) : -1;
}

function decorateSelectionCandidates(
  game: DestructionReplacementHost,
  owner: GamePlayer,
  candidates: readonly GameCard[],
  zones: readonly ZoneInput[],
): ReplacementSelectionCandidate[] {
  return candidates.map((card, idx) => {
    const zone =
      zones.find(
        (zoneName) => getCardZoneIndex(game, owner, zoneName, card) >= 0,
      ) || "field";
    const zoneIndex = getCardZoneIndex(game, owner, zone, card);
    return {
      idx,
      name: card.name,
      owner: card.owner === "player" ? "player" : "opponent",
      controller: card.controller || card.owner || owner.id,
      zone,
      zoneIndex,
      position: card.position,
      atk: card.atk,
      def: card.def,
      cardKind: card.cardKind,
      cardRef: card,
    };
  });
}

function getReplacementCostZones(
  replacement: RuntimeReplacementEffect,
): readonly ZoneInput[] {
  if (Array.isArray(replacement.costZones) && replacement.costZones.length > 0) {
    return replacement.costZones;
  }
  if (Array.isArray(replacement.costZone) && replacement.costZone.length > 0) {
    return replacement.costZone;
  }
  return [replacement.costZone || "field"];
}

function getDynamicPlayerZone(
  player: GamePlayer,
  zone: ZoneInput,
): GameCard[] | null {
  const value = Reflect.get(player, zone);
  return Array.isArray(value) ? value : null;
}

function collectReplacementCostCandidates(
  game: DestructionReplacementHost,
  costOwner: GamePlayer,
  costZones: readonly ZoneInput[],
  filterCandidates: (card: GameCard) => boolean,
): ReplacementCostCandidate[] {
  const entries: ReplacementCostCandidate[] = [];
  const seen = new Set<string | GameCard>();

  for (const zoneName of costZones) {
    const zoneCards =
      zoneName === "fieldSpell"
        ? costOwner.fieldSpell
          ? [costOwner.fieldSpell]
          : []
        : game.getZone?.(costOwner, zoneName) ||
          getDynamicPlayerZone(costOwner, zoneName) ||
          [];

    if (!Array.isArray(zoneCards)) continue;

    for (const card of zoneCards) {
      if (!filterCandidates(card)) continue;
      const key = getReplacementTargetKey(card) || card;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ card, zone: zoneName });
    }
  }

  return entries;
}

function getSelectedReplacementCostZone(
  game: DestructionReplacementHost,
  costOwner: GamePlayer,
  costZones: readonly ZoneInput[],
  candidateEntries: readonly ReplacementCostCandidate[],
  costCard: GameCard,
): ZoneInput {
  const entry = candidateEntries.find((candidate) => candidate.card === costCard);
  if (entry?.zone) return entry.zone;

  return (
    costZones.find(
      (zoneName) => getCardZoneIndex(game, costOwner, zoneName, costCard) >= 0,
    ) ||
    costZones[0] ||
    "field"
  );
}

function getCostActionText(costDestination: ZoneInput | null | undefined) {
  if (costDestination === "banished" || costDestination === "banish") {
    return {
      verb: getUIText("ui.replacement.actions.banish.verb"),
      suffix: getUIText("ui.replacement.actions.banish.suffix"),
      selectionVerb: getUIText(
        "ui.replacement.actions.banish.selectionVerb",
      ),
      logVerb: getUIText("ui.replacement.actions.banish.logVerb"),
      logDestination: getUIText(
        "ui.replacement.actions.banish.logDestination",
      ),
    };
  }
  if (costDestination === "hand") {
    return {
      verb: getUIText("ui.replacement.actions.hand.verb"),
      suffix: getUIText("ui.replacement.actions.hand.suffix"),
      selectionVerb: getUIText("ui.replacement.actions.hand.selectionVerb"),
      logVerb: getUIText("ui.replacement.actions.hand.logVerb"),
      logDestination: getUIText(
        "ui.replacement.actions.hand.logDestination",
      ),
    };
  }
  return {
    verb: getUIText("ui.replacement.actions.graveyard.verb"),
    suffix: getUIText("ui.replacement.actions.graveyard.suffix"),
    selectionVerb: getUIText(
      "ui.replacement.actions.graveyard.selectionVerb",
    ),
    logVerb: getUIText("ui.replacement.actions.graveyard.logVerb"),
    logDestination: getUIText(
      "ui.replacement.actions.graveyard.logDestination",
    ),
  };
}

function normalizeReplacementCostDestination(
  costDestination: ZoneInput | null | undefined,
): CanonicalZone {
  return costDestination === "banish"
    ? "banished"
    : costDestination || "graveyard";
}

async function moveReplacementCostCards({
  game,
  cards,
  costOwner,
  costZones,
  candidateEntries,
  costDestination,
  sourceCard,
  effect,
}: ReplacementCostMoveInput): Promise<ReplacementCostMoveResult> {
  if (!game || typeof game.moveCard !== "function") {
    return { success: false };
  }

  const normalizedDestination =
    normalizeReplacementCostDestination(costDestination);

  for (const costCard of cards) {
    const fromZone = getSelectedReplacementCostZone(
      game,
      costOwner,
      costZones,
      candidateEntries,
      costCard,
    );
    const moveResult = await game.moveCard(
      costCard,
      costOwner,
      normalizedDestination,
      {
        fromZone,
        awaitEvents: true,
        sourceCard,
        effectId: effect?.id || null,
        contextLabel: "destruction_replacement_cost",
      },
    );
    if (isReplacementActionResult(moveResult) && moveResult.needsSelection) {
      return { ...moveResult, success: false };
    }
    if (
      moveResult === false ||
      (isReplacementActionResult(moveResult) && moveResult.success === false)
    ) {
      return { success: false };
    }
  }

  return { success: true };
}

function askHumanToSelectReplacementTargets({
  game,
  sourceCard,
  targetSpec,
  targetOwner,
  candidates,
  zones,
  minCount,
  maxCount,
}: HumanReplacementSelectionInput): Promise<GameCard[]> {
  if (
    !game ||
    typeof game.startTargetSelectionSession !== "function" ||
    typeof game.buildSelectionCandidateKey !== "function"
  ) {
    return Promise.resolve([]);
  }

  const buildSelectionCandidateKey = game.buildSelectionCandidateKey;
  const startTargetSelectionSession = game.startTargetSelectionSession;

  const decorated = decorateSelectionCandidates(
    game,
    targetOwner,
    candidates,
    zones,
  ).map((candidate, idx) => ({
    ...candidate,
    key: buildSelectionCandidateKey.call(game, candidate, idx),
  }));

  const requirement = {
    id: targetSpec.id,
    min: minCount,
    max: maxCount,
    zones,
    owner: targetSpec.owner || "opponent",
    filters: {},
    allowSelf: true,
    distinct: true,
    candidates: decorated,
  };

  const message =
    targetSpec.message ||
    getUIText("ui.replacement.chooseToBanish", {
      countText:
        maxCount > 1
          ? getUIText("ui.replacement.cardPlural")
          : `1 ${getUIText("ui.replacement.cardSingular")}`,
    });

  return new Promise<GameCard[]>((resolve) => {
    startTargetSelectionSession.call(game, {
      kind: "destruction_replacement_target",
      card: sourceCard,
      selectionContract: {
        kind: "target",
        message,
        requirements: [requirement],
        ui: {
          allowCancel: false,
          preventCancel: true,
        },
        metadata: {
          context: "destruction_replacement",
          sourceCard: sourceCard?.name || null,
        },
      },
      resolve,
      autoAdvanceOnMax: true,
      preventCancel: true,
      execute: (selections) => {
        const chosenKeys = selections[requirement.id] || [];
        const chosen = chosenKeys
          .map((key) => requirement.candidates.find((cand) => cand.key === key))
          .map((candidate) => candidate?.cardRef)
          .filter((candidate): candidate is GameCard => candidate !== undefined);
        resolve(chosen);
        return { success: true, needsSelection: false };
      },
    });
  });
}

/**
 * Attempt to apply a replacement effect from a source card to prevent
 * destruction of `ctx.card`. Returns `{ replaced: boolean }`.
 *
 * @param {Game} game
 * @param sourceCard
 * @param sourceOwner
 * @param effect — must have `replacementEffect` payload
 * @param {{ card, cause, fromZone, ownerPlayer, sourceCard, sourcePlayer }} ctx
 */
async function tryReplacement(
  game: DestructionReplacementHost,
  sourceCard: ReplacementSourceCard,
  sourceOwner: GamePlayer,
  effect: RuntimeReplacementEffectDefinition,
  ctx: ReplacementContext,
): Promise<ReplacementResolutionResult> {
  const { card, cause, fromZone, ownerPlayer } = ctx;

  if (!sourceCard || !effect?.replacementEffect) {
    return { replaced: false };
  }

  const replacement = effect.replacementEffect;
  if (replacement.type && replacement.type !== "destruction") {
    return { replaced: false };
  }

  const sourceRequireFaceup = effect.requireFaceup !== false;
  if (sourceRequireFaceup && sourceCard.isFacedown) {
    return { replaced: false };
  }

  if (effect.requireZone) {
    const sourceZone =
      game.effectEngine?.findCardZone?.(sourceOwner, sourceCard) || null;
    if (sourceZone !== effect.requireZone) {
      return { replaced: false };
    }
  }

  if (replacement.targetMustBeSource === true && card !== sourceCard) {
    return { replaced: false };
  }

  if (replacement.targetMustBeEquippedToSource === true) {
    const targetEquips = Array.isArray(card.equips) ? card.equips : [];
    const sourceEquipsTarget =
      sourceCard.equippedTo === card ||
      sourceCard.equipTarget === card ||
      targetEquips.some((equip) => valuesAreStrictlyEqual(equip, sourceCard));
    if (!sourceEquipsTarget) {
      return { replaced: false };
    }
  }

  const targetOwnerKey =
    replacement.targetOwner ||
    replacement.appliesTo ||
    (sourceCard === card ? "self" : null);
  if (!targetOwnerKey) {
    return { replaced: false };
  }

  if (targetOwnerKey !== "any") {
    const expectedOwner =
      targetOwnerKey === "self"
        ? sourceOwner
        : game.getOpponent(sourceOwner);
    if (expectedOwner !== ownerPlayer) {
      return { replaced: false };
    }
  }

  const targetZones = replacement.targetZones
    ? replacement.targetZones
    : replacement.targetZone
      ? [replacement.targetZone]
      : null;
  if (targetZones && targetZones.length > 0) {
    if (!fromZone || !targetZones.includes(fromZone)) {
      return { replaced: false };
    }
  }

  const allowFacedown = replacement.allowFacedown === true;
  const targetRequireFaceup =
    replacement.targetRequireFaceup !== false && !allowFacedown;
  if (targetRequireFaceup && card.isFacedown) {
    return { replaced: false };
  }

  const targetFilters = replacement.targetFilters || null;
  if (targetFilters && !matchesTargetFilters(game, card, targetFilters)) {
    return { replaced: false };
  }

  const scopedTargetIds = Array.isArray(replacement.targetInstanceIds)
    ? replacement.targetInstanceIds
    : [];
  const scopedTargetCards = Array.isArray(replacement.targetCards)
    ? replacement.targetCards
    : [];
  if (scopedTargetIds.length > 0 || scopedTargetCards.length > 0) {
    const targetKey = getReplacementTargetKey(card);
    const matchesScopedId =
      targetKey && scopedTargetIds.includes(targetKey);
    const matchesScopedRef = scopedTargetCards.includes(card);
    if (!matchesScopedId && !matchesScopedRef) {
      return { replaced: false };
    }
  }

  if (
    cause === "battle" &&
    typeof game.isBattleDestructionPreventionNegated === "function" &&
    game.isBattleDestructionPreventionNegated(card, {
      owner: ownerPlayer,
      preventionSourceOwner: sourceOwner,
      preventionSourceCard: sourceCard,
      fromZone,
    })
  ) {
    return { replaced: false };
  }

  const onceCheck = game.canUseOncePerTurn(sourceCard, sourceOwner, effect);
  if (!onceCheck.ok) {
    return { replaced: false };
  }

  // Once-per-Duel usage persists across turns and can allow a fixed number of uses.
  const duelCheck = canUseOncePerDuelEffect(sourceCard, sourceOwner, effect);
  if (!duelCheck.ok) {
    return { replaced: false };
  }

  if (
    replacement.reason &&
    replacement.reason !== "any" &&
    replacement.reason !== cause
  ) {
    return { replaced: false };
  }

  if (!matchesReplacementSourceOwner(game, replacement, sourceOwner, ctx)) {
    return { replaced: false };
  }

  const strategyAllowsReplacement = await shouldUseAiReplacementEffect({
    game,
    player: sourceOwner,
    sourceCard,
    effect,
    replacementEffect: replacement,
    targetCard: card,
    cause,
    fromZone,
    context: ctx,
    kind: "destruction",
  });
  if (!strategyAllowsReplacement) {
    return { replaced: false };
  }

  const markOncePerDuelUsedIfNeeded = () => {
    markOncePerDuelEffectUsed(sourceCard, sourceOwner, effect);
  };

  const buildActionCostCtx = (extra: ReplacementActionContextExtra = {}) => {
    const opponent =
      typeof game.getOpponent === "function"
        ? game.getOpponent(sourceOwner)
        : null;
    return {
      player: sourceOwner,
      opponent,
      source: sourceCard,
      destroyed: card,
      destroyedOwner: ownerPlayer,
      cause,
      activationContext: {
        source: sourceCard,
        player: sourceOwner,
      },
      ...extra,
    };
  };

  const runReplacementCostActions = async (): Promise<
    ReplacementActionExecutionResult
  > => {
    const costActions = Array.isArray(replacement.costActions)
      ? replacement.costActions
      : [];
    if (costActions.length === 0) return true;

    const engine = game.effectEngine;
    if (!engine || typeof engine.applyActions !== "function") {
      return false;
    }

    const previewCtx = buildActionCostCtx({
      preview: true,
      isPreview: true,
      activationContext: {
        source: sourceCard,
        player: sourceOwner,
        preview: true,
        isPreview: true,
      },
    });
    const previewResult =
      typeof engine.checkActionPreviewRequirements === "function"
        ? engine.checkActionPreviewRequirements(costActions, previewCtx)
        : { ok: true };
    if (previewResult && previewResult.ok === false) {
      return false;
    }

    const sourceIsHuman = sourceOwner?.controllerType === "human";
    if (sourceIsHuman && replacement.auto !== true) {
      const targetName = getCardDisplayName(card) || card.name;
      const sourceName = getCardDisplayName(sourceCard) || sourceCard.name;
      const prompt =
        formatReplacementText(replacement.prompt, targetName, sourceName) ||
        getUIText("ui.replacement.confirmActionCost", {
          sourceName,
          cardName: targetName,
        });
      const wantsToReplace =
        (await game.ui?.showConfirmPrompt?.(prompt, {
          kind: "destruction_replacement",
          cardName: targetName,
        })) ?? false;
      if (!wantsToReplace) {
        return false;
      }
    }

    const costCtx = buildActionCostCtx();
    const costResult = await engine.applyActions(costActions, costCtx, {});
    if (isReplacementActionResult(costResult) && costResult.needsSelection) {
      return { ...costResult, success: false };
    }
    return (
      costResult === true ||
      (costResult &&
        typeof costResult === "object" &&
        costResult.success !== false)
    );
  };

  const runFollowUpActions = async (): Promise<void> => {
    const followUpActions = Array.isArray(effect.actions) ? effect.actions : [];
    if (followUpActions.length === 0) return;
    const engine = game.effectEngine;
    if (!engine || typeof engine.applyActions !== "function") return;
    const opponent =
      typeof game.getOpponent === "function"
        ? game.getOpponent(sourceOwner)
        : null;
    const followUpCtx = {
      player: sourceOwner,
      opponent,
      source: sourceCard,
      destroyed: card,
      destroyedOwner: ownerPlayer,
      cause,
      activationContext: { source: sourceCard, player: sourceOwner },
    };

    const resolvedTargets: ResolvedTargetMap = {};
    const declaredTargets = Array.isArray(effect.targets) ? effect.targets : [];

    // Resolve declared targets for the follow-up actions. Replacement effects
    // are not eligible to use the standard chain selection flow, so we run a
    // simplified, synchronous-ish selection here:
    //  - bot/AI source: auto-pick from candidates (deterministic).
    //  - human source: open a manual field-targeting prompt.
    for (const targetSpec of declaredTargets) {
      if (!targetSpec || !targetSpec.id) continue;

      const ownerKey = targetSpec.owner || "self";
      const targetOwner =
        ownerKey === "opponent"
          ? opponent
          : ownerKey === "self"
            ? sourceOwner
            : null;
      if (!targetOwner) continue;

      const zones = Array.isArray(targetSpec.zones)
        ? targetSpec.zones
        : targetSpec.zone
          ? [targetSpec.zone]
          : ["field"];

      const candidates: GameCard[] = [];
      for (const zoneName of zones) {
        if (zoneName === "fieldSpell") {
          if (targetOwner.fieldSpell) candidates.push(targetOwner.fieldSpell);
          continue;
        }
        const arr = getDynamicPlayerZone(targetOwner, zoneName);
        if (Array.isArray(arr)) candidates.push(...arr);
      }

      const filtered = candidates.filter((cand) => {
        if (!cand) return false;
        if (targetSpec.requireFaceup && cand.isFacedown) return false;
        if (
          targetSpec.cardKind &&
          !valuesAreStrictlyEqual(cand.cardKind, targetSpec.cardKind)
        ) {
          return false;
        }
        return true;
      });

      const minCount = targetSpec.count?.min ?? 1;
      const maxCount = targetSpec.count?.max ?? minCount;

      if (filtered.length < minCount) {
        resolvedTargets[targetSpec.id] = [];
        continue;
      }

      let chosen: GameCard[];
      const sourceIsHuman = sourceOwner?.controllerType === "human";
      if (sourceIsHuman) {
        chosen = await askHumanToSelectReplacementTargets({
          game,
          sourceCard,
          targetSpec,
          targetOwner,
          candidates: filtered,
          zones,
          minCount,
          maxCount: Math.min(maxCount, filtered.length),
        });
      } else if (ownerKey === "opponent") {
        chosen = [...filtered]
          .sort((a, b) => (b.atk || 0) - (a.atk || 0))
          .slice(0, Math.min(maxCount, filtered.length));
      } else {
        chosen = filtered.slice(0, Math.min(maxCount, filtered.length));
      }

      Reflect.set(resolvedTargets, targetSpec.id, chosen);
    }

    try {
      await engine.applyActions(followUpActions, followUpCtx, resolvedTargets);
    } catch (err) {
      console.error("[tryReplacement] Follow-up actions failed:", err);
    }
  };

  const costCount = replacement.costCount ?? 0;
  const hasActionCosts =
    Array.isArray(replacement.costActions) &&
    replacement.costActions.length > 0;
  if (hasActionCosts && costCount === 0) {
    const costPaid = await runReplacementCostActions();
    if (isReplacementActionResult(costPaid) && costPaid.needsSelection) {
      return {
        ...costPaid,
        replaced: false,
      };
    }
    if (!costPaid) {
      return { replaced: false };
    }

    game.markOncePerTurnUsed(sourceCard, sourceOwner, effect);
    markOncePerDuelUsedIfNeeded();
    const logMessage = formatReplacementText(
      replacement.logMessage,
      card.name,
      sourceCard.name,
    );
    if (logMessage) {
      game.ui?.log?.(logMessage);
    } else {
      game.ui?.log?.(
        `${card.name} avoided destruction due to ${sourceCard.name}.`,
      );
    }
    await runFollowUpActions();
    return { replaced: true };
  }

  if (replacement.auto === true || costCount === 0) {
    game.markOncePerTurnUsed(sourceCard, sourceOwner, effect);
    markOncePerDuelUsedIfNeeded();
    const logMessage = formatReplacementText(
      replacement.logMessage,
      card.name,
      sourceCard.name,
    );
    if (logMessage) {
      game.ui?.log?.(logMessage);
    } else {
      game.ui?.log?.(
        `${card.name} avoided destruction due to ${sourceCard.name}.`,
      );
    }
    await runFollowUpActions();
    return { replaced: true };
  }

  const costOwnerKey = replacement.costOwner || "source";
  const costOwner = valuesAreStrictlyEqual(costOwnerKey, "target")
    ? ownerPlayer
    : sourceOwner;

  if (!costOwner) {
    return { replaced: false };
  }

  const costFilters = replacement.costFilters || {};
  const filterCandidates = (candidate: GameCard): boolean => {
    if (!candidate || candidate === card) return false;

    if (costFilters.cardKind && candidate.cardKind !== costFilters.cardKind)
      return false;

    if (costFilters.archetype) {
      const hasArchetype =
        candidate.archetype === costFilters.archetype ||
        (Array.isArray(candidate.archetypes) &&
          candidate.archetypes.includes(costFilters.archetype));
      if (!hasArchetype) return false;
    }

    if (costFilters.name && candidate.name !== costFilters.name)
      return false;

    return true;
  };

  const costZones = getReplacementCostZones(replacement);
  const candidateEntries = collectReplacementCostCandidates(
    game,
    costOwner,
    costZones,
    filterCandidates,
  );
  const candidates = candidateEntries.map((entry) => entry.card);

  if (candidates.length < costCount) {
    return { replaced: false };
  }

  const costDestination = normalizeReplacementCostDestination(
    replacement.costDestination,
  );
  const costActionText = getCostActionText(costDestination);

  // AI auto-selection (lowest ATK for cost). Bot Arena can place an AI in the
  // "player" seat, so controllerType is the reliable human/AI boundary.
  if (costOwner.controllerType !== "human") {
    const chosen = [...candidates]
      .sort((a, b) => (a.atk || 0) - (b.atk || 0))
      .slice(0, costCount);

    const costMoveResult = await moveReplacementCostCards({
      game,
      cards: chosen,
      costOwner,
      costZones,
      candidateEntries,
      costDestination,
      sourceCard,
      effect,
    });
    if (costMoveResult?.needsSelection) {
      return {
        ...costMoveResult,
        replaced: false,
      };
    }
    if (!costMoveResult.success) {
      return { replaced: false };
    }

    game.markOncePerTurnUsed(sourceCard, sourceOwner, effect);
    markOncePerDuelUsedIfNeeded();

    const costNames = chosen.map((c) => c.name).join(", ");
    const logMessage = formatReplacementText(
      replacement.logMessage,
      card.name,
      sourceCard.name,
    );
    if (logMessage) {
      game.ui?.log?.(logMessage);
    } else {
      game.ui?.log?.(
        `${card.name} avoided destruction by ${costActionText.logVerb} ${costNames}${costActionText.logDestination}.`,
      );
    }
    return { replaced: true };
  }

  const costDescription = getCostTypeDescription(costFilters, costCount);
  const targetName = getCardDisplayName(card) || card.name;
  const sourceName = getCardDisplayName(sourceCard) || sourceCard.name;
  const prompt =
    formatReplacementText(replacement.prompt, targetName, sourceName) ||
    getUIText("ui.replacement.confirmCost", {
      verb: costActionText.verb,
      count: costCount,
      costDescription,
      suffix: costActionText.suffix,
      cardName: targetName,
    });

  const wantsToReplace =
    (await game.ui?.showConfirmPrompt?.(prompt, {
      kind: "destruction_replacement",
      cardName: targetName,
    })) ?? false;
  if (!wantsToReplace) {
    return { replaced: false };
  }

  const selectionMessage =
    formatReplacementText(
      replacement.selectionMessage,
      targetName,
      sourceName,
    ) ||
    getUIText("ui.replacement.chooseCost", {
      count: costCount,
      cardWord: getCostKindLabel("card", costCount),
      selectionVerb: costActionText.selectionVerb,
      cardName: targetName,
    });

  let selections: GameCard[] | null | undefined = [];
  if (
    typeof game.startTargetSelectionSession === "function" &&
    typeof game.buildSelectionCandidateKey === "function"
  ) {
    selections = await askHumanToSelectReplacementTargets({
      game,
      sourceCard,
      targetSpec: {
        id: "replacement_cost",
        owner: "self",
        message: selectionMessage,
      },
      targetOwner: costOwner,
      candidates,
      zones: costZones,
      minCount: costCount,
      maxCount: costCount,
    });
  } else if (
    costZones.length === 1 &&
    typeof game.askPlayerToSelectCards === "function"
  ) {
    selections = await game.askPlayerToSelectCards({
      owner: "player",
      zone: costZones[0],
      min: costCount,
      max: costCount,
      filter: filterCandidates,
      message: selectionMessage,
    });
  }

  if (!selections || selections.length < costCount) {
    game.ui.log(getUIText("ui.replacement.protectionCancelled"));
    return { replaced: false };
  }

  const costMoveResult = await moveReplacementCostCards({
    game,
    cards: selections,
    costOwner,
    costZones,
    candidateEntries,
    costDestination,
    sourceCard,
    effect,
  });
  if (costMoveResult?.needsSelection) {
    return {
      ...costMoveResult,
      replaced: false,
    };
  }
  if (!costMoveResult.success) {
    return { replaced: false };
  }

  game.markOncePerTurnUsed(sourceCard, sourceOwner, effect);
  markOncePerDuelUsedIfNeeded();

  const costNames = selections.map((c) => c.name).join(", ");
  const logMessage = formatReplacementText(
    replacement.logMessage,
    card.name,
    sourceCard.name,
  );
  if (logMessage) {
    game.ui?.log?.(logMessage);
  } else {
    game.ui.log(
      `${card.name} avoided destruction by ${costActionText.logVerb} ${costNames}${costActionText.logDestination}.`,
    );
  }
  return { replaced: true };
}

function collectSources(player: GamePlayer | null): GameCard[] {
  if (!player) return [];
  const field = Array.isArray(player.field) ? player.field : [];
  const spellTrap = Array.isArray(player.spellTrap) ? player.spellTrap : [];
  const fieldSpell = player.fieldSpell ? [player.fieldSpell] : [];
  const hand = Array.isArray(player.hand)
    ? player.hand.filter((card) =>
        (card?.effects || []).some(
          (effect) =>
            hasRuntimeReplacementEffect(effect) && effect.requireZone === "hand",
        ),
      )
    : [];
  return [...field, ...spellTrap, ...fieldSpell, ...hand].filter(Boolean);
}

export async function resolveDestructionWithReplacement(
  this: DestructionReplacementHost,
  card: GameCard | null | undefined,
  options: DestructionReplacementOptions = {},
): Promise<ReplacementResolutionResult> {
  if (!card) {
    return { replaced: false };
  }

  const ownerPlayer = card.owner === "player" ? this.player : this.bot;
  if (!ownerPlayer) {
    return { replaced: false };
  }

  const cause = options.cause || options.reason || "effect";
  const fromZone =
    options.fromZone ||
    this.effectEngine?.findCardZone?.(ownerPlayer, card) ||
    null;
  const destructionSourceCard = options.sourceCard || options.source || null;
  const destructionSourcePlayer =
    options.sourcePlayer ||
    (destructionSourceCard?.owner === "player"
      ? this.player
      : destructionSourceCard?.owner === "bot"
        ? this.bot
        : null);

  // Check for Equip Spell protection (e.g., Crescent Shield Guard)
  if (cause === "battle" && card.cardKind === "monster") {
    const guardEquip = (card.equips || []).find(
      (equip) =>
        equip && equip.grantsCrescentShieldGuard && equip.equippedTo === card,
    );

    if (guardEquip) {
      this.ui.log(
        `${guardEquip.name} was destroyed to protect ${card.name}.`,
      );
      const guardResult = await this.destroyCard(guardEquip, {
        cause,
        sourceCard: card,
        opponent: this.getOpponent(ownerPlayer),
        fromZone: "spellTrap",
      });
      if (guardResult?.destroyed) {
        guardEquip.grantsCrescentShieldGuard = false;
        return { replaced: true };
      }
      return { replaced: false };
    }
  }

  const ctx: ReplacementContext = {
    card,
    cause,
    fromZone,
    ownerPlayer,
    sourceCard: destructionSourceCard,
    sourcePlayer: destructionSourcePlayer,
  };

  const sourcePool: GameCard[] = [
    ...collectSources(ownerPlayer),
    ...collectSources(this.getOpponent(ownerPlayer)),
  ];

  const currentTurn = this.turnCounter;
  if (Array.isArray(this.temporaryReplacementEffects)) {
    this.temporaryReplacementEffects =
      this.temporaryReplacementEffects.filter((entry) => {
        if (!entry) return false;
        if (
          isFiniteNumber(entry.expiresOnTurn) &&
          currentTurn > entry.expiresOnTurn
        ) {
          return false;
        }
        if (
          isFiniteNumber(entry.usesRemaining) &&
          entry.usesRemaining <= 0
        ) {
          return false;
        }
        return true;
      });

    for (const entry of this.temporaryReplacementEffects) {
      if (!entry) continue;
      const sourceOwner =
        entry.ownerId === this.player.id ? this.player : this.bot;
      if (!sourceOwner) continue;
      const sourceCard: ReplacementSourceCard = {
        name: entry.sourceName || "Temporary Effect",
        owner: sourceOwner.id,
        isFacedown: false,
      };
      const effect: RuntimeReplacementEffectDefinition = {
        replacementEffect: entry.replacementEffect,
        requireFaceup: false,
      };
      const targetKey = getReplacementTargetKey(card);
      if (
        entry.usesPerTarget === true &&
        ((targetKey &&
          Array.isArray(entry.usedTargetKeys) &&
          entry.usedTargetKeys.includes(targetKey)) ||
          (!targetKey &&
            Array.isArray(entry.usedTargetCards) &&
            entry.usedTargetCards.includes(card)))
      ) {
        continue;
      }
      const result = await tryReplacement(this, sourceCard, sourceOwner, effect, ctx);
      if (result?.replaced) {
        if (entry.usesPerTarget === true) {
          if (!Array.isArray(entry.usedTargetKeys)) {
            entry.usedTargetKeys = [];
          }
          if (!Array.isArray(entry.usedTargetCards)) {
            entry.usedTargetCards = [];
          }
          if (targetKey) {
            entry.usedTargetKeys.push(targetKey);
          } else {
            entry.usedTargetCards.push(card);
          }
        } else if (isFiniteNumber(entry.usesRemaining)) {
          entry.usesRemaining -= 1;
        }
        if (
          isFiniteNumber(entry.usesRemaining) &&
          entry.usesRemaining <= 0
        ) {
          this.temporaryReplacementEffects =
            this.temporaryReplacementEffects.filter((e) => e !== entry);
        }
        return result;
      }
    }
  }

  for (const sourceCard of sourcePool) {
    const sourceOwner =
      sourceCard.owner === "player" ? this.player : this.bot;
    if (!sourceOwner) continue;
    const effects = sourceCard.effects || [];
    for (const effect of effects) {
      if (!hasRuntimeReplacementEffect(effect)) continue;
      const result = await tryReplacement(this, sourceCard, sourceOwner, effect, ctx);
      if (result?.replaced) {
        return result;
      }
    }
  }

  return { replaced: false };
}
