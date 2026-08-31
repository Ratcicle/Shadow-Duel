import { getEffectiveAtk } from "../cardStats.js";
import { getCounterValue, setCounterValue } from "../counters.js";
import { estimateMonsterValue, hasArchetype } from "../cardValue.js";
import {
  evaluateSimulatedConditions,
  getStoredBlueprints,
} from "../simulatedConditions.js";
import {
  getCardInstanceId,
  getCostPreference,
  getTargetPreference,
  matchesTargetFilters,
  mergeCostPreference,
  normalizeCount,
  rankCandidates,
  selectSimulatedTargets,
} from "../targetSelection.js";
import {
  attachSimulatedEquip,
  findCardOwner,
  getZoneCards,
  moveCardToZone,
  removeCardFromZones,
} from "../zones.js";
import {
  applySummonState,
  chooseRankedCards,
  getActionCandidates,
  hasOpenMonsterZone,
  hasRequiredSelections,
  markSimulatedPassiveUsed,
  pickCountForAction,
  resolveActionPlayer,
  resolveSimulatedLpCost,
  resolveTargetsForAction,
  STOP_SIMULATION,
} from "./shared.js";
import type {
  ActionOf,
  ActionProperties,
} from "../../../contracts/actions.js";
import type { SimulatedPlayerState } from "../../../contracts/aiState.js";
import type { CardFilter } from "../../../contracts/effects.js";
import type {
  SimulatedActionHandlerContext,
  SimulatedActionOptions,
} from "./shared.js";

type CounterFieldSpec = Partial<
  Pick<
    ActionProperties,
    "owner" | "player" | "zone" | "zones" | "filters" | "requireFaceup"
  >
>;

function getScopedPlayersForCounterSpec(
  spec: CounterFieldSpec,
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
): SimulatedPlayerState[] {
  const owner = spec.owner || spec.player || "self";
  if (owner === "opponent") return [opponent].filter(Boolean);
  if (owner === "any" || owner === "both" || owner === "either") {
    return [self, opponent].filter(Boolean);
  }
  return [self].filter(Boolean);
}

function countSimulatedFieldCards(
  spec: CounterFieldSpec,
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
  options: SimulatedActionOptions,
): number {
  const zones = Array.isArray(spec.zones)
    ? spec.zones
    : [spec.zone || "field"];
  const filters = spec.filters || {};
  let count = 0;

  for (const player of getScopedPlayersForCounterSpec(spec, self, opponent)) {
    const ownerRole = player === self ? "self" : "opponent";
    for (const zone of zones) {
      for (const card of getZoneCards(player, zone)) {
        if (!matchesTargetFilters(card, filters, options.sourceCard, ownerRole)) {
          continue;
        }
        count += 1;
      }
    }
  }

  return count;
}

function resolveSimulatedAddCounterAmount(
  action: ActionOf<"add_counter">,
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
  options: SimulatedActionOptions,
): number {
  if (action.amountFromFieldCount) {
    const spec = action.amountFromFieldCount;
    const count = countSimulatedFieldCards(spec, self, opponent, options);
    const rawMultiplier = Reflect.get(spec, "multiplier");
    const rawBase = Reflect.get(spec, "base");
    const rawMin = Reflect.get(spec, "min");
    const rawMax = Reflect.get(spec, "max");
    const multiplier = Number.isFinite(Number(rawMultiplier))
      ? Number(rawMultiplier)
      : 1;
    const baseAmount = Number.isFinite(Number(spec.baseAmount ?? rawBase))
      ? Number(spec.baseAmount ?? rawBase)
      : 0;
    let amount = baseAmount + count * multiplier;
    if (Number.isFinite(Number(rawMin))) {
      amount = Math.max(Number(rawMin), amount);
    }
    if (Number.isFinite(Number(rawMax))) {
      amount = Math.min(Number(rawMax), amount);
    }
    return Math.max(0, Math.floor(amount));
  }

  return typeof action.amount === "number" && Number.isFinite(action.amount)
    ? action.amount
    : 1;
}

function countSimulatedFieldCounters(
  action: ActionOf<"count_field_counters">,
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
  options: SimulatedActionOptions,
): number {
  const counterType = action.counterType || "default";
  const zones = Array.isArray(action.zones)
    ? action.zones
    : [action.zone || "field"];
  const filters: CardFilter = {
    ...(action.filters || {}),
    requireFaceup:
      action.requireFaceup === true
        ? true
        : action.filters?.requireFaceup,
  };

  let total = 0;
  for (const player of getScopedPlayersForCounterSpec(action, self, opponent)) {
    const ownerRole = player === self ? "self" : "opponent";
    for (const zone of zones) {
      for (const card of getZoneCards(player, zone)) {
        if (!matchesTargetFilters(card, filters, options.sourceCard, ownerRole)) {
          continue;
        }
        total += Math.max(0, Number(getCounterValue(card, counterType) || 0));
      }
    }
  }

  return total;
}

function getFieldCounterContextKey(
  action: ActionOf<"count_field_counters">,
  counterType: string,
): string {
  return (
    action.contextKey ||
    action.storeAs ||
    action.resultKey ||
    `field${counterType.charAt(0).toUpperCase()}${counterType.slice(1)}CounterCount`
  );
}

export function applyAddCounter(
  ctx: SimulatedActionHandlerContext<"add_counter">,
): void {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  let addedAmount = 0;
  targets.forEach((card) => {
    const amount = resolveSimulatedAddCounterAmount(
      action,
      self,
      opponent,
      options,
    );
    setCounterValue(
      card,
      action.counterType || "counter",
      getCounterValue(card, action.counterType || "counter") + amount,
    );
    addedAmount += Math.max(0, Math.floor(Number(amount || 0)));
  });
  const contextKey = action.contextKey || action.storeAs || action.resultKey;
  if (contextKey && options.actionContext) {
    Reflect.set(options.actionContext, contextKey, addedAmount);
    options.actionContext.lastAddedCounterCount = addedAmount;
    options.actionContext.addedCounterCounts =
      options.actionContext.addedCounterCounts || {};
    Reflect.set(
      options.actionContext.addedCounterCounts,
      action.counterType || "counter",
      addedAmount,
    );
  }
  return;
}

export function applyCountFieldCounters(
  ctx: SimulatedActionHandlerContext<"count_field_counters">,
): void {
  const { action, options, self, opponent } = ctx;
  const counterType = action.counterType || "default";
  const total = countSimulatedFieldCounters(action, self, opponent, options);
  if (!options.actionContext || typeof options.actionContext !== "object") {
    options.actionContext = {};
  }
  const contextKey = getFieldCounterContextKey(action, counterType);
  if (contextKey) {
    Reflect.set(options.actionContext, contextKey, total);
  }
  options.actionContext.lastFieldCounterCount = total;
  options.actionContext.fieldCounterCounts =
    options.actionContext.fieldCounterCounts || {};
  Reflect.set(options.actionContext.fieldCounterCounts, counterType, total);
}

export function applyRemoveCounter(
  ctx: SimulatedActionHandlerContext<"remove_counter">,
): void {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  targets.forEach((card) => {
    const amount = Number.isFinite(action.amount) ? action.amount : 1;
    setCounterValue(
      card,
      action.counterType || "counter",
      getCounterValue(card, action.counterType || "counter") - amount,
    );
  });
  return;
}
