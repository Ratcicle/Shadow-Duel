// src/core/game/ui/winCondition.js
// Win condition check and display for Game class.

/**
 * Checks if a win condition has been met and displays the result.
 */
export function checkWinCondition() {
  if (this.gameOver) return;

  const showGameOver = (victory) => {
    const openModal = () => {
      if (this.isDisposed?.()) return;

      const hasStrategicReport = this.hasStrategicReport?.() === true;
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
        });
      } else {
        this.ui?.showAlert?.(
          victory ? "Victory! You Won." : "Game Over! You Lost.",
        );
      }
    };

    const waitForLp = this.ui?.waitForLpPresentation?.();
    if (waitForLp && typeof waitForLp.then === "function") {
      waitForLp.then(openModal).catch((error) => {
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
    showGameOver(true);
  }
}
