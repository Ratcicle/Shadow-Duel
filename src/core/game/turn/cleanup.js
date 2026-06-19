/**
 * cleanup.js
 *
 * Turn cleanup and turn-based buff methods extracted from Game.js.
 * Handles application and cleanup of temporary effects.
 *
 * Methods:
 * - applyTurnBasedBuff
 * - cleanupExpiredBuffs
 * - cleanupTempBoosts
 */

/**
 * Applies a turn-based buff (atk/def) to a card with explicit expiration turn.
 * Multiple buffs can stack on the same card.
 */
export function applyTurnBasedBuff(card, stat, value, expiresOnTurn, id = null) {
  if (
    !card ||
    !stat ||
    !Number.isFinite(value) ||
    !Number.isFinite(expiresOnTurn)
  ) {
    return false;
  }

  if (!Array.isArray(card.turnBasedBuffs)) {
    card.turnBasedBuffs = [];
  }

  const buffId =
    id || `buff_${card.id}_${Math.random().toString(36).substr(2, 9)}`;
  const buffEntry = {
    id: buffId,
    stat,
    value,
    expiresOnTurn,
  };

  card.turnBasedBuffs.push(buffEntry);

  if (stat === "atk") {
    card.atk += value;
  } else if (stat === "def") {
    card.def += value;
  }

  this.devLog?.("TURN_BASED_BUFF_APPLIED", {
    summary: `${card.name} +${value} ${stat} (expires turn ${expiresOnTurn})`,
    card: card.name,
    stat,
    value,
    expiresOnTurn,
  });

  return true;
}

/**
 * Cleans up expired turn-based buffs.
 * Called at the start of startTurn() to remove buffs whose expiration turn has been reached.
 */
export function cleanupExpiredBuffs() {
  const allMonsters = [
    ...(this.player?.field || []),
    ...(this.bot?.field || []),
  ].filter(Boolean);

  for (const card of allMonsters) {
    if (
      !Array.isArray(card.turnBasedBuffs) ||
      card.turnBasedBuffs.length === 0
    ) {
      continue;
    }

    const expiredBuffs = card.turnBasedBuffs.filter(
      (buff) => this.turnCounter > buff.expiresOnTurn
    );

    for (const buff of expiredBuffs) {
      // Remove stat value
      if (buff.stat === "atk") {
        card.atk = Math.max(0, card.atk - buff.value);
      } else if (buff.stat === "def") {
        card.def = Math.max(0, card.def - buff.value);
      }

      this.devLog?.("TURN_BASED_BUFF_EXPIRED", {
        summary: `${card.name} buff expired (${buff.id})`,
        card: card.name,
        buffId: buff.id,
        stat: buff.stat,
      });
    }

    // Remove expired buffs from the list
    card.turnBasedBuffs = card.turnBasedBuffs.filter(
      (buff) => this.turnCounter <= buff.expiresOnTurn
    );
  }
}

/**
 * Cleans up temporary boosts for a player's monsters.
 * Called at end of turn to reset temporary stat modifications.
 * @param {Object} player - The player whose monsters to clean up
 */
export function cleanupTempBoosts(player) {
  player.field.forEach((card) => {
    if (card.tempAtkBoost) {
      card.atk -= card.tempAtkBoost;
      if (card.atk < 0) card.atk = 0;
      card.tempAtkBoost = 0;
    }
    if (card.tempDefBoost) {
      card.def -= card.tempDefBoost;
      if (card.def < 0) card.def = 0;
      card.tempDefBoost = 0;
    }

    // Restore stats if they were set to zero
    if (card.originalAtk != null) {
      card.atk = card.originalAtk;
      card.originalAtk = null;
    }
    if (card.originalDef != null) {
      card.def = card.originalDef;
      card.originalDef = null;
    }

    // Remove temporary effect negation; field-presence negation is cleared on move.
    if (card.effectsNegated && card.effectsNegatedDuration !== "while_faceup") {
      card.effectsNegated = false;
      card.effectsNegatedDuration = null;
    }

    card.tempBattleIndestructible = false;
    card.battleDamageHealsControllerThisTurn = false;
    card.canAttackDirectlyThisTurn = false;
    delete card.extraAttackTargetRestriction;

    // Reset multi-attack flags
    delete card.canAttackAllOpponentMonstersThisTurn;
    delete card.attackedMonstersThisTurn;

    if (card.tempStatuses && Object.keys(card.tempStatuses).length > 0) {
      for (const [status, previousValue] of Object.entries(card.tempStatuses)) {
        if (previousValue === undefined) {
          delete card[status];
        } else {
          card[status] = previousValue;
        }
      }
      card.tempStatuses = {};
    }
  });

  // Restore temporarily reduced levels for hand monsters
  player.hand.forEach((card) => {
    if (!card) return;
    if (card.originalLevel != null) {
      card.level = card.originalLevel;
      card.originalLevel = null;
    }
  });
}
