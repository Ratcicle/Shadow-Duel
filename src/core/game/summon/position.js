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
  if (card.battlePositionLocked) return false;
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
  if (card.battlePositionLocked) return false;
  const isTurnPlayer = card.owner === this.turn;
  const isMainPhase = this.phase === "main1" || this.phase === "main2";
  if (!isTurnPlayer || !isMainPhase) return false;
  if (card.isFacedown) return false;
  if (card.positionChangedThisTurn) return false;
  if (card.summonedTurn && this.turnCounter <= card.summonedTurn) return false;
  if (card.hasAttacked) return false;

  return true;
}

export async function changeMonsterPosition(card, newPosition) {
  const actor =
    card?.owner === "player"
      ? this.player
      : card?.owner === "bot"
        ? this.bot
        : null;
  const guard = this.guardActionStart?.({
    actor,
    kind: "change_position",
    phaseReq: ["main1", "main2"],
  });
  if (guard?.ok === false) return guard;
  if (newPosition !== "attack" && newPosition !== "defense") {
    return { ok: false, reason: "invalid_position" };
  }
  if (!this.canChangePosition(card)) {
    return { ok: false, reason: "position_change_not_allowed" };
  }
  if (!card || card.position === newPosition) {
    return { ok: false, reason: "position_unchanged" };
  }

  const previousPosition = card.position;

  const wasFlipped = card.isFacedown;
  card.position = newPosition;
  card.isFacedown = false;
  if (wasFlipped) {
    card.revealedTurn = this.turnCounter;
  }
  card.positionChangedThisTurn = true;
  // Defense Position is checked by combat availability. Keep explicit attack
  // restrictions independent so later effect-based position changes are legal.
  this.effectEngine?.clearTargetingCache?.();
  this.ui.log(
    `${card.name} changes to ${
      newPosition === "attack" ? "Attack" : "Defense"
    } Position.`,
  );

  const eventResult = await this.emit("position_change", {
    card,
    player: actor,
    fromPosition: previousPosition,
    toPosition: newPosition,
    wasFlipped,
  });

  this.updateBoard();
  return {
    ok: eventResult?.ok !== false,
    success: eventResult?.ok !== false,
    needsSelection: eventResult?.needsSelection === true,
    card,
    eventResult,
  };
}
