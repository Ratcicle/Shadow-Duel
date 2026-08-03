import assert from "node:assert/strict";
import test from "node:test";
import { DUEL_EVENT_NAMES } from "../../src/core/contracts/effects.js";
import {
  COLLECTED_TRIGGER_EVENT_NAMES,
  INFORMATIONAL_EVENT_NAMES,
  RESOLVABLE_EVENT_NAMES,
} from "../../src/core/contracts/events.js";
import type {
  AfterSummonEventPayload,
  AttackDeclaredEventPayload,
  DuelEventMap,
  EmitOptions,
  EventBusHost,
  EventListener,
  EventPayloadBase,
  EventPlayer,
  EventResolutionOutcome,
  EventResolverHost,
  EventTriggerEntry,
  InformationalEventMap,
  InformationalEventName,
  ResolvableEventName,
  RuntimeEventName,
} from "../../src/core/contracts/events.js";
import {
  emit,
  emitEffectActivated,
  notify,
  on,
} from "../../src/core/game/events/eventBus.js";
import {
  resolveEvent,
  resolveEventEntries,
} from "../../src/core/game/events/eventResolver.js";

interface TestBusHost extends EventBusHost {
  trace: string[];
  disposed: boolean;
  resolutionResult: EventResolutionOutcome;
}

function createPlayer(id: string): EventPlayer {
  return { id, name: id, field: [] };
}

function summonPayload(): AfterSummonEventPayload {
  return {
    card: { id: 1, name: "Summoned" },
    player: createPlayer("player"),
    method: "special",
    fromZone: "hand",
  };
}

function createBusHost(): TestBusHost {
  const host = {
    trace: [] as string[],
    disposed: false,
    resolutionResult: { ok: true, triggerCount: 0, results: [] },
    eventListeners: {},
    turnCounter: 7,
    phase: "main1",
    isDisposed() {
      return this.disposed;
    },
    recordReplayEvent() {
      this.trace.push("replay");
    },
    _arenaTracker: {
      recordEvent() {
        host.trace.push("arena");
      },
    },
    on<Name extends RuntimeEventName>(
      eventName: Name,
      handler: EventListener<Name>,
    ) {
      Reflect.apply(on, this, [eventName, handler]);
    },
    async resolveEvent<Name extends ResolvableEventName>(
      _eventName: Name,
      _payload: DuelEventMap[Name],
      _options?: EmitOptions,
    ) {
      this.trace.push("resolve");
      return this.resolutionResult;
    },
    async emit<Name extends ResolvableEventName>(
      eventName: Name,
      payload: DuelEventMap[Name],
      options?: EmitOptions,
    ) {
      return await Reflect.apply(emit, this, [eventName, payload, options]);
    },
    notify<Name extends InformationalEventName>(
      eventName: Name,
      payload: InformationalEventMap[Name],
    ) {
      Reflect.apply(notify, this, [eventName, payload]);
    },
  } satisfies TestBusHost;
  return host;
}

test("event name manifests keep the three runtime domains exact and frozen", () => {
  assert.equal(DUEL_EVENT_NAMES.length, 23);
  assert.equal(RESOLVABLE_EVENT_NAMES.length, 28);
  assert.equal(INFORMATIONAL_EVENT_NAMES.length, 35);
  assert.equal(COLLECTED_TRIGGER_EVENT_NAMES.length, 19);
  assert.equal(new Set(RESOLVABLE_EVENT_NAMES).size, 28);
  assert.equal(new Set(INFORMATIONAL_EVENT_NAMES).size, 35);
  assert.equal(new Set(COLLECTED_TRIGGER_EVENT_NAMES).size, 19);
  assert.equal(Object.isFrozen(RESOLVABLE_EVENT_NAMES), true);
  assert.equal(Object.isFrozen(INFORMATIONAL_EVENT_NAMES), true);
  assert.equal(Object.isFrozen(COLLECTED_TRIGGER_EVENT_NAMES), true);
  assert.equal(DUEL_EVENT_NAMES.includes("after_summon"), true);
  assert.equal(
    RESOLVABLE_EVENT_NAMES.includes("cards_added_to_hand"),
    true,
  );
  assert.equal(
    new Set<string>(DUEL_EVENT_NAMES).has("cards_added_to_hand"),
    false,
  );

  assert.equal(RESOLVABLE_EVENT_NAMES.includes("damage_step"), true);
  assert.equal(INFORMATIONAL_EVENT_NAMES.includes("decision_made"), true);
  assert.equal(COLLECTED_TRIGGER_EVENT_NAMES.includes("card_flipped"), true);
});

