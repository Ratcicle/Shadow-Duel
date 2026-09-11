import assert from "node:assert/strict";
import test from "node:test";

import Card, {
  applyStatusesOnSummon,
  captureTrapMonsterOriginalState,
  restoreFieldExitStatuses,
  restoreTemporaryStatuses,
  restoreTrapMonsterOriginalState,
} from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";
import Player from "../../src/core/Player.js";
import { cardDatabase } from "../../src/data/cards.js";
import type { CardConstructorData } from "../../src/core/contracts/cards.js";

function monster(
  name: string,
  overrides: Partial<{
    id: number;
    atk: number;
    def: number;
    level: number;
    altTribute: {
      type: "no_tribute_if_empty_field";
      tributes: number;
    };
  }> = {},
): Card {
  return new Card(
    {
      id: overrides.id ?? 9_900,
      name,
      cardKind: "monster",
      atk: overrides.atk ?? 1_000,
      def: overrides.def ?? 1_000,
      level: overrides.level ?? 4,
      altTribute: overrides.altTribute ?? null,
      effects: [],
    },
    "player",
  );
}

test("known and legacy Card statuses preserve the flat runtime shape", () => {
  const card = monster("Status model");

  assert.equal(
    applyStatusesOnSummon(card, [
      { status: "atk", value: 1_700, restoreOnFieldExit: true },
      { status: "effectsNegated", value: true },
    ]),
    true,
  );
  assert.equal(card.atk, 1_700);
  assert.equal(card.effectsNegated, true);
  assert.deepEqual(card.fieldExitStatuses, { atk: 1_000 });
  assert.equal(Object.hasOwn(card, "statuses"), false);

  assert.equal(restoreFieldExitStatuses(card), true);
  assert.equal(card.atk, 1_000);
  assert.deepEqual(card.fieldExitStatuses, {});
  assert.equal(restoreFieldExitStatuses(card), false);

  card.tempStatuses = { piercing: false };
  card.piercing = true;
  assert.equal(restoreTemporaryStatuses(card), true);
  assert.equal(card.piercing, false);
  assert.deepEqual(card.tempStatuses, {});

  assert.equal(
    applyStatusesOnSummon(card, {
      status: "legacyStatusOutsideKnownRegistry",
      value: "preserved",
    }),
    true,
  );
  assert.equal(
    Reflect.get(card, "legacyStatusOutsideKnownRegistry"),
    "preserved",
  );
  assert.equal(Object.hasOwn(card, "statuses"), false);
});

test("Trap Monster capture and restoration preserve the original Card fields", () => {
  const card = new Card(
    {
      id: 9_901,
      name: "Trap model",
      cardKind: "trap",
      subtype: "continuous",
      effects: [],
    },
    "player",
  );
  const original = captureTrapMonsterOriginalState(card);

  assert.deepEqual(original, {
    cardKind: "trap",
    subtype: "continuous",
    monsterType: null,
    isTuner: false,
    synchroMaterialRoles: null,
    type: null,
    types: null,
    attribute: null,
    level: 0,
    baseLevel: 0,
    baseAtk: 0,
    baseDef: 0,
    atk: 0,
    def: 0,
  });
  assert.equal(captureTrapMonsterOriginalState(card), original);

  card.cardKind = "monster";
  card.subtype = null;
  card.monsterType = "synchro";
  card.isTuner = true;
  card.level = 4;
  card.baseLevel = 4;
  card.atk = 1_800;
  card.def = 1_000;
  Reflect.set(card, "isTrapMonster", true);
  Reflect.set(card, "originalCardKind", "trap");
  Reflect.set(card, "treatedAsCardKinds", ["monster", "trap"]);
  Reflect.set(card, "trapMonsterSummonProcedure", "effect");

  assert.equal(restoreTrapMonsterOriginalState(card), true);
  assert.equal(card.cardKind, "trap");
  assert.equal(card.subtype, "continuous");
  assert.equal(card.monsterType, null);
  assert.equal(card.isTuner, false);
  assert.equal(card.level, 0);
  assert.equal(card.atk, 0);
  assert.equal(card.def, 0);
  assert.equal(Object.hasOwn(card, "isTrapMonster"), false);
  assert.equal(Object.hasOwn(card, "trapMonsterOriginalState"), false);
  assert.equal(restoreTrapMonsterOriginalState(card), false);
});

test("Card counters retain their mutable Map semantics", () => {
  const card = monster("Counter model");

  card.addCounter("charge", 2);
  card.addCounter("charge");
  assert.equal(card.getCounter("charge"), 3);
  assert.equal(card.hasCounter("charge"), true);

  card.removeCounter("charge", 2);
  assert.equal(card.getCounter("charge"), 1);
  card.removeCounter("charge", 5);
  assert.equal(card.getCounter("charge"), 0);
  assert.equal(card.hasCounter("charge"), false);
  assert.equal(card.counters.has("charge"), false);
});

