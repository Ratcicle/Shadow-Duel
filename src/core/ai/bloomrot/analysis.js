import { buildStrategyAnalysis } from "../common/analysis.js";
import { getCounterValue } from "../common/counters.js";

export const BLOOMROT_NAMES = {
  TOKEN: "Bloomrot Token",
  LIVING_COLONY: "Bloomrot Living Colony",
  ROOT_NETWORK: "Bloomrot Root Network",
  ROTTING_GROUND: "Bloomrot Rotting Ground",
  COMPOST_RITUAL: "Bloomrot Compost Ritual",
  HARVEST: "Bloomrot Harvest",
  POLYMERIZATION: "Polymerization",
  ANCIENT_MYCELIUM: "Bloomrot Ancient Mycelium",
  QUEEN: "Bloomrot Queen of the Hollow Grove",
  DEVOURER: "Bloomrot Devourer of Dead Roots",
};

function cardArchetypes(card) {
  const values = [];
  if (card?.archetype) values.push(card.archetype);
  if (Array.isArray(card?.archetypes)) values.push(...card.archetypes);
  return values;
}

export function isBloomrot(card) {
  if (!card) return false;
  if (cardArchetypes(card).includes("Bloomrot")) return true;
  return typeof card.name === "string" && card.name.startsWith("Bloomrot ");
}

export function isBloomrotMonster(card) {
  return isBloomrot(card) && card?.cardKind === "monster";
}

export function isFaceUpBloomrotMonster(card) {
  return isBloomrotMonster(card) && card?.isFacedown !== true;
}

export function getSporeCount(card) {
  return getCounterValue(card, "spore");
}

function zoneCards(player, zone) {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  const cards = player[zone];
  return Array.isArray(cards) ? cards.filter(Boolean) : [];
}

function fieldCounterCards(player) {
  return [
    ...zoneCards(player, "field"),
    ...zoneCards(player, "spellTrap"),
    ...zoneCards(player, "fieldSpell"),
  ];
}

