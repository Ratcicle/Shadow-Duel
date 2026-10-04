import assert from "node:assert/strict";
import test from "node:test";
import { buildSelectionCandidateKey, getEligibleSelectionCandidates, hasFeasibleSelection, normalizeSelectionContract, pruneExcludedSelections } from "../../src/core/game/selection/contract.js";
import type { RawSelectionCandidate, RawSelectionRequirement } from "../../src/core/contracts/selection.js";

const candidate = (instanceId: number, slot = instanceId): RawSelectionCandidate => ({
  cardRef: { id: 509, instanceId },
  key: buildSelectionCandidateKey({ cardRef: { id: 509 }, zone: "graveyard", controller: "player", zoneIndex: slot }),
});
const requirement = (id: string, candidates: RawSelectionCandidate[], excludeTargetRefs: string[] = []): RawSelectionRequirement =>
  ({ id, min: 1, max: 1, zones: ["graveyard"], candidates, excludeTargetRefs });

test("dependent pools compare physical identity across keys and retain printed-ID twins", () => {
  const a = candidate(1), alias = candidate(1, 7), b = candidate(2);
  const requirements = [requirement("first", [a, b]), requirement("second", [alias, b], ["first"])];
  const state = { first: [a.key!], second: [alias.key!] };
  assert.deepEqual(getEligibleSelectionCandidates(requirements[1]!, requirements, state), [b]);
  pruneExcludedSelections(requirements, state);
  assert.deepEqual(state.second, []);
  assert.deepEqual(requirements[1]!.candidates, [alias, b]);
  state.first = [b.key!]; state.second = [alias.key!];
  pruneExcludedSelections(requirements, state);
  assert.deepEqual(state.second, [alias.key]);
});

test("normalization preserves and defensively copies reference exclusions", () => {
  const refs = ["first", "first"];
  const result = normalizeSelectionContract.call({ buildSelectionCandidateKey }, { kind: "target", requirements: [requirement("first", [candidate(1)]), requirement("second", [candidate(2)], refs)] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  refs.push("third");
  assert.deepEqual(result.contract.requirements[1]!.excludeTargetRefs, ["first"]);
});

test("finite three-group feasibility agrees with exhaustive physical assignments in either declaration order", () => {
  const pool = [candidate(1), candidate(2), candidate(3)];
  for (let left = 1; left < 8; left++) for (let middle = 1; middle < 8; middle++) for (let right = 1; right < 8; right++) {
    const pools = [left, middle, right].map(mask => pool.filter((_, index) => (mask & (1 << index)) !== 0));
    const expected = pools[0]!.some(a => pools[1]!.some(b => pools[2]!.some(c => a !== b && a !== c && b !== c)));
    const requirements = [requirement("a", pools[0]!), requirement("b", pools[1]!, ["a"]), requirement("c", pools[2]!, ["a", "b"])];
    assert.equal(hasFeasibleSelection(requirements), expected, `${left}/${middle}/${right}`);
    assert.equal(hasFeasibleSelection([...requirements].reverse()), expected, `reverse ${left}/${middle}/${right}`);
  }
});

test("feasibility respects multiple required targets and optional dependent groups", () => {
  const a = candidate(1), b = candidate(2), c = candidate(3);
  const first = { ...requirement("a", [a, b]), min: 2, max: 2 };
  assert.equal(hasFeasibleSelection([first, requirement("b", [a, b], ["a"])]), false);
  assert.equal(hasFeasibleSelection([first, requirement("b", [a, b, c], ["a"])]), true);
  assert.equal(hasFeasibleSelection([first, { ...requirement("b", [a, b], ["a"]), min: 0 }]), true);
});

test("AutoSelector finds the preferred legal completion in either requirement order", async () => {
  const { default: AutoSelector } = await import("../../src/core/AutoSelector.js");
  const selector = new AutoSelector({});
  const a = candidate(1), b = candidate(2), c = candidate(3);
  for (let left = 1; left < 8; left++) for (let right = 1; right < 8; right++) {
    const pools = [left, right].map(mask => [a, b, c].filter((_, index) => (mask & (1 << index)) !== 0));
    const expected = pools[0]!.some(x => pools[1]!.some(y => x !== y));
    const requirements = [requirement("a", pools[0]!), requirement("b", pools[1]!, ["a"])];
    for (const ordered of [requirements, [...requirements].reverse()]) {
      const result = selector.select({ requirements: ordered });
      assert.equal(result.ok, expected, `${left}/${right}`);
      if (result.ok) assert.notEqual(result.selections.a![0], result.selections.b![0]);
    }
  }
  const requirements = [requirement("a", [a, b]), requirement("b", [a], ["a"])];
  assert.equal(selector.select({ requirements }, { activationContext: { decisions: { selections: { a: [1] } } } }).ok, false);
  assert.deepEqual(selector.select({ requirements }, { activationContext: { decisions: { selections: { a: [2] } } } }), { ok: true, selections: { a: [b.key], b: [a.key] } });
});


test("AutoSelector can decline an optional preference to satisfy a required dependent group", async () => {
  const { default: AutoSelector } = await import("../../src/core/AutoSelector.js");
  const selector = new AutoSelector({}), a = candidate(1);
  const requirements = [{ ...requirement("optional", [a]), min: 0, strategy: "highest_atk" as const }, requirement("required", [a], ["optional"])];
  for (const ordered of [requirements, [...requirements].reverse()]) {
    const result = selector.select({ requirements: ordered });
    assert.deepEqual(result, { ok: true, selections: { optional: [], required: [a.key] } });
  }
  assert.equal(selector.select({ requirements }, { activationContext: { decisions: { selections: { optional: [1] } } } }).ok, false);
});
