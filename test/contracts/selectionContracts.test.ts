import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSelectionCandidateKey,
  canUseFieldTargeting,
  mergeCanonicalSelections,
  normalizeSelectionContract,
} from "../../src/core/game/selection/contract.js";
import {
  SELECTION_KINDS,
  SELECTION_PURPOSES,
} from "../../src/core/contracts/selection.js";
import type {
  RawSelectionCandidate,
  SelectionCandidate,
  SelectionNormalizationResult,
} from "../../src/core/contracts/selection.js";

const normalizationHost = { buildSelectionCandidateKey };

function normalize(contract: unknown): SelectionNormalizationResult {
  return Reflect.apply(normalizeSelectionContract, normalizationHost, [contract]);
}

test("selection constants expose the closed runtime vocabulary and stay frozen", () => {
  assert.equal(Object.isFrozen(SELECTION_KINDS), true);
  assert.equal(Object.isFrozen(SELECTION_PURPOSES), true);
  assert.deepEqual(SELECTION_PURPOSES, ["cost", "target", "resolution"]);
  assert.ok(SELECTION_KINDS.includes("choice"));
  assert.ok(SELECTION_KINDS.includes("fusion_materials"));
  assert.ok(SELECTION_KINDS.includes("destruction_replacement_target"));
});

test("normalization canonicalizes aliases while preserving candidate identity", () => {
  const candidate: RawSelectionCandidate = {
    cardRef: { id: 42, name: "Candidate" },
    controller: "player",
    zone: "banish",
    zoneIndex: 3,
  };
  const filters = { cardKind: "monster" as const };
  const metadata = { context: "contract-test" };
  const result = normalize({
    kind: "cost",
    timing: "activation",
    purpose: "cost",
    message: "Choose a cost",
    requirements: {
      id: "payment",
      title: "Payment",
      count: { min: 1, max: 2 },
      zone: "banish",
      owner: "any",
      filters,
      strategy: "lowest_atk",
      intent: "cost",
      candidates: [candidate],
    },
    ui: {
      allowCancel: false,
      preventCancel: true,
      message: "input-only",
    },
    metadata,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const contract = result.contract;
  assert.deepEqual(Object.keys(contract), [
    "kind",
    "message",
    "requirements",
    "ui",
    "metadata",
  ]);
  assert.deepEqual(Object.keys(contract.ui), [
    "allowCancel",
    "preventCancel",
    "useFieldTargeting",
    "allowEmpty",
  ]);
  assert.equal(Reflect.has(contract, "timing"), false);
  assert.equal(Reflect.has(contract, "purpose"), false);
  assert.equal(Reflect.has(contract.ui, "message"), false);
  assert.deepEqual(contract.requirements[0], {
    id: "payment",
    label: "Payment",
    min: 1,
    max: 2,
    zones: ["banish"],
    owner: "either",
    filters,
    allowSelf: true,
    distinct: true,
    candidates: [candidate],
  });
  assert.equal(Reflect.has(contract.requirements[0], "strategy"), false);
  assert.equal(Reflect.has(contract.requirements[0], "intent"), false);
  assert.strictEqual(contract.requirements[0].candidates[0], candidate);
  assert.equal(candidate.key, "player:banish:3:42");
  assert.notStrictEqual(contract.requirements[0].filters, filters);
  assert.notStrictEqual(contract.metadata, metadata);
});

test("normalization keeps override precedence and input objects defensive", () => {
  const candidate = { name: "Position", controller: "player" };
  const result = Reflect.apply(normalizeSelectionContract, normalizationHost, [
    {
      message: "raw",
      requirements: {
        candidates: [candidate],
        owner: "opponent",
      },
      ui: { allowCancel: true, useFieldTargeting: false },
    },
    {
      kind: "position_select",
      message: "override",
      ui: { allowCancel: false, useFieldTargeting: true },
    },
  ]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.contract.kind, "position_select");
  assert.equal(result.contract.message, "override");
  assert.equal(result.contract.ui.allowCancel, false);
  assert.equal(result.contract.ui.useFieldTargeting, true);
  assert.deepEqual(result.contract.requirements[0].zones, ["field"]);
  assert.equal(result.contract.requirements[0].owner, "opponent");
});

test("normalization infers zones and rejects each malformed boundary", () => {
  const inferred = normalize({
    requirements: [
      {
        candidates: [
          { zoneName: "hand", controller: "player" },
          { zone: "hand", controller: "player" },
        ],
      },
    ],
  });
  assert.equal(inferred.ok, true);
  if (inferred.ok) {
    assert.deepEqual(inferred.contract.requirements[0].zones, ["hand"]);
  }

  assert.deepEqual(normalize(null), {
    ok: false,
    reason: "Selection contract missing requirements.",
  });
  assert.deepEqual(normalize({ requirements: [null] }), {
    ok: false,
    reason: "Invalid selection requirements.",
  });
  assert.deepEqual(normalize({ requirements: [{ min: 2, max: 1 }] }), {
    ok: false,
    reason: "Selection requirements are invalid.",
  });
  assert.deepEqual(normalize({ requirements: [{ zones: [] }] }), {
    ok: false,
    reason: "Selection requirements missing zones.",
  });
});

test("field targeting and canonical phase merge preserve legacy semantics", () => {
  assert.equal(canUseFieldTargeting(undefined), false);
  assert.equal(canUseFieldTargeting(null), false);
  const card = { id: 7, name: "Field card" };
  const candidate = {
    key: buildSelectionCandidateKey(
      { cardRef: card, controller: "player", zone: "field", zoneIndex: 0 },
      0,
    ),
    cardRef: card,
    controller: "player",
    zone: "field" as const,
    zoneIndex: 0,
  } satisfies SelectionCandidate;
  assert.equal(
    canUseFieldTargeting([
      {
        id: "field",
        candidates: [candidate],
      },
    ]),
    true,
  );
  assert.equal(
    canUseFieldTargeting([
      {
        id: "mixed",
        candidates: [candidate, { ...candidate, zone: "graveyard" }],
      },
    ]),
    false,
  );
  assert.equal(canUseFieldTargeting([{ id: "empty", candidates: [] }]), false);

  const costKey = buildSelectionCandidateKey({ name: "cost" });
  const targetKey = buildSelectionCandidateKey({ name: "target" });
  const resolutionKey = buildSelectionCandidateKey({ name: "resolution" });
  assert.deepEqual(
    mergeCanonicalSelections({
      costSelections: { shared: [costKey], cost: [costKey] },
      targetSelections: { shared: [targetKey], target: [targetKey] },
      resolutionSelections: {
        shared: [resolutionKey],
        resolution: [resolutionKey],
      },
    }),
    {
      shared: [resolutionKey],
      cost: [costKey],
      target: [targetKey],
      resolution: [resolutionKey],
    },
  );
  assert.deepEqual(mergeCanonicalSelections(null), {});
});
