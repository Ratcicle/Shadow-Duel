import { checkSimulatedAscension } from "./ascensionPlanning.js";
import { canActivateDuringDamageStep } from "../../game/spellTrap/quickSpellRules.js";
import type { DamageStepTiming } from "../../contracts/effects.js";
import { expireFaceupDeclaredValues, restoreFaceupStatuses } from "../../Card.js";
import { expireEffectNegation } from "../../effects/negation.js";
import { expireLevelModifications } from "../../effects/actions/stats.js";
import type { SimulatedEquipHostExitBinding } from "./zones.js";
import { hasEquipHostExitProof, matchesEquipHostExitSourcePresence } from "../../effects/triggers/collectors/shared.js";
import { getImmediateEventEffectValidationError, isActiveEquipInZone } from "../../effects/passives/passiveBuffs.js";
import { captureProcedureTriggerConditions } from "../../effects/conditions/runtime.js";
import { matchesCardFilter, type RuntimeCardFilter } from "../../effects/filters/cardFilters.js";
import { getPositionChangeProvenance, matchesPositionChangeEvent } from "../../effects/triggers/collectors/positionChange.js";
import { createMaterialDuelStats, recordMaterialEffectActivationInStats, recordMaterialEffectIdentity } from "../../game/summon/materialStats.js";
import { recordTurnCardActivation } from "../../game/events/activationHistory.js";
import { projectStoredBlueprintActivation } from "../../effects/blueprints/index.js";
import { effectMatchesFilters } from "../../effects/filters/effectFilters.js";
import { projectEffectActivationCase } from "../../effects/activation/cases.js";
import { hasActionZoneCandidates, hasActionSummonCapacity } from "./actionValidation.js";
import { getGraveyardBanishBurnEntries } from "./simulatedActions/destruction.js";
import { collectProcedureCounterSources, getCounterValue, setCounterValue } from "./counters.js";
import { prepareSimulatedFieldCounterPayment } from "./simulatedActions/counters.js";
import { getBaseLpCost } from "../../effects/costs/lpCost.js";
import { resolveActionPlayer, resolveSimulatedLpCost } from "./simulatedActions/shared.js";
import { resolveTargetsForAction, captureSimulatedReferences, captureSimulatedSourceSnapshot, isSimulatedReferencePresenceValid, isSimulatedSourcePresenceValid, areRequiredContextualReferencesValid, recordCompletedSimulatedSummon } from "./simulatedActions/shared.js";
import { buildEventReferenceContext } from "../../effects/targeting/references.js";
import { appendSimulatedZoneCard } from "./zones.js";
import { appendSimulatedFieldCard, refreshSimulatedFieldAuras } from "./zones.js";
import {
  applySimulatedActions,
  evaluateSimulatedConditions,
  moveCardToZone,
  selectSimulatedTargets,
} from "../StrategyUtils.js";
import {
  canMoveCardToZone,
  findCardOwner,
  findCardZone,
  getZoneCards,
} from "./zones.js";
import {
  getCardInstanceId,
  matchesTargetFilters,
} from "./targetSelection.js";
import { updateSimulatedSentToGraveMaterialMarker } from "./simulatedActions/shared.js";
import { emitSimulatedMove, getOriginalOwner, setSimulatedController, resolveSimulatedTemporaryControlEffects } from "./simulatedActions/movement.js";
import { simulateSynchroSummon } from "./simulatedActions/summon.js";
import { selectPayableTributes } from "./tributePolicy.js";
import { processSimulatedDelayedActions, cleanupSimulatedEndTurn, cleanupExpiredSimulatedTurnEffects } from "./simulatedActions/lifecycle.js";
import { getAvailableFieldSlots } from "../../game/zones/placement.js";
import { canActivateTrap } from "../../game/spellTrap/verification.js";
import { resolvePerspectiveSlotForPlayer } from "./perspective.js";
import { resolvePlanningOwnerPolicy } from "./planningExecution.js";
import type {
  SimulatedActionContextData,
  SimulatedActionOptions,
  SimulatedOwnerPolicy,
  SimulatedRuntimeState,
  SimulatedTemporaryEventEffect,
  SimulatedEventOccurrence,
  SimulatedReferenceSnapshot,
} from "./simulatedActions/shared.js";
import {
  fieldHasTributeValue,
  getTributeCardsFromIndices,
  getTributeValueTotal,
  getNormalSummonTributeOptions,
  getNormalTributeRequirement,
} from "../../game/summon/tributeValue.js";
import {
  canUseNormalSummonForCard,
  recordNormalSummonForTurn,
} from "../../Player.js";
import {
  checkSpecialSummonEligibility,
  establishProperSummon,
} from "../../game/summon/eligibility.js";
import {
  canUseSimulatedEffectUsage,
  markSimulatedEffectUsage,
} from "./simStateUtils.js";
import type { SimulatedUsageEffect } from "./simStateUtils.js";
import type {
  PerspectiveGameState,
  SimulatedCardState,
  SimulatedPlayerState,
  SimulationGameState,
  AiStateShape,
  AiCardInput,
  AiPlayerInput,
} from "../../contracts/aiState.js";
import type { CardAction } from "../../contracts/actions.js";
import type {
  CardKind,
  GameCard,
} from "../../contracts/cards.js";
import type {
  AIAction,
  AIDecisionPlan,
  AIActivationContext,
  AIPlannedAction,
} from "../../contracts/ai.js";
import type {
  CardFilter,
  EffectDefinition,
  EffectTiming,
} from "../../contracts/effects.js";
import type { SummonMethod } from "../../contracts/summon.js";
import type { CanonicalSelectionMap } from "../../contracts/selection.js";
import { isPlanningActionPresenceCurrent, resolvePlanningCard, resolvePlanningMaterialIds, resolvePlanningSourceIndex } from "./actionIdentity.js";
import type { PresenceCard } from "../../game/zones/ownership.js";
import type { CanonicalZone } from "../../contracts/zones.js";

interface SimulatedHandIndexAction {
  card?: PresenceCard | null | undefined;
  cardId?: number | undefined;
  cardName?: string | undefined;
  index?: number;
}

interface SimulatedFieldIndexAction extends SimulatedHandIndexAction {
  fieldIndex?: number;
  materialIndex?: number | undefined;
}

interface SimulatedExtraDeckMaterialHint {
  index?: number;
  id?: number | undefined;
  name?: string | undefined;
  instanceIds?: readonly (string | number)[] | undefined;
}

interface SimulatedExtraDeckAction extends SimulatedHandIndexAction {
  extraDeckIndex?: number;
  extraDeckCard?: SimulatedPlayerState["extraDeck"][number] | GameCard | null;
  materials?: readonly SimulatedExtraDeckMaterialHint[];
  materialIndices?: readonly number[];
  materialIds?: readonly (number | undefined)[];
  materialNames?: readonly (string | undefined)[];
  materialInstanceIds?: readonly (readonly (string | number)[] | undefined)[];
}

interface SimulatedSelectionActionContext extends SimulatedActionContextData {
  specialSummonPositions?: object;
}

interface SimulatedSelectionActivationContext extends NonNullable<
  SimulatedActionOptions["activationContext"]
> {
  actionContext?: SimulatedSelectionActionContext;
}

interface SimulatedSelectionOptionsInput
  extends Omit<
    SimulatedActionOptions,
    | "actionContext"
    | "activationContext"
    | "strategy"
    | "rankSearchCandidates"
    | "evaluateRecruitCandidate"
    | "chooseSpecialSummonPosition"
  > {
  archetype?: string | null;
  preferDefense?: boolean;
  changedCard?: SimulatedCardState | null;
  actionContext?: SimulatedSelectionActionContext;
  activationContext?: AIActivationContext | null | undefined;
  strategy?: unknown;
  rankSearchCandidates?: unknown;
  evaluateRecruitCandidate?: unknown;
  chooseSpecialSummonPosition?: unknown;
  specialSummonPositions?: object;
}

interface SimulatedEventPayloadView {
  isDamageStep?: boolean;
  damageStepTiming?: DamageStepTiming;
  before?: number;
  after?: number;
  lpGained?: number;
  lpLost?: number;
  lpPaid?: number;
  damageAmount?: number;
  equipCard?: SimulatedCardState | null;
  target?: SimulatedCardState | null;
  effect?: EffectDefinition | null;
  activationZone?: string | null;
  placementOnly?: boolean;
  attacker?: SimulatedCardState | null;
  defender?: SimulatedCardState | null;
  attackerOwner?: SimulatedPlayerState | null;
  defenderOwner?: SimulatedPlayerState | null;
  /** Scoped battle bridges publish negated triggers, then suppress their actions. */
  recordNegatedBattleActivation?: boolean;
  destroyed?: SimulatedCardState | null;
  destroyedOwner?: SimulatedPlayerState | null;
  destroyedPosition?: string | null;
  battleDestroyer?: SimulatedCardState | null;
  battleDestroyers?: SimulatedCardState[];
  deferActivationChecks?: boolean;
  equipBindingsAtFieldExit?: readonly SimulatedEquipHostExitBinding[];
  locationVersion?: number;
  counterType?: string;
  amount?: number;
  fromField?: boolean;
  fromPosition?: string;
  toPosition?: string;
  wasFlipped?: boolean;
  positionChangedByEffect?: boolean;
  effectId?: string | null;
  actionContext?: SimulatedActionContextData;
  effectsNegatedAtFieldExit?: boolean;
  card?: SimulatedCardState | null;
  eventCard?: SimulatedCardState | null;
  changedCard?: SimulatedCardState | null;
  fromZone?: string | null;
  toZone?: string | null;
  player?: SimulatedPlayerState | null;
  fromPlayer?: SimulatedPlayerState | null;
  toPlayer?: SimulatedPlayerState | null;
  movedByEffect?: boolean;
  wasFaceupBeforeMove?: boolean;
  method?: SummonMethod | null;
  sourceCard?: SimulatedCardState | null;
  source?: SimulatedCardState | null;
  wasFaceupBeforeChange?: boolean;
  wasDestroyed?: boolean;
  destroyCause?: string;
  destroySource?: SimulatedCardState | null;
  contextLabel?: string;
}

interface SimulatedEventSourceView {
  equipHostExitBinding?: SimulatedEquipHostExitBinding;
  card: SimulatedCardState;
  player: SimulatedPlayerState;
  zone: CanonicalZone | "temporary";
}

interface SimulatedEventSourceEntry extends SimulatedEventSourceView {
  opponent: SimulatedPlayerState | null;
}

interface SimulatedEventSourceList extends Array<SimulatedEventSourceEntry> {
  _bot?: SimulatedPlayerState | null;
  _player?: SimulatedPlayerState | null;
}

interface LegacySimulatedEventEffectFields {
  readonly minLpGained?: number;
  readonly lpChangeSourceFilters?: CardFilter;
  readonly sourceCardFilters?: CardFilter;
  requireEquippedAsAttacker?: boolean;
  requireEquippedCardFilters?: RuntimeCardFilter;
  requireMovedByEffect?: boolean;
  requireFaceupAtFieldExit?: boolean;
  summonMethod?: SummonMethod | readonly SummonMethod[];
  requireSummonedFrom?: string | readonly string[];
  eventCardOwner?: "self" | "opponent";
  requirePositionChangedByEffect?: boolean;
}

interface ManagedSimulatedEventOptions extends SimulatedActionOptions {
  _managedSimulatedEventEmitter?: boolean;
  emitSimulatedEvent?: (event: string, payload: object, extra?: SimulatedActionOptions) => void;
}

interface SimulatedEventActivationInput {
  sourceCard: SimulatedCardState;
  effect: EffectDefinition;
  player: SimulatedPlayerState;
  game: SimulatedRuntimeState;
  activationZone: CanonicalZone | "temporary";
}

interface SimulatedEventStrategyCapabilities {
  buildActivationContextForEffect?(
    input: SimulatedEventActivationInput,
  ): SimulatedActionOptions["activationContext"] | null;
}

interface BuiltSimulatedSelectionOptions extends SimulatedActionOptions {
  archetype?: string | null;
  preferDefense?: boolean;
  specialSummonPositions?: object;
}

interface SimulatedEventDispatchOptions
  extends Omit<
    ManagedSimulatedEventOptions,
    | "activationContext"
    | "strategy"
    | "rankSearchCandidates"
    | "evaluateRecruitCandidate"
    | "chooseSpecialSummonPosition"
  > {
  activationContext?: AIActivationContext | null | undefined;
  archetype?: string | null;
  preferDefense?: boolean;
  maxSimulatedEventDepth?: number;
  strategy?: unknown;
  rankSearchCandidates?: unknown;
  evaluateRecruitCandidate?: unknown;
  chooseSpecialSummonPosition?: unknown;
  onEffectActivated?(payload: object): void;
}

export function canSimulatedSpecialSummon(
  card: AiCardInput | null | undefined,
  player: Pick<AiPlayerInput, "specialSummonRestrictions"> | null | undefined,
  summonProcedure: string = "special",
  fromZone: string | null = null,
  matchesFilters: (card: AiCardInput, filters: CardFilter) => boolean = matchesTargetFilters,
): boolean {
  if (!card || !player) return false;
  if (
    checkSpecialSummonEligibility(card, {
      summonProcedure,
      fromZone,
    }).ok === false
  ) {
    return false;
  }
  const restrictions = Array.isArray(player.specialSummonRestrictions)
    ? player.specialSummonRestrictions
    : [];
  return restrictions.every((restriction) => {
    const filters = restriction?.allowedFilters;
    return !filters || matchesFilters(card, filters);
  });
}

export function canSimulatedProcedureEnterField(
  card: AiCardInput,
  player: Pick<AiPlayerInput, "field">,
  opponent: Pick<AiPlayerInput, "field"> | null | undefined,
  materials: readonly AiCardInput[],
  matchesFilters: (card: AiCardInput, filters: CardFilter) => boolean = matchesTargetFilters,
): boolean {
  const remaining = (player.field || []).filter((entry) => !materials.includes(entry));
  if (remaining.length >= 5) return false;
  const exclusive = (entry: AiCardInput) =>
    !entry.isFacedown && entry.fieldPresenceRestriction?.type === "only_monster_you_control_while_faceup";
  if (remaining.some(exclusive)) return false;
  if (exclusive(card) && remaining.length > 0) return false;
  const limit = card.fieldLimit;
  if (!limit || !matchesFilters(card, limit.filters || {})) return true;
  const fields = limit.scope === "global" ? [...remaining, ...(opponent?.field || [])] : remaining;
  const matching = fields.filter((entry) =>
    (!limit.requireFaceup || !entry.isFacedown) && matchesFilters(entry, limit.filters || {})).length;
  const max = Number.isFinite(Number(limit.max)) ? Number(limit.max) : 1;
  return matching + 1 <= max;
}

export function resolveSimulatedHandIndex(
  player: SimulatedPlayerState | null | undefined,
  action: SimulatedHandIndexAction,
  expectedKind: CardKind | readonly CardKind[] | null = null,
): number {
  const hand = player?.hand || [];
  const bound = resolvePlanningCard(hand, action.card, player?.id || "", "hand", action);
  if (bound.explicit) {
    if (!bound.card || (expectedKind && !(Array.isArray(expectedKind) ? expectedKind : [expectedKind]).includes(bound.card.cardKind))) return -1;
    return hand.indexOf(bound.card);
  }
  const matches = (
    card: SimulatedPlayerState["hand"][number] | null | undefined,
    allowLegacyIndex = false,
  ): boolean => {
    if (!card) return false;
    if (expectedKind) {
      const kinds = Array.isArray(expectedKind) ? expectedKind : [expectedKind];
      if (!kinds.includes(card.cardKind)) return false;
    }
    if (typeof action.cardId === "number" && card.id === action.cardId) {
      return true;
    }
    if (action.cardName && card.name === action.cardName) return true;
    return allowLegacyIndex && typeof action.cardId !== "number" && !action.cardName;
  };

  if (
    Number.isInteger(action.index as number) &&
    matches(hand[action.index!], true)
  ) {
    return action.index!;
  }
  return hand.findIndex(card => matches(card));
}

export function resolveSimulatedFieldIndex(
  player: SimulatedPlayerState | null | undefined,
  action: SimulatedFieldIndexAction,
  predicate: ((card: SimulatedPlayerState["field"][number]) => boolean) | null = null,
): number {
  const field = player?.field || [];
  const bound = resolvePlanningCard(field, action.card, player?.id || "", "field", action);
  if (bound.explicit) return bound.card && (!predicate || predicate(bound.card)) ? field.indexOf(bound.card) : -1;
  const matches = (
    card: SimulatedPlayerState["field"][number] | null | undefined,
  ): boolean => {
    if (!card) return false;
    if (typeof predicate === "function" && !predicate(card)) return false;
    if (typeof action.cardId === "number" && card.id === action.cardId) {
      return true;
    }
    if (action.cardName && card.name === action.cardName) return true;
    return !action.cardId && !action.cardName;
  };

  if (
    Number.isInteger(action.fieldIndex as number) &&
    matches(field[action.fieldIndex!])
  ) {
    return action.fieldIndex!;
  }
  if (
    Number.isInteger(action.materialIndex as number) &&
    matches(field[action.materialIndex!])
  ) {
    return action.materialIndex!;
  }
  return field.findIndex(matches);
}

function findSimulatedExtraDeckCard(
  player: SimulatedPlayerState | null | undefined,
  action: SimulatedExtraDeckAction,
): {
  card: SimulatedPlayerState["extraDeck"][number] | null | undefined;
  index: number;
} {
  const extraDeck = player?.extraDeck || [];
  const bound = resolvePlanningCard(extraDeck, action.extraDeckCard, player?.id || "", "extraDeck", action);
  if (bound.explicit) return { card: bound.card, index: bound.card ? extraDeck.indexOf(bound.card) : -1 };
  if (Number.isInteger(action.extraDeckIndex as number)) {
    const direct = extraDeck[action.extraDeckIndex!];
    if (
      direct &&
      (direct.id === action.cardId ||
        direct.name === action.cardName ||
        direct.name === action.extraDeckCard?.name)
    ) {
      return { card: direct, index: action.extraDeckIndex! };
    }
  }
  const index = extraDeck.findIndex(
    (card) =>
      card &&
      (card.id === action.cardId ||
        card.name === action.cardName ||
        card.name === action.extraDeckCard?.name),
  );
  return {
    card:
      index >= 0
        ? extraDeck[index]
        : (action.extraDeckCard as SimulatedCardState | null | undefined) ||
          null,
    index,
  };
}

function findSimulatedMaterialByHint(
  field: readonly SimulatedPlayerState["field"][number][] = [],
  hint: SimulatedExtraDeckMaterialHint = {},
): SimulatedPlayerState["field"][number] | undefined {
  const ids = Array.isArray(hint.instanceIds) ? hint.instanceIds : [];
  if (ids.length > 0) {
    return resolvePlanningMaterialIds(field, ids);
  }
  if (Number.isInteger(hint.index as number)) {
    const direct = field[hint.index!];
    if (
      direct &&
      (hint.id === undefined || direct.id === hint.id) &&
      (!hint.name || direct.name === hint.name)
    ) {
      return direct;
    }
  }
  return field.find(
    (card) =>
      card &&
      (hint.id === undefined || card.id === hint.id) &&
      (!hint.name || card.name === hint.name),
  );
}

