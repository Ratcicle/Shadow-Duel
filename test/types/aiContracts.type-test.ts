import type {
  AIAction,
  AIActionByType,
  AIActionOf,
  AIActionType,
  BeamSearchResult,
  GameTreeSearchResult,
  GreedySearchResult,
  ScoredAIAction,
  SimulatedBattleAction,
  StrategyConstructor,
  StrategyRegistryPort,
  StrategyRuntimePort,
  TurnLineSearchResult,
} from "../../src/core/contracts/ai.js";
import type {
  AiStateShape,
  BeamPerspectiveGameState,
  BotPerspectiveGameState,
  GameTreeSimulatedPlayerState,
  GameTreeSimulationGameState,
  GameTreeStateShape,
  LiveGameState,
  PerspectiveGameState,
  PublicGameState,
  ReplayGameState,
  SimulationCloneProfile,
  SimulatedCardState,
  SimulationGameState,
} from "../../src/core/contracts/aiState.js";
import type {
  ArenaCancelledDuelResult,
  ArenaCompletedDuelResult,
  ArenaDuelResult,
  ArenaSearchOptions,
} from "../../src/core/contracts/arena.js";
import type { CanonicalGameStateSnapshot } from "../../src/core/contracts/replay.js";
import type { getPublicState } from "../../src/core/game/state/serialization.js";
import type {
  BotGamePort,
  BotMainPhaseActionExecutor,
  BotMainPhaseActionExecutors,
  BotRuntimePort,
} from "../../src/core/contracts/bot.js";
import { buildPrioritizedAction } from "../../src/core/ai/common/actionGeneration.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;

type Expect<Value extends true> = Value;

type ExpectedAIActionType =
  | "ascension"
  | "extraDeckProcedure"
  | "special_summon_sanctum_protector"
  | "position_change"
  | "summon"
  | "spell"
  | "set_spell_trap"
  | "spellTrapEffect"
  | "graveyardSpellEffect"
  | "fieldEffect"
  | "monsterEffect"
  | "graveyardMonsterEffect"
  | "handIgnition";

type ActionTypesAreExact = Expect<Equal<AIActionType, ExpectedAIActionType>>;
type ActionMapKeysAreExact = Expect<
  Equal<keyof AIActionByType, ExpectedAIActionType>
>;
type ExecutorKeysAreExact = Expect<
  Equal<keyof BotMainPhaseActionExecutors, ExpectedAIActionType>
>;
type ReplayStateKeepsCanonicalSnapshot = Expect<
  Equal<ReplayGameState, CanonicalGameStateSnapshot>
>;
type SimulationProfilesMatchRealCloneFactories = Expect<
  Equal<SimulationCloneProfile, "gameTree" | "turnLine">
>;
type PublicStateIsExplicitReturn = Expect<
  Equal<ReturnType<typeof getPublicState>, PublicGameState>
>;
type SearchScoresAreRequired = Expect<
  BeamSearchResult extends { score: number }
    ? GreedySearchResult extends { score: number }
      ? GameTreeSearchResult extends { score: number }
        ? TurnLineSearchResult extends { score: number }
          ? true
          : false
        : false
      : false
    : false
>;
type GameTreePlayerKeysAreExact = Expect<
  Equal<
    keyof GameTreeSimulatedPlayerState,
    | "id"
    | "name"
    | "lp"
    | "hand"
    | "field"
    | "graveyard"
    | "extraDeck"
    | "spellTrap"
    | "fieldSpell"
    | "summonCount"
    | "debug"
  >
>;

declare const liveState: LiveGameState;
declare const publicState: PublicGameState;
declare const replayState: ReplayGameState;
declare const perspectiveState: PerspectiveGameState;
declare const simulationState: SimulationGameState;
declare const botPerspectiveState: BotPerspectiveGameState;
declare const beamPerspectiveState: BeamPerspectiveGameState;
declare const gameTreeState: GameTreeSimulationGameState;
declare const simulatedCard: SimulatedCardState;
declare const bot: BotRuntimePort;
declare const game: BotGamePort;
declare const strategy: StrategyRuntimePort;
declare const strategyConstructor: StrategyConstructor;
declare const registry: StrategyRegistryPort;

