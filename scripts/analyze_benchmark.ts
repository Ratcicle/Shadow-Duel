import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPARISON_SCHEMA,
  COMPARISON_SCHEMA_VERSION,
  DUELS_FILE,
  GUARD_COUNTERS,
  GUARD_FLOOR,
  HEADER_FILE,
  JOURNAL_FILE,
  RUN_END_FILE,
  SEATS,
  SUMMARY_JSON_FILE,
  SUMMARY_MARKDOWN_FILE,
  SUMMARY_SCHEMA,
  SUMMARY_SCHEMA_VERSION,
  SchemaError,
  canonicalJson,
  caseListDigest,
  compareCodeUnits,
  configBaselineBlockers,
  deterministicDigest,
  jsonValue,
  parseDuelRecord,
  parseRunEnd,
  parseRunHeader,
  planCases,
  sortByCaseIndex,
  stripClock,
  type BenchmarkCase,
  type Counter,
  type CrossCheckDiff,
  type DuelRecordV1,
  type GuardCounterName,
  type GuardPeaks,
  type JsonValue,
  type RunConfig,
  type RunEnd,
  type RunHeader,
  type RunIdentity,
} from "./benchmark/schema.js";
import {
  DRAW_POINTS,
  WIN_RATE_RULE,
  distribution,
  drawPointsText,
  increment,
  mergeCounter,
  newcombe,
  ratio,
  round,
  roundInterval,
  roundOrNull,
  scorePoints,
  sortedCounter,
  sortedEntries,
  wilson,
  type Distribution,
  type Interval,
} from "./benchmark/statistics.js";

// Benchmark analyzer (Roadmap 2.2): sanity gates first, then H3/D4 metrics,
// and a comparator between runs. No engine import.

const EXIT_OK = 0;
const EXIT_INVALID = 1;
const EXIT_INCOMPARABLE = 2;
const EXIT_SANITY = 3;
const EXIT_NOVELTIES = 3;
const EXIT_NOT_IDENTICAL = 4;
const EXIT_DEFECTS = 5;

/** Invalid or incomplete input: exit 1. */
export class AnalysisInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisInputError";
  }
}

// ── Loading ────────────────────────────────────────────────────────────────

