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

function normalizeNegateEffectsDuration(action = {}) {
  return action.negateEffectsDuration === "while_faceup"
    ? "while_faceup"
    : "until_end_turn";
}

export function applyBuffStatsTemp(ctx) {
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
    if (!card) return;
    if (Number.isFinite(action.atkBoost)) {
      card.tempAtkBoost = (card.tempAtkBoost || 0) + action.atkBoost;
      card.atk = Math.max(0, (card.atk || 0) + action.atkBoost);
    }
    if (Number.isFinite(action.defBoost)) {
      card.tempDefBoost = (card.tempDefBoost || 0) + action.defBoost;
      card.def = Math.max(0, (card.def || 0) + action.defBoost);
    }
  });
  return;
}

export function applyBuffAtkTemp(ctx) {
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
    if (!card) return;
    const amount = Number.isFinite(action.amount)
      ? action.amount
      : Number.isFinite(action.atkBoost)
        ? action.atkBoost
        : 0;
    if (amount !== 0) {
      card.tempAtkBoost = (card.tempAtkBoost || 0) + amount;
      card.atk = Math.max(0, (card.atk || 0) + amount);
    }
  });
  return;
}

export function applyForbidAttackNextTurn(ctx) {
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
  const turns = Number.isFinite(action.turns) ? action.turns : 1;
  targets.forEach((card) => {
    if (!card) return;
    card.cannotAttackThisTurn = true;
    card.cannotAttackUntilTurn = Math.max(
      card.cannotAttackUntilTurn || 0,
      (state.turnCounter || 0) + turns,
    );
    card._simCannotAttackByEffect = true;
  });
  return;
}

export function applyGrantProtection(ctx) {
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
    if (!card) return;
    if (action.protectionType === "effect_destruction") {
      card.cannotBeDestroyedByCardEffects = true;
      card._simEffectDestructionProtected = true;
    } else {
      card._simProtection = {
        type: action.protectionType || "generic",
        duration: action.duration || "temporary",
      };
    }
  });
  return;
}

export function applyRegisterReplacementEffect(ctx) {
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
  if (!Array.isArray(state._simReplacementEffects)) {
    state._simReplacementEffects = [];
  }
  const targetIds = targets.map(getCardInstanceId).filter((id) => id !== null);
  const uniqueKey =
    action.uniqueKey ||
    `${options.sourceCard?.name || "source"}:${action.replacementEffect?.type || "replacement"}`;
  state._simReplacementEffects = state._simReplacementEffects.filter(
    (entry) => entry.uniqueKey !== uniqueKey || entry.playerId !== self.id,
  );
  state._simReplacementEffects.push({
    _sim: true,
    uniqueKey,
    playerId: self.id,
    sourceName: action.sourceName || options.sourceCard?.name || null,
    duration: action.duration || "temporary",
    targetRef: action.targetRef || null,
    targetInstanceIds: targetIds,
    uses: action.uses || null,
    usesPerTarget: action.usesPerTarget || null,
    replacementEffect: action.replacementEffect || null,
  });
  targets.forEach((card) => {
    if (!card) return;
    card._simReplacementProtection = {
      uniqueKey,
      duration: action.duration || "temporary",
      replacementEffect: action.replacementEffect || null,
    };
  });
  return;
}

export function applyModifyStatsTemp(ctx) {
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
    if (!card) return;
    if (Number.isFinite(action.atkFactor)) {
      const previousAtk = card.atk || 0;
      const newAtk = Math.floor(previousAtk * action.atkFactor);
      card.atk = newAtk;
      card.tempAtkBoost =
        (card.tempAtkBoost || 0) + newAtk - previousAtk;
    }
    if (Number.isFinite(action.defFactor)) {
      const previousDef = card.def || 0;
      const newDef = Math.floor(previousDef * action.defFactor);
      card.def = newDef;
      card.tempDefBoost =
        (card.tempDefBoost || 0) + newDef - previousDef;
    }
  });
  return;
}

export function applyModifyStatsTempThenDestroyIfZeroed(ctx) {
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
    if (!card) return;
    const previousAtk = card.atk || 0;
    const previousDef = card.def || 0;
    if (Number.isFinite(action.atkChange)) {
      const newAtk = Math.max(0, previousAtk + action.atkChange);
      card.atk = newAtk;
      card.tempAtkBoost = (card.tempAtkBoost || 0) + newAtk - previousAtk;
    }
    if (Number.isFinite(action.defChange)) {
      const newDef = Math.max(0, previousDef + action.defChange);
      card.def = newDef;
      card.tempDefBoost = (card.tempDefBoost || 0) + newDef - previousDef;
    }
    const atkZeroed =
      action.destroyIfAtkZeroedByThisEffect === true &&
      previousAtk > 0 &&
      (card.atk || 0) === 0;
    const defZeroed =
      action.destroyIfDefZeroedByThisEffect === true &&
      previousDef > 0 &&
      (card.def || 0) === 0;
    if (atkZeroed || defZeroed) {
      const owner = findCardOwner(state, card);
      if (owner) moveCardToZone(owner, card, "graveyard");
    }
  });
  return;
}

export function applySetStatsToZeroAndNegate(ctx) {
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
    if (!card) return;
    if (action.setAtkToZero) {
      card.atk = 0;
      card.tempAtkBoost = 0;
    }
    if (action.setDefToZero) {
      card.def = 0;
      card.tempDefBoost = 0;
    }
    if (action.negateEffects) {
      card.effectsNegated = true;
      card.effectsNegatedDuration = normalizeNegateEffectsDuration(action);
    }
  });
  return;
}

export function applyAddStatus(ctx) {
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
    if (!card) return;
    const status = action.status;
    if (status) {
      card[status] = action.value ?? true;
    }
  });
  return;
}
