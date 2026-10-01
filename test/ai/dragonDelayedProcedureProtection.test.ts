import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import DragonStrategy from "../../src/core/ai/DragonStrategy.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { cleanupExpiredSimulatedTurnEffects, processSimulatedDelayedActions } from "../../src/core/ai/common/simulatedActions/lifecycle.js";
import { moveCardToZone } from "../../src/core/ai/common/zones.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import type { AiLiveGamePort } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function setup(t: TestContext) {
  const bot = new Bot();
  const game = createRuntimeGame({ opponentOverride: bot, disableChains: true, randomSeed: 1 });
  t.after(() => game.dispose());
  game.phase = "main1";
  game.turn = bot.id;
  game.turnCounter = 4;
  const botGame = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game,
    "Concrete Game with Bot supplies the attached planning and validation methods");
  const make = (id: number) => new Card(cardDefinition(id), bot.id);
  return { bot, game, botGame, make };
}

test("common planner consumes the procedure name limit across Purified copies", t => {
  const { bot, botGame, make } = setup(t);
  const first = make(264), second = make(264);
  bot.hand.push(first, second);
  bot.graveyard.push(...Array.from({ length: 6 }, () => make(255)));
  const actions = bot.generateMainPhaseActions(botGame).filter(action => action.type === "handSummonProcedure");
  assert.equal(actions.length, 2);
  const state = bot.cloneGameState(botGame);
  applyGenericSimulatedMainPhaseAction(state, required(actions[0]));
  const secondAction = { ...required(actions[1]), materials: state.bot.graveyard.map((card, index) => {
    const instanceId = card.instanceId;
    assert.ok(typeof instanceId === "number");
    return { zone: "graveyard" as const, index, cardId: required(card.id), instanceId };
  }) };
  applyGenericSimulatedMainPhaseAction(state, secondAction);
  assert.equal(state.bot.field.length, 1);
  assert.equal(state.bot.hand.length, 1);
  assert.equal(state.bot.graveyard.length, 3);
  assert.equal(bot.graveyard.length, 6, "planning must not consume the live cards");
});

test("Bot discovery and cloned plans retain a procedure limit consumed in the live duel", async t => {
  const { bot, game, botGame, make } = setup(t);
  const first = make(264), second = make(264);
  bot.hand.push(first, second);
  bot.graveyard.push(...Array.from({ length: 6 }, () => make(255)));
  const before = bot.generateMainPhaseActions(botGame).filter(action => action.type === "handSummonProcedure");
  assert.equal((await game.performHandSummonProcedure(first, bot, { materials: bot.graveyard.slice(0, 3), position: "attack" })).success, true);
  assert.deepEqual(bot.generateMainPhaseActions(botGame).filter(action => action.type === "handSummonProcedure"), []);
  const state = bot.cloneGameState(botGame);
  applyGenericSimulatedMainPhaseAction(state, { ...required(before[1]), index: 0,
    materials: state.bot.graveyard.map((card, index) => {
      const instanceId = card.instanceId;
      assert.ok(typeof instanceId === "number");
      return { zone: "graveyard" as const, index, cardId: required(card.id), instanceId };
    }) });
  assert.equal(state.bot.hand.length, 1);
  assert.equal(state.bot.graveyard.length, 3);
});

test("simulated delayed summons reject a graveyard card that left and returned", t => {
  const { bot, botGame, make } = setup(t);
  bot.graveyard.push(make(257));
  const state = bot.cloneGameState(botGame);
  const card = required(state.bot.graveyard[0]);
  applySimulatedActions({ state, actions: [{ type: "schedule_special_summon", cardRef: "self", fromZone: "graveyard", phase: "end", triggerPlayer: "current" }], options: { sourceCard: card } });
  assert.equal(state.delayedActions?.length, 1);
  assert.equal(moveCardToZone(state.bot, card, "banished", state.bot, { state }), true);
  assert.equal(moveCardToZone(state.bot, card, "graveyard", state.bot, { state }), true);
  processSimulatedDelayedActions(state, "end", bot.id);
  assert.ok(state.bot.graveyard.includes(card));
  assert.equal(state.delayedActions?.length, 0);
});

test("simulated Rainbow protection is removed when the protected target leaves field", t => {
  const { bot, botGame, make } = setup(t);
  const source = make(267), target = make(257);
  placeFieldCards(bot.field, source, target);
  const state = bot.cloneGameState(botGame);
  const simulatedSource = required(state.bot.field[0]), simulatedTarget = required(state.bot.field[1]);
  const effect = required(source.effects.find(entry => entry.id === "rainbow_cosmic_dragon_protect_dragon"));
  applySimulatedActions({ state, actions: required(effect.actions), selections: { rainbow_cosmic_protection_target: [simulatedTarget] },
    options: { sourceCard: simulatedSource, effect } });
  assert.equal(simulatedTarget.protectionEffects?.length, 2);
  moveCardToZone(state.bot, simulatedTarget, "hand", state.bot, { state });
  moveCardToZone(state.bot, simulatedTarget, "field", state.bot, { state });
  assert.deepEqual(simulatedTarget.protectionEffects, []);
});

