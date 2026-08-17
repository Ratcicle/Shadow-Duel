import type {
  BattlePositionInput,
  GameCard,
  KnownCardStatusInput,
  SpecialSummonProcedure,
} from "./cards.js";
import type {
  ChainAutoSelectorPort,
  ChainPendingEventSelection,
  ChainRuntimePort,
  FastEffectState,
} from "./chainRuntime.js";
import type { MaybePromise } from "./decisions.js";
import type { DecisionBrokerPort } from "./decisions.js";
import type { DamageStepTiming, EffectDefinition } from "./effects.js";
import type {
  DeterministicRandomPort,
  DeterministicRandomSeed,
  GamePhase,
  GameRendererPort,
  ReplayMode,
} from "./game.js";
import type { GamePlayer } from "./player.js";
import type {
  DamageStepId,
  DuelCardId,
  PlayerId,
  SummonId,
} from "./primitives.js";
import type { BattlePosition } from "./cards.js";
import type { SummonMethod, SummonOrigin } from "./summon.js";
import type {
  CanonicalZone,
  LegacyZoneAlias,
  ZoneInput,
} from "./zones.js";
import type { ActiveSelectionSession, SelectionSessionState } from "./selection.js";
import type { ReplayRecordingBuffer } from "./replay.js";

export type { MaybePromise } from "./decisions.js";
export type { GameCard } from "./cards.js";
export type { GamePlayer } from "./player.js";

export interface ZonePlayerSnapshot {
  hand: GameCard[];
  field: GameCard[];
  spellTrap: GameCard[];
  graveyard: GameCard[];
  banished: GameCard[];
  deck: GameCard[];
  extraDeck: GameCard[];
  fieldSpell: GameCard | null;
}

export type CardStateSnapshot = Partial<GameCard> & {
  counters?: Map<string, number>;
  equips?: GameCard[];
};

export interface ZoneSnapshot {
  contextLabel: string;
  players: {
    player: ZonePlayerSnapshot;
    bot: ZonePlayerSnapshot;
  };
  cardState: Map<GameCard, CardStateSnapshot>;
}

export interface ZoneOpOptions {
  contextLabel?: string;
  card?: GameCard | null;
  fromZone?: ZoneInput | null;
  toZone?: ZoneInput | null;
}

export interface ZoneOpFailure {
  success: false;
  reason: string;
  rolledBack: true;
}

export interface MoveCardResult {
  success?: boolean;
  ok?: boolean;
  card?: GameCard | null;
  reason?: string | null;
  code?: string | null;
  fromZone?: CanonicalZone | "token" | null;
  toZone?: CanonicalZone | null;
  fromPlayer?: GamePlayer | null;
  toPlayer?: GamePlayer | null;
  moved?: boolean;
  removed?: boolean;
  tokenRemoved?: boolean;
  replaced?: boolean;
  summonNegated?: boolean;
  summonId?: SummonId | number | null;
  summonOrigin?: SummonOrigin | null;
  needsSelection?: boolean;
  selectionContract?: unknown;
  deferredCardToGraveTriggerPackage?: DeferredCardToGraveTriggerPackage;
  deferredCardToGraveEntries?: readonly unknown[];
}

export interface DeferredCardToGraveTriggerPackage {
  success?: boolean;
  ok?: boolean;
  needsSelection?: boolean;
  selectionContract?: unknown;
  collectedOnly?: boolean;
  entries?: readonly unknown[];
  reason?: string | null;
}

export interface MoveCardActionContext {
  damageStepId?: DamageStepId | null;
  damageStepTiming?: DamageStepTiming | null;
  isDamageStep?: boolean;
  synchroSummonContextId?: string | null;
  synchroSummonCardId?: number | null;
  synchroSummonCardName?: string | null;
}

export interface SynchroMaterialFollowup {
  id?: string;
  type?: string;
  synchroSummonContextId?: string | null;
  ownerId?: PlayerId | string | null;
  source?: GameCard | null;
  sourceName?: string | null;
  sourceCardId?: number | null;
  sourceInstanceId?: number | string | null;
  sourceEffectId?: string | null;
  actions?: readonly unknown[];
}

