import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";
import { turnLineSearch } from "../../src/core/ai/TurnLineSearch.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import { cardDefinition, record, required, unsafeFixture } from "../helpers/fixtures.js";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>(finish => { resolve = finish; });
  return { promise, resolve };
}

async function flushMicrotasks() {
  for (let index = 0; index < 60; index++) await Promise.resolve();
}

async function advance(t: TestContext, milliseconds = 20) {
  t.mock.timers.tick(milliseconds);
  await flushMicrotasks();
}

async function settle(t: TestContext, promise: Promise<unknown>) {
  let settled = false;
  void promise.then(() => { settled = true; });
  for (let index = 0; index < 100 && !settled; index++) await advance(t);
  assert.equal(settled, true, "Main Phase invocation did not settle");
  await promise;
}

function scenario(t: TestContext, useRealPhaseTransitions = false) {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const game = unsafeFixture<Game & BotGamePort>(new Game({
    laboratoryMode: true,
    laboratoryUseBot: true,
    disableChains: true,
    captureReplay: false,
    randomSeed: 3103,
  }), "Concrete Game has attached EffectEngine methods; this Bot integration fixture bridges their narrower public projections.");
  t.after(() => game.dispose("main_phase_concurrency_test"));
  const bot = game.bot;
  assert.ok(bot instanceof Bot);
  game.turn = bot.id;
  game.phase = "main1";
  game.turnCounter = 2;
  game.disablePresentationDelays = true;
  game.phaseDelayMs = 0;
  game.aiSuccessfulActionDelayMs = 0;
  game.aiActionDelayMs = 100;
  game.turnLineSearchMode = "off";
  bot.strategy.shouldUseAutomaticAscensionShortcut = () => false;
  bot.simulateMainPhaseAction = state => state;
  bot.evaluateBoardV2 = () => 0;
  bot.sequenceActions = actions => actions;
  bot.filterValidActionsForCurrentState = actions => actions;
  const card = new Card(cardDefinition("Nightmare Steed"), bot.id);
  card.position = "attack";
  card.isFacedown = false;
  bot.field.push(card);
  const action: AIAction = { type: "monsterEffect", fieldIndex: 0, effectId: "controlled" };
  let executions = 0;
  let generations = 0;
  let transitions = 0;
  let actionCount = 2;
  let beforeFinish: () => Promise<void> = async () => {};
  const exits: Record<string, unknown>[] = [];
  game._arenaTracker = {
    recordProgress(label: string, _game: unknown, detail?: unknown) {
      if (label === "ai_main_phase_exit" || label === "ai_main_phase_finalization") exits.push(record(detail));
    },
  };
  bot.generateMainPhaseActions = () => {
    generations++;
    return executions < actionCount ? [action] : [];
  };
  bot.executeMainPhaseAction = async () => {
    executions++;
    await beforeFinish();
    bot.lp--;
    return true;
  };
  const nextPhase = game.nextPhase;
  t.mock.method(game, "nextPhase", async () => {
    transitions++;
    if (useRealPhaseTransitions) return await nextPhase.call(game);
    game.phase = "battle";
    return undefined;
  });
  return {
    game,
    bot,
    get executions() { return executions; },
    get generations() { return generations; },
    get transitions() { return transitions; },
    exit: () => required(exits.at(-1)),
    setActionCount(count: number) { actionCount = count; },
    holdActions(callback: () => Promise<void>) { beforeFinish = callback; },
  };
}

function configureBattleBridge(fixture: ReturnType<typeof scenario>) {
  const { game, bot } = fixture;
  game.turnLineSearchMode = "always";
  game.turnLineSearchTurnMode = "mainBattleMain2";
  game.turnLineSearchMaxDepth = 2;
  game.turnLineSearchNodeBudget = 10;
  const defense: AIAction = { type: "position_change", fieldIndex: 0, toPosition: "defense" };
  bot.generateMainPhaseActions = () => [defense];
  bot.strategy.generateMainPhaseActions = () => [];
  bot.strategy.simulateMainPhaseAction = state => state;
  bot.strategy.evaluateBoardV2 = state => 8000 - (state.player?.lp ?? 8000);
  return defense;
}

