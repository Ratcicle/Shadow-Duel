import { CARD_KNOWLEDGE, isExtremeDragon } from "./knowledge.js";
import { analyzeDragonState } from "./stateAnalysis.js";

export const DRAGON_GOOD_DISCARD_NAMES = [
  "Solar Eclipse Dragon",
  "Voltaic Dragon",
  "Stelya, Dragon Tamer",
  "Grey Dragon",
  "Lunar Eclipse Dragon",
  "Black Bull Dragon",
];

export const DRAGON_MEDIUM_DISCARD_NAMES = [
  "Luminous Dragon",
  "Hellkite Dragon",
  "Purified Crystal Dragon",
];

export const DRAGON_CORE_PAYOFF_NAMES = [
  "Fire Extreme Dragon",
  "Volcanic Extreme Dragon",
  "Luminous Dragon",
  "Black Bull Dragon",
  "Purified Crystal Dragon",
  "Hellkite Dragon",
  "Majestic Silver Dragon",
  "Polymerization",
  "Extreme Dragon Awakening",
  "Jagged Peak of the Dragons",
  "Dragon Spirit Sanctuary",
  "Call of the Haunted",
];

const DRAGON_OFFENSIVE_PAYOFF_NAMES = [
  "Fire Extreme Dragon",
  "Volcanic Extreme Dragon",
  "Black Bull Dragon",
  "Purified Crystal Dragon",
  "Hellkite Dragon",
  "Majestic Silver Dragon",
  "Radiant Cosmic Dragon",
  "Rainbow Cosmic Dragon",
  "Tech-Void Dragon",
];

const HAND_COST_TARGET_IDS = [
  "lunar_eclipse_discard_cost",
  "stelya_discard_other_card",
  "grey_dragon_discard_cost",
  "bbd_cost",
  "darkness_dragon_discard_cost",
];

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function zoneCards(player, zone) {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  return Array.isArray(player[zone]) ? player[zone].filter(Boolean) : [];
}

function isDragonMonster(card) {
  return card?.cardKind === "monster" && card.type === "Dragon";
}

function hasName(cards = [], name) {
  return (cards || []).some((card) => card?.name === name);
}

function countName(cards = [], name) {
  return (cards || []).filter((card) => card?.name === name).length;
}

function instanceId(card) {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uuid ??
    card?.simInstanceId ??
    null
  );
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

function getOpponent(context = {}, player = null) {
  if (context.opponent) return context.opponent;
  const game = context.game?._gameRef || context.game;
  if (!game || !player) return {};
  if (game.bot === player) return game.player || {};
  if (game.player === player) return game.bot || {};
  return game.player || game.bot || {};
}

function getSourceName(context = {}) {
  return context.source?.name || context.sourceCard?.name || "";
}

function getEffectId(context = {}) {
  return context.effect?.id || context.ctx?.effect?.id || "";
}