test("emit preserves replay, Arena, synchronous listener and resolver order", async () => {
  const host = createBusHost();
  const payload = summonPayload();
  host.on("after_summon", () => host.trace.push("listener"));

  const result = await host.emit("after_summon", payload, {
    collectTriggersOnly: true,
  });

  assert.strictEqual(result, host.resolutionResult);
  assert.deepEqual(host.trace, ["replay", "arena", "listener", "resolve"]);
});

test("emit preserves the legacy non-awaiting listener contract", async () => {
  const host = createBusHost();
  let releaseListener: () => void = () => {};
  const listenerGate = new Promise<void>((resolve) => {
    releaseListener = resolve;
  });
  host.on("after_summon", async () => {
    host.trace.push("listener-start");
    await listenerGate;
    host.trace.push("listener-end");
  });

  await host.emit("after_summon", summonPayload());
  assert.deepEqual(host.trace, [
    "replay",
    "arena",
    "listener-start",
    "resolve",
  ]);

  releaseListener();
  await listenerGate;
  await Promise.resolve();
  assert.equal(host.trace.at(-1), "listener-end");
});

test("emit isolates listener errors and keeps the same mutable payload", async () => {
  const host = createBusHost();
  const attackerOwner = createPlayer("player");
  const defenderOwner = createPlayer("bot");
  const redirected = {
    id: 3,
    name: "Redirected",
    cardKind: "monster",
  } as const;
  defenderOwner.field?.push(redirected);
  const payload: AttackDeclaredEventPayload = {
    attacker: { id: 1, name: "Attacker", cardKind: "monster" },
    attackerOwner,
    defender: null,
    defenderOwner,
    target: null,
    targetOwner: defenderOwner,
  };
  let resolvedPayload: DuelEventMap[keyof DuelEventMap] | null = null;
  host.resolveEvent = async (_eventName, received) => {
    resolvedPayload = received;
    host.trace.push("resolve");
    return { ok: true };
  };
  host.on("attack_declared", () => {
    throw new Error("listener failed");
  });
  host.on("attack_declared", (received) => {
    received.attackRedirect = {
      target: redirected,
      targetOwner: defenderOwner,
      reason: "test",
    };
    host.trace.push("second-listener");
  });
  const originalConsoleError = console.error;
  const observedErrors: unknown[][] = [];
  console.error = (...arguments_: unknown[]) => {
    observedErrors.push(arguments_);
  };
  try {
    await host.emit("attack_declared", payload);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(observedErrors.length, 1);
  assert.strictEqual(resolvedPayload, payload);
  assert.strictEqual(payload.attackRedirect?.target, redirected);
  assert.deepEqual(host.trace, [
    "replay",
    "arena",
    "second-listener",
    "resolve",
  ]);
});

test("disposed buses return null and notify never enters trigger resolution", async () => {
  const disposed = createBusHost();
  disposed.disposed = true;
  const result = await disposed.emit("after_summon", summonPayload());
  assert.equal(result, null);
  assert.deepEqual(disposed.trace, []);

  const active = createBusHost();
  let observedPosition = "";
  active.on("position_chosen", (payload) => {
    observedPosition = payload.position;
  });
  active.notify("position_chosen", {
    card: { name: "Chosen" },
    player: createPlayer("player"),
    position: "defense",
    context: "special_summon",
  });
  assert.equal(observedPosition, "defense");
  assert.deepEqual(active.trace, ["replay", "arena"]);
});

test("emitEffectActivated validates, normalizes and guards recursive events", async () => {
  const host = createBusHost();
  const missing = await Reflect.apply(emitEffectActivated, host, []);
  assert.deepEqual(missing, {
    ok: false,
    reason: "missing_activation_payload",
  });

  host.trace.length = 0;
  const card = { id: 1, name: "Source" };
  const player = createPlayer("player");
  const guarded = await Reflect.apply(emitEffectActivated, host, [
    {
      source: card,
      owner: player,
      sourceEvent: "effect_activated",
    },
  ]);
  assert.deepEqual(guarded, {
    ok: true,
    skipped: true,
    reason: "effect_activated_loop_guard",
  });
  assert.deepEqual(host.trace, ["replay", "arena"]);

  host.trace.length = 0;
  const emitted = await Reflect.apply(emitEffectActivated, host, [
    { source: card, owner: player },
    { atomicGroupId: "activation:1" },
  ]);
  assert.strictEqual(emitted, host.resolutionResult);
  assert.deepEqual(host.trace, ["replay", "arena", "resolve"]);
});

interface ResolverTestState {
  logEvents: string[];
  invariantScopes: string[];
  resolvedEntries: number;
}

function createResolverHost(): EventResolverHost & ResolverTestState {
  const state = {
    logEvents: [] as string[],
    invariantScopes: [] as string[],
    resolvedEntries: 0,
    eventListeners: {},
    eventResolutionDepth: 0,
    eventResolutionCounter: 0,
    player: createPlayer("player"),
    bot: createPlayer("bot"),
    turn: "player",
    on() {},
    async emit() {
      return { ok: true };
    },
    notify() {},
    async resolveEvent() {
      return { ok: true };
    },
    devLog(eventName: string) {
      this.logEvents.push(eventName);
    },
    assertStateInvariants(scope: string) {
      this.invariantScopes.push(scope);
    },
    async resolveEventEntries() {
      this.resolvedEntries += 1;
      return { ok: true, triggerCount: 0, results: [] };
    },
    queueTriggerOccurrence() {
      return { ok: true, deferred: true };
    },
    async checkAndOfferTraps() {
      return null;
    },
  } as EventResolverHost & ResolverTestState;
  return state;
}

test("resolveEvent collect-only keeps listeners upstream and returns collectors", async () => {
  const host = createResolverHost();
  const entries: EventTriggerEntry[] = [
    { summary: "first" },
    { summary: "second" },
  ];
  const occurrence = {
    eventName: "after_summon",
    entries: [] as EventTriggerEntry[],
    entriesProvided: false,
    orderRule: null,
    onComplete: null,
  };
  host.chainSystem = {
    createTriggerOccurrence() {
      return occurrence;
    },
    resolveTriggerOccurrences() {
      return { ok: true };
    },
  };
  host.effectEngine = {
    collectEventTriggers() {
      return { entries, orderRule: "summoner -> opponent" };
    },
  };

  const result = await Reflect.apply(resolveEvent, host, [
    "after_summon",
    summonPayload(),
    { collectTriggersOnly: true, atomicGroupId: "atomic:1" },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.collectedOnly, true);
  assert.strictEqual(result.occurrence, occurrence);
  assert.strictEqual(result.entries, entries);
  assert.equal(result.triggerCount, 2);
  assert.equal(occurrence.entriesProvided, true);
  assert.strictEqual(occurrence.entries, entries);
  assert.equal(occurrence.orderRule, "summoner -> opponent");
  assert.equal(host.eventResolutionDepth, 0);
  assert.deepEqual(host.logEvents, [
    "EVENT_START",
    "TRIGGERS_COLLECTED",
    "EVENT_END",
  ]);
  assert.deepEqual(host.invariantScopes, ["event_after_summon"]);
  assert.equal(host.resolvedEntries, 0);
});

test("resolveEventEntries copies attack redirects back to the original payload", async () => {
  const host = createResolverHost();
  const attackerOwner = createPlayer("player");
  const defenderOwner = createPlayer("bot");
  const redirected = {
    id: 4,
    name: "Guard",
    cardKind: "monster",
  } as const;
  const payload: AttackDeclaredEventPayload = {
    attacker: { id: 1, name: "Attacker", cardKind: "monster" },
    attackerOwner,
    defender: null,
    defenderOwner,
    target: null,
    targetOwner: defenderOwner,
  };
  host.chainSystem = {
    resolveTriggerOccurrences() {
      return { ok: true, success: true, chainBuilt: false, results: [] };
    },
  };
  host.checkAndOfferTraps = async (
    _eventName: string,
    trapPayload: EventPayloadBase,
  ) => {
    trapPayload.attackRedirect = {
      target: redirected,
      targetOwner: defenderOwner,
    };
    trapPayload.redirectedTarget = redirected;
    trapPayload.redirectedTargetOwner = defenderOwner;
    return { ok: true, chainBuilt: false };
  };

  const result = await Reflect.apply(resolveEventEntries, host, [
    "attack_declared",
    payload,
    [],
  ]);

  assert.equal(result.ok, true);
  assert.strictEqual(payload.attackRedirect?.target, redirected);
  assert.strictEqual(payload.redirectedTarget, redirected);
  assert.strictEqual(payload.redirectedTargetOwner, defenderOwner);
});
