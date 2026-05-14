import {
  getEffectiveAtk,
  getEffectiveDef,
  getTotalAttackThreat,
  getVisibleAtk,
  getVisibleDef,
} from "../common/cardStats.js";
import { estimateCardValue } from "../StrategyUtils.js";
import { evaluateCardExpendability } from "./cardValue.js";
import { evaluateLuminarchDefensePlan } from "./defensePlanning.js";
import { isLuminarch } from "./knowledge.js";
import {
  getBattleReadyLuminarchAttackers,
  getBestTemporaryCombatDebuffTarget,
  LUMINARCH_CORE_DEFENDERS,
  LUMINARCH_COUNTERATTACK_PAYOFFS,
} from "./priorityShared.js";

const HOLY_SHIELD = "Luminarch Holy Shield";
const CRESCENT_SHIELD = "Luminarch Crescent Shield";
const RADIANT_WAVE = "Luminarch Radiant Wave";
const SPEAR = "Luminarch Spear of Dawnfall";

const PROTECTED_COST_NAMES = new Set([
  "Luminarch Aegisbearer",
  "Luminarch Sanctum Protector",
  "Luminarch Fortress Aegis",
  "Luminarch Aurora Seraph",
  "Luminarch Megashield Barbarias",
]);

function cardsIn(analysis = {}, zone) {
  return Array.isArray(analysis?.[zone]) ? analysis[zone] : [];
}

function getFaceupLuminarchMonsters(analysis = {}) {
  return cardsIn(analysis, "field").filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      isLuminarch(card) &&
      !card.isFacedown,
  );
}

function getOpponentMonsters(analysis = {}, { requireFaceup = false } = {}) {
  return cardsIn(analysis, "oppField").filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      (!requireFaceup || !card.isFacedown),
  );
}

function uniqueNames(names = []) {
  return [...new Set((names || []).filter(Boolean))];
}

function hasSetHolyShield(analysis = {}) {
  return cardsIn(analysis, "spellTrap").some(
    (card) => card && card.name === HOLY_SHIELD && card.isFacedown,
  );
}

function getPressureProfile(analysis = {}) {
  const opponentMonsters = getOpponentMonsters(analysis);
  const oppTotalAtk = getTotalAttackThreat(opponentMonsters, {
    facedownValue: 1500,
    includeBoosts: false,
  });
  const lp = analysis.lp || 8000;
  const threateningMonsters = opponentMonsters.filter(
    (monster) => monster && !monster.isFacedown && (monster.atk || 0) >= 1800,
  );
  return {
    opponentMonsters,
    oppTotalAtk,
    threateningCount: threateningMonsters.length,
    lpCritical: lp <= 2000,
    lethalPressure: oppTotalAtk >= lp && opponentMonsters.length > 0,
    multipleThreats: threateningMonsters.length >= 2,
  };
}

function getProtectionTargetScore(card, analysis = {}) {
  if (!card) return -100;
  const defensePlan =
    analysis.luminarchDefensePlan || evaluateLuminarchDefensePlan(analysis);
  let score = estimateCardValue(card, {
    archetype: "Luminarch",
    fieldSpell: analysis.fieldSpell || null,
    preferDefense: true,
  });

  if (LUMINARCH_CORE_DEFENDERS.includes(card.name)) score += 8;
  if (LUMINARCH_COUNTERATTACK_PAYOFFS.includes(card.name)) score += 4;
  if (card.mustBeAttacked) score += 4;
  if (getEffectiveDef(card) >= defensePlan.oppStrongest) score += 2;
  if (getEffectiveDef(card) >= 2500) score += 2;
  if (card.name === "Luminarch Aegisbearer") score += 2;
  if (card.name === "Luminarch Sanctum Protector") score += 3;
  if (card.name === "Luminarch Fortress Aegis") score += 4;
  if (card.name === "Luminarch Megashield Barbarias") score += 3;
  return score;
}

