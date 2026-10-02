import type {
  AiCardInput,
  AiStateInput,
  AiStateShape,
  SimulatedCardState,
} from "../../contracts/aiState.js";
import {
  PLANNING_CARD_FIELDS,
  PLANNING_CARD_LINKS,
  PLANNING_LEGACY_CARD_FIELDS,
  PLANNING_ZONES,
} from "./stateFingerprint.js";
import type { EffectUsageMap } from "../../contracts/cards.js";
import type { ActionReplacementEffect } from "../../contracts/actions/shared.js";
type SearchCardInput = AiCardInput;

/** Copy public, already-resolved destruction registrations into the planner. */
export function projectRuntimeReplacementEffects(input: AiStateInput, state: AiStateShape): void {
  const registrations: unknown = Reflect.get(input, "temporaryReplacementEffects");
  if (!Array.isArray(registrations)) return;
  const read = (value: unknown, key: string): unknown =>
    value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
  state._simReplacementEffects = [];
  for (const entry of registrations as readonly unknown[]) {
    const raw = read(entry, "replacementEffect");
    const ownerId = read(entry, "ownerId");
    if (!raw || typeof raw !== "object" || read(raw, "type") !== "destruction" || typeof ownerId !== "string") continue;
    // The owned runtime producer supplies ActionReplacementEffect; retain only
    // its declarative fields, excluding targetCards and other live references.
    const behavior = raw as ActionReplacementEffect;
    const replacementEffect: ActionReplacementEffect = {
      type: "destruction",
      ...(behavior.reason ? { reason: behavior.reason } : {}),
      ...(behavior.targetOwner ? { targetOwner: behavior.targetOwner } : {}),
      ...(behavior.targetZones ? { targetZones: [...behavior.targetZones] } : {}),
      ...(behavior.targetRequireFaceup !== undefined ? { targetRequireFaceup: behavior.targetRequireFaceup } : {}),
      ...(behavior.targetFilters ? { targetFilters: structuredClone(behavior.targetFilters) } : {}),
      ...(behavior.costActions ? { costActions: structuredClone(behavior.costActions) } : {}),
      ...(behavior.costCount !== undefined ? { costCount: behavior.costCount } : {}),
    };
    const presences = read(raw, "targetPresences");
    const targetPresences = Array.isArray(presences) ? (presences as readonly unknown[]).flatMap(presence => {
      const instanceId = read(presence, "instanceId"); const locationVersion = read(presence, "locationVersion");
      const fieldPresenceId = read(presence, "fieldPresenceId");
      if ((typeof instanceId !== "string" && typeof instanceId !== "number") || typeof locationVersion !== "number") return [];
      return [{ instanceId, locationVersion, fieldPresenceId: typeof fieldPresenceId === "string" || typeof fieldPresenceId === "number" ? fieldPresenceId : null }];
    }) : [];
    const uniqueKey = read(entry, "uniqueKey"); const uses = read(entry, "usesRemaining"); const expiry = read(entry, "expiresOnTurn");
    state._simReplacementEffects.push({ sourcePlayerId: ownerId, replacementEffect, targetPresences,
      ...(typeof uniqueKey === "string" ? { uniqueKey } : {}),
      usesRemaining: typeof uses === "number" && Number.isFinite(uses) ? uses : null,
      expiresOnTurn: typeof expiry === "number" ? expiry : null,
    });
  }
}

/** Passive restoration is not modeled, including suppression inherited from a live duel. */
export function hasPendingPassiveRestoration(state: Pick<AiStateInput, "bot" | "player">): boolean {
  return [state.bot, state.player].some(player => player?.field?.some(card =>
    Object.values(card.temporarySuppressedDynamicBuffStatsByKey || {})
      .some(stats => stats.atk === true || stats.def === true),
  ));
}

