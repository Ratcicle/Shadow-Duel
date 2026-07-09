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
const ETHEREAL_LANCER_NAME = "Luminarch Ethereal Lancer";
const FORTRESS_NAME = "Luminarch Fortress Aegis";
const PURE_KNIGHT_NAME = "Luminarch Pure Knight";
const CITADEL_NAME = "Sanctum of the Luminarch Citadel";
const RADIANT_LANCER_NAME = "Luminarch Radiant Lancer";
const AURORA_SERAPH_NAME = "Luminarch Aurora Seraph";
const CELESTIAL_MARSHAL_NAME = "Luminarch Celestial Marshal";
const MOONBLADE_CAPTAIN_NAME = "Luminarch Moonblade Captain";
const SANCTUM_PROTECTOR_NAME = "Luminarch Sanctum Protector";
const AEGISBEARER_NAME = "Luminarch Aegisbearer";

const LUMINARCH_PAYOFF_MATERIAL_NAMES = [
  BARBARIAS_NAME,
  ETHEREAL_LANCER_NAME,
  FORTRESS_NAME,
  RADIANT_LANCER_NAME,
  AURORA_SERAPH_NAME,
];

const LUMINARCH_PROTECTED_FUSION_MATERIAL_NAMES = [
  ...LUMINARCH_PAYOFF_MATERIAL_NAMES,
  CELESTIAL_MARSHAL_NAME,
  MOONBLADE_CAPTAIN_NAME,
  SANCTUM_PROTECTOR_NAME,
];

function uniqueNames(names) {
  return [...new Set((names || []).filter(Boolean))];
}

function mergeFusionCostPreferences(existing = {}) {
  return {
    ...existing,
    preserveNames: uniqueNames([
      ...(existing.preserveNames || []),
      ...LUMINARCH_PROTECTED_FUSION_MATERIAL_NAMES,
    ]),
    offensivePayoffNames: uniqueNames([
      ...(existing.offensivePayoffNames || []),
      ...LUMINARCH_PAYOFF_MATERIAL_NAMES,
    ]),
    preferNames: uniqueNames([
      ...(existing.preferNames || []),
      AEGISBEARER_NAME,
    ]),
  };
}

function getLuminarchFusionMaterialEntries(bot) {
  const handMaterials = (bot?.hand || [])
    .filter((c) => c && c.cardKind === "monster")
    .map((card) => ({ card, zone: "hand" }));
  const fieldMaterials = (bot?.field || [])
    .filter((c) => c && c.cardKind === "monster")
    .map((card) => ({ card, zone: "field" }));
  return [...handMaterials, ...fieldMaterials];
}

function findLuminarchFusionMaterialCombos(game, fusionCard, bot) {
  const entries = getLuminarchFusionMaterialEntries(bot);
  if (!fusionCard || !game?.effectEngine?.findFusionMaterialCombos) {
    return { entries, combos: [] };
  }

  const materials = entries.map((entry) => entry.card);
  const materialInfo = entries.map((entry) => ({ zone: entry.zone }));
  try {
    const combos =
      game.effectEngine.findFusionMaterialCombos(fusionCard, materials, {
        materialInfo,
      }) || [];
    return { entries, combos };
  } catch (error) {
    return { entries, combos: [] };
  }
}

function getMaterialZone(card, entries, bot) {
  const entry = entries.find((item) => item.card === card);
  if (entry?.zone) return entry.zone;
  if ((bot?.field || []).includes(card)) return "field";
  if ((bot?.hand || []).includes(card)) return "hand";
  return "unknown";
}

function getFieldMaterialValue(card, context = {}) {
  if (!card) return 0;
  const name = card.name || "";
  const baseStats = Math.max(card.atk || 0, card.def || 0) / 100;
  const protectedBonus = {
    [BARBARIAS_NAME]: 55,
    [ETHEREAL_LANCER_NAME]: 42,
    [FORTRESS_NAME]: 50,
    [RADIANT_LANCER_NAME]: 45,
    [AURORA_SERAPH_NAME]: 40,
    [CELESTIAL_MARSHAL_NAME]: 32,
    [MOONBLADE_CAPTAIN_NAME]: 26,
    [SANCTUM_PROTECTOR_NAME]: 24,
    [AEGISBEARER_NAME]: 14,
  }[name] || 0;
  const opponent = context.opponent;
  const oppStrongest = getStrongestAttackThreat(opponent?.field || [], {
    facedownValue: 1500,
    includeBoosts: false,
  });
  const defensiveRole =
    card.mustBeAttacked ||
    (card.position === "defense" && (card.def || 0) >= oppStrongest);
  return baseStats + protectedBonus + (defensiveRole ? 8 : 0);
}

