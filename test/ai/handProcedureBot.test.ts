import assert from "node:assert/strict";
import test from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { cardDefinition } from "../helpers/fixtures.js";
import { createRuntimeGame } from "../helpers/game.js";
import { unsafeFixture } from "../helpers/fixtures.js";
import type { AiLiveGamePort } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";

function setup() {
  const bot = new Bot();
  const game = createRuntimeGame({ opponentOverride: bot, disableChains: true, randomSeed: 1 });
  game.phase = "main1";
  game.turn = bot.id;
  bot.hand = [new Card(cardDefinition("Luminous God Hyperion"), bot.id)];
  bot.field = [];
  bot.graveyard = Array.from({ length: 5 }, (_, index) => new Card({
    name: `Light material ${index}`, cardKind: "monster", attribute: "Light", level: 1, atk: 100, def: 100,
  }, bot.id));
  for (const card of [...bot.hand, ...bot.graveyard]) game.ensureDuelCardId(card);
  // The concrete Game exposes richer attached methods than its narrow facade types.
  const botGame = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game, "concrete Game with Bot and clone methods");
  return { game, botGame, bot };
}

test("Bot discovers and executes hand procedure after its normal summon is spent", async (t) => {
  const { game, botGame, bot } = setup();
  t.after(() => game.dispose());
  bot.summonCount = 1;
  bot.effectActivationRestrictions = [{
    blockedNames: ["Luminous God Hyperion"], allowedAttributes: [], restrictedCardFilters: {},
    duration: "turn", expiresOnTurn: null, reason: null, sourceName: null,
    sourceId: null, effectId: null,
  }];
  const actions = bot.generateMainPhaseActions(botGame).filter((entry) => entry.type === "handSummonProcedure");
  assert.equal(actions.length, 1);
  const action = actions[0];
  assert.equal(action?.type, "handSummonProcedure");
  assert.equal(bot.filterValidActionsForCurrentState(actions, botGame).length, 1);
  assert.equal(await bot.executeMainPhaseAction(botGame, action!), true);
  assert.equal(bot.summonCount, 1);
  assert.equal(bot.hand.length, 0);
  assert.equal(bot.field[0]?.lastSummonProcedure, "luminous_god_hyperion_special_summon");
  assert.equal(bot.banished.length, 5);
});

test("Bot selects a field material when the field is full and the cost can clear a slot", (t) => {
  const { game, botGame, bot } = setup();
  t.after(() => game.dispose());
  bot.field = Array.from({ length: 4 }, (_, index) => new Card({
    name: `Dark field ${index}`, cardKind: "monster", attribute: "Dark", level: 1, atk: 100, def: 100,
  }, bot.id));
  bot.field.push(new Card({ name: "Light field", cardKind: "monster", attribute: "Light", level: 1, atk: 100, def: 100 }, bot.id));
  const action = bot.generateMainPhaseActions(botGame).find((entry) => entry.type === "handSummonProcedure");
  assert.ok(action);
  assert.equal(action.materials.filter((hint) => hint.zone === "field").length, 1);
  const state = bot.cloneGameState(botGame);
  applyGenericSimulatedMainPhaseAction(state, action);
  assert.equal(state.bot.field.length, 5);
  assert.equal(state.bot.banished.length, 5);
  assert.equal(state.bot.field.some((card) => card.name === "Light field"), false);
});

test("Bot rejects a stale graveyard-only payment after the field fills", (t) => {
  const { game, botGame, bot } = setup();
  t.after(() => game.dispose());
  const action = bot.generateMainPhaseActions(botGame).find((entry) => entry.type === "handSummonProcedure");
  assert.ok(action);
  bot.field = Array.from({ length: 4 }, (_, index) => new Card({
    name: `Dark field ${index}`, cardKind: "monster", attribute: "Dark", level: 1, atk: 100, def: 100,
  }, bot.id));
  bot.field.push(new Card({ name: "Light field", cardKind: "monster", attribute: "Light", level: 1, atk: 100, def: 100 }, bot.id));
  assert.equal(bot.filterValidActionsForCurrentState([action], botGame).length, 0);
});

test("planner applies procedure cost and special summon without consuming normal summon", (t) => {
  const { game, botGame, bot } = setup();
  t.after(() => game.dispose());
  const action = bot.generateMainPhaseActions(botGame).find((entry) => entry.type === "handSummonProcedure");
  assert.ok(action);
  const state = bot.cloneGameState(botGame);
  state.bot.summonCount = 1;
  applyGenericSimulatedMainPhaseAction(state, action);
  assert.equal(state.bot.summonCount, 1);
  assert.equal(state.bot.field[0]?.lastSummonProcedure, "luminous_god_hyperion_special_summon");
  assert.equal(state.bot.field[0]?.lastSummonMethod, "special");
  assert.equal(state.bot.hand.length, 0);
  assert.equal(state.bot.graveyard.length, 0);
  assert.equal(state.bot.banished.length, 5);
});
