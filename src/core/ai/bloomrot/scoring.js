import BaseStrategy from "../BaseStrategy.js";
import {
  BLOOMROT_NAMES,
  buildBloomrotAnalysis,
  countFieldSpores,
  getFreeMonsterZones,
  getSporeCount,
  isBloomrot,
  isBloomrotMonster,
} from "./analysis.js";
import { getBloomrotCounterSpendSummary } from "./resourcePolicy.js";

const BASE_STRATEGY = new BaseStrategy(null);

const N = {
  SPORELING: "Bloomrot Sporeling",
  ROOTLING: "Bloomrot Rootling",
  MYCO_WEAVER: "Bloomrot Myco-Weaver",
  ROT_STAG: "Bloomrot Rot-Stag",
  CARRIONCAP: "Bloomrot Carrioncap",
  MOLDMENDER: "Bloomrot Moldmender",
  GRAVECAP_WIDOW: "Bloomrot Gravecap Widow",
  ANCIENT_HUSK: "Bloomrot Ancient Husk",
  SPORE_CLOUD: "Bloomrot Spore Cloud",
  FUNGAL_ARMOR: "Bloomrot Fungal Armor",
  OVERGROWTH: "Bloomrot Overgrowth",
  SUDDEN_GERMINATION: "Bloomrot Sudden Germination",
};

const BLOOMROT_BOSSES = new Set([
  BLOOMROT_NAMES.ANCIENT_MYCELIUM,
  BLOOMROT_NAMES.QUEEN,
  BLOOMROT_NAMES.DEVOURER,
]);

const KEY_FIELD_PIECES = new Set([
  N.MYCO_WEAVER,
  N.GRAVECAP_WIDOW,
  N.ANCIENT_HUSK,
  BLOOMROT_NAMES.ANCIENT_MYCELIUM,
  BLOOMROT_NAMES.QUEEN,
  BLOOMROT_NAMES.DEVOURER,
]);

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function faceUp(card) {
  return card && card.isFacedown !== true;
}

function hasName(cards = [], name) {
  return asArray(cards).some((card) => card?.name === name);
}

function getCards(player, zone) {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  return asArray(player[zone]);
}

function effectiveAtk(card) {
  return (
    Number(card?.atk || 0) +
    Number(card?.tempAtkBoost || 0) +
    Number(card?.equipAtkBonus || 0)
  );
}

function effectiveDef(card) {
  return (
    Number(card?.def || 0) +
    Number(card?.tempDefBoost || 0) +
    Number(card?.equipDefBonus || 0)
  );
}

function battleValue(card) {
  if (!card) return 0;
  if (card.cardKind !== "monster") return 0;
  return Math.max(effectiveAtk(card), effectiveDef(card)) / 1000 + Number(card.level || 0) * 0.12;
}

function opponentThreatScore(monsters = []) {
  return asArray(monsters).reduce((sum, card) => {
    if (card?.cardKind !== "monster") return sum;
    let value = battleValue(card);
    if ((card.level || 0) >= 7) value += 1.1;
    if (card.monsterType === "fusion" || card.monsterType === "ascension") value += 1.4;
    if (asArray(card.effects).length > 0 && !card.effectsNegated && !card.status?.effectsNegated) value += 0.7;
    return sum + value;
  }, 0);
}

function countFaceUpBloomrots(cards = []) {
  return asArray(cards).filter((card) => isBloomrotMonster(card) && faceUp(card)).length;
}

function countBloomrotTokens(cards = []) {
  return asArray(cards).filter(
    (card) => card?.isToken === true || card?.name === BLOOMROT_NAMES.TOKEN,
  ).length;
}

function isBloomrotToken(card) {
  return card?.isToken === true || card?.name === BLOOMROT_NAMES.TOKEN;
}

function scoreSporeCounters(analysis = {}) {
  let score = 0;
  const opponentCards = [
    ...asArray(analysis.oppField),
    ...asArray(analysis.oppSpellTrap),
    analysis.oppFieldSpell,
  ].filter(faceUp);

  for (const card of opponentCards) {
    const spores = getSporeCount(card);
    if (spores <= 0) continue;
    const monster = card.cardKind === "monster";
    const threat = monster ? battleValue(card) : card.subtype === "field" ? 2 : 1;
    score += Math.min(1.2, spores * 0.18);
    score += Math.min(1.4, spores * threat * 0.09);
    if (monster && spores >= 4) score += 1.1;
    if (monster && spores >= 5) score += 0.9;
  }

  const total = Number(analysis.fieldSporeTotal) || countFieldSpores({
    player: analysis.player,
    opponent: analysis.opponent,
  });
  if (total >= 4) score += 0.8;
  if (total >= 5) score += 0.7;
  if (total >= 8) score += 1.8;
  return score;
}

