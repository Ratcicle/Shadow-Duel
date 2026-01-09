// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/ui/winCondition.js
// Win condition check and display for Game class — B.10 extraction
// ─────────────────────────────────────────────────────────────────────────────

import ReplayCapture from "../../ReplayCapture.js";

/**
 * Checks if a win condition has been met and displays the result.
 */
export function checkWinCondition() {
  if (this.gameOver) return; // Já terminou

  const showGameOver = (victory) => {
    // Usa o modal customizado se disponível, senão fallback para alert
    if (typeof this.ui?.showGameOverModal === "function") {
      this.ui.showGameOverModal({
        victory,
        playerLP: this.player.lp,
        botLP: this.bot.lp,
        turns: this.turnCounter,
        onMenu: () => {
          // Voltar ao menu principal
          document.getElementById("start-screen")?.classList.remove("hidden");
        },
        onRematch: () => {
          // Reiniciar duelo - dispara evento para main.js tratar
          window.dispatchEvent(new CustomEvent("shadow-duel-rematch"));
        },
        onExport: () => {
          // Exportar replay do duelo atual
          if (ReplayCapture.isEnabled() && ReplayCapture.currentDuel) {
            const duel = ReplayCapture.currentDuel;
            const decisions = duel.decisions?.length || 0;
            ReplayCapture.exportReplays();
            return { decisions };
          } else if (ReplayCapture.replays?.length > 0) {
            const lastDuel =
              ReplayCapture.replays[ReplayCapture.replays.length - 1];
            const decisions = lastDuel?.decisions?.length || 0;
            ReplayCapture.exportReplays();
            return { decisions };
          }
          return null;
        },
      });
    } else {
      // Fallback
      this.ui?.showAlert?.(
        victory ? "Victory! You Won." : "Game Over! You Lost."
      );
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
    showGameOver(true);
  }
}
