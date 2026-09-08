import assert from "node:assert/strict";
import test from "node:test";

import {
  beamSearchTurn,
  greedySearchWithEvalV2,
} from "../../src/core/ai/BeamSearch.js";
import {
  estimateSearchComplexity,
  gameTreeSearch,
  shouldUseGameTreeSearch,
} from "../../src/core/ai/GameTreeSearch.js";
import { turnLineSearch } from "../../src/core/ai/TurnLineSearch.js";

interface SearchAction {
  type: "position_change";
  tag: string;
  priority: number;
  toPosition: "attack";
}

interface SearchCard {
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
    transpositionHits: 1,
  });
  assert.equal(generationCalls, 4);
  assert.equal(estimateSearchComplexity(4), 81);
  assert.equal(shouldUseGameTreeSearch(game, game.bot), false);
  assert.equal(shouldUseGameTreeSearch(game, game.bot, true), true);
});

test("game-tree search applies the legacy 0.85 future discount", () => {
  const game = makeTreeGame();
  game.bot.hand.push({ name: "Bot Material", atk: 1000, def: 0 });
  game.player.hand.push({ name: "Player Material", atk: 1000, def: 0 });
  const summonAction = { type: "summon", index: 0 } as const;
  const strategy = {
    bot: game.bot,
    generateMainPhaseActions: () => [summonAction],
  };

  const result = gameTreeSearch(game, strategy, game.bot, 1);

  assert.equal(result.action, summonAction);
  assert.equal(result.score, -1.5 * Math.pow(0.85, 3));
});

test("game-tree transposition cache stops at the legacy 2000-entry boundary", () => {
  const NativeMap = globalThis.Map;
  let setCalls = 0;

  class NearLimitMap<Key, Value> extends NativeMap<Key, Value> {
    override get size(): number {
      return super.size + 1999;
    }

    override set(key: Key, value: Value): this {
      setCalls += 1;
      return super.set(key, value);
    }
  }

  globalThis.Map = NearLimitMap;
  try {
    const game = makeGame();
    const strategy = {
      bot: game.bot,
      generateMainPhaseActions: () => SEARCH_ACTIONS,
    };

    const result = gameTreeSearch(game, strategy, game.bot, 2);

    assert.equal(setCalls, 1);
    assert.equal(result.transpositionHits, 2000);
  } finally {
    globalThis.Map = NativeMap;
  }
});

test("game-tree hash failures retain the randomized HASH_ERROR fingerprint", () => {
  const NativeMap = globalThis.Map;
  const originalRandom = Math.random;
  const observedHashes: string[] = [];

  class CapturingMap<Key, Value> extends NativeMap<Key, Value> {
    override has(key: Key): boolean {
      observedHashes.push(String(key));
      return super.has(key);
    }
  }

  const game = makeGame();
  Object.defineProperty(game.bot, "lp", {
    configurable: true,
    enumerable: true,
    get() {
      throw new Error("unhashable state");
    },
  });

  globalThis.Map = CapturingMap;
  Math.random = () => 0.375;
  try {
    const strategy = {
      bot: game.bot,
      generateMainPhaseActions: () => [],
    };

    gameTreeSearch(game, strategy, game.bot, 1);

    assert.deepEqual(observedHashes, ["HASH_ERROR_0.375"]);
  } finally {
    Math.random = originalRandom;
    globalThis.Map = NativeMap;
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
