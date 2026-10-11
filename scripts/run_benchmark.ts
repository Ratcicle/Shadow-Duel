import { execFileSync, fork, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format } from "node:util";
import {
  BENCHMARK_PROFILES,
  CONTROLS_SCHEMA,
  CONTROLS_SCHEMA_VERSION,
  DEFAULT_GUARD,
  DEFAULT_MAX_TURNS,
  DEFAULT_SEED_BASE,
  DEFAULT_TIMEOUT_MS,
  DUELS_FILE,
  DUEL_RECORD_VERSION,
  HEADER_FILE,
  JOURNAL_FILE,
  LOGS_DIRECTORY,
  PLANNER_MODES,
  PLANNER_MODE_SOURCES,
  PLANNER_TURN_MODES,
  PRESET_METRIC_IDS,
  RUN_END_FILE,
  RUN_END_SCHEMA,
  RUN_END_SCHEMA_VERSION,
  RUN_SCHEMA,
  RUN_SCHEMA_VERSION,
  SEED_RULE,
  WATCHDOG_GRACE_MS,
  array,
  buildMatrixCases,
  buildRunId,
  canonicalJson,
  caseListDigest,
  digestOf,
  isUint32,
  jsonValue,
  matchCaseFilter,
  object,
  parseBenchmarkCase,
  parseDuelRecord,
  parseEnvironmentDescription,
  parseRunConfig,
  parseRunHeader,
  recordLine,
  seedFor,
  sha256Hex,
  sortByCaseIndex,
  stripClock,
  string,
  validateCaseFilterPattern,
  workerLostRecord,
  type BenchmarkCase,
  type BenchmarkProfile,
  type Counter,
  type DuelOutcome,
  type DuelRecordV1,
  type EnvironmentDescription,
  type GuardLimits,
  type JsonValue,
  type PlannerMode,
  type PlannerModeSource,
  type PlannerTurnMode,
  type PresetMetricId,
  type RunConfig,
  type RunEnd,
  type RunHeader,
  type RunIdentity,
  type RunOrder,
} from "./benchmark/schema.js";
import { installMemoryStorage } from "./benchmark/environment.js";
import { increment, round, sortedCounter } from "./benchmark/statistics.js";

// Benchmark harness runner (Roadmap 2.2). The parent never loads the engine:
// a describe worker reads the engine facts, and every case runs in its own
// forked worker so that module state (Card.instanceId, log de-duplication,
// the strategy registry) never leaks between cases.

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const ASSET_LOADER_URL = pathToFileURL(path.join(REPO_ROOT, "scripts", "register_node_asset_loader.ts")).href;
const WORKER_EXEC_ARGV = ["--import=tsx", `--import=${ASSET_LOADER_URL}`];
/** H1: the normal duel's Main Phase beam (mainPhaseController defaults 2/2/100). */
const CANONICAL_BEAM = { beamWidth: 2, maxDepth: 2, nodeBudget: 100 } as const;

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_CHANGED = 2;
const EXIT_SIGINT = 130;

/** Configuration, identity or I/O problem: the runner exits with 1 before running cases. */
class RunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunnerError";
  }
}

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

// ── Command line ───────────────────────────────────────────────────────────

interface RunOptions {
  seeds: number | null;
  seedBase: number;
  presets: string[] | null;
  cases: string[] | null;
  profile: BenchmarkProfile;
  maxTurns: number;
  timeoutMs: number;
  guard: GuardLimits;
  guardObserve: boolean;
  plannerMode: PlannerMode | null;
  plannerTurnMode: PlannerTurnMode | null;
  plannerModeSource: PlannerModeSource;
  presetMetrics: PresetMetricId[];
  strategyOverrides: Record<string, string>;
  allowDirty: boolean;
  workers: number;
  order: RunOrder;
  out: string | null;
  resume: string | null;
  dryRun: boolean;
}

const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(["--dry-run", "--allow-dirty", "--guard-observe"]);
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--seeds", "--seed-base", "--presets", "--cases", "--profile", "--max-turns", "--timeout-ms", "--guard-decisions",
  "--guard-actions", "--guard-progress", "--planner-mode", "--planner-turn-mode", "--planner-mode-source",
  "--preset-metrics", "--strategy-override", "--workers", "--order", "--out", "--resume",
]);
const RESUME_FLAGS: ReadonlySet<string> = new Set(["--resume", "--workers", "--order"]);

function defaultWorkers(): number {
  return Math.max(1, Math.floor(os.availableParallelism() / 2));
}

function parseFlags(argv: readonly string[], valueFlags: ReadonlySet<string>, booleanFlags: ReadonlySet<string>): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? "";
    if (flags.has(flag)) throw new RunnerError(`Opção repetida: ${flag}.`);
    if (booleanFlags.has(flag)) {
      flags.set(flag, "true");
      continue;
    }
    if (!valueFlags.has(flag)) throw new RunnerError(`Argumento desconhecido: ${flag}.`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--") || !value.trim()) throw new RunnerError(`Falta o valor de ${flag}.`);
    flags.set(flag, value);
    index += 1;
  }
  return flags;
}

function positiveInteger(value: string, flag: string): number {
  const number = Number(value);
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(number) || number < 1) {
    throw new RunnerError(`${flag} deve ser um inteiro positivo.`);
  }
  return number;
}

function listValue(value: string, flag: string): string[] {
  const items = value.split(",").map(item => item.trim());
  if (items.some(item => !item)) throw new RunnerError(`${flag} deve ser uma lista separada por vírgulas, sem itens vazios.`);
  if (new Set(items).size !== items.length) throw new RunnerError(`${flag} tem itens repetidos.`);
  return items;
}

function choice<Value extends string>(value: string, options: readonly Value[], flag: string): Value {
  const match = options.find(option => option === value);
  if (match === undefined) throw new RunnerError(`${flag} deve ser um de: ${options.join(", ")}.`);
  return match;
}

