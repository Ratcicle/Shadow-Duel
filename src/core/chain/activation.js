import { isQuickSpell } from "../game/spellTrap/quickSpellRules.js";
import {
  CHAIN_ACTIVATION_KINDS,
  buildUsagePolicy,
  captureSourceSnapshot,
  classifyActivationKind,
  classifyEffectKind,
  getResponseContextType,
} from "./link.js";
import { FAST_EFFECT_ORIGINS } from "./timing.js";

const PERSISTENT_SPELL_TRAP_SUBTYPES = new Set([
  "continuous",
  "equip",
  "field",
]);

export function effectRequiresSourceAtResolution(card, effect, zone = null) {
  if (typeof effect?.requiresSourceAtResolution === "boolean") {
    return effect.requiresSourceAtResolution;
  }
  const isActivePermanentZone =
    zone == null || zone === "spellTrap" || zone === "fieldSpell";
  return (
    isActivePermanentZone &&
    (card?.cardKind === "spell" || card?.cardKind === "trap") &&
    PERSISTENT_SPELL_TRAP_SUBTYPES.has(String(card?.subtype || "").toLowerCase())
  );
}

function legacyActionIsActivationCost(effect, action) {
  if (!action || typeof action !== "object") return false;
  if (action.activationStage === "cost") return true;
  if (action.type === "pay_lp") return true;
  const label = String(action.contextLabel || "");
  if (label === "cost" || label.endsWith("_cost")) return true;
  const costTargetIds = new Set(
    (effect?.targets || [])
      .filter((target) => target?.intent === "cost")
      .map((target) => target.id),
  );
  return typeof action.targetRef === "string" && costTargetIds.has(action.targetRef);
}

export function getEffectActivationCosts(effect) {
  const explicit = Array.isArray(effect?.activationCosts)
    ? effect.activationCosts
    : [];
  const legacy = (effect?.actions || []).filter((action) =>
    legacyActionIsActivationCost(effect, action),
  );
  return [...explicit, ...legacy.filter((action) => !explicit.includes(action))];
}

export function getEffectResolutionActions(effect) {
  return (effect?.actions || []).filter(
    (action) => !legacyActionIsActivationCost(effect, action),
  );
}

function selectionsForIntent(effect, selections, costIntent) {
  const ids = new Set(
    (effect?.targets || [])
      .filter((target) =>
        costIntent ? target?.intent === "cost" : target?.intent !== "cost",
      )
      .map((target) => target?.id)
      .filter(Boolean),
  );
  return Object.fromEntries(
    Object.entries(selections || {}).filter(([id]) => ids.has(id)),
  );
}

