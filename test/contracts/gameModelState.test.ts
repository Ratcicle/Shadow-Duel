import assert from "node:assert/strict";
import test from "node:test";

import Card from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";
import Player from "../../src/core/Player.js";

function createStateCard(name = "State Card"): Card {
  return new Card(
    {
      id: 999,
      name,
      cardKind: "monster",
      atk: 1000,
      def: 1000,
      level: 4,
      effects: [],
    },
    "player",
  );
}

test("DuelCardId is allocated lazily and remains unique within a duel", () => {
  const game = new Game({ disableChains: true, randomSeed: 1 });
  const first = createStateCard("First identity");
  const second = createStateCard("Second identity");

  assert.equal(Object.hasOwn(first, "duelCardId"), false);
  assert.equal(game.ensureDuelCardId(null), null);
  assert.equal(game.ensureDuelCardId(undefined), null);

  const firstId = game.ensureDuelCardId(first);
  assert.equal(firstId, 1);
  assert.equal(game.ensureDuelCardId(first), firstId);
  assert.equal(first.duelCardId, firstId);

  const secondId = game.ensureDuelCardId(second);
  assert.equal(secondId, 2);
  assert.notEqual(secondId, firstId);
});

test("Card, Player and Game retain mutable per-instance state", () => {
  const firstCard = createStateCard("First Card");
  const secondCard = createStateCard("Second Card");
  const firstPlayer = new Player("player", "First Player", "human");
  const secondPlayer = new Player("bot", "Second Player", "ai");
  const game = new Game({ disableChains: true, randomSeed: "state" });

  assert.equal(Object.isFrozen(firstCard), false);
  assert.equal(Object.isFrozen(firstPlayer), false);
  assert.equal(Object.isFrozen(game), false);
  assert.notEqual(firstCard.equips, secondCard.equips);
  assert.notEqual(firstCard.counters, secondCard.counters);
  assert.notEqual(firstPlayer.hand, secondPlayer.hand);
  assert.notEqual(firstPlayer.oncePerTurnUsageByName, secondPlayer.oncePerTurnUsageByName);

  firstCard.atk = 1250;
  firstPlayer.lp = 7500;
  game.turnCounter = 3;
  assert.equal(firstCard.atk, 1250);
  assert.equal(firstPlayer.lp, 7500);
  assert.equal(game.turnCounter, 3);
});

test("dispose clears transient domains and destroys the renderer exactly once", () => {
  let rendererDestroyCount = 0;
  const game = new Game({
    disableChains: true,
    renderer: {
      destroy(): void {
        rendererDestroyCount += 1;
      },
    },
  });

  game.pendingChainEvents.push({ event: "pending" });
  game.pendingCardAnimations.push({ kind: "move" });
  game.pendingVisualFeedback.push({ kind: "damage" });
  game.delayedActions.push({ type: "noop" });

  game.dispose("state-test");

  assert.equal(game.isDisposed(), true);
  assert.equal(game.gameOver, true);
  assert.equal(game.disposeReason, "state-test");
  assert.equal(game.targetSelection, null);
  assert.deepEqual(game.pendingChainEvents, []);
  assert.deepEqual(game.pendingCardAnimations, []);
  assert.deepEqual(game.pendingVisualFeedback, []);
  assert.deepEqual(game.delayedActions, []);
  assert.equal(rendererDestroyCount, 1);

  game.dispose("second-call");
  assert.equal(game.disposeReason, "state-test");
  assert.equal(rendererDestroyCount, 1);
});
