import assert from "node:assert/strict";
import test from "node:test";

import { validateEffectActionTree } from "../../src/core/CardDatabaseValidator.js";

function messages(
  result: ReturnType<typeof validateEffectActionTree>,
  kind: "errors" | "warnings",
): string[] {
  return result[kind].map((issue) => issue.message);
}

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
