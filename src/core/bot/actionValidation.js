import {
  fieldHasTributeValue,
  getTributeCardsFromIndices,
  getTributeValueTotal,
} from "../game/summon/tributeValue.js";
import { canUseNormalSummonForCard } from "../Player.js";
import { canSetReactiveBackrowNow } from "../ai/common/phaseTiming.js";
import { getCanonicalEffectActivationZones } from "../chain/legality.js";

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

  if (!canUseNormalSummonForCard(bot, card)) return false;

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
    const tradeCheck =
      typeof bot.evaluateTributeTrade === "function"
        ? bot.evaluateTributeTrade(card, field, tributesNeeded, {
            oppField: opponent?.field || [],
            game,
          })
        : { ok: true };
    if (tradeCheck?.ok === false) return false;
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

function zoneCards(player, zoneName) {
  if (!player) return [];
  if (zoneName === "fieldSpell") {
    return player.fieldSpell ? [player.fieldSpell] : [];
  }
  const zone = player[zoneName];
  return Array.isArray(zone) ? zone.filter(Boolean) : [];
}

function controlledPublicCards(player) {
  return [
    ...zoneCards(player, "field").map((card) => ({ card, zone: "field" })),
    ...zoneCards(player, "spellTrap").map((card) => ({
      card,
      zone: "spellTrap",
    })),
    ...zoneCards(player, "fieldSpell").map((card) => ({
      card,
      zone: "fieldSpell",
    })),
  ];
}

function findEffectForAction(card, action, fallbackZone) {
  const contextualEffect = action?.activationContext?.effect;
  if (contextualEffect && Array.isArray(contextualEffect.actions)) {
    return contextualEffect;
  }

  const effects = Array.isArray(card?.effects) ? card.effects : [];
  if (action?.effectId) {
    const byId = effects.find((effect) => effect?.id === action.effectId);
    if (byId) return byId;
  }

  return effects.find((effect) => {
    if (effect?.timing !== "ignition") return false;
    if (
      fallbackZone &&
      !getCanonicalEffectActivationZones(card, effect).includes(fallbackZone)
    ) {
      return false;
    }
    return true;
  }) || null;
}

function actionRemovesFieldCounters(action) {
  if (!action) return false;
  if (
    action.type !== "remove_counters_from_field" &&
    action.type !== "remove_all_counters_from_field"
  ) {
    return false;
  }
  const zones = Array.isArray(action.zones)
    ? action.zones
    : [action.zone].filter(Boolean);
  if (zones.length === 0) return true;
  return zones.some((zone) =>
    ["field", "spellTrap", "fieldSpell"].includes(zone),
  );
}

function actionSummonsFromHand(action) {
  return action?.type === "conditional_summon_from_hand";
}

function effectRemovesCountersBeforeHandSummon(effect) {
  const actions = Array.isArray(effect?.actions) ? effect.actions : [];
  const summonIndex = actions.findIndex(actionSummonsFromHand);
  if (summonIndex <= 0) return false;
  return actions.slice(0, summonIndex).some(actionRemovesFieldCounters);
}

function actionSpecialSummonsToSelfField(action) {
  if (!action) return false;
  if (
    action.type !== "special_summon_token" &&
    action.type !== "special_summon_from_zone" &&
    action.type !== "special_summon_matching_level" &&
    action.type !== "draw_and_summon" &&
    action.type !== "search_then_optional_special_summon_from_hand"
  ) {
    return false;
  }
  return action.player === undefined || action.player === "self";
}

function cardEffectActiveInZone(card, zone, effect) {
  if (!card || !effect) return false;
  if (effect.requireZone && effect.requireZone !== zone) return false;
  if (effect.requireFaceup === true && card.isFacedown === true) return false;
  if (zone === "spellTrap" && card.isFacedown === true) return false;
  return true;
}

function controlsCounterRemovedSelfSummonTrigger(player) {
  return controlledPublicCards(player).some(({ card, zone }) => {
    const effects = Array.isArray(card?.effects) ? card.effects : [];
    return effects.some((effect) => {
      if (effect?.timing !== "on_event") return false;
      if (effect.event !== "counter_removed") return false;
      if (!cardEffectActiveInZone(card, zone, effect)) return false;
      const actions = Array.isArray(effect.actions) ? effect.actions : [];
      return actions.some(actionSpecialSummonsToSelfField);
    });
  });
}

function needsCounterRemovedSummonZoneReserve(bot, action, card) {
  if ((bot?.field || []).length <= 3) return false;
  const effect = findEffectForAction(card, action, "hand");
  if (!effectRemovesCountersBeforeHandSummon(effect)) return false;
  return controlsCounterRemovedSelfSummonTrigger(bot);
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
      const handIndex = resolveHandIndexForAction(bot, action, "spell");
      const card = bot.hand?.[handIndex];
      if (!card) return false;
      const activationContext = {
        ...(action.activationContext || {}),
        fromHand: true,
        sourceZone: "hand",
      };
      const preview = game?.effectEngine?.canActivateSpellFromHandPreview?.(
        card,
        bot,
        { activationContext },
      );
      return preview ? preview.ok !== false : true;
    }
    if (action.type === "set_spell_trap") {
      const handIndex = resolveHandIndexForAction(bot, action, ["spell", "trap"]);
      if (handIndex < 0) return false;
      const card = bot.hand?.[handIndex];
      return canSetReactiveBackrowNow(card, game);
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
      const handIndex = resolveHandIndexForAction(bot, action, "monster");
      const card = bot.hand?.[handIndex];
      if (!card || card.cardKind !== "monster") return false;
      if (needsCounterRemovedSummonZoneReserve(bot, action, card)) {
        return false;
      }
      const activationContext = {
        ...(action.activationContext || {}),
        effectId:
          action.effectId ||
          action.effect?.id ||
          action.activationContext?.effectId ||
          null,
        fromHand: true,
        activationZone: "hand",
        sourceZone: "hand",
        autoSelectTargets: action.activationContext?.autoSelectTargets !== false,
      };
      const preview = game?.effectEngine?.canActivateMonsterEffectPreview?.(
        card,
        bot,
        "hand",
        null,
        { activationContext },
      );
      return preview ? preview.ok !== false : true;
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
        {
          activationContext: {
            ...(action.activationContext || {}),
            effectId:
              action.effectId ||
              action.effect?.id ||
              action.activationContext?.effectId ||
              null,
          },
        },
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
        {
          activationContext: {
            ...(action.activationContext || {}),
            effectId:
              action.effectId ||
              action.effect?.id ||
              action.activationContext?.effectId ||
              null,
          },
        },
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
      if (
        typeof game?.checkAscensionRequirements === "function" &&
        action.ascensionCard
      ) {
        const requirementCheck = game.checkAscensionRequirements(
          bot,
          action.ascensionCard,
          material,
        );
        if (requirementCheck && requirementCheck.ok === false) return false;
      }
      if (
        action.ascensionCard &&
        typeof game?.canPlaceCardOnField === "function"
      ) {
        const placeCheck = game.canPlaceCardOnField(action.ascensionCard, bot, {
          isFacedown: false,
          excludeCards: [material],
          summonMethod: "ascension",
          summonProcedure: "ascension",
          silent: true,
        });
        if (placeCheck?.ok === false) return false;
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
