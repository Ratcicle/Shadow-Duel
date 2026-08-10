import type { BattlePosition } from "./cards.js";
import type { ChainRuntimePort } from "./chainRuntime.js";
import type {
  ChainResponseDecisionContext,
  DecisionCandidateIdentity,
  DecisionKind,
  DecisionReplayValue,
  SegocOrderDecisionContext,
} from "./decisions.js";
import type { EventPhase, RuntimeEventName } from "./events.js";
import type {
  DecisionId,
  DuelCardId,
  PlayerId,
  RawCardDefinitionId,
} from "./primitives.js";

export const CANONICAL_REPLAY_FORMAT = "shadow-duel-canonical-replay" as const;
export const CANONICAL_REPLAY_SCHEMA_VERSION = 1 as const;
export const CANONICAL_REPLAY_ENGINE_VERSION = "phase-9" as const;

export type SerializablePrimitive = string | number | boolean | null;

export interface SerializableObject {
  [property: string]: SerializableValue;
}

export type SerializableValue =
  | SerializablePrimitive
  | SerializableObject
  | SerializableValue[];

export type CanonicalHash = string;
export type ReplaySeed = string | number;

export interface ReplayRandomState {
  seed: number;
  state: number;
  calls: number;
}

export interface ReplayDeckEntry {
  id: RawCardDefinitionId;
  duelCardId: DuelCardId | number;
}

export interface CanonicalReplaySetup {
  seed: ReplaySeed;
  randomState: ReplayRandomState | null;
  startingPlayer: PlayerId | null;
  playerDeck: ReplayDeckEntry[];
  playerExtraDeck: ReplayDeckEntry[];
  botDeck: ReplayDeckEntry[];
  botExtraDeck: ReplayDeckEntry[];
}

export type ReplayCardZone =
  | "deck"
  | "extraDeck"
  | "hand"
  | "field"
  | "spellTrap"
  | "graveyard"
  | "banished"
  | "fieldSpell";

export interface ReplayCardLocator {
  duelCardId?: DuelCardId | number | null;
  cardId?: RawCardDefinitionId | null;
}

export type NoopReplayCommandPayload = SerializableObject;

export interface DrawReplayCommandPayload {
  amount?: number;
}

export type ShuffleReplayCommandPayload = SerializableObject;

export interface SetPhaseReplayCommandPayload {
  phase: EventPhase;
}

export interface SetLpReplayCommandPayload {
  lp: number;
}

export interface PhaseIntentReplayCommandPayload {
  fromPhase?: EventPhase;
  toPhase?: EventPhase | null;
}

export interface SummonReplayCommandPayload extends ReplayCardLocator {
  position?: BattlePosition | null;
  facedown?: boolean;
  tributeIndices?: number[] | null;
}

export interface SetSpellTrapReplayCommandPayload extends ReplayCardLocator {}

export interface FlipSummonReplayCommandPayload extends ReplayCardLocator {}

export type ReplayExtraDeckSummonType =
  | "synchro"
  | "ascension"
  | "procedure";

export interface ExtraDeckSummonReplayCommandPayload extends ReplayCardLocator {
  summonType?: ReplayExtraDeckSummonType;
  position?: BattlePosition | null;
  materialIds?: Array<DuelCardId | number>;
}

export interface ActivateReplayCommandPayload extends ReplayCardLocator {
  sourceZone?: ReplayCardZone;
  effectId?: string | null;
}

export interface ChangePositionReplayCommandPayload extends ReplayCardLocator {
  position: BattlePosition;
}

export interface AttackReplayCommandPayload {
  attackerId: DuelCardId | number;
  targetId?: DuelCardId | number | null;
}

