import {
  getStrongestAttackThreat,
  getTotalAttackThreat,
} from "../common/cardStats.js";
import { withFusionPreferences } from "../common/fusionPlanning.js";
import {
  evaluateLuminarchFinisherPlans,
  getBestLuminarchFinisherPlan,
} from "./finisherPlanning.js";

const BARBARIAS_NAME = "Luminarch Megashield Barbarias";
const FORTRESS_NAME = "Luminarch Fortress Aegis";

function getContextFinisherPlans(context = {}) {
  if (Array.isArray(context.finisherPlans)) return context.finisherPlans;
  if (Array.isArray(context.analysis?.finisherPlans)) {
    return context.analysis.finisherPlans;
  }
  try {
    return evaluateLuminarchFinisherPlans(
      context.bot,
      context.opponent,
      context.game,
      context.analysis,
      context.hooks || {},
    );
  } catch (error) {
    return [];
  }
}

function getContextFinisherPlan(context, kind, targetName) {
  return getBestLuminarchFinisherPlan(getContextFinisherPlans(context), (plan) => {
    if (!plan || plan.kind !== kind) return false;
    return !targetName || plan.targetName === targetName;
  });
}

function buildLuminarchFusionActivationContext(context, fusionPlan) {
  const baseContext = {
    ...(context.activationContext || {}),
    autoSelectSingleTarget: true,
    autoSelectTargets: true,
    logTargets: false,
    actionContext: {
      ...(context.activationContext?.actionContext || {}),
      fusionPositions: {
        ...(context.activationContext?.actionContext?.fusionPositions || {}),
        byName: {
          ...(context.activationContext?.actionContext?.fusionPositions?.byName ||
            {}),
          [BARBARIAS_NAME]: fusionPlan?.details?.position || "defense",
        },
      },
    },
  };

  if (!fusionPlan) return baseContext;
  return withFusionPreferences(baseContext, {
    target: fusionPlan.targetName,
    priority: fusionPlan.details?.spellPriority || fusionPlan.actionPriority,
    reason: fusionPlan.reason,
    plan: fusionPlan,
  });
}

