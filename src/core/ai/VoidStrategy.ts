import type { StrategyCard, VoidPlayer, VoidGame, VoidAnalysisInput, VoidActivationContext, VoidSelectionAction, VoidSelectionContext, VoidAscensionContext, VoidBattleContext, VoidCompleteAnalysis, StrategySimulation, VoidSummonPayload } from "./void/types.js";
import { analyzeVoidGameState, analyzeVoidSwarmPayoffs, decideVoidMacroStrategy, calculateVoidComboBoosts, evaluateVoidFusionOpportunity, getOpponentStrongestBattleStat, getMirrorDimensionCandidateScore } from "./void/analysis.js";
import { generateVoidMainPhaseActions, sequenceVoidActions } from "./void/actionGeneration.js";
import { refreshSimulatedFieldAuras } from "./common/zones.js";

import { createMaterialDuelStats, recordMaterialEffectActivationInStats } from "../game/summon/materialStats.js";
import type { AIAction, AIPlannedAction, AIPlanningContext, AIState, AIStrategyBotPort } from "../contracts/ai.js";
import type { AiStateShape, SimulatedCardState, SimulatedPlayerState, SimulationGameState } from "../contracts/aiState.js";

import type { EffectDefinition } from "../contracts/effects.js";
import type { buildVoidCostPreferences } from "./void/costPolicy.js";
import type { FinisherPlan } from "./common/finisherPlans.js";

import BaseStrategy from "./BaseStrategy.js";
import { applyGenericSimulatedMainPhaseAction } from "./common/simulation.js";

import { isVoid, getVoidCardKnowledge } from "./void/knowledge.js";
import { assessVoidSummonEntry, evaluateVoidFinisherPlans, evaluateVoidFusionPriority } from "./void/priorities.js";
import { VOID_IDS, COMBO_DATABASE } from "./void/combos.js";
import { evaluateBoardVoid, evaluateVoidMonster } from "./void/scoring.js";
import { buildVoidActivationContext, buildVoidTributePolicy } from "./void/costPolicy.js";
import { selectBestTributes as selectBestTributesGeneric } from "./common/tributePolicy.js";
import { getEffectiveStat } from "./common/cardStats.js";

import { buildVoidPlanningProfile, describeVoidPlannedLine, scoreVoidLineMilestones, scoreVoidLineTerminal } from "./void/linePlanning.js";
import { fieldHasTributeValue } from "../game/summon/tributeValue.js";

const CONJURER_REVIVE_PROTECTED_COST_IDS = new Set([
  VOID_IDS.ARCTURUS,
  VOID_IDS.HOLLOW_KING,
  VOID_IDS.BERSERKER,
  VOID_IDS.HYDRA_TITAN,
  VOID_IDS.COSMIC_WALKER,
  VOID_IDS.MALICIOUS_DEMON,
  VOID_IDS.FALLEN_ARCTURUS,
  VOID_IDS.SLAYER_BRUTE,
  VOID_IDS.SERPENT_DRAKE,
  VOID_IDS.THOUSAND_ARMS,
]);

function getEffectiveBattleStat(card: StrategyCard | null | undefined, stat: "atk" | "def") {
  return getEffectiveStat(card, stat);
}

