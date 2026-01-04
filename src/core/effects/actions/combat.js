/**
 * Combat Actions - attack negation, forbid attack, direct attack
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

/**
 * Apply negate attack action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @returns {boolean} Whether attack was negated
 */
export function applyNegateAttack(action, ctx) {
  if (!this.game || !ctx?.attacker) return false;
  if (typeof this.game.registerAttackNegated === "function") {
    this.game.registerAttackNegated(ctx.attacker);
    return true;
  }
  return false;
}

/**
 * Apply forbid attack this turn action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {boolean} Whether any cards were affected
 */
export function applyForbidAttackThisTurn(action, ctx, targets) {
  // Se targetRef está definido, usa os alvos selecionados
  // Caso contrário, aplica à carta fonte (self)
  let targetCards = [];
  if (action.targetRef && targets?.[action.targetRef]) {
    targetCards = targets[action.targetRef];
  } else if (ctx && ctx.source) {
    targetCards = [ctx.source];
  }

  targetCards.forEach((card) => {
    card.cannotAttackThisTurn = true;
  });
  return targetCards.length > 0;
}

/**
 * Apply forbid attack next turn action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {boolean} Whether any cards were affected
 */
export function applyForbidAttackNextTurn(action, ctx, targets) {
  let targetCards = [];
  if (action.targetRef && targets?.[action.targetRef]) {
    targetCards = targets[action.targetRef];
  } else if (ctx && ctx.source) {
    targetCards = [ctx.source];
  }

  if (targetCards.length === 0) {
    return false;
  }

  const currentTurn = this.game?.turnCounter ?? 0;
  const extraTurns = Math.max(
    1,
    Math.floor(typeof action.turns === "number" ? action.turns : 1)
  );
  const untilTurn = currentTurn + extraTurns;

  targetCards.forEach((card) => {
    card.cannotAttackThisTurn = true;
    if (!card.cannotAttackUntilTurn || card.cannotAttackUntilTurn < untilTurn) {
      card.cannotAttackUntilTurn = untilTurn;
    }
  });

  return true;
}

/**
 * Apply allow direct attack this turn action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {boolean} Whether any cards were affected
 */
export function applyAllowDirectAttackThisTurn(action, ctx, targets) {
  const targetCards = targets[action.targetRef] || [ctx.source].filter(Boolean);
  if (!targetCards.length) return false;

  targetCards.forEach((card) => {
    card.canAttackDirectlyThisTurn = true;
  });

  return true;
}
