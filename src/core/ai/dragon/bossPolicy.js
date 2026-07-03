import {
  CARD_KNOWLEDGE,
  isExtremeDragon,
} from "./knowledge.js";
import { analyzeDragonState } from "./stateAnalysis.js";

export const DRAGON_BOSS_POLICY_NAMES = [
  "Fire Extreme Dragon",
  "Volcanic Extreme Dragon",
  "Purified Crystal Dragon",
  "Black Bull Dragon",
  "Hellkite Dragon",
  "Majestic Silver Dragon",
];

const DRAGON_BOSS_NAME_SET = new Set(DRAGON_BOSS_POLICY_NAMES);
const EXTREME_BOSS_NAMES = new Set(["Fire Extreme Dragon", "Volcanic Extreme Dragon"]);

function zoneCards(player, zone) {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  return Array.isArray(player[zone]) ? player[zone].filter(Boolean) : [];
}

function isDragonMonster(card) {
  return card?.cardKind === "monster" && card.type === "Dragon";
}

function isFaceupDragon(card) {
  return isDragonMonster(card) && !card.isFacedown;
}

function hasName(cards = [], name) {
  return (cards || []).some((card) => card?.name === name);
}

function countName(cards = [], name) {
  return (cards || []).filter((card) => card?.name === name).length;
}

function getCardInstanceId(card) {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uuid ??
    card?.simInstanceId ??
    null
  );
}

