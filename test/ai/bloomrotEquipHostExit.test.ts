import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { attachSimulatedEventEmitter } from "../../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { attachSimulatedEquip, moveCardToZone } from "../../src/core/ai/common/zones.js";
import { getCounterValue } from "../../src/core/ai/common/counters.js";
import { cardDefinition } from "../helpers/fixtures.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

for (const seat of ["player", "bot"] as const) {
  for (const kind of ["normal", "banished", "token"] as const) {
    for (const negated of [false, true]) {
      test(`simulated Overgrowth host ${kind} destruction, negated=${negated} (${seat})`, () => {
        const other = seat === "player" ? "bot" : "player";
        const equip = simulationCard(new Card(cardDefinition(415), seat));
        equip.effectsNegated = negated;
        const host = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, other));
        host.isToken = kind === "token"; host.banishWhenLeavesField = kind === "banished";
        const target = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, other));
        const state = simulationState({ [seat]: { spellTrap: [equip] }, [other]: { field: [host, target] } });
        assert.equal(attachSimulatedEquip(equip, host), true);
        const activations: string[] = [];
        const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true,
          onEffectActivated: event => { if (Reflect.get(event, "card") === equip) {
            const effect: unknown = Reflect.get(event, "effect");
            activations.push(effect && typeof effect === "object" ? String(Reflect.get(effect, "id")) : "");
          } } });
        const result = applySimulatedActions({ state, selfId: seat, actions: [{ type: "destroy", targetRef: "host" }],
          selections: { host: [host] }, options });
        assert.equal(result, true);
        assert.ok(state[seat].graveyard.includes(equip));
        assert.equal(state[seat].spellTrap.includes(equip), false);
        assert.equal(state[other].graveyard.includes(equip), false);
        assert.equal(getCounterValue(target, "spore"), negated ? 0 : 1);
        assert.deepEqual(activations, ["bloomrot_overgrowth_destroyed_host_spread"]);
        assert.deepEqual(state._simUnsupportedActions ?? [], []);
      });
    }
  }
  for (const type of ["return_to_hand", "banish"] as const) {
    test(`simulated Overgrowth ignores ${type} host exit (${seat})`, () => {
      const other = seat === "player" ? "bot" : "player";
      const equip = simulationCard(new Card(cardDefinition(415), seat));
      const host = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, other));
      const target = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, other));
      const state = simulationState({ [seat]: { spellTrap: [equip] }, [other]: { field: [host, target] } });
      attachSimulatedEquip(equip, host);
      const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true });
      applySimulatedActions({ state, selfId: seat, actions: [{ type, targetRef: "host" }], selections: { host: [host] }, options });
      assert.equal(getCounterValue(target, "spore"), 0);
      assert.ok(state[seat].graveyard.includes(equip));
    });
  }
  test(`simulated borrowed Overgrowth keeps its actor and original destination (${seat})`, () => {
    const other = seat === "player" ? "bot" : "player";
    const equip = simulationCard(new Card(cardDefinition(415), other)); equip.owner = equip.controller = seat;
    const host = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, other));
    const target = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, other));
    const ownTarget = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, seat));
    const state = simulationState({ [seat]: { spellTrap: [equip], field: [ownTarget] }, [other]: { field: [host, target] } });
    attachSimulatedEquip(equip, host);
    const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true });
    applySimulatedActions({ state, selfId: seat, actions: [{ type: "destroy", targetRef: "host" }], selections: { host: [host] }, options });
    assert.ok(state[other].graveyard.includes(equip)); assert.equal(state[seat].graveyard.includes(equip), false);
    assert.equal(getCounterValue(target, "spore"), 1); assert.equal(getCounterValue(ownTarget, "spore"), 0);
  });
  test(`simulated independent Overgrowth bindings each spread once (${seat})`, () => {
    const other = seat === "player" ? "bot" : "player";
    const first = simulationCard(new Card(cardDefinition(415), seat)), second = simulationCard(new Card(cardDefinition(415), seat));
    const host = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, other)); host.isToken = true;
    const target = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, other));
    const state = simulationState({ [seat]: { spellTrap: [first, second] }, [other]: { field: [host, target] } });
    attachSimulatedEquip(first, host); attachSimulatedEquip(second, host);
    const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true });
    applySimulatedActions({ state, selfId: seat, actions: [{ type: "destroy", targetRef: "host" }], selections: { host: [host] }, options });
    assert.equal(getCounterValue(target, "spore"), 2);
    assert.equal(state[seat].spellTrap.length, 0);
  });
  test(`simulated cleanup callback cannot substitute a new Overgrowth presence (${seat})`, () => {
    const other = seat === "player" ? "bot" : "player";
    const equip = simulationCard(new Card(cardDefinition(415), seat));
    const host = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, other)); host.isToken = true;
    const target = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, other));
    const state = simulationState({ [seat]: { spellTrap: [equip] }, [other]: { field: [host, target] } });
    attachSimulatedEquip(equip, host);
    let changed = false;
    const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true,
      onSimulatedEvent: (event, payload) => {
        if (event !== "card_to_grave" || Reflect.get(payload, "card") !== equip || changed) return;
        changed = true;
        moveCardToZone(state[seat], equip, "hand", state[seat], { state });
        moveCardToZone(state[seat], equip, "graveyard", state[seat], { state });
      } });
    applySimulatedActions({ state, selfId: seat, actions: [{ type: "destroy", targetRef: "host" }], selections: { host: [host] }, options });
    assert.equal(changed, true); assert.ok(state[seat].graveyard.includes(equip));
    assert.equal(getCounterValue(target, "spore"), 0);
  });
  for (const exitType of ["destroy", "return_to_hand", "banish", "move"] as const) {
  test(`simulated host ${exitType} keeps its receipt after a later cleanup movement (${seat})`, () => {
    const other = seat === "player" ? "bot" : "player";
    const equip = simulationCard(new Card(cardDefinition(415), seat));
    const host = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, other));
    const target = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, other));
    const state = simulationState({ [seat]: { spellTrap: [equip] }, [other]: { field: [host, target] } });
    assert.equal(attachSimulatedEquip(equip, host), true);
    const committedZone = exitType === "return_to_hand" ? "hand" : exitType === "banish" ? "banished" : "graveyard";
    const initialVersion = host.locationVersion ?? 0;
    const events: Array<{ event: string; fromZone: unknown; toZone: unknown; fromPlayer: unknown;
      toPlayer: unknown; player: unknown; version: unknown }> = [];
    let movedDuringCleanup = false;
    const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true,
      onSimulatedEvent: (event, payload) => {
        if (Reflect.get(payload, "card") === host) events.push({ event,
          fromZone: Reflect.get(payload, "fromZone"), toZone: Reflect.get(payload, "toZone"),
          fromPlayer: Reflect.get(payload, "fromPlayer"), toPlayer: Reflect.get(payload, "toPlayer"),
          player: Reflect.get(payload, "player"), version: Reflect.get(payload, "locationVersion") });
        if (event !== "card_to_grave" || Reflect.get(payload, "card") !== equip || movedDuringCleanup) return;
        movedDuringCleanup = true;
        assert.ok(state[other][committedZone].includes(host));
        assert.equal(applySimulatedActions({ state, selfId: seat,
          actions: [{ type: "move", targetRef: "host", to: "hand", player: "self", contextLabel: "later_host_move" }],
          selections: { host: [host] }, options }), true);
      } });
    assert.equal(applySimulatedActions({ state, selfId: seat,
      actions: [exitType === "move" ? { type: "move", targetRef: "host", to: "graveyard" } : { type: exitType, targetRef: "host" }],
      selections: { host: [host] }, options }), true);
    assert.equal(movedDuringCleanup, true);
    assert.ok(state[seat].hand.includes(host));
    assert.equal(state[other].graveyard.includes(host), false);
    assert.deepEqual(events, [
      { event: "card_moved", fromZone: committedZone, toZone: "hand", fromPlayer: state[other],
        toPlayer: state[seat], player: state[seat], version: initialVersion + 2 },
      ...(committedZone === "graveyard" ? [{ event: "card_to_grave", fromZone: "field", toZone: committedZone,
        fromPlayer: state[other], toPlayer: state[other], player: state[other], version: initialVersion + 1 }] : []),
      { event: "card_moved", fromZone: "field", toZone: committedZone, fromPlayer: state[other],
        toPlayer: state[other], player: state[other], version: initialVersion + 1 },
    ]);
    assert.equal(host.locationVersion, initialVersion + 2);
    assert.equal(host.controller, seat);
    assert.equal(host.owner, seat);
    assert.equal(getCounterValue(target, "spore"), exitType === "destroy" ? 1 : 0);
  });
  }
}
