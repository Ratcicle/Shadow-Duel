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
import type { ActionCase } from "../../../contracts/actions.js";
import type { SimulatedCardState } from "../../../contracts/aiState.js";
import type {
  DuelEventName,
} from "../../../contracts/effects.js";
import type {
  CanonicalSelectionMap,
} from "../../../contracts/selection.js";
import type { SimulatedActionHandlerContext } from "./shared.js";

interface SimulatedCaseEntry {
  choiceCase: ActionCase;
  caseSelections: CanonicalSelectionMap;
}

type LegacyTemporaryEventAction = SimulatedActionHandlerContext<
  "register_temporary_event_effect"
>["action"] & { readonly id?: string };

type ChosenCase = ActionCase | string | number | null | undefined;

export function applyNegateActivation(
  ctx: SimulatedActionHandlerContext<"negate_activation">,
): void {
  const { action, selections, options } = ctx;
  const activationContext =
    options.actionContext || options.activationContext?.context || {};
  const activationAttempt = activationContext.activationAttempt || null;
  const targetCard =
    activationAttempt?.card ||
    activationContext.card ||
    activationContext.targetCard ||
    null;
  if (!activationAttempt || !targetCard) return;

  activationAttempt.activationNegated = true;
  activationContext.activationNegated = true;
  if (action.storeNegatedCardAs) {
    if (selections && typeof selections === "object") {
      selections[action.storeNegatedCardAs] = [targetCard];
    }
    if (!options.actionResults || typeof options.actionResults !== "object") {
      options.actionResults = {};
    }
    options.actionResults[action.storeNegatedCardAs] = [targetCard];
  }
}

export function applyNegateEffect(
  ctx: SimulatedActionHandlerContext<"negate_effect">,
): void {
  const { action, selections, options } = ctx;
  const activationContext =
    options.actionContext || options.activationContext?.context || {};
  const activationAttempt = activationContext.activationAttempt || null;
  const targetCard =
    activationAttempt?.card ||
    activationContext.card ||
    activationContext.targetCard ||
    null;
  if (!activationAttempt || !targetCard) return;

  activationContext.effectNegated = true;
  if (activationContext.respondingToChainLink) {
    activationContext.respondingToChainLink.effectNegated = true;
  }
  if (action.storeNegatedCardAs) {
    if (selections && typeof selections === "object") {
      selections[action.storeNegatedCardAs] = [targetCard];
    }
    options.actionResults = options.actionResults || {};
    options.actionResults[action.storeNegatedCardAs] = [targetCard];
  }
}

export function applyConditionalTargetActions(
  ctx: SimulatedActionHandlerContext<"conditional_target_actions">,
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
  const sourceCard = options.sourceCard || null;
  const caseTargets = (
    targets.length > 0 ? targets : [sourceCard].filter(Boolean)
  ) as SimulatedCardState[];
  const matchesCase = (caseEntry: ActionCase): boolean => {
    if (!caseEntry) return false;
    if (
      caseEntry.conditions &&
      !evaluateSimulatedConditions(caseEntry.conditions, {
        state,
        selfId,
        options,
        sourceCard,
      })
    ) {
      return false;
    }
    const filters = caseEntry.filters || caseEntry.filter;
    if (!filters || Object.keys(filters).length === 0) return true;
    const matchMode = action.matchMode === "all" ? "all" : "any";
    if (matchMode === "all") {
      return caseTargets.every((card) =>
        matchesTargetFilters(
          card,
          filters,
          sourceCard,
          findCardOwner(state, card) === self ? "self" : "opponent",
        )
      );
    }
    return caseTargets.some((card) =>
      matchesTargetFilters(
        card,
        filters,
        sourceCard,
        findCardOwner(state, card) === self ? "self" : "opponent",
      )
    );
  };
  const chosenCase = (action.cases || []).find(matchesCase);
  const nestedActions = chosenCase?.actions || action.defaultActions || [];
  if (nestedActions.length === 0) return;
  applySimulatedActions({
    actions: nestedActions,
    selections,
    state,
    selfId,
    options,
  });
  return;
}

