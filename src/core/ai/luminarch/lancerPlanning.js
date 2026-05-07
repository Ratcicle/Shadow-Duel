// Radiant Lancer battle planning.

import { getVisibleAtk } from "../common/cardStats.js";
import { getBattleStatForTarget } from "./priorityShared.js";

function getBattleDestroyAtkGain(card) {
  return (card?.effects || []).reduce((total, effect) => {
    if (
      effect?.timing !== "on_event" ||
      effect.event !== "battle_destroy" ||
      effect.requireSelfAsAttacker === false
    ) {
      return total;
    }

    return total + (effect.actions || []).reduce((sum, action) => {
      const targetsSelf = !action.targetRef || action.targetRef === "self";
      if (action.type === "permanent_buff_named" && targetsSelf) {
        return sum + (action.atkBoost || 0);
      }
      return sum;
    }, 0);
  }, 0);
}

export function evaluateRadiantLancerBattlePlan(card, analysis = {}) {
  const baseAtk = getVisibleAtk(card) || card?.atk || 0;
  const atkGain = getBattleDestroyAtkGain(card);
  const visibleTargets = (analysis.oppField || [])
    .filter((monster) => monster && monster.cardKind === "monster" && !monster.isFacedown)
    .map((monster) => ({
      card: monster,
      stat: getBattleStatForTarget(monster),
      atk: getVisibleAtk(monster),
    }))
    .filter((target) => target.stat > 0);

  const destroyable = visibleTargets.filter((target) => baseAtk > target.stat);
  const emptyPlan = {
    hasLine: false,
    improvesThreatMatchup: false,
    canSnowball: false,
    baseAtk,
    atkGain,
    projectedAtk: baseAtk,
    destroyableCount: destroyable.length,
    visibleThreatCount: visibleTargets.length,
    bestTarget: null,
    bestTargetStat: 0,
    nextThreat: null,
    nextThreatStat: 0,
    survivesNextThreat: false,
    tradesNextThreat: false,
    score: 0,
    reason: "Radiant Lancer has no visible battle target it can destroy safely",
  };

  if (atkGain <= 0 || destroyable.length === 0) {
    return emptyPlan;
  }

  const evaluatedLines = destroyable.map((target) => {
    const projectedAtk = baseAtk + atkGain;
    const remainingThreats = visibleTargets.filter((entry) => entry.card !== target.card);
    const nextThreat = remainingThreats.reduce(
      (best, entry) => (entry.stat > (best?.stat || 0) ? entry : best),
      null,
    );
    const nextThreatStat = nextThreat?.stat || 0;
    const survivesNextThreat = nextThreatStat > 0 && projectedAtk > nextThreatStat;
    const tradesNextThreat = nextThreatStat > 0 && projectedAtk === nextThreatStat;
    const clearsLastThreat = nextThreatStat === 0;
    const improvesThreatMatchup = clearsLastThreat || survivesNextThreat || tradesNextThreat;

    let score = target.stat / 450;
    if (clearsLastThreat) score += 4;
    if (survivesNextThreat) score += 5;
    else if (tradesNextThreat) score += 3;
    else score -= 2;
    if (visibleTargets.length >= 2) score += 1;

    return {
      hasLine: true,
      improvesThreatMatchup,
      canSnowball: true,
      baseAtk,
      atkGain,
      projectedAtk,
      destroyableCount: destroyable.length,
      visibleThreatCount: visibleTargets.length,
      bestTarget: target.card,
      bestTargetStat: target.stat,
      nextThreat: nextThreat?.card || null,
      nextThreatStat,
      survivesNextThreat,
      tradesNextThreat,
      score,
      reason: nextThreat
        ? `Radiant Lancer can destroy ${target.card.name} (${target.stat}), grow to ${projectedAtk}, then ${
            survivesNextThreat ? "beat" : tradesNextThreat ? "trade with" : "still lose to"
          } ${nextThreat.card.name} (${nextThreatStat})`
        : `Radiant Lancer can destroy ${target.card.name} (${target.stat}) and grow to ${projectedAtk}`,
    };
  });

  return evaluatedLines.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.bestTargetStat - a.bestTargetStat;
  })[0] || emptyPlan;
}
