import { isExtremeDragon } from "./knowledge.js";

export const DRAGON_OPT_NAMES = {
  solarHand: "solar_eclipse_discard_summon_lunar",
  solarGy: "solar_eclipse_gy_revive_dragon",
  lunarSummon: "lunar_eclipse_summon_search",
  lunarGy: "lunar_eclipse_gy_summon_deck_dragon",
  stelyaSummon: "stelya_effect_choice",
  stelyaSearch: "stelya_effect_choice",
};

const LOW_DRAGON_NAMES = new Set([
  "Solar Eclipse Dragon",
  "Lunar Eclipse Dragon",
  "Stelya, Dragon Tamer",
  "Armored Dragon",
  "Grey Dragon",
  "Luminescent Dragon",
  "Voltaic Dragon",
]);

const USEFUL_DISCARD_REASONS = {
  "Solar Eclipse Dragon": "GY revive follow-up",
  "Voltaic Dragon": "discard burn and Tech-Void material",
  "Stelya, Dragon Tamer": "GY self-summon bridge",
  "Grey Dragon": "GY return effect",
  "Lunar Eclipse Dragon": "GY deck summon follow-up",
  "Black Bull Dragon": "GY Level 7/8 search",
  "Luminous Dragon": "revive/fusion follow-up",
  "Hellkite Dragon": "revive/recursion follow-up",
  "Purified Crystal Dragon": "revive/protection payoff",
};

function zoneCards(player, zone) {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  return Array.isArray(player[zone]) ? player[zone].filter(Boolean) : [];
}

function countNamed(cards = [], name) {
  return (cards || []).filter((card) => card?.name === name).length;
}

function hasName(cards = [], name) {
  return countNamed(cards, name) > 0;
}

function isDragonMonster(card) {
  return card?.cardKind === "monster" && card.type === "Dragon";
}

function isFaceupDragon(card) {
  return isDragonMonster(card) && !card.isFacedown;
}

function isLowDragon(card) {
  return isDragonMonster(card) && (card.level || 0) <= 4;
}

function isLevel5PlusDragon(card) {
  return isDragonMonster(card) && (card.level || 0) >= 5;
}

function instanceId(card) {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? card?.simInstanceId ?? null;
}

function summarizeCard(card, zone, index, extra = {}) {
  return {
    name: card?.name || "",
    zone,
    index,
    instanceId: instanceId(card),
    cardKind: card?.cardKind,
    type: card?.type,
    attribute: card?.attribute,
    level: card?.level,
    atk: card?.atk,
    def: card?.def,
    isFacedown: !!card?.isFacedown,
    ...extra,
  };
}

function summarizeCards(cards, zone, reasonFn = null) {
  return (cards || []).map((card, index) =>
    summarizeCard(card, zone, index, reasonFn ? reasonFn(card, index) : {}),
  );
}

function getUsageValue(store, key) {
  if (!store) return undefined;
  if (typeof store.get === "function") return store.get(key);
  return store[key];
}

function getOptStatus(game, player, optName, { isSimulatedState = false } = {}) {
  const prefixed = `once_per_turn:${optName}`;
  const currentTurn = game?.turnCounter;

  if (isSimulatedState) {
    const playerId = player?.id || "bot";
    const used = game?._dragonSimOnce?.[playerId]?.[optName] === true;
    return {
      name: optName,
      used,
      canUse: !used,
      assumed: false,
      source: "simulation._dragonSimOnce",
    };
  }

  if (!game || currentTurn === undefined || currentTurn === null) {
    return {
      name: optName,
      used: false,
      canUse: true,
      assumed: true,
      source: "simulated_or_missing_turn",
    };
  }

  const playerId = player?.id || "player";
  const gameStore = game.oncePerTurnUsage?.[playerId];
  const gameValue = getUsageValue(gameStore, prefixed) ?? getUsageValue(gameStore, optName);
  if (gameValue !== undefined) {
    const used = gameValue === currentTurn || gameValue === true;
    return {
      name: optName,
      used,
      canUse: !used,
      assumed: false,
      source: "game.oncePerTurnUsage",
    };
  }

  const playerStore = player?.oncePerTurnUsageByName;
  const playerValue =
    getUsageValue(playerStore, optName) ?? getUsageValue(playerStore, prefixed);
  if (playerValue !== undefined) {
    const used = playerValue === currentTurn || playerValue === true;
    return {
      name: optName,
      used,
      canUse: !used,
      assumed: false,
      source: "player.oncePerTurnUsageByName",
    };
  }

  return {
    name: optName,
    used: false,
    canUse: true,
    assumed: true,
    source: "no_usage_store",
  };
}

