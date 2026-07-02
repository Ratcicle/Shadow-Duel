import {
  CARD_KNOWLEDGE,
  CURRENT_AWAKENING_TARGET_NAMES,
  isExtremeDragon,
} from "./knowledge.js";
import { analyzeDragonState } from "./stateAnalysis.js";

const LOW_DRAGON_NAMES = [
  "Solar Eclipse Dragon",
  "Lunar Eclipse Dragon",
  "Stelya, Dragon Tamer",
  "Armored Dragon",
  "Grey Dragon",
  "Luminescent Dragon",
  "Voltaic Dragon",
];

const AWAKENING_SEARCH_NAMES = new Set(CURRENT_AWAKENING_TARGET_NAMES);
const LUNAR_FORBIDDEN_SEARCH_NAMES = new Set(["Luminous Dragon"]);

function isDragonMonster(card) {
  return card?.cardKind === "monster" && card.type === "Dragon";
}

function hasName(cards = [], name) {
  return (cards || []).some((card) => card?.name === name);
}

function countName(cards = [], name) {
  return (cards || []).filter((card) => card?.name === name).length;
}

function zoneCards(player, zone) {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  return Array.isArray(player[zone]) ? player[zone].filter(Boolean) : [];
}

function getSourceName(context = {}) {
  return (
    context.source?.name ||
    context.ctx?.source?.name ||
    context.card?.name ||
    ""
  );
}

function getEffectId(action = {}, context = {}) {
  return (
    context.ctx?.effect?.id ||
    context.effect?.id ||
    action.effectId ||
    action.selectionId ||
    action.resultRef ||
    ""
  );
}

function getOpponent(context = {}, player = null) {
  if (context.opponent) return context.opponent;
  const game = context.game?._gameRef || context.game;
  if (!game || !player) return {};
  if (game.bot === player) return game.player || {};
  if (game.player === player) return game.bot || {};
  return game.player || game.bot || {};
}

function getDragonState(context = {}, player = {}, opponent = {}) {
  if (context.dragonState) return context.dragonState;
  if (!context.game && context.analysis?.dragonState) return context.analysis.dragonState;
  return analyzeDragonState({
    game: context.game?._gameRef || context.game || null,
    bot: player,
    opponent,
    isSimulatedState:
      context.isSimulatedState === true ||
      context.game?._isPerspectiveState === true,
  });
}

function cardStrategicValue(card, fallbackValue = null) {
  if (typeof fallbackValue === "function") {
    return Number(fallbackValue(card)) || 0;
  }
  const knowledge = CARD_KNOWLEDGE[card?.name] || {};
  return (
    (knowledge.value || knowledge.priority || 0) +
    (card?.level || 0) * 0.25 +
    Math.max(card?.atk || 0, card?.def || 0) / 1000 +
    (isExtremeDragon(card) ? 4 : 0) +
    (card?.monsterType === "fusion" || card?.monsterType === "ascension" ? 5 : 0)
  );
}

function classifySearch(action = {}, context = {}) {
  const sourceName = getSourceName(context);
  const effectId = getEffectId(action, context);
  const filters = action.filters || {};

  if (
    sourceName === "Armored Dragon" ||
    effectId === "armored_dragon_search_on_normal"
  ) {
    return "armored";
  }
  if (
    sourceName === "Lunar Eclipse Dragon" ||
    effectId === "lunar_eclipse_summon_search" ||
    action.resultRef === "lunar_eclipse_added_dragon"
  ) {
    return "lunar";
  }
  if (
    sourceName === "Stelya, Dragon Tamer" ||
    effectId === "stelya_discard_search_dragon"
  ) {
    return "stelya";
  }
  if (
    sourceName === "Extreme Dragon Awakening" ||
    effectId === "extreme_dragon_awakening_gy_search" ||
    filters.archetype === "Extreme Dragons"
  ) {
    return "awakening";
  }
  if (sourceName === "Black Bull Dragon" || effectId === "bbd_gy_banish_search") {
    return "blackBull";
  }
  if (
    sourceName === "Hellkite Roar" ||
    effectId === "hellkite_roar_gy_search_peak" ||
    filters.name === "Jagged Peak of the Dragons"
  ) {
    return "hellkiteRoar";
  }

  return "generic";
}