export interface MoveCardOptions {
  fromZone?: ZoneInput | "token";
  position?: BattlePosition;
  isFacedown?: boolean;
  resetAttackFlags?: boolean;
  summonOrigin?: SummonOrigin | null;
  summonMethod?: SummonMethod;
  summonMethodOverride?: SummonMethod;
  summonProcedure?: SpecialSummonProcedure | string | null;
  summonMode?: SummonMode;
  summonTransaction?: SummonTransaction | null;
  summonId?: SummonId | number | null;
  tributes?: readonly GameCard[];
  statusesOnSummon?: KnownCardStatusInput | readonly KnownCardStatusInput[];
  source?: GameCard | null;
  sourceCard?: GameCard | null;
  sourcePlayer?: GamePlayer | null;
  effectPlayer?: GamePlayer | null;
  destroySource?: GameCard | null;
  excludeCards?: readonly GameCard[];
  reason?: string;
  cause?: string;
  destroyCause?: string | null;
  contextLabel?: string;
  actionContext?: MoveCardActionContext | null;
  effectId?: string | null;
  chainId?: number | null;
  linkId?: number | null;
  atomicGroupId?: string | number | null;
  locationVersion?: number;
  method?: SummonMethod | string;
  movedByEffect?: boolean;
  wasDestroyed?: boolean;
  wasFaceupBeforeMove?: boolean;
  skipSummonAttempt?: boolean;
  animateCards?: boolean;
  skipAnimation?: boolean;
  skipSendToGraveReplacement?: boolean;
  skipSendToGraveActionReplacement?: boolean;
  silent?: boolean;
  allowExtraDeckMonsterToHand?: boolean;
  awaitEvents?: boolean;
  awaitCardMovedEvent?: boolean;
  awaitCardToGraveEvent?: boolean;
  deferCardToGraveTriggerResolution?: boolean;
  presentBeforeAfterSummon?: boolean;
  presentBeforeCardToGrave?: boolean;
  presentBeforeCardToGraveEvent?: boolean;
  graveyardActivationDelayMs?: number;
  graveyardPresentationDelayMs?: number;
  summonPresentationDelayMs?: number;
  synchroMaterialFollowups?: readonly SynchroMaterialFollowup[];
}

export type RegularMoveDestinationZone = Exclude<CanonicalZone, "field">;
export type SummonMoveSourceZone = Exclude<CanonicalZone, "field">;

type MoveCardOptionsWithoutSource = Omit<MoveCardOptions, "fromZone">;

export type RegularMoveCardOptions = MoveCardOptionsWithoutSource & {
  fromZone?: CanonicalZone;
};

export type FieldTransferMoveCardOptions = MoveCardOptionsWithoutSource & {
  fromZone: "field";
};

export type SummonEntryMoveCardOptions = Omit<
  MoveCardOptionsWithoutSource,
  "summonOrigin"
> & {
  fromZone: SummonMoveSourceZone;
  summonOrigin: SummonOrigin;
};

export type TokenEntryMoveCardOptions = Omit<
  MoveCardOptionsWithoutSource,
  "summonOrigin"
> & {
  fromZone: "token";
  summonOrigin: SummonOrigin;
};

/** Narrow compatibility boundary for the historical `banish` zone alias. */
export type LegacyMoveCardOptions = MoveCardOptionsWithoutSource & {
  fromZone?: ZoneInput | "token";
};

export type LegacySourceMoveCardOptions = MoveCardOptionsWithoutSource & {
  fromZone: LegacyZoneAlias;
};

export interface MoveCardFunction {
  (
    card: GameCard,
    player: GamePlayer,
    zone: RegularMoveDestinationZone,
    options?: RegularMoveCardOptions,
  ): MaybePromise<MoveCardResult | ZoneOpFailure>;
  (
    card: GameCard,
    player: GamePlayer,
    zone: "field",
    options: FieldTransferMoveCardOptions,
  ): MaybePromise<MoveCardResult | ZoneOpFailure>;
  (
    card: GameCard,
    player: GamePlayer,
    zone: "field",
    options: SummonEntryMoveCardOptions,
  ): MaybePromise<MoveCardResult | SummonExecutionResult | ZoneOpFailure>;
  (
    card: GameCard,
    player: GamePlayer,
    zone: "field",
    options: TokenEntryMoveCardOptions,
  ): MaybePromise<MoveCardResult | SummonExecutionResult | ZoneOpFailure>;
  (
    card: GameCard,
    player: GamePlayer,
    zone: LegacyZoneAlias,
    options?: LegacyMoveCardOptions,
  ): MaybePromise<MoveCardResult | SummonExecutionResult | ZoneOpFailure>;
  (
    card: GameCard,
    player: GamePlayer,
    zone: RegularMoveDestinationZone,
    options: LegacySourceMoveCardOptions,
  ): MaybePromise<MoveCardResult | SummonExecutionResult | ZoneOpFailure>;
}

