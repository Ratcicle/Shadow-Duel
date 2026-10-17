import { createHash } from "node:crypto";

// Benchmark harness data contract (Roadmap 2.2). This module never imports the
// engine: the analyzer and the parent runner load it without a Game.

export const RUN_SCHEMA = "shadow-duel-benchmark-run";
export const DUEL_SCHEMA = "shadow-duel-benchmark-duel";
export const SUMMARY_SCHEMA = "shadow-duel-benchmark-summary";
export const COMPARISON_SCHEMA = "shadow-duel-benchmark-comparison";
export const RUN_END_SCHEMA = "shadow-duel-benchmark-run-end";
export const CONTROLS_SCHEMA = "shadow-duel-benchmark-controls";
export const RUN_SCHEMA_VERSION = 1;
export const DUEL_RECORD_VERSION = 1;
export const SUMMARY_SCHEMA_VERSION = 1;
export const COMPARISON_SCHEMA_VERSION = 1;
export const RUN_END_SCHEMA_VERSION = 1;
export const CONTROLS_SCHEMA_VERSION = 1;

export const HEADER_FILE = "header.json";
export const JOURNAL_FILE = "journal.jsonl";
export const DUELS_FILE = "duels.jsonl";
export const SUMMARY_JSON_FILE = "summary.json";
export const SUMMARY_MARKDOWN_FILE = "summary.md";
export const RUN_END_FILE = "run-end.json";
export const LOGS_DIRECTORY = "logs";
/** Side file of the hidden-information invariance control; never part of the duel records. */
export const INVARIANCE_FILE = "invariance.jsonl";
export const INVARIANCE_SCHEMA = "shadow-duel-benchmark-invariance";
/** v2: each seat also carries the live roots' public-projection guard tally. */
export const INVARIANCE_SCHEMA_VERSION = 2;

export const DEFAULT_SEED_BASE = 20261011;
export const DEFAULT_MAX_TURNS = 50;
export const DEFAULT_TIMEOUT_MS = 600000;
/** The parent kills a worker this long after its duel's wall-clock limit. */
export const WATCHDOG_GRACE_MS = 60000;

export type Seat = "player" | "bot";
export const SEATS: readonly Seat[] = ["player", "bot"];
export type Counter = Record<string, number>;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type BenchmarkProfile = "canonical" | "instant";
export const BENCHMARK_PROFILES: readonly BenchmarkProfile[] = ["canonical", "instant"];
export type PlannerMode = "off" | "critical" | "always";
export const PLANNER_MODES: readonly PlannerMode[] = ["off", "critical", "always"];
export type PlannerTurnMode = "mainOnly" | "mainBattleMain2";
export const PLANNER_TURN_MODES: readonly PlannerTurnMode[] = ["mainOnly", "mainBattleMain2"];
export type PlannerModeSource = "arena" | "strategy";
export const PLANNER_MODE_SOURCES: readonly PlannerModeSource[] = ["arena", "strategy"];
export type GuardMode = "enforce" | "observe";
export type GuardCounterName = "decisions" | "actions" | "progress";
export const GUARD_COUNTERS: readonly GuardCounterName[] = ["decisions", "actions", "progress"];
/**
 * Opt-in preset metrics (--preset-metrics), computed by the observer:
 * - techzero-combo: Tech-Zero seats; real M + Portal + Synchro boss summons in one turn (IDs from TECH_ZERO_IDS);
 * - lethal: every seat; public battle projection once per seat and turn, converted only by an LP-zero win that turn.
 */
export type PresetMetricId = "techzero-combo" | "lethal";
export const PRESET_METRIC_IDS: readonly PresetMetricId[] = ["techzero-combo", "lethal"];
export type RunOrder = "forward" | "reverse";

/**
 * Hidden-information invariance control (--invariance-control, phase 2.3 L09).
 * Every live decision root runs again on the real state and with the
 * opponent's hidden information traded; diagnostic runs only, never a baseline.
 * The rule enters the configuration only when the control is on.
 */
export const INVARIANCE_SWAP_RULE = "opponent hand and deck rotated by the hand size; each face-down monster, backrow card " +
  "or field spell traded with a deck card of the same kind and another id; every hidden position keeps its public placement fields, " +
  "and a position on the field also its public presence state";
export type InvarianceRoot = "p2" | "turnLineSearch" | "beam" | "greedy" | "attack";
export const INVARIANCE_ROOTS: readonly InvarianceRoot[] = ["p2", "turnLineSearch", "beam", "greedy", "attack"];
/** Divergent comparisons (traded or live) kept per root and seat, with their fingerprints. */
export const INVARIANCE_SAMPLE_LIMIT = 4;

export interface InvarianceControlConfig {
  swap: typeof INVARIANCE_SWAP_RULE;
}

export type ErrorKind =
  | "stall_guard"
  | "exception"
  | "wall_clock"
  | "worker_lost"
  | "unexpected_cancel"
  | "unknown_game_over"
  | "config_drift";
export const ERROR_KINDS: readonly ErrorKind[] = [
  "stall_guard", "exception", "wall_clock", "worker_lost", "unexpected_cancel", "unknown_game_over", "config_drift",
];
export type DecidedBy = "lp_zero" | "lp_at_turn_limit" | "tie_at_turn_limit";
export const DECIDED_BY: readonly DecidedBy[] = ["lp_zero", "lp_at_turn_limit", "tie_at_turn_limit"];

export interface GuardLimits {
  decisionsPerTurn: number;
  actionsPerTurn: number;
  progressPerTurn: number;
}

/**
 * Floor of the per-turn stall guard. The limits are provisional until the
 * N = 2 pilot calibrates them as max(floor, 10 × observed peak).
 */
export const GUARD_FLOOR: Readonly<GuardLimits> = Object.freeze({
  decisionsPerTurn: 2000,
  actionsPerTurn: 1000,
  progressPerTurn: 20000,
});
export const DEFAULT_GUARD: Readonly<GuardLimits> = GUARD_FLOOR;

// Bounded lists of the duel record. The observer produces them and the
// validators enforce them, so both read these limits from the contract.
/** Last progress stages kept in guard.trip.lastStages. */
export const GUARD_STAGE_RING_SIZE = 16;
/** Plan/runtime mismatch samples kept in diag.mismatchSamples. */
export const MISMATCH_SAMPLE_LIMIT = 8;

// ── Failure codes ──────────────────────────────────────────────────────────
// Stable codes of failed or blocked actions (activationPipeline.ts and
// actions/guard.ts). The localized `reason` text is never classified.
const FAILURE_CODE_TABLE: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["busy_timing", ["BLOCKED_SELECTION_ACTIVE", "BLOCKED_RESOLVING", "BLOCKED_CHAIN_WINDOW_OPEN", "BLOCKED_FAST_EFFECT_TIMING"]],
  ["wrong_context", ["BLOCKED_WRONG_PHASE", "BLOCKED_NOT_YOUR_TURN", "BLOCKED_BATTLE_PHASE_LOCK", "BLOCKED_GAME_DISPOSED"]],
  ["usage_limit", ["ACTIVATION_USAGE_LIMIT"]],
  ["opponent_response", ["ACTIVATION_NEGATED"]],
  ["cost", ["ACTIVATION_COST_UNAVAILABLE", "ACTIVATION_COST_SELECTION_INVALID", "ACTIVATION_COST_SELECTION_CANCELLED",
    "ACTIVATION_COMMITMENT_UNAVAILABLE"]],
  ["target_selection", ["TARGET_SELECTION_FAILED", "INVALID_ACTIVATION_TARGET", "AUTO_SELECTION_FAILED", "SELECTION_ABORTED",
    "CANCELLED", "ACTIVATION_TARGET_COUNT_MISMATCH", "ACTIVATION_TARGET_COUNT_UNAVAILABLE",
    "ACTIVATION_TARGET_SELECTION_FAILED_AFTER_COMMIT"]],
  ["revalidation", ["ACTIVATION_REVALIDATION_FAILED", "ACTIVATION_SOURCE_MOVED", "ACTIVATION_CASE_UNAVAILABLE"]],
  ["resolution", ["RESOLUTION_FAILED", "ACTIVATION_COMMIT_FAILED"]],
  ["config", ["INVALID_ACTIVATION_CONFIG"]],
];

export const FAILURE_CODE_CLASSES: ReadonlyMap<string, string> = new Map(
  FAILURE_CODE_TABLE.flatMap(([failureClass, codes]) => codes.map(code => [code, failureClass] as const)),
);

/** A missing code is "uncoded"; a code outside the table stays visible as "unclassified:<code>". */
export function classifyFailureCode(code: string | null): string {
  if (!code) return "uncoded";
  return FAILURE_CODE_CLASSES.get(code) ?? `unclassified:${code}`;
}

// ── Canonical serialization ────────────────────────────────────────────────

