import type {
  BattlePosition,
  CardKind,
  MonsterType,
} from "./cards.js";
import type {
  ChainActivationKind,
  ChainEffectKind,
  ChainResponseContextType,
} from "./chain.js";
import type {
  DamageStepTiming,
  EffectDefinition,
} from "./effects.js";
import type { SummonMethod, SummonOrigin } from "./summon.js";
import type { RawSelectionContract } from "./selection.js";
import type { CanonicalZone, LegacyZoneAlias } from "./zones.js";

export type MaybeEventPromise<Value> = Value | PromiseLike<Value>;
export type EventEntityId = number | string;
export type EventZone =
  | CanonicalZone
  | LegacyZoneAlias
  | "temporary"
  | "token";
export type EventPhase =
  | "draw"
  | "standby"
  | "main1"
  | "battle"
  | "main2"
  | "end";

/**
 * Small mutable projections used at the event boundary. They describe only
 * data observed by event consumers; the complete Card and Player models stay
 * owned by their later migration stage.
 */
export interface EventCard {
  id?: number | null;
  name?: string | null;
  cardName?: string | null;
  instanceId?: EventEntityId | null;
  _instanceId?: EventEntityId | null;
  duelCardId?: number | null;
  uuid?: string | null;
  simInstanceId?: EventEntityId | null;
  cardKind?: CardKind | null;
  cardType?: string | null;
  originalCardKind?: CardKind | null;
  subtype?: string | null;
  monsterType?: MonsterType | null;
  type?: string | null;
  archetype?: string | null;
  archetypes?: string[];
  owner?: string | null;
  originalOwner?: string | null;
  controller?: string | null;
  /** Card.js remains a JavaScript producer whose mutable state is string-typed. */
  position?: string | null;
  previousPosition?: string | null;
  isFacedown?: boolean;
  locationVersion?: number;
  atk?: number;
  def?: number;
  baseAtk?: number;
  baseDef?: number;
  level?: number;
  counters?: Map<string, number> | object;
  effects?: readonly EffectDefinition[];
  equippedTo?: EventCard | null;
  equipTarget?: EventCard | EventEntityId | null;
  lastEquippedCardLeftField?: EventCard | null;
  lastSummonMethod?: SummonMethod | null;
  lastSummonFromZone?: EventZone | null;
  lastSummonProcedure?: string | null;
  effectsNegated?: boolean;
  effectsNegatedDuration?: string | number | null;
}

export interface EventPlayer {
  id: string;
  name?: string;
  controllerType?: string;
  lp?: number;
  deck?: EventCard[];
  extraDeck?: EventCard[];
  hand?: EventCard[];
  field?: EventCard[];
  spellTrap?: EventCard[];
  graveyard?: EventCard[];
  banished?: EventCard[];
  fieldSpell?: EventCard | null;
}

/** Legacy counter producers may expose the duel seat before resolving it. */
export type EventPlayerReference = EventPlayer | "player" | "bot";

export interface EventActionContext {
  type?: string | null;
  event?: string | null;
  effectId?: string | null;
  activationZone?: EventZone | null;
  sourceZone?: EventZone | null;
  triggeredByEvent?: string | null;
  damageStepId?: EventEntityId | null;
  damageStepTiming?: DamageStepTiming | null;
  isDamageStep?: boolean;
  attackRedirect?: AttackRedirect | null;
  redirectedTarget?: EventCard | null;
  redirectedTargetOwner?: EventPlayer | null;
}

export interface AttackRedirect {
  target: EventCard;
  targetOwner?: EventPlayer | null;
  source?: EventCard | null;
  reason?: string | null;
}

/** Shared mutable capabilities present across the established event payloads. */
export interface EventPayloadBase {
  type?: string | null;
  reason?: string | null;
  event?: string | null;
  card?: EventCard | null;
  player?: EventPlayer | null;
  opponent?: EventPlayer | null;
  source?: EventCard | null;
  sourceCard?: EventCard | null;
  sourcePlayer?: EventPlayer | null;
  target?: EventCard | null;
  targetOwner?: EventPlayer | null;
  targets?: EventCard[];
  attacker?: EventCard | null;
  attackerOwner?: EventPlayer | null;
  defender?: EventCard | null;
  defenderOwner?: EventPlayer | null;
  destroyed?: EventCard | null;
  destroyedOwner?: EventPlayer | null;
  movedCard?: EventCard | null;
  changedCard?: EventCard | null;
  eventCard?: EventCard | null;
  effect?: EffectDefinition | null;
  effectId?: string | null;
  sourceEvent?: string | null;
  fromZone?: EventZone | null;
  toZone?: EventZone | null;
  activationZone?: EventZone | null;
  method?: SummonMethod | null;
  summonMethod?: SummonMethod | null;
  summonOrigin?: SummonOrigin | null;
  summonProcedure?: string | null;
  summonId?: EventEntityId | null;
  chainId?: EventEntityId | null;
  linkId?: EventEntityId | null;
  atomicGroupId?: EventEntityId | null;
  actionContext?: EventActionContext | null;
  activationContext?: EventActionContext | null;
  damageStepId?: EventEntityId | null;
  damageStepTiming?: DamageStepTiming | null;
  isDamageStep?: boolean;
  amount?: number;
  damageDealt?: number;
  before?: number | null;
  after?: number | null;
  lpGained?: number;
  directAttack?: boolean;
  targetDestroyed?: boolean;
  attackerDestroyed?: boolean;
  attackRedirect?: AttackRedirect | null;
  redirectedTarget?: EventCard | null;
  redirectedTargetOwner?: EventPlayer | null;
  isOpponentAttack?: boolean;
}

