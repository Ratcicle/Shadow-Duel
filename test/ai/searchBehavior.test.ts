import { fixtureGameTreeSearch as gameTreeSearch } from "../helpers/gameTree.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import assert from "node:assert/strict";
import test from "node:test";

import {
  beamSearchTurn,
  greedySearchWithEvalV2,
} from "../../src/core/ai/BeamSearch.js";
import {
  estimateSearchComplexity,
  shouldUseGameTreeSearch,
} from "../../src/core/ai/GameTreeSearch.js";
import { turnLineSearch } from "../../src/core/ai/TurnLineSearch.js";
import type { AIAction, AIState, TurnLineSearchCompletion } from "../../src/core/contracts/ai.js";
import type { TurnLineSimulationGameState } from "../../src/core/contracts/aiState.js";

interface SearchAction {
  type: "position_change";
  tag: string;
  priority: number;
  toPosition: "attack";
}

interface SearchCard {
  cardKind?: "monster";
  name: string;
  atk: number;
  def: number;
}

interface SearchPlayer {
  id: "bot" | "player";
  name: string;
  lp: number;
  hand: [];
  field: [];
  graveyard: [];
  deck: [];
  extraDeck: [];
  banished: [];
  fieldSpell: null;
  spellTrap: [];
  summonCount: number;
  additionalNormalSummons: number;
  additionalNormalSummonPermissions: [];
  normalSummonsThisTurn: [];
  specialSummonRestrictions: [];
  effectActivationRestrictions: [];
  controllerType: "ai";
  debug: false;
}

interface SearchState {
  bot: SearchPlayer;
  player: SearchPlayer;
  turn?: "bot" | "player";
  phase: "main1";
  turnCounter: number;
}

interface MutableScoreState {
  bot: { lp: number };
}

interface TreeSearchPlayer {
  id: "bot" | "player";
  name: string;
  lp: number;
  hand: SearchCard[];
  field: SearchCard[];
  graveyard: SearchCard[];
  extraDeck: SearchCard[];
  spellTrap: SearchCard[];
  fieldSpell: null;
  summonCount: number;
  debug: false;
}

interface TreeSearchState {
  bot: TreeSearchPlayer;
  player: TreeSearchPlayer;
  turn: "bot";
  phase: "main1";
  turnCounter: number;
}

function makePlayer(id: "bot" | "player"): SearchPlayer {
  return {
    id,
    name: id,
    lp: 8000,
    hand: [],
    field: [],
    graveyard: [],
    deck: [],
    extraDeck: [],
    banished: [],
    fieldSpell: null,
    spellTrap: [],
    summonCount: 0,
    additionalNormalSummons: 0,
    additionalNormalSummonPermissions: [],
    normalSummonsThisTurn: [],
    specialSummonRestrictions: [],
    effectActivationRestrictions: [],
    controllerType: "ai",
    debug: false,
  };
}

function makeGame(): SearchState {
  const bot = makePlayer("bot");
  return {
    bot,
    player: makePlayer("player"),
    turn: "bot",
    phase: "main1",
    turnCounter: 1,
  };
}

function makeTreePlayer(id: "bot" | "player"): TreeSearchPlayer {
  return {
    id,
    name: id,
    lp: 8000,
    hand: [],
    field: [],
    graveyard: [],
    extraDeck: [],
    spellTrap: [],
    fieldSpell: null,
    summonCount: 0,
    debug: false,
  };
}

function makeTreeGame(): TreeSearchState {
  return {
    bot: makeTreePlayer("bot"),
    player: makeTreePlayer("player"),
    turn: "bot",
    phase: "main1",
    turnCounter: 1,
  };
}

const SEARCH_ACTIONS: SearchAction[] = [
  { type: "position_change", tag: "first", priority: 10, toPosition: "attack" },
  { type: "position_change", tag: "second", priority: 10, toPosition: "attack" },
  { type: "position_change", tag: "third", priority: 10, toPosition: "attack" },
];