test("Player shuffle uses the Game port and retains the deterministic fallback", () => {
  const game = new Game({ disableChains: true, randomSeed: "player-shuffle" });
  const player = new Player("player", "Player", "human");
  const first = monster("First", { id: 9_911 });
  const second = monster("Second", { id: 9_912 });
  const third = monster("Third", { id: 9_913 });
  let delegated = false;

  player.deck = [first, second, third];
  player.game = game;
  const originalShuffle = game.shuffle.bind(game);
  game.shuffle = <Value>(items: Value[]): Value[] => {
    delegated = true;
    return originalShuffle(items);
  };
  player.shuffleDeck();
  assert.equal(delegated, true);
  assert.deepEqual(new Set(player.deck), new Set([first, second, third]));

  player.game = undefined;
  player.deck = [first, second, third];
  const originalRandom = Math.random;
  Math.random = (): number => 0;
  try {
    player.shuffleDeck();
  } finally {
    Math.random = originalRandom;
  }
  assert.deepEqual(player.deck, [second, third, first]);
});

test("Player draw, damage and healing preserve current mutations and feedback", () => {
  const game = new Game({ disableChains: true, randomSeed: 1 });
  const player = new Player("player", "Player", "human");
  const card = monster("Draw model");
  const feedback: unknown[] = [];

  player.game = game;
  player.deck.push(card);
  game.ui.showLpChange = (): false => false;
  game.queueVisualFeedback = (entry): true => {
    feedback.push(entry);
    return true;
  };

  assert.equal(player.draw(), card);
  assert.deepEqual(player.deck, []);
  assert.deepEqual(player.hand, [card]);
  assert.equal(player.draw(), null);

  player.takeDamage(1_500, { cause: "test" });
  assert.equal(player.lp, 6_500);
  player.lpGainMultiplier = 1.5;
  player.gainLP(1_000, { cause: "test" });
  assert.equal(player.lp, 8_000);
  assert.equal(player.lpGainedThisTurn, 1_500);
  assert.deepEqual(
    feedback.map((entry) => Reflect.get(entry as object, "kind")),
    ["damage", "heal"],
  );
});

test("Player tribute rules and a normal summon use the existing transaction port", async () => {
  const game = new Game({
    disableChains: true,
    disableTraps: true,
    disableEffectActivation: true,
    randomSeed: 1,
  });
  const low = monster("Low", { level: 4 });
  const middle = monster("Middle", { level: 6 });
  const high = monster("High", { level: 8 });
  const alternate = monster("Alternate", {
    level: 8,
    altTribute: { type: "no_tribute_if_empty_field", tributes: 0 },
  });

  assert.equal(game.player.getTributeRequirement(low).tributesNeeded, 0);
  assert.equal(game.player.getTributeRequirement(middle).tributesNeeded, 1);
  assert.equal(game.player.getTributeRequirement(high).tributesNeeded, 2);
  assert.deepEqual(game.player.getTributeRequirement(alternate), {
    tributesNeeded: 0,
    usingAlt: true,
    alt: alternate.altTribute,
  });

  game.player.hand = [low];
  const result = await game.player.summon(0, "attack");
  assert.equal(result?.success, true);
  assert.equal(game.player.hand.includes(low), false);
  assert.equal(game.player.field.includes(low), true);
  assert.equal(game.player.summonCount, 1);
  assert.equal(game.player.normalSummonsThisTurn.length, 1);
});

test("Player Extra Deck keeps only eligible database definitions", () => {
  const player = new Player("player", "Player", "human");
  const extraDefinition = cardDatabase.find((definition: CardConstructorData) =>
    ["fusion", "synchro", "ascension"].includes(
      definition.monsterType ?? "",
    ),
  );
  const mainDefinition = cardDatabase.find(
    (definition: CardConstructorData) =>
      definition.cardKind === "monster" && !definition.monsterType,
  );

  assert.ok(extraDefinition);
  assert.ok(mainDefinition);
  player.buildExtraDeck([mainDefinition.id, extraDefinition.id]);
  assert.deepEqual(
    player.extraDeck.map((card) => card.id),
    [extraDefinition.id],
  );
});

test("Player Main Deck construction is deterministic through its Game port", () => {
  const firstGame = new Game({ disableChains: true, randomSeed: "deck-seed" });
  const secondGame = new Game({ disableChains: true, randomSeed: "deck-seed" });
  const firstPlayer = new Player("player", "First", "human");
  const secondPlayer = new Player("player", "Second", "human");
  firstPlayer.game = firstGame;
  secondPlayer.game = secondGame;

  firstPlayer.buildDeck();
  secondPlayer.buildDeck();

  assert.equal(firstPlayer.deck.length, firstPlayer.minDeckSize);
  assert.equal(secondPlayer.deck.length, secondPlayer.minDeckSize);
  assert.deepEqual(
    firstPlayer.deck.map((card) => card.id),
    secondPlayer.deck.map((card) => card.id),
  );
  assert.deepEqual(
    firstPlayer.deck.map((card) => card.duelCardId),
    secondPlayer.deck.map((card) => card.duelCardId),
  );
  assert.equal(
    firstPlayer.deck.every(
      (card) => !["fusion", "synchro", "ascension"].includes(
        card.monsterType ?? "",
      ),
    ),
    true,
  );
  assert.equal(
    firstPlayer.deck.every((card) => Number.isInteger(card.duelCardId)),
    true,
  );
  firstGame.dispose("deck-test-complete");
  secondGame.dispose("deck-test-complete");
});
