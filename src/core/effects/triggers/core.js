/**
 * Trigger core handling - handleTriggeredEffect, buildTriggerActivationContext, buildTriggerEntry
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

/**
 * Handles a triggered effect, resolving targets and applying actions.
 * @param {Object} sourceCard - The card triggering the effect
 * @param {Object} effect - The effect definition
 * @param {Object} ctx - The context object
 * @param {Object|null} selections - Optional selections for targeting
 * @returns {Promise<Object>} Result with success/needsSelection status
 */
export async function handleTriggeredEffect(
  sourceCard,
  effect,
  ctx,
  selections = null
) {
  const targetResult = this.resolveTargets(
    effect.targets || [],
    ctx,
    selections || null
  );

  if (targetResult.needsSelection) {
    return {
      success: false,
      needsSelection: true,
      selectionContract: targetResult.selectionContract,
    };
  }

  if (targetResult.ok === false) {
    return {
      success: false,
      needsSelection: false,
      reason: targetResult.reason,
    };
  }

  if (selections && typeof selections === "object") {
    ctx.selections = selections;
    if (
      ctx.activationContext &&
      typeof ctx.activationContext === "object" &&
      !ctx.activationContext.selections
    ) {
      ctx.activationContext.selections = selections;
    }
  }

  const actionsResult = await this.applyActions(
    effect.actions || [],
    ctx,
    targetResult.targets || {}
  );
  if (
    actionsResult &&
    typeof actionsResult === "object" &&
    actionsResult.needsSelection
  ) {
    return {
      success: false,
      needsSelection: true,
      selectionContract: actionsResult.selectionContract,
      ...actionsResult,
    };
  }

  // Record material effect activation for ascension tracking
  const owner = ctx?.player;
  if (
    owner &&
    sourceCard?.cardKind === "monster" &&
    typeof sourceCard.id === "number"
  ) {
    this.game.recordMaterialEffectActivation(owner, sourceCard, {
      contextLabel: "triggered",
      effectId: effect.id,
    });
  }

  this.game.checkWinCondition();

  return { success: true, needsSelection: false };
}

/**
 * Builds the activation context for a triggered effect.
 * @param {Object} sourceCard - The source card
 * @param {Object} player - The player who owns the card
 * @param {string|null} zoneOverride - Optional zone override
 * @returns {Object} The activation context
 */
export function buildTriggerActivationContext(
  sourceCard,
  player,
  zoneOverride = null
) {
  const activationZone =
    zoneOverride || this.findCardZone(player, sourceCard) || "field";
  return {
    fromHand: activationZone === "hand",
    activationZone,
    sourceZone: activationZone,
    committed: false,
  };
}

/**
 * Builds a trigger entry for chain/activation handling.
 * @param {Object} options - Configuration options
 * @param {Object} options.sourceCard - The source card
 * @param {Object} options.owner - The owning player
 * @param {Object} options.effect - The effect definition
 * @param {Object} [options.activationContext] - Optional activation context
 * @param {string} [options.selectionKind] - Kind of selection (default: "triggered")
 * @param {string} [options.selectionMessage] - Message for selection UI
 * @param {string} [options.summary] - Summary string for debugging
 * @param {Object} [options.ctx] - Base context object
 * @param {Function} [options.activate] - Custom activate implementation
 * @param {Function} [options.onSuccess] - Callback on successful activation
 * @returns {Object|null} The trigger entry or null if invalid
 */
export function buildTriggerEntry(options = {}) {
  const sourceCard = options.sourceCard;
  const owner = options.owner;
  const effect = options.effect;

  if (!sourceCard || !owner || !effect) {
    return null;
  }

  const activationContext =
    options.activationContext ||
    this.buildTriggerActivationContext(
      sourceCard,
      owner,
      options.activationZone
    );
  const selectionKind = options.selectionKind || "triggered";
  const selectionMessage =
    options.selectionMessage || "Select target(s) for the triggered effect.";
  const summary =
    options.summary ||
    `${owner.id}:${sourceCard.name}:${effect.id || effect.event || "trigger"}`;

  const baseCtx = options.ctx || {};
  const activateImpl =
    options.activate ||
    ((selections, activationCtx, resolvedCtx) =>
      this.handleTriggeredEffect(sourceCard, effect, resolvedCtx, selections));

  const config = {
    card: sourceCard,
    owner,
    activationZone: activationContext.activationZone,
    activationContext,
    selectionKind,
    selectionMessage,
    allowDuringOpponentTurn: true,
    allowDuringResolving: true,
    suppressFailureLog: true,
    oncePerTurn: {
      card: sourceCard,
      player: owner,
      effect,
    },
    activate: (selections, activationCtx) => {
      const resolvedCtx = {
        ...baseCtx,
        activationZone: activationCtx.activationZone,
        activationContext: activationCtx,
      };
      return activateImpl(selections, activationCtx, resolvedCtx);
    },
    onSuccess: (result, activationCtx) => {
      this.registerOncePerTurnUsage(sourceCard, owner, effect);
      this.registerOncePerDuelUsage(sourceCard, owner, effect);
      if (typeof options.onSuccess === "function") {
        options.onSuccess(result, activationCtx);
      }
    },
  };

  return {
    summary,
    card: sourceCard,
    effect,
    owner,
    config,
  };
}