export type SummonMode = "summon" | "set";
export type SummonStatus =
  | "prepared"
  | "committed"
  | "awaiting_negation"
  | "succeeded"
  | "negated"
  | "failed"
  | "cancelled";

export interface SummonSourceSnapshot {
  zone: CanonicalZone | "token" | null;
  controllerId: PlayerId | string | null;
  ownerId: PlayerId | string | null;
  faceUp: boolean | null;
  locationVersion: number;
}

export interface SummonCostPayment {
  card: GameCard;
  owner?: GamePlayer | null;
  fromZone?: CanonicalZone | null;
  toZone?: CanonicalZone;
  kind?: string;
  paid?: boolean;
  contextLabel?: string;
  options?: MoveCardOptions;
  pay?: (transaction: SummonTransaction) => MaybePromise<MoveCardResult | boolean | null | undefined>;
}

export interface SummonNegationOutcome {
  destination?: CanonicalZone;
  destroyed?: boolean;
  sourceCard?: GameCard | null;
  sourcePlayer?: GamePlayer | null;
  linkId?: number | null;
}

export interface SummonCardIdentitySnapshot {
  cardId: number | null;
  instanceId: string | number | null;
  name: string | null;
}

export interface SummonCostSnapshot extends SummonCardIdentitySnapshot {
  ownerId: PlayerId | string | null;
  fromZone: CanonicalZone | null;
  toZone: CanonicalZone | null;
  kind: string;
  paid: boolean;
}

export interface SummonNegationSnapshot {
  destination: CanonicalZone;
  destroyed: boolean;
  sourceCard: SummonCardIdentitySnapshot | null;
  sourcePlayerId: PlayerId | string | null;
  linkId: number | null;
}

export interface SummonTransactionSnapshot {
  summonId: SummonId | number | null;
  status: SummonStatus;
  summonOrigin: SummonOrigin | null;
  summonMode: SummonMode;
  summonMethod: SummonMethod;
  summonProcedure: SpecialSummonProcedure | string | null;
  controllerId: PlayerId | string | null;
  opponentId: PlayerId | string | null;
  card: SummonCardIdentitySnapshot | null;
  sourceAtStart: SummonSourceSnapshot | null;
  position: BattlePosition | null;
  consumesNormalSummon: boolean;
  normalSummonCommitted: boolean;
  costs: SummonCostSnapshot[];
  negationOutcome: SummonNegationSnapshot | null;
  committedAtTurn: number | null;
  completedAtTurn: number | null;
  reason: string | null;
}

export interface SummonState {
  active: boolean;
  transaction: SummonTransactionSnapshot | null;
  last: SummonTransactionSnapshot | null;
}

export interface PreparedSummonInput {
  card?: GameCard | null;
  controller?: GamePlayer | null;
  opponent?: GamePlayer | null;
  sourceZone?: CanonicalZone | "token" | null;
  summonOrigin?: SummonOrigin | null;
  summonMode?: SummonMode;
  summonMethod?: SummonMethod;
  summonProcedure?: SpecialSummonProcedure | string | null;
  position?: BattlePosition | null;
  consumesNormalSummon?: boolean;
  costPayments?: readonly SummonCostPayment[];
  cancelled?: boolean;
  commit?: (transaction: SummonTransaction) => MaybePromise<SummonExecutionResult | boolean | null | undefined>;
  perform?: (transaction: SummonTransaction) => MaybePromise<SummonExecutionResult | boolean | null | undefined>;
  onFailure?: (transaction: SummonTransaction, error: unknown) => MaybePromise<unknown>;
  finalContext?: unknown;
  skipFinalTiming?: boolean;
}

