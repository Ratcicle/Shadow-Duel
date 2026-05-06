/**
 * transitions.js
 *
 * Phase transition methods extracted from Game.js.
 * Handles advancing through game phases.
 *
 * Methods:
 * - nextPhase
 * - skipToPhase
 */

import { isAI } from "../../Player.js";

function scheduleAiMoveAfterPaint(game, actor) {
  if (!isAI(actor) || game.gameOver || typeof actor?.makeMove !== "function") {
    return;
  }

  const expectedTurn = game.turn;
  const expectedPhase = game.phase;
  const runMove = () => {
    if (
      game.gameOver ||
      game.turn !== expectedTurn ||
      game.phase !== expectedPhase
    ) {
      return;
    }
    actor.makeMove(game);
  };

  const requestFrame = globalThis.requestAnimationFrame;
  if (typeof requestFrame === "function") {
    requestFrame(() => setTimeout(runMove, 0));
    return;
  }

  setTimeout(runMove, 0);
}

/**
 * Advances to the next phase in the turn order.
 * Phase order: draw → standby → main1 → battle → main2 → end
 */
export async function nextPhase() {
  if (this.gameOver) return;
  const actor = this.turn === "player" ? this.player : this.bot;
  const guard = this.guardActionStart(
    { actor, kind: "phase_change" },
    actor === this.player,
  );
  if (!guard.ok) {
    if (
      isAI(actor) &&
      (guard.code === "BLOCKED_RESOLVING" ||
        guard.code === "BLOCKED_SELECTION_ACTIVE")
    ) {
      const retryDelayMs = Number.isFinite(this?.aiActionDelayMs)
        ? this.aiActionDelayMs
        : 250;
      setTimeout(() => this.nextPhase(), retryDelayMs);
    }
    return guard;
  }

  // Offer generic trap activation at the end of current phase
  await this.checkAndOfferTraps("phase_end", {
    currentPhase: this.phase,
  });

  const order = ["draw", "standby", "main1", "battle", "main2", "end"];
  const idx = order.indexOf(this.phase);
  if (idx === -1) return;
  const next = order[idx + 1];
  if (!next) {
    return await this.endTurn();
  }
  this.phase = next;

  // Clear attack indicators when leaving battle phase
  this.clearAttackResolutionIndicators();
  this.clearAttackReadyIndicators();

  this.updateBoard();

  scheduleAiMoveAfterPaint(this, actor);
}

/**
 * Skips directly to a target phase.
 * Can only skip forward, not backward.
 * @param {string} targetPhase - The phase to skip to
 */
export async function skipToPhase(targetPhase) {
  const actor = this.turn === "player" ? this.player : this.bot;
  const guard = this.guardActionStart(
    { actor, kind: "phase_change" },
    actor === this.player,
  );
  if (!guard.ok) return guard;
  const order = ["draw", "standby", "main1", "battle", "main2", "end"];
  const currentIdx = order.indexOf(this.phase);
  const targetIdx = order.indexOf(targetPhase);
  if (currentIdx === -1 || targetIdx === -1) return;
  if (targetIdx <= currentIdx) return;

  const fromPhase = this.phase;
  this.phase = targetPhase;

  // Clear attack indicators when skipping phases
  this.clearAttackResolutionIndicators();
  this.clearAttackReadyIndicators();

  // Emitir evento informativo para captura de replay (não bloqueia)
  if (actor.controllerType === "human") {
    this.notify("phase_skip", {
      player: this.turn,
      fromPhase,
      toPhase: targetPhase,
    });
  }

  if (this.phase === "end") {
    return await this.endTurn();
  }
  this.updateBoard();
  if (this.phase !== "draw") {
    scheduleAiMoveAfterPaint(this, actor);
  }
}
