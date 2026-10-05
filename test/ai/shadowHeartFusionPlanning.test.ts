import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import { turnLineSearch } from "../../src/core/ai/TurnLineSearch.js";
import { greedySearchWithEvalV2 } from "../../src/core/ai/BeamSearch.js";
import ShadowHeartStrategy from "../../src/core/ai/ShadowHeartStrategy.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { fingerprintPlanningState } from "../../src/core/ai/common/stateFingerprint.js";
import { fingerprintAction } from "../../src/core/ai/common/planningDiagnostics.js";
import { playBotMainPhase } from "../../src/core/bot/mainPhaseController.js";
import type { AIAction, AIPlannedAction, AIPlanningProfile, TurnLineSearchCompletion } from "../../src/core/contracts/ai.js";
import type { AiLiveGamePort, TurnLineSimulationGameState } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { fixtureGameTreeSearch } from "../helpers/gameTree.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

type Seat = "player" | "bot";

function scenario(t: TestContext, seat: Seat, lethalFusion = false) {
  t.mock.method(console, "log", () => {});
  const first = new Bot("shadowheart");
  first.id = "player";
  const second = new Bot("shadowheart");
  const game = createRuntimeGame({ opponentOverride: second, captureReplay: false, laboratoryMode: true });
  game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot provides the Player runtime interface");
  const runtime = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game,
    "Concrete Game supplies the attached Bot execution and snapshot capabilities");
  first.game = runtime;
  second.game = runtime;
  const actor = seat === "player" ? first : second;
  const opponent = seat === "player" ? second : first;
  game.turn = seat;
  game.phase = "main1";
  game.turnCounter = 5;
  game.disablePresentationDelays = true;
  t.after(() => game.dispose("shadow_heart_fusion_planning"));
  actor.summonCount = 1;
  actor.lp = 8000;
  opponent.lp = lethalFusion ? 200 : 8000;
  const devastation = new Card(cardDefinition(124), seat);
  const eel = new Card(cardDefinition(101), seat);
  devastation.lastSummonMethod = "ascension";
  eel.lastSummonMethod = "normal";
  if (lethalFusion) devastation.cannotAttackThisTurn = true;
  placeFieldCards(actor.field, devastation, eel);
  const threat = new Card({ ...cardDefinition(1), name: "Visible fusion planning threat",
    atk: lethalFusion ? 2100 : 1800, def: 0, effects: [] }, opponent.id);
  placeFieldCards(opponent.field, threat);
  actor.hand.push(new Card(cardDefinition(12), seat));
  actor.extraDeck.push(new Card(cardDefinition(122), seat));
  const actions = actor.generateMainPhaseActions(runtime);
  assert.ok(actions.some(action => action.type === "spell" && action.cardId === 12),
    "Polymerization remains a competing candidate from the real policy");
  assert.ok(actor.strategy instanceof ShadowHeartStrategy);
  const analysis = actor.strategy.analyzeGameState(runtime);
  const profile = actor.strategy.getPlanningProfile(runtime, { analysis });
  return { game, runtime, actor, opponent, devastation, eel, actions, profile };
}

function options(profile: AIPlanningProfile) {
  return { profile, beamWidth: profile.beamWidth, maxDepth: profile.maxDepth,
    nodeBudget: profile.nodeBudget, candidateLimit: profile.candidateLimit,
    turnMode: profile.turnMode, useV2Evaluation: true };
}

function planningInput(state: ReturnType<typeof simulationState>) {
  assert.equal(state._isPerspectiveState, true);
  assert.equal(state.temporaryBattlePairEffects?.length || 0, 0);
  return unsafeFixture<Parameters<typeof turnLineSearch>[0]>(state,
    "This direct fixture supplies canonical players and contains no legacy temporary pair-effect projection");
}

function simulateMainAction(state: TurnLineSimulationGameState, action: AIPlannedAction) {
  // These mechanics controls score the search-owned Battle result. Their
  // adapter only resolves ordinary Main actions, not the diagnostic probe.
  if (action.type === "simulatedBattle") return state;
  return applyGenericSimulatedMainPhaseAction(state, action);
}

