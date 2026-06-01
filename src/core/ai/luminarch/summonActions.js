import { assessActionSafety } from "../ChainAwareness.js";
import { calculateMacroPriorityBonus } from "../MacroPlanning.js";
import {
  getStrongestAttackThreat,
  getTotalAttackThreat,
} from "../common/cardStats.js";
import { buildPrioritizedAction } from "../common/actionGeneration.js";
import { evaluateRadiantLancerBattlePlan } from "./priorities.js";
import {
  evaluateLuminarchTributeSummonCost,
  isRadiantLancer,
  LUMINARCH_OFFENSIVE_NAMES,
  spendsAegisbearerProtectorCore,
} from "./tributePolicy.js";

const CELESTIAL_MARSHAL_NAME = "Luminarch Celestial Marshal";
const FORTRESS_AEGIS_NAME = "Luminarch Fortress Aegis";
const MAGIC_SICKLE_NAME = "Luminarch Magic Sickle";
const CITADEL_NAME = "Sanctum of the Luminarch Citadel";
const CRESCENT_SHIELD_NAME = "Luminarch Crescent Shield";
const HOLY_SHIELD_NAME = "Luminarch Holy Shield";
const MOONLIT_BLESSING_NAME = "Luminarch Moonlit Blessing";
const SUNFORGED_BLADE_NAME = "Luminarch Sunforged Blade";

const LUMINARCH_SPELL_RECOVERY_TARGETS = new Set([
  "Sanctum of the Luminarch Citadel",
  "Luminarch Holy Ascension",
  "Luminarch Holy Shield",
  "Luminarch Moonlit Blessing",
  "Luminarch Radiant Wave",
  "Luminarch Sacred Judgment",
  "Luminarch Spear of Dawnfall",
  "Luminarch Sunforged Blade",
]);

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

function isLuminarchMonster(card) {
  return card?.cardKind === "monster" && card.archetype === "Luminarch";
}

function getOpponentTotalThreat(opponent) {
  return getTotalAttackThreat(opponent?.field || [], {
    facedownValue: "printed",
    includeBoosts: false,
  });
}

function hasStableWall(bot, opponent) {
  const oppStrongest = getStrongestAttackThreat(opponent?.field || [], {
    facedownValue: 1500,
    includeBoosts: false,
  });
  return (bot?.field || []).some((card) => {
    if (!card || card.cardKind !== "monster" || card.isFacedown) return false;
    if (card.mustBeAttacked) return true;
    return (card.def || 0) + (card.tempDefBoost || 0) >= oppStrongest;
  });
}

function canPayLpForLuminarchAction({
  bot,
  opponent,
  cost,
  createsWall = false,
  createsPayoff = false,
}) {
  const lp = bot?.lp || 0;
  const finalLp = lp - cost;
  if (finalLp <= 0) return false;
  if (createsWall || createsPayoff) return finalLp >= 500;
  const oppThreat = getOpponentTotalThreat(opponent);
  return finalLp > Math.max(1500, oppThreat);
}

function getBestFortressReviveTarget(graveyard = [], opponent = null) {
  const oppStrongest = getStrongestAttackThreat(opponent?.field || [], {
    facedownValue: 1500,
    includeBoosts: false,
  });
  return graveyard
    .filter(
      (card) =>
        isLuminarchMonster(card) &&
        (card.def || 0) <= 2000,
    )
    .map((card) => {
      let score = (card.def || 0) / 350 + (card.atk || 0) / 700;
      if (card.name === "Luminarch Aegisbearer") score += 8;
      if (card.name === "Luminarch Valiant - Knight of the Dawn") score += 5;
      if (card.name === "Luminarch Sanctified Arbiter") score += 4;
      if (card.name === MAGIC_SICKLE_NAME) score += 2;
      if ((card.def || 0) >= oppStrongest && oppStrongest > 0) score += 3;
      return { card, score };
    })
    .sort((a, b) => b.score - a.score)[0]?.card || null;
}

function getUsefulSickleSpellTargets(graveyard = []) {
  return graveyard.filter(
    (card) =>
      card &&
      card.cardKind === "spell" &&
      card.archetype === "Luminarch" &&
      LUMINARCH_SPELL_RECOVERY_TARGETS.has(card.name),
  );
}

