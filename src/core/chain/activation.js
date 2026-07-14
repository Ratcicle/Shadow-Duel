import { isQuickSpell } from "../game/spellTrap/quickSpellRules.js";

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

export function createPreparedActivation(input = {}) {
  const card = input.card || null;
  const player = input.player || null;
  const effect = input.effect || null;
  const zone = input.zone || input.activationZone || null;
  const activationAttempt =
    input.activationAttempt || {
      card,
      player,
      effect,
      activationZone: zone,
      negated: false,
    };

  return {
    ...input,
    card,
    player,
    effect,
    zone,
    selections: input.selections || {},
    activationContext: input.activationContext || {},
    activationAttempt,
    committed: input.committed === true,
    costsPaid: input.costsPaid === true,
    prepared: true,
    requiresSourceAtResolution:
      typeof input.requiresSourceAtResolution === "boolean"
        ? input.requiresSourceAtResolution
        : effectRequiresSourceAtResolution(card, effect, zone),
  };
}

function buildEffectContext(chainSystem, prepared, context = null) {
  const player = prepared.player;
  const activationContext = {
    ...(prepared.activationContext || {}),
    activationZone: prepared.zone,
    sourceZone:
      prepared.activationContext?.sourceZone || prepared.sourceZone || prepared.zone,
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
    activationZone: prepared.zone,
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
  const basePayload = {
    card: link.card,
    source: link.card,
    sourceCard: link.card,
    player: link.player,
    owner: link.player,
    effect: link.effect,
    effectId: link.effect?.id || null,
    effectType: link.effect?.timing || "chain",
    activationZone: link.zone || null,
    fromZone: link.activationContext?.sourceZone || link.zone || null,
    fromHand: link.activationContext?.fromHand === true,
    chainLevel: link.chainLevel,
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
      orderRule: result.orderRule || null,
      onComplete: result.onComplete || null,
    });
  };

  if (link.card?.cardKind === "spell") {
    collectPackage(
      "spell_activated",
      await game.emit?.("spell_activated", basePayload, {
        collectTriggersOnly: true,
      }),
    );
  } else if (link.card?.cardKind === "trap") {
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
      source: link.card,
      sourceCard: link.card,
      player: link.player,
      effect: link.effect,
      actionContext: link.context || null,
      target,
      targetOwner,
      targets: selectedCards,
      chainLevel: link.chainLevel,
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
  return { success: true, needsSelection: false };
}

export async function appendActivationTriggerPackages(
  publicationResult,
  parentContext = null,
) {
  const pending = Array.isArray(publicationResult?.triggerPackages)
    ? [...publicationResult.triggerPackages]
    : [];
  let added = 0;

  while (pending.length > 0) {
    const eventPackage = pending.shift();
    if (!eventPackage || !Array.isArray(eventPackage.entries)) continue;
    if (typeof eventPackage.onComplete === "function") {
      this.chainEventCompletions = this.chainEventCompletions || [];
      this.chainEventCompletions.push(eventPackage.onComplete);
    }

    for (const entry of eventPackage.entries) {
      const config = entry?.config || entry?.pipeline || entry;
      if (!config || typeof config.activate !== "function") continue;
      if (entry?.card && entry?.effect) {
        const offered = this.chainTriggerEffectsOffered || new Map();
        const effects = offered.get(entry.card) || new Set();
        if (effects.has(entry.effect)) continue;
        effects.add(entry.effect);
        offered.set(entry.card, effects);
        this.chainTriggerEffectsOffered = offered;
      }

      const preparation = await this.game?.runActivationPipelineWait?.({
        ...config,
        prepareForExistingChain: true,
        allowDuringChainWindow: true,
      });
      if (!preparation?.success || !preparation.preparedActivation) {
        continue;
      }

      const prepared = preparation.preparedActivation;
      const eventContext = {
        ...(parentContext || {}),
        ...(eventPackage.payload || {}),
        type: eventPackage.eventName,
        event: eventPackage.eventName,
        card: prepared.card,
        effect: prepared.effect,
        player: prepared.player,
        triggerPlayer: prepared.player,
        addTriggerToChain: false,
        activationContext: prepared.activationContext || null,
      };
      prepared.context = eventContext;
      const link = this.addToChain(prepared);
      added += 1;
      const nestedPublication = await this.publishChainLinkActivation?.(link);
      if (Array.isArray(nestedPublication?.triggerPackages)) {
        pending.push(...nestedPublication.triggerPackages);
      }
    }
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
  const { card, player, zone } = prepared;
  if (!card || !player) {
    return { success: false, reason: "Missing response card or player." };
  }

  if (zone === "hand" && isQuickSpell(card)) {
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
        reason: "Quick Spell could not be committed to the Spell/Trap Zone.",
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
    prepared.zone = "spellTrap";
    prepared.activationAttempt.activationZone = "spellTrap";
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
    activationZone: prepared.zone,
    committed: true,
  };
  return { success: true };
}

export async function prepareChainResponse(candidate, player, context = null) {
  if (!candidate?.card || !candidate?.effect || !player) {
    return { success: false, reason: "Invalid chain response." };
  }

  const prepared = createPreparedActivation({
    card: candidate.card,
    player,
    effect: candidate.effect,
    zone: candidate.zone || this.determineCardZone(candidate.card, player),
    selections: candidate.selections || {},
    context: candidate.context || context || null,
    activationContext: {
      ...(candidate.context?.activationContext || {}),
      sourceZone:
        candidate.zone || this.determineCardZone(candidate.card, player),
      activationZone:
        candidate.zone || this.determineCardZone(candidate.card, player),
      selections: candidate.selections || {},
    },
  });

  const responseContext = candidate.context || context || null;
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

  const effectEngine = this.game?.effectEngine;
  const previewCtx = buildEffectContext(
    this,
    prepared,
    candidate.context || context,
  );
  const targetResult = effectEngine?.resolveTargets?.(
    prepared.effect.targets || [],
    previewCtx,
    prepared.selections || null,
  );
  if (targetResult?.needsSelection || targetResult?.ok === false) {
    return {
      success: false,
      code: "CHAIN_RESPONSE_TARGETS_INVALID",
      reason:
        targetResult?.reason || "Chain response targets are no longer valid.",
    };
  }
  prepared.selections = targetResult?.targets || prepared.selections || {};
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
      _actionTargets: prepared.selections,
      activationContext: {
        ...previewCtx.activationContext,
        preview: true,
        selections: prepared.selections,
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

  const commitResult = await commitResponseSource(this, prepared);
  if (!commitResult.success) return commitResult;

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

  return { success: true, preparedActivation: prepared };
}

export async function openActivationChain(preparedInput) {
  const prepared = createPreparedActivation(preparedInput);
  if (!prepared.card || !prepared.player || !prepared.effect) {
    return { success: false, reason: "Invalid prepared activation." };
  }
  const activationType =
    prepared.card.cardKind === "monster"
      ? "effect_activation"
      : "card_activation";
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
    player: prepared.player,
    triggerPlayer: prepared.player,
    activationZone: prepared.zone,
    activationAttempt: prepared.activationAttempt,
    target: firstTarget,
    targetOwner: firstTargetOwner,
    targets: selectedCards,
    activationType,
    preparedActivation: prepared,
    addTriggerToChain: true,
  };
  return await this.openChainWindow(context);
}

export async function openEventWindow(context = {}) {
  return await this.openChainWindow({
    ...context,
    addTriggerToChain: false,
    skipTriggerLink: true,
  });
}
