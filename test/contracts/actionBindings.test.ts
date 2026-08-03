import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  ACTION_BINDINGS,
  getActionBindingLabel,
  listActionBindingTypes,
} from "../../src/core/actionHandlers/actionBindings.js";
import {
  ACTION_CATALOG,
  listCatalogActionTypes,
} from "../../src/core/actionHandlers/actionCatalog.js";
import { walkEffectActions } from "../../src/core/actionHandlers/actionWalker.js";
import {
  ActionHandlerRegistry,
  registerDefaultHandlers,
} from "../../src/core/ActionHandlers.js";
import { cardDatabase } from "../../src/data/cards.js";

const LEGACY_BINDING_ORDER_SHA256 =
  "4d0cf6ce3d129f300a0f6c9a95ff79d1679ba2568c9e37c3271b3a329aa92734";

function bindingOrderDigest(types: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(types)).digest("hex");
}

test("canonical bindings preserve the complete legacy registry", () => {
  const bindingTypes = listActionBindingTypes();
  const catalogTypes = listCatalogActionTypes();
  const registry = new ActionHandlerRegistry();
  registerDefaultHandlers(registry);

  assert.equal(bindingTypes.length, 109);
  assert.equal(bindingOrderDigest(bindingTypes), LEGACY_BINDING_ORDER_SHA256);
  assert.deepEqual(registry.listTypes(), bindingTypes);
  assert.deepEqual([...bindingTypes].sort(), catalogTypes);

  const direct = bindingTypes.filter(
    (type) => ACTION_BINDINGS[type].kind === "direct",
  );
  const proxy = bindingTypes.filter(
    (type) => ACTION_BINDINGS[type].kind === "proxy",
  );
  assert.equal(direct.length, 80);
  assert.equal(proxy.length, 29);

  for (const type of bindingTypes) {
    const binding = ACTION_BINDINGS[type];
    assert.equal(ACTION_CATALOG[type].handler, getActionBindingLabel(type));
    if (binding.kind === "direct") {
      assert.equal(binding.handler.name, binding.handlerId);
      assert.equal(registry.get(type), binding.handler);
    } else {
      assert.equal(ACTION_CATALOG[type].handler, `proxy:${binding.method}`);
      assert.equal(typeof registry.get(type), "function");
    }
  }
});

test("all action types reached by the canonical walker have bindings", () => {
  const usedTypes = new Set<string>();
  for (const card of cardDatabase) {
    for (const effect of card.effects ?? []) {
      const walk = walkEffectActions(effect);
      assert.deepEqual(walk.diagnostics, []);
      for (const visit of walk.visits) {
        const action = visit.action;
        if (
          action &&
          typeof action === "object" &&
          "type" in action &&
          typeof action.type === "string"
        ) {
          usedTypes.add(action.type);
        }
      }
    }
  }

  assert.equal(usedTypes.size, 100);
  for (const type of usedTypes) {
    assert.equal(
      Object.hasOwn(ACTION_BINDINGS, type),
      true,
      `Missing binding for ${type}`,
    );
  }
});

test("legacy aliases retain direct handler identity", () => {
  const aliases = [
    ["special_summon_from_zone", "special_summon_matching_level"],
    [
      "special_summon_from_hand_with_cost",
      "special_summon_from_hand_with_tiered_cost",
    ],
    ["banish", "banish_destroyed_monster"],
    ["selective_field_destruction", "destroy_targeted_cards"],
    [
      "buff_stats_temp",
      "reduce_self_atk",
      "grant_second_attack",
      "buff_stats_temp_with_second_attack",
    ],
    ["add_from_zone_to_hand", "search_any"],
  ] as const;

  for (const [firstType, ...otherTypes] of aliases) {
    const first = ACTION_BINDINGS[firstType];
    assert.equal(first.kind, "direct");
    if (first.kind !== "direct") continue;
    for (const type of otherTypes) {
      const candidate = ACTION_BINDINGS[type];
      assert.equal(candidate.kind, "direct");
      if (candidate.kind === "direct") {
        assert.equal(candidate.handler, first.handler);
      }
    }
  }
});
