import type {
  ActionConditionResult,
  ActionRuntimeCheckResult,
  LegacyActionHandlerResult,
  MaybePromise,
  NeedsSelectionResult,
  NormalizedActionExecutionResult,
  ResolvedTargetMap,
} from "../../contracts/actionRuntime.js";
import type { CardAction } from "../../contracts/actions.js";
import type { BattlePosition, CardKind } from "../../contracts/cards.js";
import type {
  EventCard,
  EventPlayer,
} from "../../contracts/events.js";
import type {
  CardFilter,
  DamageStepTiming,
  DuelEventName,
  EffectCondition,
  EffectDefinition,
  EffectTarget,
  EffectTiming,
  TriggerRequirement,
  TriggerTiming,
} from "../../contracts/effects.js";
import type { SummonMethod } from "../../contracts/summon.js";
import type {
  RawSelectionContract,
  RawSelectionRequirement,
} from "../../contracts/selection.js";
import type { ZoneInput } from "../../contracts/zones.js";

/** Runtime projection used only by trigger collection and resolution. */
export type TriggerRuntimeCard = Omit<EventCard, "effects"> & {
  name?: string | null;
  image?: string | null;
  uid?: number | string | null;
  effects?: readonly TriggerEffect[];
  declaredValues?: { [property: string]: unknown };
  lastSummonedFromZone?: ZoneInput | null;
  fieldPresenceId?: string;
  fieldPresenceState?: { [counter: string]: number } | null;
  state?: {
    specialSummonTypeCount?: { [typeName: string]: number };
  };
  __temporaryEventEffect?: boolean;
};

export interface TriggerStrategyPort {
  buildActivationContextForEffect?(input: {
    sourceCard: TriggerRuntimeCard;
    effect: TriggerEffectLike;
    player: TriggerRuntimePlayer;
    game: TriggerGamePort;
    activationZone?: TriggerZone;
  }): TriggerActivationContext | null;
}

export type TriggerRuntimePlayer = Omit<
  EventPlayer,
  | "deck"
  | "extraDeck"
  | "hand"
  | "field"
  | "spellTrap"
  | "graveyard"
  | "banished"
  | "fieldSpell"
> & {
  deck?: TriggerRuntimeCard[];
  extraDeck?: TriggerRuntimeCard[];
  hand?: TriggerRuntimeCard[];
  field?: TriggerRuntimeCard[];
  spellTrap?: TriggerRuntimeCard[];
  graveyard?: TriggerRuntimeCard[];
  banished?: TriggerRuntimeCard[];
  fieldSpell?: TriggerRuntimeCard | null;
  oncePerDuelUsageByName?: { [effectKey: string]: number | boolean };
  strategy?: TriggerStrategyPort | null;
};

export type TriggerPlayerReference = TriggerRuntimePlayer | string | null;
export type TriggerZone = ZoneInput | "temporary" | "token" | null;

export interface TriggerPassiveDefinition {
  readonly type: string;
  readonly scope?: string;
  readonly typeName?: string;
  readonly monsterType?: string;
  readonly summonMethods?: readonly SummonMethod[];
  readonly summonMethod?: SummonMethod | readonly SummonMethod[];
  readonly countOwner?: "self" | "opponent" | "any" | "both";
}

export interface TriggerCardFilter extends CardFilter {
  readonly fromZone?: string | readonly string[];
  readonly toZone?: string | readonly string[];
  readonly owner?: "self" | "opponent" | "any" | "both";
  readonly eventCardIsEquippedToSource?: boolean;
}

/**
 * Closed projection of the legacy trigger capabilities still consumed by the
 * runtime. The canonical declarative contract is stricter; this projection is
 * intentionally confined to the migration boundary.
 */
