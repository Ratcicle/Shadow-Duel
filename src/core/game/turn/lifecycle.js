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

/**
 * Starts a new turn for the active player.
 * Handles draw phase, standby phase, and transitions to main1.
 */
export async function startTurn() {
  this.turnCounter += 1;
  this.resetOncePerTurnUsage("start_turn");

  // Clean up expired turn-based buffs at the start of the turn
  this.cleanupExpiredBuffs();

  this.phase = "draw";

  const activePlayer = this.turn === "player" ? this.player : this.bot;
  const opponent = activePlayer === this.player ? this.bot : this.player;
  activePlayer.field.forEach((card) => {
    card.hasAttacked = false;
    card.attacksUsedThisTurn = 0;
    card.positionChangedThisTurn = false;
    card.canMakeSecondAttackThisTurn = false;
    card.secondAttackUsedThisTurn = false;
    card.battleIndestructibleOncePerTurnUsed = false;

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

  this.updateBoard();

  this.drawCards(activePlayer, 1);
  this.updateBoard();
  await this.waitForPhaseDelay();

  this.phase = "standby";

  // Process delayed actions in standby phase BEFORE emitting the event
  this.processDelayedActions("standby", activePlayer.id || this.turn);

  this.updateBoard();
  await this.emit("standby_phase", { player: activePlayer, opponent });
  await this.waitForPhaseDelay();

  this.phase = "main1";
  this.updateBoard();
  if (
    isAI(this.bot) &&
    this.turn === "bot" &&
    !this.gameOver &&
    typeof this.bot?.makeMove === "function"
  ) {
    this.bot.makeMove(this);
  }
}

/**
 * Ends the current turn and starts the opponent's turn.
 */
export function endTurn() {
  const actor = this.turn === "player" ? this.player : this.bot;
  const guard = this.guardActionStart(
    { actor, kind: "phase_change" },
    actor === this.player
  );
  if (!guard.ok) return guard;
  this.cleanupTempBoosts(this.player);
  this.cleanupTempBoosts(this.bot);

  // Clear all attack indicators at end of turn
  this.clearAttackResolutionIndicators();
  this.clearAttackReadyIndicators();

  this.turn = this.turn === "player" ? "bot" : "player";
  this.startTurn();
}

/**
 * Waits for a configurable delay between phases.
 * @returns {Promise<void>}
 */
export function waitForPhaseDelay() {
  return new Promise((resolve) => setTimeout(resolve, this.phaseDelayMs || 0));
}