function getDragonState(context = {}, player = {}, opponent = {}) {
  if (context.dragonState) return context.dragonState;
  if (!context.game && context.analysis?.dragonState) {
    return context.analysis.dragonState;
  }
  return analyzeDragonState({
    game: context.game?._gameRef || context.game || null,
    bot: player,
    opponent,
    isSimulatedState:
      context.isSimulatedState === true ||
      context.game?._isPerspectiveState === true,
  });
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
  const extraDeck = zoneCards(player, "extraDeck");
  const opponentField = zoneCards(opponent, "field");
  const opponentBackrow =
    zoneCards(opponent, "spellTrap").length +
    (opponent?.fieldSpell ? 1 : 0);
  const accessibleFusionCards = [...hand, ...field];
  const accessibleDragons = accessibleFusionCards.filter(isDragonMonster);
  const hasPolymerization = hasName(hand, "Polymerization");
  const hasAwakeningAccess =
    hasName(hand, "Extreme Dragon Awakening") ||
    hasName(spellTrap, "Extreme Dragon Awakening");
  const hasCallAccess =
    hasName(hand, "Call of the Haunted") ||
    hasName(spellTrap, "Call of the Haunted");
  const hasJaggedPeakAccess =
    player?.fieldSpell?.name === "Jagged Peak of the Dragons" ||
    hasName(hand, "Jagged Peak of the Dragons");
  const hasVoltaicAccessible =
    hasName(accessibleFusionCards, "Voltaic Dragon") ||
    hasName(graveyard, "Voltaic Dragon");
  const hasLuminousAccessible =
    hasName(accessibleFusionCards, "Luminous Dragon") ||
    hasName(graveyard, "Luminous Dragon");
  const hasRadiantLight =
    accessibleDragons.some(
      (card) => String(card.attribute || "").toLowerCase() === "light",
    ) || hasLuminousAccessible;
  const techVoidClose =
    hasPolymerization &&
    hasVoltaicAccessible &&
    accessibleDragons.some(
      (card) => card.name !== "Voltaic Dragon" && (card.level || 0) >= 5,
    );
  const radiantClose =
    hasPolymerization &&
    hasRadiantLight &&
    accessibleDragons.length >= 2;
  const awakeningLive =
    hasAwakeningAccess &&
    (dragonState.hasTwoDragonsForAwakening ||
      zoneCards(player, "field").filter((card) => isDragonMonster(card) && !card.isFacedown).length >= 2);
  const defensiveNeed =
    opponentField.some((card) => (card?.effects || []).length > 0) ||
    opponentBackrow > 0 ||
    field.some(
      (card) =>
        isDragonMonster(card) &&
        ((card.level || 0) >= 7 ||
          isExtremeDragon(card) ||
          card.monsterType === "fusion" ||
          card.monsterType === "ascension"),
    );

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
    extraDeck,
    opponentField,
    opponentBackrow,
    sourceName: getSourceName(context),
    effectId: getEffectId(context),
    hasPolymerization,
    hasAwakeningAccess,
    hasCallAccess,
    hasJaggedPeakAccess,
    techVoidClose,
    radiantClose,
    awakeningLive,
    defensiveNeed,
    voltaicTotal: countName([...hand, ...field, ...graveyard, ...deck], "Voltaic Dragon"),
    luminousTotal: countName([...hand, ...field, ...graveyard, ...deck], "Luminous Dragon"),
  };
}

function hasLevel7Or8SearchTarget(ctx) {
  return ctx.deck.some(
    (card) =>
      isDragonMonster(card) &&
      (card.level || 0) >= 7 &&
      (card.level || 0) <= 8,
  );
}

function hasLiveReviveAccess(ctx) {
  return ctx.hasCallAccess || ctx.hasJaggedPeakAccess || ctx.dragonState.hasSolarInGY;
}

