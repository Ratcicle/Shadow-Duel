/**
 * activation/preview.js
 * Activation preview/check methods (no side effects)
 * Functions assume `this` = EffectEngine instance
 */

import {
  canActivateDuringDamageStep,
  canActivateSetQuickSpell,
  canActivateQuickSpellFromHand,
  isQuickSpell,
} from "../../game/spellTrap/quickSpellRules.js";

function hasImpossibleSelectionRequirement(targetResult) {
  const requirements = targetResult?.selectionContract?.requirements || [];
  return requirements.some((requirement) => {
    const min = Number(requirement?.min ?? 0);
    const candidates = Array.isArray(requirement?.candidates)
      ? requirement.candidates
      : [];
    return min > 0 && candidates.length < min;
  });
}

function impossibleSelectionReason(targetResult, fallback) {
  const requirements = targetResult?.selectionContract?.requirements || [];
  const impossible = requirements.find((requirement) => {
    const min = Number(requirement?.min ?? 0);
    const candidates = Array.isArray(requirement?.candidates)
      ? requirement.candidates
      : [];
    return min > 0 && candidates.length < min;
  });
  if (!impossible) return fallback;
  return `Need ${Number(impossible.min ?? 1)} valid target(s).`;
}

/**
 * Check if a monster has an activatable graveyard effect.
 */
export function hasActivatableGraveyardEffect(card, player = null) {
  if (!card) return false;
  if (player) {
    if (card.cardKind === "monster") {
      const firstActivatable =
        this.getFirstActivatableMonsterIgnitionEffect?.(
          card,
          player,
          "graveyard",
        );
      return !!(
        firstActivatable ||
        this.canActivateMonsterEffectPreview?.(card, player, "graveyard")?.ok
      );
    }
    if (card.cardKind === "spell" || card.cardKind === "trap") {
      return !!this.canActivateSpellTrapEffectPreview?.(
        card,
        player,
        "graveyard"
      )?.ok;
    }
    return false;
  }
  return card.effects?.some(
    (e) => e.timing === "ignition" && e.requireZone === "graveyard"
  );
}

/**
 * Basic activation check for a spell card.
 */
export function canActivate(card, player) {
  if (card.cardKind !== "spell") {
    return { ok: false, reason: "Card is not a spell." };
  }
  if (this.game.turn !== player.id) {
    return { ok: false, reason: "Not your turn." };
  }
  if (this.game.phase !== "main1" && this.game.phase !== "main2") {
    return { ok: false, reason: "Can only activate in Main Phase." };
  }

  return { ok: true };
}

/**
 * Dry-run check for activating a Spell from hand (no side effects).
 */
