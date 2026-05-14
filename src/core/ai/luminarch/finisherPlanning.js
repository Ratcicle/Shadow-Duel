import {
  createFinisherPlan,
  getBestFinisherPlan,
  rankFinisherPlans,
} from "../common/finisherPlans.js";
import {
  countDestroyableByAtk,
  getEffectiveAtk,
  getStrongestAttackThreat,
  getTotalAttackThreat,
} from "../common/cardStats.js";
import { isLuminarch } from "./knowledge.js";
import { evaluateLuminarchDefensePlan } from "./defensePlanning.js";
import { evaluateRadiantLancerBattlePlan } from "./lancerPlanning.js";

const BARBARIAS_NAME = "Luminarch Megashield Barbarias";
const FORTRESS_NAME = "Luminarch Fortress Aegis";
const LANCER_NAME = "Luminarch Radiant Lancer";
const SERAPH_NAME = "Luminarch Aurora Seraph";
const MOONBLADE_NAME = "Luminarch Moonblade Captain";

function getMonsters(cards = []) {
  return (cards || []).filter((card) => card && card.cardKind === "monster");
}

function getMaterialEntries(bot) {
  return [
    ...(bot?.hand || []).map((card) => ({ card, zone: "hand" })),
    ...(bot?.field || []).map((card) => ({ card, zone: "field" })),
  ].filter((entry) => entry.card && entry.card.cardKind === "monster");
}

function hasDistinctMegashieldMaterials(bot) {
  const entries = getMaterialEntries(bot);
  const protectors = entries.filter(
    (entry) => entry.card?.name === "Luminarch Sanctum Protector",
  );
  if (protectors.length === 0) return false;
  return protectors.some((protector) =>
    entries.some(
      (entry) =>
        entry !== protector &&
        isLuminarch(entry.card) &&
        (entry.card.level || 0) >= 5,
    ),
  );
}

function canSummonMegashield(bot, game, fusionCard) {
  if (!bot || !fusionCard) return false;
  if (game?.effectEngine?.canSummonFusion) {
    const entries = getMaterialEntries(bot);
    const materials = entries.map((entry) => entry.card);
    const materialInfo = entries.map((entry) => ({ zone: entry.zone }));
    return !!game.effectEngine.canSummonFusion(fusionCard, materials, bot, {
      materialInfo,
    });
  }
  return hasDistinctMegashieldMaterials(bot);
}

function canActivatePolymerization(polyCard, bot, game, activationContext = null) {
  if (!polyCard || !bot) return false;
  if (!game?.effectEngine?.canActivateSpellFromHandPreview) return true;
  const preview = game.effectEngine.canActivateSpellFromHandPreview(polyCard, bot, {
    activationContext: activationContext || {
      autoSelectSingleTarget: true,
      logTargets: false,
    },
  });
  return preview?.ok !== false;
}

function evaluateBarbariasActionPriority(bot, opponent, defensePlan, hooks = {}) {
  let priority = 10;

  const lp = bot?.lp || 8000;
  if (lp <= 2000) priority += 4;
  else if (lp <= 3500) priority += 2;

  const oppStrength = getTotalAttackThreat(opponent?.field || [], {
    facedownValue: "printed",
    includeBoosts: false,
  });
  if (oppStrength >= 8000) priority += 3;
  else if (oppStrength >= 6000) priority += 1;

  const hasCitadel = bot?.fieldSpell?.name?.includes("Citadel");
  if (hasCitadel) priority += 2;

  const projectedBarbarias = {
    name: BARBARIAS_NAME,
    cardKind: "monster",
    atk: 2500,
    def: 3000,
    position: "defense",
  };
  const stanceValue =
    typeof hooks.evaluateBarbariasStanceDance === "function"
      ? hooks.evaluateBarbariasStanceDance(projectedBarbarias, opponent)
      : { score: 0 };
  if (stanceValue.score > 0) {
    priority += Math.min(5, Math.max(2, Math.floor(stanceValue.score / 5)));
  }

  const hasFortress = (bot?.field || []).some(
    (card) => card && card.name === FORTRESS_NAME,
  );
  const has2800Tank = (bot?.field || []).some(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      card.position === "defense" &&
      (card.def || 0) >= 2800,
  );
  if (hasFortress || has2800Tank) priority -= 3;
  if (defensePlan?.clearLethalRisk) priority += 2;
  if (defensePlan && !defensePlan.stable) priority += 1;

  const protector = (bot?.field || []).find(
    (card) => card && card.name === "Luminarch Sanctum Protector",
  );
  if ((protector?.fieldAgeTurns || 0) >= 2) priority -= 1;

  return {
    priority,
    stanceValue,
    hasFortress,
    has2800Tank,
  };
}

