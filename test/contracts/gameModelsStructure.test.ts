import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import Card from "../../src/core/Card.js";
import * as CardModule from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";
import * as GameModule from "../../src/core/Game.js";
import Player from "../../src/core/Player.js";
import * as PlayerModule from "../../src/core/Player.js";
import { GAME_ATTACHMENT_NAMES } from "../../src/core/game/attachments.js";

const CARD_OWN_KEYS_SHA256 =
  "06bd2484efb06db0a59ce0ed9c254139f6eb4ca466b091931ea18258fc8a9c5d";
const CARD_WITH_DUEL_ID_KEYS_SHA256 =
  "4fee8781da0ba61f669a9caa72bdedfd39ead6016c8b7befc6e3c91757415d02";
const PLAYER_OWN_KEYS_SHA256 =
  "d5d29769977cfe151836b3cab5f9cb4c602e22102f2db9df15906cf86e481a17";
const GAME_OWN_KEYS_SHA256 =
  "15ef93fedac39ca008e27f141661647d9856448f90a69c70b8b4ccafc00c2ad0";
const CARD_PROTOTYPE_KEYS_SHA256 =
  "5452099429b26afc52c7a10473ff0478c117cf68686bf4d2557ea29e97f1921b";
const PLAYER_PROTOTYPE_KEYS_SHA256 =
  "4217e599abeb44e8f09e7d521fdb68d3445564aede0caf233a12f68373646250";
const GAME_PROTOTYPE_KEYS_SHA256 =
  "933a03725063477f9a5bf1dafa3e8142f820ca528f237c1ae215c71dc7b5a010";
const CARD_PROTOTYPE_ARITIES_SHA256 =
  "9e80717990147ad60201041abb2cd044e420389305060d39c9a10c2728dfc9d8";