const summonAction: AIActionOf<"summon"> = {
  type: "summon",
  index: 0,
  position: "attack",
};
const spellAction: AIActionOf<"spell"> = {
  type: "spell",
  index: 1,
};
const extraDeckProcedureAction: AIActionOf<"extraDeckProcedure"> = {
  type: "extraDeckProcedure",
  extraDeckIndex: 0,
  summonProcedure: "contact_fusion",
  requiredMaterialCount: 2,
};
const builtExtraDeckProcedureAction = buildPrioritizedAction({
  type: "extraDeckProcedure",
  extra: {
    summonProcedure: "graveyard_banish_fusion",
    requiredMaterialCount: 3,
  },
});
const plannerBattleAction: SimulatedBattleAction = {
  type: "simulatedBattle",
  direct: true,
};
const appliedSimulationState = applyGenericSimulatedMainPhaseAction(
  simulationState,
  summonAction,
);
const appliedPerspectiveState = applyGenericSimulatedMainPhaseAction(
  perspectiveState,
  spellAction,
);
type BuiltExtraDeckTypeIsCorrelated = Expect<
  Equal<typeof builtExtraDeckProcedureAction.type, "extraDeckProcedure">
>;
type AppliedSimulationKeepsProfile = Expect<
  Equal<typeof appliedSimulationState, SimulationGameState>
>;
type AppliedPerspectiveKeepsProfile = Expect<
  Equal<typeof appliedPerspectiveState, PerspectiveGameState>
>;
const closedAction: AIAction = summonAction;
const scoredAction: ScoredAIAction = {
  action: summonAction,
  score: 100,
};
const summonExecutor: BotMainPhaseActionExecutor<"summon"> = async (
  _bot,
  _game,
  action,
) => action.type === "summon";

registry.registerStrategy("type-test", strategyConstructor);
const registeredStrategy = registry.getStrategyFor("type-test", bot);
const registeredStrategyIds = registry.getRegisteredStrategyIds();

const legacyTurnLineSearchOptions: ArenaSearchOptions = {
  turnLineSearchMode: "critical",
  turnLineSearchTurnMode: "mainBattleMain2",
  turnLineSearchBeamWidth: 3,
  turnLineSearchMaxDepth: 4,
  turnLineSearchNodeBudget: 200,
  turnLineSearchCandidateLimit: 8,
};
const cloneBoundaryMayPreserveUndefined: Pick<
  AiStateShape,
  "turn" | "phase"
> = {
  turn: undefined,
  phase: undefined,
};
const gameTreeBoundaryMayPreserveUndefined: Pick<
  GameTreeStateShape,
  "turn" | "phase"
> = {
  turn: undefined,
  phase: undefined,
};
const completedArenaDuel: ArenaCompletedDuelResult = {
  duelNumber: 1,
  winner: "player",
  turns: 3,
  type: "completed",
  reason: "lp_zero",
  totalTimeMs: 100,
};
const cancelledArenaDuel: ArenaCancelledDuelResult = {
  type: "cancelled",
  duelNumber: 2,
};
const arenaDuelResults: ArenaDuelResult[] = [
  completedArenaDuel,
  cancelledArenaDuel,
];

// contract-negative: public snapshots cannot be used as mutable live state.
// @ts-expect-error
const liveFromPublic: LiveGameState = publicState;

// contract-negative: replay wire snapshots are distinct from public AI state.
// @ts-expect-error
const publicFromReplay: PublicGameState = replayState;

// contract-negative: live state has not passed through a perspective clone.
// @ts-expect-error
const perspectiveFromLive: PerspectiveGameState = liveState;

// contract-negative: perspective and simulation clone brands are distinct.
// @ts-expect-error
const simulationFromPerspective: SimulationGameState = perspectiveState;

// contract-negative: clone profiles remain distinct even within perspective state.
// @ts-expect-error
const botPerspectiveFromBeam: BotPerspectiveGameState = beamPerspectiveState;

// contract-negative: the GameTree profile intentionally omits the hidden Deck.
// @ts-expect-error
gameTreeState.bot.deck;

// contract-negative: GameTree and full simulation profiles have distinct shapes.
// @ts-expect-error
const fullSimulationFromGameTree: SimulationGameState = gameTreeState;

// contract-negative: only a real clone may establish simulated-card identity.
// @ts-expect-error
const unbrandedSimulatedCard: SimulatedCardState = { name: "raw clone" };

// contract-negative: a planner-only battle action is not executable by the dispatcher.
// @ts-expect-error
const plannerActionAsRuntimeAction: AIAction = { type: "simulatedBattle" };

// contract-negative: AI action discriminants form a closed runtime union.
// @ts-expect-error
const unknownRuntimeAction: AIAction = { type: "phase_advance" };

// contract-negative: planner-only battles never reach the main-phase dispatcher.
// @ts-expect-error
applyGenericSimulatedMainPhaseAction(simulationState, plannerBattleAction);

// contract-negative: the main-phase dispatcher rejects unknown action types.
// @ts-expect-error
applyGenericSimulatedMainPhaseAction(perspectiveState, { type: "phase_advance" });

// contract-negative: live runtime state must be cloned before simulation.
// @ts-expect-error
applyGenericSimulatedMainPhaseAction(liveState, summonAction);

