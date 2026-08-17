import type { CardAction } from "./actions.js";
import type {
  BattlePosition,
  CardKind,
  CardSubtype,
  MonsterType,
} from "./cards.js";
import type {
  ChainActivationKind,
  ChainContextType,
  ChainEffectKind,
  ChainFinalizationStatus,
  ChainPreparationStatus,
  ChainResolutionStatus,
  ChainResponseContextType,
  FastEffectContextType,
  FastEffectOrigin,
  FastEffectStateName,
  SegocGroup,
  SpellSpeed,
  TriggerEligibilityStatus,
} from "./chain.js";
import type {
  DamageStepTiming,
  DuelEventName,
  CardFilter,
  EffectCondition,
  EffectResponseContext,
  EffectTarget,
  EffectTiming,
  NumericComparisonOperator,
  TriggerRequirement,
  TriggerTiming,
  UsagePolicy,
} from "./effects.js";
import type {
  ChainId,
  ChainLinkId,
  DuelCardId,
  PlayerId,
  SelectionCandidateKey,
} from "./primitives.js";
import type {
  NormalizedSelectionContract,
  RawSelectionContract,
  SelectionKind,
  SelectionPurpose,
  SelectionResult,
} from "./selection.js";
import type { SummonMethod } from "./summon.js";
import type { CanonicalZone } from "./zones.js";

export type { ChainId, ChainLinkId } from "./primitives.js";

/** A value which may cross an asynchronous runtime boundary. */
export type ChainMaybePromise<Value> = Value | PromiseLike<Value>;

export type ChainEntityId = number | string;
export type ChainCardInstanceId = ChainEntityId | null;
export type ChainSourceZone = CanonicalZone | "token" | "temporary" | "unknown";
export type ChainActivationZone = CanonicalZone | null;
export type ChainPhase =
  | "draw"
  | "standby"
  | "main1"
  | "battle"
  | "main2"
  | "end";

/**
 * Compatibility fields read by the Chain runtime but not exposed as part of
 * the declarative authoring schema. They stay confined to this projection.
 */
export interface ChainEffect {
  readonly id?: string;
  readonly timing?: EffectTiming;
  readonly event?: DuelEventName | string;
  readonly speed?: SpellSpeed;
  readonly isQuickEffect?: boolean;
  readonly activationZones?: readonly CanonicalZone[];
  readonly activationCosts?: readonly CardAction[];
  readonly activationCommitActions?: readonly CardAction[];
  readonly actions?: readonly CardAction[];
  readonly targets?: readonly ChainEffectTarget[];
  readonly conditions?: readonly EffectCondition[];
  readonly canRespondTo?: readonly EffectResponseContext[];
  readonly triggerRequirement?: TriggerRequirement;
  readonly triggerTiming?: TriggerTiming;
  readonly usagePolicy?: UsagePolicy;
  readonly oncePerTurn?: boolean;
  readonly oncePerTurnLimit?: number;
  readonly oncePerTurnName?: string;
  readonly oncePerTurnScope?: "card";
  readonly oncePerTurnPerCard?: boolean;
  readonly oncePerTurnPerEventCard?: boolean;
  readonly oncePerDuel?: boolean | number;
  readonly oncePerDuelLimit?: number;
  readonly oncePerDuelName?: string;
  readonly requireFaceup?: boolean;
  readonly requireOpponentAttack?: boolean;
  readonly requireOpponentSummon?: boolean;
  readonly requireDefender?: boolean;
  readonly requireDefenderIsSelf?: boolean;
  readonly requireDefenderType?: string | readonly string[];
  readonly requirePhase?: readonly ChainPhase[] | ChainPhase;
  readonly requireZone?: CanonicalZone;
  readonly summonMethod?: SummonMethod;
  readonly summonMethods?: readonly SummonMethod[];
  readonly requiresSourceAtResolution?: boolean;
  readonly activationLabel?: string;
  readonly activationLabelKey?: string;
  readonly promptMessage?: string;
  readonly allowManualActivation?: boolean;
  /** Legacy read-only aliases retained at the runtime compatibility boundary. */
  readonly usesPerTurn?: number;
  readonly maxUsesPerTurn?: number;
  readonly oncePerDuelMax?: number;
  readonly placementOnly?: boolean;
}

export interface ChainEffectTarget extends Omit<EffectTarget, "position"> {
  readonly allowSelf?: boolean;
  readonly cardIds?: readonly number[];
  readonly faceUp?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly maxAtk?: number;
  readonly minDef?: number;
  readonly level?: number;
  readonly levelOp?: NumericComparisonOperator;
  readonly filters?: CardFilter;
  readonly position?: BattlePosition | "any";
  /** Added by the activation-selection normalizer without mutating authoring. */
  readonly resolvedCountFromSelectionRef?: string;
  readonly resolvedSelectionCount?: number;
  readonly cappedByTargetRefs?: readonly string[];
}

/** Minimal mutable Card projection actually observed by Chain modules. */
export interface ChainCard {
  id?: number;
  duelCardId?: DuelCardId | number;
  instanceId?: ChainEntityId | null;
  _instanceId?: ChainEntityId | null;
  uuid?: string | null;
  simInstanceId?: ChainEntityId | null;
  name: string;
  cardName?: string | null;
  cardKind?: CardKind | null;
  subtype?: CardSubtype | string | null;
  monsterType?: MonsterType | null;
  type?: string | null;
  archetype?: string | null;
  archetypes?: string[];
  owner?: PlayerId | string | null;
  controller?: PlayerId | string | null;
  position?: BattlePosition | string | null;
  isFacedown?: boolean;
  locationVersion?: number;
  level?: number;
  atk?: number;
  def?: number;
  piercing?: boolean;
  setTurn?: number | null;
  turnSetOn?: number | null;
  zone?: CanonicalZone | null;
  effects?: readonly ChainEffect[];
}

export interface ChainStrategyPort {
  chooseChainResponse?(input: {
    chainSystem: ChainRuntimePort;
    game: ChainGamePort | null;
    player: ChainPlayer;
    opponent: ChainPlayer | null;
    activatable: readonly ChainActivationCandidate[];
    context: FastEffectContextInput;
  }): ChainMaybePromise<ChainStrategyResponse | null>;
}

export interface ChainStrategyResponse {
  pass?: boolean;
  reason?: string;
  candidateKey?: string;
  card?: ChainCard;
  effect?: ChainEffect;
  activationContext?: PreparedActivationContext | null;
  context?: FastEffectContextInput | null;
  actionContext?: ChainActionContext | null;
}

/** Minimal mutable Player projection actually observed by Chain modules. */
export interface ChainPlayer {
  id: PlayerId | string;
  name?: string;
  controllerType?: string;
  lp: number;
  deck: ChainCard[];
  extraDeck: ChainCard[];
  hand: ChainCard[];
  field: ChainCard[];
  spellTrap: ChainCard[];
  graveyard: ChainCard[];
  banished: ChainCard[];
  fieldSpell: ChainCard | null;
  strategy?: ChainStrategyPort | null;
}

export interface ChainSourceSnapshot {
  cardInstanceId: ChainCardInstanceId;
  controllerId: PlayerId | string | null;
  zone: ChainSourceZone | null;
  faceUp: boolean;
  locationVersion: number;
}

export interface ChainDeclaredTarget {
  targetId: string | null;
  cards: ChainCard[];
}

export interface ChainTargetSnapshot {
  card: ChainCard;
  cardInstanceId: ChainCardInstanceId;
  controllerId: PlayerId | string | null;
  zone: ChainSourceZone | null;
  faceUp: boolean;
  locationVersion: number;
}

export interface ChainDeclaredTargetSnapshot {
  targetId: string | null;
  cards: ChainTargetSnapshot[];
}

/**
 * Selection references are data-defined, so Chain treats each channel as an
 * opaque record and uses Reflect at the few points which read or write keys.
 * The optional type-only marker keeps the public contract closed without
 * adding a runtime property or weakening every object with an index signature.
 */
declare const chainSelectionMapContract: unique symbol;
declare const chainSelectionKeyMapContract: unique symbol;
declare const chainSelectionCountMapContract: unique symbol;

export type ChainSelectionValue =
  | ChainCard
  | ChainCard[]
  | readonly string[]
  | { card: ChainCard }
  | string
  | number
  | boolean
  | null
  | undefined;

export interface ChainSelectionMap {
  readonly [chainSelectionMapContract]?: ChainSelectionValue;
}

export interface ChainSelectionKeyMap {
  readonly [chainSelectionKeyMapContract]?: readonly string[];
}

export interface ChainResolvedSelectionCounts {
  readonly [chainSelectionCountMapContract]?: number;
}

