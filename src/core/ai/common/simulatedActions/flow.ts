import { getEffectiveAtk } from "../cardStats.js";
import { clearSimulatedTemporaryControl, emitSimulatedMove, getOriginalOwner } from "./movement.js";
import { buildEffectBlueprint, getBlueprintStorageConfig } from "../../../effects/blueprints/index.js";
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
  findCardZone,
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
import type { AiCardInput, SimulatedCardState, SimulatedPlayerState, SimulatedDelayedSummonAction } from "../../../contracts/aiState.js";
import type { SimulatedMoveReceipt } from "../zones.js";
import type {
  DuelEventName, EffectDefinition,
} from "../../../contracts/effects.js";
import type {
  CanonicalSelectionMap,
} from "../../../contracts/selection.js";
import type { SimulatedActionHandlerContext, SimulatedActionOptions } from "./shared.js";

interface SimulatedCaseEntry {
  choiceCase: ActionCase;
  caseSelections: CanonicalSelectionMap;
}

type LegacyTemporaryEventAction = SimulatedActionHandlerContext<
  "register_temporary_event_effect"
>["action"] & { readonly id?: string };

type ChosenCase = ActionCase | string | number | null | undefined;

/** AI storage follows runtime metadata; the pure builders never see a live Game. */
export function storeSimulatedBlueprintAfterResolution(
  player: SimulatedPlayerState,
  source: AiCardInput,
  effect: EffectDefinition | null | undefined,
): boolean {
  if (source.cardKind !== "spell" || !source.name || !effect) return false;
  const holder = player.spellTrap.find(card => getBlueprintStorageConfig({ name: card.name || "", blueprintStorage: card.blueprintStorage ?? null }));
  if (!holder) return false;
  const config = getBlueprintStorageConfig({ name: holder.name || "", blueprintStorage: holder.blueprintStorage ?? null });
  if (!config || (config.requireFaceup && holder.isFacedown) ||
      (config.requireEquipped && !holder.equippedTo) || holder.effectsNegated) return false;
  if (config.allowedCardKinds?.length && !config.allowedCardKinds.includes(source.cardKind)) return false;
  if (config.allowedArchetypes?.length && !config.allowedArchetypes.some(archetype => hasArchetype(source, archetype))) return false;
  if (!Reflect.get(effect, config.storableEffectFlag) && !Reflect.get(source, config.storableEffectFlag)) return false;
  const stored = holder.state?.blueprintStorage?.storedBlueprints || [];
  const hasSpace = stored.length < config.maxSlots;
  if ((!hasSpace && !config.allowOverwrite) || !config.autoStoreForAI) return false;
  const blueprint = buildEffectBlueprint({
    ...(source.id === undefined ? {} : { id: source.id }),
    name: source.name,
    cardKind: source.cardKind,
    ...(source.subtype === undefined ? {} : { subtype: source.subtype }),
    ...(source.archetype === undefined ? {} : { archetype: source.archetype }),
    ...(source.description === undefined ? {} : { description: source.description }),
  }, effect);
  if (!blueprint?.effectSnapshot) return false;
  const entry = { ...blueprint, effectSnapshot: blueprint.effectSnapshot, respectUsageLimits: config.respectStoredEffectUsageLimits,
    shortRulesText: blueprint.shortRulesText || "", displayName: blueprint.displayName || source.name,
    // Legacy AI projection alias for a stored blueprint; no routing depends on a card name.
    _simStoredByGrimoire: true };
  holder.state ??= {};
  holder.state.blueprintStorage ??= { storedBlueprints: [] };
  if (hasSpace) holder.state.blueprintStorage.storedBlueprints.push(entry);
  else holder.state.blueprintStorage.storedBlueprints[0] = entry;
  return true;
}

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
      expectedLocationVersion: card.locationVersion || 0,
      position: action.position, statusesOnSummon: action.statusesOnSummon || null,
      summonMethod: action.summonMethod || "special", summonProcedure: action.summonProcedure || null,
    }] },
    scheduledTurn: state.turnCounter || 0,
    priority: Number.isFinite(Number(action.priority)) ? Number(action.priority) : 1,
  });
}