export interface PreparedSummon {
  summonId: null;
  status: "prepared";
  summonOrigin: SummonOrigin | null;
  summonMode: SummonMode;
  summonMethod: SummonMethod;
  summonProcedure: SpecialSummonProcedure | string | null;
  controller: GamePlayer | null;
  opponent: GamePlayer | null;
  card: GameCard | null;
  position: BattlePosition | null;
  sourceAtStart: SummonSourceSnapshot;
  consumesNormalSummon: boolean;
  normalSummonCommitted: boolean;
  costPayments: SummonCostPayment[];
  negationOutcome: SummonNegationOutcome | null;
  committedAtTurn: number | null;
  completedAtTurn: number | null;
  reason: string | null;
  cancelled: boolean;
  commit: PreparedSummonInput["commit"] | null;
  perform: PreparedSummonInput["perform"] | null;
  onFailure: PreparedSummonInput["onFailure"] | null;
  finalContext: unknown;
  skipFinalTiming: boolean;
}

export interface SummonTransaction extends Omit<PreparedSummon, "summonId" | "status"> {
  summonId: SummonId | number;
  status: SummonStatus;
}

export interface SummonExecutionResult extends MoveCardResult {
  success?: boolean;
  cancelled?: boolean;
  summonNegated?: boolean;
  summonId?: SummonId | number | null;
  transaction?: SummonTransactionSnapshot | null;
  tributes?: readonly GameCard[];
  set?: boolean;
  needsSelection?: boolean;
  selectionContract?: unknown;
  error?: unknown;
}

export type DamageStepStatus =
  | "active"
  | "completed"
  | "failed"
  | "cancelled";

export type DamageStepCard = GameCard & {
  simInstanceId?: string | number | null;
};

export type DamageStepCardInstanceId = string | number | null;

export interface DamageStepCardSnapshot {
  cardId: number | null;
  instanceId: DamageStepCardInstanceId;
  name: string | null;
  ownerId: PlayerId | string | null;
  zone: CanonicalZone;
  locationVersion: number;
  position: BattlePosition | null;
  faceDown: boolean;
}

export interface DamageStepDestructionCandidate {
  card: DamageStepCard;
  owner: GamePlayer;
  sourceCard: DamageStepCard;
  role: "attacker" | "defender";
  position: BattlePosition | null;
  locationVersion: number;
}

export interface DamageStepLpChangePayload {
  player: GamePlayer;
  sourceCard: DamageStepCard;
  lpGained?: number;
  before: number;
  after: number;
}

export interface DamageStepOutcome {
  committed: boolean;
  battled: boolean;
  damageDealt: number;
  damagedPlayer: GamePlayer | null;
  healingApplied: number;
  targetDestroyed: boolean;
  attackerDestroyed: boolean;
  destructionCandidates: DamageStepDestructionCandidate[];
  movedAtEnd: DamageStepCard[];
  lpChangePayload: DamageStepLpChangePayload | null;
}

export interface DamageStepTransactionInput {
  attacker?: DamageStepCard | null;
  defender?: DamageStepCard | null;
  attackerOwner?: GamePlayer | null;
  defenderOwner?: GamePlayer | null;
  consumeBattleLpLossFeedback?: (
    player: GamePlayer,
    amount: number,
  ) => boolean;
}

export interface DamageStepTransaction {
  damageStepId: DamageStepId;
  status: DamageStepStatus;
  timing: DamageStepTiming | null;
  directAttack: boolean;
  attacker: DamageStepCard;
  defender: DamageStepCard | null;
  attackerOwner: GamePlayer;
  defenderOwner: GamePlayer | null;
  damageOptions: {
    consumeBattleLpLossFeedback:
      | ((player: GamePlayer, amount: number) => boolean)
      | null;
  };
  sourceAtStart: {
    attacker: DamageStepCardSnapshot;
    defender: DamageStepCardSnapshot | null;
  };
  revealedDefender: boolean;
  stoppedBeforeCalculation: boolean;
  endFinalized: boolean;
  nextDestructionIndex: number;
  destructionQueueStart: number | null;
  destructionAtomicGroupId: number | string | null;
  failureReason: string | null;
  outcome: DamageStepOutcome;
}