export interface AfterSummonEventPayload extends EventPayloadBase {
  card: EventCard;
  player: EventPlayer;
  method: SummonMethod;
  fromZone: EventZone;
  opponent?: EventPlayer | null;
  summonId?: EventEntityId | null;
  summonOrigin?: SummonOrigin | null;
  tributes?: EventCard[];
  position?: BattlePosition;
}

export interface AttackDeclaredEventPayload extends EventPayloadBase {
  attacker: EventCard;
  attackerOwner: EventPlayer;
  defender: EventCard | null;
  defenderOwner: EventPlayer;
  target: EventCard | null;
  targetOwner: EventPlayer;
  battleStep?: string | null;
  damageStepTiming?: null;
}

export interface DamageStepEventPayload extends EventPayloadBase {
  damageStepId: EventEntityId;
  damageStepTiming: DamageStepTiming;
  isDamageStep: true;
  attacker: EventCard;
  defender: EventCard | null;
  target: EventCard | null;
  attackerOwner: EventPlayer;
  defenderOwner: EventPlayer;
  targetOwner: EventPlayer;
  player: EventPlayer;
  triggerPlayer?: EventPlayer;
  directAttack: boolean;
  wasFacedownAtStart?: boolean;
  flippedCard?: EventCard | null;
  damagedPlayer?: EventPlayer | null;
  amount: number;
  damageDealt: number;
  before: number | null;
  after: number | null;
  lpGained: number;
  pendingBattleDestructionCards: EventCard[];
  targetDestroyed: boolean;
  attackerDestroyed: boolean;
}

export interface BattleDestroyEventPayload extends DamageStepEventPayload {
  battleDestroyer: EventCard | null;
  battleDestroyers: EventCard[];
  destroyed: EventCard;
  destroyedOwner: EventPlayer;
  destroyedOwnerId?: string | null;
  destroyedPosition?: BattlePosition | null;
}

export interface CardMovedEventPayload extends EventPayloadBase {
  card: EventCard;
  fromZone: EventZone;
  toZone: EventZone;
  locationVersion?: number;
  player: EventPlayer | null;
  opponent?: EventPlayer | null;
  fromPlayer: EventPlayer;
  toPlayer: EventPlayer;
  contextLabel?: string | null;
  wasDestroyed?: boolean;
  destroyCause?: string | null;
  movedByEffect?: boolean;
  wasFaceupBeforeMove?: boolean;
}

export interface CardToGraveEventPayload extends EventPayloadBase {
  card: EventCard;
  fromZone: EventZone;
  toZone?: "graveyard";
  player: EventPlayer;
  opponent?: EventPlayer | null;
  wasDestroyed?: boolean;
  destroyCause?: string | null;
  destroySource?: EventCard | null;
  contextLabel?: string | null;
  deferTargetPrecheck?: boolean;
  effectsNegatedAtFieldExit?: boolean;
}

export type CounterRemovedEventPayload = Omit<
  EventPayloadBase,
  "player" | "opponent"
> & {
  player?: EventPlayerReference | null;
  opponent?: EventPlayerReference | null;
  counterType: string;
  amount: number;
  card: EventCard | null;
  cards: EventCard[];
  zones: string[];
  uniqueZones?: string[];
  fromField: boolean;
};

export interface PhaseEventPayload extends EventPayloadBase {
  player: EventPlayer;
  opponent: EventPlayer | null;
}

export interface EffectTargetedEventPayload extends EventPayloadBase {
  source: EventCard;
  sourceCard?: EventCard;
  sourcePlayer?: EventPlayer;
  player: EventPlayer;
  target: EventCard;
  targetOwner: EventPlayer;
  targetId?: number | null;
}

export interface PositionChangeEventPayload extends EventPayloadBase {
  card: EventCard;
  player: EventPlayer;
  opponent?: EventPlayer | null;
  fromPosition: BattlePosition;
  toPosition: BattlePosition;
  wasFlipped?: boolean;
  wasSetFacedown?: boolean;
  battlePositionLocked?: boolean;
  positionChangedByEffect?: boolean;
}

