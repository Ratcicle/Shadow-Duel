import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import { cardDefinition, record, required, unsafeFixture } from "../helpers/fixtures.js";

async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

async function tick(t: TestContext, count = 1) {
  for (let i = 0; i < count; i++) {
    t.mock.timers.tick(20);
    await flush();
  }
}

async function settle(t: TestContext, promise: Promise<unknown>) {
  let done = false;
  void promise.then(() => { done = true; });
  for (let i = 0; i < 500 && !done; i++) await tick(t);
  assert.equal(done, true, "session must release its continuation");
  await promise;
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>(finish => { resolve = finish; });
  return { promise, resolve };
}

function scenario(t: TestContext) {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  const errors: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { errors.push(args); });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const game = unsafeFixture<Game & BotGamePort>(new Game({
    laboratoryMode: true, laboratoryUseBot: true, disableChains: true,
    captureReplay: false, randomSeed: 3105,
  }), "Concrete Game attaches EffectEngine methods omitted by the public preview projection.");
  t.after(() => game.dispose("main_phase_recovery_test"));
  const bot = game.bot;
  assert.ok(bot instanceof Bot);
  game.turn = bot.id;
  game.phase = "main1";
  game.turnCounter = 2;
  game.aiActionDelayMs = 20;
  game.aiSuccessfulActionDelayMs = 0;
  game.phaseDelayMs = 0;
  game.disablePresentationDelays = true;
  game.turnLineSearchMode = "off";
  bot.strategy.shouldUseAutomaticAscensionShortcut = () => false;
  bot.simulateMainPhaseAction = state => state;
  bot.evaluateBoardV2 = () => 0;
  bot.sequenceActions = actions => actions;
  bot.filterValidActionsForCurrentState = actions => actions;
  bot.playBattlePhase = () => {};
  bot.field.push(new Card(cardDefinition("Nightmare Steed"), bot.id));
  game.updateBoard();
  const events: { kind: string; data: Record<string, unknown> }[] = [];
  game._arenaTracker = { recordProgress(kind, _game, details) {
    events.push({ kind, data: record(details ?? {}) });
  } };
  let executions = 0;
  let phaseEnds = 0;
  let onExecute = async () => { bot.lp--; return true; };
  let onPhaseEnd = async () => false;
  bot.generateMainPhaseActions = (): AIAction[] => [{ type: "monsterEffect", fieldIndex: 0, effectId: "first" },
    { type: "monsterEffect", fieldIndex: 0, effectId: "alternative" }];
  bot.executeMainPhaseAction = async () => { executions++; return onExecute(); };
  t.mock.method(game, "checkAndOfferTraps", async (event: Parameters<Game["checkAndOfferTraps"]>[0]) => {
    const interrupted = event === "phase_end" && (++phaseEnds, await onPhaseEnd());
    return { success: true, needsSelection: false, phaseTransitionAllowed: !interrupted,
      phaseTransitionInterrupted: interrupted };
  });
  return { game, bot, events, errors,
    get executions() { return executions; }, get phaseEnds() { return phaseEnds; },
    execute(fn: () => Promise<boolean>) { onExecute = fn; },
    phaseEnd(fn: () => Promise<boolean>) { onPhaseEnd = fn; },
    last(kind: string) { return required(events.filter(entry => entry.kind === kind).at(-1)).data; },
  };
}

test("makeMove finalizes after an executor exception without playing another candidate", async t => {
  const f = scenario(t);
  f.execute(async () => { throw new Error("executor original failure"); });
  await settle(t, f.bot.makeMove(f.game));
  await tick(t, 10);
  assert.equal(f.executions, 1);
  assert.equal(f.phaseEnds, 1);
  assert.equal(f.game.phase, "battle");
  const final = f.last("ai_main_phase_finalization");
  assert.equal(final.stopReason, "execution_error");
  assert.equal(final.finalizationOutcome, "transitioned");
  assert.equal(final.operation, "execute_action");
  assert.equal(final.message, "executor original failure");
  assert.equal(final.executions, 1);
});