/** Compile-time source correlating each supported command with its payload. */
export interface CanonicalReplayCommandPayloadByType {
  noop: NoopReplayCommandPayload;
  draw: DrawReplayCommandPayload;
  shuffle: ShuffleReplayCommandPayload;
  set_phase: SetPhaseReplayCommandPayload;
  set_lp: SetLpReplayCommandPayload;
  phase_intent: PhaseIntentReplayCommandPayload;
  summon: SummonReplayCommandPayload;
  set_monster: SummonReplayCommandPayload;
  set_spell_trap: SetSpellTrapReplayCommandPayload;
  flip_summon: FlipSummonReplayCommandPayload;
  extra_deck_summon: ExtraDeckSummonReplayCommandPayload;
  activate_effect: ActivateReplayCommandPayload;
  activate_card: ActivateReplayCommandPayload;
  change_position: ChangePositionReplayCommandPayload;
  attack: AttackReplayCommandPayload;
}

export type CanonicalReplayCommandType =
  keyof CanonicalReplayCommandPayloadByType;

export const CANONICAL_REPLAY_COMMAND_TYPES = Object.freeze([
  "noop",
  "draw",
  "shuffle",
  "set_phase",
  "set_lp",
  "phase_intent",
  "summon",
  "set_monster",
  "set_spell_trap",
  "flip_summon",
  "extra_deck_summon",
  "activate_effect",
  "activate_card",
  "change_position",
  "attack",
] as const satisfies readonly CanonicalReplayCommandType[]);

type MissingCanonicalReplayCommandType = Exclude<
  CanonicalReplayCommandType,
  (typeof CANONICAL_REPLAY_COMMAND_TYPES)[number]
>;
type CanonicalReplayCommandManifestIsComplete =
  MissingCanonicalReplayCommandType extends never ? true : never;
const canonicalReplayCommandManifestIsComplete:
  CanonicalReplayCommandManifestIsComplete = true;
void canonicalReplayCommandManifestIsComplete;

export interface CanonicalReplayCommandBase<
  Type extends CanonicalReplayCommandType,
> {
  sequence: number;
  type: Type;
  actorId: PlayerId | null;
  payload: CanonicalReplayCommandPayloadByType[Type];
  stateHash?: CanonicalHash | null;
}

export type CanonicalReplayCommandOf<
  Type extends CanonicalReplayCommandType,
> = CanonicalReplayCommandBase<Type>;

export type CanonicalReplayCommand = {
  [Type in CanonicalReplayCommandType]: CanonicalReplayCommandOf<Type>;
}[CanonicalReplayCommandType];

export type CanonicalReplayDecisionContextByKind = {
  [Kind in DecisionKind]: Kind extends "chain_response"
    ? (ChainResponseDecisionContext & SerializableObject) | null
    : Kind extends "segoc_order"
      ? (SegocOrderDecisionContext & SerializableObject) | null
      : SerializableObject | null;
};

export interface CanonicalReplayDecisionBase<Kind extends DecisionKind> {
  sequence: number;
  decisionId: DecisionId | number;
  kind: Kind;
  actorId: string | null;
  candidateKeys: DecisionCandidateIdentity[];
  value: DecisionReplayValue<Kind>;
  context: CanonicalReplayDecisionContextByKind[Kind];
}

export type CanonicalReplayDecisionOf<Kind extends DecisionKind> =
  CanonicalReplayDecisionBase<Kind>;

export type CanonicalReplayDecision = {
  [Kind in DecisionKind]: CanonicalReplayDecisionOf<Kind>;
}[DecisionKind];

export const CANONICAL_REPLAY_RUNTIME_EVENT_NAMES = Object.freeze([
  "effect_activated",
  "spell_activated",
  "trap_activated",
  "activation_transaction",
  "fast_effect_timing",
  "fast_effect_priority",
  "trigger_occurrence_queued",
  "trigger_opportunity_opened",
  "segoc_order_selected",
  "trigger_candidate_rejected",
  "trigger_chain_prepared",
  "effect_usage",
  "chain_link_resolution",
  "chain_finalization",
  "chain_finalization_complete",
  "summon_transaction",
  "summon_cost_paid",
  "summon_negated",
  "after_summon",
  "damage_step_created",
  "damage_step_timing",
  "damage_step_completed",
  "battle_damage_inflicted",
  "control_changed",
  "card_moved",
  "card_to_grave",
  "game_over",
] as const satisfies readonly RuntimeEventName[]);