export function createPreparedActivation(input = {}) {
  const card = input.card || null;
  const controller = input.controller || input.player || null;
  const effect = input.effect || null;
  const activationZone = input.activationZone || input.zone || null;
  const activationContext = {
    ...(input.activationContext || {}),
  };
  if (typeof activationContext.sourceWasFacedown !== "boolean") {
    activationContext.sourceWasFacedown = card?.isFacedown === true;
  }
  if (!activationContext.sourceZone) {
    activationContext.sourceZone = input.sourceZone || activationZone;
  }
  activationContext.activationZone = activationZone;
  const sourceAtTrigger =
    input.sourceAtTrigger || activationContext.sourceAtTrigger || null;
  const sourceAtActivation =
    input.sourceAtActivation ||
    activationContext.sourceAtActivation ||
    captureSourceSnapshot(card, controller, activationZone);
  const activationKind = classifyActivationKind({
    ...input,
    card,
    effect,
    activationContext,
    sourceAtTrigger,
  });
  const effectKind = classifyEffectKind({
    ...input,
    card,
    effect,
    activationContext,
    selectionKind: input.selectionKind || activationContext.selectionKind,
  });
  const responseContextType = getResponseContextType(activationKind);
  const activationAttempt =
    input.activationAttempt || {};
  const normalizedAttempt = {
    ...activationAttempt,
    card,
    controller,
    // Phase 9 compatibility alias.
    player: controller,
    effect,
    effectId: effect?.id || null,
    activationKind,
    activationZone,
    activationNegated:
      activationAttempt.activationNegated === true ||
      activationAttempt.negated === true,
    // Phase 9 compatibility alias.
    negated:
      activationAttempt.activationNegated === true ||
      activationAttempt.negated === true,
  };
  const legacySelections = input.selections || {};
  const costSelections =
    input.costSelections ||
    selectionsForIntent(effect, legacySelections, true);
  const targetSelections =
    input.targetSelections ||
    selectionsForIntent(effect, legacySelections, false);
  const resolutionSelections = input.resolutionSelections || {};
  // Phase 9 compatibility alias: keep the legacy aggregate derived from the
  // three canonical selection stages instead of allowing it to drift.
  const normalizedSelections = {
    ...legacySelections,
    ...costSelections,
    ...targetSelections,
    ...resolutionSelections,
  };

  return {
    ...input,
    card,
    controller,
    // Phase 9: remove after all callers use controller.
    player: controller,
    effect,
    activationZone,
    // Phase 9: remove after all callers use activationZone.
    zone: activationZone,
    selections: normalizedSelections,
    costSelections,
    targetSelections,
    resolutionSelections,
    costPayment: input.costPayment || null,
    activationContext: {
      ...activationContext,
      sourceAtTrigger,
      sourceAtActivation,
    },
    activationAttempt: normalizedAttempt,
    activationKind,
    effectKind,
    responseContextType,
    sourceAtTrigger,
    sourceAtActivation,
    usagePolicy: input.usagePolicy || buildUsagePolicy(effect),
    committed: input.committed === true,
    costsPaid: input.costsPaid === true,
    prepared: true,
    requiresSourceAtResolution:
      typeof input.requiresSourceAtResolution === "boolean"
        ? input.requiresSourceAtResolution
        : effectRequiresSourceAtResolution(card, effect, activationZone),
    requiresSourceFaceUpAtResolution:
      typeof input.requiresSourceFaceUpAtResolution === "boolean"
        ? input.requiresSourceFaceUpAtResolution
        : typeof input.requiresSourceAtResolution === "boolean"
          ? input.requiresSourceAtResolution
          : effectRequiresSourceAtResolution(card, effect, activationZone),
  };
}

export function refreshPreparedActivationSourceSnapshot(prepared) {
  if (!prepared?.card) return prepared;
  const controller = prepared.controller || prepared.player || null;
  const activationZone = prepared.activationZone || prepared.zone || null;
  prepared.sourceAtActivation = captureSourceSnapshot(
    prepared.card,
    controller,
    activationZone,
  );
  prepared.activationKind = classifyActivationKind(prepared);
  prepared.effectKind = classifyEffectKind(prepared);
  prepared.responseContextType = getResponseContextType(
    prepared.activationKind,
  );
  prepared.activationContext = {
    ...(prepared.activationContext || {}),
    activationZone,
    sourceAtActivation: prepared.sourceAtActivation,
  };
  Object.assign(prepared.activationAttempt || {}, {
    activationKind: prepared.activationKind,
    activationZone,
  });
  return prepared;
}

function buildEffectContext(chainSystem, prepared, context = null) {
  const player = prepared.controller || prepared.player;
  const activationContext = {
    ...(prepared.activationContext || {}),
    activationZone: prepared.activationZone,
    sourceZone:
      prepared.activationContext?.sourceZone ||
      prepared.sourceZone ||
      prepared.activationZone,
    committed: prepared.committed === true,
    selections: prepared.selections || {},
    context: context || prepared.context || null,
  };
  return {
    ...(context || {}),
    source: prepared.card,
    sourceCard: prepared.card,
    effect: prepared.effect,
    effectId: prepared.effect?.id || null,
    player,
    opponent: chainSystem.getOpponent(player),
    activationZone: prepared.activationZone,
    actionContext: context || prepared.context || null,
    activationContext,
  };
}