export interface DamageStepOutcomeSnapshot {
  committed: boolean;
  battled: boolean;
  damageDealt: number;
  damagedPlayerId: PlayerId | string | null;
  healingApplied: number;
  targetDestroyed: boolean;
  attackerDestroyed: boolean;
  destructionInstanceIds: Array<Exclude<DamageStepCardInstanceId, null>>;
  movedAtEndInstanceIds: Array<Exclude<DamageStepCardInstanceId, null>>;
}

export interface DamageStepTransactionSnapshot {
  damageStepId: DamageStepId;
  status: DamageStepStatus;
  timing: DamageStepTiming | null;
  sequenceIndex: number;
  directAttack: boolean;
  attacker: DamageStepCardSnapshot;
  defender: DamageStepCardSnapshot | null;
  attackerOwnerId: PlayerId | string | null;
  defenderOwnerId: PlayerId | string | null;
  revealedDefender: boolean;
  stoppedBeforeCalculation: boolean;
  outcome: DamageStepOutcomeSnapshot;
  failureReason: string | null;
}

export interface DamageStepState {
  active: boolean;
  transaction: DamageStepTransactionSnapshot | null;
  last: DamageStepTransactionSnapshot | null;
}

export type DamageStepPreparationFailure = {
  ok: false;
  reason:
    | "removed_damage_step_target_field"
    | "missing_damage_step_attacker"
    | "damage_step_already_active";
};

export interface DamageStepExecutionSuccess {
  ok: true;
  success: true;
  damageStepId: DamageStepId;
  damageDealt: number;
  targetDestroyed: boolean;
  attackerDestroyed: boolean;
  stoppedBeforeCalculation: boolean;
}

export interface DamageStepExecutionFailure {
  ok: false;
  success: false;
  damageStepId: DamageStepId;
  reason: string;
  damageDealt: number;
  targetDestroyed: boolean;
  attackerDestroyed: boolean;
}

export interface DamageStepExecutionRejected {
  ok: false;
  reason: "damage_step_transaction_not_active";
}

export type DamageStepExecutionResult =
  | DamageStepExecutionSuccess
  | DamageStepExecutionFailure
  | DamageStepExecutionRejected;

export interface DamageStepBuff {
  card?: DamageStepCard | null;
  atk?: number;
  def?: number;
}

export interface PlayerGamePort {
  player?: GamePlayer;
  bot?: GamePlayer;
  turnCounter?: number;
  ui?: GameUiPort;
  effectEngine?: EffectEngineRuntimePort;
  getOpponent?(player: GamePlayer | null): GamePlayer | null;
  ensureDuelCardId?: {
    (card: GameCard): DuelCardId;
    (card: null | undefined): null;
  };
  shuffle?<Value>(items: Value[]): Value[];
  canPlaceCardOnField?(card: GameCard, player: GamePlayer, options?: MoveCardOptions): MoveCardResult;
  createPreparedSummon(input: PreparedSummonInput): PreparedSummon;
  executeSummonTransaction(
    input: PreparedSummonInput | PreparedSummon,
  ): Promise<SummonExecutionResult>;
  moveCard: MoveCardFunction;
  devLog?(code: string, detail?: unknown): void;
  queueVisualFeedback?(feedback: VisualFeedback): void;
}

export interface VisualFeedback {
  kind: string;
  ownerId?: PlayerId | string;
  fromZone?: CanonicalZone | "token" | null;
  targetOwnerId?: PlayerId | string;
  amount?: number;
  tone?: string;
}

export interface GameUiPort {
  log(message: string): void;
  showLpChange?(
    player: GamePlayer,
    amount: number,
    options: {
      cause: string;
      sourceCard?: GameCard | null;
      sourceRect?: unknown;
      fromLp: number;
      toLp: number;
      screenShake?: boolean;
    },
  ): boolean | void;
  bindPhaseClick(handler: (phase: GamePhase) => void): void;
  showDuelStartAnnouncement?(
    message: string,
    options?: { durationMs?: number },
  ): MaybePromise<unknown>;
  updatePriorityIndicator(state: GamePlayer | FastEffectState | null): void;
}

