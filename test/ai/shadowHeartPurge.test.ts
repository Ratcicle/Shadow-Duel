import assert from "node:assert/strict";
import test from "node:test";
import { attachSimulatedEventEmitter, simulateGenericSpellEffect } from "../../src/core/ai/common/simulation.js";
import { shouldPlaySpell, evaluateShadowHeartOffensivePlan } from "../../src/core/ai/shadowheart/priorities.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

function fixture(atk = 800) {
  const target = simulationCard({ id: 991031, instanceId: 991031, name: "Target", cardKind: "monster", atk, def: 2500, position: "attack" });
  const other = simulationCard({ id: 991032, instanceId: 991032, name: "Other", cardKind: "monster", atk: 2000, def: 1000, position: "attack" });
  const source = simulationCard({ id: 103, instanceId: 103, name: "Shadow-Heart Purge", cardKind: "spell", subtype: "normal", effects: [{
    id: "purge", timing: "on_play", targets: [{ id: "target", owner: "opponent", zone: "field", name: "Target" }], actions: [
      { type: "buff_stats_temp", targetRef: "target", atkBoost: -1000, permanent: true, storeAs: "reduced" },
      { type: "register_temporary_event_effect", event: "card_moved", bindEventTargetRef: "reduced", requireBoundTargetLeavesField: true,
        requireBoundTargetDestroyed: true, duration: "end_of_turn", uses: 1, triggerRequirement: "mandatory", triggerTiming: "if",
        actions: [{ type: "buff_stats_temp", targetScope: { owner: "opponent", zone: "field", filters: { cardKind: "monster" }, requireFaceup: true }, atkBoost: -1000, permanent: true }] },
    ],
  }] });
  const state = simulationState({ turnCounter: 2, bot: { graveyard: [source] }, player: { field: [target, other] } });
  simulateGenericSpellEffect(state, source, { enableSimulatedEvents: true });
  const events = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true });
  return { target, other, source, state, events };
}

test("Purge simulation preserves a zeroed monster and waits for its destruction before spreading", () => {
  const { state, target, other } = fixture();
  assert.equal(target.atk, 0);
  assert.equal(target.tempAtkBoost || 0, 0);
  assert.deepEqual(state.player.field, [target, other]);
  assert.equal(other.atk, 2000);
  assert.equal(state.temporaryEventEffects?.length, 1);
  assert.deepEqual(state._simUnsupportedActions || [], []);
});

for (const [wasDestroyed, destroyCause, expectedAtk] of [[false, "effect", 2000], [true, "effect", 1000], [true, "battle", 1000], [true, "rule", 2000]] as const) {
  test(`Purge simulation consumes the first field exit and spreads only on battle/effect destruction (${wasDestroyed}, ${destroyCause})`, () => {
    const { state, target, other, events } = fixture();
    state.player.field = [other];
    state.player.graveyard.push(target);
    events.emitSimulatedEvent?.("card_moved", { card: target, player: state.player, fromZone: "field", toZone: "graveyard", wasDestroyed, destroyCause });
    assert.equal(other.atk, expectedAtk);
    assert.equal(other.tempAtkBoost || 0, 0);
    assert.deepEqual(state.temporaryEventEffects, []);
    events.emitSimulatedEvent?.("card_moved", { card: target, player: state.player, fromZone: "field", toZone: "graveyard", wasDestroyed: true, destroyCause: "effect" });
    assert.equal(other.atk, expectedAtk);
  });
}

test("Purge simulation cannot bind the follow-up when ATK did not decrease", () => {
  const { state, target, other, events } = fixture(0);
  state.player.field = [other];
  state.player.graveyard.push(target);
  events.emitSimulatedEvent?.("card_moved", { card: target, player: state.player, fromZone: "field", toZone: "graveyard", wasDestroyed: true, destroyCause: "effect" });
  assert.equal(other.atk, 2000);
  assert.deepEqual(state.temporaryEventEffects, []);
});

test("Purge simulation expires its conditional follow-up after the activation turn", () => {
  const { state, target, other, events } = fixture();
  state.turnCounter++;
  state.player.field = [other];
  state.player.graveyard.push(target);
  events.emitSimulatedEvent?.("card_moved", { card: target, player: state.player, fromZone: "field", toZone: "graveyard", wasDestroyed: true, destroyCause: "effect" });
  assert.equal(other.atk, 2000);
  assert.deepEqual(state.temporaryEventEffects, []);
});

test("Purge heuristics do not spend discard resources to zero a monster without a combat payoff", () => {
  const { source, target } = fixture();
  const discard = simulationCard({ id: 991033, name: "Shadow-Heart Fodder", cardKind: "monster", archetype: "Shadow-Heart", atk: 500 });
  target.atk = 800;
  assert.equal(shouldPlaySpell(source, { hand: [source, discard], field: [], graveyard: [], oppField: [target], lp: 8000, oppLp: 8000, phase: "main1" }).yes, false);
});

test("Purge offensive planning does not treat a low-ATK defensive wall as removed", () => {
  const { source, target } = fixture();
  target.atk = 800;
  target.position = "defense";
  const attacker = simulationCard({ id: 991034, name: "Shadow-Heart Attacker", cardKind: "monster", archetype: "Shadow-Heart", atk: 2000, position: "attack" });
  assert.equal(evaluateShadowHeartOffensivePlan({ hand: [source], field: [attacker], graveyard: [], oppField: [target], lp: 8000, oppLp: 8000, phase: "main1" }).purgeWindow, false);
});
