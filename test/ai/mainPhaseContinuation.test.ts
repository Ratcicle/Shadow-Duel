import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Game from "../../src/core/Game.js";
import Card from "../../src/core/Card.js";
import { playBotMainPhase } from "../../src/core/bot/mainPhaseController.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import { cardDefinition, record, required, unsafeFixture } from "../helpers/fixtures.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";

function scenario(t: TestContext) {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  const game = unsafeFixture<Game & BotGamePort>(new Game({ laboratoryMode: true, laboratoryUseBot: true, disableChains: true, captureReplay: false }),
    "Concrete Game installs effect engine/activation methods; its public engine type omits Bot preview capabilities.");
  t.after(() => game.dispose("main_phase_test"));
  const bot = game.bot;
  assert.ok(bot instanceof Bot);
  game.turn = bot.id;
  game.phase = "main1";
  game.turnCounter = 2;
  game.disablePresentationDelays = true;
  game.phaseDelayMs = 0;
  game.aiSuccessfulActionDelayMs = 0;
  game.aiActionDelayMs = 0;
  game.waitForBoardPresentation = async () => {};
  game.waitForAiPresentationStep = async () => {};
  bot.strategy.shouldUseAutomaticAscensionShortcut = () => false;
  bot.simulateMainPhaseAction = state => state;
  bot.evaluateBoardV2 = () => 0;
  bot.sequenceActions = actions => actions;
  const exits: Record<string, unknown>[] = [];
  Reflect.set(game, "_arenaTracker", { recordProgress(kind: string, _game: unknown, details: object) {
    if (kind === "ai_main_phase_exit") exits.push(record(details));
  } });
  return { game, bot, exit: () => required(exits.at(-1)) };
}

test("Main Phase completes twelve productive executions instead of stopping at six", async t => {
  const { game, bot } = scenario(t);
  let executed = 0;
  const action: AIAction = { type: "monsterEffect", fieldIndex: 0, effectId: "repeat" };
  bot.field.push(new Card(cardDefinition("Nightmare Steed"), bot.id));
  bot.generateMainPhaseActions = () => executed < 12 ? [action] : [];
  bot.filterValidActionsForCurrentState = actions => actions;
  bot.executeMainPhaseAction = async () => { executed++; bot.lp--; return true; };
  await playBotMainPhase(bot, game);
  assert.equal(executed, 12);
  assert.equal(bot.lp, 7988);
});

function effect(effectId: string): AIAction {
  return { type: "monsterEffect", fieldIndex: 0, effectId };
}

function synthetic(t: TestContext) {
  const fixture = scenario(t);
  fixture.bot.field.push(new Card(cardDefinition("Nightmare Steed"), fixture.bot.id));
  // A real board has already initialized passive fields (e.g. lpGainMultiplier).
  // The legacy rejection refresh must not introduce that setup in mid-test.
  fixture.game.updateBoard();
  fixture.bot.filterValidActionsForCurrentState = actions => actions;
  return fixture;
}

for (const rejected of [false, true]) {
  test(`${rejected ? "rejected" : "accepted no-op"} effect leaves another effect on the same card available`, async t => {
    const { game, bot, exit } = synthetic(t);
    const executed: string[] = [];
    bot.generateMainPhaseActions = () => executed.includes("useful") ? [] : [effect("blocked"), effect("useful")];
    bot.executeMainPhaseAction = async (_game, action) => {
      executed.push(action.effectId!);
      if (action.effectId === "useful") bot.lp--;
      return action.effectId === "useful" || !rejected;
    };
    await playBotMainPhase(bot, game);
    assert.deepEqual(executed, ["blocked", "useful"]);
    assert.equal(exit().noOps, rejected ? 0 : 1);
    assert.equal(exit().rejected, rejected ? 1 : 0);
    assert.equal(exit().changes, 1);
  });
}

test("returning to A suppresses its repeated transition but preserves a third exit", async t => {
  const { game, bot, exit } = synthetic(t);
  const source = required(bot.field[0]);
  source.position = "attack";
  let finished = false;
  const executed: string[] = [];
  bot.generateMainPhaseActions = () => finished ? [] : source.position === "attack"
    ? [effect("toB"), effect("exit")] : [effect("toA")];
  bot.executeMainPhaseAction = async (_game, action) => {
    executed.push(action.effectId!);
    if (action.effectId === "toB") source.position = "defense";
    else if (action.effectId === "toA") source.position = "attack";
    else { bot.lp--; finished = true; }
    return true;
  };
  await playBotMainPhase(bot, game);
  assert.deepEqual(executed, ["toB", "toA", "exit"]);
  assert.equal(exit().changes, 3);
  assert.ok(Number(exit().repetitionsSuppressed) >= 1);
});