function makeContext(context = {}) {
  const player = context.player || context.bot || context.game?.bot || {};
  const opponent = getOpponent(context, player);
  const dragonState = getDragonState(context, player, opponent);
  const hand = zoneCards(player, "hand");
  const field = zoneCards(player, "field");
  const deck = zoneCards(player, "deck");
  const graveyard = zoneCards(player, "graveyard");
  const spellTrap = zoneCards(player, "spellTrap");
  const opponentField = zoneCards(opponent, "field");
  const opponentBackrow =
    zoneCards(opponent, "spellTrap").length +
    (opponent?.fieldSpell ? 1 : 0);
  const opponentEffectMonsters = opponentField.filter(
    (card) => (card?.effects || []).length > 0,
  ).length;
  const opponentStrongestAtk = opponentField.reduce(
    (max, card) => Math.max(max, card?.atk || 0),
    0,
  );
  const botLp = Number(player?.lp || 0);
  const opponentLp = Number(opponent?.lp || 0);

  return {
    ...context,
    player,
    opponent,
    dragonState,
    hand,
    field,
    deck,
    graveyard,
    spellTrap,
    opponentField,
    opponentBackrow,
    opponentEffectMonsters,
    opponentStrongestAtk,
    opponentGraveyardCount: zoneCards(opponent, "graveyard").length,
    fieldCapacity: Math.max(0, 5 - field.length),
    hasPolymerization: hasName(hand, "Polymerization"),
    hasHellkiteRoarAccess:
      hasName(hand, "Hellkite Roar") ||
      hasName(graveyard, "Hellkite Roar") ||
      hasName(spellTrap, "Hellkite Roar"),
    botLowLp: botLp > 0 && opponentLp > 0 && botLp < opponentLp * 0.7,
    opponentLowLp: opponentLp > 0 && opponentLp <= 2500,
    combatNeed:
      opponentField.length > 0 &&
      (opponentStrongestAtk >= 2200 || field.length === 0),
    bossRoute:
      dragonState.hasDragonFieldBodyForStelya ||
      dragonState.hasTwoDragonsForAwakening ||
      hasName(hand, "Extreme Dragon Awakening") ||
      hasName(spellTrap, "Extreme Dragon Awakening") ||
      player?.fieldSpell?.name === "Jagged Peak of the Dragons",
  };
}

function scoreGeneric(card, ctx) {
  return cardStrategicValue(card, ctx.fallbackValue);
}

function scoreArmored(card, ctx) {
  let score = scoreGeneric(card, ctx);
  const name = card?.name;
  const ds = ctx.dragonState;

  if (!LOW_DRAGON_NAMES.includes(name)) score -= 20;

  if (name === "Solar Eclipse Dragon") {
    score += 80;
    if (!ds.hasSolarInHand && !ds.hasSolarInGY) score += 70;
    if (ds.hasLunarInDeck || ds.hasLunarInHand) score += 25;
    if (ctx.fieldCapacity > 0) score += 10;
  } else if (name === "Lunar Eclipse Dragon") {
    score += 70;
    if ((ds.hasSolarInHand || ds.hasSolarInGY) && !ds.hasLunarInHand && !ds.hasLunarInGY) {
      score += 60;
    }
    if (!ds.hasLunarInHand && !ds.hasLunarInGY) score += 25;
    if (ds.hasUsefulLunarDiscard) score += 15;
  } else if (name === "Stelya, Dragon Tamer") {
    score += 55;
    if (ctx.bossRoute) score += 35;
    if (ds.hasDragonFieldBodyForStelya) score += 20;
    if ((ctx.hand || []).some((c) => isDragonMonster(c) && (c.level || 0) >= 5)) score += 15;
  } else if (name === "Voltaic Dragon") {
    score += 45;
    if (ctx.hasPolymerization || ds.fusionPieces?.techVoid?.hasMaterials) score += 35;
    if (ds.hasDragonFieldBodyForStelya) score += 10;
  } else if (name === "Luminescent Dragon") {
    score += 40;
    if ((ds.lowLevelDragonGYTargets || []).length > 0) score += 45;
    if (ds.hasSolarInGY || ds.hasLunarInGY || ds.hasStelyaInGY) score += 15;
  } else if (name === "Grey Dragon") {
    score += 35;
    if (ctx.combatNeed) score += 25;
    if ((ds.gyResources || []).length > 0) score += 10;
  } else if (name === "Armored Dragon") {
    score += 20;
    if (!hasName(ctx.hand, "Armored Dragon")) score += 10;
  }

  return score;
}

