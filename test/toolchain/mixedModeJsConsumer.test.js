import assert from "node:assert/strict";
import test from "node:test";
import {
  getMixedModeValue,
  MIXED_MODE_VALUE,
} from "./fixtures/mixedModule.js";

test("a JavaScript test resolves a .js specifier to TypeScript", () => {
  assert.equal(MIXED_MODE_VALUE, "mixed-mode-ok");
  assert.equal(getMixedModeValue(), MIXED_MODE_VALUE);
});