export interface TriggerEffectLike {
  readonly id?: string;
  readonly timing?: EffectTiming;
  readonly event?: DuelEventName | string;
  readonly actions?: readonly CardAction[];
  readonly targets?: readonly EffectTarget[];
  readonly conditions?: readonly EffectCondition[];
  readonly condition?: EffectCondition;
  readonly passive?: TriggerPassiveDefinition;
  readonly speed?: 1 | 2 | 3;
  readonly isQuickEffect?: boolean;
  readonly triggerRequirement?: TriggerRequirement;
  readonly triggerTiming?: TriggerTiming;
  readonly activationZones?: readonly ZoneInput[];
  readonly activatedCardFilters?: TriggerCardFilter;
  readonly activatedEffectFilters?: {
    readonly activationZone?: string | readonly string[];
    readonly placementOnly?: boolean;
    readonly timing?: EffectTiming;
  };
  readonly eventCardFilters?: TriggerCardFilter;
  readonly destroyedCardFilters?: TriggerCardFilter;
  readonly positionChangeSourceFilters?: TriggerCardFilter;
  readonly positionChangeSourceCardFilters?: TriggerCardFilter;
  readonly sourceCardFilters?: TriggerCardFilter;
  readonly lpChangeSourceFilters?: TriggerCardFilter;
  readonly counterCardFilters?: TriggerCardFilter;
  readonly removedCardFilters?: TriggerCardFilter;
  readonly requireActivatedCardFilters?: TriggerCardFilter;
  readonly requireActivatedEffectFilters?: TriggerCardFilter;
  readonly requireDestroyedCardFilters?: TriggerCardFilter;
  readonly requireEquipCardFilters?: TriggerCardFilter;
  readonly requireEquippedCardFilters?: TriggerCardFilter;
  readonly requireFaceup?: boolean;
  readonly requireFaceupAtFieldExit?: boolean;
  readonly allowIfEffectsNegatedAtFieldExit?: boolean;
  readonly requireOpponentSummon?: boolean;
  readonly requireSelfAsSummoned?: boolean;
  readonly requireSelfAsAttacker?: boolean;
  readonly requireSelfAsDefender?: boolean;
  readonly requireSelfAsBattleDestroyer?: boolean;
  readonly requireSelfAsDestroyed?: boolean;
  readonly requireSelfAsMoved?: boolean;
  readonly requireSelfAsChanged?: boolean;
  readonly requireSelfAsFlipped?: boolean;
  readonly requireSelfBattled?: boolean;
  readonly requireSelfDestroyedByBattle?: boolean;
  readonly requireDestroyedByOpponent?: boolean;
  readonly requireDestroyedIsOpponent?: boolean;
  readonly requireOpponentAttack?: boolean;
  readonly requireDefender?: boolean;
  readonly requireDefenderIsSelf?: boolean;
  readonly requireDefenderOwner?: "self" | "opponent";
  readonly requireDefenderPosition?: boolean;
  readonly requireDefenderType?: string;
  readonly requireDestroyedPosition?: BattlePosition;
  readonly destroyedPosition?: BattlePosition | readonly BattlePosition[];
  readonly requireEquippedAsAttacker?: boolean;
  readonly requireEquippedAsBattleDestroyer?: boolean;
  readonly requireOwnMonsterArchetype?: string;
  readonly requireSelfSummonProcedure?: string | readonly string[];
  readonly requireSelfWasSummonedBy?: SummonMethod | readonly SummonMethod[];
  readonly requireSummonedFrom?: ZoneInput;
  readonly requireZone?: ZoneInput;
  readonly requireRemovedFromField?: boolean;
  readonly requireMovedCardWasFaceup?: boolean;
  readonly requireMovedByEffect?: boolean;
  readonly requirePositionChangedByEffect?: boolean;
  readonly changedCardOwner?: "self" | "opponent" | "any" | "both";
  readonly eventCardOwner?: "self" | "opponent" | "any" | "both";
  readonly changedCardRequireFaceup?: boolean;
  readonly changedCardRequireFaceupBeforeChange?: boolean;
  readonly fromZone?: string | readonly string[];
  readonly toZone?: string | readonly string[];
  readonly summonFrom?: ZoneInput;
  readonly summonMethods?: readonly SummonMethod[];
  readonly triggerPlayer?: "current" | "opponent" | "self" | "any";
  readonly standbyPlayer?: "current" | "opponent" | "self" | "any" | "both";
  readonly endPhasePlayer?: "current" | "opponent" | "self" | "any" | "both";
  readonly phasePlayer?: "current" | "opponent" | "self" | "any" | "both";
  readonly requirePhase?: readonly string[];
  readonly movedByEffect?: boolean;
  readonly positionChangedByEffect?: boolean;
  readonly fromPosition?: BattlePosition | readonly BattlePosition[] | "any";
  readonly positionFrom?: BattlePosition | readonly BattlePosition[] | "any";
  readonly toPosition?: BattlePosition | readonly BattlePosition[] | "any";
  readonly positionTo?: BattlePosition | readonly BattlePosition[] | "any";
  readonly minAmount?: number;
  readonly minLpGained?: number;
  readonly counterType?: string;
  readonly counterTypes?: readonly string[];
  readonly damageStepTimings?: readonly DamageStepTiming[];
  readonly excludeActivatedSelf?: boolean;
  readonly placementOnly?: boolean;
  readonly oncePerTurn?: boolean;
  readonly oncePerTurnName?: string;
  readonly oncePerTurnScope?: "card";
  readonly oncePerTurnPerCard?: boolean;
  readonly oncePerTurnPerEventCard?: boolean;
  readonly oncePerDuel?: boolean | number;
  readonly oncePerDuelLimit?: number;
  readonly oncePerDuelMax?: number;
  readonly oncePerDuelName?: string;
  readonly promptUser?: boolean;
  readonly promptOnAttackDeclared?: boolean;
  readonly promptOnTargeted?: boolean;
  readonly promptMessage?: string;
  readonly customPromptMethod?: string;
  readonly contextLabel?: string;
  readonly contextLabels?: readonly string[];
}

