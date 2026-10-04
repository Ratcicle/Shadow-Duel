import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import BloomrotStrategy from "../../src/core/ai/BloomrotStrategy.js";
import { getStrategyFor } from "../../src/core/ai/StrategyRegistry.js";
import { getGenericCostlessHandSummonActions, getGenericHandSummonProcedureActions } from "../../src/core/ai/common/actionGeneration.js";
import { getCounterValue } from "../../src/core/ai/common/counters.js";
import { cloneBotGameState } from "../../src/core/bot/simulationBridge.js";
import type { AIStrategyBotPort } from "../../src/core/contracts/ai.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { placeFieldCards } from "../helpers/game.js";

function player(id: string): AIStrategyBotPort {
  return { id, lp: 8000, hand: [], field: [], graveyard: [], deck: [], extraDeck: [], banished: [], spellTrap: [], fieldSpell: null };
}

function fixture(id: 402 | 404 | 407 | 408, counters: number, withColony = false) {
  const actor = player("bot"), opponent = player("player");
  if (withColony) actor.fieldSpell = new Card(cardDefinition(410), actor.id);
  actor.hand.push(new Card(cardDefinition(id), actor.id), new Card(cardDefinition(id), actor.id));
  const recipient = new Card({ name: "Procedure counter recipient", cardKind: "monster", atk: 1000, def: 1000, level: 1 }, opponent.id);
  recipient.addCounter("spore", counters);
  placeFieldCards(opponent.field, recipient);
  if (id === 402) {
    const token = new Card({ name: "Bloomrot Token", cardKind: "monster", archetype: "Bloomrot", atk: 0, def: 0, level: 1 }, actor.id);
    token.isToken = true;
    placeFieldCards(actor.field, token);
  }
  const strategy = getStrategyFor("bloomrot", actor);
  assert.ok(strategy instanceof BloomrotStrategy);
  const bot = { ...actor, strategy, resolveOpponent: () => opponent };
  const game = { bot, player: opponent, turn: "bot", phase: "main1", turnCounter: 3 };
  return { bot, opponent, strategy, state: cloneBotGameState(bot, game) };
}

for (const [id, payment] of [[402, 0], [404, 2], [407, 3], [408, 4]] as const) {
  test(`registered Bloomrot plans ${id} as a hand procedure and preserves payment (${payment})`, () => {
    const { state, strategy, bot, opponent } = fixture(id, payment + 4);
    const actions = getStrategyFor("bloomrot", state.bot).generateMainPhaseActions(state);
    const procedure = required(actions.find(action => action.type === "handSummonProcedure" && action.cardId === id));
    assert.equal(actions.some(action => action.type === "handIgnition" && action.cardId === id), false);
    assert.equal(getGenericCostlessHandSummonActions(state).some(action => action.cardId === id), payment === 0);
    const initialHand = bot.hand.length;
    strategy.simulateMainPhaseAction(state, procedure);
    const summoned = required(state.bot.field.find(card => card.id === id));
    assert.equal(summoned.lastSummonProcedure, required(bot.hand[0]?.handSummonProcedure).id);
    assert.equal(summoned.summonedTurn, state.turnCounter);
    assert.equal(summoned.lastSummonedTurn, state.turnCounter);
    assert.equal(strategy.getPositionChangeActions(state, state.bot, state.player).some(action => action.cardId === id), false,
      "a projected Special Summon cannot change position in the same turn");
    const recipient = required([...state.player.field, ...state.player.graveyard].find(card => card.name === "Procedure counter recipient"));
    assert.equal(getCounterValue(recipient, "spore"), 4 + (id === 404 ? 1 : 0));
    assert.equal(state.bot.hand.length, initialHand - 1);
    assert.equal(state.bot.summonCount ?? 0, 0, "special procedures do not spend the Normal Summon");
    assert.deepEqual(state._simUnsupportedActions ?? [], []);
    if (id === 407) {
      state.player.field.push(required(fixture(407, 4).state.player.field[0]));
    }
    assert.equal(getGenericHandSummonProcedureActions(state).some(action => action.cardId === id), id === 402);
    assert.equal(bot.hand.length, initialHand, "planning never mutates the live hand");
    assert.equal(getCounterValue(required(opponent.field[0]), "spore"), payment + 4);
  });
}

