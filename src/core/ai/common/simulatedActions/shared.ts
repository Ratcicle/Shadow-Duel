import {
  asArray,
  buildActionFilter,
  getCostPreference,
  getTargetPreference,
  matchesTargetFilters,
  mergeCostPreference,
  normalizeCount,
  rankCandidates,
} from "../targetSelection.js";
import type { AiCardFilter } from "../cardFilters.js";
import { getZoneCards } from "../zones.js";
import { applyStatusesOnSummon } from "../../../Card.js";
import type {
  ActionOf,
  ActionProperties,
  ActionTargetScope,
  ActionType,
  CardAction,
  ContextNumberSource,
  SelectionCount,
} from "../../../contracts/actions.js";
import type {
  AIActivationContext,
  SimulatedActionHandlerContext as CanonicalSimulatedActionHandlerContext,
} from "../../../contracts/ai.js";
import type {
  AiStateShape,
  SimulatedCardState,
  SimulatedPlayerState,
  SimulationGameState,
} from "../../../contracts/aiState.js";
import type { BattlePosition } from "../../../contracts/cards.js";
import type {
  CardFilter,
  EffectDefinition,
  EffectTarget,
} from "../../../contracts/effects.js";
import type { PlayerId } from "../../../contracts/primitives.js";
import type {
  CanonicalSelectionMap,
  CanonicalSelectionValue,
} from "../../../contracts/selection.js";
import type { CanonicalZone, ZoneInput } from "../../../contracts/zones.js";

export interface SimulatedActionContextData {
  attacker?: SimulatedCardState | null;
  defender?: SimulatedCardState | null;
  target?: SimulatedCardState | null;
  source?: SimulatedCardState | null;
  eventCard?: SimulatedCardState | null;
  movedCard?: SimulatedCardState | null;
  summonedCard?: SimulatedCardState | null;
  destroyed?: SimulatedCardState | SimulatedCardState[] | null;
  battleDestroyer?: SimulatedCardState | null;
  battleDestroyers?: SimulatedCardState[];
  respondingToChainLink?: {
    effectNegated?: boolean;
  } | null;
  activationAttempt?: {
    card?: SimulatedCardState | null;
    activationNegated?: boolean;
  } | null;
  card?: SimulatedCardState | null;
  targetCard?: SimulatedCardState | null;
  activationNegated?: boolean;
  effectNegated?: boolean;
  attackRedirect?: {
    target: SimulatedCardState;
    reason: string;
  };
  redirectedTarget?: SimulatedCardState | null;
  targetPreferences?: object;
  targetPreference?: object | null;
  costPreferences?: object;
  declaredValues?: object;
  lastAddedCounterCount?: number;
  addedCounterCounts?: object;
  lastFieldCounterCount?: number;
  fieldCounterCounts?: object;
  destroyedOwner?: SimulatedPlayerState | PlayerId | string | null;
  lastAddedToHandCard?: SimulatedCardState | null;
  lastAddedToHandCards?: SimulatedCardState[];
  lastDrawnCard?: SimulatedCardState | null;
  lastDrawnCards?: SimulatedCardState[];
}

interface SimulatedRecruitScore {
  card: SimulatedCardState;
  score: number;
  blocked?: boolean;
}

interface SimulatedRecruitResult {
  scores?: SimulatedRecruitScore[];
  asBotSelect?(): SimulatedCardState[];
  best?: SimulatedCardState | null;
}

export interface SimulatedStrategyCapabilities {
  rankSearchCandidates?(
    candidates: SimulatedCardState[],
    action: CardAction,
    context: object,
  ): SimulatedCardState[];
  evaluateRecruitCandidate?(
    candidates: SimulatedCardState[],
    context: object,
  ): SimulatedRecruitResult;
  chooseSpecialSummonPosition?(
    card: SimulatedCardState,
    context: object,
  ): BattlePosition | "choice" | null | undefined;
  chooseActionCase?(
    cases: readonly object[],
    context: object,
  ): object | string | number | null | undefined;
}

