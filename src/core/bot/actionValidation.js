export function resolveHandIndexForAction(bot, action, expectedKind) {
  if (!action) return -1;
  const hand = bot.hand || [];
  const idHint = action.cardId ?? action.card?.id ?? null;
  const nameHint = action.cardName || action.card?.name || null;
  const expectedKinds = Array.isArray(expectedKind)
    ? expectedKind
    : expectedKind
      ? [expectedKind]
      : null;
  const matchesKind = (card) => {
    if (!card) return false;
    if (expectedKinds && !expectedKinds.includes(card.cardKind)) return false;
    return true;
  };
  const matchesById = (card) => {
    if (!matchesKind(card)) return false;
    if (idHint === null || idHint === undefined) return false;
    return card.id === idHint;
  };
  const matchesByName = (card) => {
    if (!matchesKind(card)) return false;
    if (!nameHint) return true;
    return card.name === nameHint;
  };

  if (Number.isInteger(action.index)) {
    const direct = hand[action.index];
    if (matchesById(direct)) return action.index;
    if (
      (idHint === null || idHint === undefined) &&
      !nameHint &&
      matchesKind(direct)
    ) {
      return action.index;
    }
    if (
      (idHint === null || idHint === undefined) &&
      nameHint &&
      matchesByName(direct)
    ) {
      return action.index;
    }
    if (nameHint && matchesByName(direct)) return action.index;
  }

  if (idHint !== null && idHint !== undefined) {
    const foundIndex = hand.findIndex((card) => matchesById(card));
    if (foundIndex >= 0) return foundIndex;
  }

  if (nameHint) {
    const foundIndex = hand.findIndex((card) => matchesByName(card));
    if (foundIndex >= 0) return foundIndex;
  }

  return -1;
}

export function tributeMatchesAltRequirement(card, alt) {
  if (!card || card.cardKind !== "monster" || !alt) return false;
  if (card.isFacedown) return false;
  if (alt.requiresName && card.name !== alt.requiresName) return false;
  if (alt.requiresType && card.type !== alt.requiresType) return false;
  return true;
}

export function canResolveSummonActionForCurrentState(bot, action, game) {
  const resolvedIndex = resolveHandIndexForAction(bot, action, "monster");
  if (resolvedIndex < 0) return false;
  const card = bot.hand?.[resolvedIndex];
  if (!card || card.cardKind !== "monster") return false;
  if (card.cannotBeNormalSummonedOrSet) return false;
  if (card.summonRestrict === "shadow_heart_invocation_only") return false;

  const summonLimit = 1 + Math.max(0, Number(bot.additionalNormalSummons || 0));
  if (Number(bot.summonCount || 0) >= summonLimit) return false;

  const tributeInfo = bot.getTributeRequirementFor(card, bot) || {
    tributesNeeded: 0,
  };
  const tributesNeeded = Math.max(0, Number(tributeInfo.tributesNeeded || 0));
  const field = Array.isArray(bot.field) ? bot.field : [];
  if (field.length < tributesNeeded) return false;
  if (field.length - tributesNeeded + 1 > 5) return false;

  let tributeIndices = [];
  if (tributesNeeded > 0) {
    const opponent = game ? (bot === game.player ? game.bot : game.player) : null;
    tributeIndices =
      typeof bot.selectBestTributes === "function"
        ? bot.selectBestTributes(field, tributesNeeded, card, {
            oppField: opponent?.field || [],
            game,
          })
        : field.map((_entry, index) => index).slice(0, tributesNeeded);
    if (!Array.isArray(tributeIndices) || tributeIndices.length < tributesNeeded) {
      return false;
    }
    const uniqueIndices = [...new Set(tributeIndices)].filter(
      (index) => Number.isInteger(index) && field[index],
    );
    if (uniqueIndices.length < tributesNeeded) return false;
    tributeIndices = uniqueIndices.slice(0, tributesNeeded);
    if (
      tributeInfo.usingAlt === true &&
      tributeInfo.alt &&
      !tributeIndices.some((index) =>
        tributeMatchesAltRequirement(field[index], tributeInfo.alt),
      )
    ) {
      return false;
    }
  }

  if (typeof game?.canPlaceCardOnField === "function") {
    const isFacedown = action.facedown === true;
    const excluded = tributeIndices.map((index) => field[index]).filter(Boolean);
    const placeCheck = game.canPlaceCardOnField(card, bot, {
      zone: "monster",
      isFacedown,
      excludeCards: excluded,
      silent: true,
    });
    if (placeCheck?.ok === false) return false;
  }

  return true;
}