function flattenSelectionCards(selections) {
  const cards = [];
  const seen = new Set();
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === "object" && value.card) {
      visit(value.card);
      return;
    }
    if (typeof value === "object" && (value.name || value.cardName)) {
      if (!seen.has(value)) {
        seen.add(value);
        cards.push(value);
      }
    }
  };
  for (const value of Object.values(selections || {})) visit(value);
  return cards;
}

function flattenDeclaredEffectTargets(effect, selections) {
  const costIds = new Set(
    (effect?.targets || [])
      .filter((target) => target?.intent === "cost")
      .map((target) => target.id),
  );
  return flattenSelectionCards(
    Object.fromEntries(
      Object.entries(selections || {}).filter(([id]) => !costIds.has(id)),
    ),
  );
}

function resolveCardOwner(chainSystem, card) {
  if (!card) return null;
  for (const player of [chainSystem.game?.player, chainSystem.game?.bot]) {
    if (!player) continue;
    if (card.owner === player.id) return player;
    if (
      player.field?.includes(card) ||
      player.hand?.includes(card) ||
      player.spellTrap?.includes(card) ||
      player.graveyard?.includes(card) ||
      player.fieldSpell === card
    ) {
      return player;
    }
  }
  return null;
}

export async function publishChainLinkActivation(link) {
  if (!link || link.activationPublished === true) return { ok: true, skipped: true };
  const game = this.game;
  if (!game) return { ok: false, reason: "missing_game" };
  link.activationPublished = true;

  const selectedCards = flattenDeclaredEffectTargets(
    link.effect,
    link.selections || {},
  );
  const atomicGroupId = this.allocateAtomicEventGroupId?.() || null;
  const basePayload = {
    chainId: link.chainId,
    linkId: link.linkId,
    card: link.card,
    source: link.card,
    sourceCard: link.card,
    player: link.controller,
    owner: link.controller,
    effect: link.effect,
    effectId: link.effect?.id || null,
    effectType: link.effect?.timing || "chain",
    activationZone: link.activationZone || null,
    fromZone:
      link.sourceAtTrigger?.zone ||
      link.activationContext?.sourceZone ||
      link.activationZone ||
      null,
    fromHand: link.activationContext?.fromHand === true,
    chainLevel: link.chainLevel,
    triggerOpportunityId: link.triggerOpportunityId ?? null,
    triggerOccurrenceId: link.triggerOccurrenceId ?? null,
    atomicGroupId,
    triggerAtomicGroupId: link.atomicGroupId ?? null,
    segocGroup: link.segocGroup || null,
    segocOrder: link.segocOrder ?? null,
    activationKind: link.activationKind,
    effectKind: link.effectKind,
    responseContextType: link.responseContextType,
    sourceAtTrigger: link.sourceAtTrigger,
    sourceAtActivation: link.sourceAtActivation,
    preparationStatus: link.preparationStatus,
    resolutionStatus: link.resolutionStatus,
    finalizationStatus: link.finalizationStatus,
    chainContext: link.context?.type || null,
    target: selectedCards[0] || null,
    targets: selectedCards,
    selectedCount: selectedCards.length,
    activationContext: link.activationContext || null,
    sourceEvent:
      link.activationContext?.triggeredByEvent || link.effect?.event || null,
  };

  const triggerPackages = [];
  const collectPackage = (eventName, result) => {
    if (!result || !Array.isArray(result.entries) || result.entries.length === 0) {
      return;
    }
    triggerPackages.push({
      eventName,
      payload: result.payload || basePayload,
      entries: result.entries,
      occurrence: result.occurrence || null,
      orderRule: result.orderRule || null,
      onComplete: result.onComplete || null,
    });
  };

  if (
    link.activationKind === CHAIN_ACTIVATION_KINDS.SPELL_TRAP_CARD &&
    link.card?.cardKind === "spell"
  ) {
    collectPackage(
      "spell_activated",
      await game.emit?.("spell_activated", basePayload, {
        collectTriggersOnly: true,
      }),
    );
  } else if (
    link.activationKind === CHAIN_ACTIVATION_KINDS.SPELL_TRAP_CARD &&
    link.card?.cardKind === "trap"
  ) {
    collectPackage(
      "trap_activated",
      await game.emit?.("trap_activated", basePayload, {
        collectTriggersOnly: true,
      }),
    );
  }
  collectPackage(
    "effect_activated",
    await game.emitEffectActivated?.(basePayload, {
      collectTriggersOnly: true,
    }),
  );

  for (const target of selectedCards) {
    const targetOwner = resolveCardOwner(this, target);
    const targetedPayload = {
      ...basePayload,
      actionContext: link.context || null,
      target,
      targetOwner,
    };
    collectPackage(
      "effect_targeted",
      await game.emit?.("effect_targeted", targetedPayload, {
        collectTriggersOnly: true,
      }),
    );
  }
  return { ok: true, triggerPackages };
}

