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

export function applyBanish(ctx) {
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
    const owner = findCardOwner(state, card);
    if (!owner) return;
    moveCardToZone(owner, card, "banished");
  });
  return;
}

export function applyReturnToHand(ctx) {
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
    const owner = findCardOwner(state, card);
    if (!owner) return;
    moveCardToZone(owner, card, "hand");
  });
  return;
}

export function applyMove(ctx) {
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
    const owner = findCardOwner(state, card);
    if (!owner) return;
    const to = action.to || "graveyard";
    moveCardToZone(owner, card, to);
  });
  return;
}
