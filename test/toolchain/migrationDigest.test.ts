import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import {
  canonicalJson,
  canonicalize,
  calculateMigrationDigests,
  loadDigestRegistry,
  loadMigrationPayload,
  parseDigestRegistry,
  validateDigestRegistry,
  verifyMigrationDigest,
  verifyMigrationDigestValues,
  type DigestRegistry,
} from "../../scripts/verify_migration_digest.js";

const EXPECTED_COMPONENTS = {
  cardDatabaseGroups:
    "25e36c9393d54218a4ccbabc264bf0623a4860fe2ae5e4f6c3a7d6d928a6a275",
  cardIdRanges:
    "ebab3971d3ae7d7bc39412842af19152290eff4cfc4b607c5328adcce7433022",
  cardIdMigration:
    "767cedfcc510631425c924d697210454a773b3d58c8021458fdfcd498ae5da89",
  banlist:
    "d41709efebdfa620f0b6d78eb70c4c188fe1ceba37bbbb7da808363cc3ba1ae7",
  actionCatalog:
    "b72dc32aaa0cb2d0e8608f8c92af607de9d358e9e97e7edb9810d12a04b07af7",
  locales:
    "39c0e0346c31c4c92dcfec488350295692be931d735ebc5fa2d85d8d300f60de",
};
const EXPECTED_AGGREGATE =
  "428e28a85f361880302a65745236cec6d153111d0d08fa6bf37cca45bf2b43dd";
const REGISTRY_URL = new URL(
  "../../docs/migrations/typescript-digests.json",
  import.meta.url,
);

async function registryFixture(): Promise<DigestRegistry> {
  return structuredClone(await loadDigestRegistry());
}

async function assertRegistryRejects(
  mutate: (registry: DigestRegistry) => void,
  expected: RegExp,
): Promise<void> {
  const registry = await registryFixture();
  mutate(registry);
  assert.throws(() => validateDigestRegistry(registry), expected);
}

test("canonicalizer sorts object keys recursively and preserves array order", () => {
  const value = {
    z: [{ d: 4, c: 3 }, 2],
    a: Object.assign(Object.create(null), { b: true, a: null }),
  };

  assert.equal(
    canonicalJson(value),
    '{"a":{"a":null,"b":true},"z":[{"c":3,"d":4},2]}',
  );
});

test("canonicalizer preserves an own __proto__ key", () => {
  const value = {
    safe: 2,
    ["__proto__"]: { x: 1 },
  };

  assert.equal(
    canonicalJson(value),
    '{"__proto__":{"x":1},"safe":2}',
  );
});

test("canonicalizer rejects values that JSON could omit or normalize", () => {
  const unsupportedValues: Array<[unknown, RegExp]> = [
    [undefined, /Unsupported undefined at \$/],
    [() => true, /Unsupported function at \$/],
    [Symbol("value"), /Unsupported symbol at \$/],
    [1n, /Unsupported bigint at \$/],
    [Number.NaN, /Non-finite number at \$/],
    [Number.POSITIVE_INFINITY, /Non-finite number at \$/],
    [new Date(0), /Non-plain object at \$/],
    [new Map(), /Non-plain object at \$/],
    [new Set(), /Non-plain object at \$/],
  ];

  for (const [value, expected] of unsupportedValues) {
    assert.throws(() => canonicalize(value), expected);
  }
  assert.throws(
    () => canonicalize({ nested: undefined }),
    /Undefined value at \$\.nested/,
  );
});

test("canonicalizer rejects cycles and malformed arrays", () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.throws(() => canonicalize(cycle), /Cycle at \$\.self/);

  const sparse: unknown[] = Array(1);
  assert.throws(
    () => canonicalize(sparse),
    /Sparse or extended array at \$/,
  );

  const extended: unknown[] = [1];
  Object.defineProperty(extended, "extra", {
    value: true,
    enumerable: true,
  });
  assert.throws(
    () => canonicalize(extended),
    /Sparse or extended array at \$/,
  );

  const symbolExtended: unknown[] = [1];
  Reflect.set(symbolExtended, Symbol("extra"), true);
  assert.throws(
    () => canonicalize(symbolExtended),
    /Sparse or extended array at \$/,
  );
});

test("canonicalizer rejects symbol and non-enumerable object keys", () => {
  const symbolObject = { visible: true };
  Reflect.set(symbolObject, Symbol("hidden"), true);
  assert.throws(
    () => canonicalize(symbolObject),
    /Symbol or non-enumerable key at \$/,
  );

  const hiddenObject = { visible: true };
  Object.defineProperty(hiddenObject, "hidden", {
    value: true,
    enumerable: false,
  });
  assert.throws(
    () => canonicalize(hiddenObject),
    /Symbol or non-enumerable key at \$/,
  );
});

test("baseline payload reproduces every approved component and aggregate", async () => {
  const payload = await loadMigrationPayload();
  const digests = calculateMigrationDigests(payload);

  assert.deepEqual(digests.components, EXPECTED_COMPONENTS);
  assert.equal(digests.aggregate, EXPECTED_AGGREGATE);
});

test("registry records the functional baseline and legacy replay signature", async () => {
  const registrySource = await readFile(REGISTRY_URL, "utf8");
  const registry = parseDigestRegistry(registrySource);

  assert.equal(registry.legacyReplaySignature, "1cc622e3");
  assert.equal(registry.approvals.length, 1);
  assert.equal(
    registry.approvals[0].functionalCommit,
    "cd41114621b2e9d0c4cb1a58f7e067d114c83519",
  );
  assert.equal(
    registry.approvals[0].approvedAt,
    "2026-07-30T10:35:24-03:00",
  );
  assert.deepEqual(registry.approvals[0].components, EXPECTED_COMPONENTS);
  assert.equal(registry.approvals[0].aggregate, EXPECTED_AGGREGATE);
});

