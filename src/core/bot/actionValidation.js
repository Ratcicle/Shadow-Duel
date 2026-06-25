import {
  fieldHasTributeValue,
  getTributeCardsFromIndices,
  getTributeValueTotal,
} from "../game/summon/tributeValue.js";

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
  if (!fieldHasTributeValue(field, tributesNeeded, card)) return false;

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
    if (!Array.isArray(tributeIndices) || tributeIndices.length === 0) {
      return false;
    }
    const uniqueIndices = [...new Set(tributeIndices)].filter(
      (index) => Number.isInteger(index) && field[index],
    );
    const tributeCards = getTributeCardsFromIndices(field, uniqueIndices);
    if (getTributeValueTotal(tributeCards, card) < tributesNeeded) return false;
    tributeIndices = uniqueIndices;
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

  if (field.length - tributeIndices.length + 1 > 5) return false;

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

function getCardInstanceIds(card) {
  return [
    card?.instanceId,
    card?._instanceId,
    card?.uid,
    card?.uuid,
    card?.simInstanceId,
    card?.fieldPresenceId,
  ].filter((id) => id !== null && id !== undefined);
}

function findExtraDeckCardForAction(bot, action) {
  const extraDeck = bot?.extraDeck || [];
  if (Number.isInteger(action.extraDeckIndex)) {
    const direct = extraDeck[action.extraDeckIndex];
    if (
      direct &&
      (direct.id === action.cardId ||
        direct.name === action.cardName ||
        direct.name === action.extraDeckCard?.name)
    ) {
      return direct;
    }
  }
  return extraDeck.find(
    (card) =>
      card &&
      (card.id === action.cardId ||
        card.name === action.cardName ||
        card.name === action.extraDeckCard?.name),
  );
}

function findFieldMaterialForHint(field = [], hint = {}) {
  const ids = Array.isArray(hint.instanceIds) ? hint.instanceIds : [];
  if (ids.length > 0) {
    const byInstance = field.find((card) => {
      const cardIds = getCardInstanceIds(card);
      return cardIds.some((id) => ids.includes(id));
    });
    if (byInstance) return byInstance;
  }

  if (Number.isInteger(hint.index)) {
    const direct = field[hint.index];
    if (
      direct &&
      (hint.id === undefined || direct.id === hint.id) &&
      (!hint.name || direct.name === hint.name)
    ) {
      return direct;
    }
  }

  return field.find(
    (card) =>
      card &&
      (hint.id === undefined || card.id === hint.id) &&
      (!hint.name || card.name === hint.name),
  );
}

function resolveExtraDeckProcedureMaterials(bot, action) {
  const field = bot?.field || [];
  const hints = Array.isArray(action.materials)
    ? action.materials
    : (action.materialIndices || []).map((index, offset) => ({
        index,
        id: action.materialIds?.[offset],
        name: action.materialNames?.[offset],
        instanceIds: action.materialInstanceIds?.[offset],
      }));
  const materials = [];
  for (const hint of hints) {
    const material = findFieldMaterialForHint(field, hint);
    if (!material || materials.includes(material)) return [];
    materials.push(material);
  }
  return materials;
}

function materialSelectionMatchesCombo(materials = [], combos = []) {
  if (!Array.isArray(materials) || !Array.isArray(combos)) return false;
  return combos.some((combo) => {
    if (!Array.isArray(combo) || combo.length !== materials.length) return false;
    const remaining = [...combo];
    for (const material of materials) {
      const index = remaining.indexOf(material);
      if (index < 0) return false;
      remaining.splice(index, 1);
    }
    return true;
  });
}

export function canResolveExtraDeckProcedureActionForCurrentState(
  bot,
  action,
  game,
) {
  const card = findExtraDeckCardForAction(bot, action);
  if (!card || !card.extraDeckSummonProcedure) return false;
  if (typeof game?.canSummonExtraDeckCardByProcedure !== "function") {
    return false;
  }

  const check = game.canSummonExtraDeckCardByProcedure(card, bot, {
    silent: true,
  });
  if (!check?.ok) return false;

  const materials = resolveExtraDeckProcedureMaterials(bot, action);
  if (materials.length !== Number(check.requiredCount || materials.length)) {
    return false;
  }
  const candidateSet = new Set(check.candidates || []);
  if (materials.some((material) => !candidateSet.has(material))) return false;
  if (
    check.materialCombos &&
    !materialSelectionMatchesCombo(materials, check.materialCombos)
  ) {
    return false;
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
      if (!card || (card.cardKind !== "spell" && card.cardKind !== "trap")) return false;
      const activationContext = {
        ...(action.activationContext || {}),
        fromHand: false,
        activationZone: "spellTrap",
        sourceZone: "spellTrap",
        trapActivationFromSet:
          action.activationContext?.trapActivationFromSet === true ||
          (card.cardKind === "trap" && card.isFacedown === true),
        autoSelectTargets: action.activationContext?.autoSelectTargets !== false,
        autoSelectSingleTarget:
          action.activationContext?.autoSelectSingleTarget !== false,
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
    if (action.type === "extraDeckProcedure") {
      return canResolveExtraDeckProcedureActionForCurrentState(bot, action, game);
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
