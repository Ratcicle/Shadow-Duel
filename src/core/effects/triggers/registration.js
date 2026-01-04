/**
 * Trigger Registration Module
 * Extracted from EffectEngine.js - once-per-turn/duel usage registration
 *
 * All functions assume `this` = EffectEngine instance
 */

/**
 * Register that a once-per-duel effect has been used
 * @param {Object} card - The card with the effect
 * @param {Object} player - The player using the effect
 * @param {Object} effect - The effect being used
 */
export function registerOncePerDuelUsage(card, player, effect) {
  if (!effect || !effect.oncePerDuel || !player) {
    return;
  }

  const key = effect.oncePerDuelName || effect.id || card?.name;
  player.oncePerDuelUsageByName =
    player.oncePerDuelUsageByName || Object.create(null);
  player.oncePerDuelUsageByName[key] = true;
}

/**
 * Register that a once-per-turn effect has been used
 * @param {Object} card - The card with the effect
 * @param {Object} player - The player using the effect
 * @param {Object} effect - The effect being used
 */
export function registerOncePerTurnUsage(card, player, effect) {
  if (!effect || !effect.oncePerTurn) {
    return;
  }
  if (!this.game || typeof this.game.markOncePerTurnUsed !== "function") {
    console.error(
      "[EffectEngine] registerOncePerTurnUsage: Game instance or markOncePerTurnUsed not available"
    );
    return;
  }
  this.game.markOncePerTurnUsed(card, player, effect);
}
