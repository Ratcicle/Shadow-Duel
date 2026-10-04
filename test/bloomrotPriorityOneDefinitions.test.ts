import assert from "node:assert/strict";
import test from "node:test";
import { validateCardDatabase, validateEffectActionTree } from "../src/core/CardDatabaseValidator.js";
import { cardDefinition, required } from "./helpers/fixtures.js";

for (const id of [412, 419]) test(`${id} prepares its mode and counter cost before resolution`, () => {
  const effect = required(cardDefinition(id).effects?.find(entry => entry.timing === "ignition"));
  const cases = required(effect.activationCases);
  assert.equal(cases.length, id === 412 ? 2 : 3);
  for (const mode of cases) {
    const cost = required(mode.activationCosts?.[0]);
    assert.equal(cost.type, "remove_counters_from_field");
    assert.equal(mode.targets?.[0]?.intent, "cost");
    assert.equal(mode.actions.some(action => action.type === "remove_counters_from_field"), false);
    assert.equal(mode.actions.some(action => action.type === "choose_action_case"), false);
  }
  if (id === 419) assert.deepEqual(cases.map(mode => mode.actions), [
    [{ type: "heal", player: "self", amount: 500 }],
    [{ type: "heal", player: "self", amount: 1000 }],
    [{ type: "heal", player: "self", amount: 1500 }],
  ]);
});

test("418 separates pooled cost references from its declared Defense target", () => {
  const effect = required(cardDefinition(418).effects?.find(entry => entry.timing === "ignition"));
  assert.equal(effect.activationCosts?.[0]?.type, "remove_counters_from_field");
  const target = required(effect.targets?.find(entry => entry.intent !== "cost"));
  assert.equal(target.owner, "opponent");
  assert.equal(target.filters?.position, "defense");
  assert.notEqual(target.requireFaceup, true);
  assert.equal(effect.actions?.[0]?.type, "destroy");
});

test("403 requires its selected cost to arrive in the Graveyard", () => {
  const cost = required(cardDefinition(403).effects?.find(entry => entry.activationCosts)?.activationCosts?.[0]);
  assert.equal(cost.type, "move");
  if (cost.type === "move") assert.equal(cost.requireDestination, true);
});

for (const id of [406, 407, 408, 420]) test(`${id} observes destruction independently of the destination`, () => {
  const effect = required(cardDefinition(id).effects?.find(entry => entry.event === "card_to_grave" || entry.event === "card_moved"));
  assert.equal(effect.event, "card_moved");
  assert.equal(effect.fromZone, "field");
  assert.equal(effect.toZone, "any");
  const conditions = [...(effect.conditions ?? []), ...(effect.condition ? [effect.condition] : [])];
  assert.ok(conditions.some(condition => !Array.isArray(condition) &&
    "type" in condition && (condition.type === "destroyed_by_battle" || condition.type === "destroyed_by_battle_or_effect")));
});

test("P1 declarative definitions satisfy the database contracts", () => {
  assert.deepEqual(validateCardDatabase().errors.filter(issue => issue.cardId !== null && [401, 403, 406, 407, 408, 412, 418, 419, 420].includes(issue.cardId)), []);
});

test("pooled activation costs require a declared cost reference and fixed positive amount", () => {
  const targets = [{ id: "cost", intent: "cost", owner: "any", zones: ["field"], count: { min: 1, max: 3 } }];
  for (const action of [
    { type: "remove_counters_from_field", amount: 2 },
    { type: "remove_counters_from_field", targetRef: "cost", minAmount: 1, maxAmount: 3 },
    { type: "remove_counters_from_field", targetRef: "cost", amount: 0 },
    { type: "remove_counters_from_field", targetRef: "cost", amount: 2, maxAmount: 3 },
    { type: "remove_counters_from_field", targetRef: "cost", amount: 2, variableAmount: true },
  ]) assert.ok(validateEffectActionTree({ id: "invalid_cost", timing: "ignition", targets, activationCosts: [action] }).errors.length > 0);
  assert.deepEqual(validateEffectActionTree({ id: "valid_cost", timing: "ignition", targets,
    activationCosts: [{ type: "remove_counters_from_field", targetRef: "cost", counterType: "spore", amount: 2 }] }).errors, []);
});
