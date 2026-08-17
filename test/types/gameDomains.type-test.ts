import Game from "../../src/core/Game.js";
import type { GameAttachedMethods } from "../../src/core/game/attachments.js";
import { GAME_ATTACHMENT_NAMES } from "../../src/core/game/attachments.js";
import type {
  CardStatusValueMap,
  GameCard,
  KnownCardStatusInput,
} from "../../src/core/contracts/cards.js";
import type {
  GameOptions,
  StartWithDecksOptions,
} from "../../src/core/contracts/game.js";
import type {
  ActivationPipelineConfig,
  ActivationPipelineConfigInput,
  ActivationPipelineContext,
  ActivationPipelineResult,
  ActivationResolutionContext,
} from "../../src/core/contracts/activation.js";
import type {
  DamageStepCardSnapshot,
  DamageStepExecutionResult,
  DamageStepOutcomeSnapshot,
  DamageStepPreparationFailure,
  DamageStepState,
  DamageStepStatus,
  DamageStepTransaction,
  DamageStepTransactionInput,
  DamageStepTransactionSnapshot,
  FieldTransferMoveCardOptions,
  FullGameHost,
  GameDeckHost,
  LegacyMoveCardOptions,
  LegacySourceMoveCardOptions,
  MoveCardFunction,
  MoveCardOptions,
  MoveCardResult,
  PreparedSummon,
  RegularMoveCardOptions,
  SummonExecutionResult,
  SummonEntryMoveCardOptions,
  SummonState,
  SummonStatus,
  SummonTransaction,
  SummonTransactionSnapshot,
  TokenEntryMoveCardOptions,
  ZoneOpFailure,
} from "../../src/core/contracts/gameRuntime.js";
import type { GamePlayer } from "../../src/core/contracts/player.js";
import type {
  DamageStepId,
  DuelCardId,
  SummonId,
} from "../../src/core/contracts/primitives.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;

type Expect<Value extends true> = Value;

type ExpectedGameOptionKey =
  | "disableChains"
  | "disableTraps"
  | "disableEffectActivation"
  | "randomSeed"
  | "captureReplay"
  | "laboratoryMode"
  | "laboratoryRevealBotHand"
  | "laboratoryUseBot"
  | "playerName"
  | "opponentName"
  | "opponentOverride"
  | "botPreset"
  | "renderer"
  | "replayMode"
  | "damageCalculationStatPresentationDelayMs"
  | "normalDuelStrategicReport"
  | "playerArchetype"
  | "botArchetype"
  | "devMode"
  | "chainResponseTimeoutMs";

type GameOptionsHaveExactKeyset = Expect<
  Equal<keyof GameOptions, ExpectedGameOptionKey>
>;
type AttachmentsHaveExactKeyset = Expect<
  Equal<
    keyof GameAttachedMethods,
    (typeof GAME_ATTACHMENT_NAMES)[number]
  >
>;
const gameOptionsHaveExactKeyset: GameOptionsHaveExactKeyset = true;
const attachmentsHaveExactKeyset: AttachmentsHaveExactKeyset = true;

declare const game: Game;
declare const card: GameCard;
declare const player: GamePlayer;
declare const duelCardId: DuelCardId;
declare const summonId: SummonId;
declare const damageStepId: DamageStepId;
declare const preparedSummon: PreparedSummon;
declare const summonTransaction: SummonTransaction;
declare const summonSnapshot: SummonTransactionSnapshot;
declare const damageStepTransaction: DamageStepTransaction;
declare const deckHost: GameDeckHost;

const fullHost: FullGameHost = game;
const exactDeckSetup: StartWithDecksOptions = {
  exactDecks: true,
  playerDeck: [{ id: 1, duelCardId }],
  playerExtraDeck: [],
  botDeck: [{ id: 2, duelCardId: 2 }],
  botExtraDeck: [],
  startingPlayer: "player",
  preserveDeckOrder: true,
};
const generatedDeckSetup: StartWithDecksOptions = {
  exactDecks: false,
  playerDeck: [1, 2, 3],
  playerExtraDeck: [29],
  botDeck: [4, 5, 6],
  botExtraDeck: [],
};
const validOptions: GameOptions = {
  disableChains: true,
  disableTraps: false,
  disableEffectActivation: false,
  randomSeed: "seed",
  captureReplay: true,
  laboratoryMode: true,
  laboratoryRevealBotHand: true,
  laboratoryUseBot: false,
  playerName: "Player",
  opponentName: "Opponent",
  opponentOverride: player,
  botPreset: "shadowheart",
  renderer: { destroy(): void {} },
  replayMode: "live",
  damageCalculationStatPresentationDelayMs: 0,
  normalDuelStrategicReport: false,
  playerArchetype: "shadowheart",
  botArchetype: "luminarch",
  devMode: false,
  chainResponseTimeoutMs: 1_000,
};