function scoreEngineCards(analysis = {}) {
  let score = 0;
  if (analysis.hasLivingColonyActive) score += 2.8;
  if (analysis.hasRootNetworkActive) {
    score += 1.8;
    if (asArray(analysis.opponentSporedMonsters5Plus).length > 0) score += 1.4;
    if (asArray(analysis.bloomrotGraveyard).length > 0) score += 0.6;
  }
  if (analysis.hasRottingGroundActive) {
    score += 1.7;
    if (asArray(analysis.opponentSporedMonsters4Plus).length > 0) score += 1.3;
  }

  const backrow = asArray(analysis.spellTrap);
  const underPressure = asArray(analysis.opponentMonsters).length > asArray(analysis.field).length;
  if (hasName(backrow, N.SUDDEN_GERMINATION)) score += underPressure ? 1.3 : 0.6;
  if (hasName(backrow, BLOOMROT_NAMES.ROTTING_GROUND) && !analysis.hasRottingGroundActive) {
    score += 0.6;
  }
  if (analysis.fieldSpell?.name === BLOOMROT_NAMES.LIVING_COLONY && !analysis.hasLivingColonyActive) {
    score += 0.8;
  }
  return score;
}

function scoreBloomrotBodies(analysis = {}) {
  const field = asArray(analysis.field);
  const faceUpBloomrots = field.filter(
    (card) => isBloomrotMonster(card) && faceUp(card) && !isBloomrotToken(card),
  );
  const tokens = countBloomrotTokens(field);
  let score = 0;

  for (const card of faceUpBloomrots) {
    score += 0.55 + battleValue(card) * 0.22;
    if (KEY_FIELD_PIECES.has(card.name)) score += 0.75;
    if (card.name === N.MOLDMENDER && card.position === "defense") score += 0.45;
    if (card.name === N.ROT_STAG && asArray(analysis.opponentSporedMonsters).length > 0) score += 0.5;
    if (card.name === N.CARRIONCAP && asArray(analysis.opponentSporedMonsters).length > 0) score += 0.45;
  }

  if (tokens > 0) {
    score += Math.min(1.8, tokens * 0.75);
    if (analysis.hasDevourerInExtra) score += Math.min(1.3, tokens * 0.65);
    if (hasName(analysis.hand, N.ROOTLING)) score += 0.7;
  }

  return score;
}

function scoreBossAccess(analysis = {}) {
  let score = 0;
  const field = asArray(analysis.field);
  const extra = asArray(analysis.extraDeck);
  const handAndField = [...asArray(analysis.hand), ...field];
  const faceUpBloomrots = field.filter((card) => isBloomrotMonster(card) && faceUp(card));
  const totalSpores = Number(analysis.fieldSporeTotal) || 0;
  const hasLevel5 = faceUpBloomrots.some((card) => Number(card.level || 0) >= 5);
  const hasToken = countBloomrotTokens(handAndField) > 0;
  const devourerMaterials = handAndField.filter(isBloomrotMonster).length;

  for (const boss of field.filter((card) => BLOOMROT_BOSSES.has(card?.name))) {
    score += boss.name === BLOOMROT_NAMES.DEVOURER ? 4 : 3.4;
  }
  if (analysis.hasAncientMyceliumInExtra && asArray(analysis.myceliumEligibleMaterials).length > 0) {
    score += 2.1;
  } else if (extra.some((card) => card?.name === BLOOMROT_NAMES.ANCIENT_MYCELIUM)) {
    const close = faceUpBloomrots.some((card) => card?.name === N.MYCO_WEAVER || Number(card.level || 0) >= 4);
    if (close) score += 0.8;
  }
  if (analysis.hasQueenInExtra && totalSpores >= 8 && hasLevel5) score += 3;
  else if (analysis.hasQueenInExtra && totalSpores >= 6 && hasLevel5) score += 1.1;
  if (analysis.hasDevourerInExtra && hasToken && devourerMaterials >= 4) score += 3.2;
  else if (analysis.hasDevourerInExtra && hasToken && devourerMaterials >= 3) score += 1.4;
  return score;
}

function scoreHandsAndGraveyard(analysis = {}) {
  let score = 0;
  const hand = asArray(analysis.hand);
  const graveyard = asArray(analysis.graveyard);
  const bloomrotHand = hand.filter(isBloomrot);

  score += Math.min(2.4, bloomrotHand.length * 0.35);
  if (!analysis.hasLivingColonyActive && hasName(hand, BLOOMROT_NAMES.LIVING_COLONY)) score += 1.5;
  if (hasName(hand, N.SPORE_CLOUD) && asArray(analysis.opponentMonsters).length > 0) score += 0.8;
  if (hasName(hand, BLOOMROT_NAMES.HARVEST) && (analysis.fieldSporeTotal || 0) >= 4) score += 1.0;
  if (hasName(hand, N.GRAVECAP_WIDOW) && asArray(analysis.opponentSporedMonsters).length > 0) score += 0.9;
  if (analysis.hasRootNetworkActive) {
    score += Math.min(1.4, graveyard.filter(isBloomrot).length * 0.25);
  }
  return score;
}