export function evaluateLuminarchFusionPlan(
  bot,
  opponent,
  game = null,
  analysis = null,
  hooks = {},
) {
  const polyIndex = (bot?.hand || []).findIndex(
    (card) => card && card.name === "Polymerization",
  );
  if (polyIndex === -1) return null;
  const polyCard = bot.hand[polyIndex];
  const fusionCard = (bot?.extraDeck || []).find(
    (card) => card && card.name === BARBARIAS_NAME,
  );
  if (!fusionCard) return null;
  if (!canSummonMegashield(bot, game, fusionCard)) return null;
  if (!canActivatePolymerization(polyCard, bot, game)) return null;

  const defensePlan = analysis?.luminarchDefensePlan || evaluateLuminarchDefensePlan(
    analysis || { field: bot?.field, hand: bot?.hand, graveyard: bot?.graveyard, oppField: opponent?.field, lp: bot?.lp },
  );
  const actionEval = evaluateBarbariasActionPriority(
    bot,
    opponent,
    defensePlan,
    hooks,
  );
  const score100 =
    actionEval.priority * 5 +
    (defensePlan?.clearLethalRisk ? 8 : 0) +
    (!defensePlan?.stable ? 5 : 0);

  return createFinisherPlan({
    kind: "fusion",
    targetName: BARBARIAS_NAME,
    score100,
    reason: defensePlan?.clearLethalRisk
      ? "barbarias_stabilizes_lethal_pressure"
      : actionEval.stanceValue?.score > 0
        ? "barbarias_stance_pressure"
        : "barbarias_defensive_finisher",
    preserveResources: ["Luminarch Sanctum Protector"],
    details: {
      spellIndex: polyIndex,
      spellCardId: polyCard.id,
      spellPriority: actionEval.priority,
      position: "defense",
      stanceValue: actionEval.stanceValue,
      hasFortress: actionEval.hasFortress,
      has2800Tank: actionEval.has2800Tank,
    },
  });
}

function findFortressAscensionCandidate(bot, game) {
  const fortress = (bot?.extraDeck || []).find(
    (card) => card && card.name === FORTRESS_NAME,
  );
  if (!fortress) return null;

  if (
    typeof game?.canUseAsAscensionMaterial === "function" &&
    typeof game?.getAscensionCandidatesForMaterial === "function" &&
    typeof game?.checkAscensionRequirements === "function"
  ) {
    for (const [fieldIndex, material] of (bot?.field || []).entries()) {
      if (!material || material.cardKind !== "monster") continue;
      const canUse = game.canUseAsAscensionMaterial(bot, material);
      if (!canUse?.ok) continue;
      const candidates = game.getAscensionCandidatesForMaterial(bot, material) || [];
      const ascensionCard = candidates.find(
        (candidate) =>
          candidate &&
          candidate.name === FORTRESS_NAME &&
          game.checkAscensionRequirements(bot, candidate)?.ok,
      );
      if (ascensionCard) {
        return { material, fieldIndex, ascensionCard };
      }
    }
    return null;
  }

  const fieldIndex = (bot?.field || []).findIndex(
    (card) =>
      card &&
      card.name === "Luminarch Aegisbearer" &&
      (card.fieldAgeTurns || 0) >= 2,
  );
  if (fieldIndex === -1) return null;
  return {
    material: bot.field[fieldIndex],
    fieldIndex,
    ascensionCard: fortress,
  };
}

