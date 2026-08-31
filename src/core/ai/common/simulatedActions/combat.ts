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
import type { SimulatedCardState } from "../../../contracts/aiState.js";
import type {
  CanonicalSelectionMap,
  CanonicalSelectionValue,
} from "../../../contracts/selection.js";
import type { SimulatedActionHandlerContext } from "./shared.js";

export function applyAllowDirectAttackThisTurn(
  ctx: SimulatedActionHandlerContext<"allow_direct_attack_this_turn">,
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
    if (!card) return;
    card.canAttackDirectlyThisTurn = true;
  });
  return;
}

export function applyForbidDirectAttackThisTurn(
  ctx: SimulatedActionHandlerContext<"forbid_direct_attack_this_turn">,
): void {
  const { action, self, opponent } = ctx;
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  if (!targetPlayer) return;
  targetPlayer.forbidDirectAttacksThisTurn = true;
}

function isSimulatedCard(value: unknown): value is SimulatedCardState {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function selectionCard(
  value: CanonicalSelectionValue,
): SimulatedCardState | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (!isSimulatedCard(first)) return null;
  if ("card" in first && isSimulatedCard(first.card)) return first.card;
  return first;
}

function firstSelection(
  selections: CanonicalSelectionMap,
  ref: string | null | undefined,
): SimulatedCardState | null {
  if (!ref) return null;
  return selectionCard(selections[ref]);
}

export function applyRegisterBattlePairEffect(
  ctx: SimulatedActionHandlerContext<"register_battle_pair_effect">,
): void {
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

export function applySetSourceAfterResolutionIf(
  ctx: SimulatedActionHandlerContext<"set_source_after_resolution_if">,
): void {
  const { action, selections, options } = ctx;
  const firstTarget = firstSelection(selections, action.firstTargetRef);
  const secondTarget = firstSelection(selections, action.secondTargetRef);
  const source = options.sourceCard;
  if (!firstTarget || !secondTarget || !source) return;

  const condition = action.condition;
  const conditionType =
    condition && "type" in condition
      ? condition.type
      : action.conditionType || "atk_difference_lte";
  const conditionValue =
    condition && "value" in condition ? condition.value : undefined;
  const conditionMaxDifference =
    condition && "maxDifference" in condition
      ? condition.maxDifference
      : undefined;
  const maxDifference = Number(
    conditionValue ??
      conditionMaxDifference ??
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

export function applyRedirectCurrentAttackToTarget(
  ctx: SimulatedActionHandlerContext<"redirect_current_attack_to_target">,
): void {
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
