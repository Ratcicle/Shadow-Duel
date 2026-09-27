import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import ArcanistStrategy from "../../src/core/ai/ArcanistStrategy.js";
import { getEffectiveAtk, getEffectiveDef } from "../../src/core/ai/common/cardStats.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { moveCardToZone } from "../../src/core/ai/common/zones.js";
import { buildShadowHeartSimulationOptions } from "../../src/core/ai/shadowheart/simulation.js";
import { simulateMainPhaseAction as simulateDragon } from "../../src/core/ai/dragon/simulation.js";
import { prepareLuminarchSimulatedBattle, applyLuminarchSimulatedBattleRewards } from "../../src/core/ai/luminarch/simulation.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import type { AIStrategyBotPort } from "../../src/core/contracts/ai.js";
import { simulationState } from "../helpers/simulation.js";

const make = (name: string) => createPlanningCopy().cloneCardForSim(new Card(cardDefinition(name), "bot"));

test("Arcanist simulated boosts update canonical totals and passive refresh stays idempotent", () => {
  const elementalist = make("Elementalist Master Arcanist");
  const azrath = make("Azrath, Corrupted Arcanist");
  const target = make("Tech-Zero Energy Core");
  target.atk = 50;
  target.def = 50;
  const state = simulationState({ bot: { field: [elementalist, azrath] }, player: { field: [target] } });
  const strategy = new ArcanistStrategy(unsafeFixture<AIStrategyBotPort>(null,
    "These stat simulation methods use the supplied state and do not access the strategy actor"));
  strategy.applySimulatedLightningLance(state, { type: "spell", index: 0,
    activationContext: { actionContext: { targetPreferences: { lightning_magic_lance_target: { preferredNames: [elementalist.name] } } } } });
  assert.equal(elementalist.atk, required(elementalist.baseAtk) + 500);
  assert.equal(getEffectiveAtk(elementalist), elementalist.atk);
  state._simArcanistSpellActivations = 1;
  strategy.applySimulatedArcanistPassiveStats(state);
  strategy.applySimulatedArcanistPassiveStats(state);
  assert.equal(elementalist.atk, required(elementalist.baseAtk) + 600);
  assert.equal(target.atk, 0);
  assert.equal(target.def, 0);
  state._simArcanistSpellActivations = 0;
  strategy.applySimulatedArcanistPassiveStats(state);
  assert.equal(elementalist.atk, required(elementalist.baseAtk) + 500);
  assert.equal(target.atk, 50);
  assert.equal(target.def, 50);
});

test("Shadow-Heart Rage applies its ATK and DEF once to canonical stats", () => {
  const dragon = make("Shadow-Heart Scale Dragon");
  const state = simulationState({ bot: { field: [dragon] } });
  buildShadowHeartSimulationOptions().onEffectActivated({ state, card: make("Shadow-Heart Rage") });
  assert.equal(dragon.atk, required(dragon.baseAtk) + 700);
  assert.equal(dragon.def, required(dragon.baseDef) + 700);
  assert.equal(getEffectiveAtk(dragon), dragon.atk);
  assert.equal(getEffectiveDef(dragon), dragon.def);
});

test("Darkness Dragon destruction reward updates its canonical ATK", () => {
  const darkness = make("Darkness Dragon");
  const state = simulationState({ bot: { hand: [darkness], field: [make("Grey Dragon"), make("Grey Dragon"), make("Grey Dragon")] } });
  simulateDragon(state, { type: "summon", index: 0 });
  const summoned = required(state.bot.field.find(card => card.name === darkness.name));
  assert.equal(state.bot.field.length, 1);
  assert.equal(summoned.atk, required(darkness.baseAtk) + 600);
  assert.equal(getEffectiveAtk(summoned), summoned.atk);
});

test("Luminarch Sickle boosts canonical stats without duplicate effective bonuses", () => {
  const attacker = make("Luminarch Valiant - Knight of the Dawn");
  const target = make("Grey Dragon");
  target.atk = required(attacker.atk) + 500;
  const state = simulationState({ bot: { field: [attacker], hand: [make("Luminarch Magic Sickle")] }, player: { field: [target] } });
  prepareLuminarchSimulatedBattle({ state, attacker, target, opponent: state.player });
  assert.equal(attacker.atk, required(attacker.baseAtk) + 1200);
  assert.equal(attacker.def, required(attacker.baseDef) + 1700);
  assert.equal(getEffectiveAtk(attacker), attacker.atk);
  assert.equal(getEffectiveDef(attacker), attacker.def);
  assert.equal(state.bot.hand.length, 0);
});

test("Sunforged stat growth is stored on its equip and reverses on detach", () => {
  const host = make("Luminarch Valiant - Knight of the Dawn");
  const blade = make("Luminarch Sunforged Blade");
  host.equips = [blade];
  blade.equippedTo = host;
  const state = simulationState({ bot: { field: [host], spellTrap: [blade] } });
  applyLuminarchSimulatedBattleRewards({ state, summary: { lpGains: [{ playerId: "bot", amount: 500 }] } });
  assert.equal(host.atk, required(host.baseAtk) + 200);
  assert.equal(host.def, required(host.baseDef) + 200);
  assert.equal(blade.equipAtkBonus, 200);
  assert.equal(blade.equipDefBonus, 200);
  assert.equal(getEffectiveAtk(host), host.atk);
  moveCardToZone(state.bot, blade, "graveyard");
  assert.equal(host.atk, host.baseAtk);
  assert.equal(host.def, host.baseDef);
});