export type TriggerEffect = EffectDefinition & TriggerEffectLike;

export type TriggerTargetResolution =
  | (Omit<NeedsSelectionResult, "selectionContract"> & {
      readonly ok?: boolean;
      readonly selectionContract: RawSelectionContract & {
        readonly requirements: RawSelectionRequirement[];
      };
      readonly targets?: ResolvedTargetMap;
    })
  | {
      readonly ok?: boolean;
      readonly needsSelection?: false;
      readonly selectionContract?: RawSelectionContract & {
        readonly requirements: RawSelectionRequirement[];
      };
      readonly reason?: string;
      readonly targets?: ResolvedTargetMap;
    };

export interface TriggerActionContext {
  targetPreferences?: object;
  costPreferences?: object;
  specialSummonPositions?: {
    byName?: object;
    byTargetRef?: object;
  };
}

export interface TriggerActivationContext {
  fromHand?: boolean;
  activationZone?: TriggerZone;
  sourceZone?: TriggerZone;
  sourceWasFacedown?: boolean;
  sourceAtTrigger?: object | null;
  selectionKind?: string;
  committed?: boolean;
  preview?: boolean;
  isPreview?: boolean;
  logTargets?: boolean;
  prepareOnly?: boolean;
  costsPaid?: boolean;
  confirmed?: boolean;
  skipPrompt?: boolean;
  resolutionSelections?: object | null;
  actionContext?: TriggerActionContext | null;
  triggeredByEvent?: string | null;
  damageStepTiming?: DamageStepTiming | null;
  excludedDamageStepTargets?: readonly TriggerRuntimeCard[];
}

