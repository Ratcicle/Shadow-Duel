import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ARCHITECTURE_IDS, ARCHITECTURE_SCENARIOS, architectureState, createArchitectureFixture, normalizeArchitectureValue, createArchitectureEncoding, expandArchitectureValue, architectureDifferences } from "../test/helpers/architectureBaseline.js";
import { required, unsafeFixture } from "../test/helpers/fixtures.js";
import { createGameTreeCopy } from "../src/core/ai/common/gameTreeSimulation.js";
import { resolveRegisteredStrategy, getRegisteredStrategyIds } from "../src/core/ai/StrategyRegistry.js";
import { turnLineSearch } from "../src/core/ai/TurnLineSearch.js";
import type { AIStrategyBotPort, TurnLineSearchCompletion } from "../src/core/contracts/ai.js";
import type { GameTreeSimulationGameState } from "../src/core/contracts/aiState.js";
import { cardDatabase } from "../src/data/cards.js";

const args = process.argv.slice(2);
function argument(name: string) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : required(args[index + 1], name);
}
const output = resolve(argument("--output") || ".cache/ai-architecture/baseline/corpus.json");
const comparison = argument("--compare");
const SEED = 20261007;
const PROBE = { beamWidth: 2, maxDepth: 2, nodeBudget: 6, candidateLimit: 4, turnMode: "mainOnly" as const, useV2Evaluation: true };
const notes = [
  "Observation corpus, not a legality oracle or engine-parity golden; deliberate fixes may differ from this baseline.",
  "Synthetic main1 snapshots use real catalog/preset supply; reachability from a complete replay is not asserted.",
  "Fresh snapshot-bound strategies; no live Game, hidden opponent identities or _gameRef. Runtime-only fallbacks/previews/Chain are outside this corpus.",
  "Line probes use the recorded bounded test budget, not production search settings; actual strategy profiles are captured separately.",
  "All candidates remain ordered and include preferences/decision plans; definition IDs, scores, OPT, slots and distinct copy references are retained.",
  "State records the full mutable planning projection; repeated static effect definitions are omitted and the complete card database digest is recorded.",
  "Unknown draws/replan/unsupported signals and empty candidates remain visible; none imply correct execution.",
  "Content-addressed blocks deduplicate repeated observations without losing fields. A {$block: hash} expands to blocks[hash]; case digests are over expanded observations.",
];
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
const { blocks, pack } = createArchitectureEncoding();
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function strategyFor(id: typeof ARCHITECTURE_IDS[number], state: GameTreeSimulationGameState) {
  const Constructor = required(resolveRegisteredStrategy(id), id);
  // The canonical snapshot player structurally satisfies the strategy input.
  const actor: AIStrategyBotPort = state.bot;
  return new Constructor(actor);
}
const cases: Array<{ key: string; observation: unknown; digest: string }> = [];
const failures: Array<{ key: string; stage: string; error: string }> = [];
let lineResults = 0;
let emptyCandidates = 0;
let unsupported = 0;
assert.deepEqual([...getRegisteredStrategyIds()].sort(), [...ARCHITECTURE_IDS].sort());