export interface CardEquippedEventPayload extends EventPayloadBase {
  equipCard: EventCard;
  equipOwner: EventPlayer;
  target: EventCard;
  targetOwner: EventPlayer;
}

export interface ActivationEventPayload extends EventPayloadBase {
  card: EventCard;
  player: EventPlayer;
  owner?: EventPlayer | null;
  effect?: EffectDefinition | null;
  effectType?: string | null;
  placementOnly?: boolean;
  fromHand?: boolean;
  chainLevel?: number;
  trigger?: string | null;
  chainLink?: object | null;
  triggerOpportunityId?: EventEntityId | null;
  triggerOccurrenceId?: EventEntityId | null;
  triggerAtomicGroupId?: EventEntityId | null;
  segocGroup?: string | null;
  segocOrder?: number | null;
  activationKind?: ChainActivationKind | null;
  effectKind?: ChainEffectKind | null;
  responseContextType?: ChainResponseContextType | null;
  sourceAtTrigger?: object | null;
  sourceAtActivation?: object | null;
  preparationStatus?: string | null;
  resolutionStatus?: string | null;
  finalizationStatus?: string | null;
  costPayment?: object | null;
  activationCommitment?: object | null;
  chainContext?: string | null;
  selectedCount?: number;
  selectedTargets?: object[];
}

/** Input accepted by emitEffectActivated before its required fields normalize. */
export interface ActivationEventInput extends EventPayloadBase {
  owner?: EventPlayer | null;
  effectType?: string | null;
  triggeredByEvent?: string | null;
}

export interface LpChangeEventPayload extends EventPayloadBase {
  player: EventPlayer;
  before: number | null;
  after: number | null;
  lpGained?: number;
  lpPaid?: number;
  lpLost?: number;
  damagedPlayer?: EventPlayer | null;
}

export interface CardsAddedToHandEventPayload extends EventPayloadBase {
  player: EventPlayer;
  cards: EventCard[];
  fromZone: EventZone;
}

export interface CombatResolvedEventPayload extends EventPayloadBase {
  attacker: EventCard;
  target: EventCard;
  attackerOwner: EventPlayer;
  defenderOwner: EventPlayer;
  damageDealt: number;
  targetDestroyed: boolean;
  attackerDestroyed: boolean;
}

export interface ControlChangedEventPayload extends EventPayloadBase {
  card: EventCard;
  fromPlayer: EventPlayer;
  toPlayer: EventPlayer;
  previousControllerId: string;
  controllerId: string;
  originalOwnerId?: string | null;
  reason: string;
  temporaryControlId?: string | null;
}

export interface GameOverEventPayload extends EventPayloadBase {
  winner: EventPlayer;
  winnerId: string;
  loser: EventPlayer;
  loserId: string;
  reason: string;
}

export interface MonsterSetEventPayload extends EventPayloadBase {
  card: EventCard;
  player: EventPlayer;
  opponent?: EventPlayer | null;
  method: SummonMethod;
  fromZone: EventZone;
  position: "defense";
  tributes?: EventCard[];
}

export interface OriginalStatsChangedEventPayload extends EventPayloadBase {
  card: EventCard;
  previousAtk: number;
  previousDef: number;
  previousBaseAtk: number;
  previousBaseDef: number;
  newAtk: number;
  newDef: number;
  newBaseAtk: number;
  newBaseDef: number;
}

export interface StatBuffAppliedEventPayload extends EventPayloadBase {
  card: EventCard;
  previousAtk: number;
  newAtk: number;
  previousDef: number;
  newDef: number;
  atkChange: number;
  defChange: number;
  permanent: boolean;
  duration?: string | number | null;
  expiresOnTurn?: number | null;
}

export interface StatIncreasesRemovedEventPayload extends EventPayloadBase {
  card: EventCard;
  removedByStat: { atk?: number; def?: number };
}

/** The complete set that is currently passed to Game.emit(). */
export interface DuelEventMap {
  after_summon: AfterSummonEventPayload;
  attack_declared: AttackDeclaredEventPayload;
  battle_completed: DamageStepEventPayload;
  battle_damage: DamageStepEventPayload;
  battle_damage_inflicted: DamageStepEventPayload;
  battle_destroy: BattleDestroyEventPayload;
  card_equipped: CardEquippedEventPayload;
  card_flipped: DamageStepEventPayload;
  card_moved: CardMovedEventPayload;
  card_to_grave: CardToGraveEventPayload;
  cards_added_to_hand: CardsAddedToHandEventPayload;
  combat_resolved: CombatResolvedEventPayload;
  control_changed: ControlChangedEventPayload;
  counter_removed: CounterRemovedEventPayload;
  damage_step: DamageStepEventPayload;
  effect_activated: ActivationEventPayload;
  effect_targeted: EffectTargetedEventPayload;
  end_phase: PhaseEventPayload;
  game_over: GameOverEventPayload;
  lp_change: LpChangeEventPayload;
  monster_set: MonsterSetEventPayload;
  original_stats_changed: OriginalStatsChangedEventPayload;
  position_change: PositionChangeEventPayload;
  spell_activated: ActivationEventPayload;
  standby_phase: PhaseEventPayload;
  stat_buff_applied: StatBuffAppliedEventPayload;
  stat_increases_removed: StatIncreasesRemovedEventPayload;
  trap_activated: ActivationEventPayload;
}