function resolveSimulatedExtraDeckMaterials(
  player: SimulatedPlayerState | null | undefined,
  action: SimulatedExtraDeckAction,
): SimulatedPlayerState["field"] {
  const field = player?.field || [];
  const hints = Array.isArray(action.materials)
    ? action.materials
    : (action.materialIndices || []).map((index, offset) => ({
        index,
        id: action.materialIds?.[offset],
        name: action.materialNames?.[offset],
        instanceIds: action.materialInstanceIds?.[offset],
      }));
  const materials: SimulatedPlayerState["field"] = [];
  for (const [offset, hint] of hints.entries()) {
    const bound = resolvePlanningCard(field, undefined, player?.id || "", "field", action, offset);
    const material = bound.explicit ? bound.card : findSimulatedMaterialByHint(field, hint);
    if (!material || materials.includes(material)) return [];
    materials.push(material);
  }
  return materials;
}

function buildSelectionOptions(
  options: SimulatedSelectionOptionsInput = {},
): BuiltSimulatedSelectionOptions {
  const inputActionContext =
    options.actionContext ||
    options.activationContext?.actionContext ||
    {};
  // Effect handlers store simulated results in these contexts. Keep that
  // scratch state separate from the action later fingerprinted and executed.
  const actionContext = { ...inputActionContext } as SimulatedSelectionActionContext;
  const activationContext = options.activationContext
    ? {
        ...options.activationContext,
        ...(options.activationContext.actionContext ? {
          actionContext: options.activationContext.actionContext === inputActionContext
            ? actionContext : { ...options.activationContext.actionContext },
        } : {}),
      }
    : undefined;
  return {
    ...options,
    archetype: options.archetype,
    preferDefense: options.preferDefense,
    actionContext,
    activationContext: activationContext as SimulatedActionOptions["activationContext"],
    targetPreferences:
      options.targetPreferences ||
      (actionContext as SimulatedSelectionActionContext).targetPreferences ||
      {},
    specialSummonPositions:
      options.specialSummonPositions ||
      (actionContext as SimulatedSelectionActionContext).specialSummonPositions ||
      {},
  } as BuiltSimulatedSelectionOptions;
}

/** Reuse the legacy simulation boundary for typed execution-only policies. */
export function normalizePlanningOwnerPolicy(
  options: SimulatedActionOverrideOptions,
): SimulatedOwnerPolicy {
  const normalized = buildSelectionOptions(options);
  // Default empty maps must not shadow preferences built for the next effect.
  if (options.targetPreferences === undefined) delete normalized.targetPreferences;
  if (!("specialSummonPositions" in options)) delete normalized.specialSummonPositions;
  const strategy = options.strategy as SimulatedEventStrategyCapabilities | null | undefined;
  const rankSearchCandidates = normalized.rankSearchCandidates ||
    normalized.strategy?.rankSearchCandidates?.bind(normalized.strategy);
  const evaluateRecruitCandidate = normalized.evaluateRecruitCandidate ||
    normalized.strategy?.evaluateRecruitCandidate?.bind(normalized.strategy);
  const chooseSpecialSummonPosition = normalized.chooseSpecialSummonPosition ||
    normalized.strategy?.chooseSpecialSummonPosition?.bind(normalized.strategy);
  const chooseActionCase = normalized.chooseActionCase ||
    normalized.strategy?.chooseActionCase?.bind(normalized.strategy);
  return {
    ...normalized,
    ...(rankSearchCandidates ? { rankSearchCandidates } : {}),
    ...(evaluateRecruitCandidate ? { evaluateRecruitCandidate } : {}),
    ...(chooseSpecialSummonPosition ? { chooseSpecialSummonPosition } : {}),
    ...(chooseActionCase ? { chooseActionCase } : {}),
    ...(options.onEffectActivated ? { onEffectActivated: options.onEffectActivated } : {}),
    ...(strategy?.buildActivationContextForEffect ? {
      buildActivationContextForEffect: strategy.buildActivationContextForEffect.bind(strategy),
    } : {}),
  };
}

interface SimulatedEffectPlayer {
  id?: string | null;
  effectActivationRestrictions?: readonly SimulatedEffectActivationRestriction[] | undefined;
}

interface SimulatedEffectActivationRestriction {
  blockedNames?: unknown;
  names?: unknown;
  allowedAttributes?: unknown;
  attributes?: unknown;
  restrictedCardFilters?: object | null;
}

interface SimulatedRestrictionName {
  name?: { trim?(): string } | null;
}

interface SimulatedRestrictionAttribute {
  attribute?: { trim?(): string } | null;
}

interface SimulatedEffectState {
  turnCounter?: number;
  _simOncePerTurnTurn?: number;
  player?: SimulatedEffectPlayer | null;
  bot?: SimulatedEffectPlayer | null;
  _simOncePerTurn?: object;
  _gameTreeActors?: AiStateShape["_gameTreeActors"];
  materialDuelStats?: AiStateShape["materialDuelStats"];
}

interface SimulatedRuntimeEffect extends SimulatedUsageEffect {
  timing?: EffectTiming | null;
  placementOnly?: boolean;
  oncePerTurn?: boolean;
  oncePerTurnLimit?: number;
  usesPerTurn?: number;
  maxUsesPerTurn?: number;
}

type SimulatedEffectSourceCard = SimulatedPlayerState["field"][number];

function getSimPlayerById(
  state: SimulatedEffectState | null | undefined,
  playerId: string = "bot",
  ownerIsPhysical = false,
): SimulatedEffectPlayer | null | undefined {
  if (!state) return null;
  if (state._gameTreeActors && ownerIsPhysical) {
    if (state.player?.id === playerId) return state.player;
    if (state.bot?.id === playerId) return state.bot;
    return null;
  }
  if (playerId === "player") return state.player;
  if (playerId === "bot") return state.bot;
  if (state.player?.id === playerId) return state.player;
  if (state.bot?.id === playerId) return state.bot;
  return state[playerId as "player" | "bot"] || null;
}

function simEffectCanBeBlocked(
  effect: SimulatedRuntimeEffect | null | undefined,
): boolean {
  if (!effect || effect.placementOnly === true) return false;
  if (effect.timing === "passive") return false;
  return true;
}

function normalizeSimRestrictionNames(names: unknown = []): string[] {
  const values = (Array.isArray(names) ? names : [names]) as readonly (
    | string
    | SimulatedRestrictionName
    | null
    | undefined
  )[];
  return values
    .map((entry) =>
      typeof entry === "string"
        ? entry.trim()
        : entry?.name?.trim?.() || "",
    )
    .filter(Boolean);
}

function normalizeSimRestrictionAttributes(attributes: unknown = []): string[] {
  const values = (Array.isArray(attributes) ? attributes : [attributes]) as readonly (
    | string
    | SimulatedRestrictionAttribute
    | null
    | undefined
  )[];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of values) {
    const attribute =
      typeof entry === "string"
        ? entry.trim()
        : entry?.attribute?.trim?.() || "";
    if (!attribute) continue;
    const key = attribute.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(attribute);
  }
  return result;
}

function simAttributeMatches(
  value: unknown,
  allowedAttributes: readonly string[] = [],
): boolean {
  const actual = String(value || "").toLowerCase();
  return allowedAttributes.some(
    (attribute) => String(attribute || "").toLowerCase() === actual,
  );
}

function isSimulatedEffectActivationRestricted(
  state: SimulatedEffectState | null | undefined,
  effect: SimulatedRuntimeEffect | null | undefined,
  sourceCard: SimulatedEffectSourceCard | null | undefined,
  selfId: string = "bot",
  ownerIsPhysical = false,
): boolean {
  if (!sourceCard || !simEffectCanBeBlocked(effect)) return false;
  const player = getSimPlayerById(state, selfId, ownerIsPhysical);
  const restrictions = Array.isArray(player?.effectActivationRestrictions)
    ? player.effectActivationRestrictions
    : [];
  return restrictions.some((restriction) => {
    const blockedNames = normalizeSimRestrictionNames(
      restriction?.blockedNames || restriction?.names || [],
    );
    if (sourceCard.name && blockedNames.includes(sourceCard.name)) return true;

    const allowedAttributes = normalizeSimRestrictionAttributes(
      restriction?.allowedAttributes || restriction?.attributes || [],
    );
    if (allowedAttributes.length === 0) return false;
    const restrictedCardFilters =
      restriction?.restrictedCardFilters &&
      typeof restriction.restrictedCardFilters === "object"
        ? restriction.restrictedCardFilters
        : { cardKind: "monster" };
    if (!matchesTargetFilters(sourceCard, restrictedCardFilters, null, "self")) {
      return false;
    }
    return !simAttributeMatches(sourceCard.attribute, allowedAttributes);
  });
}

function canUseSimulatedEffect(
  state: SimulatedEffectState | null | undefined,
  effect: SimulatedRuntimeEffect | null | undefined,
  sourceCard: SimulatedEffectSourceCard | null | undefined,
  selfId: string = "bot",
  ownerIsPhysical = false,
): boolean {
  if (isSimulatedEffectActivationRestricted(state, effect, sourceCard, selfId, ownerIsPhysical)) {
    return false;
  }
  return canUseSimulatedEffectUsage(state, effect, sourceCard, selfId, ownerIsPhysical);
}

function markSimulatedEffectUsed(
  state: SimulatedEffectState | null | undefined,
  effect: SimulatedRuntimeEffect | null | undefined,
  sourceCard: SimulatedEffectSourceCard | null | undefined,
  selfId: string = "bot",
  ownerIsPhysical = false,
): void {
  if (state && sourceCard?.cardKind === "monster") {
    state.materialDuelStats ||= createMaterialDuelStats();
    const owner = getSimPlayerById(state, selfId, ownerIsPhysical);
    if (owner?.id) recordMaterialEffectIdentity(state.materialDuelStats, owner.id, sourceCard, effect?.id);
  }
  markSimulatedEffectUsage(state, effect, sourceCard, selfId, ownerIsPhysical);
}

function effectConditionsPass(
  state: SimulatedRuntimeState,
  effect: EffectDefinition | null | undefined,
  sourceCard: SimulatedCardState | null | undefined,
  options: SimulatedSelectionOptionsInput = {},
): boolean {
  if (effect?.requirePhase && !asArray(effect.requirePhase).includes(state.phase || "main1")) return false;
  if (!effect?.conditions) return true;
  return evaluateSimulatedConditions(effect.conditions, {
    state,
    selfId: options.selfId || "bot",
    options,
    sourceCard,
  });
}

function asArray(value: unknown): readonly unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function matchesZoneFilter(zone: unknown, filter: unknown): boolean {
  if (!filter || filter === "any") return true;
  return asArray(filter).includes(zone);
}

function getOtherSimPlayer(
  state:
    | {
        bot?: SimulatedPlayerState | null | undefined;
        player?: SimulatedPlayerState | null | undefined;
      }
    | null
    | undefined,
  player: SimulatedPlayerState | null | undefined,
): SimulatedPlayerState | null {
  if (!state || !player) return null;
  if (player === state.bot) return state.player || null;
  if (player === state.player) return state.bot || null;
  if (player.id === state.bot?.id) return state.player || null;
  if (player.id === state.player?.id) return state.bot || null;
  return null;
}

function sourceKey(
  card: SimulatedCardState,
): string | number | SimulatedCardState {
  return getCardInstanceId(card) ?? card?.fieldPresenceId ?? card;
}

function addSimEventSource(
  entries: SimulatedEventSourceList,
  seen: Set<string | number | SimulatedCardState>,
  player: SimulatedPlayerState | null | undefined,
  card: SimulatedCardState | null | undefined,
  zone: string | null | undefined,
): void {
  if (!player || !card) return;
  const key = sourceKey(card);
  if (seen.has(key)) return;
  seen.add(key);
  entries.push({
    player,
    opponent: getOtherSimPlayer({ bot: entries._bot, player: entries._player }, player),
    card,
    zone: (zone || findCardZone(player, card) || "field") as CanonicalZone,
  });
}

function addPlayerZoneSources(
  entries: SimulatedEventSourceList,
  seen: Set<string | number | SimulatedCardState>,
  state: SimulatedRuntimeState | null | undefined,
  player: SimulatedPlayerState | null | undefined,
  zones: readonly CanonicalZone[] = [],
): void {
  if (!player) return;
  for (const zone of zones) {
    for (const card of getZoneCards(player, zone)) {
      addSimEventSource(entries, seen, player, card, zone);
    }
  }
}

function effectExecutionActions(
  effect: EffectDefinition | null | undefined,
): CardAction[] {
  return [
    ...(Array.isArray(effect?.activationCosts) ? effect.activationCosts : []),
    ...(Array.isArray(effect?.activationCommitActions)
      ? effect.activationCommitActions
      : []),
    ...(Array.isArray(effect?.actions) ? effect.actions : []),
  ];
}

function hasHandPositionChangeTrigger(
  card: SimulatedCardState | null | undefined,
): boolean {
  return (card?.effects || []).some(
    (effect) =>
      effect &&
      effect.timing === "on_event" &&
      effect.event === "position_change" &&
      effect.requireZone &&
      matchesZoneFilter("hand", effect.requireZone),
  );
}

function addHandPositionChangeSources(
  entries: SimulatedEventSourceList,
  seen: Set<string | number | SimulatedCardState>,
  state: SimulatedRuntimeState | null | undefined,
  player: SimulatedPlayerState | null | undefined,
): void {
  if (!player || !Array.isArray(player.hand)) return;
  for (const card of player.hand) {
    if (!hasHandPositionChangeTrigger(card)) continue;
    addSimEventSource(entries, seen, player, card, "hand");
  }
}

function collectSimulatedEventSources(
  state: SimulatedRuntimeState,
  eventName: string,
  payload: SimulatedEventPayloadView = {},
): SimulatedEventSourceEntry[] {
  const entries: SimulatedEventSourceList = [];
  entries._bot = state?.bot || null;
  entries._player = state?.player || null;
  const seen = new Set<string | number | SimulatedCardState>();
  const players = [state?.bot, state?.player].filter(
    Boolean,
  ) as SimulatedPlayerState[];
  const eventCard = payload.card || payload.eventCard || null;
  const eventOwner =
    payload.player ||
    payload.toPlayer ||
    findCardOwner(state, eventCard) ||
    payload.fromPlayer ||
    null;

  if (eventName === "card_moved" || eventName === "card_to_grave") {
    if (eventCard && eventOwner) {
      addSimEventSource(
        entries,
        seen,
        eventOwner,
        eventCard,
        payload.toZone || findCardZone(eventOwner, eventCard) || "hand",
      );
    }
    for (const player of players) {
      addPlayerZoneSources(entries, seen, state, player, [
        "field",
        "fieldSpell",
        "spellTrap",
        "hand",
      ]);
    }
    if (eventName === "card_moved" && eventCard) {
      for (const binding of payload.equipBindingsAtFieldExit || []) {
        const before = binding.hostBeforeExit;
        if (before.zone !== payload.fromZone || before.instanceId == null ||
            before.instanceId !== (eventCard.instanceId ?? eventCard._instanceId ?? null) ||
            before.cardId !== (eventCard.id ?? null) || before.duelCardId !== (eventCard.duelCardId ?? null) ||
            before.controllerId !== payload.fromPlayer?.id || before.locationVersion + 1 !== payload.locationVersion) continue;
        const source = findSimulatedCardByInstanceId(state, binding.equipBeforeExit.instanceId);
        const actor = players.find(player => player.id === binding.equipController.id);
        const physical = findCardOwner(state, source);
        if (!source || source !== binding.equip || !actor || !physical) continue;
        addSimEventSource(entries, seen, actor, source, findCardZone(physical, source));
        const entry = entries.find(candidate => candidate.card === source);
        if (entry) entry.equipHostExitBinding = binding;
      }
    }
  } else if (eventName === "lp_change") {
    const recipients = eventOwner ? [eventOwner, ...players.filter(player => player !== eventOwner)] : players;
    for (const player of recipients) addPlayerZoneSources(entries, seen, state, player,
      ["fieldSpell", "field", "spellTrap"]);
  } else if (eventName === "battle_damage") {
    const participants = [payload.attackerOwner, payload.defenderOwner].filter(
      (player): player is SimulatedPlayerState => !!player,
    );
    for (const player of participants) addPlayerZoneSources(entries, seen, state, player,
      ["field", "fieldSpell", "hand"]);
  } else if (eventName === "attack_declared") {
    for (const player of players) addPlayerZoneSources(entries, seen, state, player,
      ["field", "fieldSpell", "spellTrap"]);
  } else if (eventName === "battle_destroy") {
    for (const player of players) addPlayerZoneSources(entries, seen, state, player,
      ["field", "fieldSpell", "spellTrap", "hand"]);
    if (eventCard && eventOwner) addSimEventSource(entries, seen, eventOwner, eventCard,
      findCardZone(eventOwner, eventCard) || "graveyard");
  } else if (eventName === "after_summon") {
    if (eventCard && eventOwner) {
      addSimEventSource(
        entries,
        seen,
        eventOwner,
        eventCard,
        findCardZone(eventOwner, eventCard) || "field",
      );
    }
    for (const player of players) {
      addPlayerZoneSources(entries, seen, state, player, [
        "field",
        "fieldSpell",
        "spellTrap",
        "hand",
      ]);
    }
  } else if (eventName === "card_equipped") {
    for (const card of [payload.target, payload.equipCard]) {
      const owner = findCardOwner(state, card);
      if (card && owner) addSimEventSource(entries, seen, owner, card, findCardZone(owner, card));
    }
  } else if (eventName === "standby_phase") {
    const standbyPlayers = [...players].sort((first, second) =>
      Number(second.id === eventOwner?.id) - Number(first.id === eventOwner?.id));
    for (const player of standbyPlayers) {
      addPlayerZoneSources(entries, seen, state, player, ["field", "spellTrap", "fieldSpell"]);
    }
  } else if (eventName === "position_change" || eventName === "end_phase" || eventName === "spell_activated" || eventName === "effect_activated" || eventName === "counter_removed") {
    for (const player of players) {
      addPlayerZoneSources(entries, seen, state, player, [
        "field",
        "fieldSpell",
        "spellTrap",
      ]);
      addHandPositionChangeSources(entries, seen, state, player);
    }
  }

  delete entries._bot;
  delete entries._player;
  entries.forEach((entry) => {
    entry.opponent = getOtherSimPlayer(state, entry.player);
  });
  return entries;
}

function findSimulatedCardByInstanceId(
  state: SimulatedRuntimeState | null | undefined,
  instanceId: string | number | null | undefined,
): SimulatedCardState | null {
  if (!state || instanceId == null) return null;
  for (const player of [state.player, state.bot]) {
    if (!player) continue;
    for (const zone of [
      "deck",
      "extraDeck",
      "hand",
      "field",
      "spellTrap",
      "graveyard",
      "banished",
    ] as const) {
      const card = (player[zone] || []).find(
        (candidate: SimulatedCardState) =>
          getCardInstanceId(candidate) === instanceId,
      );
      if (card) return card;
    }
    if (player.fieldSpell && getCardInstanceId(player.fieldSpell) === instanceId) {
      return player.fieldSpell;
    }
  }
  return null;
}