export function canActivateSpellFromHandPreview(card, player, options = {}) {
  options = options || {};
  if (!card || !player) {
    return { ok: false, reason: "Missing card or player." };
  }
  if (card.cardKind !== "spell") {
    return { ok: false, reason: "Card is not a spell." };
  }
  if (!player.hand || !player.hand.includes(card)) {
    return { ok: false, reason: "Card not in hand." };
  }
  if (card.subtype !== "field" && (player.spellTrap || []).length >= 5) {
    return { ok: false, reason: "Spell/Trap Zone is full." };
  }

  // Check for fusion spell (has polymerization_fusion_summon action)
  // Generic check instead of hardcoded card name
  const hasFusionAction = (card.effects || []).some(
    (e) =>
      e &&
      Array.isArray(e.actions) &&
      e.actions.some((a) => a && a.type === "polymerization_fusion_summon")
  );
  if (hasFusionAction) {
    const canActivatePoly = this.game?.canActivatePolymerization?.(player);
    if (!canActivatePoly) {
      return { ok: false, reason: "No valid fusion materials available." };
    }
  }

  const effect = this.getHandActivationEffect(card);
  if (isQuickSpell(card)) {
    const quickSpellContext = {
      ...(options.activationContext?.quickSpellContext || {}),
      ...(options.quickSpellContext || {}),
      activationZone: "hand",
      effect,
    };
    const quickCheck = canActivateQuickSpellFromHand(
      this.game,
      card,
      player,
      quickSpellContext,
    );
    if (!quickCheck.ok) {
      return quickCheck;
    }
  } else {
    const baseCheck = this.canActivate(card, player);
    if (!baseCheck.ok) {
      return baseCheck;
    }
  }

  const isFieldSpell = card.subtype === "field";
  const isContinuousSpell = card.subtype === "continuous";
  const placementOnly = !effect && (isFieldSpell || isContinuousSpell);
  if (!effect) {
    return placementOnly
      ? { ok: true, placementOnly: true }
      : { ok: false, reason: "No on_play effect." };
  }

  const restrictionCheck =
    this.game?.canActivateCardEffectUnderRestrictions?.(card, player, effect, {
      silent: true,
    });
  if (restrictionCheck?.ok === false) {
    return { ok: false, reason: restrictionCheck.reason };
  }

  const optCheck = this.checkOncePerTurn(card, player, effect);
  if (!optCheck.ok) return { ok: false, reason: optCheck.reason };

  const opdCheck = this.checkOncePerDuel(card, player, effect);
  if (!opdCheck.ok) return { ok: false, reason: opdCheck.reason };

  const activationContext = {
    ...(options.activationContext || {}),
    preview: true,
  };
  const ctx = {
    source: card,
    player,
    opponent: this.game?.getOpponent?.(player),
    activationZone: "hand",
    activationContext,
  };

  if (effect.conditions) {
    const condResult = this.evaluateConditions(effect.conditions, ctx);
    if (!condResult.ok) {
      return { ok: false, reason: condResult.reason };
    }
  }

  if (effect.requireEmptyField && (player.field?.length || 0) > 0) {
    return { ok: false, reason: "You must control no monsters." };
  }

  const actionCheck = this.checkActionPreviewRequirements(effect.actions || [], {
    ...ctx,
    effect,
  });
  if (!actionCheck.ok) {
    return { ok: false, reason: actionCheck.reason };
  }

  const targetResult = this.resolveTargets(effect.targets || [], ctx, null);
  if (targetResult.ok === false) {
    return { ok: false, reason: targetResult.reason };
  }
  if (hasImpossibleSelectionRequirement(targetResult)) {
    return {
      ok: false,
      reason: impossibleSelectionReason(targetResult, "No valid targets."),
    };
  }

  return {
    ok: true,
    needsSelection: !!targetResult.needsSelection,
  };
}

/**
 * Lightweight check to see if a monster effect could be activated from a zone,
 * without consuming OPT flags or performing actions. Used for UI pre-checks
 * (e.g., showing the Special Summon button in hand).
 */
