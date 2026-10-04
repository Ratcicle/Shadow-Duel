import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { attachSimulatedEventEmitter } from "../../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { simulateSynchroSummon } from "../../src/core/ai/common/simulatedActions/summon.js";
import { markSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { getCounterValue, setCounterValue } from "../../src/core/ai/common/counters.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

for (const seat of ["player", "bot"] as const) {
  test(`simulated self departure benefits previous controller (${seat})`, () => {
    const other = seat === "player" ? "bot" : "player";
    const source = simulationCard(new Card(cardDefinition(401), other));
    source.owner = source.controller = seat;
    const candidate = simulationCard(new Card({ ...cardDefinition(410), effects: [] }, seat));
    const wrong = simulationCard(new Card({ ...cardDefinition(410), effects: [] }, other));
    const state = simulationState({ [seat]: { field: [source], deck: [candidate] }, [other]: { deck: [wrong] } });
    const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true, shouldActivateEffect: () => true });
    applySimulatedActions({ state, selfId: seat, actions: [{ type: "move", targetRef: "departed", to: "graveyard" }],
      selections: { departed: [source] }, options });
    assert.ok(state[seat].hand.includes(candidate));
    assert.ok(state[other].graveyard.includes(source));
    assert.ok(state[other].deck.includes(wrong));
    assert.deepEqual(state._simUnsupportedActions ?? [], []);
  });
  for (const kind of ["graveyard", "banished", "token"] as const) {
    test(`simulated observers recognize ${kind} destruction (${seat})`, () => {
      const other = seat === "player" ? "bot" : "player";
      const widow = simulationCard(new Card(cardDefinition(407), seat));
      const husk = simulationCard(new Card(cardDefinition(408), seat));
      const infected = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, other));
      infected.isToken = kind === "token";
      infected.banishWhenLeavesField = kind === "banished"; setCounterValue(infected, "spore", 1);
      const target = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, other));
      const state = simulationState({ [seat]: { field: [widow, husk] }, [other]: { field: [infected, target] } });
      const options = attachSimulatedEventEmitter(state, { sourceCard: widow, enableSimulatedEvents: true });
      applySimulatedActions({ state, selfId: seat, actions: [{ type: "destroy", targetRef: "infected" }],
        selections: { infected: [infected] }, options });
      assert.equal(getCounterValue(target, "spore"), 2);
      assert.deepEqual(state._simUnsupportedActions ?? [], []);
    });
  }
  for (const previouslyOpponent of [true, false]) {
    test(`simulated Widow compares historical controller (${seat}, opponent=${previouslyOpponent})`, () => {
      const other = seat === "player" ? "bot" : "player";
      const oldController = previouslyOpponent ? other : seat;
      const originalOwner = previouslyOpponent ? seat : other;
      const widow = simulationCard(new Card(cardDefinition(407), seat));
      const target = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, other));
      const infected = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, originalOwner));
      infected.owner = infected.controller = oldController; setCounterValue(infected, "spore", 1);
      const state = simulationState({ [seat]: { field: previouslyOpponent ? [widow] : [widow, infected] },
        [other]: { field: previouslyOpponent ? [infected, target] : [target] } });
      const options = attachSimulatedEventEmitter(state, { sourceCard: widow, enableSimulatedEvents: true });
      applySimulatedActions({ state, selfId: seat, actions: [{ type: "destroy", targetRef: "infected" }],
        selections: { infected: [infected] }, options });
      assert.ok(state[originalOwner].graveyard.includes(infected));
      assert.equal(getCounterValue(target, "spore"), previouslyOpponent ? 1 : 0);
    });
  }
  for (const operation of ["return_to_hand", "banish"] as const) {
    test(`simulated non-destructive ${operation} does not fire destruction observers (${seat})`, () => {
      const other = seat === "player" ? "bot" : "player";
      const widow = simulationCard(new Card(cardDefinition(407), seat)), husk = simulationCard(new Card(cardDefinition(408), seat));
      const infected = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, other)); setCounterValue(infected, "spore", 1);
      const target = simulationCard(new Card({ ...cardDefinition(1), effects: [] }, other));
      const state = simulationState({ [seat]: { field: [widow, husk] }, [other]: { field: [infected, target] } });
      const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true });
      applySimulatedActions({ state, selfId: seat, actions: [{ type: operation, targetRef: "infected" }],
        selections: { infected: [infected] }, options });
      assert.equal(getCounterValue(target, "spore"), 0);
      assert.deepEqual(state._simUnsupportedActions ?? [], []);
    });
  }
}