export interface ChainActivationCommitInfo {
  cardRef?: ChainCard | null;
  activationZone?: ChainActivationZone;
  fromIndex?: number;
  replacedFieldSpell?: ChainCard | null;
}

export interface ChainSummonTransactionReference {
  summonId?: ChainEntityId | null;
}

/** Fields propagated to EffectEngine while a Chain action is evaluated. */
export interface ChainActionContext extends ChainContextPayload {
  source?: ChainCard | null;
  sourceCard?: ChainCard | null;
  effectId?: string | null;
  activationContext?: PreparedActivationContext | null;
  actionContext?: ChainContextInput | null;
  preview?: boolean;
  isPreview?: boolean;
}

export interface ChainActionTraceEntry {
  index: number;
  type: string | null;
  targetRef?: string | null;
}

export interface ChainCostPayment {
  status: "not_required" | "paid";
  actions: ChainActionTraceEntry[];
}

export interface ChainActivationCommitment {
  status: "not_required" | "applied";
  actions: ChainActionTraceEntry[];
}

export interface ChainUsagePolicy {
  consumption: UsagePolicy | null;
  oncePerTurn: boolean;
  oncePerDuel: boolean;
  name: string | null;
  scope: "card" | null;
  perEventCard: boolean;
  limit: number | null;
}

export type ChainUsageReservationStatus =
  | "reserved"
  | "consumed"
  | "released";

export interface ChainUsageReservation {
  success?: boolean;
  ok?: boolean;
  code?: string;
  reason?: string;
  reservationId?: number;
  policy?: UsagePolicy | null;
  status?: ChainUsageReservationStatus;
  playerId?: PlayerId | string | null;
  turnKey?: string | null;
  duelKey?: string | null;
  oncePerTurn?: boolean;
  oncePerDuel?: boolean;
  chainId?: ChainId | number | null;
  linkId?: ChainLinkId | number | null;
  effectId?: string | null;
  sourceInstanceId?: ChainEntityId | null;
}

export interface ChainActivationAttempt {
  chainId?: ChainId;
  linkId?: ChainLinkId;
  card: ChainCard | null;
  controller: ChainPlayer | null;
  effect: ChainEffect | null;
  effectId: string | null;
  activationKind: ChainActivationKind;
  activationZone: ChainActivationZone;
  activationNegated: boolean;
}

export interface PreparedActivationContext {
  activationZone?: ChainActivationZone;
  sourceZone?: ChainSourceZone | null;
  sourceWasFacedown?: boolean;
  sourceAtTrigger?: ChainSourceSnapshot | null;
  sourceAtActivation?: ChainSourceSnapshot | null;
  fromHand?: boolean;
  cardActivation?: boolean;
  commitInfo?: ChainActivationCommitInfo | null;
  activationCommitment?: ChainActivationCommitment | null;
  triggeredByEvent?: string | null;
  selectionKind?: SelectionKind | string | null;
  committed?: boolean;
  payingActivationCosts?: boolean;
  applyingActivationCommitActions?: boolean;
  costSelections?: ChainSelectionMap;
  targetSelections?: ChainSelectionMap;
  resolutionSelections?: ChainSelectionMap;
  resolvedSelectionCounts?: ChainResolvedSelectionCounts;
  timing?: "activation" | string;
  purpose?: SelectionPurpose | "choice";
  autoSelectSingleTarget?: boolean;
  autoSelectTargets?: boolean;
  preview?: boolean;
  isPreview?: boolean;
  context?: ChainContextInput | null;
  actionContext?: ChainActionContext | ChainContextInput | null;
}

export interface ChainContextPayload {
  event?: string | null;
  card?: ChainCard | null;
  effect?: ChainEffect | null;
  player?: ChainPlayer | null;
  opponent?: ChainPlayer | null;
  controller?: ChainPlayer | null;
  triggerPlayer?: ChainPlayer | null;
  turnPlayer?: ChainPlayer | null;
  actionPlayer?: ChainPlayer | null;
  priorityPlayer?: ChainPlayer | null;
  attacker?: ChainCard | null;
  attackerOwner?: ChainPlayer | null;
  defender?: ChainCard | null;
  defenderOwner?: ChainPlayer | null;
  target?: ChainCard | null;
  targetOwner?: ChainPlayer | null;
  targets?: ChainCard[];
  destroyed?: ChainCard | null;
  destroyedOwner?: ChainPlayer | null;
  destroyedOwnerId?: PlayerId | string | null;
  destroyedPosition?: BattlePosition | string | null;
  battleDestroyer?: ChainCard | null;
  battleDestroyers?: (ChainCard | null | undefined)[];
  summonedCard?: ChainCard | null;
  method?: SummonMethod | null;
  summonMethod?: SummonMethod | null;
  fromZone?: ChainSourceZone | null;
  fromPhase?: ChainPhase | string | null;
  toPhase?: ChainPhase | string | null;
  currentPhase?: ChainPhase | string | null;
  nextPhase?: ChainPhase | string | null;
  isOpponentAttack?: boolean;
  isOpponentSummon?: boolean;
  damageStepTiming?: DamageStepTiming | null;
  activationZone?: ChainActivationZone;
  activationContext?: PreparedActivationContext | null;
  activationAttempt?: ChainActivationAttempt | null;
  _actionTargets?: ChainSelectionMap;
  _chainRootContext?: FastEffectContextInput | null;
  preparedActivation?: PreparedActivation | null;
  preparedActivations?: PreparedActivation[];
  negatedLink?: ChainLink | null;
  respondingToChainLink?: ChainLink | null;
  originalContext?: FastEffectContextInput | null;
  activationKind?: ChainActivationKind;
  effectKind?: ChainEffectKind;
  responseContextType?: ChainResponseContextType;
  firstPlayer?: ChainPlayer | null;
  timingOrigin?: FastEffectOrigin;
  timingWindowId?: number | null;
  summonId?: ChainEntityId | null;
  summonTransaction?: ChainSummonTransactionReference | null;
  timing?: DamageStepTiming | string | null;
  linkId?: ChainLinkId | number | null;
  triggerOpportunityId?: number | null;
  triggerOccurrenceId?: number | null;
  atomicGroupId?: number | null;
  segocGroup?: SegocGroup | null;
  segocOrder?: number | null;
  addTriggerToChain?: boolean;
  openState?: boolean;
  legalWindow?: boolean;
  skipTriggerLink?: boolean;
}

export type ChainRuntimeContextType =
  | ChainContextType
  | FastEffectContextType
  | DuelEventName;

type ChainContextOf<Type extends ChainRuntimeContextType> =
  ChainContextPayload & {
  type: Type;
};

/** Canonical runtime context: every accepted discriminant is explicit. */
export type ChainContext = {
  [Type in ChainRuntimeContextType]: ChainContextOf<Type>;
}[ChainRuntimeContextType];

/**
 * Compatibility boundary for callers which historically supplied an empty or
 * partially populated context before the Chain selected a concrete window.
 */
export interface ChainContextInput extends ChainContextPayload {
  type?: ChainRuntimeContextType;
}

export type FastEffectRuntimeContextType = ChainRuntimeContextType;

/**
 * Fast Effect boundary kept distinct from generic Chain input. Its optional
 * discriminant preserves the established empty-context calls while any value
 * that is present remains part of the closed runtime vocabulary.
 */
export interface FastEffectContextInput extends ChainContextPayload {
  type?: FastEffectRuntimeContextType;
}

export interface ChainPhaseIntent {
  fromPhase: ChainPhase | string | null;
  toPhase: ChainPhase | string | null;
}

export interface FastEffectState {
  state: FastEffectStateName;
  origin: FastEffectOrigin;
  timingWindowId: number | null;
  turnPlayerId: PlayerId | string | null;
  actionPlayerId: PlayerId | string | null;
  priorityPlayerId: PlayerId | string | null;
  lastLinkControllerId: PlayerId | string | null;
  chainId: ChainId | null;
  consecutivePasses: number;
  phaseIntent: ChainPhaseIntent | null;
}