function cleanupSimulatedTemporaryEventEffects(
  state: SimulatedRuntimeState | null | undefined,
): void {
  if (!Array.isArray(state?.temporaryEventEffects)) {
    if (state) state.temporaryEventEffects = [];
    return;
  }
  const currentTurn = Number(state.turnCounter || 0);
  state.temporaryEventEffects = state.temporaryEventEffects.filter(
    (entry: SimulatedTemporaryEventEffect) =>
      entry &&
      (!Number.isFinite(entry.expiresOnTurn as number) ||
        currentTurn <= entry.expiresOnTurn!) &&
      (!Number.isFinite(entry.usesRemaining as number) ||
        entry.usesRemaining! > 0),
  );
}

function getMatchingSimulatedTemporaryEventEffects(
  state: SimulatedRuntimeState,
  eventName: string,
  payload: SimulatedEventPayloadView = {},
): SimulatedTemporaryEventEffect[] {
  cleanupSimulatedTemporaryEventEffects(state);
  const eventCard = payload.card || payload.eventCard || payload.changedCard || null;
  return (state.temporaryEventEffects || []).filter(
    (entry: SimulatedTemporaryEventEffect) => {
    if (!entry || entry.event !== eventName) return false;
    if (
      entry.boundEventTargetInstanceId != null &&
      getCardInstanceId(eventCard) !== entry.boundEventTargetInstanceId
    ) {
      return false;
    }
    if (
      entry.requireBoundTargetLeavesField === true &&
      (payload.fromZone !== "field" || payload.toZone === "field")
    ) {
      return false;
    }
    if (entry.requireBoundTargetDestroyed === true) {
      if (payload.fromZone !== "field" || payload.toZone === "field") return false;
      // Any first field exit ends the binding, including a bounce or banish.
      entry.usesRemaining = 0;
      if (
        payload.wasDestroyed !== true ||
        (payload.destroyCause !== "battle" && payload.destroyCause !== "effect")
      ) return false;
    }
      return true;
    },
  );
}

function ownerRoleFor(
  sourcePlayer: SimulatedPlayerState | null | undefined,
  eventPlayer: SimulatedPlayerState | null | undefined,
): "self" | "opponent" | null {
  if (!sourcePlayer || !eventPlayer) return null;
  return sourcePlayer === eventPlayer || sourcePlayer.id === eventPlayer.id
    ? "self"
    : "opponent";
}

function resolveSimulatedMovementEventOwner(
  state: SimulatedRuntimeState,
  effect: EffectDefinition,
  payload: SimulatedEventPayloadView,
): SimulatedPlayerState | null {
  if (effect.movementTriggerOwnership === "field_exit_controller" &&
      (payload.fromZone === "field" || payload.fromZone === "spellTrap" || payload.fromZone === "fieldSpell")) {
    return payload.fromPlayer || null;
  }
  return payload.player || payload.toPlayer || findCardOwner(state, payload.card || payload.eventCard) || payload.fromPlayer || null;
}

function simEffectForEventCard(
  effect: EffectDefinition | null | undefined,
  payload: SimulatedEventPayloadView = {},
): EffectDefinition | null | undefined {
  if (!effect?.oncePerTurnPerEventCard) return effect;
  const eventCard = payload.card || payload.eventCard || payload.changedCard || null;
  const eventCardKey =
    eventCard?.duelCardId ??
    (getCardInstanceId(eventCard) ||
      eventCard?.fieldPresenceId ||
      eventCard?.id ||
      eventCard?.name ||
      "event_card");
  const baseName = effect.oncePerTurnName || effect.id || "sim_event";
  return {
    ...effect,
    oncePerTurn: true,
    oncePerTurnName: `${baseName}:event_card:${eventCardKey}`,
  };
}

function matchesSimulatedEventEffect(
  state: SimulatedRuntimeState,
  eventName: string,
  payload: SimulatedEventPayloadView = {},
  sourceEntry: SimulatedEventSourceView,
  effect:
    | (EffectDefinition & LegacySimulatedEventEffectFields)
    | null
    | undefined,
  options: SimulatedSelectionOptionsInput = {},
  isTemporaryRegistration = false,
  conditionCheck?: () => boolean,
): effect is EffectDefinition & LegacySimulatedEventEffectFields {
  const sourceCard = sourceEntry.card;
  const sourceZone = sourceEntry.zone;
  const binding = sourceEntry.equipHostExitBinding;
  const usesExitProof = !!effect && hasEquipHostExitProof(sourceCard, effect, binding);
  if (binding && !usesExitProof) return false;
  if (usesExitProof && effect) {
    const physical = findCardOwner(state, sourceCard);
    if (!matchesEquipHostExitSourcePresence(sourceCard, effect, binding, physical?.id || null,
      physical ? findCardZone(physical, sourceCard) : null)) return false;
  }
  const eligibilityZone = usesExitProof && binding ? binding.equipBeforeExit.zone : sourceZone;
  const sourceFaceUp = usesExitProof && binding ? binding.equipBeforeExit.faceUp : sourceCard.isFacedown !== true;
  const eventCard = payload.card || payload.eventCard || payload.changedCard || null;
  const eventPlayer = effect && (eventName === "card_moved" || eventName === "card_to_grave")
    ? resolveSimulatedMovementEventOwner(state, effect, payload)
    : payload.player || payload.toPlayer || findCardOwner(state, eventCard);
  const eventRole = ownerRoleFor(sourceEntry.player, eventPlayer);

  if (!effect || effect.timing !== "on_event" || effect.event !== eventName) {
    return false;
  }
  if ((eventName === "card_moved" || eventName === "card_to_grave") && !eventPlayer) return false;
  if (effect.contextLabel && effect.contextLabel !== payload.contextLabel) return false;
  const sourceOnField = ["field", "fieldSpell", "spellTrap"].includes(sourceZone);
  const recordsNegatedBattleActivation = payload.recordNegatedBattleActivation === true &&
    (eventName === "battle_destroy" || eventName === "attack_declared" || eventName === "battle_damage");
  if (sourceOnField && sourceCard.effectsNegated === true && !recordsNegatedBattleActivation) return false;
  if (sourceCard === eventCard && payload.fromZone === "field") {
    if (effect.requireFaceupAtFieldExit && !payload.wasFaceupBeforeMove) return false;
    if (payload.effectsNegatedAtFieldExit && !effect.allowIfEffectsNegatedAtFieldExit) return false;
  }
  if (
    ["field", "fieldSpell", "spellTrap"].includes(eligibilityZone) &&
    !sourceFaceUp
  ) {
    return false;
  }
  if (effect.requireFaceup === true && !sourceFaceUp) {
    return false;
  }
  if (
    Array.isArray(effect.activationZones) &&
    !effect.activationZones.includes(eligibilityZone)
  ) {
    return false;
  }
  if (effect.requireZone && !matchesZoneFilter(eligibilityZone, effect.requireZone)) {
    return false;
  }
  if (effect.requirePhase) {
    const phases = asArray(effect.requirePhase);
    if (!phases.includes(state?.phase || "main1")) return false;
  }

  if (eventName === "standby_phase" && !isTemporaryRegistration) {
    if (!payload.player) return false;
    if (effect.standbyPlayer !== "any" && eventRole !== "self") return false;
    if (sourceCard.subtype === "equip" && !sourceCard.equippedTo) return false;
  }

  if (eventName === "attack_declared" || eventName === "battle_damage") {
    const defender = payload.defender || payload.target;
    const attackerOwner = payload.attackerOwner || findCardOwner(state, payload.attacker);
    const defenderOwner = payload.defenderOwner || findCardOwner(state, defender);
    if (!payload.attacker) return false;
    if (effect.requireOpponentAttack && attackerOwner !== getOtherSimPlayer(state, sourceEntry.player)) return false;
    if (effect.requireDefenderIsSelf && defenderOwner !== sourceEntry.player) return false;
    if (effect.requireSelfAsAttacker && payload.attacker !== sourceCard) return false;
    if (effect.requireSelfAsDefender && defender !== sourceCard) return false;
    if (effect.requireDefender && !defender) return false;
    if (effect.requireDefenderPosition && defender?.position !== "defense") return false;
    if (effect.requireDefenderType && (!defender?.type || !asArray(effect.requireDefenderType).includes(defender.type))) return false;
    if (eventName === "battle_damage") {
      if (!defender || !attackerOwner || !defenderOwner) return false;
      if (sourceZone === "hand" && (sourceCard.cardKind !== "monster" || effect.requireZone !== "hand" ||
          (effect.isQuickEffect !== true && effect.speed !== 2))) return false;
      if (!canActivateDuringDamageStep(effect, { cardKind: sourceCard.cardKind || null,
        subtype: sourceCard.subtype || null, isFacedown: sourceCard.isFacedown === true }, { type: "battle_damage", event: "battle_damage",
        isDamageStep: true, damageStepTiming: payload.damageStepTiming || "before_damage_calculation",
        activationZone: sourceZone }).ok) return false;
    }
  }

  if (eventName === "battle_destroy") {
    const destroyed = payload.destroyed || eventCard;
    if (!payload.attacker || !destroyed) return false;
    if (effect.requireSelfAsAttacker && payload.attacker !== sourceCard) return false;
    if (effect.requireSelfAsDestroyed && destroyed !== sourceCard) return false;
    if (effect.requireEquippedAsAttacker && sourceCard.equippedTo !== payload.attacker) return false;
    const destroyers = payload.battleDestroyers || [payload.battleDestroyer || payload.attacker];
    if (effect.requireSelfAsBattleDestroyer && !destroyers.includes(sourceCard)) return false;
    if (effect.requireEquippedAsBattleDestroyer &&
        (!sourceCard.equippedTo || !destroyers.includes(sourceCard.equippedTo))) return false;
    if (effect.requireSelfWasSummonedBy && !asArray(effect.requireSelfWasSummonedBy).includes(sourceCard.lastSummonMethod)) return false;
    if (effect.requireSelfSummonProcedure && !asArray(effect.requireSelfSummonProcedure).includes(sourceCard.lastSummonProcedure)) return false;
    const destroyedOwner = payload.destroyedOwner || findCardOwner(state, destroyed);
    const destroyedRole = ownerRoleFor(sourceEntry.player, destroyedOwner);
    if (effect.requireDestroyedIsOpponent && destroyedRole !== "opponent") return false;
    if (effect.requireOwnMonsterArchetype && (destroyedRole !== "self" || destroyed.cardKind !== "monster" ||
        !destroyed.archetype?.includes(effect.requireOwnMonsterArchetype))) return false;
    const destroyedFilters = effect.destroyedCardFilters;
    if (destroyedFilters && !matchesTargetFilters(destroyed, destroyedFilters, sourceCard, destroyedRole)) return false;
    const positions = effect.requireDestroyedPosition;
    if (positions && !asArray(positions).includes(payload.destroyedPosition || destroyed.position)) return false;
  }

  if (eventName === "card_equipped") {
    if (!payload.equipCard || !payload.target) return false;
    if (effect.requireEquipCardFilters && !matchesTargetFilters(payload.equipCard, effect.requireEquipCardFilters, sourceCard)) return false;
    if (effect.requireEquippedCardFilters && !matchesTargetFilters(payload.target, effect.requireEquippedCardFilters, sourceCard)) return false;
  }

  if (eventName === "card_moved") {
    if (effect.requireSelfAsMoved === true && sourceCard !== eventCard) return false;
    if (effect.fromZone && !matchesZoneFilter(payload.fromZone, effect.fromZone)) {
      return false;
    }
    if (effect.toZone && !matchesZoneFilter(payload.toZone, effect.toZone)) {
      return false;
    }
    const requiresEffectMove =
      effect.movedByEffect === true || effect.requireMovedByEffect === true;
    if (requiresEffectMove && payload.movedByEffect !== true) return false;
    if (
      effect.requireMovedCardWasFaceup === true &&
      payload.wasFaceupBeforeMove !== true
    ) {
      return false;
    }
    if (
      effect.requireFaceupAtFieldExit === true &&
      (payload.fromZone !== "field" || payload.wasFaceupBeforeMove !== true)
    ) {
      return false;
    }
    const condition = effect.condition;
    if (condition && "type" in condition) {
      if (condition.type === "destroyed_by_battle" &&
          (payload.wasDestroyed !== true || payload.destroyCause !== "battle")) return false;
      if (condition.type === "destroyed_by_battle_or_effect" &&
          (payload.wasDestroyed !== true || (payload.destroyCause !== "battle" && payload.destroyCause !== "effect"))) return false;
    }
  }

  if (eventName === "card_to_grave") {
    if (sourceCard !== eventCard && !effect.eventCardFilters) return false;
    if (effect.requireSelfAsDestroyed && !payload.wasDestroyed) return false;
    if (effect.requireSelfDestroyedByBattle && payload.destroyCause !== "battle") return false;
    if (effect.requireDestroyedByOpponent &&
        (!payload.destroySource || payload.destroySource.controller === sourceEntry.player.id)) return false;
    if (effect.fromZone && !matchesZoneFilter(payload.fromZone, effect.fromZone)) return false;
    const condition = effect.condition;
    if (condition && "type" in condition) {
      if (condition.type === "destroyed_by_battle" && payload.destroyCause !== "battle") return false;
      if (condition.type === "destroyed_by_battle_or_effect" &&
          payload.destroyCause !== "battle" && payload.destroyCause !== "effect") return false;
    }
  }

  if (eventName === "end_phase") {
    const phaseOwner = effect.endPhasePlayer;
    if (phaseOwner !== "any" && sourceEntry.player !== eventPlayer) return false;
  }

  if (eventName === "after_summon") {
    if (effect.triggerPlayer === "self" && eventRole !== "self") return false;
    if (effect.triggerPlayer === "opponent" && eventRole !== "opponent") return false;
    if (effect.requireSelfAsSummoned === true && sourceCard !== eventCard) {
      return false;
    }
    if (effect.requireOpponentSummon === true && eventRole !== "opponent") {
      return false;
    }
    const summonMethods = effect.summonMethods ?? effect.summonMethod;
    if (summonMethods && !asArray(summonMethods).includes(payload.method)) {
      return false;
    }
    const summonFrom = effect.summonFrom ?? effect.requireSummonedFrom;
    if (summonFrom && payload.fromZone && !matchesZoneFilter(payload.fromZone, summonFrom)) {
      return false;
    }
  }

  if (eventName === "lp_change") {
    if (effect.triggerPlayer === "self" && eventRole !== "self") return false;
    if (effect.triggerPlayer === "opponent" && eventRole !== "opponent") return false;
    const delta = typeof payload.before === "number" && typeof payload.after === "number"
      ? payload.after - payload.before : null;
    const gained = Math.max(0, delta ?? payload.lpGained ?? 0);
    const lost = Math.max(0, delta === null ? payload.lpLost ?? payload.lpPaid ?? 0 : -delta);
    const damage = Math.min(lost, Math.max(0, payload.damageAmount ?? 0));
    const kind = effect.lpChangeKind || "gain";
    const amount = kind === "gain" ? gained : kind === "loss" ? lost : damage;
    if (amount <= 0 || amount < (effect.minAmount ?? (kind === "gain" ? effect.minLpGained : undefined) ?? 0)) return false;
    const filters = effect.lpChangeSourceFilters || effect.sourceCardFilters;
    if (filters && (!payload.sourceCard || !matchesTargetFilters(payload.sourceCard, filters, sourceCard))) return false;
  }

  if (eventName === "counter_removed") {
    if (effect.counterType && effect.counterType !== payload.counterType) return false;
    if (effect.minAmount !== undefined && Number(payload.amount || 0) < effect.minAmount) return false;
    if (effect.requireRemovedFromField && payload.fromField !== true) return false;
  }

  if (eventName === "spell_activated" || eventName === "effect_activated") {
    if (effect.triggerPlayer === "self" && eventRole !== "self") return false;
    if (effect.triggerPlayer === "opponent" && eventRole !== "opponent") return false;
    if (effect.excludeActivatedSelf && eventCard === sourceCard) return false;
    if (effect.activatedCardFilters && !matchesTargetFilters(eventCard, effect.activatedCardFilters, sourceCard, eventRole)) return false;
    if (eventName === "effect_activated" && effect.activatedEffectFilters &&
        !effectMatchesFilters(payload.effect, effect.activatedEffectFilters, {
          activationZone: payload.activationZone || null, placementOnly: payload.placementOnly === true,
        })) return false;
  }

  if (eventName === "position_change") {
    const changedOwner = payload.player || findCardOwner(state, eventCard);
    if (!eventCard || !changedOwner || !matchesPositionChangeEvent(effect, sourceCard, eventCard, payload, {
      sourceOwnerId: sourceEntry.player.id, changedOwnerId: changedOwner.id,
      changedIsFacedown: eventCard.isFacedown === true,
      matchesEventFilters: filters => matchesTargetFilters(eventCard, filters, sourceCard, eventRole),
      matchesSourceFilters: (card, filters) => !!card && matchesTargetFilters(card, filters, sourceCard),
    })) return false;
  }

  if (effect.eventCardFilters?.eventCardIsEquippedToSource === true &&
      !(usesExitProof || sourceCard.equippedTo === eventCard || sourceCard.equipTarget === eventCard)) return false;
  if (
    effect.eventCardFilters &&
    !matchesTargetFilters(eventCard, effect.eventCardFilters, sourceCard, eventRole)
  ) {
    return false;
  }

  return conditionCheck ? conditionCheck() : effectConditionsPass(state, effect, sourceCard, {
    ...options,
    actionContext: { ...buildSimEventActionContext(eventName, payload, options.actionContext),
      player: sourceEntry.player, opponent: getOtherSimPlayer(state, sourceEntry.player), eventPlayer },
    eventCard,
    movedCard: eventName === "card_moved" ? eventCard : null,
    changedCard: eventName === "position_change" ? eventCard : null,
    summonedCard: eventName === "after_summon" ? eventCard : null,
  });
}