export interface SimulatedActionOptions {
  sourceCard?: SimulatedCardState | null;
  sourceAction?: object | null;
  effect?: EffectDefinition | null;
  activationContext?: AIActivationContext & {
    actionContext?: SimulatedActionContextData;
    costPreferences?: object;
    context?: SimulatedActionContextData;
    actionResults?: CanonicalSelectionMap;
    targetPreference?: object | null;
  };
  actionContext?: SimulatedActionContextData;
  actionResults?: CanonicalSelectionMap;
  strategy?: SimulatedStrategyCapabilities;
  self?: SimulatedPlayerState | null;
  selfId?: PlayerId | string;
  attacker?: SimulatedCardState | null;
  defender?: SimulatedCardState | null;
  target?: SimulatedCardState | null;
  resolvedTargets?: SimulatedCardState[];
  targetPreference?: object | null;
  targetPreferences?: object;
  costPreferences?: object;
  rankSearchCandidates?: SimulatedStrategyCapabilities["rankSearchCandidates"];
  evaluateRecruitCandidate?: SimulatedStrategyCapabilities["evaluateRecruitCandidate"];
  chooseSpecialSummonPosition?: SimulatedStrategyCapabilities["chooseSpecialSummonPosition"];
  chooseActionCase?: (
    cases: readonly object[],
    context: object,
  ) => object | string | number | null | undefined;
  emitSimulatedEvent?: (event: string, payload: object) => void;
  onAfterSpecialSummon?: (payload: object) => void;
  onFusionSummon?: (payload: object) => void;
  evaluateSimulatedConditions?: (
    conditions: readonly object[],
    context: object,
  ) => boolean;
  lastAddedToHandCard?: SimulatedCardState | null;
  lastAddedToHandCards?: SimulatedCardState[];
  lastDrawnCard?: SimulatedCardState | null;
  lastDrawnCards?: SimulatedCardState[];
  lastSpecialSummonedCard?: SimulatedCardState | null;
  lastSpecialSummonedCards?: SimulatedCardState[];
  card?: SimulatedCardState | null;
  eventCard?: SimulatedCardState | null;
  movedCard?: SimulatedCardState | null;
  summonedCard?: SimulatedCardState | null;
  destroyed?: SimulatedCardState | SimulatedCardState[] | null;
  battleDestroyer?: SimulatedCardState | null;
  battleDestroyers?: SimulatedCardState[];
  enableSimulatedEvents?: boolean;
  _simEventDepth?: number;
}

interface SimulatedLpReducer {
  board: SimulatedPlayerState;
  card: SimulatedCardState;
  effect: EffectDefinition;
  reduction: number;
  stackMode: "max" | "sum";
  minFinalAmount: number;
}

interface SimulatedLpCostResolution {
  finalAmount: number;
  appliedReducers: SimulatedLpReducer[];
}

interface SimulatedLpCostInput {
  action: CardAction;
  targetPlayer: SimulatedPlayerState | null | undefined;
  self: SimulatedPlayerState | null | undefined;
  opponent: SimulatedPlayerState | null | undefined;
  state: SimulatedRuntimeState;
  options: SimulatedActionOptions;
  baseAmount: number;
}

export type SimulatedCardIntent = "benefit" | "cost" | "summon";

interface SimulatedSummonActionShape {
  readonly position?: BattlePosition | "choice";
  readonly cannotAttackThisTurn?: boolean;
  readonly destroySummonedAtEndPhase?: boolean;
  readonly negateEffects?: boolean;
  readonly negateEffectsDuration?: string;
  readonly setAtkToZeroAfterSummon?: boolean;
  readonly setDefToZeroAfterSummon?: boolean;
  readonly atkBoostAfterSummon?: number;
  readonly defBoostAfterSummon?: number;
  readonly statusesOnSummon?: ActionProperties["statusesOnSummon"];
}

interface SimulatedMaterialMarkerInput {
  card: SimulatedCardState;
  state: SimulatedRuntimeState;
  player: SimulatedPlayerState;
  fromZone?: ZoneInput | null;
  contextLabel?: string | null;
}

type SimulatedContextNumberReference =
  | number
  | string
  | ContextNumberSource
  | {
      readonly contextKey?: string;
      readonly path?: string;
      readonly resultKey?: string;
      readonly defaultValue?: number;
      readonly default?: number;
      readonly fallback?: number;
    };

