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

export function applyRegisterSynchroMaterialFollowup(
  ctx: SimulatedActionHandlerContext<"register_synchro_material_followup">,
): void {
  const { action, state, self, options } = ctx;
  const source = options.sourceCard;
  const context = options.actionContext || options.activationContext?.actionContext;
  const synchroSummonContextId = action.synchroSummonContextId || context?.synchroSummonContextId;
  if (!source || !synchroSummonContextId) {
    state._simUnsupportedActions ??= [];
    state._simUnsupportedActions.push(action.type);
    return;
  }
  if (action.actions.length === 0) return;
  state._simGeneratedInstanceCounter = (state._simGeneratedInstanceCounter || 0) + 1;
  state.pendingSynchroMaterialFollowups ??= [];
  state.pendingSynchroMaterialFollowups.push({
    id: action.uniqueKey || `sim_synchro_followup_${state._simGeneratedInstanceCounter}`,
    type: "synchro_material_followup", synchroSummonContextId, ownerId: self.id,
    source, sourceName: action.sourceName || source.name || null,
    sourceCardId: source.id ?? null, sourceInstanceId: getCardInstanceId(source),
    sourceEffectId: options.effect?.id || null, actions: action.actions,
  });
}

export function applyScheduleSpecialSummon(
  ctx: SimulatedActionHandlerContext<"schedule_special_summon">,
): void {
  const { action, state, self, opponent, options, selections } = ctx;
  const reference = action.cardRef || action.targetRef || "self";
  const card = reference === "self" || reference === "source" ? options.sourceCard :
    resolveTargetsForAction({ targetRef: reference }, selections || {}, options, opponent)[0];
  if (!card) {
    state._simUnsupportedActions ??= [];
    state._simUnsupportedActions.push(action.type);
    return;
  }
  const owner = action.owner === "opponent" || action.summonPlayer === "opponent" ? opponent : self;
  const trigger = action.triggerPlayer || action.player || "current";
  const triggerPlayer = trigger === "current" ? state.turn :
    trigger === "self" ? self.id : trigger === "opponent" ? opponent.id : trigger;
  const fromZone = action.fromZone || action.zone || "graveyard";
  if (!triggerPlayer || typeof fromZone !== "string" || action.position === "any") {
    state._simUnsupportedActions ??= [];
    state._simUnsupportedActions.push(action.type);
    return;
  }
  state._simGeneratedInstanceCounter = (state._simGeneratedInstanceCounter || 0) + 1;
  state.delayedActions ??= [];
  state.delayedActions.push({
    id: `sim_delayed_action_${state._simGeneratedInstanceCounter}`, actionType: "delayed_summon",
    triggerCondition: { phase: action.phase || action.returnPhase || "end", player: triggerPlayer },
    payload: { summons: [{
      card, owner: owner.id, placementActorId: self.id, fromZone,
      position: action.position, statusesOnSummon: action.statusesOnSummon || null,
      summonMethod: action.summonMethod || "special", summonProcedure: action.summonProcedure || null,
    }] },
    scheduledTurn: state.turnCounter || 0,
    priority: Number.isFinite(Number(action.priority)) ? Number(action.priority) : 1,
  });
}

export function applyNegateSummonOrActivationAndDestroy(
  ctx: SimulatedActionHandlerContext<"negate_summon_or_activation_and_destroy">,
): void {
  // Turn planning has no producer for pending Summon/Chain transactions yet.
  // A card reference alone cannot establish that a negation succeeds.
  ctx.state._simUnsupportedActions ??= [];
  ctx.state._simUnsupportedActions.push(ctx.action.type);
}

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
  if (!activationAttempt || !targetCard) {
    (ctx.state._simUnsupportedActions ??= []).push(action.type);
    return;
  }

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
  if (!activationAttempt || !targetCard) {
    (ctx.state._simUnsupportedActions ??= []).push(action.type);
    return;
  }

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
      selections: nestedSelections,
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
    ...(action.requireBoundTargetDestroyed === true ? { requireBoundTargetDestroyed: true } : {}),
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
  if (!blueprint) return;
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
): void | typeof STOP_SIMULATION {
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
  const decisionKey = action.effectChoiceKey || action.requirementId || "action_case_choice";
  const exactCase = options.activationContext?.decisions?.cases?.[decisionKey] ??
    options.activationContext?.decisions?.cases?.[action.requirementId || "action_case_choice"];
  const validCases = (action.cases || [])
    .filter(choiceCase => exactCase === undefined || choiceCase.id === exactCase)
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
  if (validCases.length === 0) {
    if (exactCase !== undefined) {
      (state._simUnsupportedActions ??= []).push(`exact_case:${decisionKey}`);
      return STOP_SIMULATION;
    }
    return;
  }

  const chooser =
    options.chooseActionCase ||
    options.strategy?.chooseActionCase?.bind(options.strategy);
  let chosenEntry: SimulatedCaseEntry | null | undefined = null;
  if (exactCase === undefined && typeof chooser === "function") {
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