for (const seat of ["player", "bot"] as const) {
  test(`Shadow-Heart keeps Devastation and Eel for Battle while Polymerization remains available (${seat})`, async t => {
    const { runtime, actor, actions, profile } = scenario(t, seat);
    const state = actor.cloneGameState(runtime);
    const before = fingerprintPlanningState(state);
    const line = required(await turnLineSearch(state, actor.strategy, {
      ...options(profile), preGeneratedActions: actions,
    }));
    assert.equal(line.action.type, "simulatedBattle");
    assert.deepEqual(line.finalState.bot.field.map(card => card.id).sort(), [101, 124]);
    assert.ok(line.finalState.bot.hand.some(card => card.id === 12));
    assert.equal(line.finalState.player.lp, 6500);
    assert.equal(line.sequence.filter(action => action.type === "simulatedBattle").length, 1);
    assert.equal(fingerprintPlanningState(state), before, "planning leaves its input snapshot isolated");
    assert.equal(runtime.phase, "main1");
  });

  for (const nodeBudget of [1, 2, 4]) {
    test(`Shadow-Heart budgets Battle before spending its ${nodeBudget}-node limit on fusion (${seat})`, async t => {
      const { runtime, actor, actions, profile } = scenario(t, seat);
      const line = required(await turnLineSearch(actor.cloneGameState(runtime), actor.strategy, {
        ...options(profile), nodeBudget, preGeneratedActions: actions,
      }));
      assert.equal(line.action.type, "simulatedBattle");
      assert.equal(line.sequence.filter(action => action.type === "simulatedBattle").length, 1);
      assert.ok(line.nodesEvaluated <= nodeBudget);
      if (nodeBudget === 1) {
        assert.equal(line.nodesEvaluated, 1);
        assert.equal(line.completion.terminationReason, "node_budget");
      }
      assert.equal(line.finalState.player.lp, 6500);
    });
  }

  test(`Shadow-Heart mainOnly profile conserves a stronger board rather than forcing fusion (${seat})`, async t => {
    const { runtime, actor, actions, profile } = scenario(t, seat);
    let completion: TurnLineSearchCompletion | undefined;
    const line = await turnLineSearch(actor.cloneGameState(runtime), actor.strategy, {
      ...options(profile), turnMode: "mainOnly", preGeneratedActions: actions,
      onComplete: value => { completion = value; },
    });
    assert.equal(line, null);
    assert.equal(completion?.terminationReason, "preferred_terminal");
  });

  test(`Shadow-Heart can spend an attack-locked Devastation to convert Warlord into lethal (${seat})`, async t => {
    const { runtime, actor, actions, profile } = scenario(t, seat, true);
    const line = required(await turnLineSearch(actor.cloneGameState(runtime), actor.strategy, {
      ...options(profile), preGeneratedActions: actions,
    }));
    assert.equal(line.action.type, "spell");
    assert.equal(line.action.cardId, 12);
    assert.ok(line.finalState.bot.graveyard.some(card => card.id === 124));
    assert.ok(line.finalState.bot.field.some(card => card.id === 122));
    assert.equal(line.finalState.player.lp, 0);
  });

  test(`Shadow-Heart conserving fusion advances the public phase once without spending its boss (${seat})`, async t => {
    const { game, runtime, actor, devastation, eel } = scenario(t, seat);
    let transitions = 0;
    const nextPhase = game.nextPhase.bind(game);
    t.mock.method(game, "nextPhase", async (...args: Parameters<typeof game.nextPhase>) => {
      transitions += 1;
      return nextPhase(...args);
    });
    t.mock.method(actor, "playBattlePhase", () => {});
    await playBotMainPhase(actor, runtime);
    assert.equal(game.phase, "battle");
    assert.equal(transitions, 1);
    assert.ok(actor.field.includes(devastation));
    assert.ok(actor.field.includes(eel));
    assert.ok(actor.hand.some(card => card.id === 12));
  });

  test(`Shadow-Heart fusion planning ignores changed identities and stats behind the same hidden board (${seat})`, async t => {
    const { runtime, actor, opponent, profile } = scenario(t, seat);
    const hiddenHand = new Card(cardDefinition(101), opponent.id);
    const hiddenField = new Card(cardDefinition(101), opponent.id);
    hiddenField.isFacedown = true;
    hiddenField.position = "defense";
    opponent.hand.push(hiddenHand);
    placeFieldCards(opponent.field, hiddenField);
    const decision = async () => {
      const actions = actor.generateMainPhaseActions(runtime);
      const state = actor.cloneGameState(runtime);
      const before = fingerprintPlanningState(state);
      const line = required(await turnLineSearch(state, actor.strategy, {
        ...options(profile), preGeneratedActions: actions,
      }));
      assert.equal(fingerprintPlanningState(state), before);
      return { candidates: actions.map(fingerprintAction), first: fingerprintAction(line.action), score: line.score };
    };
    const first = await decision();
    Object.assign(hiddenHand, { id: 124, name: "Shadow-Heart Devastation Dragon", atk: 99000, def: 99000 });
    Object.assign(hiddenField, { id: 122, name: "Shadow-Heart Warlord", atk: 88000, def: 88000 });
    assert.deepEqual(await decision(), first);
    assert.equal(runtime.phase, "main1");
    assert.equal(actor.hand.length, 1);
    assert.equal(opponent.hand[0], hiddenHand);
    assert.equal(opponent.field[1], hiddenField);
  });

  for (const profileName of ["bot", "beamGreedy", "gameTree", "turnLine"] as const) {
    test(`Shadow-Heart fusion keeps the live field isolated in the ${profileName} clone (${seat})`, async t => {
      const { runtime, actor, devastation, actions } = scenario(t, seat);
      let captured: unknown;
      const capture = (input: unknown) => {
        const snapshot = unsafeFixture<TurnLineSimulationGameState>(input,
          "This selected planner profile passes its canonical perspective clone to the probe");
        captured ??= snapshot;
        return snapshot;
      };
      const evaluate = (input: unknown) => {
        const snapshot = unsafeFixture<TurnLineSimulationGameState>(input,
          "The clone probe only evaluates canonical planner snapshots");
        return actor.strategy.evaluateBoardV2(snapshot, snapshot.bot);
      };
      const probe = {
        bot: actor,
        generateMainPhaseActions(input: unknown) { if (profileName === "gameTree") capture(input); return actions; },
        simulateMainPhaseAction(input: unknown, action: AIAction) {
          return actor.strategy.simulateMainPhaseAction(capture(input), action);
        },
        evaluateBoardV2: evaluate,
        evaluateBoard: evaluate,
      };
      if (profileName === "bot") captured = actor.cloneGameState(runtime);
      else if (profileName === "beamGreedy") await greedySearchWithEvalV2(runtime, probe, { preGeneratedActions: actions });
      else if (profileName === "gameTree") fixtureGameTreeSearch(runtime, probe, actor, 1);
      else await turnLineSearch(runtime, probe, { maxDepth: 1, nodeBudget: 1, preGeneratedActions: actions });
      const snapshot = unsafeFixture<TurnLineSimulationGameState>(required(captured),
        "All four captured clone profiles expose this common card and player projection for isolation assertions");
      const clonedBoss = required([...snapshot.bot.field, ...snapshot.bot.graveyard].find(card => card.id === 124));
      assert.equal(clonedBoss.instanceId, devastation.instanceId);
      assert.notEqual(clonedBoss, devastation);
      const before = fingerprintPlanningState(snapshot);
      clonedBoss.atk = 77;
      clonedBoss.cannotAttackThisTurn = true;
      assert.notEqual(fingerprintPlanningState(snapshot), before);
      assert.equal(devastation.atk, 3300);
      assert.equal(devastation.cannotAttackThisTurn, false);
      assert.ok(actor.field.includes(devastation));
      assert.equal(actor.hand.length, 1);
      assert.equal(runtime.phase, "main1");
    });
  }
}