// contract-negative: Game options are closed to the twenty supported keys.
// @ts-expect-error
const unknownGameOption: GameOptions = { experimentalRules: true };

// contract-negative: generated deck mode accepts raw numeric definition ids only.
// @ts-expect-error
const generatedDeckWithReplayIdentity: StartWithDecksOptions = {
  exactDecks: false,
  playerDeck: [{ id: 1, duelCardId }],
};

const unknownStartingPlayer: StartWithDecksOptions = {
  exactDecks: true,
  // contract-negative: duel seats remain a closed union.
  // @ts-expect-error
  startingPlayer: "spectator",
};

const allocatedDuelId: DuelCardId = game.ensureDuelCardId(card);
const nullableDuelId: null = game.ensureDuelCardId(null);

// contract-negative: only the real allocator may establish DuelCardId identity.
// @ts-expect-error
const rawDuelId: DuelCardId = 1;

// contract-negative: live card, summon and Damage Step identities are nominally distinct.
// @ts-expect-error
const summonIdentityAsCard: DuelCardId = summonId;

// contract-negative: Damage Step identity is not Summon identity.
// @ts-expect-error
const damageStepIdentityAsSummon: SummonId = damageStepId;

const attackStatus: KnownCardStatusInput = { status: "atk", value: 700 };
const tunerStatus: KnownCardStatusInput = { status: "isTuner", value: true };
const attackValue: CardStatusValueMap["atk"] = 700;
const tunerValue: CardStatusValueMap["isTuner"] = false;

const invalidAttackStatus: KnownCardStatusInput = {
  status: "atk",
  // contract-negative: a numeric Card status cannot receive a boolean value.
  // @ts-expect-error
  value: true,
};

const invalidTunerStatus: KnownCardStatusInput = {
  status: "isTuner",
  // contract-negative: a boolean Card status cannot receive a numeric value.
  // @ts-expect-error
  value: 1,
};

// contract-negative: unknown legacy statuses stay outside the known status contract.
// @ts-expect-error
const unknownKnownStatus: KnownCardStatusInput = "future_status";

const broadMoveOptions: MoveCardOptions = {
  fromZone: "hand",
  contextLabel: "type_test",
};
const regularMoveOptions: RegularMoveCardOptions = {
  fromZone: "field",
  contextLabel: "type_test",
};
const fieldTransferMoveOptions: FieldTransferMoveCardOptions = {
  fromZone: "field",
};
const summonEntryMoveOptions: SummonEntryMoveCardOptions = {
  fromZone: "hand",
  summonOrigin: "effect_resolution",
  summonMethod: "special",
};
const tokenMoveOptions: TokenEntryMoveCardOptions = {
  fromZone: "token",
  summonOrigin: "procedure",
};
const legacyZoneMoveOptions: LegacyMoveCardOptions = { fromZone: "banish" };
const legacySourceMoveOptions: LegacySourceMoveCardOptions = {
  fromZone: "banish",
};
const moveCardFunction: MoveCardFunction = game.moveCard;
const regularMoveCall = game.moveCard(
  card,
  player,
  "graveyard",
  regularMoveOptions,
);
const fieldTransferMoveCall = game.moveCard(
  card,
  player,
  "field",
  fieldTransferMoveOptions,
);
const summonEntryMoveCall = game.moveCard(
  card,
  player,
  "field",
  summonEntryMoveOptions,
);
const tokenEntryMoveCall = game.moveCard(
  card,
  player,
  "field",
  tokenMoveOptions,
);
const legacyDestinationMoveCall = game.moveCard(
  card,
  player,
  "banish",
  legacyZoneMoveOptions,
);
const legacySourceMoveCall = game.moveCard(
  card,
  player,
  "graveyard",
  legacySourceMoveOptions,
);

// contract-negative: entering the field from a canonical non-field zone requires an explicit summon origin.
// @ts-expect-error
moveCardFunction(card, player, "field", { fromZone: "hand" });

// contract-negative: token entry also requires an explicit summon origin.
// @ts-expect-error
moveCardFunction(card, player, "field", { fromZone: "token" });

// contract-negative: the legacy banish source boundary cannot be used to enter the field.
// @ts-expect-error
moveCardFunction(card, player, "field", { fromZone: "banish" });

const invalidCanonicalSource: RegularMoveCardOptions = {
  // contract-negative: the legacy banish alias stays outside canonical regular movement options.
  // @ts-expect-error
  fromZone: "banish",
};
const moveResult: MoveCardResult = {
  success: true,
  fromZone: "token",
  toZone: "field",
};
const summonResult: SummonExecutionResult = {
  success: true,
  summonId,
  transaction: summonSnapshot,
};
const zoneFailure: ZoneOpFailure = {
  success: false,
  reason: "rolled back",
  rolledBack: true,
};

