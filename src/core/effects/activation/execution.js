/**
 * activation/execution.js
 * Effect activation execution methods
 * Functions assume `this` = EffectEngine instance
 */

import {
  canActivateDuringDamageStep,
  canActivateSetQuickSpell,
  isQuickSpell,
} from "../../game/spellTrap/quickSpellRules.js";

function hasQuickSpellLegalWindowContext(context = {}) {
  return (
    context.legalWindow === true ||
    context.isChainWindow === true ||
    context.chainWindowOpen === true ||
    context.openState === true ||
    typeof context.type === "string"
  );
}

function actionsResultFailed(actionsResult) {
  return (
    actionsResult &&
    typeof actionsResult === "object" &&
    actionsResult.success === false &&
    actionsResult.needsSelection !== true
  );
}

function buildActionsFailure(actionsResult) {
  return {
    success: false,
    needsSelection: false,
    reason: actionsResult?.reason || "Effect actions failed.",
    actionResult: actionsResult || null,
  };
}

/**
 * Activate a monster's ignition effect from the graveyard.
 * @returns {Promise<Object>} Result with success/needsSelection status
 */
export async function activateMonsterFromGraveyard(
  card,
  player,
  selections = null,
  activationContext = {}
) {
  if (!card || !player) {
    return {
      success: false,
      needsSelection: false,
      reason: "Missing card or player.",
    };
  }
  if (this.game?.turn !== player.id) {
    return {
      success: false,
      needsSelection: false,
      reason: "Not your turn.",
    };
  }
  if (this.game?.phase !== "main1" && this.game?.phase !== "main2") {
    return {
      success: false,
      needsSelection: false,
      reason: "Effect can only be used in Main Phase.",
    };
  }
  if (card.cardKind !== "monster") {
    return {
      success: false,
      needsSelection: false,
      reason: "Only monsters can activate from graveyard.",
    };
  }
  if (!player.graveyard || !player.graveyard.includes(card)) {
    return {
      success: false,
      needsSelection: false,
      reason: "Monster is not in the graveyard.",
    };
  }

  const requestedEffectId = activationContext?.effectId || null;
  const effect = this.getMonsterIgnitionEffect
    ? this.getMonsterIgnitionEffect(card, "graveyard", {
        effectId: requestedEffectId,
      })
    : card.effects?.find(
        (e) =>
          e.timing === "ignition" &&
          e.requireZone === "graveyard" &&
          (!requestedEffectId || e.id === requestedEffectId)
      );

  if (!effect) {
    return {
      success: false,
      needsSelection: false,
      reason: "No graveyard ignition effect.",
    };
  }

  const optCheck = this.checkOncePerTurn(card, player, effect);
  if (!optCheck.ok) {
    return { success: false, needsSelection: false, reason: optCheck.reason };
  }

  const duelCheck = this.checkOncePerDuel(card, player, effect);
  if (!duelCheck.ok) {
    return {
      success: false,
      needsSelection: false,
      reason: duelCheck.reason,
    };
  }

  const normalizedActivationContext = {
    fromHand: activationContext?.fromHand === true,
    activationZone: "graveyard",
    sourceZone: activationContext?.sourceZone || "graveyard",
    effectId: effect.id,
    committed: activationContext?.committed === true,
    commitInfo: activationContext?.commitInfo || null,
    autoSelectSingleTarget: activationContext?.autoSelectSingleTarget,
    autoSelectTargets: activationContext?.autoSelectTargets,
    actionContext: activationContext?.actionContext || null,
    prepareOnly: activationContext?.prepareOnly === true,
  };

  const ctx = {
    source: card,
    effect,
    player,
    opponent: this.game.getOpponent(player),
    activationZone: "graveyard",
    activationContext: normalizedActivationContext,
    actionContext: normalizedActivationContext.actionContext || null,
  };

  const condCheck = this.evaluateConditions(effect.conditions, ctx);
  if (!condCheck.ok) {
    return {
      success: false,
      needsSelection: false,
      reason: condCheck.reason,
    };
  }

  const targetResult = this.resolveTargets(
    effect.targets || [],
    ctx,
    selections
  );

  if (targetResult.needsSelection) {
    return {
      success: false,
      needsSelection: true,
      selectionContract: targetResult.selectionContract,
    };
  }

  if (!targetResult.ok) {
    return {
      success: false,
      needsSelection: false,
      reason: targetResult.reason,
    };
  }

  if (normalizedActivationContext.prepareOnly) {
    return {
      success: true,
      needsSelection: false,
      prepared: true,
      effect,
      targets: targetResult.targets || {},
      activationContext: ctx.activationContext,
    };
  }

  // Await applyActions and propagate needsSelection if returned
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
  if (actionsResultFailed(actionsResult)) {
    return buildActionsFailure(actionsResult);
  }

  // Only register usage and check win after successful resolution
  this.registerOncePerTurnUsage(card, player, effect);
  this.registerOncePerDuelUsage(card, player, effect);

  this.game.checkWinCondition();
  return {
    success: true,
    needsSelection: false,
    activationContext: ctx.activationContext,
  };
}

