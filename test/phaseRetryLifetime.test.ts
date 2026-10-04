import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { cardDefinition } from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";

async function advance(t: TestContext, delay = 100) {
  t.mock.timers.tick(delay);
  for (let index = 0; index < 200; index++) await Promise.resolve();
}

function setup(t: TestContext, seat: "player" | "bot") {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false });
  t.after(() => game.dispose());
  game.turn = seat;
  game.turnCounter = 4;
  game.phase = "main1";
  game.aiActionDelayMs = 100;
  game.disablePresentationDelays = true;
  game.phaseDelayMs = 0;
  game.waitForPhaseDelay = async () => {};
  game[seat].controllerType = "ai";
  game[seat === "player" ? "bot" : "player"].controllerType = "human";
  for (const owner of [game.player, game.bot]) {
    owner.deck.push(...Array.from({ length: 8 }, () => new Card(cardDefinition(1), owner.id)));
  }
  return game;
}

for (const seat of ["player", "bot"] as const) {
  for (const block of ["resolving", "selection"] as const) {
    test(`phase retry coalesces repeated requests while ${block} (${seat})`, async t => {
      const game = setup(t, seat);
      if (block === "resolving") game.isResolvingEffect = true;
      else game.selectionState = "selecting";
      const calls = t.mock.method(game, "nextPhase");
      for (let count = 0; count < 3; count++) await game.nextPhase();
      assert.equal(calls.mock.callCount(), 3);
      await advance(t);
      assert.equal(calls.mock.callCount(), 4, "one outstanding phase intent renews once");
      assert.equal(game.phase, "main1");
      game.isResolvingEffect = false;
      game.selectionState = "idle";
      await advance(t);
      assert.equal(game.phase, "battle");
      assert.equal(calls.mock.callCount(), 5);
      await advance(t, 500);
      assert.equal(game.phase, "battle", "one blocked intent cannot skip the newly entered phase");
      assert.equal(calls.mock.callCount(), 5);
    });
  }

  test(`accepted End exit invalidates the old retry even when interrupted (${seat})`, async t => {
    const game = setup(t, seat);
    game.phase = "end";
    const calls = t.mock.method(game, "nextPhase");
    game.isResolvingEffect = true;
    await game.nextPhase();
    game.isResolvingEffect = false;
    t.mock.method(game, "checkAndOfferTraps", async () => ({
      phaseTransitionAllowed: false, phaseTransitionInterrupted: true,
    }));
    const result = await game.endTurn();
    assert.ok(result && typeof result === "object");
    assert.equal(Reflect.get(result, "ok"), false);
    assert.equal(Reflect.get(result, "reason"), "phase_transition_interrupted");
    await advance(t);
    assert.equal(calls.mock.callCount(), 1);
    assert.equal(game.phase, "end");
  });

  for (const invalidator of ["turn", "counter", "phase", "restart", "dispose", "controller", "accepted", "disabled"] as const) {
    test(`phase retry expires on ${invalidator} (${seat})`, async t => {
      const game = setup(t, seat);
      const calls = t.mock.method(game, "nextPhase");
      game.isResolvingEffect = true;
      await game.nextPhase(invalidator === "disabled" ? { retryOnBlocked: false } : undefined);
      game.isResolvingEffect = false;
      if (invalidator === "turn") {
        await game.skipToPhase("end");
        assert.notEqual(game.turn, seat);
      }
      if (invalidator === "counter") game.turnCounter += 2;
      if (invalidator === "phase") await game.skipToPhase("main2");
      if (invalidator === "restart") game.resetDuelState("retry_test", { turn: seat, phase: "main1", turnCounter: 4 });
      if (invalidator === "dispose") game.dispose();
      if (invalidator === "controller") game[seat].controllerType = "human";
      if (invalidator === "accepted") await game.nextPhase();
      const before = { turn: game.turn, phase: game.phase, counter: game.turnCounter, calls: calls.mock.callCount() };
      await advance(t, 500);
      assert.deepEqual({ turn: game.turn, phase: game.phase, counter: game.turnCounter, calls: calls.mock.callCount() }, before);
    });
  }
}