function scoreSickleSpellTarget(card, { bot, opponent }) {
  if (!card) return 0;
  const hasCitadel = bot?.fieldSpell?.name === CITADEL_NAME;
  const oppThreat = getOpponentTotalThreat(opponent);
  const underPressure = oppThreat >= (bot?.lp || 8000) || (bot?.lp || 8000) <= 3500;
  const hasGyLuminarch = (bot?.graveyard || []).some(
    (entry) => isLuminarchMonster(entry) && entry.name !== MAGIC_SICKLE_NAME,
  );
  const hasFaceupLuminarch = (bot?.field || []).some(
    (entry) => isLuminarchMonster(entry) && !entry.isFacedown,
  );
  const controlsSunforged = (bot?.spellTrap || []).some(
    (entry) => entry?.name === SUNFORGED_BLADE_NAME,
  );
  switch (card.name) {
    case CITADEL_NAME:
      return hasCitadel ? 1 : 12;
    case MOONLIT_BLESSING_NAME:
      return hasGyLuminarch ? (hasCitadel ? 13 : 9) : 3;
    case HOLY_SHIELD_NAME:
      return underPressure ? 12 : 7;
    case CRESCENT_SHIELD_NAME:
      return hasFaceupLuminarch ? (underPressure ? 10 : 7) : 2;
    case "Luminarch Radiant Wave":
      return (bot?.field || []).some((entry) => isLuminarchMonster(entry) && (entry.atk || 0) >= 2000)
        ? 10
        : 4;
    case "Luminarch Sacred Judgment":
      return underPressure && (bot?.field || []).length === 0 ? 11 : 5;
    case "Luminarch Spear of Dawnfall":
      return (opponent?.field || []).length > 0 ? 9 : 4;
    case SUNFORGED_BLADE_NAME:
      if (controlsSunforged || !hasFaceupLuminarch) return 2;
      return hasCitadel ? 9 : 7;
    case "Luminarch Holy Ascension":
      return (opponent?.field || []).length > 0 ? 7 : 3;
    default:
      return 2;
  }
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

    actions.push(
      buildPrioritizedAction({
        type: "summon",
        index,
        card,
        priority,
        reason: finisherPlan?.reason || shouldSummon.reason,
        extra: {
          position: preferredPosition,
          facedown,
          finisherPlan,
          lancerPlan: compactRadiantLancerPlan(radiantLancerPlan),
          macroBuff,
          tributeCostPenalty,
          tributeCostReason,
          safetyScore: summonSafety.riskScore,
        },
      }),
    );
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

    actions.push(
      buildPrioritizedAction({
        type: "special_summon_sanctum_protector",
        index: protectorIndex,
        materialIndex: chosenAegis.fieldIndex,
        card: protectorCard,
        priority,
        reason: "upgrade_tank",
        extra: {
          position: "defense",
          cardName: protectorCard?.name || "Luminarch Sanctum Protector",
          macroBuff,
        },
      }),
    );
  } else if (bot?.debug && aegisCandidates.length > 0) {
    console.log("[LuminarchStrategy] Skip Protector SS: ascension ready for Aegis");
  }

  return actions;
}

function getCelestialMarshalHandIgnitionActions(context) {
  const { game, bot, opponent, activationContext, macroStrategy } = context;
  const actions = [];
  if ((bot.field || []).length >= 5) return actions;

  const marshalIndex = (bot.hand || []).findIndex(
    (card) => card?.name === CELESTIAL_MARSHAL_NAME,
  );
  if (marshalIndex < 0) return actions;

  const marshal = bot.hand[marshalIndex];
  const oppStrongest = getStrongestAttackThreat(opponent?.field || [], {
    facedownValue: 1500,
    includeBoosts: false,
  });
  const createsWall =
    oppStrongest === 0 ||
    (marshal.def || 0) >= oppStrongest ||
    !hasStableWall(bot, opponent);
  const hasHalberdFollowUp = (bot.hand || []).some(
    (card) => card?.name === "Luminarch Enchanted Halberd",
  );
  const opensFusion =
    (bot.hand || []).some((card) => card?.name === "Polymerization") &&
    (bot.extraDeck || []).some((card) =>
      ["Luminarch Pure Knight", "Luminarch Megashield Barbarias"].includes(
        card?.name,
      ),
    );
  const createsPayoff = hasHalberdFollowUp || opensFusion;

  if (
    !canPayLpForLuminarchAction({
      bot,
      opponent,
      cost: 2000,
      createsWall,
      createsPayoff,
    })
  ) {
    return actions;
  }

  const marshalPosition = oppStrongest > 0 ? "defense" : "attack";
  const handActivationContext = {
    ...(activationContext || {}),
    fromHand: true,
    activationZone: "hand",
    sourceZone: "hand",
    autoSelectTargets: true,
    autoSelectSingleTarget: true,
    actionContext: {
      ...(activationContext?.actionContext || {}),
      specialSummonPositions: {
        ...(activationContext?.actionContext?.specialSummonPositions || {}),
        byName: {
          ...(activationContext?.actionContext?.specialSummonPositions?.byName ||
            {}),
          [CELESTIAL_MARSHAL_NAME]: marshalPosition,
        },
      },
    },
  };
  const preview = game?.effectEngine?.canActivateMonsterEffectPreview?.(
    marshal,
    bot,
    "hand",
    null,
    { activationContext: handActivationContext },
  );
  if (preview && preview.ok === false) return actions;

  let priority = 8;
  if (createsWall) priority += 3;
  if (hasHalberdFollowUp) priority += 2;
  if (opensFusion) priority += 2;
  if ((opponent?.field || []).length === 0 && !opensFusion) priority -= 2;
  priority += calculateMacroPriorityBonus(
    "handIgnition",
    marshal,
    macroStrategy,
  );

  actions.push(
    buildPrioritizedAction({
      type: "handIgnition",
      index: marshalIndex,
      card: marshal,
      priority,
      reason: createsWall
        ? "marshal_creates_wall"
        : createsPayoff
          ? "marshal_opens_followup"
          : "marshal_body",
      activationContext: handActivationContext,
    }),
  );

  return actions;
}