test("simulated negated field-exit projection is explicit rather than silently treated as supported", () => {
  const source = simulationCard(new Card(cardDefinition(401), "bot")); source.effectsNegated = true;
  const state = simulationState({ bot: { field: [source], deck: [simulationCard(new Card(cardDefinition(410), "bot"))] } });
  const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true });
  applySimulatedActions({ state, selfId: "bot", actions: [{ type: "move", targetRef: "departed", to: "graveyard" }],
    selections: { departed: [source] }, options });
  assert.ok(required(state._simUnsupportedActions).includes("negated_field_exit_trigger"));
});

test("a negated self departure with exhausted OPT carries no unsupported eligible trigger", () => {
  const source = simulationCard(new Card(cardDefinition(401), "bot")); source.effectsNegated = true;
  const state = simulationState({ bot: { field: [source], deck: [simulationCard(new Card(cardDefinition(410), "bot"))] } });
  const effect = required(source.effects?.find(entry => entry.event === "card_moved"));
  markSimulatedEffectUsage(state, effect, source, "bot", true);
  const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true });
  applySimulatedActions({ state, selfId: "bot", actions: [{ type: "move", targetRef: "departed", to: "graveyard" }],
    selections: { departed: [source] }, options });
  assert.deepEqual(state._simUnsupportedActions ?? [], []);
  assert.equal(state.bot.hand.length, 0);
});

for (const id of [406, 420] as const) {
  for (const operation of ["return_to_hand", "banish"] as const) {
    test(`negated ${id} ${operation} carries no fictitious unsupported destruction trigger`, () => {
      const source = simulationCard(new Card(cardDefinition(id), "bot")); source.effectsNegated = true;
      const state = simulationState({ bot: { field: [source], deck: [simulationCard(new Card(cardDefinition(402), "bot"))] } });
      const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true });
      applySimulatedActions({ state, selfId: "bot", actions: [{ type: operation, targetRef: "departed" }],
        selections: { departed: [source] }, options });
      assert.deepEqual(state._simUnsupportedActions ?? [], []);
    });
  }
}

test("Synchro material producer retains provenance for Sporeling departure", () => {
  const source = simulationCard(new Card(cardDefinition(401), "bot"));
  const tuner = simulationCard(new Card({ ...cardDefinition(501), level: 3, effects: [] }, "bot")); tuner.isTuner = true;
  const synchro = simulationCard(new Card({ ...cardDefinition(510), level: 5, effects: [] }, "bot"));
  const candidate = simulationCard(new Card({ ...cardDefinition(410), effects: [] }, "bot"));
  const state = simulationState({ bot: { field: [source, tuner], extraDeck: [synchro], deck: [candidate] } });
  const movements: Array<{ from: unknown; to: unknown }> = [];
  const result = simulateSynchroSummon(state, state.bot, { synchroInstanceId: required(synchro.instanceId),
    materialInstanceIds: [required(source.instanceId), required(tuner.instanceId)], position: "attack" }, {
    enableSimulatedEvents: true, shouldActivateEffect: () => true, onSimulatedEvent(event, payload) {
      if (event === "card_moved" && Reflect.get(payload, "card") === source) movements.push({
        from: Reflect.get(payload, "fromPlayer"), to: Reflect.get(payload, "toPlayer") });
    },
  }, applySimulatedActions);
  assert.equal(result, true); assert.equal(movements.length, 1);
  assert.equal(movements[0]?.from, state.bot); assert.equal(movements[0]?.to, state.bot);
  assert.ok(state.bot.hand.includes(candidate)); assert.ok(state.bot.graveyard.includes(source));
  assert.deepEqual(state._simUnsupportedActions ?? [], []);
});
