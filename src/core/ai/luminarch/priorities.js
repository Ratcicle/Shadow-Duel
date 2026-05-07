// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/luminarch/priorities.js
// Decisões táticas: quando jogar spells, quando invocar, etc.
// ─────────────────────────────────────────────────────────────────────────────

import { CARD_KNOWLEDGE, isLuminarchByName, isLuminarch } from "./knowledge.js";
import {
  evaluateCardExpendability,
  evaluateFieldSpellUrgency,
} from "./cardValue.js";
import {
  estimateTemporaryCombatDebuffTargetValue,
  isBattleReadyAttacker,
} from "../StrategyUtils.js";

// Rastrear erros já logados para evitar spam
const _loggedErrors = new Set();

const LUMINARCH_CORE_DEFENDERS = [
  "Luminarch Aegisbearer",
  "Luminarch Sanctum Protector",
  "Luminarch Fortress Aegis",
  "Luminarch Megashield Barbarias",
];

const LUMINARCH_COUNTERATTACK_PAYOFFS = [
  "Luminarch Radiant Lancer",
  "Luminarch Aurora Seraph",
  "Luminarch Celestial Marshal",
  "Luminarch Moonblade Captain",
  "Luminarch Megashield Barbarias",
];

function getVisibleAtk(card) {
  if (!card || card.isFacedown) return 0;
  return (card.atk || 0) + (card.tempAtkBoost || 0) + (card.equipAtkBonus || 0);
}

function getVisibleDef(card) {
  if (!card || card.isFacedown) return 0;
  return (card.def || 0) + (card.tempDefBoost || 0) + (card.equipDefBonus || 0);
}

function getBattleStatForTarget(card) {
  if (!card || card.cardKind !== "monster" || card.isFacedown) return 0;
  return card.position === "defense" ? getVisibleDef(card) : getVisibleAtk(card);
}

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

function isProtectedLuminarchCost(card) {
  const name = card?.name || "";
  return (
    name === "Luminarch Aegisbearer" ||
    name === "Luminarch Sanctum Protector" ||
    name === "Luminarch Fortress Aegis" ||
    name === "Luminarch Aurora Seraph" ||
    (name === "Luminarch Radiant Lancer" &&
      ((card.atk || 0) > 2200 || card.hasAttacked))
  );
}

function getRemovalCostScore(card, analysis) {
  const expendability = evaluateCardExpendability(card, {
    hand: analysis.hand || [],
    field: analysis.field || [],
    graveyard: analysis.graveyard || [],
    fieldSpell: analysis.fieldSpell || null,
    usedEffects: analysis.usedEffects || [],
  });

  let score = expendability.value ?? 5;
  if (expendability.expendable) score -= 2;
  if (card.usedEffectThisTurn || card.hasAttacked) score -= 1.25;
  if (card.name === "Luminarch Enchanted Halberd") score -= 1.5;
  if (card.name === "Luminarch Magic Sickle") score -= 1.25;
  if (isProtectedLuminarchCost(card)) score += 4;
  if (card.mustBeAttacked) score += 2;
  if (getVisibleDef(card) >= 2500) score += 1.5;
  return score;
}

function getRemovalTargetScore(card, analysis) {
  if (!card) return 0;
  const atk = getVisibleAtk(card);
  const def = getVisibleDef(card);
  let score = Math.max(atk, def) / 450;
  if (atk >= 2500 || def >= 2500) score += 1.5;
  if (atk >= 3000) score += 2.5;
  if ((card.name || "").includes("Extreme Dragon")) score += 3;
  if (card.monsterType === "fusion" || card.monsterType === "ascension") {
    score += 1.5;
  }
  if (card.mustBeAttacked || card.battleIndestructibleOncePerTurn) score += 1;

  const oppTotalAtk = (analysis.oppField || []).reduce(
    (sum, monster) => sum + getVisibleAtk(monster),
    0,
  );
  if (oppTotalAtk >= (analysis.lp || 8000) && atk >= 2000) score += 2;
  return score;
}

function getBattleReadyLuminarchAttackers(analysis) {
  return (analysis.field || []).filter((card) =>
    isBattleReadyAttacker(card, { archetype: "Luminarch" })
  );
}

function getBestTemporaryCombatDebuffTarget(analysis) {
  const attackers = getBattleReadyLuminarchAttackers(analysis);
  if (attackers.length === 0) return { target: null, score: 0 };

  return (analysis.oppField || [])
    .filter((card) => card && card.cardKind === "monster" && !card.isFacedown)
    .map((target) => ({
      target,
      score: estimateTemporaryCombatDebuffTargetValue(target, {
        attackers,
        opponentLp: analysis.oppLp || 0,
      }),
    }))
    .sort((a, b) => b.score - a.score)[0] || { target: null, score: 0 };
}

function getBattleStatToAttack(card) {
  if (!card || card.cardKind !== "monster") return 0;
  if (card.isFacedown) return 1500;
  return card.position === "defense" ? getVisibleDef(card) : getVisibleAtk(card);
}

function getThreatAtk(card) {
  if (!card || card.cardKind !== "monster") return 0;
  return card.isFacedown ? 1500 : getVisibleAtk(card);
}

function getSelfLuminarchTargetIds(effect) {
  return new Set(
    (effect?.targets || [])
      .filter(
        (target) =>
          target &&
          target.owner === "self" &&
          target.zone === "field" &&
          target.cardKind === "monster" &&
          (!target.archetype || target.archetype === "Luminarch")
      )
      .map((target) => target.id)
      .filter(Boolean)
  );
}