export interface PreparedActivationInput {
  card?: ChainCard | null;
  controller?: ChainPlayer | null;
  opponent?: ChainPlayer | null;
  effect?: ChainEffect | null;
  activationZone?: ChainActivationZone;
  sourceZone?: ChainSourceZone | null;
  context?: ChainContextInput | null;
  activationContext?: PreparedActivationContext | null;
  activationAttempt?: Partial<ChainActivationAttempt> | null;
  activationKind?: ChainActivationKind;
  effectKind?: ChainEffectKind;
  responseContextType?: ChainResponseContextType;
  selectionKind?: SelectionKind | string | null;
  sourceAtTrigger?: ChainSourceSnapshot | null;
  sourceAtActivation?: ChainSourceSnapshot | null;
  costSelections?: ChainSelectionMap | null;
  targetSelections?: ChainSelectionMap | null;
  resolutionSelections?: ChainSelectionMap | null;
  resolvedSelectionCounts?: ChainResolvedSelectionCounts;
  costPayment?: ChainCostPayment | null;
  activationCommitment?: ChainActivationCommitment | null;
  declaredTargets?: ChainDeclaredTarget[];
  declaredTargetSnapshots?: ChainDeclaredTargetSnapshot[];
  targetValidation?: ChainTargetValidation | null;
  usagePolicy?: ChainUsagePolicy;
  usageReservation?: ChainUsageReservation | null;
  committed?: boolean;
  costsPaid?: boolean;
  requiresSourceAtResolution?: boolean;
  requiresSourceFaceUpAtResolution?: boolean;
  preparationStatus?: ChainPreparationStatus;
  resolutionStatus?: ChainResolutionStatus;
  finalizationStatus?: ChainFinalizationStatus;
  finalizationQueued?: boolean;
  activationNegated?: boolean;
  effectNegated?: boolean;
  sourceMoved?: boolean;
  sourceDestroyed?: boolean;
  latestSourceLocation?: ChainSourceSnapshot | null;
  resolvedWithoutEffect?: boolean;
  activationPublished?: boolean;
  effectTargetedResolved?: boolean;
  pipelineCompletion?: ChainPipelineCompletion | null;
  pipelineFinalization?: ChainPipelineFinalization | null;
  pipelineManaged?: boolean;
  skipDefaultFinalization?: boolean;
  triggerOpportunityId?: number | null;
  triggerOccurrenceId?: number | null;
  atomicGroupId?: number | null;
  segocGroup?: SegocGroup | null;
  segocOrder?: number | null;
  fromHand?: boolean;
  sourceWasFacedown?: boolean;
  cardActivation?: boolean;
}

/** Normalized, mutable activation state created by createPreparedActivation. */
export interface PreparedActivation extends PreparedActivationInput {
  card: ChainCard | null;
  controller: ChainPlayer | null;
  effect: ChainEffect | null;
  activationZone: ChainActivationZone;
  activationContext: PreparedActivationContext;
  activationAttempt: ChainActivationAttempt;
  activationKind: ChainActivationKind;
  effectKind: ChainEffectKind;
  responseContextType: ChainResponseContextType;
  sourceAtTrigger: ChainSourceSnapshot | null;
  sourceAtActivation: ChainSourceSnapshot | null;
  costSelections: ChainSelectionMap;
  targetSelections: ChainSelectionMap;
  resolutionSelections: ChainSelectionMap;
  costPayment: ChainCostPayment | null;
  activationCommitment: ChainActivationCommitment | null;
  usagePolicy: ChainUsagePolicy;
  committed: boolean;
  costsPaid: boolean;
  prepared: true;
  requiresSourceAtResolution: boolean;
  requiresSourceFaceUpAtResolution: boolean;
}

export interface ChainSourceValidity {
  valid: boolean;
  required: boolean;
  reason?:
    | "missing_source"
    | "source_wrong_zone"
    | "source_location_changed"
    | "source_not_face_up"
    | "source_invalid"
    | null;
  zone?: ChainSourceZone;
  expectedZone?: ChainSourceZone | null;
  controllerId?: PlayerId | string | null;
  locationVersion?: number;
  expectedLocationVersion?: number;
  sameLocation?: boolean;
  faceUp?: boolean;
}

export type ChainTargetInvalidReason =
  | "target_location_changed"
  | "target_wrong_zone"
  | "target_not_face_up"
  | "target_no_longer_matches"
  | "target_invalid";

export interface ChainTargetValidationCard {
  cardInstanceId: ChainCardInstanceId;
  valid: boolean;
  reason: ChainTargetInvalidReason | null;
  zone: ChainSourceZone;
  locationVersion: number;
}

export interface ChainTargetValidationGroup {
  targetId: string;
  minimum: number;
  minimumMet: boolean;
  cards: ChainTargetValidationCard[];
}

export interface ChainTargetValidation {
  satisfiesMinimums: boolean;
  groups: ChainTargetValidationGroup[];
}

export interface ChainOperationResult {
  ok?: boolean;
  success?: boolean;
  needsSelection?: boolean;
  reason?: string | null;
  code?: string;
  skipped?: boolean;
  deferred?: boolean;
  prepared?: boolean;
  committed?: boolean;
  cancelled?: boolean;
  costsPaid?: boolean;
  alreadyApplied?: boolean;
  added?: number;
  noRollback?: boolean;
  chainBuilt?: boolean;
  chainsDisabled?: boolean;
  pendingChainSelection?: boolean;
  phaseTransitionAllowed?: boolean;
  phaseTransitionInterrupted?: boolean;
  activationNegated?: boolean;
  effectNegated?: boolean;
  fizzled?: boolean;
  resolvedWithoutEffect?: boolean;
  error?: unknown;
  chainId?: ChainId | null;
  linkId?: ChainLinkId | null;
  occurrenceId?: number;
  opportunityId?: number;
  triggerCount?: number;
  selectedTriggerCount?: number;
  pendingCount?: number;
  selectionContract?: ChainSelectionContract | null;
  selectionSource?: string | null;
  baseTargets?: ChainSelectionMap | null;
  targets?: ChainSelectionMap;
  costSelections?: ChainSelectionMap;
  targetSelections?: ChainSelectionMap;
  resolutionSelections?: ChainSelectionMap;
  activationContext?: PreparedActivationContext | null;
  activationZone?: ChainActivationZone;
  targetValidation?: ChainTargetValidation | null;
  triggerPackages?: ChainTriggerInputPackage[];
  occurrences?: ChainTriggerOccurrence[];
  selectedCandidates?: ChainTriggerCandidate[];
  preparedActivation?: PreparedActivation;
  preparedActivations?: PreparedActivation[];
  candidate?: ChainActivationCandidate;
  state?: FastEffectState;
  entries?: ChainFinalizationSnapshot[];
  results?: unknown[];
  linkResults?: ChainOperationResult[];
  finalizationResult?: ChainOperationResult | null;
  resolutionResult?: ChainOperationResult | null;
  timing?: ChainOperationResult | null;
  responses?: ChainResponseNegotiation;
  lastLinkController?: ChainPlayer | null;
}

/** Normalized pipeline value returned by Game callbacks without changing its runtime shape. */
export interface ChainPipelineCallbackResult {
  success: boolean;
  ok: boolean;
  needsSelection: boolean;
}

export type ChainPipelineCompletion = (
  result: ChainOperationResult,
) => ChainMaybePromise<
  void | ChainOperationResult | ChainPipelineCallbackResult
>;

export type ChainPipelineFinalization = (
  result: ChainOperationResult,
  identity: {
    chainId: ChainId;
    linkId: ChainLinkId;
    finalizationId: number;
  },
) => ChainMaybePromise<
  void | ChainOperationResult | ChainPipelineCallbackResult
>;

/** Canonical mutable link stored in the LIFO stack. */
export interface ChainLink {
  chainId: ChainId;
  linkId: ChainLinkId;
  chainLevel: number;
  controller: ChainPlayer;
  opponent: ChainPlayer | null;
  card: ChainCard;
  effect: ChainEffect;
  effectId: string | null;
  spellSpeed: SpellSpeed;
  activationZone: ChainActivationZone;
  activationKind: ChainActivationKind;
  effectKind: ChainEffectKind;
  responseContextType: ChainResponseContextType;
  context: FastEffectContextInput | null;
  activationContext: PreparedActivationContext;
  activationAttempt: ChainActivationAttempt;
  costSelections: ChainSelectionMap;
  targetSelections: ChainSelectionMap;
  resolutionSelections: ChainSelectionMap;
  resolvedSelectionCounts: ChainResolvedSelectionCounts;
  costPayment: ChainCostPayment | null;
  activationCommitment: ChainActivationCommitment | null;
  declaredTargets: ChainDeclaredTarget[];
  declaredTargetSnapshots: ChainDeclaredTargetSnapshot[];
  targetValidation: ChainTargetValidation | null;
  committed: boolean;
  costsPaid: boolean;
  usagePolicy: ChainUsagePolicy;
  usageReservation: ChainUsageReservation | null;
  sourceAtTrigger: ChainSourceSnapshot | null;
  sourceAtActivation: ChainSourceSnapshot | null;
  requiresSourceAtResolution: boolean;
  requiresSourceFaceUpAtResolution: boolean;
  preparationStatus: ChainPreparationStatus;
  resolutionStatus: ChainResolutionStatus;
  finalizationStatus: ChainFinalizationStatus;
  finalizationQueued: boolean;
  activationNegated: boolean;
  effectNegated: boolean;
  sourceMoved: boolean;
  sourceDestroyed: boolean;
  latestSourceLocation: ChainSourceSnapshot | null;
  resolvedWithoutEffect: boolean;
  activationPublished: boolean;
  effectTargetedResolved: boolean;
  pipelineCompletion: ChainPipelineCompletion | null;
  pipelineCompletionDone?: boolean;
  pipelineFinalization: ChainPipelineFinalization | null;
  pipelineManaged: boolean;
  skipDefaultFinalization: boolean;
  triggerOpportunityId: number | null;
  triggerOccurrenceId: number | null;
  atomicGroupId: number | null;
  segocGroup: SegocGroup | null;
  segocOrder: number | null;
  negatedBy?: ChainCard | null;
  effectNegatedBy?: ChainCard | null;
  effectNegationReason?: string | null;
  sourceValidity?: ChainSourceValidity | null;
}

