import { assessActionSafety } from "../ChainAwareness.js";
import { calculateMacroPriorityBonus } from "../MacroPlanning.js";
import { getStrongestAttackThreat } from "../common/cardStats.js";
import { evaluateRadiantLancerBattlePlan } from "./priorities.js";
import {
  evaluateLuminarchTributeSummonCost,
  isRadiantLancer,
  LUMINARCH_OFFENSIVE_NAMES,
  spendsAegisbearerProtectorCore,
} from "./tributePolicy.js";

function getRadiantLancerAnalysis(bot, opponent, game) {
  return {
    hand: bot?.hand || [],
    field: bot?.field || [],
    spellTrap: bot?.spellTrap || [],
    fieldSpell: bot?.fieldSpell || null,
    graveyard: bot?.graveyard || [],
    lp: bot?.lp || 8000,
    oppField: opponent?.field || [],
    oppLp: opponent?.lp || 8000,
    currentTurn: game?.turnCounter || 1,
  };
}

function compactRadiantLancerPlan(plan) {
  if (!plan) return null;
  return {
    hasLine: !!plan.hasLine,
    improvesThreatMatchup: !!plan.improvesThreatMatchup,
    projectedAtk: plan.projectedAtk || 0,
    bestTargetName: plan.bestTarget?.name || null,
    bestTargetStat: plan.bestTargetStat || 0,
    nextThreatName: plan.nextThreat?.name || null,
    nextThreatStat: plan.nextThreatStat || 0,
    survivesNextThreat: !!plan.survivesNextThreat,
    tradesNextThreat: !!plan.tradesNextThreat,
  };
}

function getNormalSummonFinisherPlan(context, card) {
  if (!card) return null;
  const plans = context.finisherPlans || context.analysis?.finisherPlans || [];
  return (plans || []).find(
    (plan) =>
      plan &&
      plan.kind === "normal_summon" &&
      plan.targetName === card.name,
  );
}

function getNormalSummonActions(context) {
  const {
    game,
    bot,
    opponent,
    macroStrategy,
    luminarchDefensePlan,
    verboseEval,
    hooks = {},
  } = context;
  const actions = [];

  if (bot.summonCount >= 1) return actions;

  bot.hand.forEach((card, index) => {
    if (card.cardKind !== "monster") return;
    const tributeInfo = hooks.getTributeRequirementFor(card, bot);
    if (verboseEval && bot?.debug) {
      console.log(`\n[LuminarchStrategy] Evaluating monster: ${card.name}`);
      console.log(
        `  Tributes needed: ${tributeInfo.tributesNeeded}, field: ${bot.field.length}`,
      );
    }
    if (bot.field.length < tributeInfo.tributesNeeded) {
      if (verboseEval && bot?.debug) {
        console.log(
          `  Rejected: insufficient tributes (${tributeInfo.tributesNeeded}/${bot.field.length})`,
        );
      }
      return;
    }
    const projectedFieldCount =
      (bot.field?.length || 0) - tributeInfo.tributesNeeded + 1;
    if (projectedFieldCount > 5) {
      if (verboseEval && bot?.debug) {
        console.log(`  Rejected: no monster zone after tributes`);
      }
      return;
    }

    const shouldSummon = hooks.shouldSummonMonsterSafely(
      card,
      game,
      opponent,
    );
    if (verboseEval && bot?.debug) {
      console.log(
        `  Safety check: ${shouldSummon.yes ? "approved" : "rejected"} - ${
          shouldSummon.reason || "no reason"
        }`,
      );
    }
    if (!shouldSummon.yes) return;

    const projectedTributeIndices =
      tributeInfo.tributesNeeded > 0
        ? hooks.selectBestTributes(bot.field, tributeInfo.tributesNeeded, card, {
            oppField: opponent?.field || [],
            game,
          })
        : [];
    const projectedTributes = projectedTributeIndices
      .map((fieldIndex) => bot.field?.[fieldIndex])
      .filter(Boolean);

    let tributeCostPenalty = 0;
    let tributeCostReason = null;
    if (tributeInfo.tributesNeeded > 0) {
      const tributeCost = evaluateLuminarchTributeSummonCost(
        card,
        projectedTributes,
        { bot, opponent, game, shouldSummon },
      );
      tributeCostPenalty += tributeCost.penalty || 0;
      tributeCostReason = tributeCost.reason || null;
      if (!tributeCost.ok) {
        if (verboseEval && bot?.debug) {
          console.log(`  Rejected tribute summon: ${tributeCost.reason}`);
        }
        return;
      }
    }

    let radiantLancerPlan = shouldSummon.lancerPlan || null;
    if (isRadiantLancer(card) && tributeInfo.tributesNeeded > 0) {
      if (spendsAegisbearerProtectorCore(projectedTributes)) {
        radiantLancerPlan =
          radiantLancerPlan ||
          evaluateRadiantLancerBattlePlan(
            card,
            getRadiantLancerAnalysis(bot, opponent, game),
          );

        const hasImmediatePayoff =
          radiantLancerPlan?.hasLine &&
          radiantLancerPlan?.improvesThreatMatchup;
        if (!hasImmediatePayoff) {
          if (verboseEval && bot?.debug) {
            console.log(
              "  Rejected: Radiant Lancer would spend defensive core without payoff",
            );
          }
          return;
        }

        if (
          radiantLancerPlan.tradesNextThreat &&
          !radiantLancerPlan.survivesNextThreat
        ) {
          tributeCostPenalty -= 2;
        }
      }
    }

    const preferredPosition =
      shouldSummon.position || hooks.chooseSummonPosition(card, game);
    const facedown = hooks.shouldSetFacedown(card, preferredPosition);

    let priority = shouldSummon.priority || 2;
    const macroBuff = calculateMacroPriorityBonus(
      "summon",
      card,
      macroStrategy,
    );
    priority += macroBuff + tributeCostPenalty;
    if (
      luminarchDefensePlan.readyToCounterattack &&
      LUMINARCH_OFFENSIVE_NAMES.includes(card.name)
    ) {
      priority += 2;
    }

    const finisherPlan = getNormalSummonFinisherPlan(context, card);
    if (finisherPlan) {
      const plannedPriority =
        finisherPlan.details?.summonPriority || finisherPlan.actionPriority;
      priority = Math.max(priority, plannedPriority);
    }

    const summonSafety = assessActionSafety(
      { bot, player: opponent },
      bot,
      opponent,
      "summon",
      card,
    );
    if (summonSafety.recommendation === "very_risky") {
      priority -= 10;
    }

    actions.push({
      type: "summon",
      index,
      cardId: card.id,
      position: preferredPosition,
      facedown,
      priority,
      cardName: card.name,
      reason: finisherPlan?.reason || shouldSummon.reason,
      finisherPlan,
      lancerPlan: compactRadiantLancerPlan(radiantLancerPlan),
      macroBuff,
      tributeCostPenalty,
      tributeCostReason,
      safetyScore: summonSafety.riskScore,
    });
  });

  return actions;
}

