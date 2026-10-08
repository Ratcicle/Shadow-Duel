import assert from "node:assert/strict";
import test from "node:test";
import { normalizeArchitectureValue, createArchitectureFixture, ARCHITECTURE_IDS, ARCHITECTURE_SCENARIOS, createArchitectureEncoding, expandArchitectureValue, architectureDifferences } from "../helpers/architectureBaseline.js";

test("architecture normalization preserves copy identity and exact decision choices", () => {
  const left = new Map<number | string, string>([[41, "bot:hand:0:501"], [42, "bot:hand:1:501"]]);
  const right = new Map<number | string, string>([[91, "bot:hand:0:501"], [92, "bot:hand:1:501"]]);
  const action = (first: number, second: number) => ({ cardId: 501, priority: 41,
    activationContext: { decisions: { selections: { cost: [first], target: [second] } } } });
  assert.deepEqual(normalizeArchitectureValue(action(41, 42), left), normalizeArchitectureValue(action(91, 92), right));
  assert.notDeepEqual(normalizeArchitectureValue(action(41, 42), left), normalizeArchitectureValue(action(42, 41), left));
  assert.equal(Reflect.get(normalizeArchitectureValue(action(41, 42), left) as object, "priority"), 41);
});

test("architecture blocks preserve the full observation and differences identify costs and decisions", () => {
  const value = { candidates: [{ priority: 12, activationContext: { decisions: { selections: { cost: ["copy-0"] } } } }],
    state: { lp: 6000, field: [{ instanceId: "copy-0", counters: { charge: 3 } }] }, padding: "repeated".repeat(80) };
  const encoding = createArchitectureEncoding();
  const encoded = encoding.pack([value, value]);
  assert.deepEqual(expandArchitectureValue(encoded, encoding.blocks), [value, value]);
  const changed = structuredClone(value);
  changed.state.lp = 4000;
  changed.candidates[0]!.activationContext.decisions.selections.cost = ["copy-1"];
  assert.deepEqual(architectureDifferences(value, changed).map(entry => entry.path),
    ["candidates[0].activationContext.decisions.selections.cost[0]", "state.lp"]);
});

test("architecture fixtures isolate all six situations for each real registered model and seat", () => {
  assert.equal(ARCHITECTURE_IDS.length, 9);
  assert.equal(ARCHITECTURE_SCENARIOS.length, 6);
  for (const id of ARCHITECTURE_IDS) for (const scenario of ARCHITECTURE_SCENARIOS) for (const seat of ["bot", "player"] as const) {
    const first = createArchitectureFixture(id, scenario, seat);
    const second = createArchitectureFixture(id, scenario, seat);
    assert.equal(first.state.bot.id, seat);
    assert.equal(first.state._gameRef, undefined);
    assert.equal(first.state.player.hand.length, 0, "opponent hidden identities are absent");
    assert.deepEqual(first.normalizedSetup, second.normalizedSetup);
    assert.notEqual(first.state.bot.hand, second.state.bot.hand);
    if (scenario === "full_field") assert.equal(first.state.bot.field.length, 5);
    if (scenario === "scarce") assert.equal(first.state.bot.lp, 1800);
    if (scenario === "recovery") assert.ok(first.state.bot.graveyard.length >= 2);
    const before = second.state.bot.lp;
    first.state.bot.lp = 1;
    assert.equal(second.state.bot.lp, before);
  }
});
