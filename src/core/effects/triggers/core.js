import { getCardDisplayName, getUIText } from "../../i18n.js";
import { isAI } from "../../Player.js";

const AUTOMATIC_TRIGGER_ACTION_TYPES = new Set([
  "forbid_attack_this_turn",
  "forbid_direct_attack_this_turn",
  "permanent_buff_named",
  "remove_permanent_buff_named",
  "add_counter",
  "remove_counter",
]);

function hasRegisteredTriggerActions(effect, actionHandlers) {
  const actions = Array.isArray(effect?.actions) ? effect.actions : [];
  if (actions.length === 0) return false;

  return actions.some((action) => {
    const actionType = action?.type;
    if (!actionType || typeof actionType !== "string") return false;
    if (!actionHandlers || typeof actionHandlers.has !== "function") return true;
    return actionHandlers.has(actionType);
  });
}

function isAutomaticTriggeredEffect(effect) {
  const actions = Array.isArray(effect?.actions) ? effect.actions : [];
  if (actions.length === 0) return false;

  return actions.every((action) =>
    AUTOMATIC_TRIGGER_ACTION_TYPES.has(action?.type)
  );
}

function isPromptOwnedTriggeredEffect(effect) {
  const actions = Array.isArray(effect?.actions) ? effect.actions : [];
  if (actions.length === 0) return false;

  return actions.every((action) => {
    if (!action || action.optional === false) return false;
    return action.type === "conditional_summon_from_hand";
  });
}

function getActionTargetRefs(action) {
  const refs = new Set();
  if (!action || typeof action !== "object") return refs;

  if (typeof action.targetRef === "string") refs.add(action.targetRef);
  if (typeof action.costTargetRef === "string") refs.add(action.costTargetRef);

  const nestedActionLists = [
    action.actions,
    action.thenActions,
    action.elseActions,
    action.onSuccessActions,
  ];
  for (const list of nestedActionLists) {
    if (!Array.isArray(list)) continue;
    for (const nested of list) {
      for (const ref of getActionTargetRefs(nested)) refs.add(ref);
    }
  }

  if (Array.isArray(action.cases)) {
    for (const caseEntry of action.cases) {
      const caseActions = Array.isArray(caseEntry?.actions)
        ? caseEntry.actions
        : [];
      for (const nested of caseActions) {
        for (const ref of getActionTargetRefs(nested)) refs.add(ref);
      }
    }
  }

  return refs;
}

function actionCanResolveWithSelectionRequirements(action, requirementById) {
  const targetRefs = getActionTargetRefs(action);
  if (targetRefs.size === 0) return true;

  for (const targetRef of targetRefs) {
    const requirement = requirementById.get(targetRef);
    if (!requirement) continue;

    const candidates = Array.isArray(requirement.candidates)
      ? requirement.candidates
      : [];
    if (candidates.length === 0) return false;
  }

  return true;
}

function hasResolvableSelectionTargetActions(effect, targetPreview) {
  if (!targetPreview?.needsSelection) return true;

  const requirements =
    targetPreview?.selectionContract?.requirements || [];
  if (requirements.length === 0) return false;

  const requirementById = new Map(
    requirements
      .filter((req) => req?.id)
      .map((req) => [req.id, req]),
  );
  const actions = Array.isArray(effect?.actions) ? effect.actions : [];
  if (actions.length === 0) return true;

  return actions.some((action) =>
    actionCanResolveWithSelectionRequirements(action, requirementById),
  );
}

function shouldPromptTriggeredEffect(effect, owner, ctx) {
  if (!effect || effect.timing !== "on_event") return false;
  if (!owner || isAI(owner)) return false;
  if (ctx?.activationContext?.skipPrompt === true) return false;
  if (ctx?.activationContext?.preview === true) return false;
  if (ctx?.activationContext?.isPreview === true) return false;
  if (
    effect.event === "attack_declared" &&
    effect.promptOnAttackDeclared === false
  ) {
    return false;
  }
  if (effect.event === "effect_targeted" && effect.promptOnTargeted === false) {
    return false;
  }
  if (effect.promptUser === true) return true;
  if (effect.promptUser === false) return false;
  if (isAutomaticTriggeredEffect(effect)) return false;
  if (isPromptOwnedTriggeredEffect(effect)) return false;
  return true;
}

