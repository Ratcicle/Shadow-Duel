import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  auditTypeScriptSources,
  parseDebtRegistry,
  runTypeScriptEscapeAudit,
  type TypeScriptDebtEntry,
  type TypeScriptDebtRegistry,
} from "../../scripts/audit_typescript_escapes.js";

const REGISTRY_FORMAT = "shadow-duel-typescript-debt-registry";
const REGISTRY_PATH = "config/toolchain/typescript-debt.json";

async function temporaryAuditRoot(context: TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "shadow-duel-debt-"));
  context.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

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
  const source = await readFile(
    new URL("../../config/toolchain/typescript-debt.json", import.meta.url),
    "utf8",
  );
  const parsed = parseDebtRegistry(source);

  assert.deepEqual(parsed.diagnostics, []);
  assert.deepEqual(parsed.registry.entries, []);
});

test("debt parser rejects invalid JSON and Markdown wrappers", () => {
  for (const source of ["{", `\`\`\`json\n${JSON.stringify(registry())}\n\`\`\``]) {
    const parsed = parseDebtRegistry(source);
    assert.deepEqual(parsed.diagnostics.map(diagnostic => diagnostic.code), ["invalid-debt-registry-json"]);
    assert.equal(parsed.diagnostics[0]?.path, REGISTRY_PATH);
  }
});

test("debt parser rejects incorrect format and version", () => {
  const parsed = parseDebtRegistry(JSON.stringify({ ...registry(), format: "unknown", version: 2 }));
  assert.deepEqual(parsed.diagnostics.map(diagnostic => diagnostic.code), [
    "invalid-debt-registry-format", "invalid-debt-registry-version",
  ]);
  assert.ok(parsed.diagnostics.every(diagnostic => diagnostic.path === REGISTRY_PATH));
});

test("audit rejects a missing mandatory registry at its configuration path", async context => {
  const directory = await temporaryAuditRoot(context);
  await assert.rejects(runTypeScriptEscapeAudit(directory), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(Reflect.get(error, "code"), "ENOENT");
    assert.equal(Reflect.get(error, "path"), path.join(directory, REGISTRY_PATH));
    assert.doesNotMatch(error.message, /docs[\\/]migrations/);
    return true;
  });
});

test("audit loads pure JSON and keeps invalid or stale registries as failures", async context => {
  const directory = await temporaryAuditRoot(context);
  await mkdir(path.join(directory, "config", "toolchain"), { recursive: true });
  const cases = [
    { source: JSON.stringify(registry()), codes: [] },
    { source: "{", codes: ["invalid-debt-registry-json"] },
    { source: "null", codes: ["invalid-debt-registry"] },
    { source: JSON.stringify({ ...registry(), entries: [null] }), codes: ["invalid-debt-entry"] },
    { source: JSON.stringify(registry([entry()])), codes: ["stale-debt-entry"] },
  ];
  for (const { source, codes } of cases) {
    await writeFile(path.join(directory, REGISTRY_PATH), source);
    const result = await runTypeScriptEscapeAudit(directory);
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), codes);
    for (const diagnostic of result.diagnostics) {
      assert.equal(diagnostic.path, REGISTRY_PATH);
      assert.doesNotMatch(diagnostic.message, /docs[\\/]migrations/);
    }
  }
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
  const source = `{
  "format": "shadow-duel-typescript-debt-registry",
  "version": 1,
  "entries": [{
    "id": "temporary",
    "path": "../outside.ts",
    "kind": "shortcut",
    "justification": "",
    "removalStage": ""
  }]
}`;
  const parsed = parseDebtRegistry(source);
  const codes = parsed.diagnostics.map((diagnostic) => diagnostic.code);

  assert.deepEqual(codes, [
    "invalid-debt-id",
    "invalid-debt-path",
    "invalid-debt-kind",
    "invalid-debt-justification",
    "invalid-debt-removal-stage",
  ]);
});
