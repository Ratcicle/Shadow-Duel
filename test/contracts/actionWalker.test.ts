import assert from "node:assert/strict";
import test from "node:test";

import {
  formatActionPath,
  walkActionList,
  walkEffectActions,
} from "../../src/core/actionHandlers/actionWalker.js";
import { cardDatabase } from "../../src/data/cards.js";

function actionAt(result: ReturnType<typeof walkEffectActions>, path: string) {
  const visit = result.visits.find((candidate) => candidate.pathText === path);
  assert.ok(visit, `Expected action visit at ${path}`);
  return visit;
}

test("walker preserves root order, stages, flows, paths and lexical scopes", () => {
  const effect = {
    targets: [
      { id: "effect_target" },
      { id: "cost_target", intent: "cost" },
    ],
    activationCosts: [
      { type: "discard_from_hand", resultRef: "cost_result" },
      { type: "send_to_grave", targetRef: "cost_result" },
    ],
    activationCommitActions: [{ type: "pay_lp", amount: 100 }],
    actions: [
      {
        type: "optional_target_actions",
        resultRef: "parent_result",
        targets: [{ id: "action_target" }],
        actions: [
          {
            type: "draw",
            targetRef: "action_target",
            storeResultAs: "nested_result",
            actions: [{ type: "damage", targetRef: "nested_result" }],
          },
        ],
      },
      {
        type: "conditional_target_actions",
        targetRef: "effect_target",
        cases: [
          {
            targets: [{ id: "case_target" }],
            actions: [
              {
                type: "destroy",
                targetRef: "case_target",
                storeNegatedCardAs: "case_result",
              },
            ],
          },
        ],
        defaultActions: [{ type: "draw", targetRef: "case_result" }],
      },
      { type: "heal", targetRef: "parent_result", amount: 500 },
    ],
    replacementEffect: {
      type: "destruction",
      costActions: [{ type: "remove_counters_from_field", amount: 1 }],
    },
    negationCost: [{ type: "reduce_self_atk", amount: 700 }],
  };

  const result = walkEffectActions(effect, { path: ["effects", 0] });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.visits.map(({ stage, flow, pathText }) => ({ stage, flow, pathText })),
    [
      { stage: "cost", flow: "activation", pathText: "effects[0].activationCosts[0]" },
      { stage: "cost", flow: "activation", pathText: "effects[0].activationCosts[1]" },
      { stage: "commit", flow: "activation", pathText: "effects[0].activationCommitActions[0]" },
      { stage: "resolution", flow: "activation", pathText: "effects[0].actions[0]" },
      { stage: "resolution", flow: "activation", pathText: "effects[0].actions[0].actions[0]" },
      { stage: "resolution", flow: "activation", pathText: "effects[0].actions[0].actions[0].actions[0]" },
      { stage: "resolution", flow: "activation", pathText: "effects[0].actions[1]" },
      { stage: "resolution", flow: "activation", pathText: "effects[0].actions[1].defaultActions[0]" },
      { stage: "resolution", flow: "activation", pathText: "effects[0].actions[1].cases[0].actions[0]" },
      { stage: "resolution", flow: "activation", pathText: "effects[0].actions[2]" },
      { stage: "cost", flow: "replacement", pathText: "effects[0].replacementEffect.costActions[0]" },
      { stage: "cost", flow: "negation", pathText: "effects[0].negationCost[0]" },
    ],
  );

  const commit = actionAt(result, "effects[0].activationCommitActions[0]");
  assert.ok(commit.availableRefs.has("cost_result"));

  const nested = actionAt(result, "effects[0].actions[0].actions[0]");
  assert.ok(nested.targetIds.has("effect_target"));
  assert.ok(nested.targetIds.has("action_target"));
  assert.ok(nested.availableRefs.has("parent_result"));

  const grandchild = actionAt(
    result,
    "effects[0].actions[0].actions[0].actions[0]",
  );
  assert.ok(grandchild.availableRefs.has("nested_result"));

  const caseAction = actionAt(
    result,
    "effects[0].actions[1].cases[0].actions[0]",
  );
  assert.ok(caseAction.targetIds.has("case_target"));

  const fallback = actionAt(
    result,
    "effects[0].actions[1].defaultActions[0]",
  );
  assert.equal(fallback.targetIds.has("case_target"), false);
  assert.equal(fallback.availableRefs.has("case_result"), false);

  const followingSibling = actionAt(result, "effects[0].actions[2]");
  assert.ok(followingSibling.availableRefs.has("parent_result"));
  assert.equal(followingSibling.availableRefs.has("nested_result"), false);
  assert.equal(followingSibling.availableRefs.has("case_result"), false);

  const replacement = actionAt(
    result,
    "effects[0].replacementEffect.costActions[0]",
  );
  assert.equal(replacement.availableRefs.has("cost_result"), false);

  assert.deepEqual(result.visits.map((visit) => visit.sequence), [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
  ]);
});