test("128 decisions still allow one interrupted phase-end followed by an accepted passage", async t => {
  const f = scenario(t);
  f.bot.generateMainPhaseActions = () => [{ type: "monsterEffect", fieldIndex: 0, effectId: "stale" }];
  f.bot.simulateMainPhaseAction = state => { f.bot.lp++; return state; };
  f.phaseEnd(async () => f.phaseEnds === 1);
  await settle(t, f.bot.makeMove(f.game));
  await tick(t, 20);
  assert.equal(f.last("ai_main_phase_exit").decisions, 128);
  assert.equal(f.executions, 0);
  assert.equal(f.phaseEnds, 2);
  assert.equal(f.game.phase, "battle");
  assert.equal(f.last("ai_main_phase_finalization").finalizationAttempts, 2);
});

test("a paid cost survives an executor exception exactly once", async t => {
  const f = scenario(t);
  f.execute(async () => { f.bot.lp -= 100; throw new Error("after cost"); });
  await settle(t, f.bot.makeMove(f.game));
  await tick(t, 10);
  assert.equal(f.bot.lp, 7900);
  assert.equal(f.executions, 1);
  assert.equal(f.phaseEnds, 1);
  assert.equal(f.game.phase, "battle");
  assert.equal(f.last("ai_main_phase_finalization").stopReason, "execution_error");
});

for (const pending of ["resolution", "selection", "chain"] as const) {
  test(`recovery waits for pending ${pending} without spending finalization attempts`, async t => {
    const f = scenario(t);
    let chainOpen = false;
    if (pending === "chain") t.mock.method(f.game.chainSystem, "isChainWindowOpen", () => chainOpen);
    const gate = deferred();
    f.execute(async () => {
      await gate.promise;
      if (pending === "resolution") f.game.isResolvingEffect = true;
      if (pending === "selection") f.game.selectionState = "selecting";
      chainOpen = pending === "chain";
      throw new Error(`pending ${pending}`);
    });
    const first = f.bot.makeMove(f.game);
    await flush();
    const second = f.bot.makeMove(f.game);
    gate.resolve();
    await tick(t, 10);
    assert.equal(f.executions, 1);
    assert.equal(f.phaseEnds, 0);
    assert.equal(f.game.phase, "main1");
    f.game.isResolvingEffect = false;
    f.game.selectionState = "idle";
    chainOpen = false;
    await settle(t, Promise.all([first, second]));
    await tick(t, 5);
    assert.equal(f.phaseEnds, 1);
    assert.equal(f.game.phase, "battle");
    assert.equal(f.last("ai_main_phase_finalization").finalizationAttempts, 1);
  });
}

test("persistent projection failure never needs a second fingerprint to finalize", async t => {
  const f = scenario(t);
  let reads = 0;
  const reservations = f.game.effectUsageReservations;
  Object.defineProperty(f.game, "effectUsageReservations", { configurable: true, get() { reads++; throw new Error("ledger projection unreadable"); } });
  try {
    await settle(t, f.bot.makeMove(f.game));
    assert.equal(reads, 1);
    assert.equal(f.executions, 0);
    assert.equal(f.phaseEnds, 1);
    assert.equal(f.game.phase, "battle");
    const final = f.last("ai_main_phase_finalization");
    assert.equal(final.stopReason, "capture_error");
    assert.equal(final.operation, "capture_state");
    assert.equal(final.message, "ledger projection unreadable");
    assert.equal(final.finalizationOutcome, "transitioned");
  } finally {
    // dispose legitimately releases reservations after the assertions; restore
    // only the fixture accessor for that unrelated teardown operation.
    Object.defineProperty(f.game, "effectUsageReservations", { configurable: true, writable: true, value: reservations });
  }
});

test("action identity failures preserve their cause and finalize without executing", async t => {
  const f = scenario(t);
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  f.bot.generateMainPhaseActions = () => [{ type: "monsterEffect", fieldIndex: 0,
    activationContext: { actionContext: cyclic } }];
  await settle(t, f.bot.makeMove(f.game));
  assert.equal(f.executions, 0);
  assert.equal(f.game.phase, "battle");
  const final = f.last("ai_main_phase_finalization");
  assert.equal(final.stopReason, "capture_error");
  assert.equal(final.operation, "identify_action");
  assert.match(String(final.message), /Cyclic main-phase identity metadata/);
});

