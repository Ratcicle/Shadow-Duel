import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureSimOptSet,
  useSimOpt,
} from "../../src/core/ai/common/simStateUtils.js";

test("legacy one-shot buckets normalize arrays to Sets without reordering", () => {
  const state = { _simOptUsed: ["first", "second", "first"] };

  const bucket = ensureSimOptSet(state);

  assert.equal(bucket, state._simOptUsed);
  assert.deepEqual([...bucket], ["first", "second"]);
  assert.equal(ensureSimOptSet(state), bucket);
});

test("legacy one-shot buckets replace unsupported values with an empty Set", () => {
  const state = { _simOptUsed: { stale: true } };

  const bucket = ensureSimOptSet(state);

  assert.equal(bucket, state._simOptUsed);
  assert.deepEqual([...bucket], []);
});

test("useSimOpt preserves empty-key and first-use semantics", () => {
  const state: { _simOptUsed?: Set<string> } = {};

  assert.equal(useSimOpt(state, null), true);
  assert.equal("_simOptUsed" in state, false);
  assert.equal(useSimOpt(state, "effect"), true);
  assert.equal(useSimOpt(state, "effect"), false);
  assert.deepEqual([...state._simOptUsed ?? []], ["effect"]);
});