test("concurrent makeMove invocations share one Main Phase sequence and transition", async t => {
  const fixture = scenario(t);
  const gate = deferred();
  fixture.holdActions(() => gate.promise);
  const first = fixture.bot.makeMove(fixture.game);
  const second = fixture.bot.makeMove(fixture.game);
  await flushMicrotasks();
  const startsWhileHeld = fixture.executions;
  gate.resolve();
  await settle(t, Promise.all([first, second]));
  await advance(t, 200);
  assert.equal(startsWhileHeld, 1, "reentry executed the same live state twice");
  assert.equal(fixture.executions, 2);
  assert.equal(fixture.transitions, 1);
});

test("Main Phase waits for the executor promise before executing another action", async t => {
  const fixture = scenario(t);
  const gate = deferred();
  fixture.holdActions(() => gate.promise);
  const move = fixture.bot.makeMove(fixture.game);
  await flushMicrotasks();
  await advance(t, 1000);
  assert.equal(fixture.executions, 1);
  assert.equal(fixture.transitions, 0);
  gate.resolve();
  await settle(t, move);
  await advance(t, 200);
  assert.equal(fixture.executions, 2);
  assert.equal(fixture.transitions, 1);
});

test("reentry while Main Phase finalization is scheduled joins the same transition", async t => {
  const fixture = scenario(t);
  fixture.setActionCount(0);
  const first = fixture.bot.makeMove(fixture.game);
  await flushMicrotasks();
  const second = fixture.bot.makeMove(fixture.game);
  await settle(t, Promise.all([first, second]));
  await advance(t, 200);
  assert.equal(fixture.executions, 0);
  assert.equal(fixture.transitions, 1);
});

test("a scheduled transition waits for a newly pending selection to resolve", async t => {
  const fixture = scenario(t);
  fixture.setActionCount(0);
  const move = fixture.bot.makeMove(fixture.game);
  await flushMicrotasks();
  fixture.game.selectionState = "selecting";
  await advance(t, 200);
  const whileSelecting = fixture.transitions;
  fixture.game.selectionState = "idle";
  await settle(t, move);
  assert.equal(whileSelecting, 0);
  assert.equal(fixture.transitions, 1);
});

test("an interrupted phase-end negotiation resumes Main Phase and eventually reaches Battle", async t => {
  const fixture = scenario(t, true);
  fixture.setActionCount(0);
  t.mock.method(fixture.bot, "playBattlePhase", () => {});
  let phaseEndAttempts = 0;
  t.mock.method(fixture.game, "checkAndOfferTraps", async (event: Parameters<Game["checkAndOfferTraps"]>[0]) => {
    if (event === "phase_end") phaseEndAttempts++;
    const interrupted = event === "phase_end" && phaseEndAttempts === 1;
    if (interrupted) {
      fixture.bot.lp -= 50;
      fixture.setActionCount(1);
    }
    return {
      success: true,
      needsSelection: false,
      phaseTransitionAllowed: !interrupted,
      phaseTransitionInterrupted: interrupted,
    };
  });
  await settle(t, fixture.bot.makeMove(fixture.game));
  for (let tick = 0; tick < 10; tick++) await advance(t, 100);
  assert.equal(phaseEndAttempts, 2, "a completed response Chain requires a renewed transition intent");
  assert.equal(fixture.executions, 1, "newly available actions must be planned after the response Chain");
  assert.equal(fixture.game.phase, "battle");
  assert.equal(fixture.transitions, 2);
});