export interface EffectEngineRuntimePort {
  clearTargetingCache?(): void;
  updatePassiveBuffs?(): MaybePromise<unknown>;
  getMonsterIgnitionEffect?(
    card: GameCard,
    activationZone?: CanonicalZone,
    options?: { effectId?: string | null },
  ): EffectDefinition | null | undefined;
  activateMonsterEffect(
    card: GameCard,
    player: GamePlayer,
    selections: unknown,
    zone: CanonicalZone | null,
    context?: unknown,
  ): MaybePromise<unknown>;
  chooseSpecialSummonPosition(
    card: GameCard,
    player: GamePlayer,
    options?: { position?: BattlePositionInput | null },
  ): Promise<BattlePosition>;
}

export interface ArenaProgressTrackerPort {
  recordProgress?(label: string, game: FullGameHost, detail?: unknown): void;
  recordBlockedAction?(entry: {
    actor: GamePlayer | null;
    kind: string;
    reason: string;
    code: string;
    turn: number;
  }): void;
}

export interface OncePerTurnRuntimeState {
  player: Map<string, unknown>;
  bot: Map<string, unknown>;
  card: WeakMap<GameCard, unknown>;
}

export type MaterialStatMapName =
  | "destroyedOpponentMonstersByMaterialId"
  | "effectActivationsByMaterialId";

export type MaterialStatsForPlayer = Record<
  MaterialStatMapName,
  Map<number, number>
>;

export type MaterialDuelStats = Record<PlayerId, MaterialStatsForPlayer>;

export interface TemporaryControlEffect {
  id: string;
  cardInstanceId: number | string | null;
  holderId: string;
  previousControllerId: string | null;
  expiresOnTurn: number;
  sourceInstanceId: number | string | null;
  createdOnTurn: number;
}

export interface ReplayCommandDescriptorCarrier {
  replayCommandDescriptor?: unknown;
}

/**
 * Exact constructor-owned state of Game. Late properties are optional and
 * erased through interface merging; they must not become emitted class fields.
 */
export interface GameRuntimeState {
  disableChains: boolean;
  disableTraps: boolean;
  disableEffectActivation: boolean;
  randomSeed: DeterministicRandomSeed;
  randomGenerator: DeterministicRandomPort;
  nextDuelCardId: number;
  generatedIdCounters: Map<string, number>;
  captureReplayEnabled: boolean;
  _canonicalReplay: ReplayRecordingBuffer | null;
  laboratoryModeEnabled: boolean;
  laboratoryRevealBotHand: boolean;
  player: GamePlayer;
  botPreset: string;
  bot: GamePlayer;
  renderer: GameRendererPort | null;
  ui: GameUiPort;
  autoSelector: ChainAutoSelectorPort;
  replayMode: ReplayMode;
  decisionBroker: DecisionBrokerPort;
  turn: PlayerId;
  phase: GamePhase;
  turnCounter: number;
  disposed: boolean;
  gameOver: boolean;
  winner: PlayerId | "draw" | null;
  targetSelection: (ActiveSelectionSession & ReplayCommandDescriptorCarrier) | null;
  selectionState: SelectionSessionState;
  graveyardSelection: unknown;
  selectionSessionCounter: number;
  lastSelectionSessionId: number;
  eventListeners: Record<string, Array<(payload: unknown) => MaybePromise<unknown>>>;
  phaseDelayMs: number;
  aiSuccessfulActionDelayMs: number;
  aiPresentationStepDelayMs: number;
  battleStep: string | null;
  damageCalculationStatChangePending: boolean;
  nextDamageStepId: number;
  activeDamageStepTransaction: DamageStepTransaction | null;
  lastDamageStepTransaction: DamageStepTransaction | null;
  damageStepProcedureDepth: number;
  damageCalculationTempBuffs: DamageStepBuff[];
  endOfDamageStepTempBuffs: DamageStepBuff[];
  damageCalculationStatPresentationDelayMs: number;
  lastAttackNegated: boolean;
  pendingSpecialSummon: unknown;
  nextSummonId: number;
  activeSummonTransaction: SummonTransaction | null;
  lastSummonTransaction: SummonTransactionSnapshot | null;
  summonProcedureDepth: number;
  pendingTributeSummonSelection: unknown;
  isResolvingEffect: boolean;
  eventResolutionDepth: number;
  eventResolutionCounter: number;
  pendingEventSelection: ChainPendingEventSelection | null;
  pendingTriggerSelection: unknown;
  pendingChainEvents: unknown[];
  _flushingPendingTriggerOccurrences: boolean;
  temporaryReplacementEffects: unknown[];
  temporaryBattlePairEffects: unknown[];
  temporaryEventEffects: unknown[];
  temporaryControlEffects: TemporaryControlEffect[];
  pendingSynchroMaterialFollowups: unknown[];
  pendingSynchroMaterialTriggerContinuation: unknown;
  synchroSummonContextCounter: number;
  devModeEnabled: boolean;
  zoneOpDepth: number;
  zoneOpSnapshot: ZoneSnapshot | null;
  devFailAfterZoneMutation: boolean;
  pendingCardAnimations: unknown[];
  pendingVisualFeedback: VisualFeedback[];
  pendingBoardPresentationPromise: Promise<boolean>;
  cardAnimationsReady: boolean;
  normalDuelStrategicReportEnabled: boolean;
  normalDuelPlayerArchetype: string;
  normalDuelBotArchetype: string;
  _normalDuelStrategic: unknown;
  oncePerTurnUsage: OncePerTurnRuntimeState;
  nextEffectUsageReservationId: number;
  effectUsageReservations: Map<number, unknown>;
  oncePerTurnTurnCounter: number;
  materialDuelStats: MaterialDuelStats;
  delayedActions: unknown[];
  specialSummonTypeCounts: Record<PlayerId, Map<string, number>>;
  effectEngine: EffectEngineRuntimePort;
  chainSystem: ChainRuntimePort;

