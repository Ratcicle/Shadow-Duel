import { greedySearchWithEvalV2 } from "../../src/core/ai/BeamSearch.js";
import { recordTurnCardActivation } from "../../src/core/game/events/activationHistory.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { cleanupTempBoosts } from "../../src/core/game/turn/cleanup.js";
import { cleanupSimulatedEndTurn } from "../../src/core/ai/common/simulatedActions/lifecycle.js";
import type { ActionOf } from "../../src/core/contracts/actions.js";
import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import ArcanistStrategy from "../../src/core/ai/ArcanistStrategy.js";
import { getEffectiveAtk, getEffectiveDef } from "../../src/core/ai/common/cardStats.js";
import { hasPendingPassiveRestoration, createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { refreshSimulatedFieldAuras, moveCardToZone } from "../../src/core/ai/common/zones.js";
import { simulateSpellEffect } from "../../src/core/ai/shadowheart/simulation.js";
import { simulateMainPhaseAction as simulateDragon } from "../../src/core/ai/dragon/simulation.js";
import { prepareLuminarchSimulatedBattle, applyLuminarchSimulatedBattleRewards } from "../../src/core/ai/luminarch/simulation.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import type { AIStrategyBotPort } from "../../src/core/contracts/ai.js";
import { simulationState } from "../helpers/simulation.js";
import { emitSimulatedSpellActivation, resolveSimulatedEndPhase } from "../../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { applyPassiveBuffValue, getFieldAuraBuffKey, getModeledPassiveContributions } from "../../src/core/effects/passives/passiveBuffs.js";
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

test("Sunforged stat growth is stored as its declared passive and reverses on detach", () => {
  const host = make("Luminarch Valiant - Knight of the Dawn");
  const blade = make("Luminarch Sunforged Blade");
  host.equips = [blade];
  blade.equippedTo = host;
  const state = simulationState({ bot: { field: [host], spellTrap: [blade] } });
  applyLuminarchSimulatedBattleRewards({ state, summary: { lpGains: [{ playerId: "bot", amount: 500 }] } });
  assert.equal(host.atk, required(host.baseAtk) + 200);
  assert.equal(host.def, required(host.baseDef) + 200);
  assert.deepEqual(getModeledPassiveContributions(host), [["luminarch_sunforged_blade_counter_buff", "equipped_counter_buff"]]);
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
  assert.equal(metal.atk, 1600, "departure clears all passive contributions as in runtime");
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

for (const seat of ["bot", "player"] as const) {
  for (const family of ["presence", "activations"] as const) {
    for (const factor of [0, 0.05, 0.5]) {
      for (const bonusBefore of [true, false]) {
        test(`B27 ${family} low stats factor=${factor} bonusBefore=${bonusBefore} (${seat})`, async t => {
          const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
          t.after(() => game.dispose("b27_three_families"));
          game.turnCounter = 3;
          const owner = game[seat], opponent = game[seat === "bot" ? "player" : "bot"];
          const target = new Card(cardDefinition(family === "presence" ? "Metal Armored Dragon" : "Elementalist Master Arcanist"), seat);
          placeFieldCards(owner.field, target);
          target.fieldPresenceId = "b27-counted-presence";
          target.fieldPresenceState = { summon_count_Dragon: 2 };
          target.tempAtkBoost = 101 - target.atk; target.atk = 101;
          target.tempDefBoost = 103 - target.def; target.def = 103;
          for (let i = 0; i < 2; i++) recordTurnCardActivation(game, {
            card: new Card(cardDefinition("Arcanist Ice Barrier"), seat), player: owner,
          });
          game.effectEngine.updatePassiveBuffs();
          const copy = createPlanningCopy(), simulated = copy.cloneCardForSim(target);
          const state = simulationState({ turnCounter: 3, [seat]: { field: [simulated] },
            cardActivationHistory: structuredClone(required(game.cardActivationHistory)) });
          const bonus: ActionOf<"buff_stats_temp"> = { type: "buff_stats_temp", targetRef: "target", atkBoost: 31, defBoost: 37, duration: "end_of_turn" };
          const half: ActionOf<"modify_stats_temp"> = { type: "modify_stats_temp", targetRef: "target", atkFactor: factor, defFactor: factor };
          for (const action of bonusBefore ? [bonus, half] : [half, bonus]) {
            await game.effectEngine.applyActions([action], { player: owner, opponent, source: target }, { target: [target] });
            game.effectEngine.updatePassiveBuffs();
            applySimulatedActions({ state, selfId: seat, actions: [action], selections: { target: [simulated] } });
            assert.deepEqual([simulated.atk, simulated.def, simulated.tempAtkBoost, simulated.tempDefBoost],
              [target.atk, target.def, target.tempAtkBoost, target.tempDefBoost]);
            assert.deepEqual(state._simUnsupportedActions || [], []);
          }
          game.cardActivationHistory = { turnCounter: game.turnCounter, entries: [] };
          cleanupTempBoosts(owner); game.effectEngine.updatePassiveBuffs();
          cleanupSimulatedEndTurn(state);
          assert.deepEqual([simulated.atk, simulated.def], [target.atk, target.def]);
          assert.equal(simulated.atk, target.baseAtk + (family === "presence" ? 200 : 0));
        });
      }
    }
  }
}

test("B27 presence producer uses the runtime fallback contribution key when effect ID is absent", () => {
  const metal = make("Metal Armored Dragon");
  metal.effects = unsafeFixture<NonNullable<typeof metal.effects>>([{ timing: "passive", passive: {
    type: "field_presence_type_summon_count_buff", typeName: "Dragon", amountPerCard: 100, stats: ["atk", "def"],
  } }], "Legacy partial effect deliberately omits its ID to exercise the runtime-compatible fallback contribution key");
  metal.fieldPresenceId = "fallback-presence";
  metal.fieldPresenceState = { summon_count_Dragon: 2 };
  const state = simulationState({ bot: { field: [metal] } });
  refreshSimulatedFieldPresenceTypeSummonBuffs(state);
  const key = `passive_${metal.id}_0_field_presence_type`;
  assert.equal(metal.dynamicBuffs?.[key]?.value, 200);
  applySimulatedActions({ state, actions: [{ type: "modify_stats_temp", targetRef: "target", atkFactor: 0, defFactor: 0 }],
    selections: { target: [metal] } });
  assert.deepEqual(state._simUnsupportedActions || [], []);
  cleanupSimulatedEndTurn(state);
  assert.deepEqual([metal.atk, metal.def], [1800, 2200]);
});

for (const seat of ["bot", "player"] as const) {
  for (const previouslyActive of [false, true]) {
    test(`B27 presence requireZone never grants proof outside its declared zone (${seat}, previouslyActive=${previouslyActive})`, t => {
      const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
      t.after(() => game.dispose("b27_presence_zone_guard"));
      const metal = new Card(cardDefinition("Metal Armored Dragon"), seat);
      const presenceEffect = required(metal.effects.find(effect => effect.id === "metal_armored_dragon_field_presence_buff"));
      metal.effects = [{ ...presenceEffect, requireZone: previouslyActive ? "field" : "spellTrap" }];
      placeFieldCards(game[seat].field, metal);
      metal.fieldPresenceId = "b27-zone-presence";
      metal.fieldPresenceState = { summon_count_Dragon: 2 };
      game.effectEngine.updatePassiveBuffs();
      const simulated = createPlanningCopy().cloneCardForSim(metal);
      const state = simulationState({ [seat]: { field: [simulated] } });
      if (previouslyActive) {
        assert.equal(metal.atk, 1800);
        assert.equal(getModeledPassiveContributions(simulated).length, 1);
        metal.effects = [{ ...presenceEffect, requireZone: "spellTrap" }];
        simulated.effects = [{ ...presenceEffect, requireZone: "spellTrap" }];
        game.effectEngine.updatePassiveBuffs();
      }
      refreshSimulatedFieldPresenceTypeSummonBuffs(state);
      refreshSimulatedFieldPresenceTypeSummonBuffs(state);
      assert.equal(metal.atk, 1600);
      assert.equal(simulated.atk, metal.atk);
      assert.equal(simulated.def, metal.def);
      assert.deepEqual(getModeledPassiveContributions(metal), []);
      assert.deepEqual(getModeledPassiveContributions(simulated), []);
      assert.equal(simulated.dynamicBuffs?.metal_armored_dragon_field_presence_buff, undefined);
      applySimulatedActions({ state, selfId: seat, actions: [{
        type: "modify_stats_temp", targetRef: "target", atkFactor: 0,
      }], selections: { target: [simulated] } });
      assert.equal(simulated.temporarySuppressedDynamicBuffStatsByKey, undefined);
      assert.deepEqual(getModeledPassiveContributions(simulated), []);
      cleanupSimulatedEndTurn(state);
      assert.equal(simulated.atk, 1600);
    });
  }
}

for (const seat of ["bot", "player"] as const) {
  for (const suppressBeforeNegation of [false, true]) {
    for (const removeNegation of [false, true]) {
      test(`B27 activation-count negation admits modeled restoration (${seat}, suppressionFirst=${suppressBeforeNegation}, remove=${removeNegation})`, () => {
        const target = make("Elementalist Master Arcanist");
        target.owner = seat;
        target.atk = 101;
        target.tempAtkBoost = 101 - required(target.baseAtk);
        const state = simulationState({ turnCounter: 3, [seat]: { field: [target] } });
        for (let i = 0; i < 2; i++) recordTurnCardActivation(state, {
          card: new Card(cardDefinition("Arcanist Ice Barrier"), seat), player: state[seat],
        });
        refreshSimulatedFieldAuras(state);
        const key = "elementalist_master_spell_buff";
        const reduce = () => applySimulatedActions({ state, selfId: seat, actions: [{
          type: "modify_stats_temp", targetRef: "target", atkFactor: 0,
        }], selections: { target: [target] } });
        assert.equal(target.atk, 301);
        assert.deepEqual(getModeledPassiveContributions(target), [[key, "activated_card_count_buff"]]);
        if (suppressBeforeNegation) reduce();
        applySimulatedActions({ state, selfId: seat, actions: [{ type: "add_status", targetRef: "target",
          status: "effectsNegated", duration: "until_end_turn" }], selections: { target: [target] } });
        assert.equal(target.atk, suppressBeforeNegation ? 0 : 101);
        assert.deepEqual(state._simUnsupportedActions || [], []);
        assert.equal(hasPendingPassiveRestoration(state), false);
        assert.deepEqual(getModeledPassiveContributions(target), suppressBeforeNegation ? [[key, "activated_card_count_buff"]] : []);
        if (removeNegation) {
          applySimulatedActions({ state, selfId: seat, actions: [{ type: "add_status", targetRef: "target",
            status: "effectsNegated", remove: true }], selections: { target: [target] } });
          assert.equal(target.atk, suppressBeforeNegation ? 0 : 301);
          assert.deepEqual(getModeledPassiveContributions(target), [[key, "activated_card_count_buff"]]);
        }
        if (!suppressBeforeNegation) reduce();
        assert.deepEqual(state._simUnsupportedActions || [], []);
        assert.equal(hasPendingPassiveRestoration(state), false);
        cleanupSimulatedEndTurn(state);
        assert.equal(target.atk, target.baseAtk);
        assert.equal(target.effectsNegated, false);
        assert.deepEqual(getModeledPassiveContributions(target), []);
      });
    }
  }
}

for (const seat of ["bot", "player"] as const) {
  test(`B27 negating an inactive activation-count source cannot mint proof (${seat})`, () => {
    const target = make("Elementalist Master Arcanist");
    const effect = required(target.effects?.find(entry => entry.id === "elementalist_master_spell_buff"));
    target.effects = [{ ...effect, requireZone: "spellTrap" }];
    const state = simulationState({ turnCounter: 3, [seat]: { field: [target] } });
    recordTurnCardActivation(state, { card: new Card(cardDefinition("Arcanist Ice Barrier"), seat), player: state[seat] });
    refreshSimulatedFieldAuras(state);
    assert.equal(target.atk, target.baseAtk);
    assert.deepEqual(getModeledPassiveContributions(target), []);
    for (const remove of [false, true]) {
      applySimulatedActions({ state, selfId: seat, actions: [{ type: "add_status", targetRef: "target",
        status: "effectsNegated", remove }], selections: { target: [target] } });
      assert.equal(target.atk, target.baseAtk);
      assert.deepEqual(getModeledPassiveContributions(target), []);
    }
    assert.deepEqual(state._simUnsupportedActions || [], []);
    target.temporarySuppressedDynamicBuffStatsByKey = { unknown: { atk: true } };
    assert.equal(hasPendingPassiveRestoration(state), true, "a modeled declaration never proves an unrelated key");
  });
}

for (const seat of ["bot", "player"] as const) {
  for (const family of ["fieldAura", "activations", "presence"] as const) {
    for (const active of [false, true]) {
      test(`B27 refresh cannot prove a preexisting unknown suppression (${seat}, ${family}, active=${active})`, async t => {
        const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
        t.after(() => game.dispose("b27_unproven_snapshot_refresh"));
        game.turnCounter = 3;
        const owner = game[seat];
        const target = new Card(cardDefinition(family === "fieldAura" ? "Shadow-Heart Scale Dragon"
          : family === "activations" ? "Elementalist Master Arcanist" : "Metal Armored Dragon"), seat);
        placeFieldCards(owner.field, target);
        target.fieldPresenceId = "unknown-snapshot-presence";
        target.fieldPresenceState = { summon_count_Dragon: 2 };
        const source = family === "fieldAura" ? new Card(cardDefinition("Darkness Valley"), seat) : target;
        if (family === "fieldAura") owner.fieldSpell = source;
        source.effectsNegated = !active;
        recordTurnCardActivation(game, { card: new Card(cardDefinition("Arcanist Ice Barrier"), seat), player: owner });
        const key = family === "fieldAura"
          ? getFieldAuraBuffKey(source, "darkness_valley_shadow_heart_aura", 0, -1, "atk")
          : family === "activations" ? "elementalist_master_spell_buff" : "metal_armored_dragon_field_presence_buff";
        // This fixture represents imported, already-suppressed data. No producer
        // has ever registered the origin of this suppression on this object.
        target.atk = 0;
        target.temporarySuppressedDynamicBuffStatsByKey = { [key]: { atk: true } };
        const copy = createPlanningCopy();
        const simulated = copy.cloneCardForSim(target);
        const state = simulationState({ turnCounter: 3, [seat]: {
          field: [simulated], fieldSpell: owner.fieldSpell ? copy.cloneCardForSim(owner.fieldSpell) : null,
        }, cardActivationHistory: structuredClone(required(game.cardActivationHistory)) });
        let plannerCalls = 0;
        const policy = {
          generateMainPhaseActions() { plannerCalls++; return []; },
          simulateMainPhaseAction() { plannerCalls++; },
          evaluateBoard() { plannerCalls++; return 0; },
        };
        assert.equal(hasPendingPassiveRestoration(state), true);
        assert.equal(await greedySearchWithEvalV2(state, policy), null);
        assert.equal(plannerCalls, 0);
        assert.deepEqual(getModeledPassiveContributions(target), []);
        assert.deepEqual(getModeledPassiveContributions(simulated), []);
        game.effectEngine.updatePassiveBuffs();
        assert.deepEqual(getModeledPassiveContributions(target), [], "runtime refresh must not certify inherited suppression");
        for (let pass = 0; pass < 2; pass++) {
          refreshSimulatedFieldAuras(state);
          assert.equal(simulated.atk, 0);
          assert.deepEqual(getModeledPassiveContributions(simulated), [], "simulation refresh must not certify inherited suppression");
          assert.equal(hasPendingPassiveRestoration(state), true);
          assert.equal(await greedySearchWithEvalV2(state, policy), null);
          assert.equal(plannerCalls, 0, "refresh must not open the planner gate for unproven suppression");
        }
        applySimulatedActions({ state, selfId: seat, actions: [{
          type: "modify_stats_temp", targetRef: "target", atkFactor: 0.5,
        }], selections: { target: [simulated] } });
        assert.deepEqual(state._simUnsupportedActions, ["modify_stats_temp:passive_recalculation"]);
        assert.equal(hasPendingPassiveRestoration(state), true);
      });
    }
  }
}