export function filterValidActionsForCurrentState(bot, actions, game) {
  if (!Array.isArray(actions)) return [];
  return actions.filter((action) => {
    if (!action || !action.type) return false;
    if (action.type === "summon") {
      return canResolveSummonActionForCurrentState(bot, action, game);
    }
    if (action.type === "spell") {
      return resolveHandIndexForAction(bot, action, "spell") >= 0;
    }
    if (action.type === "set_spell_trap") {
      return resolveHandIndexForAction(bot, action, ["spell", "trap"]) >= 0;
    }
    if (action.type === "spellTrapEffect") {
      const zoneIndex = Number.isInteger(action.zoneIndex)
        ? action.zoneIndex
        : action.index;
      const card = bot.spellTrap?.[zoneIndex];
      if (!card || card.cardKind !== "spell") return false;
      const activationContext = {
        ...(action.activationContext || {}),
        fromHand: false,
        activationZone: "spellTrap",
        sourceZone: "spellTrap",
      };
      const preview = game?.effectEngine?.canActivateSpellTrapEffectPreview?.(
        card,
        bot,
        "spellTrap",
        null,
        { activationContext },
      );
      return preview ? preview.ok !== false : true;
    }
    if (action.type === "graveyardSpellEffect") {
      const graveyardIndex = Number.isInteger(action.graveyardIndex)
        ? action.graveyardIndex
        : bot.graveyard.findIndex(
            (c) =>
              c &&
              (c.id === action.cardId ||
                (!action.cardId && c.name === action.cardName)),
          );
      const card = bot.graveyard?.[graveyardIndex];
      if (!card || card.cardKind !== "spell") return false;
      const activationContext = {
        ...(action.activationContext || {}),
        fromHand: false,
        activationZone: "graveyard",
        sourceZone: "graveyard",
      };
      const preview = game?.effectEngine?.canActivateSpellTrapEffectPreview?.(
        card,
        bot,
        "graveyard",
        null,
        { activationContext },
      );
      return preview ? preview.ok !== false : true;
    }
    if (action.type === "special_summon_sanctum_protector") {
      const handIndex = resolveHandIndexForAction(bot, action, "monster");
      if (handIndex < 0) return false;
      const materialIndex = Number.isInteger(action.materialIndex)
        ? action.materialIndex
        : bot.field.findIndex(
            (c) => c && c.name === "Luminarch Aegisbearer" && !c.isFacedown,
          );
      const material = bot.field[materialIndex];
      return !!(
        material &&
        material.name === "Luminarch Aegisbearer" &&
        !material.isFacedown
      );
    }
    if (action.type === "handIgnition") {
      return resolveHandIndexForAction(bot, action, "monster") >= 0;
    }
    if (action.type === "graveyardMonsterEffect") {
      const graveyardIndex = Number.isInteger(action.graveyardIndex)
        ? action.graveyardIndex
        : bot.graveyard.findIndex(
            (c) =>
              c &&
              (c.id === action.cardId ||
                (!action.cardId && c.name === action.cardName)),
          );
      const card = bot.graveyard?.[graveyardIndex];
      if (!card || card.cardKind !== "monster") return false;
      const preview = game?.effectEngine?.canActivateMonsterEffectPreview?.(
        card,
        bot,
        "graveyard",
        null,
        { activationContext: action.activationContext || {} },
      );
      return preview ? preview.ok !== false : true;
    }
    if (action.type === "monsterEffect") {
      const fieldIndex = Number.isInteger(action.fieldIndex)
        ? action.fieldIndex
        : bot.field.findIndex(
            (c) =>
              c &&
              (c.id === action.cardId ||
                (!action.cardId && c.name === action.cardName)),
          );
      const card = bot.field?.[fieldIndex];
      if (!card || card.cardKind !== "monster" || card.isFacedown) {
        return false;
      }
      const preview = game?.effectEngine?.canActivateMonsterEffectPreview?.(
        card,
        bot,
        "field",
        null,
        { activationContext: action.activationContext || {} },
      );
      return preview ? preview.ok !== false : true;
    }
    if (action.type === "ascension") {
      const material = bot.field[action.materialIndex];
      if (!material) return false;
      if (game?.canUseAsAscensionMaterial) {
        const check = game.canUseAsAscensionMaterial(bot, material);
        if (check && check.ok === false) return false;
      }
      return true;
    }
    if (action.type === "fieldEffect") {
      if (!bot.fieldSpell) return false;
      const activationContext = {
        ...(action.activationContext || {}),
        fromHand: false,
        activationZone: "fieldSpell",
        sourceZone: "fieldSpell",
      };
      const preview = game?.effectEngine?.canActivateFieldSpellEffectPreview?.(
        bot.fieldSpell,
        bot,
        null,
        { activationContext },
      );
      return preview ? preview.ok !== false : true;
    }
    if (action.type === "position_change") {
      const target = Number.isInteger(action.fieldIndex)
        ? bot.field?.[action.fieldIndex]
        : (bot.field || []).find(
            (c) =>
              c &&
              (c.id === action.cardId ||
                (!action.cardId && c.name === action.cardName)),
          );
      if (!target) return false;
      if (
        typeof game?.canChangePosition === "function" &&
        !game.canChangePosition(target)
      ) {
        return false;
      }
      if (
        action.toPosition &&
        (action.toPosition === "attack" || action.toPosition === "defense") &&
        target.position === action.toPosition
      ) {
        return false;
      }
      return true;
    }
    return true;
  });
}