/**
 * Activate a Field Spell's effect while on the field.
 * @returns {Promise<Object>} Result with success/needsSelection status
 */
export async function activateFieldSpell(
  card,
  player,
  selections = null,
  activationContext = {}
) {
  if (!card || card.cardKind !== "spell" || card.subtype !== "field") {
    return {
      success: false,
      needsSelection: false,
      reason: "Not a field spell.",
    };
  }

  const check = this.canActivate(card, player);
  if (!check.ok) {
    return { success: false, needsSelection: false, reason: check.reason };
  }

  // Look for on_field_activate OR ignition with requireZone: "fieldSpell"
  const effect = (card.effects || []).find(
    (e) =>
      e &&
      (e.timing === "on_field_activate" ||
        (e.timing === "ignition" && e.requireZone === "fieldSpell"))
  );

  if (!effect) {
    return {
      success: false,
      needsSelection: false,
      reason: "No field activation effect.",
    };
  }

  const optCheck = this.checkOncePerTurn(card, player, effect);
  if (!optCheck.ok) {
    return { success: false, needsSelection: false, reason: optCheck.reason };
  }

  // Check requireEmptyField condition
  if (effect.requireEmptyField && player.field.length > 0) {
    return {
      success: false,
      needsSelection: false,
      reason: "You must control no monsters to activate this effect.",
    };
  }

  const normalizedActivationContext = {
    fromHand: activationContext?.fromHand === true,
    activationZone: "fieldSpell",
    sourceZone: activationContext?.sourceZone || "fieldSpell",
    committed: activationContext?.committed === true,
    commitInfo: activationContext?.commitInfo || null,
    autoSelectSingleTarget: activationContext?.autoSelectSingleTarget,
    autoSelectTargets: activationContext?.autoSelectTargets,
    actionContext: activationContext?.actionContext || null,
    prepareOnly: activationContext?.prepareOnly === true,
  };

  const ctx = {
    source: card,
    effect,
    player,
    opponent: this.game.getOpponent(player),
    activationZone: "fieldSpell",
    activationContext: normalizedActivationContext,
    actionContext: normalizedActivationContext.actionContext || null,
  };

  const targetResult = this.resolveTargets(
    effect.targets || [],
    ctx,
    selections
  );

  if (targetResult.needsSelection) {
    return {
      success: false,
      needsSelection: true,
      selectionContract: targetResult.selectionContract,
    };
  }

  if (!targetResult.ok) {
    return {
      success: false,
      needsSelection: false,
      reason: targetResult.reason,
    };
  }


  if (normalizedActivationContext.prepareOnly) {
    return {
      success: true,
      needsSelection: false,
      prepared: true,
      effect,
      targets: targetResult.targets || {},
      activationContext: ctx.activationContext,
    };
  }

  // Await applyActions and propagate needsSelection if returned
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
  if (actionsResultFailed(actionsResult)) {
    return buildActionsFailure(actionsResult);
  }

  // Only register usage and check win after successful resolution
  this.registerOncePerTurnUsage(card, player, effect);
  this.game.checkWinCondition();

  await this.handleBlueprintStorageAfterResolution(card, effect, ctx);

  return {
    success: true,
    needsSelection: false,
    activationContext: ctx.activationContext,
  };
}

