import type {
  AiCardInput,
  SimulatedCardState,
} from "../../contracts/aiState.js";
import {
  PLANNING_CARD_FIELDS,
  PLANNING_CARD_LINKS,
  PLANNING_LEGACY_CARD_FIELDS,
} from "./stateFingerprint.js";
type SearchCardInput = AiCardInput;

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

  return { cloneCardForSim, copyFields, copyValue };
}
