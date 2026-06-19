import BaseStrategy from "./BaseStrategy.js";
import { sequenceActionsByPriority } from "./common/actionSequencing.js";
import {
  estimateCardValue,
  estimateOffensiveTemporaryBuffValue,
  estimateMonsterValue,
  hasArchetype,
} from "./StrategyUtils.js";
import {
  decideMacroStrategy,
} from "./MacroPlanning.js";
import {
  evaluateActionBlockingRisk,
} from "./ChainAwareness.js";
// P2 (gameTreeSearch, analyzeOpponent etc.) está em BaseStrategy.
import { isLuminarch } from "./luminarch/knowledge.js";
import {
  evaluateLuminarchDefensePlan,
  evaluateLuminarchFinisherPlans,
  shouldSummonMonster,
} from "./luminarch/priorities.js";
import {
  detectAvailableCombos,
  shouldPrioritizeDefense,
  canAttemptLethal,
  shouldTurtleStrategy,
} from "./luminarch/combos.js";
import {
  evaluateGameStance,
  planNextTurns,
} from "./luminarch/multiTurnPlanning.js";
import {
  buildLuminarchActivationContext,
} from "./luminarch/actionContext.js";
import { buildLuminarchResourceEconomy } from "./luminarch/resourceEconomy.js";
import { getLuminarchSummonActions } from "./luminarch/summonActions.js";
import { getLuminarchSpellActions } from "./luminarch/spellActions.js";
import {
  chooseLuminarchAscensionPosition,
  detectLuminarchAscensionOpportunities,
  detectLuminarchFusionOpportunities,
  evaluateLuminarchAscensionPriority,
  evaluateLuminarchFusionPriority as evaluateLuminarchFusionActionPriority,
  getLuminarchExtraDeckActions,
} from "./luminarch/extraDeckActions.js";
import {
  getLuminarchTributeRequirementFor,
  selectBestLuminarchTributes,
} from "./luminarch/tributePolicy.js";
import { buildStrategyAnalysis } from "./common/analysis.js";
import {
  getEffectiveAtk,
  getStrongestAttackThreat,
  getStrongestBattleStat,
} from "./common/cardStats.js";
import {
  fieldHasTributeValue,
  getTributeCardsFromIndices,
  getTributeValueTotal,
} from "../game/summon/tributeValue.js";
import {
  resolveSimulatedFieldIndex as resolveGenericSimulatedFieldIndex,
  resolveSimulatedHandIndex as resolveGenericSimulatedHandIndex,
} from "./common/simulation.js";
import {
  chooseLuminarchSpecialSummonPosition,
  applyLuminarchSimulatedBattleRewards,
  prepareLuminarchSimulatedBattle,
  rankLuminarchSearchCandidates,
  scoreLuminarchBattleAttackCandidate,
  simulateLuminarchMainPhaseAction,
  simulateLuminarchSearch as simulateLuminarchSearchAction,
  simulateLuminarchSpellEffect,
} from "./luminarch/simulation.js";
import {
  buildLuminarchPlanningProfile,
  describeLuminarchPlannedLine,
  scoreLuminarchLineMilestones,
  scoreLuminarchLineTerminal,
} from "./luminarch/linePlanning.js";

// Flag para logs detalhados de avaliação por carta (muito verboso - ~6000 linhas/10 duelos)
// Desligar para logs mais limpos, ligar para debug de prioridades
const VERBOSE_EVAL = false;
const CITADEL_TEMP_BUFF = {
  role: "temporary_stat_buff",
  purpose: "offense",
  atkBoost: 500,
  defBoost: 500,
};
const BARBARIAS_STANCE_DANCE = {
  role: "stance_dance_buff",
  purpose: "offense",
  preferredName: "Luminarch Megashield Barbarias",
  atkBoost: 800,
};

function findBestOffensiveTemporaryBuffTarget(monsters, opponent, preference) {
  return (monsters || []).reduce(
    (best, monster) => {
      const score = estimateOffensiveTemporaryBuffValue(monster, {
        atkBoost: preference?.atkBoost || 0,
        opponentField: opponent?.field || [],
        opponentLp: opponent?.lp || 0,
      });
      if (score > best.score) return { monster, score };
      return best;
    },
    { monster: null, score: 0 },
  );
}

function evaluateBarbariasStanceDance(card, opponent, options = {}) {
  if (!card || card.name !== "Luminarch Megashield Barbarias") {
    return { score: 0, reason: "not_barbarias" };
  }
  if (card.isFacedown || card.hasAttacked) {
    return { score: 0, reason: "barbarias_unavailable" };
  }

  const expectedAtk = getEffectiveAtk(card) + BARBARIAS_STANCE_DANCE.atkBoost;
  const opponentMonsters = (opponent?.field || []).filter(
    (monster) => monster && monster.cardKind === "monster",
  );
  const bestTargetStat = getStrongestBattleStat(opponentMonsters, {
    facedownValue: 1500,
  });
  const canClearMonster = bestTargetStat > 0 && expectedAtk > bestTargetStat;
  const directPressure = opponentMonsters.length === 0;
  const createsLethal = expectedAtk >= (opponent?.lp || 8000);

  let score = 0;
  if (card.position === "defense") score += 12;
  if (directPressure) score += 7;
  if (canClearMonster) score += 10;
  if (createsLethal) score += 16;
  if (options.afterManualDefense) score += 5;
  if (card.position === "attack" && !options.afterManualDefense) score -= 10;

  return {
    score,
    expectedAtk,
    canClearMonster,
    directPressure,
    createsLethal,
    reason: createsLethal
      ? "barbarias_lethal_push"
      : canClearMonster
        ? "barbarias_3300_trade"
        : directPressure
          ? "barbarias_direct_pressure"
          : "barbarias_stance_value",
  };
}

