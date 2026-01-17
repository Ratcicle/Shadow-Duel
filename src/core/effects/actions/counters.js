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
  if (action.damagePerCounter && ctx.damageAmount !== undefined) {
    // Add 1 counter per damage instance that meets the threshold.
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
      }.`,
    );
  }

  return added;
}

/**
 * Apply remove counter action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {boolean} Whether counters were removed
 */
export function applyRemoveCounter(action, ctx, targets) {
  const counterType = action.counterType || "default";
  const amount = Number.isFinite(action.amount) ? action.amount : 1;
  const targetRef = action.targetRef || "self";
  const allowBelow = action.allowBelow === true;

  let targetCards = [];
  if (targetRef === "self") {
    targetCards = [ctx.source];
  } else if (targets[targetRef]) {
    targetCards = targets[targetRef];
  }

  if (!Array.isArray(targetCards)) {
    targetCards = [targetCards];
  }

  let removed = false;
  for (const card of targetCards) {
    if (!card || typeof card.getCounter !== "function") continue;
    const current = card.getCounter(counterType);
    if (current <= 0) continue;
    if (!allowBelow && current < amount) continue;
    const removeAmount = allowBelow ? Math.min(current, amount) : amount;
    if (typeof card.removeCounter === "function") {
      card.removeCounter(counterType, removeAmount);
      console.log(
        `Removed ${removeAmount} ${counterType} counter(s) from ${card.name}`,
      );
      removed = true;
    }
  }

  if (removed && this.game && typeof this.game.updateBoard === "function") {
    this.game.updateBoard();
  }

  if (removed && this.ui?.log) {
    this.ui.log(
      `Removed ${amount} ${counterType} counter(s) from ${
        targetCards[0]?.name || ctx.source?.name || "card"
      }.`,
    );
  }

  return removed;
}
