// src/core/game/ui/winCondition.js
// Win condition check and display for Game class.

import type { GamePlayer } from "../../contracts/gameRuntime.js";

type DuelWinner = "player" | "bot";

interface StrategicReportExport {
  duelCount?: number;
}

interface GameOverModalOptions {
  victory: boolean;
  playerLP: number;
  botLP: number;
  turns: number;
  strategicReportAvailable: boolean;
  replayAvailable: boolean;
  strategicReportInfo: {
    duelCount: 1;
    winner: string | null;
    turns: number;
  } | null;
  onMenu(): void;
  onRematch(): void;
  onExportStrategicReport(): { duelCount: number; filename?: string } | null;
  onExportReplay(): unknown;
}

interface WinConditionUiPort {
  showGameOverModal?(options: GameOverModalOptions): void;
  showAlert?(message: string): void;
  waitForLpPresentation?(): Promise<unknown> | void;
}

interface WinConditionHost {
  gameOver: boolean;
  winner: string | null;
  player: GamePlayer;
  bot: GamePlayer;
  turnCounter: number;
  normalDuelStrategicReportEnabled: boolean;
  ui?: WinConditionUiPort;
  isDisposed?(): boolean;
  hasStrategicReport?(): boolean;
  hasCanonicalReplay?(): boolean;
  buildStrategicReportFilename?(outcome: "win" | "loss"): string;
  downloadStrategicReport?(filename?: string): StrategicReportExport | null;
  exportReplay?(options: { download: true }): unknown;
  emit(event: "game_over", payload: unknown): unknown;
  finalizeNormalDuelStrategicReport?(
    winner: DuelWinner,
    reason: "lp_zero",
  ): unknown;
  finalizeReplay?(result: { winner: DuelWinner; reason: "lp_zero" }): unknown;
}

/**
 * Checks if a win condition has been met and displays the result.
 */
export function checkWinCondition(this: WinConditionHost) {
  if (this.gameOver) return;

  const showGameOver = (victory: boolean) => {
    const openModal = () => {
      if (this.isDisposed?.()) return;

      const hasStrategicReport = this.hasStrategicReport?.() === true;
      const hasReplay = this.hasCanonicalReplay?.() === true;
      if (!hasStrategicReport && this.normalDuelStrategicReportEnabled) {
        console.warn(
          "[StrategicReport] Game over modal opened without exportable analytics.",
        );
      }

      if (typeof this.ui?.showGameOverModal === "function") {
        this.ui.showGameOverModal({
          victory,
          playerLP: this.player.lp,
          botLP: this.bot.lp,
          turns: this.turnCounter,
          strategicReportAvailable: hasStrategicReport,
          replayAvailable: hasReplay,
          strategicReportInfo: hasStrategicReport
            ? {
                duelCount: 1,
                winner: this.winner,
                turns: this.turnCounter,
              }
            : null,
          onMenu: () => {
            document.getElementById("start-screen")?.classList.remove("hidden");
          },
          onRematch: () => {
            window.dispatchEvent(new CustomEvent("shadow-duel-rematch"));
          },
          onExportStrategicReport: () => {
            if (!this.hasStrategicReport?.()) {
              console.warn(
                "[StrategicReport] Export requested but no normal duel analytics are available.",
              );
              return null;
            }
            const filename = this.buildStrategicReportFilename?.(
              victory ? "win" : "loss",
            );
            const report = this.downloadStrategicReport?.(filename);
            return report
              ? {
                  duelCount: report.duelCount || 1,
                  filename,
                }
              : null;
          },
          onExportReplay: () => this.exportReplay?.({ download: true }),
        });
      } else {
        this.ui?.showAlert?.(
          victory ? "Victory! You Won." : "Game Over! You Lost.",
        );
      }
    };

    const waitForLp = this.ui?.waitForLpPresentation?.();
    if (waitForLp && typeof waitForLp.then === "function") {
      waitForLp.then(openModal).catch((error: unknown) => {
        console.warn("[Game] Failed while waiting for LP presentation.", error);
        openModal();
      });
    } else {
      openModal();
    }
  };

  if (this.player.lp <= 0) {
    this.gameOver = true;
    this.winner = "bot";
    this.emit("game_over", {
      winner: this.bot,
      winnerId: this.bot.id,
      loser: this.player,
      loserId: this.player.id,
      reason: "lp_zero",
    });
    this.finalizeNormalDuelStrategicReport?.("bot", "lp_zero");
    this.finalizeReplay?.({ winner: "bot", reason: "lp_zero" });
    showGameOver(false);
  } else if (this.bot.lp <= 0) {
    this.gameOver = true;
    this.winner = "player";
    this.emit("game_over", {
      winner: this.player,
      winnerId: this.player.id,
      loser: this.bot,
      loserId: this.bot.id,
      reason: "lp_zero",
    });
    this.finalizeNormalDuelStrategicReport?.("player", "lp_zero");
    this.finalizeReplay?.({ winner: "player", reason: "lp_zero" });
    showGameOver(true);
  }
}
