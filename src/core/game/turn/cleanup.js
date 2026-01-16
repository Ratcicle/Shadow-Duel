/**
 * cleanup.js
 *
 * Turn cleanup methods extracted from Game.js.
 * Handles cleanup of temporary effects at end of turn.
 *
 * Methods:
 * - cleanupExpiredBuffs
 * - cleanupTempBoosts
 */

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

    // Remove effect negation
    card.effectsNegated = false;

    card.tempBattleIndestructible = false;
    card.battleDamageHealsControllerThisTurn = false;
    card.canAttackDirectlyThisTurn = false;

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
}
