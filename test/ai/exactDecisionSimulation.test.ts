import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { appendSimulatedFieldCard } from "../../src/core/ai/common/zones.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { selectSimulatedTargets } from "../../src/core/ai/common/targetSelection.js";
import { applyGenericSimulatedMainPhaseAction, attachSimulatedEventEmitter, simulateGenericSpellEffect } from "../../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import type { SimulatedRuntimeState } from "../../src/core/ai/common/simulatedActions/shared.js";
import type { AIDecisionPlan } from "../../src/core/contracts/ai.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";

function scenario(actor: "player" | "bot" = "bot") {
  const player = (id: "player" | "bot") => ({ id, lp: 8000, hand: [], deck: [], field: [], graveyard: [],
    banished: [], extraDeck: [], spellTrap: [], fieldSpell: null, summonCount: 0, additionalNormalSummons: 0 });
  const state = unsafeFixture<SimulatedRuntimeState>({
    bot: player(actor), player: player(actor === "bot" ? "player" : "bot"),
    turn: actor, phase: "main1", turnCounter: 4, _isPerspectiveState: true,
  }, "Minimal planning graph retains physical owners in perspective slots");
  const copy = createPlanningCopy();
  const make = (id: number) => copy.cloneCardForSim(new Card(cardDefinition(id), actor));
  return { state, make };
}

test("exact target selection preserves instance identity over rank and name", () => {
  const { state, make } = scenario();
  const first = make(502), selected = make(502);
  for (const card of [first, selected]) appendSimulatedFieldCard(state.bot.field, card);
  const selections = selectSimulatedTargets({ state, targets: [{ id: "chosen", zone: "field", owner: "self", count: 1 }],
    options: { activationContext: { decisions: { selections: { chosen: [required(selected.instanceId)] } } } } });
  assert.deepEqual(selections.chosen, [selected]);
});

for (const invalid of ["absent", "duplicate", "wrong_zone", "wrong_count"] as const) {
  test(`exact target selection rejects ${invalid} without a same-name fallback`, () => {
    const { state, make } = scenario();
    const first = make(502), chosen = make(502);
    for (const card of [first]) appendSimulatedFieldCard(state.bot.field, card);
    (invalid === "wrong_zone" ? state.bot.graveyard : state.bot.field).push(chosen);
    const id = required(chosen.instanceId);
    const ids = invalid === "absent" ? ["stale"] : invalid === "duplicate" ? [id, id] : invalid === "wrong_count" ? [] : [id];
    const selections = selectSimulatedTargets({ state, targets: [{ id: "chosen", zone: "field", owner: "self", count: 1 }],
      options: { activationContext: { decisions: { selections: { chosen: ids } } } } });
    assert.deepEqual(selections.chosen, []);
    assert.ok(state._simUnsupportedActions?.includes("exact_selection:chosen"));
  });
}

test("exact case and target choose a legal decrease instead of the first case", () => {
  const { state, make } = scenario();
  const core = make(501), first = make(502), selected = make(502);
  for (const card of [core, first, selected]) appendSimulatedFieldCard(state.bot.field, card);
  const effect = required(core.effects?.find(item => item.id === "tech_zero_energy_core_level_mod"));
  applySimulatedActions({ state, actions: effect.actions, options: { sourceCard: core, effect,
    activationContext: { decisions: { cases: { tech_zero_energy_core_level_mod: "decrease" },
      selections: { tech_zero_energy_core_level_down_target: [required(selected.instanceId)] } } } } });
  assert.equal(selected.level, 2);
  assert.equal(first.level, 3);
  assert.equal(core.level, 1);
});

test("an invalid exact case cannot use the first available case", () => {
  const { state, make } = scenario();
  const core = make(501);
  for (const card of [core]) appendSimulatedFieldCard(state.bot.field, card);
  const effect = required(core.effects?.find(item => item.id === "tech_zero_energy_core_level_mod"));
  applySimulatedActions({ state, actions: effect.actions, options: { sourceCard: core, effect,
    activationContext: { decisions: { cases: { tech_zero_energy_core_level_mod: "decrease" } } } } });
  assert.equal(core.level, 1);
  assert.ok(state._simUnsupportedActions?.includes("exact_case:tech_zero_energy_core_level_mod"));
});

