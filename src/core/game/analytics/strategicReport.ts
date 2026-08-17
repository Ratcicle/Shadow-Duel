import {
  ArenaAnalytics,
  DuelTracker,
  END_REASONS,
} from "../../ai/ArenaAnalytics.js";
import type {
  GamePlayer,
} from "../../contracts/gameRuntime.js";

type StrategicWinner = "player" | "bot" | "draw";
type StrategicOutcome = "win" | "loss" | "draw";
type StrategicExportOptions = Parameters<
  InstanceType<typeof ArenaAnalytics>["exportStrategicReport"]
>[0];
type StrategicDuelResult = ReturnType<
  InstanceType<typeof DuelTracker>["finalize"]
>;

interface NormalDuelStrategicState {
  analytics: InstanceType<typeof ArenaAnalytics>;
  tracker: InstanceType<typeof DuelTracker>;
  finalized: boolean;
  result: StrategicDuelResult | null;
}

type StrategicReportHost = {
    player: GamePlayer;
    bot: GamePlayer;
    turnCounter: number;
    winner: string | null;
    normalDuelStrategicReportEnabled: boolean;
    normalDuelPlayerArchetype: string;
    normalDuelBotArchetype: string;
    botPreset: string;
    laboratoryModeEnabled: boolean;
    _arenaTracker: InstanceType<typeof DuelTracker> | null;
    arenaBeamWidth?: number;
    arenaMaxDepth?: number;
    _normalDuelStrategic: NormalDuelStrategicState | null;
    hasStrategicReport?(): boolean;
    exportStrategicReport(
      options?: StrategicExportOptions,
    ): ReturnType<InstanceType<typeof ArenaAnalytics>["exportStrategicReport"]> | null;
    buildStrategicReportFilename?(outcome?: StrategicOutcome | null): string;
  };

function localDateStamp(date: Date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeWinner(winner: string | null | undefined): StrategicWinner {
  return winner === "player" || winner === "bot" || winner === "draw"
    ? winner
    : "draw";
}

export function startNormalDuelStrategicReport(this: StrategicReportHost) {
  if (!this.normalDuelStrategicReportEnabled) return null;
  if (this.laboratoryModeEnabled) return null;
  if (this.bot?.controllerType !== "ai") return null;

  const archetype1 = this.normalDuelPlayerArchetype || "custom";
  const archetype2 = this.normalDuelBotArchetype || this.botPreset || "custom";
  const analytics = new ArenaAnalytics({
    trackOpeningBook: false,
  });
  const tracker = new DuelTracker(1, archetype1, archetype2, {
    beamWidth: this.arenaBeamWidth ?? null,
    maxDepth: this.arenaMaxDepth ?? null,
  });

  this._normalDuelStrategic = {
    analytics,
    tracker,
    finalized: false,
    result: null,
  };
  this._arenaTracker = tracker;
  return this._normalDuelStrategic;
}

export function finalizeNormalDuelStrategicReport(
  this: StrategicReportHost,
  winner: string | null | undefined,
  reason: string = END_REASONS.LP_ZERO,
) {
  const state = this._normalDuelStrategic;
  if (!state?.tracker || !state?.analytics) {
    return null;
  }
  if (state.finalized) {
    return state.result;
  }

  state.tracker.setCurrentTurn?.(this.turnCounter || 0);
  const result = state.tracker.finalize(normalizeWinner(winner), reason, {
    player: this.player?.lp ?? 0,
    bot: this.bot?.lp ?? 0,
  });

  state.analytics.recordDuel(result);
  state.finalized = true;
  state.result = result;

  if (this._arenaTracker === state.tracker) {
    this._arenaTracker = null;
  }

  return result;
}

export function hasStrategicReport(this: StrategicReportHost) {
  return (this._normalDuelStrategic?.analytics?.duelRecords?.length || 0) > 0;
}

export function exportStrategicReport(
  this: StrategicReportHost,
  options: StrategicExportOptions = {},
) {
  if (!this.hasStrategicReport?.()) {
    return null;
  }
  return this._normalDuelStrategic!.analytics.exportStrategicReport(options);
}

export function buildStrategicReportFilename(
  this: StrategicReportHost,
  outcome: StrategicOutcome | null = null,
) {
  const suffix =
    outcome === "win" || outcome === "loss" || outcome === "draw"
      ? outcome
      : this.winner === "player"
        ? "win"
        : this.winner === "bot"
          ? "loss"
          : "draw";
  return `normal_duel_strategic_report_${localDateStamp()}_${suffix}.json`;
}

export function downloadStrategicReport(
  this: StrategicReportHost,
  filename: string | null = null,
  options: StrategicExportOptions = {},
) {
  if (!this.hasStrategicReport?.()) {
    console.warn("[StrategicReport] No normal duel analytics available to export.");
    return null;
  }
  const report = this.exportStrategicReport(options);
  this._normalDuelStrategic!.analytics.downloadStrategicReport(
    filename || this.buildStrategicReportFilename?.() || undefined,
    options,
  );
  return report;
}
