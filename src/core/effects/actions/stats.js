/**
 * Stats Actions - ATK/DEF temporary modifications
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

/**
 * Apply temporary ATK buff action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {boolean} Whether any cards were affected
 */
export function applyBuffAtkTemp(action, ctx, targets) {
  const targetCards = targets?.[action.targetRef] || [];
  const amount = action.amount ?? 0;
  targetCards.forEach((card) => {
    if (card.isFacedown) return;
    card.atk += amount;
    card.tempAtkBoost = (card.tempAtkBoost || 0) + amount;
  });
  return targetCards.length > 0 && amount !== 0;
}

/**
 * Apply temporary stat modification action (using factors)
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {boolean} Whether any cards were affected
 */
export function applyModifyStatsTemp(action, ctx, targets) {
  const targetCards = targets?.[action.targetRef] || [];
  const atkFactor = action.atkFactor ?? 1;
  const defFactor = action.defFactor ?? 1;

  targetCards.forEach((card) => {
    if (card.isFacedown) return;
    if (atkFactor !== 1) {
      const newAtk = Math.floor((card.atk || 0) * atkFactor);
      const deltaAtk = newAtk - card.atk;
      card.atk = newAtk;
      card.tempAtkBoost = (card.tempAtkBoost || 0) + deltaAtk;
    }
    if (defFactor !== 1) {
      const newDef = Math.floor((card.def || 0) * defFactor);
      const deltaDef = newDef - card.def;
      card.def = newDef;
      card.tempDefBoost = (card.tempDefBoost || 0) + deltaDef;
    }
  });
  return targetCards.length > 0 && (atkFactor !== 1 || defFactor !== 1);
}