  _activeDeferredReplayCommandDescriptor?: unknown;
  _arenaTracker?: ArenaProgressTrackerPort | null;
  _botArenaMode?: boolean;
  aiActionDelayMs?: number;
  arenaBeamWidth?: number;
  arenaMaxDepth?: number;
  disablePresentationDelays?: boolean;
  disposeReason?: string | null;
  pendingReplayDecisionPromise?: Promise<unknown> | null;
}

/** Common live-duel capabilities shared by several attached domains. */
export interface GameCoreHost {
  player: GamePlayer;
  bot: GamePlayer;
  turn: PlayerId;
  phase: GamePhase;
  turnCounter: number;
  ui: GameUiPort;
  effectEngine: EffectEngineRuntimePort;
  chainSystem: ChainRuntimePort;
  getOpponent?(player: GamePlayer | null): GamePlayer | null;
  ensureDuelCardId?: {
    (card: GameCard): DuelCardId;
    (card: null | undefined): null;
  };
  shuffle?<Value>(items: Value[]): Value[];
  canPlaceCardOnField?(
    card: GameCard,
    player: GamePlayer,
    options?: MoveCardOptions,
  ): MoveCardResult;
  createPreparedSummon?(input: PreparedSummonInput): PreparedSummon;
  executeSummonTransaction?(
    input: PreparedSummonInput | PreparedSummon,
  ): Promise<SummonExecutionResult>;
  moveCard?(
    card: GameCard,
    player: GamePlayer,
    zone: CanonicalZone,
    options?: MoveCardOptions,
  ): MaybePromise<MoveCardResult>;
  devLog?(code: string, detail?: unknown): void;
  queueVisualFeedback?(feedback: VisualFeedback): void;
}

export interface GameZonesHost extends GameCoreHost {
  zoneOpDepth: number;
  zoneOpSnapshot: ZoneSnapshot | null;
  moveCard: MoveCardFunction;
  captureZoneSnapshot(contextLabel?: string): ZoneSnapshot;
  restoreZoneSnapshot(snapshot: ZoneSnapshot | null | undefined): void;
  collectAllZoneCards(): GameCard[];
  snapshotCardState(card: GameCard | null | undefined): CardStateSnapshot | null;
}

