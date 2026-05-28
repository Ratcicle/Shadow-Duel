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
  targets.forEach((card) => {
    const amount = Number.isFinite(action.amount) ? action.amount : 1;
    setCounterValue(
      card,
      action.counterType || "counter",
      getCounterValue(card, action.counterType || "counter") + amount,
    );
  });
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
