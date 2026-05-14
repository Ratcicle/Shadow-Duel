import { getEffectiveAtk, getEffectiveDef } from "../common/cardStats.js";
import {
  ARCANIST_NAMES,
  CARD_KNOWLEDGE,
  controlsArcanistEquip,
  getInkCounters,
  getStoredBlueprintCount,
  hasArcanistEquip,
  isArcanist,
  isArcanistEquip,
  isArcanistMonster,
  isArcanistSpell,
} from "./knowledge.js";

function getCardBaseValue(card) {
  if (!card) return 0;
  const knowledge = CARD_KNOWLEDGE[card.name];
  if (knowledge?.value) return knowledge.value;
  if (card.cardKind === "monster") {
    return Math.max(getEffectiveAtk(card), getEffectiveDef(card)) / 350;
  }
  return 3;
}

function getArcanistMonsterValue(card, analysis = {}) {
  if (!card || card.cardKind !== "monster") return 0;

  let value = getCardBaseValue(card);
  const atk = getEffectiveAtk(card);
  const def = getEffectiveDef(card);
  value += Math.max(atk, def) / 900;
  value += (card.level || 0) * 0.12;

  if (isArcanistMonster(card)) value += 0.7;
  if (hasArcanistEquip(card)) value += 2.4;
  if (card.name === ARCANIST_NAMES.AZRATH && hasArcanistEquip(card)) {
    value += 2.2;
  }
  if (card.name === ARCANIST_NAMES.ELEMENTALIST) {
    value += 1.2;
    if (hasArcanistEquip(card)) value += 2.4;
  }
  if (card.name === ARCANIST_NAMES.APPRENTICE && hasArcanistEquip(card)) {
    const allies = (analysis.field || []).filter(isArcanistMonster).length;
    value += allies * 0.45;
  }
  if (card.name === ARCANIST_NAMES.TERA && hasArcanistEquip(card)) {
    value += (analysis.oppField || []).length > 0 ? 1.0 : 0.3;
  }

  if (card.position === "attack" && !card.hasAttacked) {
    value += atk / 1400;
    if ((analysis.oppField || []).length === 0) value += atk / 1800;
  }

  if (card.isFacedown) value *= 0.65;
  return value;
}

function getArcanistSpellTrapValue(card, analysis = {}) {
  if (!card) return 0;
  let value = getCardBaseValue(card);

  if (card.name === ARCANIST_NAMES.GRAND_LIBRARY) value += 2.5;
  if (card.name === ARCANIST_NAMES.GRIMOIRE) {
    value += 2.0;
    value += getStoredBlueprintCount(card) * 1.5;
    if (card.equippedTo) value += 1.2;
  }
  if (card.name === ARCANIST_NAMES.INK_RIVER) {
    const counters = getInkCounters(card);
    value += Math.min(counters, 4) * 0.6;
    if (counters >= 2 && (analysis.arcanistSpellsInGY || 0) > 0) value += 1.4;
  }
  if (card.name === ARCANIST_NAMES.MEETING) value += 0.8;
  if (isArcanistEquip(card) && card.equippedTo) value += 1.0;

  return value;
}

export function evaluateArcanistCardValue(card, analysis = {}) {
  if (!card) return 0;
  if (card.cardKind === "monster") {
    return getArcanistMonsterValue(card, analysis);
  }
  if (card.cardKind === "spell" || card.cardKind === "trap") {
    return getArcanistSpellTrapValue(card, analysis);
  }
  return getCardBaseValue(card);
}

export function evaluateBoardArcanist(gameOrState, perspectivePlayer, getOpponent) {
  const perspective =
    perspectivePlayer?.id ? perspectivePlayer : gameOrState?.bot || null;
  const opponent =
    typeof getOpponent === "function"
      ? getOpponent(gameOrState, perspective)
      : gameOrState?.player || null;

  if (!perspective) return 0;

  const analysis = {
    field: perspective.field || [],
    spellTrap: perspective.spellTrap || [],
    graveyard: perspective.graveyard || [],
    oppField: opponent?.field || [],
    arcanistSpellsInGY: (perspective.graveyard || []).filter(isArcanistSpell)
      .length,
  };

  let score = 0;
  score += ((perspective.lp || 0) - (opponent?.lp || 0)) / 700;

  for (const card of perspective.field || []) {
    score += evaluateArcanistCardValue(card, analysis);
  }
  for (const card of perspective.spellTrap || []) {
    if (card?.isFacedown) {
      score += 0.2;
    } else {
      score += evaluateArcanistCardValue(card, analysis) * 0.55;
    }
  }

  if (perspective.fieldSpell?.name === ARCANIST_NAMES.GRAND_LIBRARY) {
    score += 3.0;
  } else if (perspective.fieldSpell) {
    score += 0.6;
  }

  const equippedArcanists = (perspective.field || []).filter(
    (card) => isArcanistMonster(card) && hasArcanistEquip(card),
  ).length;
  score += equippedArcanists * 1.2;
  if (controlsArcanistEquip(perspective)) score += 0.8;

  const recoverableSpells = (perspective.graveyard || []).filter(
    isArcanistSpell,
  ).length;
  score += Math.min(recoverableSpells, 5) * 0.25;

  const removalInHand = (perspective.hand || []).filter((card) =>
    [
      ARCANIST_NAMES.SEISMIC_IMPACT,
      ARCANIST_NAMES.CRIMSON_EXPLOSION,
      ARCANIST_NAMES.LIGHTNING_LANCE,
    ].includes(card?.name),
  ).length;
  score += removalInHand * 0.55;

  for (const card of opponent?.field || []) {
    if (!card || card.cardKind !== "monster") continue;
    const threat = card.isFacedown
      ? 1.2
      : Math.max(getEffectiveAtk(card), getEffectiveDef(card)) / 850;
    score -= threat;
  }

  score -= (opponent?.spellTrap || []).length * 0.25;
  if (opponent?.fieldSpell) score -= 0.6;

  if ((perspective.field || []).length === 0) score -= 2.2;
  if ((opponent?.field || []).length === 0 && (perspective.field || []).length > 0) {
    score += 1.2;
  }

  if (!isArcanist(perspective.fieldSpell) && perspective.fieldSpell) {
    score -= 0.2;
  }

  return score;
}
