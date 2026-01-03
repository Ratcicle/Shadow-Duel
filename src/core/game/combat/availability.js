/**
 * Combat availability checks - attack validation and usage tracking.
 * Extracted from Game.js as part of B.5 modularization.
 */

/**
 * Check if a monster can attack and how many attacks it has available.
 * @param {Object} attacker - The monster attempting to attack
 * @returns {Object} Availability result with ok, reason, maxAttacks, etc.
 */
export function getAttackAvailability(attacker) {
  if (!attacker) {
    return { ok: false, reason: "No attacker selected." };
  }
  if (attacker.cannotAttackThisTurn) {
    return {
      ok: false,
      reason: `${attacker.name} cannot attack this turn.`,
    };
  }
  if (attacker.position === "defense") {
    return {
      ok: false,
      reason: "Defense position monsters cannot attack!",
    };
  }

  const extraAttacks = attacker.extraAttacks || 0;
  const maxAttacks = 1 + extraAttacks;
  const attacksUsed = attacker.attacksUsedThisTurn || 0;
  const canUseSecondAttack =
    attacker.canMakeSecondAttackThisTurn && !attacker.secondAttackUsedThisTurn;

  // Check for multi-attack ability (attack all opponent monsters)
  if (attacker.canAttackAllOpponentMonstersThisTurn) {
    const opponent = attacker.owner === "player" ? this.bot : this.player;
    const opponentMonsters = (opponent?.field || []).filter(
      (m) => m && !m.isFacedown
    );
    const opponentMonsterCount = opponentMonsters.length;

    // Filter out already attacked monsters
    const attackedMonsters = attacker.attackedMonstersThisTurn || new Set();
    const unattackedMonsters = opponentMonsters.filter((m) => {
      const cardId = m.instanceId || m.id || m.name;
      return !attackedMonsters.has(cardId);
    });

    // Can still attack if there are unattacked monsters
    if (unattackedMonsters.length > 0) {
      return {
        ok: true,
        maxAttacks: opponentMonsterCount,
        attacksUsed,
        isMultiAttack: true,
        remainingTargets: unattackedMonsters.length,
      };
    }

    // All monsters attacked - no more attacks in multi-attack mode
    return {
      ok: false,
      reason: `${attacker.name} has attacked all opponent monsters this turn.`,
    };
  }

  if (attacksUsed >= maxAttacks && !canUseSecondAttack) {
    return {
      ok: false,
      reason: `${attacker.name} has already attacked the maximum number of times this turn.`,
    };
  }

  return { ok: true, maxAttacks, attacksUsed };
}

/**
 * Mark an attack as used, updating attack counters and flags.
 * @param {Object} attacker - The attacking monster
 * @param {Object|null} target - The target monster (null for direct attack)
 */
export function markAttackUsed(attacker, target = null) {
  if (!attacker) return;
  const extraAttacks = attacker.extraAttacks || 0;
  const maxAttacks = 1 + extraAttacks;
  attacker.attacksUsedThisTurn = (attacker.attacksUsedThisTurn || 0) + 1;

  // Track attacked monsters for multi-attack effects
  if (attacker.canAttackAllOpponentMonstersThisTurn && target) {
    attacker.attackedMonstersThisTurn =
      attacker.attackedMonstersThisTurn || new Set();
    // Use unique identifier for the target (id or reference)
    const targetId = target.instanceId || target.id || target.name;
    attacker.attackedMonstersThisTurn.add(targetId);
  }

  if (
    attacker.attacksUsedThisTurn > maxAttacks &&
    attacker.canMakeSecondAttackThisTurn &&
    !attacker.secondAttackUsedThisTurn
  ) {
    attacker.secondAttackUsedThisTurn = true;
  }

  // For multi-attack mode, don't set hasAttacked until all opponent monsters are attacked
  if (attacker.canAttackAllOpponentMonstersThisTurn) {
    // In multi-attack mode, check if there are still unattacked monsters
    const opponent = attacker.owner === "player" ? this.bot : this.player;
    const opponentMonsters = (opponent?.field || []).filter(
      (m) => m && !m.isFacedown
    );
    const attackedMonsters = attacker.attackedMonstersThisTurn || new Set();
    const unattackedCount = opponentMonsters.filter((m) => {
      const cardId = m.instanceId || m.id || m.name;
      return !attackedMonsters.has(cardId);
    }).length;

    // Only mark as hasAttacked when all monsters have been attacked
    attacker.hasAttacked = unattackedCount === 0;
  } else if (attacker.attacksUsedThisTurn >= maxAttacks) {
    attacker.hasAttacked = true;
  } else {
    attacker.hasAttacked = false;
  }
}

/**
 * Register that an attack was negated (e.g., by a trap).
 * @param {Object} attacker - The monster whose attack was negated
 */
export function registerAttackNegated(attacker) {
  this.lastAttackNegated = true;
  if (attacker?.name) {
    this.ui.log(`The attack of ${attacker.name} was negated!`);
  } else {
    this.ui.log("The attack was negated!");
  }
}

/**
 * Check if a card can be destroyed by battle.
 * @param {Object} card - The card to check
 * @returns {boolean} True if the card can be destroyed by battle
 */
export function canDestroyByBattle(card) {
  if (!card) return false;
  if (card.battleIndestructible) return false;
  if (card.tempBattleIndestructible) return false;
  if (
    card.battleIndestructibleOncePerTurn &&
    !card.battleIndestructibleOncePerTurnUsed
  ) {
    card.battleIndestructibleOncePerTurnUsed = true;
    return false;
  }
  return true;
}