function cardStrategicValue(card) {
  const knowledge = CARD_KNOWLEDGE[card?.name] || {};
  return (
    (knowledge.value || knowledge.priority || 0) +
    (card?.level || 0) * 0.25 +
    Math.max(card?.atk || 0, card?.def || 0) / 1000 +
    (isExtremeDragon(card) ? 4 : 0)
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
  if (context.analysis?.dragonState) return context.analysis.dragonState;
  return analyzeDragonState({
    game: context.game?._gameRef || context.game || null,
    bot: player,
    opponent,
    isSimulatedState:
      context.isSimulatedState === true ||
      context.game?._isPerspectiveState === true ||
      !context.game,
  });
}

function hasUsefulHellkiteReviveTarget(ctx) {
  return ctx.graveyard.some(
    (card) =>
      isDragonMonster(card) &&
      (card.level || 0) <= 7 &&
      card.name !== "Hellkite Dragon" &&
      (
        DRAGON_BOSS_NAME_SET.has(card.name) ||
        ["Solar Eclipse Dragon", "Lunar Eclipse Dragon", "Stelya, Dragon Tamer", "Luminous Dragon"].includes(card.name) ||
        (card.atk || 0) >= 1700
      ),
  );
}

function hasMajesticPositionSwing(ctx) {
  return ctx.opponentField.some((card) => {
    if (!card || card.cardKind !== "monster" || card.isFacedown) return false;
    if (card.position === "attack" && (card.atk || 0) >= 2200) return true;
    if (card.position === "defense" && (card.def || 0) < 2500) return true;
    return card.monsterType === "fusion" || card.monsterType === "ascension";
  });
}

function canKeepExtremeSolo(ctx) {
  const monsterCount = ctx.field.filter((card) => card?.cardKind === "monster").length;
  const route = ctx.routeKind || "";
  if (route === "awakening") {
    return monsterCount - Math.max(0, Number(ctx.fieldCostCount ?? 2)) <= 0;
  }
  if (route === "tribute") {
    return monsterCount - Math.max(0, Number(ctx.tributeCount ?? 2)) <= 0;
  }
  if (route === "call" || route === "jaggedPeak") {
    return monsterCount === 0;
  }
  if (route === "stelyaSearch") {
    return (
      ctx.canNormalSummon &&
      ctx.faceupDragons.length <= 1 &&
      ctx.faceupDragons.length > 0
    );
  }
  return monsterCount <= 1;
}

function isDecisiveExtremeReplacement(card, ctx) {
  if (!ctx.allowExtremeReplacement || !EXTREME_BOSS_NAMES.has(card?.name)) {
    return false;
  }
  const lethalAttack = (card.atk || 0) >= (ctx.opponent?.lp || 8000);
  const survivalSwing = card.name === "Volcanic Extreme Dragon" && ctx.battlePressure >= 52;
  const effectRace = card.name === "Fire Extreme Dragon" && ctx.effectPressure >= 32 && ctx.opponentLowLp;
  return lethalAttack || survivalSwing || effectRace;
}

export function buildDragonBossContext(context = {}) {
  const player = context.player || context.bot || context.owner || context.game?.bot || {};
  const opponent = getOpponent(context, player);
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
  const opponentEffectMonsters = opponentField.filter(
    (card) => (card?.effects || []).length > 0,
  ).length;
  const opponentStrongestAtk = opponentField.reduce(
    (max, card) => Math.max(max, card?.atk || 0),
    0,
  );
  const attackThreats = opponentField.filter(
    (card) => !card.isFacedown && card.position !== "defense" && (card.atk || 0) >= 1800,
  );
  const faceupDragons = field.filter(isFaceupDragon);
  const dragonState = getDragonState(context, player, opponent);
  const botLp = Number(player?.lp || 0);
  const opponentLp = Number(opponent?.lp || 0);
  const hasHellkiteRoarAccess =
    hasName(hand, "Hellkite Roar") ||
    hasName(spellTrap, "Hellkite Roar") ||
    hasName(graveyard, "Hellkite Roar");
  const hasCallAccess =
    hasName(hand, "Call of the Haunted") ||
    hasName(spellTrap, "Call of the Haunted");
  const hasJaggedCashout =
    player?.fieldSpell?.name === "Jagged Peak of the Dragons" &&
    Number(player.fieldSpell?.counters?.dragon_peak || 0) >= 5;

  const ctx = {
    ...context,
    player,
    bot: player,
    opponent,
    hand,
    field,
    deck,
    graveyard,
    spellTrap,
    extraDeck,
    opponentField,
    opponentBackrow,
    opponentEffectMonsters,
    opponentStrongestAtk,
    attackThreats,
    faceupDragons,
    dragonState,
    hasHellkiteRoarAccess,
    hasCallAccess,
    hasJaggedCashout,
    hasUsefulHellkiteReviveTarget: false,
    hasMajesticPositionSwing: false,
    botLowLp:
      botLp > 0 &&
      (
        botLp <= 2500 ||
        (opponentLp > 0 && botLp < opponentLp * 0.7)
      ),
    opponentLowLp: opponentLp > 0 && opponentLp <= 2500,
    effectPressure: opponentEffectMonsters * 12 + opponentBackrow * 8,
    battlePressure:
      opponentField.length * 10 +
      attackThreats.length * 8 +
      (opponentStrongestAtk >= 2400 ? 20 : 0) +
      (botLp > 0 && botLp <= 2500 ? 12 : 0),
    wideOpponentField: opponentField.length >= 2,
    activeExtreme: faceupDragons.find(isExtremeDragon) || null,
    canNormalSummon:
      context.analysis?.canNormalSummon ??
      !(player?.normalSummonUsed || Number(player?.summonCount || 0) > 0),
  };

  ctx.hasUsefulHellkiteReviveTarget = hasUsefulHellkiteReviveTarget(ctx);
  ctx.hasMajesticPositionSwing = hasMajesticPositionSwing(ctx);
  ctx.canKeepExtremeSolo = canKeepExtremeSolo(ctx);
  return ctx;
}

export function isDragonBossCandidate(card) {
  return DRAGON_BOSS_NAME_SET.has(card?.name);
}

export function hasActiveExtremeDragonConflict(card, context = {}) {
  const ctx = buildDragonBossContext(context);
  if (!EXTREME_BOSS_NAMES.has(card?.name)) return false;
  if (!ctx.activeExtreme) return false;
  return !isDecisiveExtremeReplacement(card, ctx);
}

export function hasDragonBossRoute(card, context = {}) {
  if (!isDragonBossCandidate(card)) return false;
  const ctx = buildDragonBossContext(context);
  const route = ctx.routeKind || "";
  const faceupDragonCount = ctx.faceupDragons.length;

  if (hasActiveExtremeDragonConflict(card, ctx)) return false;

  if (route === "awakening") {
    return (
      (card.level || 0) >= 8 &&
      ctx.hand.includes(card) &&
      faceupDragonCount >= 2
    );
  }

  if (route === "tribute") {
    return ctx.canNormalSummon && faceupDragonCount >= Number(ctx.tributeCount ?? 1);
  }

  if (route === "call") {
    return ctx.graveyard.includes(card) && ctx.hasCallAccess;
  }

  if (route === "jaggedPeak") {
    return ctx.hasJaggedCashout;
  }

  if (route === "stelyaSearch") {
    if (card.name === "Black Bull Dragon") {
      return (ctx.dragonState?.usefulDiscardCandidates || []).length >= 2;
    }
    if (card.name === "Purified Crystal Dragon") {
      return ctx.dragonState?.hasThreeSafeGYDragonsForPurified === true;
    }
    if (card.name === "Hellkite Dragon") {
      return ctx.hasHellkiteRoarAccess || faceupDragonCount > 0 || ctx.hasUsefulHellkiteReviveTarget;
    }
    if ((card.level || 0) >= 7 && ctx.canNormalSummon && faceupDragonCount > 0) {
      return true;
    }
    return (
      ctx.hasCallAccess ||
      ctx.hasJaggedCashout ||
      ctx.opponentField.length <= ctx.field.length + 1
    );
  }

  if (card.name === "Black Bull Dragon") {
    return (ctx.dragonState?.usefulDiscardCandidates || []).length >= 2 || ctx.wideOpponentField;
  }
  if (card.name === "Purified Crystal Dragon") {
    return ctx.dragonState?.hasThreeSafeGYDragonsForPurified || ctx.hasCallAccess;
  }
  if (card.name === "Hellkite Dragon") {
    return faceupDragonCount > 0 || ctx.hasHellkiteRoarAccess || ctx.hasUsefulHellkiteReviveTarget;
  }
  if (card.name === "Majestic Silver Dragon") {
    return ctx.hasMajesticPositionSwing || ctx.canNormalSummon;
  }
  return true;
}

export function scoreDragonBossCandidate(card, context = {}) {
  if (!isDragonBossCandidate(card)) {
    return -100000 + cardStrategicValue(card);
  }

  const ctx = buildDragonBossContext(context);
  if (hasActiveExtremeDragonConflict(card, ctx)) {
    return -50000 + cardStrategicValue(card);
  }

  let score = cardStrategicValue(card);
  const routeLive = hasDragonBossRoute(card, ctx);
  if (!routeLive) score -= 28;
  if (ctx.canKeepExtremeSolo && EXTREME_BOSS_NAMES.has(card.name)) score += 24;

  if (card.name === "Fire Extreme Dragon") {
    score += 86 + ctx.effectPressure;
    if (ctx.opponentLowLp) score += 18;
    if (ctx.opponentBackrow > 0) score += 8;
    if (ctx.battlePressure >= 45 && !ctx.canKeepExtremeSolo) score -= 8;
  } else if (card.name === "Volcanic Extreme Dragon") {
    score += 84 + ctx.battlePressure + (ctx.wideOpponentField ? 14 : 0);
    score += Math.min(24, zoneCards(ctx.opponent, "graveyard").length * 3);
    if (ctx.botLowLp) score += 12;
  } else if (card.name === "Purified Crystal Dragon") {
    score += 76;
    if (ctx.dragonState?.hasThreeSafeGYDragonsForPurified) score += 40;
    if (ctx.botLowLp) score += 18;
    if (hasName(ctx.extraDeck, "Rainbow Cosmic Dragon")) score += 14;
    if (ctx.hasCallAccess) score += 8;
  } else if (card.name === "Black Bull Dragon") {
    score += 70;
    if ((ctx.dragonState?.usefulDiscardCandidates || []).length >= 2) score += 34;
    if (ctx.wideOpponentField) score += 24;
    if (ctx.opponentField.length >= 3) score += 10;
  } else if (card.name === "Hellkite Dragon") {
    score += 66;
    if (ctx.hasHellkiteRoarAccess) score += 34;
    if (ctx.hasUsefulHellkiteReviveTarget) score += 24;
    if (ctx.dragonState?.hasLevel7PlusForRoar === false) score += 12;
    if (ctx.hasCallAccess) score += 8;
  } else if (card.name === "Majestic Silver Dragon") {
    score += 62;
    if (ctx.hasMajesticPositionSwing) score += 38;
    if (ctx.opponentField.some((target) => target?.position === "defense")) score += 10;
    if (ctx.battlePressure >= 35) score += 8;
  }

  return score;
}

export function rankDragonBossCandidates(candidates = [], context = {}) {
  return (candidates || [])
    .filter(Boolean)
    .map((card, index) => ({
      card,
      index,
      score: scoreDragonBossCandidate(card, context),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        cardStrategicValue(b.card) - cardStrategicValue(a.card) ||
        a.index - b.index,
    );
}

export function selectBestDragonBoss(candidates = [], context = {}) {
  const ranked = rankDragonBossCandidates(candidates, context);
  return ranked.find((entry) => entry.score > -1000)?.card || null;
}

export function buildDragonBossTargetPreference(
  candidates = [],
  context = {},
  role = "named_preference",
) {
  const ranked = rankDragonBossCandidates(candidates, context)
    .filter((entry) => entry.score > -1000)
    .map((entry) => entry.card);
  const preferredNames = [...new Set(ranked.map((card) => card.name).filter(Boolean))];
  const preferredInstanceIds = ranked
    .map(getCardInstanceId)
    .filter((id) => id !== null && id !== undefined);

  return {
    role,
    purpose:
      role === "recursion" || role === "summon"
        ? (buildDragonBossContext(context).botLowLp ? "stabilize" : "pressure")
        : undefined,
    preferredNames,
    preferNames: preferredNames,
    offensiveNames: preferredNames,
    defensiveNames: preferredNames,
    preferredInstanceIds,
  };
}

export function buildDragonBossPreferenceMap(context = {}) {
  const ctx = buildDragonBossContext(context);
  const sourceName =
    context.source?.name ||
    context.sourceCard?.name ||
    context.card?.name ||
    "";
  const effectId =
    context.effect?.id ||
    context.effectId ||
    context.action?.effectId ||
    "";
  const map = {};

  if (sourceName === "Call of the Haunted" || effectId === "call_of_the_haunted_activate") {
    map.haunted_target = buildDragonBossTargetPreference(
      ctx.graveyard.filter((card) => card?.cardKind === "monster"),
      { ...ctx, routeKind: "call" },
      "recursion",
    );
  }

  if (sourceName === "Jagged Peak of the Dragons" || effectId === "dragon_peak_ignite_summon") {
    const candidates = [...ctx.hand, ...ctx.deck, ...ctx.graveyard].filter(isDragonMonster);
    map.dragon_peak_ignite_summon = buildDragonBossTargetPreference(
      candidates,
      { ...ctx, routeKind: "jaggedPeak" },
      "recursion",
    );
  }

  if (sourceName === "Stelya, Dragon Tamer" || effectId === "stelya_discard_search_dragon") {
    const candidates = ctx.deck.filter(
      (card) => isDragonMonster(card) && (card.level || 0) >= 5,
    );
    map.stelya_discard_search_dragon_selection = buildDragonBossTargetPreference(
      candidates,
      { ...ctx, routeKind: "stelyaSearch" },
      "named_preference",
    );
  }

  if (sourceName === "Extreme Dragon Awakening" || effectId === "extreme_dragon_awakening_summon") {
    const candidates = ctx.hand.filter(
      (card) => isDragonMonster(card) && (card.level || 0) >= 8,
    );
    map.awakening_summon_dragon = buildDragonBossTargetPreference(
      candidates,
      { ...ctx, routeKind: "awakening", fieldCostCount: 2 },
      "summon",
    );
  }

  return map;
}

export function actionBreaksSoloExtremeProtection(action = {}, context = {}) {
  const ctx = buildDragonBossContext(context);
  const soloExtreme = ctx.field.find(
    (card) =>
      EXTREME_BOSS_NAMES.has(card?.name) &&
      !card.isFacedown &&
      ctx.field.filter((fieldCard) => fieldCard?.cardKind === "monster").length === 1,
  );
  if (!soloExtreme) return false;
  if (!["summon", "handIgnition", "graveyardMonsterEffect", "spellTrapEffect", "fieldEffect"].includes(action.type)) {
    return false;
  }
  if ((ctx.opponent?.lp || 8000) <= 1800) return false;
  if (ctx.opponentField.some((card) => (card?.atk || 0) >= 2400)) return false;
  if (action.cardName === "Black Bull Dragon" || action.cardName === "Purified Crystal Dragon") {
    return false;
  }
  return true;
}