export interface SimulatedTemporaryBattlePairEffect {
  timing: string;
  duration: string;
  createdOnTurn: number;
  expiresOnTurn: number;
  controllerId: PlayerId | string | null;
  opponentId: PlayerId | string | null;
  sourceName: string | null;
  sourceCardId: number | null;
  sourceInstanceId: string | number | null;
  sourceEffectId: string | null;
  sourceArchetype: string | null;
  sourceArchetypes: string[];
  firstTargetRef?: string;
  secondTargetRef?: string;
  affectedTargetRef?: string;
  firstTarget: SimulatedCardState;
  secondTarget: SimulatedCardState;
  affectedTarget: SimulatedCardState;
  firstInstanceId: string | number | null;
  secondInstanceId: string | number | null;
  affectedInstanceId: string | number | null;
  actions: readonly CardAction[];
}

export interface SimulatedTemporaryControlEffect {
  id: string;
  cardInstanceId: string | number | null;
  holderId: PlayerId | string;
  previousControllerId: PlayerId | string;
  expiresOnTurn: number;
  sourceInstanceId: string | number | null;
  createdOnTurn: number;
}

export interface SimulatedTemporaryEventEffect {
  event: string;
  ownerId: PlayerId | string;
  sourceCardId: number | null;
  sourceName: string | null;
  sourceCardKind: string | null;
  sourceCardSubtype: string | null;
  sourceArchetype: string | null;
  sourceArchetypes: string[];
  sourceEffectId: string | null;
  sourceInstanceId: string | number | null;
  boundEventTargetInstanceId: string | number | null;
  requireBoundTargetLeavesField: boolean;
  duration: string;
  createdOnTurn: number;
  expiresOnTurn: number | null;
  usesRemaining: number | null;
  declaredValues: object;
  effect: EffectDefinition;
}

export interface SimulatedRuntimeStateFields {
  temporaryBattlePairEffects?: SimulatedTemporaryBattlePairEffect[];
  temporaryControlEffects?: SimulatedTemporaryControlEffect[];
  temporaryEventEffects?: SimulatedTemporaryEventEffect[];
}

export type SimulatedRuntimeState = SimulationGameState &
  SimulatedRuntimeStateFields;

export interface SimulatedActionBatchInput {
  actions?: readonly CardAction[] | null;
  selections?: CanonicalSelectionMap;
  state: SimulatedRuntimeState;
  selfId?: PlayerId | string;
  options?: SimulatedActionOptions;
}

export type SimulatedActionHandlerContext<Type extends ActionType> = Omit<
  CanonicalSimulatedActionHandlerContext<Type>,
  | "targets"
  | "options"
  | "state"
  | "self"
  | "opponent"
  | "applySimulatedActions"
> & {
  targets: SimulatedCardState[];
  options: SimulatedActionOptions;
  state: SimulatedRuntimeState;
  self: SimulatedPlayerState;
  opponent: SimulatedPlayerState;
  source?: SimulatedCardState | null;
  applySimulatedActions(input: SimulatedActionBatchInput): void;
};

export type SimulatedActionHandler<Type extends ActionType> = (
  context: SimulatedActionHandlerContext<Type>,
) => void | typeof STOP_SIMULATION;

export type SimulatedActionHandlerManifest<Type extends ActionType> = {
  [Key in Type]: SimulatedActionHandler<Key>;
};

export const STOP_SIMULATION = Symbol("STOP_SIMULATION");

export function hasOpenMonsterZone(
  player: SimulatedPlayerState | null | undefined,
): boolean {
  return (player?.field || []).length < 5;
}

export function resolveActionPlayer(
  action: object,
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
): SimulatedPlayerState {
  return Reflect.get(action, "player") === "opponent" ? opponent : self;
}

export function getSimulatedOncePerTurnKey(
  effect: EffectDefinition | null | undefined,
  card: SimulatedCardState | null | undefined,
): string | null {
  return effect?.oncePerTurnName || effect?.id || card?.name || null;
}