for (const [id, payment] of [[404, 2], [407, 3], [408, 4]] as const) {
  test(`${id} projected procedure rejects insufficient or stale counters before mutating`, () => {
    const { state, strategy } = fixture(id, payment);
    const action = required(getGenericHandSummonProcedureActions(state).find(entry => entry.cardId === id));
    required(state.player.field[0]).counters?.set("spore", payment - 1);
    assert.equal(getGenericHandSummonProcedureActions(state).some(entry => entry.cardId === id), false);
    strategy.simulateMainPhaseAction(state, action);
    assert.equal(state.bot.hand.length, 2);
    assert.equal(state.bot.field.length, 0);
    assert.equal(getCounterValue(required(state.player.field[0]), "spore"), payment - 1);
  });
}

test("Rootling's projected procedure requires a Token and has no extra summon limit", () => {
  const { state, strategy } = fixture(402, 0);
  const action = required(getGenericHandSummonProcedureActions(state)[0]);
  strategy.simulateMainPhaseAction(state, action);
  strategy.simulateMainPhaseAction(state, required(getGenericHandSummonProcedureActions(state)[0]));
  assert.equal(state.bot.field.filter(card => card.id === 402).length, 2);
  const absent = fixture(402, 0).state;
  absent.bot.field = [];
  assert.equal(getGenericHandSummonProcedureActions(absent).length, 0);
});

test("counter procedures defer the Colony's single aggregate removal trigger until after the summon", () => {
  const { state, strategy } = fixture(408, 4, true);
  const action = required(getGenericHandSummonProcedureActions(state)[0]);
  strategy.simulateMainPhaseAction(state, action);
  assert.deepEqual(state.bot.field.map(card => card.name), ["Bloomrot Ancient Husk", "Bloomrot Token"]);
  assert.equal(getCounterValue(required(state.player.field[0]), "spore"), 0);
  assert.deepEqual(state._simUnsupportedActions ?? [], []);
});

test("a different counter type does not spuriously trigger Living Colony", () => {
  const { state, strategy } = fixture(408, 4, true);
  const source = required(state.bot.hand[0]), procedure = required(source.handSummonProcedure);
  source.handSummonProcedure = { ...procedure, counterCost: { ...required(procedure.counterCost), counterType: "charge" } };
  required(state.player.field[0]).counters?.set("charge", 4);
  const action = required(getGenericHandSummonProcedureActions(state)[0]);
  strategy.simulateMainPhaseAction(state, action);
  assert.deepEqual(state.bot.field.map(card => card.name), ["Bloomrot Ancient Husk"]);
  assert.equal(getCounterValue(required(state.player.field[0]), "charge"), 0);
  assert.equal(getCounterValue(required(state.player.field[0]), "spore"), 4);
});

test("generic counter cost defaults and hidden field cards are rejected conservatively", () => {
  const { state } = fixture(408, 4);
  const source = required(state.bot.hand[0]), procedure = required(source.handSummonProcedure);
  source.handSummonProcedure = { ...procedure, counterCost: { counterType: "spore", amount: 4 } };
  assert.equal(getGenericHandSummonProcedureActions(state).some(action => action.index === 0), false, "omitted scope is the actor's monster field");
  source.handSummonProcedure = { ...procedure };
  required(state.player.field[0]).isFacedown = true;
  assert.equal(getGenericHandSummonProcedureActions(state).some(action => action.cardId === 408), false, "face-down counters cannot pay the declared face-up cost");
});
