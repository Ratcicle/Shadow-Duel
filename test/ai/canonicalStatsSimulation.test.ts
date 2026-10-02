import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import ArcanistStrategy from "../../src/core/ai/ArcanistStrategy.js";
import { getEffectiveAtk, getEffectiveDef } from "../../src/core/ai/common/cardStats.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { moveCardToZone } from "../../src/core/ai/common/zones.js";
import { simulateSpellEffect } from "../../src/core/ai/shadowheart/simulation.js";
import { simulateMainPhaseAction as simulateDragon } from "../../src/core/ai/dragon/simulation.js";
import { prepareLuminarchSimulatedBattle, applyLuminarchSimulatedBattleRewards } from "../../src/core/ai/luminarch/simulation.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import type { AIStrategyBotPort } from "../../src/core/contracts/ai.js";
import { simulationState } from "../helpers/simulation.js";
import { emitSimulatedSpellActivation, resolveSimulatedEndPhase } from "../../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { applyPassiveBuffValue } from "../../src/core/effects/passives/passiveBuffs.js";
import { appendSimulatedZoneCard, clearSimulatedFieldPosition, refreshSimulatedFieldPresenceTypeSummonBuffs } from "../../src/core/ai/common/zones.js";

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
  emitSimulatedSpellActivation(state, make("Arcanist Ice Barrier"));
  strategy.applySimulatedArcanistPassiveStats(state);
  strategy.applySimulatedArcanistPassiveStats(state);
  assert.equal(elementalist.atk, required(elementalist.baseAtk) + 600);
  assert.equal(target.atk, 0);
  assert.equal(target.def, 0);
  resolveSimulatedEndPhase(state);
  strategy.applySimulatedArcanistPassiveStats(state);
  assert.equal(elementalist.atk, elementalist.baseAtk);
  assert.equal(target.atk, 50);
  assert.equal(target.def, 50);
});

