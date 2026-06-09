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
import { PHASE_ORDER, getNextPhase, normalizeTargetPhase } from "./phaseRules.js";

function scheduleAiMoveAfterPaint(game, actor) {
  if (
    !isAI(actor) ||
    game.gameOver ||
    game.isDisposed?.() ||
    typeof actor?.makeMove !== "function"
  ) {
    return;
  }

  const expectedTurn = game.turn;
  const expectedPhase = game.phase;
  const runMove = () => {
    if (
      game.isDisposed?.() ||
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

function hasPendingPhaseInterruption(game) {
  const selectionState = game.selectionState || "idle";
  return (
    !!game.targetSelection ||
    selectionState === "selecting" ||
    selectionState === "confirming" ||
    selectionState === "resolving" ||
    game.isResolvingEffect ||
    game.eventResolutionDepth > 0 ||
    game.chainSystem?.isChainResolving?.() ||
    game.chainSystem?.isChainWindowOpen?.()
  );
}

function setBattleOpenStateForPhase(game, phase) {
  if (phase === "battle") {
    game.battleStep = "start";
    game.damageStepTiming = null;
    return;
  }
  game.battleStep = null;
  game.damageStepTiming = null;
}

async function leaveCurrentPhase(game, options = {}) {
  const currentPhase = game.phase;
  const nextPhase =
    options.nextPhase ??
    game.getNextPhase?.(currentPhase) ??
    getNextPhase(currentPhase, game);
  if (currentPhase === "battle") {
    game.battleStep = "end";
    game.damageStepTiming = null;
  }

  await game.checkAndOfferTraps("phase_end", {
    currentPhase,
    nextPhase,
    fromPhase: currentPhase,
    toPhase: nextPhase,
    battleStep: game.battleStep ?? null,
    damageStepTiming: game.damageStepTiming ?? null,
  });

  if (game.gameOver || game.isDisposed?.()) {
    return { ok: false, reason: "duel_stopped" };
  }

  if (game.phase !== currentPhase) {
    return {
      ok: false,
      reason: "phase_changed_during_phase_end",
      currentPhase: game.phase,
    };
  }

  if (hasPendingPhaseInterruption(game)) {
    return { ok: false, reason: "phase_window_pending" };
  }

  if (currentPhase === "battle") {
    game.clearAttackResolutionIndicators();
    game.clearAttackReadyIndicators();
  }

  return { ok: true, currentPhase, nextPhase };
}

async function enterPhase(game, nextPhase, previousPhase) {
  if (!nextPhase) return { ok: true };

  game.phase = nextPhase;
  setBattleOpenStateForPhase(game, nextPhase);
  game.updateBoard();

  await game.checkAndOfferTraps("phase_start", {
    currentPhase: nextPhase,
    previousPhase,
    fromPhase: previousPhase,
    toPhase: nextPhase,
    battleStep: game.battleStep ?? null,
    damageStepTiming: game.damageStepTiming ?? null,
  });

  if (game.gameOver || game.isDisposed?.()) {
    return { ok: false, reason: "duel_stopped" };
  }

  if (game.phase !== nextPhase) {
    return {
      ok: false,
      reason: "phase_changed_during_phase_start",
      currentPhase: game.phase,
    };
  }

  if (hasPendingPhaseInterruption(game)) {
    return { ok: false, reason: "phase_window_pending" };
  }

  if (nextPhase === "battle" && game.battleStep === "start") {
    game.battleStep = "battle";
  }

  return { ok: true };
}

/**
 * Advances to the next phase in the turn order.
 * Phase order: draw → standby → main1 → battle → main2 → end
 */
export async function nextPhase() {
  if (this.gameOver || this.isDisposed?.()) return;
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
      setTimeout(() => {
        if (!this.isDisposed?.()) this.nextPhase();
      }, retryDelayMs);
    }
    return guard;
  }

  const next = this.getNextPhase?.(this.phase) ?? null;
  const leaveResult = await leaveCurrentPhase(this, { nextPhase: next });
  if (!leaveResult.ok) return leaveResult;

  if (!next) {
    return await this.endTurn();
  }
  const enterResult = await enterPhase(this, next, leaveResult.currentPhase);
  if (!enterResult.ok) return enterResult;

  scheduleAiMoveAfterPaint(this, actor);
}

/**
 * Skips directly to a target phase.
 * Can only skip forward, not backward.
 * @param {string} targetPhase - The phase to skip to
 */
export async function skipToPhase(targetPhase) {
  if (this.gameOver || this.isDisposed?.()) return;
  const actor = this.turn === "player" ? this.player : this.bot;
  const guard = this.guardActionStart(
    { actor, kind: "phase_change" },
    actor === this.player,
  );
  if (!guard.ok) return guard;
  const normalized = normalizeTargetPhase(targetPhase, this);
  const finalTargetPhase = normalized.phase;
  const currentIdx = PHASE_ORDER.indexOf(this.phase);
  const targetIdx = PHASE_ORDER.indexOf(finalTargetPhase);
  if (currentIdx === -1 || targetIdx === -1) return;
  if (targetIdx <= currentIdx) return;

  const fromPhase = this.phase;

  while (this.phase !== finalTargetPhase) {
    const next =
      this.getNextPhase?.(this.phase) ?? getNextPhase(this.phase, this);
    if (!next) return;

    const leaveResult = await leaveCurrentPhase(this, { nextPhase: next });
    if (!leaveResult.ok) return leaveResult;

    const enterResult = await enterPhase(this, next, leaveResult.currentPhase);
    if (!enterResult.ok) return enterResult;
    if (this.gameOver || this.isDisposed?.()) return;
  }

  if (normalized.redirected && actor.controllerType === "human") {
    this.ui?.log?.(normalized.reason);
  }

  // Emitir evento informativo para captura de replay (não bloqueia)
  if (actor.controllerType === "human") {
    this.notify("phase_skip", {
      player: this.turn,
      fromPhase,
      toPhase: finalTargetPhase,
    });
  }

  if (this.phase === "end") {
    return await this.endTurn();
  }
  if (this.gameOver || this.isDisposed?.()) return;
  this.updateBoard();
  if (this.phase !== "draw") {
    scheduleAiMoveAfterPaint(this, actor);
  }
}