export interface TriggerContext {
  source?: TriggerRuntimeCard | null;
  player?: TriggerRuntimePlayer | null;
  opponent?: TriggerRuntimePlayer | null;
  effect?: TriggerEffectLike | null;
  effectId?: string | null;
  activationZone?: TriggerZone;
  sourceZone?: TriggerZone;
  activationContext?: TriggerActivationContext | null;
  actionContext?: object | null;
  selections?: object | null;
  eventData?: object | null;
  eventCard?: TriggerRuntimeCard | null;
  movedCard?: TriggerRuntimeCard | null;
  changedCard?: TriggerRuntimeCard | null;
  summonedCard?: TriggerRuntimeCard | null;
  summonMethod?: SummonMethod | null;
  summonFromZone?: string | null;
  currentPhase?: string | null;
  attacker?: TriggerRuntimeCard | null;
  attackerOwner?: TriggerRuntimePlayer | null;
  defender?: TriggerRuntimeCard | null;
  defenderOwner?: TriggerRuntimePlayer | null;
  destroyed?: TriggerRuntimeCard | null;
  destroyedOwner?: TriggerRuntimePlayer | null;
  battleDestroyer?: TriggerRuntimeCard | null;
  battleDestroyers?: TriggerRuntimeCard[];
  destroyedPosition?: string | null;
  host?: TriggerRuntimeCard | null;
  target?: TriggerRuntimeCard | null;
  targetOwner?: TriggerRuntimePlayer | null;
  damageAmount?: number;
  damageDealt?: number;
  isDamageStep?: boolean;
  targetDestroyed?: boolean;
  attackerDestroyed?: boolean;
  damagedPlayer?: TriggerRuntimePlayer | null;
  fromZone?: string | null;
  toZone?: string | null;
  cause?: string | null;
}

export interface TriggerUsageCheck {
  readonly ok: boolean;
  readonly reason?: string;
  readonly code?: string;
  readonly reservation?: object;
  readonly lockKey?: string;
}

export type TriggerResolutionResult =
  | NormalizedActionExecutionResult
  | NeedsSelectionResult
  | LegacyActionHandlerResult
  | {
      readonly success: boolean;
      readonly needsSelection: boolean;
      readonly activationSkipped?: boolean;
      readonly prepared?: boolean;
      readonly reason?: string;
      readonly selectionContract?: RawSelectionContract;
      readonly effect?: TriggerEffectLike;
      readonly targets?: ResolvedTargetMap;
      readonly activationContext?: TriggerActivationContext;
      readonly resolutionContext?: TriggerContext;
      readonly actionResult?: object;
    };

export interface TriggerEntryConfig {
  readonly card: TriggerRuntimeCard;
  readonly effect: TriggerEffectLike;
  readonly owner: TriggerRuntimePlayer;
  readonly activationZone?: TriggerZone;
  readonly activationContext: TriggerActivationContext;
  readonly selectionKind: string;
  readonly selectionMessage: string;
  readonly allowDuringOpponentTurn: boolean;
  readonly allowDuringResolving: boolean;
  readonly suppressFailureLog: boolean;
  readonly oncePerTurn: {
    readonly card: TriggerRuntimeCard;
    readonly player: TriggerRuntimePlayer;
    readonly effect: TriggerEffectLike;
  };
  readonly activate: (
    selections: object | null | undefined,
    activationContext: TriggerActivationContext,
  ) => MaybePromise<TriggerResolutionResult>;
  readonly onSuccess: (
    result: TriggerResolutionResult,
    activationContext: TriggerActivationContext,
  ) => MaybePromise<void>;
}

export interface TriggerEntry {
  readonly summary: string;
  readonly card: TriggerRuntimeCard;
  readonly effect: TriggerEffectLike;
  readonly owner: TriggerRuntimePlayer;
  readonly triggerRequirement: TriggerRequirement | null;
  readonly triggerTiming: TriggerTiming | null;
  readonly sourceAtTrigger: object | null;
  readonly config: TriggerEntryConfig;
}

export interface TriggerPackage {
  readonly entries: TriggerEntry[];
  readonly orderRule: string;
  readonly onComplete?: () => MaybePromise<void>;
}