test("64 executions remain closed through a finite phase-end interruption", async t => {
  const f = scenario(t);
  f.phaseEnd(async () => f.phaseEnds === 1);
  await settle(t, f.bot.makeMove(f.game));
  await tick(t, 5);
  assert.equal(f.executions, 64);
  assert.equal(f.phaseEnds, 2);
  assert.equal(f.game.phase, "battle");
  const final = f.last("ai_main_phase_finalization");
  assert.equal(final.stopReason, "execution_limit");
  assert.equal(final.executions, 64);
  assert.equal(final.finalizationAttempts, 2);
});

test("a planner bridge at decision 128 shares finite finalization without reopening play", async t => {
  const f = scenario(t);
  f.game.turnLineSearchMode = "always";
  f.game.turnLineSearchTurnMode = "mainBattleMain2";
  f.game.turnLineSearchMaxDepth = 2;
  f.game.turnLineSearchNodeBudget = 10;
  let generations = 0;
  f.bot.generateMainPhaseActions = () => { generations++; return [{ type: "position_change", fieldIndex: 0, toPosition: "defense" }]; };
  f.bot.strategy.generateMainPhaseActions = () => [];
  f.bot.strategy.simulateMainPhaseAction = state => {
    if (generations < 128) f.bot.lp++;
    return state;
  };
  f.bot.strategy.evaluateBoardV2 = state => 8000 - (state.player?.lp ?? 8000);
  f.phaseEnd(async () => f.phaseEnds === 1);
  await settle(t, f.bot.makeMove(f.game));
  await tick(t, 5);
  assert.equal(generations, 128);
  assert.equal(f.executions, 0);
  assert.equal(f.phaseEnds, 2);
  assert.equal(f.game.phase, "battle");
  const final = f.last("ai_main_phase_finalization");
  assert.equal(final.stopReason, "planner_transition");
  assert.equal(final.decisions, 128);
});

test("nextPhase can throw once and recover without reopening card play", async t => {
  const f = scenario(t);
  f.bot.generateMainPhaseActions = () => [];
  const real = f.game.nextPhase;
  let attempts = 0;
  t.mock.method(f.game, "nextPhase", async (...args: Parameters<Game["nextPhase"]>) => {
    attempts++;
    if (attempts === 1) {
      f.bot.generateMainPhaseActions = () => [{ type: "monsterEffect", fieldIndex: 0 }];
      throw new Error("transition original cause");
    }
    return real.apply(f.game, args);
  });
  await settle(t, f.bot.makeMove(f.game));
  await tick(t, 5);
  assert.equal(attempts, 2);
  assert.equal(f.executions, 0);
  assert.equal(f.game.phase, "battle");
  const final = f.last("ai_main_phase_finalization");
  assert.equal(final.finalizationOutcome, "transitioned");
  assert.equal(final.category, "transition_error");
  assert.equal(final.message, "transition original cause");
});

test("an exception after the real phase change never advances again", async t => {
  const f = scenario(t);
  f.bot.generateMainPhaseActions = () => [];
  const update = f.game.updateBoard;
  t.mock.method(f.game, "updateBoard", (...args: Parameters<Game["updateBoard"]>) => {
    if (f.game.phase === "battle") throw new Error("presentation after phase changed");
    return update.apply(f.game, args);
  });
  await settle(t, f.bot.makeMove(f.game));
  await tick(t, 20);
  assert.equal(f.game.phase, "battle");
  assert.equal(f.phaseEnds, 1);
  assert.equal(f.last("ai_main_phase_finalization").finalizationOutcome, "transitioned");
  assert.equal(f.last("ai_main_phase_finalization").message, "presentation after phase changed");
});

test("persistent transition exceptions exhaust their own budget and release all retries", async t => {
  const f = scenario(t);
  f.bot.generateMainPhaseActions = () => [];
  let attempts = 0;
  t.mock.method(f.game, "nextPhase", async () => { attempts++; throw new Error("persistent transition failure"); });
  await settle(t, f.bot.makeMove(f.game));
  const atEnd = f.last("ai_main_phase_finalization");
  assert.equal(attempts, 8);
  assert.equal(atEnd.finalizationOutcome, "limit_reached");
  assert.equal(atEnd.status, "failed");
  assert.equal(atEnd.decisions, 1);
  await settle(t, f.bot.makeMove(f.game));
  await tick(t, 100);
  assert.equal(attempts, 8);
  assert.equal(f.executions, 0);
  assert.equal(f.game.phase, "main1");
});