export type CanonicalReplayRuntimeEventName =
  (typeof CANONICAL_REPLAY_RUNTIME_EVENT_NAMES)[number];

export const CANONICAL_REPLAY_HISTORICAL_EVENT_NAMES = Object.freeze([
  "trigger_opportunity",
  "trigger_ordered",
  "activation_usage",
  "chain_link_resolved",
  "chain_finalized",
  "summon_attempt",
  "chain_cleanup",
] as const);

export type CanonicalReplayHistoricalEventName =
  (typeof CANONICAL_REPLAY_HISTORICAL_EVENT_NAMES)[number];

export const CANONICAL_REPLAY_EVENT_NAMES = Object.freeze([
  "effect_activated",
  "spell_activated",
  "trap_activated",
  "activation_transaction",
  "fast_effect_timing",
  "fast_effect_priority",
  "trigger_occurrence_queued",
  "trigger_opportunity_opened",
  "segoc_order_selected",
  "trigger_candidate_rejected",
  "trigger_chain_prepared",
  "trigger_opportunity",
  "trigger_ordered",
  "effect_usage",
  "activation_usage",
  "chain_link_resolution",
  "chain_finalization",
  "chain_finalization_complete",
  "chain_link_resolved",
  "chain_finalized",
  "summon_transaction",
  "summon_cost_paid",
  "summon_negated",
  "summon_attempt",
  "after_summon",
  "damage_step_created",
  "damage_step_timing",
  "damage_step_completed",
  "battle_damage_inflicted",
  "control_changed",
  "card_moved",
  "card_to_grave",
  "chain_cleanup",
  "game_over",
] as const satisfies readonly (
  | CanonicalReplayRuntimeEventName
  | CanonicalReplayHistoricalEventName
)[]);

export type CanonicalReplayEventName =
  (typeof CANONICAL_REPLAY_EVENT_NAMES)[number];

type MissingCanonicalReplayEventName = Exclude<
  CanonicalReplayRuntimeEventName | CanonicalReplayHistoricalEventName,
  CanonicalReplayEventName
>;
type CanonicalReplayEventManifestIsComplete =
  MissingCanonicalReplayEventName extends never ? true : never;
const canonicalReplayEventManifestIsComplete:
  CanonicalReplayEventManifestIsComplete = true;
void canonicalReplayEventManifestIsComplete;

export type CanonicalReplayEventPayloadByName = {
  [Name in CanonicalReplayEventName]: SerializableValue;
};

export interface CanonicalReplayEventBase<
  Name extends CanonicalReplayEventName,
> {
  sequence: number;
  event: Name;
  turn: number;
  phase: EventPhase | null;
  payload: CanonicalReplayEventPayloadByName[Name];
}

export type CanonicalReplayEventOf<Name extends CanonicalReplayEventName> =
  CanonicalReplayEventBase<Name>;

export type CanonicalReplayEvent = {
  [Name in CanonicalReplayEventName]: CanonicalReplayEventOf<Name>;
}[CanonicalReplayEventName];

export interface CanonicalCardStatusSnapshot {
  effectsNegated: boolean;
  effectsNegatedDuration: SerializableValue;
  cannotAttackThisTurn: boolean;
  battlePositionLocked: boolean;
  banishWhenLeavesField: boolean;
}

export interface CanonicalCardStateSnapshot {
  duelCardId: DuelCardId | number | null;
  cardId: RawCardDefinitionId | null;
  owner: string | null;
  controller: string | null;
  originalOwner: string | null;
  locationVersion: number;
  lastSummonMethod: string | null;
  lastSummonedFromZone: string | null;
  properSummonEstablished: boolean;
  properSummonProcedure: string | null;
  position: string | null;
  facedown: boolean;
  atk: number;
  def: number;
  baseAtk: number;
  baseDef: number;
  level: number;
  baseLevel: number;
  counters: SerializableValue;
  equipTargetId: DuelCardId | number | null;
  statuses: CanonicalCardStatusSnapshot;
}