function canPaySimulatedActivationCosts(
  effect: EffectDefinition,
  selections: ReturnType<typeof selectSimulatedTargets>,
  source: SimulatedCardState,
  player: SimulatedPlayerState,
  state: SimulatedRuntimeState,
  options: SimulatedActionOptions = {},
): boolean {
  const opponent = state.player === player ? state.bot : state.player;
  const remainingLp = new Map<SimulatedPlayerState, number>();
  const remainingCounters = new Map<SimulatedCardState, Map<string, number>>();
  return (effect.activationCosts || []).every(cost => {
    if (cost.type === "pay_lp") {
      const targetPlayer = resolveActionPlayer(cost, player, opponent);
      const lp = remainingLp.get(targetPlayer) ?? targetPlayer.lp;
      const baseAmount = getBaseLpCost(cost, lp);
      const amount = resolveSimulatedLpCost({ action: cost, targetPlayer, self: player, opponent, state,
        options: { ...options, sourceCard: source }, baseAmount }).finalAmount;
      if (baseAmount <= 0 || lp < amount) return false;
      remainingLp.set(targetPlayer, lp - amount);
      return true;
    }
    if (cost.type === "remove_counter") {
      const cards = resolveTargetsForAction(cost, selections, { ...options, sourceCard: source, self: player, selfId: player.id }, opponent);
      const counterType = cost.counterType || "counter";
      const amount = cost.amount ?? 1;
      if (!cards.length || amount <= 0) return false;
      return cards.every(card => {
        const counters = remainingCounters.get(card) ?? new Map<string, number>();
        const remaining = counters.get(counterType) ?? getCounterValue(card, counterType);
        if (remaining < amount) return false;
        counters.set(counterType, remaining - amount);
        remainingCounters.set(card, counters);
        return true;
      });
    }
    if (cost.type === "remove_counters_from_field") {
      if (!cost.targetRef && options.activationContext?.decisions?.selections?.counter_payment !== undefined) return false;
      const cards = resolveTargetsForAction(cost, selections, { ...options, sourceCard: source, self: player, selfId: player.id }, opponent);
      const payment = prepareSimulatedFieldCounterPayment(cost, cards, player, opponent, { ...options, sourceCard: source },
        (card, counterType) => remainingCounters.get(card)?.get(counterType) ?? getCounterValue(card, counterType));
      const selected = cost.targetRef ? selections[cost.targetRef] : undefined;
      const counterType = cost.counterType || "default";
      let needed = payment?.amount || 0;
      if (!payment || (cost.targetRef && (!Array.isArray(selected) || selected.length !== cards.length))) return false;
      while (needed > 0) {
        let progressed = false;
        for (const card of payment.cards) {
          if (needed <= 0) break;
          const counters = remainingCounters.get(card) ?? new Map<string, number>();
          const available = counters.get(counterType) ?? getCounterValue(card, counterType);
          if (available <= 0) continue;
          counters.set(counterType, available - 1);
          remainingCounters.set(card, counters);
          needed--; progressed = true;
        }
        if (!progressed) return false;
      }
      return needed === 0;
    }
    if (cost.type !== "move" || !cost.targetRef) return true;
    const cards = resolveTargetsForAction(cost, selections, { sourceCard: source, self: player, selfId: player.id },
      opponent);
    if (!cards.length || new Set(cards).size !== cards.length) return false;
    return cards.every(card => {
      const owner = findCardOwner(state, card);
      if (!owner || (cost.fromZone && findCardZone(owner, card) !== cost.fromZone)) return false;
      if (cost.requireDestination && card.isToken && cost.to !== "field") return false;
      return canMoveCardToZone(player, card, cost.to || "graveyard", owner, {
        state, requireDestination: cost.requireDestination === true,
        allowExtraDeckMonsterToHand: cost.allowExtraDeckMonsterToHand === true,
      });
    });
  });
}

function hasRequiredSimSelections(
  targets: NonNullable<EffectDefinition["targets"]> = [],
  selections: ReturnType<typeof selectSimulatedTargets> = {},
): boolean {
  return (targets || []).every((target) => {
    if (!target?.id) return true;
    const linkedSelections =
      typeof target.countFromSelectionRef === "string"
        ? selections[target.countFromSelectionRef]
        : null;
    const min = Array.isArray(linkedSelections)
      ? linkedSelections.length
      : Number(target.count?.min ?? target.count ?? 1);
    if (min <= 0) return true;
    return (
      (selections[target.id] || []) as { length: number }
    ).length >= min;
  });
}

function buildSimEventActionContext(
  eventName: string,
  payload: SimulatedEventPayloadView = {},
  base: object = {},
) {
  const eventCard = payload.card || payload.eventCard || payload.changedCard || null;
  return {
    ...(payload.actionContext || {}),
    ...(base || {}),
    simEventName: eventName,
    eventCard,
    movedCard: eventName === "card_moved" ? eventCard : null,
    changedCard: eventName === "position_change" ? eventCard : null,
    summonedCard: eventName === "after_summon" ? eventCard : null,
    eventPlayer: payload.player || payload.toPlayer || null,
    fromZone: payload.fromZone || null,
    toZone: payload.toZone || null,
    summonMethod: payload.method || null,
    summonFromZone: eventName === "after_summon" ? payload.fromZone || null : null,
    wasFaceupBeforeMove: payload.wasFaceupBeforeMove === true,
    wasFaceupBeforeChange: payload.wasFaceupBeforeChange === true,
    movementSourceCard: payload.sourceCard || null,
    ...(eventName === "lp_change" ? {
      lpChangePlayer: payload.player || null, lpChangeSourceCard: payload.sourceCard || null,
      lpGained: Math.max(0, (payload.after ?? 0) - (payload.before ?? 0)),
      lpLost: Math.max(0, (payload.before ?? 0) - (payload.after ?? 0)),
      lpPaid: payload.lpPaid || 0, damageAmount: payload.damageAmount || 0,
      before: payload.before, after: payload.after,
    } : {}),
    ...(eventName === "attack_declared" || eventName === "battle_damage" ? {
      attacker: payload.attacker || null,
      defender: payload.defender || payload.target || null,
      target: payload.target || payload.defender || null,
      ...(eventName === "battle_damage" ? { isDamageStep: true,
        damageStepTiming: payload.damageStepTiming || "before_damage_calculation" } : {}),
    } : {}),
    ...(eventName === "battle_destroy" ? {
      attacker: payload.attacker || null,
      destroyed: payload.destroyed || eventCard,
      destroyedOwner: payload.destroyedOwner || payload.player || null,
      battleDestroyer: payload.battleDestroyer || payload.attacker || null,
      battleDestroyers: payload.battleDestroyers || (payload.attacker ? [payload.attacker] : []),
    } : {}),
    ...getPositionChangeProvenance(payload),
  };
}

export function attachSimulatedEventEmitter(
  state: SimulatedRuntimeState,
  options: SimulatedEventDispatchOptions,
): ManagedSimulatedEventOptions;
export function attachSimulatedEventEmitter(
  state: SimulatedRuntimeState,
  options?: ManagedSimulatedEventOptions,
): ManagedSimulatedEventOptions;
export function attachSimulatedEventEmitter(
  state: SimulatedRuntimeState,
  options: SimulatedEventDispatchOptions | ManagedSimulatedEventOptions = {},
): ManagedSimulatedEventOptions {
  if (options.enableSimulatedEvents !== true) {
    return options as ManagedSimulatedEventOptions;
  }
  if (
    typeof options.emitSimulatedEvent === "function" &&
    options._managedSimulatedEventEmitter !== true
  ) {
    return options as ManagedSimulatedEventOptions;
  }
  options._managedSimulatedEventEmitter = true;
  options.emitSimulatedEvent = (
    eventName: string,
    payload: object = {},
    extra: SimulatedActionOptions = {},
  ) => {
    options.onSimulatedEvent?.(eventName, payload);
    dispatchSimulatedEvent(state, eventName, payload as SimulatedEventPayloadView, {
      ...options,
      ...extra,
      _simEventDepth: Number(options._simEventDepth || 0),
    });
  };
  options.emitSimulatedEvents = (events: readonly SimulatedEventOccurrence[]) => {
    const queue: SimulatedQueuedTrigger[] = [];
    for (const occurrence of events) {
      if (!occurrence.observed) options.onSimulatedEvent?.(occurrence.event, occurrence.payload);
      dispatchSimulatedEvent(state, occurrence.event, occurrence.payload, options, queue);
    }
    // Runtime SEGOC publishes active mandatory, opposing mandatory, active
    // optional, opposing optional triggers, then resolves the Chain LIFO.
    resolveQueuedSimulatedTriggers(state, queue);
  };
  return options as ManagedSimulatedEventOptions;
}

interface SimulatedQueuedTrigger {
  ownerId: string;
  optional: boolean;
  prepare?(): boolean;
  getPendingPlan?(): SimulatedPendingEffectPlan | null;
  resolve(): void;
}

export interface SimulatedPendingEffectPlan {
  readonly ownerId: string;
  readonly sourceInstanceId: number | string | null;
  readonly effect: EffectDefinition;
  readonly decisions: AIDecisionPlan;
}

const simulatedPendingEffectPlans = new WeakMap<object, readonly SimulatedPendingEffectPlan[]>();
type SimulatedResolutionCompletion = NonNullable<SimulatedActionOptions["onSimulatedResolutionComplete"]>;
const queuedResolutionCompletions = new WeakMap<SimulatedQueuedTrigger[], Set<SimulatedResolutionCompletion>>();
const activeResolutionCompletions = new WeakMap<object, Set<SimulatedResolutionCompletion>>();

function registerResolutionCompletion(state: SimulatedRuntimeState, queue: SimulatedQueuedTrigger[],
  callback: SimulatedResolutionCompletion | undefined): void {
  if (!callback) return;
  const active = activeResolutionCompletions.get(state);
  if (active) { active.add(callback); return; }
  let callbacks = queuedResolutionCompletions.get(queue);
  if (!callbacks) queuedResolutionCompletions.set(queue, callbacks = new Set());
  callbacks.add(callback);
}

function withResolutionCompletions(state: SimulatedRuntimeState, queue: SimulatedQueuedTrigger[], resolve: () => void,
  forward?: (callback: SimulatedResolutionCompletion) => void): void {
  const parent = activeResolutionCompletions.get(state);
  const callbacks = parent || new Set<SimulatedResolutionCompletion>();
  for (const callback of queuedResolutionCompletions.get(queue) || []) callbacks.add(callback);
  queuedResolutionCompletions.delete(queue);
  activeResolutionCompletions.set(state, callbacks);
  try { resolve(); } finally {
    if (parent) activeResolutionCompletions.set(state, parent);
    else {
      activeResolutionCompletions.delete(state);
      for (const callback of callbacks) {
        if (forward) forward(callback);
        else callback({ state });
      }
    }
  }
}

/** Plans committed within the current simulated trigger opportunity; never persistent state. */
export function getSimulatedPendingEffectPlans(state: object): readonly SimulatedPendingEffectPlan[] {
  return simulatedPendingEffectPlans.get(state) || [];
}

function resolveQueuedSimulatedTriggers(state: SimulatedRuntimeState, queue: SimulatedQueuedTrigger[],
  forward?: (callback: SimulatedResolutionCompletion) => void): void {
  withResolutionCompletions(state, queue, () => {
    const group = (entry: SimulatedQueuedTrigger) => (entry.optional ? 2 : 0) + (entry.ownerId === state.turn ? 0 : 1);
    const parentPlans = simulatedPendingEffectPlans.get(state);
    const plans = [...parentPlans || []];
    simulatedPendingEffectPlans.set(state, plans);
    try {
      while (queue.length) {
        const pending = queue.splice(0).sort((a, b) => group(a) - group(b));
        const prepared: Array<{ trigger: SimulatedQueuedTrigger; plan: SimulatedPendingEffectPlan | null }> = [];
        for (const trigger of pending) {
          if (trigger.prepare?.() === false) continue;
          const plan = trigger.getPendingPlan?.() || null;
          if (plan) plans.push(plan);
          prepared.push({ trigger, plan });
        }
        for (const { trigger, plan } of prepared.reverse()) {
          if (plan) {
            const index = plans.indexOf(plan);
            if (index >= 0) plans.splice(index, 1);
          }
          trigger.resolve();
        }
      }
    } finally {
      if (parentPlans) simulatedPendingEffectPlans.set(state, parentPlans);
      else simulatedPendingEffectPlans.delete(state);
    }
  }, forward);
}

interface DeferredSimulatedEventPublisher {
  deferEvent(event: string): boolean;
  publish(event: string, payload: object, extra: SimulatedActionOptions, observed: boolean): void;
  registerCompletion(callback: SimulatedResolutionCompletion): void;
}

const deferredEventEmitters = new WeakMap<object, DeferredSimulatedEventPublisher>();

/** Observe/freeze an event now, then publish its triggers after the parent procedure. */
export function createDeferredSimulatedEventFrame(
  state: SimulatedRuntimeState,
  input: SimulatedEventDispatchOptions,
  deferEvent: (event: string) => boolean = () => true,
  customEmitterMode: "delegate" | "observer" = "delegate",
): { options: ManagedSimulatedEventOptions; finishResolution(): void } {
  const base = attachSimulatedEventEmitter(state, input);
  const inheritedEmitter = input.emitSimulatedEvent;
  const inheritedFrame = inheritedEmitter ? deferredEventEmitters.get(inheritedEmitter) : undefined;
  const customEmitter = inheritedEmitter && input._managedSimulatedEventEmitter !== true && !inheritedFrame ? inheritedEmitter : null;
  if (customEmitter && customEmitterMode === "delegate") {
    // An external dispatcher owns its timing; never silently replace that port.
    (state._simUnsupportedActions ??= []).push("deferred_event_frame:custom_emitter");
    return { options: base, finishResolution() {} };
  }
  const queue: SimulatedQueuedTrigger[] = [];
  const registerCompletion = (callback: SimulatedResolutionCompletion) => {
    if (inheritedFrame) inheritedFrame.registerCompletion(callback);
    else registerResolutionCompletion(state, queue, callback);
  };
  if (base.onSimulatedResolutionComplete) registerCompletion(base.onSimulatedResolutionComplete);
  const publish: DeferredSimulatedEventPublisher["publish"] = (event, payload, extra, observed) => {
    if (inheritedFrame?.deferEvent(event)) {
      inheritedFrame.publish(event, payload, extra, observed);
      return;
    }
    if (!deferEvent(event) && !observed && !customEmitter) {
      base.emitSimulatedEvent?.(event, payload, extra);
      return;
    }
    dispatchSimulatedEvent(state, event, payload, { ...base, ...extra }, deferEvent(event) ? queue : undefined,
      observed ? undefined : () => { base.onSimulatedEvent?.(event, payload); customEmitter?.(event, payload, extra); });
  };
  const options: ManagedSimulatedEventOptions = { ...base, _managedSimulatedEventEmitter: false,
    emitSimulatedEvent(event, payload = {}, extra = {}) {
      publish(event, payload, extra, false);
    },
    emitSimulatedEvents(events) {
      for (const event of events) publish(event.event, event.payload, {}, event.observed === true);
    },
  };
  if (options.emitSimulatedEvent) deferredEventEmitters.set(options.emitSimulatedEvent, { deferEvent, publish, registerCompletion });
  let finished = false;
  return { options, finishResolution() {
    if (finished) return;
    finished = true;
    resolveQueuedSimulatedTriggers(state, queue, inheritedFrame?.registerCompletion);
  } };
}

