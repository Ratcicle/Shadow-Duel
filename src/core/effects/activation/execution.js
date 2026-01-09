/**
 * activation/execution.js
 * Effect activation execution methods
 * Functions assume `this` = EffectEngine instance
 */

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

  // Busca efeito ignition com requireZone: "graveyard"
  const effect = card.effects?.find(
    (e) => e.timing === "ignition" && e.requireZone === "graveyard"
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
    committed: activationContext?.committed === true,
    commitInfo: activationContext?.commitInfo || null,
    autoSelectSingleTarget: activationContext?.autoSelectSingleTarget,
    autoSelectTargets: activationContext?.autoSelectTargets,
    actionContext: activationContext?.actionContext || null,
  };

  const ctx = {
    source: card,
    player,
    opponent: this.game.getOpponent(player),
    activationZone: "graveyard",
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

  // Only register usage and check win after successful resolution
  this.registerOncePerTurnUsage(card, player, effect);
  this.registerOncePerDuelUsage(card, player, effect);

  // Emitir evento para captura de replay
  this.game?.emit?.("effect_activated", {
    card,
    player,
    effect,
    activationZone: "graveyard",
    effectType: "ignition",
  });

  this.game.checkWinCondition();
  return { success: true, needsSelection: false };
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
  };

  const ctx = {
    source: card,
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

  // Only register usage and check win after successful resolution
  this.registerOncePerTurnUsage(card, player, effect);
  this.game.checkWinCondition();

  return { success: true, needsSelection: false };
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
  const isSetSpell =
    card.cardKind === "spell" &&
    card.isFacedown === true &&
    activationZone === "spellTrap";
  let flipAfterChecks = false;
  if (card.isFacedown) {
    if (!isSetSpell) {
      return fail("Card must be face-up to activate.");
    }
    const setTurn = card.setTurn ?? card.turnSetOn ?? null;
    if (setTurn === null || this.game?.turnCounter <= setTurn) {
      return fail("Spell cannot be activated this turn.");
    }
    flipAfterChecks = true;
  }
  if (this.game.turn !== player.id) {
    return fail("Not your turn.");
  }
  if (this.game.phase !== "main1" && this.game.phase !== "main2") {
    return fail("Effect can only be activated during Main Phase.");
  }

  const fromHand = activationContext?.fromHand === true;
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
    resolvedTargets: activationContext?.resolvedTargets || null,
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
    effect = (card.effects || []).find(
      (e) => e && (e.timing === "on_activate" || e.timing === "ignition")
    );
    if (!effect) {
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
      effect = this.getSpellTrapActivationEffect(card, { fromHand: false });
      if (!effect) {
        const placementOnly =
          card.subtype === "continuous" || card.subtype === "field";
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

  // Check requireEmptyField condition
  if (effect.requireEmptyField && player.field.length > 0) {
    return fail("You must control no monsters to activate this effect.");
  }

  const ctx = {
    source: card,
    player,
    opponent: this.game.getOpponent(player),
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

  if (flipAfterChecks) {
    card.isFacedown = false;
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
  this.registerOncePerTurnUsage(card, player, effect);
  this.game.checkWinCondition();
  logDev?.("SPELL_TRAP_ACTIVATION_RESOLVED", {
    card: card.name,
    player: player.id,
  });

  // Emitir evento para captura de replay
  this.game?.emit?.("effect_activated", {
    card,
    player,
    effect,
    activationZone: card.subtype === "field" ? "fieldSpell" : "spellTrap",
    effectType: effect?.timing || "spell_trap",
  });

  return { success: true, needsSelection: false };
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
  if (this.game.phase !== "main1" && this.game.phase !== "main2") {
    return {
      success: false,
      needsSelection: false,
      reason: "Effect can only be activated during Main Phase.",
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

  // Check if effects are negated (only for cards on field)
  if (activationZone === "field" && this.isEffectNegated(card)) {
    return {
      success: false,
      needsSelection: false,
      reason: "Card's effects are currently negated.",
    };
  }

  // Find effect that matches activation zone
  let effect = null;
  if (activationZone === "hand") {
    // For hand effects, look for ignition effects with requireZone: "hand"
    effect = (card.effects || []).find(
      (e) => e && e.timing === "ignition" && e.requireZone === "hand"
    );
  } else {
    // For field effects, look for ignition effects without requireZone (or with requireZone: "field")
    effect = (card.effects || []).find(
      (e) =>
        e &&
        e.timing === "ignition" &&
        (!e.requireZone || e.requireZone === "field")
    );
  }

  if (!effect) {
    return {
      success: false,
      needsSelection: false,
      reason: "No ignition effect defined for this zone.",
    };
  }

  const fromHand =
    activationContext?.fromHand === true || activationZone === "hand";
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
  this.registerOncePerTurnUsage(card, player, effect);
  this.registerOncePerDuelUsage(card, player, effect);

  // Emitir evento para captura de replay
  this.game?.emit?.("effect_activated", {
    card,
    player,
    effect,
    activationZone,
    effectType: "ignition",
  });

  this.game.checkWinCondition();
  return { success: true, needsSelection: false };
}