function evaluateFortressActionPriority(material, bot, opponent, defensePlan) {
  let priority = 11;

  const lp = bot?.lp || 8000;
  if (lp <= 3000) priority += 3;
  else if (lp <= 5000) priority += 1;

  const oppStrength = getTotalAttackThreat(opponent?.field || [], {
    facedownValue: "printed",
    includeBoosts: false,
  });
  if (oppStrength >= 6000) priority += 2;
  if ((material?.fieldAgeTurns || 0) >= 3) priority += 2;

  const gyLuminarch = (bot?.graveyard || []).filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      isLuminarch(card) &&
      (card.def || 0) <= 2000,
  ).length;
  if (gyLuminarch < 2) priority -= 2;
  if (defensePlan?.clearLethalRisk) priority += 2;
  if (defensePlan?.stable) priority -= 1;

  return { priority, gyLuminarch, oppStrength };
}

export function evaluateLuminarchAscensionPlan(
  bot,
  opponent,
  game = null,
  analysis = null,
) {
  const candidate = findFortressAscensionCandidate(bot, game);
  if (!candidate) return null;

  const defensePlan = analysis?.luminarchDefensePlan || evaluateLuminarchDefensePlan(
    analysis || { field: bot?.field, hand: bot?.hand, graveyard: bot?.graveyard, oppField: opponent?.field, lp: bot?.lp },
  );
  const actionEval = evaluateFortressActionPriority(
    candidate.material,
    bot,
    opponent,
    defensePlan,
  );

  return createFinisherPlan({
    kind: "ascension",
    targetName: FORTRESS_NAME,
    score100:
      actionEval.priority * 6 +
      (defensePlan?.clearLethalRisk ? 8 : 0) +
      (actionEval.gyLuminarch >= 2 ? 5 : 0),
    reason: defensePlan?.clearLethalRisk
      ? "fortress_blocks_lethal_pressure"
      : actionEval.gyLuminarch >= 2
        ? "fortress_revive_engine_online"
        : "fortress_defensive_upgrade",
    details: {
      materialName: candidate.material?.name || null,
      materialInstanceId: candidate.material?.instanceId || null,
      materialIndex: candidate.fieldIndex,
      ascensionPriority: actionEval.priority,
      gyLuminarch: actionEval.gyLuminarch,
      oppStrength: actionEval.oppStrength,
    },
  });
}

function getTributeRequirement(card) {
  const level = card?.level || 0;
  if (level >= 7) return 2;
  if (level >= 5) return 1;
  return 0;
}

function canNormalSummonFromHand(card, analysis) {
  if (!card || card.cardKind !== "monster") return false;
  if ((analysis?.normalSummonsAvailable ?? 1) <= 0) return false;
  return (analysis?.field || []).length >= getTributeRequirement(card);
}