export interface CanonicalPlayerZonesSnapshot {
  deck: Array<CanonicalCardStateSnapshot | null>;
  extraDeck: Array<CanonicalCardStateSnapshot | null>;
  hand: Array<CanonicalCardStateSnapshot | null>;
  field: Array<CanonicalCardStateSnapshot | null>;
  spellTrap: Array<CanonicalCardStateSnapshot | null>;
  graveyard: Array<CanonicalCardStateSnapshot | null>;
  banished: Array<CanonicalCardStateSnapshot | null>;
  fieldSpell: CanonicalCardStateSnapshot | null;
}

export interface CanonicalPlayerStateSnapshot {
  id: PlayerId | string | null;
  lp: number;
  zones: CanonicalPlayerZonesSnapshot;
  summonCount: number;
  additionalNormalSummons: number;
  oncePerDuelUsage: SerializableValue;
  restrictions: SerializableValue;
}

export interface CanonicalChainStateSnapshot {
  state: SerializableValue;
  links: SerializableValue;
  timing: SerializableValue;
  triggers: SerializableValue;
}

export interface CanonicalProcedureStateSnapshot {
  active: boolean;
  transaction: SerializableValue;
  last: SerializableValue;
}

export type CanonicalSummonStateSnapshot = CanonicalProcedureStateSnapshot;
export type CanonicalCombatStateSnapshot = CanonicalProcedureStateSnapshot;

export interface CanonicalGameStateSnapshot {
  turn: PlayerId | string | null;
  phase: EventPhase | string | null;
  turnCounter: number;
  random: ReplayRandomState | null;
  players: {
    player: CanonicalPlayerStateSnapshot;
    bot: CanonicalPlayerStateSnapshot;
  };
  usage: SerializableValue;
  delayedActions: SerializableValue;
  temporaryEventEffects: SerializableValue;
  temporaryControlEffects: SerializableValue;
  chain: CanonicalChainStateSnapshot;
  summon: CanonicalSummonStateSnapshot | null;
  combat: CanonicalCombatStateSnapshot | null;
}

export type CanonicalCardState = CanonicalCardStateSnapshot;
export type CanonicalPlayerState = CanonicalPlayerStateSnapshot;
export type CanonicalChainState = CanonicalChainStateSnapshot;
export type CanonicalSummonState = CanonicalSummonStateSnapshot;
export type CanonicalCombatState = CanonicalCombatStateSnapshot;

export interface CanonicalReplayResult {
  winner?: PlayerId | string | null;
  reason?: string | null;
  finalStateHash?: CanonicalHash | null;
  finalState?: CanonicalGameStateSnapshot;
}

export interface CanonicalReplay {
  format: typeof CANONICAL_REPLAY_FORMAT;
  schemaVersion: typeof CANONICAL_REPLAY_SCHEMA_VERSION;
  engineVersion?: typeof CANONICAL_REPLAY_ENGINE_VERSION;
  cardDatabaseSignature: CanonicalHash;
  setup: CanonicalReplaySetup;
  commands: CanonicalReplayCommand[];
  decisions: CanonicalReplayDecision[];
  events?: CanonicalReplayEvent[];
  result?: CanonicalReplayResult | null;
  finalized?: boolean;
}

export interface ReplayRuntimeCard {
  id?: RawCardDefinitionId | null;
  duelCardId?: DuelCardId | number | null;
  owner?: string | null;
  controller?: string | null;
  originalOwner?: string | null;
  locationVersion?: number;
  lastSummonMethod?: string | null;
  lastSummonedFromZone?: string | null;
  properSummonEstablished?: boolean;
  properSummonProcedure?: string | null;
  position?: string | null;
  isFacedown?: boolean;
  atk?: number;
  def?: number;
  baseAtk?: number;
  baseDef?: number;
  level?: number;
  baseLevel?: number;
  counters?: object | null;
  equippedTo?: ReplayRuntimeCard | null;
  effectsNegated?: boolean;
  effectsNegatedDuration?: string | number | null;
  cannotAttackThisTurn?: boolean;
  battlePositionLocked?: boolean;
  banishWhenLeavesField?: boolean;
  cardKind?: string | null;
  name?: string | null;
}

