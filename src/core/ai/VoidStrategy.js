import BaseStrategy from "./BaseStrategy.js";
import { estimateCardValue, estimateMonsterValue } from "./StrategyUtils.js";
import { applyGenericSimulatedMainPhaseAction } from "./common/simulation.js";
import {
  isVoid,
  getVoidCardKnowledge,
  VOID_EXTRA_DECK_IDS,
} from "./void/knowledge.js";
import {
  assessVoidNormalSummonEntry,
  assessVoidSummonEntry,
  evaluateVoidFinisherPlans,
  evaluateVoidFusionPriority,
  shouldPlayVoidSpell,
  shouldSummonVoidMonster,
} from "./void/priorities.js";
import {
  VOID_IDS,
  COMBO_DATABASE,
  detectAvailableCombos,
  getComboSequence,
  calculateFusionValue,
} from "./void/combos.js";
import {
  evaluateBoardVoid,
  evaluateVoidMonster,
  analyzeHollowEconomy,
  assessVoidHollowResourcePolicy,
} from "./void/scoring.js";
import {
  buildVoidActivationContext,
  buildVoidTributePolicy,
} from "./void/costPolicy.js";
import { selectBestTributes as selectBestTributesGeneric } from "./common/tributePolicy.js";
import { getEffectiveStat } from "./common/cardStats.js";
import {
  validateFieldIgnitionCandidate as validateVoidFieldIgnitionCandidate,
  validateHandIgnitionCandidate as validateVoidHandIgnitionCandidate,
} from "./common/actionValidation.js";
import {
  getFusionPreferenceScore,
  withFusionPreferences,
} from "./common/fusionPlanning.js";
import {
  buildVoidPlanningProfile,
  describeVoidPlannedLine,
  scoreVoidLineMilestones,
  scoreVoidLineTerminal,
} from "./void/linePlanning.js";

const CONJURER_REVIVE_PROTECTED_COST_IDS = new Set([
  VOID_IDS.ARCTURUS,
  VOID_IDS.HOLLOW_KING,
  VOID_IDS.BERSERKER,
  VOID_IDS.HYDRA_TITAN,
  VOID_IDS.COSMIC_WALKER,
  VOID_IDS.MALICIOUS_DEMON,
  VOID_IDS.SLAYER_BRUTE,
  VOID_IDS.SERPENT_DRAKE,
  VOID_IDS.THOUSAND_ARMS,
]);

function getEffectiveBattleStat(card, stat) {
  return getEffectiveStat(card, stat, { includeEquip: false });
}

function getOpponentStrongestBattleStat(analysis = {}) {
  const fromAnalysis = Number(analysis.oppStrongestAtk || 0);
  if (fromAnalysis > 0) return fromAnalysis;
  return (analysis.oppField || []).reduce((max, card) => {
    if (!card || card.cardKind !== "monster") return max;
    if (card.isFacedown) return Math.max(max, 1500);
    return Math.max(max, getEffectiveBattleStat(card, "atk"));
  }, 0);
}

function getArcturusSoloBuffState(player) {
  const faceUpMonsters = (player?.field || []).filter(
    (card) => card && card.cardKind === "monster" && !card.isFacedown,
  );
  const arcturus = faceUpMonsters.find(
    (card) => card?.id === VOID_IDS.ARCTURUS,
  );
  if (!arcturus) {
    return {
      arcturus: null,
      isSolo: false,
      voidsInGY: 0,
      soloBonus: 0,
      projectedAtk: 0,
    };
  }

  const voidsInGY = (player?.graveyard || []).filter(isVoid).length;
  const soloBonus = voidsInGY * 100;
  return {
    arcturus,
    isSolo: faceUpMonsters.length === 1,
    voidsInGY,
    soloBonus,
    projectedAtk: getEffectiveBattleStat(arcturus, "atk") + soloBonus,
  };
}

function shouldPreserveArcturusSoloBuff(player, opponent, analysis = {}) {
  const state = getArcturusSoloBuffState(player);
  if (!state.isSolo || state.soloBonus <= 0) return false;

  const strongestThreat = getOpponentStrongestBattleStat(analysis);
  const opponentLP = opponent?.lp || analysis.oppLP || 8000;
  return (
    state.projectedAtk >= opponentLP ||
    state.projectedAtk > strongestThreat ||
    state.soloBonus >= 300
  );
}

function assessConjurerReviveCostRisk(card, analysis = {}) {
  const knowledge = getVoidCardKnowledge(card);
  const protectedBoss =
    CONJURER_REVIVE_PROTECTED_COST_IDS.has(card?.id) ||
    knowledge?.role === "boss" ||
    knowledge?.role === "fusion_boss" ||
    knowledge?.role === "ascension_boss";

  const def = getEffectiveBattleStat(card, "def");
  const atk = getEffectiveBattleStat(card, "atk");
  const strongestThreat = getOpponentStrongestBattleStat(analysis);
  const canStillWall =
    def > 0 && (strongestThreat <= 0 || def >= strongestThreat || def >= atk);

  if (!protectedBoss) {
    return { protectedBoss: false, canStillWall, strongestThreat };
  }

  const reason = canStillWall
    ? "protected boss can still hold the field in defense"
    : "protected boss is not valid Conjurer revive cost";

  return { protectedBoss: true, canStillWall, strongestThreat, reason };
}

const MIRROR_DIMENSION_RANKS = new Map([
  [VOID_IDS.CONJURER, 100],
  [VOID_IDS.WALKER, 90],
  [VOID_IDS.TENEBRIS_HORN, 80],
  [VOID_IDS.BEAST, 70],
  [VOID_IDS.FORGOTTEN_KNIGHT, 100],
  [VOID_IDS.HAUNTER, 90],
  [VOID_IDS.THOUSAND_ARMS, 100],
  [VOID_IDS.SERPENT_DRAKE, 90],
  [VOID_IDS.BONE_SPIDER, 80],
  [VOID_IDS.SLAYER_BRUTE, 100],
  [VOID_IDS.ARCTURUS, 100],
]);

function isMirrorDimensionContext(source, action = {}) {
  return (
    source?.id === VOID_IDS.MIRROR_DIMENSION ||
    source?.name === "Void Mirror Dimension" ||
    action?.type === "special_summon_matching_level"
  );
}

function getMirrorDimensionCandidateScore(card) {
  if (!card || card.cardKind !== "monster") return -100;
  if (card.id === VOID_IDS.RAVEN) return -80;
  if (card.id === VOID_IDS.HOLLOW) return -25;
  if (MIRROR_DIMENSION_RANKS.has(card.id)) {
    return MIRROR_DIMENSION_RANKS.get(card.id);
  }
  if (isVoid(card) && (card.level || 0) >= 4) return 35;
  return 10;
}

function isUsefulMirrorDimensionHandMonster(card) {
  return getMirrorDimensionCandidateScore(card) > 0;
}

function getLikelyOpponentSummonLevels(opponent) {
  const zones = [
    ...(opponent?.hand || []),
    ...(opponent?.extraDeck || []),
  ];
  return new Set(
    zones
      .filter((card) => card?.cardKind === "monster" && Number.isFinite(card.level))
      .map((card) => card.level),
  );
}

function evaluateMirrorDimensionSetup(bot, opponent, mirrorCard) {
  const usefulHandMonsters = (bot?.hand || []).filter(
    (candidate) =>
      candidate !== mirrorCard && isUsefulMirrorDimensionHandMonster(candidate),
  );
  if (usefulHandMonsters.length === 0) {
    return { ok: false, priority: 0, usefulHandMonsters: [] };
  }

  const likelyLevels = getLikelyOpponentSummonLevels(opponent);
  const matchingMonsters =
    likelyLevels.size > 0
      ? usefulHandMonsters.filter((candidate) =>
          likelyLevels.has(candidate.level),
        )
      : [];
  if (matchingMonsters.length === 0) {
    return { ok: false, priority: 0, usefulHandMonsters, matchingMonsters };
  }

  const highImpact = matchingMonsters.filter(
    (candidate) => getMirrorDimensionCandidateScore(candidate) >= 70,
  ).length;
  const priority =
    4.2 +
    Math.min(matchingMonsters.length, 3) * 0.25 +
    Math.min(highImpact, 2) * 0.45;

  return { ok: true, priority, usefulHandMonsters, matchingMonsters };
}

function hasImmediateVoidFusionPlan(bot) {
  const handIds = (bot?.hand || []).map((card) => card?.id).filter(Boolean);
  if (!handIds.includes(VOID_IDS.POLYMERIZATION)) return false;
  const fusionEval = evaluateVoidFusionPriority(bot);
  return (fusionEval?.priority || 0) >= 9;
}

function getMaterialEffectActivationCount(game, player, materialId) {
  const playerId = player?.id || player;
  const readMapLike = (value) => {
    if (!value) return 0;
    if (typeof value.get === "function") return value.get(materialId) || 0;
    return value[materialId] || value[String(materialId)] || 0;
  };
  const realGame = game?._gameRef || game;
  const realCount = readMapLike(
    realGame?.materialDuelStats?.[playerId]?.effectActivationsByMaterialId,
  );
  const simCount =
    readMapLike(
      game?._simMaterialEffectActivationsByMaterialId?.[playerId],
    ) +
    readMapLike(player?._simMaterialEffectActivationsByMaterialId);
  return realCount + simCount;
}

function isMaliciousAscensionReady(game, player, material) {
  if (!game || !player || material?.id !== VOID_IDS.THOUSAND_ARMS) {
    return false;
  }
  const realGame = game?._gameRef || game;
  const malicious = (player.extraDeck || []).find(
    (card) => card?.id === VOID_IDS.MALICIOUS_DEMON,
  );
  if (!malicious) return false;
  const materialCheck = realGame.canUseAsAscensionMaterial?.(player, material);
  if (materialCheck && materialCheck.ok === false) return false;
  const requirementCheck = realGame.checkAscensionRequirements?.(
    player,
    malicious,
  );
  return requirementCheck?.ok === true;
}

function getThousandArmsMaliciousSetup(game, player, material) {
  if (!game || !player || material?.id !== VOID_IDS.THOUSAND_ARMS) {
    return {
      hasMalicious: false,
      activations: 0,
      requirementsMet: false,
      canAscendNow: false,
      shouldHoldForAscension: false,
      shouldDelayFreshBounce: false,
    };
  }

  const realGame = game?._gameRef || game;
  const malicious = (player.extraDeck || []).find(
    (card) => card?.id === VOID_IDS.MALICIOUS_DEMON,
  );
  const activations = getMaterialEffectActivationCount(
    realGame,
    player,
    VOID_IDS.THOUSAND_ARMS,
  );

  if (!malicious) {
    return {
      hasMalicious: false,
      activations,
      requirementsMet: false,
      canAscendNow: false,
      shouldHoldForAscension: false,
      shouldDelayFreshBounce: false,
    };
  }

  const requirementCheck = realGame.checkAscensionRequirements?.(
    player,
    malicious,
  );
  const requirementsMet =
    requirementCheck?.ok === true ||
    (typeof requirementCheck?.ok !== "boolean" && activations >= 2);
  const materialCheck = realGame.canUseAsAscensionMaterial?.(player, material);
  const canAscendNow =
    requirementsMet && (materialCheck?.ok !== false || !materialCheck);
  const onField = (player.field || []).includes(material);
  const tooFreshForAscension =
    materialCheck?.ok === false &&
    String(materialCheck.reason || "").includes("at least 1 turn");

  return {
    hasMalicious: true,
    activations,
    requirementsMet,
    canAscendNow,
    tooFreshForAscension,
    shouldHoldForAscension:
      onField && requirementsMet && (canAscendNow || tooFreshForAscension),
    shouldDelayFreshBounce: onField && !requirementsMet && tooFreshForAscension,
  };
}