const PLAYER_PROTOTYPE_ARITIES_SHA256 =
  "f014da3a109ec6c3c2dead67ec04c7f56226f470f080f468ec67fe67a54b3a31";

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function createStructureCard(name = "Structure Card"): Card {
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

function assertAssignedOwnProperties(value: object, expectedCount: number): void {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  assert.equal(Object.keys(descriptors).length, expectedCount);
  for (const [name, descriptor] of Object.entries(descriptors)) {
    assert.equal(descriptor.enumerable, true, `${name} must remain enumerable`);
    assert.equal(descriptor.writable, true, `${name} must remain writable`);
    assert.equal(
      descriptor.configurable,
      true,
      `${name} must remain configurable`,
    );
    assert.equal("get" in descriptor, false, `${name} must remain a data field`);
  }
}

function prototypeArities(prototype: object): Array<readonly [string, number]> {
  return Object.getOwnPropertyNames(prototype).map((name) => {
    const value = Reflect.get(prototype, name);
    assert.equal(typeof value, "function", `${name} must remain callable`);
    return [name, value.length] as const;
  });
}

test("Card preserves its 93 constructor-owned fields and class prototype", () => {
  const card = createStructureCard();
  const ownKeys = Object.keys(card);
  const prototypeKeys = Object.getOwnPropertyNames(Card.prototype);

  assert.equal(ownKeys.length, 93);
  assert.equal(sha256(ownKeys), CARD_OWN_KEYS_SHA256);
  assert.equal(sha256(prototypeKeys), CARD_PROTOTYPE_KEYS_SHA256);
  assert.equal(
    sha256(prototypeArities(Card.prototype)),
    CARD_PROTOTYPE_ARITIES_SHA256,
  );
  assertAssignedOwnProperties(card, 93);

  for (const name of prototypeKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(Card.prototype, name);
    assert.equal(descriptor?.enumerable, false, name);
    assert.equal(descriptor?.writable, true, name);
    assert.equal(descriptor?.configurable, true, name);
  }
});

test("DuelCardId is allocated lazily as the 94th Card field", () => {
  const game = new Game({ disableChains: true, randomSeed: 1 });
  const first = createStructureCard("First identity");
  const second = createStructureCard("Second identity");

  assert.equal(Object.hasOwn(first, "duelCardId"), false);
  assert.equal(game.ensureDuelCardId(null), null);
  assert.equal(game.ensureDuelCardId(undefined), null);

  const firstId = game.ensureDuelCardId(first);
  assert.equal(firstId, 1);
  assert.equal(game.ensureDuelCardId(first), firstId);
  assert.equal(Object.keys(first).length, 94);
  assert.equal(sha256(Object.keys(first)), CARD_WITH_DUEL_ID_KEYS_SHA256);
  assert.equal(Object.keys(first).at(-1), "duelCardId");

  const secondId = game.ensureDuelCardId(second);
  assert.equal(secondId, 2);
  assert.notEqual(secondId, firstId);
});

test("Player preserves its 25 constructor-owned fields and class prototype", () => {
  const player = new Player("player", "Structure Player", "human");
  const ownKeys = Object.keys(player);
  const prototypeKeys = Object.getOwnPropertyNames(Player.prototype);

  assert.equal(ownKeys.length, 25);
  assert.equal(sha256(ownKeys), PLAYER_OWN_KEYS_SHA256);
  assert.equal(sha256(prototypeKeys), PLAYER_PROTOTYPE_KEYS_SHA256);
  assert.equal(
    sha256(prototypeArities(Player.prototype)),
    PLAYER_PROTOTYPE_ARITIES_SHA256,
  );
  assertAssignedOwnProperties(player, 25);

  for (const name of prototypeKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(Player.prototype, name);
    assert.equal(descriptor?.enumerable, false, name);
    assert.equal(descriptor?.writable, true, name);
    assert.equal(descriptor?.configurable, true, name);
  }
});

test("Game preserves its 85 constructor-owned fields and 239 prototype keys", () => {
  const game = new Game({
    disableChains: true,
    disableTraps: true,
    disableEffectActivation: true,
    randomSeed: 1,
  });
  const ownKeys = Object.keys(game);
  const prototypeKeys = Object.getOwnPropertyNames(Game.prototype);

  assert.equal(ownKeys.length, 85);
  assert.equal(sha256(ownKeys), GAME_OWN_KEYS_SHA256);
  assert.equal(prototypeKeys.length, 239);
  assert.equal(sha256(prototypeKeys), GAME_PROTOTYPE_KEYS_SHA256);
  assert.equal(GAME_ATTACHMENT_NAMES.length, 219);
  assertAssignedOwnProperties(game, 85);
});

test("Card, Player and Game retain mutable per-instance state", () => {
  const firstCard = createStructureCard("First Card");
  const secondCard = createStructureCard("Second Card");
  const firstPlayer = new Player("player", "First Player", "human");
  const secondPlayer = new Player("bot", "Second Player", "ai");
  const game = new Game({ disableChains: true, randomSeed: "structure" });

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

test("model facade keysets remain compatible with their legacy modules", () => {
  assert.deepEqual(Object.keys(GameModule), ["default"]);
  assert.deepEqual(Object.keys(CardModule), [
    "applyStatusesOnSummon",
    "bumpCardLocationVersion",
    "captureTrapMonsterOriginalState",
    "cardMatchesKind",
    "default",
    "getCardComparableAttribute",
    "getCardLocationVersion",
    "getEffectiveCardKinds",
    "restoreFieldExitStatuses",
    "restoreTemporaryStatuses",
    "restoreTrapMonsterOriginalState",
  ]);
  assert.deepEqual(Object.keys(PlayerModule), [
    "canUseNormalSummonForCard",
    "cardMatchesNormalSummonFilters",
    "createNormalSummonRecord",
    "default",
    "isAI",
    "isHuman",
    "recordNormalSummonForTurn",
  ]);
});

test("dispose preserves lazy-field behavior while clearing transient domains", () => {
  let rendererDestroyCount = 0;
  const game = new Game({
    disableChains: true,
    renderer: {
      destroy(): void {
        rendererDestroyCount += 1;
      },
    },
  });
  const initialKeys = Object.keys(game);

  assert.equal(Object.hasOwn(game, "disposeReason"), false);
  assert.equal(Object.hasOwn(game, "pendingReplayDecisionPromise"), false);

  game.pendingChainEvents.push({ event: "pending" });
  game.pendingCardAnimations.push({ kind: "move" });
  game.pendingVisualFeedback.push({ kind: "damage" });
  game.delayedActions.push({ type: "noop" });

  game.dispose("structure-test");

  assert.equal(game.isDisposed(), true);
  assert.equal(game.gameOver, true);
  assert.equal(game.disposeReason, "structure-test");
  assert.equal(Object.keys(game).at(-1), "disposeReason");
  assert.deepEqual(Object.keys(game).slice(0, initialKeys.length), initialKeys);
  assert.equal(game.targetSelection, null);
  assert.deepEqual(game.pendingChainEvents, []);
  assert.deepEqual(game.pendingCardAnimations, []);
  assert.deepEqual(game.pendingVisualFeedback, []);
  assert.deepEqual(game.delayedActions, []);
  assert.equal(rendererDestroyCount, 1);

  game.dispose("second-call");
  assert.equal(game.disposeReason, "structure-test");
  assert.equal(rendererDestroyCount, 1);
});