const activationContext: ActivationPipelineContext = {
  fromHand: true,
  activationZone: "hand",
  targetSelections: {},
  costsPaid: false,
};
const activationResolutionContext: ActivationResolutionContext = {
  source: card,
  sourceCard: card,
  player,
  activationZone: "hand",
  activationContext,
};
const activationResult: ActivationPipelineResult = {
  success: true,
  ok: true,
  needsSelection: false,
  activationContext,
  resolutionContext: activationResolutionContext,
};
const activationConfig: ActivationPipelineConfig = {
  card,
  owner: player,
  activationContext,
  activate: () => activationResult,
};
const activationConfigInput: ActivationPipelineConfigInput = {
  card,
  owner: player,
};
const activationPipelineCall: Promise<ActivationPipelineResult> =
  game.runActivationPipeline(activationConfigInput);

// contract-negative: the normalized configuration requires the activation callback.
// @ts-expect-error
const missingActivationCallback: ActivationPipelineConfig = {
  card,
  owner: player,
};

const invalidActivationZone: ActivationPipelineContext = {
  // contract-negative: contextual effect-only zones are not activation zones.
  // @ts-expect-error
  activationZone: "removed",
};

// contract-negative: normalized Activation results always carry all three legacy booleans.
// @ts-expect-error
const incompleteActivationResult: ActivationPipelineResult = {
  success: true,
  ok: true,
};

const invalidActivationConfig: ActivationPipelineConfigInput = {
  card,
  // contract-negative: the Activation configuration surface is closed.
  // @ts-expect-error
  unexpectedActivationMode: "automatic",
};

// contract-negative: pipeline context and normalized result remain distinct shapes.
// @ts-expect-error
const resultFromActivationContext: ActivationPipelineResult = activationContext;

const invalidResolutionContext: ActivationResolutionContext = {
  // contract-negative: a Player is not a valid Activation source card.
  // @ts-expect-error
  source: player,
};

// contract-negative: normalized results never expose the legacy banish alias.
// @ts-expect-error
const legacyAliasInResult: MoveCardResult = { toZone: "banish" };

// contract-negative: a rollback failure must carry its literal failure invariants.
// @ts-expect-error
const incompleteZoneFailure: ZoneOpFailure = {
  success: false,
  reason: "rolled back",
};

const damageStepInput: DamageStepTransactionInput = {
  attacker: card,
  defender: null,
  attackerOwner: player,
  defenderOwner: null,
  consumeBattleLpLossFeedback: (_damagedPlayer, amount) => amount > 0,
};
const preparedDamageStep = game.createDamageStepTransaction(damageStepInput);
let allocatedDamageStepId: DamageStepId | null = null;
if ("damageStepId" in preparedDamageStep) {
  allocatedDamageStepId = preparedDamageStep.damageStepId;
}

const damageStepCardSnapshot: DamageStepCardSnapshot = {
  cardId: 1,
  instanceId: 10,
  name: "Type Test Attacker",
  ownerId: "player",
  zone: "field",
  locationVersion: 3,
  position: "attack",
  faceDown: false,
};
const damageStepOutcomeSnapshot: DamageStepOutcomeSnapshot = {
  committed: true,
  battled: true,
  damageDealt: 800,
  damagedPlayerId: "opponent",
  healingApplied: 0,
  targetDestroyed: true,
  attackerDestroyed: false,
  destructionInstanceIds: [11],
  movedAtEndInstanceIds: [11],
};
const damageStepSnapshot: DamageStepTransactionSnapshot = {
  damageStepId,
  status: "completed",
  timing: "end_of_damage_step",
  sequenceIndex: 1,
  directAttack: false,
  attacker: damageStepCardSnapshot,
  defender: null,
  attackerOwnerId: "player",
  defenderOwnerId: "opponent",
  revealedDefender: true,
  stoppedBeforeCalculation: false,
  outcome: damageStepOutcomeSnapshot,
  failureReason: null,
};
const damageStepState: DamageStepState = {
  active: false,
  transaction: null,
  last: damageStepSnapshot,
};
const observedDamageStepState: DamageStepState = game.getDamageStepState();
const damageStepExecution = game.executeDamageStepTransaction(
  damageStepTransaction,
);
const successfulDamageStep: DamageStepExecutionResult = {
  ok: true,
  success: true,
  damageStepId,
  damageDealt: 800,
  targetDestroyed: true,
  attackerDestroyed: false,
  stoppedBeforeCalculation: false,
};
const failedDamageStep: DamageStepExecutionResult = {
  ok: false,
  success: false,
  damageStepId,
  reason: "damage_step_failed",
  damageDealt: 0,
  targetDestroyed: false,
  attackerDestroyed: false,
};
const rejectedDamageStep: DamageStepExecutionResult = {
  ok: false,
  reason: "damage_step_transaction_not_active",
};
const damageStepPreparationFailure: DamageStepPreparationFailure = {
  ok: false,
  reason: "missing_damage_step_attacker",
};
const activeDamageStepStatus: DamageStepStatus = "active";

