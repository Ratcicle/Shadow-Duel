/**
 * Event Bus for Game
 * Handles: on, emit, notify
 */

/**
 * Register an event listener
 * @this {import('../../Game.js').default}
 */
export function on(eventName, handler) {
  if (!this.eventListeners[eventName]) {
    this.eventListeners[eventName] = [];
  }
  this.eventListeners[eventName].push(handler);
}

/**
 * Emit an event and resolve triggers
 * @this {import('../../Game.js').default}
 */
export async function emit(eventName, payload) {
  const list = this.eventListeners[eventName];
  if (list) {
    for (const fn of list) {
      try {
        fn(payload);
      } catch (err) {
        console.error("Error in event handler for " + eventName + ":", err);
      }
    }
  }
  return await this.resolveEvent(eventName, payload);
}

/**
 * Notify listeners without resolving triggers or incrementing eventResolutionDepth.
 * Use this for informational events that should not block game actions.
 * @this {import('../../Game.js').default}
 */
export function notify(eventName, payload) {
  const list = this.eventListeners[eventName];
  if (list) {
    for (const fn of list) {
      try {
        fn(payload);
      } catch (err) {
        console.error("Error in notify handler for " + eventName + ":", err);
      }
    }
  }
}

/**
 * Emits a successful card/effect activation as a resolvable event.
 * Triggers caused by effect_activated do not emit another effect_activated.
 * @this {import('../../Game.js').default}
 */
export async function emitEffectActivated(payload = {}) {
  const card = payload.card || payload.source || null;
  const player = payload.player || payload.owner || null;
  if (!card || !player) {
    return { ok: false, reason: "missing_activation_payload" };
  }

  const effect = payload.effect || null;
  const sourceEvent =
    payload.sourceEvent ||
    payload.triggeredByEvent ||
    payload.activationContext?.triggeredByEvent ||
    effect?.event ||
    null;

  if (sourceEvent === "effect_activated") {
    return { ok: true, skipped: true, reason: "effect_activated_loop_guard" };
  }

  return await this.emit("effect_activated", {
    ...payload,
    card,
    player,
    effect,
    sourceEvent,
    activationZone:
      payload.activationZone ||
      payload.activationContext?.activationZone ||
      null,
    effectType: payload.effectType || effect?.timing || "effect",
  });
}