export function canActivateMonsterEffectPreview(
  card,
  player,
  activationZone = "field",
  selections = null,
  options = {}
) {
  if (!card || !player) {
    return { ok: false, reason: "Missing card or player." };
  }
  if (card.owner !== player.id) {
    return { ok: false, reason: "Card does not belong to the player." };
  }
  if (card.cardKind !== "monster") {
    return { ok: false, reason: "Only Monster cards can use this effect." };
  }
  const isPublicOutOfPlayZone =
    activationZone === "graveyard" || activationZone === "banished";
  if (card.isFacedown && activationZone !== "hand" && !isPublicOutOfPlayZone) {
    return { ok: false, reason: "Card must be face-up to activate." };
  }
  if (this.game?.turn !== player.id) {
    return { ok: false, reason: "Not your turn." };
  }

  if (activationZone === "hand") {
    if (!player.hand || !player.hand.includes(card)) {
      return { ok: false, reason: "Card is not in your hand." };
    }
  } else if (activationZone === "field") {
    if (!player.field || !player.field.includes(card)) {
      return { ok: false, reason: "Card is not on the field." };
    }
  } else if (activationZone === "graveyard") {
    if (!player.graveyard || !player.graveyard.includes(card)) {
      return { ok: false, reason: "Card is not in your graveyard." };
    }
  }

  const requestedEffectId =
    options.effectId || options.activationContext?.effectId || null;
  const effect = this.getMonsterIgnitionEffect
    ? this.getMonsterIgnitionEffect(card, activationZone, {
        effectId: requestedEffectId,
      })
    : (card.effects || []).find(
        (e) =>
          e &&
          e.timing === "ignition" &&
          (activationZone === "field"
            ? !e.requireZone || e.requireZone === "field"
            : e.requireZone === activationZone) &&
          (!requestedEffectId || e.id === requestedEffectId)
      );

  if (!effect) {
    return { ok: false, reason: "No ignition effect defined for this zone." };
  }

  const restrictionCheck =
    this.game?.canActivateCardEffectUnderRestrictions?.(card, player, effect, {
      silent: true,
    });
  if (restrictionCheck?.ok === false) {
    return { ok: false, reason: restrictionCheck.reason };
  }

  const isMainPhase =
    this.game?.phase === "main1" || this.game?.phase === "main2";
  const isManualFieldQuickEffect =
    activationZone === "field" &&
    (effect.isQuickEffect === true || Number(effect.speed) === 2);
  const isBattlePhase = this.game?.phase === "battle";
  if (!isMainPhase && !(isManualFieldQuickEffect && isBattlePhase)) {
    return {
      ok: false,
      reason: "Effect can only be activated during Main Phase.",
    };
  }

  const damageStepCheck = canActivateDuringDamageStep(effect, card, {
    ...(options.activationContext?.context || {}),
    ...(options.activationContext?.actionContext || {}),
    activationZone,
    phase: this.game?.phase || null,
  });
  if (!damageStepCheck.ok) {
    return { ok: false, reason: damageStepCheck.reason };
  }

  const activationContext = {
    ...(options.activationContext || {}),
    ...(effect?.id ? { effectId: effect.id } : {}),
    preview: true,
  };
  const ctx = {
    source: card,
    player,
    opponent: this.game.getOpponent(player),
    activationZone,
    activationContext,
  };

  const optCheck = this.checkOncePerTurn(card, player, effect);
  if (!optCheck.ok) {
    return { ok: false, reason: optCheck.reason };
  }

  const opdCheck = this.checkOncePerDuel(card, player, effect);
  if (!opdCheck.ok) {
    return { ok: false, reason: opdCheck.reason };
  }

  if (effect.conditions) {
    const condResult = this.evaluateConditions(effect.conditions, ctx);
    if (!condResult.ok) {
      return { ok: false, reason: condResult.reason };
    }
  }

  if (effect.requireEmptyField && (player.field?.length || 0) > 0) {
    return { ok: false, reason: "You must control no monsters." };
  }

  const actionCheck = this.checkActionPreviewRequirements(
    effect.actions || [],
    { ...ctx, effect }
  );
  if (!actionCheck.ok) {
    return { ok: false, reason: actionCheck.reason };
  }

  const targetResult = this.resolveTargets(
    effect.targets || [],
    ctx,
    selections
  );

  if (targetResult.needsSelection) {
    return { ok: true, reason: "Selection needed." };
  }

  if (targetResult.ok === false) {
    return { ok: false, reason: targetResult.reason };
  }
  if (hasImpossibleSelectionRequirement(targetResult)) {
    return {
      ok: false,
      reason: impossibleSelectionReason(targetResult, "No valid targets."),
    };
  }

  return { ok: true };
}

/**
 * Preview for Spell/Trap ignition/on_activate effects while on the field.
 */