const removedDamageStepInput: DamageStepTransactionInput = {
  attacker: card,
  // contract-negative: the removed legacy target field is rejected by the input contract.
  // @ts-expect-error
  target: card,
};

const rawDamageStepSnapshot: DamageStepTransactionSnapshot = {
  ...damageStepSnapshot,
  // contract-negative: serialized Damage Step transactions retain their branded identity.
  // @ts-expect-error
  damageStepId: 1,
};

// contract-negative: a live Damage Step transaction is not its serializable snapshot.
// @ts-expect-error
const damageStepSnapshotFromTransaction: DamageStepTransactionSnapshot =
  damageStepTransaction;

// contract-negative: Damage Step status is a closed state machine.
// @ts-expect-error
const unknownDamageStepStatus: DamageStepStatus = "resolving";

const inconsistentDamageStepResult: DamageStepExecutionResult = {
  ok: true,
  // contract-negative: a success result must retain its success literal.
  // @ts-expect-error
  success: false,
  damageStepId,
  damageDealt: 0,
  targetDestroyed: false,
  attackerDestroyed: false,
  stoppedBeforeCalculation: false,
};

const preparedId: null = preparedSummon.summonId;
const runtimeSummonId: number = summonTransaction.summonId;
const closedSummonStatus: SummonStatus = "awaiting_negation";
const summonState: SummonState = {
  active: true,
  transaction: summonSnapshot,
  last: null,
};

// contract-negative: prepared input is not a committed runtime transaction.
// @ts-expect-error
const transactionFromPrepared: SummonTransaction = preparedSummon;

// contract-negative: a live transaction contains cards/functions and is not its snapshot.
// @ts-expect-error
const snapshotFromTransaction: SummonTransactionSnapshot = summonTransaction;

// contract-negative: Summon status is a closed state machine.
// @ts-expect-error
const unknownSummonStatus: SummonStatus = "resolving";

// contract-negative: the deck host deliberately has no zone-movement capability.
// @ts-expect-error
deckHost.moveCard(card, player, "graveyard");

void fullHost;
void exactDeckSetup;
void generatedDeckSetup;
void validOptions;
void unknownGameOption;
void generatedDeckWithReplayIdentity;
void unknownStartingPlayer;
void allocatedDuelId;
void nullableDuelId;
void rawDuelId;
void summonIdentityAsCard;
void damageStepIdentityAsSummon;
void attackStatus;
void tunerStatus;
void attackValue;
void tunerValue;
void invalidAttackStatus;
void invalidTunerStatus;
void unknownKnownStatus;
void broadMoveOptions;
void regularMoveOptions;
void fieldTransferMoveOptions;
void summonEntryMoveOptions;
void legacyZoneMoveOptions;
void legacySourceMoveOptions;
void tokenMoveOptions;
void moveCardFunction;
void regularMoveCall;
void fieldTransferMoveCall;
void summonEntryMoveCall;
void tokenEntryMoveCall;
void legacyDestinationMoveCall;
void legacySourceMoveCall;
void invalidCanonicalSource;
void moveResult;
void summonResult;
void zoneFailure;
void activationContext;
void activationResolutionContext;
void activationResult;
void activationConfig;
void activationConfigInput;
void activationPipelineCall;
void missingActivationCallback;
void invalidActivationZone;
void incompleteActivationResult;
void invalidActivationConfig;
void resultFromActivationContext;
void invalidResolutionContext;
void legacyAliasInResult;
void incompleteZoneFailure;
void damageStepInput;
void preparedDamageStep;
void allocatedDamageStepId;
void damageStepCardSnapshot;
void damageStepOutcomeSnapshot;
void damageStepSnapshot;
void damageStepState;
void observedDamageStepState;
void damageStepExecution;
void successfulDamageStep;
void failedDamageStep;
void rejectedDamageStep;
void damageStepPreparationFailure;
void activeDamageStepStatus;
void removedDamageStepInput;
void rawDamageStepSnapshot;
void damageStepSnapshotFromTransaction;
void unknownDamageStepStatus;
void inconsistentDamageStepResult;
void preparedId;
void runtimeSummonId;
void closedSummonStatus;
void summonState;
void transactionFromPrepared;
void snapshotFromTransaction;
void unknownSummonStatus;
void gameOptionsHaveExactKeyset;
void attachmentsHaveExactKeyset;