export function canUseSimulatedPassive(
  state: SimulatedRuntimeState,
  player: SimulatedPlayerState,
  card: SimulatedCardState,
  effect: EffectDefinition,
): boolean {
  if (!effect?.oncePerTurn && !effect?.oncePerTurnName) return true;
  const key = getSimulatedOncePerTurnKey(effect, card);
  if (!key) return true;
  const currentTurn = state?.turnCounter || 0;
  const legacyUsesPerTurn = Reflect.get(effect, "usesPerTurn");
  const legacyMaxUsesPerTurn = Reflect.get(effect, "maxUsesPerTurn");
  const limit = Math.max(
    1,
    Math.floor(
      Number(
        effect.oncePerTurnLimit ??
          legacyUsesPerTurn ??
          legacyMaxUsesPerTurn ??
          1,
      ),
    ) || 1,
  );
  const usage =
    effect.oncePerTurnScope === "card" || effect.oncePerTurnPerCard
      ? card?.oncePerTurnUsageByName || {}
      : player?.oncePerTurnUsageByName || {};
  const entry = usage[key];
  const persistedUsed =
    entry === currentTurn
      ? 1
      : entry && typeof entry === "object" && Number(entry.turn) === currentTurn
        ? Math.max(0, Math.floor(Number(entry.count ?? 0)) || 0)
        : 0;
  if (!state._simPassiveOncePerTurn) state._simPassiveOncePerTurn = new Map();
  if (state._simPassiveOncePerTurn instanceof Set) {
    const migrated = new Map<string, number>();
    for (const entryKey of state._simPassiveOncePerTurn) {
      if (typeof entryKey === "string") migrated.set(entryKey, 1);
    }
    state._simPassiveOncePerTurn = migrated;
  }
  const ownerKey = player?.id || (player === state?.bot ? "bot" : "player");
  const cardKey = card?.instanceId || card?.id || card?.name || "card";
  const simKey = `${ownerKey}:${cardKey}:${key}`;
  const simulatedUsed = Number(state._simPassiveOncePerTurn.get(simKey) || 0);
  return persistedUsed + simulatedUsed < limit;
}

export function markSimulatedPassiveUsed(
  state: SimulatedRuntimeState,
  player: SimulatedPlayerState,
  card: SimulatedCardState,
  effect: EffectDefinition,
): void {
  if (!effect?.oncePerTurn && !effect?.oncePerTurnName) return;
  const key = getSimulatedOncePerTurnKey(effect, card);
  if (!key) return;
  if (!state._simPassiveOncePerTurn) state._simPassiveOncePerTurn = new Map();
  if (state._simPassiveOncePerTurn instanceof Set) {
    const migrated = new Map<string, number>();
    for (const entryKey of state._simPassiveOncePerTurn) {
      if (typeof entryKey === "string") migrated.set(entryKey, 1);
    }
    state._simPassiveOncePerTurn = migrated;
  }
  const ownerKey = player?.id || (player === state?.bot ? "bot" : "player");
  const cardKey = card?.instanceId || card?.id || card?.name || "card";
  const simKey = `${ownerKey}:${cardKey}:${key}`;
  const current = Number(state._simPassiveOncePerTurn.get(simKey) || 0);
  state._simPassiveOncePerTurn.set(simKey, current + 1);
}