/** Snapshot canonical runtime counters without keeping their Maps/WeakMap. */
export function projectRuntimeEffectUsage(input: AiStateInput, state: AiStateShape): void {
  const runtime = input.oncePerTurnUsage;
  if (!runtime || (input.oncePerTurnTurnCounter !== undefined &&
    input.oncePerTurnTurnCounter !== input.turnCounter)) return;
  const copyEntries = (inputEntries: unknown, suffix = ""): EffectUsageMap => {
    const result: EffectUsageMap = {};
    if (!(inputEntries instanceof Map)) return result;
    const entries: ReadonlyMap<unknown, unknown> = inputEntries;
    for (const [key, value] of entries) {
      if (typeof key !== "string") continue;
      if (!key.startsWith("once_per_turn:") || (suffix && !key.endsWith(suffix))) continue;
      const bare = key.slice("once_per_turn:".length, suffix ? -suffix.length : undefined);
      if (typeof value === "number") result[bare] = value;
      else if (value && typeof value === "object") {
        const turn: unknown = Reflect.get(value, "turn");
        const count: unknown = Reflect.get(value, "count");
        if (typeof turn === "number" && typeof count === "number") result[bare] = { turn, count };
      }
    }
    return result;
  };
  for (const original of [input.bot, input.player]) {
    if (!original?.id) continue;
    const cloned = state.bot.id === original.id ? state.bot : state.player.id === original.id ? state.player : null;
    if (!cloned) continue;
    const entries = original.id === "bot" ? runtime.bot : original.id === "player" ? runtime.player : undefined;
    cloned.oncePerTurnUsageByName = { ...cloned.oncePerTurnUsageByName, ...copyEntries(entries) };
    const copyCard = (card: AiCardInput | null | undefined, target: SimulatedCardState | null | undefined) => {
      if (!card || !target) return;
      const id: unknown = Reflect.get(card, "duelCardId") ?? card.instanceId;
      const presence: unknown = Reflect.get(card, "oncePerTurnResetVersion") || 0;
      const usage = copyEntries(runtime.card?.get(card), `:card:${String(id)}:presence:${String(presence)}`);
      if (Object.keys(usage).length > 0) target.oncePerTurnUsageByName = { ...target.oncePerTurnUsageByName, ...usage };
    };
    for (const zone of PLANNING_ZONES) {
      original[zone]?.forEach((card, index) => copyCard(card, cloned[zone][index]));
    }
    copyCard(original.fieldSpell, cloned.fieldSpell);
  }
}

/**
 * Graph-copy mechanism; each planner still selects its own state/player fields.
 * Equipment shares a memo with all zones, so
 * common/zones.ts detach/move operations affect the branch's host only.
 * Beam/Greedy retain their legacy shallow metadata. GameTree selects planning
 * fields only, including on cards reached through links outside the zones.
 */
export function createPlanningCopy(planningCardsOnly = false) {
  const copies = new Map<object, unknown>();
  const planningCards = new Set<object>();

  // Deferred runtime effects retain their source Player. The planner owns a
  // selected player projection, so these links must not copy Player.game.
  function registerPlayerCopy(source: object, target: object): void {
    copies.set(source, target);
  }

  function registerCardProjection(source: SearchCardInput, projection: SearchCardInput): void {
    copies.set(source, cloneCardForSim(projection));
  }

  function registerPlanningCard(card: object): void {
    if (planningCards.has(card)) return;
    planningCards.add(card);
    for (const key of PLANNING_CARD_LINKS) {
      const linked: unknown = Reflect.get(card, key);
      if (linked && typeof linked === "object") registerPlanningCard(linked);
    }
    const equips: unknown = Reflect.get(card, "equips");
    if (Array.isArray(equips)) {
      for (const equip of equips) {
        if (equip && typeof equip === "object") registerPlanningCard(equip);
      }
    }
  }

  function copyValue(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    if (copies.has(value)) return copies.get(value);
    if (planningCardsOnly && planningCards.has(value)) return cloneCardForSim(value);
    if (Array.isArray(value)) {
      const result: unknown[] = new Array(value.length);
      copies.set(value, result);
      value.forEach((entry, index) => {
        result[index] = copyValue(entry);
      });
      return result;
    }
    if (value instanceof Map) {
      const result = new Map<unknown, unknown>();
      copies.set(value, result);
      for (const [key, entry] of value)
        result.set(copyValue(key), copyValue(entry));
      return result;
    }
    if (value instanceof Set) {
      const result = new Set<unknown>();
      copies.set(value, result);
      for (const entry of value) result.add(copyValue(entry));
      return result;
    }
    const result = {};
    copies.set(value, result);
    for (const key of Object.keys(value)) {
      if (key === "_gameRef") continue;
      const entry: unknown = Reflect.get(value, key);
      if (typeof entry !== "function")
        Reflect.set(result, key, copyValue(entry));
    }
    return result;
  }

  function copyFields(
    source: object,
    target: object,
    keys: readonly string[],
  ): void {
    for (const key of keys) {
      if (key in source)
        Reflect.set(target, key, copyValue(Reflect.get(source, key)));
    }
  }

  function cloneCardForSim(card: SearchCardInput): SimulatedCardState {
    if (!card || typeof card !== "object") return card;
    // Memo entries are copies of these exact input objects.
    if (copies.has(card)) return copies.get(card) as SimulatedCardState;
    if (planningCardsOnly) registerPlanningCard(card);
    const clone = planningCardsOnly ? {} : { ...card };
    copies.set(card, clone);
    copyFields(card, clone, [
      ...PLANNING_CARD_FIELDS,
      ...PLANNING_LEGACY_CARD_FIELDS,
      ...PLANNING_CARD_LINKS,
      "equips",
      "state",
    ]);
    return clone as SimulatedCardState;
  }

  return { cloneCardForSim, copyFields, copyValue, registerPlayerCopy, registerCardProjection };
}
