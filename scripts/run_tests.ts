import { spawn } from "node:child_process";
import { globSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_TEST_GLOB = "test/**/*.test.ts";

const TEST_DIRECTORY = "test";
const TEST_FILE_SUFFIX = ".test.ts";

// Node options that every run needs: tsx for the TypeScript sources. The SVG
// asset loader is not preloaded: it re-registers tsx in an off-thread hooks
// worker and makes every test process several times slower. Test files that
// import SVG modules register it themselves
// (`import "../scripts/register_node_asset_loader.js"`).
const BASE_NODE_ARGS = ["--import=tsx", "--test"] as const;

// Only test-runner flags that select, schedule or report tests are forwarded.
// Flags that change isolation or outcomes (--test-isolation, --test-only,
// --test-force-exit, --test-update-snapshots) and arbitrary Node options are
// rejected. Every flag must use the `--flag=value` form.
const ALLOWED_TEST_FLAGS: ReadonlySet<string> = new Set([
  "--test-name-pattern",
  "--test-skip-pattern",
  "--test-concurrency",
  "--test-timeout",
  "--test-reporter",
  "--test-reporter-destination",
  "--test-shard",
]);

// Defaults apply only when the caller does not pass the flag (D10). The
// timeout applies per test: it does not stop a file that hangs at module top
// level or keeps open handles after its tests finish. In CI that case is
// covered by the job's `timeout-minutes`.
const DEFAULT_TEST_FLAGS: ReadonlyArray<readonly [flag: string, value: string]> = [
  ["--test-concurrency", "1"],
  ["--test-timeout", "120000"],
];

export type TestRunnerInvocation =
  | { ok: true; args: string[] }
  | { ok: false; message: string };

function toForwardSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function isInsideDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return (
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

function normalizeTestPattern(
  rawPattern: string,
  cwd: string,
): { ok: true; pattern: string } | { ok: false; message: string } {
  const testRoot = path.resolve(cwd, TEST_DIRECTORY);
  const resolved = path.resolve(cwd, toForwardSlashes(rawPattern));
  if (path.relative(testRoot, resolved) === "") {
    return {
      ok: false,
      message: `Test path ${rawPattern} is the ${TEST_DIRECTORY}/ root itself; omit positionals to run ${DEFAULT_TEST_GLOB} or pass a file or glob inside ${TEST_DIRECTORY}/`,
    };
  }
  if (!isInsideDirectory(testRoot, resolved)) {
    return {
      ok: false,
      message: `Test path must stay inside ${TEST_DIRECTORY}/: ${rawPattern}`,
    };
  }
  // node --test resolves positionals against its cwd; pass a short relative
  // pattern so the command line stays small.
  const pattern = toForwardSlashes(path.relative(cwd, resolved));
  const matches = globSync(pattern, { cwd }).map(toForwardSlashes);
  if (matches.length === 0) {
    return { ok: false, message: `No test files match ${rawPattern}` };
  }
  const invalid = matches.find(
    (match) =>
      !match.endsWith(TEST_FILE_SUFFIX) ||
      !isInsideDirectory(testRoot, path.resolve(cwd, match)),
  );
  if (invalid !== undefined) {
    return {
      ok: false,
      message: `Test path ${rawPattern} matches ${invalid}, which is not a *${TEST_FILE_SUFFIX} file inside ${TEST_DIRECTORY}/`,
    };
  }
  return { ok: true, pattern };
}

export function createTestRunnerInvocation(
  argv: readonly string[],
  cwd: string,
): TestRunnerInvocation {
  const flags: string[] = [];
  const passedFlags = new Set<string>();
  const patterns: string[] = [];
  let endOfOptions = false;

  for (const argument of argv) {
    // A bare `--` ends the options, as in Node; later arguments are paths.
    if (!endOfOptions && argument === "--") {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && argument.startsWith("-")) {
      const separator = argument.indexOf("=");
      const flag = separator === -1 ? argument : argument.slice(0, separator);
      if (!ALLOWED_TEST_FLAGS.has(flag)) {
        return {
          ok: false,
          message: `Unsupported flag ${argument}. Allowed: ${[...ALLOWED_TEST_FLAGS].join(", ")}`,
        };
      }
      if (separator === -1 || separator === argument.length - 1) {
        return {
          ok: false,
          message: `Flag ${flag} requires the ${flag}=<value> form`,
        };
      }
      flags.push(argument);
      passedFlags.add(flag);
      continue;
    }

    const normalized = normalizeTestPattern(argument, cwd);
    if (!normalized.ok) return normalized;
    patterns.push(normalized.pattern);
  }

  for (const [flag, value] of DEFAULT_TEST_FLAGS) {
    if (!passedFlags.has(flag)) flags.push(`${flag}=${value}`);
  }

  return {
    ok: true,
    args: [
      ...BASE_NODE_ARGS,
      ...flags,
      ...(patterns.length > 0 ? patterns : [DEFAULT_TEST_GLOB]),
    ],
  };
}

// Node gives the entry module the real path in import.meta.url, while argv[1]
// keeps the path as typed. Both sides are resolved to real paths so a checkout
// reached through a symlink or a Windows junction still runs main().
export function isEntryModule(
  entry: string | undefined,
  moduleUrl: string,
): boolean {
  if (!entry) return false;
  let entryPath: string;
  let modulePath: string;
  try {
    entryPath = realpathSync(path.resolve(entry));
    modulePath = realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
  return process.platform === "win32"
    ? entryPath.toLowerCase() === modulePath.toLowerCase()
    : entryPath === modulePath;
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const invocation = createTestRunnerInvocation(process.argv.slice(2), cwd);
  if (!invocation.ok) {
    console.error(`[test-runner] ${invocation.message}`);
    process.exitCode = 1;
    return;
  }

  // The runner is always the root of its own test run. An inherited
  // NODE_TEST_CONTEXT (for example when a test spawns this script) makes the
  // child `node --test` skip every file and still exit 0, so it is removed.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;

  const exitCode = await new Promise<number>((resolveExitCode, reject) => {
    const child = spawn(process.execPath, invocation.args, {
      cwd,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("close", (code) => resolveExitCode(code ?? 1));
  });
  process.exitCode = exitCode;
}

if (isEntryModule(process.argv[1], import.meta.url)) await main();
