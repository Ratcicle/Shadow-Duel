/**
 * activationPipeline.js
 *
 * Activation pipeline extracted from Game.js (~460 lines total).
 * Orchestrates the canonical sequence used by every effect activation:
 *
 *   guard → gate → preview → once-per-turn check → commit → selection → finalize
 *
 * The pipeline body keeps its inner closures (`safeActivate`, `handleResult`)
 * because they recurse on selection cycles and capture the resolved card,
 * activation context, and commit info. Splitting those would either thread
 * state through every parameter or break recursion — neither is worth it.
 *
 * Public methods (bound via prototype on Game):
 *  - normalizeActivationResult
 *  - runActivationPipeline
 *  - runActivationPipelineWait
 */

import { isAI } from "../../Player.js";

export function normalizeActivationResult(result) {
  const base =
    result && typeof result === "object" && !Array.isArray(result)
      ? result
      : {};
  const needsSelection = base.needsSelection === true;
  const success = needsSelection
    ? false
    : typeof base.success === "boolean"
      ? base.success
      : base.ok === true;
  const ok = typeof base.ok === "boolean" ? base.ok : success;
  const selectionContract = base.selectionContract;

  return { ...base, success, ok, needsSelection, selectionContract };
}

export function createActionResult(result = {}) {
  const base =
    typeof result === "string"
      ? { success: false, reason: result }
      : result && typeof result === "object" && !Array.isArray(result)
        ? result
        : {};
  return normalizeActivationResult({
    success: false,
    needsSelection: false,
    ...base,
  });
}