test("a rejection is reconsidered after another action supplies its missing resource", async t => {
  const { game, bot, exit } = synthetic(t);
  const source = required(bot.field[0]);
  source.counters = new Map();
  const executed: string[] = [];
  let finished = false;
  bot.generateMainPhaseActions = () => finished ? [] : [effect("consume"), effect("supply")];
  bot.executeMainPhaseAction = async (_game, action) => {
    executed.push(action.effectId!);
    if (action.effectId === "supply") { source.counters.set("fuel", 1); return true; }
    if (!source.counters.get("fuel")) return false;
    source.counters.set("fuel", 0);
    bot.lp--;
    finished = true;
    return true;
  };
  await playBotMainPhase(bot, game);
  assert.deepEqual(executed, ["consume", "supply", "consume"]);
  assert.equal(exit().rejected, 1);
  assert.equal(exit().changes, 2);
});

test("a rejected activation that paid a cost is progress, and is not automatically retried", async t => {
  const { game, bot, exit } = synthetic(t);
  const executed: string[] = [];
  bot.generateMainPhaseActions = () => executed.length === 0 ? [effect("negated")] :
    executed.length === 1 ? [effect("followup")] : [];
  bot.executeMainPhaseAction = async (_game, action) => { executed.push(action.effectId!); bot.lp -= 100; return action.effectId !== "negated"; };
  await playBotMainPhase(bot, game);
  assert.deepEqual(executed, ["negated", "followup"]);
  assert.equal(exit().rejected, 1);
  assert.equal(exit().changes, 2);
  assert.equal(exit().noOps, 0);
});

test("copies at index zero remain distinct after zone reordering", async t => {
  const { game, bot } = synthetic(t);
  const first = required(bot.field[0]);
  const second = new Card(cardDefinition("Nightmare Steed"), bot.id);
  bot.field.push(second);
  const executed: number[] = [];
  let reordered = false;
  let finished = false;
  bot.generateMainPhaseActions = () => finished ? [] : reordered ? [effect("try")]
    : [effect("try"), effect("reorder")];
  bot.executeMainPhaseAction = async (_game, action) => {
    if (action.effectId === "reorder") { bot.field.reverse(); reordered = true; return true; }
    const source = required(bot.field[0]);
    executed.push(source.instanceId);
    if (source === first) return false;
    bot.lp--;
    finished = true;
    return true;
  };
  await playBotMainPhase(bot, game);
  assert.deepEqual(executed, [first.instanceId, second.instanceId]);
});

test("unique productive states stop at the execution safety budget and reentry cannot reset it", async t => {
  const { game, bot, exit } = synthetic(t);
  Reflect.set(bot.strategy, "isPostBattlePayoffAction", () => true);
  let executed = 0;
  bot.generateMainPhaseActions = () => [effect("grow")];
  bot.executeMainPhaseAction = async () => { executed++; bot.lp++; return true; };
  await playBotMainPhase(bot, game);
  assert.equal(executed, 64);
  assert.equal(exit().reason, "execution_limit");
  assert.equal(exit().changes, 64);
  await playBotMainPhase(bot, game);
  assert.equal(executed, 64);
  game.phase = "main2";
  await playBotMainPhase(bot, game);
  assert.equal(executed, 128);
  game.turnCounter++;
  await playBotMainPhase(bot, game);
  assert.equal(executed, 192);
});

test("no alternatives after a no-op terminates instead of consuming the safety budget", async t => {
  const { game, bot, exit } = synthetic(t);
  let executed = 0;
  bot.generateMainPhaseActions = () => [effect("nothing")];
  bot.executeMainPhaseAction = async () => { executed++; return true; };
  await playBotMainPhase(bot, game);
  assert.equal(executed, 1);
  assert.equal(exit().reason, "alternatives_exhausted");
  assert.equal(exit().decisions, 2);
});

test("stale decisions have a separate absolute budget without executing old choices", async t => {
  const { game, bot, exit } = synthetic(t);
  let plannerCalls = 0;
  let executions = 0;
  bot.generateMainPhaseActions = () => [effect("stale")];
  // A callback changing the live state during planning invalidates that decision.
  bot.simulateMainPhaseAction = state => { plannerCalls++; bot.lp++; return state; };
  bot.executeMainPhaseAction = async () => { executions++; return true; };
  await playBotMainPhase(bot, game);
  assert.equal(exit().reason, "decision_limit");
  assert.equal(exit().decisions, 128);
  assert.equal(plannerCalls, 128);
  assert.equal(executions, 0);
});

