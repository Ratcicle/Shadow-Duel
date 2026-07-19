import { isQuickSpell } from "../game/spellTrap/quickSpellRules.js";
import {
  CHAIN_ACTIVATION_KINDS,
  buildUsagePolicy,
  captureSourceSnapshot,
  classifyActivationKind,
  classifyEffectKind,
  getResponseContextType,
} from "./link.js";
import {
  capCostDefinitionsByLinkedTargetCapacity,
  resolveCountFromSelectionDefinitions,
} from "./selection.js";
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

export function getEffectActivationCosts(effect) {
  return Array.isArray(effect?.activationCosts) ? effect.activationCosts : [];
}

export function getEffectActivationCommitActions(effect) {
  return Array.isArray(effect?.activationCommitActions)
    ? effect.activationCommitActions
    : [];
}

export function getEffectResolutionActions(effect) {
  return Array.isArray(effect?.actions) ? effect.actions : [];
}

export function createPreparedActivation(input = {}) {
  const removedFields = [
    "player",
    "zone",
    "activationType",
    "negated",
    "selections",
    "skipUsageRegistration",
  ].filter((field) => Object.hasOwn(input, field));
  const nestedRemovedFields = [
    "player",
    "zone",
    "activationType",
    "negated",
  ].filter((field) => Object.hasOwn(input.activationAttempt || {}, field));
  const contextRemovedFields = Object.hasOwn(
    input.activationContext || {},
    "selections",
  )
    ? ["activationContext.selections"]
    : [];
  if (
    removedFields.length > 0 ||
    nestedRemovedFields.length > 0 ||
    contextRemovedFields.length > 0
  ) {
    throw new TypeError(
      `PreparedActivation contains removed fields: ${[
        ...removedFields,
        ...nestedRemovedFields.map((field) => `activationAttempt.${field}`),
        ...contextRemovedFields,
      ].join(", ")}`,
    );
  }
  const card = input.card || null;
  const controller = input.controller || null;
  const effect = input.effect || null;
  const activationZone = input.activationZone || null;
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
    effect,
    effectId: effect?.id || null,
    activationKind,
    activationZone,
    activationNegated: activationAttempt.activationNegated === true,
  };
  const costSelections = input.costSelections || {};
  const targetSelections = input.targetSelections || {};
  const resolutionSelections = input.resolutionSelections || {};

  const prepared = {
    ...input,
    card,
    controller,
    effect,
    activationZone,
    costSelections,
    targetSelections,
    resolutionSelections,
    costPayment: input.costPayment || null,
    activationCommitment:
      input.activationCommitment ||
      activationContext.activationCommitment ||
      null,
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
  return prepared;
}

