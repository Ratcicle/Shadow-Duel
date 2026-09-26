import assert from "node:assert/strict";
import test from "node:test";
import { createPlacementPreference } from "../../src/ui/main/placementPreference.js";

test("placement preference defaults to automatic and persists only its own key", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>([["unrelated", "preserved"]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const first = createPlacementPreference();
  assert.equal(first.getMode(), "automatic");
  first.setMode("manual");
  assert.equal(createPlacementPreference().getMode(), "manual");
  assert.equal(values.get("unrelated"), "preserved");
  first.setMode("unknown");
  assert.equal(first.getMode(), "automatic");
  assert.equal(createPlacementPreference().getMode(), "automatic");
});

test("blocked browser storage keeps the live placement preference usable", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => { throw new Error("Storage blocked"); },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const preference = createPlacementPreference();
  assert.equal(preference.getMode(), "automatic");
  preference.setMode("manual");
  assert.equal(preference.getMode(), "manual");
});
