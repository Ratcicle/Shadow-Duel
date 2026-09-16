import assert from "node:assert/strict";
import test from "node:test";

test("a JavaScript consumer resolves a .js specifier to TypeScript", async () => {
  // Keep the deliberate JavaScript fixture outside the checked TypeScript graph.
  // Its exports are checked at this runtime interoperability boundary.
  const consumer: unknown = await import(
    new URL("./fixtures/jsConsumer.js", import.meta.url).href
  );
  assert.ok(consumer && typeof consumer === "object");
  assert.ok("MIXED_MODE_VALUE" in consumer);
  assert.equal(consumer.MIXED_MODE_VALUE, "mixed-mode-ok");
  assert.ok("getMixedModeValue" in consumer);
  assert.ok(typeof consumer.getMixedModeValue === "function");
  assert.equal(consumer.getMixedModeValue(), consumer.MIXED_MODE_VALUE);
});