test("beam search freezes default depth, width, discount and result shape", async () => {
  const game = makeGame();
  const strategy = {
    bot: game.bot,
    generateMainPhaseActions: () => SEARCH_ACTIONS,
    simulateMainPhaseAction(state: MutableScoreState, action: SearchAction) {
      const delta = action.tag === "first" ? 1 : action.tag === "second" ? 2 : 3;
      state.bot.lp -= delta;
    },
    evaluateBoardV2: (state: MutableScoreState) => 8000 - state.bot.lp,
    evaluateBoard: (state: MutableScoreState) => 8000 - state.bot.lp,
  };

  const result = await beamSearchTurn(game, strategy);

  assert.deepEqual(result, {
    action: SEARCH_ACTIONS[0],
    score: 2.6,
    sequence: [SEARCH_ACTIONS[0], SEARCH_ACTIONS[1]],
    nodesEvaluated: 5,
  });
});

test("beam search preserves its legacy node-budget boundary", async () => {
  const game = makeGame();
  const strategy = {
    bot: game.bot,
    generateMainPhaseActions: () => SEARCH_ACTIONS,
    simulateMainPhaseAction(state: MutableScoreState, action: SearchAction) {
      const delta = action.tag === "first" ? 1 : action.tag === "second" ? 2 : 3;
      state.bot.lp -= delta;
    },
    evaluateBoardV2: (state: MutableScoreState) => 8000 - state.bot.lp,
    evaluateBoard: (state: MutableScoreState) => 8000 - state.bot.lp,
  };

  const result = await beamSearchTurn(game, strategy, {
    maxDepth: 3,
    nodeBudget: 1,
  });

  assert.deepEqual(result, {
    action: SEARCH_ACTIONS[2],
    score: 3,
    sequence: [SEARCH_ACTIONS[2]],
    nodesEvaluated: 3,
  });
});

test("greedy search keeps the last equally scored candidate", async () => {
  const game = makeGame();
  const strategy = {
    bot: game.bot,
    generateMainPhaseActions: () => SEARCH_ACTIONS,
    simulateMainPhaseAction(state: MutableScoreState) {
      state.bot.lp -= 1;
    },
    evaluateBoardV2: (state: MutableScoreState) => 8000 - state.bot.lp,
    evaluateBoard: (state: MutableScoreState) => 8000 - state.bot.lp,
  };

  const result = await greedySearchWithEvalV2(game, strategy, {
    preGeneratedActions: SEARCH_ACTIONS,
  });

  assert.deepEqual(result, {
    action: SEARCH_ACTIONS[2],
    score: 1,
    sequence: [SEARCH_ACTIONS[2]],
  });
});

test("game-tree search freezes defaults, three-candidate beam and first-tie behavior", () => {
  const game = makeGame();
  let generationCalls = 0;
  const fourthAction: SearchAction = {
    type: "position_change",
    tag: "outside-candidate-beam",
    priority: 10,
    toPosition: "attack",
  };
  const strategy = {
    simulateMainPhaseAction: () => undefined,
    bot: game.bot,
    generateMainPhaseActions() {
      generationCalls += 1;
      return [...SEARCH_ACTIONS, fourthAction];
    },
  };

  const result = gameTreeSearch(game, strategy, game.bot);

  assert.deepEqual(result, {
    action: SEARCH_ACTIONS[0],
    score: 0,
    depth: 4,
    confidence: 0,
    // Same no-op board now has separate horizons, perspectives and windows.
    transpositionHits: 9,
  });
  assert.equal(generationCalls, 9);
  assert.equal(estimateSearchComplexity(4), 81);
  assert.equal(shouldUseGameTreeSearch(game, game.bot), false);
  assert.equal(shouldUseGameTreeSearch(game, game.bot, true), true);
});

test("game-tree search applies the legacy 0.85 future discount", () => {
  const game = makeTreeGame();
  game.bot.hand.push({ name: "Bot Material", cardKind: "monster", atk: 1000, def: 0 });
  game.player.hand.push({ name: "Player Material", atk: 1000, def: 0 });
  const summonAction = { type: "summon", index: 0, cardName: "Bot Material" } as const;
  const strategy = {
    bot: game.bot,
    generateMainPhaseActions: () => [summonAction],
    simulateMainPhaseAction: applyGenericSimulatedMainPhaseAction,
  };

  const result = gameTreeSearch(game, strategy, game.bot, 1);

  assert.equal(result.action, summonAction);
  // The summon gains 1.5 for the physical root; ending on the opponent ply
  // must not reverse that gain. The legacy discount itself is unchanged.
  assert.equal(result.score, 1.5 * Math.pow(0.85, 3));
});