function dispatchSimulatedEvent(
  state: SimulatedRuntimeState,
  eventName: string,
  payload: SimulatedEventPayloadView = {},
  options: SimulatedEventDispatchOptions = {},
  queue?: SimulatedQueuedTrigger[],
  observe?: () => void,
  sourceCards?: readonly SimulatedCardState[],
  sourceEffects?: readonly EffectDefinition[],
): void {
  if (options.enableSimulatedEvents !== true) return;
  const depth = Number(options._simEventDepth || 0);
  const maxDepth = Number.isFinite(options.maxSimulatedEventDepth as number)
    ? options.maxSimulatedEventDepth!
    : 8;
  if (depth >= maxDepth) {
    (state._simUnsupportedActions ??= []).push("simulated_event_depth");
    return;
  }

  const sourceEntries = collectSimulatedEventSources(state, eventName, payload);
  if (sourceCards) {
    for (let index = sourceEntries.length - 1; index >= 0; index--) {
      const entry = sourceEntries[index];
      if (entry && !sourceCards.includes(entry.card)) sourceEntries.splice(index, 1);
    }
  }
  // Event references bind before immediate observers and activation policies
  // can mutate a host or the referenced card's presence.
  const eventReferences = new Map<SimulatedCardState, Map<EffectDefinition, Record<string, SimulatedReferenceSnapshot[]>>>();
  const eventReferenceSources = new Map<SimulatedCardState, SimulatedReferenceSnapshot[]>();
  for (const entry of sourceEntries) {
    const effects = new Map<EffectDefinition, Record<string, SimulatedReferenceSnapshot[]>>();
    for (const effect of entry.card.effects || []) {
      if (effect.timing !== "on_event" || effect.event !== eventName) continue;
      const references: CanonicalSelectionMap = {};
      const context = buildEventReferenceContext(eventName, payload, entry.card);
      for (const definition of effect.targets || []) {
        if (definition.intent !== "reference" || !definition.targetFromContext) continue;
        const key = definition.targetFromContext;
        const value: unknown = key ? context[key] : null;
        references[definition.id] = (Array.isArray(value) ? value : value ? [value] : []) as SimulatedCardState[];
      }
      effects.set(effect, captureSimulatedReferences({ ...effect,
        targets: (effect.targets || []).filter(definition => definition.intent === "reference" && definition.targetFromContext) },
      references, entry.player, entry.opponent));
    }
    eventReferences.set(entry.card, effects);
    eventReferenceSources.set(entry.card, captureSimulatedReferences(null, undefined, entry.player, entry.opponent,
      { self: [entry.card] }).self || []);
  }
  observe?.();
  // Immediate observers finish before any ordinary trigger is collected.
  const immediateEventCard = payload.card || payload.changedCard || payload.eventCard;
  const immediateOwner = findCardOwner(state, immediateEventCard) || payload.player || null;
  const immediatePayload = { ...payload, player: immediateOwner };
  const immediateSources = sourceEntries.filter(entry =>
    entry.zone === "field" || entry.zone === "spellTrap" || entry.zone === "fieldSpell");
  // Match the runtime's changed-owner -> opponent, field -> spell/trap ->
  // field-spell order. Ordinary trigger collection retains its existing order.
  immediateSources.sort((left, right) => {
    const ownerOrder = Number(right.player === immediateOwner) - Number(left.player === immediateOwner);
    if (ownerOrder) return ownerOrder;
    const leftZone = left.zone === "field" ? 0 : left.zone === "spellTrap" ? 1 : 2;
    const rightZone = right.zone === "field" ? 0 : right.zone === "spellTrap" ? 1 : 2;
    return leftZone - rightZone;
  });
  for (const sourceEntry of immediateSources) {
    if (!["field", "spellTrap", "fieldSpell"].includes(sourceEntry.zone) ||
        sourceEntry.card.isFacedown || sourceEntry.card.effectsNegated) continue;
    const selfId = resolvePerspectiveSlotForPlayer(state, sourceEntry.player);
    if (selfId === null) continue;
    for (const effect of sourceEntry.card.effects || []) {
      if (effect.timing !== "passive" || !("passive" in effect) || effect.passive?.type !== "event_actions" ||
          effect.event !== eventName || getImmediateEventEffectValidationError(effect)) continue;
      // Immediate card predicates use the same canonical reader as runtime.
      // The ordinary trigger projection below handles the remaining event gates.
      const { eventCardFilters, positionChangeSourceFilters, ...eventGates } = effect;
      const filterContext = { turnCounter: state.turnCounter,
        getCounter: (card: SimulatedCardState, type: string) => getCounterValue(card, type) };
      if (eventCardFilters && !matchesCardFilter(immediateEventCard, eventCardFilters, filterContext)) continue;
      if (positionChangeSourceFilters && !matchesCardFilter(
        getPositionChangeProvenance(immediatePayload).positionChangeSourceCard,
        positionChangeSourceFilters, filterContext)) continue;
      const matchingEffect: EffectDefinition = { ...eventGates, timing: "on_event", triggerRequirement: "mandatory", triggerTiming: "if" };
      if (!matchesSimulatedEventEffect(state, eventName, immediatePayload, sourceEntry, matchingEffect, options)) continue;
      const eventCard = payload.card || payload.eventCard || payload.changedCard || null;
      const actionContext = buildSimEventActionContext(eventName, immediatePayload, {
        player: sourceEntry.player, opponent: sourceEntry.opponent,
      });
      const immediateOptions = attachSimulatedEventEmitter(state, { ...options, selfId,
        sourceCard: sourceEntry.card, effect, actionContext, _simEventDepth: depth + 1 });
      applySimulatedActions({ actions: effect.actions || [], state, selfId,
        selections: { self: [sourceEntry.card], eventCard: eventCard ? [eventCard] : [], changedCard: eventCard ? [eventCard] : [] },
        options: immediateOptions });
    }
  }
  const pendingTriggers = queue || [];
  for (const physicalSourceEntry of sourceEntries) {
    const sourceCard = physicalSourceEntry.card;
    for (const rawEffect of sourceCard?.effects || []) {
      if (rawEffect.timing !== "on_event" || rawEffect.event !== eventName) continue;
      if (sourceEffects && !sourceEffects.includes(rawEffect)) continue;
      const eventOwner = eventName === "card_moved" || eventName === "card_to_grave"
        ? resolveSimulatedMovementEventOwner(state, rawEffect, payload) : null;
      const actor = sourceCard === (payload.card || payload.eventCard) && eventOwner
        ? eventOwner : physicalSourceEntry.player;
      const sourceEntry = { ...physicalSourceEntry, player: actor, opponent: getOtherSimPlayer(state, actor) };
      // Usage persists by physical ID; conditions/actions execute in a slot.
      const selfId = resolvePerspectiveSlotForPlayer(state, actor);
      if (selfId === null) continue;
      const ownerPolicy = resolvePlanningOwnerPolicy(state, sourceEntry.player);
      const ownerOptions: SimulatedEventDispatchOptions = ownerPolicy === undefined
        ? { ...options, selfId }
        : {
          ...(ownerPolicy || {}),
          selfId,
          enableSimulatedEvents: true,
          _simEventDepth: depth,
          ...(options.maxSimulatedEventDepth === undefined ? {} : { maxSimulatedEventDepth: options.maxSimulatedEventDepth }),
        };
      const effect = simEffectForEventCard(rawEffect, payload);
      const recordsNegatedBattleActivation = payload.recordNegatedBattleActivation === true &&
        (eventName === "battle_destroy" || eventName === "attack_declared" || eventName === "battle_damage") && sourceEffects?.includes(rawEffect) === true;
      const deferActivationChecks = !!queue && payload.deferActivationChecks === true;
      const capturedConditions = deferActivationChecks ? captureProcedureTriggerConditions(effect?.conditions || [],
        condition => ({ ok: effectConditionsPass(state, { ...rawEffect, conditions: [condition] }, sourceCard, {
          ...ownerOptions, actionContext: { ...buildSimEventActionContext(eventName, payload, ownerOptions.actionContext),
            player: sourceEntry.player, opponent: sourceEntry.opponent, ...(eventOwner ? { eventPlayer: eventOwner } : {}) },
          eventCard: payload.card || payload.eventCard || null,
        }) })) : null;
      const hasContextualReferences = effect?.targets?.some(definition => definition.intent === "reference" && !!definition.targetFromContext);
      const frozenSourceIsCurrent = () => {
        if (eventReferenceSources.get(sourceCard)?.some(isSimulatedReferencePresenceValid)) return true;
        if (queue && !hasContextualReferences) {
          // Runtime's noncontextual collectors may read the source later.
          // A callback-mutated source cannot silently claim that parity.
          (state._simUnsupportedActions ??= []).push("deferred_trigger_source_presence");
        }
        return false;
      };
      if (hasContextualReferences && !frozenSourceIsCurrent()) continue;
      const unsupportedNegatedExit = sourceCard === (payload.card || payload.eventCard) &&
        payload.effectsNegatedAtFieldExit === true && rawEffect.movementTriggerOwnership === "field_exit_controller" &&
        !rawEffect.allowIfEffectsNegatedAtFieldExit;
      if (
        !matchesSimulatedEventEffect(
          state,
          eventName,
          unsupportedNegatedExit ? { ...payload, effectsNegatedAtFieldExit: false } :
            { ...payload, recordNegatedBattleActivation: recordsNegatedBattleActivation },
          sourceEntry,
          effect,
          ownerOptions,
          false,
          capturedConditions ? () => capturedConditions.possible : undefined,
        )
      ) {
        continue;
      }
      if (!canUseSimulatedEffect(state, effect, sourceCard, sourceEntry.player?.id || "bot", true)) {
        continue;
      }
      if (unsupportedNegatedExit) {
        (state._simUnsupportedActions ??= []).push("negated_field_exit_trigger");
        continue;
      }
      if (queue && !frozenSourceIsCurrent()) continue;
      let preparedTrigger: { triggerOptions: BuiltSimulatedSelectionOptions; selections: ReturnType<typeof selectSimulatedTargets> } | null = null;
      const prepareActivation = (): boolean => {
        if (capturedConditions?.check().ok === false) return false;
        if (effect.triggerRequirement === "optional" && ownerOptions.shouldActivateEffect?.({
          sourceCard, effect, player: sourceEntry.player, state,
        }) === false) return false;
        if ((hasContextualReferences || queue) && !frozenSourceIsCurrent()) return false;

        const strategy = ownerOptions.strategy as SimulatedEventStrategyCapabilities | null | undefined;
        const buildActivationContext = ownerPolicy?.buildActivationContextForEffect ||
          strategy?.buildActivationContextForEffect?.bind(strategy);
        const strategyContext =
          typeof buildActivationContext === "function"
            ? buildActivationContext({
                sourceCard,
                effect,
                player: sourceEntry.player,
                game: state,
                activationZone: sourceEntry.zone,
              }) || {}
            : {};
        const actionContext = buildSimEventActionContext(eventName, payload, {
          ...(ownerOptions.actionContext || {}),
          ...(strategyContext.actionContext || {}),
          player: sourceEntry.player,
          opponent: sourceEntry.opponent,
          ...(eventOwner ? { eventPlayer: eventOwner } : {}),
          ...(eventName === "standby_phase" ? { host: sourceCard.equippedTo || null } : {}),
        });
        if (eventOwner) actionContext.eventPlayer = eventOwner;
        const activationContext = {
          ...(strategyContext || {}),
          ...(ownerOptions.activationContext || {}),
          ...(strategyContext.decisions ? { decisions: strategyContext.decisions } : {}),
          actionContext,
        };
        const triggerOptions = attachSimulatedEventEmitter(state, buildSelectionOptions({
          ...ownerOptions,
          sourceCard,
          effect,
          activationContext,
          actionContext,
          _simEventDepth: depth + 1,
        }));
        const frozenReferences = eventReferences.get(sourceCard)?.get(rawEffect) || {};
        triggerOptions.referenceSnapshots = frozenReferences;
        const sourceReferences = effect.requiresSourceAtResolution === true
          ? captureSimulatedReferences(null, undefined, sourceEntry.player, sourceEntry.opponent, { self: [sourceCard] })
          : {};
        const selections = selectSimulatedTargets({
          targets: effect.targets || [],
          effect,
          actions: effectExecutionActions(effect),
          state,
          sourceCard,
          selfId,
          options: triggerOptions,
        });
        if (!hasRequiredSimSelections(effect.targets || [], selections)) {
          return false;
        }
        // Mandatory zone summons must have capacity before reserving trigger
        // usage. Project only selected movement costs; do not pay them here.
        for (const action of effect.actions || []) {
          if (action.type !== "special_summon_from_zone") continue;
          const destination = action.summonToOwner === "opponent" ? sourceEntry.opponent : sourceEntry.player;
          if (!destination) return false;
          const freedCards = new Set<SimulatedCardState>();
          for (const cost of effect.activationCosts || []) {
            if (cost.type !== "move" || cost.to === "field") continue;
            const cards = resolveTargetsForAction({ targetRef: cost.targetRef || "self" }, selections,
              { ...triggerOptions, self: sourceEntry.player, selfId }, sourceEntry.opponent);
            for (const card of cards) if (destination.field.includes(card)) freedCards.add(card);
          }
          if (!hasActionSummonCapacity(sourceEntry.player, action, {
            occupiedMonsterZones: destination.field.length,
            fieldSlotsFreedBeforeSummon: freedCards.size,
          })) return false;
        }
        const bindsSourceStats = effect.actions?.some(action =>
          action.type === "permanent_buff_named" && (action.targetRef || "self") === "self" && !action.applyToAllField);
        triggerOptions.referenceSnapshots = {
          ...captureSimulatedReferences(effect, selections, sourceEntry.player, sourceEntry.opponent,
            bindsSourceStats ? { self: [sourceCard] } : {}),
          ...sourceReferences,
          ...frozenReferences,
        };
        preparedTrigger = { triggerOptions, selections };
        registerResolutionCompletion(state, pendingTriggers, ownerOptions.onSimulatedResolutionComplete);
        return true;
      };
      if (!deferActivationChecks && !prepareActivation()) continue;
      if (!queue) markSimulatedEffectUsed(state, effect, sourceCard, sourceEntry.player?.id || "bot", true);
      const prepare = () => {
        if (!frozenSourceIsCurrent() ||
          !canUseSimulatedEffect(state, effect, sourceCard, sourceEntry.player.id, true)) return false;
        if (deferActivationChecks && !prepareActivation()) return false;
        if (!preparedTrigger || !areRequiredContextualReferencesValid(preparedTrigger.triggerOptions, sourceEntry.player,
            sourceEntry.opponent || state[selfId === "player" ? "bot" : "player"])) return false;
        markSimulatedEffectUsed(state, effect, sourceCard, sourceEntry.player.id, true);
        return true;
      };
      const resolve = () => {
        if (!preparedTrigger) return;
        const { triggerOptions, selections } = preparedTrigger;
        if (sourceEntry.equipHostExitBinding) {
          const physical = findCardOwner(state, sourceCard);
          if (!matchesEquipHostExitSourcePresence(sourceCard, effect, sourceEntry.equipHostExitBinding,
            physical?.id || null, physical ? findCardZone(physical, sourceCard) : null)) return;
          if (sourceEntry.equipHostExitBinding.equipEffectsNegatedAtHostExit) {
            ownerOptions.onEffectActivated?.({ state, action: null, player: sourceEntry.player, card: sourceCard,
              effect, zone: sourceEntry.zone, options: triggerOptions });
            return;
          }
        }
        if (!isSimulatedSourcePresenceValid(triggerOptions, sourceEntry.player)) return;
        const resolvedNegatedBattleActivation = recordsNegatedBattleActivation && sourceCard.effectsNegated === true &&
          ["field", "fieldSpell", "spellTrap"].includes(sourceEntry.zone);
        const success = applySimulatedEffectResolution({
          effect, primaryActions: resolvedNegatedBattleActivation ? effect.activationCommitActions || [] : effectExecutionActions(effect),
          effectActionsAllowed: !resolvedNegatedBattleActivation, selections, state, selfId, options: triggerOptions,
        });
        if (!success) return;
        if (resolvedNegatedBattleActivation && sourceCard.cardKind === "monster") {
          state.materialDuelStats ||= createMaterialDuelStats();
          recordMaterialEffectActivationInStats(state.materialDuelStats, sourceEntry.player.id, sourceCard, effect.id);
        }
        ownerOptions.onEffectActivated?.({
          state, action: null, player: sourceEntry.player, card: sourceCard,
          effect, zone: sourceEntry.zone, options: triggerOptions,
        });
      };
      pendingTriggers.push({ ownerId: sourceEntry.player.id, optional: effect.triggerRequirement === "optional",
        ...(queue ? { prepare, getPendingPlan: () => {
          const decisions = preparedTrigger?.triggerOptions.activationContext?.decisions;
          return decisions ? { ownerId: sourceEntry.player.id, sourceInstanceId: sourceCard.instanceId ?? null,
            effect, decisions } : null;
        } } : {}), resolve });
    }
  }

  // Runtime temporary triggers are instance-bound records rather than card
  // definitions. Mirror that distinction here so planning observes the same
  // one-shot leave-field follow-ups as the duel engine.
  for (const entry of sourceCards ? [] : getMatchingSimulatedTemporaryEventEffects(
    state,
    eventName,
    payload,
  )) {
    const selfId = resolvePerspectiveSlotForPlayer(state, entry.ownerId);
    if (selfId === null) continue;
    const owner = state[selfId];
    const sourceCard = findSimulatedCardByInstanceId(
      state,
      entry.sourceInstanceId,
    );
    const effect = entry.effect || null;
    if (!owner || !sourceCard || !effect) continue;
    const ownerPolicy = resolvePlanningOwnerPolicy(state, owner);
    const ownerOptions: SimulatedEventDispatchOptions = ownerPolicy === undefined
      ? { ...options, selfId }
      : {
        ...(ownerPolicy || {}),
        selfId,
        enableSimulatedEvents: true,
        _simEventDepth: depth,
        ...(options.maxSimulatedEventDepth === undefined ? {} : { maxSimulatedEventDepth: options.maxSimulatedEventDepth }),
      };

    const sourceZone = findCardZone(owner, sourceCard) || "temporary";
    const sourceEntry: SimulatedEventSourceView = {
      card: sourceCard,
      player: owner,
      zone: sourceZone,
    };
    if (
      !matchesSimulatedEventEffect(
        state,
        eventName,
        payload,
        sourceEntry,
        effect,
        ownerOptions,
        true,
      )
    ) {
      continue;
    }

    const consumeOnMatch =
      entry.requireBoundTargetDestroyed === true ||
      (entry.duration === "until_consumed" &&
        entry.boundEventTargetInstanceId != null);
    if (consumeOnMatch && Number.isFinite(entry.usesRemaining)) {
      entry.usesRemaining = 0;
    }

    const strategy = ownerOptions.strategy as SimulatedEventStrategyCapabilities | null | undefined;
    const buildActivationContext = ownerPolicy?.buildActivationContextForEffect ||
      strategy?.buildActivationContextForEffect?.bind(strategy);
    const strategyContext = ownerPolicy === undefined ? {} : buildActivationContext?.({
      sourceCard, effect, player: owner, game: state, activationZone: sourceZone,
    }) || {};
    const actionContext = buildSimEventActionContext(eventName, payload, {
      ...(ownerOptions.actionContext || {}),
      ...(strategyContext.actionContext || {}),
      player: owner,
      opponent: getOtherSimPlayer(state, owner),
    });
    const triggerOptions = attachSimulatedEventEmitter(state, buildSelectionOptions({
      ...ownerOptions,
      sourceCard,
      effect,
      actionContext,
      activationContext: { ...strategyContext, ...(ownerOptions.activationContext || {}),
        ...(strategyContext.decisions ? { decisions: strategyContext.decisions } : {}), actionContext },
      _simEventDepth: depth + 1,
    }));
    const sourceReferences = effect.requiresSourceAtResolution === true
      ? captureSimulatedReferences(null, undefined, owner, getOtherSimPlayer(state, owner), { self: [sourceCard] })
      : {};
    const selections = selectSimulatedTargets({
      targets: effect.targets || [],
      effect,
      actions: effectExecutionActions(effect),
      state,
      sourceCard,
      selfId,
      options: triggerOptions,
    });
    if (!hasRequiredSimSelections(effect.targets || [], selections)) continue;
    if (effect.requiresSourceAtResolution === true) triggerOptions.referenceSnapshots = sourceReferences;

    if (!consumeOnMatch && Number.isFinite(entry.usesRemaining)) entry.usesRemaining! -= 1;
    const resolve = () => {
      if (!isSimulatedSourcePresenceValid(triggerOptions, owner)) return;
      const success = applySimulatedEffectResolution({
        effect, primaryActions: effectExecutionActions(effect), selections, state, selfId, options: triggerOptions,
      });
      if (!success) return;
      ownerOptions.onEffectActivated?.({
        state, action: null, player: owner, card: sourceCard,
        effect, zone: sourceZone, options: triggerOptions,
      });
    };
    registerResolutionCompletion(state, pendingTriggers, ownerOptions.onSimulatedResolutionComplete);
    pendingTriggers.push({ ownerId: owner.id, optional: effect.triggerRequirement === "optional", resolve });
  }
  if (!queue) withResolutionCompletions(state, pendingTriggers, () => {
    for (const trigger of pendingTriggers) trigger.resolve();
  });
  cleanupSimulatedTemporaryEventEffects(state);
}

/** Resolves the modeled End Phase without advancing the planner's horizon. */
export function resolveSimulatedEndPhase(
  state: SimulatedRuntimeState,
  options: SimulatedSelectionOptionsInput = {},
): void {
  const events = attachSimulatedEventEmitter(state, { ...options, enableSimulatedEvents: true });
  state.phase = "end";
  const player = [state.player, state.bot].find(candidate => candidate.id === state.turn);
  dispatchSimulatedEvent(state, "end_phase", { player: player || null }, events);
  resolveSimulatedTemporaryControlEffects(state, events);
  if (state.turn) processSimulatedDelayedActions(state, "end", state.turn, events);
  cleanupSimulatedEndTurn(state);
}

/** Battle facts enter the same declarative trigger/usage/action dispatcher. */
export function emitSimulatedAttackDeclaration(
  state: SimulatedRuntimeState,
  payload: SimulatedEventPayloadView & { attacker: SimulatedCardState },
  options: SimulatedSelectionOptionsInput = {},
  sourceCards?: readonly SimulatedCardState[],
  sourceEffects?: readonly EffectDefinition[],
): void {
  const events = attachSimulatedEventEmitter(state, { ...options, enableSimulatedEvents: true });
  dispatchSimulatedEvent(state, "attack_declared", {
    ...payload, player: payload.attackerOwner || findCardOwner(state, payload.attacker),
  }, events, undefined, undefined, sourceCards, sourceEffects);
}

/** Battle facts enter the same declarative trigger/usage/action dispatcher. */
export function emitSimulatedBattleDamage(
  state: SimulatedRuntimeState,
  payload: SimulatedEventPayloadView & { attacker: SimulatedCardState; defender: SimulatedCardState;
    attackerOwner: SimulatedPlayerState; defenderOwner: SimulatedPlayerState },
  options: SimulatedSelectionOptionsInput = {},
  sourceCards?: readonly SimulatedCardState[],
  sourceEffects?: readonly EffectDefinition[],
): void {
  const events = attachSimulatedEventEmitter(state, { ...options, enableSimulatedEvents: true });
  dispatchSimulatedEvent(state, "battle_damage", { ...payload, player: payload.attackerOwner,
    isDamageStep: true, damageStepTiming: payload.damageStepTiming || "before_damage_calculation" },
    events, undefined, undefined, sourceCards, sourceEffects);
}

