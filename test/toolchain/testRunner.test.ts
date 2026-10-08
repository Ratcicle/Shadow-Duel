import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { globSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DEFAULT_TEST_GLOB,
  createTestRunnerInvocation,
  isEntryModule,
  type TestRunnerInvocation,
} from "../../scripts/run_tests.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
// The asset loader is deliberately not preloaded (it slows every test process
// several times); SVG-importing test files register it themselves.
const BASE_ARGS = ["--import=tsx", "--test"];

function argsOf(invocation: TestRunnerInvocation): string[] {
  assert.equal(invocation.ok, true, invocation.ok ? "" : invocation.message);
  return invocation.ok ? invocation.args : [];
}

function messageOf(invocation: TestRunnerInvocation): string {
  assert.equal(invocation.ok, false, "the invocation should be rejected");
  return invocation.ok ? "" : invocation.message;
}

test("default invocation loads tsx without preloading the asset loader and passes the glob to node", () => {
  const args = argsOf(createTestRunnerInvocation([], root));
  assert.deepEqual(args, [
    ...BASE_ARGS,
    "--test-concurrency=1",
    "--test-timeout=120000",
    DEFAULT_TEST_GLOB,
  ]);
  assert.ok(args.join(" ").length < 300, "node --test expands the glob; no file list is forwarded");
});

test("explicit concurrency and timeout replace the defaults without duplicates", () => {
  const args = argsOf(createTestRunnerInvocation(["--test-concurrency=3", "--test-timeout=5000"], root));
  assert.deepEqual(args, [...BASE_ARGS, "--test-concurrency=3", "--test-timeout=5000", DEFAULT_TEST_GLOB]);
});

test("allowlisted test flags pass through in the --flag=value form", () => {
  const flags = [
    "--test-name-pattern=foo",
    "--test-skip-pattern=bar",
    "--test-reporter=tap",
    "--test-reporter-destination=stdout",
    "--test-shard=1/2",
  ];
  const args = argsOf(createTestRunnerInvocation(flags, root));
  assert.deepEqual(args, [...BASE_ARGS, ...flags, "--test-concurrency=1", "--test-timeout=120000", DEFAULT_TEST_GLOB]);
});

test("flags outside the allowlist and the space-separated form are rejected", () => {
  for (const flag of [
    "--inspect",
    "-r",
    "--test-only",
    "--test-force-exit",
    "--test-update-snapshots",
    "--test-isolation=none",
  ]) {
    assert.match(messageOf(createTestRunnerInvocation([flag], root)), /Unsupported flag/, flag);
  }
  assert.match(
    messageOf(createTestRunnerInvocation(["--test-name-pattern", "foo"], root)),
    /--test-name-pattern=<value>/,
  );
  assert.match(messageOf(createTestRunnerInvocation(["--test-timeout="], root)), /--test-timeout=<value>/);
});