/**
 * Activate a Spell/Trap card's effect.
 */
export async function activateSpellTrapEffect(
  card,
  player,
  selections = null,
  activationZone = "spellTrap",
  activationContext = {}
) {
  const logDev =
    this.game?.devLog && ((tag, detail) => this.game.devLog(tag, detail || {}));
  const fail = (reason) => {
    if (logDev) {
      logDev("SPELL_TRAP_ACTIVATION_FAILED", {
        card: card?.name || "Unknown",
        player: player?.id || null,
        reason,
      });
    }
    return { success: false, needsSelection: false, reason };
  };

  if (!card || !player) {
    return fail("Missing card or player.");
  }
  if (card.owner !== player.id) {
    return fail("Card does not belong to the requesting player.");
  }
  if (card.cardKind !== "spell" && card.cardKind !== "trap") {
    return fail("Only Spell/Trap cards can use this effect.");
  }
  const fromHand = activationContext?.fromHand === true;
  const trapActivationFromSet =
    activationContext?.trapActivationFromSet === true ||
    activationContext?.fromSet === true;
  const quickSpellActivationFromSet =
    activationContext?.quickSpellActivationFromSet === true;
  const isSetSpell =
    card.cardKind === "spell" &&
    card.isFacedown === true &&
    activationZone === "spellTrap";
  const isSetTrap =
    card.cardKind === "trap" &&
    card.isFacedown === true &&
    activationZone === "spellTrap";
  const quickSpellFromHand = fromHand && isQuickSpell(card);
  const quickSpellFromSet =
    !fromHand &&
    isQuickSpell(card) &&
    activationZone === "spellTrap" &&
    (isSetSpell || quickSpellActivationFromSet);
  let flipAfterChecks = false;
  if (card.isFacedown) {
    if (isSetTrap) {
      const canActivateTrap =
        typeof this.game?.canActivateTrap === "function"
          ? this.game.canActivateTrap(card)
          : true;
      if (!canActivateTrap) {
        return fail("Trap cannot be activated this turn.");
      }
      flipAfterChecks = true;
    } else if (!isSetSpell) {
      return fail("Card must be face-up to activate.");
    } else {
      const setTurn = card.setTurn ?? card.turnSetOn ?? null;
      if (setTurn === null || this.game?.turnCounter <= setTurn) {
        return fail("Spell cannot be activated this turn.");
      }
      flipAfterChecks = true;
    }
  }
  if (this.game.turn !== player.id) {
    return fail("Not your turn.");
  }
  const inMainPhase = this.game.phase === "main1" || this.game.phase === "main2";
  if (
    !inMainPhase &&
    !quickSpellFromHand &&
    !quickSpellFromSet
  ) {
    return fail("Effect can only be activated during Main Phase.");
  }
  if (
    (quickSpellFromHand || quickSpellFromSet) &&
    (!inMainPhase || this.game.turn !== player.id) &&
    !hasQuickSpellLegalWindowContext(activationContext?.quickSpellContext)
  ) {
    return fail("No legal Quick Spell activation window is open.");
  }

  const normalizedActivationContext = {
    fromHand,
    activationZone,
    sourceZone:
      activationContext?.sourceZone || (fromHand ? "hand" : activationZone),
    committed: activationContext?.committed === true,
    commitInfo: activationContext?.commitInfo || null,
    autoSelectSingleTarget: activationContext?.autoSelectSingleTarget,
    autoSelectTargets: activationContext?.autoSelectTargets,
    actionContext: activationContext?.actionContext || null,
    quickSpellContext: activationContext?.quickSpellContext || null,
    quickSpellActivationFromSet,
    resolvedTargets: activationContext?.resolvedTargets || null,
    trapActivationFromSet: trapActivationFromSet || isSetTrap || false,
    prepareOnly: activationContext?.prepareOnly === true,
  };
  let effect = null;

  logDev?.("SPELL_TRAP_ACTIVATION_ATTEMPT", {
    card: card.name,
    player: player.id,
    fromHand,
    activationZone,
  });

  if (
    this.game?.devModeEnabled &&
    activationContext?.devFailAfterCommit === true &&
    normalizedActivationContext.committed === true &&
    activationZone === "fieldSpell"
  ) {
    return {
      success: false,
      needsSelection: false,
      reason: "Dev forced failure.",
    };
  }

  if (card.cardKind === "trap") {
    effect = this.getSpellTrapActivationEffect(card, {
      fromHand: false,
      activationZone,
      trapActivationFromSet:
        normalizedActivationContext.trapActivationFromSet === true ||
        flipAfterChecks,
    });
    if (!effect) {
      const placementOnly =
        card.subtype === "continuous" &&
        (normalizedActivationContext.trapActivationFromSet === true ||
          flipAfterChecks);
      if (placementOnly) {
        if (flipAfterChecks) {
          card.isFacedown = false;
        }
        logDev?.("SPELL_TRAP_PLACEMENT_ONLY", {
          card: card.name,
          player: player.id,
          activationZone,
        });
        return {
          success: true,
          needsSelection: false,
          placementOnly: true,
        };
      }
      return fail("No trap activation effect defined.");
    }
  } else if (card.cardKind === "spell") {
    if (fromHand) {
      effect = this.getHandActivationEffect(card);
      const placementOnly =
        !effect && (card.subtype === "field" || card.subtype === "continuous");
      if (!effect) {
        if (placementOnly) {
          logDev?.("SPELL_TRAP_PLACEMENT_ONLY", {
            card: card.name,
            player: player.id,
            activationZone,
          });
          return {
            success: true,
            needsSelection: false,
            placementOnly: true,
          };
        }
        return fail("No on_play effect defined.");
      }
    } else {
      effect = this.getSpellTrapActivationEffect(card, {
        fromHand: false,
        activationZone,
      });
      if (!effect) {
        const placementOnly =
          flipAfterChecks &&
          (card.subtype === "continuous" || card.subtype === "field");
        if (placementOnly) {
          if (flipAfterChecks) {
            card.isFacedown = false;
          }
          return {
            success: true,
            needsSelection: false,
            placementOnly: true,
          };
        }
        return fail("No ignition effect defined.");
      }
    }
  }

  if (quickSpellFromSet && card.isFacedown === true) {
    const quickSpellContext = {
      ...(normalizedActivationContext.quickSpellContext || {}),
      activationZone: "spellTrap",
      effect,
    };
    const quickCheck = canActivateSetQuickSpell(
      this.game,
      card,
      player,
      quickSpellContext,
    );
    if (!quickCheck.ok) {
      return fail(quickCheck.reason);
    }
  }

  // Check requireEmptyField condition
  if (effect.requireEmptyField && player.field.length > 0) {
    return fail("You must control no monsters to activate this effect.");
  }
  if (effect.requirePhase) {
    const allowedPhases = Array.isArray(effect.requirePhase)
      ? effect.requirePhase
      : [effect.requirePhase];
    if (!allowedPhases.includes(this.game?.phase)) {
      return fail("Effect cannot be activated this phase.");
    }
  }

  const ctx = {
    source: card,
    player,
    opponent: this.game.getOpponent(player),
    effect,
    effectId: effect?.id || null,
    activationZone,
    activationContext: normalizedActivationContext,
    actionContext: normalizedActivationContext.actionContext || null,
    selections: selections || normalizedActivationContext.selections || null,
  };

  // Ensure selections propagate through activation context for network resume.
  normalizedActivationContext.selections =
    normalizedActivationContext.selections || selections || null;

  const condCheck = this.evaluateConditions(effect.conditions, ctx);
  if (!condCheck.ok) {
    return fail(condCheck.reason);
  }

  const optCheck = this.checkOncePerTurn(card, player, effect);
  if (!optCheck.ok) {
    return fail(optCheck.reason);
  }

  const targetResult = this.resolveTargets(
    effect.targets || [],
    ctx,
    selections
  );
  if (targetResult.needsSelection) {
    logDev?.("SPELL_TRAP_NEEDS_SELECTION", {
      card: card.name,
      player: player.id,
    });
    return {
      success: false,
      needsSelection: true,
      selectionContract: targetResult.selectionContract,
    };
  }

  if (targetResult.ok === false) {
    return fail(targetResult.reason);
  }

  if (normalizedActivationContext.prepareOnly) {
    return {
      success: true,
      needsSelection: false,
      prepared: true,
      placementOnly: false,
      effect,
      targets: targetResult.targets || {},
      activationContext: ctx.activationContext,
    };
  }

  if (flipAfterChecks) {
    card.isFacedown = false;
    await this.game?.presentSpellTrapActivationFlip?.(
      card,
      player,
      activationZone,
    );
  }

  const visualSource = this.game?.ui?.captureCardAnimationSource?.(card, {
    ownerId: player.id,
    zone: activationZone,
  });
  normalizedActivationContext.sourceRect = visualSource?.rect || null;
  this.game?.queueVisualFeedback?.({
    kind: "effect-activation",
    sourceCard: card,
    ownerId: player.id,
    fromZone: activationZone,
    sourceRect: visualSource?.rect || null,
    tone: card.cardKind === "trap" ? "violet" : "gold",
  });
  this.game?.updateBoard?.();
  if (typeof this.game?.waitForAiPresentationStep === "function") {
    await this.game.waitForAiPresentationStep(player);
  }

  logDev?.("SPELL_TRAP_ACTIONS_START", {
    card: card.name,
    player: player.id,
    actionCount: (effect.actions || []).length,
  });
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
  if (actionsResultFailed(actionsResult)) {
    return buildActionsFailure(actionsResult);
  }
  this.game?.updateBoard?.();
  if (typeof this.game?.waitForAiPresentationStep === "function") {
    await this.game.waitForAiPresentationStep(player);
  }

  this.registerOncePerTurnUsage(card, player, effect);
  this.game.checkWinCondition();

  await this.handleBlueprintStorageAfterResolution(card, effect, ctx);

  logDev?.("SPELL_TRAP_ACTIVATION_RESOLVED", {
    card: card.name,
    player: player.id,
  });

  return {
    success: true,
    needsSelection: false,
    activationContext: ctx.activationContext,
  };
}