export interface SerializedChainCard {
  id: number | null;
  instanceId: ChainCardInstanceId;
  name: string | null;
  owner: PlayerId | string | null;
}

export interface SerializedChainLink {
  chainId: ChainId | null;
  linkId: ChainLinkId | null;
  chainLevel: number | null;
  controllerId: PlayerId | string | null;
  opponentId: PlayerId | string | null;
  cardId: number | null;
  cardInstanceId: ChainCardInstanceId;
  cardName: string;
  effectId: string | null;
  spellSpeed: SpellSpeed | null;
  activationZone: ChainActivationZone;
  activationKind: ChainActivationKind | null;
  effectKind: ChainEffectKind | null;
  responseContextType: ChainResponseContextType | null;
  costsPaid: boolean;
  committed: boolean;
  declaredTargets: {
    targetId: string | null;
    cards: SerializedChainCard[];
  }[];
  declaredTargetSnapshots: {
    targetId: string | null;
    cards: Omit<ChainTargetSnapshot, "card">[];
  }[];
  targetValidation: ChainTargetValidation | null;
  costSelections: ChainSelectionMap;
  targetSelections: ChainSelectionMap;
  resolutionSelections: ChainSelectionMap;
  resolvedSelectionCounts: ChainResolvedSelectionCounts;
  costPayment: ChainCostPayment | null;
  activationCommitment: ChainActivationCommitment | null;
  usagePolicy: ChainUsagePolicy | null;
  usageReservation: ChainUsageReservation | null;
  sourceAtTrigger: ChainSourceSnapshot | null;
  sourceAtActivation: ChainSourceSnapshot | null;
  latestSourceLocation: ChainSourceSnapshot | null;
  sourceValidity: ChainSourceValidity | null;
  requiresSourceAtResolution: boolean;
  requiresSourceFaceUpAtResolution: boolean;
  preparationStatus: ChainPreparationStatus | null;
  resolutionStatus: ChainResolutionStatus | null;
  finalizationStatus: ChainFinalizationStatus | null;
  finalizationQueued: boolean;
  activationNegated: boolean;
  effectNegated: boolean;
  effectNegationReason: string | null;
  sourceMoved: boolean;
  sourceDestroyed: boolean;
  resolvedWithoutEffect: boolean;
  triggerOpportunityId: number | null;
  triggerOccurrenceId: number | null;
  atomicGroupId: number | null;
  segocGroup: SegocGroup | null;
  segocOrder: number | null;
}

export interface ChainActivationCandidate {
  candidateKey: string;
  card: ChainCard;
  effect: ChainEffect;
  effectId: string | null;
  player: ChainPlayer;
  controller: ChainPlayer;
  sourceZone: CanonicalZone;
  sourceLocationVersion: number;
  spellSpeed: SpellSpeed;
  context: FastEffectContextInput;
  effectLabel: string;
  activationLabelKey: string | null;
  category?: "monster_effect" | "spell_trap_effect";
  legality?: ChainActivationLegality;
  activationContext?: PreparedActivationContext | null;
  selectionKind?: SelectionKind | string | null;
  costSelections?: ChainSelectionMap;
  targetSelections?: ChainSelectionMap;
  resolutionSelections?: ChainSelectionMap;
  priority?: number;
}

export interface ChainActivationLegality {
  ok: boolean;
  code: string;
  reason: string | null;
  allowedZones?: CanonicalZone[];
}

export interface ChainResponseNegotiation {
  offers: number;
  activations: number;
  consecutivePasses: number;
  lastActivator: ChainPlayer | null;
  chainBuilt: boolean;
}

export interface ChainWindowOptions {
  firstPlayer?: ChainPlayer | null;
  secondPlayer?: ChainPlayer | null;
  initialPasses?: number;
  preparedActivations?: PreparedActivation[];
}

export interface FastEffectTimingInput {
  origin?: FastEffectOrigin;
  turnPlayer?: ChainPlayer | null;
  actionPlayer?: ChainPlayer | null;
  priorityPlayer?: ChainPlayer | null;
  preparedActivation?: PreparedActivation | null;
  preparedActivations?: PreparedActivation[];
  context?: FastEffectContextInput;
  phaseIntent?: ChainPhaseIntent | null;
  deferPostChainWindow?: boolean;
  suppressTriggerCollection?: boolean;
  pauseAfterRootResolution?: boolean;
}

export interface FastEffectTransitionDetails {
  origin?: FastEffectOrigin;
  timingWindowId?: number | null;
  turnPlayer?: ChainPlayer | null;
  actionPlayer?: ChainPlayer | null;
  priorityPlayer?: ChainPlayer | null;
  lastLinkController?: ChainPlayer | null;
  chainId?: ChainId | null;
  consecutivePasses?: number;
  phaseIntent?: ChainPhaseIntent | null;
}

export interface FastEffectPriorityDetails {
  consecutivePasses?: number;
  chainId?: ChainId | null;
  linkId?: ChainLinkId | null;
  lastLinkController?: ChainPlayer | null;
}

export type FastEffectPriorityDecision = "offered" | "activate" | "pass";

export type ChainSelectionContract =
  | RawSelectionContract
  | NormalizedSelectionContract
  | ChainCompatibilitySelectionContract
  | ChainTargetSelectionContract
  | TriggerOrderSelectionContract;

export interface ChainCompatibilitySelectionContract
  extends Omit<RawSelectionContract, "kind" | "purpose"> {
  kind?: SelectionKind;
  purpose?: SelectionPurpose | "choice";
}

export interface ChainSelectionCandidateReference {
  key?: SelectionCandidateKey;
  cardRef?: ChainCard | null;
}

export interface ChainSelectionRequirement {
  id: string;
  min?: number;
  max?: number;
  candidates?: ChainSelectionCandidateReference[];
}

/** Mutable activation-time contract returned by EffectEngine.resolveTargets. */
export interface ChainTargetSelectionContract {
  kind?: SelectionKind;
  timing?: string;
  purpose?: SelectionPurpose | "choice";
  message?: string | null;
  requirements: ChainSelectionRequirement[];
  ui?: {
    allowCancel?: boolean;
    preventCancel?: boolean;
  };
}

export interface TriggerOrderSelectionContract {
  kind: "trigger_order";
  group: SegocGroup | null;
  optional: boolean;
  candidates: (SerializedTriggerCandidate | null)[];
}

export interface ChainSelectionSessionInput {
  kind?: SelectionKind | "trigger_order";
  selectionContract: ChainSelectionContract;
  owner?: ChainPlayer | null;
  player?: ChainPlayer | null;
  controller?: ChainPlayer | null;
  card?: ChainCard | null;
  attacker?: ChainCard | null;
  message?: string | null;
  allowCancel?: boolean;
  preventCancel?: boolean;
  useFieldTargeting?: boolean;
  allowEmpty?: boolean;
  autoAdvanceOnMax?: boolean;
  activationContext?: PreparedActivationContext | null;
  replayCommandDescriptor?: ChainReplayCommandDescriptor | null;
  resolve?(value: SelectionResult | ChainCard[] | null): void;
  execute?(
    selections: SelectionResult,
  ): ChainMaybePromise<ChainOperationResult | boolean | null | undefined>;
  rollback?(): void;
  onResult?(result: ChainOperationResult): unknown;
  onCancel?: (() => void) | null;
}

/** Descriptor is forwarded untouched to the canonical replay recorder. */
export interface ChainReplayCommandDescriptor {
  type: string;
  actorId?: PlayerId | string | null;
  payload?: unknown;
}