async function confirmTriggeredEffect(effect, sourceCard, owner, ui, ctx) {
  if (!shouldPromptTriggeredEffect(effect, owner, ctx)) return true;

  let wantsToUse = true;
  const promptName =
    getCardDisplayName(sourceCard) ||
    sourceCard?.name ||
    getUIText("ui.prompts.thisCard");

  if (effect.customPromptMethod && ui?.[effect.customPromptMethod]) {
    wantsToUse = await ui[effect.customPromptMethod]();
  } else if (ui?.showConfirmPrompt) {
    let promptMessage = effect.promptMessage;
    if (!promptMessage) {
      if (effect.event === "attack_declared") {
        promptMessage =
          sourceCard?.cardKind === "trap"
            ? getUIText("ui.prompts.triggeredAttackTrap", {
                cardName: promptName,
              })
            : getUIText("ui.prompts.triggeredAttackEffect", {
                cardName: promptName,
              });
      } else if (effect.event === "effect_targeted") {
        promptMessage = getUIText("ui.prompts.triggeredTargeted", {
          cardName: promptName,
        });
      } else {
        promptMessage = getUIText("ui.prompts.triggeredEffect", {
          cardName: promptName,
        });
      }
    }
    const confirmResult = ui.showConfirmPrompt(promptMessage, {
      kind: "triggered_effect",
      cardName: promptName,
      effectId: effect.id,
      event: effect.event,
    });
    wantsToUse =
      confirmResult && typeof confirmResult.then === "function"
        ? await confirmResult
        : !!confirmResult;
  }

  return !!wantsToUse;
}

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
  ctx.effect = ctx.effect || effect;
  ctx.effectId = ctx.effectId || effect?.id || null;

  const targetResult = this.resolveTargets(
    effect.targets || [],
    ctx,
    selections || null
  );

  if (targetResult.needsSelection) {
    if (!hasResolvableSelectionTargetActions(effect, targetResult)) {
      return {
        success: false,
        needsSelection: false,
        activationSkipped: true,
        reason: "No valid targets for this effect.",
      };
    }
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

  const activationZone =
    ctx?.activationContext?.activationZone ||
    ctx?.activationContext?.sourceZone ||
    (ctx?.player && this.findCardZone?.(ctx.player, sourceCard)) ||
    null;
  const queuedActivationFeedback = this.game?.queueVisualFeedback?.({
    kind: "effect-activation",
    sourceCard,
    ownerId: ctx?.player?.id || sourceCard?.owner || null,
    fromZone: activationZone,
    tone: sourceCard?.cardKind === "monster" ? "violet" : "gold",
  });
  if (queuedActivationFeedback && isAI(ctx?.player)) {
    this.game?.updateBoard?.();
    if (typeof this.game?.waitForAiPresentationStep === "function") {
      await this.game.waitForAiPresentationStep(ctx.player);
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
  if (
    actionsResult &&
    typeof actionsResult === "object" &&
    actionsResult.success === false
  ) {
    return {
      success: false,
      needsSelection: false,
      reason: actionsResult.reason || "Triggered effect actions failed.",
      actionResult: actionsResult,
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

function mergeStrategyActivationContext(baseContext, extraContext) {
  if (!extraContext || typeof extraContext !== "object") return baseContext;
  const baseActionContext = baseContext?.actionContext || {};
  const extraActionContext = extraContext.actionContext || {};
  return {
    ...baseContext,
    ...extraContext,
    actionContext: {
      ...baseActionContext,
      ...extraActionContext,
      targetPreferences: {
        ...(baseActionContext.targetPreferences || {}),
        ...(extraActionContext.targetPreferences || {}),
      },
      costPreferences:
        extraActionContext.costPreferences || baseActionContext.costPreferences,
      specialSummonPositions: {
        ...(baseActionContext.specialSummonPositions || {}),
        ...(extraActionContext.specialSummonPositions || {}),
        byName: {
          ...(baseActionContext.specialSummonPositions?.byName || {}),
          ...(extraActionContext.specialSummonPositions?.byName || {}),
        },
        byTargetRef: {
          ...(baseActionContext.specialSummonPositions?.byTargetRef || {}),
          ...(extraActionContext.specialSummonPositions?.byTargetRef || {}),
        },
      },
    },
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

  if (
    typeof options.activate !== "function" &&
    !hasRegisteredTriggerActions(effect, this.actionHandlers)
  ) {
    return null;
  }

  let activationContext =
    options.activationContext ||
    this.buildTriggerActivationContext(
      sourceCard,
      owner,
      options.activationZone
    );
  const strategyContext =
    typeof owner.strategy?.buildActivationContextForEffect === "function"
      ? owner.strategy.buildActivationContextForEffect({
          sourceCard,
          effect,
          player: owner,
          game: this.game,
          activationZone: activationContext.activationZone,
        })
      : null;
  activationContext = mergeStrategyActivationContext(
    activationContext,
    strategyContext,
  );
  const selectionKind = options.selectionKind || "triggered";
  const selectionMessage =
    options.selectionMessage || getUIText("ui.triggers.selection");
  const summary =
    options.summary ||
    `${owner.id}:${sourceCard.name}:${effect.id || effect.event || "trigger"}`;

  const triggerGuard = this.game?.canStartAction?.({
    actor: owner,
    kind: options.guardKind || selectionKind || "triggered",
    phaseReq: options.phaseReq || null,
    allowDuringSelection: options.allowDuringSelection === true,
    allowDuringResolving: options.allowDuringResolving !== false,
    allowDuringOpponentTurn: options.allowDuringOpponentTurn !== false,
    silent: true,
  });
  if (triggerGuard?.ok === false) {
    // Arcturus-style battle locks are real activation rules. Skipping the
    // trigger here keeps analytics focused on bad AI actions instead of
    // recording a blocked activation attempt that could never resolve.
    if (triggerGuard.code === "BLOCKED_BATTLE_PHASE_LOCK") {
      return null;
    }
  }

  const baseCtx = options.ctx || {};
  const previewCtx = {
    ...baseCtx,
    source: baseCtx.source || sourceCard,
    player: baseCtx.player || owner,
    opponent: baseCtx.opponent || this.game?.getOpponent?.(owner) || null,
    activationZone: activationContext.activationZone,
    activationContext: {
      ...activationContext,
      preview: true,
    },
    effect,
  };
  const actionPreview =
    typeof this.checkActionPreviewRequirements === "function"
      ? this.checkActionPreviewRequirements(effect.actions || [], previewCtx)
      : { ok: true };
  if (actionPreview?.ok === false) {
    return null;
  }

  if (Array.isArray(effect.targets) && effect.targets.length > 0) {
    const targetPreview = this.resolveTargets(effect.targets, previewCtx, null);
    if (targetPreview?.ok === false && !targetPreview.needsSelection) {
      return null;
    }
    if (!hasResolvableSelectionTargetActions(effect, targetPreview)) {
      return null;
    }
  }

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
    activate: async (selections, activationCtx) => {
      const resolvedCtx = {
        ...baseCtx,
        activationZone: activationCtx.activationZone,
        activationContext: activationCtx,
      };
      const livePreviewCtx = {
        ...resolvedCtx,
        source: resolvedCtx.source || sourceCard,
        player: resolvedCtx.player || owner,
        opponent:
          resolvedCtx.opponent || this.game?.getOpponent?.(owner) || null,
        activationContext: {
          ...activationCtx,
          preview: true,
        },
        effect,
      };
      const liveActionPreview =
        typeof this.checkActionPreviewRequirements === "function"
          ? this.checkActionPreviewRequirements(
              effect.actions || [],
              livePreviewCtx,
            )
          : { ok: true };
      if (liveActionPreview?.ok === false) {
        return {
          success: false,
          needsSelection: false,
          activationSkipped: true,
          reason:
            liveActionPreview.reason || "Effect cannot be resolved right now.",
        };
      }
      if (Array.isArray(effect.targets) && effect.targets.length > 0) {
        const livePreview = this.resolveTargets(
          effect.targets,
          livePreviewCtx,
          null,
        );
        if (livePreview?.ok === false && !livePreview.needsSelection) {
          return {
            success: false,
            needsSelection: false,
            activationSkipped: true,
            reason: livePreview.reason || "No valid targets for this effect.",
          };
        }
        if (!hasResolvableSelectionTargetActions(effect, livePreview)) {
          return {
            success: false,
            needsSelection: false,
            activationSkipped: true,
            reason: "No valid targets for this effect.",
          };
        }
      }
      if (selections == null) {
        const wantsToUse = await confirmTriggeredEffect(
          effect,
          sourceCard,
          owner,
          this.ui,
          resolvedCtx
        );
        if (!wantsToUse) {
          return {
            success: false,
            needsSelection: false,
            reason: "Effect activation cancelled.",
          };
        }
      }
      return activateImpl(selections, activationCtx, resolvedCtx);
    },
    onSuccess: async (result, activationCtx) => {
      this.registerOncePerTurnUsage(sourceCard, owner, effect);
      this.registerOncePerDuelUsage(sourceCard, owner, effect);
      if (typeof options.onSuccess === "function") {
        await options.onSuccess(result, activationCtx);
      }
      if (typeof this.game?.emitEffectActivated === "function") {
        await this.game.emitEffectActivated({
          card: sourceCard,
          player: owner,
          effect,
          activationZone:
            activationCtx?.activationZone || activationContext.activationZone,
          activationContext: activationCtx,
          effectType: "triggered",
          sourceEvent: effect.event || null,
        });
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
