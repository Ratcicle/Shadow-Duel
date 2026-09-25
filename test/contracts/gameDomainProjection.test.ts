import { placeFieldCards } from "../helpers/game.js";
import assert from "node:assert/strict";
import test from "node:test";

import Card from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";

function monster(
  id: number,
  name: string,
  owner: "player" | "bot",
  atk: number,
): Card {
  return new Card(
    {
      id,
      name,
      cardKind: "monster",
      atk,
      def: 1_000,
      level: 4,
      effects: [],
    },
    owner,
  );
}

test("Game integrates setup, draw, movement, summon, combat and disposal", async () => {
  const game = new Game({
    disableChains: true,
    disableTraps: true,
    disableEffectActivation: true,
    randomSeed: 123,
  });
  await game.startWithDecks({
    exactDecks: true,
    playerDeck: [1, 1, 1, 3, 3, 3, 4, 4],
    playerExtraDeck: [],
    botDeck: [1, 1, 1, 3, 3, 3, 4, 4],
    botExtraDeck: [],
    startingPlayer: "player",
    preserveDeckOrder: true,
    initializeOnly: true,
    announceStartingPlayer: false,
  });
  const afterStart = {
    turn: game.turn,
    phase: game.phase,
    turnCounter: game.turnCounter,
    playerDeck: game.player.deck.length,
    playerHand: game.player.hand.length,
    botDeck: game.bot.deck.length,
    botHand: game.bot.hand.length,
  };

  const drawResult = game.drawCards(game.player, 1, {
    silent: true,
    animateCards: false,
  });
  const draw = {
    ok: drawResult.ok,
    ids: drawResult.drawn.map((card) => card.id),
    deck: game.player.deck.length,
    hand: game.player.hand.length,
  };

  const movedCard = game.player.hand.at(-1);
  assert.ok(movedCard);
  const movementResult = await game.moveCard(
    movedCard,
    game.player,
    "graveyard",
    { fromZone: "hand", skipAnimation: true },
  );
  assert.ok("fromZone" in movementResult);
  const move = {
    success: movementResult.success,
    fromZone: movementResult.fromZone,
    toZone: movementResult.toZone,
    hand: game.player.hand.length,
    graveyard: game.player.graveyard.length,
  };

  const summoned = monster(9_900, "Integrated summon", "player", 1_000);
  game.player.hand.push(summoned);
  const summonResult = await game.player.summon(
    game.player.hand.length - 1,
    "attack",
  );
  const summon = {
    success: summonResult?.success,
    summonId: summonResult?.summonId,
    status: game.getSummonState().last?.status,
    field: game.player.field.map((card) => card.name),
  };

  const events: string[] = [];
  for (const eventName of [
    "attack_declared",
    "battle_damage",
    "battle_destroy",
    "card_to_grave",
    "battle_completed",
  ] as const) {
    game.on(eventName, () => {
      events.push(eventName);
    });
  }
  const attacker = monster(
    9_901,
    "Integrated attacker",
    "player",
    2_000,
  );
  const defender = monster(9_902, "Integrated defender", "bot", 1_000);
  placeFieldCards(game.player.field, attacker);
  placeFieldCards(game.bot.field, defender);
  game.phase = "battle";
  game.turn = "player";
  await game.resolveCombat(attacker, defender);
  const combat = {
    botLp: game.bot.lp,
    attackerHasAttacked: attacker.hasAttacked,
    defenderField: game.bot.field.includes(defender),
    defenderGraveyard: game.bot.graveyard.includes(defender),
    events,
  };

  game.dispose("integrated");
  const dispose = {
    disposed: game.disposed,
    gameOver: game.gameOver,
    reason: game.disposeReason,
    eventListenerKeys: Object.keys(game.eventListeners),
    renderer: game.renderer,
  };

  assert.equal(afterStart.turn, "player");
  assert.equal(afterStart.playerDeck + afterStart.playerHand, 8);
  assert.equal(afterStart.botDeck + afterStart.botHand, 8);
  assert.equal(draw.ok, true);
  assert.equal(draw.ids.length, 1);
  assert.equal(draw.deck, afterStart.playerDeck - 1);
  assert.equal(draw.hand, afterStart.playerHand + 1);
  assert.deepEqual(move, {
    success: true,
    fromZone: "hand",
    toZone: "graveyard",
    hand: draw.hand - 1,
    graveyard: 1,
  });
  assert.equal(summon.success, true);
  assert.ok(summon.summonId);
  assert.equal(summon.status, "succeeded");
  assert.deepEqual(summon.field, ["Integrated summon"]);
  assert.equal(combat.botLp, 7000);
  assert.equal(combat.attackerHasAttacked, true);
  assert.equal(combat.defenderField, false);
  assert.equal(combat.defenderGraveyard, true);
  assert.deepEqual(combat.events, [
    "attack_declared",
    "battle_damage",
    "battle_completed",
    "card_to_grave",
    "battle_destroy",
  ]);
  assert.deepEqual(dispose, {
    disposed: true,
    gameOver: true,
    reason: "integrated",
    eventListenerKeys: [],
    renderer: null,
  });
});
