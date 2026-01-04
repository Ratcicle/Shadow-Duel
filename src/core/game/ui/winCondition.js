// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/ui/winCondition.js
// Win condition check and display for Game class — B.10 extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks if a win condition has been met and displays the result.
 */
export function checkWinCondition() {
  if (this.gameOver) return; // Já terminou

  if (this.player.lp <= 0) {
    this.ui?.showAlert?.("Game Over! You Lost.");
    this.gameOver = true;
    this.emit("game_over", {
      winner: this.bot,
      winnerId: this.bot.id,
      loser: this.player,
      loserId: this.player.id,
      reason: "lp_zero",
    });
  } else if (this.bot.lp <= 0) {
    this.ui?.showAlert?.("Victory! You Won.");
    this.gameOver = true;
    this.emit("game_over", {
      winner: this.player,
      winnerId: this.player.id,
      loser: this.bot,
      loserId: this.bot.id,
      reason: "lp_zero",
    });
  }
}
