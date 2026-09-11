import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

const TEST_ROOT = path.resolve(process.cwd(), "test");

async function collectTestFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTestFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && /\.test\.(?:js|ts)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

const testFiles = (await collectTestFiles(TEST_ROOT)).sort((left, right) =>
  left.localeCompare(right, "en"),
);

if (testFiles.length === 0) {
  console.error(
    `[test-runner] No .test.js or .test.ts files found under ${
      path.relative(process.cwd(), TEST_ROOT) || "test"
    }.`,
  );
  process.exitCode = 1;
} else {
  const exitCode = await new Promise<number>((resolveExitCode, reject) => {
    const child = spawn(
      process.execPath,
      ["--import=tsx", "--test", "--test-concurrency=1", ...testFiles],
      {
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.once("error", reject);
    child.once("close", (code) => resolveExitCode(code ?? 1));
  });
  process.exitCode = exitCode;
}