test("runtime phase-end reentry and concurrent callers share a pending negotiation", async t => {
  const f = scenario(t);
  f.execute(async () => { throw new Error("recover only"); });
  const gate = deferred();
  f.phaseEnd(async () => {
    if (f.phaseEnds !== 1) return false;
    await gate.promise;
    return true;
  });
  const original = f.bot.makeMove;
  let entries = 0;
  t.mock.method(f.bot, "makeMove", (...args: Parameters<Bot["makeMove"]>) => { entries++; return original.apply(f.bot, args); });
  const first = f.bot.makeMove(f.game);
  await tick(t, 4);
  const second = f.bot.makeMove(f.game);
  await tick(t, 4);
  assert.equal(f.phaseEnds, 1);
  gate.resolve();
  await settle(t, Promise.all([first, second]));
  await tick(t, 10);
  assert.ok(entries >= 3, "nextPhase's scheduled makeMove must actually reenter");
  assert.equal(f.phaseEnds, 2);
  assert.equal(f.executions, 1);
  assert.equal(f.game.phase, "battle");
});

for (const invalidation of ["phase", "turn", "turnCounter", "actor", "opponent", "gameOver", "disposed"] as const) {
  test(`recovery abandons an old session after ${invalidation} changes`, async t => {
    const f = scenario(t);
    f.execute(async () => { f.game.isResolvingEffect = true; throw new Error("recovering"); });
    const move = f.bot.makeMove(f.game);
    await tick(t, 3);
    assert.equal(f.phaseEnds, 0);
    if (invalidation === "phase") f.game.phase = "main2";
    if (invalidation === "turn") f.game.turn = "player";
    if (invalidation === "turnCounter") f.game.turnCounter++;
    if (invalidation === "actor") f.game.bot = new Bot();
    if (invalidation === "opponent") f.game.player = new Bot();
    if (invalidation === "gameOver") f.game.gameOver = true;
    if (invalidation === "disposed") f.game.dispose("lost recovery context");
    await settle(t, move);
    await tick(t, 5);
    assert.equal(f.executions, 1);
    assert.equal(f.phaseEnds, 0);
    const final = f.last("ai_main_phase_finalization");
    assert.equal(final.stopReason, "execution_error");
    assert.equal(final.finalizationOutcome, "invalidated");
  });
}

test("phase_window_pending resumes only finalization after a capture failure", async t => {
  const f = scenario(t);
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  f.bot.generateMainPhaseActions = () => [{ type: "monsterEffect", fieldIndex: 0, activationContext: { actionContext: cyclic } }];
  let negotiations = 0;
  t.mock.method(f.game, "checkAndOfferTraps", async (event: Parameters<Game["checkAndOfferTraps"]>[0]) => {
    const pending = event === "phase_end" && ++negotiations === 1;
    if (pending) f.game.selectionState = "selecting";
    return { success: true, needsSelection: pending, phaseTransitionAllowed: !pending, phaseTransitionInterrupted: false };
  });
  const move = f.bot.makeMove(f.game);
  await tick(t, 10);
  assert.equal(negotiations, 1);
  assert.equal(f.game.phase, "main1");
  f.game.selectionState = "idle";
  await settle(t, move);
  assert.equal(negotiations, 2);
  assert.equal(f.game.phase, "battle");
  assert.equal(f.executions, 0);
  assert.equal(f.last("ai_main_phase_finalization").stopReason, "capture_error");
});

