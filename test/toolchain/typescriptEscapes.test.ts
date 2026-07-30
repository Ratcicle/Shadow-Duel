import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  auditTypeScriptSources,
  parseDebtRegistryMarkdown,
  type TypeScriptDebtEntry,
  type TypeScriptDebtRegistry,
} from "../../scripts/audit_typescript_escapes.js";

const REGISTRY_FORMAT = "shadow-duel-typescript-debt-registry";

function registry(
  entries: TypeScriptDebtEntry[] = [],
): TypeScriptDebtRegistry {
  return {
    format: REGISTRY_FORMAT,
    version: 1,
    entries,
  };
}

function entry(
  overrides: Partial<TypeScriptDebtEntry> = {},
): TypeScriptDebtEntry {
  return {
    id: "TSDEBT-001",
    path: "src/example.ts",
    kind: "explicit-any",
    justification: "Temporary compatibility boundary",
    removalStage: "Etapa 13",
    ...overrides,
  };
}

function diagnosticCodes(
  source: string,
  filePath = "src/example.ts",
  debtRegistry = registry(),
): string[] {
  return auditTypeScriptSources(
    [{ path: filePath, text: source }],
    debtRegistry,
  ).diagnostics.map((diagnostic) => diagnostic.code);
}

test("the checked-in debt registry is valid and initially empty", async () => {
  const markdown = await readFile(
    new URL("../../docs/migrations/typescript-debt.md", import.meta.url),
    "utf8",
  );
  const parsed = parseDebtRegistryMarkdown(markdown);

  assert.deepEqual(parsed.diagnostics, []);
  assert.deepEqual(parsed.registry.entries, []);
});

test("AST audit finds explicit any and nested casts without matching strings", () => {
  const codes = diagnosticCodes(`
    const prose = "type Alias = any; value as unknown as Alias";
    // This sentence mentions @ts-ignore but is not a directive.
    type Unsafe = any;
    const converted = value as unknown as Unsafe;
    void prose;
    void converted;
  `);

  assert.equal(
    codes.filter((code) => code === "unregistered-typescript-escape").length,
    2,
  );
  assert.equal(codes.includes("prohibited-ts-ignore"), false);
});

test("@ts-ignore is always prohibited", () => {
  const codes = diagnosticCodes(`
    // @ts-ignore
    consume(legacyValue);
  `);

  assert.deepEqual(codes, ["prohibited-ts-ignore"]);
});

test("@ts-nocheck is always prohibited", () => {
  const codes = diagnosticCodes(`
    // @ts-nocheck
    const invalid: number = "not a number";
  `);

  assert.deepEqual(codes, ["prohibited-ts-nocheck"]);
});

test("documented contract-negative tests may keep @ts-expect-error", () => {
  const accepted = diagnosticCodes(
    `
      // contract-negative: strings are not valid amounts
      // @ts-expect-error
      draw("two");
    `,
    "test/types/draw.contract.test.ts",
  );
  const missingReason = diagnosticCodes(
    `
      // @ts-expect-error
      draw("two");
    `,
    "test/types/draw.contract.test.ts",
  );
  const wrongDirectory = diagnosticCodes(
    `
      // contract-negative: strings are not valid amounts
      // @ts-expect-error
      draw("two");
    `,
    "test/toolchain/draw.test.ts",
  );

  assert.deepEqual(accepted, []);
  assert.deepEqual(missingReason, ["unregistered-typescript-escape"]);
  assert.deepEqual(wrongDirectory, ["unregistered-typescript-escape"]);
});

test("a matching debt entry and adjacent marker approve an escape", () => {
  const debt = entry();
  const codes = diagnosticCodes(
    `
      // typescript-debt: TSDEBT-001
      type Unsafe = any;
    `,
    debt.path,
    registry([debt]),
  );

  assert.deepEqual(codes, []);
});

test("unknown markers are rejected", () => {
  const codes = diagnosticCodes(`
    // typescript-debt: TSDEBT-999
    type Unsafe = any;
  `);

  assert.deepEqual(codes, ["unknown-debt-marker"]);
});

test("registry path mismatches are rejected and leave stale debt", () => {
  const debt = entry({ path: "src/elsewhere.ts" });
  const codes = diagnosticCodes(
    `
      // typescript-debt: TSDEBT-001
      type Unsafe = any;
    `,
    "src/example.ts",
    registry([debt]),
  );

  assert.deepEqual(codes, ["stale-debt-entry", "debt-path-mismatch"]);
});

test("registry kind mismatches are rejected and leave stale debt", () => {
  const debt = entry({ kind: "double-cast" });
  const codes = diagnosticCodes(
    `
      // typescript-debt: TSDEBT-001
      type Unsafe = any;
    `,
    debt.path,
    registry([debt]),
  );

  assert.deepEqual(codes, ["stale-debt-entry", "debt-kind-mismatch"]);
});

test("unused registry entries and orphan markers are rejected", () => {
  const debt = entry();
  const withoutMarker = diagnosticCodes(
    "export const safeValue = 1;",
    debt.path,
    registry([debt]),
  );
  const orphanMarker = diagnosticCodes(
    `
      // typescript-debt: TSDEBT-001
      export const safeValue = 1;
    `,
    debt.path,
    registry([debt]),
  );

  assert.deepEqual(withoutMarker, ["stale-debt-entry"]);
  assert.deepEqual(orphanMarker, [
    "stale-debt-entry",
    "orphan-debt-marker",
  ]);
});

test("registry validation rejects malformed IDs, paths, kinds and metadata", () => {
  const markdown = `<!-- typescript-debt-registry -->
\`\`\`json
{
  "format": "shadow-duel-typescript-debt-registry",
  "version": 1,
  "entries": [{
    "id": "temporary",
    "path": "../outside.ts",
    "kind": "shortcut",
    "justification": "",
    "removalStage": ""
  }]
}
\`\`\``;
  const parsed = parseDebtRegistryMarkdown(markdown);
  const codes = parsed.diagnostics.map((diagnostic) => diagnostic.code);

  assert.deepEqual(codes, [
    "invalid-debt-id",
    "invalid-debt-path",
    "invalid-debt-kind",
    "invalid-debt-justification",
    "invalid-debt-removal-stage",
  ]);
});