export function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function serializeCanonical(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`${path}: número não finito não pode ser serializado.`);
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        const items: string[] = [];
        for (let index = 0; index < value.length; index += 1) {
          if (!Object.hasOwn(value, index)) throw new TypeError(`${path}[${index}]: arrays esparsos não podem ser serializados.`);
          items.push(serializeCanonical(value[index], `${path}[${index}]`));
        }
        return `[${items.join(",")}]`;
      }
      const prototype: unknown = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${path}: só objetos simples podem ser serializados.`);
      }
      const keys = Object.keys(value).sort(compareCodeUnits);
      return `{${keys.map(key => `${JSON.stringify(key)}:${serializeCanonical(Reflect.get(value, key), `${path}.${key}`)}`).join(",")}}`;
    }
    default:
      throw new TypeError(`${path}: valores do tipo ${typeof value} não podem ser serializados.`);
  }
}

/**
 * Canonical JSON: object keys sorted by code unit, no key dropped, and an
 * error for undefined, NaN, Infinity, functions and non-plain objects.
 */
export function canonicalJson(value: unknown): string {
  return serializeCanonical(value, "$");
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function digestOf(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

// ── Matrix ─────────────────────────────────────────────────────────────────

export interface BenchmarkCase {
  caseIndex: number;
  /** `${seat1}:${seat2}:${k}`. */
  caseId: string;
  k: number;
  /** Unordered pair in canonical preset order: `${earlier}|${later}`. */
  pair: string;
  mirror: boolean;
  /** Preset of the "player" seat. */
  seat1: string;
  /** Preset of the "bot" seat. */
  seat2: string;
  seed: number;
}

export interface MatrixOptions {
  /** Presets in canonical order. */
  presets: readonly string[];
  seeds: number;
  seedBase: number;
}

export function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

export function seedFor(seedBase: number, k: number): number {
  return (seedBase + k) >>> 0;
}

/**
 * 81·N cases for nine presets. k is the outer loop and every matchup of a
 * seed index shares seed_k; each unordered pair plays a:b then b:a, and a
 * mirror plays once.
 */
export function buildMatrixCases(options: MatrixOptions): BenchmarkCase[] {
  if (!Number.isSafeInteger(options.seeds) || options.seeds < 1) throw new RangeError("seeds deve ser um inteiro positivo.");
  if (!isUint32(options.seedBase)) throw new RangeError("seedBase deve ser um inteiro entre 0 e 4294967295.");
  if (!options.presets.length) throw new RangeError("É preciso ao menos um preset.");
  if (new Set(options.presets).size !== options.presets.length) throw new RangeError("Os presets devem ser únicos.");
  for (const preset of options.presets) {
    if (!/^[a-z0-9_-]+$/i.test(preset)) throw new RangeError(`ID de preset inválido: ${preset}.`);
  }
  const cases: BenchmarkCase[] = [];
  const push = (seat1: string, seat2: string, pair: string, mirror: boolean, k: number, seed: number) => {
    cases.push({ caseIndex: cases.length, caseId: `${seat1}:${seat2}:${k}`, k, pair, mirror, seat1, seat2, seed });
  };
  for (let k = 0; k < options.seeds; k += 1) {
    const seed = seedFor(options.seedBase, k);
    for (let first = 0; first < options.presets.length; first += 1) {
      for (let second = first; second < options.presets.length; second += 1) {
        const a = options.presets[first];
        const b = options.presets[second];
        if (a === undefined || b === undefined) continue;
        const pair = `${a}|${b}`;
        if (first === second) {
          push(a, a, pair, true, k, seed);
        } else {
          push(a, b, pair, false, k, seed);
          push(b, a, pair, false, k, seed);
        }
      }
    }
  }
  return cases;
}

function globSegment(segment: string): RegExp {
  const escaped = segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^:]*");
  return new RegExp(`^${escaped}$`);
}

/** Case filter patterns have three ':' segments; `*` matches within one segment. */
export function validateCaseFilterPattern(pattern: string): void {
  const segments = pattern.split(":");
  if (segments.length !== 3 || segments.some(segment => !segment || !/^[a-z0-9_*-]+$/i.test(segment))) {
    throw new RangeError(`Padrão de caso inválido "${pattern}". Use assento1:assento2:k com * por segmento, por exemplo void:bloomrot:* ou *:techzero:0.`);
  }
}

export function matchCaseFilter(patterns: readonly string[] | null, caseId: string): boolean {
  if (patterns === null) return true;
  const target = caseId.split(":");
  return patterns.some(pattern => {
    const segments = pattern.split(":");
    return segments.length === target.length &&
      segments.every((segment, index) => globSegment(segment).test(target[index] ?? ""));
  });
}

export function planCases(config: Pick<RunConfig, "presets" | "seeds" | "caseFilter">): BenchmarkCase[] {
  return buildMatrixCases({ presets: config.presets, seeds: config.seeds.count, seedBase: config.seeds.base })
    .filter(entry => matchCaseFilter(config.caseFilter, entry.caseId));
}

// ── Run header ─────────────────────────────────────────────────────────────

export interface RunIdentity {
  commit: string;
  dirty: boolean;
  dirtyDiffSha256: string | null;
  engineVersion: string;
  cardDatabaseSignature: string;
  cardDatabaseSha256: string;
  node: string;
  lockfileSha256: string;
}

export interface BeamProfileConfig {
  beamWidth: number;
  maxDepth: number;
  nodeBudget: number;
  source: "custom" | "speed_preset";
}

export interface PlannerBudgets {
  beamWidth: number | null;
  maxDepth: number | null;
  nodeBudget: number | null;
  candidateLimit: number | null;
}

export interface PlannerProfileConfig {
  /** Mode the Arena imposes from its speed preset (its getPlannerConfig default). */
  arenaMode: string;
  arenaTurnMode: string | null;
  arenaBudgets: PlannerBudgets;
  /** Planner budgets come from each strategy's getPlanningProfile; no planner* is passed. */
  budgetsSource: "strategy_profile";
  customBudgets: false;
  modeOverride: PlannerMode | null;
  turnModeOverride: PlannerTurnMode | null;
  /** "strategy" removes arenaPlanner* before start (H1 proof only, never a baseline). */
  modeSource: PlannerModeSource;
}

export interface DelayConfig {
  phaseDelayMs: number;
  aiActionDelayMs: number;
  aiSuccessfulActionDelayMs: number;
  aiPresentationStepDelayMs: number;
  aiBattleDelayMs: number;
  disablePresentationDelays: boolean;
  presentationDelayGate: "bypassed_by_zero_values";
  damageCalculationStatDelay: "gated";
}

export interface EnvironmentConfig {
  renderer: "null";
  requestAnimationFrame: false;
  localStorage: "memory-empty";
  consoleLog: "silenced";
  isolation: "process-per-case";
  captureReplay: false;
}

export interface StallGuardConfig extends GuardLimits {
  mode: GuardMode;
}

export interface DeckConfig {
  main: number[];
  extra: number[];
  mainSha256: string;
  extraSha256: string;
}

export interface SeedConfig {
  base: number;
  count: number;
  values: number[];
  rule: string;
}

export interface MatrixConfig {
  mirrors: true;
  plannedCases: number;
  caseListSha256: string;
}

export interface RunConfig {
  profile: BenchmarkProfile;
  speed: "instant";
  beam: BeamProfileConfig;
  planner: PlannerProfileConfig;
  delays: DelayConfig;
  environment: EnvironmentConfig;
  maxTurns: number;
  timeoutMs: number;
  timeoutOutcome: "error";
  stallGuard: StallGuardConfig;
  /** Every preset the environment offers, in canonical order. */
  availablePresets: string[];
  /** Presets of this run: an ordered subset of availablePresets. */
  presets: string[];
  decks: Record<string, DeckConfig>;
  decksSha256: string;
  banlistSha256: string;
  seeds: SeedConfig;
  matrix: MatrixConfig;
  presetMetrics: PresetMetricId[];
  strategyOverrides: Record<string, string>;
  caseFilter: string[] | null;
  /** Present only when the run carries the invariance control; absent, the configuration is unchanged. */
  invarianceControl?: InvarianceControlConfig;
}

export const SEED_RULE = "seed_k = (base + k) >>> 0; a:b and b:a share seed_k; mirrors play once";

export interface RunClock {
  createdAt: string;
  host: { platform: string; arch: string; cpus: number };
  workers: number;
  order: RunOrder;
}

export interface RunHeader {
  schema: typeof RUN_SCHEMA;
  version: number;
  recordVersion: number;
  runId: string;
  identity: RunIdentity;
  config: RunConfig;
  configDigest: string;
  identityDigest: string;
  clock: RunClock;
}

export function caseListDigest(cases: readonly BenchmarkCase[]): string {
  return digestOf(cases.map(entry => entry.caseId));
}

export function buildRunId(profile: BenchmarkProfile, identity: RunIdentity, configDigest: string): string {
  return `${profile}-${identity.commit.slice(0, 7)}${identity.dirty ? "-dirty" : ""}-${configDigest.slice(0, 8)}`;
}

const GUARD_LIMIT_KEYS: ReadonlyArray<keyof GuardLimits> = ["decisionsPerTurn", "actionsPerTurn", "progressPerTurn"];

/**
 * A run is a baseline candidate only with the canonical configuration: the
 * full preset matrix of its environment, the default turn limit, wall clock,
 * seed base and guard limits, no filter, override or debug mode. The sample
 * size (seeds.count) is reported, not judged here.
 */
export function configBaselineBlockers(config: RunConfig): string[] {
  const blockers: string[] = [];
  if (config.profile !== "canonical") blockers.push("profile");
  if (config.planner.modeSource !== "arena") blockers.push("planner.modeSource");
  if (config.planner.modeOverride !== null || config.planner.turnModeOverride !== null) blockers.push("planner.override");
  if (config.stallGuard.mode !== "enforce") blockers.push("stallGuard.mode");
  if (GUARD_LIMIT_KEYS.some(key => config.stallGuard[key] !== DEFAULT_GUARD[key])) blockers.push("stallGuard.limits");
  if (canonicalJson(config.presets) !== canonicalJson(config.availablePresets)) blockers.push("presets");
  if (config.maxTurns !== DEFAULT_MAX_TURNS) blockers.push("maxTurns");
  if (config.timeoutMs !== DEFAULT_TIMEOUT_MS) blockers.push("timeoutMs");
  if (config.seeds.base !== DEFAULT_SEED_BASE) blockers.push("seeds.base");
  if (config.caseFilter !== null) blockers.push("caseFilter");
  if (Object.keys(config.strategyOverrides).length) blockers.push("strategyOverrides");
  if (config.invarianceControl !== undefined) blockers.push("invarianceControl");
  return blockers;
}

// ── Duel record v1 ─────────────────────────────────────────────────────────

export interface DuelStart {
  seat: Seat;
  preset: string;
  rngCalls: number;
}

export interface DuelOutcome {
  status: "valid" | "error";
  endReason: "lp_zero" | "max_turns" | "error";
  errorKind: ErrorKind | null;
  decidedBy: DecidedBy | null;
  winnerSeat: Seat | null;
  winnerPreset: string | null;
  draw: boolean;
  turns: number | null;
  finalLP: { player: number; bot: number } | null;
  message: string | null;
}

export interface GuardStage {
  stage: string;
  turn: number;
  phase: string | null;
  actor: string | null;
}

export interface GuardTrip {
  counter: GuardCounterName;
  turn: number;
  phase: string | null;
  value: number;
  limit: number;
  lastStages: GuardStage[];
}

export interface GuardPeaks {
  decisions: number;
  actions: number;
  progress: number;
}

export interface GuardRecord {
  peaks: GuardPeaks | null;
  trip: GuardTrip | null;
}

export interface ProfilesRecord {
  beam: string;
  planner: { player: Counter; bot: Counter };
}

// Keys of planning.mismatchBySeverity (phase 2.3 plan, E4). A key without
// FAILED_MARK_PREFIX is the severity of one divergent comparison, so those keys
// add up to planning.mismatches, an invariant the analyzer checks. A key with
// the prefix marks a failed comparison (planning.failed), whose reason stays
// action_failed, and stays outside that sum.
export const FAILED_MARK_PREFIX = "failed:";
/** Only the opponent diverged, and a card of its face-down backrow left its zone or was revealed. */
export const BACKROW_REACTION_SEVERITY = "opponent_backrow_reaction";
/** The planned action failed while a card of the opponent's face-down backrow left its zone or was revealed. */
export const FAILED_BACKROW_REACTION_KEY = `${FAILED_MARK_PREFIX}${BACKROW_REACTION_SEVERITY}`;

export interface SeatMetrics {
  preset: string;
  decisions: { mainPhase: number; measured: number; broker: number };
  planning: {
    searches: number;
    used: number;
    comparisons: number;
    matches: number;
    mismatches: number;
    failed: { notExecuted: number; executedRejected: number };
    /** Severities of the divergent comparisons, plus FAILED_MARK_PREFIX marks outside their sum. */
    mismatchBySeverity: Counter;
    mismatchByPath: Counter;
    terminations: Counter;
    repeatedStates: number;
  };
  unsupported: {
    tlsBranches: number;
    tlsByFamily: Counter;
    tlsByMarker: Counter;
    beamGreedyByFamily: Counter;
    beamGreedyByMarker: Counter;
    otherByFamily: Counter;
  };
  nodes: { tls: number; beamGreedySimulations: number; otherSimulations: number };
  actions: {
    attempts: number;
    failed: number;
    blocked: number;
    failedByClass: Counter;
    failedByCode: Counter;
    blockedByCode: Counter;
    invalidByCard: Counter;
  };
  mainPhaseExits: Counter;
}

export interface TechZeroComboSeat {
  summonsById: Counter;
  comboTurns: number[];
}

export interface LethalSeat {
  /** Battle phases projected (once per seat and turn). */
  projections: number;
  opportunities: number;
  converted: number;
  unconverted: number;
}

export interface PresetMetricsRecord {
  "techzero-combo": { player: TechZeroComboSeat | null; bot: TechZeroComboSeat | null } | null;
  lethal: { player: LethalSeat; bot: LethalSeat } | null;
}

export interface MismatchSample {
  turn: number;
  phase: string | null;
  stage: string;
  actor: Seat;
  severity: string;
  paths: string[];
  plannedAction: string | null;
  actualAction: string | null;
}

export interface DuelDiagnostics {
  consoleErrors: number;
  consoleWarnings: number;
  errorLabels: Counter;
  warningLabels: Counter;
  unhandledRejections: number;
  processWarnings: number;
  observerErrors: number;
  mathRandomCalls: number;
  mismatchSamples: MismatchSample[];
}

export interface CrossCheckDiff {
  seat: Seat;
  field: string;
  observer: number;
  tracker: number;
}

export interface CrossCheck {
  status: "ok" | "failed" | "skipped";
  diffs: CrossCheckDiff[];
}

export interface DuelClock {
  duelMs: number | null;
  workerMs: number | null;
  decisionLatencyMs: { player: number[]; bot: number[] };
  /** Wall-clock-driven tracker snapshots (zero-event watchdog); never part of the deterministic record. */
  watchdogStages: number;
  partial: JsonValue | null;
}

export interface DuelRecordV1 {
  schema: typeof DUEL_SCHEMA;
  v: number;
  caseIndex: number;
  caseId: string;
  k: number;
  pair: string;
  mirror: boolean;
  seats: { player: string; bot: string };
  seed: number;
  effectiveSeed: number | null;
  start: DuelStart | null;
  opening: { digest: string } | null;
  outcome: DuelOutcome;
  guard: GuardRecord;
  profiles: ProfilesRecord | null;
  seatMetrics: { player: SeatMetrics; bot: SeatMetrics } | null;
  presetMetrics: PresetMetricsRecord | null;
  diag: DuelDiagnostics;
  crossCheck: CrossCheck;
  clock: DuelClock;
}

export type DeterministicDuelRecord = Omit<DuelRecordV1, "clock">;

export function stripClock(record: DuelRecordV1): DeterministicDuelRecord {
  const { clock: _clock, ...deterministic } = record;
  return deterministic;
}

export function sortByCaseIndex<Entry extends { caseIndex: number }>(entries: readonly Entry[]): Entry[] {
  return [...entries].sort((left, right) => left.caseIndex - right.caseIndex);
}

/** sha256 of the records without `clock`, one canonical line each, in caseIndex order. */
export function deterministicDigest(records: readonly DuelRecordV1[]): string {
  const hash = createHash("sha256");
  for (const record of sortByCaseIndex(records)) hash.update(`${canonicalJson(stripClock(record))}\n`);
  return hash.digest("hex");
}

export function recordLine(record: DuelRecordV1): string {
  return `${canonicalJson(record)}\n`;
}

/**
 * Parent-side record of a case whose worker produced no result. Only the first
 * line of the message is kept: stacks carry absolute paths and line numbers,
 * so they belong to logs/, never to the deterministic record.
 */
export function workerLostRecord(entry: BenchmarkCase, message: string, workerMs: number | null): DuelRecordV1 {
  const firstLine = message.split(/\r?\n/, 1)[0] ?? "";
  return {
    schema: DUEL_SCHEMA,
    v: DUEL_RECORD_VERSION,
    caseIndex: entry.caseIndex,
    caseId: entry.caseId,
    k: entry.k,
    pair: entry.pair,
    mirror: entry.mirror,
    seats: { player: entry.seat1, bot: entry.seat2 },
    seed: entry.seed,
    effectiveSeed: null,
    start: null,
    opening: null,
    outcome: {
      status: "error", endReason: "error", errorKind: "worker_lost", decidedBy: null, winnerSeat: null,
      winnerPreset: null, draw: false, turns: null, finalLP: null, message: firstLine,
    },
    guard: { peaks: null, trip: null },
    profiles: null,
    seatMetrics: null,
    presetMetrics: null,
    diag: {
      consoleErrors: 0, consoleWarnings: 0, errorLabels: {}, warningLabels: {}, unhandledRejections: 0,
      processWarnings: 0, observerErrors: 0, mathRandomCalls: 0, mismatchSamples: [],
    },
    crossCheck: { status: "skipped", diffs: [] },
    clock: { duelMs: null, workerMs, decisionLatencyMs: { player: [], bot: [] }, watchdogStages: 0, partial: null },
  };
}

// ── Process boundary ───────────────────────────────────────────────────────

export interface SpeedDescription {
  phaseDelayMs: number;
  actionDelayMs: number;
  battleDelayMs: number;
  pollIntervalMs: number;
  useRenderer: boolean;
  timeoutMs: number;
  beamWidth: number;
  maxDepth: number;
  nodeBudget: number;
  planner: {
    mode: string;
    turnMode: string | null;
    beamWidth: number | null;
    maxDepth: number | null;
    nodeBudget: number | null;
    candidateLimit: number | null;
  };
}

/** Engine facts read by a describe worker, so that the parent never loads the engine. */
export interface EnvironmentDescription {
  engineVersion: string;
  cardDatabaseSignature: string;
  cardDatabaseSha256: string;
  presets: string[];
  decks: Record<string, { main: number[]; extra: number[] }>;
  strategyIds: string[];
  banlist: Record<string, string>;
  instant: SpeedDescription;
}

export interface RunEnd {
  schema: typeof RUN_END_SCHEMA;
  version: number;
  runId: string;
  finishedAt: string;
  wallMs: number;
  identity: RunIdentity;
  identityDigest: string;
  identityChangedDuringRun: boolean;
  identityDiff: Array<{ field: string; start: JsonValue; end: JsonValue }>;
}

// ── Strict validation ──────────────────────────────────────────────────────

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}

type JsonObject = Record<string, unknown>;

function fail(label: string, message: string): never {
  throw new SchemaError(`${label} ${message}`);
}

export function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(label, "deve ser um objeto.");
  const result: JsonObject = {};
  for (const key of Object.keys(value)) result[key] = Reflect.get(value, key);
  return result;
}

function exactKeys(value: JsonObject, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(label, `não tem "${key}".`);
  for (const key of Object.keys(value)) if (!expected.has(key)) fail(label, `tem a chave desconhecida "${key}".`);
}

export function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(label, "deve ser um array.");
  return value;
}

export function string(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value)) fail(label, allowEmpty ? "deve ser uma string." : "deve ser uma string não vazia.");
  return value;
}

export function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    fail(label, `deve ser um inteiro >= ${minimum}.`);
  }
  return value;
}

export function finiteNumber(value: unknown, label: string, minimum = Number.NEGATIVE_INFINITY): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) fail(label, "deve ser um número finito.");
  return value;
}

export function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(label, "deve ser um booleano.");
  return value;
}

export function oneOf<Value extends string>(value: unknown, options: readonly Value[], label: string): Value {
  const match = options.find(option => option === value);
  if (match === undefined) fail(label, `deve ser um de: ${options.join(", ")}.`);
  return match;
}

function literal<Value extends string | number | boolean>(value: unknown, expected: Value, label: string): Value {
  if (value !== expected) fail(label, `deve ser ${JSON.stringify(expected)}.`);
  return expected;
}

function nullable<Value>(value: unknown, parse: (entry: unknown) => Value): Value | null {
  return value === null ? null : parse(value);
}

export function counter(value: unknown, label: string): Counter {
  const source = object(value, label);
  const result: Counter = {};
  for (const [key, count] of Object.entries(source)) result[key] = integer(count, `${label}.${key}`);
  return result;
}

function stringArray(value: unknown, label: string): string[] {
  return array(value, label).map((entry, index) => string(entry, `${label}[${index}]`));
}

function integerArray(value: unknown, label: string, minimum = 0): number[] {
  return array(value, label).map((entry, index) => integer(entry, `${label}[${index}]`, minimum));
}

function numberArray(value: unknown, label: string): number[] {
  return array(value, label).map((entry, index) => finiteNumber(entry, `${label}[${index}]`, 0));
}

function sha256String(value: unknown, label: string): string {
  const text = string(value, label);
  if (!/^[0-9a-f]{64}$/.test(text)) fail(label, "deve ser um digest sha256 em hexadecimal.");
  return text;
}

export function seat(value: unknown, label: string): Seat {
  return oneOf(value, SEATS, label);
}

export function jsonValue(value: unknown, label: string): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return finiteNumber(value, label);
  if (Array.isArray(value)) return value.map((entry, index) => jsonValue(entry, `${label}[${index}]`));
  const source = object(value, label);
  const result: { [key: string]: JsonValue } = {};
  for (const [key, entry] of Object.entries(source)) result[key] = jsonValue(entry, `${label}.${key}`);
  return result;
}

function parseIdentity(value: unknown, label: string): RunIdentity {
  const raw = object(value, label);
  exactKeys(raw, ["commit", "dirty", "dirtyDiffSha256", "engineVersion", "cardDatabaseSignature", "cardDatabaseSha256",
    "node", "lockfileSha256"], label);
  const dirty = boolean(raw.dirty, `${label}.dirty`);
  const dirtyDiffSha256 = nullable(raw.dirtyDiffSha256, entry => sha256String(entry, `${label}.dirtyDiffSha256`));
  if (dirty !== (dirtyDiffSha256 !== null)) fail(label, "deve trazer dirtyDiffSha256 exatamente quando a árvore está suja.");
  return {
    commit: string(raw.commit, `${label}.commit`),
    dirty,
    dirtyDiffSha256,
    engineVersion: string(raw.engineVersion, `${label}.engineVersion`),
    cardDatabaseSignature: string(raw.cardDatabaseSignature, `${label}.cardDatabaseSignature`),
    cardDatabaseSha256: sha256String(raw.cardDatabaseSha256, `${label}.cardDatabaseSha256`),
    node: string(raw.node, `${label}.node`),
    lockfileSha256: sha256String(raw.lockfileSha256, `${label}.lockfileSha256`),
  };
}

function parsePlannerBudgets(value: unknown, label: string): PlannerBudgets {
  const raw = object(value, label);
  exactKeys(raw, ["beamWidth", "maxDepth", "nodeBudget", "candidateLimit"], label);
  return {
    beamWidth: nullable(raw.beamWidth, entry => integer(entry, `${label}.beamWidth`, 1)),
    maxDepth: nullable(raw.maxDepth, entry => integer(entry, `${label}.maxDepth`, 1)),
    nodeBudget: nullable(raw.nodeBudget, entry => integer(entry, `${label}.nodeBudget`, 1)),
    candidateLimit: nullable(raw.candidateLimit, entry => integer(entry, `${label}.candidateLimit`, 1)),
  };
}

function parseConfig(value: unknown, label: string): RunConfig {
  const raw = object(value, label);
  // The invariance control is the only optional key: a run without it keeps the v1 configuration exactly.
  const invarianceControl = Object.hasOwn(raw, "invarianceControl");
  exactKeys(raw, ["profile", "speed", "beam", "planner", "delays", "environment", "maxTurns", "timeoutMs", "timeoutOutcome",
    "stallGuard", "availablePresets", "presets", "decks", "decksSha256", "banlistSha256", "seeds", "matrix", "presetMetrics",
    "strategyOverrides", "caseFilter", ...(invarianceControl ? ["invarianceControl"] : [])], label);
  const beam = object(raw.beam, `${label}.beam`);
  exactKeys(beam, ["beamWidth", "maxDepth", "nodeBudget", "source"], `${label}.beam`);
  const planner = object(raw.planner, `${label}.planner`);
  exactKeys(planner, ["arenaMode", "arenaTurnMode", "arenaBudgets", "budgetsSource", "customBudgets", "modeOverride",
    "turnModeOverride", "modeSource"], `${label}.planner`);
  const delays = object(raw.delays, `${label}.delays`);
  exactKeys(delays, ["phaseDelayMs", "aiActionDelayMs", "aiSuccessfulActionDelayMs", "aiPresentationStepDelayMs",
    "aiBattleDelayMs", "disablePresentationDelays", "presentationDelayGate", "damageCalculationStatDelay"], `${label}.delays`);
  const environment = object(raw.environment, `${label}.environment`);
  exactKeys(environment, ["renderer", "requestAnimationFrame", "localStorage", "consoleLog", "isolation", "captureReplay"],
    `${label}.environment`);
  const guard = object(raw.stallGuard, `${label}.stallGuard`);
  exactKeys(guard, ["mode", "decisionsPerTurn", "actionsPerTurn", "progressPerTurn"], `${label}.stallGuard`);
  const availablePresets = stringArray(raw.availablePresets, `${label}.availablePresets`);
  if (!availablePresets.length || new Set(availablePresets).size !== availablePresets.length) {
    fail(`${label}.availablePresets`, "devem ser únicos e não vazios.");
  }
  const presets = stringArray(raw.presets, `${label}.presets`);
  if (!presets.length || new Set(presets).size !== presets.length) fail(`${label}.presets`, "devem ser únicos e não vazios.");
  // The plan always follows the canonical order of the environment's presets.
  if (canonicalJson(availablePresets.filter(preset => presets.includes(preset))) !== canonicalJson(presets)) {
    fail(`${label}.presets`, "devem ser um subconjunto de availablePresets, na mesma ordem.");
  }
  const decksRaw = object(raw.decks, `${label}.decks`);
  exactKeys(decksRaw, presets, `${label}.decks`);
  const decks: Record<string, DeckConfig> = {};
  for (const preset of presets) {
    const deckLabel = `${label}.decks.${preset}`;
    const deck = object(decksRaw[preset], deckLabel);
    exactKeys(deck, ["main", "extra", "mainSha256", "extraSha256"], deckLabel);
    decks[preset] = {
      main: integerArray(deck.main, `${deckLabel}.main`, 1),
      extra: integerArray(deck.extra, `${deckLabel}.extra`, 1),
      mainSha256: sha256String(deck.mainSha256, `${deckLabel}.mainSha256`),
      extraSha256: sha256String(deck.extraSha256, `${deckLabel}.extraSha256`),
    };
  }
  const seeds = object(raw.seeds, `${label}.seeds`);
  exactKeys(seeds, ["base", "count", "values", "rule"], `${label}.seeds`);
  const matrix = object(raw.matrix, `${label}.matrix`);
  exactKeys(matrix, ["mirrors", "plannedCases", "caseListSha256"], `${label}.matrix`);
  const overridesRaw = object(raw.strategyOverrides, `${label}.strategyOverrides`);
  const strategyOverrides: Record<string, string> = {};
  for (const [target, source] of Object.entries(overridesRaw)) {
    strategyOverrides[target] = string(source, `${label}.strategyOverrides.${target}`);
  }
  const caseFilter = nullable(raw.caseFilter, entry => stringArray(entry, `${label}.caseFilter`));
  for (const pattern of caseFilter ?? []) validateCaseFilterPattern(pattern);
  const presetMetrics = array(raw.presetMetrics, `${label}.presetMetrics`)
    .map((entry, index) => oneOf(entry, PRESET_METRIC_IDS, `${label}.presetMetrics[${index}]`));
  if (new Set(presetMetrics).size !== presetMetrics.length) fail(`${label}.presetMetrics`, "devem ser únicas.");
  const config: RunConfig = {
    profile: oneOf(raw.profile, BENCHMARK_PROFILES, `${label}.profile`),
    speed: literal(raw.speed, "instant", `${label}.speed`),
    beam: {
      beamWidth: integer(beam.beamWidth, `${label}.beam.beamWidth`, 1),
      maxDepth: integer(beam.maxDepth, `${label}.beam.maxDepth`, 1),
      nodeBudget: integer(beam.nodeBudget, `${label}.beam.nodeBudget`, 1),
      source: oneOf(beam.source, ["custom", "speed_preset"] as const, `${label}.beam.source`),
    },
    planner: {
      arenaMode: string(planner.arenaMode, `${label}.planner.arenaMode`),
      arenaTurnMode: nullable(planner.arenaTurnMode, entry => string(entry, `${label}.planner.arenaTurnMode`)),
      arenaBudgets: parsePlannerBudgets(planner.arenaBudgets, `${label}.planner.arenaBudgets`),
      budgetsSource: literal(planner.budgetsSource, "strategy_profile", `${label}.planner.budgetsSource`),
      customBudgets: literal(planner.customBudgets, false, `${label}.planner.customBudgets`),
      modeOverride: nullable(planner.modeOverride, entry => oneOf(entry, PLANNER_MODES, `${label}.planner.modeOverride`)),
      turnModeOverride: nullable(planner.turnModeOverride,
        entry => oneOf(entry, PLANNER_TURN_MODES, `${label}.planner.turnModeOverride`)),
      modeSource: oneOf(planner.modeSource, PLANNER_MODE_SOURCES, `${label}.planner.modeSource`),
    },
    delays: {
      phaseDelayMs: integer(delays.phaseDelayMs, `${label}.delays.phaseDelayMs`),
      aiActionDelayMs: integer(delays.aiActionDelayMs, `${label}.delays.aiActionDelayMs`),
      aiSuccessfulActionDelayMs: integer(delays.aiSuccessfulActionDelayMs, `${label}.delays.aiSuccessfulActionDelayMs`),
      aiPresentationStepDelayMs: integer(delays.aiPresentationStepDelayMs, `${label}.delays.aiPresentationStepDelayMs`),
      aiBattleDelayMs: integer(delays.aiBattleDelayMs, `${label}.delays.aiBattleDelayMs`),
      disablePresentationDelays: boolean(delays.disablePresentationDelays, `${label}.delays.disablePresentationDelays`),
      presentationDelayGate: literal(delays.presentationDelayGate, "bypassed_by_zero_values", `${label}.delays.presentationDelayGate`),
      damageCalculationStatDelay: literal(delays.damageCalculationStatDelay, "gated", `${label}.delays.damageCalculationStatDelay`),
    },
    environment: {
      renderer: literal(environment.renderer, "null", `${label}.environment.renderer`),
      requestAnimationFrame: literal(environment.requestAnimationFrame, false, `${label}.environment.requestAnimationFrame`),
      localStorage: literal(environment.localStorage, "memory-empty", `${label}.environment.localStorage`),
      consoleLog: literal(environment.consoleLog, "silenced", `${label}.environment.consoleLog`),
      isolation: literal(environment.isolation, "process-per-case", `${label}.environment.isolation`),
      captureReplay: literal(environment.captureReplay, false, `${label}.environment.captureReplay`),
    },
    maxTurns: integer(raw.maxTurns, `${label}.maxTurns`, 1),
    timeoutMs: integer(raw.timeoutMs, `${label}.timeoutMs`, 1),
    timeoutOutcome: literal(raw.timeoutOutcome, "error", `${label}.timeoutOutcome`),
    stallGuard: {
      mode: oneOf(guard.mode, ["enforce", "observe"] as const, `${label}.stallGuard.mode`),
      decisionsPerTurn: integer(guard.decisionsPerTurn, `${label}.stallGuard.decisionsPerTurn`, 1),
      actionsPerTurn: integer(guard.actionsPerTurn, `${label}.stallGuard.actionsPerTurn`, 1),
      progressPerTurn: integer(guard.progressPerTurn, `${label}.stallGuard.progressPerTurn`, 1),
    },
    availablePresets,
    presets,
    decks,
    decksSha256: sha256String(raw.decksSha256, `${label}.decksSha256`),
    banlistSha256: sha256String(raw.banlistSha256, `${label}.banlistSha256`),
    seeds: {
      base: integer(seeds.base, `${label}.seeds.base`),
      count: integer(seeds.count, `${label}.seeds.count`, 1),
      values: integerArray(seeds.values, `${label}.seeds.values`),
      rule: string(seeds.rule, `${label}.seeds.rule`),
    },
    matrix: {
      mirrors: literal(matrix.mirrors, true, `${label}.matrix.mirrors`),
      plannedCases: integer(matrix.plannedCases, `${label}.matrix.plannedCases`, 1),
      caseListSha256: sha256String(matrix.caseListSha256, `${label}.matrix.caseListSha256`),
    },
    presetMetrics,
    strategyOverrides,
    caseFilter,
  };
  if (invarianceControl) {
    const control = object(raw.invarianceControl, `${label}.invarianceControl`);
    exactKeys(control, ["swap"], `${label}.invarianceControl`);
    config.invarianceControl = { swap: literal(control.swap, INVARIANCE_SWAP_RULE, `${label}.invarianceControl.swap`) };
  }
  if (!isUint32(config.seeds.base)) fail(`${label}.seeds.base`, "deve ser um uint32.");
  const expectedSeeds = Array.from({ length: config.seeds.count }, (_, k) => seedFor(config.seeds.base, k));
  if (canonicalJson(expectedSeeds) !== canonicalJson(config.seeds.values)) fail(`${label}.seeds.values`, "não seguem a regra das seeds.");
  return config;
}

export function parseRunHeader(value: unknown, label = "header"): RunHeader {
  const raw = object(value, label);
  exactKeys(raw, ["schema", "version", "recordVersion", "runId", "identity", "config", "configDigest", "identityDigest", "clock"], label);
  literal(raw.schema, RUN_SCHEMA, `${label}.schema`);
  literal(raw.version, RUN_SCHEMA_VERSION, `${label}.version`);
  literal(raw.recordVersion, DUEL_RECORD_VERSION, `${label}.recordVersion`);
  const clock = object(raw.clock, `${label}.clock`);
  exactKeys(clock, ["createdAt", "host", "workers", "order"], `${label}.clock`);
  const host = object(clock.host, `${label}.clock.host`);
  exactKeys(host, ["platform", "arch", "cpus"], `${label}.clock.host`);
  const header: RunHeader = {
    schema: RUN_SCHEMA,
    version: RUN_SCHEMA_VERSION,
    recordVersion: DUEL_RECORD_VERSION,
    runId: string(raw.runId, `${label}.runId`),
    identity: parseIdentity(raw.identity, `${label}.identity`),
    config: parseConfig(raw.config, `${label}.config`),
    configDigest: sha256String(raw.configDigest, `${label}.configDigest`),
    identityDigest: sha256String(raw.identityDigest, `${label}.identityDigest`),
    clock: {
      createdAt: string(clock.createdAt, `${label}.clock.createdAt`),
      host: {
        platform: string(host.platform, `${label}.clock.host.platform`),
        arch: string(host.arch, `${label}.clock.host.arch`),
        cpus: integer(host.cpus, `${label}.clock.host.cpus`),
      },
      workers: integer(clock.workers, `${label}.clock.workers`, 1),
      order: oneOf(clock.order, ["forward", "reverse"] as const, `${label}.clock.order`),
    },
  };
  if (digestOf(header.config) !== header.configDigest) fail(`${label}.configDigest`, "não corresponde à configuração.");
  if (digestOf(header.identity) !== header.identityDigest) fail(`${label}.identityDigest`, "não corresponde à identidade.");
  return header;
}

function parseOutcome(value: unknown, label: string): DuelOutcome {
  const raw = object(value, label);
  exactKeys(raw, ["status", "endReason", "errorKind", "decidedBy", "winnerSeat", "winnerPreset", "draw", "turns", "finalLP",
    "message"], label);
  const outcome: DuelOutcome = {
    status: oneOf(raw.status, ["valid", "error"] as const, `${label}.status`),
    endReason: oneOf(raw.endReason, ["lp_zero", "max_turns", "error"] as const, `${label}.endReason`),
    errorKind: nullable(raw.errorKind, entry => oneOf(entry, ERROR_KINDS, `${label}.errorKind`)),
    decidedBy: nullable(raw.decidedBy, entry => oneOf(entry, DECIDED_BY, `${label}.decidedBy`)),
    winnerSeat: nullable(raw.winnerSeat, entry => seat(entry, `${label}.winnerSeat`)),
    winnerPreset: nullable(raw.winnerPreset, entry => string(entry, `${label}.winnerPreset`)),
    draw: boolean(raw.draw, `${label}.draw`),
    turns: nullable(raw.turns, entry => integer(entry, `${label}.turns`)),
    finalLP: nullable(raw.finalLP, entry => {
      const lp = object(entry, `${label}.finalLP`);
      exactKeys(lp, ["player", "bot"], `${label}.finalLP`);
      return { player: finiteNumber(lp.player, `${label}.finalLP.player`), bot: finiteNumber(lp.bot, `${label}.finalLP.bot`) };
    }),
    message: nullable(raw.message, entry => string(entry, `${label}.message`, true)),
  };
  if (outcome.status === "valid") {
    if (outcome.errorKind !== null || outcome.endReason === "error" || outcome.decidedBy === null) {
      fail(label, "é válido, mas traz erro ou não tem decidedBy.");
    }
    const tie = outcome.decidedBy === "tie_at_turn_limit";
    if (tie !== outcome.draw || tie !== (outcome.winnerSeat === null) || (outcome.winnerSeat === null) !== (outcome.winnerPreset === null)) {
      fail(label, "tem um vencedor inconsistente.");
    }
    if ((outcome.endReason === "lp_zero") !== (outcome.decidedBy === "lp_zero")) fail(label, "tem decidedBy inconsistente.");
  } else if (outcome.errorKind === null || outcome.endReason !== "error" || outcome.decidedBy !== null ||
    outcome.winnerSeat !== null || outcome.draw) {
    fail(label, "é erro sem errorKind ou com resultado.");
  }
  return outcome;
}

function parseStage(value: unknown, label: string): GuardStage {
  const raw = object(value, label);
  exactKeys(raw, ["stage", "turn", "phase", "actor"], label);
  return {
    stage: string(raw.stage, `${label}.stage`),
    turn: integer(raw.turn, `${label}.turn`),
    phase: nullable(raw.phase, entry => string(entry, `${label}.phase`)),
    actor: nullable(raw.actor, entry => string(entry, `${label}.actor`)),
  };
}

function parsePeaks(value: unknown, label: string): GuardPeaks {
  const raw = object(value, label);
  exactKeys(raw, ["decisions", "actions", "progress"], label);
  return {
    decisions: integer(raw.decisions, `${label}.decisions`),
    actions: integer(raw.actions, `${label}.actions`),
    progress: integer(raw.progress, `${label}.progress`),
  };
}

function parseGuard(value: unknown, label: string): GuardRecord {
  const raw = object(value, label);
  exactKeys(raw, ["peaks", "trip"], label);
  return {
    peaks: nullable(raw.peaks, entry => parsePeaks(entry, `${label}.peaks`)),
    trip: nullable(raw.trip, entry => {
      const trip = object(entry, `${label}.trip`);
      exactKeys(trip, ["counter", "turn", "phase", "value", "limit", "lastStages"], `${label}.trip`);
      const lastStages = array(trip.lastStages, `${label}.trip.lastStages`)
        .map((stage, index) => parseStage(stage, `${label}.trip.lastStages[${index}]`));
      if (lastStages.length > GUARD_STAGE_RING_SIZE) {
        fail(`${label}.trip.lastStages`, `comporta no máximo ${GUARD_STAGE_RING_SIZE} estágios.`);
      }
      return {
        counter: oneOf(trip.counter, GUARD_COUNTERS, `${label}.trip.counter`),
        turn: integer(trip.turn, `${label}.trip.turn`),
        phase: nullable(trip.phase, phase => string(phase, `${label}.trip.phase`)),
        value: integer(trip.value, `${label}.trip.value`),
        limit: integer(trip.limit, `${label}.trip.limit`),
        lastStages,
      };
    }),
  };
}

function parseSeatMetrics(value: unknown, label: string): SeatMetrics {
  const raw = object(value, label);
  exactKeys(raw, ["preset", "decisions", "planning", "unsupported", "nodes", "actions", "mainPhaseExits"], label);
  const decisions = object(raw.decisions, `${label}.decisions`);
  exactKeys(decisions, ["mainPhase", "measured", "broker"], `${label}.decisions`);
  const planning = object(raw.planning, `${label}.planning`);
  exactKeys(planning, ["searches", "used", "comparisons", "matches", "mismatches", "failed", "mismatchBySeverity",
    "mismatchByPath", "terminations", "repeatedStates"], `${label}.planning`);
  const failed = object(planning.failed, `${label}.planning.failed`);
  exactKeys(failed, ["notExecuted", "executedRejected"], `${label}.planning.failed`);
  const unsupported = object(raw.unsupported, `${label}.unsupported`);
  exactKeys(unsupported, ["tlsBranches", "tlsByFamily", "tlsByMarker", "beamGreedyByFamily", "beamGreedyByMarker",
    "otherByFamily"], `${label}.unsupported`);
  const nodes = object(raw.nodes, `${label}.nodes`);
  exactKeys(nodes, ["tls", "beamGreedySimulations", "otherSimulations"], `${label}.nodes`);
  const actions = object(raw.actions, `${label}.actions`);
  exactKeys(actions, ["attempts", "failed", "blocked", "failedByClass", "failedByCode", "blockedByCode", "invalidByCard"],
    `${label}.actions`);
  return {
    preset: string(raw.preset, `${label}.preset`),
    decisions: {
      mainPhase: integer(decisions.mainPhase, `${label}.decisions.mainPhase`),
      measured: integer(decisions.measured, `${label}.decisions.measured`),
      broker: integer(decisions.broker, `${label}.decisions.broker`),
    },
    planning: {
      searches: integer(planning.searches, `${label}.planning.searches`),
      used: integer(planning.used, `${label}.planning.used`),
      comparisons: integer(planning.comparisons, `${label}.planning.comparisons`),
      matches: integer(planning.matches, `${label}.planning.matches`),
      mismatches: integer(planning.mismatches, `${label}.planning.mismatches`),
      failed: {
        notExecuted: integer(failed.notExecuted, `${label}.planning.failed.notExecuted`),
        executedRejected: integer(failed.executedRejected, `${label}.planning.failed.executedRejected`),
      },
      mismatchBySeverity: counter(planning.mismatchBySeverity, `${label}.planning.mismatchBySeverity`),
      mismatchByPath: counter(planning.mismatchByPath, `${label}.planning.mismatchByPath`),
      terminations: counter(planning.terminations, `${label}.planning.terminations`),
      repeatedStates: integer(planning.repeatedStates, `${label}.planning.repeatedStates`),
    },
    unsupported: {
      tlsBranches: integer(unsupported.tlsBranches, `${label}.unsupported.tlsBranches`),
      tlsByFamily: counter(unsupported.tlsByFamily, `${label}.unsupported.tlsByFamily`),
      tlsByMarker: counter(unsupported.tlsByMarker, `${label}.unsupported.tlsByMarker`),
      beamGreedyByFamily: counter(unsupported.beamGreedyByFamily, `${label}.unsupported.beamGreedyByFamily`),
      beamGreedyByMarker: counter(unsupported.beamGreedyByMarker, `${label}.unsupported.beamGreedyByMarker`),
      otherByFamily: counter(unsupported.otherByFamily, `${label}.unsupported.otherByFamily`),
    },
    nodes: {
      tls: integer(nodes.tls, `${label}.nodes.tls`),
      beamGreedySimulations: integer(nodes.beamGreedySimulations, `${label}.nodes.beamGreedySimulations`),
      otherSimulations: integer(nodes.otherSimulations, `${label}.nodes.otherSimulations`),
    },
    actions: {
      attempts: integer(actions.attempts, `${label}.actions.attempts`),
      failed: integer(actions.failed, `${label}.actions.failed`),
      blocked: integer(actions.blocked, `${label}.actions.blocked`),
      failedByClass: counter(actions.failedByClass, `${label}.actions.failedByClass`),
      failedByCode: counter(actions.failedByCode, `${label}.actions.failedByCode`),
      blockedByCode: counter(actions.blockedByCode, `${label}.actions.blockedByCode`),
      invalidByCard: counter(actions.invalidByCard, `${label}.actions.invalidByCard`),
    },
    mainPhaseExits: counter(raw.mainPhaseExits, `${label}.mainPhaseExits`),
  };
}

function parseComboSeat(value: unknown, label: string): TechZeroComboSeat {
  const raw = object(value, label);
  exactKeys(raw, ["summonsById", "comboTurns"], label);
  return { summonsById: counter(raw.summonsById, `${label}.summonsById`), comboTurns: integerArray(raw.comboTurns, `${label}.comboTurns`) };
}

function parseLethalSeat(value: unknown, label: string): LethalSeat {
  const raw = object(value, label);
  exactKeys(raw, ["projections", "opportunities", "converted", "unconverted"], label);
  return {
    projections: integer(raw.projections, `${label}.projections`),
    opportunities: integer(raw.opportunities, `${label}.opportunities`),
    converted: integer(raw.converted, `${label}.converted`),
    unconverted: integer(raw.unconverted, `${label}.unconverted`),
  };
}

function parsePresetMetrics(value: unknown, label: string): PresetMetricsRecord {
  const raw = object(value, label);
  exactKeys(raw, ["techzero-combo", "lethal"], label);
  return {
    "techzero-combo": nullable(raw["techzero-combo"], entry => {
      const combo = object(entry, `${label}.techzero-combo`);
      exactKeys(combo, ["player", "bot"], `${label}.techzero-combo`);
      return {
        player: nullable(combo.player, seatEntry => parseComboSeat(seatEntry, `${label}.techzero-combo.player`)),
        bot: nullable(combo.bot, seatEntry => parseComboSeat(seatEntry, `${label}.techzero-combo.bot`)),
      };
    }),
    lethal: nullable(raw.lethal, entry => {
      const lethal = object(entry, `${label}.lethal`);
      exactKeys(lethal, ["player", "bot"], `${label}.lethal`);
      return {
        player: parseLethalSeat(lethal.player, `${label}.lethal.player`),
        bot: parseLethalSeat(lethal.bot, `${label}.lethal.bot`),
      };
    }),
  };
}

function parseMismatchSample(value: unknown, label: string): MismatchSample {
  const raw = object(value, label);
  exactKeys(raw, ["turn", "phase", "stage", "actor", "severity", "paths", "plannedAction", "actualAction"], label);
  return {
    turn: integer(raw.turn, `${label}.turn`),
    phase: nullable(raw.phase, entry => string(entry, `${label}.phase`)),
    stage: string(raw.stage, `${label}.stage`),
    actor: seat(raw.actor, `${label}.actor`),
    severity: string(raw.severity, `${label}.severity`),
    paths: stringArray(raw.paths, `${label}.paths`),
    plannedAction: nullable(raw.plannedAction, entry => string(entry, `${label}.plannedAction`)),
    actualAction: nullable(raw.actualAction, entry => string(entry, `${label}.actualAction`)),
  };
}

function parseDiagnostics(value: unknown, label: string): DuelDiagnostics {
  const raw = object(value, label);
  exactKeys(raw, ["consoleErrors", "consoleWarnings", "errorLabels", "warningLabels", "unhandledRejections", "processWarnings",
    "observerErrors", "mathRandomCalls", "mismatchSamples"], label);
  const mismatchSamples = array(raw.mismatchSamples, `${label}.mismatchSamples`)
    .map((entry, index) => parseMismatchSample(entry, `${label}.mismatchSamples[${index}]`));
  if (mismatchSamples.length > MISMATCH_SAMPLE_LIMIT) {
    fail(`${label}.mismatchSamples`, `comporta no máximo ${MISMATCH_SAMPLE_LIMIT} amostras.`);
  }
  return {
    consoleErrors: integer(raw.consoleErrors, `${label}.consoleErrors`),
    consoleWarnings: integer(raw.consoleWarnings, `${label}.consoleWarnings`),
    errorLabels: counter(raw.errorLabels, `${label}.errorLabels`),
    warningLabels: counter(raw.warningLabels, `${label}.warningLabels`),
    unhandledRejections: integer(raw.unhandledRejections, `${label}.unhandledRejections`),
    processWarnings: integer(raw.processWarnings, `${label}.processWarnings`),
    observerErrors: integer(raw.observerErrors, `${label}.observerErrors`),
    mathRandomCalls: integer(raw.mathRandomCalls, `${label}.mathRandomCalls`),
    mismatchSamples,
  };
}

function parseCrossCheck(value: unknown, label: string): CrossCheck {
  const raw = object(value, label);
  exactKeys(raw, ["status", "diffs"], label);
  const status = oneOf(raw.status, ["ok", "failed", "skipped"] as const, `${label}.status`);
  const diffs = array(raw.diffs, `${label}.diffs`).map((entry, index) => {
    const diffLabel = `${label}.diffs[${index}]`;
    const diff = object(entry, diffLabel);
    exactKeys(diff, ["seat", "field", "observer", "tracker"], diffLabel);
    return {
      seat: seat(diff.seat, `${diffLabel}.seat`),
      field: string(diff.field, `${diffLabel}.field`),
      observer: integer(diff.observer, `${diffLabel}.observer`),
      tracker: integer(diff.tracker, `${diffLabel}.tracker`),
    };
  });
  if ((status === "failed") !== (diffs.length > 0)) fail(label, "deve listar diffs exatamente quando falha.");
  return { status, diffs };
}

function parseClock(value: unknown, label: string): DuelClock {
  const raw = object(value, label);
  exactKeys(raw, ["duelMs", "workerMs", "decisionLatencyMs", "watchdogStages", "partial"], label);
  const latency = object(raw.decisionLatencyMs, `${label}.decisionLatencyMs`);
  exactKeys(latency, ["player", "bot"], `${label}.decisionLatencyMs`);
  return {
    duelMs: nullable(raw.duelMs, entry => finiteNumber(entry, `${label}.duelMs`, 0)),
    workerMs: nullable(raw.workerMs, entry => finiteNumber(entry, `${label}.workerMs`, 0)),
    decisionLatencyMs: {
      player: numberArray(latency.player, `${label}.decisionLatencyMs.player`),
      bot: numberArray(latency.bot, `${label}.decisionLatencyMs.bot`),
    },
    watchdogStages: integer(raw.watchdogStages, `${label}.watchdogStages`),
    partial: nullable(raw.partial, entry => jsonValue(entry, `${label}.partial`)),
  };
}

export function parseDuelRecord(value: unknown, label = "duel"): DuelRecordV1 {
  const raw = object(value, label);
  exactKeys(raw, ["schema", "v", "caseIndex", "caseId", "k", "pair", "mirror", "seats", "seed", "effectiveSeed", "start",
    "opening", "outcome", "guard", "profiles", "seatMetrics", "presetMetrics", "diag", "crossCheck", "clock"], label);
  literal(raw.schema, DUEL_SCHEMA, `${label}.schema`);
  literal(raw.v, DUEL_RECORD_VERSION, `${label}.v`);
  const caseId = string(raw.caseId, `${label}.caseId`);
  const at = `${label}(${caseId})`;
  const seats = object(raw.seats, `${at}.seats`);
  exactKeys(seats, ["player", "bot"], `${at}.seats`);
  const record: DuelRecordV1 = {
    schema: DUEL_SCHEMA,
    v: DUEL_RECORD_VERSION,
    caseIndex: integer(raw.caseIndex, `${at}.caseIndex`),
    caseId,
    k: integer(raw.k, `${at}.k`),
    pair: string(raw.pair, `${at}.pair`),
    mirror: boolean(raw.mirror, `${at}.mirror`),
    seats: { player: string(seats.player, `${at}.seats.player`), bot: string(seats.bot, `${at}.seats.bot`) },
    seed: integer(raw.seed, `${at}.seed`),
    effectiveSeed: nullable(raw.effectiveSeed, entry => integer(entry, `${at}.effectiveSeed`)),
    start: nullable(raw.start, entry => {
      const start = object(entry, `${at}.start`);
      exactKeys(start, ["seat", "preset", "rngCalls"], `${at}.start`);
      return {
        seat: seat(start.seat, `${at}.start.seat`),
        preset: string(start.preset, `${at}.start.preset`),
        rngCalls: integer(start.rngCalls, `${at}.start.rngCalls`),
      };
    }),
    opening: nullable(raw.opening, entry => {
      const opening = object(entry, `${at}.opening`);
      exactKeys(opening, ["digest"], `${at}.opening`);
      return { digest: sha256String(opening.digest, `${at}.opening.digest`) };
    }),
    outcome: parseOutcome(raw.outcome, `${at}.outcome`),
    guard: parseGuard(raw.guard, `${at}.guard`),
    profiles: nullable(raw.profiles, entry => {
      const profiles = object(entry, `${at}.profiles`);
      exactKeys(profiles, ["beam", "planner"], `${at}.profiles`);
      const planner = object(profiles.planner, `${at}.profiles.planner`);
      exactKeys(planner, ["player", "bot"], `${at}.profiles.planner`);
      return {
        beam: string(profiles.beam, `${at}.profiles.beam`),
        planner: {
          player: counter(planner.player, `${at}.profiles.planner.player`),
          bot: counter(planner.bot, `${at}.profiles.planner.bot`),
        },
      };
    }),
    seatMetrics: nullable(raw.seatMetrics, entry => {
      const metrics = object(entry, `${at}.seatMetrics`);
      exactKeys(metrics, ["player", "bot"], `${at}.seatMetrics`);
      return {
        player: parseSeatMetrics(metrics.player, `${at}.seatMetrics.player`),
        bot: parseSeatMetrics(metrics.bot, `${at}.seatMetrics.bot`),
      };
    }),
    presetMetrics: nullable(raw.presetMetrics, entry => parsePresetMetrics(entry, `${at}.presetMetrics`)),
    diag: parseDiagnostics(raw.diag, `${at}.diag`),
    crossCheck: parseCrossCheck(raw.crossCheck, `${at}.crossCheck`),
    clock: parseClock(raw.clock, `${at}.clock`),
  };
  if (record.caseId !== `${record.seats.player}:${record.seats.bot}:${record.k}`) fail(at, "caseId não corresponde aos assentos e a k.");
  if (record.mirror !== (record.seats.player === record.seats.bot)) fail(at, "mirror não corresponde aos assentos.");
  if (record.outcome.winnerSeat !== null && record.outcome.winnerPreset !== record.seats[record.outcome.winnerSeat]) {
    fail(at, "winnerPreset não corresponde ao assento vencedor.");
  }
  if (record.start !== null && record.start.preset !== record.seats[record.start.seat]) fail(at, "start.preset não corresponde ao assento.");
  return record;
}

export function parseRunEnd(value: unknown, label = "run-end"): RunEnd {
  const raw = object(value, label);
  exactKeys(raw, ["schema", "version", "runId", "finishedAt", "wallMs", "identity", "identityDigest", "identityChangedDuringRun",
    "identityDiff"], label);
  literal(raw.schema, RUN_END_SCHEMA, `${label}.schema`);
  literal(raw.version, RUN_END_SCHEMA_VERSION, `${label}.version`);
  return {
    schema: RUN_END_SCHEMA,
    version: RUN_END_SCHEMA_VERSION,
    runId: string(raw.runId, `${label}.runId`),
    finishedAt: string(raw.finishedAt, `${label}.finishedAt`),
    wallMs: finiteNumber(raw.wallMs, `${label}.wallMs`, 0),
    identity: parseIdentity(raw.identity, `${label}.identity`),
    identityDigest: sha256String(raw.identityDigest, `${label}.identityDigest`),
    identityChangedDuringRun: boolean(raw.identityChangedDuringRun, `${label}.identityChangedDuringRun`),
    identityDiff: array(raw.identityDiff, `${label}.identityDiff`).map((entry, index) => {
      const diffLabel = `${label}.identityDiff[${index}]`;
      const diff = object(entry, diffLabel);
      exactKeys(diff, ["field", "start", "end"], diffLabel);
      return { field: string(diff.field, `${diffLabel}.field`), start: jsonValue(diff.start, `${diffLabel}.start`),
        end: jsonValue(diff.end, `${diffLabel}.end`) };
    }),
  };
}

export function parseEnvironmentDescription(value: unknown, label = "description"): EnvironmentDescription {
  const raw = object(value, label);
  exactKeys(raw, ["engineVersion", "cardDatabaseSignature", "cardDatabaseSha256", "presets", "decks", "strategyIds",
    "banlist", "instant"], label);
  const presets = stringArray(raw.presets, `${label}.presets`);
  const decksRaw = object(raw.decks, `${label}.decks`);
  exactKeys(decksRaw, presets, `${label}.decks`);
  const decks: Record<string, { main: number[]; extra: number[] }> = {};
  for (const preset of presets) {
    const deck = object(decksRaw[preset], `${label}.decks.${preset}`);
    exactKeys(deck, ["main", "extra"], `${label}.decks.${preset}`);
    decks[preset] = { main: integerArray(deck.main, `${label}.decks.${preset}.main`, 1),
      extra: integerArray(deck.extra, `${label}.decks.${preset}.extra`, 1) };
  }
  const banlistRaw = object(raw.banlist, `${label}.banlist`);
  const banlist: Record<string, string> = {};
  for (const [id, status] of Object.entries(banlistRaw)) banlist[id] = string(status, `${label}.banlist.${id}`);
  const instant = object(raw.instant, `${label}.instant`);
  exactKeys(instant, ["phaseDelayMs", "actionDelayMs", "battleDelayMs", "pollIntervalMs", "useRenderer", "timeoutMs",
    "beamWidth", "maxDepth", "nodeBudget", "planner"], `${label}.instant`);
  const planner = object(instant.planner, `${label}.instant.planner`);
  exactKeys(planner, ["mode", "turnMode", "beamWidth", "maxDepth", "nodeBudget", "candidateLimit"], `${label}.instant.planner`);
  return {
    engineVersion: string(raw.engineVersion, `${label}.engineVersion`),
    cardDatabaseSignature: string(raw.cardDatabaseSignature, `${label}.cardDatabaseSignature`),
    cardDatabaseSha256: sha256String(raw.cardDatabaseSha256, `${label}.cardDatabaseSha256`),
    presets,
    decks,
    strategyIds: stringArray(raw.strategyIds, `${label}.strategyIds`),
    banlist,
    instant: {
      phaseDelayMs: integer(instant.phaseDelayMs, `${label}.instant.phaseDelayMs`),
      actionDelayMs: integer(instant.actionDelayMs, `${label}.instant.actionDelayMs`),
      battleDelayMs: integer(instant.battleDelayMs, `${label}.instant.battleDelayMs`),
      pollIntervalMs: integer(instant.pollIntervalMs, `${label}.instant.pollIntervalMs`),
      useRenderer: boolean(instant.useRenderer, `${label}.instant.useRenderer`),
      timeoutMs: integer(instant.timeoutMs, `${label}.instant.timeoutMs`),
      beamWidth: integer(instant.beamWidth, `${label}.instant.beamWidth`, 1),
      maxDepth: integer(instant.maxDepth, `${label}.instant.maxDepth`, 1),
      nodeBudget: integer(instant.nodeBudget, `${label}.instant.nodeBudget`, 1),
      planner: {
        mode: string(planner.mode, `${label}.instant.planner.mode`),
        turnMode: nullable(planner.turnMode, entry => string(entry, `${label}.instant.planner.turnMode`)),
        beamWidth: nullable(planner.beamWidth, entry => integer(entry, `${label}.instant.planner.beamWidth`, 1)),
        maxDepth: nullable(planner.maxDepth, entry => integer(entry, `${label}.instant.planner.maxDepth`, 1)),
        nodeBudget: nullable(planner.nodeBudget, entry => integer(entry, `${label}.instant.planner.nodeBudget`, 1)),
        candidateLimit: nullable(planner.candidateLimit, entry => integer(entry, `${label}.instant.planner.candidateLimit`, 1)),
      },
    },
  };
}

// ── Invariance side file ───────────────────────────────────────────────────
// One line per case in INVARIANCE_FILE when the run carries the control. The
// reruns may perturb the duel (caches, timing), so these runs never measure
// strength, and nothing here enters the duel records or their digest.

export interface InvarianceSample {
  turn: number;
  phase: string | null;
  /** Hidden positions whose identity the trade changed: Hand and Deck, and face-down cards on the field. */
  traded: { handDeck: number; faceDown: number };
  /** Fingerprint of the live decision. */
  live: string;
  /** Fingerprint of the rerun on the real state. */
  real: string;
  /** Fingerprint of the rerun with the opponent's hidden information traded. */
  swapped: string;
  liveScore: number | null;
  realScore: number | null;
  swappedScore: number | null;
}

/** The control's comparisons for one root of one seat. */
export interface InvarianceRootTally {
  /** Live executions compared: the trade changed at least one hidden identity. */
  checked: number;
  /** Live executions not compared: the opponent had no hidden card to trade. */
  vacuous: number;
  /**
   * Comparisons left out of the gate: the rerun on the real state did not
   * reproduce the live decision (liveActionDiff or liveScoreDiff), so its
   * traded comparison cannot tell hidden information from carried state.
   */
  nonReproducible: number;
  /** Reproduced comparisons whose reruns on the real and on the traded state chose different actions. */
  actionDiff: number;
  /** Reproduced comparisons whose reruns on the real and on the traded state gave different scores. */
  scoreDiff: number;
  /**
   * The rerun on the real state disagreed with the live decision: the root did
   * not reproduce. The reruns start from an empty targeting cache, the live search from the duel's.
   */
  liveActionDiff: number;
  liveScoreDiff: number;
  /** Reruns that threw; their comparison is skipped. */
  errors: number;
  /** The live state after the trade and its restoration differed from the state before it. */
  restoreFailures: number;
  errorLabels: Counter;
  samples: InvarianceSample[];
}

/** Tally of the public-projection guard for one search root; the guard only counts (phase 2.3, E2). */
export interface InvarianceGuardTally {
  /** Planning roots inspected. */
  roots: number;
  /** Opaque projections inspected. */
  projections: number;
  /** Fields outside the guard's allowlist, by field. */
  fields: Counter;
  /** Allowlisted fields beyond the public placement (a known channel), by field. */
  tolerated: Counter;
  /** Hidden cards of the opponent without an opaque projection, by zone. */
  unprojected: Counter;
}

export interface InvarianceSeat {
  preset: string;
  roots: Record<InvarianceRoot, InvarianceRootTally>;
  /** The live roots' guard tallies of the Arena tracker, by search root (reruns are silenced). */
  guard: Record<string, InvarianceGuardTally>;
  /** console.error/warn of the reruns, kept here instead of the record's diagnostics. */
  consoleLabels: Counter;
}

export interface InvarianceCaseRecord {
  schema: typeof INVARIANCE_SCHEMA;
  v: number;
  caseIndex: number;
  caseId: string;
  seats: Record<Seat, InvarianceSeat>;
}

export function emptyInvarianceRootTally(): InvarianceRootTally {
  return {
    checked: 0, vacuous: 0, nonReproducible: 0, actionDiff: 0, scoreDiff: 0, liveActionDiff: 0, liveScoreDiff: 0, errors: 0,
    restoreFailures: 0, errorLabels: {}, samples: [],
  };
}

function parseInvarianceSample(value: unknown, label: string): InvarianceSample {
  const raw = object(value, label);
  exactKeys(raw, ["turn", "phase", "traded", "live", "real", "swapped", "liveScore", "realScore", "swappedScore"], label);
  const traded = object(raw.traded, `${label}.traded`);
  exactKeys(traded, ["handDeck", "faceDown"], `${label}.traded`);
  return {
    turn: integer(raw.turn, `${label}.turn`),
    phase: nullable(raw.phase, entry => string(entry, `${label}.phase`)),
    traded: { handDeck: integer(traded.handDeck, `${label}.traded.handDeck`), faceDown: integer(traded.faceDown, `${label}.traded.faceDown`) },
    live: string(raw.live, `${label}.live`),
    real: string(raw.real, `${label}.real`),
    swapped: string(raw.swapped, `${label}.swapped`),
    liveScore: nullable(raw.liveScore, entry => finiteNumber(entry, `${label}.liveScore`)),
    realScore: nullable(raw.realScore, entry => finiteNumber(entry, `${label}.realScore`)),
    swappedScore: nullable(raw.swappedScore, entry => finiteNumber(entry, `${label}.swappedScore`)),
  };
}

function parseInvarianceRootTally(value: unknown, label: string): InvarianceRootTally {
  const raw = object(value, label);
  exactKeys(raw, ["checked", "vacuous", "nonReproducible", "actionDiff", "scoreDiff", "liveActionDiff", "liveScoreDiff",
    "errors", "restoreFailures", "errorLabels", "samples"], label);
  const samples = array(raw.samples, `${label}.samples`).map((entry, index) => parseInvarianceSample(entry, `${label}.samples[${index}]`));
  if (samples.length > INVARIANCE_SAMPLE_LIMIT) fail(`${label}.samples`, `comporta no máximo ${INVARIANCE_SAMPLE_LIMIT} amostras.`);
  const tally: InvarianceRootTally = {
    checked: integer(raw.checked, `${label}.checked`),
    vacuous: integer(raw.vacuous, `${label}.vacuous`),
    nonReproducible: integer(raw.nonReproducible, `${label}.nonReproducible`),
    actionDiff: integer(raw.actionDiff, `${label}.actionDiff`),
    scoreDiff: integer(raw.scoreDiff, `${label}.scoreDiff`),
    liveActionDiff: integer(raw.liveActionDiff, `${label}.liveActionDiff`),
    liveScoreDiff: integer(raw.liveScoreDiff, `${label}.liveScoreDiff`),
    errors: integer(raw.errors, `${label}.errors`),
    restoreFailures: integer(raw.restoreFailures, `${label}.restoreFailures`),
    errorLabels: counter(raw.errorLabels, `${label}.errorLabels`),
    samples,
  };
  for (const key of ["nonReproducible", "liveActionDiff", "liveScoreDiff"] as const) {
    if (tally[key] > tally.checked) fail(`${label}.${key}`, "não pode passar de checked.");
  }
  // nonReproducible counts the comparisons with liveActionDiff or liveScoreDiff; the gate keeps the others.
  if (tally.nonReproducible < Math.max(tally.liveActionDiff, tally.liveScoreDiff) ||
      tally.nonReproducible > tally.liveActionDiff + tally.liveScoreDiff) {
    fail(`${label}.nonReproducible`, "não corresponde a liveActionDiff e liveScoreDiff.");
  }
  for (const key of ["actionDiff", "scoreDiff"] as const) {
    if (tally[key] > tally.checked - tally.nonReproducible) fail(`${label}.${key}`, "não pode passar das comparações reproduzidas.");
  }
  return tally;
}

function parseInvarianceGuardTally(value: unknown, label: string): InvarianceGuardTally {
  const raw = object(value, label);
  exactKeys(raw, ["roots", "projections", "fields", "tolerated", "unprojected"], label);
  return {
    roots: integer(raw.roots, `${label}.roots`),
    projections: integer(raw.projections, `${label}.projections`),
    fields: counter(raw.fields, `${label}.fields`),
    tolerated: counter(raw.tolerated, `${label}.tolerated`),
    unprojected: counter(raw.unprojected, `${label}.unprojected`),
  };
}

function parseInvarianceSeat(value: unknown, label: string): InvarianceSeat {
  const raw = object(value, label);
  exactKeys(raw, ["preset", "roots", "guard", "consoleLabels"], label);
  const roots = object(raw.roots, `${label}.roots`);
  exactKeys(roots, INVARIANCE_ROOTS, `${label}.roots`);
  const tally = (root: InvarianceRoot) => parseInvarianceRootTally(roots[root], `${label}.roots.${root}`);
  const guard: Record<string, InvarianceGuardTally> = {};
  for (const [root, entry] of Object.entries(object(raw.guard, `${label}.guard`))) {
    guard[root] = parseInvarianceGuardTally(entry, `${label}.guard.${root}`);
  }
  return {
    preset: string(raw.preset, `${label}.preset`),
    roots: { p2: tally("p2"), turnLineSearch: tally("turnLineSearch"), beam: tally("beam"), greedy: tally("greedy"), attack: tally("attack") },
    guard,
    consoleLabels: counter(raw.consoleLabels, `${label}.consoleLabels`),
  };
}

export function parseInvarianceRecord(value: unknown, label = "invariance"): InvarianceCaseRecord {
  const raw = object(value, label);
  exactKeys(raw, ["schema", "v", "caseIndex", "caseId", "seats"], label);
  literal(raw.schema, INVARIANCE_SCHEMA, `${label}.schema`);
  literal(raw.v, INVARIANCE_SCHEMA_VERSION, `${label}.v`);
  const caseId = string(raw.caseId, `${label}.caseId`);
  const seats = object(raw.seats, `${label}(${caseId}).seats`);
  exactKeys(seats, SEATS, `${label}(${caseId}).seats`);
  return {
    schema: INVARIANCE_SCHEMA,
    v: INVARIANCE_SCHEMA_VERSION,
    caseIndex: integer(raw.caseIndex, `${label}(${caseId}).caseIndex`),
    caseId,
    seats: {
      player: parseInvarianceSeat(seats.player, `${label}(${caseId}).seats.player`),
      bot: parseInvarianceSeat(seats.bot, `${label}(${caseId}).seats.bot`),
    },
  };
}

export function parseBenchmarkCase(value: unknown, label = "case"): BenchmarkCase {
  const raw = object(value, label);
  exactKeys(raw, ["caseIndex", "caseId", "k", "pair", "mirror", "seat1", "seat2", "seed"], label);
  return {
    caseIndex: integer(raw.caseIndex, `${label}.caseIndex`),
    caseId: string(raw.caseId, `${label}.caseId`),
    k: integer(raw.k, `${label}.k`),
    pair: string(raw.pair, `${label}.pair`),
    mirror: boolean(raw.mirror, `${label}.mirror`),
    seat1: string(raw.seat1, `${label}.seat1`),
    seat2: string(raw.seat2, `${label}.seat2`),
    seed: integer(raw.seed, `${label}.seed`),
  };
}

export { parseConfig as parseRunConfig };