function countSporesOnCards(cards = []) {
  return cards.reduce((sum, card) => sum + getSporeCount(card), 0);
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

function threatScore(card) {
  if (!card) return 0;
  if (card.cardKind === "monster") {
    return Math.max(effectiveAtk(card), effectiveDef(card)) + Number(card.level || 0) * 100;
  }
  let score = 900;
  if (card.subtype === "field") score += 1200;
  if (card.subtype === "continuous") score += 800;
  if (card.subtype === "equip") score += 300;
  return score;
}

function getBloomrotFusionMaterialPool(base = {}) {
  return [...(base.hand || []), ...(base.field || [])].filter(isBloomrotMonster);
}

function hasDevourerMaterialShape(materialPool = []) {
  const bloomrotMonsters = materialPool.filter(isBloomrotMonster);
  const hasToken = bloomrotMonsters.some((card) => card?.isToken === true);
  return hasToken && bloomrotMonsters.length >= 4;
}

function buildBestSporedOpponentTargets(opponentSporedMonsters = []) {
  return [...opponentSporedMonsters]
    .filter((card) => card?.isFacedown !== true)
    .sort(
      (a, b) =>
        threatScore(b) + getSporeCount(b) * 150 -
        (threatScore(a) + getSporeCount(a) * 150),
    );
}

export function countFieldSpores({ player, opponent } = {}) {
  return countSporesOnCards([
    ...fieldCounterCards(player),
    ...fieldCounterCards(opponent),
  ]);
}

export function hasBloomrotToken(player) {
  return zoneCards(player, "field").some(
    (card) => card?.isToken === true && card?.name === BLOOMROT_NAMES.TOKEN,
  );
}

export function getFreeMonsterZones(player) {
  return Math.max(0, 5 - zoneCards(player, "field").length);
}

function hasName(cards = [], name, options = {}) {
  return cards.some((card) => {
    if (!card || card.name !== name) return false;
    if (options.faceUp === true && card.isFacedown === true) return false;
    return true;
  });
}

function cardsByName(cards = [], name) {
  return cards.filter((card) => card?.name === name);
}

function buildBloomrotZones(base) {
  return {
    bloomrotHand: (base.hand || []).filter(isBloomrot),
    bloomrotField: (base.field || []).filter(isBloomrotMonster),
    faceUpBloomrotField: (base.field || []).filter(isFaceUpBloomrotMonster),
    bloomrotGraveyard: (base.graveyard || []).filter(isBloomrot),
    bloomrotDeck: (base.deck || []).filter(isBloomrot),
    bloomrotExtraDeck: (base.extraDeck || []).filter(isBloomrot),
    bloomrotSpellTrap: (base.spellTrap || []).filter(isBloomrot),
  };
}

export function buildBloomrotAnalysis({
  bot,
  opponent,
  game,
  strategy,
  baseAnalysis,
} = {}) {
  const base =
    baseAnalysis ||
    buildStrategyAnalysis({
      bot,
      opponent,
      game,
      strategy,
    });
  const player = base.player || bot || strategy?.bot || null;
  const resolvedOpponent = base.opponent || opponent || null;
  const zones = buildBloomrotZones(base);
  const opponentMonsters = (base.oppField || []).filter(
    (card) => card?.cardKind === "monster",
  );
  const opponentSporedMonsters = opponentMonsters.filter(
    (card) => getSporeCount(card) > 0,
  );
  const bloomrotFusionMaterialPool = getBloomrotFusionMaterialPool(base);
  const opponentFieldSporeTotal = countSporesOnCards(
    fieldCounterCards(resolvedOpponent),
  );
  const opponentMonsterSporeTotal = countSporesOnCards(opponentMonsters);
  const fieldSporeTotal = countFieldSpores({
    player,
    opponent: resolvedOpponent,
  });
  const handAndBackrow = [...(base.hand || []), ...(base.spellTrap || [])];

  return {
    ...base,
    ...zones,
    player,
    opponent: resolvedOpponent,
    opponentMonsters,
    opponentSporedMonsters,
    opponentSporedMonsters1Plus: opponentSporedMonsters,
    opponentSporedMonsters4Plus: opponentMonsters.filter(
      (card) => getSporeCount(card) >= 4,
    ),
    opponentSporedMonsters5Plus: opponentMonsters.filter(
      (card) => getSporeCount(card) >= 5,
    ),
    fieldSporeTotal,
    opponentFieldSporeTotal,
    opponentMonsterSporeTotal,
    hasBloomrotToken: hasBloomrotToken(player),
    freeMonsterZones: getFreeMonsterZones(player),
    fieldCapacity: getFreeMonsterZones(player),
    canNormalSummon: base.summonAvailable,
    hasLivingColonyActive: hasName(
      [...(base.spellTrap || []), base.fieldSpell].filter(Boolean),
      BLOOMROT_NAMES.LIVING_COLONY,
      { faceUp: true },
    ),
    hasRootNetworkActive: hasName(
      [...(base.spellTrap || []), base.fieldSpell].filter(Boolean),
      BLOOMROT_NAMES.ROOT_NETWORK,
      { faceUp: true },
    ),
    hasRottingGroundActive: hasName(base.spellTrap || [], BLOOMROT_NAMES.ROTTING_GROUND, {
      faceUp: true,
    }),
    hasCompostRitual: hasName(handAndBackrow, BLOOMROT_NAMES.COMPOST_RITUAL),
    hasHarvest: hasName(handAndBackrow, BLOOMROT_NAMES.HARVEST),
    hasPolymerization: hasName(handAndBackrow, BLOOMROT_NAMES.POLYMERIZATION),
    compostRituals: cardsByName(handAndBackrow, BLOOMROT_NAMES.COMPOST_RITUAL),
    harvests: cardsByName(handAndBackrow, BLOOMROT_NAMES.HARVEST),
    polymerizations: cardsByName(handAndBackrow, BLOOMROT_NAMES.POLYMERIZATION),
    bloomrotFusionMaterialPool,
    bestSporedOpponentTargets: buildBestSporedOpponentTargets(opponentSporedMonsters),
    has2Spores: fieldSporeTotal >= 2,
    has3Spores: fieldSporeTotal >= 3,
    has4Spores: fieldSporeTotal >= 4,
    has5Spores: fieldSporeTotal >= 5,
    has8Spores: fieldSporeTotal >= 8,
    hasAncientMyceliumInExtra: hasName(
      base.extraDeck || [],
      BLOOMROT_NAMES.ANCIENT_MYCELIUM,
    ),
    hasQueenInExtra: hasName(base.extraDeck || [], BLOOMROT_NAMES.QUEEN),
    hasDevourerInExtra: hasName(base.extraDeck || [], BLOOMROT_NAMES.DEVOURER),
    queenReady:
      fieldSporeTotal >= 8 &&
      hasName(base.extraDeck || [], BLOOMROT_NAMES.QUEEN) &&
      zones.faceUpBloomrotField.some(
        (card) => card?.cardKind === "monster" && Number(card.level || 0) >= 5,
      ),
    devourerReady:
      hasName(base.extraDeck || [], BLOOMROT_NAMES.DEVOURER) &&
      hasName(handAndBackrow, BLOOMROT_NAMES.POLYMERIZATION) &&
      hasDevourerMaterialShape(bloomrotFusionMaterialPool),
  };
}