export function scoreDragonDiscardCandidate(card, context = {}) {
  if (!card) return 9999;
  const ctx = context.dragonState ? context : makeContext(context);
  const name = card.name;
  let score = 55 + cardStrategicValue(card, ctx.fallbackValue);

  if (name === "Solar Eclipse Dragon") {
    score -= 48;
    if (ctx.dragonState.opt?.solarGy?.canUse !== false) score -= 12;
    if ((ctx.dragonState.solarReviveTargets || []).length > 0) score -= 8;
  } else if (name === "Voltaic Dragon") {
    score -= 52;
    if (ctx.techVoidClose && ctx.voltaicTotal <= 1) score += 80;
  } else if (name === "Stelya, Dragon Tamer") {
    score -= 42;
    if (ctx.dragonState.hasDragonFieldBodyForStelya) score -= 10;
  } else if (name === "Grey Dragon") {
    score -= 36;
  } else if (name === "Lunar Eclipse Dragon") {
    score -= 34;
    if (ctx.dragonState.hasLunarInDeck || ctx.dragonState.opt?.lunarGy?.canUse) {
      score -= 8;
    }
  } else if (name === "Black Bull Dragon") {
    score -= hasLevel7Or8SearchTarget(ctx) ? 30 : 16;
  } else if (name === "Luminous Dragon") {
    score += ctx.radiantClose && ctx.luminousTotal <= 1 ? 78 : 10;
  } else if (name === "Hellkite Dragon") {
    score += ctx.dragonState.hasLevel7PlusForRoar || ctx.hasCallAccess ? 34 : 12;
  } else if (name === "Purified Crystal Dragon") {
    score += ctx.dragonState.hasThreeSafeGYDragonsForPurified ? 52 : 18;
  }

  if (name === "Polymerization") {
    score += ctx.techVoidClose || ctx.radiantClose ? 95 : 25;
  }
  if (name === "Extreme Dragon Awakening") {
    score += ctx.awakeningLive ? 95 : 30;
  }
  if (name === "Dragon Spirit Sanctuary") {
    score += ctx.defensiveNeed ? 78 : 28;
  }
  if (name === "Jagged Peak of the Dragons") {
    score += ctx.player?.fieldSpell?.name === "Jagged Peak of the Dragons" ? 12 : 82;
  }
  if (name === "Fire Extreme Dragon" || name === "Volcanic Extreme Dragon") {
    score += hasLiveReviveAccess(ctx) ? 45 : 85;
    if (ctx.awakeningLive) score += 35;
  }
  if (isExtremeDragon(card) && name !== "Fire Extreme Dragon" && name !== "Volcanic Extreme Dragon") {
    score += 70;
  }
  if (card.monsterType === "fusion" || card.monsterType === "ascension") {
    score += 100;
  }

  if (ctx.sourceName === "Lunar Eclipse Dragon" || ctx.effectId === "lunar_eclipse_summon_search") {
    if (["Voltaic Dragon", "Solar Eclipse Dragon", "Stelya, Dragon Tamer"].includes(name)) {
      score -= 16;
    }
  }
  if (ctx.sourceName === "Stelya, Dragon Tamer" || ctx.effectId === "stelya_discard_search_dragon") {
    if (["Solar Eclipse Dragon", "Lunar Eclipse Dragon", "Voltaic Dragon", "Grey Dragon"].includes(name)) {
      score -= 12;
    }
    if ((card.level || 0) >= 7 || ["Polymerization", "Extreme Dragon Awakening"].includes(name)) {
      score += 18;
    }
  }
  if (ctx.sourceName === "Grey Dragon" || ctx.effectId === "grey_dragon_gy_return") {
    if (["Voltaic Dragon", "Solar Eclipse Dragon", "Lunar Eclipse Dragon", "Stelya, Dragon Tamer"].includes(name)) {
      score -= 12;
    }
  }
  if (ctx.sourceName === "Black Bull Dragon" || ctx.effectId === "bbd_special_summon_from_hand") {
    if (["Voltaic Dragon", "Solar Eclipse Dragon", "Grey Dragon", "Lunar Eclipse Dragon", "Stelya, Dragon Tamer"].includes(name)) {
      score -= 18;
    }
    if (["Polymerization", "Extreme Dragon Awakening", "Dragon Spirit Sanctuary"].includes(name)) {
      score += 25;
    }
  }

  return score;
}

export function rankDragonDiscardCandidates(candidates = [], context = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const ctx = makeContext(context);
  return candidates
    .map((card, index) => ({
      card,
      index,
      score: scoreDragonDiscardCandidate(card, ctx),
    }))
    .sort(
      (a, b) =>
        a.score - b.score ||
        cardStrategicValue(a.card, ctx.fallbackValue) -
          cardStrategicValue(b.card, ctx.fallbackValue) ||
        a.index - b.index,
    )
    .map((entry) => entry.card);
}

function protectedDiscardNames(ctx, candidates = []) {
  const names = new Set();
  if (ctx.techVoidClose && ctx.voltaicTotal <= 1) names.add("Voltaic Dragon");
  if (ctx.radiantClose && ctx.luminousTotal <= 1) names.add("Luminous Dragon");
  if (ctx.techVoidClose || ctx.radiantClose) names.add("Polymerization");
  if (ctx.awakeningLive) names.add("Extreme Dragon Awakening");
  if (ctx.defensiveNeed) names.add("Dragon Spirit Sanctuary");
  if (!ctx.player?.fieldSpell || ctx.player.fieldSpell.name !== "Jagged Peak of the Dragons") {
    names.add("Jagged Peak of the Dragons");
  }
  if (ctx.awakeningLive || !hasLiveReviveAccess(ctx)) {
    names.add("Fire Extreme Dragon");
    names.add("Volcanic Extreme Dragon");
  }
  if (ctx.dragonState.hasThreeSafeGYDragonsForPurified) {
    names.add("Purified Crystal Dragon");
  }
  if (ctx.dragonState.hasLevel7PlusForRoar || ctx.hasCallAccess) {
    names.add("Hellkite Dragon");
  }
  if (ctx.hasCallAccess && ctx.graveyard.some((card) => (card?.level || 0) >= 7)) {
    names.add("Call of the Haunted");
  }

  for (const card of candidates || []) {
    const score = scoreDragonDiscardCandidate(card, ctx);
    if (score >= 115 && card?.name) names.add(card.name);
  }

  return [...names];
}