function getStatBuffOptionsFromEffect(source, effect, sourceZone) {
  const targetIds = getSelfLuminarchTargetIds(effect);
  if (targetIds.size === 0) return [];

  const lpCost = (effect.actions || []).reduce(
    (sum, action) =>
      action?.type === "pay_lp" ? sum + (action.amount || 0) : sum,
    0
  );
  const options = [];
  (effect.actions || []).forEach((action) => {
    if (action.type === "pay_lp") return;

    if (!targetIds.has(action.targetRef)) return;
    if (action.type === "buff_stats_temp") {
      options.push({
        sourceName: source?.name || effect.id || "stat buff",
        sourceZone,
        atkBoost: action.atkBoost || 0,
        defBoost: action.defBoost || 0,
        lpCost,
      });
    }
    if (action.type === "equip") {
      options.push({
        sourceName: source?.name || effect.id || "equip",
        sourceZone,
        atkBoost: action.atkBonus || 0,
        defBoost: action.defBonus || 0,
        lpCost,
      });
    }
  });

  return options.filter((option) => option.atkBoost > 0 || option.defBoost > 0);
}

function getMoonlitBuffOptions(analysis) {
  const options = [];
  const fieldSpell = analysis.fieldSpell || null;
  const fieldEffect = (fieldSpell?.effects || []).find(
    (effect) => effect && effect.timing === "on_field_activate"
  );
  if (fieldSpell?.name?.includes("Citadel") && fieldEffect) {
    options.push(...getStatBuffOptionsFromEffect(fieldSpell, fieldEffect, "fieldSpell"));
  }

  (analysis.hand || [])
    .filter(
      (card) =>
        card &&
        card.cardKind === "spell" &&
        card.name !== "Luminarch Moonlit Blessing"
    )
    .forEach((card) => {
      (card.effects || [])
        .filter((effect) => effect && effect.timing === "on_play")
        .forEach((effect) => {
          options.push(...getStatBuffOptionsFromEffect(card, effect, "hand"));
        });
    });

  return options;
}

function chooseBestBuffPackage(options, lp, purpose) {
  const usable = (options || []).filter((option) => (option.lpCost || 0) <= lp);
  const limit = Math.min(usable.length, 8);
  let best = {
    atkBoost: 0,
    defBoost: 0,
    lpCost: 0,
    sources: [],
  };

  for (let mask = 1; mask < 1 << limit; mask += 1) {
    const selected = [];
    let atkBoost = 0;
    let defBoost = 0;
    let lpCost = 0;
    for (let i = 0; i < limit; i += 1) {
      if ((mask & (1 << i)) === 0) continue;
      const option = usable[i];
      selected.push(option);
      atkBoost += option.atkBoost || 0;
      defBoost += option.defBoost || 0;
      lpCost += option.lpCost || 0;
    }
    if (lpCost > lp) continue;

    const score =
      purpose === "defense"
        ? defBoost * 1.2 + atkBoost * 0.25
        : atkBoost * 1.2 + defBoost * 0.25;
    const bestScore =
      purpose === "defense"
        ? best.defBoost * 1.2 + best.atkBoost * 0.25
        : best.atkBoost * 1.2 + best.defBoost * 0.25;
    if (score > bestScore || (score === bestScore && lpCost < best.lpCost)) {
      best = {
        atkBoost,
        defBoost,
        lpCost,
        sources: selected.map((option) => option.sourceName),
      };
    }
  }

  return best;
}

function getBestAttackLine(projectedAtk, oppMonsters) {
  return (oppMonsters || [])
    .map((card) => ({
      card,
      stat: getBattleStatToAttack(card),
      atk: getThreatAtk(card),
    }))
    .filter((entry) => projectedAtk > entry.stat)
    .sort((a, b) => b.stat - a.stat)[0] || null;
}

export function evaluateMoonlitReviveCandidate(card, analysis = {}) {
  if (!card || card.cardKind !== "monster") {
    return { target: card, score: -100, purpose: "none", position: "attack" };
  }

  const oppMonsters = (analysis.oppField || []).filter(
    (entry) => entry && entry.cardKind === "monster"
  );
  const oppStrongestBattleStat = oppMonsters.reduce(
    (max, monster) => Math.max(max, getBattleStatToAttack(monster)),
    0
  );
  const oppStrongestAtk = oppMonsters.reduce(
    (max, monster) => Math.max(max, getThreatAtk(monster)),
    0
  );
  const oppTotalAtk = oppMonsters.reduce(
    (sum, monster) => sum + getThreatAtk(monster),
    0
  );
  const hasTank = (analysis.field || []).some(
    (entry) =>
      entry &&
      entry.cardKind === "monster" &&
      !entry.isFacedown &&
      isLuminarch(entry) &&
      (isDefensiveLuminarch(entry) || getVisibleDef(entry) >= oppStrongestAtk)
  );
  const pressure =
    (analysis.lp || 8000) <= 3500 ||
    oppTotalAtk >= (analysis.lp || 8000) ||
    (oppStrongestAtk >= 2200 && !hasTank);

  const buffOptions = getMoonlitBuffOptions(analysis);
  const attackBuff = chooseBestBuffPackage(buffOptions, analysis.lp || 0, "attack");
  const defenseBuff = chooseBestBuffPackage(buffOptions, analysis.lp || 0, "defense");
  const atk = getVisibleAtk(card);
  const def = getVisibleDef(card);
  const projectedAtk = atk + attackBuff.atkBoost;
  const projectedDef = def + defenseBuff.defBoost;
  const attackLine = getBestAttackLine(projectedAtk, oppMonsters);
  const canAttackOverAll =
    oppStrongestBattleStat === 0 || projectedAtk > oppStrongestBattleStat;
  const canCounterattack = !!attackLine && (canAttackOverAll || projectedAtk > atk);
  const blocksBestThreat = projectedDef >= oppStrongestAtk;
  const defensive = isDefensiveLuminarch(card);

  let purpose = pressure ? "stabilize" : "value";
  let position = atk >= def ? "attack" : "defense";
  let score = (card.level || 0) * 0.2 + Math.max(atk, def) / 1000;

  if (canCounterattack) {
    purpose = pressure ? "counterattack" : "pressure";
    position = "attack";
    score += projectedAtk / 450;
    score += (attackLine?.stat || 0) / 350;
    if (canAttackOverAll) score += 3;
    if (pressure) score += 3;
    if (attackBuff.sources.length > 0) score += 1;
  } else if (pressure) {
    purpose = "stabilize";
    position = "defense";
    score += projectedDef / 450;
    if (defensive) score += 4;
    if (blocksBestThreat) score += 2;
    if (!blocksBestThreat && !defensive) score -= 2;
  } else {
    const bestDebuffTarget = getBestTemporaryCombatDebuffTarget({
      ...analysis,
      field: [...(analysis.field || []), card],
    });
    const wantsPressure =
      (analysis.oppLp || 8000) <= 3000 || bestDebuffTarget.score > 0;
    if (wantsPressure && atk >= 1600) {
      purpose = "pressure";
      position = "attack";
      score += atk / 450;
      if (atk >= 2000 || card.piercing) score += 2;
    } else if (defensive) {
      position = "defense";
      score += 1.2;
    }
  }

  return {
    target: card,
    score,
    purpose,
    position,
    projectedAtk,
    projectedDef,
    attackBuffSources: attackBuff.sources,
    defenseBuffSources: defenseBuff.sources,
    attackLine,
    pressure,
    canCounterattack,
    blocksBestThreat,
    reason: canCounterattack
      ? `counterattack ${attackLine.card.name} with ${projectedAtk} ATK`
      : blocksBestThreat
        ? `stabilize with ${projectedDef} DEF`
        : `${purpose} in ${position}`,
  };
}