export function parseRunArgs(argv: readonly string[]): RunOptions {
  const flags = parseFlags(argv, VALUE_FLAGS, BOOLEAN_FLAGS);
  const resume = flags.get("--resume") ?? null;
  if (resume !== null) {
    const extra = [...flags.keys()].filter(flag => !RESUME_FLAGS.has(flag));
    if (extra.length) throw new RunnerError(`--resume aceita só --workers e --order (recebeu ${extra.join(", ")}).`);
  }
  const value = (flag: string) => flags.get(flag) ?? null;
  const seeds = value("--seeds");
  if (resume === null && seeds === null) throw new RunnerError("--seeds N é obrigatório (piloto 2, baseline 20).");
  const seedBaseText = value("--seed-base");
  const seedBase = seedBaseText === null ? DEFAULT_SEED_BASE : Number(seedBaseText);
  if (seedBaseText !== null && (!/^\d+$/.test(seedBaseText.trim()) || !isUint32(seedBase))) {
    throw new RunnerError("--seed-base deve ser um inteiro entre 0 e 4294967295.");
  }
  const cases = value("--cases");
  const casePatterns = cases === null ? null : listValue(cases, "--cases");
  for (const pattern of casePatterns ?? []) {
    try {
      validateCaseFilterPattern(pattern);
    } catch (error) {
      throw new RunnerError(error instanceof Error ? error.message : String(error));
    }
  }
  const metrics = value("--preset-metrics");
  const presetMetrics = metrics === null ? [] : listValue(metrics, "--preset-metrics")
    .map(entry => choice(entry, PRESET_METRIC_IDS, "--preset-metrics"));
  const overrides: Record<string, string> = {};
  const overrideText = value("--strategy-override");
  for (const entry of overrideText === null ? [] : listValue(overrideText, "--strategy-override")) {
    const [target, source, ...rest] = entry.split("=");
    if (!target || !source || rest.length) throw new RunnerError("--strategy-override usa alvo=fonte[,alvo=fonte].");
    if (Object.hasOwn(overrides, target)) throw new RunnerError(`--strategy-override repete ${target}.`);
    if (target === source) throw new RunnerError(`--strategy-override ${entry} não muda nada.`);
    overrides[target] = source;
  }
  const integerOption = (flag: string, fallback: number) => {
    const text = value(flag);
    return text === null ? fallback : positiveInteger(text, flag);
  };
  const out = value("--out");
  if (resume !== null && out !== null) throw new RunnerError("--resume já indica a pasta de saída.");
  return {
    seeds: seeds === null ? null : positiveInteger(seeds, "--seeds"),
    seedBase,
    presets: value("--presets") === null ? null : listValue(value("--presets") ?? "", "--presets"),
    cases: casePatterns,
    profile: choice(value("--profile") ?? "canonical", BENCHMARK_PROFILES, "--profile"),
    maxTurns: integerOption("--max-turns", DEFAULT_MAX_TURNS),
    timeoutMs: integerOption("--timeout-ms", DEFAULT_TIMEOUT_MS),
    guard: {
      decisionsPerTurn: integerOption("--guard-decisions", DEFAULT_GUARD.decisionsPerTurn),
      actionsPerTurn: integerOption("--guard-actions", DEFAULT_GUARD.actionsPerTurn),
      progressPerTurn: integerOption("--guard-progress", DEFAULT_GUARD.progressPerTurn),
    },
    guardObserve: flags.has("--guard-observe"),
    plannerMode: value("--planner-mode") === null ? null : choice(value("--planner-mode") ?? "", PLANNER_MODES, "--planner-mode"),
    plannerTurnMode: value("--planner-turn-mode") === null ? null
      : choice(value("--planner-turn-mode") ?? "", PLANNER_TURN_MODES, "--planner-turn-mode"),
    plannerModeSource: choice(value("--planner-mode-source") ?? "arena", PLANNER_MODE_SOURCES, "--planner-mode-source"),
    presetMetrics,
    strategyOverrides: overrides,
    allowDirty: flags.has("--allow-dirty"),
    workers: integerOption("--workers", defaultWorkers()),
    order: choice(value("--order") ?? "forward", ["forward", "reverse"] as const, "--order"),
    out,
    resume,
    dryRun: flags.has("--dry-run"),
  };
}

// ── Identity ───────────────────────────────────────────────────────────────

function git(args: readonly string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] });
}

interface GitIdentity {
  commit: string;
  dirty: boolean;
  dirtyDiffSha256: string | null;
}

/** Commit plus a digest of every uncommitted change, including untracked files that are not ignored. */
function gitIdentity(): GitIdentity {
  const commit = git(["rev-parse", "HEAD"]).trim();
  const status = git(["status", "--porcelain", "--untracked-files=all"]);
  if (!status.trim()) return { commit, dirty: false, dirtyDiffSha256: null };
  const hash = createHash("sha256");
  hash.update(execFileSync("git", ["diff", "HEAD", "--binary"], { cwd: REPO_ROOT, maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] }));
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean).sort();
  for (const file of untracked) {
    hash.update(`\0untracked:${file}\0`);
    hash.update(sha256Hex(fs.readFileSync(path.join(REPO_ROOT, file))));
  }
  return { commit, dirty: true, dirtyDiffSha256: hash.digest("hex") };
}

function runIdentity(environment: EnvironmentDescription): RunIdentity {
  const gitState = gitIdentity();
  return {
    commit: gitState.commit,
    dirty: gitState.dirty,
    dirtyDiffSha256: gitState.dirtyDiffSha256,
    engineVersion: environment.engineVersion,
    cardDatabaseSignature: environment.cardDatabaseSignature,
    cardDatabaseSha256: environment.cardDatabaseSha256,
    node: process.version,
    lockfileSha256: sha256Hex(fs.readFileSync(path.join(REPO_ROOT, "package-lock.json"))),
  };
}

const IDENTITY_FIELDS: ReadonlyArray<keyof RunIdentity> = [
  "cardDatabaseSha256", "cardDatabaseSignature", "commit", "dirty", "dirtyDiffSha256", "engineVersion", "lockfileSha256", "node",
];

function identityDiff(start: RunIdentity, end: RunIdentity): Array<{ field: string; start: JsonValue; end: JsonValue }> {
  return IDENTITY_FIELDS.filter(field => start[field] !== end[field]).map(field => ({ field, start: start[field], end: end[field] }));
}

// ── Configuration ──────────────────────────────────────────────────────────

function sortedRecord(source: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(source).sort()) {
    const entry = source[key];
    if (entry !== undefined) result[key] = entry;
  }
  return result;
}

function buildConfig(options: RunOptions, environment: EnvironmentDescription): { config: RunConfig; cases: BenchmarkCase[] } {
  const known = environment.presets;
  const requested = options.presets ?? known;
  const unknown = requested.filter(preset => !known.includes(preset));
  if (unknown.length) throw new RunnerError(`Preset(s) desconhecido(s): ${unknown.join(", ")}. Disponíveis: ${known.join(", ")}.`);
  // The plan always follows the canonical preset order.
  const presets = known.filter(preset => requested.includes(preset));
  for (const [target, source] of Object.entries(options.strategyOverrides)) {
    for (const id of [target, source]) {
      if (!environment.strategyIds.includes(id)) {
        throw new RunnerError(`--strategy-override usa ${id}, que não é uma estratégia registrada (${environment.strategyIds.join(", ")}).`);
      }
    }
  }
  const speed = environment.instant;
  if (speed.useRenderer || speed.phaseDelayMs !== 0 || speed.actionDelayMs !== 0 || speed.battleDelayMs !== 0) {
    throw new RunnerError("O preset instant da Arena não roda mais sem renderer e com delays zerados; o harness depende disso (H1).");
  }
  if (options.seeds === null) throw new RunnerError("--seeds N é obrigatório.");
  const decks: RunConfig["decks"] = {};
  for (const preset of presets) {
    const deck = environment.decks[preset];
    if (!deck) throw new RunnerError(`O ambiente não tem lista de deck para ${preset}.`);
    decks[preset] = { main: [...deck.main], extra: [...deck.extra], mainSha256: digestOf(deck.main), extraSha256: digestOf(deck.extra) };
  }
  const allCases = buildMatrixCases({ presets, seeds: options.seeds, seedBase: options.seedBase });
  const cases = allCases.filter(entry => matchCaseFilter(options.cases, entry.caseId));
  if (!cases.length) throw new RunnerError("--cases não corresponde a nenhum caso planejado.");
  const config: RunConfig = {
    profile: options.profile,
    speed: "instant",
    beam: options.profile === "canonical"
      ? { ...CANONICAL_BEAM, source: "custom" }
      : { beamWidth: speed.beamWidth, maxDepth: speed.maxDepth, nodeBudget: speed.nodeBudget, source: "speed_preset" },
    planner: {
      arenaMode: speed.planner.mode,
      arenaTurnMode: speed.planner.turnMode,
      arenaBudgets: {
        beamWidth: speed.planner.beamWidth, maxDepth: speed.planner.maxDepth,
        nodeBudget: speed.planner.nodeBudget, candidateLimit: speed.planner.candidateLimit,
      },
      budgetsSource: "strategy_profile",
      customBudgets: false,
      modeOverride: options.plannerMode,
      turnModeOverride: options.plannerTurnMode,
      modeSource: options.plannerModeSource,
    },
    delays: {
      phaseDelayMs: speed.phaseDelayMs,
      aiActionDelayMs: speed.actionDelayMs,
      aiSuccessfulActionDelayMs: speed.actionDelayMs,
      aiPresentationStepDelayMs: speed.actionDelayMs,
      aiBattleDelayMs: speed.battleDelayMs,
      disablePresentationDelays: true,
      presentationDelayGate: "bypassed_by_zero_values",
      damageCalculationStatDelay: "gated",
    },
    environment: {
      renderer: "null", requestAnimationFrame: false, localStorage: "memory-empty", consoleLog: "silenced",
      isolation: "process-per-case", captureReplay: false,
    },
    maxTurns: options.maxTurns,
    timeoutMs: options.timeoutMs,
    timeoutOutcome: "error",
    stallGuard: { mode: options.guardObserve ? "observe" : "enforce", ...options.guard },
    availablePresets: [...known],
    presets,
    decks,
    decksSha256: digestOf(decks),
    banlistSha256: digestOf(environment.banlist),
    seeds: {
      base: options.seedBase,
      count: options.seeds,
      values: Array.from({ length: options.seeds }, (_, k) => seedFor(options.seedBase, k)),
      rule: SEED_RULE,
    },
    matrix: { mirrors: true, plannedCases: cases.length, caseListSha256: caseListDigest(cases) },
    presetMetrics: PRESET_METRIC_IDS.filter(id => options.presetMetrics.includes(id)),
    strategyOverrides: sortedRecord(options.strategyOverrides),
    caseFilter: options.cases,
  };
  return { config, cases };
}