export const RESOLVABLE_EVENT_NAMES = Object.freeze([
  "after_summon",
  "attack_declared",
  "battle_completed",
  "battle_damage",
  "battle_damage_inflicted",
  "battle_destroy",
  "card_equipped",
  "card_flipped",
  "card_moved",
  "card_to_grave",
  "cards_added_to_hand",
  "combat_resolved",
  "control_changed",
  "counter_removed",
  "damage_step",
  "effect_activated",
  "effect_targeted",
  "end_phase",
  "game_over",
  "lp_change",
  "monster_set",
  "original_stats_changed",
  "position_change",
  "spell_activated",
  "standby_phase",
  "stat_buff_applied",
  "stat_increases_removed",
  "trap_activated",
] as const satisfies readonly (keyof DuelEventMap)[]);

export type ResolvableEventName = keyof DuelEventMap;
type MissingResolvableEventName = Exclude<
  ResolvableEventName,
  (typeof RESOLVABLE_EVENT_NAMES)[number]
>;
type ResolvableEventManifestIsComplete =
  MissingResolvableEventName extends never ? true : never;
const resolvableEventManifestIsComplete: ResolvableEventManifestIsComplete =
  true;
void resolvableEventManifestIsComplete;

export interface ActivationTransactionEventPayload {
  stage:
    | "preflight"
    | "source_committed"
    | "cost_paid"
    | "commit_actions_applied"
    | "targets_declared";
  cardInstanceId: EventEntityId | null;
  duelCardId: number | null;
  effectId: string | null;
  activationZone?: EventZone | null;
  costPayment?: object | null;
  activationCommitment?: object | null;
  targetIds?: string[];
}

export interface AiActivationRejectedEventPayload {
  playerId?: string | null;
  cardId?: number | null;
  candidateKey?: EventEntityId | null;
  effectId?: string | null;
  reason: string;
  context?: object | null;
}

export interface CardSetEventPayload {
  card: EventCard;
  player: EventPlayer;
  zone: "spellTrap";
}

export interface ChainLinkResolutionEventPayload {
  stage: "resolving" | "completed" | "failed";
  chainId: EventEntityId | null;
  linkId: EventEntityId | null;
  chainLevel: number;
  controllerId: string | null;
  effectId: string | null;
  activationKind?: ChainActivationKind | null;
  effectKind?: ChainEffectKind | null;
  success?: boolean;
  activationNegated?: boolean;
  effectNegated?: boolean;
  resolvedWithoutEffect?: boolean;
  reason?: string | null;
}

export interface ChainFinalizationEventPayload {
  stage: string;
  chainId: EventEntityId | null;
  linkId: EventEntityId | null;
  finalizationId?: EventEntityId | null;
  chainLevel?: number | null;
  cardInstanceId?: EventEntityId | null;
  cardName?: string | null;
  controllerId?: string | null;
  activationZone?: EventZone | null;
  activationKind?: ChainActivationKind | null;
  cardKind?: CardKind | null;
  subtype?: string | null;
  sourceLocationVersion?: number | null;
  status?: string | null;
  disposition?: string | null;
  outcome?: object;
}

export interface ChainFinalizationCompleteEventPayload {
  chainId: EventEntityId | null;
  count: number;
  entries: object[];
}

export interface DamageInflictedEventPayload {
  target: EventPlayer;
  sourceCard?: EventCard | null;
  amount: number;
  lpLost: number;
  newLP: number;
}

export interface DamageStepCardSnapshot {
  cardId: number | null;
  instanceId: EventEntityId | null;
  name: string | null;
  ownerId: string | null;
  zone: string;
  locationVersion: number;
  position: BattlePosition | null;
  faceDown: boolean;
}

export interface DamageStepOutcomeSnapshot {
  committed: boolean;
  battled: boolean;
  damageDealt: number;
  damagedPlayerId: string | null;
  healingApplied: number;
  targetDestroyed: boolean;
  attackerDestroyed: boolean;
  destructionInstanceIds: EventEntityId[];
  movedAtEndInstanceIds: EventEntityId[];
}

export interface DamageStepSnapshot {
  damageStepId: EventEntityId;
  status: string;
  timing: DamageStepTiming | null;
  sequenceIndex: number;
  directAttack: boolean;
  attacker: DamageStepCardSnapshot;
  defender: DamageStepCardSnapshot | null;
  attackerOwnerId: string | null;
  defenderOwnerId: string | null;
  revealedDefender: boolean;
  stoppedBeforeCalculation: boolean;
  outcome: DamageStepOutcomeSnapshot;
  failureReason: string | null;
}