export function getLuminarchProtectionTargetNames(analysis = {}, count = 3) {
  return getFaceupLuminarchMonsters(analysis)
    .map((card) => ({ card, score: getProtectionTargetScore(card, analysis) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((entry) => entry.card.name);
}

export function evaluateLuminarchHolyShieldPolicy(analysis = {}) {
  const targets = getFaceupLuminarchMonsters(analysis);
  if (targets.length === 0) {
    return {
      canUse: false,
      shouldActivateNow: false,
      shouldSet: true,
      priority: 3,
      setPriority: 2,
      targetNames: [],
      reason: "Sem monstros Luminarch face-up para proteger agora",
    };
  }

  const pressure = getPressureProfile(analysis);
  const targetNames = getLuminarchProtectionTargetNames(analysis);
  const urgent =
    (pressure.lpCritical && pressure.multipleThreats && targets.length >= 2) ||
    (pressure.lethalPressure && targets.length >= 1);
  const alreadySet = hasSetHolyShield(analysis);

  return {
    canUse: true,
    shouldActivateNow: urgent,
    shouldSet: !alreadySet || urgent,
    priority: urgent ? 16 : 0,
    setPriority: urgent ? 14 : pressure.multipleThreats ? 9 : 6,
    targetNames,
    reason: urgent
      ? `Protecao urgente contra ${pressure.threateningCount || pressure.opponentMonsters.length} ameacas`
      : "Quick Spell: preservar para janela reativa do oponente",
  };
}

export function evaluateLuminarchCrescentShieldPolicy(analysis = {}) {
  const targets = getFaceupLuminarchMonsters(analysis).filter((card) => {
    return !cardsIn(analysis, "spellTrap").some(
      (equip) => equip && equip.name === CRESCENT_SHIELD && equip.equippedTo === card.id,
    );
  });
  if (targets.length === 0) {
    return {
      yes: false,
      priority: 0,
      target: null,
      targetNames: [],
      reason: "Sem monstro Luminarch face-up para equipar",
    };
  }

  const defensePlan =
    analysis.luminarchDefensePlan || evaluateLuminarchDefensePlan(analysis);
  const best = targets
    .map((card) => ({
      card,
      score:
        getProtectionTargetScore(card, analysis) +
        (getEffectiveDef(card) + 500 >= defensePlan.oppStrongest ? 3 : 0),
    }))
    .sort((a, b) => b.score - a.score)[0];

  const target = best?.card || targets[0];
  const targetNames = uniqueNames([
    target?.name,
    ...targets
      .map((card) => ({ card, score: getProtectionTargetScore(card, analysis) }))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.card.name),
  ]);
  const priority =
    target?.name === "Luminarch Aegisbearer"
      ? 8
      : target?.name === "Luminarch Sanctum Protector"
        ? 7
        : LUMINARCH_CORE_DEFENDERS.includes(target?.name)
          ? 7
          : 5;

  return {
    yes: true,
    priority: priority + (defensePlan.clearLethalRisk ? 2 : 0),
    target,
    targetNames,
    reason: `Equipar ${target.name} (${getEffectiveDef(target) + 500} DEF projetada)`,
  };
}

function isProtectedLuminarchCost(card) {
  if (!card) return false;
  if (PROTECTED_COST_NAMES.has(card.name)) return true;
  return (
    card.name === "Luminarch Radiant Lancer" &&
    (getEffectiveAtk(card) > 2200 || card.hasAttacked)
  );
}

export function getLuminarchRemovalCostScore(card, analysis = {}) {
  const expendability = evaluateCardExpendability(card, {
    hand: cardsIn(analysis, "hand"),
    field: cardsIn(analysis, "field"),
    graveyard: cardsIn(analysis, "graveyard"),
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

export function getLuminarchRemovalTargetScore(card, analysis = {}) {
  if (!card) return 0;
  if (card.cardKind !== "monster") {
    let score = estimateCardValue(card, {
      archetype: card.archetype,
      fieldSpell: analysis.oppFieldSpell || null,
    });
    if (card.subtype === "field" || card === analysis.oppFieldSpell) score += 4;
    if (/Cathedral|Valley|Citadel|The Shadow Heart|The Void/i.test(card.name || "")) {
      score += 3;
    }
    return score;
  }

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

  const oppTotalAtk = getTotalAttackThreat(cardsIn(analysis, "oppField"), {
    includeFacedown: false,
  });
  if (oppTotalAtk >= (analysis.lp || 8000) && atk >= 2000) score += 2;
  return score;
}

function getRadiantWaveCosts(analysis = {}) {
  return getFaceupLuminarchMonsters(analysis).filter(
    (card) => getVisibleAtk(card) >= 2000,
  );
}

function getRadiantWaveTargets(analysis = {}) {
  return [
    ...getOpponentMonsters(analysis, { requireFaceup: true }),
    ...cardsIn(analysis, "oppSpellTrap"),
    analysis.oppFieldSpell,
  ].filter(Boolean);
}

export function evaluateLuminarchRadiantWavePolicy(analysis = {}) {
  const costs = getRadiantWaveCosts(analysis);
  const targets = getRadiantWaveTargets(analysis);
  if (costs.length === 0 || targets.length === 0) {
    return {
      yes: false,
      priority: 0,
      bestCost: null,
      bestTarget: null,
      reason: "Sem material 2000+ ATK ou sem alvo relevante para remover",
    };
  }

  const bestCost = costs
    .map((card) => ({ card, score: getLuminarchRemovalCostScore(card, analysis) }))
    .sort((a, b) => a.score - b.score)[0];
  const bestTarget = targets
    .map((card) => ({ card, score: getLuminarchRemovalTargetScore(card, analysis) }))
    .sort((a, b) => b.score - a.score)[0];

  const targetAtk = bestTarget?.card?.cardKind === "monster"
    ? getVisibleAtk(bestTarget.card)
    : 0;
  const oppTotalAtk = getTotalAttackThreat(getOpponentMonsters(analysis), {
    includeFacedown: false,
  });
  const preventsLethal = oppTotalAtk >= (analysis.lp || 8000) && targetAtk >= 1800;
  const targetName = bestTarget?.card?.name || "opposing threat";
  const costName = bestCost?.card?.name || "Luminarch monster";
  const removesWinCondition =
    /Extreme Dragon|Bahamut|Galaxy|Malicious|Leviathan|Fire Extreme/i.test(
      targetName,
    ) || bestTarget.score >= 9;
  const positiveTrade = bestTarget.score >= bestCost.score + 1.5;

  if (!positiveTrade && !preventsLethal && !removesWinCondition) {
    return {
      yes: false,
      priority: 0,
      bestCost: bestCost?.card || null,
      bestTarget: bestTarget?.card || null,
      reason: `Radiant Wave held: ${targetName} is not worth ${costName}`,
    };
  }

  return {
    yes: true,
    priority: preventsLethal || removesWinCondition ? 15 : 11,
    bestCost: bestCost?.card || null,
    bestTarget: bestTarget?.card || null,
    reason: `Destroy ${targetName} with preferred cost ${costName}`,
  };
}

export function evaluateLuminarchSpearPolicy(analysis = {}) {
  const attackers = getBattleReadyLuminarchAttackers(analysis);
  if (attackers.length === 0) {
    return {
      yes: false,
      priority: 0,
      bestTarget: null,
      reason: "Sem atacante Luminarch apto para aproveitar o debuff",
    };
  }

  const combatTarget = getBestTemporaryCombatDebuffTarget(analysis);
  return combatTarget.target && combatTarget.score > 0
    ? {
        yes: true,
        priority: combatTarget.score >= 100 ? 18 : 11,
        bestTarget: combatTarget.target,
        reason: `Spear em ${combatTarget.target.name}: janela real de combate`,
      }
    : {
        yes: false,
        priority: 0,
        bestTarget: null,
        reason: "Spear segurada: nenhum alvo gera ganho real de batalha",
      };
}

export function evaluateLuminarchProtectionSpell(card, analysis = {}) {
  if (card?.name === HOLY_SHIELD) {
    const policy = evaluateLuminarchHolyShieldPolicy(analysis);
    if (!policy.canUse) {
      return { yes: false, reason: policy.reason };
    }
    if (policy.shouldActivateNow) {
      return {
        yes: true,
        priority: policy.priority,
        reason: policy.reason,
      };
    }
    return {
      yes: false,
      reason: policy.reason,
    };
  }

  if (card?.name === CRESCENT_SHIELD) {
    const policy = evaluateLuminarchCrescentShieldPolicy(analysis);
    return {
      yes: policy.yes,
      priority: policy.priority,
      reason: policy.reason,
    };
  }

  return null;
}

export function evaluateLuminarchRemovalSpell(card, analysis = {}) {
  if (card?.name === RADIANT_WAVE) {
    const policy = evaluateLuminarchRadiantWavePolicy(analysis);
    return {
      yes: policy.yes,
      priority: policy.priority,
      reason: policy.reason,
    };
  }
  if (card?.name === SPEAR) {
    const policy = evaluateLuminarchSpearPolicy(analysis);
    return {
      yes: policy.yes,
      priority: policy.priority,
      reason: policy.reason,
    };
  }
  return null;
}

export function evaluateLuminarchBackrowSetPolicy(card, analysis = {}) {
  if (card?.name === HOLY_SHIELD) {
    const policy = evaluateLuminarchHolyShieldPolicy(analysis);
    return {
      shouldSet: policy.shouldSet,
      priority: policy.setPriority,
      reason: policy.reason,
    };
  }
  if (card?.cardKind === "trap") {
    const pressure = getPressureProfile(analysis);
    return {
      shouldSet: true,
      priority: pressure.lethalPressure ? 7 : 3,
      reason: "setup_reactive_backrow",
    };
  }
  if (card?.subtype === "quick") {
    return {
      shouldSet: true,
      priority: 2,
      reason: "setup_quick_spell",
    };
  }
  return null;
}

export function applyLuminarchDefenseActionContext(
  actionContext = {},
  card,
  analysis = {},
) {
  const next = { ...(actionContext || {}) };
  const targetPreferences = { ...(next.targetPreferences || {}) };

  if (card?.name === HOLY_SHIELD) {
    targetPreferences.holy_shield_targets = {
      role: "named_preference",
      preferredNames: getLuminarchProtectionTargetNames(analysis),
    };
  }

  if (card?.name === CRESCENT_SHIELD) {
    const shieldPlan = evaluateLuminarchCrescentShieldPolicy(analysis);
    targetPreferences.crescent_shield_target = {
      role: "named_preference",
      preferredNames: shieldPlan.targetNames || [],
    };
  }

  if (card?.name === RADIANT_WAVE) {
    const removalPlan = evaluateLuminarchRadiantWavePolicy(analysis);
    targetPreferences.radiant_wave_destroy = {
      role: "removal",
      preferredNames: removalPlan.bestTarget?.name
        ? [removalPlan.bestTarget.name]
        : [],
    };
    if (removalPlan.bestCost?.name) {
      const existing = next.costPreferences || {};
      next.costPreferences = {
        ...existing,
        preferNames: uniqueNames([
          ...(existing.preferNames || []),
          removalPlan.bestCost.name,
        ]),
        preserveNames: uniqueNames([
          ...(existing.preserveNames || []),
          ...PROTECTED_COST_NAMES,
        ]),
      };
    }
  }

  if (card?.name === SPEAR) {
    const attackers = getBattleReadyLuminarchAttackers(analysis);
    targetPreferences.spear_zero_target = {
      role: "temporary_stat_debuff",
      purpose: "combat",
      attackers,
      opponentLp: analysis.oppLp || 0,
    };
  }

  if (Object.keys(targetPreferences).length > 0) {
    next.targetPreferences = targetPreferences;
  }
  return next;
}
