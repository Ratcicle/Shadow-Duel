import assert from "node:assert/strict";
import test from "node:test";

import EffectEngine from "../../src/core/EffectEngine.js";
import {
  COST_EFFECT_METHODS,
  attachEffectModules,
  EFFECT_MODULE_MANIFESTS,
  FILTER_EFFECT_METHODS,
} from "../../src/core/effects/attachModules.js";

function attachmentEntries(): Array<readonly [string, (...args: never[]) => unknown]> {
  return EFFECT_MODULE_MANIFESTS.flatMap((manifest) =>
    Object.entries(manifest),
  );
}

test("EffectEngine installs unique module methods by reference", () => {
  const entries = attachmentEntries();
  const names = entries.map(([name]) => name);

  assert.equal(new Set(names).size, names.length);

  for (const [name, method] of entries) {
    assert.equal(typeof method, "function", `${name} must be callable`);
    assert.equal(Reflect.get(EffectEngine.prototype, name), method);
    const descriptor = Object.getOwnPropertyDescriptor(
      EffectEngine.prototype,
      name,
    );
    assert.deepEqual(
      descriptor && {
        value: descriptor.value,
        writable: descriptor.writable,
        enumerable: descriptor.enumerable,
        configurable: descriptor.configurable,
      },
      {
        value: method,
        writable: true,
        enumerable: true,
        configurable: true,
      },
    );
  }
});

test("attachment is idempotent for identical references", () => {
  const before = Object.getOwnPropertyDescriptor(
    EffectEngine.prototype,
    "applyDraw",
  );
  assert.doesNotThrow(() => attachEffectModules(EffectEngine));
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(EffectEngine.prototype, "applyDraw"),
    before,
  );
});

test("attachment preflight rejects missing and duplicate references", () => {
  const cardMatchesFilters = FILTER_EFFECT_METHODS.cardMatchesFilters;
  assert.equal(
    Reflect.set(FILTER_EFFECT_METHODS, "cardMatchesFilters", undefined),
    true,
  );
  try {
    assert.throws(
      () => attachEffectModules(class MissingReference {}),
      /exported value is not callable/,
    );
  } finally {
    assert.equal(
      Reflect.set(
        FILTER_EFFECT_METHODS,
        "cardMatchesFilters",
        cardMatchesFilters,
      ),
      true,
    );
  }

  assert.equal(
    Reflect.set(COST_EFFECT_METHODS, "cardMatchesFilters", cardMatchesFilters),
    true,
  );
  try {
    assert.throws(
      () => attachEffectModules(class DuplicateReference {}),
      /duplicate method cardMatchesFilters/,
    );
  } finally {
    assert.equal(
      Reflect.deleteProperty(COST_EFFECT_METHODS, "cardMatchesFilters"),
      true,
    );
  }
});

test("attachment preflight rejects collisions atomically", () => {
  class EarlyCollision {
    applyDraw(): void {}
  }
  assert.throws(
    () => attachEffectModules(EarlyCollision),
    /prototype already defines an incompatible member/,
  );

  class LateCollision {
    canActivateFieldSpellEffectPreview(): void {}
  }
  assert.throws(
    () => attachEffectModules(LateCollision),
    /prototype already defines an incompatible member/,
  );
  assert.equal(
    Object.hasOwn(LateCollision.prototype, "cardMatchesFilters"),
    false,
  );
});

test("an instance can still shadow an attached prototype method", () => {
  const instance = Object.create(EffectEngine.prototype) as EffectEngine;
  const replacement = (): true => true;

  Object.defineProperty(instance, "applyDraw", {
    value: replacement,
    writable: true,
    enumerable: true,
    configurable: true,
  });

  assert.equal(instance.applyDraw, replacement);
  assert.notEqual(instance.applyDraw, EffectEngine.prototype.applyDraw);
});