export interface DecisionRequestedEventPayload {
  player: string;
  candidates: object[];
  effectId: string;
  sourceCard?: EventCard | null;
  allowCancel: boolean;
}

export interface DecisionCompletedEventPayload {
  player: string;
  sourceCard?: EventCard | null;
  effectId: string;
  selectedTargets: object[];
  selectedCount: number;
}

export interface DecisionMadeEventPayload {
  decisionId: number;
  kind: string;
  actorId: string | null;
  candidateKeys: EventEntityId[];
  value: object;
  context: object | null;
}

export interface DecisionRejectedEventPayload {
  decisionId?: number;
  kind: string;
  actorId?: string | null;
  reason: string;
  context?: object | null;
}

export interface EffectUsageEventPayload {
  reservationId: number;
  sourceInstanceId?: EventEntityId | null;
  effectId?: string | null;
  playerId?: string | null;
  policy: string | null;
  status: string;
  turnKey: string | null;
  duelKey: string | null;
  oncePerTurn: boolean;
  oncePerDuel: boolean;
  chainId?: EventEntityId | null;
  linkId?: EventEntityId | null;
  reason?: string;
}

export interface FastEffectTimingEventPayload {
  state?: string | null;
  origin?: string | null;
  timingWindowId?: EventEntityId | null;
  chainId?: EventEntityId | null;
  turnPlayerId?: string | null;
  actionPlayerId?: string | null;
  priorityPlayerId?: string | null;
  lastLinkControllerId?: string | null;
  consecutivePasses?: number;
  phaseIntent?: object | null;
}

export interface FastEffectPriorityEventPayload {
  timingWindowId: EventEntityId | null;
  chainId: EventEntityId | null;
  playerId: string | null;
  decision: string;
  consecutivePasses: number;
  linkId: EventEntityId | null;
  origin: string | null;
}

export interface GrimoireBlueprintActivatedEventPayload {
  player?: EventPlayer | null;
  storageCard?: EventCard | null;
  blueprint: object;
}

export interface GrimoireStorageDecisionEventPayload {
  player?: EventPlayer | null;
  storageCard?: EventCard | null;
  sourceCard?: EventCard | null;
  blueprint: object;
  stored: boolean;
  replaced: boolean;
  replacedBlueprintId?: string | null;
}

export interface PhaseSkipEventPayload {
  player: string;
  fromPhase: string;
  toPhase: string;
  reason: string;
}

export interface PositionChosenEventPayload {
  card: EventCard;
  player: EventPlayer;
  position: BattlePosition;
  context: "special_summon";
  turn?: number;
  phase?: string;
}

export interface SegocOrderSelectedEventPayload {
  opportunityId: EventEntityId;
  group: string;
  optional: boolean;
  orderedCandidateIds: EventEntityId[];
}

export interface SummonCostPaidEventPayload {
  summonId: EventEntityId;
  cost: object;
}

export interface SummonTransactionEventPayload {
  summonId: EventEntityId | null;
  status: string;
  card?: object | null;
  controllerId?: string | null;
  opponentId?: string | null;
  sourceAtStart?: object | null;
  summonMethod?: SummonMethod | null;
  summonOrigin?: SummonOrigin | null;
  summonMode?: string | null;
  summonProcedure?: string | null;
  position?: BattlePosition | null;
  consumesNormalSummon?: boolean;
  normalSummonCommitted?: boolean;
  costs?: object[];
  negationOutcome?: object | null;
  committedAtTurn?: number | null;
  completedAtTurn?: number | null;
  reason?: string | null;
}

export type SummonNegatedEventPayload = SummonTransactionEventPayload;

export interface TargetSelectedEventPayload extends EventPayloadBase {
  player: EventPlayer;
  sourceCard: EventCard;
  effect?: EffectDefinition | null;
  effectId?: string | null;
  selectedTargets: object[];
  selectedCount: number;
  context?: object | null;
}

export interface TriggerOccurrenceQueuedEventPayload {
  occurrenceId: EventEntityId | null;
  eventName: string | null;
  atomicGroupId?: EventEntityId | null;
  sequence?: number | null;
  turnCounter?: number | null;
  phase?: string | null;
  chainId?: EventEntityId | null;
  resolvingLinkId?: EventEntityId | null;
  snapshot?: object | null;
}

export interface TriggerOpportunityOpenedEventPayload {
  opportunityId: EventEntityId;
  occurrenceIds: EventEntityId[];
  lastRelevantAtomicGroupId: EventEntityId | null;
  turnPlayerId: string | null;
}