// contract-negative: public replay snapshots are not mutable simulation state.
// @ts-expect-error
applyGenericSimulatedMainPhaseAction(publicState, summonAction);

const extraDeckProcedureWithDeadField: AIActionOf<"extraDeckProcedure"> = {
  type: "extraDeckProcedure",
  // contract-negative: the removed procedureType field was never consumed by the runtime.
  // @ts-expect-error
  procedureType: "contact_fusion",
};

buildPrioritizedAction({
  type: "spell",
  // contract-negative: an action extra is correlated with its inferred discriminant.
  // @ts-expect-error
  extra: { requiredMaterialCount: 2 },
});

buildPrioritizedAction({
  type: "summon",
  // contract-negative: extras cannot replace the canonical action discriminant.
  // @ts-expect-error
  extra: { type: "spell" },
});

// contract-negative: position-change actions require their correlated destination.
// @ts-expect-error
const incompletePositionChange: AIActionOf<"position_change"> = {
  type: "position_change",
};

// contract-negative: a summon executor cannot receive a spell action.
// @ts-expect-error
summonExecutor(bot, game, spellAction);

// contract-negative: the executor manifest must cover all thirteen action types.
// @ts-expect-error
const incompleteExecutors: BotMainPhaseActionExecutors = {
  summon: summonExecutor,
};

// contract-negative: every scored action result carries an explicit score.
// @ts-expect-error
const unscoredAction: ScoredAIAction = { action: summonAction };

declare const incompatibleConstructor: new (
  id: number,
) => StrategyRuntimePort;

// contract-negative: strategy constructors receive the canonical bot port.
// @ts-expect-error
registry.registerStrategy("invalid", incompatibleConstructor);

const invalidCancelledArenaDuel: ArenaDuelResult = {
  type: "cancelled",
  duelNumber: 3,
  // contract-negative: cancelled duels intentionally carry no completed metrics.
  // @ts-expect-error
  winner: "draw",
};

// contract-negative: completed results require the full metrics projection.
// @ts-expect-error
const incompleteCompletedArenaDuel: ArenaDuelResult = {
  type: "completed",
  duelNumber: 4,
};

void closedAction;
void extraDeckProcedureAction;
void builtExtraDeckProcedureAction;
void plannerBattleAction;
void appliedSimulationState;
void appliedPerspectiveState;
void scoredAction;
void simulatedCard;
void simulationState;
void botPerspectiveState;
void strategy;
void liveFromPublic;
void publicFromReplay;
void perspectiveFromLive;
void simulationFromPerspective;
void botPerspectiveFromBeam;
void gameTreeState;
void fullSimulationFromGameTree;
void unbrandedSimulatedCard;
void plannerActionAsRuntimeAction;
void unknownRuntimeAction;
void extraDeckProcedureWithDeadField;
void incompletePositionChange;
void incompleteExecutors;
void unscoredAction;
void legacyTurnLineSearchOptions;
void cloneBoundaryMayPreserveUndefined;
void gameTreeBoundaryMayPreserveUndefined;
void arenaDuelResults;
void registeredStrategy;
void registeredStrategyIds;
void invalidCancelledArenaDuel;
void incompleteCompletedArenaDuel;

const actionTypesAreExact: ActionTypesAreExact = true;
const actionMapKeysAreExact: ActionMapKeysAreExact = true;
const executorKeysAreExact: ExecutorKeysAreExact = true;
const replayStateKeepsCanonicalSnapshot: ReplayStateKeepsCanonicalSnapshot =
  true;
const simulationProfilesMatchRealCloneFactories: SimulationProfilesMatchRealCloneFactories =
  true;
const publicStateIsExplicitReturn: PublicStateIsExplicitReturn = true;
const searchScoresAreRequired: SearchScoresAreRequired = true;
const gameTreePlayerKeysAreExact: GameTreePlayerKeysAreExact = true;
const builtExtraDeckTypeIsCorrelated: BuiltExtraDeckTypeIsCorrelated = true;
const appliedSimulationKeepsProfile: AppliedSimulationKeepsProfile = true;
const appliedPerspectiveKeepsProfile: AppliedPerspectiveKeepsProfile = true;

void actionTypesAreExact;
void actionMapKeysAreExact;
void executorKeysAreExact;
void replayStateKeepsCanonicalSnapshot;
void simulationProfilesMatchRealCloneFactories;
void publicStateIsExplicitReturn;
void searchScoresAreRequired;
void gameTreePlayerKeysAreExact;
void builtExtraDeckTypeIsCorrelated;
void appliedSimulationKeepsProfile;
void appliedPerspectiveKeepsProfile;
