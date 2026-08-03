/**
 * Event Bus for Game
 * Handles: on, emit, notify
 */

import type {
  ActivationEventInput,
  ActivationEventPayload,
  DuelEventMap,
  EmitOptions,
  EventBusHost,
  EventListener,
  EventListenerRegistry,
  EventResolutionResult,
  InformationalEventMap,
  InformationalEventName,
  ResolvableEventName,
  RuntimeEventMap,
  RuntimeEventName,
} from "../../contracts/events.js";

/** The listener registry is heterogeneous; correlation stays at this edge. */
function getListeners<Payload>(
  registry: EventListenerRegistry,
  eventName: RuntimeEventName,
): ((payload: Payload) => void)[] | null {
  const value: unknown = Reflect.get(registry, eventName);
  return Array.isArray(value)
    ? (value as ((payload: Payload) => void)[])
    : null;
}

/** Register an event listener. */
export function on<Name extends RuntimeEventName>(
  this: EventBusHost,
  eventName: Name,
  handler: EventListener<Name>,
): void {
  if (this.isDisposed?.()) return;
  let listeners = getListeners<RuntimeEventMap[Name]>(
    this.eventListeners,
    eventName,
  );
  if (!listeners) {
    listeners = [];
    Reflect.set(this.eventListeners, eventName, listeners);
  }
  listeners.push(handler);
}

/**
 * Emit an event and resolve triggers. When collectTriggersOnly is true,
 * listeners still run immediately, but triggers are returned to the caller.
 */
export async function emit<Name extends ResolvableEventName>(
  this: EventBusHost,
  eventName: Name,
  payload: DuelEventMap[Name],
  options: EmitOptions = {},
): Promise<EventResolutionResult> {
  if (this.isDisposed?.()) return null;
  this.recordReplayEvent?.(eventName, payload);
  this._arenaTracker?.recordEvent?.(eventName, payload, {
    turn: this.turnCounter,
    phase: this.phase,
  });
  const listeners = getListeners<DuelEventMap[Name]>(
    this.eventListeners,
    eventName,
  );
  if (listeners) {
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (error) {
        console.error("Error in event handler for " + eventName + ":", error);
      }
    }
  }
  return await this.resolveEvent(eventName, payload, options);
}

/** Notify listeners without entering trigger resolution. */
export function notify<Name extends InformationalEventName>(
  this: EventBusHost,
  eventName: Name,
  payload: InformationalEventMap[Name],
): void {
  if (this.isDisposed?.()) return;
  this.recordReplayEvent?.(eventName, payload);
  this._arenaTracker?.recordEvent?.(eventName, payload, {
    turn: this.turnCounter,
    phase: this.phase,
  });
  const listeners = getListeners<InformationalEventMap[Name]>(
    this.eventListeners,
    eventName,
  );
  if (listeners) {
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (error) {
        console.error("Error in notify handler for " + eventName + ":", error);
      }
    }
  }
}

/**
 * Emit a successful card/effect activation as a resolvable event. Triggers
 * caused by effect_activated do not emit another effect_activated.
 */
export async function emitEffectActivated(
  this: EventBusHost,
  payload: ActivationEventInput = {},
  options: EmitOptions = {},
): Promise<EventResolutionResult> {
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
  const normalized: ActivationEventPayload = {
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
  };

  if (sourceEvent === "effect_activated") {
    this.notify?.("effect_activated", normalized);
    return { ok: true, skipped: true, reason: "effect_activated_loop_guard" };
  }

  return await this.emit("effect_activated", normalized, options);
}
