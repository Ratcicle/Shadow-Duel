/**
 * registry.js
 *
 * ActionHandlerRegistry class and proxyEngineMethod helper.
 * Moved from ActionHandlers.js with identical API.
 */

export class ActionHandlerRegistry {
  constructor() {
    this.handlers = new Map();
  }

  /**
   * Register a handler for an action type
   * @param {string} actionType - The action type identifier
   * @param {Function} handler - Handler function (action, ctx, targets, engine) => Promise<boolean>
   */
  register(actionType, handler) {
    this.handlers.set(actionType, handler);
  }

  /**
   * Get a handler for an action type
   * @param {string} actionType
   * @returns {Function|null}
   */
  get(actionType) {
    return this.handlers.get(actionType) || null;
  }

  /**
   * Check if a handler exists for an action type
   * @param {string} actionType
   * @returns {boolean}
   */
  has(actionType) {
    return this.handlers.has(actionType);
  }

  /**
   * List registered action type identifiers.
   * @returns {string[]}
   */
  listTypes() {
    return Array.from(this.handlers.keys());
  }
}

/**
 * Helper: create a simple wrapper that proxies to EffectEngine methods.
 * Keeps the behavior identical to legacy switch/case while moving action types
 * into the registry.
 */
export function proxyEngineMethod(methodName) {
  return async (action, ctx, targets, engine) => {
    if (!engine || typeof engine[methodName] !== "function") {
      return false;
    }

    // Many legacy methods are sync, but awaiting is safe and keeps a uniform signature.
    return await engine[methodName](action, ctx, targets);
  };
}