// Any incidental random policy is replayable within each case. Restore globals
// after the run; this script is sequential and does not modify strategy budgets.
const originalRandom = Math.random;
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
try {
  for (const id of ARCHITECTURE_IDS) for (const scenario of ARCHITECTURE_SCENARIOS) for (const seat of ["bot", "player"] as const) {
    const key = `${id}/${scenario}/${seat}`;
    let rng = SEED;
    let randomCalls = 0;
    Math.random = () => { randomCalls++; rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 0x100000000; };
    const diagnostics: Array<{ level: string; message: string }> = [];
    console.log = () => {};
    console.warn = (...values: unknown[]) => diagnostics.push({ level: "warn", message: values.map(errorMessage).join(" ") });
    console.error = (...values: unknown[]) => diagnostics.push({ level: "error", message: values.map(errorMessage).join(" ") });
    const fixture = createArchitectureFixture(id, scenario, seat);
    const normalize = (value: unknown) => normalizeArchitectureValue(value, fixture.references);
    const strategy = strategyFor(id, fixture.state);
    const observation: Record<string, unknown> = { setup: fixture.normalizedSetup };
    let stage = "generation";
    try {
      const candidates = strategy.generateMainPhaseActions(fixture.state);
      observation.candidates = normalize(candidates);
      observation.generationStateChanged = digest(architectureState(fixture.state, fixture.references)) !== digest(fixture.normalizedSetup);
      observation.boardScore = strategy.evaluateBoardV2(fixture.state, fixture.state.bot);
      observation.profile = normalize(strategy.getPlanningProfile?.(fixture.state));
      if (candidates.length === 0) emptyCandidates++;
      stage = "first_simulated_step";
      const first = candidates[0];
      if (first) {
        // Identity references must come from the SAME initial snapshot as the
        // action, so clone fixture.state rather than generating replacement IDs.
        const step = createGameTreeCopy(fixture.state).state;
        delete step._gameRef;
        strategyFor(id, step).simulateMainPhaseAction(step, first);
        observation.firstStep = { action: normalize(first), state: architectureState(step, fixture.references),
          noStateChange: digest(architectureState(step, fixture.references)) === digest(architectureState(fixture.state, fixture.references)) };
        if (step._simUnsupportedActions?.length || step._simRequiresReplan) unsupported++;
      } else observation.firstStep = null;
      stage = "bounded_line";
      const lineInput = createGameTreeCopy(fixture.state).state;
      delete lineInput._gameRef;
      let completion: TurnLineSearchCompletion | null = null;
      const lineStrategy = strategyFor(id, lineInput);
      const line = await turnLineSearch(unsafeFixture<Parameters<typeof turnLineSearch>[0]>(lineInput,
        "Canonical isolated snapshot players contain no live Game or legacy combat-pair projection; TurnLine's narrower optional-name projection is sufficient here"),
        lineStrategy, { ...PROBE, onComplete: value => { completion = value; } });
      if (line) lineResults++;
      observation.line = line ? { action: normalize(line.action), sequence: normalize(line.sequence), score: line.score,
        baseScore: line.baseScore, milestoneScore: line.milestoneScore, milestones: normalize(line.milestones),
        completion: normalize(line.completion), reason: line.reason, finalState: architectureState(line.finalState, fixture.references) }
        : { action: null, completion: normalize(completion) };
    } catch (error) {
      const failure = { key, stage, error: errorMessage(error) };
      failures.push(failure);
      observation.failure = failure;
    }
    observation.random = { seed: SEED, calls: randomCalls, finalState: rng };
    observation.diagnostics = diagnostics;
    cases.push({ key, observation, digest: digest(observation) });
  }
} finally {
  Math.random = originalRandom;
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
}
const corpus = { schemaVersion: 1, revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  cardDatabaseDigest: digest(cardDatabase), seed: SEED, lineProbe: PROBE, notes,
  summary: { cases: cases.length, failures: failures.length, lineResults, emptyCandidates, unsupportedFirstSteps: unsupported },
  failures, cases: cases.map(entry => ({ ...entry, observation: pack(entry.observation) })), blocks };
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(corpus, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ output, digest: digest(cases), summary: corpus.summary }));
if (comparison) {
  const baseline: unknown = JSON.parse(await readFile(resolve(comparison), "utf8"));
  assert.ok(baseline && typeof baseline === "object");
  const before: unknown = Reflect.get(baseline, "cases");
  assert.ok(Array.isArray(before));
  const previous = new Map<string, string>(before.map((entry: unknown) => {
    assert.ok(entry && typeof entry === "object");
    const key: unknown = Reflect.get(entry, "key"), hash: unknown = Reflect.get(entry, "digest");
    assert.ok(typeof key === "string" && typeof hash === "string");
    return [key, hash];
  }));
  const changed = cases.filter(entry => previous.get(entry.key) !== entry.digest).map(entry => entry.key);
  const missing = [...previous.keys()].filter(key => !cases.some(entry => entry.key === key));
  const baselineBlocks: unknown = Reflect.get(baseline, "blocks") || {};
  assert.ok(baselineBlocks && typeof baselineBlocks === "object");
  const details = changed.map(key => {
    const old = before.find((entry: unknown) => entry && typeof entry === "object" && Reflect.get(entry, "key") === key);
    const current = required(cases.find(entry => entry.key === key));
    return { key, differences: architectureDifferences(old && typeof old === "object"
      ? expandArchitectureValue(Reflect.get(old, "observation"), baselineBlocks) : undefined, current.observation) };
  });
  await writeFile(output + ".diff.json", JSON.stringify({ changed, missing, details }, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ comparedWith: resolve(comparison), changed, missing, details: output + ".diff.json" }));
  if (changed.length || missing.length) process.exitCode = 2;
}
if (failures.length) process.exitCode = 1;