function getFortressAegisReviveActions(context) {
  const { game, bot, opponent, activationContext, macroStrategy } = context;
  const actions = [];
  if ((bot.field || []).length >= 5) return actions;

  (bot.field || []).forEach((card, fieldIndex) => {
    if (!card || card.name !== FORTRESS_AEGIS_NAME || card.isFacedown) return;

    const bestTarget = getBestFortressReviveTarget(bot.graveyard || [], opponent);
    if (!bestTarget) return;

    const oppStrongest = getStrongestAttackThreat(opponent?.field || [], {
      facedownValue: 1500,
      includeBoosts: false,
    });
    const createsWall =
      bestTarget.name === "Luminarch Aegisbearer" ||
      (bestTarget.def || 0) >= oppStrongest;
    const createsPayoff = [
      "Luminarch Valiant - Knight of the Dawn",
      "Luminarch Sanctified Arbiter",
      "Luminarch Aegisbearer",
    ].includes(bestTarget.name);

    if (
      !canPayLpForLuminarchAction({
        bot,
        opponent,
        cost: 1000,
        createsWall,
        createsPayoff,
      })
    ) {
      return;
    }

    const reviveContext = {
      ...(activationContext || {}),
      fromHand: false,
      activationZone: "field",
      sourceZone: "field",
      autoSelectTargets: true,
      autoSelectSingleTarget: true,
      actionContext: {
        ...(activationContext?.actionContext || {}),
        targetPreferences: {
          ...(activationContext?.actionContext?.targetPreferences || {}),
          fortress_aegis_revive_target: {
            role: "recursion",
            purpose: createsWall ? "stabilize" : "value",
            preferredNames: [bestTarget.name],
            defensiveNames: ["Luminarch Aegisbearer"],
            offensiveNames: [
              "Luminarch Valiant - Knight of the Dawn",
              "Luminarch Sanctified Arbiter",
            ],
          },
        },
      },
    };

    const preview = game?.effectEngine?.canActivateMonsterEffectPreview?.(
      card,
      bot,
      "field",
      null,
      { activationContext: reviveContext },
    );
    if (preview && preview.ok === false) return;

    let priority = 9;
    if (createsWall) priority += 3;
    if (createsPayoff) priority += 2;
    if ((bot.lp || 0) <= 3000) priority -= 1;
    priority += calculateMacroPriorityBonus(
      "monsterEffect",
      card,
      macroStrategy,
    );

    actions.push(
      buildPrioritizedAction({
        type: "monsterEffect",
        fieldIndex,
        card,
        priority,
        reason: `fortress_revive_${bestTarget.name}`,
        activationContext: reviveContext,
      }),
    );
  });

  return actions;
}

function getMagicSickleGraveyardActions(context) {
  const { game, bot, opponent, activationContext, macroStrategy } = context;
  const actions = [];
  const graveyard = bot.graveyard || [];
  const spellTargets = getUsefulSickleSpellTargets(graveyard)
    .map((card) => ({
      card,
      score: scoreSickleSpellTarget(card, { bot, opponent }),
    }))
    .filter((entry) => entry.score >= 7)
    .sort((a, b) => b.score - a.score);
  if (spellTargets.length === 0) return actions;

  graveyard.forEach((card, graveyardIndex) => {
    if (!card || card.name !== MAGIC_SICKLE_NAME) return;

    const bestSpell = spellTargets[0].card;
    const sickleContext = {
      ...(activationContext || {}),
      fromHand: false,
      activationZone: "graveyard",
      sourceZone: "graveyard",
      autoSelectTargets: true,
      autoSelectSingleTarget: true,
      actionContext: {
        ...(activationContext?.actionContext || {}),
        preferredSearchNames: [bestSpell.name],
      },
    };

    const preview = game?.effectEngine?.canActivateMonsterEffectPreview?.(
      card,
      bot,
      "graveyard",
      null,
      { activationContext: sickleContext },
    );
    if (preview && preview.ok === false) return;

    const macroBuff = calculateMacroPriorityBonus(
      "graveyardMonsterEffect",
      card,
      macroStrategy,
    );
    actions.push(
      buildPrioritizedAction({
        type: "graveyardMonsterEffect",
        graveyardIndex,
        card,
        priority: 7 + spellTargets[0].score + macroBuff,
        reason: `sickle_recover_${bestSpell.name}`,
        activationContext: sickleContext,
      }),
    );
  });

  return actions;
}

export function getLuminarchMonsterIgnitionActions(context) {
  return [
    ...getCelestialMarshalHandIgnitionActions(context),
    ...getFortressAegisReviveActions(context),
    ...getMagicSickleGraveyardActions(context),
  ];
}

export function getLuminarchSummonActions(context) {
  return [
    ...getNormalSummonActions(context),
    ...getSanctumProtectorActions(context),
    ...getLuminarchMonsterIgnitionActions(context),
  ];
}
