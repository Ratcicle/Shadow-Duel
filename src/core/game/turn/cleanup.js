/**
 * cleanup.js
 *
 * Turn cleanup and turn-based buff methods extracted from Game.js.
 * Handles application and cleanup of temporary effects.
 *
 * Methods:
 * - applyTurnBasedBuff
 * - cleanupExpiredBuffs
 * - cleanupExpiredDeclaredValues
 * - cleanupExpiredEffectMarkers
 * - cleanupTempBoosts
 */

import { restoreTemporaryStatuses } from "../../Card.js";

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
    id || this.createDeterministicId?.(`buff_${card.id}`) ||
    `buff_${card.id}_${card.turnBasedBuffs.length + 1}`;
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
    if (Array.isArray(card.turnBasedBuffs) && card.turnBasedBuffs.length > 0) {
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

    if (Array.isArray(card.protectionEffects)) {
      card.protectionEffects = card.protectionEffects.filter(
        (entry) =>
          entry &&
          (!Number.isFinite(entry.expiresOnTurn) ||
            this.turnCounter <= entry.expiresOnTurn),
      );
    }
  }
}

function getActiveCards(player) {
  if (!player) return [];
  return [
    ...(player.field || []),
    ...(player.spellTrap || []),
    player.fieldSpell,
  ].filter(Boolean);
}

function getAllPlayerCards(player) {
  if (!player) return [];
  return [
    ...(player.deck || []),
    ...(player.hand || []),
    ...(player.field || []),
    ...(player.spellTrap || []),
    ...(player.graveyard || []),
    ...(player.banished || []),
    ...(player.extraDeck || []),
    player.fieldSpell,
  ].filter(Boolean);
}

export function cleanupExpiredDeclaredValues() {
  const activeCards = [
    ...getActiveCards(this.player),
    ...getActiveCards(this.bot),
  ];

  for (const card of activeCards) {
    if (!card?.declaredValues || typeof card.declaredValues !== "object") {
      continue;
    }

    for (const [stateKey, declaration] of Object.entries(card.declaredValues)) {
      if (
        declaration &&
        Number.isFinite(declaration.expiresOnTurn) &&
        this.turnCounter > declaration.expiresOnTurn
      ) {
        delete card.declaredValues[stateKey];
        this.devLog?.("DECLARED_VALUE_EXPIRED", {
          summary: `${card.name} declaration expired (${stateKey})`,
          card: card.name,
          stateKey,
        });
      }
    }

    if (Object.keys(card.declaredValues).length === 0) {
      delete card.declaredValues;
    }
  }
}

export function cleanupExpiredEffectMarkers() {
  const seen = new Set();
  const allCards = [
    ...getAllPlayerCards(this.player),
    ...getAllPlayerCards(this.bot),
  ];

  for (const card of allCards) {
    const key = card?.instanceId ?? card?._instanceId ?? card;
    if (!card || seen.has(key)) continue;
    seen.add(key);

    if (!card.effectMarkers || typeof card.effectMarkers !== "object") {
      continue;
    }

    for (const [markerKey, marker] of Object.entries(card.effectMarkers)) {
      if (
        marker &&
        Number.isFinite(marker.expiresOnTurn) &&
        this.turnCounter > marker.expiresOnTurn
      ) {
        delete card.effectMarkers[markerKey];
        this.devLog?.("EFFECT_MARKER_EXPIRED", {
          summary: `${card.name} effect marker expired (${markerKey})`,
          card: card.name,
          markerKey,
        });
      }
    }

    if (Object.keys(card.effectMarkers).length === 0) {
      delete card.effectMarkers;
    }
  }
}

export function cleanupExpiredTemporaryBattlePairEffects() {
  if (!Array.isArray(this.temporaryBattlePairEffects)) {
    this.temporaryBattlePairEffects = [];
    return;
  }

  this.temporaryBattlePairEffects = this.temporaryBattlePairEffects.filter(
    (entry) =>
      !entry ||
      !Number.isFinite(entry.expiresOnTurn) ||
      this.turnCounter <= entry.expiresOnTurn,
  );
}

export function cleanupExpiredTemporaryEventEffects() {
  if (!Array.isArray(this.temporaryEventEffects)) {
    this.temporaryEventEffects = [];
    return;
  }

  this.temporaryEventEffects = this.temporaryEventEffects.filter(
    (entry) =>
      entry &&
      (!Number.isFinite(entry.expiresOnTurn) ||
        this.turnCounter <= entry.expiresOnTurn) &&
      (!Number.isFinite(entry.usesRemaining) || entry.usesRemaining > 0),
  );
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
    delete card.temporarySuppressedDynamicBuffStatsByKey;

    // Restore stats if they were set to zero
    if (card.originalAtk != null) {
      card.atk = card.originalAtk;
      card.originalAtk = null;
    }
    if (card.originalDef != null) {
      card.def = card.originalDef;
      card.originalDef = null;
    }
    if (card.originalLevel != null) {
      card.level = card.originalLevel;
      card.originalLevel = null;
    }

    // Remove temporary effect negation; field-presence negation is cleared on move.
    if (card.effectsNegated && card.effectsNegatedDuration !== "while_faceup") {
      card.effectsNegated = false;
      card.effectsNegatedDuration = null;
    }

    card.tempBattleIndestructible = false;
    card.battleDamageHealsControllerThisTurn = false;
    card.canAttackDirectlyThisTurn = false;
    delete card.attackLimitThisTurn;
    delete card.attackLimitDuration;
    card.extraAttackTargetRestriction =
      card.baseExtraAttackTargetRestriction || null;
    delete card.passiveExtraAttackTargetRestriction;

    // Reset multi-attack flags
    delete card.canAttackAllOpponentMonstersThisTurn;
    delete card.attackedMonstersThisTurn;

    restoreTemporaryStatuses(card);
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