function scoreLunar(card, ctx) {
  let score = scoreGeneric(card, ctx);
  const name = card?.name;
  const ds = ctx.dragonState;

  if (LUNAR_FORBIDDEN_SEARCH_NAMES.has(name)) return -100000;
  if (!isDragonMonster(card) || (card.level || 0) > 4) score -= 5000;

  if (name === "Solar Eclipse Dragon") {
    score += 85;
    if (!ds.hasSolarInHand && !ds.hasSolarInGY) score += 80;
    if (ctx.fieldCapacity > 0) score += 30;
  } else if (name === "Stelya, Dragon Tamer") {
    score += 70;
    if (ctx.bossRoute) score += 45;
    if (ds.hasDragonFieldBodyForStelya) score += 20;
    if ((ctx.hand || []).some((c) => isDragonMonster(c) && (c.level || 0) >= 5)) score += 20;
  } else if (name === "Voltaic Dragon") {
    score += 55;
    if (ctx.hasPolymerization || ds.fusionPieces?.techVoid?.hasMaterials) score += 35;
    if (ctx.opponentLowLp) score += 20;
  } else if (name === "Luminescent Dragon") {
    score += 50;
    if ((ds.lowLevelDragonGYTargets || []).length > 0) score += 40;
  } else if (name === "Grey Dragon") {
    score += 42;
    if (ctx.combatNeed) score += 25;
  } else if (name === "Armored Dragon") {
    score += 38;
    if (!hasName(ctx.hand, "Armored Dragon")) score += 10;
  } else if (name === "Lunar Eclipse Dragon") {
    score += 35;
    if (ds.hasSolarInHand || ds.hasSolarInGY) score += 20;
    if (!ds.hasLunarInGY && countName(ctx.hand, "Lunar Eclipse Dragon") <= 1) score += 10;
  }

  return score;
}

function scoreStelya(card, ctx) {
  let score = scoreGeneric(card, ctx);
  const name = card?.name;
  const ds = ctx.dragonState;
  const noRoutePenalty = ctx.bossRoute ? 0 : 18;
  const effectPressure = ctx.opponentEffectMonsters * 12 + ctx.opponentBackrow * 8;
  const battlePressure =
    ctx.opponentField.length * 10 +
    (ctx.opponentStrongestAtk >= 2400 ? 20 : 0) +
    (ctx.botLowLp ? 12 : 0);

  if (!isDragonMonster(card) || (card.level || 0) < 5) score -= 5000;

  if (name === "Fire Extreme Dragon") {
    score += 90 + effectPressure + (ctx.opponentLowLp ? 15 : 0) - noRoutePenalty;
  } else if (name === "Volcanic Extreme Dragon") {
    score +=
      88 +
      battlePressure +
      Math.min(20, ctx.opponentGraveyardCount * 3) -
      noRoutePenalty;
  } else if (name === "Hellkite Dragon") {
    score += 72;
    if (ctx.hasHellkiteRoarAccess) score += 45;
    if ((ds.lowLevelDragonGYTargets || []).length > 0) score += 20;
    if (ds.hasLevel7PlusForRoar === false) score += 10;
  } else if (name === "Majestic Silver Dragon") {
    score += 68;
    if (ctx.combatNeed) score += 35;
    if (ctx.opponentField.some((card) => card?.position === "defense")) score += 10;
  } else if (name === "Purified Crystal Dragon") {
    score += 76;
    if (ds.hasThreeSafeGYDragonsForPurified) score += 45;
    if (ctx.botLowLp) score += 20;
    if (ds.fusionPieces?.radiant?.hasMaterials || ds.hasLuminousForRadiant) score += 10;
  } else if (name === "Black Bull Dragon") {
    score += 70;
    if ((ds.usefulDiscardCandidates || []).length >= 2) score += 35;
    if (ctx.opponentField.length >= 2) score += 25;
  } else if (name === "Luminous Dragon") {
    score += 58;
    if (ctx.hasPolymerization || ds.fusionPieces?.radiant?.hasMaterials) score += 35;
    if (ds.hasLuminousForRadiant) score += 15;
  }

  return score;
}