export interface ReplayRuntimePlayer {
  id: PlayerId | string;
  lp: number;
  deck: ReplayRuntimeCard[];
  extraDeck: ReplayRuntimeCard[];
  hand: ReplayRuntimeCard[];
  field: ReplayRuntimeCard[];
  spellTrap: ReplayRuntimeCard[];
  graveyard: ReplayRuntimeCard[];
  banished: ReplayRuntimeCard[];
  fieldSpell?: ReplayRuntimeCard | null;
  summonCount?: number;
  additionalNormalSummons?: number;
  oncePerDuelUsageByName?: object | null;
  specialSummonRestrictions?: unknown[];
  effectActivationRestrictions?: unknown[];
  forbidDirectAttacksThisTurn?: boolean;
}

export type CanonicalReplayChainPort = Partial<
  Pick<
    ChainRuntimePort,
    "getChainSummary" | "getFastEffectState" | "getTriggerState"
  >
> & {
  getPublicState?(): unknown;
};

export interface CanonicalReplayGamePort {
  turn?: PlayerId | string | null;
  phase?: EventPhase | string | null;
  turnCounter?: number;
  player?: ReplayRuntimePlayer;
  bot?: ReplayRuntimePlayer;
  delayedActions?: unknown[];
  temporaryEventEffects?: unknown[];
  temporaryControlEffects?: unknown[];
  chainSystem?: CanonicalReplayChainPort | null;
  ensureDuelCardId?(card: ReplayRuntimeCard): DuelCardId | number | null;
  getRandomState?(): ReplayRandomState | null;
  getEffectUsageState?(): SerializableValue;
  getTemporaryControlState?(): unknown;
  getSummonState?(): unknown;
  getDamageStepState?(): unknown;
}

export interface ReplayCommandInput<Type extends CanonicalReplayCommandType> {
  type: Type;
  actorId?: PlayerId | null;
  playerId?: PlayerId | null;
  payload?: CanonicalReplayCommandPayloadByType[Type];
}

export type CanonicalReplayCommandInput = {
  [Type in CanonicalReplayCommandType]: ReplayCommandInput<Type>;
}[CanonicalReplayCommandType];

/** Legacy permissive recording boundary; validation rejects unsupported data. */
export interface ReplayCommandRecordingInput {
  type?: string;
  actorId?: string | null;
  playerId?: string | null;
  payload?: object;
}

/** Legacy permissive recording boundary used by direct Game integrations. */
export type ReplayDecisionRecordingInput = Partial<CanonicalReplayDecision>;

export interface ReplayRecordedCommandEntry extends ReplayCommandRecordingInput {
  sequence: number;
  type: string;
  actorId: string | null;
  payload: object;
  stateHash: CanonicalHash;
}

export type ReplayRecordedDecisionEntry = ReplayDecisionRecordingInput & {
  sequence: number;
};

export interface ReplayRecordedEventEntry {
  sequence: number;
  event: CanonicalReplayEventName;
  turn: number;
  phase: EventPhase | string | null;
  payload: SerializableValue;
}

export interface RecordedCanonicalReplayResult {
  winner: PlayerId | string | null;
  reason: string | null;
  finalStateHash: CanonicalHash;
  finalState: CanonicalGameStateSnapshot;
}

/**
 * In-memory recorder buffer. Its permissive command and decision entries are
 * intentionally distinct from a replay that crossed validateCanonicalReplay().
 */
export interface ReplayRecordingBuffer {
  format: typeof CANONICAL_REPLAY_FORMAT;
  schemaVersion: typeof CANONICAL_REPLAY_SCHEMA_VERSION;
  engineVersion: typeof CANONICAL_REPLAY_ENGINE_VERSION;
  cardDatabaseSignature: CanonicalHash;
  setup: CanonicalReplaySetup;
  commands: ReplayRecordedCommandEntry[];
  decisions: ReplayRecordedDecisionEntry[];
  events: ReplayRecordedEventEntry[];
  result: RecordedCanonicalReplayResult | null;
  finalized: boolean;
}