function optionsFromHeader(header: RunHeader, workers: number, order: RunOrder): RunOptions {
  const config = header.config;
  return {
    seeds: config.seeds.count,
    seedBase: config.seeds.base,
    presets: [...config.presets],
    cases: config.caseFilter,
    profile: config.profile,
    maxTurns: config.maxTurns,
    timeoutMs: config.timeoutMs,
    guard: {
      decisionsPerTurn: config.stallGuard.decisionsPerTurn,
      actionsPerTurn: config.stallGuard.actionsPerTurn,
      progressPerTurn: config.stallGuard.progressPerTurn,
    },
    guardObserve: config.stallGuard.mode === "observe",
    plannerMode: config.planner.modeOverride,
    plannerTurnMode: config.planner.turnModeOverride,
    plannerModeSource: config.planner.modeSource,
    presetMetrics: [...config.presetMetrics],
    strategyOverrides: { ...config.strategyOverrides },
    allowDirty: header.identity.dirty,
    workers,
    order,
    out: null,
    resume: null,
    dryRun: false,
  };
}

// ── Output directory ───────────────────────────────────────────────────────

function insideRepository(target: string): string | null {
  const relative = path.relative(REPO_ROOT, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative;
}

function isGitIgnored(relative: string): boolean {
  const result = spawnSync("git", ["check-ignore", "-q", "--", relative.replaceAll("\\", "/")], { cwd: REPO_ROOT });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new RunnerError(`git check-ignore falhou para ${relative}.`);
}

/** Results never land in a versioned path or under docs/ (H5). */
export function validateOutputDirectory(target: string): string {
  const resolved = path.resolve(target);
  const relative = insideRepository(resolved);
  if (relative === null) return resolved;
  const first = relative.split(/[\\/]/, 1)[0] ?? "";
  if (first.toLowerCase() === "docs") throw new RunnerError(`${target} fica em docs/, que guarda só Markdown.`);
  if (!relative || !isGitIgnored(relative)) {
    throw new RunnerError(`${target} não é ignorado pelo git; use .cache/benchmark/... ou uma pasta fora do repositório.`);
  }
  return resolved;
}

function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(`${file}.tmp`, file);
}

function writeTextAtomic(file: string, text: string): void {
  fs.writeFileSync(`${file}.tmp`, text, "utf8");
  fs.renameSync(`${file}.tmp`, file);
}

// ── Process boundary ───────────────────────────────────────────────────────

/**
 * A worker failure: `message` is the first line, which may enter a record;
 * `detail` keeps the full text (stack included) for logs/ only.
 */
interface FatalReply {
  type: "fatal";
  message: string;
  detail: string;
}

type WorkerReply =
  | { type: "result"; record: DuelRecordV1; log: string }
  | { type: "description"; description: EnvironmentDescription }
  | FatalReply;

function parseWorkerReply(value: unknown): WorkerReply {
  const message = object(value, "worker message");
  switch (message.type) {
    case "result":
      return { type: "result", record: parseDuelRecord(message.record, "worker record"), log: string(message.log, "worker log", true) };
    case "description":
      return { type: "description", description: parseEnvironmentDescription(message.description) };
    case "fatal":
      return {
        type: "fatal",
        message: string(message.message, "worker fatal", true),
        detail: string(message.detail, "worker fatal detail", true),
      };
    default:
      throw new RunnerError(`Tipo inesperado de mensagem do worker: ${String(message.type)}.`);
  }
}

function forkWorker(mode: "--worker" | "--describe"): ChildProcess {
  return fork(SCRIPT_PATH, [mode], {
    cwd: REPO_ROOT,
    execArgv: WORKER_EXEC_ARGV,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    serialization: "json",
  });
}

/** Engine facts come from a fresh worker with the same loaders as the cases. */
function describeEnvironment(): Promise<EnvironmentDescription> {
  return new Promise((resolve, reject) => {
    const child = forkWorker("--describe");
    const stderr: Buffer[] = [];
    let description: EnvironmentDescription | null = null;
    let failure: string | null = null;
    child.stderr?.on("data", (chunk: Buffer) => { stderr.push(chunk); });
    child.on("message", (value: unknown) => {
      try {
        const reply = parseWorkerReply(value);
        if (reply.type === "description") description = reply.description;
        else if (reply.type === "fatal") failure = reply.detail || reply.message;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    });
    child.on("error", error => { failure ??= error.message; });
    child.once("exit", code => {
      if (description) resolve(description);
      else reject(new RunnerError(`O worker de descrição falhou (código ${code}): ${failure ?? Buffer.concat(stderr).toString("utf8").trim()}`));
    });
    child.send({ type: "describe" });
  });
}

// ── Journal ────────────────────────────────────────────────────────────────

interface JournalState {
  records: Map<string, DuelRecordV1>;
  truncatedBytes: number;
}

/** Reads a journal for --resume: only the last line may be incomplete, and it is truncated. */
function readJournal(file: string, planned: ReadonlyMap<string, BenchmarkCase>): JournalState {
  const records = new Map<string, DuelRecordV1>();
  if (!fs.existsSync(file)) return { records, truncatedBytes: 0 };
  const text = fs.readFileSync(file, "utf8");
  let keep = text;
  let truncatedBytes = 0;
  if (text.length && !text.endsWith("\n")) {
    keep = text.slice(0, text.lastIndexOf("\n") + 1);
    truncatedBytes = Buffer.byteLength(text, "utf8") - Buffer.byteLength(keep, "utf8");
    fs.truncateSync(file, Buffer.byteLength(keep, "utf8"));
  }
  const lines = keep.split("\n").filter(line => line.length > 0);
  lines.forEach((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new RunnerError(`${file}: a linha ${index + 1} não é JSON válido; só a última linha pode estar incompleta.`);
    }
    const record = parseDuelRecord(parsed, `${JOURNAL_FILE}:${index + 1}`);
    const entry = planned.get(record.caseId);
    if (!entry || !recordMatchesCase(record, entry)) throw new RunnerError(`${file}: a linha ${index + 1} (${record.caseId}) não é um caso planejado.`);
    const previous = records.get(record.caseId);
    if (previous && canonicalJson(stripClock(previous)) !== canonicalJson(stripClock(record))) {
      throw new RunnerError(`${file}: linhas duplicadas de ${record.caseId} diferem.`);
    }
    if (!previous) records.set(record.caseId, record);
  });
  return { records, truncatedBytes };
}