export function resolveSimulatedLpCost({
  action,
  targetPlayer,
  self,
  opponent,
  state,
  options,
  baseAmount,
}: SimulatedLpCostInput): SimulatedLpCostResolution {
  const result: SimulatedLpCostResolution = {
    finalAmount: baseAmount,
    appliedReducers: [],
  };
  if (!state || !targetPlayer || baseAmount <= 0) return result;

  const source = options.sourceCard || null;
  const boards = [self, opponent].filter(
    (board): board is SimulatedPlayerState => board !== null && board !== undefined,
  );
  const reducers: SimulatedLpReducer[] = [];

  boards.forEach((board) => {
    const zoneCards = [
      ...(board.field || []),
      ...(board.spellTrap || []),
      board.fieldSpell,
    ].filter(
      (card): card is SimulatedCardState =>
        card !== null && card !== undefined,
    );

    zoneCards.forEach((card) => {
      (card.effects || []).forEach((effect: EffectDefinition) => {
        if (!effect || effect.timing !== "passive" || !("passive" in effect)) {
          return;
        }
        const passive = effect.passive;
        if (!passive || passive.type !== "lp_cost_reduction") return;
        if (effect.requireFaceup === true && card.isFacedown) return;
        const effectAllowsFacedown = Reflect.get(effect, "allowFacedown") === true;
        const passiveAllowsFacedown = Reflect.get(passive, "allowFacedown") === true;
        if (card.isFacedown && !effectAllowsFacedown && !passiveAllowsFacedown) {
          return;
        }

        const appliesTo = asArray(
          passive.appliesTo ||
            Reflect.get(passive, "affects") ||
            Reflect.get(passive, "owner") ||
            "self",
        );
        const relation = board === targetPlayer ? "self" : "opponent";
        if (!appliesTo.includes("any") && !appliesTo.includes(relation)) return;

        const actionTypes =
          passive.actionTypes || Reflect.get(passive, "actionType");
        if (actionTypes && !asArray(actionTypes).includes(action.type)) return;

        const legacySourceFilter = Reflect.get(passive, "sourceFilter");
        const sourceFilters = passive.sourceFilters ||
          (typeof legacySourceFilter === "object" && legacySourceFilter !== null
            ? legacySourceFilter
            : null);
        if (sourceFilters) {
          const filters: CardFilter = {
            ...sourceFilters,
            name:
              "cardName" in sourceFilters &&
              typeof sourceFilters.cardName === "string" &&
              !("name" in sourceFilters)
                ? sourceFilters.cardName
                : "name" in sourceFilters && typeof sourceFilters.name === "string"
                  ? sourceFilters.name
                  : undefined,
          };
          if (!source || !matchesTargetFilters(source, filters, source, relation)) {
            return;
          }
        }

        if (!canUseSimulatedPassive(state, board, card, effect)) return;
        const reduction = Number(
          passive.amount ??
            Reflect.get(passive, "reduction") ??
            Reflect.get(passive, "value") ??
            0,
        );
        if (reduction <= 0) return;
        const legacyStackMode: unknown = Reflect.get(passive, "stackMode");
        const stackMode = legacyStackMode === "sum" ? "sum" : "max";
        reducers.push({
          board,
          card,
          effect,
          reduction,
          stackMode,
          minFinalAmount: Number(
            Reflect.get(passive, "minFinalAmount") ??
              Reflect.get(passive, "minAmount") ??
              0,
          ),
        });
      });
    });
  });

  if (reducers.length === 0) return result;

  const sumReducers = reducers.filter((entry) => entry.stackMode === "sum");
  const maxReducer = reducers
    .filter((entry) => entry.stackMode !== "sum")
    .sort((a, b) => b.reduction - a.reduction)[0] || null;
  const appliedReducers = [...sumReducers];
  if (maxReducer) appliedReducers.push(maxReducer);

  const totalReduction = appliedReducers.reduce(
    (sum, entry) => sum + entry.reduction,
    0,
  );
  const minFinalAmount = appliedReducers.reduce(
    (max, entry) => Math.max(max, entry.minFinalAmount || 0),
    0,
  );
  result.finalAmount = Math.max(minFinalAmount, baseAmount - totalReduction);
  if (result.finalAmount < baseAmount) {
    result.appliedReducers = appliedReducers;
  }
  return result;
}