export async function runActivationPipeline(config = {}) {
  if (!config || typeof config.activate !== "function") {
    return createActionResult({
      reason: "Invalid activation configuration.",
      code: "INVALID_ACTIVATION_CONFIG",
    });
  }

  const owner = config.owner || this.player;
  let resolvedCard = config.card;
  if (!owner || !resolvedCard) {
    return createActionResult({
      reason: "Invalid activation target.",
      code: "INVALID_ACTIVATION_TARGET",
    });
  }

  const selectionKind = config.selectionKind || "activation";
  let resolvedZone =
    config.activationZone || config.activationContext?.activationZone || null;

  const logPipeline = (tag, detail = {}) => {
    if (typeof this.devLog !== "function") return;
    const summaryBase = [
      resolvedCard?.name,
      selectionKind,
      resolvedZone || "zone",
    ]
      .filter(Boolean)
      .join(" | ");
    const summary =
      typeof detail.summary === "string" ? detail.summary : summaryBase;
    this.devLog(tag, { summary, ...detail });
  };

  const trackActivationAttempt = (result = {}, extra = {}) => {
    this._arenaTracker?.recordActivationAttempt?.({
      player: owner,
      card: resolvedCard,
      type: selectionKind,
      success: result.success === true,
      blocked:
        result.blockedByGuard === true ||
        result.blockedOncePerTurn === true ||
        extra.blocked === true,
      reason: result.reason || extra.reason || null,
      code: result.code || extra.code || null,
      turn: this.turnCounter,
    });
  };

  const guardResult = this.canStartAction({
    actor: owner,
    kind: config.guardKind || selectionKind || "activation",
    phaseReq: config.phaseReq || null,
    allowDuringSelection: config.allowDuringSelection === true,
    allowDuringResolving: config.allowDuringResolving === true,
    allowDuringOpponentTurn: config.allowDuringOpponentTurn === true,
  });
  if (!guardResult.ok) {
    logPipeline("PIPELINE_GUARD_BLOCKED", {
      reason: guardResult.reason,
      code: guardResult.code,
    });
    if (
      guardResult.reason &&
      config.suppressFailureLog !== true &&
      this.ui?.log
    ) {
      this.ui.log(guardResult.reason);
    }
    const blockedResult = {
      success: false,
      ok: false,
      needsSelection: false,
      reason: guardResult.reason,
      code: guardResult.code,
      blockedByGuard: true,
    };
    trackActivationAttempt(blockedResult, { blocked: true });
    return blockedResult;
  }

  if (typeof config.gate === "function") {
    const gateResult = config.gate();
    if (gateResult && gateResult.ok === false) {
      logPipeline("PIPELINE_PREVIEW_FAIL", { reason: gateResult.reason });
      if (gateResult.reason) {
        this.ui.log(gateResult.reason);
      }
      trackActivationAttempt({
        success: false,
        reason: gateResult.reason,
        code: gateResult.code,
      });
      return normalizeActivationResult(gateResult);
    }
  }

  if (typeof config.preview === "function") {
    const previewResult = config.preview();
    if (previewResult && previewResult.ok === false) {
      logPipeline("PIPELINE_PREVIEW_FAIL", { reason: previewResult.reason });
      if (previewResult.reason) {
        this.ui.log(previewResult.reason);
      }
      trackActivationAttempt({
        success: false,
        reason: previewResult.reason,
        code: previewResult.code,
      });
      return normalizeActivationResult(previewResult);
    }
    logPipeline("PIPELINE_PREVIEW_OK");
  } else {
    logPipeline("PIPELINE_PREVIEW_OK");
  }

  const oncePerTurnConfig = config.oncePerTurn || null;
  const activationEffect = oncePerTurnConfig?.effect || config.effect || null;
  let oncePerTurnInfo = null;
  if (oncePerTurnConfig?.effect && oncePerTurnConfig.effect.oncePerTurn) {
    const optCard = oncePerTurnConfig.card || resolvedCard;
    const optPlayer = oncePerTurnConfig.player || owner;
    const optCheck = this.canUseOncePerTurn(
      optCard,
      optPlayer,
      oncePerTurnConfig.effect,
      oncePerTurnConfig,
    );
    if (!optCheck.ok) {
      logPipeline("PIPELINE_OPT_BLOCKED", {
        reason: optCheck.reason,
        lockKey: optCheck.lockKey,
      });
      if (optCheck.reason) {
        this.ui.log(optCheck.reason);
      }
      const blockedResult = {
        success: false,
        ok: false,
        needsSelection: false,
        reason: optCheck.reason,
        blockedOncePerTurn: true,
      };
      trackActivationAttempt(blockedResult, { blocked: true });
      return blockedResult;
    }
    oncePerTurnInfo = {
      card: optCard,
      player: optPlayer,
      effect: oncePerTurnConfig.effect,
      lockKey: optCheck.lockKey,
    };
  }

  let commitInfo = null;
  if (typeof config.commit === "function") {
    commitInfo = await config.commit();
    if (!commitInfo || !commitInfo.cardRef) {
      return createActionResult({
        reason: "Activation commit failed.",
        code: "ACTIVATION_COMMIT_FAILED",
      });
    }
    resolvedCard = commitInfo.cardRef;
    resolvedZone = commitInfo.activationZone || resolvedZone;
    logPipeline("PIPELINE_COMMIT", {
      activationZone: resolvedZone,
      fromIndex: commitInfo.fromIndex,
      replacedFieldSpell: commitInfo.replacedFieldSpell?.name || null,
    });
    this.updateBoard?.();
    if (typeof this.waitForAiPresentationStep === "function") {
      await this.waitForAiPresentationStep(owner);
    }
  }

  const committed =
    config.activationContext?.committed === true || !!commitInfo;
  const fromHand =
    config.activationContext?.fromHand === true || !!commitInfo;
  const resolvedActivationZone =
    resolvedZone || config.activationContext?.activationZone || null;
  const explicitAutoSelect =
    typeof config.activationContext?.autoSelectSingleTarget === "boolean"
      ? config.activationContext.autoSelectSingleTarget
      : isAI(owner);
  const explicitAutoSelectTargets =
    typeof config.activationContext?.autoSelectTargets === "boolean"
      ? config.activationContext.autoSelectTargets
      : isAI(owner);
  const activationContext = {
    ...(config.activationContext || {}),
    fromHand,
    activationZone: resolvedActivationZone,
    sourceZone:
      config.activationContext?.sourceZone ||
      (fromHand ? "hand" : resolvedActivationZone),
    committed,
    commitInfo: config.activationContext?.commitInfo || commitInfo || null,
    autoSelectSingleTarget: explicitAutoSelect,
    autoSelectTargets: explicitAutoSelectTargets,
    selections: config.selections || null,
  };

  const safeActivate = async (selections) => {
    try {
      return await config.activate(
        selections,
        activationContext,
        resolvedActivationZone,
        resolvedCard,
        owner,
      );
    } catch (err) {
      console.error("[Game] Activation pipeline error:", err);
      const errorResult = {
        success: false,
        ok: false,
        needsSelection: false,
        reason: "Resolution failed.",
        code: "RESOLUTION_FAILED",
      };
      trackActivationAttempt(errorResult);
      return errorResult;
    }
  };

  const opensNegationWindow = (effect) =>
    Array.isArray(effect?.actions) &&
    effect.actions.some(
      (action) => action?.type === "negate_summon_or_activation_and_destroy",
    );

  const offerActivationNegationWindow = async () => {
    if (
      config.openActivationWindow === false ||
      config.activationContext?.skipActivationWindow === true ||
      opensNegationWindow(config.effect || oncePerTurnConfig?.effect) ||
      this.disableChains ||
      !this.chainSystem ||
      this.chainSystem.isChainResolving?.() ||
      this.chainSystem.isChainWindowOpen?.()
    ) {
      return { ok: true };
    }

    const activationType =
      resolvedCard.cardKind === "monster" ? "effect_activation" : "card_activation";
    const activationAttempt = {
      card: resolvedCard,
      player: owner,
      effect: config.effect || oncePerTurnConfig?.effect || null,
      activationZone: resolvedActivationZone,
      negated: false,
    };
    const context = {
      type: activationType,
      event: activationType,
      card: resolvedCard,
      player: owner,
      triggerPlayer: owner,
      activationZone: resolvedActivationZone,
      activationAttempt,
      addTriggerToChain: false,
    };

    await this.chainSystem.openChainWindow(context);
    if (activationAttempt.negated || context.negated) {
      return { ok: false, negated: true, reason: "activation_negated" };
    }
    return { ok: true };
  };

  const handleResult = async (result, fromSelection = false) => {
    const normalized = this.normalizeActivationResult(result);
    normalized.commitInfo =
      normalized.commitInfo || activationContext.commitInfo || commitInfo;
    normalized.activationZone =
      normalized.activationZone ||
      resolvedActivationZone ||
      activationContext.activationZone ||
      null;
    normalized.activationContext =
      normalized.activationContext || activationContext;
    normalized.cardRef = normalized.cardRef || resolvedCard;

    if (fromSelection) {
      logPipeline("PIPELINE_SELECTION_FINISH", {
        success: normalized.success,
        needsSelection: normalized.needsSelection,
      });
    }

    if (normalized.needsSelection) {
      const selectionContract = normalized.selectionContract;
      if (!selectionContract) {
        const selectionFailure = {
          success: false,
          ok: false,
          needsSelection: false,
          reason: "Target selection failed.",
          code: "TARGET_SELECTION_FAILED",
        };
        return handleResult(selectionFailure, true);
      }

      const allowCancel =
        activationContext.committed || config.preventCancel === true
          ? false
          : typeof config.allowCancel === "boolean"
            ? config.allowCancel
            : true;

      const normalizedContract = this.normalizeSelectionContract(
        selectionContract,
        {
          kind: selectionKind,
          message:
            config.selectionMessage || selectionContract.message || null,
          ui: {
            allowCancel,
            preventCancel:
              activationContext.committed || config.preventCancel === true,
            useFieldTargeting: config.useFieldTargeting,
            allowEmpty: config.allowEmpty,
          },
        },
      );

      if (!normalizedContract.ok) {
        const selectionFailure = {
          success: false,
          ok: false,
          needsSelection: false,
          reason: normalizedContract.reason || "Target selection failed.",
          code: "TARGET_SELECTION_FAILED",
        };
        return handleResult(selectionFailure, true);
      }

      const contract = normalizedContract.contract;
      if (typeof contract.ui.allowEmpty !== "boolean") {
        contract.ui.allowEmpty = contract.requirements.some(
          (req) => Number(req.min ?? 0) === 0,
        );
      }
      // Field-only target prompts resolve directly on the board unless the
      // contract explicitly opts in or out.
      const usingFieldTargeting =
        typeof contract.ui.useFieldTargeting === "boolean"
          ? contract.ui.useFieldTargeting
          : this.canUseFieldTargeting(contract.requirements);
      contract.ui.useFieldTargeting = usingFieldTargeting;

      if (typeof config.onSelectionStart === "function") {
        config.onSelectionStart();
      }

      logPipeline("PIPELINE_SELECTION_START", {
        mode: usingFieldTargeting ? "field" : "modal",
        committed: activationContext.committed,
        requirementCount: contract.requirements.length,
      });

      const shouldAutoSelect = config.useAutoSelector === true || isAI(owner);

      if (shouldAutoSelect) {
        const autoResult = this.autoSelector?.select(contract, {
          owner,
          activationContext,
          selectionKind,
        });
        if (!autoResult?.ok) {
          const selectionFailure = {
            success: false,
            ok: false,
            needsSelection: false,
            reason: autoResult?.reason || "Auto selection failed.",
            code: "AUTO_SELECTION_FAILED",
          };
          return handleResult(selectionFailure, true);
        }
        const nextResult = await safeActivate(autoResult.selections || {});
        const normalizedNext = this.normalizeActivationResult(nextResult);
        if (normalizedNext.needsSelection) {
          const selectionFailure = {
            success: false,
            ok: false,
            needsSelection: false,
            reason: "Auto selection failed.",
            code: "AUTO_SELECTION_FAILED",
          };
          return handleResult(selectionFailure, true);
        }
        return handleResult(normalizedNext, true);
      }

      try {
        this.startTargetSelectionSession({
          kind: selectionKind,
          card: resolvedCard,
          owner,
          selectionContract: contract,
          activationZone: resolvedActivationZone,
          activationContext,
          preventCancel: contract.ui.preventCancel,
          allowCancel: contract.ui.allowCancel,
          message: contract.message,
          execute: (selections) => safeActivate(selections),
          onResult: (nextResult) => handleResult(nextResult, true),
          onCancel: allowCancel ? config.onCancel : null,
        });
      } catch (err) {
        console.error("[Game] Failed to start target selection:", err);
        if (this.targetSelection?.closeModal) {
          this.targetSelection.closeModal();
        }
        this.clearTargetHighlights();
        if (
          this.ui &&
          typeof this.ui.hideFieldTargetingControls === "function"
        ) {
          this.ui.hideFieldTargetingControls();
        }
        this.targetSelection = null;
        this.setSelectionState("idle");
        const selectionFailure = {
          success: false,
          ok: false,
          needsSelection: false,
          reason: "Target selection failed.",
          code: "TARGET_SELECTION_FAILED",
        };
        return handleResult(selectionFailure, true);
      }

      return normalized;
    }

    if (!normalized.success) {
      const skipFailureTracking =
        normalized.activationSkipped === true ||
        normalized.skipActivationTracking === true;
      if (
        normalized.reason &&
        config.suppressFailureLog !== true &&
        !skipFailureTracking
      ) {
        this.ui.log(normalized.reason);
      }
      if (activationContext.committed && activationContext.commitInfo) {
        this.rollbackSpellActivation(owner, activationContext.commitInfo);
        logPipeline("PIPELINE_ROLLBACK", {
          activationZone: resolvedActivationZone,
        });
      }
      if (typeof config.onFailure === "function") {
        config.onFailure(normalized, activationContext);
      }
      if (!skipFailureTracking) {
        trackActivationAttempt(normalized);
      }
      return normalized;
    }

    if (typeof config.finalize === "function") {
      await config.finalize(normalized, {
        card: resolvedCard,
        owner,
        activationZone: resolvedActivationZone,
        activationContext,
      });
    }

    const shouldCountMaterialActivation =
      resolvedCard?.cardKind === "monster" &&
      (selectionKind === "monsterEffect" ||
        selectionKind === "graveyardEffect");
    if (shouldCountMaterialActivation) {
      this.recordMaterialEffectActivation(owner, resolvedCard, {
        contextLabel: selectionKind,
      });
    }
    if (oncePerTurnInfo) {
      this.markOncePerTurnUsed(
        oncePerTurnInfo.card,
        oncePerTurnInfo.player,
        oncePerTurnInfo.effect,
        { lockKey: oncePerTurnInfo.lockKey },
      );
    }
    logPipeline("PIPELINE_FINALIZE", {
      activationZone: resolvedActivationZone,
    });
    if (
      config.emitEffectActivated !== false &&
      selectionKind !== "triggered" &&
      typeof this.emitEffectActivated === "function"
    ) {
      await this.emitEffectActivated({
        card: resolvedCard,
        player: owner,
        effect: oncePerTurnInfo?.effect || activationEffect,
        activationZone: resolvedActivationZone,
        activationContext,
        effectType: selectionKind,
        placementOnly: normalized.placementOnly === true,
      });
    }
    if (typeof config.onSuccess === "function") {
      await config.onSuccess(normalized, activationContext);
    }
    trackActivationAttempt({ ...normalized, success: true });
    return normalized;
  };

  const negationWindowResult = await offerActivationNegationWindow();
  if (negationWindowResult?.negated) {
    const negatedResult = {
      success: false,
      ok: false,
      needsSelection: false,
      reason: "Activation was negated.",
      code: "ACTIVATION_NEGATED",
      activationNegated: true,
    };
    if (typeof config.onFailure === "function") {
      await config.onFailure(negatedResult, activationContext);
    }
    trackActivationAttempt(negatedResult, { blocked: true });
    return negatedResult;
  }

  const initialResult = await safeActivate(config.selections || null);
  return handleResult(initialResult, false);
}