function canUseCitadelBuff(bot, opponent, bestBuffTarget) {
  const lp = bot?.lp || 0;
  const finalLp = lp - 1000;
  if (finalLp <= 0) return false;
  if (!bestBuffTarget?.monster || bestBuffTarget.score <= 0) return false;

  const opponentStrongest = getStrongestAttackThreat(opponent?.field || [], {
    includeFacedown: false,
    includeBoosts: false,
  });
  const target = bestBuffTarget.monster;
  const projectedDef =
    (target.def || 0) +
    (target.tempDefBoost || 0) +
    CITADEL_TEMP_BUFF.defBoost;
  const createsWall =
    target.mustBeAttacked ||
    target.battleIndestructibleOncePerTurn ||
    (opponentStrongest > 0 && projectedDef >= opponentStrongest);
  const createsPayoff = bestBuffTarget.score >= 100;

  if (finalLp <= 1500 && !createsWall && !createsPayoff) return false;
  return true;
}

export default class LuminarchStrategy extends BaseStrategy {
  buildPlanningAnalysis(game, context = {}) {
    const bot = context.bot || this.bot || game?.bot || null;
    const opponent = bot ? this.getOpponent(game, bot) : game?.player || null;
    const analysis =
      context.analysis ||
      buildStrategyAnalysis({
        bot,
        opponent,
        game,
        strategy: this,
      });

    analysis.resourceEconomy =
      analysis.resourceEconomy || buildLuminarchResourceEconomy(analysis);
    analysis.luminarchDefensePlan =
      analysis.luminarchDefensePlan || evaluateLuminarchDefensePlan(analysis);
    analysis.finisherPlans =
      analysis.finisherPlans ||
      evaluateLuminarchFinisherPlans(bot, opponent, game, analysis, {
        evaluateBarbariasStanceDance,
      });
    analysis.availableCombos =
      analysis.availableCombos || detectAvailableCombos(analysis);
    return analysis;
  }

  getPlanningProfile(game, context = {}) {
    if (!game) return super.getPlanningProfile(game, context);
    const analysis = this.buildPlanningAnalysis(game, context);
    return buildLuminarchPlanningProfile(analysis, {
      ...context,
      game,
      bot: context.bot || this.bot || game.bot,
    });
  }

  shouldUseDeepPlanning(game, context = {}) {
    const profile =
      context.profile || this.getPlanningProfile(game, context) || {};
    return game?.turnLineSearchEnabled === true || profile.enabled === true;
  }

  scoreLineMilestones(context = {}) {
    return scoreLuminarchLineMilestones(context);
  }

  scoreLineTerminal(context = {}) {
    return scoreLuminarchLineTerminal(context);
  }

  describePlannedLine(context = {}) {
    return describeLuminarchPlannedLine(context);
  }

  prepareSimulatedBattle(context = {}) {
    return prepareLuminarchSimulatedBattle(context);
  }

  applySimulatedBattleRewards(context = {}) {
    return applyLuminarchSimulatedBattleRewards(context);
  }

  scoreBattleAttackCandidate(context = {}) {
    return scoreLuminarchBattleAttackCandidate(context);
  }