function getSimulatedVoidAscensionCandidates(game, player, material) {
  if (!player || !material || material.cardKind !== "monster" || material.isFacedown) {
    return [];
  }
  return (player.extraDeck || []).filter((candidate) => {
    if (!candidate || candidate.monsterType !== "ascension") return false;
    if (candidate.ascension?.materialId !== material.id) return false;
    const requirements = candidate.ascension?.requirements || [];
    return requirements.every((requirement) => {
      if (requirement?.type !== "material_effect_activations") return true;
      const required = Number(requirement.count || 0);
      return getMaterialEffectActivationCount(game, player, material.id) >= required;
    });
  });
}

export default class VoidStrategy extends BaseStrategy {
  constructor(bot) {
    super(bot);
    // Estado de análise atual
    this.currentAnalysis = null;
    this.thoughtProcess = [];
    this.knownCombos = COMBO_DATABASE;
  }

  /**
   * Avaliação de board usando a nova lógica Void-específica.
   * Mantém compatibilidade com evaluateBoard mas usa evaluateBoardVoid internamente.
   */
  evaluateBoard(gameOrState, perspectivePlayer) {
    return evaluateBoardVoid(gameOrState, perspectivePlayer);
  }

  evaluateBoardV2(gameOrState, perspectivePlayer) {
    return evaluateBoardVoid(gameOrState, perspectivePlayer);
  }

  getPlanningProfile(game, context = {}) {
    const analysis = context.analysis || this.analyzeGameState(game);
    return buildVoidPlanningProfile(analysis, {
      ...context,
      game,
      strategy: this,
    });
  }

  shouldUseDeepPlanning(game, context = {}) {
    const profile =
      context.profile || this.getPlanningProfile(game, context);
    return game?.turnLineSearchEnabled === true || profile.enabled === true;
  }

  scoreLineMilestones(context = {}) {
    return scoreVoidLineMilestones(context);
  }

  scoreLineTerminal(context = {}) {
    return scoreVoidLineTerminal(context);
  }

  describePlannedLine(context = {}) {
    return describeVoidPlannedLine(context);
  }

  /**
   * Analisa o estado atual e detecta combos disponíveis.
   */
  analyzeGameState(game) {
    this.thoughtProcess = [];
    const isSimulatedState = game._isPerspectiveState === true;
    const bot = isSimulatedState ? game.bot : this.bot || game.bot;
    const opponent = this.getOpponent(game, bot);

    const analysis = {
      // Recursos próprios
      hand: bot.hand || [],
      deck: bot.deck || [],
      field: bot.field || [],
      graveyard: bot.graveyard || [],
      extraDeck: bot.extraDeck || [],
      spellTrap: bot.spellTrap || [],
      fieldSpell: bot.fieldSpell,
      lp: bot.lp || 8000,
      bot,
      opponent,
      phase: game?.phase,
      summonAvailable:
        (bot.summonCount || 0) < 1 + (bot.additionalNormalSummons || 0),

      // Recursos do oponente
      oppField: opponent?.field || [],
      oppHand: opponent?.hand || [],
      oppGraveyard: opponent?.graveyard || [],
      oppSpellTrap: opponent?.spellTrap || [],
      oppFieldSpell: opponent?.fieldSpell,
      oppLP: opponent?.lp || 8000,

      // Métricas calculadas
      oppFieldCount: (opponent?.field || []).length,
      oppStrongestAtk: (opponent?.field || []).reduce((max, m) => {
        if (!m || m.cardKind !== "monster") return max;
        const atk = m.isFacedown ? 1500 : (m.atk || 0) + (m.tempAtkBoost || 0);
        return Math.max(max, atk);
      }, 0),
      oppStrongestBattle: (opponent?.field || []).reduce((max, m) => {
        if (!m || m.cardKind !== "monster") return max;
        if (m.isFacedown) return Math.max(max, 1500);
        const stat =
          m.position === "defense"
            ? (m.def || 0) + (m.tempDefBoost || 0)
            : (m.atk || 0) + (m.tempAtkBoost || 0);
        return Math.max(max, stat);
      }, 0),
      myStrongestAtk: (bot.field || []).reduce((max, m) => {
        if (!m || m.cardKind !== "monster") return max;
        return Math.max(max, (m.atk || 0) + (m.tempAtkBoost || 0));
      }, 0),
      hollowCount: (bot.field || []).filter((m) => m?.id === VOID_IDS.HOLLOW)
        .length,
      voidCount: (bot.field || []).filter(isVoid).length,
      hollowsInHand: (bot.hand || []).filter((m) => m?.id === VOID_IDS.HOLLOW)
        .length,
      myLP: bot.lp || 8000,
    };

    // Detectar combos disponíveis
    analysis.availableCombos = detectAvailableCombos(analysis);
    analysis.readyCombos = analysis.availableCombos.filter((c) => c.ready);

    // Analisar economia de Hollows (campo, mão, GY, acessibilidade)
    analysis.hollowEconomy = analyzeHollowEconomy(analysis);

    // Analisar payoffs disponíveis para swarm
    analysis.swarmPayoffs = this.analyzeSwarmPayoffs(analysis);
    analysis.finisherPlans = evaluateVoidFinisherPlans(
      bot,
      opponent,
      game,
      analysis,
    );
    analysis.bestFinisherPlan = analysis.finisherPlans[0] || null;
    analysis.hollowResourcePolicy = assessVoidHollowResourcePolicy(analysis);

    // Determinar estratégia macro
    analysis.macroStrategy = this.decideMacroStrategy(analysis);

    this.currentAnalysis = analysis;
    return analysis;
  }

