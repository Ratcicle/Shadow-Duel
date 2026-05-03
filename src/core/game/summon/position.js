/**
 * position.js
 *
 * Position-change methods extracted from Game.js.
 * Handles validation and execution of switching monsters between
 * Attack and Defense positions, plus the gating used by flip-summon
 * helpers in execution.js.
 *
 * Methods:
 *  - canFlipSummon
 *  - canChangePosition
 *  - changeMonsterPosition
 */

export function canFlipSummon(card) {
  if (!card) return false;
  const isTurnPlayer = card.owner === this.turn;
  const isMainPhase = this.phase === "main1" || this.phase === "main2";
  if (!isTurnPlayer || !isMainPhase) return false;
  if (!card.isFacedown) return false;
  if (card.positionChangedThisTurn) return false;

  const setTurn = card.setTurn ?? card.summonedTurn ?? 0;
  if (this.turnCounter <= setTurn) return false;

  const owner = card.owner === "player" ? this.player : this.bot;
  const limitCheck = this.canPlaceCardOnField?.(card, owner, {
    isFacedown: false,
    excludeCards: [card],
    silent: true,
  });
  if (limitCheck && limitCheck.ok === false) return false;

  return true;
}

export function canChangePosition(card) {
  if (!card) return false;
  const isTurnPlayer = card.owner === this.turn;
  const isMainPhase = this.phase === "main1" || this.phase === "main2";
  if (!isTurnPlayer || !isMainPhase) return false;
  if (card.isFacedown) return false;
  if (card.positionChangedThisTurn) return false;
  if (card.summonedTurn && this.turnCounter <= card.summonedTurn) return false;
  if (card.hasAttacked) return false;

  return true;
}

export function changeMonsterPosition(card, newPosition) {
  if (newPosition !== "attack" && newPosition !== "defense") return;
  if (!this.canChangePosition(card)) return;
  if (!card || card.position === newPosition) return;

  const previousPosition = card.position;

  const wasFlipped = card.isFacedown;
  card.position = newPosition;
  card.isFacedown = false;
  if (wasFlipped) {
    card.revealedTurn = this.turnCounter;
  }
  card.positionChangedThisTurn = true;
  card.cannotAttackThisTurn = newPosition === "defense";
  this.effectEngine?.clearTargetingCache?.();
  this.ui.log(
    `${card.name} changes to ${
      newPosition === "attack" ? "Attack" : "Defense"
    } Position.`,
  );

  this.emit("position_change", {
    card,
    player: card.owner === "player" ? this.player : this.bot,
    fromPosition: previousPosition,
    toPosition: newPosition,
    wasFlipped,
  });

  this.updateBoard();
}