for (const planning of ["normal", "battle bridge"] as const) {
  test(`interminable phase-end interruptions exhaust finalization protection for ${planning}`, async t => {
    const fixture = scenario(t, true);
    fixture.setActionCount(0);
    if (planning === "battle bridge") configureBattleBridge(fixture);
    let phaseEndAttempts = 0;
    t.mock.method(fixture.game, "checkAndOfferTraps", async (event: Parameters<Game["checkAndOfferTraps"]>[0]) => {
      if (event === "phase_end") phaseEndAttempts++;
      return {
        success: true,
        needsSelection: false,
        phaseTransitionAllowed: event !== "phase_end",
        phaseTransitionInterrupted: event === "phase_end",
      };
    });
    const move = fixture.bot.makeMove(fixture.game);
    for (let tick = 0; tick < 150; tick++) await advance(t, 100);
    await settle(t, move);
    assert.equal(fixture.exit().status, "failed");
    assert.equal(fixture.exit().finalizationOutcome, "limit_reached");
    assert.equal(fixture.exit().finalizationAttempts, 8);
    assert.ok(Number(fixture.exit().decisions) <= 128);
    assert.equal(fixture.executions, 0);
    assert.equal(fixture.game.phase, "main1");
    assert.equal(phaseEndAttempts, 8);
    assert.equal(fixture.transitions, phaseEndAttempts);
    const attemptsAtLimit = phaseEndAttempts;
    for (let tick = 0; tick < 20; tick++) await advance(t, 100);
    await fixture.bot.makeMove(fixture.game);
    await advance(t, 1000);
    assert.equal(phaseEndAttempts, attemptsAtLimit, "reentry must not renew exhausted finalization protection");
  });
}

test("the sixty-four execution budget survives an interrupted phase-end Chain", async t => {
  const fixture = scenario(t, true);
  fixture.setActionCount(65);
  t.mock.method(fixture.bot, "playBattlePhase", () => {});
  let phaseEndAttempts = 0;
  const executionsAtPhaseEnd: number[] = [];
  t.mock.method(fixture.game, "checkAndOfferTraps", async (event: Parameters<Game["checkAndOfferTraps"]>[0]) => {
    if (event === "phase_end") {
      phaseEndAttempts++;
      executionsAtPhaseEnd.push(fixture.executions);
    }
    const interrupted = event === "phase_end" && phaseEndAttempts === 1;
    if (interrupted) fixture.bot.lp -= 50;
    return {
      success: true,
      needsSelection: false,
      phaseTransitionAllowed: !interrupted,
      phaseTransitionInterrupted: interrupted,
    };
  });
  const move = fixture.bot.makeMove(fixture.game);
  await settle(t, move);
  for (let tick = 0; tick < 10; tick++) await advance(t, 100);
  assert.equal(fixture.executions, 64);
  assert.deepEqual(executionsAtPhaseEnd, [64, 64]);
  assert.equal(fixture.exit().executions, 64);
  assert.equal(fixture.exit().reason, "execution_limit");
  assert.equal(fixture.game.phase, "battle");
  assert.equal(fixture.transitions, 2);
});

const pendingStates = {
  resolution: (game: Game, active: boolean) => { game.isResolvingEffect = active; },
  selection: (game: Game, active: boolean) => { game.selectionState = active ? "selecting" : "idle"; },
} as const;

for (const [pending, setPending] of Object.entries(pendingStates)) {
  test(`Main Phase waits when ${pending} is already pending on entry`, async t => {
    const fixture = scenario(t);
    setPending(fixture.game, true);
    let completed = false;
    const move = fixture.bot.makeMove(fixture.game).then(() => { completed = true; });
    await flushMicrotasks();
    for (let tick = 0; tick < 10; tick++) await advance(t, 100);
    const whileBusy = {
      generations: fixture.generations,
      executions: fixture.executions,
      transitions: fixture.transitions,
      completed,
    };
    setPending(fixture.game, false);
    await settle(t, move);
    await advance(t, 200);
    assert.deepEqual(whileBusy, { generations: 0, executions: 0, transitions: 0, completed: false });
    assert.equal(fixture.executions, 2);
    assert.equal(fixture.transitions, 1);
  });

  test(`pending ${pending} after an executor returns blocks replanning and phase advancement`, async t => {
    const fixture = scenario(t);
    let first = true;
    fixture.holdActions(async () => {
      if (first) {
        first = false;
        setPending(fixture.game, true);
      }
    });
    const move = fixture.bot.makeMove(fixture.game);
    await flushMicrotasks();
    for (let tick = 0; tick < 10; tick++) await advance(t, 100);
    const whileBusy = {
      generations: fixture.generations,
      executions: fixture.executions,
      transitions: fixture.transitions,
    };
    setPending(fixture.game, false);
    await settle(t, move);
    await advance(t, 200);
    assert.deepEqual(whileBusy, { generations: 1, executions: 1, transitions: 0 });
    assert.equal(fixture.executions, 2);
    assert.equal(fixture.transitions, 1);
  });
}

