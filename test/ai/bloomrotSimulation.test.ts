import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import BloomrotStrategy from "../../src/core/ai/BloomrotStrategy.js";
import { gameTreeSearch } from "../../src/core/ai/GameTreeSearch.js";
import { createGameTreeModels } from "../../src/core/ai/PlanningStrategies.js";
import { getStrategyFor } from "../../src/core/ai/StrategyRegistry.js";
import { getCounterValue } from "../../src/core/ai/common/counters.js";
import { cloneBotGameState } from "../../src/core/bot/simulationBridge.js";
import type { AIStrategyBotPort } from "../../src/core/contracts/ai.js";
import { cardDefinition, required } from "../helpers/fixtures.js";

function player(id: string): AIStrategyBotPort {
  return {
    id, lp: 8000, hand: [], field: [], graveyard: [], deck: [],
    extraDeck: [], banished: [], spellTrap: [], fieldSpell: null,
  };
}

function scenario(handNames: string[]) {
  const opponent = player("player");
  const actor = player("bot");
  actor.hand.push(...handNames.map(name => new Card(cardDefinition(name), "bot")));
  const strategy = getStrategyFor("bloomrot", actor);
  assert.ok(strategy instanceof BloomrotStrategy);
  const bot = { ...actor, strategy, resolveOpponent: () => opponent };
  const game = { bot, player: opponent, turn: "bot", phase: "main1", turnCounter: 2 };
  return { bot, opponent, strategy, game, clone: () => cloneBotGameState(bot, game) };
}

test("registered Bloomrot simulation summons Myco-Weaver and resolves its token event", () => {
  const fixture = scenario(["Bloomrot Myco-Weaver"]);
  const state = fixture.clone();
  fixture.strategy.simulateMainPhaseAction(state, { type: "summon", index: 0, cardName: "Bloomrot Myco-Weaver" });

  assert.deepEqual(state.bot.field.map(card => card.name), ["Bloomrot Myco-Weaver", "Bloomrot Token"]);
  assert.equal(state.bot.field[1]?.position, "defense");
  assert.equal(state.bot.hand.length, 0);
  assert.equal(state.bot.summonCount, 1);
  assert.deepEqual(state._simUnsupportedActions ?? [], []);
  assert.equal(fixture.bot.hand.length, 1);
  assert.equal(fixture.bot.field.length, 0);
});

test("registered Bloomrot simulation follows its summon with Rootling hand ignition", () => {
  const fixture = scenario(["Bloomrot Myco-Weaver", "Bloomrot Rootling"]);
  const state = fixture.clone();
  fixture.strategy.simulateMainPhaseAction(state, { type: "summon", index: 0, cardName: "Bloomrot Myco-Weaver" });
  fixture.strategy.simulateMainPhaseAction(state, {
    type: "handIgnition", index: 0, cardName: "Bloomrot Rootling", effectId: "bloomrot_rootling_special_summon_hand",
  });

  assert.deepEqual(state.bot.field.map(card => card.name), ["Bloomrot Myco-Weaver", "Bloomrot Token", "Bloomrot Rootling"]);
  assert.equal(state.bot.hand.length, 0);
  assert.equal(state.bot.summonCount, 1);
  assert.deepEqual(state._simUnsupportedActions ?? [], []);
});

test("registered Bloomrot simulation resolves Spore Cloud counters and temporary debuff", () => {
  const fixture = scenario(["Bloomrot Spore Cloud"]);
  fixture.opponent.field.push(new Card(cardDefinition("Bloomrot Myco-Weaver"), "player"));
  const state = fixture.clone();
  fixture.strategy.simulateMainPhaseAction(state, { type: "spell", index: 0, cardName: "Bloomrot Spore Cloud" });

  const target = required(state.player.field[0]);
  assert.equal(getCounterValue(target, "spore"), 2);
  assert.equal(target.atk, 900);
  assert.equal(target.def, 1200);
  assert.equal(state.bot.hand.length, 0);
  assert.equal(state.bot.graveyard[0]?.name, "Bloomrot Spore Cloud");
  assert.deepEqual(state._simUnsupportedActions ?? [], []);
});

test("registered Bloomrot simulation places Living Colony and consumes its ignition once per turn", () => {
  const fixture = scenario(["Bloomrot Living Colony"]);
  fixture.opponent.field.push(new Card(cardDefinition("Bloomrot Myco-Weaver"), "player"));
  const state = fixture.clone();
  fixture.strategy.simulateMainPhaseAction(state, { type: "spell", index: 0, cardName: "Bloomrot Living Colony" });
  assert.equal(state.bot.fieldSpell?.name, "Bloomrot Living Colony");
  assert.equal(state.bot.graveyard.length, 0);
  const action = { type: "fieldEffect", effectId: "bloomrot_living_colony_ignition_spore_counter" } as const;
  fixture.strategy.simulateMainPhaseAction(state, action);
  fixture.strategy.simulateMainPhaseAction(state, action);

  assert.equal(getCounterValue(required(state.player.field[0]), "spore"), 1);
  assert.deepEqual(state._simUnsupportedActions ?? [], []);
});

test("GameTree evaluates the real Spore Cloud effect through the registered Bloomrot strategy", () => {
  const fixture = scenario(["Bloomrot Spore Cloud"]);
  fixture.opponent.field.push(new Card(cardDefinition("Bloomrot Myco-Weaver"), "player"));
  const result = gameTreeSearch(fixture.game, fixture.strategy, fixture.bot, 1, createGameTreeModels(fixture.bot.id, [
    { id: fixture.bot.id, modelId: "bloomrot" },
    { id: fixture.opponent.id, modelId: null },
  ]));

  assert.equal(result.action?.type, "spell");
  assert.equal(result.action?.cardName, "Bloomrot Spore Cloud");
  // Root perspective: the opponent's remaining 900 ATK is worth -1.8,
  // offset by our spent spell in GY worth +0.3. Discount is unchanged.
  assert.equal(result.score, -1.5 * Math.pow(0.85, 3));
  assert.equal(fixture.bot.hand.length, 1);
  assert.equal(fixture.bot.graveyard.length, 0);
  assert.equal(fixture.opponent.field[0]?.atk, 1400);
  assert.equal(getCounterValue(required(fixture.opponent.field[0]), "spore"), 0);
});
