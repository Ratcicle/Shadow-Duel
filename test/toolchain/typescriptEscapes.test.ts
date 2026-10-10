import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  auditTypeScriptSources,
  runTypeScriptEscapeAudit,
} from "../../scripts/audit_typescript_escapes.js";

async function temporaryAuditRoot(context: TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "shadow-duel-type-audit-"));
  context.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function diagnosticCodes(source: string, filePath = "src/example.ts"): string[] {
  return auditTypeScriptSources([
    { path: filePath, text: source },
  ]).diagnostics.map((diagnostic) => diagnostic.code);
}

test("audit runs without auxiliary configuration", async (context) => {
  const directory = await temporaryAuditRoot(context);
  await writeFile(path.join(directory, "vite.config.ts"), "export const safe = 1;");

  assert.deepEqual(await runTypeScriptEscapeAudit(directory), {
    diagnostics: [],
    scannedFiles: 1,
  });
});

test("audit scans authored TypeScript and excludes generated directories", async (context) => {
  const directory = await temporaryAuditRoot(context);
  const files = [
    "src/example.ts",
    "src/view.tsx",
    "scripts/example.mts",
    "test/example.cts",
    "vite.config.ts",
    "src/node_modules/dependency/index.ts",
    "src/.cache/generated.ts",
    "dist/bundle.ts",
    "public/assets/art.ts",
  ];
  for (const filePath of files) {
    const absolutePath = path.join(directory, filePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, "type Unsafe = any;");
  }

  const result = await runTypeScriptEscapeAudit(directory);
  assert.equal(result.scannedFiles, 5);
  assert.deepEqual(result.diagnostics.map(({ path: filePath }) => filePath), [
    "scripts/example.mts",
    "src/example.ts",
    "src/view.tsx",
    "test/example.cts",
    "vite.config.ts",
  ]);
  assert.ok(result.diagnostics.every(({ code }) => code === "prohibited-explicit-any"));
});

test("AST audit rejects explicit any and nested casts without matching prose", () => {
  assert.deepEqual(diagnosticCodes(`
    const prose = "type Alias = any; value as unknown as Alias";
    // This sentence mentions @ts-ignore but is not a directive.
    type Unsafe = any;
    const converted = value as unknown as Unsafe;
    void prose;
    void converted;
  `), ["prohibited-explicit-any", "prohibited-double-cast"]);
});

test("nested casts are rejected through parentheses and angle-bracket assertions", () => {
  for (const expression of [
    "(value as unknown) as Card",
    "<Card>(<unknown>value)",
    "<Card>(value as unknown)",
  ]) {
    assert.deepEqual(diagnosticCodes(`const card = ${expression};`), [
      "prohibited-double-cast",
    ]);
  }
});

test("safe types and a single type assertion remain allowed", () => {
  assert.deepEqual(diagnosticCodes(`
    const input: unknown = value;
    const card = input as Card;
    const literal = { active: true } as const;
    const text = "@ts-nocheck";
  `), []);
});

test("diagnostics identify the source path and exact location", () => {
  const result = auditTypeScriptSources([
    { path: "src\\example.ts", text: "type Unsafe = any;" },
  ]);
  assert.equal(result.scannedFiles, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.path, "src/example.ts");
  assert.equal(result.diagnostics[0]?.line, 1);
  assert.equal(result.diagnostics[0]?.column, 15);
});

test("@ts-ignore and @ts-nocheck are prohibited even in contract tests", () => {
  for (const directive of ["ts-ignore", "ts-nocheck"]) {
    for (const filePath of ["src/example.ts", "test/types/example.contract.test.ts"]) {
      assert.deepEqual(diagnosticCodes(`
        // contract-negative: strings are not valid amounts
        // @${directive}
        draw("two");
      `, filePath), [`prohibited-${directive}`]);
    }
  }
});

test("documented contract-negative tests may use @ts-expect-error", () => {
  assert.deepEqual(diagnosticCodes(`
    // contract-negative: strings are not valid amounts
    // @ts-expect-error
    draw("two");
  `, "test/types/draw.contract.test.ts"), []);
});

test("@ts-expect-error requires an immediately preceding contract-negative reason", () => {
  for (const prefix of [
    "",
    "// unrelated explanation\n",
    "// contract-negative:\n",
    "// contract-negative:   \n",
    "// contract-negative: invalid amount\n\n",
  ]) {
    assert.deepEqual(diagnosticCodes(
      `${prefix}// @ts-expect-error\ndraw("two");`,
      "test/types/draw.contract.test.ts",
    ), ["prohibited-ts-expect-error"]);
  }
});

test("@ts-expect-error is prohibited outside contract tests", () => {
  for (const filePath of ["src/example.ts", "test/toolchain/draw.test.ts"]) {
    assert.deepEqual(diagnosticCodes(`
      // contract-negative: strings are not valid amounts
      // @ts-expect-error
      draw("two");
    `, filePath), ["prohibited-ts-expect-error"]);
  }
});

test("human decision prompts must go through the decision broker", () => {
  const unrecorded = `export async function choose(ui: { showConfirmPrompt(message: string): Promise<boolean> }) {
  return ui.showConfirmPrompt("Use it?");
}`;
  assert.deepEqual(diagnosticCodes(unrecorded, "src/core/example.ts"), ["unrecorded-human-prompt"]);
  // Optional-call and non-null forms are the same call.
  assert.deepEqual(diagnosticCodes(`export function f(ui: any) { return ui?.showTargetSelection?.({}); }`
    .replace("any", "{ showTargetSelection?(value: object): void }"), "src/core/example.ts"), ["unrecorded-human-prompt"]);
  // Outside src/ (tests, scripts) and in excluded UI/contract paths the guard does not apply.
  assert.deepEqual(diagnosticCodes(unrecorded, "test/example.ts"), []);
  assert.deepEqual(diagnosticCodes(unrecorded, "src/ui/renderer/example.ts"), []);
  assert.deepEqual(diagnosticCodes(unrecorded, "src/core/game/ui/interactions.ts"), []);
});

test("broker callbacks, their same-file helpers and human resolvers may prompt", () => {
  const brokered = `declare function requestOptionalConfirmation(game: object, player: object, human: () => Promise<boolean>): Promise<boolean>;
declare function requestResolutionOption(game: object, player: object, human: () => Promise<number>): Promise<number>;
type Ui = { showConfirmPrompt(message: string): Promise<boolean>; showNumberPrompt(message: string): Promise<number> };
async function askHuman(ui: Ui) { return ui.showConfirmPrompt("Helper?"); }
export async function decide(game: object, player: object, ui: Ui) {
  await requestOptionalConfirmation(game, player, () => ui.showConfirmPrompt("Inline?"));
  await requestOptionalConfirmation(game, player, () => askHuman(ui));
  // Handed to the broker by reference.
  const human = () => ui.showNumberPrompt("How many?");
  return requestResolutionOption(game, player, human);
}
export const port = { resolveHuman(ui: Ui) { return ui.showConfirmPrompt("Resolver?"); } };`;
  assert.deepEqual(diagnosticCodes(brokered, "src/core/example.ts"), []);
});

test("an allowlisted prompt that no longer exists is reported", () => {
  const withoutPrompt = "export function startTargetSelectionSession() { return null; }";
  assert.deepEqual(diagnosticCodes(withoutPrompt, "src/core/game/selection/session.ts"), ["stale-human-prompt-allowlist"]);
});
