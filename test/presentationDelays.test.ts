import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRuntimeGame } from "./helpers/game.js";

function setup(t: TestContext, disablePresentationDelays: boolean) {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, randomSeed: 91 });
  t.after(() => game.dispose("presentation_delays_test"));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  game.player.controllerType = "human";
  game.bot.controllerType = "ai";
  game.aiPresentationStepDelayMs = 650;
  game.disablePresentationDelays = disablePresentationDelays;
  return game;
}

async function flushMicrotasks() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function trackSettled(promise: Promise<unknown>) {
  const state = { settled: false };
  void promise.then(() => { state.settled = true; });
  return state;
}

test("AI presentation step resolves without waiting when presentation delays are disabled", async t => {
  const game = setup(t, true);
  const wait = trackSettled(game.waitForAiPresentationStep(game.bot));
  await flushMicrotasks();
  assert.equal(wait.settled, true);
});

test("AI presentation step waits aiPresentationStepDelayMs when presentation delays are enabled", async t => {
  const game = setup(t, false);
  const wait = trackSettled(game.waitForAiPresentationStep(game.bot));
  await flushMicrotasks();
  assert.equal(wait.settled, false);
  t.mock.timers.tick(649);
  await flushMicrotasks();
  assert.equal(wait.settled, false);
  t.mock.timers.tick(1);
  await flushMicrotasks();
  assert.equal(wait.settled, true);
});

for (const disabled of [true, false] as const) {
  test(`a human player never waits for the AI presentation step (delays ${disabled ? "disabled" : "enabled"})`, async t => {
    const game = setup(t, disabled);
    const wait = trackSettled(game.waitForAiPresentationStep(game.player));
    const explicit = trackSettled(game.waitForAiPresentationStep(game.player, { delayMs: 900 }));
    await flushMicrotasks();
    assert.equal(wait.settled, true);
    assert.equal(explicit.settled, true);
  });
}

test("an explicit delayMs is ignored only when presentation delays are disabled", async t => {
  const game = setup(t, true);
  const skipped = trackSettled(game.waitForAiPresentationStep(game.bot, { delayMs: 900 }));
  await flushMicrotasks();
  assert.equal(skipped.settled, true, "the flag overrides an explicit delay");

  game.disablePresentationDelays = false;
  const honored = trackSettled(game.waitForAiPresentationStep(game.bot, { delayMs: 900 }));
  t.mock.timers.tick(899);
  await flushMicrotasks();
  assert.equal(honored.settled, false);
  t.mock.timers.tick(1);
  await flushMicrotasks();
  assert.equal(honored.settled, true);
});