function evaluateLuminarchNormalFinisher(card, analysis, defensePlan) {
  const oppField = getMonsters(analysis?.oppField || []);
  const oppStrongest = getStrongestAttackThreat(oppField, {
    facedownValue: 1500,
    includeBoosts: false,
  });
  const atk = getEffectiveAtk(card);
  const destroyable = countDestroyableByAtk(oppField, atk, {
    facedownValue: 1500,
  });
  const directLethal = oppField.length === 0 && atk >= (analysis?.oppLp || 8000);
  const pressureLowLp = (analysis?.oppLp || 8000) <= Math.max(2500, atk);

  if (card.name === LANCER_NAME) {
    const lancerPlan = evaluateRadiantLancerBattlePlan(card, analysis);
    if (!lancerPlan?.hasLine && !directLethal && destroyable === 0) return null;
    const score100 =
      58 +
      (lancerPlan?.improvesThreatMatchup ? 14 : 0) +
      (lancerPlan?.survivesNextThreat ? 8 : 0) +
      (directLethal ? 18 : 0) +
      Math.min(10, destroyable * 4);
    return createFinisherPlan({
      kind: "normal_summon",
      targetName: LANCER_NAME,
      score100,
      reason: directLethal
        ? "lancer_lethal_push"
        : lancerPlan?.improvesThreatMatchup
          ? "lancer_clears_threat"
          : "lancer_offensive_payoff",
      details: {
        summonPriority: 10 + Math.min(4, Math.floor(score100 / 20)),
        lancerPlan,
      },
    });
  }

  if (card.name === SERAPH_NAME) {
    if (!directLethal && destroyable === 0 && !defensePlan?.readyToCounterattack) {
      return null;
    }
    const score100 =
      56 +
      (directLethal ? 18 : 0) +
      Math.min(12, destroyable * 5) +
      (atk >= oppStrongest && oppStrongest > 0 ? 8 : 0) +
      (pressureLowLp ? 4 : 0);
    return createFinisherPlan({
      kind: "normal_summon",
      targetName: SERAPH_NAME,
      score100,
      reason: directLethal
        ? "seraph_lethal_push"
        : destroyable > 0
          ? "seraph_heal_combat_payoff"
          : "seraph_counterattack_payoff",
      details: {
        summonPriority: 9 + Math.min(4, Math.floor(score100 / 22)),
      },
    });
  }

  if (card.name === MOONBLADE_NAME) {
    const reviveTargets = (analysis?.graveyard || []).filter(
      (target) =>
        target &&
        isLuminarch(target) &&
        target.cardKind === "monster" &&
        (target.level || 0) <= 4,
    );
    if (reviveTargets.length === 0 && !directLethal && destroyable === 0) return null;
    const score100 =
      52 +
      (reviveTargets.length > 0 ? 12 : 0) +
      Math.min(8, destroyable * 4) +
      (directLethal ? 18 : 0);
    return createFinisherPlan({
      kind: "normal_summon",
      targetName: MOONBLADE_NAME,
      score100,
      reason: reviveTargets.length > 0
        ? "moonblade_revive_extends_board"
        : directLethal
          ? "moonblade_lethal_push"
          : "moonblade_combat_payoff",
      details: {
        summonPriority: 8 + Math.min(4, Math.floor(score100 / 24)),
        reviveTargets: reviveTargets.map((target) => target.name),
      },
    });
  }

  return null;
}

function evaluateNormalSummonFinisherPlans(bot, opponent, game, analysis, defensePlan) {
  if ((analysis?.normalSummonsAvailable ?? 1) <= 0) return [];
  return (bot?.hand || [])
    .filter((card) => canNormalSummonFromHand(card, analysis))
    .map((card) => evaluateLuminarchNormalFinisher(card, analysis, defensePlan))
    .filter(Boolean);
}

export function evaluateLuminarchFinisherPlans(
  bot,
  opponent,
  game = null,
  analysis = null,
  hooks = {},
) {
  const normalizedAnalysis =
    analysis || {
      hand: bot?.hand || [],
      field: bot?.field || [],
      graveyard: bot?.graveyard || [],
      extraDeck: bot?.extraDeck || [],
      lp: bot?.lp || 8000,
      oppField: opponent?.field || [],
      oppLp: opponent?.lp || 8000,
      normalSummonsAvailable: Math.max(0, 1 - (bot?.summonCount || 0)),
      phase: game?.phase || "main1",
    };
  const defensePlan =
    normalizedAnalysis.luminarchDefensePlan ||
    evaluateLuminarchDefensePlan(normalizedAnalysis);
  normalizedAnalysis.luminarchDefensePlan = defensePlan;

  return rankFinisherPlans([
    evaluateLuminarchFusionPlan(bot, opponent, game, normalizedAnalysis, hooks),
    evaluateLuminarchAscensionPlan(bot, opponent, game, normalizedAnalysis),
    ...evaluateNormalSummonFinisherPlans(
      bot,
      opponent,
      game,
      normalizedAnalysis,
      defensePlan,
    ),
  ]);
}

export function getBestLuminarchFinisherPlan(plans = [], predicateOrKind = null) {
  return getBestFinisherPlan(plans, predicateOrKind);
}
