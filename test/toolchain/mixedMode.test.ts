import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { OutputChunk, RollupOutput, RollupWatcher } from "rollup";
import { build } from "vite";
import {
  getMixedModeValue,
  MIXED_MODE_VALUE,
} from "./fixtures/mixedModule.js";

const fixtureDirectory = fileURLToPath(new URL("./fixtures/", import.meta.url));
const fixtureDist = path.join(fixtureDirectory, "dist");

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

function isRollupOutput(
  result: RollupOutput | RollupWatcher,
): result is RollupOutput {
  return "output" in result;
}

test("tsx resolves a .js specifier to a physical TypeScript module", () => {
  assert.equal(MIXED_MODE_VALUE, "mixed-mode-ok");
  assert.equal(getMixedModeValue(), MIXED_MODE_VALUE);
});

test("Vite resolves mixed-mode imports without writing build artifacts", async () => {
  assert.equal(await pathExists(fixtureDist), false);

  const result = await build({
    root: fixtureDirectory,
    configFile: false,
    publicDir: false,
    logLevel: "silent",
    build: {
      write: false,
      rollupOptions: {
        input: path.join(fixtureDirectory, "viteEntry.ts"),
        preserveEntrySignatures: "strict",
      },
    },
  });

  const results = Array.isArray(result) ? result : [result];
  assert.ok(results.every(isRollupOutput), "Vite returned an unexpected watcher");

  const entryChunk = results
    .filter(isRollupOutput)
    .flatMap((output) => output.output)
    .find(
      (entry): entry is OutputChunk =>
        entry.type === "chunk" && entry.isEntry,
    );

  assert.ok(entryChunk, "Vite did not produce an entry chunk");
  assert.match(entryChunk.code, /mixed-mode-ok/);
  assert.equal(await pathExists(fixtureDist), false);
});
