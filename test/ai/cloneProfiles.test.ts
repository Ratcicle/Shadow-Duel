import assert from "node:assert/strict";
import test from "node:test";

import { cloneBotGameState } from "../../src/core/bot/simulationBridge.js";

function makePlayer(id: "player" | "bot") {
  const nested = { stats: ["atk"] };
  const card = {
    id: id === "bot" ? 101 : 201,
    name: `${id} card`,
    cardKind: "monster",
    atk: 1200,
    def: 800,
    nested,
  };
  return {
    id,
    lp: id === "bot" ? 7600 : 6400,
    hand: [card],
    field: [],
    graveyard: [],
    deck: [],
    extraDeck: [],
    banished: [],
    fieldSpell: null,
    spellTrap: [],
    summonCount: 1,
    additionalNormalSummons: 2,
    controllerType: "ai",
  };
}

test("bot perspective clone preserves its legacy key order and aliasing profile", () => {
  const bot = makePlayer("bot");
  const opponent = makePlayer("player");
  const usedThisTurn = new Map([["probe", 2]]);
  const game = {
    player: opponent,
    bot,
    turn: "bot",
    phase: "main1",
    turnCounter: 7,
    effectEngine: { usedThisTurn },
  };
  const botPort = {
    ...bot,
    resolveOpponent: () => opponent,
    strategy: {
      simulateMainPhaseAction: (state: unknown) => state,
      simulateSpellEffect: () => undefined,
    },
  };

  const clone = cloneBotGameState(botPort, game);

  assert.deepEqual(Object.keys(clone), [
    "player",
    "bot",
    "turn",
    "phase",
    "turnCounter",
    "_isPerspectiveState",
    "_gameRef",
    "usedThisTurn",
  ]);
  assert.deepEqual(Object.keys(clone.bot), [
    "id",
    "lp",
    "hand",
    "field",
    "graveyard",
    "deck",
    "extraDeck",
    "banished",
    "fieldSpell",
    "spellTrap",
    "summonCount",
    "additionalNormalSummons",
    "controllerType",
  ]);
  assert.equal(clone._isPerspectiveState, true);
  assert.equal(clone._gameRef, game);
  assert.notEqual(clone.bot, bot);
  assert.notEqual(clone.bot.hand, bot.hand);
  assert.notEqual(clone.bot.hand[0], bot.hand[0]);
  assert.equal(clone.bot.hand[0]?.nested, bot.hand[0]?.nested);
  assert.notEqual(clone.usedThisTurn, usedThisTurn);
  assert.deepEqual([...clone.usedThisTurn], [["probe", 2]]);
});