test("Shadow-Heart Rage applies its ATK and DEF once to canonical stats", () => {
  const dragon = make("Shadow-Heart Scale Dragon");
  const state = simulationState({ bot: { field: [dragon] } });
  simulateSpellEffect(state, make("Shadow-Heart Rage"));
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

for (const events of [false, true]) {
  for (const sourceSeat of ["bot", "player"] as const) {
    test(`Metal counts a completed opposing special summon with events=${events}, source=${sourceSeat}`, () => {
      const metal = make("Metal Armored Dragon");
      metal.owner = sourceSeat;
      metal.fieldPresenceId = "metal-presence";
      const incoming = make("Voltaic Dragon");
      const state = simulationState({ turnCounter: 3,
        [sourceSeat]: { field: [metal] },
        [sourceSeat === "bot" ? "player" : "bot"]: { hand: [incoming] } });
      const recipient = state[sourceSeat === "bot" ? "player" : "bot"];
      applySimulatedActions({ state, selfId: sourceSeat === "bot" ? "player" : "bot",
        actions: [{ type: "special_summon_from_zone", zone: "hand", targetRef: "incoming", position: "attack" }],
        selections: { incoming: [incoming] }, options: { enableSimulatedEvents: events,
          onAfterSpecialSummon: () => {
            assert.equal(metal.atk, 1700, "the completion facts and bonus precede summon callbacks");
          } } });
      assert.ok(recipient.field.includes(incoming));
      assert.equal(metal.fieldPresenceState?.summon_count_Dragon, 1);
      assert.equal(metal.atk, 1700);
      assert.equal(metal.def, 2100);
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }
}

test("Dragon hand effect updates Metal's shared summon count and current totals", () => {
  const metal = make("Metal Armored Dragon");
  metal.fieldPresenceId = "metal-presence";
  const voltaic = make("Voltaic Dragon");
  const state = simulationState({ turn: "bot", turnCounter: 3, phase: "main1",
    bot: { field: [metal], hand: [voltaic] } });
  simulateDragon(state, { type: "handIgnition", index: 0, effectId: "voltaic_dragon_special_summon" });
  assert.ok(state.bot.field.some(card => card.name === voltaic.name));
  assert.equal(metal.fieldPresenceState?.summon_count_Dragon, 1);
  assert.equal(metal.atk, 1700);
  assert.equal(metal.def, 2100);
});

test("presence-count contribution preserves other buffs through negation, face, control and departure", () => {
  const metal = make("Metal Armored Dragon");
  metal.effects = required(metal.effects).filter(effect => effect.id === "metal_armored_dragon_field_presence_buff");
  metal.fieldPresenceId = "metal-presence";
  metal.fieldPresenceState = { summon_count_Dragon: 2 };
  applyPassiveBuffValue(metal, "unrelated", 500, ["atk"]);
  const state = simulationState({ turnCounter: 3, bot: { field: [metal] } });
  const status = (remove: boolean) => applySimulatedActions({ state, selections: { target: [metal] },
    actions: [{ type: "add_status", targetRef: "target", status: "effectsNegated", ...(remove ? { remove: true } : {}) }] });
  refreshSimulatedFieldPresenceTypeSummonBuffs(state);
  refreshSimulatedFieldPresenceTypeSummonBuffs(state);
  assert.equal(metal.atk, 2300);
  assert.equal(metal.def, 2200);
  status(false);
  assert.equal(metal.atk, 2100);
  assert.equal(metal.fieldPresenceState.summon_count_Dragon, 2);
  status(true);
  assert.equal(metal.atk, 2300);
  applySimulatedActions({ state, selections: { target: [metal] },
    actions: [{ type: "set_facedown_defense", targetRef: "target" }] });
  assert.equal(metal.atk, 2100);
  assert.equal(metal.fieldPresenceState.summon_count_Dragon, 2);
  applySimulatedActions({ state, selections: { target: [metal] },
    actions: [{ type: "switch_position", targetRef: "target" }] });
  assert.equal(metal.atk, 2300);
  applySimulatedActions({ state, selfId: "player", selections: { target: [metal] },
    actions: [{ type: "take_control", targetRef: "target" }] });
  assert.ok(state.player.field.includes(metal));
  assert.equal(metal.fieldPresenceState.summon_count_Dragon, 2);
  assert.equal(metal.atk, 2300);
  assert.equal(moveCardToZone(state.player, metal, "hand", state.player, { state }), true);
  assert.equal(metal.fieldPresenceState, null);
  assert.equal(metal.atk, 2100, "departure removes only the presence-count contribution");
  assert.deepEqual(state._simUnsupportedActions || [], []);
});

for (const cleanup of ["position", "append"] as const) {
  test(`direct ${cleanup} cleanup removes only the presence-count stat contribution`, () => {
    const metal = make("Metal Armored Dragon");
    metal.fieldPresenceId = "metal-presence";
    metal.fieldPresenceState = { summon_count_Dragon: 2 };
    applyPassiveBuffValue(metal, "unrelated", 500, ["atk"]);
    const state = simulationState({ bot: { field: [metal] } });
    refreshSimulatedFieldPresenceTypeSummonBuffs(state);
    assert.equal(metal.atk, 2300);
    state.bot.field.splice(0, 1);
    if (cleanup === "position") clearSimulatedFieldPosition(metal);
    else appendSimulatedZoneCard(state.bot.graveyard, metal);
    assert.equal(metal.atk, 2100);
    assert.equal(metal.def, 2000);
    assert.equal(metal.fieldPresenceState, null);
    assert.equal(metal.dynamicBuffs?.unrelated?.value, 500);
    clearSimulatedFieldPosition(metal);
    assert.equal(metal.atk, 2100, "repeated cleanup is idempotent");
  });
}

test("presence-count face changes update canonical stats before position callbacks", () => {
  const metal = make("Metal Armored Dragon");
  metal.fieldPresenceId = "metal-presence";
  metal.fieldPresenceState = { summon_count_Dragon: 2 };
  const state = simulationState({ bot: { field: [metal] } });
  refreshSimulatedFieldPresenceTypeSummonBuffs(state);
  const observed: number[] = [];
  const options = { emitSimulatedEvent: (event: string) => {
    if (event === "position_change") observed.push(required(metal.atk));
  } };
  applySimulatedActions({ state, selections: { target: [metal] }, options,
    actions: [{ type: "set_facedown_defense", targetRef: "target" }] });
  applySimulatedActions({ state, selections: { target: [metal] }, options,
    actions: [{ type: "switch_position", targetRef: "target" }] });
  assert.deepEqual(observed, [1600, 1800]);
  assert.equal(metal.fieldPresenceState.summon_count_Dragon, 2);
});

test("the generic stat-negation action suppresses the presence-count bonus and retains its history", () => {
  const metal = make("Metal Armored Dragon");
  metal.fieldPresenceId = "metal-presence";
  metal.fieldPresenceState = { summon_count_Dragon: 2 };
  applyPassiveBuffValue(metal, "unrelated", 500, ["atk"]);
  const state = simulationState({ bot: { field: [metal] } });
  refreshSimulatedFieldPresenceTypeSummonBuffs(state);
  applySimulatedActions({ state, selections: { target: [metal] },
    actions: [{ type: "set_stats_to_zero_and_negate", targetRef: "target", setAtkToZero: false, setDefToZero: false }] });
  assert.equal(metal.atk, 2100);
  assert.equal(metal.def, 2000);
  assert.equal(metal.fieldPresenceState.summon_count_Dragon, 2);
  refreshSimulatedFieldPresenceTypeSummonBuffs(state);
  assert.equal(metal.atk, 2100);
});

for (const persistent of [false, true]) {
  test(`End cleanup reconciles Metal's presence bonus after negation expiry (persistent: ${persistent})`, () => {
    const metal = make("Metal Armored Dragon");
    metal.fieldPresenceId = "metal-presence";
    metal.fieldPresenceState = { summon_count_Dragon: 2 };
    applyPassiveBuffValue(metal, "unrelated", 500, ["atk"]);
    const state = simulationState({ turn: "bot", turnCounter: 3, bot: { field: [metal] } });
    refreshSimulatedFieldPresenceTypeSummonBuffs(state);
    assert.equal(metal.atk, 2300);
    applySimulatedActions({ state, selections: { target: [metal] },
      actions: [{ type: "add_status", targetRef: "target", status: "effectsNegated", duration: "until_end_turn" }] });
    if (persistent) {
      applySimulatedActions({ state, selections: { target: [metal] },
        actions: [{ type: "add_status", targetRef: "target", status: "effectsNegated", duration: "while_faceup" }] });
    }
    assert.equal(metal.atk, 2100);
    resolveSimulatedEndPhase(state);
    assert.equal(metal.effectsNegated, persistent);
    assert.equal(metal.fieldPresenceState.summon_count_Dragon, 2);
    assert.equal(metal.dynamicBuffs?.unrelated?.value, 500);
    assert.equal(metal.atk, persistent ? 2100 : 2300);
    assert.equal(metal.def, persistent ? 2000 : 2200);
    assert.deepEqual(metal.effectsNegationContributions?.map(entry => entry.duration), persistent ? ["while_faceup"] : []);
    resolveSimulatedEndPhase(state);
    assert.equal(metal.atk, persistent ? 2100 : 2300, "repeated cleanup must not duplicate the passive bonus");
  });
}
