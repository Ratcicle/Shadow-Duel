import assert from "node:assert/strict";
import test from "node:test";
import { MIXED_MODE_VALUE, getMixedModeValue } from "./fixtures/jsConsumer.js";

test("a JavaScript consumer resolves a .js specifier to TypeScript", () => {
  assert.equal(MIXED_MODE_VALUE, "mixed-mode-ok");
  assert.equal(getMixedModeValue(), MIXED_MODE_VALUE);
});
