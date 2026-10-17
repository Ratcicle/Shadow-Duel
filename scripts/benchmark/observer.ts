import Bot from "../../src/core/Bot.js";
import Game from "../../src/core/Game.js";
import { DuelTracker } from "../../src/core/ai/ArenaAnalytics.js";
import { evaluateVisibleBattle, type VisibleBattleProjection } from "../../src/core/ai/common/battleProjection.js";
import { TECH_ZERO_IDS } from "../../src/core/ai/techzero/knowledge.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import type { ArenaDuelResult } from "../../src/core/contracts/arena.js";
import type { BotGamePort, BotStrategyPort } from "../../src/core/contracts/bot.js";
import type { AfterSummonEventPayload } from "../../src/core/contracts/events.js";
import type { GameOptions } from "../../src/core/contracts/game.js";
import type { GamePlayer } from "../../src/core/contracts/player.js";
import type { SummonMethod } from "../../src/core/contracts/summon.js";
import {
  DUEL_RECORD_VERSION,
  DUEL_SCHEMA,
  FAILED_BACKROW_REACTION_KEY,
  GUARD_STAGE_RING_SIZE,
  MISMATCH_SAMPLE_LIMIT,
  SEATS,
  classifyFailureCode,
  digestOf,
  jsonValue,
  type BenchmarkCase,
  type Counter,
  type CrossCheck,
  type CrossCheckDiff,
  type DuelDiagnostics,
  type DuelOutcome,
  type DuelRecordV1,
  type DuelStart,
  type GuardCounterName,
  type GuardPeaks,
  type GuardStage,
  type GuardTrip,
  type InvarianceCaseRecord,
  type JsonValue,
  type LethalSeat,
  type MismatchSample,
  type PresetMetricId,
  type PresetMetricsRecord,
  type RunConfig,
  type Seat,
  type SeatMetrics,
  type TechZeroComboSeat,
} from "./schema.js";
import { InvarianceTallies, installInvarianceControl, type InvarianceHost } from "./invariance.js";
import { increment, round, sortedCounter } from "./statistics.js";

// Instance-level observation for the benchmark harness. Nothing here changes
// a decision: wrappers are synchronous, keep `this` and the return value, and
// add no await. The duel, the Arena UI and replays never load this module.

/** Tracker snapshots taken by the Arena's wall-clock watchdog are clock data. */
const CLOCK_DRIVEN_STAGES: ReadonlySet<string> = new Set(["zero_event_watchdog", "zero_event_timeout"]);
const ARENA_PLANNER_FIELDS = [
  "arenaPlannerMode", "arenaPlannerTurnMode", "arenaPlannerBeamWidth", "arenaPlannerMaxDepth",
  "arenaPlannerNodeBudget", "arenaPlannerCandidateLimit", "arenaPlannerConfig",
] as const;
const TURN_LINE_BUDGET_FIELDS = [
  "turnLineSearchBeamWidth", "turnLineSearchMaxDepth", "turnLineSearchNodeBudget",
  "turnLineSearchCandidateLimit", "turnLineSearchBattleStepLimit", "arenaPlannerBattleStepLimit",
] as const;

export class HarnessConfigDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessConfigDriftError";
  }
}

export interface HarnessSpec {
  entry: BenchmarkCase;
  config: RunConfig;
}

type TrackerSeats = ReturnType<DuelTracker["finalize"]>["strategic"]["seats"];
type ProgressArgs = Parameters<DuelTracker["recordProgress"]>;
type ActivationAttemptArgs = Parameters<DuelTracker["recordActivationAttempt"]>;
type BlockedActionArgs = Parameters<DuelTracker["recordBlockedAction"]>;
type FinalizeArgs = Parameters<DuelTracker["finalize"]>;

function seatOf(value: unknown): Seat | null {
  const id = typeof value === "string" ? value : value !== null && typeof value === "object" ? Reflect.get(value, "id") : null;
  return id === "player" || id === "bot" ? id : null;
}

/** Same lookup as the tracker's cardName: name, cardName, then label. */
function refName(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return null;
  for (const key of ["name", "cardName", "label"]) {
    const name: unknown = Reflect.get(value, key);
    if (name) return String(name);
  }
  return null;
}

