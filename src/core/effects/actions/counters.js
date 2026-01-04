/**
 * Counter Actions - add/remove counters
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

/**
 * Apply add counter action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {boolean} Whether counters were added
 */
export function applyAddCounter(action, ctx, targets) {
  const counterType = action.counterType || "default";
  let amount = action.amount || 1;
  const targetRef = action.targetRef || "self";

  // If damagePerCounter is specified, calculate amount based on damage
  if (action.damagePerCounter && ctx.damageAmount) {
    // Add 1 counter per instance of damage that meets the threshold
    amount = ctx.damageAmount >= action.damagePerCounter ? 1 : 0;
    if (amount <= 0) return false;
  }

  let targetCards = [];
  if (targetRef === "self") {
    targetCards = [ctx.source];
  } else if (targets[targetRef]) {
    targetCards = targets[targetRef];
  }

  if (!Array.isArray(targetCards)) {
    targetCards = [targetCards];
  }

  let added = false;
  for (const card of targetCards) {
    if (card && typeof card.addCounter === "function") {
      card.addCounter(counterType, amount);
      console.log(`Added ${amount} ${counterType} counter(s) to ${card.name}`);
      added = true;
    }
  }

  if (added && this.game && typeof this.game.updateBoard === "function") {
    this.game.updateBoard();
  }

  if (added && this.ui?.log) {
    this.ui.log(
      `Added ${amount} ${counterType} counter(s) to ${
        targetCards[0]?.name || ctx.source?.name || "card"
      }.`
    );
  }

  return added;
}
