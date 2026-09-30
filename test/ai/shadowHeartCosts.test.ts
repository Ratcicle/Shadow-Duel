import assert from "node:assert/strict";
import test from "node:test";
import { simulateMainPhaseAction } from "../../src/core/ai/shadowheart/simulation.js";
import { cardDefinition } from "../helpers/fixtures.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

const card = (id: number) => simulationCard({ ...cardDefinition(id) });

test("Cathedral simulation cannot spend itself for a forbidden summon", () => {
  const source = card(119); source.counters = new Map([["judgment_marker", 3]]);
  const recruit = card(125);
  const state = simulationState({ _isPerspectiveState: true, phase: "main1", turn: "bot",
    bot: { spellTrap: [source], deck: [recruit], specialSummonRestrictions: [{ allowedFilters: { type: "Machine" }, duration: "until_end_turn", expiresOnTurn: 1, reason: null, sourceName: null, sourceId: null, effectId: null }] } });
  simulateMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0, effectId: "shadow_heart_cathedral_summon_effect" });
  assert.deepEqual(state.bot.spellTrap, [source]);
  assert.deepEqual(state.bot.deck, [recruit]);
  assert.equal(state.bot.field.length, 0);
});

test("Cathedral simulation pays before choosing summon position and uses current counters", () => {
  const source = card(119); source.counters = new Map([["judgment_marker", 3]]);
  const recruit = card(125);
  const state = simulationState({ _isPerspectiveState: true, phase: "main1", turn: "bot", bot: { spellTrap: [source], deck: [recruit] } });
  let chosen = false;
  simulateMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0, effectId: "shadow_heart_cathedral_summon_effect" }, {
    chooseSpecialSummonPosition: () => { assert.ok(state.bot.graveyard.includes(source)); chosen = true; return "defense"; },
  });
  assert.ok(chosen);
  assert.deepEqual(state.bot.field, [recruit]);
  assert.equal(recruit.position, "defense");
  assert.equal(state.bot.graveyard.filter(card => card === source).length, 1);
});

test("Leviathan simulation pays once and uses the space freed by Eel", () => {
  const source = card(117), eel = card(101);
  const state = simulationState({ _isPerspectiveState: true, phase: "main1", turn: "bot",
    bot: { hand: [source], field: [eel, ...Array.from({ length: 4 }, () => card(125))] } });
  simulateMainPhaseAction(state, { type: "handIgnition", index: 0, cardId: 117, effectId: "shadow_heart_leviathan_special_summon_hand" });
  assert.ok(state.bot.field.includes(source));
  assert.equal(state.bot.field.length, 5);
  assert.equal(state.bot.graveyard.filter(card => card.id === 101).length, 1);
});

test("Cathedral simulation shares its hard OPT across copies", () => {
  const first = card(119), second = card(119);
  first.counters = new Map([["judgment_marker", 3]]);
  second.counters = new Map([["judgment_marker", 3]]);
  const state = simulationState({ _isPerspectiveState: true, phase: "main1", turn: "bot",
    bot: { spellTrap: [first, second], deck: [card(125), card(125)] } });
  const action = { type: "spellTrapEffect" as const, zoneIndex: 0, effectId: "shadow_heart_cathedral_summon_effect" };
  simulateMainPhaseAction(state, action);
  simulateMainPhaseAction(state, action);
  assert.deepEqual(state.bot.spellTrap, [second]);
  assert.equal(state.bot.field.length, 1);
});
