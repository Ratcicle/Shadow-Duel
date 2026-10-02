import assert from "node:assert/strict";
import test from "node:test";

import { validateEffectActionTree } from "../../src/core/CardDatabaseValidator.js";

function messages(
  result: ReturnType<typeof validateEffectActionTree>,
  kind: "errors" | "warnings",
): string[] {
  return result[kind].map((issue) => issue.message);
}

test("activation cases validate IDs, fields and list shapes", () => {
  for (const activationCases of [null, {}, []]) {
    assert.ok(validateEffectActionTree({ activationCases }).errors.length > 0);
  }
  const result = validateEffectActionTree({ activationCases: [
    { id: "duplicate", actions: [] },
    { id: "duplicate", actions: [] },
    { id: "", actions: [] },
    { id: "invalid", label: 42, description: false, conditions: {}, targets: {}, activationCosts: {}, actions: {}, oncePerTurn: true },
    { id: "missing_actions" },
  ] });
  const errors = messages(result, "errors");
  for (const fragment of ["duplicate", "non-empty", "label", "description", "conditions", "targets", "activationCosts", "actions", "oncePerTurn"]) {
    assert.ok(errors.some(message => message.includes(fragment)), `Missing diagnostic for ${fragment}`);
  }
});

test("activation cases validate nested actions, references and cost intent within each case", () => {
  const result = validateEffectActionTree({ activationCases: [
    {
      id: "valid",
      targets: [{ id: "discard", intent: "cost" }],
      activationCosts: [{ type: "move", targetRef: "discard", to: "graveyard" }],
      actions: [{ type: "draw", amount: 1 }],
    },
    {
      id: "invalid",
      targets: [{ id: "effect_target" }, { id: "cost_target", intent: "cost" }],
      activationCosts: [{ type: "move", targetRef: "effect_target", to: "graveyard" }, { type: "search_any", player: "self" }],
      actions: [{ type: "conditional_actions", actions: [
        { type: "destroy", targetRef: "discard" },
        { type: "destroy", targetRef: "cost_target" },
        { type: "missing_action" },
      ] }],
    },
  ] });
  const errors = messages(result, "errors");
  assert.equal(errors.some(message => message.includes("activationCases[0]")), false);
  for (const fragment of ['intent: "cost"', "dynamic selection", "does not match any effect target id", "cannot consume cost target", 'missing_action" is not registered']) {
    assert.ok(errors.some(message => message.includes(fragment)), `Missing diagnostic for ${fragment}`);
  }
});

test("legacy resolution selections retain their deferred cost actions and local references", () => {
  const result = validateEffectActionTree({
    targets: [{ id: "deferred_cost", intent: "cost" }],
    actions: [{
      type: "optional_target_actions",
      targets: [{ id: "revive_target" }],
      actions: [
        { type: "move", targetRef: "deferred_cost", fromZone: "field", to: "graveyard", contextLabel: "cost" },
        { type: "special_summon_from_zone", targetRef: "revive_target", zone: "graveyard" },
      ],
    }, {
      type: "choose_action_case",
      cases: [{
        id: "local_cost",
        targets: [{ id: "local_discard", intent: "cost" }],
        actions: [{ type: "move", targetRef: "local_discard", to: "graveyard" }],
      }],
    }],
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);

  const directCost = validateEffectActionTree({
    targets: [{ id: "cost", intent: "cost" }],
    actions: [{ type: "move", targetRef: "cost", to: "graveyard" }],
  });
  assert.ok(messages(directCost, "errors").some(message => message.includes("cannot consume cost target")));
});

test("deep validation reports unknown types, missing fields and extra fields with paths", () => {
  const result = validateEffectActionTree({
    actions: [
      {
        type: "conditional_actions",
        actions: [
          { type: "draw", player: "self" },
          { type: "draw", amount: 1, unexpected: true },
        ],
      },
      {
        type: "conditional_target_actions",
        targetRef: "source",
        cases: [],
        defaultActions: [{ type: "not_cataloged" }],
      },
    ],
    targets: [{ id: "source" }],
  });

  assert.ok(
    messages(result, "errors").some(
      (message) =>
        message.includes("actions[0].actions[0]") &&
        message.includes('missing required field "amount"'),
    ),
  );
  assert.ok(
    messages(result, "errors").some(
      (message) =>
        message.includes("actions[1].defaultActions[0]") &&
        message.includes('not_cataloged" is not registered'),
    ),
  );
  assert.ok(
    messages(result, "warnings").some(
      (message) =>
        message.includes("actions[0].actions[1]") &&
        message.includes('unknown field "unexpected"'),
    ),
  );
});

test("deep target references honor sequential, action-local and case-local scopes", () => {
  const result = validateEffectActionTree({
    targets: [{ id: "effect_target" }],
    actions: [
      { type: "destroy", targetRef: "future_result" },
      {
        type: "add_from_zone_to_hand",
        zone: "deck",
        resultRef: "future_result",
      },
      { type: "destroy", targetRef: "future_result" },
      {
        type: "optional_target_actions",
        targets: [{ id: "action_target" }],
        actions: [{ type: "destroy", targetRef: "action_target" }],
      },
      {
        type: "conditional_target_actions",
        targetRef: "effect_target",
        cases: [
          {
            targets: [{ id: "case_target" }],
            actions: [{ type: "destroy", targetRef: "case_target" }],
          },
        ],
        defaultActions: [{ type: "destroy", targetRef: "case_target" }],
      },
    ],
  });

  const targetErrors = messages(result, "errors").filter((message) =>
    message.includes("does not match any effect target id"),
  );
  assert.equal(targetErrors.length, 2);
  assert.ok(targetErrors.some((message) => message.includes("actions[0]")));
  assert.ok(
    targetErrors.some((message) =>
      message.includes("actions[4].defaultActions[0]"),
    ),
  );
});

test("activation-only cost rules do not leak into replacement or negation flows", () => {
  const replacement = validateEffectActionTree({
    replacementEffect: {
      type: "destruction",
      costActions: [
        { type: "remove_counters_from_field", counterType: "guard" },
        { type: "special_summon_from_zone", zone: "graveyard" },
      ],
    },
    negationCost: [{ type: "reduce_self_atk", amount: 700 }],
  });
  assert.deepEqual(replacement.errors, []);
  assert.deepEqual(replacement.warnings, []);

  const activation = validateEffectActionTree({
    activationCosts: [
      { type: "remove_counters_from_field", counterType: "guard" },
    ],
  });
  assert.ok(
    messages(activation, "errors").some((message) =>
      message.includes("cannot open a dynamic selection"),
    ),
  );
});

test("replacement and negation roots receive deep shape validation", () => {
  const result = validateEffectActionTree({
    replacementEffect: {
      type: "destruction",
      costActions: [{ type: "draw" }],
    },
    negationCost: [{ type: "destroy", targetRef: "missing_target" }],
  });

  assert.ok(
    messages(result, "errors").some(
      (message) =>
        message.includes("replacementEffect.costActions[0]") &&
        message.includes('missing required field "amount"'),
    ),
  );
  assert.ok(
    messages(result, "errors").some(
      (message) =>
        message.includes("negationCost[0]") &&
        message.includes("does not match any effect target id"),
    ),
  );
});