function recordMatchesCase(record: DuelRecordV1, entry: BenchmarkCase): boolean {
  return record.caseIndex === entry.caseIndex && record.caseId === entry.caseId && record.k === entry.k &&
    record.pair === entry.pair && record.mirror === entry.mirror && record.seats.player === entry.seat1 &&
    record.seats.bot === entry.seat2 && record.seed === entry.seed;
}

function logFileName(entry: BenchmarkCase): string {
  return `${String(entry.caseIndex).padStart(5, "0")}-${entry.seat1}-${entry.seat2}-${entry.k}.txt`;
}

// ── Worker pool ────────────────────────────────────────────────────────────

interface PoolOptions {
  cases: readonly BenchmarkCase[];
  config: RunConfig;
  workers: number;
  journalFile: string;
  logsDirectory: string;
  onRecord(record: DuelRecordV1): void;
  progressBase: number;
  progressTotal: number;
}

type PoolOutcome = "completed" | "sigint" | "environment";

function describeOutcome(record: DuelRecordV1): string {
  const outcome = record.outcome;
  if (outcome.status === "error") return `erro ${outcome.errorKind ?? "?"}`;
  return `${outcome.decidedBy ?? "?"} ${outcome.draw ? "empate" : `vence ${outcome.winnerPreset ?? "?"}`}`;
}

function runPool(options: PoolOptions): Promise<PoolOutcome> {
  return new Promise(resolve => {
    const queue = [...options.cases];
    const running = new Set<ChildProcess>();
    const fd = fs.openSync(options.journalFile, "a");
    const heldLost: Array<{ record: DuelRecordV1; entry: BenchmarkCase; logText: string }> = [];
    let anyResult = false;
    let aborted: PoolOutcome | null = null;
    let finished = options.progressBase;
    let settled = false;
    const startedAt = performance.now();

    const append = (record: DuelRecordV1, entry: BenchmarkCase, logText: string) => {
      fs.writeSync(fd, recordLine(record));
      fs.fsyncSync(fd);
      if (logText.trim()) {
        fs.mkdirSync(options.logsDirectory, { recursive: true });
        fs.writeFileSync(path.join(options.logsDirectory, logFileName(entry)), logText, "utf8");
      }
      options.onRecord(record);
      finished += 1;
      const elapsed = (performance.now() - startedAt) / 1000;
      const duelSeconds = record.clock.duelMs === null ? "—" : (record.clock.duelMs / 1000).toFixed(1);
      log(`[${finished}/${options.progressTotal}] ${record.caseId} ${describeOutcome(record)} turnos=${record.outcome.turns ?? "—"} ` +
        `duelo=${duelSeconds}s decorrido=${elapsed.toFixed(0)}s`);
    };

    const finish = () => {
      if (settled || running.size) return;
      if (!aborted && queue.length) return;
      settled = true;
      process.off("SIGINT", onSigint);
      fs.closeSync(fd);
      resolve(aborted ?? "completed");
    };

    const abort = (reason: PoolOutcome) => {
      if (aborted) return;
      aborted = reason;
      queue.length = 0;
      for (const child of running) child.kill("SIGKILL");
    };

    const onSigint = () => {
      log("SIGINT: encerrando os workers; os casos em curso são descartados (retome com --resume).");
      abort("sigint");
      finish();
    };
    process.on("SIGINT", onSigint);

    const launch = () => {
      while (!aborted && running.size < options.workers && queue.length) {
        const entry = queue.shift();
        if (entry) start(entry);
      }
      finish();
    };

    const start = (entry: BenchmarkCase) => {
      const launchedAt = performance.now();
      const child = forkWorker("--worker");
      running.add(child);
      const stderr: Buffer[] = [];
      let reply: { record: DuelRecordV1; log: string } | null = null;
      // `failure` may enter the record (first line only); `failureDetail` only reaches logs/.
      let failure: string | null = null;
      let failureDetail: string | null = null;
      let watchdogFired = false;
      child.stderr?.on("data", (chunk: Buffer) => { stderr.push(chunk); });
      const watchdog = setTimeout(() => {
        watchdogFired = true;
        child.kill("SIGKILL");
      }, options.config.timeoutMs + WATCHDOG_GRACE_MS);
      child.on("message", (value: unknown) => {
        try {
          const message = parseWorkerReply(value);
          if (message.type === "result") {
            if (!recordMatchesCase(message.record, entry)) throw new RunnerError(`o worker devolveu um registro de ${message.record.caseId}`);
            reply = { record: message.record, log: message.log };
          } else if (message.type === "fatal") {
            failure = message.message;
            failureDetail = message.detail;
          }
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
        }
      });
      child.on("error", error => { failure ??= error.message; });
      child.once("exit", (code, signal) => {
        clearTimeout(watchdog);
        running.delete(child);
        if (aborted) {
          launch();
          return;
        }
        const residual = Buffer.concat(stderr).toString("utf8");
        const result: { record: DuelRecordV1; log: string } | null = reply;
        if (result) {
          const logText = [result.log, residual ? `--- stderr ---\n${residual}` : ""].filter(Boolean).join("\n");
          if (!anyResult) {
            anyResult = true;
            for (const held of heldLost.splice(0)) append(held.record, held.entry, held.logText);
          }
          append(result.record, entry, logText);
        } else {
          const reason = watchdogFired
            ? `Worker encerrado pelo watchdog após ${options.config.timeoutMs + WATCHDOG_GRACE_MS} ms.`
            : `O worker terminou (código ${code ?? "null"}, sinal ${signal ?? "null"}) sem resultado${failure ? `: ${failure}` : "."}`;
          const record = workerLostRecord(entry, reason, round(performance.now() - launchedAt, 0));
          const logText = [failureDetail ?? failure ?? "", residual].filter(Boolean).join("\n");
          if (anyResult) append(record, entry, logText);
          else {
            heldLost.push({ record, entry, logText });
            log(`${entry.caseId}: ${reason}`);
            if (heldLost.length >= Math.min(options.workers, options.cases.length)) {
              log(`Os primeiros ${heldLost.length} workers terminaram sem resultado: erro de ambiente.`);
              // Held records are discarded on abort, so the last failure's full text is shown here.
              if (logText.trim()) log(logText.trim());
              abort("environment");
            }
          }
        }
        launch();
      });
      child.send({ type: "case", case: entry, config: options.config });
    };

    launch();
  });
}

// ── Run ────────────────────────────────────────────────────────────────────

