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

function getScopedPlayersForCounterSpec(spec = {}, self, opponent) {
  const owner = spec.owner || spec.player || "self";
  if (owner === "opponent") return [opponent].filter(Boolean);
  if (owner === "any" || owner === "both" || owner === "either") {
    return [self, opponent].filter(Boolean);
  }
  return [self].filter(Boolean);
}

function countSimulatedFieldCards(spec = {}, self, opponent, options = {}) {
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

function resolveSimulatedAddCounterAmount(action, self, opponent, options) {
  if (action.amountFromFieldCount) {
    const spec = action.amountFromFieldCount;
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

  return Number.isFinite(action.amount) ? action.amount : 1;
}

export function applyAddCounter(ctx) {
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
    options.actionContext[contextKey] = addedAmount;
    options.actionContext.lastAddedCounterCount = addedAmount;
    options.actionContext.addedCounterCounts =
      options.actionContext.addedCounterCounts || {};
    options.actionContext.addedCounterCounts[action.counterType || "counter"] =
      addedAmount;
  }
  return;
}

export function applyRemoveCounter(ctx) {
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