export function applyConditionalActions(
  ctx: SimulatedActionHandlerContext<"conditional_actions">,
): void {
  const {
    action,
    selections,
    state,
    selfId,
    options,
    applySimulatedActions,
  } = ctx;
  if (
    action.conditions &&
    !evaluateSimulatedConditions(action.conditions, {
      state,
      selfId,
      options,
      sourceCard: options.sourceCard,
      ...options.actionContext,
    })
  ) {
    return;
  }
  const nestedActions = Array.isArray(action.actions) ? action.actions : [];
  if (nestedActions.length === 0) return;
  applySimulatedActions({
    actions: nestedActions,
    selections,
    state,
    selfId,
    options,
  });
  return;
}

export function applyOptionalTargetActions(
  ctx: SimulatedActionHandlerContext<"optional_target_actions">,
): void {
  const {
    action,
    selections,
    state,
    selfId,
    options,
    applySimulatedActions,
  } = ctx;
  if (
    action.conditions &&
    !evaluateSimulatedConditions(action.conditions, {
      state,
      selfId,
      options,
      sourceCard: options.sourceCard,
      ...options.actionContext,
    })
  ) {
    return;
  }

  const nestedActions = Array.isArray(action.actions) ? action.actions : [];
  if (nestedActions.length === 0) return;

  let nestedSelections = selections || {};
  const targetDefs = Array.isArray(action.targets) ? action.targets : [];
  if (targetDefs.length > 0) {
    const selectedTargets = selectSimulatedTargets({
      targets: targetDefs,
      actions: nestedActions,
      state,
      sourceCard: options.sourceCard,
      selfId,
      options,
    });
    if (!hasRequiredSelections(targetDefs, selectedTargets)) {
      return;
    }
    nestedSelections = {
      ...nestedSelections,
      ...selectedTargets,
    };
  }

  applySimulatedActions({
    actions: nestedActions,
    selections: nestedSelections,
    state,
    selfId,
    options,
  });
}

export function applyRegisterTemporaryEventEffect(
  ctx: SimulatedActionHandlerContext<"register_temporary_event_effect">,
): void {
  const { action, state, self, options, selections } = ctx;
  const sourceCard = options.sourceCard || null;
  if (!action?.event || !sourceCard || !self) return;
  if (!Array.isArray(state.temporaryEventEffects)) {
    state.temporaryEventEffects = [];
  }
  const currentTurn = Number(state.turnCounter || 0);
  const expiresOnTurn =
    action.duration === "duel" || action.duration === "until_consumed"
      ? null
      : action.duration === "end_of_next_turn"
        ? currentTurn + 1
        : currentTurn;
  const boundTarget = action.bindEventTargetRef
    ? ((selections?.[action.bindEventTargetRef] || []) as
        readonly SimulatedCardState[])[0]
    : null;
  if (action.bindEventTargetRef && !boundTarget) return;
  const declaredValues = sourceCard.declaredValues
    ? JSON.parse(JSON.stringify(sourceCard.declaredValues))
    : {};
  state.temporaryEventEffects.push({
    event: action.event as DuelEventName,
    ownerId: self.id,
    sourceCardId: sourceCard.id ?? null,
    sourceName: action.sourceName || sourceCard.name || null,
    sourceCardKind: sourceCard.cardKind || null,
    sourceCardSubtype: sourceCard.subtype || null,
    sourceArchetype: sourceCard.archetype || null,
    sourceArchetypes: Array.isArray(sourceCard.archetypes)
      ? [...sourceCard.archetypes]
      : sourceCard.archetype
        ? [sourceCard.archetype]
        : [],
    sourceEffectId: options.effect?.id || null,
    sourceInstanceId:
      sourceCard.instanceId ?? sourceCard._instanceId ?? sourceCard.uuid ?? null,
    boundEventTargetInstanceId: boundTarget
      ? boundTarget.instanceId ?? boundTarget._instanceId ?? boundTarget.uuid ?? null
      : null,
    requireBoundTargetLeavesField:
      action.requireBoundTargetLeavesField === true,
    duration: action.duration || "end_of_turn",
    createdOnTurn: currentTurn,
    expiresOnTurn,
    usesRemaining:
      action.unlimitedUses === true
        ? null
        : Number.isFinite(Number(action.uses))
          ? Math.max(0, Number(action.uses))
          : 1,
    declaredValues,
    effect: {
      id:
        action.effectId ||
        (action as LegacyTemporaryEventAction).id ||
        "temporary_event_effect",
      timing: "on_event",
      event: action.event as DuelEventName,
      triggerRequirement: action.triggerRequirement,
      triggerTiming: action.triggerTiming,
      conditions: action.conditions || [],
      actions: action.actions || [],
      targets: action.targets || [],
      promptUser: action.promptUser === true,
    },
  });
}