export function refreshPreparedActivationSourceSnapshot(prepared) {
  if (!prepared?.card) return prepared;
  const controller = prepared.controller || null;
  const activationZone = prepared.activationZone || null;
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
  const player = prepared.controller;
  const activationContext = {
    ...(prepared.activationContext || {}),
    activationZone: prepared.activationZone,
    sourceZone:
      prepared.activationContext?.sourceZone ||
      prepared.sourceZone ||
      prepared.activationZone,
    committed: prepared.committed === true,
    costSelections: prepared.costSelections || {},
    targetSelections: prepared.targetSelections || {},
    resolutionSelections: prepared.resolutionSelections || {},
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
    link.targetSelections || {},
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
    costPayment: link.costPayment || null,
    activationCommitment: link.activationCommitment || null,
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
    prepared.costSelections || {},
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

export async function applyActivationCommitActions(prepared, context = null) {
  if (prepared?.activationCommitment?.status === "applied") {
    return { success: true, needsSelection: false, alreadyApplied: true };
  }
  const actions = getEffectActivationCommitActions(prepared?.effect);
  if (actions.length === 0) {
    prepared.activationCommitment = { status: "not_required", actions: [] };
    return { success: true, needsSelection: false };
  }
  const effectEngine = this.game?.effectEngine;
  if (!effectEngine?.applyActions) {
    return {
      success: false,
      reason: "No effect engine available for activation commitment.",
    };
  }

  const ctx = buildEffectContext(this, prepared, context);
  ctx.activationContext.applyingActivationCommitActions = true;
  const selections = {
    ...(prepared.costSelections || {}),
    ...(prepared.targetSelections || {}),
  };
  const result = await effectEngine.applyActions(actions, ctx, selections);
  if (result?.needsSelection) {
    return {
      ...result,
      success: false,
      reason:
        result.reason ||
        "Activation commitment actions must be fully determined before targets are declared.",
    };
  }
  if (result && typeof result === "object" && result.success === false) {
    return result;
  }
  prepared.activationCommitment = {
    status: "applied",
    actions: actions.map((action, index) => ({
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
        player: prepared.controller,
        controller: prepared.controller,
        triggerPlayer: prepared.controller,
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
  const player = prepared.controller;
  const zone = prepared.activationZone;
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
    candidate.sourceZone || this.determineCardZone(candidate.card, player);
  const prepared = createPreparedActivation({
    card: candidate.card,
    controller: player,
    effect: candidate.effect,
    activationZone: sourceZone,
    costSelections: {},
    targetSelections: {},
    resolutionSelections: {},
    context: candidate.context || context || null,
    activationContext: {
      ...(candidate.context?.activationContext || {}),
      sourceZone:
        sourceZone,
      activationZone:
        sourceZone,
      costSelections: {},
      targetSelections: {},
      resolutionSelections: {},
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
  const costSelectionDefinitions = capCostDefinitionsByLinkedTargetCapacity(
    costDefinitions,
    targetDefinitions,
    effectEngine,
    previewCtx,
  );
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
    duelCardId: this.game?.ensureDuelCardId?.(prepared.card) ?? null,
    effectId: prepared.effect?.id || null,
    sourceZone,
  });

  let costSelections = candidate.costSelections || {};
  if (
    costSelectionDefinitions.length > 0 &&
    Object.keys(costSelections || {}).length === 0
  ) {
    costSelections = await this.getPlayerSelectionsForDefinitions?.(
      prepared.card,
      costSelectionDefinitions,
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
  prepared.activationContext.costSelections = { ...prepared.costSelections };

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
        costSelections: prepared.costSelections,
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
  const commitActions = getEffectActivationCommitActions(prepared.effect);
  if (
    commitActions.length > 0 &&
    typeof effectEngine?.checkActionPreviewRequirements === "function"
  ) {
    const commitmentPreview = effectEngine.checkActionPreviewRequirements(
      commitActions,
      {
        ...previewCtx,
        preview: true,
        isPreview: true,
        _actionTargets: prepared.costSelections,
        activationContext: {
          ...previewCtx.activationContext,
          preview: true,
          costSelections: prepared.costSelections,
          applyingActivationCommitActions: true,
        },
      },
    );
    if (commitmentPreview?.ok === false) {
      return {
        success: false,
        code:
          commitmentPreview.code || "ACTIVATION_COMMITMENT_UNAVAILABLE",
        reason:
          commitmentPreview.reason ||
          "Activation commitment cannot be applied.",
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
  const finalCostPreview = costSelectionDefinitions.length
    ? effectEngine?.resolveTargets?.(
        costSelectionDefinitions,
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

  const resolvedTargetDefinitions = resolveCountFromSelectionDefinitions(
    targetDefinitions,
    prepared.costSelections,
  );
  const resolvedTargetPreview = resolvedTargetDefinitions.length
    ? effectEngine?.resolveTargets?.(
        resolvedTargetDefinitions,
        previewCtx,
        null,
      )
    : { ok: true };
  if (
    resolvedTargetPreview?.ok === false &&
    !resolvedTargetPreview?.needsSelection
  ) {
    return {
      success: false,
      code: "ACTIVATION_TARGET_COUNT_UNAVAILABLE",
      reason: "The selected activation cost cannot be matched by legal targets.",
    };
  }

  const commitResult = await commitResponseSource(this, prepared);
  if (!commitResult.success) return commitResult;
  this.game?.notify?.("activation_transaction", {
    stage: "source_committed",
    cardInstanceId: prepared.card?.instanceId ?? null,
    duelCardId: this.game?.ensureDuelCardId?.(prepared.card) ?? null,
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
    duelCardId: this.game?.ensureDuelCardId?.(prepared.card) ?? null,
    effectId: prepared.effect?.id || null,
    costPayment: prepared.costPayment,
  });

  this.isPreparingActivation = true;
  let commitmentResult;
  try {
    commitmentResult = await this.applyActivationCommitActions(
      prepared,
      candidate.context || context,
    );
  } finally {
    this.isPreparingActivation = false;
  }
  if (!commitmentResult.success) {
    return {
      ...commitmentResult,
      committed: true,
      costsPaid: prepared.costsPaid === true,
      noRollback: true,
    };
  }
  if (prepared.activationCommitment?.status === "applied") {
    this.game?.notify?.("activation_transaction", {
      stage: "commit_actions_applied",
      cardInstanceId: prepared.card?.instanceId ?? null,
      duelCardId: this.game?.ensureDuelCardId?.(prepared.card) ?? null,
      effectId: prepared.effect?.id || null,
      activationCommitment: prepared.activationCommitment,
    });
  }

  let targetSelections =
    candidate.targetSelections || {};
  if (
    resolvedTargetDefinitions.length > 0 &&
    Object.keys(targetSelections || {}).length === 0
  ) {
    targetSelections = await this.getPlayerSelectionsForDefinitions?.(
      prepared.card,
      resolvedTargetDefinitions,
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
  const finalDeclaredTargetPreview = resolvedTargetDefinitions.length
    ? effectEngine?.resolveTargets?.(
        resolvedTargetDefinitions,
        previewCtx,
        prepared.targetSelections,
      )
    : { ok: true };
  if (
    finalDeclaredTargetPreview?.ok === false ||
    finalDeclaredTargetPreview?.needsSelection
  ) {
    return {
      success: false,
      committed: true,
      costsPaid: true,
      code: "ACTIVATION_TARGET_COUNT_MISMATCH",
      reason: "Declared targets do not match the paid activation cost.",
    };
  }
  prepared.activationContext.costSelections = { ...prepared.costSelections };
  prepared.activationContext.targetSelections = {
    ...prepared.targetSelections,
  };
  prepared.resolvedSelectionCounts = Object.fromEntries(
    resolvedTargetDefinitions
      .filter((definition) => definition?.resolvedCountFromSelectionRef)
      .map((definition) => [
        definition.id,
        Number(definition.resolvedSelectionCount ?? 0),
      ]),
  );
  prepared.activationContext.resolvedSelectionCounts = {
    ...prepared.resolvedSelectionCounts,
  };
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
    duelCardId: this.game?.ensureDuelCardId?.(prepared.card) ?? null,
    effectId: prepared.effect?.id || null,
    targetIds: resolvedTargetDefinitions.map((definition) => definition.id),
  });

  return { success: true, preparedActivation: prepared };
}

export async function openActivationChain(preparedInput) {
  const prepared = createPreparedActivation(preparedInput);
  const controller = prepared.controller;
  if (!prepared.card || !controller || !prepared.effect) {
    return { success: false, reason: "Invalid prepared activation." };
  }
  const responseContextType = prepared.responseContextType;
  const selectedCards = flattenDeclaredEffectTargets(
    prepared.effect,
    prepared.targetSelections || {},
  );
  const firstTarget = selectedCards[0] || null;
  const firstTargetOwner = resolveCardOwner(this, firstTarget);
  const context = {
    ...(prepared.context || {}),
    type:
      selectedCards.length > 0
        ? "effect_targeted"
        : prepared.context?.type || responseContextType,
    event:
      selectedCards.length > 0
        ? "effect_targeted"
        : prepared.context?.event || responseContextType,
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
      this.game?._flushingPendingTriggerOccurrences === true,
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
