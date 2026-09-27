import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { cardDatabase } from "../../src/data/cards.js";
import { moveCardToZone, canMoveCardToZone, findCardZone } from "../../src/core/ai/common/zones.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import type { SimulatedActionOptions } from "../../src/core/ai/common/simulatedActions/shared.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

function card(id: number) {
  const definition = cardDatabase.find(entry => entry.id === id);
  assert.ok(definition);
  return simulationCard(new Card(definition, "bot"));
}

test("Assembly field departure banishes the marked instance and consumes its departure status", () => {
  const material = card(503);
  material.banishWhenLeavesField = true;
  const state = simulationState({ bot: { field: [material] } });
  assert.equal(moveCardToZone(state.bot, material, "graveyard"), true);
  assert.deepEqual(state.bot.graveyard, []);
  assert.deepEqual(state.bot.banished, [material]);
  assert.equal(material.banishWhenLeavesField, undefined);
});

test("Phoenix blocks an Assembly departure without clearing statuses or changing zones", () => {
  const material = card(503);
  const phoenix = card(514);
  material.banishWhenLeavesField = true;
  material.effectsNegated = true;
  material.level = 1;
  material.originalLevel = 3;
  const state = simulationState({ bot: { field: [material, phoenix] } });
  assert.equal(canMoveCardToZone(state.bot, material, "graveyard"), false);
  assert.equal(material.banishWhenLeavesField, true);
  assert.equal(material.level, 1);
  assert.equal(moveCardToZone(state.bot, material, "graveyard"), false);
  assert.deepEqual(state.bot.field, [material, phoenix]);
  assert.deepEqual(state.bot.graveyard, []);
  assert.deepEqual(state.bot.banished, []);
  assert.equal(material.banishWhenLeavesField, true);
  assert.equal(material.effectsNegated, true);
  assert.equal(material.level, 1);
});

for (const disabled of ["negated", "facedown", "source itself"] as const) {
  test(`Phoenix protection does not block when ${disabled}`, () => {
    const phoenix = card(514);
    const material = disabled === "source itself" ? phoenix : card(503);
    if (disabled === "negated") phoenix.effectsNegated = true;
    if (disabled === "facedown") phoenix.isFacedown = true;
    const state = simulationState({ bot: { field: material === phoenix ? [phoenix] : [material, phoenix] } });
    assert.equal(moveCardToZone(state.bot, material, "banished"), true);
    assert.deepEqual(state.bot.banished, [material]);
  });
}

for (const destination of ["graveyard", "hand", "deck", "banished"] as const) {
  test(`a token disappears when moved to ${destination}`, () => {
    const token = simulationCard({ id: 99001, cardKind: "monster", isToken: true, level: 1 });
    const state = simulationState({ bot: { field: [token] } });
    assert.equal(moveCardToZone(state.bot, token, destination), true);
    assert.equal(findCardZone(state.bot, token), null);
    assert.equal(token.location, null);
  });
}

for (const destination of ["hand", "deck"] as const) {
  test(`a Synchro returned to ${destination} enters Extra and loses its proper summon marker`, () => {
    const phoenix = card(514);
    phoenix.properSummonEstablished = true;
    phoenix.properSummonProcedure = "synchro";
    const state = simulationState({ bot: { field: [phoenix] } });
    assert.equal(moveCardToZone(state.bot, phoenix, destination), true);
    assert.deepEqual(state.bot[destination], []);
    assert.deepEqual(state.bot.extraDeck, [phoenix]);
    assert.equal(phoenix.properSummonEstablished, false);
    assert.equal(phoenix.properSummonProcedure, null);
  });
}

test("leaving the field restores the original level, stats and effect negation", () => {
  const material = card(503);
  Object.assign(material, { level: 1, originalLevel: 3, effectsNegated: true,
    effectsNegatedDuration: "while_faceup", originalAtk: 800, atk: 1300,
    cannotAttackThisTurn: true, battlePositionLocked: true });
  const state = simulationState({ bot: { field: [material] } });
  assert.equal(moveCardToZone(state.bot, material, "graveyard"), true);
  assert.equal(material.level, 3);
  assert.equal(material.originalLevel, null);
  assert.equal(material.effectsNegated, false);
  assert.equal(material.effectsNegatedDuration, null);
  assert.equal(material.atk, 800);
  assert.equal(material.cannotAttackThisTurn, false);
  assert.equal(material.battlePositionLocked, false);
});

test("simulated moves emit actual destinations sequentially and preserve pre-exit negation in grave events", () => {
  const material = card(503);
  const marked = card(509);
  material.effectsNegated = true;
  marked.banishWhenLeavesField = true;
  const state = simulationState({ bot: { field: [material, marked] } });
  const events: Array<[string, unknown, unknown, number]> = [];
  applySimulatedActions({ state, selfId: "bot", selections: { materials: [material, marked] },
    actions: [{ type: "move", targetRef: "materials", to: "graveyard" }],
    options: { emitSimulatedEvent(event, payload) {
      events.push([event, Reflect.get(payload, "toZone"), Reflect.get(payload, "effectsNegatedAtFieldExit"), state.bot.field.length]);
    } },
  });
  assert.deepEqual(events, [
    ["card_to_grave", "graveyard", true, 1],
    ["card_moved", "graveyard", true, 1],
    ["card_moved", "banished", false, 0],
  ]);
});

test("blocked movement stops the remaining action sequence and emits no fictional grave event", () => {
  const material = card(503);
  material.banishWhenLeavesField = true;
  const state = simulationState({ bot: { field: [material, card(514)] } });
  const events: string[] = [];
  applySimulatedActions({ state, selfId: "bot", selections: { material: [material] },
    actions: [{ type: "move", targetRef: "material", to: "graveyard" }, { type: "damage", player: "opponent", amount: 1000 }],
    options: { emitSimulatedEvent: event => events.push(event) },
  });
  assert.equal(state.player.lp, 8000);
  assert.deepEqual(events, []);
});

test("Kaiser level storage counts only successful moves and captures levels before field-exit reset", () => {
  const adjusted = card(503);
  adjusted.level = 1;
  adjusted.originalLevel = 3;
  const blocked = card(509);
  blocked.banishWhenLeavesField = true;
  const state = simulationState({ bot: { field: [adjusted, blocked, card(514)] } });
  const options: SimulatedActionOptions = { actionContext: {} };
  applySimulatedActions({ state, selfId: "bot", selections: { materials: [adjusted, blocked] }, options,
    actions: [{ type: "move", targetRef: "materials", to: "deck", storeLevelSumAs: "kaiserLevels" }],
  });
  assert.equal(Reflect.get(options.actionContext ?? {}, "kaiserLevels"), 1);
  assert.equal(adjusted.level, 3);
  assert.deepEqual(state.bot.extraDeck, [adjusted]);
  assert.deepEqual(state.bot.deck, []);
  assert.ok(state.bot.field.includes(blocked));
});
