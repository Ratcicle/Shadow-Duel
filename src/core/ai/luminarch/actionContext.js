import {
  estimateOffensiveTemporaryBuffValue,
  estimateTemporaryCombatDebuffTargetValue,
  isBattleReadyAttacker,
} from "../StrategyUtils.js";
import {
  getStrongestAttackThreat,
  getTotalAttackThreat,
} from "../common/cardStats.js";
import {
  buildActivationContext,
  buildCostPreferences,
  buildTargetPreferences,
} from "../common/preferencePolicy.js";
import {
  evaluateLuminarchDefensePlan,
  getMoonlitTargetPlan,
} from "./priorities.js";
import { isLuminarch } from "./knowledge.js";
import {
  LUMINARCH_DEFENSIVE_NAMES,
  LUMINARCH_OFFENSIVE_NAMES,
} from "./tributePolicy.js";
import { buildLuminarchResourcePreferences } from "./resourceEconomy.js";
import { applyLuminarchDefenseActionContext } from "./defensePolicy.js";

const LUMINARCH_COST_PREFER_NAMES = [
  "Luminarch Enchanted Halberd",
  "Luminarch Magic Sickle",
  "Luminarch Valiant - Knight of the Dawn",
  "Luminarch Sanctified Arbiter",
];

const LUMINARCH_COST_PRESERVE_NAMES = [
  "Luminarch Aegisbearer",
  "Luminarch Sanctum Protector",
  "Luminarch Fortress Aegis",
  "Luminarch Celestial Marshal",
  "Luminarch Moonblade Captain",
  "Luminarch Aurora Seraph",
  "Luminarch Radiant Lancer",
  "Luminarch Megashield Barbarias",
];

export function buildLuminarchCostPreferences({
  analysis = {},
  preferNames = LUMINARCH_COST_PREFER_NAMES,
  preserveNames = LUMINARCH_COST_PRESERVE_NAMES,
  offensivePayoffNames = [],
  preserveLastOffensivePayoff = true,
  availableOffensivePayoffs,
  extra = {},
} = {}) {
  const resourcePreferences = buildLuminarchResourcePreferences(analysis);
  const mergedPreferNames = [
    ...new Set([
      ...(preferNames || []),
      ...(resourcePreferences.preferNames || []),
    ]),
  ];
  const mergedPreserveNames = [
    ...new Set([
      ...(preserveNames || []),
      ...(resourcePreferences.preserveNames || []),
    ]),
  ];

  return buildCostPreferences({
    archetype: "Luminarch",
    hand: analysis.hand || [],
    field: analysis.field || [],
    preferNames: mergedPreferNames,
    preserveNames: mergedPreserveNames,
    offensivePayoffNames,
    preserveLastOffensivePayoff,
    availableOffensivePayoffs,
    extra: {
      ...extra,
      resourceEconomy: resourcePreferences.resourceEconomy,
      resourcePressure: resourcePreferences.resourcePressure,
    },
  });
}

export function buildLuminarchActivationContext() {
  return buildActivationContext({
    costPreferences: buildLuminarchCostPreferences(),
    autoSelectSingleTarget: true,
    includeAutoSelectTargets: false,
    logTargets: false,
  });
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

function mergeTargetPreferences(actionContext, targetProfiles) {
  const targetPreferences = buildTargetPreferences({
    costPreferences: actionContext.costPreferences,
    targetProfiles,
  });
  if (Object.keys(targetPreferences).length === 0) return;
  actionContext.targetPreferences = {
    ...(actionContext.targetPreferences || {}),
    ...targetPreferences,
  };
}

function getMoonlitPurpose(analysis) {
  const oppMonsters = (analysis.oppField || []).filter(
    (card) => card && card.cardKind === "monster",
  );
  const oppStrongest = getStrongestAttackThreat(oppMonsters, {
    facedownValue: 1500,
    includeBoosts: false,
  });
  const oppTotalAtk = getTotalAttackThreat(oppMonsters, {
    facedownValue: 1500,
    includeBoosts: false,
  });
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
  let actionContext = { ...(baseActionContext || {}) };
  actionContext = applyLuminarchDefenseActionContext(
    actionContext,
    card,
    analysis,
  );

  if (card?.name === "Luminarch Spear of Dawnfall") {
    const attackers = getBattleReadyLuminarchAttackers(analysis.field);
    mergeTargetPreferences(actionContext, {
      spear_zero_target: {
        role: "temporary_stat_debuff",
        purpose: "combat",
        attackers,
        opponentLp: analysis.oppLp || 0,
      },
    });
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
    mergeTargetPreferences(actionContext, {
      moonlit_blessing_target: {
        role: "recursion",
        purpose,
        preferredNames: plan?.target?.name ? [plan.target.name] : [],
        defensiveNames: LUMINARCH_DEFENSIVE_NAMES,
        offensiveNames: LUMINARCH_OFFENSIVE_NAMES,
      },
    });
    actionContext.specialSummonPositions = {
      ...(actionContext.specialSummonPositions || {}),
      byName,
    };
  }

  if (card?.name === "Luminarch Holy Ascension") {
    const attackers = getBattleReadyLuminarchAttackers(analysis.field);
    const preferredNames = attackers
      .map((attacker) => ({
        attacker,
        score: estimateOffensiveTemporaryBuffValue(attacker, {
          atkBoost: 800,
          opponentField: analysis.oppField || [],
          opponentLp: analysis.oppLp || 0,
        }),
      }))
      .filter((entry) => entry.score >= 80)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.attacker.name);
    mergeTargetPreferences(actionContext, {
      holy_ascension_target: {
        role: "temporary_stat_buff",
        purpose: "offense",
        atkBoost: 800,
        preferredNames,
      },
    });
  }

  if (card?.name === "Polymerization") {
    actionContext.fusionPositions = {
      ...(actionContext.fusionPositions || {}),
      byName: {
        ...(actionContext.fusionPositions?.byName || {}),
        "Luminarch Megashield Barbarias": "defense",
        "Luminarch Pure Knight": "defense",
      },
    };
  }

  if (card?.name === "Luminarch Knights Convocation") {
    const defensePlan = evaluateLuminarchDefensePlan(analysis);
    const existingPreferences = actionContext.costPreferences || {};
    actionContext.costPreferences = buildLuminarchCostPreferences({
      analysis,
      preferNames: existingPreferences.preferNames || [],
      preserveNames: [
        ...new Set([
          ...(existingPreferences.preserveNames || []),
          ...LUMINARCH_COST_PRESERVE_NAMES,
        ]),
      ],
      offensivePayoffNames: LUMINARCH_OFFENSIVE_NAMES,
      preserveLastOffensivePayoff: true,
      availableOffensivePayoffs:
        defensePlan.offensivePayoffsAvailable?.length || 0,
      extra: {
        stableDefense: defensePlan.stable,
        readyToCounterattack: defensePlan.readyToCounterattack,
      },
    });
  }

  return actionContext;
}