for (const count of [0, 1, 2, 3]) {
  test(`Portal follows an exact group of ${count} revivals`, () => {
    const { state, make } = scenario();
    const portal = make(509), multimodal = make(503), catapult = make(502), core = make(501);
    multimodal.properSummonEstablished = true;
    for (const card of [portal]) appendSimulatedFieldCard(state.bot.field, card);
    state.bot.graveyard.push(core, catapult, multimodal);
    const effect = required(portal.effects?.find(item => item.id === "tech_zero_summoning_portal_synchro_revive"));
    const chosen = [multimodal, catapult, core].slice(0, count);
    applySimulatedActions({ state, actions: effect.actions, options: { sourceCard: portal, effect,
      activationContext: { decisions: { specialSummons: { [required(effect.id)]: chosen.map(card => required(card.instanceId)) } } } } });
    assert.deepEqual(state.bot.field, [portal, ...chosen]);
    assert.equal(state.bot.specialSummonRestrictions?.length, 1);
  });
}

for (const invalid of ["missing", "duplicate", "same_name", "too_many"] as const) {
  test(`Portal rejects ${invalid} exact revival group as a whole`, () => {
    const { state, make } = scenario();
    const portal = make(509), first = make(502), second = make(502), core = make(501), wyvern = make(506);
    for (const card of [portal]) appendSimulatedFieldCard(state.bot.field, card);
    state.bot.graveyard.push(first, second, core, wyvern);
    const effect = required(portal.effects?.find(item => item.id === "tech_zero_summoning_portal_synchro_revive"));
    const id = required(first.instanceId);
    const ids = invalid === "missing" ? [id, "stale"] : invalid === "duplicate" ? [id, id]
      : invalid === "same_name" ? [id, required(second.instanceId)]
      : [id, required(second.instanceId), required(core.instanceId), required(wyvern.instanceId)];
    applySimulatedActions({ state, actions: effect.actions, options: { sourceCard: portal, effect,
      activationContext: { decisions: { specialSummons: { [required(effect.id)]: ids } } } } });
    assert.deepEqual(state.bot.field, [portal]);
    assert.equal(state.bot.specialSummonRestrictions?.length ?? 0, 0);
    assert.ok(state._simUnsupportedActions?.includes(`exact_special_summon:${effect.id}`));
  });
}