export async function payActivationCosts(prepared, context = null) {
  const costs = getEffectActivationCosts(prepared?.effect);
  if (!Array.isArray(costs) || costs.length === 0) {
    prepared.costsPaid = true;
    prepared.costPayment = { status: "not_required", actions: [] };
    return { success: true, needsSelection: false };
  }
  const effectEngine = this.game?.effectEngine;
  if (!effectEngine?.applyActions) {
    return { success: false, reason: "No effect engine available for costs." };
  }

  const ctx = buildEffectContext(this, prepared, context);
  ctx.activationContext.payingActivationCosts = true;
  const result = await effectEngine.applyActions(
    costs,
    ctx,
    prepared.selections || {},
  );
  if (result?.needsSelection) {
    return {
      ...result,
      success: false,
      reason:
        result.reason ||
        "Activation costs must be fully selected before the card is committed.",
    };
  }
  if (result && typeof result === "object" && result.success === false) {
    return result;
  }
  prepared.costsPaid = true;
  prepared.costPayment = {
    status: "paid",
    actions: costs.map((action, index) => ({
      index,
      type: action?.type || null,
      targetRef: action?.targetRef || null,
    })),
  };
  return { success: true, needsSelection: false };
}

export async function appendActivationTriggerPackages(
  publicationResult,
  parentContext = null,
) {
  let pending = Array.isArray(publicationResult?.triggerPackages)
    ? [...publicationResult.triggerPackages]
    : [];
  let added = 0;

  while (pending.length > 0) {
    const batch = pending;
    pending = [];
    const preparation = await this.prepareTriggerPackages?.(batch, {
      parentContext,
    });
    if (!preparation?.ok || preparation?.needsSelection) {
      this.activeTriggerOpportunity = null;
      this.pendingTriggerSelection = null;
      break;
    }
    for (const occurrence of preparation.occurrences || []) {
      if (typeof occurrence?.onComplete !== "function") continue;
      this.chainEventCompletions = this.chainEventCompletions || [];
      this.chainEventCompletions.push(occurrence.onComplete);
    }

    for (const prepared of preparation.preparedActivations || []) {
      prepared.context = {
        ...(parentContext || {}),
        ...(prepared.context || {}),
        card: prepared.card,
        effect: prepared.effect,
        player: prepared.controller || prepared.player,
        controller: prepared.controller || prepared.player,
        triggerPlayer: prepared.controller || prepared.player,
        addTriggerToChain: false,
        activationContext: prepared.activationContext || null,
      };
      const link = this.addToChain(prepared);
      added += 1;
      const nestedPublication = await this.publishChainLinkActivation?.(link);
      if (Array.isArray(nestedPublication?.triggerPackages)) {
        pending.push(...nestedPublication.triggerPackages);
      }
    }
    this.activeTriggerOpportunity = null;
    this.pendingTriggerSelection = null;
  }

  return { success: true, added };
}