function read(source: unknown, key: string): unknown {
  return source !== null && typeof source === "object" ? Reflect.get(source, key) : undefined;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function firstPresent(...values: unknown[]): unknown {
  return values.find(value => value !== undefined && value !== null);
}

function actionLabel(fingerprint: unknown): string | null {
  if (fingerprint === null || typeof fingerprint !== "object") return null;
  const type = textOrNull(read(fingerprint, "type")) ?? "action";
  const card = textOrNull(read(fingerprint, "cardName"));
  const target = textOrNull(read(fingerprint, "targetName"));
  return [type, card, target].filter((entry): entry is string => entry !== null).join(":");
}

function unsupportedMarkers(state: unknown): readonly unknown[] {
  const markers = read(state, "_simUnsupportedActions");
  return Array.isArray(markers) ? markers : [];
}

function markerFamily(marker: string): string {
  return marker.split(":", 1)[0] ?? marker;
}

function emptySeatMetrics(preset: string): SeatMetrics {
  return {
    preset,
    decisions: { mainPhase: 0, measured: 0, broker: 0 },
    planning: {
      searches: 0, used: 0, comparisons: 0, matches: 0, mismatches: 0,
      failed: { notExecuted: 0, executedRejected: 0 },
      mismatchBySeverity: {}, mismatchByPath: {}, terminations: {}, repeatedStates: 0,
    },
    unsupported: { tlsBranches: 0, tlsByFamily: {}, tlsByMarker: {}, beamGreedyByFamily: {}, beamGreedyByMarker: {}, otherByFamily: {} },
    nodes: { tls: 0, beamGreedySimulations: 0, otherSimulations: 0 },
    actions: { attempts: 0, failed: 0, blocked: 0, failedByClass: {}, failedByCode: {}, blockedByCode: {}, invalidByCard: {} },
    mainPhaseExits: {},
  };
}

function sortedSeatMetrics(metrics: SeatMetrics): SeatMetrics {
  return {
    preset: metrics.preset,
    decisions: { ...metrics.decisions },
    planning: {
      ...metrics.planning,
      failed: { ...metrics.planning.failed },
      mismatchBySeverity: sortedCounter(metrics.planning.mismatchBySeverity),
      mismatchByPath: sortedCounter(metrics.planning.mismatchByPath),
      terminations: sortedCounter(metrics.planning.terminations),
    },
    unsupported: {
      tlsBranches: metrics.unsupported.tlsBranches,
      tlsByFamily: sortedCounter(metrics.unsupported.tlsByFamily),
      tlsByMarker: sortedCounter(metrics.unsupported.tlsByMarker),
      beamGreedyByFamily: sortedCounter(metrics.unsupported.beamGreedyByFamily),
      beamGreedyByMarker: sortedCounter(metrics.unsupported.beamGreedyByMarker),
      otherByFamily: sortedCounter(metrics.unsupported.otherByFamily),
    },
    nodes: { ...metrics.nodes },
    actions: {
      attempts: metrics.actions.attempts,
      failed: metrics.actions.failed,
      blocked: metrics.actions.blocked,
      failedByClass: sortedCounter(metrics.actions.failedByClass),
      failedByCode: sortedCounter(metrics.actions.failedByCode),
      blockedByCode: sortedCounter(metrics.actions.blockedByCode),
      invalidByCard: sortedCounter(metrics.actions.invalidByCard),
    },
    mainPhaseExits: sortedCounter(metrics.mainPhaseExits),
  };
}

interface PlannerProfileSnapshot {
  beamWidth: unknown;
  maxDepth: unknown;
  nodeBudget: unknown;
  candidateLimit: unknown;
}

interface SeatObservation {
  metrics: SeatMetrics;
  /** pre: between ai_decision_before and ai_turn_line_search; post: after it; idle: outside a decision. */
  window: "idle" | "pre" | "post";
  pendingSimulations: number;
  pendingBranches: number;
  pendingMarkers: string[];
  tlsSearchMismatches: number;
  executedSinceDecision: boolean;
  decisionOpen: boolean;
  decisionStartedAt: number;
  awaitingProfile: boolean;
  profile: PlannerProfileSnapshot | null;
  plannerProfiles: Counter;
  latencies: number[];
}

// ── Preset metric plugins ──────────────────────────────────────────────────

export interface ObservedSummon {
  seat: Seat;
  turn: number;
  cardId: number;
  method: SummonMethod;
}

export interface BattleObservation extends VisibleBattleProjection {
  seat: Seat;
  turn: number;
}

/** The Tech-Zero combo summons: M, Portal and the three Synchro bosses. */
export const TECH_ZERO_COMBO_IDS: readonly number[] = [
  TECH_ZERO_IDS.MULTIMODAL, TECH_ZERO_IDS.PORTAL, TECH_ZERO_IDS.REACTOR, TECH_ZERO_IDS.LANCER, TECH_ZERO_IDS.SINGULARITY,
];
const TECH_ZERO_COMBO_BOSSES: ReadonlySet<number> = new Set([
  TECH_ZERO_IDS.REACTOR, TECH_ZERO_IDS.LANCER, TECH_ZERO_IDS.SINGULARITY,
]);

/** A combo needs M, Portal and a Synchro boss summoned in the same seat and turn. */
export function techZeroComboMetrics(summons: readonly ObservedSummon[]): Record<Seat, TechZeroComboSeat> {
  const forSeat = (seat: Seat): TechZeroComboSeat => {
    const seatSummons = summons.filter(summon => summon.seat === seat);
    const comboTurns = [...new Set(seatSummons.map(summon => summon.turn))].filter(turn => {
      const turnSummons = seatSummons.filter(summon => summon.turn === turn);
      return turnSummons.some(summon => summon.cardId === TECH_ZERO_IDS.MULTIMODAL) &&
        turnSummons.some(summon => summon.cardId === TECH_ZERO_IDS.PORTAL) &&
        turnSummons.some(summon => TECH_ZERO_COMBO_BOSSES.has(summon.cardId) && summon.method === "synchro");
    });
    return {
      summonsById: Object.fromEntries(TECH_ZERO_COMBO_IDS.map(id =>
        [id, seatSummons.filter(summon => summon.cardId === id).length])),
      comboTurns,
    };
  };
  return { player: forSeat("player"), bot: forSeat("bot") };
}

/** A proven lethal is converted only by an LP-zero win of that seat in that turn. */
export function summarizeBattles(observations: readonly BattleObservation[], completed: ArenaDuelResult | null) {
  const battles = observations.map(battle => ({ ...battle,
    converted: battle.lethal && completed?.type === "completed" && completed.reason === "lp_zero" &&
      completed?.winner === battle.seat && completed.turns === battle.turn,
  }));
  return {
    battles,
    provenLethalOpportunities: battles.filter(battle => battle.lethal).length,
    unconvertedProvenLethals: battles.filter(battle => battle.lethal && !battle.converted).length,
  };
}

function lethalForSeat(observations: readonly BattleObservation[], seat: Seat, completed: ArenaDuelResult | null): LethalSeat {
  const summary = summarizeBattles(observations.filter(battle => battle.seat === seat), completed);
  return {
    projections: summary.battles.length,
    opportunities: summary.provenLethalOpportunities,
    converted: summary.provenLethalOpportunities - summary.unconvertedProvenLethals,
    unconverted: summary.unconvertedProvenLethals,
  };
}

// ── Observer ───────────────────────────────────────────────────────────────

export class DuelObserver {
  readonly spec: HarnessSpec;
  readonly game: HarnessGame;
  readonly seats: Record<Seat, SeatObservation>;
  readonly summons: ObservedSummon[] = [];
  readonly battles: BattleObservation[] = [];
  readonly mismatchSamples: MismatchSample[] = [];
  readonly peaks: GuardPeaks = { decisions: 0, actions: 0, progress: 0 };
  readonly limits: Record<GuardCounterName, number>;
  readonly enforceGuard: boolean;
  readonly plugins: ReadonlySet<PresetMetricId>;
  start: DuelStart | null = null;
  openingDigest: string | null = null;
  trip: GuardTrip | null = null;
  tripState: { turns: number; finalLP: { player: number; bot: number } } | null = null;
  frozen = false;
  /** Set while the invariance control reruns a root: its activity is no part of the duel. */
  muted = false;
  /** Comparisons of the invariance control; null when the run does not carry it. */
  readonly invariance: InvarianceTallies | null;
  /** This duel's tracker, kept for its public-projection guard tallies. */
  tracker: DuelTracker | null = null;
  observerErrors = 0;
  observerErrorLabels: Counter = {};
  clockStages = 0;
  private guardTurn: number | null = null;
  private turnCounts: Record<GuardCounterName, number> = { decisions: 0, actions: 0, progress: 0 };
  private readonly stageRing: GuardStage[] = [];

  constructor(spec: HarnessSpec, game: HarnessGame) {
    this.spec = spec;
    this.game = game;
    const observation = (preset: string): SeatObservation => ({
      metrics: emptySeatMetrics(preset), window: "idle", pendingSimulations: 0, pendingBranches: 0, pendingMarkers: [],
      tlsSearchMismatches: 0, executedSinceDecision: false, decisionOpen: false, decisionStartedAt: 0,
      awaitingProfile: false, profile: null, plannerProfiles: {}, latencies: [],
    });
    this.seats = { player: observation(spec.entry.seat1), bot: observation(spec.entry.seat2) };
    const guard = spec.config.stallGuard;
    this.limits = { decisions: guard.decisionsPerTurn, actions: guard.actionsPerTurn, progress: guard.progressPerTurn };
    this.enforceGuard = guard.mode === "enforce";
    this.plugins = new Set(spec.config.presetMetrics);
    this.invariance = spec.config.invarianceControl === undefined ? null
      : new InvarianceTallies({ player: spec.entry.seat1, bot: spec.entry.seat2 });
  }

  /** Stops every deterministic counter; later engine activity is not part of the record. */
  freeze(): void {
    this.frozen = true;
  }

  private guarded(task: () => void): void {
    if (this.frozen || this.muted) return;
    try {
      task();
    } catch (error) {
      // A harness defect never reaches the duel; it is counted as a defect of the record.
      this.observerErrors += 1;
      const message = error instanceof Error ? error.message : String(error);
      increment(this.observerErrorLabels, `[observer] ${message.split(/\r?\n/, 1)[0]?.slice(0, 200) ?? ""}`);
    }
  }

  private bump(name: GuardCounterName): void {
    const turn = this.game.turnCounter;
    if (turn !== this.guardTurn) {
      this.guardTurn = turn;
      this.turnCounts = { decisions: 0, actions: 0, progress: 0 };
    }
    const value = this.turnCounts[name] + 1;
    this.turnCounts[name] = value;
    if (value > this.peaks[name]) this.peaks[name] = value;
    // An ended duel has nothing left to stop: activity between its end and the
    // tracker's finalize (bot_arena_after_wait_for_end, late notifications)
    // still counts, but never turns a finished duel into a stall_guard error.
    if (this.enforceGuard && this.trip === null && !this.game.gameOver && value > this.limits[name]) {
      this.trip = {
        counter: name, turn, phase: textOrNull(this.game.phase), value, limit: this.limits[name],
        lastStages: this.stageRing.map(stage => ({ ...stage })),
      };
      this.tripState = { turns: turn, finalLP: { player: this.game.player.lp, bot: this.game.bot.lp } };
      this.frozen = true;
      // Same effect as BotArena.stop(): the Arena sees a cancelled duel and the
      // worker classifies it by this trip. No game_over is emitted.
      this.game.gameOver = true;
    }
  }

  onProgress(stage: string, details: unknown): void {
    this.guarded(() => {
      if (CLOCK_DRIVEN_STAGES.has(stage)) {
        this.clockStages += 1;
        return;
      }
      const actor = seatOf(read(details, "actor"));
      this.stageRing.push({ stage, turn: this.game.turnCounter, phase: textOrNull(this.game.phase), actor });
      if (this.stageRing.length > GUARD_STAGE_RING_SIZE) this.stageRing.shift();
      this.bump("progress");
      if (this.frozen) return;
      switch (stage) {
        case "starting_player_selected": this.captureStart(); return;
        case "opening_draw_after": this.captureOpening(); return;
        case "ai_main_phase_execution":
        case "bot_make_move_enter":
          this.bump("actions");
          return;
      }
      if (!actor) return;
      const seat = this.seats[actor];
      switch (stage) {
        case "ai_decision_before": this.decisionBefore(seat); break;
        case "ai_turn_line_search": this.turnLineSearch(seat, details); break;
        case "ai_decision_after": this.decisionClosed(seat); break;
        case "ai_main_phase_exit":
          this.decisionClosed(seat);
          increment(seat.metrics.mainPhaseExits, textOrNull(read(details, "reason")) ?? "none");
          break;
        case "ai_plan_execution_compare":
        case "ai_plan_execution_failed":
          this.planExecution(stage, actor, seat, details);
          break;
      }
    });
  }

  private captureStart(): void {
    const seat = seatOf(this.game.turn);
    if (!seat) return;
    this.start = { seat, preset: this.seats[seat].metrics.preset, rngCalls: this.game.getRandomState().calls };
  }

  private captureOpening(): void {
    const zones = (player: GamePlayer) => ({
      hand: player.hand.map(card => card.id ?? null),
      deck: player.deck.map(card => card.id ?? null),
      extraDeck: player.extraDeck.map(card => card.id ?? null),
    });
    this.openingDigest = digestOf({ player: zones(this.game.player), bot: zones(this.game.bot) });
  }

  private flushPending(seat: SeatObservation, target: "tls" | "beamGreedy"): void {
    const unsupported = seat.metrics.unsupported;
    if (target === "tls") {
      unsupported.tlsBranches += seat.pendingBranches;
      for (const marker of seat.pendingMarkers) {
        increment(unsupported.tlsByMarker, marker);
        increment(unsupported.tlsByFamily, markerFamily(marker));
      }
    } else {
      seat.metrics.nodes.beamGreedySimulations += seat.pendingSimulations;
      for (const marker of seat.pendingMarkers) {
        increment(unsupported.beamGreedyByMarker, marker);
        increment(unsupported.beamGreedyByFamily, markerFamily(marker));
      }
    }
    seat.pendingSimulations = 0;
    seat.pendingBranches = 0;
    seat.pendingMarkers = [];
  }

  private decisionBefore(seat: SeatObservation): void {
    // A decision that ended without a planner stage was resolved by beam/greedy.
    if (seat.window === "pre") this.flushPending(seat, "beamGreedy");
    seat.window = "pre";
    seat.metrics.decisions.mainPhase += 1;
    seat.executedSinceDecision = false;
    seat.decisionOpen = true;
    seat.decisionStartedAt = performance.now();
    seat.awaitingProfile = true;
    seat.profile = null;
    this.bump("decisions");
  }

  /** Same pairing as the tracker: an open ai_decision_before closes on ai_decision_after or ai_main_phase_exit. */
  private decisionClosed(seat: SeatObservation): void {
    if (seat.window === "pre") this.flushPending(seat, "beamGreedy");
    seat.window = "idle";
    seat.awaitingProfile = false;
    if (!seat.decisionOpen) return;
    seat.decisionOpen = false;
    seat.metrics.decisions.measured += 1;
    seat.latencies.push(round(performance.now() - seat.decisionStartedAt, 3));
  }

  private turnLineSearch(seat: SeatObservation, details: unknown): void {
    const planning = seat.metrics.planning;
    planning.searches += 1;
    if (read(details, "plannerUsed") === true) planning.used += 1;
    increment(planning.terminations, textOrNull(read(details, "plannerTerminationReason")) ?? "unknown");
    planning.repeatedStates += numberOr(read(details, "plannerRepeatedStates"), 0);
    seat.metrics.nodes.tls += numberOr(read(details, "plannedNodesEvaluated"), 0);
    // Cross-check per search: the planner counts one unsupported branch per
    // simulated step whose state gained markers.
    if (numberOr(read(details, "plannerUnsupportedBranches"), 0) !== seat.pendingBranches) seat.tlsSearchMismatches += 1;
    this.flushPending(seat, "tls");
    seat.window = "post";
    increment(seat.plannerProfiles, this.plannerTuple(seat.profile, details));
  }

  /** Effective planner profile with mainPhaseController's precedence (turnLineSearch* are absent, checked at start). */
  private plannerTuple(profile: PlannerProfileSnapshot | null, details: unknown): string {
    const game = this.game;
    const field = (key: string): unknown => Reflect.get(game, key);
    const width = firstPresent(field("turnLineSearchBeamWidth"), profile?.beamWidth, field("arenaPlannerBeamWidth"),
      field("arenaBeamWidth"), 2);
    const depth = firstPresent(field("turnLineSearchMaxDepth"), profile?.maxDepth, field("arenaPlannerMaxDepth"),
      field("arenaMaxDepth"), 2);
    const budget = firstPresent(field("turnLineSearchNodeBudget"), profile?.nodeBudget, field("arenaPlannerNodeBudget"),
      field("arenaNodeBudget"), 100);
    const candidates = firstPresent(field("turnLineSearchCandidateLimit"), profile?.candidateLimit,
      field("arenaPlannerCandidateLimit"), "actions");
    const turnMode = read(details, "plannerTurnMode") ?? "?";
    const battleSteps = read(details, "plannerBattleStepLimit") ?? "?";
    const mode = read(details, "plannerMode") ?? "?";
    return [width, depth, budget, candidates, turnMode, battleSteps, mode].map(String).join("/");
  }

  private planExecution(stage: string, actor: Seat, seat: SeatObservation, details: unknown): void {
    const planning = seat.metrics.planning;
    planning.comparisons += 1;
    const failed = stage === "ai_plan_execution_failed";
    let severity: string;
    if (failed) {
      if (seat.executedSinceDecision) planning.failed.executedRejected += 1;
      else planning.failed.notExecuted += 1;
      severity = textOrNull(read(details, "mismatchReason")) ?? "action_failed";
      // Same mark as the tracker's: a declared failed: key, outside the severities.
      if (read(details, "opponentBackrowReacted") === true) increment(planning.mismatchBySeverity, FAILED_BACKROW_REACTION_KEY);
    } else if (read(details, "matched")) {
      planning.matches += 1;
      return;
    } else {
      planning.mismatches += 1;
      severity = textOrNull(read(details, "mismatchReason")) ?? textOrNull(read(details, "diffSeverity")) ?? "state_mismatch";
      increment(planning.mismatchBySeverity, severity);
    }
    const diffs = read(details, "diffs");
    const paths = (Array.isArray(diffs) ? diffs : []).map(diff => textOrNull(read(diff, "path")) ?? "unspecified");
    if (!failed) for (const path of paths) increment(planning.mismatchByPath, path);
    if (this.mismatchSamples.length < MISMATCH_SAMPLE_LIMIT) {
      this.mismatchSamples.push({
        turn: this.game.turnCounter, phase: textOrNull(this.game.phase), stage, actor, severity, paths,
        plannedAction: actionLabel(read(details, "plannedAction")),
        actualAction: actionLabel(read(details, "actualAction")),
      });
    }
  }

  onDecisionMade(actorId: unknown): void {
    this.guarded(() => {
      this.bump("decisions");
      const seat = seatOf(actorId);
      if (seat && !this.frozen) this.seats[seat].metrics.decisions.broker += 1;
    });
  }

  /** Mirrors DuelTracker.recordActivationAttempt, keeping the stable code it discards. */
  onActivationAttempt(data: unknown): void {
    this.guarded(() => {
      this.bump("actions");
      if (this.frozen) return;
      const seat = seatOf(read(data, "player") || read(data, "owner") || read(data, "seat"));
      if (!seat) return;
      const actions = this.seats[seat].metrics.actions;
      actions.attempts += 1;
      if (read(data, "success") === true) return;
      const name = refName(read(data, "card") || read(data, "source")) || textOrNull(read(data, "cardName")) || "unknown";
      this.recordFailure(actions, textOrNull(read(data, "code")), read(data, "blocked") === true, name);
    });
  }

  /** Mirrors DuelTracker.recordBlockedAction (guardActionStart). */
  onBlockedAction(data: unknown): void {
    this.guarded(() => {
      this.bump("actions");
      if (this.frozen) return;
      const seat = seatOf(read(data, "player") || read(data, "actor") || read(data, "seat"));
      if (!seat) return;
      const actions = this.seats[seat].metrics.actions;
      actions.attempts += 1;
      const name = refName(read(data, "card")) || textOrNull(read(data, "cardName")) || textOrNull(read(data, "kind")) || "action";
      this.recordFailure(actions, textOrNull(read(data, "code")), true, name);
    });
  }

  private recordFailure(actions: SeatMetrics["actions"], code: string | null, blocked: boolean, cardName: string): void {
    actions.failed += 1;
    increment(actions.failedByCode, code ?? "uncoded");
    increment(actions.failedByClass, classifyFailureCode(code));
    increment(actions.invalidByCard, cardName);
    if (!blocked) return;
    actions.blocked += 1;
    increment(actions.blockedByCode, code ?? "uncoded");
  }

  onSimulation(actorId: unknown, markers: readonly string[]): void {
    this.guarded(() => {
      const actor = seatOf(actorId);
      if (!actor) return;
      const seat = this.seats[actor];
      if (seat.window === "pre") {
        seat.pendingSimulations += 1;
        if (markers.length) seat.pendingBranches += 1;
        seat.pendingMarkers.push(...markers);
        return;
      }
      const unsupported = seat.metrics.unsupported;
      if (seat.window === "post") {
        seat.metrics.nodes.beamGreedySimulations += 1;
        for (const marker of markers) {
          increment(unsupported.beamGreedyByMarker, marker);
          increment(unsupported.beamGreedyByFamily, markerFamily(marker));
        }
        return;
      }
      seat.metrics.nodes.otherSimulations += 1;
      for (const marker of markers) increment(unsupported.otherByFamily, markerFamily(marker));
    });
  }

  onPlanningProfile(actorId: unknown, profile: unknown): void {
    this.guarded(() => {
      const actor = seatOf(actorId);
      if (!actor) return;
      const seat = this.seats[actor];
      if (!seat.awaitingProfile) return;
      seat.awaitingProfile = false;
      seat.profile = {
        beamWidth: read(profile, "beamWidth"), maxDepth: read(profile, "maxDepth"),
        nodeBudget: read(profile, "nodeBudget"), candidateLimit: read(profile, "candidateLimit"),
      };
    });
  }

  onExecuteMainPhaseAction(actorId: unknown): void {
    this.guarded(() => {
      const actor = seatOf(actorId);
      if (actor) this.seats[actor].executedSinceDecision = true;
    });
  }

  onSummon(payload: AfterSummonEventPayload): void {
    this.guarded(() => {
      const cardId = payload.card.id;
      const seat = seatOf(payload.player.id);
      if (cardId == null || !seat || !TECH_ZERO_COMBO_IDS.includes(cardId)) return;
      this.summons.push({ seat, turn: this.game.turnCounter, cardId, method: payload.method });
    });
  }

  onBattlePhase(bot: HarnessBot, game: BotGamePort): void {
    this.guarded(() => {
      if (!this.plugins.has("lethal")) return;
      const seat = seatOf(bot.id);
      if (!seat || this.battles.some(battle => battle.seat === seat && battle.turn === game.turnCounter)) return;
      const opponent = seat === "player" ? game.bot : game.player;
      this.battles.push({ seat, turn: game.turnCounter, ...evaluateVisibleBattle(bot, opponent, game.turnCounter) });
    });
  }

  seatMetrics(seat: Seat): SeatMetrics {
    return sortedSeatMetrics(this.seats[seat].metrics);
  }

  tlsSearchMismatches(seat: Seat): number {
    return this.seats[seat].tlsSearchMismatches;
  }

  plannerProfiles(seat: Seat): Counter {
    return sortedCounter(this.seats[seat].plannerProfiles);
  }

  latencies(seat: Seat): number[] {
    return [...this.seats[seat].latencies];
  }

  /** Side line of the invariance control, with the tracker's guard tallies; null without the control. */
  invarianceRecord(entry: BenchmarkCase): InvarianceCaseRecord | null {
    return this.invariance?.record(entry, this.tracker?.getPublicProjectionGuard() ?? { player: {}, bot: {} }) ?? null;
  }

  presetMetrics(completed: ArenaDuelResult | null): PresetMetricsRecord {
    const comboSeat = (seat: Seat, combos: Record<Seat, TechZeroComboSeat>): TechZeroComboSeat | null =>
      this.seats[seat].metrics.preset === "techzero" ? combos[seat] : null;
    let combo: PresetMetricsRecord["techzero-combo"] = null;
    if (this.plugins.has("techzero-combo")) {
      const combos = techZeroComboMetrics(this.summons);
      combo = { player: comboSeat("player", combos), bot: comboSeat("bot", combos) };
    }
    return {
      "techzero-combo": combo,
      lethal: this.plugins.has("lethal")
        ? { player: lethalForSeat(this.battles, "player", completed), bot: lethalForSeat(this.battles, "bot", completed) }
        : null,
    };
  }

  /** State of an interrupted duel; it lives under `clock.partial`, outside the deterministic record. */
  snapshot(): JsonValue {
    const seats: { [key: string]: JsonValue } = {};
    for (const seat of SEATS) {
      seats[seat] = { metrics: jsonValue(this.seatMetrics(seat), `snapshot.${seat}`),
        plannerProfiles: this.plannerProfiles(seat) };
    }
    return {
      turn: this.game.turnCounter,
      phase: textOrNull(this.game.phase),
      peaks: { ...this.peaks },
      lastStages: this.stageRing.map(stage => ({ ...stage })),
      seats,
      observerErrors: this.observerErrors,
    };
  }
}

// ── Game and Bot subclasses ────────────────────────────────────────────────

function readField(game: object, key: string): unknown {
  return Reflect.get(game, key);
}

export class HarnessGame extends Game {
  static spec: HarnessSpec | null = null;
  static current: HarnessGame | null = null;

  /** One case per worker process: the spec is set before the Arena creates its Game. */
  static configure(spec: HarnessSpec): void {
    HarnessGame.spec = spec;
    HarnessGame.current = null;
  }

  readonly observer: DuelObserver;

  constructor(options: GameOptions = {}) {
    super(options);
    const spec = HarnessGame.spec;
    if (!spec) throw new HarnessConfigDriftError("HarnessGame.configure precisa rodar antes de a Arena criar o Game.");
    this.observer = new DuelObserver(spec, this);
    HarnessGame.current = this;
    this.on("decision_made", payload => this.observer.onDecisionMade(payload.actorId));
    if (spec.config.presetMetrics.includes("techzero-combo")) {
      this.on("after_summon", payload => this.observer.onSummon(payload));
    }
  }

  override async start(...args: Parameters<Game["start"]>): Promise<void> {
    this.prepareHarnessRun();
    await super.start(...args);
  }

  /** Applies the H1 debug mode, refuses any configuration drift and wraps this duel's tracker. */
  private prepareHarnessRun(): void {
    const { config, entry } = this.observer.spec;
    const planner = config.planner;
    if (planner.modeSource === "strategy") {
      // Imitates the normal duel (gameLauncher): no Arena planner mode or budgets.
      for (const key of ARENA_PLANNER_FIELDS) Reflect.deleteProperty(this, key);
    }
    const problems: string[] = [];
    const expect = (label: string, actual: unknown, expected: unknown) => {
      if (actual !== expected) problems.push(`${label}=${JSON.stringify(actual)} (esperado ${JSON.stringify(expected)})`);
    };
    expect("randomSeed", this.randomSeed, entry.seed);
    expect("arenaBeamWidth", readField(this, "arenaBeamWidth"), config.beam.beamWidth);
    expect("arenaMaxDepth", readField(this, "arenaMaxDepth"), config.beam.maxDepth);
    expect("arenaNodeBudget", readField(this, "arenaNodeBudget"), config.beam.nodeBudget);
    if (planner.modeSource === "arena") {
      expect("arenaPlannerMode", readField(this, "arenaPlannerMode"), planner.modeOverride ?? planner.arenaMode);
      expect("arenaPlannerTurnMode", readField(this, "arenaPlannerTurnMode"), planner.turnModeOverride ?? planner.arenaTurnMode);
      expect("arenaPlannerBeamWidth", readField(this, "arenaPlannerBeamWidth"), planner.arenaBudgets.beamWidth);
      expect("arenaPlannerMaxDepth", readField(this, "arenaPlannerMaxDepth"), planner.arenaBudgets.maxDepth);
      expect("arenaPlannerNodeBudget", readField(this, "arenaPlannerNodeBudget"), planner.arenaBudgets.nodeBudget);
      expect("arenaPlannerCandidateLimit", readField(this, "arenaPlannerCandidateLimit"), planner.arenaBudgets.candidateLimit);
    } else {
      for (const key of ARENA_PLANNER_FIELDS) expect(key, readField(this, key), undefined);
    }
    for (const key of TURN_LINE_BUDGET_FIELDS) expect(key, readField(this, key), undefined);
    expect("turnLineSearchMode", readField(this, "turnLineSearchMode"), planner.modeOverride ?? undefined);
    expect("turnLineSearchEnabled", readField(this, "turnLineSearchEnabled"),
      planner.modeOverride === null ? undefined : planner.modeOverride === "always");
    expect("turnLineSearchTurnMode", readField(this, "turnLineSearchTurnMode"), planner.turnModeOverride ?? undefined);
    const delays = config.delays;
    for (const key of ["phaseDelayMs", "aiActionDelayMs", "aiSuccessfulActionDelayMs", "aiPresentationStepDelayMs", "aiBattleDelayMs"] as const) {
      expect(key, readField(this, key), delays[key]);
      expect(`${key}=0`, readField(this, key), 0);
    }
    expect("disablePresentationDelays", readField(this, "disablePresentationDelays"), true);
    expect("maxTurnCounter", this.maxTurnCounter, config.maxTurns);
    expect("captureReplayEnabled", this.captureReplayEnabled, false);
    expect("document", typeof Reflect.get(globalThis, "document"), "undefined");
    expect("requestAnimationFrame", typeof Reflect.get(globalThis, "requestAnimationFrame"), "undefined");
    expect("player.archetype", readField(this.player, "archetype"), entry.seat1);
    expect("bot.archetype", readField(this.bot, "archetype"), entry.seat2);
    expect("player.controllerType", this.player.controllerType, "ai");
    expect("bot.controllerType", this.bot.controllerType, "ai");
    const tracker = this._arenaTracker;
    if (!(tracker instanceof DuelTracker)) problems.push("_arenaTracker não é o DuelTracker da Arena");
    if (problems.length) throw new HarnessConfigDriftError(`Deriva de configuração: ${problems.join("; ")}.`);
    if (tracker instanceof DuelTracker) this.attachTracker(tracker);
  }

  /** Synchronous wrappers on this duel's tracker only; each calls the original with the tracker as `this`. */
  private attachTracker(tracker: DuelTracker): void {
    const observer = this.observer;
    observer.tracker = tracker;
    const recordProgress = tracker.recordProgress;
    tracker.recordProgress = (...args: ProgressArgs) => {
      observer.onProgress(args[0], args[2]);
      recordProgress.apply(tracker, args);
    };
    const recordActivationAttempt = tracker.recordActivationAttempt;
    tracker.recordActivationAttempt = (...args: ActivationAttemptArgs) => {
      observer.onActivationAttempt(args[0]);
      recordActivationAttempt.apply(tracker, args);
    };
    const recordBlockedAction = tracker.recordBlockedAction;
    tracker.recordBlockedAction = (...args: BlockedActionArgs) => {
      observer.onBlockedAction(args[0]);
      recordBlockedAction.apply(tracker, args);
    };
    // The tracker's result is a snapshot: stop counting at the same point.
    const finalize = tracker.finalize;
    tracker.finalize = (...args: FinalizeArgs) => {
      observer.freeze();
      return finalize.apply(tracker, args);
    };
  }
}

function activeObserver(): DuelObserver | null {
  return HarnessGame.current?.observer ?? null;
}

/** The invariance control silences this duel's observer and tracker while it reruns a root. */
const INVARIANCE_HOST: InvarianceHost = {
  talliesFor: game => game instanceof HarnessGame && !game.observer.frozen ? game.observer.invariance : null,
  silence: game => {
    if (!(game instanceof HarnessGame)) return () => {};
    const harness: HarnessGame = game;
    const observer = harness.observer;
    const tracker = harness._arenaTracker;
    observer.muted = true;
    if (tracker !== undefined) harness._arenaTracker = null;
    return () => {
      if (tracker !== undefined) harness._arenaTracker = tracker;
      observer.muted = false;
    };
  },
};

/**
 * Wraps the strategy instance of one bot. Only the outermost simulation is
 * attributed (nested calls of the same strategy pass through), and the marker
 * delta of that call is read without touching the state.
 */
function instrumentStrategy(bot: HarnessBot): void {
  const strategy: BotStrategyPort = bot.strategy;
  const simulate = strategy.simulateMainPhaseAction;
  let depth = 0;
  strategy.simulateMainPhaseAction = (state, action) => {
    if (depth > 0) return simulate.call(strategy, state, action);
    depth += 1;
    const before = unsupportedMarkers(state).length;
    try {
      return simulate.call(strategy, state, action);
    } finally {
      depth -= 1;
      const added = unsupportedMarkers(state).slice(before).map(String);
      activeObserver()?.onSimulation(bot.id, added);
    }
  };
  const getPlanningProfile = strategy.getPlanningProfile;
  if (typeof getPlanningProfile === "function") {
    strategy.getPlanningProfile = (game, context) => {
      const profile = getPlanningProfile.call(strategy, game, context);
      activeObserver()?.onPlanningProfile(bot.id, profile);
      return profile;
    };
  }
}

export class HarnessBot extends Bot {
  constructor(archetype?: string) {
    super(archetype);
    instrumentStrategy(this);
    // Opt-in (--invariance-control); without it the bot carries no observer at all.
    if (HarnessGame.spec?.config.invarianceControl !== undefined) installInvarianceControl(this, INVARIANCE_HOST);
  }

  // Not async: marks the execution and returns the very promise of the base
  // method, without an extra microtask.
  override executeMainPhaseAction(game: BotGamePort, action: AIAction): Promise<boolean> {
    activeObserver()?.onExecuteMainPhaseAction(this.id);
    return super.executeMainPhaseAction(game, action);
  }

  override playBattlePhase(game: BotGamePort): void {
    activeObserver()?.onBattlePhase(this, game);
    super.playBattlePhase(game);
  }
}

// ── Projection ─────────────────────────────────────────────────────────────

/** Compares the observer with DuelTracker's own counters; any difference fails the sanity gate. */
export function crossCheck(observer: DuelObserver, trackerSeats: TrackerSeats): CrossCheck {
  const diffs: CrossCheckDiff[] = [];
  for (const seat of SEATS) {
    const mine = observer.seatMetrics(seat);
    const theirs = trackerSeats[seat];
    const fields: Array<[string, number, number]> = [
      ["planning.searches=attempts", mine.planning.searches, theirs.planning.attempts],
      ["planning.used", mine.planning.used, theirs.planning.used],
      ["planning.matches=executionMatches", mine.planning.matches, theirs.planning.executionMatches],
      ["planning.mismatches=executionMismatches", mine.planning.mismatches, theirs.planning.executionMismatches],
      ["planning.failed=failedExecutions", mine.planning.failed.notExecuted + mine.planning.failed.executedRejected,
        theirs.planning.failedExecutions],
      ["unsupported.tlsBranches=unsupportedBranches", mine.unsupported.tlsBranches, theirs.planning.unsupportedBranches],
      ["unsupported.searchMismatches", observer.tlsSearchMismatches(seat), 0],
      ["decisions.measured=decisionCount", mine.decisions.measured, theirs.decisionCount],
      ["actions.failed=failedActions", mine.actions.failed, theirs.failedActions],
      ["actions.blocked=blockedActions", mine.actions.blocked, theirs.blockedActions],
    ];
    for (const [field, observerValue, trackerValue] of fields) {
      if (observerValue !== trackerValue) diffs.push({ seat, field, observer: observerValue, tracker: trackerValue });
    }
  }
  return { status: diffs.length ? "failed" : "ok", diffs };
}

export interface ProjectionInput {
  entry: BenchmarkCase;
  game: HarnessGame | null;
  outcome: DuelOutcome;
  /** Arena result, used only by the lethal plugin to decide conversions. */
  completed: ArenaDuelResult | null;
  trackerSeats: TrackerSeats | null;
  diag: Omit<DuelDiagnostics, "observerErrors" | "mismatchSamples">;
  duelMs: number | null;
  workerMs: number | null;
  /** wall_clock: only identity, start, opening and the error stay deterministic. */
  partial: boolean;
}

function zeroDiagnostics(): DuelDiagnostics {
  return {
    consoleErrors: 0, consoleWarnings: 0, errorLabels: {}, warningLabels: {}, unhandledRejections: 0,
    processWarnings: 0, observerErrors: 0, mathRandomCalls: 0, mismatchSamples: [],
  };
}

export function projectDuelRecord(input: ProjectionInput): DuelRecordV1 {
  const { entry, game, outcome } = input;
  const observer = game?.observer ?? null;
  const diag: DuelDiagnostics = {
    ...input.diag,
    errorLabels: sortedCounter({ ...input.diag.errorLabels, ...(observer?.observerErrorLabels ?? {}) }),
    warningLabels: sortedCounter(input.diag.warningLabels),
    observerErrors: observer?.observerErrors ?? 0,
    mismatchSamples: observer ? observer.mismatchSamples.map(sample => ({ ...sample, paths: [...sample.paths] })) : [],
  };
  const full = observer !== null && game !== null && !input.partial;
  const randomSeed = game?.randomSeed;
  const beam = game ? [readField(game, "arenaBeamWidth"), readField(game, "arenaMaxDepth"), readField(game, "arenaNodeBudget")] : [];
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
    effectiveSeed: typeof randomSeed === "number" ? randomSeed : null,
    start: observer?.start ? { ...observer.start } : null,
    opening: observer?.openingDigest ? { digest: observer.openingDigest } : null,
    outcome,
    guard: {
      peaks: full ? { ...observer.peaks } : null,
      trip: observer?.trip ? { ...observer.trip, lastStages: observer.trip.lastStages.map(stage => ({ ...stage })) } : null,
    },
    profiles: full ? {
      beam: beam.map(String).join("/"),
      planner: { player: observer.plannerProfiles("player"), bot: observer.plannerProfiles("bot") },
    } : null,
    seatMetrics: full ? { player: observer.seatMetrics("player"), bot: observer.seatMetrics("bot") } : null,
    presetMetrics: full ? observer.presetMetrics(input.completed) : null,
    diag: input.partial ? zeroDiagnostics() : diag,
    crossCheck: full && outcome.status === "valid" && input.trackerSeats
      ? crossCheck(observer, input.trackerSeats)
      : { status: "skipped", diffs: [] },
    clock: {
      duelMs: input.duelMs,
      workerMs: input.workerMs,
      decisionLatencyMs: { player: observer?.latencies("player") ?? [], bot: observer?.latencies("bot") ?? [] },
      watchdogStages: observer?.clockStages ?? 0,
      partial: input.partial ? { observer: observer?.snapshot() ?? null, diag: jsonValue(diag, "partial.diag") } : null,
    },
  };
}