test("an old recovery continuation cannot finalize a newly entered Main2 session", async t => {
  const f = scenario(t);
  f.execute(async () => { f.game.isResolvingEffect = true; throw new Error("old session"); });
  const first = f.bot.makeMove(f.game);
  await tick(t, 4);
  f.game.phase = "main2";
  f.game.isResolvingEffect = false;
  Reflect.set(f.bot.strategy, "isPostBattlePayoffAction", () => true);
  f.bot.generateMainPhaseActions = () => f.executions < 2 ? [{ type: "monsterEffect", fieldIndex: 0 }] : [];
  f.execute(async () => { f.bot.lp--; return true; });
  // The runtime legitimately schedules End Phase's own makeMove. Keep that
  // separate phase out of this test while retaining all Main Phase reentries.
  const makeMove = f.bot.makeMove.bind(f.bot);
  t.mock.method(f.bot, "makeMove", async (game: BotGamePort) => {
    if (game.phase !== "end") await makeMove(game);
  });
  const second = f.bot.makeMove(f.game);
  await settle(t, Promise.all([first, second]));
  await tick(t, 10);
  assert.equal(f.executions, 2, "exactly one action belongs to each context");
  assert.equal(f.phaseEnds, 1, "only the new Main2 session negotiates its exit");
  assert.equal(f.game.phase, "end");
  const endings = f.events.filter(entry => entry.kind === "ai_main_phase_finalization").map(entry => entry.data);
  assert.equal(endings.length, 2);
  assert.equal(endings[0]?.finalizationOutcome, "invalidated");
  assert.equal(endings[1]?.finalizationOutcome, "transitioned");
});

for (const change of ["turn", "gameOver"] as const) {
  test(`a transition exception after ${change} changes invalidates instead of retrying`, async t => {
    const f = scenario(t);
    f.bot.generateMainPhaseActions = () => [];
    let attempts = 0;
    t.mock.method(f.game, "nextPhase", async () => {
      attempts++;
      if (change === "turn") f.game.turn = "player";
      else f.game.gameOver = true;
      throw new Error("context changed inside transition");
    });
    await settle(t, f.bot.makeMove(f.game));
    await tick(t, 10);
    assert.equal(attempts, 1);
    assert.equal(f.last("ai_main_phase_finalization").finalizationOutcome, "invalidated");
  });
}

test("a guard refusal is terminal and preserves the original execution cause", async t => {
  const f = scenario(t);
  const guard = f.game.canStartAction;
  f.execute(async () => {
    t.mock.method(f.game, "canStartAction", (options: Parameters<Game["canStartAction"]>[0]) => options?.kind === "phase_change"
      ? { ok: false, success: false, needsSelection: false, code: "BLOCKED_TEST", reason: "runtime cannot finalize" }
      : guard.call(f.game, options));
    throw new Error("original execution cause");
  });
  await settle(t, f.bot.makeMove(f.game));
  assert.equal(f.phaseEnds, 0);
  assert.equal(f.game.phase, "main1");
  const final = f.last("ai_main_phase_finalization");
  assert.equal(final.finalizationOutcome, "guard_blocked");
  assert.equal(final.status, "failed");
  assert.equal(final.message, "original execution cause");
});

test("the session owns a blocked nextPhase retry instead of leaving a runtime timer", async t => {
  const f = scenario(t);
  f.bot.generateMainPhaseActions = () => [];
  const guard = f.game.guardActionStart;
  let checks = 0;
  t.mock.method(f.game, "guardActionStart", (...args: Parameters<Game["guardActionStart"]>) => {
    if (args[0]?.kind === "phase_change" && ++checks === 1) return {
      ok: false, success: false, needsSelection: false,
      code: "BLOCKED_RESOLVING", reason: "resolution started after readiness check",
    };
    return guard.apply(f.game, args);
  });
  await settle(t, f.bot.makeMove(f.game));
  await tick(t, 20);
  assert.equal(checks, 2);
  assert.equal(f.phaseEnds, 1);
  assert.equal(f.game.phase, "battle");
  assert.equal(f.last("ai_main_phase_finalization").finalizationAttempts, 2);
});

for (const diagnostics of ["absent", "tracker throws", "all sinks throw"] as const) {
  test(`recovery remains observable and releases control when diagnostics are ${diagnostics}`, async t => {
    const f = scenario(t);
    if (diagnostics === "absent") Reflect.deleteProperty(f.game, "_arenaTracker");
    else f.game._arenaTracker = { recordProgress() { throw new Error("tracker failed"); } };
    if (diagnostics === "all sinks throw") t.mock.method(console, "error", () => { throw new Error("logger failed"); });
    f.execute(async () => { throw new Error("observable execution cause"); });
    await settle(t, f.bot.makeMove(f.game));
    assert.equal(f.executions, 1);
    assert.equal(f.game.phase, "battle");
    if (diagnostics !== "all sinks throw") assert.ok(f.errors.some(args => args.some(value =>
      typeof value === "object" && value !== null && "message" in value && value.message === "observable execution cause")));
  });
}