function buildOptState(game, player, options = {}) {
  const byKey = Object.fromEntries(
    Object.entries(DRAGON_OPT_NAMES).map(([key, optName]) => [
      key,
      getOptStatus(game, player, optName, options),
    ]),
  );
  return {
    ...byKey,
    byName: Object.fromEntries(
      Object.entries(DRAGON_OPT_NAMES).map(([key, optName]) => [optName, byKey[key]]),
    ),
  };
}

function discardPriority(card, context = {}) {
  if (!card) return null;
  const reason = USEFUL_DISCARD_REASONS[card.name];
  if (!reason) return null;

  let value = 5;
  if (card.name === "Solar Eclipse Dragon") value = context.opt?.solarGy?.canUse ? 10 : 7;
  if (card.name === "Lunar Eclipse Dragon") value = context.opt?.lunarGy?.canUse ? 8 : 5;
  if (card.name === "Stelya, Dragon Tamer") value = context.hasDragonFieldBodyForStelya ? 8 : 6;
  if (card.name === "Voltaic Dragon") value = 9;
  if (card.name === "Grey Dragon") value = 7;
  if (card.name === "Black Bull Dragon") value = 7;
  if (card.name === "Luminous Dragon") value = context.hasLuminousForRadiant ? 3 : 5;
  if (card.name === "Hellkite Dragon") value = context.hasLevel7PlusForRoar ? 4 : 5;
  if (card.name === "Purified Crystal Dragon") value = context.hasThreeSafeGYDragonsForPurified ? 4 : 5;

  return { value, reason };
}

function stelyaCostReason(card, context = {}) {
  const reasons = [];
  let risk = 0;

  if (!card) return { value: 0, risk: 99, reason: "missing card" };
  if (card.isFacedown) {
    risk += 6;
    reasons.push("facedown Dragon is less certain");
  }
  if (isExtremeDragon(card)) {
    risk += 20;
    reasons.push("preserve Extreme boss");
  }
  if (card.monsterType === "fusion" || card.monsterType === "ascension") {
    risk += 18;
    reasons.push("preserve Extra Deck boss");
  }
  if (card.name === "Voltaic Dragon" && context.hasVoltaicForTechVoid) {
    risk += 8;
    reasons.push("Voltaic supports Tech-Void");
  }
  if (card.name === "Luminous Dragon" && context.hasLuminousForRadiant) {
    risk += 8;
    reasons.push("Luminous supports Radiant");
  }
  if (card.name === "Purified Crystal Dragon") {
    risk += 8;
    reasons.push("Purified is a protection/Rainbow resource");
  }

  if (LOW_DRAGON_NAMES.has(card.name)) {
    reasons.push("small Dragon can be converted");
  }
  if (card.name === "Armored Dragon") reasons.push("Armored is expendable after search");
  if (card.name === "Solar Eclipse Dragon") reasons.push("Solar can be expendable after summon");
  if (card.name === "Lunar Eclipse Dragon") reasons.push("Lunar can be expendable after search");
  if (reasons.length === 0) reasons.push("generic Dragon field body");

  return {
    value: Math.max(0, 10 - risk),
    risk,
    safe: risk <= 6,
    reason: reasons.join("; "),
  };
}

