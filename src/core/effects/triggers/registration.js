/**
 * Trigger Registration Module
 * Extracted from EffectEngine.js - once-per-turn/duel usage registration
 *
 * All functions assume `this` = EffectEngine instance
 */

export function getOncePerDuelKey(card, effect) {
  return effect?.oncePerDuelName || effect?.id || card?.name;
}

export function getOncePerDuelLimit(effect) {
  if (!effect?.oncePerDuel) return Infinity;
  const rawLimit =
    effect.oncePerDuelLimit ??
    effect.oncePerDuelMax ??
    (typeof effect.oncePerDuel === "number" ? effect.oncePerDuel : 1);
  const limit = Math.floor(Number(rawLimit));
  return Number.isFinite(limit) && limit > 0 ? limit : 1;
}

export function getOncePerDuelUsage(player, key) {
  if (!player || !key) return 0;
  const rawUsage = player.oncePerDuelUsageByName?.[key];
  if (rawUsage === true) return 1;
  if (rawUsage === false || rawUsage === undefined || rawUsage === null) {
    return 0;
  }
  const usage = Math.floor(Number(rawUsage));
  return Number.isFinite(usage) && usage > 0 ? usage : 0;
}

export function canUseOncePerDuelEffect(card, player, effect) {
  if (!effect || !effect.oncePerDuel || !player) {
    return { ok: true };
  }

  const key = getOncePerDuelKey(card, effect);
  const limit = getOncePerDuelLimit(effect);
  const used = getOncePerDuelUsage(player, key);
  if (used >= limit) {
    return {
      ok: false,
      reason:
        limit > 1
          ? `Once per duel effect limit reached (${limit}).`
          : "Once per duel effect already used.",
    };
  }
  return { ok: true, used, limit, remaining: limit - used };
}

export function markOncePerDuelEffectUsed(card, player, effect) {
  if (!effect || !effect.oncePerDuel || !player) {
    return 0;
  }

  const key = getOncePerDuelKey(card, effect);
  if (!key) return 0;
  player.oncePerDuelUsageByName =
    player.oncePerDuelUsageByName || Object.create(null);
  const nextUsage = getOncePerDuelUsage(player, key) + 1;
  player.oncePerDuelUsageByName[key] = nextUsage;
  return nextUsage;
}

/**
 * Register that a once-per-duel effect has been used
 * @param {Object} card - The card with the effect
 * @param {Object} player - The player using the effect
 * @param {Object} effect - The effect being used
 */
export function registerOncePerDuelUsage(card, player, effect) {
  markOncePerDuelEffectUsed(card, player, effect);
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