async function runCommand(argv: readonly string[]): Promise<number> {
  const options = parseRunArgs(argv);
  let resumeHeader: RunHeader | null = null;
  let effective = options;
  if (options.resume !== null) {
    const file = path.join(path.resolve(options.resume), HEADER_FILE);
    if (!fs.existsSync(file)) throw new RunnerError(`${options.resume} não tem ${HEADER_FILE}.`);
    resumeHeader = parseRunHeader(JSON.parse(fs.readFileSync(file, "utf8")));
    effective = optionsFromHeader(resumeHeader, options.workers, options.order);
  }
  log("Lendo o ambiente (worker de descrição)...");
  const environment = await describeEnvironment();
  const { config, cases } = buildConfig(effective, environment);
  const identity = runIdentity(environment);
  const configDigest = digestOf(config);
  const identityDigest = digestOf(identity);
  const runId = buildRunId(config.profile, identity, configDigest);
  const outDir = validateOutputDirectory(options.resume ?? options.out ?? path.join(REPO_ROOT, ".cache", "benchmark", runId));
  const header: RunHeader = {
    schema: RUN_SCHEMA,
    version: RUN_SCHEMA_VERSION,
    recordVersion: DUEL_RECORD_VERSION,
    runId,
    identity,
    config,
    configDigest,
    identityDigest,
    clock: {
      createdAt: new Date().toISOString(),
      host: { platform: process.platform, arch: process.arch, cpus: os.availableParallelism() },
      workers: effective.workers,
      order: effective.order,
    },
  };

  if (options.dryRun) {
    const byPair: Counter = {};
    for (const entry of cases) increment(byPair, entry.pair);
    process.stdout.write(`${JSON.stringify({
      dryRun: true, outDir, runId, configDigest, identityDigest, plannedCases: cases.length,
      dirty: identity.dirty, wouldRequireAllowDirty: identity.dirty && !options.allowDirty,
      casesByPair: sortedCounter(byPair), header,
    }, null, 2)}\n`);
    return EXIT_OK;
  }
  if (identity.dirty && !effective.allowDirty) {
    throw new RunnerError("A árvore de trabalho tem mudanças sem commit. Faça o commit ou passe --allow-dirty (a execução fica inelegível a baseline).");
  }

  const headerFile = path.join(outDir, HEADER_FILE);
  const journalFile = path.join(outDir, JOURNAL_FILE);
  const planned = new Map(cases.map(entry => [entry.caseId, entry]));
  let done = new Map<string, DuelRecordV1>();
  if (resumeHeader) {
    if (resumeHeader.configDigest !== configDigest) {
      throw new RunnerError("A configuração refeita a partir do código atual difere do cabeçalho; a execução não pode ser retomada.");
    }
    if (resumeHeader.identityDigest !== identityDigest) {
      const differences = identityDiff(resumeHeader.identity, identity).map(diff => diff.field).join(", ");
      throw new RunnerError(`A identidade mudou desde o início da execução (${differences}); a execução não pode ser retomada.`);
    }
    const journal = readJournal(journalFile, planned);
    done = journal.records;
    if (journal.truncatedBytes) log(`Retomada: última linha incompleta do diário descartada (${journal.truncatedBytes} bytes).`);
    log(`Retomada: ${done.size}/${cases.length} casos já registrados.`);
  } else {
    if (fs.existsSync(headerFile)) throw new RunnerError(`${outDir} já guarda uma execução; use --resume ${outDir}.`);
    fs.mkdirSync(outDir, { recursive: true });
    writeJsonAtomic(headerFile, header);
  }

  const pending = cases.filter(entry => !done.has(entry.caseId));
  if (effective.order === "reverse") pending.reverse();
  log(`Execução ${runId}: ${pending.length} casos pendentes de ${cases.length}, ${effective.workers} workers, ordem ${effective.order}.`);
  log(`Saída: ${outDir}`);
  const startedAt = performance.now();
  const outcome = pending.length ? await runPool({
    cases: pending,
    config,
    workers: effective.workers,
    journalFile,
    logsDirectory: path.join(outDir, LOGS_DIRECTORY),
    onRecord: record => { done.set(record.caseId, record); },
    progressBase: cases.length - pending.length,
    progressTotal: cases.length,
  }) : "completed";
  if (outcome === "sigint") return EXIT_SIGINT;
  if (outcome === "environment") return EXIT_FAILURE;

  const missing = cases.filter(entry => !done.has(entry.caseId));
  if (missing.length) throw new RunnerError(`${missing.length} casos planejados não têm registro.`);

  // The identity must not change while the run is in progress.
  const endIdentity = runIdentity(await describeEnvironment());
  const changes = identityDiff(identity, endIdentity);
  const runEnd: RunEnd = {
    schema: RUN_END_SCHEMA,
    version: RUN_END_SCHEMA_VERSION,
    runId,
    finishedAt: new Date().toISOString(),
    wallMs: Math.round(performance.now() - startedAt),
    identity: endIdentity,
    identityDigest: digestOf(endIdentity),
    identityChangedDuringRun: changes.length > 0,
    identityDiff: changes.map(change => ({ field: change.field, start: jsonValue(change.start, "start"), end: jsonValue(change.end, "end") })),
  };
  writeJsonAtomic(path.join(outDir, RUN_END_FILE), runEnd);
  if (changes.length) log(`Atenção: a identidade mudou durante a execução (${changes.map(change => change.field).join(", ")}).`);
  writeTextAtomic(path.join(outDir, DUELS_FILE), sortByCaseIndex([...done.values()]).map(recordLine).join(""));

  const { summarizeRun } = await import("./analyze_benchmark.js");
  const result = summarizeRun(outDir, {});
  log(`Resumo: ${result.jsonFile} e ${result.markdownFile}.`);
  for (const line of result.headline) log(line);
  return result.exitCode;
}

// ── Controls ───────────────────────────────────────────────────────────────

const CONTROL_MATCHUPS = [
  "shadowheart:arcanist", "arcanist:shadowheart",
  "luminarch:shadowheart", "shadowheart:luminarch",
  "void:shadowheart", "shadowheart:void",
  "dragon:shadowheart", "shadowheart:dragon",
  "miragebound:shadowheart", "shadowheart:miragebound",
  "bloomrot:techzero", "techzero:bloomrot",
  "burningwest:miragebound", "miragebound:burningwest",
];
const CONTROL_SEEDS = [4242, 9713];
const VOLATILE_KEYS: ReadonlySet<string> = new Set(["generatedAt", "timestamp", "batchDurationMs"]);

interface ControlTask {
  name: string;
  args: string[];
  outputFile: string;
}

interface ControlResult {
  name: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/** Drops clock fields of a smoke report: generatedAt, timestamps and every *TimeMs/duration value. */
function withoutClock(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map(withoutClock);
  if (value !== null && typeof value === "object") {
    const result: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value)) {
      if (VOLATILE_KEYS.has(key) || key.endsWith("TimeMs")) continue;
      result[key] = withoutClock(Reflect.get(value, key));
    }
    return result;
  }
  return jsonValue(value === undefined ? null : value, "smoke");
}

function runControlTask(task: ControlTask, directory: string): Promise<ControlResult> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, task.args, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => { stdout.push(chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr.push(chunk); });
    child.on("error", error => { stderr.push(Buffer.from(error.message)); });
    child.once("close", code => {
      const result = { name: task.name, exitCode: code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
      fs.writeFileSync(path.join(directory, `${task.name}.log`), `${result.stdout}\n--- stderr ---\n${result.stderr}`, "utf8");
      resolve(result);
    });
  });
}