test("positionals are normalized, contained in test/ and must match test files", () => {
  for (const spelling of [
    "test/lpPresentation.test.ts",
    "./test/lpPresentation.test.ts",
    "test\\lpPresentation.test.ts",
    path.join(root, "test", "lpPresentation.test.ts"),
  ]) {
    const args = argsOf(createTestRunnerInvocation([spelling], root));
    assert.equal(args.at(-1), "test/lpPresentation.test.ts", spelling);
    assert.equal(args.includes(DEFAULT_TEST_GLOB), false, "explicit positionals replace the default glob");
  }
  assert.equal(argsOf(createTestRunnerInvocation(["test/toolchain/*.test.ts"], root)).at(-1), "test/toolchain/*.test.ts");

  assert.equal(messageOf(createTestRunnerInvocation(["test/nope.test.ts"], root)), "No test files match test/nope.test.ts");
  for (const escape of ["test/../src/x.test.ts", "../test/lpPresentation.test.ts", "src/core/Game.ts"]) {
    assert.match(messageOf(createTestRunnerInvocation([escape], root)), /must stay inside test\//, escape);
  }
  for (const testRoot of ["test", "test/", "./test"]) {
    assert.match(
      messageOf(createTestRunnerInvocation([testRoot], root)),
      /is the test\/ root itself; omit positionals to run test\/\*\*\/\*\.test\.ts/,
      testRoot,
    );
  }
  assert.match(
    messageOf(createTestRunnerInvocation(["test/helpers/*.ts"], root)),
    /is not a \*\.test\.ts file/,
  );
});

test("a bare -- ends the options and is not forwarded", () => {
  assert.deepEqual(argsOf(createTestRunnerInvocation(["--", "test/lpPresentation.test.ts"], root)), [
    ...BASE_ARGS,
    "--test-concurrency=1",
    "--test-timeout=120000",
    "test/lpPresentation.test.ts",
  ]);
  // After the marker an argument that looks like a flag is a path and must be contained in test/.
  assert.match(messageOf(createTestRunnerInvocation(["--", "--test-only"], root)), /must stay inside test\//);
});

test("the entry guard compares real paths, so a linked checkout still runs main()", (t) => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "shadow-duel-runner-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const realDirectory = path.join(scratch, "real");
  const linkedDirectory = path.join(scratch, "linked");
  mkdirSync(realDirectory);
  const realEntry = path.join(realDirectory, "run_tests.ts");
  writeFileSync(realEntry, "");
  // A junction needs no elevated rights on Windows; other platforms ignore the type.
  symlinkSync(realDirectory, linkedDirectory, "junction");
  const moduleUrl = pathToFileURL(realEntry).href;

  assert.equal(isEntryModule(path.join(linkedDirectory, "run_tests.ts"), moduleUrl), true);
  assert.equal(isEntryModule(realEntry, moduleUrl), true);
  assert.equal(isEntryModule(path.relative(process.cwd(), realEntry), moduleUrl), true);
  assert.equal(isEntryModule(path.join(realDirectory, "other.ts"), moduleUrl), false);
  assert.equal(isEntryModule(undefined, moduleUrl), false);
  assert.equal(isEntryModule(path.join(root, "scripts", "run_tests.ts"), moduleUrl), false);
});

test("the default glob selects only test files under test/", () => {
  const matches = globSync(DEFAULT_TEST_GLOB, { cwd: root }).map(match => match.replace(/\\/g, "/"));
  assert.ok(matches.length > 0);
  for (const match of matches) {
    assert.ok(match.startsWith("test/") && match.endsWith(".test.ts"), match);
  }
});

function runRunner(argv: readonly string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["--import=tsx", "scripts/run_tests.ts", ...argv], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  });
}

function environmentWithoutTestContext(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

const LP_TEST_NAME = "LP counters and reduced-motion payment animations retain fractions";
const LP_FILTER = ["test/lpPresentation.test.ts", "--test-name-pattern=LP counters", "--test-reporter=tap"];

// lpPresentation.test.ts imports SVG modules through Renderer and registers the
// asset loader itself, so these cases also prove that a self-loading file runs
// under the runner without a preloaded loader, besides spawn, filtering and exit code.
test("the runner executes a filtered real test file", () => {
  const child = runRunner(LP_FILTER, environmentWithoutTestContext());
  const output = child.stdout + child.stderr;
  assert.equal(child.status, 0, output);
  assert.match(child.stdout, new RegExp(`^ok 1 - ${LP_TEST_NAME}$`, "m"), output);
  assert.match(child.stdout, /^# tests 1$/m, output);
  assert.match(child.stdout, /^# pass 1$/m, output);
  assert.match(child.stdout, /^# fail 0$/m, output);
});

test("the runner removes an inherited NODE_TEST_CONTEXT instead of silently skipping files", () => {
  const child = runRunner(LP_FILTER, { ...environmentWithoutTestContext(), NODE_TEST_CONTEXT: "child-v8" });
  const output = child.stdout + child.stderr;
  assert.equal(child.status, 0, output);
  assert.match(child.stdout, new RegExp(`^ok 1 - ${LP_TEST_NAME}$`, "m"), output);
  assert.match(child.stdout, /^# pass 1$/m, output);
});

test("a name pattern without matches runs no real test", () => {
  const child = runRunner(
    ["test/lpPresentation.test.ts", "--test-name-pattern=__no_test_has_this_name__", "--test-reporter=tap"],
    environmentWithoutTestContext(),
  );
  const output = child.stdout + child.stderr;
  // node --test reports the file itself when it contributes no tests; its own plan is empty.
  assert.match(child.stdout, /^1\.\.0$/m, output);
  assert.doesNotMatch(child.stdout, new RegExp(LP_TEST_NAME), output);
});

test("the runner exits 1 when a positional matches no test file", () => {
  const child = runRunner(["test/does-not-exist.test.ts"], environmentWithoutTestContext());
  assert.equal(child.status, 1, child.stdout + child.stderr);
  assert.match(child.stderr, /No test files match test\/does-not-exist\.test\.ts/);
});
