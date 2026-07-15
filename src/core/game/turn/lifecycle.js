/**
 * lifecycle.js
 *
 * Turn lifecycle methods extracted from Game.js.
 * Handles starting and ending turns.
 *
 * Methods:
 * - startTurn
 * - endTurn
 * - waitForPhaseDelay
 */

import { isAI } from "../../Player.js";
import { botLogger } from "../../BotLogger.js";

function scheduleAiMoveAfterPaint(game, actor) {
  if (
    !isAI(actor) ||
    game.gameOver ||
    game.isDisposed?.() ||
    typeof actor?.makeMove !== "function"
  ) {
    return;
  }

  game._arenaTracker?.recordProgress?.("ai_move_scheduled", game, {
    actor: actor?.id || null,
  });
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
    game._arenaTracker?.recordProgress?.("ai_move_before_makeMove", game, {
      actor: actor?.id || null,
      expectedPhase,
    });
    try {
      Promise.resolve(actor.makeMove(game))
        .then(() => {
          game._arenaTracker?.recordProgress?.("ai_move_after_makeMove", game, {
            actor: actor?.id || null,
          });
        })
        .catch((error) => {
          game._arenaTracker?.recordProgress?.("ai_move_makeMove_error", game, {
            actor: actor?.id || null,
            error: error?.message || String(error),
          });
          console.error("[BotArena:progress] AI makeMove failed:", error);
        });
    } catch (error) {
      game._arenaTracker?.recordProgress?.("ai_move_makeMove_error", game, {
        actor: actor?.id || null,
        error: error?.message || String(error),
      });
      throw error;
    }
  };

  const requestFrame = globalThis.requestAnimationFrame;
  if (typeof requestFrame === "function") {
    requestFrame(() => setTimeout(runMove, 0));
    return;
  }

  setTimeout(runMove, 0);
}

async function negotiateAutomaticPhaseEnd(game, eventData) {
  while (!game.gameOver && !game.isDisposed?.()) {
    const currentPhase = game.phase;
    const timingResult = await game.checkAndOfferTraps("phase_end", eventData);
    if (!timingResult || timingResult.phaseTransitionAllowed === true) {
      return { ok: true, timingResult: timingResult || null };
    }
    if (
      timingResult.needsSelection === true ||
      timingResult.deferred === true ||
      timingResult.phaseTransitionInterrupted !== true ||
      game.phase !== currentPhase
    ) {
      return { ok: false, timingResult };
    }
    // Automatic Draw/Standby phases renew their phase-transition intent after
    // a Chain and the mandatory post-Chain timing round have both completed.
  }
  return { ok: false, reason: "duel_stopped" };
}

/**
 * Starts a new turn for the active player.
 * Handles draw phase, standby phase, and transitions to main1.
 */