test("Dragon planner consumes Purified procedure use without recording an effect activation", t => {
  const { bot, botGame, make } = setup(t);
  const strategy = new DragonStrategy(bot);
  const first = make(264), second = make(264);
  bot.hand.push(first, second);
  bot.graveyard.push(...Array.from({ length: 6 }, () => make(255)));
  const actions = bot.generateMainPhaseActions(botGame).filter(action => action.type === "handSummonProcedure");
  const state = bot.cloneGameState(botGame);
  strategy.simulateMainPhaseAction(state, required(actions[0]));
  strategy.simulateMainPhaseAction(state, { ...required(actions[1]), index: 0,
    materials: state.bot.graveyard.map((card, index) => {
      const instanceId = card.instanceId;
      assert.ok(typeof instanceId === "number");
      return { zone: "graveyard" as const, index, cardId: required(card.id), instanceId };
    }) });
  assert.equal(state.bot.field.length, 1);
  assert.equal(state.bot.graveyard.length, 3);
  assert.equal(state.bot._simMaterialEffectActivationsByMaterialId, undefined);
});

test("Dragon planner schedules Abyssal's two exact presences and delayed fusion-target bonus", t => {
  const { bot, game, botGame, make } = setup(t);
  const strategy = new DragonStrategy(bot);
  const source = make(263), target = new Card(cardDefinition(265), game.player.id);
  target.properSummonEstablished = true;
  target.properSummonProcedure = "fusion";
  placeFieldCards(bot.field, source);
  placeFieldCards(game.player.field, target);
  const state = bot.cloneGameState(botGame);
  strategy.simulateMainPhaseAction(state, { type: "monsterEffect", fieldIndex: 0, cardId: 263,
    effectId: "abyssal_serpent_delayed_summon_effect" });
  assert.equal(state.delayedActions?.length, 1);
  state.turnCounter = 5;
  processSimulatedDelayedActions(state, "standby", game.player.id);
  assert.equal(state.bot.field[0]?.id, 263);
  assert.equal(state.player.field[0]?.id, 265);
  assert.equal(state.bot.field[0]?.atk, 3000);
  assert.equal(state.bot.field[0]?.turnBasedBuffs?.[0]?.expiresOnTurn, 6);
  state.turnCounter = 7;
  cleanupExpiredSimulatedTurnEffects(state);
  assert.equal(state.bot.field[0]?.atk, 2200);
});

test("Dragon planner returns stolen Abyssal cards to their physical owners and rejects a new graveyard presence", t => {
  const { bot, game, botGame } = setup(t);
  const strategy = new DragonStrategy(bot);
  const source = new Card(cardDefinition(263), game.player.id);
  const target = new Card(cardDefinition(257), bot.id);
  placeFieldCards(bot.field, source);
  placeFieldCards(game.player.field, target);
  const state = bot.cloneGameState(botGame);
  strategy.simulateMainPhaseAction(state, { type: "monsterEffect", fieldIndex: 0, cardId: 263,
    effectId: "abyssal_serpent_delayed_summon_effect" });
  const scheduled = required(state.delayedActions?.[0]);
  assert.equal(scheduled.actionType, "delayed_summon");
  if (scheduled.actionType !== "delayed_summon") return;
  assert.deepEqual(scheduled.payload.summons.map(entry => entry.owner), [game.player.id, bot.id]);
  const movedTarget = required(state.bot.graveyard[0]);
  moveCardToZone(state.bot, movedTarget, "banished", state.bot, { state });
  moveCardToZone(state.bot, movedTarget, "graveyard", state.bot, { state });
  processSimulatedDelayedActions(state, "standby", game.player.id);
  assert.equal(state.player.field[0]?.id, 263);
  assert.equal(state.bot.field.length, 0);
  assert.ok(state.bot.graveyard.includes(movedTarget));
});

test("Dragon planner does not schedule Abyssal's presence when Galaxy redirects it away from the graveyard", t => {
  const { bot, game, botGame, make } = setup(t);
  const strategy = new DragonStrategy(bot);
  const source = make(263), galaxy = new Card(cardDefinition(273), game.player.id);
  placeFieldCards(bot.field, source);
  placeFieldCards(game.player.field, galaxy);
  const state = bot.cloneGameState(botGame);
  strategy.simulateMainPhaseAction(state, { type: "monsterEffect", fieldIndex: 0, cardId: 263,
    effectId: "abyssal_serpent_delayed_summon_effect" });
  const scheduled = required(state.delayedActions?.[0]);
  assert.equal(scheduled.actionType, "delayed_summon");
  if (scheduled.actionType !== "delayed_summon") return;
  assert.deepEqual(scheduled.payload.summons.map(entry => entry.card.id), [273]);
  assert.equal(state.bot.banished[0]?.id, 263);
});

test("Dragon planner grants Rainbow protection with the shared expiry and departure rules", t => {
  const { bot, botGame, make } = setup(t);
  const strategy = new DragonStrategy(bot);
  const source = make(267), target = make(257);
  target.atk = 4500;
  placeFieldCards(bot.field, source, target);
  const state = bot.cloneGameState(botGame);
  strategy.simulateMainPhaseAction(state, { type: "monsterEffect", fieldIndex: 0, cardId: 267,
    effectId: "rainbow_cosmic_dragon_protect_dragon" });
  const protectedCard = required(state.bot.field.find(card => card.protectionEffects?.length));
  assert.equal(protectedCard.protectionEffects?.length, 2);
  assert.ok(protectedCard.protectionEffects?.every(entry => entry.expiresOnTurn === 5 && entry.removeOnLeave === true));
  moveCardToZone(state.bot, protectedCard, "hand", state.bot, { state });
  moveCardToZone(state.bot, protectedCard, "field", state.bot, { state });
  assert.deepEqual(protectedCard.protectionEffects, []);
});