for (const seat of ["player", "bot"] as const) {
  for (const full of [false, true]) {
    test(`Portal simulates remaining planned instances with full=${full} (${seat})`, () => {
      const { state, make } = scenario(seat);
      const portal = make(509), missing = make(501), replacement = make(501), catapult = make(502);
      appendSimulatedFieldCard(state.bot.field, portal);
      if (full) for (const id of [504, 505, 507, 508]) appendSimulatedFieldCard(state.bot.field, make(id));
      state.bot.graveyard.push(replacement, catapult);
      const effect = required(portal.effects?.find(item => item.id === "tech_zero_summoning_portal_synchro_revive"));
      applySimulatedActions({ state, actions: effect.actions, options: { sourceCard: portal, effect,
        activationContext: { decisions: {
          specialSummons: { [required(effect.id)]: [required(missing.instanceId), required(catapult.instanceId)] },
          specialSummonRevalidation: { [required(effect.id)]: "remaining" },
        } } } });
      assert.equal(state.bot.field.includes(catapult), !full);
      assert.equal(state.bot.field.includes(replacement), false);
      assert.equal(state.bot.specialSummonRestrictions?.length, 1);
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }
}

test("remaining-instance revalidation cannot hide duplicate choices on a full field", () => {
  const { state, make } = scenario();
  const portal = make(509), core = make(501);
  for (const card of [portal, make(504), make(505), make(507), make(508)]) appendSimulatedFieldCard(state.bot.field, card);
  state.bot.graveyard.push(core);
  const effect = required(portal.effects?.find(item => item.id === "tech_zero_summoning_portal_synchro_revive"));
  applySimulatedActions({ state, actions: effect.actions, options: { sourceCard: portal, effect,
    activationContext: { decisions: {
      specialSummons: { [required(effect.id)]: [required(core.instanceId), required(core.instanceId)] },
      specialSummonRevalidation: { [required(effect.id)]: "remaining" },
    } } } });
  assert.ok(state._simUnsupportedActions?.includes(`exact_special_summon:${effect.id}`));
});

test("effect Synchro uses the exact destination, materials and position", () => {
  const { state, make } = scenario();
  const multimodal = make(503), phoenix = make(514), first = make(516), selected = make(516);
  for (const card of [multimodal, phoenix]) appendSimulatedFieldCard(state.bot.field, card);
  state.bot.extraDeck.push(first, selected);
  applySimulatedActions({ state, actions: [{ type: "synchro_summon_from_extra_deck" }], options: {
    activationContext: { decisions: { synchroSummons: { synchro_summon_from_extra_deck: {
      synchroInstanceId: required(selected.instanceId), materialInstanceIds: [required(multimodal.instanceId), required(phoenix.instanceId)], position: "defense",
    } } } } } });
  assert.deepEqual(state.bot.field, [selected]);
  assert.deepEqual(state.bot.extraDeck, [first]);
  assert.equal(selected.position, "defense");
});

test("stale effect Synchro choice cannot fall back to a legal namesake", () => {
  const { state, make } = scenario();
  const multimodal = make(503), phoenix = make(514), lancer = make(516);
  for (const card of [multimodal, phoenix]) appendSimulatedFieldCard(state.bot.field, card);
  state.bot.extraDeck.push(lancer);
  applySimulatedActions({ state, actions: [{ type: "synchro_summon_from_extra_deck" }], options: {
    activationContext: { decisions: { synchroSummons: { synchro_summon_from_extra_deck: {
      synchroInstanceId: required(lancer.instanceId), materialInstanceIds: [required(multimodal.instanceId), "stale"], position: "attack",
    } } } } } });
  assert.deepEqual(state.bot.field, [multimodal, phoenix]);
  assert.deepEqual(state.bot.extraDeck, [lancer]);
  assert.ok(state._simUnsupportedActions?.includes("exact_synchro_summon:synchro_summon_from_extra_deck"));
});

test("a spell forwards its effect ID when resolving exact summon decisions", () => {
  const { state, make } = scenario();
  const spell = make(520), first = make(502), selected = make(502);
  spell.effects = [{ id: "exact_spell_revival", timing: "on_play", actions: [
    { type: "special_summon_from_zone", zone: "graveyard", count: 1 },
  ] }];
  state.bot.graveyard.push(first, selected);
  simulateGenericSpellEffect(state, spell, { activationContext: { decisions: {
    specialSummons: { exact_spell_revival: [required(selected.instanceId)] },
  } } });
  assert.deepEqual(state.bot.field, [selected]);
  assert.deepEqual(state.bot.graveyard, [first]);
});

for (const stale of [false, true]) {
  test(`Prism search ${stale ? "rejects a stale destination" : "pays the exact tuner and adds the exact deck instance"}`, () => {
    const { state, make } = scenario();
    const prism = make(506), spared = make(501), cost = make(501), first = make(502), selected = make(502);
    state.bot.hand.push(prism, spared, cost);
    state.bot.deck.push(first, selected);
    applyGenericSimulatedMainPhaseAction(state, { type: "handIgnition", index: 0, cardId: 506,
      effectId: "tech_zero_prism_activator_monster_search", activationContext: { decisions: { selections: {
        tech_zero_prism_activator_discard_target: [required(cost.instanceId)],
        tech_zero_prism_activator_monster_search_selection: [stale ? "missing" : required(selected.instanceId)],
      } } } });
    assert.deepEqual(state.bot.graveyard, [prism, cost]);
    assert.deepEqual(state.bot.hand, stale ? [spared] : [spared, selected]);
    assert.deepEqual(state.bot.deck, stale ? [first, selected] : [first]);
    assert.deepEqual(state._simUnsupportedActions || [], stale
      ? ["exact_selection:tech_zero_prism_activator_monster_search_selection"] : []);
  });
}

for (const actor of ["player", "bot"] as const) {
  test(`event strategy decisions override the initiating action's decisions (${actor})`, () => {
    const { state, make } = scenario(actor);
    const core = make(501), selected = make(502);
    for (const card of [core, selected]) appendSimulatedFieldCard(state.bot.field, card);
    const decisions: AIDecisionPlan = { cases: { tech_zero_energy_core_level_mod: "decrease" },
      selections: { tech_zero_energy_core_level_down_target: [required(selected.instanceId)] } };
    const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true,
      activationContext: { decisions: { cases: { tech_zero_energy_core_level_mod: "increase" } } },
      strategy: { buildActivationContextForEffect: () => ({ decisions }) },
    });
    options.emitSimulatedEvent?.("after_summon", { card: core, player: state.bot, method: "special", fromZone: "hand" });
    assert.equal(selected.level, 2);
    assert.equal(core.level, 1);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });
}