test("walker traverses defensive containers without making them shared action fields", () => {
  const nested = (type: string) => [{ type }];
  const result = walkActionList([
    {
      type: "legacy_container",
      thenActions: nested("then"),
      ifActions: nested("if"),
      elseActions: nested("else"),
      optionalActions: nested("optional"),
      onSuccessActions: nested("success"),
      entries: [{ actions: nested("entry") }, { amount: 1 }],
    },
  ]);

  assert.deepEqual(
    result.visits.map((visit) =>
      typeof visit.action === "object" && visit.action !== null
        ? Reflect.get(visit.action, "type")
        : null,
    ),
    ["legacy_container", "then", "if", "else", "optional", "success", "entry"],
  );
});

test("walker diagnoses malformed containers and cycles while allowing shared objects", () => {
  interface CyclicAction {
    type: string;
    actions?: unknown;
  }

  const cyclic: CyclicAction = { type: "cyclic" };
  cyclic.actions = [cyclic];
  const shared = { type: "shared" };
  const result = walkActionList([
    null,
    { type: "bad", cases: {} },
    { type: "bad-list", actions: "not-an-array" },
    { type: "bad-entries", entries: "not-an-array" },
    cyclic,
    shared,
    shared,
  ]);

  assert.ok(result.diagnostics.some(({ code }) => code === "invalid-action"));
  assert.ok(result.diagnostics.some(({ code }) => code === "invalid-container"));
  assert.ok(
    result.diagnostics.some(
      ({ pathText }) => pathText === "actions[3].entries",
    ),
  );
  assert.ok(result.diagnostics.some(({ code }) => code === "invalid-action-list"));
  assert.ok(result.diagnostics.some(({ code }) => code === "cycle"));
  assert.equal(
    result.visits.filter((visit) => visit.action === shared).length,
    2,
  );
});

test("formatActionPath emits stable JavaScript-like diagnostics", () => {
  assert.equal(
    formatActionPath(["effects", 2, "actions", 0, "custom-key", 1]),
    'effects[2].actions[0]["custom-key"][1]',
  );
});

test("walker inventories every declarative action in the live database", () => {
  const types = new Set<string>();
  let actionCount = 0;
  const diagnostics: string[] = [];

  for (const card of cardDatabase) {
    for (const [effectIndex, effect] of (card.effects || []).entries()) {
      const result = walkEffectActions(effect, {
        path: ["cards", card.id, "effects", effectIndex],
      });
      actionCount += result.visits.length;
      diagnostics.push(...result.diagnostics.map((entry) => entry.message));
      for (const visit of result.visits) {
        if (!visit.action || typeof visit.action !== "object") continue;
        const type = Reflect.get(visit.action, "type");
        if (typeof type === "string") types.add(type);
      }
    }
  }

  assert.deepEqual(diagnostics, []);
  assert.equal(actionCount, 572);
  assert.equal(types.size, 100);
});