/**
 * Activate a monster's ignition effect from field or hand.
 */
export async function activateMonsterEffect(
  card,
  player,
  selections = null,
  activationZone = "field",
  activationContext = {}
) {
  if (!card || !player) {
    return {
      success: false,
      needsSelection: false,
      reason: "Missing card or player.",
    };
  }
  if (card.owner !== player.id) {
    return {
      success: false,
      needsSelection: false,
      reason: "Card does not belong to the requesting player.",
    };
  }
  if (card.cardKind !== "monster") {
    return {
      success: false,
      needsSelection: false,
      reason: "Only Monster cards can use this effect.",
    };
  }
  if (card.isFacedown) {
    return {
      success: false,
      needsSelection: false,
      reason: "Card must be face-up to activate.",
    };
  }
  if (this.game.turn !== player.id) {
    return {
      success: false,
      needsSelection: false,
      reason: "Not your turn.",
    };
  }

  // Verify card is in the correct zone
  if (activationZone === "hand") {
    if (!player.hand || !player.hand.includes(card)) {
      return {
        success: false,
        needsSelection: false,
        reason: "Card is not in your hand.",
      };
    }
  } else if (activationZone === "field") {
    if (!player.field || !player.field.includes(card)) {
      return {
        success: false,
        needsSelection: false,
        reason: "Card is not on the field.",
      };
    }
  }

  const requestedEffectId = activationContext?.effectId || null;
  const effect = this.getMonsterIgnitionEffect
    ? this.getMonsterIgnitionEffect(card, activationZone, {
        effectId: requestedEffectId,
      })
    : (card.effects || []).find(
        (e) =>
          e &&
          e.timing === "ignition" &&
          (activationZone === "hand"
            ? e.requireZone === "hand"
            : !e.requireZone || e.requireZone === "field") &&
          (!requestedEffectId || e.id === requestedEffectId)
      );

  if (!effect) {
    return {
      success: false,
      needsSelection: false,
      reason: "No ignition effect defined for this zone.",
    };
  }

  const isMainPhase =
    this.game.phase === "main1" || this.game.phase === "main2";
  const isManualFieldQuickEffect =
    activationZone === "field" &&
    (effect.isQuickEffect === true || Number(effect.speed) === 2);
  const isBattlePhase = this.game.phase === "battle";
  if (!isMainPhase && !(isManualFieldQuickEffect && isBattlePhase)) {
    return {
      success: false,
      needsSelection: false,
      reason: "Effect can only be activated during Main Phase.",
    };
  }

  const damageStepCheck = canActivateDuringDamageStep(effect, card, {
    ...(activationContext?.context || {}),
    ...(activationContext?.actionContext || {}),
    activationZone,
    phase: this.game.phase || null,
  });
  if (!damageStepCheck.ok) {
    return {
      success: false,
      needsSelection: false,
      reason: damageStepCheck.reason,
    };
  }

  const fromHand =
    activationContext?.fromHand === true || activationZone === "hand";
  const normalizedActivationContext = {
    fromHand,
    activationZone,
    sourceZone:
      activationContext?.sourceZone || (fromHand ? "hand" : activationZone),
    effectId: effect.id,
    committed: activationContext?.committed === true,
    commitInfo: activationContext?.commitInfo || null,
    autoSelectSingleTarget: activationContext?.autoSelectSingleTarget,
    autoSelectTargets: activationContext?.autoSelectTargets,
    actionContext: activationContext?.actionContext || null,
    prepareOnly: activationContext?.prepareOnly === true,
  };

  const ctx = {
    source: card,
    player,
    opponent: this.game.getOpponent(player),
    activationZone,
    activationContext: normalizedActivationContext,
    actionContext: normalizedActivationContext.actionContext || null,
  };

  const condCheck = this.evaluateConditions(effect.conditions, ctx);
  if (!condCheck.ok) {
    return {
      success: false,
      needsSelection: false,
      reason: condCheck.reason,
    };
  }

  const optCheck = this.checkOncePerTurn(card, player, effect);
  if (!optCheck.ok) {
    return { success: false, needsSelection: false, reason: optCheck.reason };
  }

  const duelCheck = this.checkOncePerDuel(card, player, effect);
  if (!duelCheck.ok) {
    return {
      success: false,
      needsSelection: false,
      reason: duelCheck.reason,
    };
  }

  const targetResult = this.resolveTargets(
    effect.targets || [],
    ctx,
    selections
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


  if (normalizedActivationContext.prepareOnly) {
    return {
      success: true,
      needsSelection: false,
      prepared: true,
      effect,
      targets: targetResult.targets || {},
      activationContext: ctx.activationContext,
    };
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
  if (actionsResultFailed(actionsResult)) {
    return buildActionsFailure(actionsResult);
  }
  this.registerOncePerTurnUsage(card, player, effect);
  this.registerOncePerDuelUsage(card, player, effect);

  this.game.checkWinCondition();
  return { success: true, needsSelection: false };
}