export async function runActivationPipelineWait(config = {}) {
  let finished = false;
  let resolvePromise = null;

  const waitForFinish = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  const finishOnce = (result) => {
    if (finished) return;
    finished = true;
    if (typeof resolvePromise === "function") {
      resolvePromise(result);
    }
  };

  const wrappedConfig = {
    ...config,
    onSuccess: async (result, ctx) => {
      if (typeof config.onSuccess === "function") {
        await config.onSuccess(result, ctx);
      }
      finishOnce(result);
    },
    onFailure: async (result, ctx) => {
      if (typeof config.onFailure === "function") {
        await config.onFailure(result, ctx);
      }
      finishOnce(result);
    },
    onCancel: () => {
      if (typeof config.onCancel === "function") {
        config.onCancel();
      }
      finishOnce({
        success: false,
        ok: false,
        needsSelection: false,
        cancelled: true,
        reason: "cancelled",
        code: "CANCELLED",
      });
    },
  };

  const initialResult = await this.runActivationPipeline(wrappedConfig);
  const hasSelectionUi =
    !!this.ui &&
    (typeof this.ui.showTargetSelection === "function" ||
      typeof this.ui.showFieldTargetingControls === "function");
  const finishOnSelection =
    typeof config.finishOnSelection === "boolean"
      ? config.finishOnSelection
      : !hasSelectionUi;

  if (initialResult?.needsSelection === true && finishOnSelection) {
    finishOnce(initialResult);
  } else if (
    !finished &&
    (!initialResult || initialResult.needsSelection !== true)
  ) {
    finishOnce(initialResult);
  }

  return waitForFinish;
}