function isCriticalGyDragon(card, context = {}) {
  const reasons = [];

  if (card.name === "Solar Eclipse Dragon" && context.opt?.solarGy?.canUse) {
    reasons.push("Solar GY revive is available");
  }
  if (card.name === "Lunar Eclipse Dragon" && context.opt?.lunarGy?.canUse) {
    reasons.push("Lunar GY deck summon is available");
  }
  if (
    card.name === "Stelya, Dragon Tamer" &&
    context.opt?.stelyaSummon?.canUse
  ) {
    reasons.push(
      context.hasDragonFieldBodyForStelya
        ? "Stelya can self-summon from GY"
        : "Stelya GY effect is pending",
    );
  }
  if (card.name === "Voltaic Dragon" && context.voltaicInGYCount <= 1 && context.hasVoltaicForTechVoid) {
    reasons.push("unique Voltaic supports Tech-Void");
  }
  if (card.name === "Luminous Dragon" && context.luminousInGYCount <= 1 && context.hasLuminousForRadiant) {
    reasons.push("unique Luminous supports Radiant");
  }
  if (card.name === "Black Bull Dragon") {
    reasons.push("Black Bull GY search remains valuable");
  }
  if (card.name === "Hellkite Dragon" && (context.hasLevel7PlusForRoar || context.hasCallSetOrHand)) {
    reasons.push("Hellkite supports Roar or recursion");
  }
  if (isExtremeDragon(card) && context.hasCallSetOrHand) {
    reasons.push("Extreme Dragon is a Call target");
  }

  return reasons;
}

function buildGyResource(card, context = {}) {
  const reasons = [];
  let value = 0;

  if (card.name === "Solar Eclipse Dragon") {
    value += context.opt?.solarGy?.canUse ? 10 : 5;
    reasons.push(context.opt?.solarGy?.canUse ? "Solar GY revive available" : "Solar name in GY");
  }
  if (card.name === "Lunar Eclipse Dragon") {
    value += context.opt?.lunarGy?.canUse ? 10 : 5;
    reasons.push(context.opt?.lunarGy?.canUse ? "Lunar GY deck summon available" : "Lunar name in GY");
  }
  if (card.name === "Stelya, Dragon Tamer") {
    value += context.hasDragonFieldBodyForStelya ? 8 : 4;
    reasons.push(
      context.hasDragonFieldBodyForStelya
        ? "Stelya can self-summon with field Dragon"
        : "Stelya can become bridge later",
    );
  }
  if (card.name === "Voltaic Dragon") {
    value += context.hasVoltaicForTechVoid ? 8 : 4;
    reasons.push("Voltaic can support Tech-Void or discard burn history");
  }
  if (card.name === "Luminous Dragon") {
    value += context.hasLuminousForRadiant ? 8 : 4;
    reasons.push("Luminous can support Radiant or Call lines");
  }
  if (card.name === "Black Bull Dragon") {
    value += 7;
    reasons.push("Black Bull can search Level 7/8 Dragon");
  }
  if (card.name === "Hellkite Dragon") {
    value += 5;
    reasons.push("Hellkite can be revived for Roar/recursion");
  }
  if (isLowDragon(card)) {
    value += 2;
    reasons.push("Level 4 or lower Dragon is revivable");
  }
  if (isExtremeDragon(card) && context.hasCallSetOrHand) {
    value += 5;
    reasons.push("Extreme Dragon is a high-impact revive target");
  }

  if (reasons.length === 0) return null;
  return { value, reasons };
}

function hasCallAccess(hand, spellTrap) {
  return hasName(hand, "Call of the Haunted") || hasName(spellTrap, "Call of the Haunted");
}

function hasRadiantMaterials(cards) {
  const dragons = (cards || []).filter(isDragonMonster);
  return (
    dragons.length >= 3 &&
    dragons.some((card) => String(card.attribute || "").toLowerCase() === "light")
  );
}

function hasTechVoidMaterials(cards) {
  const dragons = (cards || []).filter(isDragonMonster);
  return (
    dragons.some((card) => card.name === "Voltaic Dragon") &&
    dragons.some((card) => card.name !== "Voltaic Dragon" && (card.level || 0) >= 5)
  );
}