function getHandMaterialValue(card) {
  if (!card) return 0;
  const baseStats = Math.max(card.atk || 0, card.def || 0) / 300;
  const protectedHandBonus = LUMINARCH_PROTECTED_FUSION_MATERIAL_NAMES.includes(
    card.name,
  )
    ? 6
    : 0;
  return baseStats + protectedHandBonus;
}

function getFusionBoardValue(fusionCard, context = {}) {
  if (!fusionCard) return 0;
  const baseStats = Math.max(fusionCard.atk || 0, fusionCard.def || 0) / 100;
  if (fusionCard.name === BARBARIAS_NAME) return baseStats + 38;
  if (fusionCard.name === ETHEREAL_LANCER_NAME) return baseStats + 28;
  if (fusionCard.name === FORTRESS_NAME) return baseStats + 34;
  if (fusionCard.name === PURE_KNIGHT_NAME) {
    const bot = context.bot;
    const hasCitadel = bot?.fieldSpell?.name === CITADEL_NAME;
    const hasCitadelInHand = (bot?.hand || []).some(
      (c) => c?.name === CITADEL_NAME,
    );
    const canSearchCitadel =
      !hasCitadel &&
      !hasCitadelInHand &&
      (bot?.deck || []).some((c) => c?.name === CITADEL_NAME);
    const hasLpCostSpell = (bot?.hand || []).some((card) =>
      [
        "Luminarch Holy Ascension",
        "Luminarch Radiant Wave",
        "Luminarch Sacred Judgment",
      ].includes(card?.name),
    );
    return baseStats + (canSearchCitadel ? 16 : 0) + (hasLpCostSpell ? 6 : 0);
  }
  return baseStats;
}

function evaluateFusionMaterialSpend(combo, fusionCard, context, entries) {
  const bot = context.bot;
  const fieldMaterials = [];
  const handMaterials = [];

  for (const material of combo || []) {
    const zone = getMaterialZone(material, entries, bot);
    if (zone === "field") fieldMaterials.push(material);
    else handMaterials.push(material);
  }

  const fieldMaterialValue = fieldMaterials.reduce(
    (sum, card) => sum + getFieldMaterialValue(card, context),
    0,
  );
  const handMaterialValue = handMaterials.reduce(
    (sum, card) => sum + getHandMaterialValue(card),
    0,
  );
  const fusionValue = getFusionBoardValue(fusionCard, context);
  const boardCompressionPenalty = Math.max(0, fieldMaterials.length - 1) * 10;
  const netBoardValue =
    fusionValue - fieldMaterialValue - boardCompressionPenalty;
  const protectedFieldMaterials = fieldMaterials.filter((card) =>
    LUMINARCH_PAYOFF_MATERIAL_NAMES.includes(card?.name),
  );

  return {
    combo,
    fieldMaterials,
    handMaterials,
    fieldMaterialValue,
    handMaterialValue,
    fusionValue,
    netBoardValue,
    protectedFieldMaterials,
    totalCostValue: fieldMaterialValue + handMaterialValue,
  };
}

function getBestFusionMaterialSpend(combos, fusionCard, context, entries) {
  const evaluated = (combos || []).map((combo) =>
    evaluateFusionMaterialSpend(combo, fusionCard, context, entries),
  );
  evaluated.sort((a, b) => a.totalCostValue - b.totalCostValue);
  return evaluated[0] || null;
}

function getPureKnightUtilityNeed(bot) {
  const hasCitadel = bot?.fieldSpell?.name === CITADEL_NAME;
  const hasCitadelInHand = (bot?.hand || []).some(
    (c) => c?.name === CITADEL_NAME,
  );
  const canSearchCitadel =
    !hasCitadel &&
    !hasCitadelInHand &&
    (bot?.deck || []).some((c) => c?.name === CITADEL_NAME);
  const hasLpCostSpell = (bot?.hand || []).some((card) =>
    [
      "Luminarch Holy Ascension",
      "Luminarch Radiant Wave",
      "Luminarch Sacred Judgment",
    ].includes(card?.name),
  );
  return {
    hasCitadel,
    canSearchCitadel,
    needsDiscountNow: hasLpCostSpell && (bot?.lp || 8000) <= 3000,
  };
}