/** Battle facts enter the same declarative trigger/usage/action dispatcher. */
export function emitSimulatedBattleDestroy(
  state: SimulatedRuntimeState,
  payload: SimulatedEventPayloadView & { attacker: SimulatedCardState; destroyed: SimulatedCardState },
  options: SimulatedSelectionOptionsInput = {},
  sourceCards?: readonly SimulatedCardState[],
  sourceEffects?: readonly EffectDefinition[],
): void {
  const events = attachSimulatedEventEmitter(state, { ...options, enableSimulatedEvents: true });
  dispatchSimulatedEvent(state, "battle_destroy", {
    ...payload, card: payload.destroyed, player: payload.destroyedOwner || findCardOwner(state, payload.destroyed),
  }, events, undefined, undefined, sourceCards, sourceEffects);
}

/** Transitional capability: pure field-Spell draw triggers only. Other battle
 * actions and temporary rewards remain owned by their existing hooks. */
export function applySimulatedFieldSpellBattleDrawRewards(
  state: SimulatedRuntimeState,
  battlePlan: { attackerIndex: number; attackerCard?: SimulatedCardState; destroyedCards?: readonly {
    owner: string; destroyedBy: string; card?: SimulatedCardState; position?: string | null;
  }[] },
): string[] {
  const source = state.bot.fieldSpell;
  const attacker = battlePlan.attackerCard || state.bot.field[battlePlan.attackerIndex];
  if (!source || !attacker) return [];
  const effects = source.effects?.filter(effect => effect.timing === "on_event" && effect.event === "battle_destroy" &&
    !effect.targets?.length && !effect.activationCosts?.length && !effect.activationCommitActions?.length &&
    !effect.afterResolutionActions?.length && !!effect.actions?.length && effect.actions.every(action => action.type === "draw")) || [];
  if (!effects.length) return [];
  const handCount = state.bot.hand.length;
  for (const entry of battlePlan.destroyedCards || []) {
    if (entry.destroyedBy !== "battle" || !entry.card) continue;
    emitSimulatedBattleDestroy(state, { attacker, destroyed: entry.card,
      destroyedOwner: entry.owner === "opponent" ? state.player : state.bot,
      destroyedPosition: entry.position || null }, {}, [source], effects);
  }
  return state.bot.hand.length > handCount ? ["drawn card"] : [];
}

/** Scoped callers can migrate one event family without activating other strategies' hooks. */
export function emitSimulatedCardEquipped(
  state: SimulatedRuntimeState, target: SimulatedCardState, equipCard: SimulatedCardState,
  options: SimulatedSelectionOptionsInput = {},
): void {
  const events = attachSimulatedEventEmitter(state, { ...options, enableSimulatedEvents: true });
  dispatchSimulatedEvent(state, "card_equipped", { card: target, target, equipCard,
    player: findCardOwner(state, target) }, events, undefined, undefined, [target, equipCard]);
}

export function emitSimulatedEffectActivated(
  state: SimulatedRuntimeState, card: SimulatedCardState, effect: EffectDefinition,
  activationZone: string, options: SimulatedSelectionOptionsInput, sourceCards: readonly SimulatedCardState[],
): void {
  const events = attachSimulatedEventEmitter(state, { ...options, enableSimulatedEvents: true });
  dispatchSimulatedEvent(state, "effect_activated", { card, effect, activationZone, placementOnly: false,
    player: findCardOwner(state, card) || [state.bot, state.player].find(owner => owner.id === (card.controller || card.owner)) || null },
    events, undefined, undefined, sourceCards);
}

interface SimulatedEffectActionView {
  effectId?: string | null | undefined;
  effect?: EffectDefinition | null | undefined;
}

type SimulatedActionOverrideAction = AIAction;

type BivariantCallback<
  Arguments extends readonly unknown[],
  Result,
> = {
  invoke(...args: Arguments): Result;
}["invoke"];

type SimulatedActionOverride = BivariantCallback<[input: never], unknown>;

type SimulatedActionOverrides = Partial<{
  [Type in SimulatedActionOverrideAction["type"]]: SimulatedActionOverride;
}>;

interface SimulatedActionOverrideOptions extends SimulatedEventDispatchOptions {
  actionOverrides?: SimulatedActionOverrides | null;
  guardLabel?: string;
  getTributeRequirementFor?: BivariantCallback<
    [card: SimulatedCardState, player: SimulatedPlayerState],
    SimulatedTributeRequirementView | null | undefined
  >;
  selectBestTributes?: BivariantCallback<
    [
      field: SimulatedCardState[],
      tributesNeeded: number,
      card: SimulatedCardState,
      context: SimulatedTributeSelectionContext,
    ],
    readonly number[] | null | undefined
  >;
  evaluateTributeTrade?: BivariantCallback<
    [card: SimulatedCardState, field: SimulatedCardState[], tributesNeeded: number, context: SimulatedTributeSelectionContext],
    { ok: boolean } | null | undefined
  >;
  onAfterSummon?: BivariantCallback<[payload: object], unknown>;
  onMonsterEffect?: BivariantCallback<[payload: object], unknown>;
  placeSpellCard?: BivariantCallback<
    [state: SimulatedMainPhaseState, card: SimulatedCardState, options?: SimulatedActionOptions],
    { placed?: unknown } | null | undefined
  >;
  getFieldEffectTargetPreference?: BivariantCallback<
    [payload: object],
    unknown
  >;
}

interface SimulatedTributeRequirementView {
  tributesNeeded?: number;
}

type SimulatedMainPhaseState = PerspectiveGameState | SimulationGameState;

interface SimulatedTributeSelectionContext {
  botState: SimulatedPlayerState;
  oppField: SimulatedCardState[];
  game: SimulatedMainPhaseState;
}

interface SimulatedActionOverrideInput {
  state: SimulatedRuntimeState;
  action: SimulatedActionOverrideAction;
  options: SimulatedActionOverrideOptions;
  resolveSimulatedHandIndex: typeof resolveSimulatedHandIndex;
  resolveSimulatedFieldIndex: typeof resolveSimulatedFieldIndex;
}

function resolveEffectForAction(
  card: SimulatedCardState | null | undefined,
  action: SimulatedEffectActionView | null | undefined,
  allowedTimings: readonly (EffectTiming | undefined)[] = [],
): EffectDefinition | undefined {
  const effects = Array.isArray(card?.effects) ? card.effects : [];
  const effectId = action?.effectId || action?.effect?.id || null;
  if (effectId) {
    const exact = effects.find((entry) => entry?.id === effectId);
    if (exact) return exact;
  }
  return effects.find(
    (entry) =>
      entry &&
      (allowedTimings.length === 0 || allowedTimings.includes(entry.timing)),
  );
}

/** Choices are validated while the source is still in its activation zone. */
export interface PreparedSimulatedSpellEffect {
  effect: EffectDefinition;
  selections: ReturnType<typeof selectSimulatedTargets>;
  selfId: string;
  options: BuiltSimulatedSelectionOptions;
  consumed: boolean;
  /** Flush collected counter-removal triggers after the parent's finalization. */
  finishResolution?: () => void;
}

/** Select a payable activation mode once, retaining its parent's usage identity. */
export function prepareSimulatedEffectActivation(
  state: SimulatedRuntimeState,
  card: SimulatedCardState,
  parentEffect: EffectDefinition,
  options: SimulatedActionOptions = {},
): { effect: EffectDefinition; selections: ReturnType<typeof selectSimulatedTargets> } | null {
  const selfId = options.selfId || "bot";
  const player = selfId === "player" ? state.player : state.bot;
  if (!canUseSimulatedEffect(state, parentEffect, card, selfId)) return null;
  const prepare = (effect: EffectDefinition) => {
    if (!effectConditionsPass(state, effect, card, options)) return null;
    // Runtime activation preview refuses this mandatory action before usage
    // commits. Resolution still checks successful movements independently.
    const opponent = selfId === "player" ? state.bot : state.player;
    if ((effect.actions || []).some(action => action.type === "banish_all_graveyard_and_burn" &&
      getGraveyardBanishBurnEntries(action, player, opponent).length === 0)) return null;
    const selections = selectSimulatedTargets({ targets: effect.targets || [], effect,
      actions: effectExecutionActions(effect), state, sourceCard: card, selfId, options });
    if (!hasRequiredSimSelections(effect.targets || [], selections)) return null;
    if (!canPaySimulatedActivationCosts(effect, selections, card, player, state, options)) return null;
    if ((parentEffect.activationCases?.length || effect.activationCosts?.length) &&
        !(effect.actions || []).every(action => hasActionZoneCandidates(player, action, card, options.activationContext))) return null;
    return { effect, selections };
  };
  if (!parentEffect.activationCases?.length) return prepare(parentEffect);
  const exactId = options.activationContext?.decisions?.cases?.[parentEffect.id];
  const legal = parentEffect.activationCases.flatMap(activationCase => {
    if (exactId !== undefined && activationCase.id !== exactId) return [];
    const prepared = prepare(projectEffectActivationCase(parentEffect, activationCase));
    return prepared ? [{ activationCase, prepared }] : [];
  });
  const chooser = options.chooseActionCase || options.strategy?.chooseActionCase?.bind(options.strategy);
  const chosen = exactId === undefined && chooser
    ? chooser(legal.map(entry => entry.activationCase), { state, source: card, effect: parentEffect, activationContext: options.activationContext })
    : null;
  const chosenId = typeof chosen === "string" ? chosen : chosen && typeof chosen === "object" ? Reflect.get(chosen, "id") : null;
  return (legal.find(entry => entry.activationCase.id === chosenId) || legal[0])?.prepared || null;
}

export function prepareSimulatedSpellEffect<State extends SimulatedMainPhaseState>(
  state: State,
  card: SimulatedCardState | null | undefined,
  options: SimulatedEventDispatchOptions = {},
): PreparedSimulatedSpellEffect | null {
  const parentEffect = card?.effects?.find(entry => entry.timing === "on_play");
  if (!card || !parentEffect) return null;
  const selfId = options.selfId || "bot";
  const selectionOptions = buildSelectionOptions(options);
  const prepared = prepareSimulatedEffectActivation(state, card, parentEffect, { ...selectionOptions, selfId });
  if (!prepared) return null;
  const { effect, selections } = prepared;
  return { effect, selections, selfId, options: selectionOptions, consumed: false };
}

/** Committed activation history; previews and cost queries never call this. */
export function recordSimulatedMaterialEffectIdentity(
  state: SimulatedRuntimeState, card: SimulatedCardState | null | undefined,
  effect: EffectDefinition, selfId = "bot",
): void {
  if (card?.cardKind !== "monster") return;
  state.materialDuelStats ||= createMaterialDuelStats();
  const owner = selfId === "player" ? state.player : state.bot;
  recordMaterialEffectIdentity(state.materialDuelStats, owner.id, card, effect.id);
}

/** Both phases share committed selections and primary action result references. */
export function applySimulatedEffectResolution(input: Omit<import("./simulatedActions/shared.js").SimulatedActionBatchInput, "actions"> & {
  effect: EffectDefinition;
  effectActionsAllowed?: boolean;
  primaryActions?: readonly CardAction[];
}): boolean {
  const { effect, effectActionsAllowed = true, primaryActions, ...batch } = input;
  const sharedBatch = { ...batch, options: { ...batch.options, actionResults: batch.options?.actionResults || {} } };
  recordSimulatedMaterialEffectIdentity(batch.state, batch.options?.sourceCard, effect, batch.selfId);
  const resolved = applySimulatedActions({ ...sharedBatch,
    actions: primaryActions || [...(effect.activationCommitActions || []), ...(effectActionsAllowed ? effect.actions || [] : [])] });
  const complete = resolved && (!effectActionsAllowed || !effect.afterResolutionActions?.length ||
    applySimulatedActions({ ...sharedBatch, actions: effect.afterResolutionActions }));
  if (complete && effectActionsAllowed && batch.options?.sourceCard?.cardKind === "monster") {
    batch.state.materialDuelStats ||= createMaterialDuelStats();
    const owner = batch.selfId === "player" ? batch.state.player : batch.state.bot;
    recordMaterialEffectActivationInStats(batch.state.materialDuelStats, owner.id, batch.options.sourceCard, effect.id);
  }
  return complete;
}

export function simulateGenericSpellEffect<State extends SimulatedMainPhaseState>(
  state: State,
  card: SimulatedCardState | null | undefined,
  options: SimulatedEventDispatchOptions = {},
  preparedInput?: PreparedSimulatedSpellEffect | null,
): void {
  const prepared = preparedInput === undefined ? prepareSimulatedSpellEffect(state, card, options) : preparedInput;
  if (!card || !prepared || prepared.consumed) return;
  prepared.consumed = true;
  const { effect, selections, selfId } = prepared;
  const selectionOptions = attachSimulatedEventEmitter(state, prepared.options);
  const player = selfId === "player" ? state.player : state.bot;
  const opponent = selfId === "player" ? state.bot : state.player;
  const frame = createDeferredSimulatedEventFrame(state, selectionOptions);
  prepared.finishResolution = frame.finishResolution;
  const resolutionOptions: SimulatedActionOptions = {
    ...frame.options, sourceCard: card, effect,
    referenceSnapshots: captureSimulatedReferences(effect, selections, player, opponent),
    actionContext: selectionOptions.actionContext || {},
    costPayment: { status: "paid", actions: [], summonMarkers: [] },
    payingActivationCosts: true,
  };
  const usageSourceAtActivation = { ...card };
  if (!applySimulatedActions({ actions: effect.activationCosts || [], selections, state,
    selfId, options: resolutionOptions })) {
    if (preparedInput === undefined) prepared.finishResolution();
    return;
  }
  emitSimulatedSpellActivation(state, card, selfId, selectionOptions);
  resolutionOptions.payingActivationCosts = false;
  applySimulatedEffectResolution({
    effect,
    selections, state, selfId, options: resolutionOptions,
  });
  markSimulatedEffectUsed(state, effect, usageSourceAtActivation, selfId);
  if (preparedInput === undefined) prepared.finishResolution();
}

/** A card activation is distinct from an ignition effect of a face-up Spell. */
export function emitSimulatedSpellActivation(
  state: SimulatedRuntimeState,
  card: SimulatedCardState,
  selfId = "bot",
  options: SimulatedEventDispatchOptions = {},
): void {
  if (card.cardKind !== "spell") return;
  const player = selfId === "player" ? state.player : state.bot;
  recordTurnCardActivation(state, { card, player });
  refreshSimulatedFieldAuras(state);
  dispatchSimulatedEvent(state, "spell_activated", { card, player }, { ...options, enableSimulatedEvents: true });
}

function resolvesToGraveyardAfterActivation(
  card: SimulatedCardState | null | undefined,
): boolean {
  if (!card) return false;
  if (card.cardKind === "trap") return card.subtype === "normal";
  if (card.cardKind !== "spell") return false;
  return (
    card.subtype === "normal" ||
    card.subtype === "quick" ||
    card.subtype === "quick-play" ||
    card.subtype === "quickplay"
  );
}

function setSimulatedSpellTrapAfterResolution(
  player: SimulatedPlayerState | null | undefined,
  card: SimulatedCardState | null | undefined,
  state: SimulatedRuntimeState,
): boolean {
  if (!player || !card) return false;
  player.spellTrap = player.spellTrap || [];
  if (player.spellTrap.length >= 5 && !player.spellTrap.includes(card)) {
    return false;
  }
  card.isFacedown = true;
  expireEffectNegation(card, "while_faceup");
  restoreFaceupStatuses(card);
  expireFaceupDeclaredValues(card);
  expireLevelModifications(card, "while_faceup");
  card.fieldPresenceSummons = [];
  if (typeof state.turnCounter === "number") {
    card.turnSetOn = state.turnCounter;
    card.setTurn = state.turnCounter;
  }
  delete card.__simSetAfterResolution;
  if (!player.spellTrap.includes(card)) {
    appendSimulatedFieldCard(player.spellTrap, card);
  }
  return true;
}

function runActionOverride(
  state: SimulatedRuntimeState,
  action: SimulatedActionOverrideAction,
  options: SimulatedActionOverrideOptions,
): boolean {
  const override = options.actionOverrides?.[action.type];
  if (typeof override !== "function") return false;
  const result = (override as BivariantCallback<
    [input: SimulatedActionOverrideInput],
    unknown
  >)({
    state,
    action,
    options,
    resolveSimulatedHandIndex,
    resolveSimulatedFieldIndex,
  });
  return (
    result === true ||
    (result as { handled?: boolean } | null | undefined)?.handled === true
  );
}

/** Search must exclude actions whose state transitions are not implemented yet. */
export function isSimulatedMainPhaseActionSupported(action: Pick<AIPlannedAction, "type">): boolean {
  return Boolean(action.type);
}

export function applyGenericSimulatedMainPhaseAction<
  State extends SimulatedMainPhaseState,