export async function completeActivationTriggerPackages() {
  const callbacks = Array.isArray(this.chainEventCompletions)
    ? this.chainEventCompletions.splice(0)
    : [];
  for (const callback of callbacks) {
    try {
      await callback();
    } catch (error) {
      console.error("[ChainSystem] Activation trigger completion failed:", error);
    }
  }
}

async function commitResponseSource(chainSystem, prepared) {
  const card = prepared.card;
  const player = prepared.controller || prepared.player;
  const zone = prepared.activationZone || prepared.zone;
  if (!card || !player) {
    return { success: false, reason: "Missing response card or player." };
  }

  if (
    zone === "hand" &&
    (isQuickSpell(card) || card.cardKind === "trap")
  ) {
    if ((player.spellTrap || []).length >= 5) {
      return {
        success: false,
        code: "SPELL_TRAP_ZONE_FULL",
        reason: "Spell/Trap Zone is full.",
      };
    }
    const wasFacedown = card.isFacedown === true;
    card.isFacedown = false;
    const moveResult = await chainSystem.game?.moveCard?.(
      card,
      player,
      "spellTrap",
      {
        fromZone: "hand",
        sourceCard: card,
        effectId: prepared.effect?.id || null,
        contextLabel: "chain_activation_commit",
      },
    );
    if (moveResult?.success === false || !player.spellTrap?.includes(card)) {
      card.isFacedown = wasFacedown;
      return {
        success: false,
        code: moveResult?.reason || "ACTIVATION_COMMIT_FAILED",
        reason: "Spell/Trap could not be committed to the Spell/Trap Zone.",
      };
    }
    prepared.committed = true;
    prepared.activationContext = {
      ...(prepared.activationContext || {}),
      fromHand: true,
      sourceZone: "hand",
      activationZone: "spellTrap",
      committed: true,
    };
    prepared.activationZone = "spellTrap";
    prepared.zone = "spellTrap";
    prepared.activationAttempt.activationZone = "spellTrap";
    refreshPreparedActivationSourceSnapshot(prepared);
    return { success: true };
  }

  if (
    zone === "spellTrap" &&
    card.isFacedown === true &&
    (card.cardKind === "spell" || card.cardKind === "trap")
  ) {
    card.isFacedown = false;
    await chainSystem.game?.presentSpellTrapActivationFlip?.(card, player, zone);
  }
  prepared.committed = true;
  prepared.activationContext = {
    ...(prepared.activationContext || {}),
    activationZone: prepared.activationZone,
    committed: true,
  };
  refreshPreparedActivationSourceSnapshot(prepared);
  return { success: true };
}

