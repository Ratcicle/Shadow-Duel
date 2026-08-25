import assert from "node:assert/strict";
import test from "node:test";

import {
  canUseSimOncePerTurn,
  ensureSimOncePerTurnBucket,
  ensureSimOptSet,
  markSimOncePerTurnUsed,
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

  assert.ok(bucket instanceof Set);
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

test("simulated once-per-turn buckets canonicalize every legacy shape", () => {
  const map = new Map([["existing", 2]]);
  const state = {
    _simOncePerTurn: {
      bot: map,
      player: new Set(["set-first", "set-second"]),
      array: [["tuple", 2], "single"],
      object: { first: 3, second: 1 },
    },
  };

  assert.equal(ensureSimOncePerTurnBucket(state, "bot"), map);
  assert.deepEqual(
    [...ensureSimOncePerTurnBucket(state, "player")],
    [["set-first", 1], ["set-second", 1]],
  );
  assert.deepEqual(
    [...ensureSimOncePerTurnBucket(state, "array")],
    [["tuple", 2], ["single", 1]],
  );
  assert.deepEqual(
    [...ensureSimOncePerTurnBucket(state, "object")],
    [["first", 3], ["second", 1]],
  );
});

test("simulated once-per-turn usage is counted and capped", () => {
  const state = { _simOncePerTurn: { bot: new Set(["legacy"]) } };

  assert.equal(canUseSimOncePerTurn(state, "legacy", 2), true);
  markSimOncePerTurnUsed(state, "legacy", 2);
  assert.equal(canUseSimOncePerTurn(state, "legacy", 2), false);
  markSimOncePerTurnUsed(state, "legacy", 2);
  assert.equal(ensureSimOncePerTurnBucket(state).get("legacy"), 2);
});