  evaluateBoard(gameOrState, perspectivePlayer) {
    const perspective = perspectivePlayer?.id
      ? perspectivePlayer
      : gameOrState.bot;
    const opponent = this.getOpponent(gameOrState, perspective);
    const archetype = "Luminarch";
    const fieldSpell = perspective?.fieldSpell || null;
    const preferDefense = true;

    let score = 0;
    score += ((perspective?.lp || 0) - (opponent?.lp || 0)) / 900;

    const ownMonstersValue = (perspective?.field || []).reduce(
      (sum, monster) =>
        sum +
        estimateMonsterValue(monster, {
          archetype,
          fieldSpell,
          preferDefense,
        }),
      0,
    );
    const oppMonstersValue = (opponent?.field || []).reduce(
      (sum, monster) =>
        sum +
        estimateMonsterValue(monster, {
          fieldSpell: opponent?.fieldSpell || null,
          preferDefense: false,
        }),
      0,
    );
    score += ownMonstersValue - oppMonstersValue;

    const opponentStrongest = getStrongestAttackThreat(opponent?.field || [], {
      includeFacedown: false,
      includeBoosts: false,
    });
    const exposedAttackers = (perspective?.field || []).filter(
      (monster) =>
        monster &&
        monster.cardKind === "monster" &&
        monster.position === "attack" &&
        (monster.atk || 0) + (monster.tempAtkBoost || 0) <
          Math.max(500, opponentStrongest - 200),
    ).length;
    score -= exposedAttackers * 0.25;

    const tauntValue = (perspective?.field || []).reduce((sum, monster) => {
      if (!monster || !monster.mustBeAttacked) return sum;
      return sum + (monster.def || 0) / 2000 + 0.3;
    }, 0);
    score += tauntValue;

    const overfillPenalty =
      Math.max(0, (perspective?.field || []).length - 3) * 0.3;
    score -= overfillPenalty;

    score += fieldSpell ? 0.9 : 0;
    score -= opponent?.fieldSpell ? 0.6 : 0;

    score += (perspective?.spellTrap || []).length * 0.2;
    score -= (opponent?.spellTrap || []).length * 0.15;

    score +=
      ((perspective?.hand || []).length - (opponent?.hand || []).length) * 0.25;

    const handValue = (perspective?.hand || []).reduce(
      (sum, card) =>
        sum +
        estimateCardValue(card, {
          archetype,
          fieldSpell,
          preferDefense,
        }),
      0,
    );
    score += handValue * 0.2;

    const gyValue = (perspective?.graveyard || []).reduce((sum, card) => {
      if (!card || card.cardKind !== "monster") return sum;
      if (!hasArchetype(card, archetype)) return sum;
      const value = (card.atk || 0) / 2000 + (card.level || 0) * 0.08;
      return sum + value;
    }, 0);
    score += gyValue * 0.2;

    if ((perspective?.field || []).length === 0 && opponentStrongest > 0) {
      score -= 0.4;
    }

    return score;
  }

  evaluateBoardV2(gameOrState, perspectivePlayer) {
    const perspective = perspectivePlayer?.id
      ? perspectivePlayer
      : gameOrState.bot;
    const opponent = this.getOpponent(gameOrState, perspective);
    if (!perspective || !opponent) return 0;

    const archetype = "Luminarch";
    const fieldSpell = perspective.fieldSpell || null;
    const preferDefense = true;

    const myLP = perspective.lp || 0;
    const oppLP = opponent.lp || 0;
    const myField = perspective.field || [];
    const oppField = opponent.field || [];
    const myBackrow = perspective.spellTrap || [];
    const oppBackrow = opponent.spellTrap || [];
    const myHand = perspective.hand || [];
    const oppHand = opponent.hand || [];
    const myGY = perspective.graveyard || [];

    let score = 0;

    // LP matters more for a defensive/control archetype.
    score += (myLP - oppLP) / 550;
    if (myLP <= 2000) score -= 3.2;
    else if (myLP <= 3000) score -= 2.0;
    else if (myLP <= 4000) score -= 1.0;
    if (oppLP <= 2000) score += 2.0;
    else if (oppLP <= 3000) score += 1.0;

    const ownMonstersValue = myField.reduce(
      (sum, monster) =>
        sum +
        estimateMonsterValue(monster, {
          archetype,
          fieldSpell,
          preferDefense,
        }),
      0,
    );
    const oppMonstersValue = oppField.reduce(
      (sum, monster) =>
        sum +
        estimateMonsterValue(monster, {
          fieldSpell: opponent.fieldSpell || null,
          preferDefense: false,
        }),
      0,
    );
    score += ownMonstersValue - oppMonstersValue * 0.9;

    const opponentStrongestAtk = getStrongestAttackThreat(oppField, {
      facedownValue: 1500,
      includeBoosts: false,
    });

    const myStrongestDef = myField.reduce((max, monster) => {
      if (!monster || monster.cardKind !== "monster") return max;
      const def =
        (monster.def || 0) +
        (monster.tempDefBoost || 0) +
        (monster.equipDefBonus || 0);
      return Math.max(max, def);
    }, 0);

    const defenseCount = myField.filter(
      (monster) =>
        monster &&
        monster.cardKind === "monster" &&
        monster.position === "defense",
    ).length;
    score += defenseCount * 0.25;

    const tauntWalls = myField.filter(
      (monster) =>
        monster &&
        monster.cardKind === "monster" &&
        !monster.isFacedown &&
        monster.mustBeAttacked,
    );
    if (tauntWalls.length > 0) {
      const bestTauntDef = tauntWalls.reduce((max, monster) => {
        const def = (monster.def || 0) + (monster.tempDefBoost || 0);
        return Math.max(max, def);
      }, 0);
      score += opponentStrongestAtk > 0 ? 0.6 : 0.2;
      if (opponentStrongestAtk > 0) {
        if (bestTauntDef >= opponentStrongestAtk) score += 0.6;
        else if (bestTauntDef >= opponentStrongestAtk - 300) score += 0.3;
      }
    }

    if (myStrongestDef > 0 && opponentStrongestAtk > 0) {
      if (myStrongestDef >= opponentStrongestAtk + 300) score += 0.7;
      else if (myStrongestDef >= opponentStrongestAtk) score += 0.4;
    }

    const exposedAttackers = myField.filter((monster) => {
      if (!monster || monster.cardKind !== "monster") return false;
      if (monster.position !== "attack") return false;
      const atk = (monster.atk || 0) + (monster.tempAtkBoost || 0);
      return atk < Math.max(500, opponentStrongestAtk - 200);
    }).length;
    score -= exposedAttackers * 0.45;

    const hasCitadel = fieldSpell?.name?.includes("Citadel") ?? false;
    if (fieldSpell) {
      score += hasCitadel ? 1.4 : 0.6;
    }
    if (hasCitadel) {
      const luminarchCount = myField.filter((c) => c && isLuminarch(c)).length;
      score += Math.min(1.2, luminarchCount * 0.2);
      if (myField.some((c) => c && c.name === "Luminarch Aegisbearer")) {
        score += 0.8;
      }
      if (myField.some((c) => c && c.name === "Luminarch Fortress Aegis")) {
        score += 0.6;
      }
      if (
        myField.some((c) => c && c.name === "Luminarch Megashield Barbarias")
      ) {
        score += 0.5;
      }
    }

    // SIMULATION BONUS: Searchers que buscaram cartas
    // Valiant que buscou Aegis = +1.5 (Aegis é peça core do arquétipo)
    const searchedAegis = myField.some((c) => c && c._searchedAegis);
    if (searchedAegis) {
      score += 1.5;
    }
    // Arbiter que buscou spell = +1.0 (spell utility/field spell)
    const searchedSpell = myField.some((c) => c && c._searchedSpell);
    if (searchedSpell) {
      score += 1.0;
    }

    if (opponent.fieldSpell) score -= 0.9;

    score += myBackrow.length * 0.35;
    score -= oppBackrow.length * 0.25;

    score += (myHand.length - oppHand.length) * 0.3;
    const handValue = myHand.reduce(
      (sum, card) =>
        sum +
        estimateCardValue(card, {
          archetype,
          fieldSpell,
          preferDefense,
        }),
      0,
    );
    score += handValue * 0.12;

    const gyLuminarch = myGY.filter(
      (card) => card && card.cardKind === "monster" && isLuminarch(card),
    );
    score += gyLuminarch.length * 0.18;
    if (gyLuminarch.length >= 2) score += 0.35;

    const hasLuminarchOnField = myField.some(
      (card) => card && isLuminarch(card),
    );
    const hasHolyShieldInHand = myHand.some(
      (card) => card && card.name === "Luminarch Holy Shield",
    );
    const hasHolyShieldSet = myBackrow.some(
      (card) =>
        card && card.name === "Luminarch Holy Shield" && card.isFacedown,
    );
    const hasCrescentShield = myBackrow.some(
      (card) => card && card.name === "Luminarch Crescent Shield",
    );
    if (hasLuminarchOnField && (hasHolyShieldInHand || hasHolyShieldSet)) {
      score += 0.6;
    }
    if (hasLuminarchOnField && hasCrescentShield) score += 0.3;

    const overfillPenalty = Math.max(0, myField.length - 3) * 0.35;
    score -= overfillPenalty;

    if (myField.length === 0 && oppField.length > 0) {
      score -= 2.6;
    } else if (oppField.length === 0 && myField.length > 0) {
      score += 0.6;
    }

    return score;
  }