  /**
   * Analisa quais payoffs estão disponíveis para justificar um swarm de Hollows.
   * Swarm sem payoff = campo fraco que será destruído.
   */
  analyzeSwarmPayoffs(analysis) {
    const { hand, field, graveyard, extraDeck } = analysis;
    const handIds = (hand || []).map((c) => c?.id).filter(Boolean);
    const gyIds = (graveyard || []).map((c) => c?.id).filter(Boolean);
    const extraIds = (extraDeck || []).map((c) => c?.id).filter(Boolean);
    const hollowsOnField = (field || []).filter(
      (m) => m?.id === VOID_IDS.HOLLOW,
    ).length;
    const hollowsInHand = handIds.filter((id) => id === VOID_IDS.HOLLOW).length;
    const hollowsInGY = gyIds.filter((id) => id === VOID_IDS.HOLLOW).length;
    const voidCountTotal =
      (hand || []).filter(isVoid).length + (field || []).filter(isVoid).length;

    const payoffs = {
      hasBossPayoff: false, // Tem boss para tributar Hollows
      hasFusionPayoff: false, // Pode fazer fusão com Hollows
      hasGYPayoff: false, // Pode usar Hollows no GY (Haunter revive)
      totalPayoffValue: 0,
      reasons: [],
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // BOSS PAYOFFS: Monstros que tributam Hollows/Voids
    // ═══════════════════════════════════════════════════════════════════════════

    // Haunter (tributa 1 Hollow → 2100 ATK, pode reviver 3 depois)
    if (handIds.includes(VOID_IDS.HAUNTER)) {
      payoffs.hasBossPayoff = true;
      payoffs.totalPayoffValue += 3.5;
      payoffs.reasons.push("Haunter pode tributar Hollow e reviver depois");
    }

    // Slayer Brute (tributa 2 Voids → 2500 ATK com banish)
    if (handIds.includes(VOID_IDS.SLAYER_BRUTE)) {
      payoffs.hasBossPayoff = true;
      payoffs.totalPayoffValue += 4.0;
      payoffs.reasons.push("Slayer Brute pode tributar 2 Voids");
    }

    // Serpent Drake (tributa 1-3 Hollows → 2300+ ATK com bônus)
    if (handIds.includes(VOID_IDS.SERPENT_DRAKE)) {
      payoffs.hasBossPayoff = true;
      payoffs.totalPayoffValue += 3.5;
      payoffs.reasons.push("Serpent Drake escala com Hollows tributados");
    }

    // Forgotten Knight (tributa 1 Void → 2000 ATK)
    if (handIds.includes(VOID_IDS.FORGOTTEN_KNIGHT)) {
      payoffs.hasBossPayoff = true;
      payoffs.totalPayoffValue += 2.0;
      payoffs.reasons.push("Forgotten Knight pode tributar Void");
    }

    // Thousand-Arms (tributa 1 Void → 2100 ATK + bounce-revive 2 Hollows do GY com +700)
    if (handIds.includes(VOID_IDS.THOUSAND_ARMS)) {
      payoffs.hasBossPayoff = true;
      payoffs.totalPayoffValue += 3.5;
      payoffs.reasons.push(
        "Thousand-Arms tributa Void e habilita bounce-revive de Hollows do GY",
      );
    }

    // Arcturus (2 tributos → 2800 ATK + lock de BP + scaling com Voids no GY)
    if (handIds.includes(VOID_IDS.ARCTURUS)) {
      payoffs.hasBossPayoff = true;
      payoffs.totalPayoffValue += 5.0;
      payoffs.reasons.push(
        "Arcturus Lord of the Void: 2800 ATK + lock de Battle Phase + GY scaling",
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FUSION PAYOFFS
    // ═══════════════════════════════════════════════════════════════════════════
    const hasPoly = handIds.includes(VOID_IDS.POLYMERIZATION);

    // Hollow King (3 Hollows)
    if (hasPoly && extraIds.includes(VOID_IDS.HOLLOW_KING)) {
      const potentialHollows = hollowsOnField + hollowsInHand + 2; // +2 do combo
      if (potentialHollows >= 3) {
        payoffs.hasFusionPayoff = true;
        payoffs.totalPayoffValue += 4.5;
        payoffs.reasons.push("Hollow King fusion possível");
      }
    }

    // Hydra Titan (6 Voids)
    if (hasPoly && extraIds.includes(VOID_IDS.HYDRA_TITAN)) {
      const potentialVoids = voidCountTotal + 2; // +2 do combo (Hollows extras)
      if (potentialVoids >= 5) {
        // Quase lá
        payoffs.hasFusionPayoff = true;
        payoffs.totalPayoffValue += 5.0;
        payoffs.reasons.push("Hydra Titan fusion próxima");
      }
    }

    // Berserker (Slayer no campo + Void) - precisa Slayer primeiro
    if (hasPoly && extraIds.includes(VOID_IDS.BERSERKER)) {
      if (handIds.includes(VOID_IDS.SLAYER_BRUTE)) {
        payoffs.hasFusionPayoff = true;
        payoffs.totalPayoffValue += 4.0;
        payoffs.reasons.push("Berserker fusion via Slayer");
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GY PAYOFFS: Hollows no cemitério são recurso
    // ═══════════════════════════════════════════════════════════════════════════

    // Haunter no GY pode reviver até 3 Hollows
    if (gyIds.includes(VOID_IDS.HAUNTER) && hollowsInGY >= 1) {
      payoffs.hasGYPayoff = true;
      payoffs.totalPayoffValue += 2.0;
      payoffs.reasons.push("Haunter no GY pode reviver Hollows");
    }

    // Conjurer no GY pode se reviver (tributa Void do campo)
    if (gyIds.includes(VOID_IDS.CONJURER)) {
      payoffs.hasGYPayoff = true;
      payoffs.totalPayoffValue += 1.5;
      payoffs.reasons.push("Conjurer pode se reviver do GY");
    }

    // Tenebris Horn no GY (once per duel revive)
    if (gyIds.includes(VOID_IDS.TENEBRIS_HORN)) {
      payoffs.hasGYPayoff = true;
      payoffs.totalPayoffValue += 1.0;
      payoffs.reasons.push("Tenebris Horn pode se reviver");
    }

    return payoffs;
  }

  /**
   * Avalia qual monstro recrutar do deck (ex: Conjurer effect).
   * Considera sinergia com o estado atual, não apenas ATK.
   *
   * REGRA CHAVE: Walker > Hollow (se Hollow na mão), porque:
   * - Walker pode bounce e SS Hollow da mão
   * - Hollow SS da mão recruta outro Hollow
   * - Resultado: 3 bodies vs 2 bodies
   *
   * @param {Array} candidates - Cartas candidatas para recrutar
   * @param {Object} context - Contexto (source, game, etc)
   * @returns {Object} - { best, scores, reasoning }
   */
  evaluateRecruitCandidate(candidates, context = {}) {
    if (!candidates || candidates.length === 0) {
      return { best: null, scores: [], reasoning: "No candidates" };
    }

    const game = context.game || this.bot?.game;
    const bot = context.player || this.bot || game?.bot;
    const analysis = this.currentAnalysis || this.analyzeGameState(game);
    const hollowEconomy = analysis?.hollowEconomy || {};
    const opponent = game ? this.getOpponent(game, bot) : null;

    const hand = bot?.hand || [];
    const field = bot?.field || [];
    const source = context.source || {};
    const action = context.action || {};
    const isWalkerBounce =
      source?.id === VOID_IDS.WALKER ||
      source?.name === "Void Walker" ||
      action?.type === "bounce_and_summon";
    const isMirrorDimension = isMirrorDimensionContext(source, action);
    const actionType = String(action?.type || "");
    const isSummonContext =
      context.forceSummonAssessment === true ||
      actionType.includes("summon") ||
      actionType === "bounce_and_summon";

    const hollowsInHand = hand.filter((c) => c?.id === VOID_IDS.HOLLOW).length;
    const walkerInHand = hand.some((c) => c?.id === VOID_IDS.WALKER);
    const hollowsOnField = field.filter(
      (c) => c?.id === VOID_IDS.HOLLOW,
    ).length;

    const scores = candidates.map((card) => {
      let score = (card.atk || 0) / 1000; // Base: ATK normalizado
      let reasons = [];
      const summonAssessment = isSummonContext
        ? assessVoidSummonEntry(card, {
            game,
            player: bot,
            opponent,
            analysis,
            source,
            action,
          })
        : { shouldSummon: true, scoreDelta: 0, reason: null };
      score += summonAssessment.scoreDelta || 0;
      if (summonAssessment.reason) {
        reasons.push(`entry: ${summonAssessment.reason}`);
      }

      if (isMirrorDimension) {
        const mirrorRank = getMirrorDimensionCandidateScore(card);
        score += mirrorRank;
        reasons.push(`Mirror Dimension level-rank ${mirrorRank}`);
        if (card.id === VOID_IDS.HOLLOW) {
          reasons.push("Hollow entra com efeitos negados via Mirror");
        }
        if (card.id === VOID_IDS.RAVEN) {
          reasons.push("Raven deve ficar na mão para proteger fusões");
        }
      }

      switch (card.id) {
        case VOID_IDS.WALKER:
          // Walker é MUITO valioso se temos Hollow na mão
          if (hollowsInHand > 0) {
            score += 4.0; // Habilita Hollow SS da mão → recruta
            reasons.push(`Walker + Hollow na mão = combo (+4.0)`);
          } else {
            score += 1.0; // Ainda útil para bounce futuros
            reasons.push(`Walker sem Hollow na mão (+1.0)`);
          }
          break;

        case VOID_IDS.HOLLOW:
          // Hollow recrutado do deck NÃO recruta outro (não é SS da mão)
          // Ainda vale como body, mas menos que Walker quando temos Hollow na mão
          if (hollowsInHand > 0) {
            score += 0.5; // Redundante se já tem na mão
            reasons.push(`Hollow do deck - já tem na mão (+0.5)`);
          } else if (hollowsOnField >= 2) {
            score += 0.3; // Já tem muitos, não precisa mais
            reasons.push(`Já tem ${hollowsOnField} Hollows no campo (+0.3)`);
          } else {
            score += 1.5; // Bom para ter presença
            reasons.push(`Hollow para presença (+1.5)`);
          }
          break;

        case VOID_IDS.BONE_SPIDER:
          // Bone Spider é bom para controle
          if ((analysis.oppFieldCount || 0) > 0) {
            score += 1.5; // Pode reduzir ATK inimigo
            reasons.push(`Bone Spider vs campo inimigo (+1.5)`);
          } else {
            score += 0.5;
            reasons.push(`Bone Spider sem alvos (+0.5)`);
          }
          break;

        case VOID_IDS.TENEBRIS_HORN:
          // Escala com Voids no campo
          const voidCount = (analysis.voidCount || 0) + 1;
          const scalingBonus = voidCount * 0.3;
          score += scalingBonus;
          reasons.push(`Tenebris Horn escala +${scalingBonus.toFixed(1)}`);
          break;

        case VOID_IDS.RAVEN:
          if (isWalkerBounce) {
            score -= 50;
            reasons.push("Raven deve ficar na mao para proteger fusoes (-50)");
            break;
          }
          // Proteção útil se temos ameaças no campo
          if (hollowsOnField >= 2 || field.length >= 3) {
            score += 1.2;
            reasons.push(`Raven protege board (+1.2)`);
          } else {
            score += 0.3;
            reasons.push(`Raven sem board para proteger (+0.3)`);
          }
          break;

        default:
          // Outros monstros Void
          score += 0.5;
          reasons.push(`Void genérico (+0.5)`);
      }

      if (summonAssessment.shouldSummon === false) {
        score -= 1000;
        reasons.push("blocked by pre-summon assessment");
      }

      return {
        card,
        score,
        reasons,
        summonAssessment,
        blocked: summonAssessment.shouldSummon === false,
      };
    });

    // Ordenar por score decrescente
    scores.sort((a, b) => b.score - a.score);

    const bestEntry = scores.find((entry) => !entry.blocked) || null;
    const best = bestEntry?.card || null;
    const reasoning = scores[0]?.reasons?.join("; ") || "No specific reasoning";

    return {
      best,
      scores,
      reasoning,
      blockedAll: !best,
      // Retorna função para usar como botSelect
      asBotSelect: () => [best].filter(Boolean),
    };
  }

  chooseSpecialSummonPosition(card, context = {}) {
    const game = context.game || this.bot?.game;
    const player = context.player || this.bot || game?.bot;
    const opponent = game ? this.getOpponent(game, player) : null;
    const analysis = this.currentAnalysis || (game ? this.analyzeGameState(game) : null);
    return assessVoidSummonEntry(card, {
      game,
      player,
      opponent,
      analysis,
      source: context.source,
      action: context.action,
    }).position;
  }

  chooseVoidAscensionPosition(ascensionCard, material, game, finisherPlan = null) {
    if (
      ascensionCard?.id === VOID_IDS.MALICIOUS_DEMON &&
      (finisherPlan?.score100 || 0) >= 72
    ) {
      return "attack";
    }
    return this.chooseSpecialSummonPosition(ascensionCard, {
      game,
      player: this.bot || game?.bot,
      source: material,
      action: { type: "ascension" },
    });
  }

  selectAutomaticAscension({ choices = [], game, bot = this.bot, opponent } = {}) {
    if (!Array.isArray(choices) || choices.length === 0) {
      return { skip: true };
    }
    const analysis = game ? this.analyzeGameState(game) : this.currentAnalysis;
    const plans =
      analysis?.finisherPlans ||
      evaluateVoidFinisherPlans(bot, opponent, game, analysis);
    const scored = choices
      .map((choice) => {
        const plan = (plans || []).find(
          (entry) => entry.targetName === choice.ascensionCard?.name,
        );
        return { ...choice, plan, score: plan?.score100 || 0 };
      })
      .filter((choice) => choice.plan && choice.score >= 72)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      return { skip: true };
    }

    const best = scored[0];
    return {
      material: best.material,
      ascensionCard: best.ascensionCard,
      position: this.chooseVoidAscensionPosition(
        best.ascensionCard,
        best.material,
        game,
        best.plan,
      ),
      reason: best.plan.reason,
    };
  }

  chooseAutomaticAscensionPosition({
    ascensionCard,
    material,
    game,
  } = {}) {
    return this.chooseVoidAscensionPosition(ascensionCard, material, game);
  }

  scoreBattleAttackCandidate(context = {}) {
    const {
      attacker,
      target,
      lethalNow = false,
      attackerSurvived = false,
      targetSurvived = false,
      isSecondAttack = false,
      bot = this.bot,
      opponent,
    } = context;
    if (!attacker || !isVoid(attacker)) return 0;

    const graveyard = bot?.graveyard || [];
    const hollowsInGY = graveyard.filter(
      (card) => card?.id === VOID_IDS.HOLLOW,
    ).length;
    const oppMonsters =
      opponent?.field?.filter((card) => card?.cardKind === "monster") || [];
    const oppStrongest = getOpponentStrongestBattleStat({
      oppField: oppMonsters,
      oppStrongestAtk: 0,
    });
    const attackerAtk = getEffectiveBattleStat(attacker, "atk");
    const targetStat = target
      ? target.isFacedown
        ? 1500
        : target.position === "defense"
          ? getEffectiveBattleStat(target, "def")
          : getEffectiveBattleStat(target, "atk")
      : 0;
    const destroysTarget = Boolean(target && !targetSurvived);
    const survivesTrade = attackerSurvived || lethalNow;
    let delta = 0;

    switch (attacker.id) {
      case VOID_IDS.FORGOTTEN_KNIGHT: {
        if (target && attackerAtk > targetStat) {
          delta += 0.45 + Math.min(hollowsInGY, 4) * 0.12;
        }
        if (hollowsInGY > 0 && target && destroysTarget && survivesTrade) {
          delta += 0.35;
        }
        break;
      }
      case VOID_IDS.ARCTURUS: {
        const faceUpOwnMonsters = (bot?.field || []).filter(
          (card) =>
            card &&
            card.cardKind === "monster" &&
            !card.isFacedown &&
            card !== attacker,
        ).length;
        if (faceUpOwnMonsters === 0) delta += 1.1;
        else delta -= 0.35;
        if (!target && lethalNow) delta += 3.5;
        if (target && attackerAtk > Math.max(targetStat, oppStrongest - 1)) {
          delta += 0.7;
        }
        break;
      }
      case VOID_IDS.GHOST_WOLF: {
        if (!target) {
          if (lethalNow) {
            delta += 4.0;
          } else if ((opponent?.lp || 8000) <= 2500 || oppStrongest >= attackerAtk) {
            delta += 1.2;
          } else {
            delta -= 1.2;
          }
        }
        break;
      }
      case VOID_IDS.BERSERKER: {
        if (target && destroysTarget && survivesTrade) {
          delta += 0.8;
          if (targetStat >= oppStrongest) delta += 0.35;
        }
        if (isSecondAttack) delta += 0.2;
        if (!target && lethalNow) delta += 3.0;
        break;
      }
      case VOID_IDS.MALICIOUS_DEMON: {
        if (hollowsInGY >= 2) delta += 0.25;
        if (!target && lethalNow) delta += 2.0;
        break;
      }
      default:
        break;
    }

    return delta;
  }

  /**
   * Ranks dynamic search targets for Void effects.
   */
  rankSearchCandidates(cards, action = {}, ctx = {}) {
    if (!Array.isArray(cards) || cards.length === 0) return [];

    const source = ctx?.source || {};
    const isLostThroneSearch =
      action?.type === "search_then_optional_special_summon_from_hand" &&
      (source.id === VOID_IDS.LOST_THRONE ||
        source.name === "Void Lost Throne");

    if (!isLostThroneSearch) {
      return this.evaluateRecruitCandidate(cards, ctx).asBotSelect();
    }

    const game = ctx.game || this.bot?.game;
    const bot = ctx.player || this.bot || game?.bot;
    const fieldEmpty = (bot?.field || []).length === 0;
    const analysis = this.currentAnalysis || (game ? this.analyzeGameState(game) : {});
    const hand = bot?.hand || [];
    const field = bot?.field || [];
    const graveyard = bot?.graveyard || [];
    const hasFusionPlan = hasImmediateVoidFusionPlan(bot);

    if (fieldEmpty) {
      const hollow = cards.find((card) => card?.id === VOID_IDS.HOLLOW);
      if (hollow) {
        const rest = cards.filter((card) => card !== hollow);
        const orderedRest = this.evaluateRecruitCandidate(rest, {
          ...ctx,
          game,
          player: bot,
          source,
          action,
          forceSummonAssessment: true,
        }).scores
          .filter((entry) => !entry.blocked)
          .sort((a, b) => b.score - a.score)
          .map((entry) => entry.card);
        return [hollow, ...orderedRest];
      }
    }

    const ranked = cards.map((card) => {
      let score = (card.atk || 0) / 1000;
      let blocked = false;
      if (fieldEmpty) {
        const summonAssessment = assessVoidSummonEntry(card, {
          game,
          player: bot,
          opponent: game ? this.getOpponent(game, bot) : null,
          analysis,
          source,
          action,
        });
        score += summonAssessment.scoreDelta || 0;
        if (summonAssessment.shouldSummon === false) {
          score -= 1000;
          blocked = true;
        }
      }

      if (card.id === VOID_IDS.HOLLOW) {
        score += fieldEmpty ? 7.0 : 2.0;
        if (fieldEmpty) {
          score += analysis?.swarmPayoffs?.totalPayoffValue || 0;
        }
        if (hand.some((c) => c?.id === VOID_IDS.HOLLOW)) {
          score -= fieldEmpty ? 0.5 : 1.0;
        }
      } else if (card.id === VOID_IDS.BEAST) {
        score += 2.5;
        if (!hand.some((c) => c?.id === VOID_IDS.HOLLOW)) score += 0.5;
      } else if (card.id === VOID_IDS.TENEBRIS_HORN) {
        score += 2.0 + Math.min(field.filter(isVoid).length, 3) * 0.4;
      } else if (card.id === VOID_IDS.RAVEN) {
        if (hasFusionPlan) {
          score += 5.5;
        } else {
          score -= fieldEmpty ? 30 : 20;
          blocked = true;
        }
      } else {
        const knowledge = getVoidCardKnowledge(card);
        if (knowledge?.tags?.includes("swarm")) score += 1.0;
        if (knowledge?.role === "control") score += 0.8;
      }

      if (graveyard.some((c) => c?.id === card.id)) {
        score -= 0.2;
      }

      return { card, score, blocked };
    });

    const pool = ranked.some((entry) => !entry.blocked)
      ? ranked.filter((entry) => !entry.blocked)
      : ranked;

    return pool
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.card);
  }

  /**
   * Avalia se ativar Void Gravitational Pull é vantajoso.
   *
   * O efeito devolve 1 Void meu e 1 monstro do oponente para a mão.
   * Só vale a pena se:
   * 1. Tenho mais de 1 monstro no campo (não ficar com campo vazio)
   * 2. OU o monstro do oponente é uma ameaça maior que o meu
   * 3. OU tenho como re-invocar o monstro devolvido facilmente
   *
   * @param {Object} bot - Jogador bot
   * @param {Object} opponent - Jogador oponente
   * @returns {Object} - { shouldActivate, priority, reason }
   */
  evaluateGravitationalPull(bot, opponent) {
    const myField = bot?.field || [];
    const oppField = opponent?.field || [];
    const myHand = bot?.hand || [];

    // Monstros válidos para devolver (Void face-up)
    const myVoids = myField.filter(
      (m) => m?.cardKind === "monster" && isVoid(m) && !m?.isFacedown,
    );
    const oppMonsters = oppField.filter((m) => m?.cardKind === "monster");

    // Se não tem alvos válidos, não pode ativar
    if (myVoids.length === 0 || oppMonsters.length === 0) {
      return {
        shouldActivate: false,
        priority: 0,
        reason: "Sem alvos válidos",
      };
    }

    // Calcular valores
    const myWeakest = myVoids.reduce(
      (min, m) => {
        const atk = (m.atk || 0) + (m.tempAtkBoost || 0);
        return atk < min.atk ? { card: m, atk } : min;
      },
      {
        card: myVoids[0],
        atk: (myVoids[0].atk || 0) + (myVoids[0].tempAtkBoost || 0),
      },
    );

    const oppStrongest = oppMonsters.reduce(
      (max, m) => {
        const atk = m.isFacedown ? 1500 : (m.atk || 0) + (m.tempAtkBoost || 0);
        return atk > max.atk ? { card: m, atk } : max;
      },
      { card: oppMonsters[0], atk: 0 },
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // REGRA 1: Não ativar se só tenho 1 monstro e ficarei com campo vazio
    // ═══════════════════════════════════════════════════════════════════════════
    if (myVoids.length === 1 && myField.length === 1) {
      // Exceção: Se o monstro do oponente é MUITO mais forte e eu tenho como voltar
      const canReinvoke = myHand.some(
        (c) =>
          c?.id === VOID_IDS.CONJURER ||
          c?.id === VOID_IDS.WALKER ||
          c?.id === VOID_IDS.HAUNTER,
      );

      const threatDiff = oppStrongest.atk - myWeakest.atk;

      if (threatDiff >= 800 && canReinvoke) {
        // Vale a pena remover ameaça grande se posso reconstruir
        return {
          shouldActivate: true,
          priority: 6.0,
          reason: `Remover ameaça forte (${oppStrongest.card?.name} ${oppStrongest.atk}ATK) - posso reinvocar`,
        };
      }

      // Não vale ficar com campo vazio
      return {
        shouldActivate: false,
        priority: 0,
        reason: `Ficaria com campo vazio (só tenho ${myWeakest.card?.name})`,
      };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // REGRA 2: Avaliar troca de recursos
    // ═══════════════════════════════════════════════════════════════════════════

    // Se oponente só tem 1 monstro e eu tenho vários, vale devolver
    if (oppMonsters.length === 1 && myVoids.length >= 2) {
      return {
        shouldActivate: true,
        priority: 7.0,
        reason: `Limpar único monstro do oponente (${oppStrongest.card?.name}) mantendo presença`,
      };
    }

    // Se monstro do oponente é mais forte que meu mais fraco, vale trocar
    if (oppStrongest.atk > myWeakest.atk + 300) {
      return {
        shouldActivate: true,
        priority: 5.5 + (oppStrongest.atk - myWeakest.atk) / 1000,
        reason: `Trocar ${myWeakest.card?.name} (${myWeakest.atk}) por ${oppStrongest.card?.name} (${oppStrongest.atk})`,
      };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // REGRA 3: Considerar se devolver meu monstro me ajuda (reuso de efeito)
    // ═══════════════════════════════════════════════════════════════════════════

    // Conjurer na mão de novo = pode recrutar novamente
    const conjurerOnField = myVoids.some((m) => m.id === VOID_IDS.CONJURER);
    if (conjurerOnField && myVoids.length >= 2) {
      // Posso devolver Conjurer e invocar de novo para recrutar
      return {
        shouldActivate: true,
        priority: 6.5,
        reason: "Reciclar Conjurer para novo recrute",
      };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DEFAULT: Só ativar se claramente vantajoso
    // ═══════════════════════════════════════════════════════════════════════════

    // Se chegou aqui, provavelmente não é uma boa jogada
    if (myVoids.length >= 2 && oppStrongest.atk >= 1500) {
      return {
        shouldActivate: true,
        priority: 4.5,
        reason: "Trocar monstro por ameaça moderada",
      };
    }

    return {
      shouldActivate: false,
      priority: 0,
      reason: "Troca não vantajosa",
    };
  }

  /**
   * Decide a estratégia macro baseada no estado do jogo.
   */
  evaluateConjurerGraveyardRevive(analysis, game, bot, conjurerCard) {
    const field = bot?.field || [];
    const hand = bot?.hand || [];
    const deck = bot?.deck || [];
    const extraDeck = bot?.extraDeck || [];

    const fieldVoids = field.filter(
      (card) => card?.cardKind === "monster" && isVoid(card),
    );
    if (fieldVoids.length < 1 || field.length >= 5) {
      return { shouldActivate: false, priority: 0, reason: "Sem custo/espaco" };
    }

    const fieldEffect = (conjurerCard?.effects || []).find(
      (effect) =>
        effect &&
        effect.id === "void_conjurer_field_summon" &&
        effect.timing === "ignition",
    );
    if (!fieldEffect) {
      return { shouldActivate: false, priority: 0, reason: "Sem efeito de recrute" };
    }

    const fieldEffectCheck = game?.effectEngine?.checkOncePerTurn?.(
      conjurerCard,
      bot,
      fieldEffect,
    );
    if (fieldEffectCheck?.ok === false) {
      return {
        shouldActivate: false,
        priority: 0,
        reason: "Recrute do Conjurer ja foi usado",
      };
    }

    const deckTargets = deck.filter(
      (card) =>
        card?.cardKind === "monster" &&
        isVoid(card) &&
        (card.level || 0) <= 4,
    );
    if (deckTargets.length < 1) {
      return {
        shouldActivate: false,
        priority: 0,
        reason: "Sem alvo lv4- no deck",
      };
    }

    const bestCost = this.chooseLowestValueConjurerCost(analysis, fieldVoids);
    if (!bestCost) {
      return { shouldActivate: false, priority: 0, reason: "Sem custo valido" };
    }
    if (bestCost.costRisk?.protectedBoss) {
      return {
        shouldActivate: false,
        priority: 0,
        reason:
          bestCost.costRisk.reason ||
          "Custo preservado: boss nao deve virar revive do Conjurer",
        costName: bestCost.card?.name || null,
      };
    }

    const handIds = hand.map((card) => card?.id).filter(Boolean);
    const targetIds = deckTargets.map((card) => card?.id).filter(Boolean);
    const extraIds = extraDeck.map((card) => card?.id).filter(Boolean);
    const hasPoly = handIds.includes(VOID_IDS.POLYMERIZATION);

    const fieldHollows = field.filter((card) => card?.id === VOID_IDS.HOLLOW)
      .length;
    const handHollows = hand.filter((card) => card?.id === VOID_IDS.HOLLOW)
      .length;
    const hollowCost = bestCost.id === VOID_IDS.HOLLOW ? 1 : 0;
    const hollowsAfterRecruit =
      fieldHollows + handHollows - hollowCost +
      (targetIds.includes(VOID_IDS.HOLLOW) ? 1 : 0);

    const fieldVoidsAfterRecruit = fieldVoids.length + 1;
    const handVoids = hand.filter(isVoid).length;
    const voidsAfterRecruit = fieldVoidsAfterRecruit + handVoids;

    const reasons = [];
    let priority = 0;

    if (targetIds.includes(VOID_IDS.WALKER) && handIds.includes(VOID_IDS.HOLLOW)) {
      priority = Math.max(priority, 9.0);
      reasons.push("Conjurer recruta Walker para descer Hollow da mao");
    }

    if (
      hasPoly &&
      extraIds.includes(VOID_IDS.HOLLOW_KING) &&
      hollowsAfterRecruit >= 3
    ) {
      priority = Math.max(priority, 8.5);
      reasons.push("Conjurer completa material para Hollow King");
    }

    if (
      hasPoly &&
      extraIds.includes(VOID_IDS.HYDRA_TITAN) &&
      voidsAfterRecruit >= 6
    ) {
      priority = Math.max(priority, 8.0);
      reasons.push("Conjurer aproxima/fecha Hydra Titan");
    }

    const hasSlayerAfterCost =
      (bestCost.id !== VOID_IDS.SLAYER_BRUTE &&
        field.some((card) => card?.id === VOID_IDS.SLAYER_BRUTE)) ||
      handIds.includes(VOID_IDS.SLAYER_BRUTE);
    if (
      hasPoly &&
      extraIds.includes(VOID_IDS.BERSERKER) &&
      hasSlayerAfterCost &&
      voidsAfterRecruit >= 2
    ) {
      priority = Math.max(priority, 7.8);
      reasons.push("Conjurer fornece material extra para Berserker");
    }

    if (
      targetIds.includes(VOID_IDS.TENEBRIS_HORN) &&
      (analysis.voidCount || 0) >= 2 &&
      (analysis.swarmPayoffs?.hasFusionPayoff ||
        analysis.swarmPayoffs?.totalPayoffValue >= 2.0)
    ) {
      priority = Math.max(priority, 7.2);
      reasons.push("Conjurer recruta Tenebris para fortalecer swarm com payoff");
    }

    if (priority <= 0) {
      return {
        shouldActivate: false,
        priority: 0,
        reason: "Sem combo claro apos reviver Conjurer",
      };
    }

    const costPenalty = Math.max(0, bestCost.score - 7) * 0.25;
    return {
      shouldActivate: true,
      priority: Math.max(1, priority - costPenalty),
      reason: reasons.join("; "),
      costName: bestCost.card?.name || null,
    };
  }

  chooseLowestValueConjurerCost(analysis, candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const activationContext = buildVoidActivationContext(analysis);
    const costPreferences =
      activationContext?.actionContext?.costPreferences || {};
    const preferNames = new Set(costPreferences.preferNames || []);
    const preserveNames = new Set(costPreferences.preserveNames || []);
    const payoffNames = new Set(costPreferences.offensivePayoffNames || []);

    return candidates
      .map((card) => {
        const costRisk = assessConjurerReviveCostRisk(card, analysis);
        let score = evaluateVoidMonster(card, {
          ...analysis,
          phase: "cost",
        });
        score += ((card?.atk || 0) + (card?.def || 0)) / 3000;
        if (preferNames.has(card?.name)) score -= 3;
        if (preserveNames.has(card?.name)) score += 18;
        if (payoffNames.has(card?.name)) score += 4;
        if (card?.isToken) score -= 4;
        if (card?.usedEffectThisTurn) score -= 1.5;
        if (card?.hasAttacked) score -= 1;
        if (card?.isFacedown) score -= 0.5;
        if (costRisk.protectedBoss) score += 100;
        return { card, score, id: card?.id, costRisk };
      })
      .sort((a, b) => a.score - b.score)[0];
  }

  decideMacroStrategy(analysis) {
    const {
      myLP,
      oppLP,
      oppFieldCount,
      oppStrongestAtk,
      voidCount,
      readyCombos,
      swarmPayoffs,
      hollowEconomy,
    } = analysis;

    // Check lethal
    const myTotalAtk = (analysis.field || [])
      .filter((m) => m?.position === "attack" && !m?.hasAttacked)
      .reduce((sum, m) => sum + (m?.atk || 0), 0);

    if (oppFieldCount === 0 && myTotalAtk >= oppLP) {
      return { mode: "lethal", priority: 15 };
    }

    // Check danger
    if (myLP <= 2000) {
      return { mode: "defensive", priority: 10 };
    }

    // Check se precisa de recovery (Hollows perdidos no GY)
    if (hollowEconomy?.needsRecovery && !hollowEconomy?.hasHaunterRevive) {
      // Priorizar buscar Haunter ou The Void
      return {
        mode: "recovery",
        priority: 9,
        reason: "Hollows stranded in GY",
      };
    }

    // Check fusion opportunity
    const fusionCombo = readyCombos.find((c) => c.combo?.fusion);
    if (fusionCombo) {
      return { mode: "fusion", priority: 12, target: fusionCombo };
    }

    // Check swarm opportunity — MAS SÓ SE TEM PAYOFF!
    // Void é deck agressivo, swarm sem payoff = campo fraco que será destruído
    const swarmCombo = readyCombos.find(
      (c) =>
        c.combo?.name?.includes("Conjurer") ||
        c.combo?.name?.includes("Pipeline"),
    );

    if (swarmCombo && voidCount < 3) {
      const hasPayoff =
        swarmPayoffs?.hasBossPayoff ||
        swarmPayoffs?.hasFusionPayoff ||
        swarmPayoffs?.totalPayoffValue >= 2.0;

      if (hasPayoff) {
        return {
          mode: "swarm",
          priority: 10 + (swarmPayoffs?.totalPayoffValue || 0) / 2,
          target: swarmCombo,
          payoffs: swarmPayoffs,
        };
      }
    }

    // Sem payoff claro, ser mais conservador
    // Pode invocar monstros individualmente mas não priorizar combo completo
    return { mode: "buildup", priority: 5 };
  }

  generateMainPhaseActions(game) {
    const actions = [];
    const analysis = this.analyzeGameState(game);
    const voidActivationContext = buildVoidActivationContext(analysis);
    const bot = game._isPerspectiveState ? game.bot : this.bot || game.bot;
    const opponent = this.getOpponent(game, bot);
    const isSimulatedState = game._isPerspectiveState === true;

    const handIds = (bot.hand || []).map((card) => card?.id).filter(Boolean);
    const hollowFieldCount = analysis.hollowCount;
    const voidFieldCount = analysis.voidCount;
    const macroStrategy = analysis.macroStrategy;
    const swarmPayoffs = analysis.swarmPayoffs || {};
    const bestFinisherPlan = analysis.bestFinisherPlan || null;
    const hollowResourcePolicy = analysis.hollowResourcePolicy || {};
    const preserveHollowsForFinisher =
      hollowResourcePolicy.preserveHollowsInGY === true ||
      (bestFinisherPlan?.preserveHollowsInGY === true &&
        String(game?.phase || "").toLowerCase().includes("main1"));
    const preserveArcturusSoloBuff = shouldPreserveArcturusSoloBuff(
      bot,
      opponent,
      analysis,
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // ASCENSION CHECK
    // ═══════════════════════════════════════════════════════════════════════════
    const canCheckAscension =
      typeof game?.canUseAsAscensionMaterial === "function" &&
      typeof game?.getAscensionCandidatesForMaterial === "function" &&
      typeof game?.checkAscensionRequirements === "function";

    if (canCheckAscension || isSimulatedState) {
      const materials = (bot.field || []).filter(
        (m) => m && m.cardKind === "monster" && !m.isFacedown,
      );
      for (const material of materials) {
        let eligible = [];
        if (canCheckAscension) {
          const check = game.canUseAsAscensionMaterial(bot, material);
          if (!check?.ok) continue;
          const candidates =
            game.getAscensionCandidatesForMaterial(bot, material) || [];
          eligible = candidates.filter(
            (asc) => game.checkAscensionRequirements(bot, asc)?.ok,
          );
        } else {
          eligible = getSimulatedVoidAscensionCandidates(game, bot, material);
        }
        for (const ascensionCard of eligible) {
          const ascensionFinisherPlan = (analysis.finisherPlans || []).find(
            (plan) => plan.targetName === ascensionCard.name,
          );
          if (
            ascensionCard.id === VOID_IDS.MALICIOUS_DEMON &&
            (!ascensionFinisherPlan || ascensionFinisherPlan.score100 < 60)
          ) {
            continue;
          }
          let ascensionPriority;
          if (ascensionCard.id === VOID_IDS.COSMIC_WALKER) {
            ascensionPriority = 11;
          } else if (ascensionCard.id === VOID_IDS.MALICIOUS_DEMON) {
            // Multi-attack escala com Hollows no GY (cada Hollow = +1 ataque)
            const hollowsInGY = (bot.graveyard || []).filter(
              (c) => c?.id === VOID_IDS.HOLLOW,
            ).length;
            ascensionPriority = 10 + Math.min(hollowsInGY, 4) * 0.5;
          } else {
            ascensionPriority = 9 + (ascensionCard.atk || 0) / 1000;
          }
          if (ascensionFinisherPlan) {
            ascensionPriority = Math.max(
              ascensionPriority,
              ascensionFinisherPlan.actionPriority || 0,
            );
            if (ascensionFinisherPlan.preserveHollowsInGY) {
              ascensionPriority += 0.4;
            }
          }
          const ascensionPosition = this.chooseVoidAscensionPosition(
            ascensionCard,
            material,
            game,
            ascensionFinisherPlan,
          );
          actions.push({
            type: "ascension",
            materialIndex: bot.field.indexOf(material),
            ascensionCard,
            cardName: ascensionCard.name,
            position: ascensionPosition,
            priority: ascensionPriority,
            extraDeck: true,
            finisherPlanRank: ascensionFinisherPlan?.score100,
          });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // COMBO-AWARE ACTION GENERATION
    // ═══════════════════════════════════════════════════════════════════════════

    // Boost de prioridade baseado em combos detectados
    const comboBoosts = this.calculateComboBoosts(analysis);

    if (bot.hand && bot.hand.length > 0) {
      bot.hand.forEach((card, index) => {
        if (!card) return;

        // ─────────────────────────────────────────────────────────────────────
        // SPELLS
        // ─────────────────────────────────────────────────────────────────────
        if (card.cardKind === "spell") {
          const hasFusionAction = (card.effects || []).some((effect) =>
            (effect.actions || []).some(
              (action) =>
                action && action.type === "polymerization_fusion_summon",
            ),
          );
          if (!isSimulatedState && hasFusionAction) {
            const canActivate = game.canActivatePolymerization?.();
            if (!canActivate) return;
          }

          let decision = shouldPlayVoidSpell(card, game, bot, opponent);
          let fusionHint = null;
          let activationContext = voidActivationContext;

          if (card.id === VOID_IDS.GRAVITATIONAL) {
            const gravitationalEval = this.evaluateGravitationalPull(
              bot,
              opponent,
            );
            if (!gravitationalEval.shouldActivate) return;
            decision = {
              yes: true,
              priority: gravitationalEval.priority,
              reason: gravitationalEval.reason,
            };
          }

          if (
            card.id === VOID_IDS.THE_VOID &&
            (bot.field || []).length === 0 &&
            handIds.includes(VOID_IDS.LOST_THRONE) &&
            (bot.deck || []).some((candidate) => candidate?.id === VOID_IDS.HOLLOW)
          ) {
            decision = {
              ...decision,
              priority: Math.min(decision.priority || 0, 7.8),
              reason: "Lost Throne deve liderar a linha starter com Hollow",
            };
          }

          if (hasFusionAction) {
            const fusionPlan = (analysis.finisherPlans || []).find(
              (plan) => plan.kind === "fusion",
            );
            const fusionEval = fusionPlan
              ? {
                  priority: fusionPlan.actionPriority,
                  target: fusionPlan.targetName,
                  reason: fusionPlan.reason,
                  preserveHollowsInGY: fusionPlan.preserveHollowsInGY,
                  plan: fusionPlan,
                }
              : evaluateVoidFusionPriority(bot);
            fusionHint = fusionEval.target;
            if (fusionEval.priority <= 0) return;
            activationContext = withFusionPreferences(
              voidActivationContext,
              fusionEval,
            );

            // Usar calculateFusionValue para prioridade mais precisa
            const fusionValue = this.evaluateFusionOpportunity(analysis);
            decision = {
              yes: true,
              priority: Math.max(
                decision.priority,
                fusionEval.priority,
                fusionValue,
              ),
            };

            // Se macro strategy é fusion, boost extra
            if (macroStrategy.mode === "fusion") {
              decision.priority += 2.0;
            }
          }

          if (decision.yes) {
            const fusionPreferenceScore = getFusionPreferenceScore(
              activationContext,
              fusionHint,
            );
            actions.push({
              type: "spell",
              index,
              cardId: card.id,
              cardName: card.name,
              priority: hasFusionAction
                ? Math.max(8.5, decision.priority)
                : decision.priority,
              extraDeck: hasFusionAction,
              fusionTargetHint: fusionHint,
              finisherPlanRank: hasFusionAction
                ? Number.isFinite(fusionPreferenceScore)
                  ? fusionPreferenceScore * 10
                  : undefined
                : undefined,
              activationContext,
            });
          }
          return;
        }

        if (card.cardKind === "trap" && card.id === VOID_IDS.MIRROR_DIMENSION) {
          const hasSpace = (bot.spellTrap || []).length < 5;
          const alreadySet = (bot.spellTrap || []).some(
            (setCard) => setCard?.id === VOID_IDS.MIRROR_DIMENSION,
          );
          const mirrorSetup = evaluateMirrorDimensionSetup(bot, opponent, card);
          if (!hasSpace || alreadySet || !mirrorSetup.ok) {
            return;
          }
          actions.push({
            type: "set_spell_trap",
            index,
            cardId: card.id,
            cardName: card.name,
            priority: mirrorSetup.priority,
          });
          return;
        }

        // ─────────────────────────────────────────────────────────────────────
        // NORMAL SUMMON (com sequenciamento de combo)
        // ─────────────────────────────────────────────────────────────────────
        const summonLimit = 1 + (bot.additionalNormalSummons || 0);
        if (card.cardKind === "monster" && bot.summonCount < summonLimit) {
          const summonDecision = shouldSummonVoidMonster(
            card,
            game,
            bot,
            opponent,
          );
          if (!summonDecision.yes) return;

          // Combo boost baseado na análise
          let comboBoost = comboBoosts[card.id] || 0;

          // ═══════════════════════════════════════════════════════════════════
          // CONJURER: Só vale combo completo se tem PAYOFF
          // Swarm sem payoff = campo fraco que será destruído
          // ═══════════════════════════════════════════════════════════════════
          if (card.id === VOID_IDS.CONJURER) {
            const hasPayoff =
              swarmPayoffs.hasBossPayoff ||
              swarmPayoffs.hasFusionPayoff ||
              swarmPayoffs.totalPayoffValue >= 2.0;

            if (hasPayoff) {
              comboBoost += 3.0; // Base boost alto COM payoff

              // COMBO COMPLETO: Conjurer + Hollow na mão + payoff
              if (handIds.includes(VOID_IDS.HOLLOW)) {
                comboBoost += 2.5; // Combo perfeito!

                // Bônus adicional baseado no tipo de payoff
                if (swarmPayoffs.hasFusionPayoff) {
                  comboBoost += 1.5; // Fusão é o melhor payoff
                }
                if (handIds.includes(VOID_IDS.HAUNTER)) {
                  comboBoost += 1.5; // Haunter tributa Hollow → 2100 ATK
                }
                if (handIds.includes(VOID_IDS.SLAYER_BRUTE)) {
                  comboBoost += 1.5; // Slayer tributa 2 → 2500 ATK
                }
                if (handIds.includes(VOID_IDS.SERPENT_DRAKE)) {
                  comboBoost += 1.0; // Drake tributa Hollows
                }
              } else {
                // Conjurer sem Hollow ainda é ok (recruta qualquer Void lv4-)
                comboBoost += 1.0;
              }
            } else {
              // SEM PAYOFF: Conjurer ainda é ok mas não prioriza combo
              comboBoost += 1.0; // Boost menor
              // Não faz o combo completo, só recruta um corpo
            }
          }

          // ═══════════════════════════════════════════════════════════════════
          // HOLLOW: NUNCA normal summon se tem opção melhor
          // ═══════════════════════════════════════════════════════════════════
          if (card.id === VOID_IDS.HOLLOW) {
            if (handIds.includes(VOID_IDS.CONJURER)) {
              comboBoost -= 5.0; // NUNCA - Conjurer traz Walker que desce Hollow
            } else if (handIds.includes(VOID_IDS.WALKER)) {
              comboBoost -= 2.0; // Prefere Walker para descer Hollow da mão
            } else {
              // Sem opção melhor, Hollow sozinho é fraco mas é alguma coisa
              comboBoost += 0.0;
            }
          }

          // ═══════════════════════════════════════════════════════════════════
          // ARCTURUS: Lord of the Void — 2 tributos para 2800 ATK + lock de BP
          // Escala com Voids no GY (boost passive se for único monstro)
          // ═══════════════════════════════════════════════════════════════════
          if (card.id === VOID_IDS.ARCTURUS) {
            const monstersOnField = (bot.field || []).filter(
              (m) => m && m.cardKind === "monster",
            ).length;
            if (monstersOnField >= 2) {
              const voidsInGY = (bot.graveyard || []).filter(isVoid).length;
              comboBoost += 3.0; // Boss máximo: prioridade alta
              comboBoost += Math.min(voidsInGY, 6) * 0.3; // Scaling do GY
              // Cada par de Voids no GY = 1 vida extra via replacementEffect
              if (voidsInGY >= 2) comboBoost += 0.6;
            } else {
              // Sem tributos suficientes: penalizar para não ser escolhido
              comboBoost -= 5.0;
            }
          }

          // ═══════════════════════════════════════════════════════════════════
          // WALKER: Bom se tem Hollow na mão (e não tem Conjurer)
          // ═══════════════════════════════════════════════════════════════════
          if (card.id === VOID_IDS.WALKER) {
            if (handIds.includes(VOID_IDS.CONJURER)) {
              comboBoost -= 3.0; // Conjurer recruta Walker do deck
            } else if (handIds.includes(VOID_IDS.HOLLOW)) {
              // Walker + Hollow é bom combo se tem payoff
              const hasPayoff =
                swarmPayoffs.hasBossPayoff || swarmPayoffs.hasFusionPayoff;
              comboBoost += hasPayoff ? 2.5 : 1.0;
            } else {
              const otherVoidsInHand = (bot.hand || []).filter(
                (c) =>
                  isVoid(c) && c.id !== VOID_IDS.WALKER && (c.level || 0) <= 4,
              ).length;
              if (otherVoidsInHand > 0) {
                comboBoost += 0.5;
              }
            }
          }

          const tributeInfo = this.getTributeRequirementFor(card, bot) || {
            tributesNeeded: 0,
          };
          const tributeIndices =
            tributeInfo.tributesNeeded > 0
              ? this.selectBestTributes(
                  bot.field || [],
                  tributeInfo.tributesNeeded,
                  card,
                  { oppField: opponent?.field || [], game },
                )
              : [];
          const tributeCards = (tributeIndices || [])
            .map((fieldIndex) => bot.field?.[fieldIndex])
            .filter(Boolean);
          const normalSummonAssessment = assessVoidNormalSummonEntry(card, {
            game,
            player: bot,
            opponent,
            analysis,
            tributeCards,
            tributeCount: tributeInfo.tributesNeeded || 0,
          });
          if (!normalSummonAssessment.shouldSummon) return;

          const position = normalSummonAssessment.position || "attack";
          let normalSummonPriority =
            summonDecision.priority +
            comboBoost +
            (normalSummonAssessment.scoreDelta || 0);
          if (bestFinisherPlan?.targetName === card.name) {
            normalSummonPriority = Math.max(
              normalSummonPriority,
              bestFinisherPlan.actionPriority || 0,
            );
          }
          actions.push({
            type: "summon",
            index,
            cardId: card.id,
            cardName: card.name,
            position,
            facedown: normalSummonAssessment.facedown === true,
            priority: normalSummonPriority,
            finisherPlanRank:
              bestFinisherPlan?.targetName === card.name
                ? bestFinisherPlan.score100
                : undefined,
          });
        }

        // ─────────────────────────────────────────────────────────────────────
        // HAND IGNITION (com sequenciamento)
        // ─────────────────────────────────────────────────────────────────────
        if (card.cardKind === "monster") {
          const handIgnitionEffect = (card.effects || []).find(
            (e) => e && e.timing === "ignition" && e.requireZone === "hand",
          );
          if (handIgnitionEffect) {
            const validation = validateVoidHandIgnitionCandidate({
              card,
              effect: handIgnitionEffect,
              player: bot,
              game,
              isSimulatedState,
              activationContext: voidActivationContext,
            });
            if (!validation.ok) return;

            const knowledge = getVoidCardKnowledge(card);
            let ignitionPriority = knowledge?.role === "boss" ? 7 : 5.5;

            // Haunter: prioriza se tem Hollows para tributar E se tem mais no GY
            if (card.id === VOID_IDS.HAUNTER) {
              if (hollowFieldCount >= 1) {
                ignitionPriority += 2.5;
                // Bônus extra se tem Haunter no GY (pode reviver Hollows depois)
                const haunterInGY = (bot.graveyard || []).some(
                  (c) => c?.id === VOID_IDS.HAUNTER,
                );
                if (haunterInGY) {
                  ignitionPriority += 1.0;
                }
              }
            }

            // Slayer Brute: prioriza se tem 2+ Voids E se queremos boss
            if (card.id === VOID_IDS.SLAYER_BRUTE) {
              if (voidFieldCount >= 2) {
                const costPrefs =
                  voidActivationContext?.actionContext?.costPreferences || {};
                const preserveNames = new Set(costPrefs.preserveNames || []);
                const payoffNames = new Set(
                  costPrefs.offensivePayoffNames || [],
                );
                const availablePayoffs = Number.isFinite(
                  costPrefs.availableOffensivePayoffs,
                )
                  ? costPrefs.availableOffensivePayoffs
                  : 0;
                const viableCosts = (bot.field || []).filter((candidate) => {
                  if (
                    !candidate ||
                    candidate.cardKind !== "monster" ||
                    candidate.isFacedown ||
                    !isVoid(candidate)
                  ) {
                    return false;
                  }
                  if (preserveNames.has(candidate.name)) return false;
                  if (
                    costPrefs.preserveLastOffensivePayoff &&
                    payoffNames.has(candidate.name) &&
                    availablePayoffs <= 1
                  ) {
                    return false;
                  }
                  return true;
                }).length;
                if (viableCosts < 2) return;
                ignitionPriority += 2.5;
                // Extra se temos Poly para Berserker depois
                if (handIds.includes(VOID_IDS.POLYMERIZATION)) {
                  ignitionPriority += 1.5;
                }
              }
            }

            // Serpent Drake: prioriza baseado em quantos Hollows pode tributar
            if (card.id === VOID_IDS.SERPENT_DRAKE) {
              if (hollowFieldCount >= 1) {
                ignitionPriority += 1.5 + hollowFieldCount * 0.5;
              }
            }

            // Forgotten Knight
            if (card.id === VOID_IDS.FORGOTTEN_KNIGHT && voidFieldCount >= 1) {
              ignitionPriority += 1.5;
            }

            // Thousand-Arms: tributa 1 Void e depois bounce-revive Hollows do GY
            if (card.id === VOID_IDS.THOUSAND_ARMS) {
              if (voidFieldCount >= 1) {
                ignitionPriority += 2.5;
                const hollowsInGY = (bot.graveyard || []).filter(
                  (c) => c?.id === VOID_IDS.HOLLOW,
                ).length;
                if (hollowsInGY >= 1) {
                  // Cada Hollow no GY = +700 ATK potencial via bounce-revive
                  ignitionPriority += 1.0 + Math.min(hollowsInGY, 2) * 0.5;
                }
                // Caminho para Malicious Demon (precisa 2 ativações)
                if (
                  (bot.extraDeck || []).some(
                    (c) => c?.id === VOID_IDS.MALICIOUS_DEMON,
                  )
                ) {
                  const materialActivations = getMaterialEffectActivationCount(
                    game,
                    bot,
                    VOID_IDS.THOUSAND_ARMS,
                  );
                  ignitionPriority += materialActivations >= 2 ? 4.0 : 0.8;
                  if (materialActivations === 1) {
                    ignitionPriority += 1.0;
                  }
                }
              }
            }

            actions.push({
              type: "handIgnition",
              index,
              cardId: card.id,
              cardName: card.name,
              priority: ignitionPriority,
              effectId: handIgnitionEffect.id,
              activationContext: voidActivationContext,
            });
          }
        }
      });
    }

    if (bot.spellTrap && bot.spellTrap.length > 0) {
      bot.spellTrap.forEach((card, index) => {
        if (!card || card.cardKind !== "spell") return;
        const effect = (card.effects || []).find(
          (e) => e.timing === "ignition",
        );
        if (!effect) return;
        if (!isSimulatedState) {
          const check = game.effectEngine?.checkOncePerTurn?.(
            card,
            bot,
            effect,
          );
          if (check?.ok === false) return;
        }

        // Avaliação específica para Gravitational Pull
        if (card.id === VOID_IDS.GRAVITATIONAL) {
          const evaluation = this.evaluateGravitationalPull(bot, opponent);
          if (!evaluation.shouldActivate) {
            // Não adicionar a ação se não for vantajoso
            return;
          }
          actions.push({
            type: "spellTrapEffect",
            zoneIndex: index,
            cardId: card.id,
            cardName: card.name,
            priority: evaluation.priority,
            activationContext: voidActivationContext,
          });
          return;
        }

        actions.push({
          type: "spellTrapEffect",
          zoneIndex: index,
          cardId: card.id,
          cardName: card.name,
          priority: 5.5,
          activationContext: voidActivationContext,
        });
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FIELD MONSTER IGNITIONS
    // Cobre Conjurer (recruta deck), Walker (bounce + SS), Bone Spider (lock),
    // Ghost Wolf (direct), Thousand-Arms (bounce-revive), Cosmic Walker (revive Hollow).
    // ═══════════════════════════════════════════════════════════════════════════
    (bot.field || []).forEach((card, fieldIndex) => {
      if (
        !card ||
        card.cardKind !== "monster" ||
        card.isFacedown ||
        card.effectsNegated
      ) {
        return;
      }

      const fieldIgnition = (card.effects || []).find(
        (e) =>
          e &&
          e.timing === "ignition" &&
          (!e.requireZone || e.requireZone === "field"),
      );
      if (!fieldIgnition) return;

      if (!isSimulatedState) {
        const preview = game?.effectEngine?.canActivateMonsterEffectPreview?.(
          card,
          bot,
          "field",
          null,
          {},
        );
        if (preview && preview.ok === false) return;
      } else {
        // Em simulação, validar OPT manualmente para evitar duplicar ações
        const optCheck = game.effectEngine?.checkOncePerTurn?.(
          card,
          bot,
          fieldIgnition,
        );
        if (optCheck?.ok === false) return;
      }

      const fieldIgnitionValidation = validateVoidFieldIgnitionCandidate({
        card,
        effect: fieldIgnition,
        player: bot,
      });
      if (!fieldIgnitionValidation.ok) return;

      const oppFieldCount = analysis.oppFieldCount || 0;
      const oppStrongestAtk = analysis.oppStrongestAtk || 0;
      const hollowsInGY = (bot.graveyard || []).filter(
        (c) => c?.id === VOID_IDS.HOLLOW,
      ).length;
      const fieldHasSpace = (bot.field || []).length < 5;

      let priority = 0;

      switch (card.id) {
        case VOID_IDS.CONJURER: {
          // Engine principal: recruta Void lv4- do deck
          if (!fieldHasSpace) break;
          priority = 8.5;
          if (handIds.includes(VOID_IDS.HOLLOW)) priority += 1.0;
          // Reciclar via Gravitational depois é payoff extra
          if (handIds.includes(VOID_IDS.GRAVITATIONAL)) priority += 0.3;
          break;
        }
        case VOID_IDS.WALKER: {
          // Bounce self → SS Void lv4- da mão (não Walker)
          if (!fieldHasSpace) break;
          if (handIds.includes(VOID_IDS.HOLLOW)) {
            priority = 9.0; // Walker into Hollow é o melhor combo de extensão
          } else {
            const otherVoidLv4 = (bot.hand || []).filter(
              (c) =>
                isVoid(c) &&
                c.id !== VOID_IDS.WALKER &&
                c.id !== VOID_IDS.RAVEN &&
                (c.level || 0) <= 4 &&
                (c.atk || 0) > 0,
            ).length;
            priority = otherVoidLv4 > 0 ? 6.0 : 0;
          }
          break;
        }
        case VOID_IDS.THOUSAND_ARMS: {
          // Bounce self → SS até 2 Hollows do GY com +700 ATK/DEF
          const maliciousSetup = getThousandArmsMaliciousSetup(
            game,
            bot,
            card,
          );
          if (
            isMaliciousAscensionReady(game, bot, card) ||
            maliciousSetup.shouldHoldForAscension ||
            maliciousSetup.shouldDelayFreshBounce
          ) {
            break;
          }
          if (hollowsInGY < 1) break;
          priority = 7.0;
          priority += Math.min(hollowsInGY, 2) * 0.75; // até +1.5
          // Caminho para Malicious Demon ascension (precisa 2 ativações)
          if (maliciousSetup.hasMalicious) {
            priority += maliciousSetup.activations >= 1 ? 0.8 : 1.5;
          }
          priority +=
            hollowResourcePolicy.spend?.thousandArmsRevive?.scoreDelta ??
            (preserveHollowsForFinisher ? -3.0 : 0);
          break;
        }
        case VOID_IDS.COSMIC_WALKER: {
          // Revive 1 Void Hollow do GY.
          if (!fieldHasSpace || hollowsInGY < 1) break;
          priority = 7.0 + Math.min(hollowsInGY, 2) * 0.5;
          if (swarmPayoffs.hasFusionPayoff || swarmPayoffs.hasBossPayoff) {
            priority += 0.5;
          }
          priority +=
            hollowResourcePolicy.spend?.cosmicWalkerRevive?.scoreDelta ??
            (preserveHollowsForFinisher ? -2.5 : 0);
          break;
        }
        case VOID_IDS.BONE_SPIDER: {
          // Locka 1 monstro inimigo até o final do próximo turno
          if (oppFieldCount === 0) break;
          priority = 4.0;
          if (oppStrongestAtk >= 2000) priority += 1.5;
          if (oppStrongestAtk >= 2500) priority += 1.0;
          break;
        }
        case VOID_IDS.GHOST_WOLF: {
          // Halve ATK + direct attack para contornar ameaça ou fechar pressão.
          const phase = String(game?.phase || "").toLowerCase();
          const isPostBattle =
            phase.includes("main2") ||
            phase.includes("main_2") ||
            phase.includes("end");
          if (
            isPostBattle ||
            card.hasAttacked ||
            card.cannotAttackThisTurn ||
            card.position === "defense"
          ) {
            break;
          }
          const halvedDamage = Math.floor((card.atk || 0) / 2);
          const oppLP = analysis.oppLP || 8000;
          const canClearThreat =
            oppStrongestAtk > 0 && (card.atk || 0) > oppStrongestAtk;
          const fieldIsHard = oppFieldCount > 0 && !canClearThreat;
          if (halvedDamage >= oppLP) {
            priority = 12.0; // letal
          } else if (fieldIsHard && oppLP <= 2500) {
            priority = 6.5;
          } else if (fieldIsHard && oppStrongestAtk >= (card.atk || 0)) {
            priority = 4.8;
          } else if (oppLP <= 2000) {
            priority = 6.5;
          } else if (oppFieldCount === 0) {
            priority = 3.5;
          } else {
            priority = 0;
          }
          break;
        }
        default: {
          // Outros monstros Void com ignition genérico — fallback baixo
          const knowledge = getVoidCardKnowledge(card);
          priority = knowledge?.role === "boss" ? 5.0 : 4.0;
        }
      }

      if (priority <= 0) return;

      actions.push({
        type: "monsterEffect",
        fieldIndex,
        cardId: card.id,
        cardName: card.name,
        priority,
        effectId: fieldIgnition.id,
        activationContext: voidActivationContext,
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // GRAVEYARD MONSTER IGNITIONS
    // Cobre Conjurer GY-revive, Tenebris Horn once-per-duel revive,
    // Forgotten Knight banish-to-destroy, Haunter banish-to-revive Hollows.
    // ═══════════════════════════════════════════════════════════════════════════
    (bot.graveyard || []).forEach((card, graveyardIndex) => {
      if (!card || card.cardKind !== "monster") return;

      const gyIgnition = (card.effects || []).find(
        (e) =>
          e && e.timing === "ignition" && e.requireZone === "graveyard",
      );
      if (!gyIgnition) return;

      if (!isSimulatedState) {
        const preview = game?.effectEngine?.canActivateMonsterEffectPreview?.(
          card,
          bot,
          "graveyard",
          null,
          {},
        );
        if (preview && preview.ok === false) return;
      } else {
        const optCheck = game.effectEngine?.checkOncePerTurn?.(
          card,
          bot,
          gyIgnition,
        );
        if (optCheck?.ok === false) return;
        const opdCheck = game.effectEngine?.checkOncePerDuel?.(
          card,
          bot,
          gyIgnition,
        );
        if (opdCheck?.ok === false) return;
      }

      const fieldHasSpace = (bot.field || []).length < 5;
      const hollowsInGY = (bot.graveyard || []).filter(
        (c) => c?.id === VOID_IDS.HOLLOW,
      ).length;
      const oppFaceUpST =
        ((opponent?.spellTrap || []).filter(
          (c) => c && !c.isFacedown,
        ).length || 0) + (opponent?.fieldSpell ? 1 : 0);

      let priority = 0;

      switch (card.id) {
        case VOID_IDS.CONJURER: {
          // Tributa 1 Void do campo → SS Conjurer do GY
          const revivePlan = this.evaluateConjurerGraveyardRevive(
            analysis,
            game,
            bot,
            card,
          );
          if (!revivePlan.shouldActivate) break;
          priority = revivePlan.priority;
          break;
        }
        case VOID_IDS.TENEBRIS_HORN: {
          // Once per duel: SS self do GY
          if (!fieldHasSpace) break;
          if (preserveArcturusSoloBuff) break;
          priority = 6.5;
          // Cada Void no campo aumenta valor (passive scaling)
          priority += Math.min(analysis.voidCount || 0, 4) * 0.4;
          break;
        }
        case VOID_IDS.FORGOTTEN_KNIGHT: {
          // Banir self do GY → destruir 1 face-up S/T do oponente
          if (oppFaceUpST < 1) break;
          priority = 7.0;
          if (opponent?.fieldSpell) priority += 1.0; // field spells são valiosos
          break;
        }
        case VOID_IDS.HAUNTER: {
          // Banir self do GY → SS até 3 Hollows do GY com ATK/DEF 0
          if (hollowsInGY < 1 || !fieldHasSpace) break;
          if (preserveArcturusSoloBuff) break;
          priority = 8.0;
          priority += Math.min(hollowsInGY, 3) * 0.5; // até +1.5
          // Payoffs para os Hollows revividos
          const hasPoly = handIds.includes(VOID_IDS.POLYMERIZATION);
          const extraIds = (bot.extraDeck || [])
            .map((c) => c?.id)
            .filter(Boolean);
          if (hasPoly && extraIds.includes(VOID_IDS.HOLLOW_KING)) {
            priority += 1.5; // Hollow King fusion fica disponível
          }
          if (hasPoly && extraIds.includes(VOID_IDS.HYDRA_TITAN)) {
            priority += 1.0; // material para Hydra
          }
          priority +=
            hollowResourcePolicy.spend?.haunterRevive?.scoreDelta ??
            (preserveHollowsForFinisher ? -3.0 : 0);
          break;
        }
        default: {
          // Outros GY ignitions desconhecidos — fallback conservador
          priority = 3.0;
        }
      }

      if (priority <= 0) return;

      actions.push({
        type: "graveyardMonsterEffect",
        graveyardIndex,
        cardId: card.id,
        cardName: card.name,
        priority,
        effectId: gyIgnition.id,
        activationContext: voidActivationContext,
      });
    });

    if (bot.fieldSpell) {
      const effect = (bot.fieldSpell.effects || []).find(
        (e) => e.timing === "on_field_activate",
      );
      if (effect) {
        // Verificar once per turn
        const check = !isSimulatedState
          ? game.effectEngine?.checkOncePerTurn?.(bot.fieldSpell, bot, effect)
          : { ok: true };
        if (check?.ok === false) {
          // Já usado neste turno, não gerar ação
        } else {
          // Verificar requireEmptyField
          if (effect.requireEmptyField && bot.field && bot.field.length > 0) {
            // Não pode ativar - tem monstros no campo
          } else {
            // Verificar se tem alvos válidos (para The Void, precisa de monstro no GY)
            let hasValidTargets = true;
            if (bot.fieldSpell.id === VOID_IDS.THE_VOID) {
              // The Void precisa de monstro Void level 4- no GY
              const validTargets = (bot.graveyard || []).filter(
                (c) =>
                  c?.cardKind === "monster" && isVoid(c) && (c.level || 0) <= 4,
              );
              hasValidTargets = validTargets.length > 0;
            }

            if (hasValidTargets) {
              actions.push({
                type: "fieldEffect",
                priority: 6,
                cardName: bot.fieldSpell.name,
                activationContext: voidActivationContext,
              });
            }
          }
        }
      }
    }

    const positionActions = this.getPositionChangeActions(game, bot, opponent);
    if (positionActions.length > 0) {
      actions.push(...positionActions);
    }

    return this.integrateP2IntoActionSelection(
      game,
      this.sequenceActions(actions),
    );
  }

  /**
   * Calcula boosts de prioridade para cartas baseado em combos detectados.
   * @param {Object} analysis - Análise do estado do jogo
   * @returns {Object} - Map de cardId -> boost
   */
  calculateComboBoosts(analysis) {
    const boosts = {};
    const readyCombos = analysis.readyCombos || [];

    for (const comboInfo of readyCombos) {
      const combo = comboInfo.combo;
      if (!combo) continue;

      // Boost para cartas que iniciam o combo
      if (combo.sequence && combo.sequence.length > 0) {
        const firstStep = combo.sequence[0];
        if (firstStep.cardId) {
          boosts[firstStep.cardId] =
            (boosts[firstStep.cardId] || 0) + combo.priority / 5;
        }
      }

      // Boost para materiais de fusão
      if (combo.fusion) {
        for (const materialId of combo.fusion.materials || []) {
          if (typeof materialId === "number") {
            boosts[materialId] = (boosts[materialId] || 0) + 0.5;
          }
        }
      }
    }

    return boosts;
  }

  /**
   * Avalia a oportunidade de fazer uma fusão.
   * @param {Object} analysis - Análise do estado do jogo
   * @returns {number} - Valor da fusão
   */
  evaluateFusionOpportunity(analysis) {
    const readyCombos = analysis.readyCombos || [];
    const fusionCombos = readyCombos.filter((c) => c.combo?.fusion);

    if (fusionCombos.length === 0) return 0;

    // Pegar a melhor fusão disponível
    const best = fusionCombos[0];
    return calculateFusionValue(best.combo.fusion.target, analysis);
  }

  sequenceActions(actions) {
    // Sequenciamento inteligente baseado em combos
    const sorted = actions.sort((a, b) => {
      const planA = Number.isFinite(a.finisherPlanRank)
        ? a.finisherPlanRank
        : -1;
      const planB = Number.isFinite(b.finisherPlanRank)
        ? b.finisherPlanRank
        : -1;
      if (planA !== planB) return planB - planA;
      // 1. Extra deck actions (fusão/ascensão) têm prioridade especial
      const extraA = a.extraDeck ? 1 : 0;
      const extraB = b.extraDeck ? 1 : 0;
      if (extraA !== extraB) return extraB - extraA;

      // 2. Dentro de mesma categoria, ordenar por prioridade
      const priorityA = a.priority ?? 0;
      const priorityB = b.priority ?? 0;

      // 3. Desempate: preferir summons antes de spells (setup antes de payoff)
      if (priorityA === priorityB) {
        const typeOrder = {
          summon: 3,
          handIgnition: 2,
          spell: 1,
          position_change: 0,
        };
        return (typeOrder[b.type] || 0) - (typeOrder[a.type] || 0);
      }

      return priorityB - priorityA;
    });

    return sorted;
  }

  recordSimulatedMaterialActivation(state, player, card) {
    if (![VOID_IDS.WALKER, VOID_IDS.THOUSAND_ARMS].includes(card?.id)) {
      return;
    }
    const playerId = player?.id || "bot";
    if (!state._simMaterialEffectActivationsByMaterialId) {
      state._simMaterialEffectActivationsByMaterialId = {};
    }
    if (!state._simMaterialEffectActivationsByMaterialId[playerId]) {
      state._simMaterialEffectActivationsByMaterialId[playerId] = {};
    }
    const bucket = state._simMaterialEffectActivationsByMaterialId[playerId];
    bucket[card.id] = (bucket[card.id] || 0) + 1;
    if (!player._simMaterialEffectActivationsByMaterialId) {
      player._simMaterialEffectActivationsByMaterialId = {};
    }
    player._simMaterialEffectActivationsByMaterialId[card.id] =
      (player._simMaterialEffectActivationsByMaterialId[card.id] || 0) + 1;
  }

  simulateVoidHollowRecruit({ state, player, card, fromZone, action }) {
    if (card?.id !== VOID_IDS.HOLLOW || fromZone !== "hand") return;
    if (card.effectsNegated || state._simVoidHollowRecruitUsed) return;
    if ((player.field || []).length >= 5) return;
    const deckIndex = (player.deck || []).findIndex(
      (candidate) => candidate?.id === VOID_IDS.HOLLOW,
    );
    if (deckIndex < 0) return;
    const recruited = player.deck.splice(deckIndex, 1)[0];
    recruited.position =
      this.chooseSpecialSummonPosition(recruited, {
        game: state,
        player,
        action,
        source: card,
      }) || "defense";
    recruited.isFacedown = false;
    recruited.hasAttacked = false;
    recruited.attacksUsedThisTurn = 0;
    player.field.push(recruited);
    state._simVoidHollowRecruitUsed = true;
  }

  handleVoidSimulatedSpecialSummon(payload = {}) {
    const { state, player, card, fromZone, action } = payload;
    if (!card || !player) return;
    if (card.id === VOID_IDS.WALKER) {
      card.cannotAttackThisTurn = true;
    }
    this.simulateVoidHollowRecruit({ state, player, card, fromZone, action });
  }

  handleVoidSimulatedNormalSummon({ state, player, newCard } = {}) {
    if (!state || !player || !newCard) return;
    if (newCard.id !== VOID_IDS.BEAST || state._simVoidBeastSearchUsed) return;
    const deckIndex = (player.deck || []).findIndex(
      (candidate) => candidate?.id === VOID_IDS.HOLLOW,
    );
    if (deckIndex < 0) return;
    const searched = player.deck.splice(deckIndex, 1)[0];
    player.hand.push(searched);
    state._simVoidBeastSearchUsed = true;
  }

  handleVoidSimulatedFusionSummon({ state, player, fusionCard } = {}) {
    if (!state || !player || !fusionCard || !isVoid(fusionCard)) return;
    const ravenIndex = (player.hand || []).findIndex(
      (card) => card?.id === VOID_IDS.RAVEN,
    );
    if (ravenIndex >= 0) {
      const raven = player.hand.splice(ravenIndex, 1)[0];
      player.graveyard.push(raven);
      fusionCard.immuneToOpponentEffectsUntilTurn =
        (state.turnCounter || 0) + 1;
      fusionCard._simProtectedByRaven = true;
    }

    if (fusionCard.id !== VOID_IDS.HYDRA_TITAN) return;
    const destroyed = [];
    player.field = (player.field || []).filter((card) => {
      if (!card || card === fusionCard || card.cardKind !== "monster") {
        return true;
      }
      destroyed.push(card);
      return false;
    });
    destroyed.forEach((card) => player.graveyard.push(card));
    destroyed.forEach(() => {
      const drawn = player.deck?.shift?.();
      if (drawn) player.hand.push(drawn);
    });
  }

  buildVoidSimulationOptions(action) {
    const placeSpellCard = (simState, placedCard) => {
      const player = simState.bot;
      if (placedCard.subtype === "field") {
        if (player.fieldSpell) player.graveyard.push(player.fieldSpell);
        player.fieldSpell = placedCard;
        return { placed: true };
      }
      if (
        placedCard.subtype === "continuous" ||
        placedCard.subtype === "equip"
      ) {
        player.spellTrap = player.spellTrap || [];
        player.spellTrap.push(placedCard);
        return { placed: true };
      }
      return { placed: false };
    };

    return {
      archetype: "Void",
      guardLabel: "VoidStrategy",
      strategy: this,
      activationContext: action.activationContext,
      rankSearchCandidates: this.rankSearchCandidates.bind(this),
      evaluateRecruitCandidate: this.evaluateRecruitCandidate.bind(this),
      chooseSpecialSummonPosition: this.chooseSpecialSummonPosition.bind(this),
      getTributeRequirementFor: this.getTributeRequirementFor.bind(this),
      selectBestTributes: this.selectBestTributes.bind(this),
      placeSpellCard,
      onAfterSummon: (payload) => this.handleVoidSimulatedNormalSummon(payload),
      onAfterSpecialSummon: (payload) =>
        this.handleVoidSimulatedSpecialSummon(payload),
      onFusionSummon: (payload) => this.handleVoidSimulatedFusionSummon(payload),
      onEffectActivated: ({ state, player, card }) =>
        this.recordSimulatedMaterialActivation(state, player, card),
    };
  }

  simulateMainPhaseAction(state, action) {
    if (!action) return state;
    applyGenericSimulatedMainPhaseAction(
      state,
      action,
      this.buildVoidSimulationOptions(action),
    );
    return state;
  }

  /**
   * Override: tributos para Normal Summon (Arcturus 2 tributos, Forgotten Knight
   * lv5, etc.) usam costPolicy Void — preferindo Hollows quando não há fusion path,
   * preservando engine pieces (Conjurer/Walker/Tenebris Horn) e bosses do campo.
   */
  selectBestTributes(field, tributesNeeded, cardToSummon, context = {}) {
    if (tributesNeeded <= 0 || !field || field.length < tributesNeeded) {
      return [];
    }
    const game = context?.game || this.bot?.game;
    const analysis =
      this.currentAnalysis ||
      (game ? this.analyzeGameState(game) : { field });
    const policy = buildVoidTributePolicy(analysis);
    return selectBestTributesGeneric(
      field,
      tributesNeeded,
      cardToSummon,
      context,
      policy,
    );
  }
}