export async function startTurn() {
  if (this.gameOver || this.isDisposed?.()) return;
  this.turnCounter += 1;
  this._arenaTracker?.recordProgress?.("turn_start", this);

  const activePlayerName =
    (this.turn === "player" ? this.player : this.bot)?.name || this.turn;
  this.devLog?.("TURN_START", {
    summary: `Turn ${this.turnCounter}: ${activePlayerName}`,
    turn: this.turnCounter,
    player: this.turn,
    playerName: activePlayerName,
  });

  this.resetOncePerTurnUsage("start_turn");
  this.player.lpGainedThisTurn = 0;
  this.bot.lpGainedThisTurn = 0;
  this.player.damageReceivedThisTurn = 0;
  this.bot.damageReceivedThisTurn = 0;

  // Clean up expired turn-based buffs at the start of the turn
  this.cleanupExpiredBuffs();
  this.cleanupExpiredDeclaredValues?.();
  this.cleanupExpiredEffectMarkers?.();
  this.cleanupExpiredTemporaryBattlePairEffects?.();
  this.cleanupExpiredTemporaryEventEffects?.();
  this.cleanupExpiredSpecialSummonRestrictions?.();
  this.cleanupExpiredEffectActivationRestrictions?.();

  // Limpar cache de targeting para novo turno
  if (this.effectEngine?.clearTargetingCache) {
    this.effectEngine.clearTargetingCache();
  }

  this.phase = "draw";
  this.battleStep = null;
  this.damageStepTiming = null;

  const activePlayer = this.turn === "player" ? this.player : this.bot;
  const opponent = activePlayer === this.player ? this.bot : this.player;
  activePlayer.forbidDirectAttacksThisTurn = false;
  activePlayer.field.forEach((card) => {
    card.hasAttacked = false;
    card.attacksUsedThisTurn = 0;
    card.positionChangedThisTurn = false;
    card.canMakeSecondAttackThisTurn = false;
    card.secondAttackUsedThisTurn = false;

    const shouldRestrictAttack =
      card.cannotAttackUntilTurn &&
      this.turnCounter <= card.cannotAttackUntilTurn;
    card.cannotAttackThisTurn = shouldRestrictAttack;

    if (!shouldRestrictAttack && card.cannotAttackUntilTurn) {
      card.cannotAttackUntilTurn = null;
    }
    if (
      card.immuneToOpponentEffectsUntilTurn &&
      this.turnCounter > card.immuneToOpponentEffectsUntilTurn
    ) {
      card.immuneToOpponentEffectsUntilTurn = null;
    }
  });
  activePlayer.summonCount = 0;
  activePlayer.additionalNormalSummons = 0;
  activePlayer.additionalNormalSummonPermissions = [];
  activePlayer.normalSummonsThisTurn = [];

  this.updateBoard();
  await this.checkAndOfferTraps("phase_start", {
    currentPhase: "draw",
    previousPhase: null,
    fromPhase: null,
    toPhase: "draw",
    player: activePlayer,
    battleStep: null,
    damageStepTiming: null,
  });
  if (this.gameOver || this.isDisposed?.()) return;
  this._arenaTracker?.recordProgress?.("turn_draw_before", this, {
    actor: activePlayer?.id || this.turn,
    deckSize: activePlayer?.deck?.length || 0,
    handSize: activePlayer?.hand?.length || 0,
  });
  const drawResult = this.drawCards(activePlayer, 1);
  this._arenaTracker?.recordProgress?.("turn_draw_result", this, {
    actor: activePlayer?.id || this.turn,
    ok: drawResult?.ok === true,
    reason: drawResult?.reason || null,
    nonFatal: drawResult?.nonFatal === true,
    drawnCount: drawResult?.drawn?.length || 0,
    deckSize: activePlayer?.deck?.length || 0,
    handSize: activePlayer?.hand?.length || 0,
  });
  if (this.gameOver || this.isDisposed?.()) return;
  this._arenaTracker?.recordProgress?.("turn_draw_after", this, {
    actor: activePlayer?.id || this.turn,
    deckSize: activePlayer?.deck?.length || 0,
    handSize: activePlayer?.hand?.length || 0,
  });
  this.updateBoard();
  const drawTiming = await this.checkAndOfferTraps("normal_draw", {
    player: activePlayer,
    drawn: drawResult?.drawn || [],
    currentPhase: "draw",
    phase: "draw",
  });
  if (drawTiming?.needsSelection || this.gameOver || this.isDisposed?.()) return;
  const drawPhaseEnd = await negotiateAutomaticPhaseEnd(this, {
    currentPhase: "draw",
    nextPhase: "standby",
    fromPhase: "draw",
    toPhase: "standby",
    battleStep: null,
    damageStepTiming: null,
  });
  if (!drawPhaseEnd.ok) return drawPhaseEnd;
  if (this.gameOver || this.isDisposed?.()) return;
  if (this.phase !== "draw") return;
  await this.waitForPhaseDelay();
  if (this.gameOver || this.isDisposed?.()) return;

  this.phase = "standby";
  this.battleStep = null;
  this.damageStepTiming = null;

  this.updateBoard();
  await this.checkAndOfferTraps("phase_start", {
    currentPhase: "standby",
    previousPhase: "draw",
    fromPhase: "draw",
    toPhase: "standby",
    player: activePlayer,
    battleStep: null,
    damageStepTiming: null,
  });
  if (this.gameOver || this.isDisposed?.()) return;

  // Process delayed actions in standby phase BEFORE emitting the event
  await this.processDelayedActions("standby", activePlayer.id || this.turn);
  if (this.gameOver || this.isDisposed?.()) return;

  this.updateBoard();
  await this.emit("standby_phase", { player: activePlayer, opponent });
  if (this.gameOver || this.isDisposed?.()) return;
  if (this.phase !== "standby") return;
  await this.waitForPhaseDelay();
  if (this.gameOver || this.isDisposed?.()) return;
  const standbyPhaseEnd = await negotiateAutomaticPhaseEnd(this, {
    currentPhase: "standby",
    nextPhase: "main1",
    fromPhase: "standby",
    toPhase: "main1",
    battleStep: null,
    damageStepTiming: null,
  });
  if (!standbyPhaseEnd.ok) return standbyPhaseEnd;
  if (this.gameOver || this.isDisposed?.()) return;
  if (this.phase !== "standby") return;

  this.phase = "main1";
  this.battleStep = null;
  this.damageStepTiming = null;
  this.updateBoard();
  await this.checkAndOfferTraps("phase_start", {
    currentPhase: "main1",
    previousPhase: "standby",
    fromPhase: "standby",
    toPhase: "main1",
    player: activePlayer,
    battleStep: null,
    damageStepTiming: null,
  });
  if (this.gameOver || this.isDisposed?.() || this.phase !== "main1") return;
  this._arenaTracker?.recordProgress?.("main1_ready", this, {
    actor: activePlayer?.id || this.turn,
  });

  // 📊 Log de transição para main1
  if (botLogger && isAI(activePlayer)) {
    botLogger.logPhaseTransition(
      activePlayer.id || "bot",
      this.turnCounter,
      "standby",
      "main1",
      0,
      0
    );
  }

  scheduleAiMoveAfterPaint(this, activePlayer);
}

/**
 * Ends the current turn and starts the opponent's turn.
 */
export async function endTurn() {
  if (this.gameOver || this.isDisposed?.()) return;
  const actor = this.turn === "player" ? this.player : this.bot;
  const guard = this.guardActionStart(
    { actor, kind: "phase_change" },
    actor === this.player
  );
  if (!guard.ok) return guard;

  // Resolve any actions scheduled for the end phase of the current turn
  // (e.g. Galaxy Extreme Dragon returning from the banished zone).
  const opponent = this.getOpponent?.(actor) || null;
  await this.emit("end_phase", { player: actor, opponent });
  if (this.gameOver || this.isDisposed?.()) return;

  await this.processDelayedActions("end", this.turn);
  if (this.gameOver || this.isDisposed?.()) return;

  this.cleanupTempBoosts(this.player);
  this.cleanupTempBoosts(this.bot);
  this.player.forbidDirectAttacksThisTurn = false;
  this.bot.forbidDirectAttacksThisTurn = false;

  // Clear all attack indicators at end of turn
  this.clearAttackResolutionIndicators();
  this.clearAttackReadyIndicators();
  this.battleStep = null;
  this.damageStepTiming = null;

  this.turn = this.turn === "player" ? "bot" : "player";
  await this.startTurn();
}

/**
 * Waits for a configurable delay between phases.
 * @returns {Promise<void>}
 */
export function waitForPhaseDelay() {
  if (this.isDisposed?.()) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, this.phaseDelayMs || 0));
}
