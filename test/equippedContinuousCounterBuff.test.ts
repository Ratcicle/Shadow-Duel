import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import BloomrotStrategy from "../src/core/ai/BloomrotStrategy.js";
import { getStrategyFor } from "../src/core/ai/StrategyRegistry.js";
import { cloneBotGameState } from "../src/core/bot/simulationBridge.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { cleanupSimulatedEndTurn } from "../src/core/ai/common/simulatedActions/lifecycle.js";
import { createPlanningCopy } from "../src/core/ai/common/planningCopy.js";
import { moveCardToZone, refreshSimulatedFieldAuras } from "../src/core/ai/common/zones.js";
import { simulationState } from "./helpers/simulation.js";
import type { AIStrategyBotPort } from "../src/core/contracts/ai.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

function armor(owner: string, statsOnly = false) {
  const definition = cardDefinition(413);
  return new Card({ ...definition, effects: (definition.effects || []).filter(effect => !statsOnly ||
    effect.id === "bloomrot_fungal_armor_equip" ||
    (effect.timing === "passive" && "passive" in effect && effect.passive?.type === "equipped_field_counter_buff")) }, owner);
}

test("continuous Equip tracks each fixed DEF contribution and excludes a face-down source or departed host", async t => {
  const { game, owner, target, equip } = runtime(t, "player");
  const second = armor(owner.id);
  owner.hand.push(second);
  for (const source of [equip, second]) {
    assert.equal((await game.tryActivateSpell(source, owner.hand.indexOf(source), {
      bloomrot_fungal_armor_equip_target: [target],
    }, { owner })).success, true);
  }
  assert.equal(target.def, 2500);
  equip.isFacedown = true;
  game.effectEngine.updatePassiveBuffs();
  assert.equal(target.def, 2000);
  equip.isFacedown = false;
  game.effectEngine.updatePassiveBuffs();
  assert.equal(target.def, 2500);
  await game.effectEngine.applyActions([{ type: "add_status", targetRef: "equip", status: "effectsNegated" }],
    { player: owner, source: target }, { equip: [second] });
  game.effectEngine.updatePassiveBuffs();
  assert.equal(target.def, 2000);
  await game.moveCard(target, owner, "hand", { fromZone: "field" });
  game.effectEngine.updatePassiveBuffs();
  assert.deepEqual([target.atk, target.def], [1200, 1500]);
  assert.equal(target.equips.length, 0);
});

function host(owner: string) {
  return new Card({ id: 999101, name: "Continuous Equip target", cardKind: "monster", type: "Plant",
    archetype: "Bloomrot", level: 4, atk: 1200, def: 1500, effects: [] }, owner);
}

function runtime(t: TestContext, ownerId: "player" | "bot") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false });
  t.after(() => game.dispose("continuous_equip_counter_test"));
  game.disablePresentationDelays = true;
  game.turn = ownerId;
  game.phase = "main1";
  game.turnCounter = 2;
  game.player.controllerType = game.bot.controllerType = "human";
  game.ui.showConfirmPrompt = async () => false;
  const owner = game[ownerId], opponent = game[ownerId === "player" ? "bot" : "player"];
  const target = host(owner.id), counterCarrier = host(opponent.id), equip = armor(owner.id);
  placeFieldCards(owner.field, target);
  placeFieldCards(opponent.field, counterCarrier);
  owner.hand.push(equip);
  return { game, owner, opponent, target, counterCarrier, equip };
}