export function evaluateLuminarchFusionPriority(
  fusionName,
  bot,
  opponent,
  game,
  hooks = {},
) {
  if (fusionName === "Luminarch Megashield Barbarias") {
    let priority = 10;

    const lp = bot.lp || 8000;
    if (lp <= 2000) priority += 4;
    else if (lp <= 3500) priority += 2;

    const oppStrength = getTotalAttackThreat(opponent?.field || [], {
      facedownValue: "printed",
      includeBoosts: false,
    });
    if (oppStrength >= 8000) priority += 3;
    else if (oppStrength >= 6000) priority += 1;

    const hasCitadel = bot.fieldSpell?.name?.includes("Citadel");
    if (hasCitadel) priority += 2;

    const projectedBarbarias = {
      name: "Luminarch Megashield Barbarias",
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

    const hasFortress = bot.field.some(
      (c) => c && c.name === "Luminarch Fortress Aegis",
    );
    const has2800Tank = bot.field.some(
      (c) =>
        c &&
        c.cardKind === "monster" &&
        c.position === "defense" &&
        (c.def || 0) >= 2800,
    );
    if (hasFortress || has2800Tank) priority -= 3;

    const willLoseProtector = bot.field.some(
      (c) => c && c.name === "Luminarch Sanctum Protector",
    );
    const protectorAge = willLoseProtector
      ? bot.field.find((c) => c && c.name === "Luminarch Sanctum Protector")
          ?.fieldAgeTurns || 0
      : 0;
    if (protectorAge >= 2) priority -= 1;

    return priority;
  }

  return 6;
}

export function detectLuminarchFusionOpportunities(context) {
  const { game, bot, opponent, hooks = {} } = context;
  const actions = [];

  try {
    const fusionPlan = getContextFinisherPlan(
      context,
      "fusion",
      BARBARIAS_NAME,
    );
    const polyInHand = bot.hand.findIndex(
      (c) => c && c.name === "Polymerization",
    );
    if (polyInHand === -1) return actions;
    const polyCard = bot.hand[polyInHand];
    if (!polyCard) return actions;

    const megashield = (bot.extraDeck || []).find(
      (c) => c && c.name === BARBARIAS_NAME,
    );
    if (!megashield) return actions;

    if (game?.effectEngine?.canSummonFusion) {
      const handMaterials = (bot.hand || [])
        .filter((c) => c && c.cardKind === "monster")
        .map((card) => ({ card, zone: "hand" }));
      const fieldMaterials = (bot.field || [])
        .filter((c) => c && c.cardKind === "monster")
        .map((card) => ({ card, zone: "field" }));
      const combined = [...handMaterials, ...fieldMaterials];
      const materials = combined.map((entry) => entry.card);
      const materialInfo = combined.map((entry) => ({ zone: entry.zone }));
      const canFuse = game.effectEngine.canSummonFusion(
        megashield,
        materials,
        bot,
        { materialInfo },
      );
      if (!canFuse) return actions;
    }

    if (game?.effectEngine?.canActivateSpellFromHandPreview) {
      const activationContext = buildLuminarchFusionActivationContext(
        context,
        fusionPlan,
      );
      const preview = game.effectEngine.canActivateSpellFromHandPreview(
        polyCard,
        bot,
        { activationContext },
      );
      if (preview && preview.ok === false) return actions;
    }

    const availableMaterials = [...(bot.hand || []), ...(bot.field || [])];
    const hasProtector = availableMaterials.some(
      (c) => c && c.name === "Luminarch Sanctum Protector",
    );
    const protectorCount = availableMaterials.filter(
      (c) => c && c.name === "Luminarch Sanctum Protector",
    ).length;
    const hasLv5PlusAlongsideProtector = availableMaterials.some(
      (c) =>
        c &&
        c.cardKind === "monster" &&
        c.name !== "Luminarch Sanctum Protector" &&
        c.archetype === "Luminarch" &&
        (c.level || 0) >= 5,
    ) || protectorCount >= 2;

    if (hasProtector && hasLv5PlusAlongsideProtector) {
      const priority =
        fusionPlan?.details?.spellPriority ||
        evaluateLuminarchFusionPriority(
          BARBARIAS_NAME,
          bot,
          opponent,
          game,
          hooks,
        );

      if (priority > 0) {
        actions.push({
          type: "spell",
          index: polyInHand,
          cardId: polyCard.id,
          priority: priority,
          cardName: "Polymerization",
          fusionTarget: BARBARIAS_NAME,
          reason:
            fusionPlan?.reason || "Fusion para Megashield (3000 DEF tank)",
          finisherPlan: fusionPlan,
          activationContext: buildLuminarchFusionActivationContext(
            context,
            fusionPlan,
          ),
        });
      }
    }
  } catch (e) {
    console.warn(`[LuminarchStrategy] detectFusionOpportunities error:`, e.message);
  }

  return actions;
}

export function chooseLuminarchAscensionPosition(ascensionCard, bot, opponent) {
  if (!ascensionCard) return "choice";
  if (ascensionCard.name !== "Luminarch Fortress Aegis") {
    return ascensionCard.ascension?.position || "choice";
  }

  const oppMonsters = (opponent?.field || []).filter(
    (monster) => monster && monster.cardKind === "monster",
  );
  const oppStrongestAtk = getStrongestAttackThreat(oppMonsters, {
    facedownValue: 1500,
    includeBoosts: false,
  });
  const oppTotalAtk = getTotalAttackThreat(oppMonsters, {
    facedownValue: 1500,
    includeBoosts: false,
  });
  const atk = ascensionCard.atk || 0;
  const def = ascensionCard.def || 0;
  const canLethal = oppMonsters.length === 0 && atk >= (opponent?.lp || 8000);
  const safePressure =
    oppStrongestAtk > 0 && atk > oppStrongestAtk + 300 && (bot?.lp || 0) > 3500;

  if (!canLethal && !safePressure && (oppTotalAtk > atk || oppStrongestAtk >= atk)) {
    return "defense";
  }
  if (def > atk && oppStrongestAtk >= atk) return "defense";
  return "attack";
}

export function evaluateLuminarchAscensionPriority(
  material,
  ascensionCard,
  bot,
  opponent,
  game,
) {
  const name = ascensionCard.name;
  const materialAge = material.fieldAgeTurns || 0;

  if (name === "Luminarch Fortress Aegis") {
    let priority = 11;

    const lp = bot.lp || 8000;
    if (lp <= 3000) priority += 3;
    else if (lp <= 5000) priority += 1;

    const oppStrength = getTotalAttackThreat(opponent?.field || [], {
      facedownValue: "printed",
      includeBoosts: false,
    });
    if (oppStrength >= 6000) priority += 2;

    if (materialAge >= 3) priority += 2;

    const gyLuminarch = (bot.graveyard || []).filter(
      (c) =>
        c &&
        c.cardKind === "monster" &&
        c.archetype === "Luminarch" &&
        (c.def || 0) <= 2000,
    ).length;
    if (gyLuminarch < 2) priority -= 2;

    return priority;
  }

  if (name === "Luminarch Megashield Barbarias") {
    let priority = 9;

    const lp = bot.lp || 8000;
    if (lp <= 2500) priority += 3;

    const oppStrength = getTotalAttackThreat(opponent?.field || [], {
      facedownValue: "printed",
      includeBoosts: false,
    });
    if (oppStrength >= 7000) priority += 2;

    return priority;
  }

  const ascDef = ascensionCard.def || 0;
  const isTank = ascDef >= 2500;

  return isTank ? 8 : 6;
}

export function detectLuminarchAscensionOpportunities(context) {
  const { game, bot, opponent } = context;
  const actions = [];

  try {
    const fortressPlan = getContextFinisherPlan(
      context,
      "ascension",
      FORTRESS_NAME,
    );
    bot.field.forEach((material, fieldIndex) => {
      if (!material || material.cardKind !== "monster") return;

      const canUse = game.canUseAsAscensionMaterial?.(bot, material);
      if (!canUse?.ok) return;

      const candidates =
        game.getAscensionCandidatesForMaterial?.(bot, material) || [];
      if (candidates.length === 0) return;

      const eligible = candidates.filter(
        (asc) => game.checkAscensionRequirements?.(bot, asc)?.ok,
      );
      if (eligible.length === 0) return;

      eligible.forEach((ascensionCard) => {
        const plannedForThisMaterial =
          fortressPlan &&
          ascensionCard.name === fortressPlan.targetName &&
          (fortressPlan.details?.materialInstanceId
            ? fortressPlan.details.materialInstanceId === material.instanceId
            : fortressPlan.details?.materialIndex === fieldIndex);
        const priority = plannedForThisMaterial
          ? Math.max(
              fortressPlan.details?.ascensionPriority || 0,
              evaluateLuminarchAscensionPriority(
                material,
                ascensionCard,
                bot,
                opponent,
                game,
              ),
            )
          : evaluateLuminarchAscensionPriority(
              material,
              ascensionCard,
              bot,
              opponent,
              game,
            );

        if (priority > 0) {
          actions.push({
            type: "ascension",
            materialIndex: fieldIndex,
            ascensionCard: ascensionCard,
            position: chooseLuminarchAscensionPosition(
              ascensionCard,
              bot,
              opponent,
            ),
            priority: priority,
            cardName: ascensionCard.name,
            materialName: material.name,
            finisherPlan: plannedForThisMaterial ? fortressPlan : null,
            reason: plannedForThisMaterial
              ? fortressPlan.reason
              : "ascension_opportunity",
          });
        }
      });
    });
  } catch (e) {
    console.warn(
      `[LuminarchStrategy] detectAscensionOpportunities error:`,
      e.message,
    );
  }

  return actions;
}

export function getLuminarchExtraDeckActions(context) {
  const { bot } = context;
  const actions = [];

  try {
    const ascensionActions = detectLuminarchAscensionOpportunities(context);
    if (ascensionActions.length > 0 && bot?.debug) {
      console.log(
        `[LuminarchStrategy] Ascension opportunities:`,
        ascensionActions.map((a) => `${a.cardName} (pri ${a.priority})`),
      );
    }
    actions.push(...ascensionActions);
  } catch (e) {
    // Silent ascension detection error
  }

  try {
    const fusionActions = detectLuminarchFusionOpportunities(context);
    if (fusionActions.length > 0 && bot?.debug) {
      console.log(
        `[LuminarchStrategy] Fusion opportunities:`,
        fusionActions.map((a) => `${a.cardName} (pri ${a.priority})`),
      );
    }
    actions.push(...fusionActions);
  } catch (e) {
    // Silent fusion detection error
  }

  return actions;
}
