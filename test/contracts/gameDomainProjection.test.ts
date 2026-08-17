import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import Card from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";

const INTEGRATED_DOMAIN_SHA256 =
  "db94f0468219e78c19dfb054b4aa5e13de1bd01b3c54864615567fbcee46f3ad";

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

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

test("integrated Game-domain projection matches the origin/main baseline", async () => {
  const game = new Game({
    disableChains: true,
    disableTraps: true,
    disableEffectActivation: true,
    randomSeed: 123,
  });
  await game.startWithDecks({
    exactDecks: true,
    playerDeck: [1, 2, 3, 4, 5, 6, 7, 8],
    playerExtraDeck: [],
    botDeck: [1, 2, 3, 4, 5, 6, 7, 8],
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
  game.player.field.push(attacker);
  game.bot.field.push(defender);
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

  const projection = { afterStart, draw, move, summon, combat, dispose };
  assert.equal(sha256(projection), INTEGRATED_DOMAIN_SHA256);
});
