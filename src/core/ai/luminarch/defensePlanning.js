// Luminarch defensive posture and Knights Convocation planning.

import {
  getStrongestAttackThreat,
  getTotalAttackThreat,
  getVisibleAtk,
  getVisibleDef,
} from "../common/cardStats.js";
import { isLuminarch } from "./knowledge.js";
import {
  LUMINARCH_COUNTERATTACK_PAYOFFS,
  LUMINARCH_CORE_DEFENDERS,
  isDefensiveLuminarch,
} from "./priorityShared.js";

function isCounterattackPayoff(card) {
  if (!card || card.cardKind !== "monster" || !isLuminarch(card)) return false;
  if (LUMINARCH_COUNTERATTACK_PAYOFFS.includes(card.name)) return true;
  return (card.level || 0) >= 7 && getVisibleAtk(card) >= 2400;
}

function getConvocationCandidates(analysis) {
  return (analysis.hand || []).filter(
    (card) =>
      card &&
      isLuminarch(card) &&
      card.cardKind === "monster" &&
      (card.level || 0) >= 7
  );
}

export function evaluateLuminarchDefensePlan(analysis = {}) {
  const field = Array.isArray(analysis.field) ? analysis.field : [];
  const hand = Array.isArray(analysis.hand) ? analysis.hand : [];
  const deck = Array.isArray(analysis.deck) ? analysis.deck : [];
  const oppField = Array.isArray(analysis.oppField) ? analysis.oppField : [];
  const lp = analysis.lp || 8000;

  const oppMonsters = oppField.filter(
    (card) => card && card.cardKind === "monster"
  );
  const oppStrongest = getStrongestAttackThreat(oppMonsters, {
    facedownValue: 1500,
  });
  const oppTotalAtk = getTotalAttackThreat(oppMonsters, {
    facedownValue: 1500,
  });
  const ownMonsters = field.filter(
    (card) => card && card.cardKind === "monster" && isLuminarch(card)
  );
  const defensivePieces = ownMonsters.filter((card) => {
    if (!card) return false;
    if (LUMINARCH_CORE_DEFENDERS.includes(card.name)) return true;
    if (card.mustBeAttacked || card.battleIndestructibleOncePerTurn) return true;
    return getVisibleDef(card) >= 2400 || getVisibleDef(card) >= oppStrongest;
  });
  const bestDefense = defensivePieces.reduce(
    (max, card) =>
      Math.max(max, card.isFacedown ? card.def || 0 : getVisibleDef(card)),
    0
  );
  const hasFunctionalDefense =
    defensivePieces.length > 0 &&
    (oppStrongest === 0 ||
      bestDefense >= oppStrongest ||
      defensivePieces.some(
        (card) =>
          card.mustBeAttacked ||
          card.battleIndestructibleOncePerTurn ||
          card.name === "Luminarch Sanctum Protector" ||
          card.name === "Luminarch Fortress Aegis"
      ));
  const hasStarterInHand = hand.some(
    (card) =>
      card &&
      (card.name === "Luminarch Valiant - Knight of the Dawn" ||
        card.name === "Luminarch Sanctified Arbiter" ||
        card.name === "Luminarch Aegisbearer" ||
        card.name === "Luminarch Sanctum Protector")
  );
  const highLevelInHand = getConvocationCandidates(analysis);
  const brickCritical =
    highLevelInHand.length >= 2 && !hasStarterInHand && ownMonsters.length === 0;
  const clearLethalRisk =
    oppTotalAtk >= lp && (!hasFunctionalDefense || bestDefense < oppStrongest);
  const lpSufficient =
    lp >= 3500 ||
    (hasFunctionalDefense && lp > Math.max(1200, oppStrongest - 1000));
  const stable =
    hasFunctionalDefense && !clearLethalRisk && lpSufficient && !brickCritical;
  const offensivePayoffsAvailable = [...hand, ...deck].filter(
    isCounterattackPayoff
  );
  const readyToCounterattack =
    stable &&
    (offensivePayoffsAvailable.length > 0 ||
      ownMonsters.some((card) =>
        getVisibleAtk(card) >= Math.max(2000, oppStrongest)
      ));

  return {
    stable,
    readyToCounterattack,
    hasFunctionalDefense,
    clearLethalRisk,
    brickCritical,
    lpSufficient,
    oppStrongest,
    oppTotalAtk,
    bestDefense,
    defensivePieces,
    offensivePayoffsAvailable,
  };
}

export function evaluateKnightsConvocationPlan(analysis = {}) {
  const highLevel = getConvocationCandidates(analysis);
  if (highLevel.length === 0) {
    return { yes: false, priority: 0, reason: "Sem Lv7+ para discartar" };
  }

  const defensePlan = evaluateLuminarchDefensePlan(analysis);
  const offensiveCosts = highLevel.filter(isCounterattackPayoff);
  const nonOffensiveCosts = highLevel.filter((card) => !isCounterattackPayoff(card));
  const hasSearcherInHand = (analysis.hand || []).some(
    (card) =>
      card &&
      (card.name?.includes("Valiant") || card.name?.includes("Arbiter"))
  );
  const hasStarterOrTank = (analysis.hand || []).some(
    (card) =>
      card &&
      (card.name === "Luminarch Aegisbearer" ||
        card.name === "Luminarch Sanctum Protector" ||
        card.name?.includes("Valiant") ||
        card.name?.includes("Arbiter"))
  );
  const isBricked = highLevel.length >= 2 && !hasSearcherInHand;
  const noDefense = !defensePlan.hasFunctionalDefense;
  const onlyOffensivePayoff =
    offensiveCosts.length === 1 &&
    defensePlan.offensivePayoffsAvailable.length <= 1 &&
    nonOffensiveCosts.length === 0;

  if (onlyOffensivePayoff && !defensePlan.clearLethalRisk) {
    return {
      yes: false,
      priority: 0,
      reason: `Preservar ultimo payoff ofensivo (${offensiveCosts[0].name})`,
      defensePlan,
    };
  }

  if (defensePlan.stable) {
    if (nonOffensiveCosts.length === 0) {
      return {
        yes: false,
        priority: 0,
        reason: "Campo estabilizado: preservar monstros grandes para contra-ataque",
        defensePlan,
      };
    }
    return {
      yes: true,
      priority: 2,
      reason: "Campo estabilizado: usar Convocation so com custo excedente",
      defensePlan,
    };
  }

  if (isBricked) {
    return {
      yes: true,
      priority: 14,
      reason: `BRICK ESCAPE: ${highLevel.length}x Lv7+ na mao sem searchers`,
      defensePlan,
    };
  }

  if (noDefense && !hasStarterOrTank && highLevel.length >= 2) {
    return {
      yes: true,
      priority: 12,
      reason: "Sem defesa/starter: converter Lv7+ excedente em peca inicial",
      defensePlan,
    };
  }

  if (defensePlan.clearLethalRisk && highLevel.length >= 2) {
    return {
      yes: true,
      priority: 13,
      reason: "Pressao letal: buscar peca defensiva urgente",
      defensePlan,
    };
  }

  return {
    yes: false,
    priority: 0,
    reason: "Convocation segurada: custo alto sem brick ou urgencia defensiva",
    defensePlan,
  };
}