function scorePenalties(analysis = {}) {
  let penalty = 0;
  const field = asArray(analysis.field);
  const opponentMonsters = asArray(analysis.opponentMonsters);
  const faceUpBloomrots = countFaceUpBloomrots(field);
  const freeZones = Number.isFinite(analysis.freeMonsterZones)
    ? analysis.freeMonsterZones
    : getFreeMonsterZones(analysis.player);
  const fieldFull = field.length >= 5 || freeZones <= 0;
  const hasPayoff =
    analysis.queenReady ||
    analysis.devourerReady ||
    analysis.hasLivingColonyActive ||
    asArray(analysis.opponentSporedMonsters4Plus).length > 0 ||
    hasName(asArray(analysis.hand), BLOOMROT_NAMES.HARVEST);

  if (fieldFull && !hasPayoff) penalty -= 1.8;
  if (fieldFull && countBloomrotTokens(field) >= 2) penalty -= 1.0;
  if (faceUpBloomrots === 0 && opponentMonsters.length > 0) penalty -= 2.5;
  if (faceUpBloomrots === 0 && analysis.fieldSporeTotal >= 4) penalty -= 1.1;
  if ((analysis.player?.lp || analysis.lp || 8000) <= 3000 && opponentMonsters.length > 0) {
    penalty -= 1.1;
  }

  const spendSummary = getBloomrotCounterSpendSummary(analysis);
  if (spendSummary.queenReady && spendSummary.totalSporeCount < 8) penalty -= 1.4;
  if (spendSummary.protectedSporeCount >= 4 && spendSummary.freeSporeCount <= 1) penalty -= 0.7;

  return penalty;
}

export function evaluateBloomrotBoardBonus(gameOrState, perspectivePlayer) {
  const perspective = perspectivePlayer?.id ? perspectivePlayer : gameOrState?.bot;
  const opponent =
    gameOrState?._isPerspectiveState === true
      ? gameOrState?.player
      : gameOrState?.bot === perspective
        ? gameOrState?.player
        : gameOrState?.player === perspective
          ? gameOrState?.bot
          : gameOrState?.player;

  if (!perspective) return 0;
  const baseAnalysis = {
    hand: getCards(perspective, "hand"),
    field: getCards(perspective, "field"),
    spellTrap: getCards(perspective, "spellTrap"),
    fieldSpell: perspective.fieldSpell || null,
    graveyard: getCards(perspective, "graveyard"),
    deck: getCards(perspective, "deck"),
    extraDeck: getCards(perspective, "extraDeck"),
    lp: perspective.lp || 8000,
    oppField: getCards(opponent, "field"),
    oppHand: getCards(opponent, "hand"),
    oppGraveyard: getCards(opponent, "graveyard"),
    oppSpellTrap: getCards(opponent, "spellTrap"),
    oppFieldSpell: opponent?.fieldSpell || null,
    oppLp: opponent?.lp || 8000,
    oppLP: opponent?.lp || 8000,
    phase: gameOrState?.phase || "main1",
    currentTurn: gameOrState?.turnCounter || 1,
    player: perspective,
    opponent,
    bot: perspective,
    game: gameOrState,
    summonAvailable: Number(perspective.summonCount || 0) < 1,
    normalSummonsAvailable: Math.max(0, 1 - Number(perspective.summonCount || 0)),
    isSimulatedState: gameOrState?._isPerspectiveState === true,
  };
  const analysis = buildBloomrotAnalysis({
    bot: perspective,
    opponent,
    game: gameOrState,
    baseAnalysis,
  });

  let score = 0;
  score += scoreSporeCounters(analysis);
  score += scoreEngineCards(analysis);
  score += scoreBloomrotBodies(analysis);
  score += scoreBossAccess(analysis);
  score += scoreHandsAndGraveyard(analysis);
  score += scorePenalties(analysis);
  score -= Math.min(4.5, opponentThreatScore(analysis.opponentMonsters) * 0.18);

  return Number.isFinite(score) ? score : 0;
}

export function evaluateBoardBloomrot(gameOrState, perspectivePlayer, options = {}) {
  const explicitBase = Number(options.baseScore);
  const baseScore = Number.isFinite(explicitBase)
    ? explicitBase
    : typeof options.baseEvaluator === "function"
      ? Number(options.baseEvaluator(gameOrState, perspectivePlayer)) || 0
      : BASE_STRATEGY.evaluateBoardV2(gameOrState, perspectivePlayer);
  return baseScore + evaluateBloomrotBoardBonus(gameOrState, perspectivePlayer);
}

export const bloomrotScoringInternals = {
  scoreSporeCounters,
  scoreEngineCards,
  scoreBloomrotBodies,
  scoreBossAccess,
  scorePenalties,
};