/** Project the declared delayed exchange using normal movement and scheduling. */
export function applyAbyssalSerpentDelayedSummon(
  ctx: SimulatedActionHandlerContext<"abyssal_serpent_delayed_summon">,
): boolean {
  const { action, state, self, opponent, options, selections } = ctx;
  const source = options.sourceCard;
  const target = resolveTargetsForAction({ targetRef: action.targetRef || "abyssal_target" },
    selections || {}, options, opponent)[0];
  if (!source || !target || !self.field.includes(source) || !opponent.field.includes(target)) return false;
  const targetWasExtraMonster = target.monsterType === "fusion" || target.monsterType === "ascension";
  const summons: SimulatedDelayedSummonAction["payload"]["summons"] = [];
  // Runtime schedules this action through moveCard without an effect source.
  // Preserve those event/replacement facts instead of inferring a new rule.
  const movementOptions: SimulatedActionOptions = {
    sourceCard: null, effect: null,
    ...(options.emitSimulatedEvent ? { emitSimulatedEvent: options.emitSimulatedEvent } : {}),
  };
  for (const card of [source, target]) {
    const holder = findCardOwner(state, card);
    if (!holder) continue;
    const fromZone = findCardZone(holder, card);
    const destination = fromZone === "field" ? getOriginalOwner(state, card, holder) : holder;
    const wasFaceup = card.isFacedown !== true;
    const wasNegated = fromZone === "field" && card.effectsNegated === true;
    const receipt: { value: SimulatedMoveReceipt | null } = { value: null };
    if (!moveCardToZone(destination, card, "graveyard", holder, {
      state, movedByEffect: false, sourceCard: null, sourcePlayer: null,
      ...(options.emitSimulatedEvent ? { emitSimulatedEvent: options.emitSimulatedEvent } : {}),
      onMoveCommitted: value => { receipt.value = value; },
    })) continue;
    if (fromZone === "field") clearSimulatedTemporaryControl(state, card);
    emitSimulatedMove(card, state, holder, destination, fromZone, wasFaceup, wasNegated,
      movementOptions, null, false, receipt.value);
    const graveOwner = [state.player, state.bot].find(player => player.graveyard.includes(card));
    if (!graveOwner) continue;
    summons.push({ card, owner: graveOwner.id, placementActorId: self.id,
      fromZone: "graveyard", expectedLocationVersion: card.locationVersion || 0,
      statusesOnSummon: null, summonMethod: "special", summonProcedure: null,
      getsBuffIfTargetWasFusionOrAscension: card === source && targetWasExtraMonster });
  }
  if (!summons.length) return false;
  state._simGeneratedInstanceCounter = (state._simGeneratedInstanceCounter || 0) + 1;
  state.delayedActions ??= [];
  state.delayedActions.push({ id: `sim_delayed_action_${state._simGeneratedInstanceCounter}`,
    actionType: "delayed_summon", triggerCondition: { phase: "standby", player: opponent.id },
    payload: { summons }, scheduledTurn: state.turnCounter || 0, priority: 1 });
  return true;
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
        ...(selections ? { _actionTargets: selections } : {}),
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
      ...(selections ? { _actionTargets: selections } : {}),
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
): boolean | typeof STOP_SIMULATION {
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
      ...(selections ? { _actionTargets: selections } : {}),
    })
  ) {
    return false;
  }

  const nestedActions = Array.isArray(action.actions) ? action.actions : [];
  if (nestedActions.length === 0) return false;

  let nestedSelections = selections || {};
  const targetDefs = Array.isArray(action.targets) ? action.targets : [];
  // Resolution choices shadow only their local ids. They do not inherit an
  // activation reference's presence binding or create a new one of their own.
  const localChoiceIds = new Set(targetDefs.filter(definition => !definition.targetFromContext).map(definition => definition.id));
  const localEffect = options.effect ? {
    ...options.effect,
    targets: [...(options.effect?.targets || []).filter(definition => !targetDefs.some(local => local.id === definition.id)), ...targetDefs],
  } : undefined;
  const localOptions: SimulatedActionOptions = { ...options, ...(localEffect ? { effect: localEffect } : {}), referenceSnapshots: Object.fromEntries(
    Object.entries(options.referenceSnapshots || {}).filter(([id]) => !localChoiceIds.has(id)),
  ) };
  // Projecting the same running effect must not recheck its already accepted
  // contextual references halfway through the enclosing action batch.
  if (targetDefs.every(definition => !definition.targetFromContext) &&
      options._contextualReferencePreflight?.effect === options.effect &&
      options._contextualReferencePreflight?.source === options.sourceCard) {
    localOptions._contextualReferencePreflight = { effect: localEffect, source: options.sourceCard };
  }
  if (targetDefs.length > 0) {
    const unsupportedBefore = state._simUnsupportedActions?.length || 0;
    const selectedTargets = selectSimulatedTargets({
      effect: localEffect,
      targets: targetDefs,
      actions: nestedActions,
      selections: nestedSelections,
      state,
      sourceCard: options.sourceCard,
      selfId,
      options: localOptions,
    });
    if ((state._simUnsupportedActions || []).slice(unsupportedBefore).some(reason => reason.startsWith("exact_selection:"))) return false;
    if (!hasRequiredSelections(targetDefs, selectedTargets)) {
      return action.optional !== false;
    }
    // AutoSelector selects the required minimum by default. Explicit plans
    // keep their full legal selection, including a larger allowed group.
    for (const definition of targetDefs) {
      const chosen = selectedTargets[definition.id];
      if (Array.isArray(chosen) && !definition.targetFromContext &&
          options.activationContext?.decisions?.selections?.[definition.id] === undefined) {
        selectedTargets[definition.id] = chosen.slice(0, normalizeCount(definition.count, 1).min);
      }
    }
    nestedSelections = {
      ...nestedSelections,
      ...selectedTargets,
    };
  }

  const requiredReplanBefore = state._simRequiresReplan === true;
  const unknownDrawCountBefore = state._simUnknownDrawCount || 0;
  const result: unknown = applySimulatedActions({
    actions: nestedActions,
    selections: nestedSelections,
    state,
    selfId,
    options: localOptions,
  });
  if (result === false && state._simRequiresReplan === true &&
      (!requiredReplanBefore || (state._simUnknownDrawCount || 0) > unknownDrawCountBefore)) {
    return STOP_SIMULATION;
  }
  return result !== false;
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
  const stored = getStoredBlueprints(sourceCard);
  if (stored.length > 1) {
    (state._simUnsupportedActions ??= []).push("stored_blueprint_choice");
    return;
  }
  const blueprint = stored[0];
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
    actions: [...(effect.activationCosts || []), ...(effect.activationCommitActions || []), ...(effect.actions || [])],
    state,
    sourceCard,
    selfId,
    options,
  });
  if (!hasRequiredSelections(effect.targets || [], blueprintSelections)) {
    return;
  }
  applySimulatedActions({ actions: effect.activationCosts || [], selections: blueprintSelections,
    state, selfId, options: { ...options, sourceCard, effect } });
  if (sourceCard?.cardKind === "spell" && ["equip", "continuous", "field"].includes(sourceCard.subtype || "") &&
      (!self.spellTrap.includes(sourceCard) && self.fieldSpell !== sourceCard)) return;
  applySimulatedActions({
    actions: [...(effect.activationCommitActions || []), ...(effect.actions || [])],
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
          _actionTargets: selections,
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
        ...(selections ? { selections } : {}),
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
    selections: { ...selections, ...chosenEntry!.caseSelections },
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