async function runControlTasks(tasks: readonly ControlTask[], directory: string, workers: number): Promise<ControlResult[]> {
  const results: ControlResult[] = [];
  const queue = [...tasks];
  const lanes = Array.from({ length: Math.max(1, Math.min(workers, tasks.length)) }, async () => {
    for (let task = queue.shift(); task; task = queue.shift()) {
      log(`controles: ${task.name}...`);
      const result = await runControlTask(task, directory);
      log(`controles: ${task.name} terminou com código ${result.exitCode ?? "null"}.`);
      results.push(result);
    }
  });
  await Promise.all(lanes);
  return tasks.map(task => results.find(result => result.name === task.name)).filter((result): result is ControlResult => !!result);
}

function corpusLines(text: string): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  for (const line of text.split(/\r?\n/).map(entry => entry.trim()).filter(entry => entry.startsWith("{"))) {
    try {
      result.push(object(JSON.parse(line), "corpus output"));
    } catch {
      continue;
    }
  }
  return result;
}

/** Reference controls of --compare-with, read before any task runs. */
interface PreviousControls {
  /** The --compare-with argument, as given. */
  label: string;
  corpusFile: string;
  corpusDigest: unknown;
  smokeDigests: ReadonlyMap<string, unknown>;
}

/** Same directory after resolving relative parts, links, junctions and (on Windows) case. */
function samePath(left: string, right: string): boolean {
  const canonical = (target: string): string => {
    const resolved = path.resolve(target);
    const real = fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
    return process.platform === "win32" ? real.toLowerCase() : real;
  };
  return canonical(left) === canonical(right);
}

/**
 * The corpus and the smokes overwrite their outputs before comparing, so the
 * reference must live in another directory and is read before the tasks run;
 * otherwise a run would compare with itself.
 */
