import assert from "node:assert/strict";
import test from "node:test";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { simulationCard, simulationState, placeSimulationCards } from "../helpers/simulation.js";
import { captureSimulatedReferences } from "../../src/core/ai/common/simulatedActions/shared.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { attachSimulatedEventEmitter } from "../../src/core/ai/common/simulation.js";
import { getCounterValue } from "../../src/core/ai/common/counters.js";
import { moveCardToZone } from "../../src/core/ai/common/zones.js";

for (const seat of ["player", "bot"] as const) {
  for (const spores of [0, 1]) {
    test(`simulated Rot-Stag ${seat} preflights its actual nested Spore filter at ${spores}`, () => {
      const state = simulationState(), owner = state[seat], opponent = state[seat === "player" ? "bot" : "player"];
      const definition = cardDefinition(404), effect = required(definition.effects?.find(candidate => candidate.id.endsWith("attack_spore_boost")));
      const source = simulationCard({ ...definition, instanceId: 40401, owner: owner.id });
      const card = simulationCard({ ...cardDefinition(1), effects: [], instanceId: 101, owner: opponent.id, counters: new Map([["spore", spores]]) });
      placeSimulationCards(owner.field, source); placeSimulationCards(opponent.field, card);
      const selections = { bloomrot_rot_stag_battle_target: [card] };
      const references = captureSimulatedReferences(effect, selections, owner, opponent);
      const result = applySimulatedActions({ state, selfId: seat, actions: effect.actions, selections,
        options: { sourceCard: source, effect, referenceSnapshots: references } });
      assert.equal(result, spores === 1);
      assert.deepEqual(state._simUnsupportedActions || [], []);
      assert.equal(source.atk, Number(definition.atk) + (spores === 1 ? 500 : 0));
      assert.equal(source.def, definition.def);
      assert.equal(source.tempAtkBoost || 0, spores === 1 ? 500 : 0);
      const buffs = state.damageCalculationTempBuffs || [];
      assert.equal(buffs.length, spores === 1 ? 1 : 0);
      if (spores === 1) {
        const buff = required(buffs[0]);
        assert.equal(buff.card, source, "cleanup binds the same physical battle participant");
        assert.equal(buff.atk, 500);
        assert.equal(buff.def || 0, 0);
      }
    });
  }
  for (const protection of ["target", "effect"] as const) {
    test(`simulated Germination ${seat} preserves the runtime failure boundary with ${protection} immunity`, () => {
      const state = simulationState(), owner = state[seat], opponent = state[seat === "player" ? "bot" : "player"];
      const definition = cardDefinition(416), effect = required(definition.effects?.[0]);
      const source = simulationCard({ ...definition, instanceId: 41601, owner: owner.id });
      const attacker = simulationCard({ ...cardDefinition(1), effects: [], instanceId: 101, owner: opponent.id });
      placeSimulationCards(owner.spellTrap, source); placeSimulationCards(opponent.field, attacker);
      if (protection === "target") Object.assign(attacker, { cannotBeTargeted: true });
      else attacker.unaffectedByOtherCardEffects = true;
      const selections = { bloomrot_sudden_germination_attacker: [attacker] };
      assert.equal(applySimulatedActions({ state, selfId: seat, actions: effect.actions, selections,
        options: { sourceCard: source, effect, referenceSnapshots: captureSimulatedReferences(effect, selections, owner, opponent) } }), false);
      assert.equal(getCounterValue(attacker, "spore"), protection === "target" ? 1 : 0);
      assert.equal(owner.field.filter(card => card.name === "Bloomrot Token").length, protection === "target" ? 1 : 0);
      assert.deepEqual(state._simUnsupportedActions || [], protection === "target" ? ["negate_attack"] : []);
    });
  }
  test(`contextual preflight ${seat} does not impose new presence after a batch begins`, () => {
    const state = simulationState(), owner = state[seat], opponent = state[seat === "player" ? "bot" : "player"];
    const definition = cardDefinition(416), effect = required(definition.effects?.[0]);
    const source = simulationCard({ ...definition, instanceId: 41601, owner: owner.id });
    const attacker = simulationCard({ ...cardDefinition(1), effects: [], instanceId: 101, owner: opponent.id });
    placeSimulationCards(owner.spellTrap, source); placeSimulationCards(opponent.field, attacker);
    const selections = { bloomrot_sudden_germination_attacker: [attacker] };
    const drawn = simulationCard({ ...cardDefinition(1), effects: [], instanceId: 303, owner: owner.id });
    owner.deck.push(drawn);
    const token = required(required(effect.actions).find(action => action.type === "special_summon_token"));
    const result = applySimulatedActions({ state, selfId: seat, selections,
      actions: [{ type: "special_summon_token", player: "self", position: "defense", token: required(token.token) },
        { type: "conditional_actions", actions: [{ type: "draw", amount: 1, player: "self" }] }],
      options: { sourceCard: source, effect, referenceSnapshots: captureSimulatedReferences(effect, selections, owner, opponent),
        emitSimulatedEvent: name => { if (name === "after_summon") assert.equal(moveCardToZone(opponent, attacker, "hand"), true); } } });
    assert.equal(result, true);
    assert.equal(owner.field.filter(card => card.name === "Bloomrot Token").length, 1);
    assert.ok(opponent.hand.includes(attacker));
    assert.equal(owner.hand.length, 1, "the nested continuation draws after the initial reference leaves");
    assert.equal(owner.deck.length, 0);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });
  for (const scope of ["effect", "source"] as const) {
    test(`contextual preflight ${seat} cannot be reused by a different ${scope}`, () => {
      const state = simulationState(), owner = state[seat], opponent = state[seat === "player" ? "bot" : "player"];
      const definition = cardDefinition(416), effect = required(definition.effects?.[0]);
      const source = simulationCard({ ...definition, instanceId: 41601, owner: owner.id });
      const other = simulationCard({ ...definition, instanceId: 41602, owner: owner.id });
      placeSimulationCards(owner.spellTrap, source, other);
      const result = applySimulatedActions({ state, selfId: seat, actions: effect.actions,
        options: { sourceCard: source, effect, referenceSnapshots: {}, _contextualReferencePreflight: {
          effect: scope === "effect" ? { ...effect } : effect, source: scope === "source" ? other : source } } });
      assert.equal(result, false); assert.equal(owner.field.length, 0);
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }
  for (const change of ["intact", "version", "missing", "filters"] as const) {
    test(`simulated Germination ${seat} preflights the required ${change} reference before all supported actions`, () => {
      const state = simulationState(), owner = state[seat], opponent = state[seat === "player" ? "bot" : "player"];
      const definition = cardDefinition(416), effect = required(definition.effects?.[0]);
      const source = simulationCard({ ...definition, instanceId: 41601, owner: owner.id });
      const attacker = simulationCard({ ...cardDefinition(1), effects: [], instanceId: 101, owner: opponent.id });
      placeSimulationCards(owner.spellTrap, source); placeSimulationCards(opponent.field, attacker);
      const selections = { bloomrot_sudden_germination_attacker: [attacker] };
      const references = captureSimulatedReferences(effect, selections, owner, opponent);
      if (change === "version") attacker.locationVersion = 1;
      if (change === "filters") attacker.cardKind = "spell";
      const result = applySimulatedActions({ state, selfId: seat, actions: effect.actions, selections,
        options: { sourceCard: source, effect, referenceSnapshots: change === "missing" ? {} : references } });
      const valid = change === "intact";
      assert.equal(result, false, "the intact reference proceeds to the later required condition; absent Colony fails there");
      assert.equal(getCounterValue(attacker, "spore"), valid ? 1 : 0);
      assert.equal(owner.field.filter(card => card.name === "Bloomrot Token").length, valid ? 1 : 0);
      assert.deepEqual(state._simUnsupportedActions || [], valid ? ["negate_attack"] : []);
    });
  }
  for (const change of ["identity", "controller", "face", "version", "missing"] as const) {
    test(`simulated Bloomrot ${seat} refuses ${change} reference without recapture`, () => {
      const state = simulationState(); const owner = state[seat], opponent = state[seat === "player" ? "bot" : "player"];
      const definition = cardDefinition(417);
      const effect = required(definition.effects?.find(candidate => candidate.id.endsWith("summon_spore_counter")));
      const source = simulationCard({ ...definition, effects: [effect], instanceId: 41701, owner: owner.id });
      const card = simulationCard({ ...cardDefinition(1), effects: [], instanceId: 101, owner: opponent.id });
      placeSimulationCards(owner.spellTrap, source); placeSimulationCards(opponent.field, card);
      const selections = { bloomrot_rotting_ground_summoned_monster: [card] };
      const referenceSnapshots = captureSimulatedReferences(effect, selections, owner, opponent);
      if (change === "identity") card.instanceId = 102;
      if (change === "controller") card.controller = owner.id;
      if (change === "face") card.isFacedown = true;
      if (change === "version") card.locationVersion = 1;
      applySimulatedActions({ state, selfId: seat, actions: effect.actions, selections,
        options: { sourceCard: source, effect, referenceSnapshots: change === "missing" ? {} : referenceSnapshots } });
      assert.equal(getCounterValue(card, "spore"), 0);
    });
  }
  test(`simulated Overgrowth ${seat} freezes host before a preceding trigger policy mutates the binding`, () => {
    const state = simulationState({ turn: seat, phase: "standby", turnCounter: 3 });
    const owner = state[seat], opponent = state[seat === "player" ? "bot" : "player"];
    const definition = cardDefinition(415), effect = required(definition.effects?.find(candidate => candidate.id.endsWith("standby_spore_counter")));
    const source = simulationCard({ ...definition, effects: [effect], instanceId: 41501, owner: owner.id });
    const first = simulationCard({ ...cardDefinition(1), effects: [], instanceId: 101, owner: opponent.id });
    const replacement = simulationCard({ ...cardDefinition(1), effects: [], instanceId: 102, owner: opponent.id });
    const preceding = simulationCard({ ...cardDefinition(1), instanceId: 103, owner: owner.id,
      effects: [{ id: "optional_policy_probe", timing: "on_event", event: "standby_phase", triggerRequirement: "optional", triggerTiming: "if", actions: [{ type: "draw", amount: 0 }] }] });
    placeSimulationCards(owner.field, preceding); placeSimulationCards(owner.spellTrap, source);
    placeSimulationCards(opponent.field, first, replacement); source.equippedTo = first;
    const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true, shouldActivateEffect: () => { source.equippedTo = replacement; return false; } });
    required(options.emitSimulatedEvent)("standby_phase", { player: owner, opponent });
    assert.equal(getCounterValue(first, "spore"), 1);
    assert.equal(getCounterValue(replacement, "spore"), 0);
  });
  for (const protection of ["target", "effect"] as const) {
    test(`simulated reference ${seat} respects ${protection} immunity at resolution`, () => {
      const state = simulationState(); const owner = state[seat], opponent = state[seat === "player" ? "bot" : "player"];
      const definition = cardDefinition(417), effect = required(definition.effects?.find(candidate => candidate.id.endsWith("summon_spore_counter")));
      const source = simulationCard({ ...definition, effects: [effect], instanceId: 41701, owner: owner.id });
      const card = simulationCard({ ...cardDefinition(1), effects: [], instanceId: 101, owner: opponent.id });
      placeSimulationCards(owner.spellTrap, source); placeSimulationCards(opponent.field, card);
      if (protection === "target") Object.assign(card, { cannotBeTargeted: true });
      else card.unaffectedByOtherCardEffects = true;
      applySimulatedActions({ state, selfId: seat, actions: effect.actions, selections: { bloomrot_rotting_ground_summoned_monster: [card] }, options: { sourceCard: source, effect } });
      assert.equal(getCounterValue(card, "spore"), protection === "target" ? 1 : 0);
    });
  }
}
