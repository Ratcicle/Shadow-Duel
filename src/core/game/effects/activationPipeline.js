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
import { finalizeNegatedSpellTrapActivation } from "../spellTrap/finalization.js";

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
    allowDuringChainWindow: config.allowDuringChainWindow === true,
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
  const restrictionCheck = this.canActivateCardEffectUnderRestrictions?.(
    resolvedCard,
    owner,
    activationEffect,
    { silent: true },
  );
  if (restrictionCheck?.ok === false) {
    logPipeline("PIPELINE_RESTRICTION_BLOCKED", {
      reason: restrictionCheck.reason,
      code: restrictionCheck.code,
    });
    if (restrictionCheck.reason) {
      this.ui.log(restrictionCheck.reason);
    }
    const blockedResult = {
      success: false,
      ok: false,
      needsSelection: false,
      reason: restrictionCheck.reason,
      code: restrictionCheck.code,
      blockedByRestriction: true,
    };
    trackActivationAttempt(blockedResult, { blocked: true });
    return blockedResult;
  }
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

  let commitInfo = config.activationContext?.commitInfo || null;
  const committed = config.activationContext?.committed === true;
  const fromHand =
    config.activationContext?.fromHand === true || typeof config.commit === "function";
  const sourceWasFacedown =
    typeof config.activationContext?.sourceWasFacedown === "boolean"
      ? config.activationContext.sourceWasFacedown
      : resolvedCard?.isFacedown === true;
  let resolvedActivationZone =
    resolvedZone ||
    config.activationContext?.activationZone ||
    (typeof config.commit === "function"
      ? resolvedCard?.subtype === "field"
        ? "fieldSpell"
        : "spellTrap"
      : null);
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
    sourceWasFacedown,
    selectionKind,
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
        { ...activationContext, prepareOnly: true },
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

  const commitPreparedSource = async () => {
    if (activationContext.committed === true) {
      return { success: true };
    }
    if (typeof config.commit !== "function") {
      if (
        resolvedActivationZone === "spellTrap" &&
        resolvedCard?.isFacedown === true &&
        (resolvedCard.cardKind === "spell" || resolvedCard.cardKind === "trap")
      ) {
        resolvedCard.isFacedown = false;
        await this.presentSpellTrapActivationFlip?.(
          resolvedCard,
          owner,
          resolvedActivationZone,
        );
      }
      activationContext.committed = true;
      activationContext.activationZone = resolvedActivationZone;
      return { success: true };
    }
    commitInfo = await config.commit();
    if (!commitInfo || !commitInfo.cardRef) {
      return createActionResult({
        reason: "Activation commit failed.",
        code: "ACTIVATION_COMMIT_FAILED",
      });
    }
    resolvedCard = commitInfo.cardRef;
    resolvedZone = commitInfo.activationZone || resolvedZone;
    resolvedActivationZone = commitInfo.activationZone || resolvedActivationZone;
    activationContext.committed = true;
    activationContext.commitInfo = commitInfo;
    activationContext.activationZone = resolvedActivationZone;
    logPipeline("PIPELINE_COMMIT", {
      activationZone: resolvedActivationZone,
      fromIndex: commitInfo.fromIndex,
      replacedFieldSpell: commitInfo.replacedFieldSpell?.name || null,
    });
    this.updateBoard?.();
    if (typeof this.waitForAiPresentationStep === "function") {
      await this.waitForAiPresentationStep(owner);
    }
    return { success: true };
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
      if (
        activationContext.committed &&
        activationContext.commitInfo &&
        normalized.noRollback !== true
      ) {
        await this.rollbackSpellActivation(owner, activationContext.commitInfo);
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

    const preparedEffect =
      normalized.effect || oncePerTurnInfo?.effect || activationEffect || config.effect;
    const preparedSelections =
      normalized.targets || normalized.selections || config.selections || {};

    if (fromSelection) {
      const gateResult =
        typeof config.gate === "function" ? config.gate() : { ok: true };
      const previewResult =
        gateResult?.ok === false
          ? gateResult
          : typeof config.preview === "function"
            ? config.preview()
            : { ok: true };
      const restrictionResult =
        previewResult?.ok === false
          ? previewResult
          : this.canActivateCardEffectUnderRestrictions?.(
              resolvedCard,
              owner,
              preparedEffect,
              { silent: true },
            ) || { ok: true };
      if (restrictionResult?.ok === false) {
        const revalidationFailure = this.createActionResult({
          reason:
            restrictionResult.reason ||
            "Activation is no longer available after target selection.",
          code: restrictionResult.code || "ACTIVATION_REVALIDATION_FAILED",
        });
        if (typeof config.onFailure === "function") {
          await config.onFailure(revalidationFailure, activationContext);
        }
        trackActivationAttempt(revalidationFailure);
        return revalidationFailure;
      }
    }

    const activationCosts =
      typeof this.chainSystem?.getEffectActivationCosts === "function"
        ? this.chainSystem.getEffectActivationCosts(preparedEffect)
        : preparedEffect?.activationCosts || [];
    if (
      activationContext.costsPaid !== true &&
      activationCosts.length > 0 &&
      typeof this.effectEngine?.checkActionPreviewRequirements === "function"
    ) {
      const costPreview = this.effectEngine.checkActionPreviewRequirements(
        activationCosts,
        {
          source: resolvedCard,
          player: owner,
          opponent: this.getOpponent?.(owner) || null,
          effect: preparedEffect,
          activationZone: resolvedActivationZone,
          activationContext: {
            ...activationContext,
            preview: true,
            selections: preparedSelections,
          },
          _actionTargets: preparedSelections,
        },
      );
      if (costPreview?.ok === false) {
        const costFailure = this.createActionResult({
          reason: costPreview.reason || "Activation cost cannot be paid.",
          code: costPreview.code || "ACTIVATION_COST_UNAVAILABLE",
        });
        if (typeof config.onFailure === "function") {
          await config.onFailure(costFailure, activationContext);
        }
        trackActivationAttempt(costFailure);
        return costFailure;
      }
    }

    const commitResult = await commitPreparedSource();
    if (commitResult?.success === false) {
      if (typeof config.onFailure === "function") {
        await config.onFailure(commitResult, activationContext);
      }
      trackActivationAttempt(commitResult);
      return commitResult;
    }

    let resolutionResult = normalized;
    const preparingForExistingChain = config.prepareForExistingChain === true;
    const shouldUseChain =
      !preparingForExistingChain &&
      normalized.placementOnly !== true &&
      !!preparedEffect &&
      config.openActivationWindow !== false &&
      config.activationContext?.skipActivationWindow !== true &&
      this.disableChains !== true &&
      this.chainSystem?.chainsDisabled !== true &&
      typeof this.chainSystem?.openActivationChain === "function";

    if (normalized.placementOnly !== true && preparedEffect) {
      const preparedActivationContext = {
        ...activationContext,
        ...(normalized.activationContext || {}),
        prepareOnly: false,
        committed: activationContext.committed === true,
        selections: preparedSelections,
      };
      const preparedActivation = this.chainSystem?.createPreparedActivation
        ? this.chainSystem.createPreparedActivation({
            card: resolvedCard,
            player: owner,
            effect: preparedEffect,
            zone: resolvedActivationZone,
            selections: preparedSelections,
            costSelections: activationContext.costSelections || {},
            targetSelections:
              activationContext.targetSelections || preparedSelections,
            resolutionSelections:
              activationContext.resolutionSelections || {},
            costPayment: activationContext.costPayment || null,
            sourceAtActivation: activationContext.sourceAtActivation || null,
            sourceMoved: activationContext.sourceMoved === true,
            latestSourceLocation:
              activationContext.latestSourceLocation || null,
            activationContext: preparedActivationContext,
            selectionKind,
            context:
              normalized.resolutionContext ||
              activationContext.actionContext ||
              null,
            committed: activationContext.committed === true,
            costsPaid: activationContext.costsPaid === true,
            skipDefaultFinalization: typeof config.finalize === "function",
            skipUsageRegistration: true,
            pipelineManaged: true,
            pipelineFinalization:
              typeof config.finalize === "function"
                ? async (linkResult = {}, finalizationContext = {}) => {
                    activationContext.chainFinalizationHandled = true;
                    if (
                      linkResult.activationNegated === true ||
                      linkResult.negated === true
                    ) {
                      return linkResult;
                    }
                    const finalResult = this.normalizeActivationResult({
                      ...normalized,
                      ...linkResult,
                      needsSelection: false,
                    });
                    await config.finalize(finalResult, {
                      card: resolvedCard,
                      owner,
                      activationZone: resolvedActivationZone,
                      activationContext: {
                        ...activationContext,
                        chainId: finalizationContext.chainId ?? null,
                        linkId: finalizationContext.linkId ?? null,
                        effectId: preparedEffect?.id || null,
                        finalizationId:
                          finalizationContext.finalizationId ?? null,
                      },
                    });
                    return finalResult;
                  }
                : null,
          })
        : {
            card: resolvedCard,
            player: owner,
            effect: preparedEffect,
            zone: resolvedActivationZone,
            selections: preparedSelections,
            activationContext: preparedActivationContext,
          };

      let costResult = { success: true };
      if (
        activationContext.costsPaid !== true &&
        (shouldUseChain || preparingForExistingChain) &&
        typeof this.chainSystem?.payActivationCosts === "function"
      ) {
        this.chainSystem.isPreparingActivation = true;
        try {
          costResult = await this.chainSystem.payActivationCosts(
            preparedActivation,
            activationContext.actionContext || null,
          );
        } finally {
          this.chainSystem.isPreparingActivation = false;
        }
      }
      if (costResult?.success === false) {
        await finalizeNegatedSpellTrapActivation(
          this,
          resolvedCard,
          owner,
          resolvedActivationZone,
          { activationContext },
        );
        if (typeof config.onFailure === "function") {
          await config.onFailure(costResult, activationContext);
        }
        trackActivationAttempt(costResult);
        return this.normalizeActivationResult(costResult);
      }
      if (preparedActivation.costsPaid === true) {
        activationContext.costsPaid = true;
        activationContext.costPayment = preparedActivation.costPayment || null;
      }

      if (preparingForExistingChain) {
          preparedActivation.pipelineCompletion = async (
          linkResult = { success: true },
        ) => {
          const succeeded =
            linkResult?.success !== false &&
            linkResult?.activationNegated !== true &&
            linkResult?.negated !== true &&
            linkResult?.fizzled !== true;
          if (!succeeded) {
            const failedResult = this.normalizeActivationResult({
              ...linkResult,
              success: false,
              needsSelection: false,
            });
            if (typeof config.onFailure === "function") {
              await config.onFailure(failedResult, activationContext);
            }
            trackActivationAttempt(failedResult, {
              blocked:
                linkResult?.activationNegated === true ||
                linkResult?.negated === true,
            });
            return failedResult;
          }

          const completed = {
            ...normalized,
            ...linkResult,
            success: true,
            ok: true,
            needsSelection: false,
            effect: preparedEffect,
            targets: preparedSelections,
          };
          const shouldCountMaterialActivation =
            resolvedCard?.cardKind === "monster" &&
            (selectionKind === "monsterEffect" ||
              selectionKind === "graveyardEffect");
          if (shouldCountMaterialActivation) {
            this.recordMaterialEffectActivation(owner, resolvedCard, {
              contextLabel: selectionKind,
            });
          }
          if (
            oncePerTurnInfo &&
            preparedEffect?.usagePolicy !== "use" &&
            preparedEffect?.usagePolicy !== "activate"
          ) {
            this.markOncePerTurnUsed(
              oncePerTurnInfo.card,
              oncePerTurnInfo.player,
              oncePerTurnInfo.effect,
              { lockKey: oncePerTurnInfo.lockKey },
            );
          }
          if (typeof config.onSuccess === "function") {
            await config.onSuccess(completed, activationContext);
          }
          trackActivationAttempt(completed);
          return completed;
        };
        const preparedResult = {
          ...normalized,
          success: true,
          ok: true,
          needsSelection: false,
          prepared: true,
          preparedActivation,
          effect: preparedEffect,
          targets: preparedSelections,
        };
        if (typeof config.onPreparationComplete === "function") {
          await config.onPreparationComplete(preparedResult, activationContext);
        }
        return preparedResult;
      }

      if (shouldUseChain) {
        resolutionResult = await this.chainSystem.openActivationChain(
          preparedActivation,
        );
      } else {
        resolutionResult = await config.activate(
          preparedSelections,
          {
            ...activationContext,
            prepareOnly: false,
            committed: activationContext.committed === true,
            selections: preparedSelections,
          },
          resolvedActivationZone,
          resolvedCard,
          owner,
        );
      }

      if (
        resolutionResult?.activationNegated === true ||
        resolutionResult?.negated === true
      ) {
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

      resolutionResult = this.normalizeActivationResult(resolutionResult);
      if (!resolutionResult.success) {
        if (
          typeof config.finalize === "function" &&
          activationContext.chainFinalizationHandled !== true
        ) {
          await config.finalize(resolutionResult, {
            card: resolvedCard,
            owner,
            activationZone: resolvedActivationZone,
            activationContext,
          });
        }
        if (typeof config.onFailure === "function") {
          await config.onFailure(resolutionResult, activationContext);
        }
        trackActivationAttempt(resolutionResult);
        return resolutionResult;
      }
    }

    const completedResult = {
      ...normalized,
      ...resolutionResult,
      success: true,
      ok: true,
      needsSelection: false,
      effect: preparedEffect,
      targets: preparedSelections,
    };

    if (
      typeof config.finalize === "function" &&
      activationContext.chainFinalizationHandled !== true
    ) {
      await config.finalize(completedResult, {
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
    if (
      oncePerTurnInfo &&
      preparedEffect?.usagePolicy !== "use" &&
      preparedEffect?.usagePolicy !== "activate"
    ) {
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
    if (typeof config.onSuccess === "function") {
      await config.onSuccess(completedResult, activationContext);
    }
    trackActivationAttempt({ ...completedResult, success: true });
    return completedResult;
  };

  const runCanonicalActivationTransaction = async (initialResult) => {
    const normalizedInitial = this.normalizeActivationResult(initialResult);
    if (!normalizedInitial.success && !normalizedInitial.needsSelection) {
      return { result: initialResult, fromSelection: false };
    }
    const effect =
      normalizedInitial.effect || activationEffect || config.effect || null;
    const chainSystem = this.chainSystem;
    if (!effect || !chainSystem || chainSystem.chainsDisabled === true) {
      return { result: initialResult, fromSelection: false };
    }
    const usageCheck = chainSystem.checkActivationUsage?.(
      resolvedCard,
      owner,
      effect,
    );
    if (usageCheck?.ok === false) {
      return {
        result: this.createActionResult({
          reason: usageCheck.reason || "Effect usage limit reached.",
          code: usageCheck.code || "ACTIVATION_USAGE_LIMIT",
        }),
        fromSelection: false,
      };
    }

    const costDefinitions = (
      chainSystem.getActivationCostTargetDefinitions?.(effect) || []
    ).map((definition) =>
      definition.requireThisCard === true || definition.allowSelf === true
        ? definition
        : { ...definition, excludeSelf: true },
    );
    const targetDefinitions =
      chainSystem.getDeclaredTargetDefinitions?.(effect) || [];
    const costs = chainSystem.getEffectActivationCosts?.(effect) || [];
    const hasCanonicalWork =
      costDefinitions.length > 0 ||
      targetDefinitions.length > 0 ||
      costs.length > 0;
    if (!hasCanonicalWork) {
      return { result: initialResult, fromSelection: false };
    }
    this.notify?.("activation_transaction", {
      stage: "preflight",
      cardInstanceId: resolvedCard?.instanceId ?? null,
      effectId: effect.id || null,
      activationZone: resolvedActivationZone,
    });

    const provided =
      normalizedInitial.targets ||
      normalizedInitial.selections ||
      config.selections ||
      {};
    const selectProvided = (definitions) =>
      Object.fromEntries(
        definitions
          .filter((definition) => definition?.id in provided)
          .map((definition) => [definition.id, provided[definition.id]]),
      );

    let costSelections = selectProvided(costDefinitions);
    if (
      costDefinitions.length > 0 &&
      Object.keys(costSelections).length === 0
    ) {
      costSelections = await chainSystem.getPlayerSelectionsForDefinitions?.(
        resolvedCard,
        costDefinitions,
        owner,
        activationContext.actionContext || null,
        {
          purpose: "cost",
          allowCancel: true,
          activationZone: resolvedActivationZone,
        },
      );
      if (costSelections == null) {
        return {
          result: this.createActionResult({
            cancelled: true,
            reason: "Activation cost selection cancelled.",
            code: "ACTIVATION_COST_SELECTION_CANCELLED",
          }),
          fromSelection: false,
        };
      }
    }

    const commitResult = await commitPreparedSource();
    if (commitResult?.success === false) {
      return { result: commitResult, fromSelection: false };
    }

    const draft = chainSystem.createPreparedActivation({
      card: resolvedCard,
      player: owner,
      effect,
      zone: resolvedActivationZone,
      selections: costSelections || {},
      costSelections: costSelections || {},
      targetSelections: {},
      activationContext: {
        ...activationContext,
        selections: costSelections || {},
      },
      committed: true,
    });
    activationContext.sourceAtActivation = draft.sourceAtActivation;
    activationContext.costSelections = costSelections || {};
    activationContext.selections = costSelections || {};
    this.notify?.("activation_transaction", {
      stage: "source_committed",
      cardInstanceId: resolvedCard?.instanceId ?? null,
      effectId: effect.id || null,
      activationZone: resolvedActivationZone,
    });

    chainSystem.isPreparingActivation = true;
    let costResult;
    try {
      costResult = await chainSystem.payActivationCosts(
        draft,
        activationContext.actionContext || null,
      );
    } finally {
      chainSystem.isPreparingActivation = false;
    }
    if (costResult?.success === false) {
      return {
        result: this.createActionResult({
          ...costResult,
          noRollback: true,
        }),
        fromSelection: false,
      };
    }
    activationContext.costsPaid = true;
    activationContext.costPayment = draft.costPayment || null;
    if (
      draft.sourceAtActivation &&
      Number(resolvedCard?.locationVersion ?? 0) !==
        Number(draft.sourceAtActivation.locationVersion ?? 0)
    ) {
      activationContext.sourceMoved = true;
      activationContext.latestSourceLocation = {
        cardInstanceId: resolvedCard?.instanceId ?? null,
        controllerId: owner?.id || null,
        zone: chainSystem.determineCardZone?.(resolvedCard, owner) || null,
        faceUp: resolvedCard?.isFacedown !== true,
        locationVersion: Number(resolvedCard?.locationVersion ?? 0),
      };
    }
    this.notify?.("activation_transaction", {
      stage: "cost_paid",
      cardInstanceId: resolvedCard?.instanceId ?? null,
      effectId: effect.id || null,
      costPayment: draft.costPayment || null,
    });

    let targetSelections = selectProvided(targetDefinitions);
    if (
      targetDefinitions.length > 0 &&
      Object.keys(targetSelections).length === 0
    ) {
      targetSelections = await chainSystem.getPlayerSelectionsForDefinitions?.(
        resolvedCard,
        targetDefinitions,
        owner,
        activationContext.actionContext || null,
        {
          purpose: "target",
          allowCancel: false,
          activationZone: resolvedActivationZone,
        },
      );
      if (targetSelections == null) {
        return {
          result: this.createActionResult({
            committed: true,
            costsPaid: true,
            noRollback: true,
            reason: "Required activation targets could not be declared.",
            code: "ACTIVATION_TARGET_SELECTION_FAILED_AFTER_COMMIT",
          }),
          fromSelection: false,
        };
      }
    }

    const selections = {
      ...(costSelections || {}),
      ...(targetSelections || {}),
    };
    activationContext.costSelections = costSelections || {};
    activationContext.targetSelections = targetSelections || {};
    activationContext.selections = selections;
    this.notify?.("activation_transaction", {
      stage: "targets_declared",
      cardInstanceId: resolvedCard?.instanceId ?? null,
      effectId: effect.id || null,
      targetIds: targetDefinitions.map((definition) => definition.id),
    });
    const nextResult = await safeActivate(selections);
    return { result: nextResult, fromSelection: true };
  };

  const initialResult = await safeActivate(config.selections || null);
  const transaction = await runCanonicalActivationTransaction(initialResult);
  return handleResult(transaction.result, transaction.fromSelection);
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
    onPreparationComplete: async (result, ctx) => {
      if (typeof config.onPreparationComplete === "function") {
        await config.onPreparationComplete(result, ctx);
      }
      finishOnce(result);
    },
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