test("registry rejects invalid format, version, empty history, and legacy signature", async () => {
  await assertRegistryRejects(
    (registry) => {
      Reflect.set(registry, "format", "unknown");
    },
    /registry\.format/,
  );
  await assertRegistryRejects(
    (registry) => {
      Reflect.set(registry, "version", 2);
    },
    /registry\.version/,
  );
  await assertRegistryRejects(
    (registry) => {
      registry.approvals = [];
    },
    /non-empty array/,
  );
  await assertRegistryRejects(
    (registry) => {
      registry.legacyReplaySignature = "1CC622E3";
    },
    /lowercase 8-character/,
  );
});

test("registry rejects malformed approvals and component keysets", async () => {
  await assertRegistryRejects(
    (registry) => {
      registry.approvals[0].functionalCommit = "cd41114";
    },
    /40-character commit hash/,
  );
  await assertRegistryRejects(
    (registry) => {
      registry.approvals[0].aggregate = "A".repeat(64);
    },
    /lowercase SHA-256 hash/,
  );
  await assertRegistryRejects(
    (registry) => {
      registry.approvals[0].components.locales = "A".repeat(64);
    },
    /lowercase SHA-256 hash/,
  );
  await assertRegistryRejects(
    (registry) => {
      registry.approvals[0].reason = "   ";
    },
    /reason must not be empty/,
  );
  await assertRegistryRejects(
    (registry) => {
      registry.approvals[0].approvedAt = "2026-07-30";
    },
    /ISO-8601 timestamp/,
  );
  await assertRegistryRejects(
    (registry) => {
      registry.approvals[0].approvedAt = "2026-02-31T10:35:24-03:00";
    },
    /valid ISO-8601 timestamp/,
  );
  await assertRegistryRejects(
    (registry) => {
      Reflect.deleteProperty(
        registry.approvals[0].components,
        "cardIdRanges",
      );
    },
    /components must contain exactly/,
  );
  await assertRegistryRejects(
    (registry) => {
      Reflect.set(
        registry.approvals[0].components,
        "unexpected",
        "a".repeat(64),
      );
    },
    /components must contain exactly/,
  );
});

test("registry requires strictly increasing timestamps and unique aggregates", async () => {
  await assertRegistryRejects(
    (registry) => {
      const second = structuredClone(registry.approvals[0]);
      second.aggregate = "a".repeat(64);
      second.approvedAt = "2026-07-30T10:35:23-03:00";
      registry.approvals.push(second);
    },
    /strictly later/,
  );
  await assertRegistryRejects(
    (registry) => {
      const second = structuredClone(registry.approvals[0]);
      second.approvedAt = "2026-07-30T10:35:25-03:00";
      registry.approvals.push(second);
    },
    /aggregate duplicates/,
  );
});

test("verification checks the runtime legacy signature and latest approval", async () => {
  const result = await verifyMigrationDigest();

  assert.equal(result.legacyReplaySignature, "1cc622e3");
  assert.equal(result.aggregate, EXPECTED_AGGREGATE);
  assert.deepEqual(result.components, EXPECTED_COMPONENTS);
  assert.equal(
    result.approval.functionalCommit,
    "cd41114621b2e9d0c4cb1a58f7e067d114c83519",
  );
});

test("verification treats only the final ordered approval as active", async () => {
  const payload = await loadMigrationPayload();
  const registry = await registryFixture();
  const latestApproval = structuredClone(registry.approvals[0]);
  registry.approvals[0].aggregate = "a".repeat(64);
  registry.approvals[0].components = {
    cardDatabaseGroups: "a".repeat(64),
    cardIdRanges: "a".repeat(64),
    cardIdMigration: "a".repeat(64),
    banlist: "a".repeat(64),
    actionCatalog: "a".repeat(64),
    locales: "a".repeat(64),
  };
  latestApproval.approvedAt = "2026-07-30T10:35:25-03:00";
  registry.approvals.push(latestApproval);

  const result = verifyMigrationDigestValues({
    payload,
    registry,
    legacyReplaySignature: "1cc622e3",
  });

  assert.equal(result.approval.approvedAt, latestApproval.approvedAt);
  assert.equal(result.aggregate, EXPECTED_AGGREGATE);
});

test("verification reports legacy, component, and aggregate divergences", async () => {
  const payload = await loadMigrationPayload();
  const registry = await registryFixture();

  assert.throws(
    () =>
      verifyMigrationDigestValues({
        payload,
        registry,
        legacyReplaySignature: "00000000",
      }),
    /Legacy replay signature mismatch/,
  );

  const componentMismatch = structuredClone(registry);
  componentMismatch.approvals[0].components.locales = "a".repeat(64);
  assert.throws(
    () =>
      verifyMigrationDigestValues({
        payload,
        registry: componentMismatch,
        legacyReplaySignature: "1cc622e3",
      }),
    /component mismatch for locales/,
  );

  const aggregateMismatch = structuredClone(registry);
  aggregateMismatch.approvals[0].aggregate = "a".repeat(64);
  assert.throws(
    () =>
      verifyMigrationDigestValues({
        payload,
        registry: aggregateMismatch,
        legacyReplaySignature: "1cc622e3",
      }),
    /aggregate mismatch/,
  );
});

test("verification never rewrites the approval registry", async () => {
  const beforeContent = await readFile(REGISTRY_URL, "utf8");
  const beforeStat = await stat(REGISTRY_URL);

  await verifyMigrationDigest();

  const afterContent = await readFile(REGISTRY_URL, "utf8");
  const afterStat = await stat(REGISTRY_URL);
  assert.equal(afterContent, beforeContent);
  assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs);
});