export interface PendingChainSelection {
  link: ChainLink;
  selectionContract: ChainSelectionContract | null;
  selectionSource: string;
  baseTargets: ChainSelectionMap | null;
}

export interface ChainTriggerEntryConfig {
  card?: ChainCard;
  effect?: ChainEffect;
  owner?: ChainPlayer;
  activationZone?: CanonicalZone;
  activationContext?: PreparedActivationContext;
  sourceAtTrigger?: ChainSourceSnapshot | null;
  selectionKind?: SelectionKind | string | null;
  activate?: (
    selections?: ChainSelectionMap | null,
    activationContext?: PreparedActivationContext,
    context?: FastEffectContextInput,
  ) => ChainMaybePromise<ChainOperationResult>;
}

export interface ChainTriggerEntry {
  card?: ChainCard;
  effect?: ChainEffect;
  owner?: ChainPlayer;
  sourceAtTrigger?: ChainSourceSnapshot | null;
  config?: ChainTriggerEntryConfig;
  pipeline?: ChainTriggerEntryConfig;
  summary?: string | null;
}

export type ChainTriggerCompletion = () => ChainMaybePromise<unknown>;

export interface ChainTriggerPackage {
  entries: ChainTriggerEntry[];
  orderRule: string | null;
  onComplete: ChainTriggerCompletion | null;
}

export interface ChainTriggerCollectionResult {
  entries?: ChainTriggerEntry[];
  payload?: ChainEventPayload;
  occurrence?: ChainTriggerOccurrence | null;
  orderRule?: string | null;
  onComplete?: ChainTriggerCompletion | null;
}

export interface ChainTriggerOccurrenceOptions {
  entries?: ChainTriggerEntry[];
  entriesProvided?: boolean;
  onComplete?: ChainTriggerCompletion | null;
  orderRule?: string | null;
  atomicGroupId?: number | null;
  sequence?: number;
}

export interface ChainEventPayload extends ChainContextPayload {
  atomicGroupId?: number | null;
}

export interface ChainTriggerOccurrence {
  occurrenceId: number;
  atomicGroupId: number;
  eventName: string;
  sequence: number;
  turnCounter: number;
  phase: ChainPhase | string | null;
  chainId: ChainId | null;
  resolvingLinkId: ChainLinkId | null;
  payload: ChainEventPayload;
  snapshot: unknown;
  entries: ChainTriggerEntry[] | null;
  entriesProvided: boolean;
  orderRule: string | null;
  onComplete: ChainTriggerCompletion | null;
}

/** Reduced occurrence emitted by NullChainSystem while Chains are disabled. */
export interface DisabledChainTriggerOccurrence {
  occurrenceId: number;
  atomicGroupId: number;
  eventName: string;
  payload: ChainEventPayload;
  entries: ChainTriggerEntry[] | null;
  entriesProvided: boolean;
  orderRule: string | null;
  onComplete: ChainTriggerCompletion | null;
}

export type ChainRuntimeTriggerOccurrence =
  | ChainTriggerOccurrence
  | DisabledChainTriggerOccurrence;

export interface ChainTriggerCandidate {
  candidateId: number;
  occurrenceId: number;
  atomicGroupId: number;
  eventName: string;
  eventSnapshot: unknown;
  card: ChainCard;
  effect: ChainEffect;
  controller: ChainPlayer;
  opponent: ChainPlayer | null;
  triggerRequirement: TriggerRequirement;
  triggerTiming: TriggerTiming;
  sourceAtTrigger: ChainSourceSnapshot | null;
  collectorOrder: number;
  sourceOrder: number;
  effectOrder: number;
  config: ChainTriggerEntryConfig;
  summary: string;
  eligibilityStatus: TriggerEligibilityStatus;
  rejectionReason: string | null;
  segocGroup?: SegocGroup;
}

export interface ChainTriggerGroups {
  turn_player_mandatory: ChainTriggerCandidate[];
  opponent_mandatory: ChainTriggerCandidate[];
  turn_player_optional: ChainTriggerCandidate[];
  opponent_optional: ChainTriggerCandidate[];
}

export interface ChainTriggerOpportunity {
  opportunityId: number;
  occurrences: ChainTriggerOccurrence[];
  occurrenceIds: number[];
  lastRelevantAtomicGroupId: number | null;
  turnPlayer: ChainPlayer | null;
  groups: ChainTriggerGroups;
  candidates: ChainTriggerCandidate[];
  selectedCandidates: ChainTriggerCandidate[];
  declinedCandidates: ChainTriggerCandidate[];
  rejectedCandidates: ChainTriggerCandidate[];
  selecting: boolean;
}

export interface PendingTriggerSelection {
  opportunity: ChainTriggerOpportunity;
}

export interface SerializedTriggerCandidate {
  candidateId: number | null;
  occurrenceId: number | null;
  atomicGroupId: number | null;
  eventName: string | null;
  controllerId: PlayerId | string | null;
  cardId: number | null;
  cardInstanceId: ChainCardInstanceId;
  cardName: string | null;
  effectId: string | null;
  triggerRequirement: TriggerRequirement | null;
  triggerTiming: TriggerTiming | null;
  segocGroup: SegocGroup | null;
  eligibilityStatus: TriggerEligibilityStatus | null;
  rejectionReason: string | null;
}

export interface ChainTriggerState {
  opportunityId: number | null;
  pendingOccurrenceCount: number;
  selecting: boolean;
  occurrenceIds: number[];
  groups: {
    turn_player_mandatory: (SerializedTriggerCandidate | null)[];
    opponent_mandatory: (SerializedTriggerCandidate | null)[];
    turn_player_optional: (SerializedTriggerCandidate | null)[];
    opponent_optional: (SerializedTriggerCandidate | null)[];
  };
}

/** Reduced, intentionally empty grouping exposed while Chains are disabled. */
export interface DisabledChainTriggerState {
  opportunityId: null;
  pendingOccurrenceCount: number;
  selecting: false;
  occurrenceIds: number[];
  groups: {
    turn_player_mandatory?: (SerializedTriggerCandidate | null)[];
    opponent_mandatory?: (SerializedTriggerCandidate | null)[];
    turn_player_optional?: (SerializedTriggerCandidate | null)[];
    opponent_optional?: (SerializedTriggerCandidate | null)[];
  };
}

export type ChainRuntimeTriggerState =
  | ChainTriggerState
  | DisabledChainTriggerState;

export interface ChainFinalizationOutcome {
  success: boolean;
  activationNegated: boolean;
  effectNegated: boolean;
  fizzled: boolean;
  resolvedWithoutEffect: boolean;
  reason: string | null;
}

export interface ChainFinalizationEntry {
  finalizationId: number;
  chainId: ChainId;
  linkId: ChainLinkId;
  chainLevel: number;
  card: ChainCard;
  cardInstanceId: ChainCardInstanceId;
  cardName: string;
  controller: ChainPlayer;
  controllerId: PlayerId | string | null;
  activationZone: ChainActivationZone;
  activationKind: ChainActivationKind | null;
  cardKind: CardKind | null;
  subtype: string | null;
  sourceLocationVersion: number;
  status: ChainFinalizationStatus;
  disposition: ChainSourceZone | string | null;
  outcome: ChainFinalizationOutcome;
  rawOutcome: ChainOperationResult;
  link: ChainLink;
}

export type ChainFinalizationSnapshot = Omit<
  ChainFinalizationEntry,
  "card" | "controller" | "link" | "rawOutcome"
>;

export interface ChainFinalizationState {
  finalizing: boolean;
  pendingCount: number;
  entries: (ChainFinalizationSnapshot | null)[];
}

export interface ChainDecisionRequest {
  kind: "chain_response" | "segoc_order";
  actor: ChainPlayer | null;
  candidates: readonly (ChainActivationCandidate | ChainTriggerCandidate)[];
  contextSnapshot: ChainDecisionContextSnapshot;
  resolveAI?: () => unknown;
  resolveHuman?: () => unknown;
}

export interface ChainResponseDecisionContextSnapshot {
  type: ChainRuntimeContextType | null;
  chainId: ChainId | null;
  respondingToLinkId: ChainLinkId | null;
}

export interface ChainSegocDecisionContextSnapshot {
  group: SegocGroup | null;
  optional: boolean;
}

export type ChainDecisionContextSnapshot =
  | ChainResponseDecisionContextSnapshot
  | ChainSegocDecisionContextSnapshot;

export interface ChainAutoSelectionOptions {
  owner: ChainPlayer;
  selectionContract: ChainSelectionContract;
  selectionKind: "cost" | "target";
}