export function canActivateSpellTrapEffectPreview(
  card,
  player,
  activationZone = "spellTrap",
  selections = null,
  options = {}
) {
  if (!card || !player) {
    return { ok: false, reason: "Missing card or player." };
  }
  if (card.owner !== player.id) {
    return { ok: false, reason: "Card does not belong to the player." };
  }
  if (card.cardKind !== "spell" && card.cardKind !== "trap") {
    return {
      ok: false,
      reason: "Only Spell/Trap cards can use this effect.",
    };
  }
  if (this.game?.turn !== player.id) {
    return { ok: false, reason: "Not your turn." };
  }

  const effect = this.getSpellTrapActivationEffect(card, {
    fromHand: false,
    activationZone,
    trapActivationFromSet:
      card.cardKind === "trap" && card.isFacedown === true,
  });
  const setQuickSpell =
    isQuickSpell(card) &&
    activationZone === "spellTrap" &&
    card.isFacedown === true;

  if (card.cardKind === "spell" && !setQuickSpell) {
    if (this.game?.turn !== player.id) {
      return { ok: false, reason: "Not your turn." };
    }
    if (this.game?.phase !== "main1" && this.game?.phase !== "main2") {
      return {
        ok: false,
        reason: "Spell can only be activated during Main Phase.",
      };
    }
    // 🚫 Equip Spells cannot be activated from spellTrap zone
    if (card.subtype === "equip" && activationZone === "spellTrap") {
      const hasFieldIgnition = (card.effects || []).some(
        (e) =>
          e &&
          e.timing === "ignition" &&
          (!e.requireZone ||
            e.requireZone === "spellTrap" ||
            e.requireZone === "field")
      );
      if (!hasFieldIgnition) {
        return {
          ok: false,
          reason: "Equip Spell can only be activated from hand.",
        };
      }
    }
  } else if (card.cardKind === "trap") {
    const validPhases = ["main1", "battle", "main2"];
    if (!validPhases.includes(this.game?.phase)) {
      return {
        ok: false,
        reason: "Trap cannot be activated during this phase.",
      };
    }
  }

  if (activationZone === "spellTrap") {
    if (!player.spellTrap || !player.spellTrap.includes(card)) {
      return { ok: false, reason: "Card is not in Spell/Trap zone." };
    }
  } else if (activationZone === "fieldSpell") {
    if (player.fieldSpell !== card) {
      return { ok: false, reason: "Card is not in Field Spell zone." };
    }
  } else if (activationZone === "graveyard") {
    if (!player.graveyard || !player.graveyard.includes(card)) {
      return { ok: false, reason: "Card is not in your graveyard." };
    }
  }

  if (setQuickSpell) {
    const quickSpellContext = {
      ...(options.activationContext?.quickSpellContext || {}),
      ...(options.quickSpellContext || {}),
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
      return quickCheck;
    }
  } else if (card.cardKind === "trap" && card.isFacedown === true) {
    const canActivateTrap =
      typeof this.game?.canActivateTrap === "function"
        ? this.game.canActivateTrap(card)
        : card.isFacedown === true;
    if (!canActivateTrap) {
      return { ok: false, reason: "Trap cannot be activated this turn." };
    }
  } else if (card.cardKind === "spell" && card.isFacedown) {
    if (activationZone !== "spellTrap") {
      return { ok: false, reason: "Card must be face-up to activate." };
    }
    const setTurn = card.setTurn ?? card.turnSetOn ?? null;
    if (setTurn === null || setTurn >= this.game?.turnCounter) {
      return { ok: false, reason: "Spell cannot be activated this turn." };
    }
  }

  if (!effect) {
    const isSetContinuousSpell =
      card.cardKind === "spell" &&
      card.isFacedown === true &&
      activationZone === "spellTrap" &&
      (card.subtype === "continuous" || card.subtype === "field");
    const placementOnly =
      isSetContinuousSpell ||
      (card.cardKind === "trap" &&
        card.subtype === "continuous" &&
        (card.isFacedown === true ||
          options?.activationContext?.trapActivationFromSet === true));
    if (placementOnly) {
      return { ok: true, placementOnly: true };
    }
    return { ok: false, reason: "No ignition effect defined for this card." };
  }

  const restrictionCheck =
    this.game?.canActivateCardEffectUnderRestrictions?.(card, player, effect, {
      silent: true,
    });
  if (restrictionCheck?.ok === false) {
    return { ok: false, reason: restrictionCheck.reason };
  }

  const optCheck = this.checkOncePerTurn(card, player, effect);
  if (!optCheck.ok) return { ok: false, reason: optCheck.reason };

  const opdCheck = this.checkOncePerDuel(card, player, effect);
  if (!opdCheck.ok) return { ok: false, reason: opdCheck.reason };

  const activationContext = {
    ...(options.activationContext || {}),
    preview: true,
  };
  const ctx = {
    source: card,
    player,
    opponent: this.game?.getOpponent?.(player),
    activationZone,
    activationContext,
  };

  if (card.cardKind === "trap" && effect.timing === "ignition") {
    if (this.game?.turn !== player.id) {
      return { ok: false, reason: "Not your turn." };
    }
  }

  if (effect.requirePhase) {
    const allowedPhases = Array.isArray(effect.requirePhase)
      ? effect.requirePhase
      : [effect.requirePhase];
    if (!allowedPhases.includes(this.game?.phase)) {
      return { ok: false, reason: "Effect cannot be activated this phase." };
    }
  }

  if (effect.conditions) {
    const condResult = this.evaluateConditions(effect.conditions, ctx);
    if (!condResult.ok) {
      return { ok: false, reason: condResult.reason };
    }
  }

  if (effect.requireEmptyField && (player.field?.length || 0) > 0) {
    return { ok: false, reason: "You must control no monsters." };
  }

  const actionCheck = this.checkActionPreviewRequirements(
    effect.actions || [],
    { ...ctx, effect }
  );
  if (!actionCheck.ok) {
    return { ok: false, reason: actionCheck.reason };
  }

  const targetResult = this.resolveTargets(
    effect.targets || [],
    ctx,
    selections
  );
  if (targetResult.needsSelection) {
    return { ok: true, needsSelection: true };
  }
  if (targetResult.ok === false) {
    return { ok: false, reason: targetResult.reason };
  }

  return { ok: true };
}