function candidateIds(cards = []) {
  return cards.map(instanceId).filter((id) => id !== null);
}

function buildTargetPreferenceForCandidates(candidates = [], context = {}, limit = 4) {
  const ctx = makeContext(context);
  const ranked = rankDragonDiscardCandidates(candidates, ctx);
  const scored = ranked.map((card) => ({
    card,
    score: scoreDragonDiscardCandidate(card, ctx),
  }));
  const preferred = scored
    .filter((entry) => entry.score < 80)
    .slice(0, limit)
    .map((entry) => entry.card);
  const protectedCards = scored
    .filter((entry) => entry.score >= 115)
    .map((entry) => entry.card);

  return {
    role: "cost",
    preferNames: unique([
      ...preferred.map((card) => card.name),
      ...DRAGON_GOOD_DISCARD_NAMES,
    ]),
    preserveNames: unique([
      ...protectedDiscardNames(ctx, candidates),
      ...protectedCards.map((card) => card.name),
    ]),
    avoidNames: unique(protectedCards.map((card) => card.name)),
    preferredInstanceIds: candidateIds(preferred),
    avoidInstanceIds: candidateIds(protectedCards),
  };
}

export function buildDragonCostPreferences(context = {}) {
  const ctx = makeContext(context);
  const handCandidates = context.candidates || ctx.hand;
  const rankedHand = rankDragonDiscardCandidates(handCandidates, ctx);
  const preferred = rankedHand
    .filter((card) => scoreDragonDiscardCandidate(card, ctx) < 80)
    .slice(0, 5);
  const protectedCards = rankedHand.filter(
    (card) => scoreDragonDiscardCandidate(card, ctx) >= 115,
  );
  const availableOffensivePayoffs = [...ctx.hand, ...ctx.field].filter((card) =>
    DRAGON_OFFENSIVE_PAYOFF_NAMES.includes(card?.name),
  ).length;

  return {
    preferNames: unique([
      ...preferred.map((card) => card.name),
      ...DRAGON_GOOD_DISCARD_NAMES,
    ]),
    preserveNames: unique([
      ...protectedDiscardNames(ctx, handCandidates),
      ...protectedCards.map((card) => card.name),
    ]),
    avoidNames: unique(protectedCards.map((card) => card.name)),
    preferredInstanceIds: candidateIds(preferred),
    avoidInstanceIds: candidateIds(protectedCards),
    offensivePayoffNames: DRAGON_OFFENSIVE_PAYOFF_NAMES,
    preserveLastOffensivePayoff: true,
    availableOffensivePayoffs,
  };
}

export function buildDragonTargetCostPreferences(context = {}) {
  const ctx = makeContext(context);
  const byId = {};
  const hand = ctx.hand;
  const handDragons = hand.filter(isDragonMonster);
  const nonSourceHand = hand.filter((card) => card !== context.source && card !== context.sourceCard);
  const nonSourceDragons = handDragons.filter(
    (card) => card !== context.source && card !== context.sourceCard,
  );

  byId.lunar_eclipse_discard_cost = buildTargetPreferenceForCandidates(hand, {
    ...ctx,
    sourceName: "Lunar Eclipse Dragon",
    effectId: "lunar_eclipse_summon_search",
  });
  byId.stelya_discard_other_card = buildTargetPreferenceForCandidates(nonSourceHand, {
    ...ctx,
    sourceName: "Stelya, Dragon Tamer",
    effectId: "stelya_discard_search_dragon",
  });
  byId.grey_dragon_discard_cost = buildTargetPreferenceForCandidates(handDragons, {
    ...ctx,
    sourceName: "Grey Dragon",
    effectId: "grey_dragon_gy_return",
  });
  byId.bbd_cost = buildTargetPreferenceForCandidates(nonSourceDragons, {
    ...ctx,
    sourceName: "Black Bull Dragon",
    effectId: "bbd_special_summon_from_hand",
  }, 6);
  byId.darkness_dragon_discard_cost = buildTargetPreferenceForCandidates(hand, ctx);

  for (const id of HAND_COST_TARGET_IDS) {
    if (!byId[id]) {
      byId[id] = buildTargetPreferenceForCandidates(hand, ctx);
    }
  }

  return byId;
}