export interface GameSummonHost extends GameCoreHost {
  nextSummonId: number;
  activeSummonTransaction: SummonTransaction | null;
  lastSummonTransaction: SummonTransactionSnapshot | null;
  summonProcedureDepth: number;
  createPreparedSummon(input?: PreparedSummonInput): PreparedSummon;
  executeSummonTransaction(input?: PreparedSummonInput | PreparedSummon): Promise<SummonExecutionResult>;
}

export interface FullGameHost extends GameRuntimeState, GameCoreHost {
  nextDuelCardId: number;
  nextSummonId: number;
  activeSummonTransaction: SummonTransaction | null;
  lastSummonTransaction: SummonTransactionSnapshot | null;
  summonProcedureDepth: number;
  zoneOpDepth: number;
  zoneOpSnapshot: ZoneSnapshot | null;
  disposed: boolean;
  isDisposed(): boolean;
  ensureDuelCardId: {
    (card: GameCard): DuelCardId;
    (card: null | undefined): null;
  };
  moveCard: MoveCardFunction;
  captureZoneSnapshot(contextLabel?: string): ZoneSnapshot;
  restoreZoneSnapshot(snapshot: ZoneSnapshot | null | undefined): void;
  collectAllZoneCards(): GameCard[];
  snapshotCardState(card: GameCard | null | undefined): CardStateSnapshot | null;
  createPreparedSummon(input?: PreparedSummonInput): PreparedSummon;
  executeSummonTransaction(input?: PreparedSummonInput | PreparedSummon): Promise<SummonExecutionResult>;
  updateBoard?(): MaybePromise<unknown>;
}

export interface GameHelpersHost {
  player: GamePlayer;
  bot: GamePlayer;
  nextDuelCardId: number;
  resolvePlayerById(id: PlayerId | string | null | undefined): GamePlayer | null;
  resolveCardData(identifier: number | string): unknown;
  createCardForOwner(
    identifier: number | string,
    owner: PlayerId | GamePlayer,
    overrides?: { duelCardId?: DuelCardId; position?: BattlePosition; isFacedown?: boolean },
  ): GameCard | null;
}

export interface GameDeckHost {
  player: GamePlayer;
  ui: GameUiPort;
  cardAnimationsReady: boolean;
  ensureDuelCardId: {
    (card: GameCard): DuelCardId;
    (card: null | undefined): null;
  };
  devLog?(code: string, detail?: unknown): void;
  queueCardAnimation?(intent: unknown): void;
}

export interface GameTurnHost extends GameCoreHost {
  phaseDelayMs: number;
  isDisposed(): boolean;
}

export interface GameActionGuardHost {
  _arenaTracker?: ArenaProgressTrackerPort | null;
  activeDamageStepTransaction: DamageStepTransaction | null;
  activeSummonTransaction: SummonTransaction | null;
  chainSystem: ChainRuntimePort;
  damageStepProcedureDepth: number;
  eventResolutionDepth: number;
  isResolvingEffect: boolean;
  phase: GamePhase;
  selectionState: SelectionSessionState;
  summonProcedureDepth: number;
  targetSelection: ActiveSelectionSession | null;
  turn: PlayerId;
  turnCounter: number;
  ui: GameUiPort;
  devLog(code: string, detail?: unknown): void;
  isDisposed(): boolean;
}

export interface GameUiHost {
  player: GamePlayer;
  bot: GamePlayer;
  phase: GamePhase;
  turn: PlayerId;
  turnCounter: number;
  ui: GameUiPort;
  effectEngine: EffectEngineRuntimePort;
  isDisposed(): boolean;
}

export interface GameDevToolsHost extends GameHelpersHost {
  phase: GamePhase;
  turn: PlayerId;
  turnCounter: number;
  ui: GameUiPort;
  effectEngine: EffectEngineRuntimePort;
  devModeEnabled: boolean;
}

export interface GameAnalyticsHost {
  player: GamePlayer;
  bot: GamePlayer;
  turnCounter: number;
  laboratoryModeEnabled: boolean;
}

export interface GameStateHost extends GameHelpersHost {
  chainSystem: ChainRuntimePort;
  effectEngine: EffectEngineRuntimePort;
  phase: GamePhase;
  turn: PlayerId;
  turnCounter: number;
  ui: GameUiPort;
  nextDuelCardId: number;
}

export type GameExtraDeckHost = GameSummonHost;