function shouldSkipLuminarchFusionAction({
  targetName,
  fusionCard,
  context,
  materialCombos,
  materialEntries,
}) {
  if (targetName !== PURE_KNIGHT_NAME || !materialCombos?.length) {
    return { skip: false, spend: null };
  }

  const spend = getBestFusionMaterialSpend(
    materialCombos,
    fusionCard,
    context,
    materialEntries,
  );
  if (!spend) return { skip: false, spend: null };

  const utility = getPureKnightUtilityNeed(context.bot);
  const battleAlreadyPassed = ["main2", "end"].includes(context.game?.phase);
  const consumesPremiumFieldMaterial =
    spend.protectedFieldMaterials.length > 0;
  const consumesEstablishedBoard =
    spend.fieldMaterials.length >= 2 && spend.fieldMaterialValue >= 65;
  const hasNoImmediatePureKnightNeed =
    utility.hasCitadel ||
    (!utility.canSearchCitadel && !utility.needsDiscountNow);
  const severeDowngrade = spend.netBoardValue <= -25;

  if (
    consumesPremiumFieldMaterial &&
    hasNoImmediatePureKnightNeed &&
    (battleAlreadyPassed || severeDowngrade)
  ) {
    return {
      skip: true,
      spend,
      reason: "pure_knight_premium_material_downgrade",
    };
  }

  if (battleAlreadyPassed && consumesEstablishedBoard && severeDowngrade) {
    return { skip: true, spend, reason: "pure_knight_main2_board_downgrade" };
  }

  return { skip: false, spend };
}

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
  const targetName = fusionPlan?.targetName || BARBARIAS_NAME;
  const defaultPosition =
    targetName === BARBARIAS_NAME
      ? fusionPlan?.details?.position || "defense"
      : fusionPlan?.details?.position || "defense";
  const currentActionContext = context.activationContext?.actionContext || {};
  const baseContext = {
    ...(context.activationContext || {}),
    autoSelectSingleTarget: true,
    autoSelectTargets: true,
    logTargets: false,
    actionContext: {
      ...currentActionContext,
      costPreferences: mergeFusionCostPreferences(
        currentActionContext.costPreferences || {},
      ),
      fusionPositions: {
        ...(currentActionContext.fusionPositions || {}),
        byName: {
          ...(currentActionContext.fusionPositions?.byName || {}),
          [targetName]: defaultPosition,
        },
      },
    },
  };

  return withFusionPreferences(baseContext, {
    target: targetName,
    priority:
      fusionPlan?.details?.spellPriority || fusionPlan?.actionPriority || 0,
    reason: fusionPlan?.reason || `fusion_${targetName}`,
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
    const oppStrongest = getStrongestAttackThreat(opponent?.field || [], {
      facedownValue: 1500,
      includeBoosts: false,
    });
    const hasStableWall = (bot.field || []).some(
      (c) =>
        c &&
        c.cardKind === "monster" &&
        !c.isFacedown &&
        (c.mustBeAttacked ||
          (c.position === "defense" && (c.def || 0) >= oppStrongest)),
    );
    const underRealPressure =
      oppStrength >= lp || (oppStrongest >= 2200 && !hasStableWall);
    if (oppStrength >= 8000) priority += 3;
    else if (oppStrength >= 6000) priority += 1;
    if (!hasStableWall) priority += 3;
    if (underRealPressure) priority += 4;

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

  if (fusionName === PURE_KNIGHT_NAME) {
    let priority = 11;

    const hasCitadel = bot.fieldSpell?.name === CITADEL_NAME;
    const hasCitadelInHand = (bot.hand || []).some(
      (c) => c?.name === CITADEL_NAME,
    );
    const hasCitadelInDeck = (bot.deck || []).some(
      (c) => c?.name === CITADEL_NAME,
    );
    if (!hasCitadel && !hasCitadelInHand && hasCitadelInDeck) priority += 5;
    else if (!hasCitadel) priority += 2;

    const lp = bot.lp || 8000;
    const hasLpCostSpell = (bot.hand || []).some((card) =>
      [
        "Luminarch Holy Ascension",
        "Luminarch Radiant Wave",
        "Luminarch Sacred Judgment",
      ].includes(card?.name),
    );
    if (hasLpCostSpell) priority += 2;
    if (lp <= 3000) priority += 1;

    const hasBarbariasWall = (bot.field || []).some(
      (c) => c?.name === BARBARIAS_NAME || c?.name === FORTRESS_NAME,
    );
    if (hasBarbariasWall && hasCitadel) priority -= 7;
    if (hasCitadel && ["main2", "end"].includes(game?.phase)) priority -= 4;
    const oppStrength = getTotalAttackThreat(opponent?.field || [], {
      facedownValue: "printed",
      includeBoosts: false,
    });
    const oppStrongest = getStrongestAttackThreat(opponent?.field || [], {
      facedownValue: 1500,
      includeBoosts: false,
    });
    const hasStableWall = (bot.field || []).some(
      (c) =>
        c &&
        c.cardKind === "monster" &&
        !c.isFacedown &&
        (c.mustBeAttacked ||
          (c.position === "defense" && (c.def || 0) >= oppStrongest)),
    );
    if (!hasBarbariasWall && !hasStableWall && oppStrength >= lp) priority -= 3;

    return priority;
  }

  return 6;
}

function canSummonFusionTarget(game, fusionCard, bot) {
  if (!fusionCard) return false;
  if (!game?.effectEngine?.canSummonFusion) return true;
  const combined = getLuminarchFusionMaterialEntries(bot);
  const materials = combined.map((entry) => entry.card);
  const materialInfo = combined.map((entry) => ({ zone: entry.zone }));
  return game.effectEngine.canSummonFusion(fusionCard, materials, bot, {
    materialInfo,
  });
}

export function detectLuminarchFusionOpportunities(context) {
  const { game, bot, opponent, hooks = {} } = context;
  const actions = [];

  try {
    const polyInHand = bot.hand.findIndex(
      (c) => c && c.name === "Polymerization",
    );
    if (polyInHand === -1) return actions;
    const polyCard = bot.hand[polyInHand];
    if (!polyCard) return actions;

    const fusionCandidates = [PURE_KNIGHT_NAME, BARBARIAS_NAME]
      .map((targetName) => ({
        targetName,
        fusionCard: (bot.extraDeck || []).find((c) => c?.name === targetName),
        fusionPlan: getContextFinisherPlan(context, "fusion", targetName),
      }))
      .filter((entry) => entry.fusionCard);

    for (const entry of fusionCandidates) {
      const { targetName, fusionCard, fusionPlan } = entry;
      if (!canSummonFusionTarget(game, fusionCard, bot)) continue;
      const { entries: materialEntries, combos: materialCombos } =
        findLuminarchFusionMaterialCombos(game, fusionCard, bot);
      const skipCheck = shouldSkipLuminarchFusionAction({
        targetName,
        fusionCard,
        context: { ...context, bot, opponent, game },
        materialCombos,
        materialEntries,
      });
      if (skipCheck.skip) {
        if (bot?.debug) {
          console.log(
            `[LuminarchStrategy] Skipping ${targetName}: ${skipCheck.reason}`,
            {
              materials: skipCheck.spend?.combo?.map((card) => card?.name),
              netBoardValue: skipCheck.spend?.netBoardValue,
            },
          );
        }
        continue;
      }

      const activationContext = buildLuminarchFusionActivationContext(context, {
        ...(fusionPlan || {}),
        targetName,
      });

      if (game?.effectEngine?.canActivateSpellFromHandPreview) {
        const preview = game.effectEngine.canActivateSpellFromHandPreview(
          polyCard,
          bot,
          { activationContext },
        );
        if (preview && preview.ok === false) continue;
      }

      const priority =
        fusionPlan?.details?.spellPriority ||
        evaluateLuminarchFusionPriority(
          targetName,
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
          fusionTarget: targetName,
          reason:
            fusionPlan?.reason ||
            (targetName === PURE_KNIGHT_NAME
              ? "fusion_to_pure_knight_citadel_access"
              : "fusion_to_barbarias_wall"),
          finisherPlan: fusionPlan,
          activationContext,
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
  if (ascensionCard.name === ETHEREAL_LANCER_NAME) return "attack";
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

  if (name === ETHEREAL_LANCER_NAME) {
    let priority = 10;
    const otherFaceupLuminarch = (bot?.field || []).some(
      (card) =>
        card &&
        card !== material &&
        card.cardKind === "monster" &&
        card.archetype === "Luminarch" &&
        !card.isFacedown,
    );
    if (otherFaceupLuminarch) priority += 2;

    const defenseTargets = (opponent?.field || []).filter(
      (card) =>
        card &&
        card.cardKind === "monster" &&
        card.position === "defense" &&
        !card.isFacedown,
    );
    if (defenseTargets.length > 0) priority += 2;

    const oppStrongest = getStrongestAttackThreat(opponent?.field || [], {
      facedownValue: 1500,
      includeBoosts: false,
    });
    if ((ascensionCard.atk || 0) >= oppStrongest + 200) priority += 1;

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