test("game-tree transposition cache stops at the legacy 2000-entry boundary", () => {
  const NativeMap = globalThis.Map;
  let setCalls = 0;
  let fingerprintSetCalls = 0;
  let table: object | undefined;

  class NearLimitMap<Key, Value> extends NativeMap<Key, Value> {
    constructor(entries?: Iterable<readonly [Key, Value]> | null) {
      super(entries);
      table ??= this; // gameTreeSearch constructs its table before other Maps.
    }

    override get size(): number {
      return super.size + (this === table ? 1999 : 0);
    }

    override set(key: Key, value: Value): this {
      if (this === table) setCalls += 1;
      else fingerprintSetCalls += 1;
      return super.set(key, value);
    }
  }

  Object.defineProperty(NearLimitMap, Symbol.hasInstance, {
    value: (value: unknown) => value instanceof NativeMap,
  });
  globalThis.Map = NearLimitMap;
  try {
    const game = makeTreeGame();
    game.bot.field.push({ name: "Cache capacity probe", atk: 1000, def: 0 });
    const strategy = {
    simulateMainPhaseAction: () => undefined,
      bot: game.bot,
      generateMainPhaseActions: () => SEARCH_ACTIONS,
    };

    const result = gameTreeSearch(game, strategy, game.bot, 2);

    assert.equal(setCalls, 1);
    assert.ok(fingerprintSetCalls > 0);
    assert.equal(result.transpositionHits, 2000);
  } finally {
    globalThis.Map = NativeMap;
  }
});

test("game-tree unrepresentable input retains leaf fallback without random cache keys", () => {
  const originalRandom = Math.random;
  let randomCalls = 0;

  const game = makeGame();
  Object.defineProperty(game.bot, "lp", {
    configurable: true,
    enumerable: true,
    get() {
      throw new Error("unhashable state");
    },
  });

  Math.random = () => { randomCalls++; throw new Error("unexpected randomness"); };
  try {
    const strategy = {
    simulateMainPhaseAction: () => undefined,
      bot: game.bot,
      generateMainPhaseActions: () => [],
    };

    assert.deepEqual(gameTreeSearch(game, strategy, game.bot, 1), {
      action: null, score: 0, depth: 1, confidence: 0, transpositionHits: 0,
    });
    assert.equal(randomCalls, 0);
  } finally {
    Math.random = originalRandom;
  }
});

test("turn-line search freezes defaults, stable ties, diagnostics and score shape", async () => {
  const game = makeGame();
  const actions: SearchAction[] = [
    { type: "position_change", tag: "low", priority: 1, toPosition: "attack" },
    { type: "position_change", tag: "first-tie", priority: 5, toPosition: "attack" },
    { type: "position_change", tag: "second-tie", priority: 5, toPosition: "attack" },
    { type: "position_change", tag: "outside", priority: 0, toPosition: "attack" },
  ];
  let generationCalls = 0;
  const strategy = {
    bot: game.bot,
    generateMainPhaseActions() {
      generationCalls += 1;
      return actions;
    },
    simulateMainPhaseAction(state: MutableScoreState, action: SearchAction) {
      state.bot.lp += action.tag === "low" ? 1 : action.tag === "outside" ? 4 : 2;
    },
    evaluateBoardV2: (state: MutableScoreState) => state.bot.lp - 8000,
  };

  const result = await turnLineSearch(game, strategy);

  assert.ok(result);
  assert.deepEqual(
    {
      action: result.action,
      score: result.score,
      baseScore: result.baseScore,
      milestoneScore: result.milestoneScore,
      sequence: result.sequence,
      nodesEvaluated: result.nodesEvaluated,
      milestones: result.milestones,
      reason: result.reason,
      used: result.used,
      diagnosticKeys: Object.keys(result.diagnostics),
      generationCalls,
    },
    {
      action: actions[1],
      score: 6,
      baseScore: 6,
      milestoneScore: 0,
      sequence: [actions[1], actions[1], actions[1]],
      nodesEvaluated: 15,
      milestones: [],
      reason: "max_depth",
      used: true,
      diagnosticKeys: [
        "rootSummary",
        "firstStepSummary",
        "terminalSummary",
        "sequenceFingerprints",
      ],
      generationCalls: 5,
    },
  );
});

