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
import type { CanonicalSelectionMap } from "../../../contracts/selection.js";
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

type CounterAmountFieldSpec = CounterFieldSpec & {
  readonly baseAmount?: number;
  readonly base?: number;
  readonly multiplier?: number;
  readonly min?: number;
  readonly max?: number;
};

type MutableCardFilter = {
  -readonly [Key in keyof CardFilter]: CardFilter[Key];
};

function getScopedPlayersForCounterSpec(
  spec: CounterFieldSpec = {},
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
  spec: CounterFieldSpec = {},
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
  options: SimulatedActionOptions = {},
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
    const spec = action.amountFromFieldCount as CounterAmountFieldSpec;
    const count = countSimulatedFieldCards(spec, self, opponent, options);
    const multiplier = Number.isFinite(Number(spec.multiplier))
      ? Number(spec.multiplier)
      : 1;
    const baseAmount = Number.isFinite(Number(spec.baseAmount ?? spec.base))
      ? Number(spec.baseAmount ?? spec.base)
      : 0;
    let amount = baseAmount + count * multiplier;
    if (Number.isFinite(Number(spec.min))) {
      amount = Math.max(Number(spec.min), amount);
    }
    if (Number.isFinite(Number(spec.max))) {
      amount = Math.min(Number(spec.max), amount);
    }
    return Math.max(0, Math.floor(amount));
  }

  return Number.isFinite(action.amount) ? action.amount as number : 1;
}

function countSimulatedFieldCounters(
  action: Partial<ActionOf<"count_field_counters">> = {},
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
  options: SimulatedActionOptions = {},
): number {
  const counterType = action.counterType || "default";
  const zones = Array.isArray(action.zones)
    ? action.zones
    : [action.zone || "field"];
  const filters: MutableCardFilter = { ...(action.filters || {}) };
  if (action.requireFaceup === true && filters.requireFaceup == null) {
    filters.requireFaceup = true;
  }

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
    (options.actionContext as CanonicalSelectionMap)[contextKey] = addedAmount;
    options.actionContext.lastAddedCounterCount = addedAmount;
    options.actionContext.addedCounterCounts =
      options.actionContext.addedCounterCounts || {};
    (options.actionContext.addedCounterCounts as CanonicalSelectionMap)[
      action.counterType || "counter"
    ] = addedAmount;
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
    (options.actionContext as CanonicalSelectionMap)[contextKey] = total;
  }
  options.actionContext.lastFieldCounterCount = total;
  options.actionContext.fieldCounterCounts =
    options.actionContext.fieldCounterCounts || {};
  (options.actionContext.fieldCounterCounts as CanonicalSelectionMap)[
    counterType
  ] = total;
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