export interface LoadedRun {
  dir: string;
  header: RunHeader;
  records: DuelRecordV1[];
  source: "duels" | "journal";
  duplicates: string[];
  runEnd: RunEnd | null;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new AnalysisInputError(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function loadRun(dir: string, allowIncomplete = false): LoadedRun {
  const resolved = path.resolve(dir);
  const headerFile = path.join(resolved, HEADER_FILE);
  if (!fs.existsSync(headerFile)) throw new AnalysisInputError(`${dir} não tem ${HEADER_FILE}.`);
  const header = parseRunHeader(readJson(headerFile));
  const duelsFile = path.join(resolved, DUELS_FILE);
  const journalFile = path.join(resolved, JOURNAL_FILE);
  let source: LoadedRun["source"];
  let text: string;
  if (fs.existsSync(duelsFile)) {
    source = "duels";
    text = fs.readFileSync(duelsFile, "utf8");
  } else if (allowIncomplete && fs.existsSync(journalFile)) {
    source = "journal";
    const journal = fs.readFileSync(journalFile, "utf8");
    // A journal may end in a line that was being written when the run stopped.
    text = journal.endsWith("\n") ? journal : journal.slice(0, journal.lastIndexOf("\n") + 1);
  } else {
    throw new AnalysisInputError(`${dir} não tem ${DUELS_FILE}; a execução está incompleta (use --allow-incomplete para ler ${JOURNAL_FILE}).`);
  }
  const byCase = new Map<string, DuelRecordV1>();
  const duplicates: string[] = [];
  text.split("\n").forEach((line, index) => {
    if (!line) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new AnalysisInputError(`${source === "duels" ? DUELS_FILE : JOURNAL_FILE}:${index + 1} não é JSON válido.`);
    }
    const record = parseDuelRecord(value, `${source === "duels" ? DUELS_FILE : JOURNAL_FILE}:${index + 1}`);
    const previous = byCase.get(record.caseId);
    if (previous) {
      if (canonicalJson(stripClock(previous)) !== canonicalJson(stripClock(record))) {
        throw new AnalysisInputError(`Registros duplicados de ${record.caseId} diferem.`);
      }
      duplicates.push(record.caseId);
      return;
    }
    byCase.set(record.caseId, record);
  });
  const runEndFile = path.join(resolved, RUN_END_FILE);
  const runEnd = fs.existsSync(runEndFile) ? parseRunEnd(readJson(runEndFile)) : null;
  if (runEnd && runEnd.runId !== header.runId) throw new AnalysisInputError(`${RUN_END_FILE} pertence a outra execução.`);
  return { dir: resolved, header, records: sortByCaseIndex([...byCase.values()]), source, duplicates, runEnd };
}

// ── Summary types ──────────────────────────────────────────────────────────

export interface ValidationReport {
  ok: boolean;
  plannedCases: number;
  presentCases: number;
  missing: string[];
  duplicates: string[];
  seedMismatches: Array<{ caseId: string; seed: number; effectiveSeed: number | null }>;
  /**
   * pairs: complete non-mirror pairs; verified: both starts seen and alternating;
   * unverified: a record without start is an error (one that ended before the
   * draw, or a worker_lost, whose record keeps no start), reported among the
   * errors. A valid duel without start is a violation.
   */
  startAlternation: { pairs: number; verified: number; unverified: number; violations: Array<{ pair: string; k: number; reason: string }> };
  startsByPreset: Record<string, { asStarter: number; nonMirror: number }>;
  rngSymmetryViolations: Array<{ pair: string; k: number; forward: number; reverse: number }>;
  beamProfileViolations: Array<{ caseId: string; beam: string; expected: string }>;
  /** Cases refused by the effective profile and delay checks (config_drift). */
  configDrift: Array<{ caseId: string; message: string | null }>;
  crossCheckFailures: Array<{ caseId: string; diffs: CrossCheckDiff[] }>;
  mathRandomCases: string[];
  identityChangedDuringRun: boolean | null;
}

interface ScoreBlock {
  n: number;
  score: Interval | null;
}

interface OrderStats {
  n: number;
  winsA: number;
  winsB: number;
  draws: number;
}

export interface MatchupSummary {
  pair: string;
  a: string;
  b: string;
  n: number;
  valid: number;
  winsA: number;
  winsB: number;
  draws: number;
  scoreA: Interval | null;
  maxTurns: { count: number; fraction: Interval | null };
  errors: number;
  byOrder: { "a:b": OrderStats; "b:a": OrderStats };
  starter: { n: number; starterScore: Interval | null };
  turns: { mean: number | null; p50: number | null; p90: number | null };
}

export interface PresetSummary {
  preset: string;
  n: number;
  wins: number;
  losses: number;
  draws: number;
  score: Interval | null;
  asStarter: ScoreBlock;
  asSecond: ScoreBlock;
  maxTurnsFraction: number | null;
  errors: number;
}

interface MirrorSummary {
  preset: string;
  n: number;
  playerSeatScore: Interval | null;
  starterScore: Interval | null;
  draws: number;
  errors: number;
}

export interface PresetDiagnostics {
  duels: number;
  turns: Distribution;
  divergence: {
    comparisons: number;
    mismatches: number;
    failedNotExecuted: number;
    failedExecutedRejected: number;
    rate: Interval | null;
    rateExcludingNotExecuted: Interval | null;
  };
  mismatchBySeverity: Counter;
  mismatchByPath: Counter;
  terminations: Counter;
  unsupported: { tlsBranches: number; tlsByFamily: Counter; tlsByMarker: Counter; beamGreedyByFamily: Counter; beamGreedyByMarker: Counter };
  failedActions: { attempts: number; failed: number; blocked: number; byClass: Counter; byCode: Counter; blockedByCode: Counter };
  nodes: { tls: number; searches: number; tlsPerSearch: number | null; beamGreedySimulations: number; beamGreedySimulationsPerDecision: number | null };
  decisions: { mainPhase: number; measured: number; broker: number };
  mainPhaseExits: Counter;
  guardPeaks: GuardPeaks;
  plannerProfiles: Counter;
}

export interface Defect {
  caseId: string;
  kind: string;
  detail: string;
}

export interface BenchmarkSummary {
  schema: typeof SUMMARY_SCHEMA;
  version: number;
  runId: string;
  configDigest: string;
  identityDigest: string;
  identity: RunIdentity;
  config: RunConfig;
  source: LoadedRun["source"];
  complete: boolean;
  baselineEligible: boolean;
  baselineBlockers: string[];
  provisional: boolean;
  scoring: { drawPoints: number; rule: string };
  deterministicDigest: string;
  validation: ValidationReport;
  outcomes: {
    total: number;
    valid: number;
    lpZero: number;
    maxTurns: { count: number; decidedByLp: number; ties: number; fraction: Interval | null };
    errors: { total: number; byKind: Counter; byMatchup: Record<string, Array<{ caseId: string; kind: string; message: string | null }>> };
  } | null;
  matchups: MatchupSummary[] | null;
  presets: PresetSummary[] | null;
  mirrors: { byPreset: MirrorSummary[]; pooled: { n: number; playerSeatScore: Interval | null; starterScore: Interval | null } } | null;
  firstPlayerAdvantage: { n: number; starterScore: Interval | null } | null;
  diagnostics: { byPreset: Record<string, PresetDiagnostics> } | null;
  presetMetrics: {
    "techzero-combo": { duelsWithCombo: number; turnsWithCombo: number; summonsById: Counter } | null;
    lethal: Record<string, { projections: number; opportunities: number; converted: number; unconverted: number }> | null;
  } | null;
  guardCalibration: {
    mode: string;
    limits: Record<GuardCounterName, number>;
    observedPeaks: GuardPeaks;
    trips: number;
    floor: Record<GuardCounterName, number>;
    suggested: Record<GuardCounterName, number>;
  } | null;
  defects: Defect[] | null;
  clock: {
    wallMs: number | null;
    duelMs: Distribution;
    decisionLatencyMs: Record<string, Distribution>;
  } | null;
}

// ── Validation ─────────────────────────────────────────────────────────────

function plannedCases(header: RunHeader): BenchmarkCase[] {
  const cases = planCases(header.config);
  if (cases.length !== header.config.matrix.plannedCases || caseListDigest(cases) !== header.config.matrix.caseListSha256) {
    throw new AnalysisInputError("A matriz do cabeçalho não corresponde ao plano refeito a partir da configuração.");
  }
  return cases;
}

function guardLimits(config: RunConfig): Record<GuardCounterName, number> {
  return { decisions: config.stallGuard.decisionsPerTurn, actions: config.stallGuard.actionsPerTurn, progress: config.stallGuard.progressPerTurn };
}

function validate(run: LoadedRun, allowIncomplete: boolean): ValidationReport {
  const { header, records } = run;
  const planned = plannedCases(header);
  const plannedById = new Map(planned.map(entry => [entry.caseId, entry]));
  const byId = new Map(records.map(record => [record.caseId, record]));
  for (const record of records) {
    const entry = plannedById.get(record.caseId);
    if (!entry) throw new AnalysisInputError(`${record.caseId} não faz parte da matriz planejada.`);
    if (record.caseIndex !== entry.caseIndex || record.k !== entry.k || record.pair !== entry.pair ||
      record.mirror !== entry.mirror || record.seats.player !== entry.seat1 || record.seats.bot !== entry.seat2) {
      throw new AnalysisInputError(`${record.caseId} não corresponde ao caso planejado.`);
    }
  }
  const missing = planned.filter(entry => !byId.has(entry.caseId)).map(entry => entry.caseId);
  const seedMismatches = records.filter(record => {
    const expected = plannedById.get(record.caseId)?.seed;
    if (record.seed !== expected) return true;
    if (record.outcome.errorKind === "worker_lost") return false;
    return record.effectiveSeed !== record.seed;
  }).map(record => ({ caseId: record.caseId, seed: record.seed, effectiveSeed: record.effectiveSeed }));

  const startAlternation: ValidationReport["startAlternation"] = { pairs: 0, verified: 0, unverified: 0, violations: [] };
  const rngSymmetryViolations: ValidationReport["rngSymmetryViolations"] = [];
  const startsByPreset: ValidationReport["startsByPreset"] = {};
  for (const preset of header.config.presets) startsByPreset[preset] = { asStarter: 0, nonMirror: 0 };
  // Who started is checked, not presumed: every valid duel passed the draw, mirrors included.
  for (const record of records) {
    if (isValid(record) && record.start === null) {
      startAlternation.violations.push({ pair: record.pair, k: record.k, reason: `missing_start:${record.caseId}` });
    }
  }
  for (const entry of planned) {
    if (entry.mirror || entry.pair !== `${entry.seat1}|${entry.seat2}`) continue;
    const forward = byId.get(entry.caseId);
    const reverse = byId.get(`${entry.seat2}:${entry.seat1}:${entry.k}`);
    // An absent case is reported by the completeness gate.
    if (!forward || !reverse) continue;
    startAlternation.pairs += 1;
    if (!forward.start || !reverse.start) {
      // A valid duel without start is already a violation; an error record without start leaves the pair unverified.
      if ([forward, reverse].every(record => record.start !== null || !isValid(record))) startAlternation.unverified += 1;
      continue;
    }
    if (forward.start.seat !== reverse.start.seat) {
      startAlternation.violations.push({ pair: entry.pair, k: entry.k, reason: "starting_seat_differs" });
    } else if (forward.start.preset === reverse.start.preset) {
      startAlternation.violations.push({ pair: entry.pair, k: entry.k, reason: "same_preset_started_both_orders" });
    } else {
      startAlternation.verified += 1;
    }
    if (forward.start.rngCalls !== reverse.start.rngCalls) {
      rngSymmetryViolations.push({ pair: entry.pair, k: entry.k, forward: forward.start.rngCalls, reverse: reverse.start.rngCalls });
    }
    for (const record of [forward, reverse]) {
      for (const seat of SEATS) {
        const counts = startsByPreset[record.seats[seat]];
        if (counts) counts.nonMirror += 1;
      }
      const starter = record.start ? startsByPreset[record.start.preset] : undefined;
      if (starter) starter.asStarter += 1;
    }
  }
  for (const [preset, counts] of Object.entries(startsByPreset)) {
    if (counts.asStarter * 2 !== counts.nonMirror) {
      startAlternation.violations.push({ pair: preset, k: -1, reason: `starts_${counts.asStarter}_of_${counts.nonMirror}` });
    }
  }
  const beam = header.config.beam;
  const expectedBeam = `${beam.beamWidth}/${beam.maxDepth}/${beam.nodeBudget}`;
  const beamProfileViolations = records.filter(record => record.profiles !== null && record.profiles.beam !== expectedBeam)
    .map(record => ({ caseId: record.caseId, beam: record.profiles?.beam ?? "", expected: expectedBeam }));
  // config_drift is the per-Game gate of the effective profile and delays, not a duel outcome.
  const configDrift = records.filter(record => record.outcome.errorKind === "config_drift")
    .map(record => ({ caseId: record.caseId, message: record.outcome.message }));
  const crossCheckFailures = records.filter(record => record.crossCheck.status === "failed")
    .map(record => ({ caseId: record.caseId, diffs: record.crossCheck.diffs }));
  const mathRandomCases = records.filter(record => record.diag.mathRandomCalls > 0).map(record => record.caseId);
  const identityChangedDuringRun = run.runEnd ? run.runEnd.identityChangedDuringRun : null;
  const duplicates = run.source === "duels" ? run.duplicates : [];
  const ok = (allowIncomplete || missing.length === 0) && !duplicates.length && !seedMismatches.length &&
    !startAlternation.violations.length && !rngSymmetryViolations.length && !beamProfileViolations.length &&
    !configDrift.length && !crossCheckFailures.length && !mathRandomCases.length && identityChangedDuringRun !== true;
  return {
    ok,
    plannedCases: planned.length,
    presentCases: records.length,
    missing,
    duplicates: run.duplicates,
    seedMismatches,
    startAlternation,
    startsByPreset,
    rngSymmetryViolations,
    beamProfileViolations,
    configDrift,
    crossCheckFailures,
    mathRandomCases,
    identityChangedDuringRun,
  };
}

// ── Metrics ────────────────────────────────────────────────────────────────

function isValid(record: DuelRecordV1): boolean {
  return record.outcome.status === "valid";
}

function scoreOf(wins: number, draws: number, n: number): Interval | null {
  return roundInterval(wilson(scorePoints(wins, draws), n));
}

function turnStats(records: readonly DuelRecordV1[]): { mean: number | null; p50: number | null; p90: number | null } {
  const stats = distribution(records.flatMap(record => record.outcome.turns === null ? [] : [record.outcome.turns]));
  return { mean: stats.mean, p50: stats.p50, p90: stats.p90 };
}

function canonicalPairs(presets: readonly string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  presets.forEach((a, first) => presets.slice(first + 1).forEach(b => pairs.push([a, b])));
  return pairs;
}

function matchupSummary(a: string, b: string, records: readonly DuelRecordV1[]): MatchupSummary {
  const valid = records.filter(isValid);
  const winsOf = (subset: readonly DuelRecordV1[], preset: string) => subset.filter(record => record.outcome.winnerPreset === preset).length;
  const drawsOf = (subset: readonly DuelRecordV1[]) => subset.filter(record => record.outcome.draw).length;
  const order = (player: string): OrderStats => {
    const subset = valid.filter(record => record.seats.player === player);
    return { n: subset.length, winsA: winsOf(subset, a), winsB: winsOf(subset, b), draws: drawsOf(subset) };
  };
  const started = valid.filter(record => record.start !== null);
  const starterWins = started.filter(record => record.start?.preset === record.outcome.winnerPreset).length;
  const maxTurns = valid.filter(record => record.outcome.endReason === "max_turns").length;
  return {
    pair: `${a}|${b}`, a, b,
    n: records.length,
    valid: valid.length,
    winsA: winsOf(valid, a),
    winsB: winsOf(valid, b),
    draws: drawsOf(valid),
    scoreA: scoreOf(winsOf(valid, a), drawsOf(valid), valid.length),
    maxTurns: { count: maxTurns, fraction: roundInterval(wilson(maxTurns, valid.length)) },
    errors: records.length - valid.length,
    byOrder: { "a:b": order(a), "b:a": order(b) },
    starter: { n: started.length, starterScore: scoreOf(starterWins, drawsOf(started), started.length) },
    turns: turnStats(valid),
  };
}

function presetSummary(preset: string, records: readonly DuelRecordV1[]): PresetSummary {
  const games = records.filter(record => !record.mirror && (record.seats.player === preset || record.seats.bot === preset));
  const valid = games.filter(isValid);
  const wins = valid.filter(record => record.outcome.winnerPreset === preset).length;
  const draws = valid.filter(record => record.outcome.draw).length;
  const block = (subset: readonly DuelRecordV1[]): ScoreBlock => ({
    n: subset.length,
    score: scoreOf(subset.filter(record => record.outcome.winnerPreset === preset).length,
      subset.filter(record => record.outcome.draw).length, subset.length),
  });
  return {
    preset,
    n: valid.length,
    wins,
    losses: valid.length - wins - draws,
    draws,
    score: scoreOf(wins, draws, valid.length),
    asStarter: block(valid.filter(record => record.start?.preset === preset)),
    asSecond: block(valid.filter(record => record.start !== null && record.start.preset !== preset)),
    maxTurnsFraction: roundOrNull(ratio(valid.filter(record => record.outcome.endReason === "max_turns").length, valid.length)),
    errors: games.length - valid.length,
  };
}

function mirrorStats(records: readonly DuelRecordV1[]) {
  const valid = records.filter(isValid);
  const draws = valid.filter(record => record.outcome.draw).length;
  const started = valid.filter(record => record.start !== null);
  return {
    n: valid.length,
    playerSeatScore: scoreOf(valid.filter(record => record.outcome.winnerSeat === "player").length, draws, valid.length),
    starterScore: scoreOf(started.filter(record => record.start?.seat === record.outcome.winnerSeat).length,
      started.filter(record => record.outcome.draw).length, started.length),
    draws,
    errors: records.length - valid.length,
  };
}

function emptyDiagnostics(): PresetDiagnostics {
  return {
    duels: 0,
    turns: distribution([]),
    divergence: { comparisons: 0, mismatches: 0, failedNotExecuted: 0, failedExecutedRejected: 0, rate: null, rateExcludingNotExecuted: null },
    mismatchBySeverity: {}, mismatchByPath: {}, terminations: {},
    unsupported: { tlsBranches: 0, tlsByFamily: {}, tlsByMarker: {}, beamGreedyByFamily: {}, beamGreedyByMarker: {} },
    failedActions: { attempts: 0, failed: 0, blocked: 0, byClass: {}, byCode: {}, blockedByCode: {} },
    nodes: { tls: 0, searches: 0, tlsPerSearch: null, beamGreedySimulations: 0, beamGreedySimulationsPerDecision: null },
    decisions: { mainPhase: 0, measured: 0, broker: 0 },
    mainPhaseExits: {},
    guardPeaks: { decisions: 0, actions: 0, progress: 0 },
    plannerProfiles: {},
  };
}

/** Sums every seat a preset controls in valid duels, mirrors included. */
function presetDiagnostics(preset: string, records: readonly DuelRecordV1[]): PresetDiagnostics {
  const result = emptyDiagnostics();
  const duels = records.filter(record => isValid(record) && (record.seats.player === preset || record.seats.bot === preset));
  result.duels = duels.length;
  result.turns = distribution(duels.flatMap(record => record.outcome.turns === null ? [] : [record.outcome.turns]));
  for (const record of duels) {
    for (const name of GUARD_COUNTERS) result.guardPeaks[name] = Math.max(result.guardPeaks[name], record.guard.peaks?.[name] ?? 0);
    for (const seat of SEATS) {
      const metrics = record.seatMetrics?.[seat];
      if (record.seats[seat] !== preset || !metrics) continue;
      const planning = metrics.planning;
      result.divergence.comparisons += planning.comparisons;
      result.divergence.mismatches += planning.mismatches;
      result.divergence.failedNotExecuted += planning.failed.notExecuted;
      result.divergence.failedExecutedRejected += planning.failed.executedRejected;
      mergeCounter(result.mismatchBySeverity, planning.mismatchBySeverity);
      mergeCounter(result.mismatchByPath, planning.mismatchByPath);
      mergeCounter(result.terminations, planning.terminations);
      result.unsupported.tlsBranches += metrics.unsupported.tlsBranches;
      mergeCounter(result.unsupported.tlsByFamily, metrics.unsupported.tlsByFamily);
      mergeCounter(result.unsupported.tlsByMarker, metrics.unsupported.tlsByMarker);
      mergeCounter(result.unsupported.beamGreedyByFamily, metrics.unsupported.beamGreedyByFamily);
      mergeCounter(result.unsupported.beamGreedyByMarker, metrics.unsupported.beamGreedyByMarker);
      result.failedActions.attempts += metrics.actions.attempts;
      result.failedActions.failed += metrics.actions.failed;
      result.failedActions.blocked += metrics.actions.blocked;
      mergeCounter(result.failedActions.byClass, metrics.actions.failedByClass);
      mergeCounter(result.failedActions.byCode, metrics.actions.failedByCode);
      mergeCounter(result.failedActions.blockedByCode, metrics.actions.blockedByCode);
      result.nodes.tls += metrics.nodes.tls;
      result.nodes.searches += planning.searches;
      result.nodes.beamGreedySimulations += metrics.nodes.beamGreedySimulations;
      result.decisions.mainPhase += metrics.decisions.mainPhase;
      result.decisions.measured += metrics.decisions.measured;
      result.decisions.broker += metrics.decisions.broker;
      mergeCounter(result.mainPhaseExits, metrics.mainPhaseExits);
      if (record.profiles) mergeCounter(result.plannerProfiles, record.profiles.planner[seat]);
    }
  }
  const divergence = result.divergence;
  const failed = divergence.failedNotExecuted + divergence.failedExecutedRejected;
  divergence.rate = roundInterval(wilson(divergence.mismatches + failed, divergence.comparisons));
  divergence.rateExcludingNotExecuted = roundInterval(wilson(divergence.mismatches + divergence.failedExecutedRejected,
    divergence.comparisons - divergence.failedNotExecuted));
  result.nodes.tlsPerSearch = roundOrNull(ratio(result.nodes.tls, result.nodes.searches), 3);
  result.nodes.beamGreedySimulationsPerDecision = roundOrNull(ratio(result.nodes.beamGreedySimulations, result.decisions.mainPhase), 3);
  for (const key of ["mismatchBySeverity", "mismatchByPath", "terminations", "mainPhaseExits", "plannerProfiles"] as const) {
    result[key] = sortedCounter(result[key]);
  }
  for (const key of ["tlsByFamily", "tlsByMarker", "beamGreedyByFamily", "beamGreedyByMarker"] as const) {
    result.unsupported[key] = sortedCounter(result.unsupported[key]);
  }
  for (const key of ["byClass", "byCode", "blockedByCode"] as const) {
    result.failedActions[key] = sortedCounter(result.failedActions[key]);
  }
  return result;
}

function collectDefects(records: readonly DuelRecordV1[]): Defect[] {
  const defects: Defect[] = [];
  const firstKey = (counts: Counter) => sortedEntries(counts)[0]?.[0] ?? "";
  for (const record of records) {
    const add = (kind: string, detail: string) => defects.push({ caseId: record.caseId, kind, detail });
    if (record.outcome.status === "error") add(record.outcome.errorKind ?? "error", record.outcome.message ?? "");
    if (record.crossCheck.status === "failed") add("cross_check", record.crossCheck.diffs.map(diff => `${diff.seat}.${diff.field}`).join(", "));
    if (record.diag.consoleErrors) add("console_error", `${record.diag.consoleErrors}× ${firstKey(record.diag.errorLabels)}`);
    if (record.diag.consoleWarnings) add("console_warning", `${record.diag.consoleWarnings}× ${firstKey(record.diag.warningLabels)}`);
    if (record.diag.unhandledRejections) add("unhandled_rejection", `${record.diag.unhandledRejections}`);
    if (record.diag.processWarnings) add("process_warning", `${record.diag.processWarnings}`);
    if (record.diag.observerErrors) add("observer_error", `${record.diag.observerErrors}`);
    if (record.diag.mathRandomCalls) add("math_random", `${record.diag.mathRandomCalls}`);
    // A code outside FAILURE_CODE_CLASSES needs a class; failures without a code stay in "uncoded".
    const unclassified = new Set<string>();
    for (const seat of SEATS) {
      for (const failureClass of Object.keys(record.seatMetrics?.[seat].actions.failedByClass ?? {})) {
        if (failureClass.startsWith("unclassified:")) unclassified.add(failureClass);
      }
    }
    if (unclassified.size) add("unclassified_failure_code", [...unclassified].sort(compareCodeUnits).join(", "));
  }
  return defects;
}

export interface SummaryOptions {
  allowIncomplete?: boolean;
  allowSanityFailures?: boolean;
}

export function computeSummary(run: LoadedRun, options: SummaryOptions = {}): BenchmarkSummary {
  const { header, records } = run;
  const config = header.config;
  const validation = validate(run, options.allowIncomplete === true);
  const complete = validation.missing.length === 0;
  const blockers = [
    ...(header.identity.dirty ? ["dirty"] : []),
    ...(complete ? [] : ["incomplete"]),
    ...(validation.ok ? [] : ["sanity"]),
    ...(validation.identityChangedDuringRun === null ? ["identity_unverified"] : validation.identityChangedDuringRun ? ["identity_changed"] : []),
    ...configBaselineBlockers(config),
  ];
  const summary: BenchmarkSummary = {
    schema: SUMMARY_SCHEMA,
    version: SUMMARY_SCHEMA_VERSION,
    runId: header.runId,
    configDigest: header.configDigest,
    identityDigest: header.identityDigest,
    identity: header.identity,
    config,
    source: run.source,
    complete,
    baselineEligible: blockers.length === 0,
    baselineBlockers: blockers,
    provisional: !validation.ok || !complete,
    scoring: { drawPoints: DRAW_POINTS, rule: WIN_RATE_RULE },
    deterministicDigest: deterministicDigest(records),
    validation,
    outcomes: null,
    matchups: null,
    presets: null,
    mirrors: null,
    firstPlayerAdvantage: null,
    diagnostics: null,
    presetMetrics: null,
    guardCalibration: null,
    defects: null,
    clock: null,
  };
  if (!validation.ok && options.allowSanityFailures !== true) return summary;

  const valid = records.filter(isValid);
  const errors = records.filter(record => !isValid(record));
  const maxTurns = valid.filter(record => record.outcome.endReason === "max_turns");
  const byKind: Counter = {};
  const byMatchup: Record<string, Array<{ caseId: string; kind: string; message: string | null }>> = {};
  for (const record of errors) {
    const kind = record.outcome.errorKind ?? "error";
    increment(byKind, kind);
    (byMatchup[record.pair] ??= []).push({ caseId: record.caseId, kind, message: record.outcome.message });
  }
  summary.outcomes = {
    total: records.length,
    valid: valid.length,
    lpZero: valid.filter(record => record.outcome.endReason === "lp_zero").length,
    maxTurns: {
      count: maxTurns.length,
      decidedByLp: maxTurns.filter(record => record.outcome.decidedBy === "lp_at_turn_limit").length,
      ties: maxTurns.filter(record => record.outcome.decidedBy === "tie_at_turn_limit").length,
      fraction: roundInterval(wilson(maxTurns.length, valid.length)),
    },
    errors: {
      total: errors.length,
      byKind: sortedCounter(byKind),
      byMatchup: Object.fromEntries(Object.keys(byMatchup).sort(compareCodeUnits).map(pair => [pair, byMatchup[pair] ?? []])),
    },
  };
  summary.matchups = canonicalPairs(config.presets)
    .map(([a, b]) => matchupSummary(a, b, records.filter(record => record.pair === `${a}|${b}`)))
    .filter(matchup => matchup.n > 0);
  summary.presets = config.presets.map(preset => presetSummary(preset, records))
    .filter(preset => preset.n > 0 || preset.errors > 0);
  const mirrors = records.filter(record => record.mirror);
  summary.mirrors = {
    byPreset: config.presets.map(preset => ({ preset, ...mirrorStats(mirrors.filter(record => record.seats.player === preset)) }))
      .filter(entry => entry.n > 0 || entry.errors > 0),
    pooled: (() => {
      const pooled = mirrorStats(mirrors);
      return { n: pooled.n, playerSeatScore: pooled.playerSeatScore, starterScore: pooled.starterScore };
    })(),
  };
  const nonMirrorStarted = valid.filter(record => !record.mirror && record.start !== null);
  summary.firstPlayerAdvantage = {
    n: nonMirrorStarted.length,
    starterScore: scoreOf(nonMirrorStarted.filter(record => record.start?.preset === record.outcome.winnerPreset).length,
      nonMirrorStarted.filter(record => record.outcome.draw).length, nonMirrorStarted.length),
  };
  summary.diagnostics = { byPreset: Object.fromEntries(config.presets.map(preset => [preset, presetDiagnostics(preset, records)])) };

  let combo: NonNullable<BenchmarkSummary["presetMetrics"]>["techzero-combo"] = null;
  if (config.presetMetrics.includes("techzero-combo")) {
    combo = { duelsWithCombo: 0, turnsWithCombo: 0, summonsById: {} };
    for (const record of valid) {
      let hasCombo = false;
      for (const seat of SEATS) {
        const seatCombo = record.presetMetrics?.["techzero-combo"]?.[seat];
        if (!seatCombo) continue;
        combo.turnsWithCombo += seatCombo.comboTurns.length;
        hasCombo ||= seatCombo.comboTurns.length > 0;
        mergeCounter(combo.summonsById, seatCombo.summonsById);
      }
      if (hasCombo) combo.duelsWithCombo += 1;
    }
    combo.summonsById = sortedCounter(combo.summonsById);
  }
  let lethal: NonNullable<BenchmarkSummary["presetMetrics"]>["lethal"] = null;
  if (config.presetMetrics.includes("lethal")) {
    lethal = {};
    for (const preset of config.presets) lethal[preset] = { projections: 0, opportunities: 0, converted: 0, unconverted: 0 };
    for (const record of valid) {
      for (const seat of SEATS) {
        const seatLethal = record.presetMetrics?.lethal?.[seat];
        const target = lethal[record.seats[seat]];
        if (!seatLethal || !target) continue;
        target.projections += seatLethal.projections;
        target.opportunities += seatLethal.opportunities;
        target.converted += seatLethal.converted;
        target.unconverted += seatLethal.unconverted;
      }
    }
  }
  summary.presetMetrics = { "techzero-combo": combo, lethal };

  const observedPeaks: GuardPeaks = { decisions: 0, actions: 0, progress: 0 };
  for (const record of records) {
    for (const name of GUARD_COUNTERS) observedPeaks[name] = Math.max(observedPeaks[name], record.guard.peaks?.[name] ?? 0);
  }
  const floor: Record<GuardCounterName, number> = {
    decisions: GUARD_FLOOR.decisionsPerTurn, actions: GUARD_FLOOR.actionsPerTurn, progress: GUARD_FLOOR.progressPerTurn,
  };
  summary.guardCalibration = {
    mode: config.stallGuard.mode,
    limits: guardLimits(config),
    observedPeaks,
    trips: records.filter(record => record.outcome.errorKind === "stall_guard").length,
    floor,
    suggested: {
      decisions: Math.max(floor.decisions, 10 * observedPeaks.decisions),
      actions: Math.max(floor.actions, 10 * observedPeaks.actions),
      progress: Math.max(floor.progress, 10 * observedPeaks.progress),
    },
  };
  summary.defects = collectDefects(records);
  const latencies: Record<string, number[]> = {};
  for (const record of records) {
    for (const seat of SEATS) (latencies[record.seats[seat]] ??= []).push(...record.clock.decisionLatencyMs[seat]);
  }
  summary.clock = {
    wallMs: run.runEnd?.wallMs ?? null,
    duelMs: distribution(records.flatMap(record => record.clock.duelMs === null ? [] : [record.clock.duelMs]), 0),
    decisionLatencyMs: Object.fromEntries(config.presets.map(preset => [preset, distribution(latencies[preset] ?? [], 2)])),
  };
  return summary;
}

// ── Markdown ───────────────────────────────────────────────────────────────

function cell(value: string | number | null): string {
  return value === null ? "—" : String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function percent(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function intervalText(interval: Interval | null): string {
  return interval ? `${percent(interval.p)} [${percent(interval.lo)}; ${percent(interval.hi)}]` : "—";
}

function numberText(value: number | null, digits = 1): string {
  return value === null ? "—" : value.toFixed(digits);
}

function counterText(counts: Counter, limit = 6): string {
  const entries = sortedEntries(counts);
  if (!entries.length) return "—";
  const shown = entries.slice(0, limit).map(([name, count]) => `${name}: ${count}`);
  return entries.length > limit ? `${shown.join("; ")}; +${entries.length - limit}` : shown.join("; ");
}

function yesNo(value: boolean | null): string {
  return value === null ? "não verificado" : value ? "sim" : "não";
}

const ERROR_KIND_LABELS: Record<string, string> = {
  stall_guard: "guarda de stall",
  exception: "exceção",
  wall_clock: "relógio de segurança",
  worker_lost: "worker perdido",
  unexpected_cancel: "cancelamento inesperado",
  unknown_game_over: "fim desconhecido",
  config_drift: "deriva de configuração",
};

export function renderSummaryMarkdown(summary: BenchmarkSummary): string {
  const config = summary.config;
  const identity = summary.identity;
  const validation = summary.validation;
  const lines: string[] = [
    `# Benchmark Shadow Duel — ${summary.runId}`, "",
    `- Commit \`${identity.commit.slice(0, 7)}\`, árvore suja: ${yesNo(identity.dirty)}; engine \`${identity.engineVersion}\`; ` +
      `banco de cartas \`${identity.cardDatabaseSignature}\`; Node ${identity.node}.`,
    `- Perfil ${config.profile}: beam ${config.beam.beamWidth}/${config.beam.maxDepth}/${config.beam.nodeBudget}; ` +
      `planner com o perfil de cada estratégia; modo imposto pela Arena: ${config.planner.arenaMode} (origem: ${config.planner.modeSource}` +
      `${config.planner.modeOverride ? `, modo ${config.planner.modeOverride}` : ""}${config.planner.turnModeOverride ? `, ${config.planner.turnModeOverride}` : ""}).`,
    `- Limite de ${config.maxTurns} turnos; relógio de segurança de ${config.timeoutMs} ms (vira erro); guarda ${config.stallGuard.mode} ` +
      `${config.stallGuard.decisionsPerTurn}/${config.stallGuard.actionsPerTurn}/${config.stallGuard.progressPerTurn} (decisões/ações/progresso por turno).`,
    `- Seeds: base ${config.seeds.base}, N = ${config.seeds.count}; casos planejados ${validation.plannedCases}, presentes ${validation.presentCases}` +
      `${config.caseFilter ? `; filtro ${config.caseFilter.join(", ")}` : ""}.`,
    `- Métricas por preset: ${config.presetMetrics.join(", ") || "nenhuma"}; trocas de estratégia: ${Object.entries(config.strategyOverrides).map(([target, source]) => `${target}=${source}`).join(", ") || "nenhuma"}.`,
    `- configDigest \`${summary.configDigest}\`; identityDigest \`${summary.identityDigest}\`; deterministicDigest \`${summary.deterministicDigest}\`.`,
    `- Elegível a baseline: ${yesNo(summary.baselineEligible)}${summary.baselineBlockers.length ? ` (${summary.baselineBlockers.join(", ")})` : ""}.` +
      `${summary.provisional ? " Resultado provisório." : ""}`,
    `- Convenção do placar: vitória vale 1, empate (PV iguais no limite de turnos) vale ${drawPointsText("pt-BR")}; ` +
      `p = (V + ${drawPointsText("pt-BR")}·E)/n, com intervalo de Wilson de 95% sobre o placar fracionário. Erros e timeouts ficam fora de toda taxa (D4).`, "",
    "## Sanidade", "",
    "| Portão | Resultado |",
    "| --- | --- |",
    `| Completude | ${validation.missing.length ? `${validation.missing.length} ausentes` : "ok"} |`,
    `| Duplicatas | ${validation.duplicates.length || "nenhuma"} |`,
    `| Seed efetiva | ${validation.seedMismatches.length ? `${validation.seedMismatches.length} divergências` : "ok"} |`,
    `| Alternância de quem começa | ${validation.startAlternation.verified}/${validation.startAlternation.pairs} pares` +
      `${validation.startAlternation.unverified ? `, ${validation.startAlternation.unverified} sem verificação (erro sem início registrado)` : ""}` +
      `${validation.startAlternation.violations.length ? `, ${validation.startAlternation.violations.length} violações` : ""} |`,
    `| Simetria de RNG antes do sorteio | ${validation.rngSymmetryViolations.length ? `${validation.rngSymmetryViolations.length} violações` : "ok"} |`,
    `| Perfil de beam | ${validation.beamProfileViolations.length ? `${validation.beamProfileViolations.length} divergências` : "ok"} |`,
    `| Perfil e delays efetivos | ${validation.configDrift.length ? `${validation.configDrift.length} casos com deriva` : "ok"} |`,
    `| Cross-check com o DuelTracker | ${validation.crossCheckFailures.length ? `${validation.crossCheckFailures.length} falhas` : "ok"} |`,
    `| Math.random no duelo | ${validation.mathRandomCases.length ? `${validation.mathRandomCases.length} casos` : "0"} |`,
    `| Identidade estável | ${validation.identityChangedDuringRun === null ? "não verificada" : validation.identityChangedDuringRun ? "mudou" : "ok"} |`,
    "",
  ];
  const violations = [
    ...validation.missing.slice(0, 20).map(caseId => `ausente: ${caseId}`),
    ...validation.seedMismatches.map(entry => `seed: ${entry.caseId} (${entry.seed} → ${entry.effectiveSeed ?? "—"})`),
    ...validation.startAlternation.violations.map(entry => `alternância: ${entry.pair}${entry.k >= 0 ? ` k=${entry.k}` : ""} (${entry.reason})`),
    ...validation.rngSymmetryViolations.map(entry => `RNG: ${entry.pair} k=${entry.k} (${entry.forward} × ${entry.reverse})`),
    ...validation.beamProfileViolations.map(entry => `beam: ${entry.caseId} (${entry.beam}, esperado ${entry.expected})`),
    ...validation.configDrift.map(entry => `deriva de configuração: ${entry.caseId} (${entry.message ?? "—"})`),
    ...validation.crossCheckFailures.map(entry => `cross-check: ${entry.caseId} (${entry.diffs.map(diff => `${diff.seat}.${diff.field} ${diff.observer}≠${diff.tracker}`).join(", ")})`),
    ...validation.mathRandomCases.map(caseId => `Math.random: ${caseId}`),
  ];
  if (violations.length) lines.push(...violations.map(entry => `- ${entry}`), "");
  if (!summary.outcomes) {
    lines.push("A sanidade reprovou: as métricas não foram calculadas (use --allow-sanity-failures para um resumo provisório).", "");
    return lines.join("\n");
  }
  const outcomes = summary.outcomes;
  lines.push("## Resultados por par", "",
    `Placar de a = (vitórias de a + ${drawPointsText("pt-BR")}·empates)/válidos, nas duas ordens de assento. Quem começa mostra o placar do preset que fez o primeiro turno.`, "",
    "| Par (a × b) | Válidos | V a / V b / E | Placar de a [IC 95%] | Limite | Erros | a:b (Va/Vb/E) | b:a (Va/Vb/E) | Quem começa | Turnos (média/p50/p90) |",
    "| --- | ---: | --- | --- | ---: | ---: | --- | --- | --- | --- |");
  for (const matchup of summary.matchups ?? []) {
    const order = (stats: OrderStats) => `${stats.winsA}/${stats.winsB}/${stats.draws}`;
    lines.push(`| ${cell(matchup.a)} × ${cell(matchup.b)} | ${matchup.valid}/${matchup.n} | ${matchup.winsA}/${matchup.winsB}/${matchup.draws} | ` +
      `${intervalText(matchup.scoreA)} | ${matchup.maxTurns.count} | ${matchup.errors} | ${order(matchup.byOrder["a:b"])} | ${order(matchup.byOrder["b:a"])} | ` +
      `${percent(matchup.starter.starterScore?.p)} (n=${matchup.starter.n}) | ${numberText(matchup.turns.mean)}/${numberText(matchup.turns.p50, 0)}/${numberText(matchup.turns.p90, 0)} |`);
  }
  lines.push("", "## Presets (sem espelhos)", "",
    "| Preset | n | V/D/E | Placar [IC 95%] | Começando | Em segundo | Fração no limite | Erros |",
    "| --- | ---: | --- | --- | --- | --- | ---: | ---: |");
  for (const preset of summary.presets ?? []) {
    lines.push(`| ${cell(preset.preset)} | ${preset.n} | ${preset.wins}/${preset.losses}/${preset.draws} | ${intervalText(preset.score)} | ` +
      `${percent(preset.asStarter.score?.p)} (n=${preset.asStarter.n}) | ${percent(preset.asSecond.score?.p)} (n=${preset.asSecond.n}) | ` +
      `${percent(preset.maxTurnsFraction)} | ${preset.errors} |`);
  }
  const mirrors = summary.mirrors;
  lines.push("", "## Espelhos e viés de assento", "",
    "Espelhos ficam fora do placar por preset e medem só o viés de assento e de quem começa.", "",
    "| Preset | n | Placar do assento player [IC 95%] | Placar de quem começa [IC 95%] | Empates | Erros |",
    "| --- | ---: | --- | --- | ---: | ---: |");
  for (const mirror of mirrors?.byPreset ?? []) {
    lines.push(`| ${cell(mirror.preset)} | ${mirror.n} | ${intervalText(mirror.playerSeatScore)} | ${intervalText(mirror.starterScore)} | ${mirror.draws} | ${mirror.errors} |`);
  }
  if (mirrors) lines.push(`| todos | ${mirrors.pooled.n} | ${intervalText(mirrors.pooled.playerSeatScore)} | ${intervalText(mirrors.pooled.starterScore)} | | |`);
  lines.push("", `Vantagem de quem começa (fora dos espelhos): ${intervalText(summary.firstPlayerAdvantage?.starterScore ?? null)} em ${summary.firstPlayerAdvantage?.n ?? 0} duelos.`, "",
    "## Limite de turnos e erros", "",
    `- Duelos: ${outcomes.total}; válidos: ${outcomes.valid}; PV zerado: ${outcomes.lpZero}; limite de turnos: ${outcomes.maxTurns.count} ` +
      `(${outcomes.maxTurns.decidedByLp} decididos por PV, ${outcomes.maxTurns.ties} empates), fração ${intervalText(outcomes.maxTurns.fraction)}.`,
    `- Erros: ${outcomes.errors.total}${outcomes.errors.total ? ` (${Object.entries(outcomes.errors.byKind).map(([kind, count]) => `${ERROR_KIND_LABELS[kind] ?? kind}: ${count}`).join("; ")})` : ""}.`, "");
  if (outcomes.errors.total) {
    lines.push("| Par | Caso | Tipo | Mensagem |", "| --- | --- | --- | --- |");
    for (const [pair, entries] of Object.entries(outcomes.errors.byMatchup)) {
      for (const entry of entries) lines.push(`| ${cell(pair)} | ${cell(entry.caseId)} | ${cell(entry.kind)} | ${cell(entry.message)} |`);
    }
    lines.push("");
  }
  lines.push("## Diagnósticos por preset", "",
    "Somam todos os assentos de cada preset em duelos válidos, espelhos incluídos. A divergência cobre só as decisões do TurnLineSearch: " +
      "(divergências + falhas)/comparações; a segunda taxa tira as falhas em que a ação nem foi executada (estado mudado, guarda ou repetição). " +
      "Simulações de beam/greedy são um proxy dos nós desses buscadores (chamadas externas de simulate), não o nodesEvaluated exato.", "",
    "| Preset | Duelos | Turnos média/p90/máx | Divergência [IC 95%] | Sem não executadas | Comparações | Unsupported TLS | Falhas (bloqueios) / tentativas | Nós TLS/busca | Simulações beam/greedy/decisão | Decisões (medidas) | Picos da guarda |",
    "| --- | ---: | --- | --- | --- | ---: | ---: | --- | ---: | ---: | --- | --- |");
  for (const [preset, diagnostics] of Object.entries(summary.diagnostics?.byPreset ?? {})) {
    if (!diagnostics.duels) continue;
    const divergence = diagnostics.divergence;
    lines.push(`| ${cell(preset)} | ${diagnostics.duels} | ${numberText(diagnostics.turns.mean)}/${numberText(diagnostics.turns.p90, 0)}/${numberText(diagnostics.turns.max, 0)} | ` +
      `${intervalText(divergence.rate)} | ${percent(divergence.rateExcludingNotExecuted?.p)} | ${divergence.comparisons} | ${diagnostics.unsupported.tlsBranches} | ` +
      `${diagnostics.failedActions.failed} (${diagnostics.failedActions.blocked}) / ${diagnostics.failedActions.attempts} | ${numberText(diagnostics.nodes.tlsPerSearch)} | ` +
      `${numberText(diagnostics.nodes.beamGreedySimulationsPerDecision)} | ${diagnostics.decisions.mainPhase} (${diagnostics.decisions.measured}) | ` +
      `${diagnostics.guardPeaks.decisions}/${diagnostics.guardPeaks.actions}/${diagnostics.guardPeaks.progress} |`);
  }
  lines.push("", "| Preset | Motivos de divergência | Caminhos dos diffs | Branches não suportados (TLS, por família) | Falhas por classe | Saídas da Main Phase | Perfis do planner |",
    "| --- | --- | --- | --- | --- | --- | --- |");
  for (const [preset, diagnostics] of Object.entries(summary.diagnostics?.byPreset ?? {})) {
    if (!diagnostics.duels) continue;
    lines.push(`| ${cell(preset)} | ${cell(counterText(diagnostics.mismatchBySeverity))} | ${cell(counterText(diagnostics.mismatchByPath, 4))} | ` +
      `${cell(counterText(diagnostics.unsupported.tlsByFamily))} | ${cell(counterText(diagnostics.failedActions.byClass))} | ` +
      `${cell(counterText(diagnostics.mainPhaseExits))} | ${cell(counterText(diagnostics.plannerProfiles, 3))} |`);
  }
  const presetMetrics = summary.presetMetrics;
  if (presetMetrics && (presetMetrics["techzero-combo"] || presetMetrics.lethal)) {
    lines.push("", "## Métricas opcionais por preset", "");
    const combo = presetMetrics["techzero-combo"];
    if (combo) {
      lines.push(`- Combo Tech-Zero (M + Portal + boss Sincro no mesmo turno e assento): ${combo.duelsWithCombo} duelos, ${combo.turnsWithCombo} turnos; ` +
        `invocações por ID: ${counterText(combo.summonsById, 5)}.`);
    }
    if (presetMetrics.lethal) {
      lines.push("", "Letal provado: a projeção pública da Battle Phase (uma por assento e turno) zera os PV sem interação incerta. " +
        "Só conta como convertido com vitória por PV zerado naquele turno.", "",
        "| Preset | Projeções | Letais provados | Convertidos | Não convertidos |", "| --- | ---: | ---: | ---: | ---: |");
      for (const [preset, lethal] of Object.entries(presetMetrics.lethal)) {
        if (lethal.projections) lines.push(`| ${cell(preset)} | ${lethal.projections} | ${lethal.opportunities} | ${lethal.converted} | ${lethal.unconverted} |`);
      }
    }
  }
  const calibration = summary.guardCalibration;
  if (calibration) {
    lines.push("", "## Guarda de stall", "",
      `Modo ${calibration.mode}; limites ${calibration.limits.decisions}/${calibration.limits.actions}/${calibration.limits.progress}; ` +
      `picos observados ${calibration.observedPeaks.decisions}/${calibration.observedPeaks.actions}/${calibration.observedPeaks.progress}; ` +
      `disparos ${calibration.trips}. Calibração sugerida, max(piso, 10 × pico): ` +
      `${calibration.suggested.decisions}/${calibration.suggested.actions}/${calibration.suggested.progress}.`);
  }
  lines.push("", "## Defeitos", "");
  const defects = summary.defects ?? [];
  if (!defects.length) lines.push("Nenhum defeito registrado.");
  else {
    lines.push("Todo defeito precisa de triagem antes do aceite.", "", "| Caso | Tipo | Detalhe |", "| --- | --- | --- |");
    for (const defect of defects.slice(0, 200)) lines.push(`| ${cell(defect.caseId)} | ${cell(defect.kind)} | ${cell(defect.detail)} |`);
    if (defects.length > 200) lines.push(`| … | | +${defects.length - 200} no JSON |`);
  }
  const clock = summary.clock;
  if (clock) {
    lines.push("", "## Relógio", "",
      "Números de relógio dependem da máquina e da carga; não entram no deterministicDigest nem em critério de aceite.", "",
      `- Execução: ${clock.wallMs === null ? "—" : `${(clock.wallMs / 1000).toFixed(0)} s`}; duelo: média ${numberText(clock.duelMs.mean === null ? null : clock.duelMs.mean / 1000)} s, ` +
        `p50 ${numberText(clock.duelMs.p50 === null ? null : clock.duelMs.p50 / 1000)} s, p95 ${numberText(clock.duelMs.p95 === null ? null : clock.duelMs.p95 / 1000)} s, ` +
        `máx ${numberText(clock.duelMs.max === null ? null : clock.duelMs.max / 1000)} s.`, "",
      "| Preset | Decisões medidas | Latência média (ms) | p50 | p95 | máx |", "| --- | ---: | ---: | ---: | ---: | ---: |");
    for (const [preset, latency] of Object.entries(clock.decisionLatencyMs)) {
      if (latency.count) lines.push(`| ${cell(preset)} | ${latency.count} | ${numberText(latency.mean)} | ${numberText(latency.p50)} | ${numberText(latency.p95)} | ${numberText(latency.max)} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// ── Output files ───────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assertOutput(file: string, inputs: readonly string[]): string {
  const resolved = path.resolve(file);
  const relative = path.relative(REPO_ROOT, resolved);
  if (!relative.startsWith("..") && !path.isAbsolute(relative) && (relative.split(/[\\/]/, 1)[0] ?? "").toLowerCase() === "docs") {
    throw new AnalysisInputError(`${file} fica em docs/, que guarda só documentação em Markdown.`);
  }
  if (inputs.some(input => path.resolve(input).toLowerCase() === resolved.toLowerCase())) {
    throw new AnalysisInputError(`${file} sobrescreveria uma entrada.`);
  }
  return resolved;
}

function runInputs(dir: string): string[] {
  return [HEADER_FILE, DUELS_FILE, JOURNAL_FILE, RUN_END_FILE].map(name => path.join(path.resolve(dir), name));
}

function writeOutputs(outputs: ReadonlyArray<[string, string]>): void {
  const seen = new Set<string>();
  for (const [file] of outputs) {
    const key = path.resolve(file).toLowerCase();
    if (seen.has(key)) throw new AnalysisInputError("Os arquivos de saída devem ser diferentes entre si.");
    seen.add(key);
  }
  for (const [file, contents] of outputs) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, contents, "utf8");
    fs.renameSync(`${file}.tmp`, file);
  }
}

export interface SummarizeRunOptions extends SummaryOptions {
  json?: string;
  /** "-" prints the Markdown to stdout. */
  markdown?: string;
  failOnDefect?: boolean;
}

export interface SummarizeRunResult {
  exitCode: number;
  summary: BenchmarkSummary;
  markdown: string;
  jsonFile: string | null;
  markdownFile: string | null;
  headline: string[];
}

export function summarizeRun(dir: string, options: SummarizeRunOptions = {}): SummarizeRunResult {
  const run = loadRun(dir, options.allowIncomplete === true);
  const summary = computeSummary(run, options);
  const markdown = renderSummaryMarkdown(summary);
  const inputs = runInputs(dir);
  const jsonFile = assertOutput(options.json ?? path.join(run.dir, SUMMARY_JSON_FILE), inputs);
  const markdownTarget = options.markdown ?? path.join(run.dir, SUMMARY_MARKDOWN_FILE);
  const markdownFile = markdownTarget === "-" ? null : assertOutput(markdownTarget, inputs);
  writeOutputs([[jsonFile, `${JSON.stringify(summary, null, 2)}\n`], ...(markdownFile ? [[markdownFile, markdown] as [string, string]] : [])]);
  if (markdownTarget === "-") process.stdout.write(markdown);
  const validation = summary.validation;
  let exitCode = EXIT_OK;
  if (validation.missing.length && options.allowIncomplete !== true) exitCode = EXIT_INVALID;
  else if (!validation.ok) exitCode = EXIT_SANITY;
  else if (options.failOnDefect === true && (summary.defects?.length ?? 0) > 0) exitCode = EXIT_DEFECTS;
  const headline = [
    `${summary.runId}: ${validation.presentCases}/${validation.plannedCases} casos; sanidade ${validation.ok ? "ok" : "REPROVADA"}; ` +
      `baseline ${summary.baselineEligible ? "elegível" : `inelegível (${summary.baselineBlockers.join(", ")})`}.`,
    summary.outcomes
      ? `Válidos ${summary.outcomes.valid}, erros ${summary.outcomes.errors.total}, limite de turnos ${summary.outcomes.maxTurns.count}, defeitos ${summary.defects?.length ?? 0}.`
      : "Métricas não calculadas.",
    `deterministicDigest ${summary.deterministicDigest}`,
  ];
  return { exitCode, summary, markdown, jsonFile, markdownFile, headline };
}

// ── Comparison ─────────────────────────────────────────────────────────────

const IDENTITY_CHANGE_FIELDS = ["engineVersion", "cardDatabaseSignature"] as const;

export interface CompareOptions {
  expectIdentical?: boolean;
  ignore?: readonly string[];
  allowConfigDiff?: readonly string[];
  allowIdentityChange?: readonly string[];
}

interface ScoreDelta {
  key: string;
  base: { p: number; lo: number; hi: number; n: number } | null;
  candidate: { p: number; lo: number; hi: number; n: number } | null;
  delta: number | null;
  newcombe: { lo: number; hi: number } | null;
  significant: boolean;
}

interface DiagnosticDelta {
  base: number | null;
  candidate: number | null;
  delta: number | null;
}

export interface BenchmarkComparison {
  schema: typeof COMPARISON_SCHEMA;
  version: number;
  base: { runId: string; configDigest: string; identityDigest: string };
  candidate: { runId: string; configDigest: string; identityDigest: string };
  scoring: { drawPoints: number; rule: string };
  configDiff: { allowed: string[]; fields: string[]; disallowed: string[] };
  identityDiff: Array<{ field: string; base: JsonValue; candidate: JsonValue }>;
  identityBlocked: string[];
  presets: ScoreDelta[];
  matchups: ScoreDelta[];
  paired: {
    common: number;
    sameOutcome: number;
    /** Both valid with another winner (or a draw on one side only). */
    flipped: number;
    /** Both valid with the same winner, decided another way (lp_zero ↔ lp_at_turn_limit). */
    decidedByChanged: number;
    toError: number;
    fromError: number;
    errorChanged: number;
    openingMismatches: string[];
    cases: Array<{ caseId: string; change: PairedChange; base: string; candidate: string }>;
  };
  maxTurnsFraction: DiagnosticDelta;
  errors: { byKind: { base: Counter; candidate: Counter } };
  diagnostics: Record<string, Record<string, DiagnosticDelta | { base: Counter; candidate: Counter }>>;
  novelties: Record<string, string[]>;
  identical: {
    compared: number;
    onlyInBase: number;
    onlyInCandidate: number;
    equal: number;
    ignored: string[];
    firstDifference: { caseId: string; pointer: string; base: JsonValue; candidate: JsonValue } | null;
  } | null;
}

function leafDiffs(base: unknown, candidate: unknown, prefix: string, output: string[]): void {
  const isObject = (value: unknown): value is object => value !== null && typeof value === "object" && !Array.isArray(value);
  if (isObject(base) && isObject(candidate)) {
    const keys = [...new Set([...Object.keys(base), ...Object.keys(candidate)])].sort(compareCodeUnits);
    for (const key of keys) leafDiffs(Reflect.get(base, key), Reflect.get(candidate, key), prefix ? `${prefix}.${key}` : key, output);
    return;
  }
  if (canonicalJson(base ?? null) !== canonicalJson(candidate ?? null)) output.push(prefix);
}

function covered(field: string, allowed: readonly string[]): boolean {
  return allowed.some(entry => field === entry || field.startsWith(`${entry}.`));
}

function intervalWithN(interval: Interval | null, n: number): ScoreDelta["base"] {
  return interval ? { ...interval, n } : null;
}

function scoreDelta(key: string, base: Interval | null, baseN: number, candidate: Interval | null, candidateN: number): ScoreDelta {
  const difference = base && candidate ? newcombe(candidate, base) : null;
  return {
    key,
    base: intervalWithN(base, baseN),
    candidate: intervalWithN(candidate, candidateN),
    delta: difference ? round(difference.delta) : null,
    newcombe: difference ? { lo: round(difference.lo), hi: round(difference.hi) } : null,
    significant: difference ? difference.lo > 0 || difference.hi < 0 : false,
  };
}

function numericDelta(base: number | null, candidate: number | null): DiagnosticDelta {
  return { base, candidate, delta: base === null || candidate === null ? null : round(candidate - base) };
}

type PairedChange = "flipped" | "decided_by" | "to_error" | "from_error" | "error_changed";

const PAIRED_CHANGE_LABELS: Record<PairedChange, string> = {
  flipped: "virada",
  decided_by: "modo de decisão",
  to_error: "válido → erro",
  from_error: "erro → válido",
  error_changed: "erro trocado",
};

function outcomeKey(record: DuelRecordV1): string {
  const outcome = record.outcome;
  if (outcome.status === "error") return `error:${outcome.errorKind ?? "?"}`;
  return outcome.draw ? `draw:${outcome.decidedBy ?? "?"}` : `win:${outcome.winnerSeat ?? "?"}:${outcome.decidedBy ?? "?"}`;
}

/** Who won a valid duel, regardless of how it was decided. */
function winnerKey(record: DuelRecordV1): string {
  return record.outcome.draw ? "draw" : `win:${record.outcome.winnerSeat ?? "?"}`;
}

/** Classifies a paired case whose outcome key changed. */
function pairedChange(base: DuelRecordV1, candidate: DuelRecordV1): PairedChange {
  const baseValid = isValid(base);
  const candidateValid = isValid(candidate);
  if (baseValid && candidateValid) return winnerKey(base) === winnerKey(candidate) ? "decided_by" : "flipped";
  if (baseValid) return "to_error";
  return candidateValid ? "from_error" : "error_changed";
}

function vocabulary(records: readonly DuelRecordV1[]): Record<string, Set<string>> {
  const sets: Record<string, Set<string>> = {
    errorKinds: new Set(), failureCodes: new Set(), failureClasses: new Set(), unsupportedMarkers: new Set(),
    mismatchSeverities: new Set(), mismatchPaths: new Set(), consoleLabels: new Set(), mainPhaseExits: new Set(),
  };
  const add = (name: string, keys: Iterable<string>) => { for (const key of keys) sets[name]?.add(key); };
  for (const record of records) {
    if (record.outcome.errorKind) add("errorKinds", [record.outcome.errorKind]);
    add("consoleLabels", Object.keys(record.diag.errorLabels).map(label => `error: ${label}`));
    add("consoleLabels", Object.keys(record.diag.warningLabels).map(label => `warn: ${label}`));
    for (const seat of SEATS) {
      const metrics = record.seatMetrics?.[seat];
      if (!metrics) continue;
      add("failureCodes", Object.keys(metrics.actions.failedByCode));
      add("failureClasses", Object.keys(metrics.actions.failedByClass));
      add("unsupportedMarkers", Object.keys(metrics.unsupported.tlsByMarker));
      add("unsupportedMarkers", Object.keys(metrics.unsupported.beamGreedyByMarker));
      add("mismatchSeverities", Object.keys(metrics.planning.mismatchBySeverity));
      add("mismatchPaths", Object.keys(metrics.planning.mismatchByPath));
      add("mainPhaseExits", Object.keys(metrics.mainPhaseExits));
    }
  }
  return sets;
}

/** Removes dotted paths (`*` matches any key or element) from a JSON value. */
function prune(value: JsonValue, segments: readonly string[]): JsonValue {
  if (!segments.length || value === null || typeof value !== "object") return value;
  const [head, ...rest] = segments;
  if (Array.isArray(value)) {
    return head === "*" ? value.map(entry => prune(entry, rest)) : value;
  }
  const result: { [key: string]: JsonValue } = {};
  for (const [key, entry] of Object.entries(value)) {
    const matches = head === "*" || head === key;
    if (matches && !rest.length) continue;
    result[key] = matches ? prune(entry, rest) : entry;
  }
  return result;
}

function firstDifference(base: JsonValue, candidate: JsonValue, pointer = ""): { pointer: string; base: JsonValue; candidate: JsonValue } | null {
  const bothObjects = base !== null && candidate !== null && typeof base === "object" && typeof candidate === "object";
  if (bothObjects && Array.isArray(base) === Array.isArray(candidate)) {
    if (Array.isArray(base) && Array.isArray(candidate)) {
      for (let index = 0; index < Math.max(base.length, candidate.length); index += 1) {
        const left = base[index];
        const right = candidate[index];
        if (left === undefined || right === undefined) return { pointer: `${pointer}/${index}`, base: left ?? null, candidate: right ?? null };
        const found = firstDifference(left, right, `${pointer}/${index}`);
        if (found) return found;
      }
      return null;
    }
    if (!Array.isArray(base) && !Array.isArray(candidate)) {
      const keys = [...new Set([...Object.keys(base), ...Object.keys(candidate)])].sort(compareCodeUnits);
      for (const key of keys) {
        const left = base[key];
        const right = candidate[key];
        const at = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
        if (left === undefined || right === undefined) return { pointer: at, base: left ?? null, candidate: right ?? null };
        const found = firstDifference(left, right, at);
        if (found) return found;
      }
      return null;
    }
  }
  return canonicalJson(base) === canonicalJson(candidate) ? null : { pointer: pointer || "/", base, candidate };
}

function truncateJson(value: JsonValue): JsonValue {
  const text = canonicalJson(value);
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : value;
}

export interface CompareResult {
  exitCode: number;
  comparison: BenchmarkComparison;
  markdown: string;
  messages: string[];
}

export function compareRuns(baseDir: string, candidateDir: string, options: CompareOptions = {}): CompareResult {
  const allowIdentity = options.allowIdentityChange ?? [];
  for (const field of allowIdentity) {
    if (!IDENTITY_CHANGE_FIELDS.some(allowed => allowed === field)) {
      throw new AnalysisInputError(`--allow-identity-change aceita só ${IDENTITY_CHANGE_FIELDS.join(", ")}.`);
    }
  }
  const baseRun = loadRun(baseDir);
  const candidateRun = loadRun(candidateDir);
  const base = computeSummary(baseRun, { allowSanityFailures: true });
  const candidate = computeSummary(candidateRun, { allowSanityFailures: true });
  const messages: string[] = [];
  let invalid = false;
  for (const [label, summary] of [["base", base], ["candidata", candidate]] as const) {
    if (!summary.validation.ok || !summary.complete) {
      invalid = true;
      messages.push(`A execução ${label} (${summary.runId}) não passa na sanidade ou está incompleta.`);
    }
  }

  const configFields: string[] = [];
  leafDiffs(baseRun.header.config, candidateRun.header.config, "", configFields);
  const allowedConfig = [...(options.allowConfigDiff ?? [])];
  const disallowed = configFields.filter(field => !covered(field, allowedConfig));
  const identityDiff = (Object.keys(baseRun.header.identity) as Array<keyof RunIdentity>).sort(compareCodeUnits)
    .filter(field => baseRun.header.identity[field] !== candidateRun.header.identity[field])
    .map(field => ({ field, base: baseRun.header.identity[field], candidate: candidateRun.header.identity[field] }));
  const identityBlocked = identityDiff.map(entry => entry.field).filter(field => {
    if (field === "engineVersion") return !allowIdentity.includes("engineVersion");
    if (field === "cardDatabaseSignature" || field === "cardDatabaseSha256") return !allowIdentity.includes("cardDatabaseSignature");
    return false;
  });
  if (disallowed.length) messages.push(`Configurações incomparáveis: ${disallowed.join(", ")} (use --allow-config-diff).`);
  if (identityBlocked.length) messages.push(`Identidade incomparável: ${identityBlocked.join(", ")} (use --allow-identity-change).`);

  const presetDeltas = (base.presets ?? []).flatMap(entry => {
    const other = candidate.presets?.find(preset => preset.preset === entry.preset);
    return other ? [scoreDelta(entry.preset, entry.score, entry.n, other.score, other.n)] : [];
  });
  const matchupDeltas = (base.matchups ?? []).flatMap(entry => {
    const other = candidate.matchups?.find(matchup => matchup.pair === entry.pair);
    return other ? [scoreDelta(entry.pair, entry.scoreA, entry.valid, other.scoreA, other.valid)] : [];
  });

  const candidateById = new Map(candidateRun.records.map(record => [record.caseId, record]));
  const baseById = new Map(baseRun.records.map(record => [record.caseId, record]));
  const common = baseRun.records.filter(record => candidateById.has(record.caseId));
  const paired: BenchmarkComparison["paired"] = {
    common: common.length, sameOutcome: 0, flipped: 0, decidedByChanged: 0, toError: 0, fromError: 0, errorChanged: 0,
    openingMismatches: [], cases: [],
  };
  for (const record of common) {
    const other = candidateById.get(record.caseId);
    if (!other) continue;
    if (record.opening && other.opening && record.opening.digest !== other.opening.digest) paired.openingMismatches.push(record.caseId);
    const before = outcomeKey(record);
    const after = outcomeKey(other);
    if (before === after) {
      paired.sameOutcome += 1;
      continue;
    }
    const change = pairedChange(record, other);
    paired.cases.push({ caseId: record.caseId, change, base: before, candidate: after });
    switch (change) {
      case "flipped": paired.flipped += 1; break;
      case "decided_by": paired.decidedByChanged += 1; break;
      case "to_error": paired.toError += 1; break;
      case "from_error": paired.fromError += 1; break;
      case "error_changed": paired.errorChanged += 1; break;
    }
  }

  const diagnostics: BenchmarkComparison["diagnostics"] = {};
  const presets = [...new Set([...baseRun.header.config.presets, ...candidateRun.header.config.presets])];
  for (const preset of presets) {
    const left = base.diagnostics?.byPreset[preset];
    const right = candidate.diagnostics?.byPreset[preset];
    if (!left?.duels || !right?.duels) continue;
    diagnostics[preset] = {
      divergenceRate: numericDelta(left.divergence.rate?.p ?? null, right.divergence.rate?.p ?? null),
      tlsUnsupported: numericDelta(left.unsupported.tlsBranches, right.unsupported.tlsBranches),
      nodesPerSearch: numericDelta(left.nodes.tlsPerSearch, right.nodes.tlsPerSearch),
      turnsMean: numericDelta(left.turns.mean, right.turns.mean),
      failedByClass: { base: left.failedActions.byClass, candidate: right.failedActions.byClass },
    };
  }

  const baseVocabulary = vocabulary(baseRun.records);
  const candidateVocabulary = vocabulary(candidateRun.records);
  const novelties: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(candidateVocabulary)) {
    const known = baseVocabulary[name] ?? new Set<string>();
    novelties[name] = [...values].filter(value => !known.has(value)).sort(compareCodeUnits);
  }
  const hasNovelties = Object.values(novelties).some(values => values.length > 0);

  let identical: BenchmarkComparison["identical"] = null;
  if (options.expectIdentical === true) {
    const ignored = [...(options.ignore ?? [])];
    const patterns = ignored.map(entry => entry.split("."));
    const project = (record: DuelRecordV1): JsonValue =>
      patterns.reduce<JsonValue>((value, segments) => prune(value, segments), jsonValue(stripClock(record), record.caseId));
    let equal = 0;
    let difference: NonNullable<BenchmarkComparison["identical"]>["firstDifference"] = null;
    for (const record of common) {
      const other = candidateById.get(record.caseId);
      if (!other) continue;
      const found = firstDifference(project(record), project(other));
      if (!found) equal += 1;
      else difference ??= { caseId: record.caseId, pointer: found.pointer, base: truncateJson(found.base), candidate: truncateJson(found.candidate) };
    }
    identical = {
      compared: common.length,
      onlyInBase: baseRun.records.filter(record => !candidateById.has(record.caseId)).length,
      onlyInCandidate: candidateRun.records.filter(record => !baseById.has(record.caseId)).length,
      equal,
      ignored,
      firstDifference: difference,
    };
    if (!common.length) messages.push("--expect-identical: nenhum caso em comum.");
  }

  const comparison: BenchmarkComparison = {
    schema: COMPARISON_SCHEMA,
    version: COMPARISON_SCHEMA_VERSION,
    base: { runId: base.runId, configDigest: base.configDigest, identityDigest: base.identityDigest },
    candidate: { runId: candidate.runId, configDigest: candidate.configDigest, identityDigest: candidate.identityDigest },
    scoring: { drawPoints: DRAW_POINTS, rule: WIN_RATE_RULE },
    configDiff: { allowed: allowedConfig, fields: configFields, disallowed },
    identityDiff,
    identityBlocked,
    presets: presetDeltas,
    matchups: matchupDeltas,
    paired,
    maxTurnsFraction: numericDelta(base.outcomes?.maxTurns.fraction?.p ?? null, candidate.outcomes?.maxTurns.fraction?.p ?? null),
    errors: { byKind: { base: base.outcomes?.errors.byKind ?? {}, candidate: candidate.outcomes?.errors.byKind ?? {} } },
    diagnostics,
    novelties,
    identical,
  };
  let exitCode = EXIT_OK;
  if (invalid) exitCode = EXIT_INVALID;
  else if (disallowed.length || identityBlocked.length) exitCode = EXIT_INCOMPARABLE;
  else if (identical && (!identical.compared || identical.equal !== identical.compared)) exitCode = EXIT_NOT_IDENTICAL;
  else if (hasNovelties) exitCode = EXIT_NOVELTIES;
  return { exitCode, comparison, markdown: renderComparisonMarkdown(comparison, messages), messages };
}

function deltaText(delta: DiagnosticDelta, digits = 3): string {
  const format = (value: number | null) => value === null ? "—" : value.toFixed(digits);
  return `${format(delta.base)} → ${format(delta.candidate)}${delta.delta === null ? "" : ` (${delta.delta >= 0 ? "+" : ""}${delta.delta.toFixed(digits)})`}`;
}

export function renderComparisonMarkdown(comparison: BenchmarkComparison, messages: readonly string[] = []): string {
  const lines = [
    "# Comparação de benchmarks", "",
    `- Base: ${comparison.base.runId} (config \`${comparison.base.configDigest.slice(0, 12)}\`).`,
    `- Candidata: ${comparison.candidate.runId} (config \`${comparison.candidate.configDigest.slice(0, 12)}\`).`,
    "- Δ = candidata − base; IC de Newcombe (híbrido de Wilson) a 95%; significativo quando o IC não contém zero.", "",
  ];
  if (messages.length) lines.push(...messages.map(message => `> ${message}`), "");
  lines.push("## Configuração e identidade", "",
    `- Diferenças de configuração: ${comparison.configDiff.fields.join(", ") || "nenhuma"}` +
      `${comparison.configDiff.allowed.length ? ` (permitidas: ${comparison.configDiff.allowed.join(", ")})` : ""}.`,
    `- Diferenças de identidade: ${comparison.identityDiff.map(entry => entry.field).join(", ") || "nenhuma"}.`, "",
    "## Presets", "", "| Preset | Base [IC] (n) | Candidata [IC] (n) | Δ | IC Δ | Significativo |", "| --- | --- | --- | ---: | --- | --- |");
  const scoreRow = (entry: ScoreDelta) => {
    const side = (value: ScoreDelta["base"]) => value ? `${intervalText(value)} (${value.n})` : "—";
    return `| ${cell(entry.key)} | ${side(entry.base)} | ${side(entry.candidate)} | ${entry.delta === null ? "—" : percent(entry.delta)} | ` +
      `${entry.newcombe ? `[${percent(entry.newcombe.lo)}; ${percent(entry.newcombe.hi)}]` : "—"} | ${entry.significant ? "sim" : "não"} |`;
  };
  lines.push(...comparison.presets.map(scoreRow), "", "## Pares (placar do primeiro preset)", "",
    "| Par | Base [IC] (n) | Candidata [IC] (n) | Δ | IC Δ | Significativo |", "| --- | --- | --- | ---: | --- | --- |",
    ...comparison.matchups.map(scoreRow));
  const paired = comparison.paired;
  lines.push("", "## Pareamento por caso", "",
    `- Casos em comum: ${paired.common}; mesmo resultado: ${paired.sameOutcome}; viradas (outro vencedor): ${paired.flipped}; ` +
      `mesmo vencedor com outro modo de decisão: ${paired.decidedByChanged}; ` +
      `válido → erro: ${paired.toError}; erro → válido: ${paired.fromError}; erro trocado: ${paired.errorChanged}.`,
    `- Aberturas diferentes: ${paired.openingMismatches.length ? paired.openingMismatches.slice(0, 20).join(", ") : "nenhuma"}.`);
  if (paired.cases.length) {
    lines.push("", "| Caso | Mudança | Base | Candidata |", "| --- | --- | --- | --- |",
      ...paired.cases.slice(0, 40).map(entry =>
        `| ${cell(entry.caseId)} | ${PAIRED_CHANGE_LABELS[entry.change]} | ${cell(entry.base)} | ${cell(entry.candidate)} |`));
    if (paired.cases.length > 40) lines.push(`| … | | | +${paired.cases.length - 40} no JSON |`);
  }
  lines.push("", "## Limite de turnos e erros", "",
    `- Fração no limite de turnos: ${deltaText(comparison.maxTurnsFraction, 4)}.`,
    `- Erros por tipo: base ${counterText(comparison.errors.byKind.base)}; candidata ${counterText(comparison.errors.byKind.candidate)}.`, "",
    "## Diagnósticos", "", "| Preset | Divergência | Unsupported TLS | Nós TLS/busca | Turnos médios |", "| --- | --- | --- | --- | --- |");
  for (const [preset, entry] of Object.entries(comparison.diagnostics)) {
    const value = (key: string, digits: number): string => {
      const delta = entry[key];
      return delta && "delta" in delta ? deltaText(delta, digits) : "—";
    };
    lines.push(`| ${cell(preset)} | ${value("divergenceRate", 3)} | ${value("tlsUnsupported", 0)} | ${value("nodesPerSearch", 1)} | ${value("turnsMean", 1)} |`);
  }
  lines.push("", "## Novidades na candidata", "");
  const novelties = Object.entries(comparison.novelties).filter(([, values]) => values.length);
  if (!novelties.length) lines.push("Nenhuma ocorrência nova.");
  else lines.push("Toda novidade impede o aceite até ser explicada.", "", ...novelties.map(([name, values]) => `- ${name}: ${values.join("; ")}`));
  if (comparison.identical) {
    const identical = comparison.identical;
    lines.push("", "## Identidade dos registros (--expect-identical)", "",
      `- Comparados: ${identical.compared}; iguais: ${identical.equal}; só na base: ${identical.onlyInBase}; só na candidata: ${identical.onlyInCandidate}` +
        `${identical.ignored.length ? `; ignorados: ${identical.ignored.join(", ")}` : ""}.`,
      identical.firstDifference
        ? `- Primeira diferença: ${identical.firstDifference.caseId} em \`${identical.firstDifference.pointer}\`: ` +
          `\`${cell(canonicalJson(identical.firstDifference.base))}\` → \`${cell(canonicalJson(identical.firstDifference.candidate))}\`.`
        : "- Nenhuma diferença fora do relógio.");
  }
  lines.push("");
  return lines.join("\n");
}

// ── Command line ───────────────────────────────────────────────────────────

const USAGE = [
  "Uso:",
  "  npm run benchmark:analyze -- summarize DIR [--json FILE] [--markdown FILE|-] [--allow-incomplete] [--allow-sanity-failures] [--fail-on-defect]",
  "  npm run benchmark:analyze -- compare BASE_DIR CAND_DIR [--expect-identical] [--ignore p1,p2] [--allow-config-diff f1,f2]",
  "      [--allow-identity-change engineVersion,cardDatabaseSignature] [--json FILE] [--markdown FILE|-]",
].join("\n");

function parseOptions(argv: readonly string[], valueFlags: readonly string[], booleanFlags: readonly string[]) {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    if (values.has(argument) || booleans.has(argument)) throw new AnalysisInputError(`Opção repetida: ${argument}.`);
    if (booleanFlags.includes(argument)) {
      booleans.add(argument);
      continue;
    }
    if (!valueFlags.includes(argument)) throw new AnalysisInputError(`Argumento desconhecido: ${argument}.`);
    const value = argv[index + 1];
    if (value === undefined || (value.startsWith("--") && value !== "-")) throw new AnalysisInputError(`Falta o valor de ${argument}.`);
    values.set(argument, value);
    index += 1;
  }
  return { positionals, values, booleans };
}

function list(value: string | undefined): string[] {
  return value === undefined ? [] : value.split(",").map(entry => entry.trim()).filter(Boolean);
}

function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;
  if (command === "summarize") {
    const { positionals, values, booleans } = parseOptions(rest, ["--json", "--markdown"],
      ["--allow-incomplete", "--allow-sanity-failures", "--fail-on-defect"]);
    const [dir, ...extra] = positionals;
    if (!dir || extra.length) throw new AnalysisInputError("summarize precisa de exatamente uma pasta de execução.");
    const json = values.get("--json");
    const markdown = values.get("--markdown");
    const result = summarizeRun(dir, {
      ...(json === undefined ? {} : { json }),
      ...(markdown === undefined ? {} : { markdown }),
      allowIncomplete: booleans.has("--allow-incomplete"),
      allowSanityFailures: booleans.has("--allow-sanity-failures"),
      failOnDefect: booleans.has("--fail-on-defect"),
    });
    for (const line of result.headline) process.stderr.write(`${line}\n`);
    return result.exitCode;
  }
  if (command === "compare") {
    const { positionals, values, booleans } = parseOptions(rest,
      ["--ignore", "--allow-config-diff", "--allow-identity-change", "--json", "--markdown"], ["--expect-identical"]);
    const [baseDir, candidateDir, ...extra] = positionals;
    if (!baseDir || !candidateDir || extra.length) throw new AnalysisInputError("compare precisa de BASE_DIR e CAND_DIR.");
    const result = compareRuns(baseDir, candidateDir, {
      expectIdentical: booleans.has("--expect-identical"),
      ignore: list(values.get("--ignore")),
      allowConfigDiff: list(values.get("--allow-config-diff")),
      allowIdentityChange: list(values.get("--allow-identity-change")),
    });
    const inputs = [...runInputs(baseDir), ...runInputs(candidateDir)];
    const outputs: Array<[string, string]> = [];
    const json = values.get("--json");
    const markdown = values.get("--markdown");
    if (json !== undefined) outputs.push([assertOutput(json, inputs), `${JSON.stringify(result.comparison, null, 2)}\n`]);
    if (markdown !== undefined && markdown !== "-") outputs.push([assertOutput(markdown, inputs), result.markdown]);
    writeOutputs(outputs);
    if (markdown === "-" || (json === undefined && markdown === undefined)) process.stdout.write(result.markdown);
    for (const message of result.messages) process.stderr.write(`${message}\n`);
    const identical = result.comparison.identical;
    if (identical) {
      process.stderr.write(`expect-identical: ${identical.equal}/${identical.compared} iguais` +
        `${identical.firstDifference ? `; primeira diferença ${identical.firstDifference.caseId} ${identical.firstDifference.pointer}` : ""}.\n`);
    }
    return result.exitCode;
  }
  throw new AnalysisInputError(`Comando desconhecido: ${command ?? "(nenhum)"}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error: unknown) {
    if (error instanceof AnalysisInputError || error instanceof SchemaError) {
      process.stderr.write(`Erro: ${error.message}\n${USAGE}\n`);
    } else {
      console.error(error);
    }
    process.exitCode = EXIT_INVALID;
  }
}