export interface ChainTriggerOrderModalOptions {
  group: SegocGroup | null;
  optional: boolean;
  candidates: readonly ChainTriggerCandidate[];
  onConfirm(ordered: unknown): void;
  onCancel(): void;
}

export interface ChainConfirmPromptOptions {
  kind?: "segoc_optional_trigger";
  cardName?: string;
  effectId?: string | null;
  event?: string | null;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface ChainAutoSelectorPort {
  select(
    contract: ChainSelectionContract,
    options?: ChainAutoSelectionOptions,
  ):
    | { ok: false; reason?: string }
    | { ok: true; selections: SelectionResult };
  orderTriggerCandidates?(
    candidates: ChainTriggerCandidate[],
    options: { group: SegocGroup | null; optional: boolean },
  ): ChainTriggerCandidate[];
}

export interface ChainUiPort {
  log?(message: string): void;
  isLeftMouseHeldForChainSkip?(): boolean;
  updatePriorityIndicator?(state: FastEffectState): void;
  showChainResponseModal?(
    candidates: readonly ChainActivationCandidate[],
    context: FastEffectContextInput,
    summary: readonly SerializedChainLink[],
    options?: { signal?: AbortSignal },
  ): ChainMaybePromise<ChainActivationCandidate | null>;
  offerTrapActivation?(
    cards: ChainCard[],
    message: string,
  ): ChainMaybePromise<{ card?: ChainCard } | null>;
  showTriggerOrderModal?(options: ChainTriggerOrderModalOptions): unknown;
  showConfirmPrompt?(
    message: string,
    options?: ChainConfirmPromptOptions,
  ): ChainMaybePromise<boolean>;
}

export interface ChainTargetResolution {
  ok?: boolean;
  needsSelection?: boolean;
  reason?: string;
  targets?: ChainSelectionMap;
  selectionContract?: ChainTargetSelectionContract;
}

export interface ChainEffectEnginePort {
  applyActions(
    actions: readonly CardAction[],
    context: ChainActionContext,
    targets: ChainSelectionMap,
  ): ChainMaybePromise<ChainOperationResult>;
  resolveTargets(
    definitions: readonly ChainEffectTarget[],
    context: ChainActionContext,
    selections: ChainSelectionMap | null,
  ): ChainTargetResolution;
  checkActionPreviewRequirements?(
    actions: readonly CardAction[],
    context: ChainActionContext,
  ): { ok?: boolean; code?: string; reason?: string };
  evaluateConditions?(
    conditions: readonly EffectCondition[],
    context: ChainActionContext,
  ): { ok?: boolean; reason?: string };
  cardMatchesFilters?(card: ChainCard, filters: CardFilter): boolean;
  checkOncePerTurn?(
    card: ChainCard,
    player: ChainPlayer,
    effect: ChainEffect,
  ): { ok?: boolean; reason?: string };
  collectEventTriggers?(
    eventName: string,
    payload: ChainEventPayload,
  ): ChainMaybePromise<ChainTriggerPackage | ChainTriggerEntry[]>;
  isEffectNegated?(card: ChainCard): boolean;
  handleBlueprintStorageAfterResolution?(
    card: ChainCard,
    effect: ChainEffect,
    context: ChainActionContext,
  ): ChainMaybePromise<unknown>;
}

export interface ChainPendingEventSelection {
  eventName: string;
}

export interface ChainMoveCardOptions {
  fromZone?: ChainActivationZone;
  sourceCard?: ChainCard | null;
  effectId?: string | null;
  chainId?: ChainId | null;
  linkId?: ChainLinkId | null;
  contextLabel?: string;
  awaitEvents?: boolean;
  deferCardToGraveTriggerResolution?: boolean;
}

/** Minimal Game surface consumed by Chain modules. */
export interface ChainGamePort {
  player: ChainPlayer;
  bot: ChainPlayer;
  turn?: PlayerId | string;
  phase?: ChainPhase | string;
  turnCounter?: number;
  eventResolutionCounter?: number;
  pendingEventSelection?: ChainPendingEventSelection | null;
  _flushingPendingTriggerOccurrences?: boolean;
  ui?: ChainUiPort | null;
  renderer?: ChainUiPort | null;
  effectEngine?: ChainEffectEnginePort | null;
  autoSelector?: ChainAutoSelectorPort | null;
  random?(): number;
  getOpponent?(player: ChainPlayer | null): ChainPlayer | null;
  notify?(eventName: string, payload?: unknown): void;
  emit?(
    eventName: string,
    payload: ChainEventPayload,
    options?: { collectTriggersOnly?: boolean },
  ): ChainMaybePromise<ChainTriggerCollectionResult | null>;
  emitEffectActivated?(
    payload: ChainEventPayload,
    options?: { collectTriggersOnly?: boolean },
  ): ChainMaybePromise<ChainTriggerCollectionResult | null>;
  updateBoard?(): void;
  checkWinCondition?(): void;
  ensureDuelCardId?(card: ChainCard): DuelCardId | number | null;
  getDamageStepState?(): {
    timing?: DamageStepTiming | string | null;
  };
  canActivateCardEffectUnderRestrictions?(
    card: ChainCard,
    player: ChainPlayer | null,
    effect: ChainEffect,
    options?: { silent?: boolean },
  ): { ok: boolean; code?: string; reason?: string };
  checkEffectUsage?(input: {
    card: ChainCard;
    player: ChainPlayer;
    effect: ChainEffect;
  }): ChainUsageCheck;
  reserveEffectUsage?(input: {
    card: ChainCard;
    player: ChainPlayer;
    effect: ChainEffect;
    chainId: ChainId;
    linkId: ChainLinkId;
  }): ChainUsageReservation | null;
  settleEffectUsage?(
    reservation: ChainUsageReservation,
    outcome: { activationNegated: boolean; effectNegated: boolean },
  ): ChainUsageReservation | null;
  releaseEffectUsageReservations?(reason: string): void;
  requestDecision?(request: ChainDecisionRequest): ChainMaybePromise<unknown>;
  startTargetSelectionSession?(session: ChainSelectionSessionInput): unknown;
  resumePendingEventSelection?(
    selections: ChainSelectionMap | SelectionResult,
  ): ChainMaybePromise<ChainOperationResult>;
  flushPendingTriggerOccurrences?(options?: {
    reason?: string;
  }): ChainMaybePromise<ChainOperationResult>;
  runActivationPipelineWait?(
    input: ChainActivationPipelineInput,
  ): ChainMaybePromise<ChainOperationResult>;
  presentSpellTrapActivationFlip?(
    card: ChainCard,
    player: ChainPlayer,
    zone: ChainActivationZone,
  ): ChainMaybePromise<void>;
  moveCard?(
    card: ChainCard,
    player: ChainPlayer,
    destination: CanonicalZone,
    options?: ChainMoveCardOptions,
  ): ChainMaybePromise<ChainOperationResult | boolean | null | undefined>;
}

export interface ChainActivationPipelineInput {
  card?: ChainCard;
  effect?: ChainEffect;
  owner?: ChainPlayer;
  activationZone?: CanonicalZone;
  activationContext?: PreparedActivationContext;
  selectionKind?: SelectionKind | string | null;
  activate?: ChainTriggerEntryConfig["activate"];
  prepareForExistingChain?: boolean;
  allowDuringChainWindow?: boolean;
  allowDuringResolving?: boolean;
  allowDuringOpponentTurn?: boolean;
}

export interface ChainUsageCheck {
  ok: boolean;
  policy?: UsagePolicy | null;
  code?: string;
  reason?: string;
  scope?: "turn" | "duel";
}

/**
 * Shared public surface implemented by both ChainSystem and NullChainSystem.
 * Real-only mutation and coordinator operations live in capability contracts.
 */
export interface ChainRuntimePort extends ChainSelectionHost {
  readonly chainsDisabled?: boolean;
  chainWindowOpen: boolean;
  isResolving: boolean;
  currentChainLevel: number;
  activeChainId: ChainId | null;
  isPreparingActivation?: boolean;
  pendingTriggerOccurrences: ChainRuntimeTriggerOccurrence[];
  pendingTriggerSelection?: PendingTriggerSelection | null;
  _flushingPendingTriggerOccurrences?: boolean;
  fastEffectState: FastEffectState;
  log(...args: unknown[]): void;
  isChainResolving(): boolean;
  isChainWindowOpen(): boolean;
  isOpenGameState(): boolean;
  getActivatableCardsInChain(
    player: ChainPlayer,
    context: FastEffectContextInput,
  ): ChainActivationCandidate[];
  getEffectActivationZones(
    card: ChainCard,
    effect: ChainEffect,
  ): CanonicalZone[];
  determineCardZone(
    card: ChainCard | null,
    player?: ChainPlayer | null,
  ): CanonicalZone | "unknown" | null;
  checkActivationUsage(
    card: ChainCard,
    player: ChainPlayer,
    effect: ChainEffect,
  ): ChainUsageCheck;
  getChainLength(): number;
  getLastChainLink(): ChainLink | null;
  getChainSummary(): SerializedChainLink[];
  getFastEffectState(): FastEffectState;
  allocateAtomicEventGroupId(providedId?: number | null): number;
  createTriggerOccurrence(
    eventName: string,
    payload?: ChainEventPayload,
    options?: ChainTriggerOccurrenceOptions,
  ): ChainRuntimeTriggerOccurrence | null;
  queueTriggerOccurrence(
    occurrence: ChainRuntimeTriggerOccurrence | null | undefined,
  ): ChainOperationResult;
  resolveTriggerOccurrences(
    occurrences?: ChainRuntimeTriggerOccurrence[],
    options?: {
      actionPlayer?: ChainPlayer | null;
      context?: FastEffectContextInput;
      deferPostChainWindow?: boolean;
    },
  ): ChainMaybePromise<ChainOperationResult>;
  getTriggerState(): ChainRuntimeTriggerState;
  resetTriggerState(options?: {
    clearPending?: boolean;
  }): ChainRuntimeTriggerState;
  resetFastEffectTiming(options?: { notify?: boolean }): FastEffectState;
  runFastEffectTiming(
    input?: FastEffectTimingInput,
  ): ChainMaybePromise<ChainOperationResult>;
  canActivateInChain(
    effect?: ChainEffect,
    card?: ChainCard,
    context?: FastEffectContextInput,
  ): { ok: boolean; reason?: string; requiredSpeed?: SpellSpeed };
  openChainWindow(
    context?: FastEffectContextInput,
    options?: ChainWindowOptions,
  ): ChainMaybePromise<ChainOperationResult | false>;
  openActivationChain(
    prepared?: PreparedActivationInput,
  ): ChainMaybePromise<ChainOperationResult>;
  openEventWindow(
    context?: FastEffectContextInput,
  ): ChainMaybePromise<ChainOperationResult>;
  createPreparedActivation(input?: PreparedActivationInput): PreparedActivation;
  getEffectActivationCosts(effect?: ChainEffect | null): readonly CardAction[];
  getActivationCostTargetDefinitions(
    effect?: ChainEffect | null,
  ): ChainEffectTarget[];
  getDeclaredTargetDefinitions(
    effect?: ChainEffect | null,
  ): ChainEffectTarget[];
  getEffectActivationCommitActions(
    effect?: ChainEffect | null,
  ): readonly CardAction[];
  getEffectResolutionActions(effect?: ChainEffect | null): readonly CardAction[];
  payActivationCosts(
    prepared: PreparedActivation,
    context?: FastEffectContextInput | null,
  ): ChainMaybePromise<ChainOperationResult>;
  applyActivationCommitActions(
    prepared: PreparedActivation,
    context?: FastEffectContextInput | null,
  ): ChainMaybePromise<ChainOperationResult>;
  offerChainResponse(
    player?: ChainPlayer | null,
    context?: FastEffectContextInput,
  ): ChainMaybePromise<
    ChainActivationCandidate | ChainOperationResult | null
  >;
  addToChain(prepared: PreparedActivation): ChainLink | null | false;
  resolveChain(): ChainMaybePromise<ChainOperationResult | false>;
  cancelChain(): void;
  getChainFinalizationState(): ChainFinalizationState;
  resetChainFinalizationState(reason?: string): ChainFinalizationState;
  releaseAllUsageReservations(reason?: string): void;
}

/** Minimal host needed by the selection module and its Null implementation. */
export interface ChainSelectionHost {
  game: ChainGamePort | null;
  getOpponent(player: ChainPlayer | null): ChainPlayer | null;
  resolveSelectionsToCards?(
    selections: ChainSelectionKeyMap,
    requirements: readonly ChainSelectionRequirement[],
    player: ChainPlayer,
  ): ChainSelectionMap;
  getPlayerSelectionsForDefinitions(
    card: ChainCard,
    definitions: readonly ChainEffectTarget[],
    player: ChainPlayer,
    context: FastEffectContextInput | null,
    options?: {
      purpose?: "cost" | "target";
      allowCancel?: boolean;
      activationZone?: CanonicalZone | null;
    },
  ): ChainMaybePromise<ChainSelectionMap | null>;
}

/** Real Chain-only source movement integration. */
export interface ChainSourceMovementCapability {
  recordChainSourceMovement(
    card: ChainCard,
    movement?: {
      wasDestroyed?: boolean;
      toPlayer?: ChainPlayer | null;
      toZone?: ChainSourceZone | null;
    },
  ): number;
}

/** Real Chain-only Fast Effect transition used by external orchestration. */
export interface ChainFastEffectTransitionCapability {
  transitionFastEffectState(
    state: FastEffectStateName,
    details?: FastEffectTransitionDetails,
  ): FastEffectState;
}

/** Real Chain-only turn-player lookup used by external orchestration. */
export interface ChainTurnPlayerCapability {
  getCurrentTurnPlayer(): ChainPlayer | null;
}

interface ChainInternalTimingHost {
  recordFastEffectPriority(
    player: ChainPlayer,
    decision: FastEffectPriorityDecision,
    details?: FastEffectPriorityDetails,
  ): void;
  resolveTimingPlayer(id: PlayerId | string | null): ChainPlayer | null;
}

/** Real Chain-only raw stack and negation mutation. */
export interface ChainLinkMutationCapability {
  markChainLinkActivationNegated(
    linkOrId: ChainLink | ChainLinkId | number | null | undefined,
    details?: { negatedBy?: ChainCard | null },
  ): ChainLink | null;
  markChainLinkEffectNegated(
    linkOrId: ChainLink | ChainLinkId | number | null | undefined,
    details?: { negatedBy?: ChainCard | null },
  ): ChainLink | null;
}

/**
 * Complete mutable host used only as `this` for the real attached modules.
 * NullChainSystem intentionally does not conform to this contract.
 */
export interface FullChainHost
  extends ChainRuntimePort,
    ChainSourceMovementCapability,
    ChainFastEffectTransitionCapability,
    ChainTurnPlayerCapability,
    ChainInternalTimingHost,
    ChainLinkMutationCapability {
  chainStack: ChainLink[];
  chainWindowContext: FastEffectContextInput | null;
  cardsBeingResolved: Set<ChainCard>;
  pendingChainSelection: PendingChainSelection | null;
  isPreparingActivation: boolean;
  activeResponseAbortController: AbortController | null;
  responseTimeoutMs: number;
  chainEventCompletions: ChainTriggerCompletion[];
  chainTriggerEffectsOffered: Map<ChainCard, Set<ChainEffect>>;
  nextTimingWindowId: number;
  nextTriggerOccurrenceId: number;
  nextAtomicEventGroupId: number;
  nextTriggerOpportunityId: number;
  nextTriggerCandidateId: number;
  activeTriggerOpportunity: ChainTriggerOpportunity | null;
  pendingTriggerSelection: PendingTriggerSelection | null;
  pendingTriggerOccurrences: ChainTriggerOccurrence[];
  _flushingPendingTriggerOccurrences: boolean;
  activeTimingWindowId: number | null;
  timingDepth: number;
  nextChainId: number;
  nextLinkId: number;
  nextFinalizationId: number;
  pendingChainFinalizations: ChainFinalizationEntry[];
  isFinalizingChain: boolean;
  currentFinalizingLink: ChainLink | null;
  currentResolvingLink: ChainLink | null;
  devMode: boolean;
  getUI(): ChainUiPort | null;
  getNonTurnPlayer(): ChainPlayer | null;
  resolveSelectionsToCards(
    selections: ChainSelectionKeyMap,
    requirements: readonly ChainSelectionRequirement[],
    player: ChainPlayer,
  ): ChainSelectionMap;
  createChainLink(
    prepared?: PreparedActivationInput,
    contextOverride?: FastEffectContextInput | null,
  ): ChainLink;
  addToChain(prepared: PreparedActivation): ChainLink | null;
  serializeChainLink(link?: ChainLink | null): SerializedChainLink | null;
  setChainLinkResolutionStatus(
    linkOrId: ChainLink | ChainLinkId | number,
    status: ChainResolutionStatus,
    details?: {
      resolvedWithoutEffect?: boolean;
      finalizationStatus?: ChainFinalizationStatus;
    },
  ): ChainLink | null;
  getUsagePolicy(effect?: ChainEffect | null): UsagePolicy | null;
  reserveUsageForChainLink(
    link: ChainLink,
  ): ChainUsageReservation | null;
  settleUsageForChainLink(link: ChainLink): ChainUsageReservation | null;
  queueChainFinalization(
    link: ChainLink,
    outcome?: ChainOperationResult,
  ): ChainFinalizationSnapshot | null;
  finalizeWholeChain(options?: {
    chainId?: ChainId | null;
  }): ChainMaybePromise<ChainOperationResult>;
  buildTriggerOpportunity(
    occurrences?: ChainTriggerOccurrence[],
  ): ChainTriggerOpportunity | null;
  collectTriggerCandidates(
    opportunity: ChainTriggerOpportunity,
  ): ChainMaybePromise<ChainTriggerCandidate[]>;
  revalidateTriggerCandidate(
    candidate: ChainTriggerCandidate,
    opportunity: ChainTriggerOpportunity,
  ): { ok: boolean; reason?: string };
  orderTriggerCandidates(
    candidates?: ChainTriggerCandidate[],
    options?: { group?: SegocGroup; optional?: boolean },
  ): ChainMaybePromise<ChainOperationResult & {
    candidates?: ChainTriggerCandidate[];
  }>;
  prepareTriggerOpportunity(
    opportunity: ChainTriggerOpportunity | null,
  ): ChainMaybePromise<ChainOperationResult & {
    selectedCandidates?: ChainTriggerCandidate[];
  }>;
  prepareTriggerPackages(
    packages?: ChainTriggerInputPackage[],
    options?: { parentContext?: FastEffectContextInput | null },
  ): ChainMaybePromise<ChainOperationResult>;
  createTriggerOccurrence(
    eventName: string,
    payload?: ChainEventPayload,
    options?: ChainTriggerOccurrenceOptions,
  ): ChainTriggerOccurrence | null;
  queueTriggerOccurrence(
    occurrence: ChainTriggerOccurrence | null | undefined,
  ): ChainOperationResult;
  resolveTriggerOccurrences(
    occurrences?: ChainTriggerOccurrence[],
    options?: {
      actionPlayer?: ChainPlayer | null;
      context?: FastEffectContextInput;
      deferPostChainWindow?: boolean;
    },
  ): ChainMaybePromise<ChainOperationResult>;
  getTriggerState(): ChainTriggerState;
  resetTriggerState(options?: { clearPending?: boolean }): ChainTriggerState;
  getEffectSpellSpeed(
    effect?: ChainEffect | null,
    card?: ChainCard | null,
  ): SpellSpeed;
  getRequiredSpellSpeed(context?: FastEffectContextInput): SpellSpeed;
  effectCanRespondToContext(
    effect: ChainEffect,
    contextType?: string | null,
  ): boolean;
  getCurrentChainActivationContext(
    context?: FastEffectContextInput,
  ): FastEffectContextInput | null;
  getEffectChainResponseContext(
    effect: ChainEffect,
    context?: FastEffectContextInput,
  ): FastEffectContextInput | null;
  effectHasAction(effect: ChainEffect, actionType: string): boolean;
  isSummonNegationResponse(effect: ChainEffect): boolean;
  requiresExplicitSummonResponse(context?: FastEffectContextInput): boolean;
  isExplicitAfterSummonEventResponse(
    effect: ChainEffect,
    context?: FastEffectContextInput,
  ): boolean;
  canOfferEffectInChainContext(
    effect: ChainEffect,
    context?: FastEffectContextInput,
  ): boolean;
  findActivatableEffect(
    card: ChainCard,
    context: FastEffectContextInput,
    player: ChainPlayer,
    zone?: CanonicalZone,
    preferredEffect?: ChainEffect,
  ): ChainEffect | null;
  findQuickMonsterEffect(
    card: ChainCard,
    context: FastEffectContextInput,
    player: ChainPlayer,
    zone?: CanonicalZone,
    preferredEffect?: ChainEffect,
  ): ChainEffect | null;
  getActivationCandidateKey(
    card: ChainCard,
    effect: ChainEffect,
    sourceZone: CanonicalZone,
  ): string;
  revalidateActivationCandidate(
    candidate: ChainActivationCandidate,
    player: ChainPlayer,
    context: FastEffectContextInput,
  ): {
    ok: boolean;
    code?: string;
    reason?: string | null;
    candidate?: ChainActivationCandidate;
  };
  effectRequiresSourceAtResolution(
    card: ChainCard,
    effect: ChainEffect,
    zone?: CanonicalZone | null,
  ): boolean;
  refreshPreparedActivationSourceSnapshot(
    prepared: PreparedActivation,
  ): PreparedActivation;
  publishChainLinkActivation(
    link: ChainLink | null | false,
  ): ChainMaybePromise<ChainOperationResult>;
  appendActivationTriggerPackages(
    result: ChainOperationResult,
    context?: FastEffectContextInput | null,
  ): ChainMaybePromise<ChainOperationResult>;
  completeActivationTriggerPackages(): ChainMaybePromise<void>;
  prepareChainResponse(
    candidate: ChainActivationCandidate,
    player: ChainPlayer,
    context?: FastEffectContextInput | null,
  ): ChainMaybePromise<ChainOperationResult>;
  offerChainResponses(
    firstPlayer: ChainPlayer,
    secondPlayer: ChainPlayer | null,
    context: FastEffectContextInput,
    options?: { initialPasses?: number },
  ): ChainMaybePromise<ChainResponseNegotiation>;
  offerChainResponse(
    player?: ChainPlayer | null,
    context?: FastEffectContextInput,
  ): ChainMaybePromise<ChainActivationCandidate | null>;
  botChooseChainResponse(
    player: ChainPlayer,
    activatable: ChainActivationCandidate[],
    context: FastEffectContextInput,
  ): ChainMaybePromise<ChainActivationCandidate | null>;
  playerChooseChainResponse(
    player: ChainPlayer,
    activatable: ChainActivationCandidate[],
    context: FastEffectContextInput,
  ): ChainMaybePromise<ChainActivationCandidate | null>;
  effectRequiresTargets(effect?: ChainEffect): boolean;
  getPlayerSelectionsForEffect(
    card: ChainCard,
    effect: ChainEffect,
    player: ChainPlayer,
    context: FastEffectContextInput | null,
  ): ChainMaybePromise<ChainSelectionMap | null>;
  startPendingChainSelection(
    result?: ChainOperationResult,
  ): Promise<unknown> | false;
  resumePendingChainSelection(
    selections?: ChainSelectionMap | SelectionResult,
  ): ChainMaybePromise<ChainOperationResult | false>;
  resolveChainLink(
    link: ChainLink,
  ): ChainMaybePromise<ChainOperationResult | undefined>;
  getChainSourceValidity(link: ChainLink): ChainSourceValidity;
  isCardStillValid(
    card: ChainCard,
    player: ChainPlayer,
    zone: CanonicalZone,
  ): boolean;
}

export interface ChainTriggerInputPackage {
  eventName: string;
  payload?: ChainEventPayload;
  entries?: ChainTriggerEntry[];
  orderRule?: string | null;
  onComplete?: ChainTriggerCompletion | null;
  atomicGroupId?: number | null;
  occurrence?: ChainTriggerOccurrence | null;
}

function hasFunction(value: unknown, key: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, key) === "function"
  );
}

/** Narrow optional integrations without exposing a permissive base port. */
export function hasChainSourceMovementCapability(
  value: unknown,
): value is ChainSourceMovementCapability {
  return hasFunction(value, "recordChainSourceMovement");
}

export function hasChainFastEffectTransitionCapability(
  value: unknown,
): value is ChainFastEffectTransitionCapability {
  return hasFunction(value, "transitionFastEffectState");
}

export function hasChainTurnPlayerCapability(
  value: unknown,
): value is ChainTurnPlayerCapability {
  return hasFunction(value, "getCurrentTurnPlayer");
}

export function hasChainLinkMutationCapability(
  value: unknown,
): value is ChainLinkMutationCapability {
  return (
    hasFunction(value, "markChainLinkActivationNegated") &&
    hasFunction(value, "markChainLinkEffectNegated")
  );
}

/** Identifies the concrete coordinator without adding a marker at runtime. */
export function isFullChainHost(value: unknown): value is FullChainHost {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "chainsDisabled") !== true &&
    hasFunction(value, "createChainLink") &&
    hasFunction(value, "resolveChainLink") &&
    hasFunction(value, "buildTriggerOpportunity")
  );
}