test("turn-line search stops on the legacy node-budget boundary", async () => {
  const game = makeGame();
  const strategy = {
    bot: game.bot,
    generateMainPhaseActions: () => SEARCH_ACTIONS,
    simulateMainPhaseAction(state: MutableScoreState) {
      state.bot.lp += 2;
    },
    evaluateBoardV2: (state: MutableScoreState) => state.bot.lp - 8000,
  };

  const result = await turnLineSearch(game, strategy, {
    maxDepth: 5,
    nodeBudget: 1,
  });

  assert.ok(result);
  assert.deepEqual(
    {
      action: result.action,
      score: result.score,
      sequence: result.sequence,
      nodesEvaluated: result.nodesEvaluated,
      reason: result.reason,
    },
    {
      action: SEARCH_ACTIONS[0],
      score: 2,
      sequence: [SEARCH_ACTIONS[0]],
      nodesEvaluated: 1,
      reason: "node_budget",
    },
  );
});

test("turn-line search limits the default candidate set to eight", async () => {
  const game = makeGame();
  const actions: SearchAction[] = Array.from({ length: 10 }, (_, index) => ({
    type: "position_change",
    tag: `candidate-${index + 1}`,
    priority: 10 - index,
    toPosition: "attack",
  }));
  const strategy = {
    bot: game.bot,
    generateMainPhaseActions: () => actions,
    simulateMainPhaseAction(state: MutableScoreState, action: SearchAction) {
      const candidateNumber = Number(action.tag.split("-")[1]);
      state.bot.lp += candidateNumber;
    },
    evaluateBoardV2: (state: MutableScoreState) => state.bot.lp - 8000,
  };

  const result = await turnLineSearch(game, strategy, {
    beamWidth: 20,
    maxDepth: 1,
    nodeBudget: 100,
  });

  assert.ok(result);
  assert.equal(result.nodesEvaluated, 8);
  assert.equal(result.action, actions[7]);
});

test("turn-line diagnostics preserve deterministic action fingerprints", async () => {
  const game = makeGame();
  const action: SearchAction = {
    type: "position_change",
    tag: "fingerprinted",
    priority: 7,
    toPosition: "attack",
  };
  const strategy = {
    bot: game.bot,
    generateMainPhaseActions: () => [action],
    simulateMainPhaseAction(state: MutableScoreState) {
      state.bot.lp += 1;
    },
    evaluateBoardV2: (state: MutableScoreState) => state.bot.lp - 8000,
  };

  const first = await turnLineSearch(game, strategy, { maxDepth: 1 });
  const second = await turnLineSearch(game, strategy, { maxDepth: 1 });

  assert.ok(first);
  assert.ok(second);
  assert.deepEqual(first.diagnostics.sequenceFingerprints, [
    {
      type: "position_change",
      cardName: null,
      cardId: null,
      index: null,
      fieldIndex: null,
      zoneIndex: null,
      graveyardIndex: null,
      materialIndex: null,
      position: null,
      priority: 7,
      targetPreferenceKeys: [],
    },
  ]);
  assert.deepEqual(
    second.diagnostics.sequenceFingerprints,
    first.diagnostics.sequenceFingerprints,
  );
});

test("turn-line reports why an empty search ended without inventing an action", async () => {
  const reports: TurnLineSearchCompletion[] = [];
  const game = makeGame();
  const result = await turnLineSearch(game, {
    bot: game.bot,
    generateMainPhaseActions: () => [],
    simulateMainPhaseAction() {},
  }, { onComplete: report => reports.push(report) });
  assert.equal(result, null);
  assert.deepEqual(reports, [{
    terminationReason: "no_candidates", nodesEvaluated: 0,
    unsupportedBranches: 0, repeatedStates: 0,
  }]);
});

