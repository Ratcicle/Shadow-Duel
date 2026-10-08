import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { applyGenericSimulatedMainPhaseAction, attachSimulatedEventEmitter } from "../../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { captureSimulatedReferences } from "../../src/core/ai/common/simulatedActions/shared.js";
import { canUseSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { moveCardToZone } from "../../src/core/ai/common/zones.js";
import type { SimulatedActionOptions, SimulatedEventOccurrence } from "../../src/core/ai/common/simulatedActions/shared.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { placeSimulationCards, simulationState } from "../helpers/simulation.js";

const clone = createPlanningCopy().cloneCardForSim;
const seats = ["player", "bot"] as const;
type Seat = typeof seats[number];

function scenario(id: 353 | 364, seat: Seat, swapped = false) {
  const state = simulationState({ turn: seat, phase: "main1", turnCounter: 2 });
  const owner = state[seat], opponent = state[seat === "player" ? "bot" : "player"];
  const source = clone(new Card(cardDefinition(id), seat));
  const effect = { ...required(source.effects?.find(entry => entry.id === (id === 353
    ? "miragebound_jackal_hand_summon_on_return" : "miragebound_rebel_hand_summon_on_position_change"))),
    requiresSourceAtResolution: true };
  source.effects = [effect];
  const target = clone(new Card(cardDefinition(351), opponent.id));
  target.effects = []; target.position = "defense";
  const returned = clone(new Card(cardDefinition(351), seat));
  returned.effects = [];
  owner.hand.push(source);
  placeSimulationCards(owner.field, returned);
  placeSimulationCards(opponent.field, target);
  assert.equal(moveCardToZone(owner, returned, "hand"), true);
  if (swapped) [state.bot, state.player] = [state.player, state.bot];
  const selfId = owner === state.bot ? "bot" : "player";
  const occurrence: SimulatedEventOccurrence = id === 353
    ? { event: "card_moved", payload: { card: returned, player: owner, fromZone: "field", toZone: "hand", movedByEffect: true } }
    : { event: "position_change", payload: { card: target, player: opponent, fromPosition: "attack", toPosition: "defense",
      positionChangedByEffect: true, sourceCard: returned } };
  const selections = id === 353 ? { miragebound_jackal_return_shift_target: [target] } : {};
  const bound = () => captureSimulatedReferences(effect, selections, owner, opponent, { self: [source] });
  return { state, owner, opponent, source, effect, target, returned, selfId, occurrence, selections, bound };
}

function relocate(fixture: ReturnType<typeof scenario>, mode: "removed" | "returned" | "other_copy" | "foreign_owner") {
  const { owner, opponent, source } = fixture;
  assert.equal(moveCardToZone(owner, source, "graveyard"), true);
  if (mode === "returned") assert.equal(moveCardToZone(owner, source, "hand"), true);
  if (mode === "other_copy") {
    const other = clone(new Card(cardDefinition(required(source.id)), owner.id));
    other.effects = [];
    owner.hand.push(other);
  }
  if (mode === "foreign_owner") assert.equal(moveCardToZone(opponent, source, "hand", owner), true);
}

for (const id of [353, 364] as const) for (const seat of seats) for (const swapped of [false, true]) {
  for (const mutation of ["intact", "removed", "returned", "other_copy", "foreign_owner"] as const) {
    test(`S02 diagnoses source movement before queued publication (${id}, ${seat}, swapped=${swapped}, ${mutation})`, () => {
      const f = scenario(id, seat, swapped);
      let completed = 0, summons = 0;
      const events = attachSimulatedEventEmitter(f.state, { enableSimulatedEvents: true,
        onSimulatedEvent: event => { if (event === "spell_activated" && mutation !== "intact") relocate(f, mutation); },
        onEffectActivated: () => { completed++; }, onAfterSpecialSummon: () => { summons++; },
        chooseSpecialSummonPosition: () => "defense" });
      // Observation hooks run before the queue prepares its activations.
      // This is the documented deferred-source projection boundary.
      events.emitSimulatedEvents?.([f.occurrence, { event: "spell_activated", payload: {} }]);
      const succeeds = mutation === "intact";
      assert.equal(f.owner.field.includes(f.source), succeeds);
      assert.equal(summons, succeeds ? 1 : 0);
      assert.equal(completed, succeeds ? 1 : 0);
      assert.equal(f.target.position, succeeds && id === 353 ? "attack" : "defense");
      if (succeeds) assert.equal(f.source.position, "defense");
      assert.equal(canUseSimulatedEffectUsage(f.state, f.effect, f.source, f.owner.id, true), !succeeds,
        "an unsupported pre-publication branch must not consume the named use");
      assert.deepEqual(f.state._simUnsupportedActions || [], succeeds ? [] : ["deferred_trigger_source_presence"]);
      if (!succeeds) return; // Unsupported projections cannot establish later state parity.
      const lateCopy = clone(new Card(cardDefinition(id), f.owner.id));
      f.owner.hand.push(lateCopy);
      events.emitSimulatedEvent?.(f.occurrence.event, f.occurrence.payload);
      assert.equal(f.owner.field.includes(lateCopy), false, "a later copy cannot reuse the named activation");
    });
  }

  for (const mutation of ["card_choice", "position_choice", "controller_card_choice", "controller_position_choice", "full_field"] as const) {
    test(`S02 self summon halts its continuation after a legal failure (${id}, ${seat}, swapped=${swapped}, ${mutation})`, () => {
      const f = scenario(id, seat, swapped);
      let completed = 0, summons = 0;
      if (mutation === "full_field") placeSimulationCards(f.owner.field, ...Array.from({ length: 5 }, () => {
        const card = clone(new Card(cardDefinition(351), f.owner.id)); card.effects = []; return card;
      }));
      const events = attachSimulatedEventEmitter(f.state, { enableSimulatedEvents: true,
        chooseSpecialSummonCards: candidates => {
          if (mutation === "card_choice") relocate(f, "returned");
          if (mutation === "controller_card_choice") f.source.controller = f.opponent.id;
          return candidates;
        },
        chooseSpecialSummonPosition: () => {
          if (mutation === "position_choice") relocate(f, "returned");
          if (mutation === "controller_position_choice") f.source.controller = f.opponent.id;
          return "defense";
        },
        onEffectActivated: () => { completed++; }, onAfterSpecialSummon: () => { summons++; } });
      events.emitSimulatedEvents?.([f.occurrence]);
      assert.equal(f.owner.field.includes(f.source), false);
      assert.equal(f.target.position, "defense", "Jackal does not change its target after its summon fails");
      assert.equal(completed, 0); assert.equal(summons, 0);
      assert.equal(canUseSimulatedEffectUsage(f.state, f.effect, f.source, f.owner.id, true), mutation === "full_field",
        "capacity rejection precedes publication; failures after selection preserve the committed use");
      assert.deepEqual(f.state._simUnsupportedActions || [], []);
    });
  }
}

// A second optional trigger from the non-turn player is published in the same
// queue and resolves first. Its completion callback probes the post-prepare
// boundary without bypassing dispatcher ordering or usage commitment.
function publishThenRelocate(f: ReturnType<typeof scenario>, mode: Parameters<typeof relocate>[1]) {
  const blocker = clone(new Card(cardDefinition(1), f.opponent.id));
  blocker.effects = [{ id: "s02_publication_order_control", timing: "on_event", event: "spell_activated",
    triggerRequirement: "optional", triggerTiming: "if", activationZones: ["field"],
    actions: [{ type: "heal", amount: 1, player: "self" }] }];
  placeSimulationCards(f.opponent.field, blocker);
  let moved = 0, completed = 0;
  const events = attachSimulatedEventEmitter(f.state, { enableSimulatedEvents: true,
    chooseSpecialSummonPosition: () => "defense",
    onEffectActivated: payload => {
      if (Reflect.get(payload, "card") === blocker) {
        assert.equal(canUseSimulatedEffectUsage(f.state, f.effect, f.source, f.owner.id, true), false,
          "the source activation must already be committed before the earlier link moves it");
        relocate(f, mode);
        moved++;
      } else if (Reflect.get(payload, "card") === f.source) completed++;
    } });
  events.emitSimulatedEvents?.([f.occurrence, { event: "spell_activated", payload: {} }]);
  assert.equal(moved, 1);
  return { events, completed };
}

for (const id of [353, 364] as const) for (const seat of seats) for (const swapped of [false, true]) {
  for (const mutation of ["removed", "returned", "other_copy", "foreign_owner"] as const) {
    test(`S02 published bound trigger fizzles after source movement (${id}, ${seat}, swapped=${swapped}, ${mutation})`, () => {
      const f = scenario(id, seat, swapped);
      const { events, completed } = publishThenRelocate(f, mutation);
      assert.equal(f.owner.field.includes(f.source), false);
      assert.equal(f.target.position, "defense", "a failed self summon must not continue to change position");
      assert.equal(completed, 0);
      assert.equal(canUseSimulatedEffectUsage(f.state, f.effect, f.source, f.owner.id, true), false);
      assert.deepEqual(f.state._simUnsupportedActions || [], []);
      const lateCopy = clone(new Card(cardDefinition(id), f.owner.id));
      f.owner.hand.push(lateCopy);
      events.emitSimulatedEvent?.(f.occurrence.event, f.occurrence.payload);
      assert.equal(f.owner.field.includes(lateCopy), false, "a later copy cannot reuse the committed named activation");
      assert.deepEqual(f.state._simUnsupportedActions || [], []);
    });
  }
}

for (const seat of seats) for (const swapped of [false, true]) for (const policy of ["absent", false] as const) {
  test(`S02 published unbound trigger survives a source round trip (${seat}, swapped=${swapped}, ${policy})`, () => {
    const f = scenario(364, seat, swapped);
    const { requiresSourceAtResolution: _boundPolicy, ...unboundEffect } = f.effect;
    f.source.effects = [{ ...unboundEffect, ...(policy === "absent" ? {} : { requiresSourceAtResolution: false }) }];
    const { completed } = publishThenRelocate(f, "returned");
    assert.equal(completed, 1);
    assert.ok(f.owner.field.includes(f.source));
    assert.equal(f.source.position, "defense");
    assert.equal(canUseSimulatedEffectUsage(f.state, f.effect, f.source, f.owner.id, true), false);
    assert.deepEqual(f.state._simUnsupportedActions || [], []);
  });
}

for (const seat of seats) for (const swapped of [false, true]) {
  test(`S02 source snapshots preserve a queued effect's other bound reference (${seat}, swapped=${swapped})`, () => {
    const f = scenario(353, seat, swapped);
    const effect = { ...f.effect, targets: required(f.effect.targets).map(target => ({ ...target, intent: "reference" as const })) };
    f.source.effects = [effect];
    const events = attachSimulatedEventEmitter(f.state, { enableSimulatedEvents: true,
      chooseSpecialSummonPosition: () => "defense" });
    events.emitSimulatedEvents?.([f.occurrence]);
    assert.ok(f.owner.field.includes(f.source));
    assert.equal(f.target.position, "attack", "capturing the source must preserve the intact referenced target");
    assert.deepEqual(f.state._simUnsupportedActions || [], []);
  });
}

for (const id of [353, 364] as const) for (const seat of seats) {
  for (const snapshot of ["missing", "empty", "other_card", "wrong_owner", "wrong_zone"] as const) {
    test(`S02 direct self summon rejects a missing or mismatched activation reference (${id}, ${seat}, ${snapshot})`, () => {
      const f = scenario(id, seat);
      // Deliberately invalid fixtures must not mutate captured immutable bindings.
      const references = { ...f.bound() };
      const original = required(references.self?.[0]);
      if (snapshot === "empty") references.self = [];
      if (snapshot === "other_card") references.self = [{ ...original, card: f.returned }];
      if (snapshot === "wrong_owner") references.self = [{ ...original, owner: f.opponent }];
      if (snapshot === "wrong_zone") references.self = [{ ...original, zone: "graveyard" }];
      const result = applySimulatedActions({ actions: f.effect.actions, state: f.state, selfId: f.selfId,
        selections: f.selections, options: { sourceCard: f.source, effect: f.effect,
          ...(snapshot === "missing" ? {} : { referenceSnapshots: references }) } });
      assert.equal(result, false); assert.equal(f.owner.field.includes(f.source), false);
      assert.equal(f.target.position, "defense"); assert.deepEqual(f.state._simUnsupportedActions || [], []);
    });
  }

  test(`S02 self summon respects its configured source zone (${id}, ${seat})`, () => {
    const f = scenario(id, seat);
    const referenceSnapshots = f.bound();
    const action = required(f.effect.actions?.find(entry => entry.type === "special_summon_from_zone"));
    assert.equal(action.type, "special_summon_from_zone");
    const result = applySimulatedActions({ actions: [{ ...action, zone: "graveyard" }], state: f.state, selfId: f.selfId,
      options: { sourceCard: f.source, effect: f.effect, referenceSnapshots } });
    assert.equal(result, false); assert.ok(f.owner.hand.includes(f.source));
  });
}

for (const seat of seats) for (const policy of ["absent", false] as const) {
  for (const swapped of [false, true]) test(`S02 diagnoses pre-publication movement even for an unbound queued self summon (${seat}, ${policy}, swapped=${swapped})`, () => {
    const f = scenario(364, seat, swapped);
    const { requiresSourceAtResolution: _boundPolicy, ...unboundEffect } = f.effect;
    f.source.effects = [{ ...unboundEffect, ...(policy === "absent" ? {} : { requiresSourceAtResolution: false }) }];
    const events = attachSimulatedEventEmitter(f.state, { enableSimulatedEvents: true,
      onSimulatedEvent: event => { if (event === "spell_activated") relocate(f, "returned"); },
      chooseSpecialSummonPosition: () => "defense" });
    events.emitSimulatedEvents?.([f.occurrence, { event: "spell_activated", payload: {} }]);
    assert.equal(f.owner.field.includes(f.source), false);
    assert.equal(canUseSimulatedEffectUsage(f.state, f.effect, f.source, f.owner.id, true), true);
    assert.deepEqual(f.state._simUnsupportedActions || [], ["deferred_trigger_source_presence"]);
  });

  test(`S02 keeps source summons that move the source as a cost (${seat}, ${policy})`, () => {
    const f = scenario(364, seat);
    const effect = { id: "source_cost_control", timing: "ignition" as const,
      activationZones: ["hand"] as const,
      ...(policy === "absent" ? {} : { requiresSourceAtResolution: false }),
      actions: [{ type: "special_summon_from_zone" as const, zone: "graveyard" as const,
        requireSource: true, haltOnFailure: true, position: "choice" as const }] };
    assert.equal(moveCardToZone(f.owner, f.source, "graveyard"), true);
    const result = applySimulatedActions({ actions: effect.actions, state: f.state, selfId: f.selfId,
      options: { sourceCard: f.source, effect, chooseSpecialSummonPosition: () => "defense" } });
    assert.equal(result, true); assert.ok(f.owner.field.includes(f.source)); assert.equal(f.source.position, "defense");
  });
}

for (const seat of seats) for (const swapped of [false, true]) for (const policy of ["absent", false] as const) {
  test(`S02 unbound Viper still summons after a position-choice round trip (${seat}, swapped=${swapped}, ${policy})`, () => {
    const f = scenario(364, seat, swapped);
    const viper = clone(new Card(cardDefinition(356), f.owner.id));
    const effect = { ...required(viper.effects?.[0]), ...(policy === "absent" ? {} : { requiresSourceAtResolution: false }) };
    assert.equal(effect.requiresSourceAtResolution, policy === "absent" ? undefined : false);
    f.owner.hand.push(viper);
    const originalVersion = viper.locationVersion || 0;
    const result = applySimulatedActions({ actions: [{ type: "special_summon_from_zone", zone: "hand", requireSource: true,
      position: "choice", haltOnFailure: true }], state: f.state, selfId: f.selfId,
      options: { sourceCard: viper, effect, chooseSpecialSummonPosition: () => {
        assert.equal(moveCardToZone(f.owner, viper, "graveyard"), true);
        assert.equal(moveCardToZone(f.owner, viper, "hand"), true);
        return "defense";
      } } });
    assert.ok((viper.locationVersion || 0) > originalVersion);
    assert.equal(result, true); assert.ok(f.owner.field.includes(viper)); assert.equal(viper.position, "defense");
    assert.deepEqual(f.state._simUnsupportedActions || [], []);
  });
}

for (const position of ["attack", "defense"] as const) test(`S02 default requireSource false still recruits a different card (${position})`, () => {
  const f = scenario(364, "bot");
  const candidate = clone(new Card(cardDefinition(351), "bot")); candidate.effects = [];
  f.owner.deck.push(candidate);
  const options: SimulatedActionOptions = { sourceCard: f.source };
  assert.equal(applySimulatedActions({ state: f.state, actions: [{ type: "special_summon_from_zone", zone: "deck", position }], options }), true);
  assert.ok(f.owner.field.includes(candidate)); assert.ok(f.owner.hand.includes(f.source));
  assert.equal(candidate.position, position);
});

for (const seat of seats) test(`S02 preserves Mirror Path's explicit source departure exception (${seat})`, () => {
  const state = simulationState({ turn: seat, phase: "main1", turnCounter: 2 });
  const owner = state[seat], opponent = state[seat === "player" ? "bot" : "player"];
  const mirror = clone(new Card(cardDefinition(359), seat));
  const effect = required(mirror.effects?.find(entry => entry.id === "miragebound_mirror_path_destroy_spell_trap"));
  assert.equal(effect.requiresSourceAtResolution, false);
  const target = clone(new Card(cardDefinition(359), opponent.id)); target.effects = [];
  placeSimulationCards(owner.spellTrap, mirror); placeSimulationCards(opponent.spellTrap, target);
  if (seat === "player") [state.bot, state.player] = [state.player, state.bot];
  applyGenericSimulatedMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0, effectId: effect.id });
  assert.ok(owner.graveyard.includes(mirror)); assert.ok(opponent.graveyard.includes(target));
});
