import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import Card from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";

function createGame(t: TestContext): Game {
  const game = new Game({
    disableChains: true,
    disableTraps: true,
    disableEffectActivation: true,
    randomSeed: 1,
  });
  t.after(() => game.dispose("movement-contract-test"));
  return game;
}

function createSpell(name: string): Card {
  return new Card(
    {
      id: 9_920,
      name,
      cardKind: "spell",
      subtype: "normal",
      effects: [],
    },
    "player",
  );
}

function createMonster(name: string): Card {
  return new Card(
    {
      id: 9_921,
      name,
      cardKind: "monster",
      atk: 1_000,
      def: 1_000,
      level: 4,
      effects: [],
    },
    "player",
  );
}

test("regular movement resolves asynchronously and normalizes the legacy banish alias", async (t) => {
  const game = createGame(t);
  const card = createSpell("Regular movement");
  game.player.hand.push(card);

  const graveyardMove = game.moveCard(card, game.player, "graveyard", {
    fromZone: "hand",
  });
  assert.equal(graveyardMove instanceof Promise, true);
  const graveyardResult = await graveyardMove;
  assert.equal(graveyardResult.success, true);
  assert.equal(graveyardResult.fromZone, "hand");
  assert.equal(graveyardResult.toZone, "graveyard");
  assert.deepEqual(game.player.graveyard, [card]);

  const banishResult = await game.moveCard(card, game.player, "banish", {
    fromZone: "graveyard",
  });
  assert.equal(banishResult.success, true);
  assert.equal(banishResult.toZone, "banished");
  assert.deepEqual(game.player.banished, [card]);
  assert.deepEqual(game.player.graveyard, []);
});

test("entry into the monster field requires an explicit summon origin", (t) => {
  const game = createGame(t);
  const card = createMonster("Missing origin");
  game.player.hand.push(card);
  const nextSummonId = game.nextSummonId;

  const result = Reflect.apply(game.moveCard, game, [
    card,
    game.player,
    "field",
    { fromZone: "hand" },
  ]);

  assert.equal(result instanceof Promise, false);
  assert.deepEqual(result, {
    success: false,
    code: "SUMMON_ORIGIN_REQUIRED",
    reason: "Monster movement to the field requires an explicit summonOrigin.",
  });
  assert.deepEqual(game.player.hand, [card]);
  assert.deepEqual(game.player.field, []);
  assert.equal(game.nextSummonId, nextSummonId);
});

test("summon entry is asynchronous and produces a transaction result", async (t) => {
  const game = createGame(t);
  const card = createMonster("Summon entry");
  game.player.hand.push(card);

  const pending = game.moveCard(card, game.player, "field", {
    fromZone: "hand",
    summonOrigin: "effect_resolution",
    summonMethodOverride: "special",
    summonProcedure: "card_effect",
  });

  assert.equal(pending instanceof Promise, true);
  const result = await pending;
  assert.equal(result.success, true);
  assert.equal(result.summonId, 1);
  assert.equal(result.summonOrigin, "effect_resolution");
  assert.deepEqual(game.player.hand, []);
  assert.deepEqual(game.player.field, [card]);
  assert.equal(game.getSummonState().last?.status, "succeeded");
});

test("field-to-field control transfer does not create a Summon transaction", async (t) => {
  const game = createGame(t);
  const card = createMonster("Control transfer");
  game.player.field.push(card);
  const nextSummonId = game.nextSummonId;

  const movement = game.moveCard(card, game.bot, "field", {
    fromZone: "field",
  });
  assert.equal(movement instanceof Promise, true);
  const result = await movement;

  assert.equal(result.success, true);
  assert.equal(result.summonId, null);
  assert.equal(game.nextSummonId, nextSummonId);
  assert.deepEqual(game.player.field, []);
  assert.deepEqual(game.bot.field, [card]);
  assert.equal(card.controller, "bot");
});

test("a token source enters through the normal Summon coordinator", async (t) => {
  const game = createGame(t);
  const token = createMonster("Token source");
  token.id = undefined;
  token.isToken = true;

  const pending = game.moveCard(token, game.player, "field", {
    fromZone: "token",
    summonOrigin: "effect_resolution",
    summonMethodOverride: "special",
    summonProcedure: "token_effect",
  });
  assert.equal(pending instanceof Promise, true);
  const result = await pending;

  assert.equal(result.success, true);
  assert.equal(result.fromZone, "token");
  assert.equal(result.toZone, "field");
  assert.equal(game.player.field.includes(token), true);
  assert.equal(token.duelCardId, 1);
});

test("zone-operation failure rolls state back atomically", async (t) => {
  const game = createGame(t);
  const card = createSpell("Rollback");
  game.player.hand.push(card);
  game.setDevMode(true);
  game.devFailAfterZoneMutation = true;

  const result = await game.moveCard(card, game.player, "graveyard", {
    fromZone: "hand",
    contextLabel: "movement_contract_rollback",
  });

  assert.deepEqual(result, {
    success: false,
    reason: "DEV_ZONE_MUTATION_FAIL",
    rolledBack: true,
  });
  assert.equal(game.devFailAfterZoneMutation, false);
  assert.deepEqual(game.player.hand, [card]);
  assert.deepEqual(game.player.graveyard, []);
  assert.equal(game.zoneOpDepth, 0);
  assert.equal(game.zoneOpSnapshot, null);
});
