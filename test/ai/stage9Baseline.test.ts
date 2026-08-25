import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import BaseStrategy from "../../src/core/ai/BaseStrategy.js";
import { getRegisteredStrategyIds } from "../../src/core/ai/StrategyRegistry.js";
import * as strategyUtils from "../../src/core/ai/StrategyUtils.js";
import { SIMULATED_ACTION_HANDLERS } from "../../src/core/ai/common/simulatedActions/index.js";

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function prototypeProjection(prototype: object) {
  return Object.getOwnPropertyNames(prototype).map((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    return [
      name,
      typeof descriptor?.value === "function" ? descriptor.value.length : null,
      Boolean(descriptor?.enumerable),
      Boolean(descriptor?.writable),
      Boolean(descriptor?.configurable),
    ];
  });
}

test("Stage 9 freezes the built-in strategy registry order", () => {
  const ids = getRegisteredStrategyIds();
  assert.deepEqual(ids, [
    "shadowheart",
    "luminarch",
    "void",
    "dragon",
    "arcanist",
    "miragebound",
    "bloomrot",
    "burningwest",
  ]);
  assert.equal(
    sha256(ids),
    "62c258ac7802e6aa0eb43a20465ad52186d1b0d9d124d51761eb57688f0ff547",
  );
});

test("Stage 9 freezes the simulated action handler order", () => {
  const actionTypes = Object.keys(SIMULATED_ACTION_HANDLERS);
  assert.equal(actionTypes.length, 64);
  assert.equal(
    sha256(actionTypes),
    "391c71c468cbb6939bfe55d2c7931219721a2425777bda3e1f7c780bbd9b32a6",
  );
});

test("Stage 9 freezes BaseStrategy and StrategyUtils public surfaces", () => {
  assert.equal(
    sha256(prototypeProjection(BaseStrategy.prototype)),
    "20ed6cb92e50b63620b1d3c8c174c5efb5342fb7acd3d6d7586a339ef825ab95",
  );
  assert.equal(
    sha256(Object.keys(strategyUtils)),
    "db327189dc12d97df0cb6a4ddba7adbf025560d2d5486b4088b9115fe7efcb4d",
  );
});