function getSanctumProtectorActions(context) {
  const { game, bot, opponent, macroStrategy } = context;
  const actions = [];
  const protectorIndices = [];
  bot.hand.forEach((card, index) => {
    if (card && card.name === "Luminarch Sanctum Protector") {
      protectorIndices.push(index);
    }
  });

  if (protectorIndices.length === 0) return actions;

  const aegisCandidates = (bot.field || [])
    .map((card, fieldIndex) => ({ card, fieldIndex }))
    .filter(
      (entry) =>
        entry.card &&
        entry.card.name === "Luminarch Aegisbearer" &&
        !entry.card.isFacedown,
    );

  const canCheckAscension =
    typeof game?.canUseAsAscensionMaterial === "function" &&
    typeof game?.getAscensionCandidatesForMaterial === "function" &&
    typeof game?.checkAscensionRequirements === "function";

  const isAscensionReady = (material) => {
    if (!canCheckAscension) return false;
    const check = game.canUseAsAscensionMaterial(bot, material);
    if (!check?.ok) return false;
    const candidates = game.getAscensionCandidatesForMaterial(bot, material);
    if (!Array.isArray(candidates) || candidates.length === 0) return false;
    return candidates.some((asc) => game.checkAscensionRequirements(bot, asc)?.ok);
  };

  const usableAegis = aegisCandidates.filter(
    (entry) => !isAscensionReady(entry.card),
  );

  if (usableAegis.length > 0) {
    const chosenAegis = usableAegis[0];
    const protectorIndex = protectorIndices[0];
    const protectorCard = bot.hand[protectorIndex];

    const oppStrongest = getStrongestAttackThreat(opponent?.field || [], {
      facedownValue: 1500,
      includeBoosts: false,
    });

    const hasOtherTank = (bot.field || []).some(
      (card) =>
        card &&
        card.cardKind === "monster" &&
        !card.isFacedown &&
        card.name !== "Luminarch Aegisbearer" &&
        ((card.def || 0) >= 2500 ||
          card.name === "Luminarch Sanctum Protector" ||
          card.name === "Luminarch Fortress Aegis"),
    );

    let priority = 7;
    if (!hasOtherTank) priority += 1;
    if (oppStrongest >= 2200) priority += 2;
    if (oppStrongest >= 2600) priority += 1;
    if ((bot.lp || 0) <= 4000) priority += 1;
    if ((opponent?.field || []).length === 0) priority -= 2;

    const macroBuff = calculateMacroPriorityBonus(
      "summon",
      protectorCard,
      macroStrategy,
    );
    priority += macroBuff;

    actions.push({
      type: "special_summon_sanctum_protector",
      index: protectorIndex,
      cardId: protectorCard?.id,
      materialIndex: chosenAegis.fieldIndex,
      position: "defense",
      priority,
      cardName: protectorCard?.name || "Luminarch Sanctum Protector",
      macroBuff,
      reason: "upgrade_tank",
    });
  } else if (bot?.debug && aegisCandidates.length > 0) {
    console.log("[LuminarchStrategy] Skip Protector SS: ascension ready for Aegis");
  }

  return actions;
}

export function getLuminarchSummonActions(context) {
  return [
    ...getNormalSummonActions(context),
    ...getSanctumProtectorActions(context),
  ];
}
