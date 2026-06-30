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

export function applyAllowDirectAttackThisTurn(ctx) {
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
    card.canAttackDirectlyThisTurn = true;
  });
  return;
}

function firstSelection(selections, ref) {
  if (!ref) return null;
  const value = selections?.[ref];
  return Array.isArray(value) ? value[0] || null : value || null;
}

export function applyRegisterBattlePairEffect(ctx) {
  const { action, selections, state, options, self, opponent } = ctx;
  const firstRef = action.firstTargetRef || action.targetARef || action.targetRef;
  const secondRef =
    action.secondTargetRef || action.targetBRef || action.opponentTargetRef;
  const affectedRef = action.affectedTargetRef || action.destroyTargetRef || secondRef;
  const firstTarget = firstSelection(selections, firstRef);
  const secondTarget = firstSelection(selections, secondRef);
  const affectedTarget = firstSelection(selections, affectedRef);
  if (!firstTarget || !secondTarget || !affectedTarget) return;

  state.temporaryBattlePairEffects = state.temporaryBattlePairEffects || [];
  state.temporaryBattlePairEffects.push({
    timing: action.timing || "before_damage_calculation",
    duration: action.duration || "end_of_turn",
    createdOnTurn: Number(state.turnCounter || 0),
    expiresOnTurn: Number(state.turnCounter || 0),
    controllerId: self?.id || null,
    opponentId: opponent?.id || null,
    sourceName: options.sourceCard?.name || null,
    sourceCardId: options.sourceCard?.id ?? null,
    sourceInstanceId: getCardInstanceId(options.sourceCard),
    sourceEffectId: options.effect?.id || null,
    sourceArchetype: options.sourceCard?.archetype || null,
    sourceArchetypes: Array.isArray(options.sourceCard?.archetypes)
      ? [...options.sourceCard.archetypes]
      : options.sourceCard?.archetype
        ? [options.sourceCard.archetype]
        : [],
    firstTargetRef: firstRef,
    secondTargetRef: secondRef,
    affectedTargetRef: affectedRef,
    firstTarget,
    secondTarget,
    affectedTarget,
    firstInstanceId: getCardInstanceId(firstTarget),
    secondInstanceId: getCardInstanceId(secondTarget),
    affectedInstanceId: getCardInstanceId(affectedTarget),
    actions: Array.isArray(action.actions)
      ? action.actions
      : [{ type: "destroy", targetRef: affectedRef }],
  });
}

export function applySetSourceAfterResolutionIf(ctx) {
  const { action, selections, options } = ctx;
  const firstTarget = firstSelection(selections, action.firstTargetRef);
  const secondTarget = firstSelection(selections, action.secondTargetRef);
  const source = options.sourceCard;
  if (!firstTarget || !secondTarget || !source) return;

  const conditionType =
    action.condition?.type || action.conditionType || "atk_difference_lte";
  const maxDifference = Number(
    action.condition?.value ??
      action.condition?.maxDifference ??
      action.atkDifferenceMax ??
      action.maxDifference ??
      0,
  );
  if (conditionType !== "atk_difference_lte") return;

  const difference = Math.abs(
    Number(firstTarget.atk || 0) - Number(secondTarget.atk || 0),
  );
  if (difference <= maxDifference) {
    source.__simSetAfterResolution = true;
  }
}

export function applyRedirectCurrentAttackToTarget(ctx) {
  const { targets, options } = ctx;
  const target = Array.isArray(targets) ? targets[0] || null : null;
  if (!target) return;
  if (!options.actionContext || typeof options.actionContext !== "object") {
    options.actionContext = {};
  }
  options.actionContext.attackRedirect = {
    target,
    reason: ctx.action?.contextLabel || "redirect_attack",
  };
  options.actionContext.redirectedTarget = target;
}