for (const ownerId of ["player", "bot"] as const) {
  test(`continuous Equip keeps fixed DEF without counters and restores both bonuses after negation (${ownerId})`, async t => {
    const { game, owner, opponent, target, counterCarrier, equip } = runtime(t, ownerId);
    const activation = await game.tryActivateSpell(equip, 0, {
      bloomrot_fungal_armor_equip_target: [target],
    }, { owner });
    assert.equal(activation.success, true);
    assert.deepEqual([target.atk, target.def], [1200, 2000]);
    const context = { player: opponent, opponent: owner, source: counterCarrier };
    await game.effectEngine.applyActions([{ type: "add_counter", targetRef: "counter", counterType: "spore", amount: 3 }], context, { counter: [counterCarrier] });
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([target.atk, target.def], [1500, 2000]);
    await game.effectEngine.applyActions([{ type: "remove_counter", targetRef: "counter", counterType: "spore", amount: 1 }], context, { counter: [counterCarrier] });
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([target.atk, target.def], [1400, 2000]);
    await game.effectEngine.applyActions([{ type: "add_status", targetRef: "equip", status: "effectsNegated", duration: "until_end_turn" }], context, { equip: [equip] });
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([target.atk, target.def], [1200, 1500]);
    game.cleanupTempBoosts(owner);
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([target.atk, target.def], [1400, 2000]);
    await game.moveCard(equip, owner, "graveyard", { fromZone: "spellTrap" });
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([target.atk, target.def], [1200, 1500]);
  });
}

function player(id: string): AIStrategyBotPort {
  return { id, lp: 8000, hand: [], field: [], graveyard: [], deck: [], extraDeck: [], banished: [], spellTrap: [], fieldSpell: null };
}

test("registered Bloomrot simulation restores continuous Equip bonuses and clones preserve their accounting", () => {
  const actor = player("bot"), opponent = player("player");
  // Keep this projection regression on the stat rule; destruction replacement
  // recalculation has its own capability marker and belongs to another audit finding.
  actor.hand.push(armor(actor.id, true));
  placeFieldCards(actor.field, host(actor.id));
  placeFieldCards(opponent.field, host(opponent.id));
  const strategy = getStrategyFor("bloomrot", actor);
  assert.ok(strategy instanceof BloomrotStrategy);
  const bot = { ...actor, strategy, resolveOpponent: () => opponent };
  const state = cloneBotGameState(bot, { bot, player: opponent, turn: "bot", phase: "main1", turnCounter: 2 });
  strategy.simulateMainPhaseAction(state, { type: "spell", index: 0, cardName: "Bloomrot Fungal Armor" });
  const target = required(state.bot.field[0]), equip = required(state.bot.spellTrap[0]), counterCarrier = required(state.player.field[0]);
  assert.deepEqual([target.atk, target.def], [1200, 2000]);
  applySimulatedActions({ state, actions: [{ type: "add_counter", targetRef: "counter", counterType: "spore", amount: 3 }], selections: { counter: [counterCarrier] } });
  assert.deepEqual([target.atk, target.def], [1500, 2000]);
  applySimulatedActions({ state, actions: [{ type: "add_status", targetRef: "equip", status: "effectsNegated", duration: "until_end_turn" }], selections: { equip: [equip] } });
  assert.deepEqual([target.atk, target.def], [1200, 1500]);
  cleanupSimulatedEndTurn(state);
  assert.deepEqual([target.atk, target.def], [1500, 2000]);
  const copy = createPlanningCopy();
  const copiedTarget = copy.cloneCardForSim(target), copiedEquip = copy.cloneCardForSim(equip);
  const copied = simulationState({ bot: { field: [copiedTarget], spellTrap: [copiedEquip] },
    player: { field: [copy.cloneCardForSim(counterCarrier)] } });
  applySimulatedActions({ state: copied, actions: [{ type: "add_status", targetRef: "equip", status: "effectsNegated" }], selections: { equip: [copiedEquip] } });
  assert.deepEqual([copiedTarget.atk, copiedTarget.def], [1200, 1500]);
  assert.deepEqual([target.atk, target.def], [1500, 2000], "planning copies must not mutate their source");
  equip.isFacedown = true;
  refreshSimulatedFieldAuras(state);
  assert.deepEqual([target.atk, target.def], [1200, 1500]);
  equip.isFacedown = false;
  refreshSimulatedFieldAuras(state);
  assert.deepEqual([target.atk, target.def], [1500, 2000]);
  assert.equal(moveCardToZone(state.bot, target, "hand", state.bot, { state }), true);
  refreshSimulatedFieldAuras(state);
  assert.deepEqual([target.atk, target.def], [1200, 1500]);
  assert.deepEqual(state._simUnsupportedActions ?? [], []);
  assert.deepEqual(copied._simUnsupportedActions ?? [], []);
});