test("TurnLine refines a reserved Battle in Main2 without simulating or counting Battle twice", async () => {
  const attacker = simulationCard({ ...cardDefinition(1), atk: 1000, position: "attack" });
  const recovery = simulationCard({ ...cardDefinition(3), name: "Public Main2 recovery", effects: [{
    id: "public_main2_recovery", timing: "on_play", actions: [{ type: "heal", amount: 500, player: "self" }],
  }] });
  const state = simulationState({ _isPerspectiveState: true, turn: "bot", phase: "main1", turnCounter: 5,
    bot: { field: [attacker], hand: [recovery] } });
  const position: AIAction = { type: "position_change", fieldIndex: 0, toPosition: "defense", priority: 10 };
  const spell: AIAction = { type: "spell", index: 0, cardId: recovery.id, priority: 1 };
  const strategy = {
    bot: state.bot,
    generateMainPhaseActions(input: TurnLineSimulationGameState) {
      if (input.phase === "main1" && input.bot.field[0]?.position === "attack") return [position];
      return input.phase === "main2" && input.bot.hand.length > 0 ? [spell] : [];
    },
    simulateMainPhaseAction: simulateMainAction,
    evaluateBoardV2: (input: TurnLineSimulationGameState) => input.bot.lp - input.player.lp,
    isPostBattlePayoffAction: (action: AIAction) => action.type === "spell",
  };
  const line = required(await turnLineSearch(planningInput(state), strategy, {
    turnMode: "mainBattleMain2", maxDepth: 3, nodeBudget: 3, beamWidth: 1,
  }));
  assert.deepEqual(line.sequence.map(action => action.type), ["simulatedBattle", "spell"],
    JSON.stringify({ completion: line.completion, hand: line.finalState.bot.hand.map(card => card.name),
      lp: line.finalState.bot.lp, unsupported: line.finalState._simUnsupportedActions }));
  assert.equal(line.nodesEvaluated, 3, "one reservation, one competing Main action and one Main2 action");
  assert.equal(line.finalState.bot.lp, 8500);
  assert.equal(line.finalState.player.lp, 7000);
  assert.equal(line.finalState.bot.field[0]?.attacksUsedThisTurn, 1);
  assert.equal(line.finalState.phase, "main2");
  assert.equal(state.bot.lp, 8000);
  assert.equal(state.player.lp, 8000);
});

