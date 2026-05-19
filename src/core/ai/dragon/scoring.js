// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/dragon/scoring.js
// Board evaluation for Dragon deck.
// ─────────────────────────────────────────────────────────────────────────────

import { CARD_KNOWLEDGE, isExtremeDragon } from "./knowledge.js";
import { analyzeResourceEconomy } from "../common/resourceEconomy.js";
import { scoreResourcePressure } from "../common/resourcePolicy.js";

export const DRAGON_EXTREME_RESOURCE_POLICY = {
  resourceName: "Extreme Dragon",
  primaryZone: "graveyard",
  thresholds: {
    preserveAt: Infinity,
    criticalAt: Infinity,
  },
};

export function analyzeExtremeDragonEconomy(analysisOrGraveyard = {}) {
  const analysis = Array.isArray(analysisOrGraveyard)
    ? { graveyard: analysisOrGraveyard }
    : analysisOrGraveyard || {};

  const economy = analyzeResourceEconomy(analysis, {
    resourceName: "Extreme Dragon",
    zones: ["graveyard"],
    matchResource: isExtremeDragon,
    computeAccessibility: ({ countsByZone }) => ({
      accessibleByZone: {
        graveyard: countsByZone.graveyard,
      },
      strandedByZone: {
        graveyard: 0,
      },
    }),
    computeFlags: ({ countsByZone }) => ({
      usefulExtremeResources: countsByZone.graveyard > 0,
    }),
  });

  const extremeInGY = economy.countsByZone.graveyard || 0;

  return {
    extremeInGY,
    extremeDragonsInGY: extremeInGY,
    totalExtremeDragons: economy.totalResources,
    usefulExtremeResources: economy.flags.usefulExtremeResources,
    economy,
  };
}

export function assessDragonExtremeResourcePolicy(analysis = {}) {
  const economy =
    analysis.extremeDragonEconomy?.economy ||
    analyzeExtremeDragonEconomy(analysis).economy;
  const pressure = scoreResourcePressure(economy, DRAGON_EXTREME_RESOURCE_POLICY);

  return {
    pressure,
    preserveExtremeInGY: pressure.shouldPreserve,
    criticalExtremeResource: pressure.isCritical,
  };
}

/**
 * Evaluates a single Dragon monster's board value.
 * @param {Object} monster
 * @param {Object} owner
 * @param {Object} opponent
 * @returns {number}
 */
export function evaluateDragonMonster(monster, owner, opponent) {
  if (!monster) return 0;

  const knowledge = CARD_KNOWLEDGE[monster.name] || {};
  let value = 0;

  // Base ATK/DEF value
  const atk = (monster.atk || 0) + (monster.tempAtkBoost || 0);
  const def = (monster.def || 0) + (monster.tempDefBoost || 0);
  const stat = monster.position === "defense" ? def : atk;
  value += stat / 900;
  value += (monster.level || 0) * 0.1;

  // Role-based bonuses
  if (knowledge.role === "win_condition") value += 5.0;
  if (knowledge.role === "boss") value += 1.5;
  if (knowledge.role === "fusion_boss" || knowledge.role === "ascension_boss") value += 2.0;
  if (knowledge.role === "searcher") value += 1.0;
  if (knowledge.role === "extender") value += 0.8;

  // Extreme Dragon bonus (they have fieldLimit — having one is valuable)
  if (isExtremeDragon(monster)) value += 1.0;

  // Battle readiness
  if (monster.position === "attack" && !monster.hasAttacked && !monster.cannotAttackThisTurn) {
    value += 0.4;
    const oppField = opponent?.field || [];
    if (oppField.length === 0) {
      value += atk / 1500;  // Direct attack potential
    }
  }

  // Protection
  if (monster.battleIndestructible || monster.tempBattleIndestructible) value += 0.8;
  if (monster.simBattleDestructionProtected || monster.simEffectDestructionProtected) value += 0.7;
  if (monster.simProtectedUntilNextTurn) value += 0.3;
  if (monster.simFutureRevive) value += 0.6;
  if (monster.simMultiAttackPressure && !monster.cannotAttackThisTurn) value += 0.6;
  if (monster.effectsNegated) value -= 0.5;

  // Penalties
  if (monster.cannotAttackThisTurn) value -= 0.3;
  if (monster.hasAttacked) value -= 0.2;
  if (monster.isFacedown) value *= 0.7;

  return value;
}

