/**
 * oncePerTurn.js
 *
 * Once-per-turn usage tracking extracted from Game.js.
 * Manages cooldowns of effects flagged with `oncePerTurn: true`.
 *
 * State owned by Game (kept on `this`):
 *  - oncePerTurnUsage: { player: Map, bot: Map, card: WeakMap }
 *  - oncePerTurnTurnCounter: number
 *
 * Methods:
 *  - resetOncePerTurnUsage
 *  - ensureOncePerTurnUsageFresh
 *  - getOncePerTurnLockKey
 *  - getOncePerTurnStore
 *  - canUseOncePerTurn
 *  - markOncePerTurnUsed
 */

export function resetOncePerTurnUsage(reason = "reset") {
  this.oncePerTurnUsage = {
    player: new Map(),
    bot: new Map(),
    card: new WeakMap(),
  };
  this.oncePerTurnTurnCounter = this.turnCounter;
  this.devLog("OPT_RESET", { summary: reason, turn: this.turnCounter });
}

export function ensureOncePerTurnUsageFresh() {
  if (this.oncePerTurnTurnCounter !== this.turnCounter) {
    this.resetOncePerTurnUsage("turn_change");
  }
}

export function getOncePerTurnLockKey(card, effect, options = {}) {
  const explicit = options.lockKey || options.key || null;
  if (explicit) {
    return explicit.startsWith("once_per_turn:")
      ? explicit
      : `once_per_turn:${explicit}`;
  }

  const base =
    effect?.oncePerTurnName ||
    effect?.id ||
    options.actionId ||
    card?.name ||
    "effect";
  return `once_per_turn:${base}`;
}

export function getOncePerTurnStore(card, player, effect, options = {}) {
  const useCardScope =
    effect?.oncePerTurnScope === "card" ||
    effect?.oncePerTurnPerCard === true;
  if (useCardScope && card) {
    let store = this.oncePerTurnUsage.card.get(card);
    if (!store) {
      store = new Map();
      this.oncePerTurnUsage.card.set(card, store);
    }
    return store;
  }

  const playerId = player?.id || "player";
  if (!this.oncePerTurnUsage[playerId]) {
    this.oncePerTurnUsage[playerId] = new Map();
  }
  return this.oncePerTurnUsage[playerId];
}

export function canUseOncePerTurn(card, player, effect, options = {}) {
  if (!effect || !effect.oncePerTurn) {
    return { ok: true };
  }
  this.ensureOncePerTurnUsageFresh();
  const lockKey = this.getOncePerTurnLockKey(card, effect, options);
  const store = this.getOncePerTurnStore(card, player, effect, options);
  const currentTurn = this.turnCounter;
  const lastTurn = store.get(lockKey);
  if (lastTurn === currentTurn) {
    return {
      ok: false,
      reason: "Efeito 1/turn ja usado neste turno.",
      lockKey,
    };
  }
  return { ok: true, lockKey };
}

export function markOncePerTurnUsed(card, player, effect, options = {}) {
  if (!effect || !effect.oncePerTurn) {
    return;
  }
  this.ensureOncePerTurnUsageFresh();
  const lockKey = this.getOncePerTurnLockKey(card, effect, options);
  const store = this.getOncePerTurnStore(card, player, effect, options);
  store.set(lockKey, this.turnCounter);
  this.devLog("OPT_MARK_USED", {
    summary: lockKey,
    card: card?.name,
    player: player?.id,
    turn: this.turnCounter,
  });
}