export async function prepareChainResponse(candidate, player, context = null) {
  if (!candidate?.card || !candidate?.effect || !player) {
    return { success: false, reason: "Invalid chain response." };
  }

  const sourceZone =
    candidate.zone || this.determineCardZone(candidate.card, player);
  const prepared = createPreparedActivation({
    card: candidate.card,
    player,
    controller: player,
    effect: candidate.effect,
    zone: sourceZone,
    selections: {},
    context: candidate.context || context || null,
    activationContext: {
      ...(candidate.context?.activationContext || {}),
      sourceZone:
        sourceZone,
      activationZone:
        sourceZone,
      selections: {},
    },
    selectionKind: candidate.selectionKind || null,
  });

  const responseContext = candidate.context || context || null;
  const candidateCheck = this.revalidateActivationCandidate?.(
    {
      ...candidate,
      sourceZone,
      sourceLocationVersion:
        candidate.sourceLocationVersion ?? Number(candidate.card.locationVersion ?? 0),
    },
    player,
    responseContext,
  );
  if (candidate.candidateKey && candidateCheck?.ok === false) {
    return {
      success: false,
      code: "CHAIN_RESPONSE_NO_LONGER_LEGAL",
      reason: candidateCheck.reason || "Chain response is no longer legal.",
    };
  }
  const chainCheck = this.canActivateInChain?.(
    prepared.effect,
    prepared.card,
    responseContext,
  );
  if (chainCheck?.ok === false) {
    return {
      success: false,
      code: "CHAIN_RESPONSE_NO_LONGER_LEGAL",
      reason: chainCheck.reason || "Chain response is no longer legal.",
    };
  }
  const restrictionCheck =
    this.game?.canActivateCardEffectUnderRestrictions?.(
      prepared.card,
      player,
      prepared.effect,
      { silent: true },
    );
  if (restrictionCheck?.ok === false) {
    return {
      success: false,
      code: restrictionCheck.code || "CHAIN_RESPONSE_RESTRICTED",
      reason: restrictionCheck.reason || "Chain response is restricted.",
    };
  }

  const usageCheck = this.checkActivationUsage?.(
    prepared.card,
    player,
    prepared.effect,
  );
  if (usageCheck?.ok === false) {
    return {
      success: false,
      code: usageCheck.code || "ACTIVATION_USAGE_LIMIT",
      reason: usageCheck.reason || "Effect usage limit reached.",
    };
  }

  const effectEngine = this.game?.effectEngine;
  const previewCtx = buildEffectContext(
    this,
    prepared,
    candidate.context || context,
  );
  const costDefinitions = (
    this.getActivationCostTargetDefinitions?.(prepared.effect) || []
  ).map((definition) =>
    definition.requireThisCard === true || definition.allowSelf === true
      ? definition
      : { ...definition, excludeSelf: true },
  );
  const targetDefinitions =
    this.getDeclaredTargetDefinitions?.(prepared.effect) || [];
  const previewDefinitions = [...costDefinitions, ...targetDefinitions];
  const targetPreview = effectEngine?.resolveTargets?.(
    previewDefinitions,
    previewCtx,
    null,
  );
  if (targetPreview?.ok === false && !targetPreview?.needsSelection) {
    return {
      success: false,
      code: "CHAIN_RESPONSE_TARGETS_INVALID",
      reason:
        targetPreview.reason || "Chain response targets are no longer valid.",
    };
  }
  this.game?.notify?.("activation_transaction", {
    stage: "preflight",
    cardInstanceId: prepared.card?.instanceId ?? null,
    effectId: prepared.effect?.id || null,
    sourceZone,
  });

  const providedSelections = candidate.selections || {};
  const pickSelections = (definitions) =>
    Object.fromEntries(
      definitions
        .filter((definition) => definition?.id in providedSelections)
        .map((definition) => [
          definition.id,
          providedSelections[definition.id],
        ]),
    );
  let costSelections = candidate.costSelections || pickSelections(costDefinitions);
  if (
    costDefinitions.length > 0 &&
    Object.keys(costSelections || {}).length === 0
  ) {
    costSelections = await this.getPlayerSelectionsForDefinitions?.(
      prepared.card,
      costDefinitions,
      player,
      responseContext,
      { purpose: "cost", allowCancel: true, activationZone: sourceZone },
    );
    if (costSelections == null) {
      return {
        success: false,
        cancelled: true,
        code: "ACTIVATION_COST_SELECTION_CANCELLED",
        reason: "Activation cost selection cancelled.",
      };
    }
  }
  prepared.costSelections = costSelections || {};
  prepared.selections = { ...prepared.costSelections };
  prepared.activationContext.selections = prepared.selections;

  const costs = getEffectActivationCosts(prepared.effect);
  if (
    costs.length > 0 &&
    typeof effectEngine?.checkActionPreviewRequirements === "function"
  ) {
    const costPreview = effectEngine.checkActionPreviewRequirements(costs, {
      ...previewCtx,
      preview: true,
      isPreview: true,
      _actionTargets: prepared.costSelections,
      activationContext: {
        ...previewCtx.activationContext,
        preview: true,
        selections: prepared.costSelections,
      },
    });
    if (costPreview?.ok === false) {
      return {
        success: false,
        code: costPreview.code || "ACTIVATION_COST_UNAVAILABLE",
        reason: costPreview.reason || "Activation cost cannot be paid.",
      };
    }
  }

  // Selection can keep a human prompt open. Revalidate the transaction at the
  // last cancellable boundary so state changes cannot commit a stale offer.
  const sourceZoneBeforeCommit = this.determineCardZone?.(
    prepared.card,
    player,
  );
  if (
    sourceZoneBeforeCommit !== sourceZone ||
    Number(prepared.card.locationVersion ?? 0) !==
      Number(candidate.sourceLocationVersion ?? prepared.sourceAtActivation?.locationVersion ?? 0)
  ) {
    return {
      success: false,
      code: "ACTIVATION_SOURCE_CHANGED_BEFORE_COMMIT",
      reason: "Activation source changed before it could be committed.",
    };
  }
  const finalUsageCheck = this.checkActivationUsage?.(
    prepared.card,
    player,
    prepared.effect,
  );
  if (finalUsageCheck?.ok === false) {
    return {
      success: false,
      code: finalUsageCheck.code || "ACTIVATION_USAGE_LIMIT",
      reason: finalUsageCheck.reason || "Effect usage limit reached.",
    };
  }
  const finalCostPreview = costDefinitions.length
    ? effectEngine?.resolveTargets?.(
        costDefinitions,
        previewCtx,
        prepared.costSelections,
      )
    : { ok: true };
  const finalTargetPreview = targetDefinitions.length
    ? effectEngine?.resolveTargets?.(targetDefinitions, previewCtx, null)
    : { ok: true };
  if (
    (finalCostPreview?.ok === false && !finalCostPreview?.needsSelection) ||
    (finalTargetPreview?.ok === false && !finalTargetPreview?.needsSelection)
  ) {
    return {
      success: false,
      code: "ACTIVATION_PREFLIGHT_CHANGED",
      reason: "Activation cost or target is no longer legal.",
    };
  }

  const commitResult = await commitResponseSource(this, prepared);
  if (!commitResult.success) return commitResult;
  this.game?.notify?.("activation_transaction", {
    stage: "source_committed",
    cardInstanceId: prepared.card?.instanceId ?? null,
    effectId: prepared.effect?.id || null,
    sourceZone,
    activationZone: prepared.activationZone,
  });

  this.isPreparingActivation = true;
  try {
    const costResult = await this.payActivationCosts(
      prepared,
      candidate.context || context,
    );
    if (!costResult.success) return costResult;
  } finally {
    this.isPreparingActivation = false;
  }

  this.game?.notify?.("activation_transaction", {
    stage: "cost_paid",
    cardInstanceId: prepared.card?.instanceId ?? null,
    effectId: prepared.effect?.id || null,
    costPayment: prepared.costPayment,
  });

  let targetSelections =
    candidate.targetSelections || pickSelections(targetDefinitions);
  if (
    targetDefinitions.length > 0 &&
    Object.keys(targetSelections || {}).length === 0
  ) {
    targetSelections = await this.getPlayerSelectionsForDefinitions?.(
      prepared.card,
      targetDefinitions,
      player,
      responseContext,
      {
        purpose: "target",
        allowCancel: false,
        activationZone: prepared.activationZone,
      },
    );
    if (targetSelections == null) {
      return {
        success: false,
        committed: true,
        costsPaid: true,
        code: "ACTIVATION_TARGET_SELECTION_FAILED_AFTER_COMMIT",
        reason: "Required activation targets could not be declared.",
      };
    }
  }
  prepared.targetSelections = targetSelections || {};
  prepared.selections = {
    ...prepared.costSelections,
    ...prepared.targetSelections,
  };
  prepared.activationContext.selections = prepared.selections;
  const currentVersion = Number(prepared.card?.locationVersion ?? 0);
  if (
    prepared.sourceAtActivation &&
    currentVersion !== Number(prepared.sourceAtActivation.locationVersion ?? 0)
  ) {
    prepared.sourceMoved = true;
    prepared.latestSourceLocation = captureSourceSnapshot(
      prepared.card,
      player,
      this.determineCardZone?.(prepared.card, player),
    );
  }
  this.game?.notify?.("activation_transaction", {
    stage: "targets_declared",
    cardInstanceId: prepared.card?.instanceId ?? null,
    effectId: prepared.effect?.id || null,
    targetIds: targetDefinitions.map((definition) => definition.id),
  });

  return { success: true, preparedActivation: prepared };
}