test("planner and emergency fallback cannot reintroduce a suppressed action", async t => {
  const { game, bot, exit } = synthetic(t);
  let executions = 0;
  let plannerCalls = 0;
  bot.generateMainPhaseActions = () => executions ? [effect("replacement")] : [effect("blocked")];
  bot.simulateMainPhaseAction = (state, action) => {
    plannerCalls++;
    // Deliberately adversarial planner output: the returned candidate now points
    // at the already attempted effect. All controller fallback paths must filter it.
    action.effectId = "blocked";
    return state;
  };
  bot.executeMainPhaseAction = async () => { executions++; return true; };
  await playBotMainPhase(bot, game);
  assert.equal(executions, 1);
  assert.equal(plannerCalls, 2);
  assert.equal(exit().reason, "alternatives_exhausted");
});

test("the same physical bot starts a fresh history in another duel", async t => {
  const first = synthetic(t);
  const second = scenario(t);
  let executions = 0;
  first.bot.generateMainPhaseActions = () => [effect("same")];
  first.bot.executeMainPhaseAction = async () => { executions++; return true; };
  await playBotMainPhase(first.bot, first.game);
  second.game.bot = first.bot;
  first.bot.game = second.game;
  await playBotMainPhase(first.bot, second.game);
  assert.equal(executions, 2);
  assert.equal(second.exit().noOps, 1);
});

for (const change of ["stats", "position", "counters", "permission", "runtime OPT", "visual"] as const) {
  test(`${change} changes are classified by runtime progress rather than executor success`, async t => {
    const { game, bot, exit } = synthetic(t);
    const source = required(bot.field[0]);
    let executions = 0;
    bot.generateMainPhaseActions = () => [effect("change")];
    bot.executeMainPhaseAction = async () => {
      executions++;
      if (executions === 1) {
        if (change === "stats") source.atk++;
        if (change === "position") source.position = "defense";
        if (change === "counters") source.counters.set("fuel", 1);
        if (change === "permission") bot.summonCount++;
        if (change === "runtime OPT") game.oncePerTurnUsage.bot.set("same-name", 1);
        if (change === "visual") game.ui.log("diagnostic only");
      }
      return true;
    };
    await playBotMainPhase(bot, game);
    assert.equal(exit().changes, change === "visual" ? 0 : 1);
    assert.equal(exit().noOps, 1);
    assert.equal(executions, change === "visual" ? 1 : 2);
  });
}

test("capture and execution failures stop conservatively with distinct diagnostics", async t => {
  for (const failure of ["capture", "execute"]) {
    const { game, bot, exit } = synthetic(t);
    let executed = 0;
    bot.generateMainPhaseActions = () => [effect("test")];
    bot.executeMainPhaseAction = async () => { executed++; throw new Error("executor failed"); };
    if (failure === "capture") Object.defineProperty(bot, "lp", { get() { throw new Error("capture failed"); } });
    await playBotMainPhase(bot, game);
    assert.equal(executed, failure === "capture" ? 0 : 1);
    assert.equal(exit().reason, failure === "capture" ? "capture_error" : "execution_error");
  }
});

test("real spells resolve six times and a seventh Normal Summon still executes", async t => {
  const { game, bot } = scenario(t);
  for (const name of [
    ...Array<string>(3).fill("Blood Sucking Mosquito"),
    ...Array<string>(3).fill("Cheap Necromancy"),
    "Nightmare Steed",
  ]) bot.hand.push(new Card(cardDefinition(name), bot.id));
  bot.generateMainPhaseActions = () => {
    const card = bot.hand[0];
    if (!card) return [];
    return card.cardKind === "monster"
      ? [{ type: "summon", index: 0, cardName: card.name, position: "attack" }]
      : [{ type: "spell", index: 0, cardName: card.name }];
  };
  await playBotMainPhase(bot, game);
  assert.equal(bot.hand.length, 0);
  assert.equal(bot.lp, 11000);
  assert.equal(bot.graveyard.length, 6);
  assert.equal(bot.field.length, 4);
  assert.equal(bot.field.at(-1)?.name, "Nightmare Steed");
  assert.equal(bot.summonCount, 1);
});