/**
 * Full board evaluation for Dragon strategy.
 * @param {Object} gameOrState
 * @param {Object} perspectivePlayer
 * @param {Function} getOpponentFn
 * @returns {number}
 */
export function evaluateBoardDragon(gameOrState, perspectivePlayer, getOpponentFn) {
  const perspective = perspectivePlayer?.id ? perspectivePlayer : gameOrState.bot;
  const opponent = typeof getOpponentFn === "function"
    ? getOpponentFn(gameOrState, perspective)
    : gameOrState.player;

  let score = 0;

  // ── LP advantage ──────────────────────────────────────────────────────────
  const lpDiff = (perspective?.lp || 0) - (opponent?.lp || 0);
  score += lpDiff / 600;

  if ((opponent?.lp || 0) <= 2000) score += 3.5;
  else if ((opponent?.lp || 0) <= 4000) score += 1.5;

  if ((perspective?.lp || 0) <= 1500) score -= 2.5;
  else if ((perspective?.lp || 0) <= 3000) score -= 1.0;

  // ── Field presence ────────────────────────────────────────────────────────
  const myField = perspective?.field || [];
  const oppField = opponent?.field || [];

  for (const monster of myField) {
    if (!monster || monster.cardKind !== "monster") continue;
    score += evaluateDragonMonster(monster, perspective, opponent);
  }

  for (const monster of oppField) {
    if (!monster || monster.cardKind !== "monster") continue;
    const oppValue = evaluateDragonMonster(monster, opponent, perspective);
    score -= oppValue * 0.85;
  }

  // ── Extreme Dragon GY resources ───────────────────────────────────────────
  const myGY = perspective?.graveyard || [];
  const { extremeInGY } = analyzeExtremeDragonEconomy(myGY);
  score += Math.min(extremeInGY, 3) * 0.25; // Useful follow-up resource, not a win condition.

  // ── Hand advantage ────────────────────────────────────────────────────────
  const myHand = perspective?.hand || [];
  const oppHand = opponent?.hand || [];
  score += (myHand.length - oppHand.length) * 0.5;

  // ── Field spell (Jagged Peak) ─────────────────────────────────────────────
  if (perspective?.fieldSpell?.name === "Jagged Peak of the Dragons") {
    score += 1.5;
    const peakCounters = perspective.fieldSpell.counters?.dragon_peak || 0;
    score += peakCounters * 0.3;  // Each counter toward 5 is valuable
    if (peakCounters >= 5) score += 2.0;  // Can SS Extreme Dragon now!
  }
  if (opponent?.fieldSpell) score -= 1.0;

  // ── Backrow ───────────────────────────────────────────────────────────────
  const myBackrow = perspective?.spellTrap || [];
  const oppBackrow = opponent?.spellTrap || [];
  score += myBackrow.length * 0.25;
  score -= oppBackrow.length * 0.3;

  // Reactive traps are worth more than raw backrow count
  for (const card of myBackrow) {
    if (!card?.isFacedown) continue;
    if (card.name === "Call of the Haunted") {
      const gyMonsters = myGY.filter((c) => c?.cardKind === "monster");
      if (gyMonsters.length > 0) score += 1.2; // Can revive on opponent's turn
    } else if (card.name === "Dragon Spirit Sanctuary") {
      if (myField.some((c) => c?.cardKind === "monster")) score += 0.8; // Protects field Dragons
    }
  }

  // ── Tempo ─────────────────────────────────────────────────────────────────
  if (myField.length === 0 && oppField.length > 0) score -= 2.0;
  if (oppField.length === 0 && myField.length > 0) score += 1.5;

  return score;
}