export async function openActivationChain(preparedInput) {
  const prepared = createPreparedActivation(preparedInput);
  const controller = prepared.controller || prepared.player;
  if (!prepared.card || !controller || !prepared.effect) {
    return { success: false, reason: "Invalid prepared activation." };
  }
  const activationType = prepared.responseContextType;
  const selectedCards = flattenDeclaredEffectTargets(
    prepared.effect,
    prepared.selections || {},
  );
  const firstTarget = selectedCards[0] || null;
  const firstTargetOwner = resolveCardOwner(this, firstTarget);
  const context = {
    ...(prepared.context || {}),
    type:
      selectedCards.length > 0
        ? "effect_targeted"
        : prepared.context?.type || activationType,
    event:
      selectedCards.length > 0
        ? "effect_targeted"
        : prepared.context?.event || activationType,
    card: prepared.card,
    effect: prepared.effect,
    player: controller,
    controller,
    triggerPlayer: controller,
    activationZone: prepared.activationZone,
    activationAttempt: prepared.activationAttempt,
    target: firstTarget,
    targetOwner: firstTargetOwner,
    targets: selectedCards,
    activationType,
    activationKind: prepared.activationKind,
    effectKind: prepared.effectKind,
    responseContextType: prepared.responseContextType,
    preparedActivation: prepared,
    addTriggerToChain: true,
  };
  return await this.runFastEffectTiming({
    origin: FAST_EFFECT_ORIGINS.ACTIVATION,
    context,
    actionPlayer: controller,
    preparedActivation: prepared,
    deferPostChainWindow:
      this.game?._flushingPendingChainEvents === true,
  });
}

export async function openEventWindow(context = {}) {
  const origin =
    context.timingOrigin ||
    (context.type === "summon_attempt"
      ? FAST_EFFECT_ORIGINS.SUMMON_ATTEMPT
      : context.event === "phase_start"
        ? FAST_EFFECT_ORIGINS.PHASE_START
        : context.event === "phase_end"
          ? FAST_EFFECT_ORIGINS.PHASE_TRANSITION_INTENT
          : FAST_EFFECT_ORIGINS.ACTION_WITHOUT_CHAIN);
  return await this.runFastEffectTiming({
    origin,
    actionPlayer: context.player || context.triggerPlayer || null,
    priorityPlayer:
      origin === FAST_EFFECT_ORIGINS.SUMMON_ATTEMPT
        ? this.getOpponent?.(context.player || context.triggerPlayer)
        : null,
    phaseIntent:
      origin === FAST_EFFECT_ORIGINS.PHASE_TRANSITION_INTENT
        ? {
            fromPhase: context.fromPhase || context.currentPhase || null,
            toPhase: context.toPhase || context.nextPhase || null,
          }
        : null,
    context: {
      ...context,
      addTriggerToChain: false,
      skipTriggerLink: true,
    },
  });
}