export interface TriggerCandidateRejectedEventPayload {
  opportunityId: EventEntityId;
  candidateId: EventEntityId | null;
  occurrenceId?: EventEntityId | null;
  atomicGroupId?: EventEntityId | null;
  eventName?: string | null;
  controllerId?: string | null;
  cardId?: number | null;
  cardInstanceId?: EventEntityId | null;
  cardName?: string | null;
  effectId?: string | null;
  triggerRequirement?: string | null;
  triggerTiming?: string | null;
  segocGroup?: string | null;
  eligibilityStatus?: string | null;
  rejectionReason?: string | null;
}

export interface TriggerChainPreparedEventPayload {
  opportunityId: EventEntityId;
  occurrenceIds: EventEntityId[];
  preparedCount: number;
  candidates: object[];
}

/** The complete set that is currently passed to Game.notify(). */
export interface InformationalEventMap {
  activation_transaction: ActivationTransactionEventPayload;
  ai_activation_rejected: AiActivationRejectedEventPayload;
  card_set: CardSetEventPayload;
  chain_finalization: ChainFinalizationEventPayload;
  chain_finalization_complete: ChainFinalizationCompleteEventPayload;
  chain_link_resolution: ChainLinkResolutionEventPayload;
  damage_inflicted: DamageInflictedEventPayload;
  damage_step_completed: DamageStepSnapshot;
  damage_step_created: DamageStepSnapshot;
  damage_step_outcome: DamageStepSnapshot;
  damage_step_timing: DamageStepSnapshot;
  decision_completed: DecisionCompletedEventPayload;
  decision_made: DecisionMadeEventPayload;
  decision_rejected: DecisionRejectedEventPayload;
  decision_requested: DecisionRequestedEventPayload;
  effect_activated: ActivationEventPayload;
  effect_usage: EffectUsageEventPayload;
  fast_effect_priority: FastEffectPriorityEventPayload;
  fast_effect_timing: FastEffectTimingEventPayload;
  grimoire_blueprint_activated: GrimoireBlueprintActivatedEventPayload;
  grimoire_storage_decision: GrimoireStorageDecisionEventPayload;
  lp_change: LpChangeEventPayload;
  phase_skip: PhaseSkipEventPayload;
  position_chosen: PositionChosenEventPayload;
  segoc_order_selected: SegocOrderSelectedEventPayload;
  spell_activated: ActivationEventPayload;
  summon_cost_paid: SummonCostPaidEventPayload;
  summon_negated: SummonNegatedEventPayload;
  summon_transaction: SummonTransactionEventPayload;
  target_selected: TargetSelectedEventPayload;
  trap_activated: ActivationEventPayload;
  trigger_candidate_rejected: TriggerCandidateRejectedEventPayload;
  trigger_chain_prepared: TriggerChainPreparedEventPayload;
  trigger_occurrence_queued: TriggerOccurrenceQueuedEventPayload;
  trigger_opportunity_opened: TriggerOpportunityOpenedEventPayload;
}

export const INFORMATIONAL_EVENT_NAMES = Object.freeze([
  "activation_transaction",
  "ai_activation_rejected",
  "card_set",
  "chain_finalization",
  "chain_finalization_complete",
  "chain_link_resolution",
  "damage_inflicted",
  "damage_step_completed",
  "damage_step_created",
  "damage_step_outcome",
  "damage_step_timing",
  "decision_completed",
  "decision_made",
  "decision_rejected",
  "decision_requested",
  "effect_activated",
  "effect_usage",
  "fast_effect_priority",
  "fast_effect_timing",
  "grimoire_blueprint_activated",
  "grimoire_storage_decision",
  "lp_change",
  "phase_skip",
  "position_chosen",
  "segoc_order_selected",
  "spell_activated",
  "summon_cost_paid",
  "summon_negated",
  "summon_transaction",
  "target_selected",
  "trap_activated",
  "trigger_candidate_rejected",
  "trigger_chain_prepared",
  "trigger_occurrence_queued",
  "trigger_opportunity_opened",
] as const satisfies readonly (keyof InformationalEventMap)[]);

export type InformationalEventName = keyof InformationalEventMap;
type MissingInformationalEventName = Exclude<
  InformationalEventName,
  (typeof INFORMATIONAL_EVENT_NAMES)[number]
>;
type InformationalEventManifestIsComplete =
  MissingInformationalEventName extends never ? true : never;
const informationalEventManifestIsComplete: InformationalEventManifestIsComplete =
  true;
void informationalEventManifestIsComplete;
export type RuntimeEventName = ResolvableEventName | InformationalEventName;

/** Overlaps deliberately select the same payload type used by emit(). */
export type RuntimeEventMap = {
  [Name in RuntimeEventName]: Name extends ResolvableEventName
    ? DuelEventMap[Name]
    : Name extends InformationalEventName
      ? InformationalEventMap[Name]
      : never;
};