const invalidate = {
  phase: (game: Game) => { game.phase = "main2"; },
  turn: (game: Game) => { game.turn = game.player.id; },
  turnCounter: (game: Game) => { game.turnCounter++; },
  actor: (game: Game) => { game.bot = new Bot(); },
  gameOver: (game: Game) => { game.gameOver = true; },
  disposed: (game: Game) => { game.dispose("test_invalidation"); },
} as const;

for (const [reason, changeContext] of Object.entries(invalidate)) {
  test(`Main Phase abandons its continuation when ${reason} changes during execution`, async t => {
    const fixture = scenario(t);
    const gate = deferred();
    fixture.holdActions(() => gate.promise);
    const move = fixture.bot.makeMove(fixture.game);
    await flushMicrotasks();
    assert.equal(fixture.executions, 1);
    changeContext(fixture.game);
    gate.resolve();
    await settle(t, move);
    await advance(t, 200);
    assert.equal(fixture.executions, 1);
    assert.equal(fixture.transitions, 0);
  });

  test(`scheduled Main Phase transition is ignored after ${reason} changes`, async t => {
    const fixture = scenario(t);
    fixture.setActionCount(0);
    const move = fixture.bot.makeMove(fixture.game);
    await flushMicrotasks();
    assert.equal(fixture.transitions, 0);
    changeContext(fixture.game);
    await settle(t, move);
    assert.equal(fixture.transitions, 0);
  });
}

test("a simulatedBattle planner bridge advances exactly once without a later timer", async t => {
  const fixture = scenario(t);
  const { game, bot } = fixture;
  const defense = configureBattleBridge(fixture);
  const plannerGame: BotGamePort = game;
  const planned = await turnLineSearch(plannerGame, bot.strategy, {
    turnMode: "mainBattleMain2",
    maxDepth: 2,
    nodeBudget: 10,
    preGeneratedActions: [defense],
  });
  const bridge = planned?.action;
  assert.ok(bridge?.type === "simulatedBattle", "fixture must generate a real planner bridge");
  assert.equal(bridge.attacker, undefined, "the planner bridge uses an attacker name, not a runtime reference");
  assert.equal(bridge.attackerName, "Nightmare Steed");
  const move = bot.makeMove(game);
  await settle(t, move);
  assert.equal(fixture.executions, 0, "planner must choose its simulated battle bridge");
  assert.equal(fixture.transitions, 1);
  assert.equal(fixture.exit().reason, "planner_transition");
  await advance(t, 1000);
  assert.equal(fixture.transitions, 1);
});

test("a simulatedBattle planner bridge renews an interrupted phase-end negotiation", async t => {
  const fixture = scenario(t, true);
  configureBattleBridge(fixture);
  t.mock.method(fixture.bot, "playBattlePhase", () => {});
  let phaseEndAttempts = 0;
  t.mock.method(fixture.game, "checkAndOfferTraps", async (event: Parameters<Game["checkAndOfferTraps"]>[0]) => {
    if (event === "phase_end") phaseEndAttempts++;
    const interrupted = event === "phase_end" && phaseEndAttempts === 1;
    return {
      success: true,
      needsSelection: false,
      phaseTransitionAllowed: !interrupted,
      phaseTransitionInterrupted: interrupted,
    };
  });
  const move = fixture.bot.makeMove(fixture.game);
  await settle(t, move);
  for (let tick = 0; tick < 10; tick++) await advance(t, 100);
  assert.equal(phaseEndAttempts, 2);
  assert.equal(fixture.executions, 0);
  assert.equal(fixture.game.phase, "battle");
  assert.equal(fixture.transitions, 2);
  assert.equal(fixture.exit().reason, "planner_transition");
});
