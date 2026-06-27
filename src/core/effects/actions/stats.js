/**
 * Stats Actions - ATK/DEF temporary modifications
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

/**
 * Queues renderer-only stat feedback for legacy EffectEngine stat actions.
 */
function queueStatFeedback(engine, card, kind, tone, ctx) {
  if (typeof engine?.game?.queueVisualFeedback !== "function") return;
  if (!card) return;

  engine.game.queueVisualFeedback({
    kind,
    sourceCard: ctx?.source || null,
    targetCard: card,
    targetOwnerId: card.owner || null,
    targetZone: "field",
    tone,
  });
}

/**
 * Apply temporary ATK buff action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {boolean} Whether any cards were affected
 */
export function applyBuffAtkTemp(action, ctx, targets) {
  let targetCards = targets?.[action.targetRef] || [];
  if (!Array.isArray(targetCards)) {
    targetCards = targetCards ? [targetCards] : [];
  }
  if (targetCards.length === 0) return true;
  const amount = action.amount ?? 0;
  let hadValidTarget = false;
  targetCards.forEach((card) => {
    if (card.isFacedown) return;
    if (card.cardKind !== "monster") return;
    hadValidTarget = true;
    card.atk = Math.max(0, card.atk + amount);
    card.tempAtkBoost = (card.tempAtkBoost || 0) + amount;
    if (amount !== 0) {
      queueStatFeedback(
        this,
        card,
        amount < 0 ? "debuff" : "buff",
        amount < 0 ? "red" : "green",
        ctx,
      );
    }
  });
  return hadValidTarget;
}

/**
 * Apply temporary stat modification action (using factors)
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {boolean} Whether any cards were affected
 */
export function applyModifyStatsTemp(action, ctx, targets) {
  let targetCards = targets?.[action.targetRef] || [];
  if (!Array.isArray(targetCards)) {
    targetCards = targetCards ? [targetCards] : [];
  }
  const atkFactor = action.atkFactor ?? 1;
  const defFactor = action.defFactor ?? 1;
  let hadValidTarget = false;

  targetCards.forEach((card) => {
    if (card.isFacedown) return;
    if (card.cardKind !== "monster") return;
    hadValidTarget = true;
    let deltaTotal = 0;
    if (atkFactor !== 1) {
      const newAtk = Math.floor((card.atk || 0) * atkFactor);
      const deltaAtk = newAtk - card.atk;
      card.atk = newAtk;
      card.tempAtkBoost = (card.tempAtkBoost || 0) + deltaAtk;
      deltaTotal += deltaAtk;
    }
    if (defFactor !== 1) {
      const newDef = Math.floor((card.def || 0) * defFactor);
      const deltaDef = newDef - card.def;
      card.def = newDef;
      card.tempDefBoost = (card.tempDefBoost || 0) + deltaDef;
      deltaTotal += deltaDef;
    }
    if (deltaTotal !== 0) {
      queueStatFeedback(
        this,
        card,
        deltaTotal < 0 ? "debuff" : "buff",
        deltaTotal < 0 ? "red" : "green",
        ctx,
      );
    }
  });
  return hadValidTarget;
}