test("turn-line preserves termination metrics when the strategy describes the line", async () => {
  const game = makeGame();
  const reports: TurnLineSearchCompletion[] = [];
  const result = await turnLineSearch(game, {
    bot: game.bot,
    generateMainPhaseActions: () => SEARCH_ACTIONS,
    simulateMainPhaseAction(state: MutableScoreState) { state.bot.lp += 1; },
    evaluateBoardV2: (state: MutableScoreState) => state.bot.lp,
    describePlannedLine: () => "Useful resource preserved",
  }, { maxDepth: 5, nodeBudget: 2, onComplete: report => reports.push(report) });
  assert.ok(result);
  assert.equal(result.reason, "Useful resource preserved");
  assert.equal(result.completion.terminationReason, "node_budget");
  assert.equal(result.nodesEvaluated, 2);
  assert.deepEqual(reports, [result.completion]);
});

test("turn-line ends at an unknown draw and never generates its continuation", async () => {
  const game = makeGame();
  let generations = 0;
  const result = await turnLineSearch(game, {
    bot: game.bot,
    generateMainPhaseActions() { generations++; return SEARCH_ACTIONS.slice(0, 1); },
    simulateMainPhaseAction(state: TurnLineSimulationGameState) {
      state.bot.lp += 1;
      state._simRequiresReplan = true;
    },
    evaluateBoardV2: (state: MutableScoreState) => state.bot.lp,
  }, { maxDepth: 8 });
  assert.ok(result);
  assert.equal(result.completion.terminationReason, "requires_replan");
  assert.equal(result.sequence.length, 1);
  assert.equal(generations, 1);
});

test("turn-line rejects unsupported rewards and reports the exhausted branches", async () => {
  const game = makeGame();
  const reports: TurnLineSearchCompletion[] = [];
  const result = await turnLineSearch(game, {
    bot: game.bot,
    generateMainPhaseActions: () => SEARCH_ACTIONS.slice(0, 1),
    simulateMainPhaseAction(state: TurnLineSimulationGameState) {
      state.bot.lp += 99999;
      state._simUnsupportedActions = ["unmodeled reward"];
    },
    evaluateBoardV2: (state: MutableScoreState) => state.bot.lp,
  }, { onComplete: report => reports.push(report) });
  assert.equal(result, null);
  assert.deepEqual(reports, [{ terminationReason: "unsupported_branches", nodesEvaluated: 1,
    unsupportedBranches: 1, repeatedStates: 0 }]);
});

test("turn-line stops a recycling cycle without repeating its milestone reward", async () => {
  const game = makeGame();
  const result = await turnLineSearch(game, {
    bot: game.bot,
    generateMainPhaseActions: () => SEARCH_ACTIONS.slice(0, 1),
    simulateMainPhaseAction(state: MutableScoreState) { state.bot.lp = state.bot.lp === 8000 ? 8001 : 8000; },
    evaluateBoardV2: (state: MutableScoreState) => state.bot.lp - 8000,
    scoreLineMilestones: () => ({ scoreDelta: 10, milestones: [] }),
  }, { maxDepth: 20, nodeBudget: 30 });
  assert.ok(result);
  assert.equal(result.sequence.length, 1);
  assert.equal(result.score, 11);
  assert.equal(result.completion.terminationReason, "no_state_changing_branches");
  assert.equal(result.completion.repeatedStates, 1);
});

test("turn-line can opt into stopping at a stronger intermediate board", async () => {
  const game = makeGame();
  const strategy = {
    bot: game.bot,
    generateMainPhaseActions: () => SEARCH_ACTIONS.slice(0, 1),
    simulateMainPhaseAction(state: MutableScoreState) { state.bot.lp += state.bot.lp === 8000 ? 10 : -2; },
    evaluateBoardV2: (state: MutableScoreState) => state.bot.lp,
  };
  const result = await turnLineSearch(game, strategy, { maxDepth: 3, allowEarlyStop: true });
  assert.ok(result);
  assert.equal(result.sequence.length, 1);
  assert.equal(result.score, 8010);
  assert.equal(result.completion.terminationReason, "preferred_terminal");
  const legacy = await turnLineSearch(game, strategy, { maxDepth: 3 });
  assert.equal(legacy?.sequence.length, 3, "other profiles retain their existing search behavior");
});

