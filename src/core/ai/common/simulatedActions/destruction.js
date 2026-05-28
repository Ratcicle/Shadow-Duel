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

export function applyDestroy(ctx) {
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
    moveCardToZone(owner, card, "graveyard");
  });
  return;
}

export function applyDestroyAndDamageByTargetAtk(ctx) {
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
  const entries = Array.isArray(action.entries) ? action.entries : [];
  const destroyed = entries.flatMap((entry) => {
    const entryTargets = resolveTargetsForAction(
      entry,
      selections,
      options,
      opponent,
    );
    return entryTargets.map((card) => ({
      card,
      owner: findCardOwner(state, card),
      damagePlayer: entry.damagePlayer || "owner",
      multiplier: Number.isFinite(entry.multiplier) ? entry.multiplier : 1,
      atk: getEffectiveAtk(card),
    }));
  });
  destroyed.forEach(({ card, owner }) => {
    if (owner) moveCardToZone(owner, card, "graveyard");
  });
  const skipDamage = (playerKey) => {
    const conditions = action.skipDamageIf?.[playerKey];
    if (!conditions) return false;
    return evaluateSimulatedConditions(conditions, {
      state,
      selfId,
      options,
    });
  };
  destroyed.forEach(({ owner, damagePlayer, multiplier, atk }) => {
    if (!owner) return;
    let recipient = null;
    if (damagePlayer === "self") recipient = self;
    else if (damagePlayer === "opponent") recipient = opponent;
    else recipient = owner;
    if (!recipient) return;
    const isSelf = recipient === self;
    if (skipDamage(isSelf ? "self" : "opponent")) return;
    recipient.lp = Math.max(
      0,
      (recipient.lp || 0) - Math.floor(Math.max(0, atk) * multiplier),
    );
  });
  return;
}