test("TurnLine scores Battle milestones at a one-node budget and prefers Main on a complete-score tie", async () => {
  const state = simulationState({ _isPerspectiveState: true, turn: "bot", phase: "main1", turnCounter: 5,
    bot: { field: [simulationCard({ ...cardDefinition(1), atk: 1000, position: "attack" }),
      simulationCard({ ...cardDefinition(101), position: "defense" })] } });
  const position: AIAction = { type: "position_change", fieldIndex: 1, toPosition: "attack", priority: 10 };
  const strategy = {
    bot: state.bot,
    generateMainPhaseActions: () => [position],
    simulateMainPhaseAction: simulateMainAction,
    evaluateBoardV2: () => 0,
    scoreLineMilestones: ({ sequence }: { sequence?: { type?: string }[] }) => ({
      scoreDelta: sequence?.some(action => action.type === "simulatedBattle") ? 17 : 0,
      milestones: [],
    }),
  };
  const scored = required(await turnLineSearch(planningInput(state), strategy, {
    turnMode: "mainBattleMain2", nodeBudget: 1, maxDepth: 1,
  }));
  assert.equal(scored.action.type, "simulatedBattle");
  assert.equal(scored.score, 17);
  assert.equal(scored.milestoneScore, 17);
  const tied = required(await turnLineSearch(planningInput(state), { ...strategy, scoreLineMilestones: () => ({
    scoreDelta: 0, milestones: [],
  }) }, { turnMode: "mainBattleMain2", nodeBudget: 2, maxDepth: 1 }));
  assert.equal(tied.action.type, "position_change", "stable equality preserves the Main action preference");
  assert.equal(tied.nodesEvaluated, 2);
});

test("TurnLine rejects a Battle whose reward marks its result unsupported", async () => {
  const state = simulationState({ _isPerspectiveState: true, turn: "bot", phase: "main1", turnCounter: 5,
    bot: { field: [simulationCard({ ...cardDefinition(1), atk: 1000, position: "attack" }),
      simulationCard({ ...cardDefinition(101), position: "defense" })] } });
  const position: AIAction = { type: "position_change", fieldIndex: 1, toPosition: "attack", priority: 10 };
  const strategy = {
    bot: state.bot,
    generateMainPhaseActions: () => [position],
    simulateMainPhaseAction: simulateMainAction,
    evaluateBoardV2: () => 0,
    applySimulatedBattleRewards({ state: next }: { state: TurnLineSimulationGameState }) {
      next._simUnsupportedActions = ["unmodeled battle reward"];
      return [];
    },
  };
  const line = required(await turnLineSearch(planningInput(state), strategy, {
    turnMode: "mainBattleMain2", nodeBudget: 1, maxDepth: 1,
  }));
  assert.equal(line.action.type, "position_change");
  assert.equal(line.nodesEvaluated, 1);
  assert.deepEqual(line.finalState._simUnsupportedActions || [], []);
  assert.equal(line.finalState.player.lp, 8000);
  assert.equal(state.player.lp, 8000);
});