>(
  state: State,
  action: SimulatedActionOverrideAction | null | undefined,
  options: SimulatedActionOverrideOptions = {},
): State {
  if (!action) return state;
  if (!isPlanningActionPresenceCurrent(action, state.bot)) return state;
  cleanupExpiredSimulatedTurnEffects(state);

  if (!state._isPerspectiveState && state.player && state.bot) {
    console.error(
      `[${options.guardLabel || "Simulation"}] CRITICAL: Simulating on REAL game state!`,
      {
        action: action.type,
        card: action.cardName || state.bot?.hand?.[action.index!]?.name,
      },
    );
  }

  // Authoritative physical references are checked before strategy overrides.
  // This prevents an adapter from substituting an absent/expired copy.
  const handTypes = ["summon", "spell", "set_spell_trap", "handIgnition", "handSummonProcedure", "special_summon_sanctum_protector"];
  if (handTypes.includes(action.type)) {
    const bound = resolvePlanningCard(state.bot.hand, action.card, state.bot.id, "hand", action);
    if (bound.explicit && !bound.card) return state;
  }
  if (action.type === "ascension") {
    const source = resolvePlanningCard(state.bot.extraDeck, action.ascensionCard, state.bot.id, "extraDeck", action);
    const material = resolvePlanningCard(state.bot.field, action.material, state.bot.id, "field", action, 0);
    if ((source.explicit && !source.card) || (material.explicit && !material.card)) return state;
  }
  if (runActionOverride(state, action, options)) {
    return state;
  }

  const selectionOptions = buildSelectionOptions({
    ...(options as SimulatedSelectionOptionsInput),
    activationContext: action.activationContext || options.activationContext,
    sourceAction: action,
  });
  attachSimulatedEventEmitter(state, selectionOptions);

  switch (action.type) {
    case "synchro": {
      if (state.phase !== "main1" && state.phase !== "main2") break;
      simulateSynchroSummon(state, state.bot, action, selectionOptions, applySimulatedActions);
      break;
    }
    case "handSummonProcedure": {
      const player = state.bot;
      const handIndex = resolveSimulatedHandIndex(player, action, "monster");
      const card = player.hand[handIndex];
      const procedure = card?.handSummonProcedure;
      if (!card || !procedure || card.cardKind !== "monster") break;
      const cardMatchesFilters = (candidate: AiCardInput, filters: RuntimeCardFilter): boolean =>
        matchesCardFilter(candidate, filters, {
          turnCounter: state.turnCounter,
          getCounter: (entry, type) => entry.counters?.get(type) || 0,
          hasMatchingEquip: (entry, equipFilters, requireFaceup) => (entry.equips || []).some(equip => {
            const owner = [state.player, state.bot].find(candidateOwner => candidateOwner.id === equip.owner);
            return isActiveEquipInZone(equip, entry, owner?.spellTrap || []) &&
              (!requireFaceup || !equip.isFacedown) && cardMatchesFilters(equip, equipFilters);
          }),
        });
      if (!canUseSimulatedEffectUsage(state, procedure, card, player.id, true)) break;
      if (!canSimulatedSpecialSummon(card, player, procedure.id, "hand", cardMatchesFilters)) break;
      if (state.phase !== "main1" && state.phase !== "main2") break;
      if (procedure.conditions && !evaluateSimulatedConditions(procedure.conditions, { state, selfId: "bot", sourceCard: card })) break;
      const cost = procedure.cost;
      const counterCost = procedure.counterCost;
      const counterSources = counterCost ? collectProcedureCounterSources(player, state.player, counterCost, state.turnCounter || 0) : [];
      if (counterCost && (!Number.isInteger(counterCost.amount) || counterCost.amount < 1 ||
          counterSources.reduce((total, source) => total + getCounterValue(source, counterCost.counterType), 0) < counterCost.amount)) break;
      if (cost && (!Number.isInteger(cost.count) || cost.count < 1)) break;
      if (action.materials.length !== (cost?.count || 0)) break;
      const costDestinationPlayer = (material: SimulatedCardState) => player.field.includes(material)
        ? getOriginalOwner(state, material, player) : player;
      const candidates = cost ? [...new Set(cost.zones.flatMap((zone) => player[zone]))]
        .filter(candidate => cardMatchesFilters(candidate, cost.filters) &&
          canMoveCardToZone(costDestinationPlayer(candidate), candidate, cost.destination, player, { state })) : [];
      const materials: SimulatedCardState[] = [];
      for (const [offset, hint] of action.materials.entries()) {
        if (!cost?.zones.includes(hint.zone)) break;
        const zone = player[hint.zone];
        const match = (entry: SimulatedCardState) =>
          entry.id === hint.cardId && entry.instanceId === hint.instanceId;
        const atIndex = zone[hint.index];
        const bound = resolvePlanningCard(zone, { instanceId: hint.instanceId }, player.id, hint.zone, action, offset);
        const material = bound.explicit ? bound.card : atIndex && match(atIndex) ? atIndex : zone.find(match);
        if (!material || !candidates.includes(material) || materials.includes(material)) break;
        materials.push(material);
      }
      if (materials.length !== (cost?.count || 0)) break;
      if (!canSimulatedProcedureEnterField(card, player, state.player, materials, cardMatchesFilters)) break;
      if (procedure.oncePerTurnConsumeOn !== "success") markSimulatedEffectUsage(state, procedure, card, player.id, true);
      const destination = cost?.destination || "graveyard";
      const deferredProcedureEvents: SimulatedEventOccurrence[] = [];
      const resolveDeferredEvents = () => {
        if (selectionOptions.emitSimulatedEvents) selectionOptions.emitSimulatedEvents(deferredProcedureEvents);
        else for (const entry of deferredProcedureEvents) selectionOptions.emitSimulatedEvent?.(entry.event, entry.payload);
      };
      let costComplete = true;
      if (counterCost) {
        let remaining = counterCost.amount;
        const paidSources: SimulatedCardState[] = [];
        while (remaining > 0) for (const source of counterSources) {
          if (remaining === 0) break;
          const available = getCounterValue(source, counterCost.counterType);
          if (available <= 0) continue;
          setCounterValue(source, counterCost.counterType, available - 1);
          if (!paidSources.includes(source)) paidSources.push(source);
          remaining--;
        }
        refreshSimulatedFieldAuras(state);
        const counterEvent: SimulatedEventOccurrence = { event: "counter_removed", observed: true, payload: {
          player, sourceCard: card, source: card, card: paidSources[0] || null, cards: paidSources,
          counterType: counterCost.counterType, amount: counterCost.amount, fromField: true,
          actionContext: selectionOptions.actionContext,
        } };
        selectionOptions.onSimulatedEvent?.(counterEvent.event, counterEvent.payload);
        deferredProcedureEvents.push(counterEvent);
      }
      for (const material of materials) {
        const fromZone = player.field.includes(material) ? "field" : "graveyard";
        const destinationPlayer = costDestinationPlayer(material);
        const wasFaceupBeforeMove = material.isFacedown !== true;
        if (!moveCardToZone(destinationPlayer, material, destination, player, { state })) {
          costComplete = false;
          break;
        }
        setSimulatedController(material, destinationPlayer);
        const costEvent: SimulatedEventOccurrence = { event: "card_moved", observed: true, payload: {
          card: material, player: destinationPlayer, fromPlayer: player, toPlayer: destinationPlayer,
          fromZone, toZone: destination,
          movedByEffect: false, wasFaceupBeforeMove,
          sourceCard: card, actionContext: selectionOptions.actionContext,
        } };
        // Each cost moves now; runtime holds its triggers until the summon ends.
        selectionOptions.onSimulatedEvent?.(costEvent.event, costEvent.payload);
        deferredProcedureEvents.push(costEvent);
      }
      if (!costComplete || !player.hand.includes(card)) {
        resolveDeferredEvents();
        break;
      }
      const summoned = Object.assign(card, {
        position: action.position === "defense" ? "defense" as const : "attack" as const, isFacedown: false,
        hasAttacked: false, attacksUsedThisTurn: 0,
        summonedTurn: state.turnCounter ?? null,
        lastSummonedTurn: state.turnCounter ?? null,
        lastSummonMethod: "special" as const,
        lastSummonedFromZone: "hand" as const,
        lastSummonProcedure: procedure.id,
      });
      establishProperSummon(summoned, { summonProcedure: procedure.id, sourceZone: "hand" });
      if (!appendSimulatedFieldCard(player.field, summoned)) {
        resolveDeferredEvents();
        break;
      }
      player.hand.splice(handIndex, 1);
      recordCompletedSimulatedSummon(state, { card: summoned, player, method: "special" });
      if (procedure.oncePerTurnConsumeOn === "success") markSimulatedEffectUsage(state, procedure, summoned, player.id, true);
      options.onAfterSummon?.({ state, action, player, card, newCard: summoned, options });
      options.onAfterSpecialSummon?.({ state, action, player, card: summoned, fromZone: "hand", options });
      const summonEvent: SimulatedEventOccurrence = { event: "after_summon", observed: true, payload: {
        card: summoned, player, method: "special", fromZone: "hand",
        sourceCard: summoned, actionContext: selectionOptions.actionContext,
      } };
      selectionOptions.onSimulatedEvent?.(summonEvent.event, summonEvent.payload);
      // Costs and the completed summon share runtime's post-procedure SEGOC window.
      deferredProcedureEvents.push(summonEvent);
      resolveDeferredEvents();
      break;
    }
    case "summon": {
      const player = state.bot;
      const handIndex = resolveSimulatedHandIndex(player, action, "monster");
      const card = player.hand[handIndex];
      if (!card) break;
      if (card.cardKind !== "monster") break;
      if (card.cannotBeNormalSummonedOrSet) break;
      if (card.summonRestrict === "shadow_heart_invocation_only") break;
      if (!canUseNormalSummonForCard(player, card)) break;
      const legalTributes = getNormalSummonTributeOptions(player, card);
      if (!legalTributes.length) break;
      const { tributesNeeded } = getNormalTributeRequirement(card, player.field);
      if (!fieldHasTributeValue(player.field || [], tributesNeeded, card)) break;
      if (tributesNeeded > 0 && options.evaluateTributeTrade?.(card, player.field, tributesNeeded,
        { botState: player, oppField: state.player.field, game: state })?.ok === false) break;

      const allowedTributes = new Set(legalTributes.flat());
      const { indices: tributeIndices } = selectPayableTributes(player, player.field, state, candidates => {
        const eligible = candidates.filter(tribute => allowedTributes.has(tribute));
        return (options.selectBestTributes?.(eligible, tributesNeeded, card, {
          botState: player,
          oppField: state.player?.field || [],
          game: state,
        }) || []).flatMap(index => eligible[index] ? [candidates.indexOf(eligible[index]!)] : []);
      });
      const validTributeIndices = [...new Set(tributeIndices)].filter(
        (idx) =>
          Number.isInteger(idx) &&
          idx >= 0 &&
          idx < (player.field || []).length,
      );
      const tributeCards = getTributeCardsFromIndices(
        player.field || [],
        validTributeIndices,
      );
      if (getTributeValueTotal(tributeCards, card) < tributesNeeded) break;
      if (!legalTributes.some(cost => cost.length === tributeCards.length && cost.every(tribute => tributeCards.includes(tribute)))) break;
      if (!tributeCards.every(tribute => canMoveCardToZone(player, tribute, "graveyard", player, { state }))) break;
      if ((player.field || []).length - validTributeIndices.length + 1 > 5) break;

      const deferredTributeEvents: SimulatedEventOccurrence[] = [];
      const tributeOptions: SimulatedActionOptions = { ...selectionOptions,
        emitSimulatedEvent(event, payload) {
          // Observe each cost now; runtime holds its triggers until the summon ends.
          selectionOptions.onSimulatedEvent?.(event, payload);
          deferredTributeEvents.push({ event, payload, observed: true });
        },
      };
      const resolveDeferredEvents = (events: readonly SimulatedEventOccurrence[]) => {
        if (selectionOptions.emitSimulatedEvents) selectionOptions.emitSimulatedEvents(events);
        else for (const entry of events) selectionOptions.emitSimulatedEvent?.(entry.event, entry.payload);
      };
      let tributeCostComplete = true;
      for (const tribute of tributeCards) {
        const wasFaceupBeforeMove = tribute.isFacedown !== true;
        const effectsNegatedAtFieldExit = tribute.effectsNegated === true;
        if (!player.field.includes(tribute) ||
            !moveCardToZone(player, tribute, "graveyard", player, { state })) {
          tributeCostComplete = false;
          break;
        }
        emitSimulatedMove(tribute, state, player, player, "field", wasFaceupBeforeMove,
          effectsNegatedAtFieldExit, tributeOptions, "tribute_summon_cost", false);
      }
      if (!tributeCostComplete) {
        resolveDeferredEvents(deferredTributeEvents);
        break;
      }

      player.hand.splice(handIndex, 1);
      const newCard = card;
      const summonPosition = action.position === "defense" ? "defense" : "attack";
      newCard.position = summonPosition;
      newCard.isFacedown = action.facedown === true || summonPosition === "defense";
      newCard.hasAttacked = false;
      newCard.attacksUsedThisTurn = 0;
      newCard.lastSummonMethod = tributesNeeded > 0 ? "tribute" : "normal";
      newCard.lastSummonedFromZone = "hand";
      newCard.lastTributeMaterialNames = tributeCards.flatMap(tribute => tribute.name ? [tribute.name] : []);
      newCard.lastTributeMaterialCount = tributeCards.length;
      let summonEvent: SimulatedEventOccurrence | null = null;
      if (newCard.cardKind !== "monster") {
        console.error(
          `[${options.guardLabel || "Simulation"}] BLOCKED sim: ${newCard.cardKind} "${newCard.name}" tried to enter field!`,
        );
        appendSimulatedZoneCard(player.graveyard, newCard);
      } else {
        appendSimulatedFieldCard(player.field, newCard);
        refreshSimulatedFieldAuras(state);
        if (!newCard.isFacedown) recordCompletedSimulatedSummon(state, { card: newCard, player, method: newCard.lastSummonMethod });
        options.onAfterSummon?.({
          state,
          action,
          player,
          card,
          newCard,
          options,
        });
        summonEvent = { event: "after_summon", observed: true, payload: {
          card: newCard,
          player,
          method: newCard.lastSummonMethod,
          fromZone: "hand",
          sourceCard: newCard,
          actionContext: selectionOptions.actionContext,
        } };
        selectionOptions.onSimulatedEvent?.(summonEvent.event, summonEvent.payload);
      }
      player.summonCount = (player.summonCount || 0) + 1;
      recordNormalSummonForTurn(player, newCard);
      // The normal procedure flushes costs and summon triggers together after
      // completion, so SEGOC orders them in one Chain before resolving LIFO.
      if (summonEvent) deferredTributeEvents.push(summonEvent);
      resolveDeferredEvents(deferredTributeEvents);
      break;
    }

    case "position_change": {
      const player = state.bot;
      const boundIndex = resolvePlanningSourceIndex(player.field, action, player.id, "field", action.card);
      const target = boundIndex !== null ? player.field[boundIndex] : Number.isInteger(action.fieldIndex) ? player.field[action.fieldIndex!] : (player.field || []).find(
        (card) =>
          card &&
          (card.id === action.cardId ||
            (!action.cardId && card.name === action.cardName)),
      );
      if (!target) break;
      if (target.battlePositionLocked) break;
      if (target.positionChangedThisTurn) break;
      if (target.hasAttacked) break;
      const previousPosition = target.position || "attack";
      if (target.isFacedown) {
        target.isFacedown = false;
        target.position = "attack";
        target.positionChangedThisTurn = true;
        recordCompletedSimulatedSummon(state, { card: target, player, method: "flip" });
        break;
      }
      const newPosition =
        action.toPosition === "defense" ? "defense" : "attack";
      if (target.position === newPosition) break;
      target.position = newPosition;
      target.positionChangedThisTurn = true;
      selectionOptions.emitSimulatedEvent?.("position_change", {
        card: target, player, opponent: state.player, fromPosition: previousPosition,
        toPosition: newPosition, wasFlipped: false, wasFaceupBeforeChange: true,
        sourceCard: null, effectId: null, positionChangedByEffect: false,
        actionContext: selectionOptions.actionContext,
      });
      break;
    }

    case "monsterEffect": {
      const player = state.bot;
      const fieldIndex = resolvePlanningSourceIndex(player.field, action, player.id, "field", action.card) ?? (Number.isInteger(action.fieldIndex as number)
        ? action.fieldIndex!
        : player.field.findIndex(
            (card) =>
              card &&
              (card.id === action.cardId ||
                (!action.cardId && card.name === action.cardName)),
          ));
      const card = player.field?.[fieldIndex];
      if (!card || card.cardKind !== "monster" || card.isFacedown) break;
      const parentEffect = resolveEffectForAction(card, action, ["ignition"]);
      const effect = parentEffect ? prepareSimulatedEffectActivation(state, card, parentEffect, selectionOptions)?.effect : null;
      if (!effect || (effect.activationZones && !effect.activationZones.includes("field"))) break;
      if (!effectConditionsPass(state, effect, card, selectionOptions)) {
        break;
      }
      if (
        !canUseSimulatedEffect(
          state,
          effect,
          card,
          options.selfId || "bot",
        )
      ) {
        break;
      }

      const handled = options.onMonsterEffect?.({
        state,
        action,
        player,
        card,
        fieldIndex,
        effect,
        options,
      });
      if (handled) break;

      const selections = selectSimulatedTargets({
        targets: effect.targets || [],
        effect,
        actions: effectExecutionActions(effect),
        state,
        sourceCard: card,
        selfId: options.selfId || "bot",
        options: selectionOptions,
      });
      if (!hasRequiredSimSelections(effect.targets || [], selections)) break;
      if (!canPaySimulatedActivationCosts(effect, selections, card, player, state, selectionOptions)) break;
      if (effect.activationCosts?.length && !effect.actions?.every(
        candidate => hasActionZoneCandidates(player, candidate, card),
      )) break;
      const frame = createDeferredSimulatedEventFrame(state, selectionOptions);
      const resolutionOptions: SimulatedActionOptions = {
        ...frame.options, sourceCard: card, effect,
        referenceSnapshots: captureSimulatedReferences(effect, selections, player, state.player,
          effect.requiresSourceAtResolution === true ? { self: [card] } : {}),
        actionContext: selectionOptions.actionContext || {},
        costPayment: { status: "paid", actions: [], summonMarkers: [] },
        payingActivationCosts: true,
      };
      const usageSourceAtActivation = { ...card };
      try {
      if (!applySimulatedActions({ actions: effect.activationCosts || [], selections, state,
        selfId: options.selfId || "bot", options: resolutionOptions })) break;
      resolutionOptions.payingActivationCosts = false;
      applySimulatedEffectResolution({
        effect, effectActionsAllowed: !card.effectsNegated,
        selections, state, selfId: options.selfId || "bot", options: resolutionOptions,
      });
      markSimulatedEffectUsed(
        state,
        effect,
        usageSourceAtActivation,
        options.selfId || "bot",
      );
      options.onEffectActivated?.({
        state,
        action,
        player,
        card,
        effect,
        zone: "field",
        options,
      });
      } finally { frame.finishResolution(); }
      break;
    }

    case "handIgnition": {
      const player = state.bot;
      const handIndex = resolveSimulatedHandIndex(player, action, "monster");
      const card = player.hand?.[handIndex];
      if (!card || card.cardKind !== "monster") break;
      const parentEffect = resolveEffectForAction(card, action, ["ignition"]);
      const effect = parentEffect ? prepareSimulatedEffectActivation(state, card, parentEffect, selectionOptions)?.effect : null;
      if (!effect || !effect.activationZones?.includes("hand")) break;
      if (!effectConditionsPass(state, effect, card, selectionOptions)) {
        break;
      }
      if (
        !canUseSimulatedEffect(
          state,
          effect,
          card,
          options.selfId || "bot",
        )
      ) {
        break;
      }
      const selections = selectSimulatedTargets({
        targets: effect.targets || [],
        effect,
        actions: effectExecutionActions(effect),
        state,
        sourceCard: card,
        selfId: options.selfId || "bot",
        options: selectionOptions,
      });
      if (!hasRequiredSimSelections(effect.targets || [], selections)) break;
      if (!canPaySimulatedActivationCosts(effect, selections, card, player, state, selectionOptions)) break;
      if (effect.activationCosts?.length && !effect.actions?.every(
        candidate => hasActionZoneCandidates(player, candidate, card),
      )) break;
      const frame = createDeferredSimulatedEventFrame(state, selectionOptions);
      const resolutionOptions: SimulatedActionOptions = {
        ...frame.options, sourceCard: card, effect,
        referenceSnapshots: captureSimulatedReferences(effect, selections, player, state.player,
          effect.requiresSourceAtResolution === true ? { self: [card] } : {}),
        actionContext: selectionOptions.actionContext || {},
        costPayment: { status: "paid", actions: [], summonMarkers: [] },
        payingActivationCosts: true,
      };
      try {
      if (!applySimulatedActions({ actions: effect.activationCosts || [], selections, state,
        selfId: options.selfId || "bot", options: resolutionOptions })) break;
      resolutionOptions.payingActivationCosts = false;
      applySimulatedEffectResolution({
        effect,
        selections, state, selfId: options.selfId || "bot", options: resolutionOptions,
      });
      markSimulatedEffectUsed(
        state,
        effect,
        card,
        options.selfId || "bot",
      );
      options.onEffectActivated?.({
        state,
        action,
        player,
        card,
        effect,
        zone: "hand",
        options,
      });
      } finally { frame.finishResolution(); }
      break;
    }

    case "spell": {
      const player = state.bot;
      const handIndex = resolveSimulatedHandIndex(player, action, "spell");
      const card = player.hand[handIndex];
      if (!card) break;
      if (card.subtype !== "field" && getAvailableFieldSlots(player.spellTrap).length === 0) break;
      const onPlayEffect = resolveEffectForAction(card, action, ["on_play"]);
      if (
        onPlayEffect &&
        (!effectConditionsPass(
          state,
          onPlayEffect,
          card,
          selectionOptions,
        ) ||
          !canUseSimulatedEffect(
            state,
            onPlayEffect,
            card,
            options.selfId || "bot",
          ))
      ) {
        break;
      }
      if (card.subtype === "field" && !onPlayEffect) {
        const placement = options.placeSpellCard?.(state, card, selectionOptions);
        if (placement?.placed) emitSimulatedSpellActivation(state, card, options.selfId || "bot", selectionOptions);
        break;
      }
      const prepared = prepareSimulatedSpellEffect(state, card, selectionOptions);
      if (onPlayEffect && !prepared) break;
      player.hand.splice(handIndex, 1);
      const placedCard = card;
      placedCard.isFacedown = false;
      if (placedCard.subtype !== "field") appendSimulatedFieldCard(player.spellTrap, placedCard);
      if (!onPlayEffect) emitSimulatedSpellActivation(state, placedCard, options.selfId || "bot", selectionOptions);
      try {
        simulateGenericSpellEffect(state, placedCard, selectionOptions, prepared);
        prepared?.finishResolution?.();
        if (placedCard.subtype !== "field" && !player.spellTrap.includes(placedCard)) break;
        if (placedCard.__simSetAfterResolution) {
          if (
            !setSimulatedSpellTrapAfterResolution(
              player,
              placedCard,
              state,
            )
          ) {
            delete placedCard.__simSetAfterResolution;
            moveCardToZone(player, placedCard, "graveyard");
          }
          break;
        }
        if (resolvesToGraveyardAfterActivation(placedCard)) {
          moveCardToZone(player, placedCard, "graveyard");
          break;
        }
        const placement = options.placeSpellCard?.(state, placedCard, selectionOptions) || {
          placed: false,
        };
        if (!placement.placed) {
          moveCardToZone(player, placedCard, "graveyard");
        }
      } finally {
        prepared?.finishResolution?.();
      }
      break;
    }

    case "set_spell_trap": {
      const player = state.bot;
      const handIndex = resolveSimulatedHandIndex(player, action, [
        "spell",
        "trap",
      ]);
      const card = player.hand[handIndex];
      if (!card) break;
      if (card.cardKind === "spell" && card.subtype === "field") break;
      if (getAvailableFieldSlots(player.spellTrap).length === 0) break;
      player.hand.splice(handIndex, 1);
      const setCard = { ...card, isFacedown: true };
      if (typeof state.turnCounter === "number") {
        setCard.turnSetOn = state.turnCounter;
      }
      player.spellTrap = player.spellTrap || [];
      if (player.spellTrap.length < 5) {
        appendSimulatedFieldCard(player.spellTrap, setCard);
      } else {
        appendSimulatedZoneCard(player.graveyard, setCard);
      }
      break;
    }

    case "spellTrapEffect": {
      const player = state.bot;
      const zoneIndex = resolvePlanningSourceIndex(player.spellTrap, action, player.id, "spellTrap", action.card) ??
        (Number.isInteger(action.zoneIndex as number) ? action.zoneIndex : action.index);
      const card = player.spellTrap?.[zoneIndex!];
      if (!card) break;
      const wasSet = card.isFacedown === true;
      if (wasSet && card.cardKind === "trap" && !canActivateTrap.call(state, card)) break;
      card.isFacedown = false;

      const rawEffect = resolveEffectForAction(card, action, wasSet ? ["on_play"] : ["ignition"]);
      const projectedEffect = rawEffect ? projectStoredBlueprintActivation(card, rawEffect) : null;
      const effect = projectedEffect ? prepareSimulatedEffectActivation(state, card, projectedEffect, selectionOptions)?.effect : null;
      if (projectedEffect && !effect) break;
      if (effect) {
        if (
          !effectConditionsPass(state, effect, card, selectionOptions)
        ) {
          break;
        }
        if (
          !canUseSimulatedEffect(
            state,
            effect,
            card,
            options.selfId || "bot",
          )
        ) {
          break;
        }
        const selections = selectSimulatedTargets({
          targets: effect.targets || [],
          effect,
          actions: effectExecutionActions(effect),
          state,
          sourceCard: card,
          selfId: options.selfId || "bot",
          options: selectionOptions,
        });
        if (!hasRequiredSimSelections(effect.targets || [], selections)) break;
        if (!canPaySimulatedActivationCosts(effect, selections, card, player, state, selectionOptions)) break;
        const usageSourceAtActivation = { ...card };
        const sourceAtActivation = captureSimulatedSourceSnapshot(card, player, "spellTrap");
        const resolutionOptions: SimulatedActionOptions = { ...selectionOptions, sourceCard: card, effect,
          activationContext: { ...selectionOptions.activationContext, sourceAtActivation },
          referenceSnapshots: captureSimulatedReferences(effect, selections, player, state.player),
          actionContext: { ...selectionOptions.actionContext, sourceAtActivation },
          costPayment: { status: "paid", actions: [], summonMarkers: [] }, payingActivationCosts: true };
        if (!applySimulatedActions({ actions: effect.activationCosts || [], selections, state,
          selfId: options.selfId || "bot", options: resolutionOptions })) break;
        resolutionOptions.payingActivationCosts = false;
        if (wasSet) emitSimulatedSpellActivation(state, card, options.selfId || "bot", selectionOptions);
        const persistent = card.cardKind === "spell" && ["equip", "continuous", "field"].includes(card.subtype || "");
        const sourcePresent = player.spellTrap.includes(card) && !card.isFacedown && !card.effectsNegated;
        if (!persistent || effect.requiresSourceAtResolution === false || sourcePresent) applySimulatedEffectResolution({
          effect,
          selections, state, selfId: options.selfId || "bot", options: resolutionOptions,
        });
        markSimulatedEffectUsed(
          state,
          effect,
          usageSourceAtActivation,
          options.selfId || "bot",
        );
        options.onEffectActivated?.({
          state,
          action,
          player,
          card,
          effect,
          zone: "spellTrap",
          options,
        });
      } else if (wasSet) {
        emitSimulatedSpellActivation(state, card, options.selfId || "bot", selectionOptions);
      }

      if (resolvesToGraveyardAfterActivation(card)) {
        if (card.__simSetAfterResolution) {
          setSimulatedSpellTrapAfterResolution(player, card, state);
          break;
        }
        if (player.spellTrap.includes(card)) {
          const wasFaceupBeforeMove = !card.isFacedown;
          const effectsNegatedAtFieldExit = card.effectsNegated === true;
          const receipt: { value: import("./zones.js").SimulatedMoveReceipt | null } = { value: null };
          if (moveCardToZone(player, card, "graveyard", player, { state, movedByEffect: false,
            ...(selectionOptions.emitSimulatedEvent ? { emitSimulatedEvent: selectionOptions.emitSimulatedEvent } : {}),
            onMoveCommitted: result => { receipt.value = result; } })) {
            emitSimulatedMove(card, state, player, player, "spellTrap", wasFaceupBeforeMove,
              effectsNegatedAtFieldExit, selectionOptions, null, false, receipt.value);
          }
        }
      }
      break;
    }

    case "fieldEffect": {
      const player = state.bot;
      const fieldSpell = player.fieldSpell;
      if (!fieldSpell) break;
      const parentEffect =
        resolveEffectForAction(fieldSpell, action, ["on_field_activate"]) ||
        (fieldSpell.effects || []).find(
          (entry) =>
            entry &&
            entry.timing === "ignition" &&
            entry.activationZones?.includes("fieldSpell"),
        );
      const effect = parentEffect ? prepareSimulatedEffectActivation(state, fieldSpell, parentEffect, selectionOptions)?.effect : null;
      if (!effect) break;
      if (
        !effectConditionsPass(
          state,
          effect,
          fieldSpell,
          selectionOptions,
        )
      ) {
        break;
      }
      if (
        !canUseSimulatedEffect(
          state,
          effect,
          fieldSpell,
          options.selfId || "bot",
        )
      ) {
        break;
      }
      const targetPreference =
        (options.getFieldEffectTargetPreference?.({
          state,
          action,
          player,
          fieldSpell,
          effect,
          options,
        }) as object | null | undefined) || null;
      const selections = selectSimulatedTargets({
        targets: effect.targets || [],
        effect,
        actions: effectExecutionActions(effect),
        state,
        sourceCard: fieldSpell,
        selfId: options.selfId || "bot",
        options: {
          ...selectionOptions,
          preferDefense: !targetPreference,
          targetPreference,
          opponentField: state.player?.field || [],
          opponentLp: state.player?.lp || 0,
        },
      });
      if (!hasRequiredSimSelections(effect.targets || [], selections)) break;
      if (!canPaySimulatedActivationCosts(effect, selections, fieldSpell, player, state, selectionOptions)) break;
      const usageSourceAtActivation = { ...fieldSpell };
      const resolutionOptions: SimulatedActionOptions = {
        ...selectionOptions, sourceCard: fieldSpell, effect, targetPreference,
        referenceSnapshots: captureSimulatedReferences(effect, selections, player, state.player),
        actionContext: selectionOptions.actionContext || {},
        costPayment: { status: "paid", actions: [], summonMarkers: [] },
        payingActivationCosts: true,
      };
      if (!applySimulatedActions({ actions: effect.activationCosts || [], selections, state,
        selfId: options.selfId || "bot", options: resolutionOptions })) break;
      resolutionOptions.payingActivationCosts = false;
      const sourcePresent = player.fieldSpell === fieldSpell && !fieldSpell.isFacedown &&
        (fieldSpell.locationVersion ?? 0) === (usageSourceAtActivation.locationVersion ?? 0);
      const sourceNegated = sourcePresent && fieldSpell.effectsNegated;
      if (!sourceNegated && (effect.requiresSourceAtResolution === false || sourcePresent)) applySimulatedEffectResolution({
        effect,
        selections,
        state,
        selfId: options.selfId || "bot",
        options: resolutionOptions,
      });
      markSimulatedEffectUsed(
        state,
        effect,
        usageSourceAtActivation,
        options.selfId || "bot",
      );
      options.onEffectActivated?.({
        state,
        action,
        player,
        card: fieldSpell,
        effect,
        zone: "fieldSpell",
        options,
      });
      break;
    }

    case "graveyardSpellEffect":
    case "graveyardMonsterEffect": {
      const player = state.bot;
      const graveyardIndex = resolvePlanningSourceIndex(player.graveyard, action, player.id, "graveyard", action.card) ?? (Number.isInteger(action.graveyardIndex as number)
        ? action.graveyardIndex
        : player.graveyard?.findIndex(
            (card) =>
              card &&
              (action.type === "graveyardMonsterEffect" ? card.cardKind === "monster" : card.cardKind === "spell" || card.cardKind === "trap") &&
              (card.id === action.cardId ||
                (!action.cardId && card.name === action.cardName)),
          ));
      const card = player.graveyard?.[graveyardIndex!];
      if (!card || (action.type === "graveyardMonsterEffect" ? card.cardKind !== "monster" : card.cardKind !== "spell" && card.cardKind !== "trap")) break;
      const parentEffect = resolveEffectForAction(card, action, ["ignition"]);
      const effect = parentEffect ? prepareSimulatedEffectActivation(state, card, parentEffect, selectionOptions)?.effect : null;
      if (!effect || !effect.activationZones?.includes("graveyard")) break;
      if (!effectConditionsPass(state, effect, card, selectionOptions)) {
        break;
      }
      if (
        !canUseSimulatedEffect(
          state,
          effect,
          card,
          options.selfId || "bot",
        )
      ) {
        break;
      }
      const selections = selectSimulatedTargets({
        targets: effect.targets || [],
        effect,
        actions: effectExecutionActions(effect),
        state,
        sourceCard: card,
        selfId: options.selfId || "bot",
        options: selectionOptions,
      });
      if (!hasRequiredSimSelections(effect.targets || [], selections)) break;
      if (!canPaySimulatedActivationCosts(effect, selections, card, player, state, selectionOptions)) break;
      const frame = createDeferredSimulatedEventFrame(state, selectionOptions);
      const usageSourceAtActivation = { ...card };
      const resolutionOptions: SimulatedActionOptions = {
        ...frame.options, sourceCard: card, effect,
        referenceSnapshots: captureSimulatedReferences(effect, selections, player, state.player,
          effect.requiresSourceAtResolution === true ? { self: [card] } : {}),
        actionContext: selectionOptions.actionContext || {},
        costPayment: { status: "paid", actions: [], summonMarkers: [] },
        payingActivationCosts: true,
      };
      try {
        if (!applySimulatedActions({ actions: effect.activationCosts || [], selections, state,
          selfId: options.selfId || "bot", options: resolutionOptions })) break;
        resolutionOptions.payingActivationCosts = false;
        if (isSimulatedSourcePresenceValid(resolutionOptions, player)) applySimulatedEffectResolution({
          effect, selections, state, selfId: options.selfId || "bot", options: resolutionOptions,
        });
      markSimulatedEffectUsed(
        state,
        effect,
        usageSourceAtActivation,
        options.selfId || "bot",
      );
      options.onEffectActivated?.({
        state,
        action,
        player,
        card,
        effect,
        zone: "graveyard",
        options,
      });
      } finally { frame.finishResolution(); }
      break;
    }

    case "ascension": {
      const player = state.bot;
      const boundMaterial = resolvePlanningCard(player.field, action.material, player.id, "field", action, 0);
      const materialIndex = boundMaterial.explicit
        ? (boundMaterial.card ? player.field.indexOf(boundMaterial.card) : -1)
        : resolveSimulatedFieldIndex(player, { materialIndex: action.materialIndex },
          card => card.cardKind === "monster" && !card.isFacedown);
      const material = player.field?.[materialIndex];
      if (!material) break;
      const boundSource = resolvePlanningCard(player.extraDeck, action.ascensionCard, player.id, "extraDeck", action);
      const extraIndex = boundSource.explicit ? (boundSource.card ? player.extraDeck.indexOf(boundSource.card) : -1) : (player.extraDeck || []).findIndex(
        (card) =>
          card &&
          (card.id === action.ascensionCard?.id ||
            card.name === action.cardName ||
            card.name === action.ascensionCard?.name),
      );
      const ascensionCard = (
        extraIndex >= 0 ? player.extraDeck[extraIndex] : null
      ) as SimulatedCardState | null | undefined;
      if (!ascensionCard) break;
      if (!checkSimulatedAscension(state, material, ascensionCard).ok) break;
      if (!canSimulatedSpecialSummon(ascensionCard, player, "ascension", "extraDeck")) break;
      player.field.splice(materialIndex, 1);
      appendSimulatedZoneCard(player.graveyard, material);
      if (extraIndex >= 0) player.extraDeck.splice(extraIndex, 1);
      const summoned = Object.assign(ascensionCard, {
        position:
          (action.position || ascensionCard.ascension?.position ||
            "attack") as NonNullable<SimulatedCardState["position"]>,
        isFacedown: false,
        hasAttacked: false,
        attacksUsedThisTurn: 0,
      });
      summoned.lastSummonMethod = "ascension";
      summoned.lastSummonedFromZone = "extraDeck";
      establishProperSummon(summoned, {
        summonProcedure: "ascension",
        sourceZone: "extraDeck",
      });
      appendSimulatedFieldCard(player.field, summoned);
      const ascensionEvents = attachSimulatedEventEmitter(state, { ...selectionOptions, enableSimulatedEvents: true });
      recordCompletedSimulatedSummon(state, { card: summoned, player, method: "ascension" });
      ascensionEvents.emitSimulatedEvent?.("after_summon", {
        card: summoned,
        player,
        method: "ascension",
        fromZone: "extraDeck",
        sourceCard: summoned,
        actionContext: selectionOptions.actionContext,
      });
      break;
    }

    case "extraDeckProcedure": {
      const player = state.bot;
      const { card: extraDeckCard, index: extraIndex } =
        findSimulatedExtraDeckCard(player, action);
      if (!extraDeckCard || extraDeckCard.cardKind !== "monster") break;
      const summonProcedure =
        extraDeckCard.extraDeckSummonProcedure?.type ||
        action.summonProcedure ||
        extraDeckCard.monsterType ||
        "special";
      if (
        !canSimulatedSpecialSummon(
          extraDeckCard,
          player,
          summonProcedure,
          "extraDeck",
        )
      ) break;
      const materials = resolveSimulatedExtraDeckMaterials(player, action);
      const requiredCount = Number(
        action.requiredMaterialCount ||
          extraDeckCard.fusionMaterials?.length ||
          materials.length,
      );
      if (materials.length !== requiredCount) break;
      if ((player.field || []).length - materials.length + 1 > 5) break;

      for (const material of materials) {
        const fromZone = findCardZone(player, material) || "field";
        const wasFaceupBeforeMove = material.isFacedown !== true;
        if (moveCardToZone(player, material, "graveyard")) {
          updateSimulatedSentToGraveMaterialMarker({
            card: material,
            state,
            player,
            fromZone,
            contextLabel: "fusion_material",
          });
          selectionOptions.emitSimulatedEvent?.("card_moved", {
            card: material,
            player,
            fromPlayer: player,
            toPlayer: player,
            fromZone,
            toZone: "graveyard",
            movedByEffect: false,
            wasFaceupBeforeMove,
            sourceCard: extraDeckCard,
            actionContext: selectionOptions.actionContext,
          });
        }
      }

      if (extraIndex >= 0) {
        player.extraDeck.splice(extraIndex, 1);
      }
      const summoned = {
        ...extraDeckCard,
        position:
          (action.position ||
            (extraDeckCard as SimulatedCardState & {
              fusionPosition?: SimulatedCardState["position"];
            }).fusionPosition ||
            "attack") as NonNullable<SimulatedCardState["position"]>,
        isFacedown: false,
        hasAttacked: false,
        attacksUsedThisTurn: 0,
        summonMethod:
          extraDeckCard.extraDeckSummonProcedure?.summonMethod || "fusion",
        summonProcedure: extraDeckCard.extraDeckSummonProcedure?.type || null,
      };
      summoned.lastSummonMethod = summoned.summonMethod;
      summoned.lastSummonedFromZone = "extraDeck";
      establishProperSummon(summoned, {
        summonProcedure,
        sourceZone: "extraDeck",
      });
      appendSimulatedFieldCard(player.field, summoned);
      recordCompletedSimulatedSummon(state, { card: summoned, player, method: summoned.lastSummonMethod });
      selectionOptions.emitSimulatedEvent?.("after_summon", {
        card: summoned,
        player,
        method: summoned.summonMethod || "fusion",
        fromZone: "extraDeck",
        sourceCard: summoned,
        actionContext: selectionOptions.actionContext,
      });
      break;
    }

    // These actions are handled by strategy overrides, or leave this generic simulation unchanged.
    case "special_summon_sanctum_protector":
      break;
    default:
      action satisfies never;
      break;
  }

  return state;
}