function isDefensiveLuminarch(card) {
  if (!card || card.cardKind !== "monster") return false;
  if (card.mustBeAttacked) return true;
  if ((card.def || 0) >= (card.atk || 0) + 500) return true;
  return LUMINARCH_CORE_DEFENDERS.includes(card.name);
}

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
  const oppStrongest = oppMonsters.reduce(
    (max, card) => Math.max(max, card.isFacedown ? 1500 : getVisibleAtk(card)),
    0
  );
  const oppTotalAtk = oppMonsters.reduce(
    (sum, card) => sum + (card.isFacedown ? 1500 : getVisibleAtk(card)),
    0
  );
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

export function getMoonlitTargetPlan(analysis) {
  const gyMonsters = (analysis.graveyard || []).filter(
    (card) => card && card.cardKind === "monster" && isLuminarch(card)
  );
  if (gyMonsters.length === 0) {
    return { target: null, score: 0, purpose: "none", position: "attack" };
  }

  const candidatePlans = gyMonsters.map((card) =>
    evaluateMoonlitReviveCandidate(card, analysis)
  );
  const bestPlan = candidatePlans.sort((a, b) => b.score - a.score)[0];
  return {
    ...bestPlan,
    candidatePlans,
  };
}

/**
 * @typedef {Object} SpellDecision
 * @property {boolean} yes
 * @property {number} [priority]
 * @property {string} reason
 */

/**
 * @typedef {Object} SummonDecision
 * @property {boolean} yes
 * @property {string} [position]
 * @property {number} [priority]
 * @property {string} reason
 */

/**
 * Decide se deve jogar uma spell.
 * @param {Object} card
 * @param {Object} analysis - { hand, field, fieldSpell, graveyard, lp, oppField, oppLp }
 * @returns {SpellDecision}
 */