/**
 * Preview for Field Spell effects while on the field.
 */
export function canActivateFieldSpellEffectPreview(
  card,
  player,
  selections = null,
  options = {}
) {
  if (!card || !player) {
    return { ok: false, reason: "Missing card or player." };
  }
  if (card.owner !== player.id) {
    return { ok: false, reason: "Card does not belong to the player." };
  }
  if (card.cardKind !== "spell" || card.subtype !== "field") {
    return { ok: false, reason: "Card is not a Field Spell." };
  }
  if (this.game?.turn !== player.id) {
    return { ok: false, reason: "Not your turn." };
  }
  if (this.game?.phase !== "main1" && this.game?.phase !== "main2") {
    return {
      ok: false,
      reason: "Effect can only be activated during Main Phase.",
    };
  }
  if (player.fieldSpell !== card) {
    return { ok: false, reason: "Card is not in Field Spell zone." };
  }

  const effect = this.getFieldSpellActivationEffect(card);
  if (!effect) {
    return { ok: false, reason: "No field activation effect defined." };
  }

  const restrictionCheck =
    this.game?.canActivateCardEffectUnderRestrictions?.(card, player, effect, {
      silent: true,
    });
  if (restrictionCheck?.ok === false) {
    return { ok: false, reason: restrictionCheck.reason };
  }

  const optCheck = this.checkOncePerTurn(card, player, effect);
  if (!optCheck.ok) return { ok: false, reason: optCheck.reason };

  const opdCheck = this.checkOncePerDuel(card, player, effect);
  if (!opdCheck.ok) return { ok: false, reason: opdCheck.reason };

  const activationContext = {
    ...(options.activationContext || {}),
    preview: true,
  };
  const ctx = {
    source: card,
    player,
    opponent: this.game?.getOpponent?.(player),
    activationZone: "fieldSpell",
    activationContext,
  };

  if (effect.conditions) {
    const condResult = this.evaluateConditions(effect.conditions, ctx);
    if (!condResult.ok) {
      return { ok: false, reason: condResult.reason };
    }
  }

  if (effect.requireEmptyField && (player.field?.length || 0) > 0) {
    return { ok: false, reason: "You must control no monsters." };
  }

  const actionCheck = this.checkActionPreviewRequirements(
    effect.actions || [],
    { ...ctx, effect }
  );
  if (!actionCheck.ok) {
    return { ok: false, reason: actionCheck.reason };
  }

  const targetResult = this.resolveTargets(
    effect.targets || [],
    ctx,
    selections
  );
  if (targetResult.needsSelection) {
    return { ok: true, needsSelection: true };
  }
  if (targetResult.ok === false) {
    return { ok: false, reason: targetResult.reason };
  }

  return { ok: true };
}