test("turn-line explicitly chooses to preserve the current board over every worse action", async () => {
  const game = makeGame();
  const reports: TurnLineSearchCompletion[] = [];
  const result = await turnLineSearch(game, {
    bot: game.bot,
    generateMainPhaseActions: () => SEARCH_ACTIONS,
    simulateMainPhaseAction(state: MutableScoreState) { state.bot.lp -= 10; },
    evaluateBoardV2: (state: MutableScoreState) => state.bot.lp,
  }, { maxDepth: 2, allowEarlyStop: true, onComplete: report => reports.push(report) });
  assert.equal(result, null);
  assert.equal(reports[0]?.terminationReason, "preferred_terminal");
});

test("turn-line candidate policy retains a necessary low-priority setup before beam truncation", async () => {
  const game = makeGame();
  const high: SearchAction = { type: "position_change", tag: "immediate", priority: 100, toPosition: "attack" };
  const low: SearchAction = { type: "position_change", tag: "setup", priority: 1, toPosition: "attack" };
  const finish: SearchAction = { type: "position_change", tag: "finish", priority: 10, toPosition: "attack" };
  const calls: { count: number; limit: number; lp: number }[] = [];
  const strategy = {
    bot: game.bot,
    generateMainPhaseActions(state: MutableScoreState) {
      return state.bot.lp === 8000 ? [high, low] : state.bot.lp === 7999 ? [finish] : [];
    },
    simulateMainPhaseAction(state: MutableScoreState, action: SearchAction) {
      state.bot.lp += action.tag === "setup" ? -1 : action.tag === "finish" ? 20 : 2;
    },
    evaluateBoardV2: (state: MutableScoreState) => state.bot.lp - 8000,
  };
  const options = { beamWidth: 1, candidateLimit: 1, maxDepth: 3, nodeBudget: 3 };
  const legacy = await turnLineSearch(game, strategy, options);
  assert.equal(legacy?.action, high);
  const planned = await turnLineSearch(game, {
    ...strategy,
    selectPlanningCandidates(actions: readonly AIAction[], state: AIState, limit: number) {
      calls.push({ count: actions.length, limit, lp: state.bot?.lp || 0 });
      return actions.includes(low) ? [low] : [...actions];
    },
  }, options);
  assert.ok(planned);
  assert.equal(planned.action, low);
  assert.deepEqual(planned.sequence, [low, finish]);
  assert.equal(planned.score, 19);
  assert.equal(planned.nodesEvaluated, 2);
  assert.deepEqual(calls, [{ count: 2, limit: 1, lp: 8000 }, { count: 1, limit: 1, lp: 7999 }]);
});

for (const limits of [{ beamWidth: 1, candidateLimit: 3 }, { beamWidth: 3, candidateLimit: 1 }]) {
  test(`turn-line bounds candidate policy output and ignores injected or repeated actions (${JSON.stringify(limits)})`, async () => {
    const game = makeGame();
    const injected: SearchAction = { type: "position_change", tag: "not-legal", priority: 999, toPosition: "attack" };
    const simulated: string[] = [];
    let policyCalls = 0;
    const result = await turnLineSearch(game, {
      bot: game.bot,
      generateMainPhaseActions: () => SEARCH_ACTIONS,
      selectPlanningCandidates(actions: readonly AIAction[], _state: AIState, limit: number) {
        policyCalls++;
        assert.equal(limit, 1);
        const first = actions[0];
        assert.ok(first);
        return [injected, first, first, ...actions];
      },
      simulateMainPhaseAction(state: MutableScoreState, action: SearchAction) {
        simulated.push(action.tag);
        state.bot.lp++;
      },
      evaluateBoardV2: (state: MutableScoreState) => state.bot.lp,
    }, { ...limits, maxDepth: 10, nodeBudget: 1 });
    assert.ok(result);
    assert.equal(result.action, SEARCH_ACTIONS[0]);
    assert.equal(policyCalls, 1);
    assert.equal(result.nodesEvaluated, 1);
    assert.equal(result.completion.terminationReason, "node_budget");
    assert.deepEqual(simulated, ["first", "first"], "only one branch plus first-step diagnostics is simulated");
  });
}
