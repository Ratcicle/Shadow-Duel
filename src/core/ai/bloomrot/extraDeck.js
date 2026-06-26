import { getGenericAscensionActions } from "../common/ascensionPlanning.js";
import { withFusionPreferences } from "../common/fusionPlanning.js";
import {
  BLOOMROT_NAMES,
  getSporeCount,
  isBloomrotMonster,
  isFaceUpBloomrotMonster,
} from "./analysis.js";

const N = {
  ROT_STAG: "Bloomrot Rot-Stag",
  GRAVECAP_WIDOW: "Bloomrot Gravecap Widow",
  ANCIENT_HUSK: "Bloomrot Ancient Husk",
  ANCIENT_MYCELIUM: BLOOMROT_NAMES.ANCIENT_MYCELIUM,
  QUEEN: BLOOMROT_NAMES.QUEEN,
  DEVOURER: BLOOMROT_NAMES.DEVOURER,
  TOKEN: BLOOMROT_NAMES.TOKEN,
};

const BLOOMROT_PAYOFF_NAMES = [
  N.GRAVECAP_WIDOW,
  N.ANCIENT_HUSK,
  N.ANCIENT_MYCELIUM,
  N.QUEEN,
  N.DEVOURER,
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function isFaceup(card) {
  return card && card.isFacedown !== true;
}

function effectiveAtk(card) {
  return (
    Number(card?.atk || 0) +
    Number(card?.tempAtkBoost || 0) +
    Number(card?.equipAtkBonus || 0)
  );
}

function effectiveDef(card) {
  return (
    Number(card?.def || 0) +
    Number(card?.tempDefBoost || 0) +
    Number(card?.equipDefBonus || 0)
  );
}

function monsterThreat(card) {
  if (!card || card.cardKind !== "monster") return 0;
  return Math.max(effectiveAtk(card), effectiveDef(card)) + Number(card.level || 0) * 100;
}

function getInstanceIds(card) {
  return [
    card?.instanceId,
    card?._instanceId,
    card?.uid,
    card?.uuid,
    card?.simInstanceId,
    card?.fieldPresenceId,
  ].filter((id) => id !== null && id !== undefined);
}

function getMaterialEffectActivations(game, player, material) {
  const playerId = player?.id;
  const materialId = material?.id;
  if (!playerId || materialId === undefined || materialId === null) return 0;
  return Number(
    game?.materialDuelStats?.[playerId]?.effectActivationsByMaterialId?.get?.(
      materialId,
    ) || 0,
  );
}

function getExtraDeckCard(bot, name) {
  return (bot?.extraDeck || []).find((card) => card?.name === name) || null;
}

function getPolymerizationIndex(bot) {
  return (bot?.hand || []).findIndex(
    (card) => card?.name === BLOOMROT_NAMES.POLYMERIZATION,
  );
}

function getFusionMaterialEntries(bot) {
  return [
    ...(bot?.hand || []).filter(isBloomrotMonster).map((card) => ({
      card,
      zone: "hand",
    })),
    ...(bot?.field || []).filter(isBloomrotMonster).map((card) => ({
      card,
      zone: "field",
    })),
  ];
}

function findDevourerCombos(game, bot, devourer) {
  const entries = getFusionMaterialEntries(bot);
  if (!devourer || !game?.effectEngine?.findFusionMaterialCombos) {
    return { entries, combos: [] };
  }

  const combos = game.effectEngine.findFusionMaterialCombos(
    devourer,
    entries.map((entry) => entry.card),
    {
      materialInfo: entries.map((entry) => ({ zone: entry.zone })),
    },
  );

  return {
    entries,
    combos: Array.isArray(combos) ? combos : [],
  };
}

function projectedCountersAfterMaterials(analysis = {}, combo = []) {
  const materialSpores = combo
    .filter((card) => asArray(analysis.field).includes(card))
    .reduce((sum, card) => sum + getSporeCount(card), 0);
  return Math.max(0, Number(analysis.fieldSporeTotal || 0) - materialSpores);
}

function hasToken(combo = []) {
  return combo.some((card) => card?.isToken === true || card?.name === N.TOKEN);
}

function lowValueMaterialScore(card) {
  let score = 0;
  if (!card) return 100;
  if (card.isToken) score -= 60;
  if (card.name === N.TOKEN) score -= 60;
  if (BLOOMROT_PAYOFF_NAMES.includes(card.name)) score += 50;
  if (getSporeCount(card) >= 3) score += 20 + getSporeCount(card) * 4;
  score += Math.max(0, Number(card.level || 0) - 4) * 5;
  score += Math.max(effectiveAtk(card), effectiveDef(card)) / 200;
  return score;
}

function chooseBestDevourerCombo(combos = [], analysis = {}) {
  return combos
    .filter((combo) => combo.length >= 4 && hasToken(combo))
    .map((combo) => {
      const projectedCounters = projectedCountersAfterMaterials(analysis, combo);
      const projectedAtk = projectedCounters * 500;
      const materialCost = combo.reduce(
        (sum, card) => sum + lowValueMaterialScore(card),
        0,
      );
      return {
        combo,
        projectedCounters,
        projectedAtk,
        materialCost,
        score: projectedAtk / 300 - materialCost / 15,
      };
    })
    .sort((a, b) => b.score - a.score)[0] || null;
}

function evaluateDevourerLine(game, bot, analysis = {}) {
  const devourer = getExtraDeckCard(bot, N.DEVOURER);
  const polyIndex = getPolymerizationIndex(bot);
  if (!devourer || polyIndex < 0) {
    return { viable: false, reason: "Devourer or Polymerization unavailable" };
  }

  const { combos } = findDevourerCombos(game, bot, devourer);
  const best = chooseBestDevourerCombo(combos, analysis);
  if (!best) {
    return { viable: false, reason: "No valid Devourer material combo" };
  }

  const sporedTargets = asArray(analysis.opponentSporedMonsters).filter(isFaceup);
  const relevantSporedTargets = sporedTargets.filter(
    (card) => getSporeCount(card) >= 2 || monsterThreat(card) >= 2100,
  );
  const strongestThreat = Math.max(
    0,
    ...asArray(analysis.opponentMonsters).map(monsterThreat),
  );
  const destroysMultiple = sporedTargets.length >= 2;
  const destroysThreat = relevantSporedTargets.length > 0;
  const relevantAtk =
    best.projectedAtk >= 2500 ||
    best.projectedAtk >= strongestThreat ||
    (best.projectedAtk >= 2000 && destroysThreat);
  const leavesNoBoard =
    asArray(analysis.faceUpBloomrotField).length <= best.combo.filter((card) =>
      asArray(analysis.field).includes(card),
    ).length;

  if (!relevantAtk && !destroysMultiple && !destroysThreat) {
    return { viable: false, reason: "Devourer projected impact is too low" };
  }
  if (leavesNoBoard && best.projectedAtk < 2500 && !destroysMultiple) {
    return { viable: false, reason: "Devourer would consume board for weak payoff" };
  }

  const priority =
    8.5 +
    Math.min(5, best.projectedAtk / 700) +
    (destroysMultiple ? 2 : 0) +
    (destroysThreat ? 1.5 : 0);

  return {
    viable: true,
    reason: destroysMultiple
      ? "Devourer clears multiple infected monsters"
      : destroysThreat
        ? "Devourer removes an infected threat"
        : "Devourer creates relevant Extra Deck pressure",
    devourer,
    polyIndex,
    combo: best.combo,
    projectedAtk: best.projectedAtk,
    priority,
  };
}

function buildFusionCostPreferences(combo = [], analysis = {}) {
  const fieldMaterials = asArray(analysis.field);
  const preferredInstanceIds = combo
    .filter((card) => card?.isToken || card?.name === N.TOKEN)
    .flatMap(getInstanceIds);
  const avoidInstanceIds = fieldMaterials
    .filter((card) => getSporeCount(card) >= 3)
    .flatMap(getInstanceIds);

  return {
    archetype: "Bloomrot",
    preferNames: [N.TOKEN],
    preserveNames: BLOOMROT_PAYOFF_NAMES,
    offensivePayoffNames: BLOOMROT_PAYOFF_NAMES,
    preserveLastOffensivePayoff: true,
    preferredInstanceIds,
    avoidInstanceIds,
  };
}

function buildDevourerActivationContext(baseContext, evaluation, analysis) {
  const context = {
    ...(baseContext || {}),
    autoSelectTargets: true,
    autoSelectSingleTarget: true,
    actionContext: {
      ...(baseContext?.actionContext || {}),
      costPreferences: buildFusionCostPreferences(evaluation.combo, analysis),
      fusionPositions: {
        ...(baseContext?.actionContext?.fusionPositions || {}),
        byName: {
          ...(baseContext?.actionContext?.fusionPositions?.byName || {}),
          [N.DEVOURER]: "attack",
        },
      },
    },
  };

  return withFusionPreferences(context, {
    target: N.DEVOURER,
    priority: evaluation.priority,
    reason: evaluation.reason,
  });
}

function buildDevourerAction({ game, bot, analysis, buildActivationContext }) {
  const evaluation = evaluateDevourerLine(game, bot, analysis);
  if (!evaluation.viable) return null;
  const poly = bot.hand[evaluation.polyIndex];
  if (!poly) return null;

  const baseContext = buildActivationContext?.(poly, analysis, {
    zone: "hand",
    activationZone: "hand",
    sourceZone: "hand",
    fromHand: true,
  }) || {};
  const activationContext = buildDevourerActivationContext(
    baseContext,
    evaluation,
    analysis,
  );

  if (game?.effectEngine?.canActivateSpellFromHandPreview) {
    const preview = game.effectEngine.canActivateSpellFromHandPreview(
      poly,
      bot,
      { activationContext },
    );
    if (preview && preview.ok === false) return null;
  }

  return {
    type: "spell",
    index: evaluation.polyIndex,
    cardId: poly.id,
    cardName: poly.name,
    fusionTarget: N.DEVOURER,
    priority: evaluation.priority,
    reason: evaluation.reason,
    activationContext,
  };
}

function hasFaceupOpponentMonster(analysis = {}) {
  return asArray(analysis.opponentMonsters).some(isFaceup);
}

function hasDefenseTarget(analysis = {}) {
  return asArray(analysis.opponentMonsters).some(
    (card) => isFaceup(card) && card.position === "defense",
  );
}

function underPressure(analysis = {}) {
  const lp = Number(analysis.lp || analysis.selfLp || analysis.selfLP || 8000);
  const totalThreat = asArray(analysis.opponentMonsters).reduce(
    (sum, card) => sum + Math.max(0, effectiveAtk(card)),
    0,
  );
  return totalThreat >= lp || totalThreat >= 4000;
}

function shouldSkipAscension(ascensionCard, material, context = {}) {
  const analysis = context.analysis || {};
  if (!isBloomrotMonster(material)) return true;

  if (ascensionCard?.name === N.ANCIENT_MYCELIUM) {
    const activations = getMaterialEffectActivations(context.game, context.bot, material);
    if (activations < 2) return true;
    return !hasFaceupOpponentMonster(analysis);
  }

  if (ascensionCard?.name === N.QUEEN) {
    if (!analysis.queenReady) return true;
    const payoff =
      hasFaceupOpponentMonster(analysis) ||
      underPressure(analysis) ||
      Number(analysis.lp || analysis.selfLp || 8000) <= 3500;
    return !payoff;
  }

  return true;
}

function evaluateAscensionPriority(ascensionCard, material, context = {}) {
  const analysis = context.analysis || {};
  if (ascensionCard?.name === N.ANCIENT_MYCELIUM) {
    return (
      8.5 +
      (hasDefenseTarget(analysis) ? 3 : 0) +
      (asArray(analysis.opponentSporedMonsters).length > 0 ? 1 : 0)
    );
  }
  if (ascensionCard?.name === N.QUEEN) {
    const opponentCount = asArray(analysis.opponentMonsters).filter(isFaceup).length;
    return (
      10.5 +
      Math.min(4, Number(analysis.fieldSporeTotal || 0) / 2) +
      (underPressure(analysis) ? 2 : 0) +
      Math.min(2, opponentCount)
    );
  }
  return 0;
}

function chooseAscensionPosition(ascensionCard, _material, context = {}) {
  const analysis = context.analysis || {};
  if (ascensionCard?.name === N.QUEEN) {
    return underPressure(analysis) ? "defense" : "attack";
  }
  if (ascensionCard?.name === N.ANCIENT_MYCELIUM) {
    return underPressure(analysis) ? "defense" : "defense";
  }
  return ascensionCard?.ascension?.position || "choice";
}

export function getBloomrotExtraDeckActions({
  game,
  bot,
  analysis,
  strategy,
} = {}) {
  if (!game || !bot || !analysis) return [];
  const buildActivationContext = strategy?.buildBloomrotActivationContext;
  const actions = [];

  actions.push(
    ...getGenericAscensionActions(
      {
        game,
        bot,
        opponent: analysis.opponent,
        analysis,
      },
      {
        shouldSkipAscension,
        evaluateAscensionPriority,
        chooseAscensionPosition,
        decorateAction: (action, ascensionCard, material) => ({
          ...action,
          cardId: ascensionCard?.id,
          materialId: material?.id,
          materialName: material?.name,
          reason:
            ascensionCard?.name === N.QUEEN
              ? "Queen payoff with 8+ Spore Counters"
              : "Ancient Mycelium Ascension payoff",
          activationContext:
            buildActivationContext?.(ascensionCard, analysis, {
              zone: "extraDeck",
              activationZone: "extraDeck",
              sourceZone: "extraDeck",
            }) || {},
        }),
      },
    ),
  );

  const devourerAction = buildDevourerAction({
    game,
    bot,
    analysis,
    buildActivationContext,
  });
  if (devourerAction) actions.push(devourerAction);

  return actions;
}

export const bloomrotExtraDeckInternals = {
  evaluateDevourerLine,
  buildFusionCostPreferences,
};