export type RuntimeEventPayload<Name extends RuntimeEventName> =
  RuntimeEventMap[Name];

export const COLLECTED_TRIGGER_EVENT_NAMES = Object.freeze([
  "after_summon",
  "spell_activated",
  "effect_activated",
  "battle_destroy",
  "battle_completed",
  "card_to_grave",
  "card_moved",
  "counter_removed",
  "attack_declared",
  "battle_damage",
  "battle_damage_inflicted",
  "card_flipped",
  "damage_step",
  "lp_change",
  "effect_targeted",
  "position_change",
  "card_equipped",
  "standby_phase",
  "end_phase",
] as const satisfies readonly ResolvableEventName[]);

export type CollectedTriggerEventName =
  (typeof COLLECTED_TRIGGER_EVENT_NAMES)[number];
export type CollectedTriggerEventMap = Pick<
  DuelEventMap,
  CollectedTriggerEventName
>;

export interface EventTriggerEntry {
  summary?: string | null;
  selectionContract?: RawSelectionContract;
}

export type EventTriggerCompletion = (
  results?: readonly unknown[],
) => MaybeEventPromise<unknown>;

export interface EventTriggerPackage {
  entries: EventTriggerEntry[];
  orderRule: string | null;
  onComplete?: EventTriggerCompletion | null;
}

export type TriggerCollector<
  Name extends CollectedTriggerEventName,
  Host,
> = (
  this: Host,
  payload: CollectedTriggerEventMap[Name],
) => MaybeEventPromise<EventTriggerPackage>;

export interface EventTriggerOccurrence {
  occurrenceId?: EventEntityId;
  eventName?: ResolvableEventName | string;
  payload?: EventPayloadBase;
  atomicGroupId?: EventEntityId | null;
  sequence?: number;
  entries: EventTriggerEntry[] | null;
  entriesProvided: boolean;
  orderRule: string | null;
  onComplete: EventTriggerCompletion | null;
  snapshot?: object;
}

export interface EmitOptions {
  collectTriggersOnly?: boolean;
  atomicGroupId?: EventEntityId | null;
}

/**
 * Existing event/Chain results are capability-shaped. No new runtime status
 * discriminant is introduced while those producers remain heterogeneous.
 */
export interface EventResolutionOutcome {
  ok?: boolean;
  success?: boolean;
  reason?: string | null;
  skipped?: boolean;
  deferred?: boolean;
  queued?: boolean;
  needsSelection?: boolean;
  selectionContract?: RawSelectionContract;
  pendingChainSelection?: boolean;
  chainBuilt?: boolean;
  phaseTransitionInterrupted?: boolean;
  collectedOnly?: boolean;
  eventName?: ResolvableEventName;
  occurrenceId?: EventEntityId;
  pendingCount?: number;
  payload?: EventPayloadBase;
  occurrence?: EventTriggerOccurrence | null;
  entries?: EventTriggerEntry[];
  orderRule?: string | null;
  onComplete?: EventTriggerCompletion | null;
  triggerCount?: number;
  results?: unknown[];
  timing?: EventResolutionOutcome | null;
  resolutionResult?: EventResolutionOutcome | null;
  flushed?: number;
  suppressed?: boolean;
  timingRecovery?: EventResolutionOutcome | null;
}

export type EventResolutionResult = EventResolutionOutcome | null;

export type EventListener<Name extends RuntimeEventName> = (
  payload: RuntimeEventMap[Name],
) => void;

export type EventListenerRegistry = {
  [Name in RuntimeEventName]?: EventListener<Name>[];
};

export interface EventTelemetryMetadata {
  turn?: number | null;
  phase?: string | null;
}

export interface RuntimeEventRecorder {
  <Name extends ResolvableEventName>(
    eventName: Name,
    payload: DuelEventMap[Name],
  ): void;
  <Name extends InformationalEventName>(
    eventName: Name,
    payload: InformationalEventMap[Name],
  ): void;
}

export interface RuntimeArenaEventRecorder {
  <Name extends ResolvableEventName>(
    eventName: Name,
    payload: DuelEventMap[Name],
    metadata: EventTelemetryMetadata,
  ): void;
  <Name extends InformationalEventName>(
    eventName: Name,
    payload: InformationalEventMap[Name],
    metadata: EventTelemetryMetadata,
  ): void;
}

export interface EventArenaTrackerPort {
  recordEvent?: RuntimeArenaEventRecorder;
}

/** Consumer-facing typed boundary exposed by Game. */
export interface DuelEventPort {
  on<Name extends RuntimeEventName>(
    eventName: Name,
    handler: EventListener<Name>,
  ): void;
  emit<Name extends ResolvableEventName>(
    eventName: Name,
    payload: DuelEventMap[Name],
    options?: EmitOptions,
  ): Promise<EventResolutionResult>;
  notify<Name extends InformationalEventName>(
    eventName: Name,
    payload: InformationalEventMap[Name],
  ): void;
  emitEffectActivated?(
    payload?: ActivationEventInput,
    options?: EmitOptions,
  ): Promise<EventResolutionResult>;
}