function scoreAwakening(card, ctx) {
  if (!AWAKENING_SEARCH_NAMES.has(card?.name)) {
    return -100000 + scoreGeneric(card, ctx);
  }

  let score = 100 + scoreGeneric(card, ctx);
  const name = card?.name;
  const ds = ctx.dragonState;
  const effectPressure = ctx.opponentEffectMonsters * 14 + ctx.opponentBackrow * 9;
  const battlePressure =
    ctx.opponentField.length * 12 +
    (ctx.opponentStrongestAtk >= 2400 ? 25 : 0) +
    (ctx.botLowLp ? 10 : 0);

  if (name === "Fire Extreme Dragon") {
    score += effectPressure + (ctx.opponentLowLp ? 20 : 0);
  } else if (name === "Volcanic Extreme Dragon") {
    score += battlePressure + Math.min(25, ctx.opponentGraveyardCount * 4);
  } else if (name === "Purified Crystal Dragon") {
    score +=
      (ds.hasThreeSafeGYDragonsForPurified ? 45 : 0) +
      (ctx.botLowLp ? 20 : 0) +
      (ds.hasLuminousForRadiant ? 10 : 0);
  } else if (name === "Black Bull Dragon") {
    score +=
      ((ds.usefulDiscardCandidates || []).length >= 2 ? 35 : 0) +
      (ctx.opponentField.length >= 2 ? 25 : 0);
  }

  return score;
}

function scoreBlackBull(card, ctx) {
  let score = scoreGeneric(card, ctx);
  const name = card?.name;
  const ds = ctx.dragonState;

  if (name === "Purified Crystal Dragon") {
    score += 90;
    if (ds.hasThreeSafeGYDragonsForPurified) score += 45;
    if (ctx.botLowLp) score += 20;
    if (ds.hasLuminousForRadiant) score += 10;
  } else if (name === "Hellkite Dragon") {
    score += 80;
    if (ctx.hasHellkiteRoarAccess) score += 45;
    if ((ds.lowLevelDragonGYTargets || []).length > 0) score += 20;
  } else if (name === "Majestic Silver Dragon") {
    score += 72;
    if (ctx.combatNeed) score += 35;
  } else if (name === "Black Bull Dragon") {
    score += 25;
    if (ctx.opponentField.length >= 2) score += 15;
  }

  return score;
}

function scoreHellkiteRoar(card, ctx) {
  if (card?.name !== "Jagged Peak of the Dragons") return scoreGeneric(card, ctx) - 1000;
  return ctx.player?.fieldSpell?.name === "Jagged Peak of the Dragons" ? 10 : 1000;
}

function scoreCandidate(card, searchKind, ctx) {
  switch (searchKind) {
    case "armored":
      return scoreArmored(card, ctx);
    case "lunar":
      return scoreLunar(card, ctx);
    case "stelya":
      return scoreStelya(card, ctx);
    case "awakening":
      return scoreAwakening(card, ctx);
    case "blackBull":
      return scoreBlackBull(card, ctx);
    case "hellkiteRoar":
      return scoreHellkiteRoar(card, ctx);
    default:
      return scoreGeneric(card, ctx);
  }
}

export function rankDragonSearchCandidates(candidates = [], action = {}, context = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const searchKind = classifySearch(action, context);
  const ctx = makeContext(context);
  return candidates
    .map((card, index) => ({
      card,
      index,
      score: scoreCandidate(card, searchKind, ctx),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        scoreGeneric(b.card, ctx) - scoreGeneric(a.card, ctx) ||
        a.index - b.index,
    )
    .map((entry) => entry.card);
}

export function getDragonSearchKind(action = {}, context = {}) {
  return classifySearch(action, context);
}