export interface ReplayRecordingOptions {
  enabled?: boolean;
}

export interface ReplayExportOptions {
  download?: boolean;
  filename?: string;
}

export interface ReplayFinalizeInput {
  winner?: PlayerId | string | null;
  reason?: string | null;
}

export interface ReplayRecorderGamePort extends CanonicalReplayGamePort {
  _canonicalReplay?: ReplayRecordingBuffer | null;
  captureReplayEnabled?: boolean;
  randomSeed?: ReplaySeed;
  winner?: PlayerId | string | null;
  ensureDuelCardId(card: ReplayRuntimeCard): DuelCardId | number;
  startReplayRecording(options?: ReplayRecordingOptions): ReplayRecordingBuffer;
  finalizeReplay(result?: ReplayFinalizeInput): ReplayRecordingBuffer | null;
}

export interface ReplayDecisionBrokerPort {
  replayCursor: number;
  loadReplayDecisions(decisions: CanonicalReplayDecision[]): void;
}

export interface ReplayDriverGamePort extends CanonicalReplayGamePort {
  player: ReplayRuntimePlayer;
  bot: ReplayRuntimePlayer;
  phase: EventPhase | string | null;
  pendingReplayDecisionPromise?: PromiseLike<unknown> | null;
  decisionBroker: ReplayDecisionBrokerPort;
  dispose?(): void;
  startWithDecks(options: object): PromiseLike<unknown>;
  drawCards(player: ReplayRuntimePlayer, amount: number): unknown;
  shuffle(cards: ReplayRuntimeCard[]): unknown;
  nextPhase(): unknown;
  skipToPhase(phase: EventPhase): unknown;
  performNormalSummon(
    player: ReplayRuntimePlayer,
    cardIndex: number,
    position: BattlePosition,
    facedown: boolean,
    tributeIndices: number[] | null,
  ): unknown;
  setSpellOrTrap(
    card: ReplayRuntimeCard,
    cardIndex: number,
    player: ReplayRuntimePlayer,
  ): unknown;
  flipSummon(card: ReplayRuntimeCard): unknown;
  performSynchroSummonFromExtraDeck(
    card: ReplayRuntimeCard,
    player: ReplayRuntimePlayer,
    options: object,
  ): unknown;
  performAscensionSummonFromExtraDeck(
    card: ReplayRuntimeCard,
    player: ReplayRuntimePlayer,
    options: object,
  ): unknown;
  performExtraDeckSummonProcedure(
    card: ReplayRuntimeCard,
    player: ReplayRuntimePlayer,
    options: object,
  ): unknown;
  tryActivateMonsterEffect(
    card: ReplayRuntimeCard,
    effectIndex: number | null,
    zone: ReplayCardZone,
    player: ReplayRuntimePlayer,
    options: object,
  ): unknown;
  tryActivateSpell(
    card: ReplayRuntimeCard,
    cardIndex: number,
    target: unknown,
    options: object,
  ): unknown;
  tryActivateSpellTrapEffect(
    card: ReplayRuntimeCard,
    effectIndex: number | null,
    options: object,
  ): unknown;
  changeMonsterPosition(
    card: ReplayRuntimeCard,
    position: BattlePosition,
  ): unknown;
  getOpponent(player: ReplayRuntimePlayer): ReplayRuntimePlayer;
  resolveCombat(
    attacker: ReplayRuntimeCard,
    target: ReplayRuntimeCard | null,
    options: object,
  ): unknown;
}

export interface ReplayDriverOptions {
  game?: ReplayDriverGamePort;
}

export interface CanonicalReplayResultSummary {
  ok: true;
  game: ReplayDriverGamePort;
  finalStateHash: CanonicalHash;
  commands: number;
}
