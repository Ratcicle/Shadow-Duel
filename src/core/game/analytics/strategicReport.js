import {
  ArenaAnalytics,
  DuelTracker,
  END_REASONS,
} from "../../ai/ArenaAnalytics.js";

function localDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeWinner(winner) {
  return winner === "player" || winner === "bot" || winner === "draw"
    ? winner
    : "draw";
}

export function startNormalDuelStrategicReport() {
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
  winner,
  reason = END_REASONS.LP_ZERO,
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

export function hasStrategicReport() {
  return (this._normalDuelStrategic?.analytics?.duelRecords?.length || 0) > 0;
}

export function exportStrategicReport(options = {}) {
  if (!this.hasStrategicReport?.()) {
    return null;
  }
  return this._normalDuelStrategic.analytics.exportStrategicReport(options);
}

export function buildStrategicReportFilename(outcome = null) {
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

export function downloadStrategicReport(filename = null, options = {}) {
  if (!this.hasStrategicReport?.()) {
    console.warn("[StrategicReport] No normal duel analytics available to export.");
    return null;
  }
  const report = this.exportStrategicReport(options);
  this._normalDuelStrategic.analytics.downloadStrategicReport(
    filename || this.buildStrategicReportFilename?.() || undefined,
    options,
  );
  return report;
}