export function applyActivateStoredBlueprint(
  ctx: SimulatedActionHandlerContext<"activate_stored_blueprint">,
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
  const sourceCard = options.sourceCard;
  const blueprint = getStoredBlueprints(sourceCard)[0];
  const effect = blueprint?.effectSnapshot || blueprint?.effect || null;
  if (!effect) return;
  if (
    effect.conditions &&
    !evaluateSimulatedConditions(effect.conditions, {
      state,
      selfId,
      options,
      sourceCard,
    })
  ) {
    return;
  }
  const blueprintSelections = selectSimulatedTargets({
    targets: effect.targets || [],
    actions: effect.actions || [],
    state,
    sourceCard,
    selfId,
    options,
  });
  if (!hasRequiredSelections(effect.targets || [], blueprintSelections)) {
    return;
  }
  applySimulatedActions({
    actions: effect.actions || [],
    selections: blueprintSelections,
    state,
    selfId,
    options: {
      ...options,
      sourceCard,
      activationContext: {
        ...(options.activationContext || {}),
        blueprintSourceCardId: blueprint.sourceCardId,
        blueprintId: blueprint.blueprintId,
      },
    },
  });
  return;
}

export function applyChooseActionCase(
  ctx: SimulatedActionHandlerContext<"choose_action_case">,
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
  const validCases = (action.cases || [])
    .map((choiceCase) => {
      if (!choiceCase) return null;
      if (
        choiceCase.conditions &&
        !evaluateSimulatedConditions(choiceCase.conditions, {
          state,
          selfId,
          options,
        })
      ) {
        return null;
      }
      const caseSelections = selectSimulatedTargets({
        targets: choiceCase.targets || [],
        actions: choiceCase.actions || [],
        state,
        sourceCard: options.sourceCard,
        selfId,
        options,
      });
      if (!hasRequiredSelections(choiceCase.targets || [], caseSelections)) {
        return null;
      }
      return { choiceCase, caseSelections };
    })
    .filter(Boolean) as SimulatedCaseEntry[];
  if (validCases.length === 0) return;

  const chooser =
    options.chooseActionCase ||
    options.strategy?.chooseActionCase?.bind(options.strategy);
  let chosenEntry: SimulatedCaseEntry | null | undefined = null;
  if (typeof chooser === "function") {
    const chosen = chooser(
      validCases.map((entry) => entry.choiceCase),
      {
        state,
        action,
        source: options.sourceCard,
        activationContext: options.activationContext,
      },
    ) as ChosenCase;
    chosenEntry =
      validCases.find((entry) => entry.choiceCase === chosen) ||
      validCases.find(
        (entry) =>
          entry.choiceCase.id ===
          (chosen as ActionCase | null | undefined)?.id,
      ) ||
      validCases.find((entry) => entry.choiceCase.id === chosen);
  }
  if (!chosenEntry) chosenEntry = validCases[0];

  applySimulatedActions({
    actions: chosenEntry!.choiceCase.actions || [],
    selections: chosenEntry!.caseSelections,
    state,
    selfId,
    options,
  });
  return;
}

export function applyShuffleDeck(
  ctx: SimulatedActionHandlerContext<"shuffle_deck">,
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
  return;
}