export interface BuildTriggerEntryOptions {
  readonly sourceCard?: TriggerRuntimeCard | null;
  readonly owner?: TriggerRuntimePlayer | null;
  readonly effect?: TriggerEffectLike | null;
  readonly activationContext?: TriggerActivationContext;
  readonly activationZone?: TriggerZone;
  readonly selectionKind?: string;
  readonly selectionMessage?: string;
  readonly summary?: string;
  readonly ctx?: TriggerContext;
  readonly guardKind?: string;
  readonly phaseReq?: string | null;
  readonly allowDuringSelection?: boolean;
  readonly allowDuringResolving?: boolean;
  readonly allowDuringOpponentTurn?: boolean;
  readonly skipTargetPreview?: boolean;
  readonly activate?: (
    selections: object | null | undefined,
    activationContext: TriggerActivationContext,
    resolvedContext: TriggerContext,
  ) => MaybePromise<TriggerResolutionResult>;
  readonly onSuccess?: (
    result: TriggerResolutionResult,
    activationContext: TriggerActivationContext,
  ) => MaybePromise<void>;
}

export interface TemporaryEventEffect {
  id?: string;
  event?: string;
  ownerId?: string;
  sourceCardId?: number;
  sourceName?: string;
  sourceCardKind?: CardKind;
  sourceCardSubtype?: string;
  sourceImage?: string;
  sourceInstanceId?: number | string | null;
  declaredValues?: { [property: string]: unknown };
  effect?: TriggerEffectLike;
  actions?: readonly CardAction[];
  expiresOnTurn?: number | null;
  usesRemaining?: number | null;
  boundEventTargetInstanceId?: number | string | null;
  requireBoundTargetLeavesField?: boolean;
  duration?: string;
}

export interface TriggerGamePort {
  player: TriggerRuntimePlayer;
  bot: TriggerRuntimePlayer;
  phase?: string;
  turn?: string;
  turnCounter?: number;
  devModeEnabled?: boolean;
  temporaryEventEffects?: TemporaryEventEffect[];
  pendingBattleDestructionCards?: readonly TriggerRuntimeCard[];
  getOpponent?(
    player: TriggerRuntimePlayer | null | undefined,
  ): TriggerRuntimePlayer | null;
  createDeterministicId?(prefix: string): string;
  canStartAction?(options: object): TriggerUsageCheck;
  canActivateCardEffectUnderRestrictions?(
    card: TriggerRuntimeCard,
    player: TriggerRuntimePlayer,
    effect: TriggerEffectLike,
    options?: object,
  ): TriggerUsageCheck;
  reserveEffectUsage?(options: {
    card: TriggerRuntimeCard | null | undefined;
    player: TriggerRuntimePlayer;
    effect: TriggerEffectLike;
  }): TriggerUsageReservation;
  settleEffectUsage?(
    reservation: TriggerUsageReservation,
    result: { success: boolean },
  ): object;
  queueVisualFeedback?(options: object): object | null;
  updateBoard?(): void;
  waitForAiPresentationStep?(player: TriggerRuntimePlayer): MaybePromise<void>;
  recordMaterialEffectActivation(
    player: TriggerRuntimePlayer,
    card: TriggerRuntimeCard,
    details: object,
  ): void;
  checkWinCondition(): void;
}

export interface TriggerUsageReservation {
  readonly success?: boolean;
  readonly status?: string;
}

export interface TriggerActionRegistryPort {
  has(type: string): boolean;
}

export interface TriggerUiPort {
  showConfirmPrompt?(message: string, options?: object): MaybePromise<boolean>;
}

