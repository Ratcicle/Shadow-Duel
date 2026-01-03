/**
 * Event Bus for Game
 * Handles: on, emit
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