function assessConjurerReviveCostRisk(card: StrategyCard, analysis: VoidAnalysisInput = {}) {
  const knowledge = getVoidCardKnowledge(card);
  const protectedBoss =
    CONJURER_REVIVE_PROTECTED_COST_IDS.has(card?.id!) ||
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

function isMirrorDimensionContext(source: Partial<StrategyCard>, action: VoidSelectionAction = {}) {
  return (
    source?.id === VOID_IDS.MIRROR_DIMENSION ||
    source?.name === "Void Mirror Dimension" ||
    action?.type === "special_summon_matching_level"
  );
}

function hasImmediateVoidFusionPlan(bot: VoidPlayer) {
  const handIds = (bot?.hand || []).map((card) => card?.id).filter(Boolean);
  if (!handIds.includes(VOID_IDS.POLYMERIZATION)) return false;
  const fusionEval = evaluateVoidFusionPriority(bot);
  return (fusionEval?.priority || 0) >= 9;
}

export default class VoidStrategy extends BaseStrategy {
  declare bot: VoidPlayer & { game?: VoidGame };
  declare currentAnalysis: VoidCompleteAnalysis | null;
  declare thoughtProcess: string[];
  declare knownCombos: typeof COMBO_DATABASE;
  constructor(bot: AIStrategyBotPort) {
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
  override evaluateBoard(gameOrState: AIState, perspectivePlayer?: SimulatedPlayerState) {
    return evaluateBoardVoid(gameOrState, perspectivePlayer);
  }

  override evaluateBoardV2(gameOrState: AIState, perspectivePlayer?: SimulatedPlayerState) {
    return evaluateBoardVoid(gameOrState, perspectivePlayer);
  }

  override getPlanningProfile(game: AIState, context: AIPlanningContext & { analysis?: VoidAnalysisInput } = {}) {
    const analysis = context.analysis || this.analyzeGameState(game);
    return buildVoidPlanningProfile(analysis, {
      ...context,
      game: game as VoidGame,
      strategy: this,
    });
  }

  override shouldUseDeepPlanning(game: AIState, context: AIPlanningContext = {}) {
    const profile =
      context.profile || this.getPlanningProfile(game, context);
    return (game as VoidGame)?.turnLineSearchEnabled === true || profile.enabled === true;
  }

  override scoreLineMilestones(context: AIPlanningContext = {}) {
    return scoreVoidLineMilestones(context);
  }

  override scoreLineTerminal(context: AIPlanningContext = {}) {
    return scoreVoidLineTerminal(context);
  }

  override describePlannedLine(context: AIPlanningContext = {}) {
    return describeVoidPlannedLine(context);
  }

  /**
   * Analisa o estado atual e detecta combos disponíveis.
   */
  analyzeGameState(gameInput: AIState): VoidCompleteAnalysis {
    return analyzeVoidGameState.call(this, gameInput);
  }

  /**
   * Analisa quais payoffs estão disponíveis para justificar um swarm de Hollows.
   * Swarm sem payoff = campo fraco que será destruído.
   */
  analyzeSwarmPayoffs(analysis: Pick<VoidAnalysisInput, "hand" | "field" | "graveyard" | "extraDeck">) {
    return analyzeVoidSwarmPayoffs(analysis);
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
  evaluateRecruitCandidate<Card extends StrategyCard>(candidates: Card[], context: VoidSelectionContext = {}) {
    if (!candidates || candidates.length === 0) {
      return { best: null, scores: [], reasoning: "No candidates" };
    }

    const game = (context.game || this.bot?.game) as VoidGame | undefined;
    const bot = context.player || this.bot || game?.bot;
    const analysis = this.currentAnalysis || this.analyzeGameState(game!);
    const hollowEconomy = analysis?.hollowEconomy || {};
    const opponent = game ? this.getOpponent(game, bot) : null;

    const hand = bot?.hand || [];
    const field = bot?.field || [];
    const graveyard = bot?.graveyard || [];
    const source: Partial<StrategyCard> = context.source || {};
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
      let reasons: string[] = [];
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
          // Bone Spider converte Hollow em lock de ataque e revive Hollow ao sair.
          if (
            (analysis.oppFieldCount || 0) > 0 &&
            hollowsInHand + hollowsOnField > 0
          ) {
            score += 1.7;
            reasons.push(`Bone Spider com Hollow para lock (+1.7)`);
          } else if ((analysis.oppFieldCount || 0) > 0) {
            score += 0.6;
            reasons.push(`Bone Spider sem Hollow disponivel (+0.6)`);
          } else {
            score += 0.4;
            reasons.push(`Bone Spider sem alvos (+0.4)`);
          }
          break;

        case VOID_IDS.TENEBRIS_HORN:
          // Escala com Voids no campo proprio e no GY.
          const voidCount =
            field.filter(isVoid).length + graveyard.filter(isVoid).length + 1;
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
      asBotSelect: () => [best].filter(Boolean) as Card[],
    };
  }

  chooseSpecialSummonPosition(card: StrategyCard | undefined, context: VoidSelectionContext = {}) {
    const game = (context.game || this.bot?.game) as VoidGame | undefined;
    const player = context.player || this.bot || game?.bot;
    const opponent = game ? this.getOpponent(game, player) : null;
    const analysis = game?._isPerspectiveState
      ? this.analyzeGameState(game)
      : this.currentAnalysis || (game ? this.analyzeGameState(game) : null);
    return assessVoidSummonEntry(card!, {
      game,
      player,
      opponent,
      analysis,
      source: context.source,
      action: context.action,
    }).position;
  }

  chooseVoidAscensionPosition(ascensionCard: StrategyCard | undefined, material: StrategyCard | undefined, game: AIState | undefined, finisherPlan: FinisherPlan | null | undefined = null) {
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

  selectAutomaticAscension<Card extends StrategyCard>({ choices = [], game: gameInput, bot = this.bot, opponent }: VoidAscensionContext<Card> = {}) {
    const game = gameInput as VoidGame | undefined;
    if (!Array.isArray(choices) || choices.length === 0) {
      return { skip: true };
    }
    const analysis = game ? this.analyzeGameState(game) : this.currentAnalysis;
    const plans =
      analysis?.finisherPlans ||
      evaluateVoidFinisherPlans(bot, opponent!, game!, analysis);
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
    if (!best) return { skip: true };
    return {
      material: best.material,
      ascensionCard: best.ascensionCard,
      position: this.chooseVoidAscensionPosition(
        best.ascensionCard,
        best.material,
        game,
        best.plan,
      ),
      reason: best.plan!.reason,
    };
  }

  chooseAutomaticAscensionPosition({
    ascensionCard,
    material,
    game,
  }: VoidAscensionContext = {}) {
    return this.chooseVoidAscensionPosition(ascensionCard, material, game);
  }

  scoreBattleAttackCandidate(context: VoidBattleContext = {}) {
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
  rankSearchCandidates<Card extends StrategyCard>(cards: Card[], action: VoidSelectionAction = {}, ctx: VoidSelectionContext = {}) {
    if (!Array.isArray(cards) || cards.length === 0) return [];

    const source: Partial<StrategyCard> = ctx?.source || {};
    const isLostThroneSearch =
      action?.type === "search_then_optional_special_summon_from_hand" &&
      (source.id === VOID_IDS.LOST_THRONE ||
        source.name === "Void Lost Throne");

    if (!isLostThroneSearch) {
      return this.evaluateRecruitCandidate(cards, ctx).asBotSelect!();
    }

    const game = (ctx.game || this.bot?.game) as VoidGame | undefined;
    const bot = ctx.player || this.bot || game?.bot;
    const fieldEmpty = (bot?.field || []).length === 0;
    const analysis: VoidAnalysisInput = this.currentAnalysis || (game ? this.analyzeGameState(game) : {});
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
  evaluateGravitationalPull(bot: VoidPlayer, opponent: VoidPlayer | null) {
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
    const firstVoid = myVoids[0];
    const firstOpponent = oppMonsters[0];
    if (!firstVoid || !firstOpponent) {
      return { shouldActivate: false, priority: 0, reason: "Sem alvos válidos" };
    }

    // Calcular valores
    const myWeakest = myVoids.reduce(
      (min, m) => {
        const atk = (m.atk || 0);
        return atk < min.atk ? { card: m, atk } : min;
      },
      {
        card: firstVoid,
        atk: (firstVoid.atk || 0),
      },
    );

    const oppStrongest = oppMonsters.reduce(
      (max, m) => {
        const atk = m.isFacedown ? 1500 : (m.atk || 0);
        return atk > max.atk ? { card: m, atk } : max;
      },
      { card: firstOpponent, atk: 0 },
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
  evaluateConjurerGraveyardRevive(analysis: VoidAnalysisInput, game: VoidGame, bot: VoidPlayer, conjurerCard: StrategyCard) {
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

    const reasons: string[] = [];
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
        analysis.swarmPayoffs?.totalPayoffValue! >= 2.0)
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

  chooseLowestValueConjurerCost<Card extends StrategyCard>(analysis: VoidAnalysisInput, candidates: Card[]) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const activationContext = buildVoidActivationContext(analysis) as VoidActivationContext;
    const costPreferences: Partial<ReturnType<typeof buildVoidCostPreferences>> =
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
        if (preferNames.has(card?.name!)) score -= 3;
        if (preserveNames.has(card?.name!)) score += 18;
        if (payoffNames.has(card?.name!)) score += 4;
        if (card?.isToken) score -= 4;
        if (card?.usedEffectThisTurn) score -= 1.5;
        if (card?.hasAttacked) score -= 1;
        if (card?.isFacedown) score -= 0.5;
        if (costRisk.protectedBoss) score += 100;
        return { card, score, id: card?.id, costRisk };
      })
      .sort((a, b) => a.score - b.score)[0];
  }

  decideMacroStrategy(analysis: VoidAnalysisInput) {
    return decideVoidMacroStrategy(analysis);
  }

  override generateMainPhaseActions(gameInput: AIState): AIAction[] {
    return generateVoidMainPhaseActions.call(this, gameInput);
  }

  /**
   * Calcula boosts de prioridade para cartas baseado em combos detectados.
   * @param {Object} analysis - Análise do estado do jogo
   * @returns {Object} - Map de cardId -> boost
   */
  calculateComboBoosts(analysis: VoidAnalysisInput) {
    return calculateVoidComboBoosts(analysis);
  }

  /**
   * Avalia a oportunidade de fazer uma fusão.
   * @param {Object} analysis - Análise do estado do jogo
   * @returns {number} - Valor da fusão
   */
  evaluateFusionOpportunity(analysis: VoidAnalysisInput) {
    return evaluateVoidFusionOpportunity(analysis);
  }

  override sequenceActions(actions: AIAction[]) {
    return sequenceVoidActions(actions);
  }

  applySimulatedVoidPassives(state?: AiStateShape) {
    if (state) refreshSimulatedFieldAuras(state);
  }

  recordSimulatedMaterialActivation(state: AiStateShape, player: SimulatedPlayerState, card: SimulatedCardState, effect?: EffectDefinition) {
    state.materialDuelStats ||= createMaterialDuelStats();
    recordMaterialEffectActivationInStats(state.materialDuelStats, player.id, card, effect?.id);
  }

  buildVoidSimulationOptions(action?: AIAction) {
    return {
      archetype: "Void",
      guardLabel: "VoidStrategy",
      strategy: this,
      activationContext: action?.activationContext,
      rankSearchCandidates: this.rankSearchCandidates.bind(this),
      evaluateRecruitCandidate: this.evaluateRecruitCandidate.bind(this),
      chooseSpecialSummonPosition: this.chooseSpecialSummonPosition.bind(this),
      getTributeRequirementFor: this.getTributeRequirementFor.bind(this),
      selectBestTributes: this.selectBestTributes.bind(this),
      placeSpellCard: this.placeSpellCard.bind(this),
      enableSimulatedEvents: true,
    };
  }

  getPlanningSimulationOptions(_state: StrategySimulation) {
    return this.buildVoidSimulationOptions();
  }

  override simulateMainPhaseAction(state: StrategySimulation, action: AIPlannedAction | null | undefined) {
    if (!action) return state;
    applyGenericSimulatedMainPhaseAction(
      state as SimulationGameState,
      action as AIAction,
      { ...this.getPlanningSimulationOptions(state), activationContext: (action as AIAction).activationContext },
    );
    this.applySimulatedVoidPassives(state);
    return state;
  }

  /**
   * Override: tributos para Normal Summon (Arcturus 2 tributos, Forgotten Knight
   * lv5, etc.) usam costPolicy Void — preferindo Hollows quando não há fusion path,
   * preservando engine pieces (Conjurer/Walker/Tenebris Horn) e bosses do campo.
   */
  override selectBestTributes(field: StrategyCard[], tributesNeeded: number, cardToSummon: StrategyCard, context: { game?: AIState; oppField?: StrategyCard[]; botState?: AIStrategyBotPort; evaluationContext?: object } = {}) {
    if (
      tributesNeeded <= 0 ||
      !fieldHasTributeValue(field || [], tributesNeeded, cardToSummon)
    ) {
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