export interface TriggerCollectorHost {
  readonly game: TriggerGamePort;
  readonly actionHandlers?: TriggerActionRegistryPort | null;
  readonly ui?: TriggerUiPort | null;
  updatePassiveBuffs(): void;
  findCardZone(
    player: TriggerRuntimePlayer,
    card: TriggerRuntimeCard,
  ): TriggerZone;
  getOwnerByCard(card: TriggerRuntimeCard): TriggerRuntimePlayer | null;
  cardMatchesFilters(
    card: TriggerRuntimeCard | null | undefined,
    filters?: TriggerCardFilter | object,
  ): boolean;
  effectMatchesFilters?(
    effect: TriggerEffectLike | null,
    filters: object,
    context?: object,
  ): boolean;
  checkOncePerTurn(
    card: TriggerRuntimeCard,
    player: TriggerRuntimePlayer,
    effect: TriggerEffectLike,
  ): TriggerUsageCheck;
  checkOncePerDuel(
    card: TriggerRuntimeCard,
    player: TriggerRuntimePlayer,
    effect: TriggerEffectLike,
  ): TriggerUsageCheck;
  checkEffectCondition(
    condition: EffectCondition | null | undefined,
    sourceCard: TriggerRuntimeCard,
    player: TriggerRuntimePlayer,
    summonedCard: TriggerRuntimeCard,
    sourceZone: TriggerZone,
    summonFromZone: string | null,
  ): boolean;
  evaluateConditions(
    conditions: readonly EffectCondition[],
    context: TriggerContext,
  ): ActionConditionResult;
  resolveTargets(
    targetDefinitions: readonly EffectTarget[],
    context: TriggerContext,
    selections?: object | null,
  ): TriggerTargetResolution;
  selectCandidates(
    targetDefinition: EffectTarget,
    context: TriggerContext,
  ): { candidates: TriggerRuntimeCard[] };
  checkActionPreviewRequirements?(
    actions: readonly CardAction[],
    context: TriggerContext,
  ): ActionRuntimeCheckResult;
  applyActions(
    actions: readonly CardAction[],
    context: TriggerContext,
    targets: ResolvedTargetMap,
  ): MaybePromise<NormalizedActionExecutionResult | NeedsSelectionResult>;
  handleTriggeredEffect(
    sourceCard: TriggerRuntimeCard,
    effect: TriggerEffectLike,
    context: TriggerContext,
    selections?: object | null,
  ): Promise<TriggerResolutionResult>;
  buildTriggerActivationContext(
    sourceCard: TriggerRuntimeCard,
    player: TriggerRuntimePlayer,
    zoneOverride?: TriggerZone,
  ): TriggerActivationContext;
  buildTriggerEntry(options: BuildTriggerEntryOptions): TriggerEntry | null;
  collectAfterSummonTriggers(payload: object): Promise<TriggerPackage>;
  collectSpellActivatedTriggers(payload: object): Promise<TriggerPackage>;
  collectEffectActivatedTriggers(payload: object): Promise<TriggerPackage>;
  collectBattleDestroyTriggers(payload: object): Promise<TriggerPackage>;
  collectBattleCompletedTriggers(payload: object): Promise<TriggerPackage>;
  collectCardToGraveTriggers(payload: object): Promise<TriggerPackage>;
  collectCardMovedTriggers(payload: object): Promise<TriggerPackage>;
  collectCounterRemovedTriggers(payload: object): Promise<TriggerPackage>;
  collectAttackDeclaredTriggers(payload: object): Promise<TriggerPackage>;
  collectBattleDamageTriggers(payload: object): Promise<TriggerPackage>;
  collectBattleDamageInflictedTriggers(payload: object): Promise<TriggerPackage>;
  collectCardFlippedTriggers(payload: object): Promise<TriggerPackage>;
  collectDamageStepTriggers(payload: object): Promise<TriggerPackage>;
  collectLpChangeTriggers(payload: object): Promise<TriggerPackage>;
  collectEffectTargetedTriggers(payload: object): Promise<TriggerPackage>;
  collectPositionChangeTriggers(payload: object): Promise<TriggerPackage>;
  collectCardEquippedTriggers(payload: object): Promise<TriggerPackage>;
  collectStandbyPhaseTriggers(payload: object): Promise<TriggerPackage>;
  collectEndPhaseTriggers(payload: object): Promise<TriggerPackage>;
}