  generateMainPhaseActions(game) {
    const actions = [];
    const isSimulatedState = game?._isPerspectiveState === true;
    const bot = isSimulatedState ? game.bot : this.bot || game.bot;
    const opponent = this.getOpponent(game, bot);
    const activationContext = buildLuminarchActivationContext();

    if (bot?.debug) {
      console.log(
        `\n[LuminarchStrategy] 🎴 Avaliando ${bot.hand.length} cartas na mão:`,
      );
      bot.hand.forEach((c, i) => {
        console.log(
          `  [${i}] ${c.name} (${c.cardKind}${
            c.cardKind === "monster"
              ? ` Lv${c.level || "?"}`
              : c.subtype
                ? ` ${c.subtype}`
                : ""
          })`,
        );
      });
    }

    // Declarar variáveis no escopo da função
    let gameStance = { stance: "balanced", reason: "default" };
    let turnPlan = { plan: ["Jogar normalmente"] };
    let fusionOpportunity = null;
    let strategyAnalysis = null;
    let luminarchFinisherPlans = [];
    let luminarchDefensePlan = { stable: false, readyToCounterattack: false };

    // === COMBO DETECTION ===
    try {
      const analysis = buildStrategyAnalysis({ bot, opponent, game });
      strategyAnalysis = analysis;
      analysis.resourceEconomy = buildLuminarchResourceEconomy(analysis);

      // === MULTI-TURN PLANNING ===
      gameStance = evaluateGameStance(analysis);
      luminarchDefensePlan = evaluateLuminarchDefensePlan(analysis);
      analysis.luminarchDefensePlan = luminarchDefensePlan;
      luminarchFinisherPlans = evaluateLuminarchFinisherPlans(
        bot,
        opponent,
        game,
        analysis,
        { evaluateBarbariasStanceDance },
      );
      analysis.finisherPlans = luminarchFinisherPlans;
      turnPlan = planNextTurns(analysis);

      if (bot?.debug) {
        console.log(
          `[LuminarchStrategy] 🎯 Stance: ${gameStance.stance.toUpperCase()} - ${
            gameStance.reason
          }`,
        );
        console.log(`[LuminarchStrategy] 📋 Plano:`, turnPlan.plan[0]);
      }

      // === FINISHER/FUSION PRIORITY EVALUATION ===
      const fusionPlan = luminarchFinisherPlans.find(
        (plan) =>
          plan?.kind === "fusion" &&
          plan.targetName === "Luminarch Megashield Barbarias",
      );
      fusionOpportunity = fusionPlan
        ? {
            fusionName: fusionPlan.targetName,
            decision: {
              reason: fusionPlan.reason,
              priority:
                fusionPlan.details?.spellPriority || fusionPlan.actionPriority,
            },
            plan: fusionPlan,
          }
        : null;

      if (fusionOpportunity && bot?.debug) {
        console.log(
          `[LuminarchStrategy] 🔮 Fusão detectada: ${fusionOpportunity.fusionName} - ${fusionOpportunity.decision.reason}`,
        );
      }

      const availableCombos = detectAvailableCombos(analysis);
      if (availableCombos.length > 0 && bot?.debug) {
        console.log(
          `[LuminarchStrategy] 🎯 Combos detectados:`,
          availableCombos.map((c) => `${c.name} (priority ${c.priority})`),
        );
      }

      // Detectar se deve priorizar defesa ou tentar lethal
      const shouldDefend = shouldPrioritizeDefense(analysis);
      const canLethal = canAttemptLethal(analysis);
      const turtleAnalysis = shouldTurtleStrategy(analysis);

      if (bot?.debug) {
        console.log(
          `[LuminarchStrategy] Situação: ${
            canLethal
              ? "⚔️ LETHAL POSSIBLE"
              : turtleAnalysis.shouldTurtle
                ? `🐢 TURTLE MODE: ${turtleAnalysis.reason}`
                : shouldDefend
                  ? "🛡️ DEFENSIVE"
                  : "⚖️ BALANCED"
          }`,
        );
      }
    } catch (e) {
      console.warn(
        `[LuminarchStrategy] Erro na detecção de combos:`,
        e.message,
        e.stack,
      );
    }

    // === P1: MACRO PLANNING ===
    const macroStrategy = this.evaluateMacroStrategy(game);

    // === P1: CHAIN AWARENESS ===
    const chainRisks = {
      spell: evaluateActionBlockingRisk(
        { bot, player: opponent },
        bot,
        opponent,
        "spell",
      ),
      summon: evaluateActionBlockingRisk(
        { bot, player: opponent },
        bot,
        opponent,
        "summon",
      ),
    };

    const luminarchActionContext = {
      game,
      bot,
      opponent,
      activationContext,
      macroStrategy,
      gameStance,
      analysis: strategyAnalysis,
      fusionOpportunity,
      finisherPlans: luminarchFinisherPlans,
      bestFinisherPlan: luminarchFinisherPlans[0] || null,
      luminarchDefensePlan,
      verboseEval: VERBOSE_EVAL,
      hooks: {
        getTributeRequirementFor: (card, playerState) =>
          this.getTributeRequirementFor(card, playerState),
        selectBestTributes: (field, tributesNeeded, cardToSummon, context) =>
          this.selectBestTributes(
            field,
            tributesNeeded,
            cardToSummon,
            context,
          ),
        shouldSummonMonsterSafely: (card, game, opponent) =>
          this.shouldSummonMonsterSafely(card, game, opponent),
        chooseSummonPosition: (card, game) =>
          this.chooseSummonPosition(card, game),
        shouldSetFacedown: (card, position) =>
          this.shouldSetFacedown(card, position),
        evaluateBarbariasStanceDance,
      },
    };

    actions.push(...getLuminarchSummonActions(luminarchActionContext));
    actions.push(...getLuminarchSpellActions(luminarchActionContext));

    // === FIELD EFFECT ===
    if (bot.fieldSpell) {
      const effect = (bot.fieldSpell.effects || []).find(
        (e) => e.timing === "on_field_activate",
      );
      if (effect) {
        const preview = game.effectEngine?.canActivateFieldSpellEffectPreview?.(
          bot.fieldSpell,
          bot,
          null,
          { activationContext },
        );
        let shouldUseFieldEffect = true;
        if (bot.fieldSpell?.name?.includes("Citadel")) {
          const myMonsters = (bot.field || []).filter(
            (card) =>
              card &&
              card.cardKind === "monster" &&
              !card.isFacedown &&
              isLuminarch(card),
          );
          const bestBuffTarget = findBestOffensiveTemporaryBuffTarget(
            myMonsters,
            opponent,
            CITADEL_TEMP_BUFF,
          );

          shouldUseFieldEffect =
            canUseCitadelBuff(bot, opponent, bestBuffTarget);
        }

        if (preview && preview.ok && shouldUseFieldEffect) {
          actions.push({
            type: "fieldEffect",
            priority: 0,
            cardName: bot.fieldSpell.name,
            activationContext: {
              ...activationContext,
              actionContext: {
                ...(activationContext.actionContext || {}),
                targetPreferences: {
                  sanctum_citadel_target: CITADEL_TEMP_BUFF,
                },
              },
            },
          });
        }
      }
    }

    const barbariasActions = this.getBarbariasMonsterEffectActions(
      game,
      bot,
      opponent,
    );
    if (barbariasActions.length > 0) {
      actions.push(...barbariasActions);
    }

    const positionActions = this.getPositionChangeActions(game, bot, opponent);
    if (positionActions.length > 0) {
      actions.push(...positionActions);
    }

    actions.push(...getLuminarchExtraDeckActions(luminarchActionContext));

    // === P2: GAME TREE SEARCH (OPCIONAL, SÓ SE CRÍTICO) ===
    // CRITICAL: Não chamar P2 recursivamente durante simulação de árvore de jogo
    if (game._isPerspectiveState) {
      // Estamos dentro de uma simulação - apenas retornar ações ordenadas sem P2
      return this.sequenceActions(actions);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FALLBACK: Se nenhuma ação foi gerada, reavaliar cartas de emergência
    // ═══════════════════════════════════════════════════════════════════════
    if (actions.length === 0) {
      if (VERBOSE_EVAL && bot?.debug) {
        console.log(
          `[LuminarchStrategy] 🆘 Fallback: reavaliando cartas de emergência...`,
        );
      }

      // === FALLBACK 1: Spells de buff/removal ignorando shouldCommitResourcesNow ===
      const emergencySpellNames = [];
      bot.hand.forEach((card, index) => {
        if (card.cardKind !== "spell") return;
        if (!emergencySpellNames.includes(card.name)) return;

        try {
          // Verificar se o EffectEngine permite a ativação
          if (
            game.effectEngine?.canActivateSpellFromHandPreview &&
            typeof game.effectEngine.canActivateSpellFromHandPreview ===
              "function"
          ) {
            const preview = game.effectEngine.canActivateSpellFromHandPreview(
              card,
              bot,
              { activationContext },
            );
            if (preview && preview.ok === false) return;
          }

          // Adicionar com prioridade baixa/moderada
          const priority = card.name.includes("Radiant Wave") ? 3 : 2;
          actions.push({
            type: "spell",
            index,
            cardId: card.id,
            priority,
            cardName: card.name,
            reason: "emergency_fallback",
          });
        } catch (e) {
          // Silent fallback error
        }
      });

      // === FALLBACK 2: Summon defensivo se ainda não invocou ===
      if (actions.length === 0 && bot.summonCount < 1) {
        const defensiveSummonNames = [
          "Luminarch Aegisbearer",
          "Luminarch Sanctified Arbiter",
        ];

        for (const targetName of defensiveSummonNames) {
          const cardIndex = bot.hand.findIndex(
            (c) => c && c.name === targetName,
          );
          if (cardIndex === -1) continue;

          const card = bot.hand[cardIndex];
          const tributeInfo = this.getTributeRequirementFor(card, bot);
          const tributesNeeded = Math.max(
            0,
            Number(tributeInfo.tributesNeeded) || 0,
          );

          // Verificar tributos e espaço
          if (!fieldHasTributeValue(bot.field || [], tributesNeeded, card)) {
            continue;
          }
          const tributeIndices =
            tributesNeeded > 0
              ? this.selectBestTributes(bot.field || [], tributesNeeded, card, {
                  oppField: opponent?.field || [],
                  game,
                })
              : [];
          const tributeCards = getTributeCardsFromIndices(
            bot.field || [],
            tributeIndices,
          );
          if (getTributeValueTotal(tributeCards, card) < tributesNeeded) {
            continue;
          }
          const projectedFieldCount =
            (bot.field?.length || 0) - tributeCards.length + 1;
          if (projectedFieldCount > 5) continue;

          // Adicionar summon defensivo
          actions.push({
            type: "summon",
            index: cardIndex,
            cardId: card.id,
            position: "defense",
            facedown: true,
            priority: 1,
            cardName: card.name,
            reason: "defensive_fallback",
          });

          break; // Apenas um summon fallback
        }
      }
    }

    if (bot?.debug) {
      console.log(
        `\n[LuminarchStrategy] 📊 Resumo: ${bot.hand.length} cartas avaliadas → ${actions.length} ações geradas`,
      );
      if (actions.length > 0) {
        console.log("  Ações:");
        actions.forEach((a) => {
          console.log(
            `    - ${a.type}: ${a.cardName || `index ${a.index}`} (priority: ${
              a.priority || 0
            })`,
          );
        });
      } else {
        console.log("  ⚠️ NENHUMA AÇÃO GERADA");
      }
    }

    const finalActions = this.integrateP2IntoActionSelection(
      game,
      this.sequenceActions(actions),
    );

    return finalActions;
  }

  sequenceActions(actions) {
    // Ordena por prioridade (P1 priority bonuses aplicados)
    const typePriority = {
      fieldEffect: 0,
      monsterEffect: 0.5,
      handIgnition: 0.75,
      graveyardMonsterEffect: 0.9,
      spell: 1,
      spellTrapEffect: 2,
      position_change: 2.5,
      summon: 3,
      special_summon_sanctum_protector: 3,
      set_spell_trap: 4,
    };

    return sequenceActionsByPriority(actions, {
      typeOrder: typePriority,
      defaultTypeOrder: 9,
    });
  }

  getTributeRequirementFor(card, playerState) {
    return getLuminarchTributeRequirementFor(card, playerState);
  }

  selectBestTributes(field, tributesNeeded, cardToSummon, context = {}) {
    return selectBestLuminarchTributes(field, tributesNeeded, cardToSummon, {
      ...context,
      botState: context.botState || this.bot || {},
    });
  }

  chooseSummonPosition(card, game) {
    const opponent = game?.player || { field: [] };
    const opponentStrongest = getStrongestAttackThreat(opponent.field || [], {
      includeFacedown: false,
      includeBoosts: false,
    });

    const atk = card.atk || 0;
    const def = card.def || 0;
    const isTaunt = !!card.mustBeAttacked;
    const canPierce = !!card.piercing;

    if (opponentStrongest <= 0) return "attack";
    if (isTaunt && def >= atk) return "defense";
    if (def >= opponentStrongest + 300) return "defense";
    if (atk >= opponentStrongest + 200) return "attack";
    if (canPierce && atk >= opponentStrongest) return "attack";
    if (def >= atk && opponentStrongest > atk) return "defense";
    return "attack";
  }

  chooseSpecialSummonPosition(card, context = {}) {
    const game = context.game || context.state || {};
    const player = context.player || this.bot || game.bot || null;
    const opponent = player ? this.getOpponent(game, player) : game.player;
    return chooseLuminarchSpecialSummonPosition(card, {
      game,
      state: game,
      player,
      opponent,
      action: {
        ...(context.action || {}),
        position:
          context.action?.position ??
          context.actionPosition ??
          context.position,
      },
      sourceAction: context.sourceAction || context.action || null,
      activationContext: context.activationContext,
      options: {
        chooseSummonPosition: this.chooseSummonPosition.bind(this),
      },
    });
  }

  shouldSetFacedown(card, position) {
    // REGRA DO JOGO: Defesa = sempre facedown (set)
    // Não existe "invocar em defesa face-up" em Shadow Duel
    if (position !== "defense") return false;
    return true;
  }

  getOpponent(gameOrState, perspectivePlayer) {
    return super.getOpponent(gameOrState, perspectivePlayer);
  }

  getPositionChangeActions(game, bot, opponent) {
    const baseActions = super
      .getPositionChangeActions(game, bot, opponent)
      .filter((action) => action.cardName !== "Luminarch Megashield Barbarias");
    const actions = [...baseActions];

    (bot?.field || []).forEach((card, fieldIndex) => {
      if (!card || card.name !== "Luminarch Megashield Barbarias") return;
      if (card.position !== "attack") return;
      if (typeof game?.canChangePosition === "function") {
        if (!game.canChangePosition(card)) return;
      } else if (card.isFacedown || card.positionChangedThisTurn || card.hasAttacked) {
        return;
      }

      const preview = game?.effectEngine?.canActivateMonsterEffectPreview?.(
        card,
        bot,
        "field",
      );
      if (preview && preview.ok === false) return;

      const value = evaluateBarbariasStanceDance(card, opponent, {
        afterManualDefense: true,
      });
      if (value.score <= 0) return;

      actions.push({
        type: "position_change",
        fieldIndex,
        cardId: card.id,
        cardName: card.name,
        toPosition: "defense",
        priority: Math.max(13, value.score),
        reason: `setup_${value.reason}`,
      });
    });

    return actions;
  }

  getBarbariasMonsterEffectActions(game, bot, opponent) {
    const actions = [];
    (bot?.field || []).forEach((card, fieldIndex) => {
      if (!card || card.name !== "Luminarch Megashield Barbarias") return;
      if (card.position !== "defense") return;
      const value = evaluateBarbariasStanceDance(card, opponent);
      if (value.score <= 0) return;

      const activationContext = {
        autoSelectTargets: true,
        autoSelectSingleTarget: true,
        logTargets: false,
        actionContext: {
          targetPreferences: {
            barbarias_switch_target: {
              ...BARBARIAS_STANCE_DANCE,
              sourceCardId: card.id,
            },
          },
        },
      };
      const preview = game?.effectEngine?.canActivateMonsterEffectPreview?.(
        card,
        bot,
        "field",
        null,
        { activationContext },
      );
      if (preview && preview.ok === false) return;

      actions.push({
        type: "monsterEffect",
        fieldIndex,
        cardId: card.id,
        cardName: card.name,
        priority: Math.max(15, value.score),
        reason: value.reason,
        activationContext,
      });
    });
    return actions;
  }

  shouldUseAutomaticAscensionShortcut() {
    return false;
  }

  resolveSimulatedHandIndex(player, action, expectedKind = null) {
    return resolveGenericSimulatedHandIndex(player, action, expectedKind);
  }

  resolveSimulatedFieldIndex(player, action, predicate = null) {
    return resolveGenericSimulatedFieldIndex(player, action, predicate);
  }

  rankSearchCandidates(cards, action = {}, ctx = {}) {
    return rankLuminarchSearchCandidates(cards, action, {
      ...ctx,
      strategy: this,
      getOpponent: this.getOpponent.bind(this),
    });
  }

  simulateLuminarchSearch(player, sourceCard, action, state) {
    return simulateLuminarchSearchAction(player, sourceCard, action, state, {
      strategy: this,
      getOpponent: this.getOpponent.bind(this),
    });
  }

  simulateMainPhaseAction(state, action) {
    return simulateLuminarchMainPhaseAction(state, action, {
      strategy: this,
      getOpponent: this.getOpponent.bind(this),
      getTributeRequirementFor: (card, playerState) =>
        this.getTributeRequirementFor(card, playerState),
      selectBestTributes: (field, tributesNeeded, cardToSummon, context) =>
        this.selectBestTributes(field, tributesNeeded, cardToSummon, {
          ...(context || {}),
          botState: state.bot,
          oppField: state.player?.field || [],
          game: state,
        }),
      placeSpellCard: this.placeSpellCard.bind(this),
      citadelTempBuff: CITADEL_TEMP_BUFF,
      barbariasStanceDance: BARBARIAS_STANCE_DANCE,
    });
  }

  simulateSpellEffect(state, card) {
    return simulateLuminarchSpellEffect(state, card);
  }
  /**
   * === P1: MACRO STRATEGY ===
   * Avalia situação do jogo e decide estratégia macro (lethal, defend, setup, grind)
   */
  evaluateMacroStrategy(game) {
    try {
      const isSimulatedState = game?._isPerspectiveState === true;
      const bot = isSimulatedState ? game.bot : this.bot || game.bot;
      const opponent = this.getOpponent(game, bot);

      if (!bot || !opponent) {
        return { strategy: "grind", priority: 30, detail: {} };
      }

      // Detectar oportunidades
      // Decidir estratégia
      const macro = decideMacroStrategy(game, bot, opponent);

      return macro;
    } catch (e) {
      if (this.bot?.debug !== false) {
        console.warn(`[LuminarchStrategy] evaluateMacroStrategy erro:`, e);
      }
      return { strategy: "grind", priority: 30, detail: {} };
    }
  }

  /**
   * === FUSION DETECTION ===
   * Detecta oportunidades de Fusion Summons (Megashield Barbarias).
   */
  detectFusionOpportunities(game, bot) {
    return detectLuminarchFusionOpportunities({
      game,
      bot,
      opponent: this.getOpponent(game, bot),
      hooks: { evaluateBarbariasStanceDance },
    });
  }

  /**
   * Avalia prioridade de uma Fusion específica.
   */
  evaluateFusionPriority(fusionName, bot, opponent, game) {
    return evaluateLuminarchFusionActionPriority(
      fusionName,
      bot,
      opponent,
      game,
      { evaluateBarbariasStanceDance },
    );
  }

  chooseAscensionPosition(ascensionCard, bot, opponent) {
    return chooseLuminarchAscensionPosition(ascensionCard, bot, opponent);
  }

  /**
   * === ASCENSION DETECTION ===
   * Detecta materiais prontos para Ascension e avalia prioridade.
   */
  detectAscensionOpportunities(game, bot) {
    return detectLuminarchAscensionOpportunities({
      game,
      bot,
      opponent: this.getOpponent(game, bot),
    });
  }

  /**
   * Avalia prioridade de uma Ascension específica.
   */
  evaluateAscensionPriority(material, ascensionCard, bot, opponent, game) {
    return evaluateLuminarchAscensionPriority(
      material,
      ascensionCard,
      bot,
      opponent,
      game,
    );
  }

  /**
   * === SUICIDE PREVENTION ===
   * Valida se é seguro summon monstro contra ameaças do oponente
   */
  shouldSummonMonsterSafely(card, game, opponent) {
    try {
      // === USO DO MÓDULO DE PRIORIDADES ===
      const bot = game?._isPerspectiveState ? game.bot : this.bot || game.bot;
      const analysis = buildStrategyAnalysis({ bot, opponent, game });

      const decision = shouldSummonMonster(card, analysis);

      if (!decision.yes) {
        return {
          yes: false,
          reason: decision.reason || "Priorities module blocked summon",
          lancerPlan: decision.lancerPlan || null,
        };
      }

      return {
        yes: true,
        position: decision.position || "defense",
        priority: decision.priority || 3,
        reason: decision.reason || "Priorities module approved",
        lancerPlan: decision.lancerPlan || null,
      };
    } catch (e) {
      if (this.bot?.debug !== false) {
        console.warn(`[LuminarchStrategy] shouldSummonMonsterSafely erro:`, e);
      }
      // Fallback: Luminarch prefere defesa
      const cardDEF = card.def || 0;
      const oppStrongestATK = getStrongestAttackThreat(opponent?.field || [], {
        facedownValue: "printed",
        includeBoosts: false,
      });
      const safePosition =
        cardDEF >= oppStrongestATK - 300 ? "defense" : "defense";
      return { yes: true, priority: 2, position: safePosition };
    }
  }

  // P2 (evaluateCriticalSituationWithGameTree, analyzeOpponentPosition,
  // integrateP2IntoActionSelection) foi hoisted para BaseStrategy.
}