export function shouldPlaySpell(card, analysis) {
  try {
    const name = card.name;
    const knowledge = CARD_KNOWLEDGE[name];

    // Guard: validação de entrada
    if (!card || !name || !analysis) {
      return { yes: false, reason: "Dados inválidos" };
    }

    // Garantir que analysis tem arrays válidos
    analysis.field = Array.isArray(analysis.field) ? analysis.field : [];
    analysis.oppField = Array.isArray(analysis.oppField)
      ? analysis.oppField
      : [];
    analysis.hand = Array.isArray(analysis.hand) ? analysis.hand : [];
    analysis.graveyard = Array.isArray(analysis.graveyard)
      ? analysis.graveyard
      : [];

    // ═════════════════════════════════════════════════════════════════════════
    // FIELD SPELL - MÁXIMA PRIORIDADE
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Sanctum of the Luminarch Citadel") {
      if (analysis.fieldSpell) {
        return { yes: false, reason: "Já tenho field spell ativo" };
      }

      // Usar sistema de avaliação de urgência
      const urgency = evaluateFieldSpellUrgency(analysis);

      return {
        yes: true,
        priority: urgency.priority,
        reason: urgency.reason,
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PROTEÇÃO
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Holy Shield") {
      const luminarchOnField = (analysis.field || []).filter(
        (c) => c && isLuminarch(c)
      );

      // CRITICAL: Sem monstros no campo = NÃO PODE ATIVAR (requer targets)
      if (luminarchOnField.length === 0) {
        return {
          yes: false,
          reason: "Sem monstros Luminarch no campo para proteger",
        };
      }

      const oppHasThreats = (analysis.oppField || []).some(
        (m) => m && m.atk && m.atk >= 2000
      );

      // CRÍTICO: Holy Shield agora é QUICK SPELL (speed 2)
      // Ideal é SETAR e ativar no turno do oponente como reação
      // Só ativar proativamente em Main Phase se situação desesperadora

      // Situação desesperadora: LP crítico + múltiplas ameaças
      const lpCritical = (analysis.lp || 8000) <= 2000;
      const multipleThreats =
        (analysis.oppField || []).filter((m) => m && m.atk && m.atk >= 1800)
          .length >= 2;

      if (lpCritical && multipleThreats && luminarchOnField.length >= 2) {
        return {
          yes: true,
          priority: 16,
          reason: `LP crítico + ${luminarchOnField.length} alvos - ativar AGORA`,
        };
      }

      // Caso contrário: SEGURAR para uso reativo
      // A IA deve SET esta carta para usar no turno do oponente
      return {
        yes: false,
        reason:
          "Quick Spell - segurar para ativar no turno do oponente (uso reativo)",
      };
    }

    if (name === "Luminarch Crescent Shield") {
      // Crescent Shield é equip que requer um monstro Luminarch no campo
      const luminarchMonsters = (analysis.field || []).filter(
        (c) =>
          c &&
          c.archetype === "Luminarch" &&
          c.cardKind === "monster" &&
          !c.isFacedown
      );

      if (luminarchMonsters.length === 0) {
        return {
          yes: false,
          reason: "Sem monstro Luminarch face-up para equipar",
        };
      }

      // Priorizar monstros defensivos
      const aegis = luminarchMonsters.find(
        (c) => c.name === "Luminarch Aegisbearer"
      );
      const protector = luminarchMonsters.find(
        (c) => c.name === "Luminarch Sanctum Protector"
      );

      if (aegis) {
        return {
          yes: true,
          priority: 8,
          reason: "Equipar Aegisbearer (3000 DEF = wall)",
        };
      }
      if (protector) {
        return {
          yes: true,
          priority: 7,
          reason: "Equipar Sanctum Protector (3300 DEF)",
        };
      }

      // Qualquer monstro Luminarch serve como fallback
      return {
        yes: true,
        priority: 5,
        reason: `Equipar ${luminarchMonsters[0].name}`,
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // RECURSÃO
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Moonlit Blessing") {
      const gyLuminarch = (analysis.graveyard || []).filter(
        (c) => c && isLuminarch(c)
      );
      const hasCitadel =
        analysis.fieldSpell?.name?.includes("Citadel") ?? false;

      if (gyLuminarch.length === 0) {
        return { yes: false, reason: "GY vazio (sem alvos)" };
      }

      // COM CITADEL = prioridade altíssima (GY → campo direto)
      if (hasCitadel && analysis.field.length < 5) {
        const plan = getMoonlitTargetPlan(analysis);
        if (!plan.target) {
          return { yes: false, reason: "Sem monstro Luminarch valido na GY" };
        }

        return {
          yes: true,
          priority: plan.purpose === "stabilize" ? 14 : 12,
          reason: `COM CITADEL: recuperar ${plan.target.name} para ${plan.purpose} em ${plan.position}`,
        };
      }

      // SEM CITADEL: ainda útil para mão
      if (gyLuminarch.length >= 2) {
        return {
          yes: true,
          priority: 7,
          reason: `Add da GY para mão (${gyLuminarch.length} opções)`,
        };
      }

      return { yes: false, reason: "Poucas opções na GY ainda" };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // REMOVAL
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Radiant Wave") {
      const luminarch2kPlus = (analysis.field || []).filter(
        (c) =>
          c &&
          isLuminarch(c) &&
          c.cardKind === "monster" &&
          !c.isFacedown &&
          getVisibleAtk(c) >= 2000
      );
      const opponentTargets = (analysis.oppField || []).filter(
        (m) => m && m.cardKind === "monster" && !m.isFacedown
      );

      if (luminarch2kPlus.length > 0 && opponentTargets.length > 0) {
        const bestCost = luminarch2kPlus
          .map((card) => ({
            card,
            score: getRemovalCostScore(card, analysis),
          }))
          .sort((a, b) => a.score - b.score)[0];
        const bestTarget = opponentTargets
          .map((card) => ({
            card,
            score: getRemovalTargetScore(card, analysis),
          }))
          .sort((a, b) => b.score - a.score)[0];
        const oppTotalAtk = opponentTargets.reduce(
          (sum, card) => sum + getVisibleAtk(card),
          0
        );
        const targetAtk = getVisibleAtk(bestTarget?.card);
        const targetName = bestTarget?.card?.name || "opposing threat";
        const costName = bestCost?.card?.name || "Luminarch monster";
        const preventsLethal =
          oppTotalAtk >= (analysis.lp || 8000) && targetAtk >= 1800;
        const removesWinCondition =
          /Extreme Dragon|Bahamut|Galaxy|Malicious|Leviathan|Fire Extreme/i.test(
            targetName
          ) || bestTarget.score >= 9;
        const positiveTrade = bestTarget.score >= bestCost.score + 1.5;

        if (!positiveTrade && !preventsLethal && !removesWinCondition) {
          return {
            yes: false,
            reason: `Radiant Wave held: ${targetName} is not worth ${costName}`,
          };
        }

        return {
          yes: true,
          priority: preventsLethal || removesWinCondition ? 15 : 11,
          reason: `Destroy ${targetName} with preferred cost ${costName}`,
        };
      }

      return {
        yes: false,
        reason: "Sem material 2000+ ATK ou sem ameaças para remover",
      };
    }

    if (name === "Luminarch Spear of Dawnfall") {
      const attackers = getBattleReadyLuminarchAttackers(analysis);
      if (attackers.length === 0) {
        return {
          yes: false,
          reason: "Sem atacante Luminarch apto para aproveitar o debuff",
        };
      }

      const combatTarget = getBestTemporaryCombatDebuffTarget(analysis);
      return combatTarget.target && combatTarget.score > 0
        ? {
            yes: true,
            priority: combatTarget.score >= 100 ? 18 : 11,
            reason: `Spear em ${combatTarget.target.name}: janela real de combate`,
          }
        : {
            yes: false,
            reason: "Spear segurada: nenhum alvo gera ganho real de batalha",
          };

      const hasLuminarch = (analysis.field || []).some(
        (c) => c && isLuminarch(c)
      );
      const oppBiggest = (analysis.oppField || [])
        .filter((m) => m && !m.isFacedown)
        .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
      const oppDefenders = (analysis.oppField || []).filter(
        (m) => m && m.position === "defense"
      );

      // NOVO: Prioridade alta se tem monstros com Piercing e oponente em DEF
      const piercingMonsters = (analysis.field || []).filter(
        (c) => c && c.cardKind === "monster" && !c.isFacedown && c.piercing
      );
      const hasPiercingSetup =
        piercingMonsters.length > 0 && oppDefenders.length > 0;

      if (hasLuminarch && hasPiercingSetup) {
        const totalPiercingAtk = piercingMonsters.reduce(
          (sum, m) => sum + (m.atk || 0),
          0
        );
        const oppLp = analysis.oppLp || 8000;
        const canLethal = totalPiercingAtk >= oppLp;

        return {
          yes: true,
          priority: canLethal ? 18 : 12, // LETHAL = máxima prioridade
          reason: canLethal
            ? `LETHAL! Spear → Zerar DEF → Piercing ${totalPiercingAtk} = WIN`
            : `Piercing setup: zerar DEF de defender → ${piercingMonsters
                .map((m) => m.name?.split(" - ")[0])
                .join(", ")} (${totalPiercingAtk} dmg)`,
        };
      }

      if (hasLuminarch && oppBiggest && (oppBiggest.atk || 0) >= 2000) {
        return {
          yes: true,
          priority: 10,
          reason: `Zerar ${oppBiggest.name} (${oppBiggest.atk} ATK → 0)`,
        };
      }

      return {
        yes: false,
        reason: "Sem Luminarch no campo ou sem alvo forte",
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // BUFF
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Holy Ascension") {
      const lp = analysis.lp || 8000;
      const oppLp = analysis.oppLp || 8000;
      const luminarchMonsters = (analysis.field || []).filter(
        (c) => c && isLuminarch(c) && c.cardKind === "monster" && !c.isFacedown
      );
      const oppMaxAtk = Math.max(
        ...(analysis.oppField || []).map(
          (m) => (m && !m.isFacedown && m.atk) || 0
        ),
        0
      );

      // CRITICAL: Holy Ascension custa 1000 LP - gerenciar budget
      // Só usar se LP alto (custo 1000 LP é pesado)
      if (lp < 4000) {
        return { yes: false, reason: "LP muito baixo (custo 1000 LP)" };
      }

      // Prioridade 1: LETHAL
      // Se pode fechar jogo com buff, SEMPRE usar
      const totalAtk = luminarchMonsters.reduce(
        (sum, m) => sum + (m.atk || 0),
        0
      );
      const buffedAtk = totalAtk + luminarchMonsters.length * 800;
      const directDamage = Math.max(
        buffedAtk -
          oppMaxAtk *
            Math.min(analysis.oppField.length, luminarchMonsters.length),
        0
      );

      if (directDamage >= oppLp) {
        return {
          yes: true,
          priority: 15,
          reason: `LETHAL! ${directDamage} damage = WIN (custo 1000 LP OK)`,
        };
      }

      // Prioridade 2: Fechar gap crítico
      // Se pode ultrapassar wall defensiva forte e tem LP sobrando
      if (lp >= 5000 && luminarchMonsters.length > 0 && oppMaxAtk >= 2500) {
        const wouldWin = luminarchMonsters.some((m) => {
          const boostedAtk = (m.atk || 0) + 800;
          return boostedAtk > oppMaxAtk + 300;
        });

        if (wouldWin) {
          return {
            yes: true,
            priority: 8,
            reason: `Buff para superar wall ${oppMaxAtk} ATK (LP saudável: ${lp})`,
          };
        }
      }

      // Prioridade 3: Setup de comeback
      // Se LP crítico mas pode virar jogo
      if (lp <= 3000 && lp >= 2000 && oppLp <= 3000) {
        const canPush = luminarchMonsters.length >= 2;
        if (canPush) {
          return {
            yes: true,
            priority: 6,
            reason: "ALL-IN: ambos LP baixo, buff para push final",
          };
        }
      }

      return {
        yes: false,
        reason: "Custo alto (1000 LP) - esperar momento melhor",
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // CONTINUOUS / SITUATIONAL
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Knights Convocation") {
      return evaluateKnightsConvocationPlan(analysis);
      const lv7Plus = (analysis.hand || []).filter(
        (c) =>
          c && isLuminarch(c) && c.cardKind === "monster" && (c.level || 0) >= 7
      );

      // NOVO: Detectar situação de BRICK (muitos Lv7+ sem searchers)
      const hasSearcherInHand = (analysis.hand || []).some(
        (c) => c && (c.name?.includes("Valiant") || c.name?.includes("Arbiter"))
      );
      const isBricked = lv7Plus.length >= 2 && !hasSearcherInHand;

      if (isBricked) {
        return {
          yes: true,
          priority: 14, // Alta prioridade - resolver brick é crítico
          reason: `BRICK ESCAPE: ${lv7Plus.length}x Lv7+ na mão sem searchers → discard boss → search Valiant/Arbiter`,
        };
      }

      if (lv7Plus.length > 0) {
        return {
          yes: true,
          priority: 5,
          reason: "Continuous search (discard high-level para buscar Lv4-)",
        };
      }

      return { yes: false, reason: "Sem Lv7+ para discartar" };
    }

    if (name === "Luminarch Sacred Judgment") {
      const myField = analysis.field.length;
      const oppField = (analysis.oppField || []).length;
      const lp = analysis.lp || 8000;
      const oppLp = analysis.oppLp || 8000;

      // Avaliação: qualidade dos monstros no GY
      const gyLuminarch = (analysis.graveyard || []).filter(
        (c) => c && isLuminarch(c) && c.cardKind === "monster"
      );

      const highValueMonsters = gyLuminarch.filter((c) => {
        // Aegisbearer (tank), Protector (DEF high), Aurora (LP gain), Fortress (Ascension boss)
        return (
          c.name?.includes("Aegisbearer") ||
          c.name?.includes("Sanctum Protector") ||
          c.name?.includes("Aurora Seraph") ||
          c.name?.includes("Fortress Aegis") ||
          (c.def && c.def >= 2000) ||
          (c.atk && c.atk >= 2000)
        );
      }).length;

      // === SITUAÇÃO CRÍTICA: Campo vazio + opp domina ===
      // Precisa: campo vazio, opp 2+, LP >= 2500 (sobra 500 após custo), GY com recursos
      if (
        myField === 0 &&
        oppField >= 2 &&
        lp >= 2500 &&
        gyLuminarch.length >= 2
      ) {
        // Calcular power swing potencial
        const potentialSummons = Math.min(gyLuminarch.length, oppField, 5);
        const lpGain = potentialSummons * 500; // heal de volta
        const netLpCost = 2000 - lpGain; // custo real após heal
        const finalLp = lp - netLpCost;

        // Avaliar se é worth it
        const isCritical = oppField >= 3 || oppLp > lp + 2000; // opp domina
        const hasQuality = highValueMonsters >= 1; // pelo menos 1 bom monstro
        const survives = finalLp >= 1000; // sobrevive após custo

        if (isCritical && hasQuality && survives) {
          // Prioridade MUITO ALTA: é carta de comeback
          const priority = oppField >= 4 ? 19 : oppField >= 3 ? 17 : 15;
          return {
            yes: true,
            priority,
            reason: `COMEBACK CRÍTICO: SS ${potentialSummons} monstros (${highValueMonsters} high-value), net cost ${netLpCost} LP, final ${finalLp} LP`,
          };
        }

        if (survives && gyLuminarch.length >= 3) {
          // Situação menos crítica mas ainda válida
          return {
            yes: true,
            priority: 13,
            reason: `Comeback: SS ${potentialSummons} monstros da GY (LP final: ${finalLp})`,
          };
        }
      }

      // Bloquear: não é situação de desperation ou muito arriscado
      if (myField > 0) {
        return { yes: false, reason: "Precisa campo vazio (situação crítica)" };
      }
      if (oppField < 2) {
        return { yes: false, reason: "Opp precisa ter 2+ monstros" };
      }
      if (lp < 2500) {
        return {
          yes: false,
          reason: "LP insuficiente (precisa 2500+ para sobreviver custo)",
        };
      }
      if (gyLuminarch.length < 2) {
        return { yes: false, reason: "GY sem recursos (precisa 2+ Luminarch)" };
      }

      return {
        yes: false,
        reason: "Não justifica risco (falta criticalidade ou qualidade no GY)",
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // FALLBACK GENÉRICO
    // ═════════════════════════════════════════════════════════════════════════

    if (knowledge) {
      return {
        yes: true,
        priority: knowledge.priority || 3,
        reason: `${knowledge.role || "utility"} spell`,
      };
    }

    return { yes: true, priority: 1, reason: "Spell genérica" };
  } catch (e) {
    const errorKey = `spell_${card?.name}_${e.message}`;
    if (!_loggedErrors.has(errorKey)) {
      _loggedErrors.add(errorKey);
      console.error(
        `[shouldPlaySpell] ERRO ao avaliar ${card?.name}:`,
        e.message
      );
    }
    return { yes: false, reason: `Erro interno: ${e.message}` };
  }
}

/**
 * Decide se deve invocar um monstro e em qual posição.
 * @param {Object} card
 * @param {Object} analysis
 * @returns {SummonDecision}
 */
export function shouldSummonMonster(card, analysis) {
  try {
    const name = card.name;
    const knowledge = CARD_KNOWLEDGE[name];

    // Guard: validação de entrada
    if (!card || !name || !analysis) {
      return { yes: false, reason: "Dados inválidos" };
    }

    // Garantir que analysis tem arrays válidos
    analysis.field = Array.isArray(analysis.field) ? analysis.field : [];
    analysis.oppField = Array.isArray(analysis.oppField)
      ? analysis.oppField
      : [];
    analysis.hand = Array.isArray(analysis.hand) ? analysis.hand : [];
    analysis.graveyard = Array.isArray(analysis.graveyard)
      ? analysis.graveyard
      : [];

    if (!knowledge) {
      // Fallback genérico
      const oppStrongest = Math.max(
        ...(analysis.oppField || []).map((m) => (m && m.atk) || 0),
        0
      );
      const isSafe = (card.atk || 0) >= oppStrongest || (card.def || 0) >= 2000;

      return {
        yes: true,
        position: isSafe ? "attack" : "defense",
        priority: 3,
        reason: isSafe ? "Beater genérico" : "Defense genérica",
      };
    }

    const oppStrongest = Math.max(
      ...(analysis.oppField || []).map((m) => (m && m.atk) || 0),
      0
    );

    // ═════════════════════════════════════════════════════════════════════════
    // LUMINARCH STRATEGY: DEFENSIVE CONTROL
    // Early game: Setup defenses (Aegisbearer, Sanctum Protector)
    // Mid game: Accumulate resources (spells, hand advantage)
    // Late game: Push with buffed monsters or Marshal
    // ═════════════════════════════════════════════════════════════════════════

    // Calcular fase do jogo baseado em recursos
    // Early game: campo vazio/1 monstro E poucos recursos usados (graveyard pequeno)
    const gyCount = analysis.graveyard?.length || 0;
    const fieldCount = analysis.field.length;
    const isEarlyGame = fieldCount <= 1 && gyCount <= 2;
    const hasTank = analysis.field.some(
      (c) =>
        c &&
        (c.name === "Luminarch Aegisbearer" ||
          c.name === "Luminarch Sanctum Protector")
    );
    const hasSanctumProtectorInHand = analysis.hand.some(
      (c) => c && c.name === "Luminarch Sanctum Protector"
    );
    const hasFieldSpell = !!analysis.fieldSpell;
    const hasAegisInHand = analysis.hand.some(
      (c) => c && c.name === "Luminarch Aegisbearer"
    );
    const hasProtection = [
      ...(analysis.hand || []),
      ...(analysis.spellTrap || []),
    ].some(
      (c) =>
        c &&
        (c.name === "Luminarch Holy Shield" ||
          c.name === "Luminarch Crescent Shield" ||
          c.name === "Luminarch Moonlit Blessing")
    );
    const oppMonsterCount = (analysis.oppField || []).filter(
      (c) => c && c.cardKind === "monster"
    ).length;
    const underHeavyPressure = oppStrongest >= 2200 || oppMonsterCount >= 2;
    const shouldAvoidExposedSearcher =
      underHeavyPressure && !hasTank && !hasProtection;

    // ═════════════════════════════════════════════════════════════════════════
    // TANKS - PRIORIDADE MÁXIMA NO EARLY GAME
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Aegisbearer") {
      // Aegisbearer é SEMPRE prioridade máxima se não temos tank
      if (!hasTank) {
        const opensProtectorLine = hasSanctumProtectorInHand;
        return {
          yes: true,
          position: opensProtectorLine ? "attack" : "defense",
          priority: 12, // Máxima prioridade
          reason: opensProtectorLine
            ? "Abrir face-up para descer Sanctum Protector imediatamente"
            : "Setup defensivo CRÍTICO - baixar Aegisbearer para sobreviver e virar depois",
        };
      }

      // Verificar se deve ser mantido para Ascension
      const aegisOnField = analysis.field.find(
        (c) => c && c.name === "Luminarch Aegisbearer"
      );
      if (aegisOnField) {
        const fieldAge = aegisOnField.fieldAgeTurns || 0;
        if (fieldAge >= 1) {
          // Já tem um Aegis veterano - não invocar outro (diluir field)
          return {
            yes: false,
            reason: `Aegis no campo (${fieldAge}/2 turnos para Ascension) - preservar field`,
          };
        }
      }

      // Já tem tank, ainda é bom mas menor prioridade
      return {
        yes: true,
        position: "defense",
        priority: 7,
        reason: "Reforço defensivo (já tem tank)",
      };
    }

    if (name === "Luminarch Sanctum Protector") {
      // Sanctum Protector é o tank definitivo - 2800 DEF + negar ataque
      if (!hasTank) {
        return {
          yes: true,
          position: "defense",
          priority: 11,
          reason: "Wall máximo - 2800 DEF + negar ataque",
        };
      }
      // Combo com Aegis: pode usar SS effect
      const hasAegis = analysis.field.some(
        (c) => c && c.name === "Luminarch Aegisbearer"
      );
      if (hasAegis) {
        return {
          yes: true,
          position: "defense",
          priority: 9,
          reason: "SS grátis via Aegis (wall supremo)",
        };
      }
      return {
        yes: true,
        position: "defense",
        priority: 6,
        reason: "Tank extra (já estável)",
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SEARCHERS - CONTEXTUAIS
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Sanctified Arbiter") {
      // ═══════════════════════════════════════════════════════════════════════
      // CRÍTICO: Arbiter DEVE ser invocado face-UP (attack) para ativar busca!
      // Face-down = sem trigger = valor perdido. O search vale mais que DEF.
      // ═══════════════════════════════════════════════════════════════════════

      // Arbiter busca SPELL/TRAP - priorizar se não temos field spell
      if (!hasFieldSpell) {
        if (
          shouldAvoidExposedSearcher &&
          (hasAegisInHand || hasSanctumProtectorInHand || oppStrongest >= 2400)
        ) {
          return {
            yes: false,
            reason:
              "Board inimigo forte: priorizar tank/protecao antes de expor Arbiter",
          };
        }
        return {
          yes: true,
          position: "attack", // SEMPRE attack para buscar!
          priority: shouldAvoidExposedSearcher ? 4 : 10,
          reason:
            "Buscar Sanctum Citadel (field spell core!) - FACE-UP para trigger",
        };
      }
      // Já tem field spell - buscar proteção se não temos
      const hasProtectionInHand = (analysis.hand || []).some(
        (c) =>
          c &&
          (c.name === "Luminarch Holy Shield" ||
            c.name === "Luminarch Crescent Shield")
      );
      if (!hasProtectionInHand) {
        if (
          shouldAvoidExposedSearcher &&
          (hasAegisInHand || hasSanctumProtectorInHand)
        ) {
          return {
            yes: false,
            reason:
              "Board inimigo forte: proteger campo antes de buscar utility com Arbiter",
          };
        }
        return {
          yes: true,
          position: "attack", // SEMPRE attack para buscar!
          priority: shouldAvoidExposedSearcher ? 3 : 7,
          reason: "Buscar spell de proteção - FACE-UP para trigger",
        };
      }
      // Low priority se já temos setup (mas ainda busca algo útil)
      return {
        yes: true,
        position: "attack", // SEMPRE attack para buscar!
        priority: 4,
        reason: "Buscar spell utility",
      };
    }

    if (name === "Luminarch Valiant - Knight of the Dawn") {
      // Valiant busca MONSTRO Lv4- (geralmente Aegisbearer ou Arbiter)

      // CRITICAL: Se não temos field spell E não temos Arbiter na mão,
      // preferir invocar Arbiter primeiro (se tiver) ou aceitar Valiant como plano B
      const currentTurn = analysis.currentTurn || 1;
      const isVeryEarly = currentTurn <= 2;

      if (!hasFieldSpell && isVeryEarly) {
        const hasArbiterInHand = (analysis.hand || []).some(
          (c) => c && c.name === "Luminarch Sanctified Arbiter"
        );

        // Se temos Arbiter na mão, preferir invocar ele ao invés de Valiant
        if (hasArbiterInHand) {
          return {
            yes: false,
            reason:
              "T1-2: Tenho Arbiter na mão - invocar ele primeiro (busca field spell)",
          };
        }

        // Se não temos Arbiter nem Citadel, invocar Valiant é aceitável
        // (buscar Aegisbearer é melhor que passar o turno sem fazer nada)
      }

      // Se não temos tank, Valiant pode buscar Aegisbearer
      // ═══════════════════════════════════════════════════════════════════════
      // CRÍTICO: Valiant DEVE ser invocado face-UP (attack) para ativar busca!
      // Face-down = sem trigger = valor perdido. O search vale mais que DEF.
      // ═══════════════════════════════════════════════════════════════════════
      if (!hasTank && isEarlyGame) {
        const hasAegisInHand = (analysis.hand || []).some(
          (c) => c && c.name === "Luminarch Aegisbearer"
        );
        if (hasAegisInHand) {
          // Já temos Aegis na mão, não precisamos de Valiant
          return {
            yes: false,
            reason: "Já tenho Aegisbearer na mão - invocar ele primeiro",
          };
        }
        // Não temos Aegis - Valiant busca - SEMPRE attack para trigger!
        return {
          yes: true,
          position: "attack", // SEMPRE attack para buscar!
          priority: shouldAvoidExposedSearcher ? 3 : 7,
          reason: shouldAvoidExposedSearcher
            ? "Buscar Aegisbearer, mas com risco alto de expor Valiant"
            : "Buscar Aegisbearer (setup) - FACE-UP para trigger",
        };
      }

      // Mid/late game: Valiant é bom para manter recursos
      if (hasTank) {
        return {
          yes: true,
          position: "attack",
          priority: 5,
          reason: "Buscar monstro (já estável)",
        };
      }

      // Fallback: ainda busca algo útil
      return {
        yes: true,
        position: "attack", // SEMPRE attack para buscar!
        priority: 4,
        reason: "Searcher conservador",
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // BEATERS - SÓ QUANDO SEGURO
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Celestial Marshal") {
      // Marshal é 2500 ATK / 2300 DEF com proteção de batalha
      const isSafeAttack = (card.atk || 2500) > oppStrongest + 100;
      const isSafeDefense = (card.def || 2300) >= oppStrongest - 200;

      // CRITICAL: Se opp tem ameaças fortes e não temos defesa, não suicide
      if (oppStrongest >= 2600 && !hasTank) {
        return {
          yes: false,
          reason: `Oponente tem ${oppStrongest} ATK - preciso de tank primeiro`,
        };
      }

      return {
        yes: true,
        position: isSafeAttack ? "attack" : "defense",
        priority: isSafeAttack ? 7 : 5,
        reason: isSafeAttack
          ? "Boss beater 2500 ATK (seguro)"
          : "Defense até limpar board",
      };
    }

    if (name === "Luminarch Radiant Lancer") {
      const lancerPlan = evaluateRadiantLancerBattlePlan(card, analysis);
      const lancerAtk = getVisibleAtk(card) || card.atk || 2600;
      const oppStrongestBattleStat = Math.max(
        ...(analysis.oppField || []).map((monster) =>
          getBattleStatForTarget(monster)
        ),
        0,
      );
      const isSafeAttacker = lancerAtk > oppStrongestBattleStat;
      const hasDefensiveField = analysis.field.some(
        (c) => c && c.cardKind === "monster" && isDefensiveLuminarch(c)
      );

      if (lancerPlan.hasLine && lancerPlan.improvesThreatMatchup) {
        const priority = lancerPlan.survivesNextThreat
          ? 8
          : lancerPlan.tradesNextThreat
            ? 7
            : 6;
        return {
          yes: true,
          position: "attack",
          priority,
          reason: lancerPlan.reason,
          lancerPlan,
        };
      }

      if (isSafeAttacker) {
        return {
          yes: true,
          position: "attack",
          priority: 5,
          reason: "Radiant Lancer can attack over current visible threats",
          lancerPlan,
        };
      }

      if (hasDefensiveField) {
        return {
          yes: false,
          reason: "Hold Radiant Lancer: defensive field is better than a no-payoff summon",
          lancerPlan,
        };
      }

      if (fieldCount === 0 && oppStrongestBattleStat > 0) {
        return {
          yes: true,
          position: "defense",
          priority: 2,
          reason: "Emergency body only: no defensive field available",
          lancerPlan,
        };
      }

      return {
        yes: false,
        reason: "Hold Radiant Lancer until it has a real offensive line",
        lancerPlan,
      };
    }

    if (name === "Luminarch Aurora Seraph") {
      // Seraph é 2800 ATK / 2400 DEF + heal on summon
      const isSafe = (card.atk || 2800) > oppStrongest + 100;
      return {
        yes: true,
        position: isSafe ? "attack" : "defense",
        priority: isSafe ? 7 : 5,
        reason: isSafe
          ? "Boss 2800 ATK + lifegain"
          : "Defense (2400 DEF sólido)",
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // UTILITY
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Moonblade Captain") {
      const gyHasTargets = (analysis.graveyard || []).some(
        (c) =>
          c && isLuminarch(c) && c.cardKind === "monster" && (c.level || 0) <= 4
      );

      if (gyHasTargets) {
        return {
          yes: true,
          position: "attack",
          priority: 7,
          reason: "Revive Lv4- da GY + duplo ataque potencial",
        };
      }

      return {
        yes: true,
        position: "attack",
        priority: 4,
        reason: "Beater 2200 ATK",
      };
    }

    if (name === "Luminarch Magic Sickle") {
      const gyHasLuminarch = (analysis.graveyard || []).some(
        (c) => c && isLuminarch(c)
      );
      if (gyHasLuminarch) {
        return {
          yes: true,
          position: "defense",
          priority: 6,
          reason: "Recursion engine (enviar → add 2 da GY)",
        };
      }
      return {
        yes: false,
        reason: "GY sem alvos ainda",
      };
    }

    if (name === "Luminarch Enchanted Halberd") {
      // Extender - geralmente vem via efeito próprio
      return {
        yes: true,
        position: "defense",
        priority: 5,
        reason: "Extender defensivo",
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // FALLBACK
    // ═════════════════════════════════════════════════════════════════════════

    // EMERGENCY FALLBACK: Campo vazio T1-2 e monstro Lv4- = SEMPRE summon em DEF
    // Previne situação onde bot tem monstros na mão mas gera 0 actions
    const currentTurn = analysis.currentTurn || 1;
    const isVeryEarly = currentTurn <= 2;
    const isLowLevel = (card.level || 0) <= 4;

    if (analysis.field.length === 0 && isVeryEarly && isLowLevel) {
      return {
        yes: true,
        position: "defense",
        priority: 9,
        reason:
          "EMERGENCY T1-2: Campo vazio + Lv4- = summon em DEF (melhor que passar turno vazio)",
      };
    }

    // EMERGENCY FALLBACK geral: Campo vazio = SEMPRE summon
    if (analysis.field.length === 0 && isLowLevel) {
      return {
        yes: true,
        position: "defense",
        priority: 8,
        reason: "EMERGENCY: Campo vazio, summon para não passar turno vazio",
      };
    }

    return {
      yes: true,
      position: (card.def || 0) >= (card.atk || 0) ? "defense" : "attack",
      priority: knowledge.priority || 3,
      reason: knowledge.effect || "Monstro genérico",
    };
  } catch (e) {
    const errorKey = `monster_${card?.name}_${e.message}`;
    if (!_loggedErrors.has(errorKey)) {
      _loggedErrors.add(errorKey);
      console.error(
        `[shouldSummonMonster] ERRO ao avaliar ${card?.name}:`,
        e.message
      );
    }
    return { yes: false, reason: `Erro interno: ${e.message}` };
  }
}

