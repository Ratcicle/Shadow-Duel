import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_CATALOG } from "../src/core/actionHandlers/actionCatalog.js";

for (const type of ["remove_counters_from_field", "remove_all_counters_from_field"] as const) {
  test(`${type} documents the existing aggregated counter_removed event`, () => {
    assert.deepEqual(ACTION_CATALOG[type].emits, ["counter_removed"]);
  });
}
