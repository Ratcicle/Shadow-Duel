import {
  estimateTemporaryCombatDebuffTargetValue,
  isBattleReadyAttacker,
} from "../StrategyUtils.js";
import {
  evaluateLuminarchDefensePlan,
  getMoonlitTargetPlan,
} from "./priorities.js";
import { isLuminarch } from "./knowledge.js";
import {
  LUMINARCH_DEFENSIVE_NAMES,
  LUMINARCH_OFFENSIVE_NAMES,
} from "./tributePolicy.js";

export function buildLuminarchActivationContext() {
  return {
    autoSelectSingleTarget: true,
    logTargets: false,
    actionContext: {
      costPreferences: {
        archetype: "Luminarch",
        preferNames: [
          "Luminarch Enchanted Halberd",
          "Luminarch Magic Sickle",
          "Luminarch Valiant - Knight of the Dawn",
          "Luminarch Sanctified Arbiter",
        ],
        preserveNames: [
          "Luminarch Aegisbearer",
          "Luminarch Sanctum Protector",
          "Luminarch Fortress Aegis",
          "Luminarch Celestial Marshal",
          "Luminarch Moonblade Captain",
          "Luminarch Aurora Seraph",
          "Luminarch Radiant Lancer",
          "Luminarch Megashield Barbarias",
        ],
      },
    },
  };
}

function getBattleReadyLuminarchAttackers(cards) {
  return (cards || []).filter((card) =>
    isBattleReadyAttacker(card, { archetype: "Luminarch" })
  );
}

function getBestSpearTargetScore(analysis) {
  const attackers = getBattleReadyLuminarchAttackers(analysis.field);
  return (analysis.oppField || []).reduce(
    (best, target) => {
      const score = estimateTemporaryCombatDebuffTargetValue(target, {
        attackers,
        opponentLp: analysis.oppLp || 0,
      });
      return score > best.score ? { target, score } : best;
    },
    { target: null, score: 0 },
  );
}

function getMoonlitPurpose(analysis) {
  const oppMonsters = (analysis.oppField || []).filter(
    (card) => card && card.cardKind === "monster",
  );
  const oppStrongest = oppMonsters.reduce(
    (max, card) => Math.max(max, card?.isFacedown ? 1500 : card?.atk || 0),
    0,
  );
  const oppTotalAtk = oppMonsters.reduce(
    (sum, card) => sum + (card?.isFacedown ? 1500 : card?.atk || 0),
    0,
  );
  const hasStableTank = (analysis.field || []).some(
    (card) =>
      card &&
      isLuminarch(card) &&
      !card.isFacedown &&
      (LUMINARCH_DEFENSIVE_NAMES.includes(card.name) ||
        (card.def || 0) + (card.tempDefBoost || 0) >= oppStrongest),
  );
  if (
    (analysis.lp || 8000) <= 3500 ||
    oppTotalAtk >= (analysis.lp || 8000) ||
    (oppStrongest >= 2200 && !hasStableTank)
  ) {
    return "stabilize";
  }
  if ((analysis.oppLp || 8000) <= 3000 || getBestSpearTargetScore(analysis).score > 0) {
    return "pressure";
  }
  return "value";
}

export function buildLuminarchSpellActionContext(
  card,
  analysis,
  baseActionContext = {},
) {
  const actionContext = { ...(baseActionContext || {}) };

  if (card?.name === "Luminarch Spear of Dawnfall") {
    const attackers = getBattleReadyLuminarchAttackers(analysis.field);
    actionContext.targetPreferences = {
      ...(actionContext.targetPreferences || {}),
      spear_zero_target: {
        role: "temporary_stat_debuff",
        purpose: "combat",
        attackers,
        opponentLp: analysis.oppLp || 0,
      },
    };
  }

  if (card?.name === "Luminarch Moonlit Blessing") {
    const plan = getMoonlitTargetPlan(analysis);
    const purpose = plan?.purpose || getMoonlitPurpose(analysis);
    const byName = {};
    (plan?.candidatePlans || [])
      .filter((entry) => entry?.target?.name)
      .forEach((entry) => {
        byName[entry.target.name] = entry.position || "attack";
      });
    actionContext.targetPreferences = {
      ...(actionContext.targetPreferences || {}),
      moonlit_blessing_target: {
        role: "recursion",
        purpose,
        preferredNames: plan?.target?.name ? [plan.target.name] : [],
        defensiveNames: LUMINARCH_DEFENSIVE_NAMES,
        offensiveNames: LUMINARCH_OFFENSIVE_NAMES,
      },
    };
    actionContext.specialSummonPositions = {
      ...(actionContext.specialSummonPositions || {}),
      byName,
    };
  }

  if (card?.name === "Polymerization") {
    actionContext.fusionPositions = {
      ...(actionContext.fusionPositions || {}),
      byName: {
        ...(actionContext.fusionPositions?.byName || {}),
        "Luminarch Megashield Barbarias": "defense",
      },
    };
  }

  if (card?.name === "Luminarch Knights Convocation") {
    const defensePlan = evaluateLuminarchDefensePlan(analysis);
    actionContext.costPreferences = {
      ...(actionContext.costPreferences || {}),
      archetype: "Luminarch",
      preserveLastOffensivePayoff: true,
      offensivePayoffNames: LUMINARCH_OFFENSIVE_NAMES,
      preserveNames: [
        ...new Set([
          ...((actionContext.costPreferences || {}).preserveNames || []),
          "Luminarch Aegisbearer",
          "Luminarch Sanctum Protector",
          "Luminarch Fortress Aegis",
          "Luminarch Celestial Marshal",
          "Luminarch Moonblade Captain",
          "Luminarch Radiant Lancer",
          "Luminarch Aurora Seraph",
          "Luminarch Megashield Barbarias",
        ]),
      ],
      stableDefense: defensePlan.stable,
      readyToCounterattack: defensePlan.readyToCounterattack,
      availableOffensivePayoffs:
        defensePlan.offensivePayoffsAvailable?.length || 0,
    };
  }

  return actionContext;
}
