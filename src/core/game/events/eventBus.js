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