function readPreviousControls(compareWith: string, outDir: string): PreviousControls {
  if (samePath(compareWith, outDir)) {
    throw new RunnerError(`--compare-with ${compareWith} é a própria pasta de saída e compararia os controles com eles mesmos; passe outra pasta em --out.`);
  }
  const directory = path.join(path.resolve(compareWith), "controls");
  const summaryFile = path.join(directory, "summary.json");
  const corpusFile = path.join(directory, "corpus.json");
  for (const file of [summaryFile, corpusFile]) {
    if (!fs.existsSync(file)) throw new RunnerError(`${compareWith} não tem controls/${path.basename(file)}.`);
  }
  try {
    const summary = object(JSON.parse(fs.readFileSync(summaryFile, "utf8")), "previous controls");
    if (summary.schema !== CONTROLS_SCHEMA) throw new RunnerError("não é um resumo de controles.");
    const smokes = array(summary.smokes, "previous controls.smokes").map((entry, index) => object(entry, `previous controls.smokes[${index}]`));
    return {
      label: compareWith,
      corpusFile,
      corpusDigest: object(summary.corpus, "previous controls.corpus").digest,
      smokeDigests: new Map(smokes.map((smoke, index) => [string(smoke.name, `previous controls.smokes[${index}].name`), smoke.controlsDigest])),
    };
  } catch (error) {
    throw new RunnerError(`${summaryFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function controlsCommand(argv: readonly string[]): Promise<number> {
  const flags = parseFlags(argv, new Set(["--out", "--compare-with", "--workers"]), new Set());
  const workersText = flags.get("--workers");
  const workers = workersText === undefined ? Math.min(5, defaultWorkers()) : positiveInteger(workersText, "--workers");
  const gitState = gitIdentity();
  const outDir = validateOutputDirectory(flags.get("--out") ??
    path.join(REPO_ROOT, ".cache", "benchmark", `controls-${gitState.commit.slice(0, 7)}${gitState.dirty ? "-dirty" : ""}`));
  const compareWith = flags.get("--compare-with");
  const previous = compareWith === undefined ? null : readPreviousControls(compareWith, outDir);
  const directory = path.join(outDir, "controls");
  fs.mkdirSync(directory, { recursive: true });
  const tasks: ControlTask[] = [{
    name: "corpus",
    outputFile: path.join(directory, "corpus.json"),
    args: ["--import=tsx", "scripts/run_ai_architecture_corpus.ts", "--output", path.join(directory, "corpus.json"),
      ...(previous ? ["--compare", previous.corpusFile] : [])],
  }];
  for (const mode of ["natural", "bridge"] as const) {
    for (const seed of CONTROL_SEEDS) {
      const name = `smoke-${mode}-${seed}`;
      const outputFile = path.join(directory, `${name}.json`);
      tasks.push({
        name,
        outputFile,
        args: [...WORKER_EXEC_ARGV, "scripts/run_bot_arena_smoke.ts", "--matchups", CONTROL_MATCHUPS.join(","),
          "--duels", "1", "--seed", String(seed),
          ...(mode === "bridge" ? ["--plannerMode", "always", "--plannerTurnMode", "mainBattleMain2"] : []),
          "--out", outputFile],
      });
    }
  }
  const results = await runControlTasks(tasks, directory, workers);
  const failures: string[] = [];
  const corpusResult = results.find(result => result.name === "corpus");
  const corpusOutput = corpusResult ? corpusLines(corpusResult.stdout) : [];
  const corpusMain = corpusOutput.find(entry => typeof entry.digest === "string") ?? null;
  const corpusCompare = corpusOutput.find(entry => Array.isArray(entry.changed)) ?? null;
  if (!corpusResult || corpusResult.exitCode === 1 || corpusResult.exitCode === null || !corpusMain) failures.push("corpus");
  const smokes = results.filter(result => result.name.startsWith("smoke-")).map(result => {
    const task = tasks.find(entry => entry.name === result.name);
    let controlsDigest: string | null = null;
    const endReasons: Counter = {};
    let duels = 0;
    if (task && fs.existsSync(task.outputFile)) {
      const report: unknown = JSON.parse(fs.readFileSync(task.outputFile, "utf8"));
      controlsDigest = digestOf(withoutClock(report));
      const reportResults = Reflect.get(object(report, "smoke"), "results");
      for (const matchup of Array.isArray(reportResults) ? reportResults : []) {
        const matchupDuels: unknown = Reflect.get(object(matchup, "smoke matchup"), "duels");
        for (const duel of Array.isArray(matchupDuels) ? matchupDuels : []) {
          duels += 1;
          const reason: unknown = Reflect.get(object(duel, "smoke duel"), "reason");
          const type: unknown = Reflect.get(object(duel, "smoke duel"), "type");
          increment(endReasons, typeof reason === "string" ? reason : typeof type === "string" ? type : "unknown");
        }
      }
    }
    if (result.exitCode !== 0 || controlsDigest === null) failures.push(result.name);
    return {
      name: result.name,
      exitCode: result.exitCode,
      controlsDigest,
      duels,
      endReasons: sortedCounter(endReasons),
      stderrLines: result.stderr.split(/\r?\n/).filter(line => line.trim()).length,
    };
  });
  const corpus = {
    exitCode: corpusResult?.exitCode ?? null,
    digest: typeof corpusMain?.digest === "string" ? corpusMain.digest : null,
    summary: corpusMain?.summary === undefined ? null : jsonValue(corpusMain.summary, "corpus summary"),
    comparedWith: corpusCompare ? {
      changed: jsonValue(corpusCompare.changed ?? [], "corpus changed"),
      missing: jsonValue(corpusCompare.missing ?? [], "corpus missing"),
    } : null,
  };
  const summary = {
    schema: CONTROLS_SCHEMA,
    version: CONTROLS_SCHEMA_VERSION,
    commit: gitState.commit,
    dirty: gitState.dirty,
    createdAt: new Date().toISOString(),
    corpus,
    smokes,
    controlsDigest: digestOf({ corpus: corpus.digest, smokes: smokes.map(smoke => [smoke.name, smoke.controlsDigest]) }),
  };
  writeJsonAtomic(path.join(directory, "summary.json"), summary);
  log(`controles: resumo em ${path.join(directory, "summary.json")}.`);
  log(`controles: corpus ${corpus.digest ?? "—"}; ${smokes.map(smoke => `${smoke.name} ${smoke.controlsDigest?.slice(0, 12) ?? "—"}`).join("; ")}.`);
  if (failures.length) {
    log(`controles: falharam ${failures.join(", ")}.`);
    return EXIT_FAILURE;
  }
  if (previous) {
    const changes: string[] = [];
    if (previous.corpusDigest !== corpus.digest || corpusResult?.exitCode === EXIT_CHANGED) changes.push("corpus");
    for (const smoke of smokes) {
      if (previous.smokeDigests.get(smoke.name) !== smoke.controlsDigest) changes.push(smoke.name);
    }
    if (changes.length) {
      log(`controles: mudanças contra ${previous.label}: ${changes.join(", ")}.`);
      return EXIT_CHANGED;
    }
    log(`controles: idênticos a ${previous.label}.`);
  }
  return EXIT_OK;
}

// ── Workers ────────────────────────────────────────────────────────────────

interface ConsoleCapture {
  errors: number;
  warnings: number;
  errorLabels: Counter;
  warningLabels: Counter;
  rawLines: string[];
  counting: boolean;
}

function messageLabel(text: string): string {
  return (text.split(/\r?\n/, 1)[0] ?? "").slice(0, 200);
}

/** console.log/info/debug are silenced; error and warn are counted while the duel runs and always kept raw. */
function captureConsole(): ConsoleCapture {
  const capture: ConsoleCapture = { errors: 0, warnings: 0, errorLabels: {}, warningLabels: {}, rawLines: [], counting: true };
  const silent = () => {};
  console.log = silent;
  console.info = silent;
  console.debug = silent;
  console.error = (...values: unknown[]) => {
    const text = format(...values);
    capture.rawLines.push(`[error] ${text}`);
    if (!capture.counting) return;
    capture.errors += 1;
    increment(capture.errorLabels, messageLabel(text));
  };
  console.warn = (...values: unknown[]) => {
    const text = format(...values);
    capture.rawLines.push(`[warn] ${text}`);
    if (!capture.counting) return;
    capture.warnings += 1;
    increment(capture.warningLabels, messageLabel(text));
  };
  return capture;
}

function nextParentMessage(): Promise<unknown> {
  return new Promise(resolve => { process.once("message", (value: unknown) => resolve(value)); });
}

function sendAndExit(message: object, code = 0): void {
  if (!process.send) process.exit(code);
  process.send(message, undefined, {}, () => process.exit(code));
}

function errorText(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

function firstLine(error: unknown): string {
  return messageLabel(error instanceof Error ? error.message : String(error)) || "Unknown error";
}

function fatalReply(error: unknown): FatalReply {
  return { type: "fatal", message: firstLine(error), detail: errorText(error) };
}

/**
 * Reports a worker failure and always ends the process: the IPC channel and
 * the 'disconnect' listener would otherwise keep it alive until the parent's
 * watchdog. A send that throws (an unserializable message) exits directly.
 */
function failWorker(error: unknown): void {
  try {
    sendAndExit(fatalReply(error), 1);
  } catch {
    process.exit(1);
  }
}

async function describeWorker(): Promise<void> {
  process.on("disconnect", () => process.exit(1));
  installMemoryStorage();
  captureConsole();
  await nextParentMessage();
  try {
    const { CANONICAL_REPLAY_ENGINE_VERSION } = await import("../src/core/contracts/replay.js");
    const { getCardDatabaseSignature } = await import("../src/core/game/replay/canonical.js");
    const { cardDatabase } = await import("../src/data/cards.js");
    const { getAvailableBotPresets, getBotDeckList, getBotExtraDeckList } = await import("../src/core/bot/presets.js");
    const { getRegisteredStrategyIds } = await import("../src/core/ai/StrategyRegistry.js");
    const { CURRENT_BANLIST } = await import("../src/data/banlist.js");
    const { default: BotArena } = await import("../src/core/BotArena.js");
    const { default: Game } = await import("../src/core/Game.js");
    const { default: Bot } = await import("../src/core/Bot.js");
    const presets = getAvailableBotPresets().map(preset => preset.id);
    const arena = new BotArena(Game, Bot);
    const speed = arena.getSpeedConfig("instant");
    const planner = arena.getPlannerConfig(speed);
    const description: EnvironmentDescription = {
      engineVersion: CANONICAL_REPLAY_ENGINE_VERSION,
      cardDatabaseSignature: getCardDatabaseSignature(),
      cardDatabaseSha256: sha256Hex(JSON.stringify(cardDatabase)),
      presets,
      decks: Object.fromEntries(presets.map(id => [id, { main: getBotDeckList(id), extra: getBotExtraDeckList(id) }])),
      strategyIds: [...getRegisteredStrategyIds()].sort(),
      banlist: Object.fromEntries(Object.entries(CURRENT_BANLIST).map(([id, status]) => [id, String(status)])),
      instant: {
        phaseDelayMs: speed.phaseDelayMs,
        actionDelayMs: speed.actionDelayMs,
        battleDelayMs: speed.battleDelayMs,
        pollIntervalMs: speed.pollIntervalMs,
        useRenderer: speed.useRenderer,
        timeoutMs: speed.timeoutMs,
        beamWidth: speed.beamWidth,
        maxDepth: speed.maxDepth,
        nodeBudget: speed.nodeBudget,
        planner: {
          mode: planner.mode, turnMode: planner.turnMode, beamWidth: planner.beamWidth,
          maxDepth: planner.maxDepth, nodeBudget: planner.nodeBudget, candidateLimit: planner.candidateLimit,
        },
      },
    };
    sendAndExit({ type: "description", description });
  } catch (error) {
    failWorker(error);
  }
}

function errorOutcome(kind: NonNullable<DuelOutcome["errorKind"]>, message: string, turns: number | null,
  finalLP: DuelOutcome["finalLP"]): DuelOutcome {
  return { status: "error", endReason: "error", errorKind: kind, decidedBy: null, winnerSeat: null, winnerPreset: null,
    draw: false, turns, finalLP, message };
}

async function caseWorker(): Promise<void> {
  // The parent owns interruption; a lost parent ends the worker.
  process.on("SIGINT", () => {});
  process.on("disconnect", () => process.exit(1));
  installMemoryStorage();
  const capture = captureConsole();
  let unhandledRejections = 0;
  let processWarnings = 0;
  let inDuel = false;
  let uncaught: unknown = null;
  process.on("unhandledRejection", reason => {
    capture.rawLines.push(`[unhandledRejection] ${errorText(reason)}`);
    if (capture.counting) unhandledRejections += 1;
  });
  process.on("warning", warning => {
    capture.rawLines.push(`[process warning] ${warning.name}: ${warning.message}`);
    if (inDuel) processWarnings += 1;
  });
  const raw = await nextParentMessage();
  let entry: BenchmarkCase;
  let config: RunConfig;
  try {
    const message = object(raw, "case message");
    if (message.type !== "case") throw new RunnerError(`Mensagem inesperada do processo pai: ${String(message.type)}.`);
    entry = parseBenchmarkCase(message.case);
    config = parseRunConfig(message.config, "config");
  } catch (error) {
    failWorker(error);
    return;
  }

  const { registerStrategy, resolveRegisteredStrategy } = await import("../src/core/ai/StrategyRegistry.js");
  for (const [target, source] of Object.entries(config.strategyOverrides)) {
    const strategy = resolveRegisteredStrategy(source);
    if (!strategy) {
      failWorker(new RunnerError(`A estratégia ${source} não está registrada.`));
      return;
    }
    registerStrategy(target, strategy);
  }
  const { HarnessGame, HarnessBot, HarnessConfigDriftError, projectDuelRecord } = await import("./benchmark/observer.js");
  const { default: BotArena } = await import("../src/core/BotArena.js");

  HarnessGame.configure({ entry, config });
  const arena = new BotArena(HarnessGame, HarnessBot);
  arena.setSearchParams({
    randomSeed: entry.seed,
    ...(config.beam.source === "custom"
      ? { beamWidth: config.beam.beamWidth, maxDepth: config.beam.maxDepth, nodeBudget: config.beam.nodeBudget }
      : {}),
    plannerMode: config.planner.modeOverride,
    plannerTurnMode: config.planner.turnModeOverride,
  });
  arena.setCustomTimeout(config.timeoutMs);
  arena.maxTurns = config.maxTurns;

  process.on("uncaughtException", error => {
    capture.rawLines.push(`[uncaughtException] ${errorText(error)}`);
    if (!inDuel) {
      failWorker(error);
      return;
    }
    // The duel cannot be trusted any more: end it and report the exception.
    uncaught ??= error;
    const game = HarnessGame.current;
    if (game) game.gameOver = true;
  });

  const originalRandom = Math.random;
  let mathRandomCalls = 0;
  Math.random = () => {
    mathRandomCalls += 1;
    return originalRandom();
  };
  let result: Awaited<ReturnType<typeof arena.runDuel>> | null = null;
  let thrown: unknown = null;
  const duelStartedAt = performance.now();
  inDuel = true;
  try {
    result = await arena.runDuel(entry.seat1, entry.seat2, arena.getSpeedConfig("instant"), 1, arena.loadStoredDeckData());
  } catch (error) {
    thrown = error;
  } finally {
    Math.random = originalRandom;
    inDuel = false;
  }
  const duelMs = round(performance.now() - duelStartedAt, 0);
  const game = HarnessGame.current;
  game?.observer.freeze();
  capture.counting = false;

  const tracked = arena.getAnalytics().duelRecords[0] ?? null;
  const observer = game?.observer ?? null;
  const gameTurns = game ? game.turnCounter : null;
  const gameLP = game ? { player: game.player.lp, bot: game.bot.lp } : null;
  let outcome: DuelOutcome;
  let partial = false;
  if (observer?.trip) {
    const trip = observer.trip;
    outcome = errorOutcome("stall_guard", `Guarda de stall: ${trip.counter} chegou a ${trip.value} > ${trip.limit} no turno ${trip.turn} (${trip.phase ?? "?"}).`,
      observer.tripState?.turns ?? trip.turn, observer.tripState?.finalLP ?? null);
  } else if (thrown !== null) {
    outcome = errorOutcome(thrown instanceof HarnessConfigDriftError ? "config_drift" : "exception", firstLine(thrown), gameTurns, gameLP);
  } else if (uncaught !== null) {
    outcome = errorOutcome("exception", `Exceção não capturada: ${firstLine(uncaught)}`, gameTurns, gameLP);
  } else if (!result || result.type === "cancelled") {
    outcome = errorOutcome("unexpected_cancel", "A Arena devolveu um duelo cancelado sem disparo da guarda de stall.", gameTurns, gameLP);
  } else if (result.reason === "timeout") {
    partial = true;
    outcome = errorOutcome("wall_clock", `Limite de segurança do relógio (${config.timeoutMs} ms) atingido.`, null, null);
  } else if (result.reason === "lp_zero" || result.reason === "max_turns") {
    const winner = result.winner;
    const finalLP = tracked ? { player: tracked.finalLP.player, bot: tracked.finalLP.bot } : gameLP;
    if (result.reason === "lp_zero" && winner === "draw") {
      outcome = errorOutcome("unknown_game_over", "Os PV zeraram sem vencedor.", result.turns, finalLP);
    } else {
      const winnerSeat = winner === "draw" ? null : winner;
      outcome = {
        status: "valid",
        endReason: result.reason,
        errorKind: null,
        decidedBy: result.reason === "lp_zero" ? "lp_zero" : winnerSeat ? "lp_at_turn_limit" : "tie_at_turn_limit",
        winnerSeat,
        winnerPreset: winnerSeat === null ? null : winnerSeat === "player" ? entry.seat1 : entry.seat2,
        draw: winnerSeat === null,
        turns: result.turns,
        finalLP,
        message: null,
      };
    }
  } else {
    outcome = errorOutcome("unknown_game_over", `O duelo terminou com game_over de motivo ${String(result.reason)}.`, result.turns, gameLP);
  }

  const record = projectDuelRecord({
    entry,
    game,
    outcome,
    completed: result,
    trackerSeats: tracked?.strategic?.seats ?? null,
    diag: {
      consoleErrors: capture.errors,
      consoleWarnings: capture.warnings,
      errorLabels: capture.errorLabels,
      warningLabels: capture.warningLabels,
      unhandledRejections,
      processWarnings,
      mathRandomCalls,
    },
    duelMs,
    workerMs: round(performance.now(), 0),
    partial,
  });
  game?.dispose("benchmark_case_end");
  sendAndExit({ type: "result", record, log: capture.rawLines.join("\n") });
}

// ── Entry point ────────────────────────────────────────────────────────────

const USAGE = [
  "Uso:",
  "  npm run benchmark -- [run] --seeds N [opções]",
  "  npm run benchmark -- --resume DIR [--workers K] [--order forward|reverse]",
  "  npm run benchmark -- controls [--out DIR] [--compare-with DIR_ANTERIOR] [--workers K]",
].join("\n");

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "--worker") {
    await caseWorker();
    return EXIT_OK;
  }
  if (command === "--describe") {
    await describeWorker();
    return EXIT_OK;
  }
  if (command === "controls") return controlsCommand(rest);
  return runCommand(command === "run" ? rest : argv);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const argv = process.argv.slice(2);
  const workerMode = argv[0] === "--worker" || argv[0] === "--describe";
  main(argv).then(code => {
    if (!workerMode) process.exitCode = code;
  }, (error: unknown) => {
    // A worker rejection outside its own handlers (a failed import, the
    // projection, dispose or an unserializable result) still reports and exits.
    if (workerMode) {
      failWorker(error);
      return;
    }
    if (error instanceof RunnerError) {
      log(`Erro: ${error.message}`);
      log(USAGE);
    } else {
      log(errorText(error));
    }
    process.exitCode = EXIT_FAILURE;
  });
}