function isSimulatedCard(value: unknown): value is SimulatedCardState {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function simulatedCardsFromSelection(
  value: CanonicalSelectionValue,
): SimulatedCardState[] {
  if (Array.isArray(value)) return value.filter(isSimulatedCard);
  if (!isSimulatedCard(value)) return [];
  if ("card" in value && isSimulatedCard(value.card)) return [value.card];
  return [value];
}

export function resolveTargetsForAction(
  action: { readonly targetRef?: string },
  selections: CanonicalSelectionMap,
  options: SimulatedActionOptions,
  opponent: SimulatedPlayerState | null | undefined,
): SimulatedCardState[] {
  if (!action?.targetRef) return [];
  if (action.targetRef === "self") {
    return options.sourceCard ? [options.sourceCard] : [];
  }
  if (action.targetRef === "ascension_material") {
    return resolveSimulatedAscensionMaterials(options);
  }
  if (
    action.targetRef === "battle_self_participant" ||
    action.targetRef === "battle_opponent_participant"
  ) {
    const selfId = options.selfId || "bot";
    const expectedId =
      action.targetRef === "battle_opponent_participant"
        ? opponent?.id || (selfId === "bot" ? "player" : "bot")
        : selfId;
    const expectedPlayer =
      expectedId === opponent?.id ? opponent : options.self || null;
    const matchesOwner = (
      card: SimulatedCardState | null | undefined,
      ownerId: PlayerId | string,
    ): card is SimulatedCardState =>
      !!card &&
      ((Array.isArray(expectedPlayer?.field) &&
        expectedPlayer.field.includes(card)) ||
        card.controller === ownerId ||
        card.owner === ownerId);
    const attacker =
      options.attacker || options.actionContext?.attacker || null;
    const defender =
      options.defender ||
      options.target ||
      options.actionContext?.defender ||
      options.actionContext?.target ||
      null;
    if (matchesOwner(attacker, expectedId)) return [attacker];
    if (matchesOwner(defender, expectedId)) return [defender];
    return [];
  }
  if (action.targetRef === "opponent_field") {
    return (opponent?.field || []).filter(
      (card) => card && card.cardKind === "monster" && !card.isFacedown,
    );
  }
  return simulatedCardsFromSelection(selections[action.targetRef]);
}

function getSimCardInstanceId(
  card: SimulatedCardState | null | undefined,
): string | number | null {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? card?.simInstanceId ?? null;
}

function resolveSimulatedAscensionMaterials(
  options: SimulatedActionOptions,
): SimulatedCardState[] {
  const source = options.sourceCard || options.actionContext?.source || null;
  const self = options.self || null;
  const graveyard = Array.isArray(self?.graveyard) ? self.graveyard : [];
  const materials = Array.isArray(source?.ascensionMaterials)
    ? source.ascensionMaterials
    : [];
  const materialInstanceIds = new Set(
    materials
      .map((entry) => entry?.instanceId)
      .filter(
        (value): value is string | number =>
          value !== undefined && value !== null,
      ),
  );
  if (materialInstanceIds.size === 0) return [];
  return graveyard.filter((card) => {
    const instanceId = getSimCardInstanceId(card);
    return instanceId !== null && materialInstanceIds.has(instanceId);
  });
}

export function storeSimActionResult(
  action: {
    readonly resultRef?: string;
    readonly storeResultAs?: string;
  },
  selections: CanonicalSelectionMap,
  options: SimulatedActionOptions,
  cards: readonly SimulatedCardState[] | null | undefined,
  fallbackKey: string | null = null,
): void {
  const resultKey = action?.resultRef || action?.storeResultAs || fallbackKey;
  if (!resultKey) return;
  const storedCards = Array.isArray(cards) ? cards.filter(Boolean) : [];
  if (selections && typeof selections === "object") {
    selections[resultKey] = storedCards;
  }
  if (options && typeof options === "object") {
    if (!options.actionResults || typeof options.actionResults !== "object") {
      options.actionResults = {};
    }
    options.actionResults[resultKey] = storedCards;
  }
}

function getSimulatedMaterialTypeFromContextLabel(
  contextLabel: string | null,
): "fusion" | "synchro" | "ascension" | null {
  if (contextLabel === "fusion_material") return "fusion";
  if (contextLabel === "synchro_material") return "synchro";
  if (contextLabel === "ascension_material") return "ascension";
  return null;
}

export function updateSimulatedSentToGraveMaterialMarker({
  card,
  state,
  player,
  fromZone = null,
  contextLabel = null,
}: SimulatedMaterialMarkerInput): void {
  if (!card) return;
  const materialType = getSimulatedMaterialTypeFromContextLabel(contextLabel);
  if (!materialType) {
    delete card.lastSentToGraveAsMaterial;
    return;
  }
  card.lastSentToGraveAsMaterial = {
    type: materialType,
    turn: Number(state?.turnCounter || 0),
    thisTurn: true,
    ownerId: player?.id || card.owner || null,
    fromZone: fromZone === "banish" ? "banished" : fromZone,
    contextLabel,
  };
}

function getContextPathValue(ctx: object, path: string): unknown {
  if (!path) return undefined;
  let value: unknown = ctx;
  for (const key of path.split(".").filter(Boolean)) {
    if (typeof value !== "object" || value === null) return undefined;
    value = Reflect.get(value, key);
  }
  return value;
}

function resolveNumberFromContext(
  ref: SimulatedContextNumberReference | null | undefined,
  options: SimulatedActionOptions,
): number | null {
  if (ref === undefined || ref === null) return null;
  if (typeof ref === "number") {
    return Number.isFinite(ref) ? ref : null;
  }
  if (typeof ref === "string" && Number.isFinite(Number(ref))) {
    return Number(ref);
  }
  const key =
    typeof ref === "string"
      ? ref
      : "key" in ref
        ? ref.key
        : ref.contextKey || ref.path || ref.resultKey || null;
  const fallback =
    typeof ref === "object" && ref !== null
      ? Reflect.get(ref, "defaultValue") ??
        Reflect.get(ref, "default") ??
        Reflect.get(ref, "fallback")
      : undefined;
  const context =
    options.actionContext ||
    options.activationContext?.actionContext ||
    options.activationContext ||
    {};
  const rawValue = key ? getContextPathValue(context, key) : undefined;
  const value = rawValue === undefined ? fallback : rawValue;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.floor(numeric) : null;
}

function applyContextMaxLevelFilter(
  filters: AiCardFilter,
  action: { readonly maxLevelFromContext?: SimulatedContextNumberReference },
  options: SimulatedActionOptions,
): AiCardFilter {
  const maxLevel = resolveNumberFromContext(action.maxLevelFromContext, options);
  if (maxLevel === null) return filters;
  return {
    ...filters,
    maxLevel: typeof filters.maxLevel === "number" && Number.isFinite(filters.maxLevel)
      ? Math.min(filters.maxLevel, maxLevel)
      : maxLevel,
  };
}

export function getActionCandidates(
  player: SimulatedPlayerState,
  action: Partial<
    Pick<
      ActionProperties,
      | "zones"
      | "zone"
      | "filters"
      | "maxLevelFromContext"
      | "cardKind"
      | "cardName"
      | "archetype"
      | "minLevel"
      | "maxLevel"
      | "minAtk"
      | "maxAtk"
      | "minDef"
      | "maxDef"
      | "isTuner"
      | "isToken"
    >
  > = {},
  zoneFallback: ZoneInput = "deck",
  options: SimulatedActionOptions = {},
): SimulatedCardState[] {
  const zones = asArray(action.zones || action.zone || zoneFallback);
  const filters = applyContextMaxLevelFilter(
    buildActionFilter(action),
    action,
    options,
  );
  return zones.flatMap((zone) =>
    getZoneCards(player, zone).filter((card) =>
      matchesTargetFilters(card, filters, null)
    )
  );
}

export function getStrategyRanker(
  options: SimulatedActionOptions = {},
): SimulatedStrategyCapabilities["rankSearchCandidates"] | null {
  return (
    options.rankSearchCandidates ||
    options.strategy?.rankSearchCandidates?.bind(options.strategy) ||
    null
  );
}

export function getRecruitEvaluator(
  options: SimulatedActionOptions = {},
): SimulatedStrategyCapabilities["evaluateRecruitCandidate"] | null {
  return (
    options.evaluateRecruitCandidate ||
    options.strategy?.evaluateRecruitCandidate?.bind(options.strategy) ||
    null
  );
}

export function chooseRankedCards(
  candidates: SimulatedCardState[],
  intent: SimulatedCardIntent,
  action: CardAction,
  state: SimulatedRuntimeState,
  player: SimulatedPlayerState,
  options: SimulatedActionOptions,
): SimulatedCardState[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const ctx = {
    game: state,
    player,
    source: options.sourceCard,
    action,
    activationContext: options.activationContext,
  };

  if (intent === "summon") {
    const evaluator = getRecruitEvaluator(options);
    if (typeof evaluator === "function") {
      const result = evaluator(candidates, {
        ...ctx,
        forceSummonAssessment: true,
      });
      if (Array.isArray(result?.scores)) {
        const pool = result.scores.some((entry) => !entry.blocked)
          ? result.scores.filter((entry) => !entry.blocked)
          : result.scores;
        return pool
          .slice()
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .map((entry) => entry.card)
          .filter(Boolean);
      }
      if (typeof result?.asBotSelect === "function") {
        return result.asBotSelect();
      }
      if (result?.best) return [result.best];
    }
  }

  const ranker = getStrategyRanker(options);
  if (intent !== "cost" && typeof ranker === "function") {
    const ranked = ranker(candidates, action, ctx);
    if (Array.isArray(ranked) && ranked.length > 0) return ranked;
  }

  const targetRef =
    "targetRef" in action && typeof action.targetRef === "string"
      ? action.targetRef
      : undefined;
  const actionId =
    "id" in action && typeof action.id === "string" ? action.id : undefined;
  const explicitTargetPreference = getTargetPreference(
    options,
    targetRef || actionId,
  );
  const targetPreference =
    intent === "cost"
      ? mergeCostPreference(explicitTargetPreference, getCostPreference(options))
      : explicitTargetPreference;

  return rankCandidates(candidates, intent === "summon" ? "benefit" : intent, {
    ...options,
    targetPreference,
  });
}

export function chooseSpecialSummonPosition(
  card: SimulatedCardState,
  action: SimulatedSummonActionShape,
  state: SimulatedRuntimeState,
  player: SimulatedPlayerState,
  options: SimulatedActionOptions = {},
): BattlePosition {
  if (action.position && action.position !== "choice") return action.position;
  const chooser =
    options.chooseSpecialSummonPosition ||
    options.strategy?.chooseSpecialSummonPosition?.bind(options.strategy);
  if (typeof chooser === "function") {
    const choice = chooser(card, {
      game: state,
      player,
      source: options.sourceCard,
      action,
      activationContext: options.activationContext,
    });
    if (choice === "attack" || choice === "defense") return choice;
  }
  return "attack";
}

function normalizeNegateEffectsDuration(
  action: SimulatedSummonActionShape,
): "while_faceup" | "until_end_turn" {
  return action.negateEffectsDuration === "while_faceup"
    ? "while_faceup"
    : "until_end_turn";
}

function assignSimulatedFieldPresenceId(
  card: SimulatedCardState,
  state: SimulatedRuntimeState,
): void {
  if (!card) return;
  if (state && typeof state === "object") {
    state._simFieldPresenceSeq = Number(state._simFieldPresenceSeq || 0) + 1;
    card.fieldPresenceId = `sim_fp_${card.id || "card"}_${state.turnCounter || 0}_${state._simFieldPresenceSeq}`;
    return;
  }
  card.fieldPresenceId = `sim_fp_${card.id || "card"}_0`;
}

export function applySummonState(
  card: SimulatedCardState,
  action: SimulatedSummonActionShape,
  state: SimulatedRuntimeState,
  player: SimulatedPlayerState,
  options: SimulatedActionOptions = {},
): void {
  assignSimulatedFieldPresenceId(card, state);
  card.position = chooseSpecialSummonPosition(card, action, state, player, options);
  card.isFacedown = false;
  card.hasAttacked = false;
  card.attacksUsedThisTurn = 0;
  if (action.cannotAttackThisTurn) card.cannotAttackThisTurn = true;
  if (action.destroySummonedAtEndPhase) {
    Reflect.set(card, "destroyAtEndPhase", true);
    Reflect.set(card, "destroyAtEndPhaseTurn", state.turnCounter);
    Reflect.set(card, "destroyAtEndPhaseSource", options.sourceCard?.name || null);
  }
  if (action.negateEffects) {
    card.effectsNegated = true;
    card.effectsNegatedDuration = normalizeNegateEffectsDuration(action);
  }
  if (action.setAtkToZeroAfterSummon) card.atk = 0;
  if (action.setDefToZeroAfterSummon) card.def = 0;
  if (Number.isFinite(action.atkBoostAfterSummon)) {
    const atkBoost = action.atkBoostAfterSummon ?? 0;
    card.tempAtkBoost =
      (card.tempAtkBoost || 0) + atkBoost;
  }
  if (Number.isFinite(action.defBoostAfterSummon)) {
    const defBoost = action.defBoostAfterSummon ?? 0;
    card.tempDefBoost =
      (card.tempDefBoost || 0) + defBoost;
  }
  applyStatusesOnSummon(card, action.statusesOnSummon);
}

export function pickCountForAction(
  action: { readonly count?: number | SelectionCount },
  fallback = 1,
): number {
  const count = normalizeCount(action.count, fallback);
  return Math.max(0, count.max);
}

export function hasRequiredSelections(
  targets: readonly EffectTarget[] = [],
  selections: CanonicalSelectionMap = {},
): boolean {
  return (targets || []).every((target) => {
    if (!target?.id) return true;
    const { min } = normalizeCount(target.count, 1);
    if (min <= 0) return true;
    return simulatedCardsFromSelection(selections[target.id]).length >= min;
  });
}