export interface EventBusHost extends DuelEventPort {
  eventListeners: EventListenerRegistry;
  turnCounter?: number;
  phase?: string | null;
  isDisposed?(): boolean;
  recordReplayEvent?: RuntimeEventRecorder;
  _arenaTracker?: EventArenaTrackerPort | null;
  resolveEvent<Name extends ResolvableEventName>(
    eventName: Name,
    payload: DuelEventMap[Name],
    options?: EmitOptions,
  ): Promise<EventResolutionOutcome>;
}

export interface EventUiPort {
  log?(message: string): void;
}

export interface EventEffectEnginePort {
  collectEventTriggers?<Name extends ResolvableEventName>(
    eventName: Name,
    payload: DuelEventMap[Name],
  ): MaybeEventPromise<EventTriggerPackage | EventTriggerEntry[]>;
}

export interface EventChainPort {
  isPreparingActivation?: boolean;
  pendingTriggerSelection?: unknown;
  pendingTriggerOccurrences?: EventTriggerOccurrence[];
  _flushingPendingTriggerOccurrences?: boolean;
  isChainResolving?(): boolean;
  isChainWindowOpen?(): boolean;
  createTriggerOccurrence?(
    eventName: ResolvableEventName,
    payload: EventPayloadBase,
    options?: {
      entries?: EventTriggerEntry[];
      entriesProvided?: boolean;
      onComplete?: EventTriggerCompletion | null;
      orderRule?: string | null;
      atomicGroupId?: EventEntityId | null;
      sequence?: number;
    },
  ): EventTriggerOccurrence | null;
  queueTriggerOccurrence?(
    occurrence: EventTriggerOccurrence | null | undefined,
  ): EventResolutionOutcome;
  resolveTriggerOccurrences(
    occurrences: EventTriggerOccurrence[],
    options?: {
      actionPlayer?: EventPlayer | null;
      context?: EventPayloadBase;
      deferPostChainWindow?: boolean;
    },
  ): MaybeEventPromise<EventResolutionOutcome>;
}

export interface EventSelectionCleanupState {
  selectionActive?: boolean;
  controlsVisible?: boolean;
  highlightCount?: number;
}

export interface PendingEventSelection {
  eventName: ResolvableEventName;
  payload: EventPayloadBase;
  entries?: EventTriggerEntry[];
  onComplete?: EventTriggerCompletion | null;
  orderRule?: string | null;
  entryIndex?: number;
  results?: unknown[];
}

export interface EventResolverHost extends EventBusHost {
  eventResolutionDepth: number;
  eventResolutionCounter: number;
  summonProcedureDepth?: number;
  damageStepProcedureDepth?: number;
  damageCalculationStatChangePending?: boolean;
  damageCalculationStatPresentationDelayMs?: number;
  devModeEnabled?: boolean;
  selectionState?: string | null;
  pendingEventSelection?: PendingEventSelection | null;
  pendingTriggerSelection?: unknown;
  _flushingPendingTriggerOccurrences?: boolean;
  player?: EventPlayer;
  bot?: EventPlayer;
  turn?: string;
  ui?: EventUiPort | null;
  effectEngine?: EventEffectEnginePort | null;
  chainSystem?: EventChainPort | null;
  devLog(eventName: string, payload: object): void;
  assertStateInvariants(
    scope: string,
    options?: { failFast?: boolean },
  ): void;
  resolveEventEntries(
    eventName: ResolvableEventName,
    payload: EventPayloadBase,
    entries?: EventTriggerEntry[] | null,
    options?: {
      onComplete?: EventTriggerCompletion | null;
      orderRule?: string | null;
      occurrence?: EventTriggerOccurrence | null;
      startIndex?: number;
      results?: unknown[];
      selections?: object | null;
    },
  ): Promise<EventResolutionOutcome>;
  queueTriggerOccurrence(
    occurrence: EventTriggerOccurrence | null | undefined,
  ): EventResolutionOutcome;
  checkAndOfferTraps(
    eventName: string,
    payload: EventPayloadBase,
  ): MaybeEventPromise<EventResolutionOutcome | null>;
  devGetSelectionCleanupState?(): EventSelectionCleanupState;
  devForceTargetCleanup?(): void;
  updateBoard?(options?: object): void;
  waitForBoardPresentation?(): Promise<void>;
  waitForPresentationDelay?(milliseconds?: number): Promise<void>;
  getOpponent?(player: EventPlayer): EventPlayer | null;
  finishPendingSynchroMaterialTriggerContinuation?(
    result: EventResolutionOutcome | null,
    eventName: ResolvableEventName,
  ): MaybeEventPromise<EventResolutionOutcome | null>;
}