export function analyzeDragonState({
  game = null,
  bot = {},
  opponent = {},
  isSimulatedState = false,
} = {}) {
  const hand = zoneCards(bot, "hand");
  const field = zoneCards(bot, "field");
  const deck = zoneCards(bot, "deck");
  const graveyard = zoneCards(bot, "graveyard");
  const spellTrap = zoneCards(bot, "spellTrap");
  const extraDeck = zoneCards(bot, "extraDeck");
  const opponentField = zoneCards(opponent, "field");
  const opt = buildOptState(game, bot, { isSimulatedState });
  const faceupFieldDragons = field.filter(isFaceupDragon);
  const allFusionMaterialZones = [...hand, ...field];
  const hasDragonFieldBodyForStelya = faceupFieldDragons.length > 0;
  const hasTwoDragonsForAwakening = faceupFieldDragons.length >= 2;
  const hasLevel7PlusForRoar = faceupFieldDragons.some((card) => (card.level || 0) >= 7);
  const hasVoltaicForTechVoid = hasTechVoidMaterials(allFusionMaterialZones) || hasName(graveyard, "Voltaic Dragon");
  const hasLuminousForRadiant = hasRadiantMaterials(allFusionMaterialZones) || hasName(graveyard, "Luminous Dragon");
  const hasCallSetOrHand = hasCallAccess(hand, spellTrap);
  const context = {
    opt,
    hasDragonFieldBodyForStelya,
    hasTwoDragonsForAwakening,
    hasLevel7PlusForRoar,
    hasVoltaicForTechVoid,
    hasLuminousForRadiant,
    hasCallSetOrHand,
    voltaicInGYCount: countNamed(graveyard, "Voltaic Dragon"),
    luminousInGYCount: countNamed(graveyard, "Luminous Dragon"),
  };

  const lowLevelDragonGYTargets = graveyard.filter(isLowDragon);
  const solarReviveTargets = lowLevelDragonGYTargets.filter(
    (card) => card.name !== "Solar Eclipse Dragon",
  );
  const lunarDeckTargets = deck.filter(isLowDragon);
  const usefulDiscardCandidates = hand
    .map((card, index) => ({ card, index, discard: discardPriority(card, context) }))
    .filter((entry) => entry.discard)
    .sort((a, b) => b.discard.value - a.discard.value)
    .map((entry) =>
      summarizeCard(entry.card, "hand", entry.index, {
        value: entry.discard.value,
        reason: entry.discard.reason,
      }),
    );
  const stelyaCostCandidates = faceupFieldDragons
    .map((card) => ({ card, detail: stelyaCostReason(card, context) }))
    .sort((a, b) => b.detail.value - a.detail.value)
    .map((entry) =>
      summarizeCard(entry.card, "field", field.indexOf(entry.card), entry.detail),
    );
  const awakeningCostCandidates = faceupFieldDragons
    .map((card) =>
      summarizeCard(card, "field", field.indexOf(card), {
        safe: !isExtremeDragon(card),
        reason: isExtremeDragon(card)
          ? "avoid sending active Extreme boss"
          : "Dragon body can pay Awakening",
      }),
    );

  const gyBanishCandidates = graveyard.filter(isDragonMonster).map((card) => {
    const criticalReasons = isCriticalGyDragon(card, context);
    return summarizeCard(card, "graveyard", graveyard.indexOf(card), {
      safe: criticalReasons.length === 0,
      reasons: criticalReasons,
      reason: criticalReasons.length ? criticalReasons.join("; ") : "safe GY Dragon for Purified",
    });
  });
  const purifiedSafeBanishCandidates = gyBanishCandidates.filter((entry) => entry.safe);
  const purifiedProtectedBanishCandidates = gyBanishCandidates.filter((entry) => !entry.safe);
  const gyResources = graveyard
    .map((card) => ({ card, resource: isDragonMonster(card) ? buildGyResource(card, context) : null }))
    .filter((entry) => entry.resource)
    .sort((a, b) => b.resource.value - a.resource.value)
    .map((entry) =>
      summarizeCard(entry.card, "graveyard", graveyard.indexOf(entry.card), {
        value: entry.resource.value,
        reasons: entry.resource.reasons,
      }),
    );

  const techVoidMaterials = {
    hasMaterials: hasTechVoidMaterials(allFusionMaterialZones),
    voltaic: summarizeCards(
      allFusionMaterialZones.filter((card) => card?.name === "Voltaic Dragon"),
      "hand_or_field",
    ),
    level5PlusDragons: summarizeCards(
      allFusionMaterialZones.filter(
        (card) => isLevel5PlusDragon(card) && card.name !== "Voltaic Dragon",
      ),
      "hand_or_field",
    ),
    gyBuffTargets: summarizeCards(lowLevelDragonGYTargets, "graveyard"),
  };

  const radiantMaterials = {
    hasMaterials: hasRadiantMaterials(allFusionMaterialZones),
    lightDragons: summarizeCards(
      allFusionMaterialZones.filter(
        (card) => isDragonMonster(card) && String(card.attribute || "").toLowerCase() === "light",
      ),
      "hand_or_field",
    ),
    dragons: summarizeCards(allFusionMaterialZones.filter(isDragonMonster), "hand_or_field"),
  };

  const hasThreeSafeGYDragonsForPurified = purifiedSafeBanishCandidates.length >= 3;
  const state = {
    opt,
    zones: {
      handDragonCount: hand.filter(isDragonMonster).length,
      fieldDragonCount: field.filter(isDragonMonster).length,
      faceupFieldDragonCount: faceupFieldDragons.length,
      deckDragonCount: deck.filter(isDragonMonster).length,
      graveyardDragonCount: graveyard.filter(isDragonMonster).length,
      extraDeckDragonCount: extraDeck.filter(isDragonMonster).length,
      opponentThreatCount: opponentField.filter((card) => card?.cardKind === "monster").length,
    },
    hasSolarInHand: hasName(hand, "Solar Eclipse Dragon"),
    hasSolarInGY: hasName(graveyard, "Solar Eclipse Dragon"),
    hasLunarInHand: hasName(hand, "Lunar Eclipse Dragon"),
    hasLunarInDeck: hasName(deck, "Lunar Eclipse Dragon"),
    hasLunarInGY: hasName(graveyard, "Lunar Eclipse Dragon"),
    hasStelyaInHand: hasName(hand, "Stelya, Dragon Tamer"),
    hasStelyaInDeck: hasName(deck, "Stelya, Dragon Tamer"),
    hasStelyaInGY: hasName(graveyard, "Stelya, Dragon Tamer"),
    hasUsefulLunarDiscard: usefulDiscardCandidates.length > 0,
    hasDragonFieldBodyForStelya,
    hasTwoDragonsForAwakening,
    hasLevel7PlusForRoar,
    hasVoltaicForTechVoid,
    hasLuminousForRadiant,
    hasThreeSafeGYDragonsForPurified,
    hasExtremeDragonFaceup: faceupFieldDragons.some(isExtremeDragon),
    hasCallSetOrHand,
    lowLevelDragonGYTargets: summarizeCards(lowLevelDragonGYTargets, "graveyard"),
    solarReviveTargets: summarizeCards(solarReviveTargets, "graveyard"),
    jaggedPeakRecoverTargets: summarizeCards(lowLevelDragonGYTargets, "graveyard"),
    callReviveTargets: summarizeCards(graveyard.filter((card) => card?.cardKind === "monster"), "graveyard"),
    lunarDeckTargets: summarizeCards(lunarDeckTargets, "deck", (card) => ({
      preferred: LOW_DRAGON_NAMES.has(card.name),
      reason: LOW_DRAGON_NAMES.has(card.name)
        ? "current Dragon list low-level target"
        : "generic Level 4 or lower Dragon",
    })),
    usefulDiscardCandidates,
    stelyaCostCandidates,
    awakeningCostCandidates,
    purifiedSafeBanishCandidates,
    purifiedProtectedBanishCandidates,
    gyResources,
    fusionPieces: {
      techVoid: techVoidMaterials,
      radiant: radiantMaterials,
    },
  };

  return state;
}
