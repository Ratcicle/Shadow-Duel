// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/ShadowHeartStrategy.js
// Estratégia Shadow-Heart — Fachada que orquestra os módulos especializados.
//
// FILOSOFIA DO ARQUÉTIPO SHADOW-HEART:
// - Agressivo com monstros de alto ATK
// - Sinergia através de tributos e efeitos de GY
// - Boss principal: Shadow-Heart Scale Dragon (3000 ATK, recupera recursos)
// - Fusion boss: Shadow-Heart Demon Dragon (3000 ATK, destrói 2 cartas)
// - Suporte: Imp (special summon), Specter (recicla GY), Eel (burn + Leviathan)
// - Field spell: Darkness Valley (+300 ATK para Shadow-Heart)
// ─────────────────────────────────────────────────────────────────────────────

import BaseStrategy from "./BaseStrategy.js";
import { validateHandIgnitionCandidate } from "./common/actionValidation.js";
import { buildStrategyAnalysis } from "./common/analysis.js";
import { getEffectiveAtk } from "./common/cardStats.js";
import { withFusionPreferences } from "./common/fusionPlanning.js";
import {
  detectLethalOpportunity,
  detectDefensiveNeed,
  detectComeback,
  decideMacroStrategy,
  calculateMacroPriorityBonus,
} from "./MacroPlanning.js";
import {
  evaluateActionBlockingRisk,
  assessActionSafety,
} from "./ChainAwareness.js";
// P2 (gameTreeSearch, analyzeOpponent etc.) está em BaseStrategy.

// Módulos Shadow-Heart refatorados
import {
  CARD_KNOWLEDGE,
  isShadowHeart,
  isShadowHeartByName,
} from "./shadowheart/knowledge.js";
import { COMBO_DATABASE, detectAvailableCombos } from "./shadowheart/combos.js";
import {
  shouldPlaySpell,
  shouldSummonMonster,
  selectBestTributes,
  evaluateTributeTrade,
  getTributeRequirementFor,
  buildShadowHeartCostPreferences,
  buildShadowHeartTargetPreferences,
  assessShadowHeartSummonEntry,
  evaluateShadowHeartFinisherPlans,
  evaluateShadowHeartFusionPlan,
  evaluateShadowHeartRecruitCandidate,
  rankShadowHeartSearchCandidates,
  pickInfusionEmergencyRevive,
  evaluateCathedralActivation,
  estimateShadowHeartCathedralCounterGain,
} from "./shadowheart/priorities.js";
import {
  evaluateMonster,
  evaluateBoardShadowHeart,
  evaluateShadowHeartTributeBossBonus,
} from "./shadowheart/scoring.js";
import {
  simulateMainPhaseAction as simAction,
  simulateSpellEffect,
} from "./shadowheart/simulation.js";
import { buildShadowHeartResourceEconomy } from "./shadowheart/resourceEconomy.js";
import {
  buildShadowHeartPlanningProfile,
  applyShadowHeartCandidateRetention,
  applyShadowHeartSimulatedBattleRewards,
  scoreShadowHeartBattleAttackCandidate,
  scoreShadowHeartLineMilestones,
  scoreShadowHeartLineTerminal,
  describeShadowHeartPlannedLine,
} from "./shadowheart/linePlanning.js";

function canActivateShadowHeartSpell(game, card, bot, activationContext = {}) {
  if (!game || game._isPerspectiveState === true) return { ok: true };
  const actualGame = game._gameRef || game;

  if (
    actualGame.effectEngine &&
    typeof actualGame.effectEngine.canActivateSpellFromHandPreview === "function"
  ) {
    return actualGame.effectEngine.canActivateSpellFromHandPreview(card, bot, {
      activationContext,
    });
  }

  if (actualGame.effectEngine && typeof actualGame.effectEngine.canActivate === "function") {
    return actualGame.effectEngine.canActivate(card, bot);
  }

  return { ok: true };
}

function withShadowHeartFusionPreferences(baseContext, card, analysis) {
  if (card?.name !== "Polymerization") return baseContext;
  const fusionPlan = evaluateShadowHeartFusionPlan(analysis);
  if (!fusionPlan?.targetName) return baseContext;
  return withFusionPreferences(baseContext, {
    target: fusionPlan.targetName,
    priority: fusionPlan.actionPriority,
    reason: fusionPlan.reason,
    plan: fusionPlan,
  });
}

function buildShadowHeartSpellActivationContext(card, bot, opponent, analysis) {
  const costPreferences = buildShadowHeartCostPreferences(analysis);

  if (card?.name === "Shadow-Heart Infusion") {
    // Always force a SH monster from hand into the discards so SSZ always finds
    // a valid GY target regardless of:
    //   a) DV/triggers claiming the GY monster before activation resolves
    //   b) AutoSelector picking all-spell discards when GY had no SH monster
    const hand = analysis?.hand || [];
    const nonInfusionHand = hand.filter(
      (c) => c?.name !== "Shadow-Heart Infusion",
    );
    const reviveMonster = pickInfusionEmergencyRevive(nonInfusionHand, analysis);
    if (reviveMonster) {
      const secondPool = nonInfusionHand.filter(
        (c) => c?.name !== reviveMonster.name,
      );
      const secondDiscard =
        secondPool.length > 0
          ? secondPool.slice().sort(
              (a, b) =>
                (CARD_KNOWLEDGE[a?.name]?.value || 0) -
                (CARD_KNOWLEDGE[b?.name]?.value || 0),
            )[0]
          : null;
      costPreferences.forceNames = secondDiscard
        ? [reviveMonster.name, secondDiscard.name]
        : [reviveMonster.name];
      const toPreserve = ["Polymerization"];
      if (reviveMonster.name !== "Shadow-Heart Scale Dragon") {
        toPreserve.push("Shadow-Heart Scale Dragon");
      }
      costPreferences.preserveNames = [
        ...new Set([
          ...(costPreferences.preserveNames || []).filter(
            (n) => !costPreferences.forceNames.includes(n),
          ),
          ...toPreserve,
        ]),
      ];
      if (bot?.debug || analysis?.game?.devModeEnabled) {
        console.log(
          `[ShadowHeart Infusion] Forçando descarte: ${reviveMonster.name}` +
            `${secondDiscard ? ` + ${secondDiscard.name}` : ""}`,
        );
      }
    }
    // No hand SH monster: rely on GY having one (shouldPlaySpell validated this).
    // AutoSelector picks cheapest 2 hand cards; GY monster stays intact.
  }
  const strategicPreferences = buildShadowHeartTargetPreferences(
    card,
    (card?.effects || [])[0] || null,
    analysis,
  );
  const actionContext = {
    costPreferences,
    targetPreferences: strategicPreferences.targetPreferences,
    specialSummonPositions: strategicPreferences.specialSummonPositions,
  };

  if (card?.name !== "Shadow-Heart Purge") {
    return withShadowHeartFusionPreferences({
      autoSelectTargets: true,
      autoSelectSingleTarget: true,
      actionContext,
    }, card, analysis);
  }

  const attackers = (bot?.field || []).filter(
    (monster) =>
      monster &&
      monster.cardKind === "monster" &&
      isShadowHeart(monster) &&
      !monster.isFacedown &&
      monster.position === "attack" &&
      !monster.cannotAttackThisTurn &&
      !monster.hasAttacked,
  );

  return withShadowHeartFusionPreferences({
    autoSelectSingleTarget: true,
    logTargets: false,
    actionContext: {
      ...actionContext,
      targetPreferences: {
        purge_target_monster: {
          role: "temporary_stat_debuff",
          purpose: "combat",
          attackers,
          opponentLp: opponent?.lp || 0,
          atkReduction: 1000,
          defReduction: 0,
          destroyIfAtkZeroedByThisEffect: true,
        },
      },
    },
  }, card, analysis);
}

/**
 * Estratégia Shadow-Heart - IA avançada que pensa como um jogador humano experiente.
 */
export default class ShadowHeartStrategy extends BaseStrategy {
  constructor(bot) {
    super(bot);

    // Referência ao knowledge (para compatibilidade)
    this.cardKnowledge = CARD_KNOWLEDGE;

    // Combos conhecidos
    this.knownCombos = COMBO_DATABASE;

    // Estado de análise atual
    this.currentAnalysis = null;
    this.thoughtProcess = [];
  }

  getPlanningProfile(game, context = {}) {
    if (!game) return super.getPlanningProfile(game, context);
    const analysis = context.analysis || this.analyzeGameState(game);
    return buildShadowHeartPlanningProfile(analysis, {
      ...context,
      game,
      strategy: this,
    });
  }

  shouldUseDeepPlanning(game, context = {}) {
    const profile =
      context.profile || this.getPlanningProfile(game, context) || {};
    return game?.turnLineSearchEnabled === true || profile.enabled === true;
  }

  scoreLineMilestones(context = {}) {
    return scoreShadowHeartLineMilestones(context);
  }

  scoreLineTerminal(context = {}) {
    return scoreShadowHeartLineTerminal(context);
  }

  describePlannedLine(context = {}) {
    return describeShadowHeartPlannedLine(context);
  }

  scoreBattleAttackCandidate(context = {}) {
    return scoreShadowHeartBattleAttackCandidate(context);
  }

  applySimulatedBattleRewards(context = {}) {
    return applyShadowHeartSimulatedBattleRewards(context);
  }

  buildActivationContextForEffect({ sourceCard, effect, player, game } = {}) {
    if (!sourceCard || !player || !game) return null;
    const analysis = this.analyzeGameState(game);
    const strategicPreferences = buildShadowHeartTargetPreferences(
      sourceCard,
      effect,
      analysis,
    );
    const targetPreferences = strategicPreferences.targetPreferences || {};
    const specialSummonPositions =
      strategicPreferences.specialSummonPositions || {};

    if (
      Object.keys(targetPreferences).length === 0 &&
      Object.keys(specialSummonPositions.byName || {}).length === 0
    ) {
      return null;
    }

    if (player.debug || game.devModeEnabled) {
      const impPreference = targetPreferences.imp_special_from_hand;
      if (impPreference?.preferredNames?.[0]) {
        console.log(
          `[ShadowHeartStrategy] Imp target: ${impPreference.preferredNames[0]} (${impPreference.reason})`,
        );
      }
      if (sourceCard.name === "Shadow-Heart Infusion") {
        console.log("[ShadowHeartStrategy] Infusion context prepared");
      }
    }

    return {
      autoSelectTargets: true,
      autoSelectSingleTarget: true,
      logTargets: false,
      actionContext: {
        costPreferences: buildShadowHeartCostPreferences(analysis),
        targetPreferences,
        specialSummonPositions,
      },
    };
  }

  rankSearchCandidates(cards, action = {}, ctx = {}) {
    return rankShadowHeartSearchCandidates(cards, action, {
      ...ctx,
      strategy: this,
      getOpponent: this.getOpponent.bind(this),
    });
  }

  evaluateRecruitCandidate(candidates, context = {}) {
    return evaluateShadowHeartRecruitCandidate(candidates, {
      ...context,
      strategy: this,
      getOpponent: this.getOpponent.bind(this),
    });
  }

  /**
   * Chooses attack/defense for a Special Summon when the action allows choice.
   * Shadow-Heart policy:
   *   1. If the card has an on-summon effect that removes opponent cards
   *      (destroy / banish / bounce), summon in attack — the opponent's board
   *      will shrink before they can punish.
   *   2. If myDef >= myAtk, defense gives no stat advantage; pick attack to
   *      keep pressure (cards like Megashield Barbarias).
   *   3. If any face-up opponent monster has ATK > myAtk, defense — losing in
   *      defense avoids battle damage. Otherwise attack.
   * Returns "attack" | "defense" | null (null = let the engine fall back).
   */
  chooseSpecialSummonPosition(card, ctx = {}) {
    if (!card || card.cardKind !== "monster") return null;
    const opponent =
      ctx.opponent ||
      (ctx.game && ctx.player ? this.getOpponent(ctx.game, ctx.player) : null);
    const assessment = assessShadowHeartSummonEntry(card, {
      ...ctx,
      opponent,
      clearsOpponentBoardOnSummon: this.cardClearsOpponentBoardOnSummon(card),
    });

    return assessment.position || null;
  }

  /**
   * True when the card has an after_summon / on_play effect that removes
   * (destroy / banish / bounce) opponent cards. Static analysis on effects[].
   */
  cardClearsOpponentBoardOnSummon(card) {
    const effects = Array.isArray(card?.effects) ? card.effects : [];
    const removalActionTypes = new Set([
      "destroy_targeted_cards",
      "destroy",
      "banish",
      "banish_card_from_graveyard",
      "banish_destroyed_monster",
      "return_to_hand",
      "bounce_and_summon",
    ]);
    for (const eff of effects) {
      if (!eff) continue;
      const triggersOnSummon =
        eff.timing === "on_play" ||
        (eff.timing === "on_event" && eff.event === "after_summon");
      if (!triggersOnSummon) continue;
      const actions = Array.isArray(eff.actions) ? eff.actions : [];
      if (actions.some((a) => a && removalActionTypes.has(a.type))) {
        return true;
      }
    }
    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Análise de estado
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Analisa o estado atual do jogo e registra o processo de pensamento.
   * IMPORTANTE: Usa game.bot (estado simulado) em vez de this.bot para lookahead.
   */
  analyzeGameState(game) {
    this.thoughtProcess = [];

    // FIDELIDADE: Usar o bot do game/state em vez de this.bot
    // Isso permite que lookahead (BeamSearch/GameTree) funcione corretamente
    const isSimulatedState = game._isPerspectiveState === true;
    const bot = isSimulatedState ? game.bot : this.bot || game.bot;
    const opponent = this.getOpponent(game, bot);
    const baseAnalysis = buildStrategyAnalysis({
      player: bot,
      opponent,
      game,
      strategy: this,
    });

    const analysis = {
      // Recursos próprios
      hand: (baseAnalysis.hand || []).map((c) => ({
        name: c.name,
        type: c.cardKind,
        cardKind: c.cardKind,
        level: c.level,
        atk: c.atk,
        archetype: c.archetype,
      })),
      field: (baseAnalysis.field || []).map((c) => ({
        name: c.name,
        atk: c.atk,
        def: c.def,
        level: c.level,
        cardKind: c.cardKind,
        position: c.position,
        isFacedown: c.isFacedown,
        hasAttacked: c.hasAttacked,
        cannotAttackThisTurn: c.cannotAttackThisTurn || false,
        battleIndestructible: c.battleIndestructible,
        cannotBeDestroyedByBattle: c.cannotBeDestroyedByBattle,
      })),
      graveyard: (baseAnalysis.graveyard || []).filter((c) => isShadowHeart(c)),
      spellTrap: (baseAnalysis.spellTrap || []).filter(Boolean),
      fieldSpell: baseAnalysis.fieldSpell?.name || null,
      deck: (baseAnalysis.deck || []).filter(Boolean),
      extraDeck: (baseAnalysis.extraDeck || []).filter(Boolean),
      lp: bot.lp,
      summonCount: bot.summonCount || 0,
      game,

      // Informações de timing (para evitar desperdício de recursos)
      phase: baseAnalysis.phase || "main1",
      turnCounter: game.turnCounter || 0,
      currentTurn: baseAnalysis.currentTurn,
      isSimulatedState: baseAnalysis.isSimulatedState,
      player: baseAnalysis.player,
      opponent: baseAnalysis.opponent,

      // Recursos do oponente
      oppField: (baseAnalysis.oppField || []).map((c) => ({
        name: c.name,
        atk: c.atk,
        def: c.def,
        level: c.level,
        cardKind: c.cardKind,
        position: c.position,
        isFacedown: c.isFacedown,
        battleIndestructible: c.battleIndestructible,
        cannotBeDestroyedByBattle: c.cannotBeDestroyedByBattle,
      })),
      oppBackrow: (baseAnalysis.oppSpellTrap || []).length,
      oppHand: (baseAnalysis.oppHand || []).length,
      oppLp: baseAnalysis.oppLp || 0,
      oppLP: baseAnalysis.oppLP || 0,

      // Avaliações
      canNormalSummon: baseAnalysis.summonAvailable,
      summonAvailable: baseAnalysis.summonAvailable,
      normalSummonsAvailable: baseAnalysis.normalSummonsAvailable,
      additionalNormalSummons: baseAnalysis.additionalNormalSummons,
      fieldCapacity: 5 - (baseAnalysis.field || []).length,
      threatsOnBoard: [],
      availableCombos: [],
      bestPlays: [],
    };

    // Identificar ameaças do oponente
    (baseAnalysis.oppField || []).forEach((c) => {
      const atk = getEffectiveAtk(c);
      if (atk > 2000 || c.isFacedown) {
        analysis.threatsOnBoard.push({
          card: c.name,
          atk,
          threat: c.isFacedown ? "unknown" : atk >= 2500 ? "high" : "medium",
        });
      }
    });

    this.think(`📊 Analisando situação: ${bot.lp} LP vs ${opponent.lp} LP`);
    this.think(
      `🃏 Minha mão: ${analysis.hand.map((c) => c.name).join(", ") || "vazia"}`,
    );
    this.think(
      `⚔️ Meu campo: ${analysis.field.map((c) => c.name).join(", ") || "vazio"}`,
    );
    this.think(
      `🎯 Campo oponente: ${
        analysis.oppField
          .map((c) => (c.isFacedown ? "???" : c.name))
          .join(", ") || "vazio"
      }`,
    );

    // Detectar combos disponíveis
    analysis.availableCombos = detectAvailableCombos(analysis, (msg) =>
      this.think(msg),
    );
    analysis.resourceEconomy = buildShadowHeartResourceEconomy(analysis);
    analysis.finisherPlans = evaluateShadowHeartFinisherPlans(
      bot,
      opponent,
      game,
      analysis,
    );

    this.currentAnalysis = analysis;
    return analysis;
  }

  /**
   * Registra um pensamento no processo de análise.
   */
  think(thought) {
    this.thoughtProcess.push(thought);
    // Só loga se debug estiver explicitamente ativado
    if (!this.bot?.debug) {
      return;
    }
    console.log(`[Shadow-Heart AI] ${thought}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Avaliação de board
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Avalia o tabuleiro com análise profunda.
   */
  evaluateBoard(gameOrState, perspectivePlayer) {
    return evaluateBoardShadowHeart(
      gameOrState,
      perspectivePlayer,
      this.getOpponent.bind(this),
    );
  }

  evaluateBoardV2(gameOrState, perspectivePlayer) {
    const perspective = perspectivePlayer?.id
      ? perspectivePlayer
      : gameOrState?.bot;
    const opponent = this.getOpponent(gameOrState, perspective);
    return (
      super.evaluateBoardV2(gameOrState, perspectivePlayer) +
      evaluateShadowHeartTributeBossBonus(perspective, opponent)
    );
  }

  /**
   * Avalia um monstro individual (wrapper para compatibilidade).
   */
  evaluateMonster(monster, owner, opponent) {
    return evaluateMonster(monster, owner, opponent);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Macro Planning
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Avalia macro strategy usando MacroPlanning.
   */
  evaluateMacroStrategy(game, analysis) {
    const actualGame = game._gameRef || game;
    const bot = this.bot;
    const opponent = this.getOpponent(actualGame, bot);

    const lethal = detectLethalOpportunity(
      { bot, player: opponent, field: {} },
      bot,
      opponent,
      2,
    );

    const defensive = detectDefensiveNeed(
      { bot, player: opponent },
      bot,
      opponent,
    );

    const comeback = detectComeback({ bot, player: opponent }, bot, opponent);

    const macro = decideMacroStrategy({ bot, player: opponent }, bot, opponent);

    if (this.bot.debug) {
      this.think(
        `    Lethal: ${
          lethal.canLethal ? "YES (in " + lethal.turnsNeeded + " turns)" : "NO"
        }`,
      );
      this.think(
        `    Threat: ${defensive.threatLevel} (${defensive.turnsToKill} turns to kill)`,
      );
      this.think(`    Comeback: ${comeback.isVirada ? "YES" : "NO"}`);
    }

    return macro;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Geração de ações
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Gera ações de main phase com análise profunda.
   * FIDELIDADE: Usa game.bot para lookahead funcionar corretamente.
   */
  generateMainPhaseActions(game) {
    const analysis = this.analyzeGameState(game);
    const actions = [];

    // FIDELIDADE: Usar bot do game/state para simulação correta
    const isSimulatedState = game._isPerspectiveState === true;
    const bot = isSimulatedState ? game.bot : this.bot || game.bot;
    const actualGame = game._gameRef || game;
    const opponent = this.getOpponent(actualGame, bot);

    // Logging reduzido em simulação para performance
    const shouldLog = !isSimulatedState;
    const log = (msg) => shouldLog && this.think(msg);

    log(`\n🧠 Gerando ações possíveis...`);

    // === P1: MACRO PLANNING ===
    const macroStrategy = this.evaluateMacroStrategy(game, analysis);
    log(
      `  📊 Macro Strategy: ${macroStrategy.strategy} (Priority: ${macroStrategy.priority})`,
    );

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
      attack: evaluateActionBlockingRisk(
        { bot, player: opponent },
        bot,
        opponent,
        "attack",
      ),
    };

    // === PRIORIDADE 1: COMBOS DE ALTA PRIORIDADE ===
    for (const combo of analysis.availableCombos.sort(
      (a, b) => b.priority - a.priority,
    )) {
      log(
        `  📌 Considerando combo: ${combo.name} (prioridade ${combo.priority})`,
      );
    }

    // === GERAR AÇÕES DE SPELL ===
    // Em simulação, não verificar canActivate (não temos effectEngine)
    // Track spells already added to avoid duplicates (for 1/turn effects)
    const addedSpellNames = new Set();

    (bot.hand || []).forEach((card, index) => {
      if (card.cardKind !== "spell") return;

      // BUGFIX: Só adicionar uma cópia de cada spell (evitar duplicatas com 1/turn)
      // Spells com efeitos 1/turn não devem ter múltiplas ações geradas
      const hasOncePerTurn = (card.effects || []).some(
        (e) => e.oncePerTurn || e.oncePerTurnName,
      );
      if (hasOncePerTurn && addedSpellNames.has(card.name)) {
        log(`  ⏭️ Skipping duplicate 1/turn spell: ${card.name}`);
        return;
      }

      // Só verificar canActivate em game real (não simulado)
      const activationContext = buildShadowHeartSpellActivationContext(
        card,
        bot,
        opponent,
        analysis,
      );

      if (!isSimulatedState) {
        const actualGame = game._gameRef || game;
        const check = canActivateShadowHeartSpell(
          game,
          card,
          bot,
          activationContext,
        );
        if (!check?.ok) return;

        // VALIDAÇÃO EXTRA: Polymerization requer materiais válidos
        if (card.name === "Polymerization") {
          const canActivate = actualGame.canActivatePolymerization?.() ?? false;
          if (!canActivate) {
            log(`  ⚠️ Polymerization bloqueado: sem materiais válidos`);
            return;
          }
        }
      }

      const decision = shouldPlaySpell(card, analysis);
      if (
        card.name === "Shadow-Heart Cathedral" &&
        (bot?.debug || actualGame?.devModeEnabled)
      ) {
        const predicted = estimateShadowHeartCathedralCounterGain(analysis);
        console.log(
          `[ShadowHeart Cathedral] hand=true predicted=${predicted.count} ` +
            `decision=${decision.yes ? "place" : "hold"} reason=${decision.reason}`,
        );
      }

      if (decision.yes) {
        log(`  ✅ Spell válida: ${card.name} - ${decision.reason}`);

        // Mark spell as added if it has 1/turn effect
        if (hasOncePerTurn) {
          addedSpellNames.add(card.name);
        }

        let finalPriority = decision.priority;
        const macroBuff = calculateMacroPriorityBonus(
          "spell",
          card,
          macroStrategy,
        );
        finalPriority += macroBuff;
        const offensivePlan =
          activationContext?.actionContext?.costPreferences?.offensivePlan;
        if (offensivePlan?.hasMajorSwing) {
          if (card.name === "Shadow-Heart Purge" && offensivePlan.purgeWindow) {
            finalPriority += 5;
          } else if (
            card.name === "Shadow-Heart Battle Hymn" &&
            (offensivePlan.battleHymnLethal || offensivePlan.attackers?.length >= 2)
          ) {
            finalPriority += offensivePlan.battleHymnLethal ? 7 : 3;
          } else if (card.name === "Shadow-Heart Rage" && offensivePlan.rageLive) {
            finalPriority += 7;
          } else if (card.name === "Polymerization" && offensivePlan.fusionNear) {
            finalPriority += 4;
          }
        }

        const spellSafety = assessActionSafety(
          { bot, player: opponent },
          bot,
          opponent,
          "spell",
          card,
        );
        if (spellSafety.recommendation === "very_risky") {
          finalPriority -= 15;
          log(`    ⚠️  Very risky (chain blocking): -15 priority`);
        } else if (spellSafety.recommendation === "risky") {
          finalPriority -= 8;
        }

        actions.push({
          type: "spell",
          index,
          cardId: card.id,
          priority: finalPriority,
          cardName: card.name,
          macroBuff,
          safetyScore: spellSafety.riskScore,
          activationContext,
        });
      } else {
        log(`  ❌ Spell descartada: ${card.name} - ${decision.reason}`);
      }
    });

    // === GERAR AÇÕES DE SUMMON ===
    if (analysis.canNormalSummon) {
      (bot.hand || []).forEach((card, index) => {
        if (card.cardKind !== "monster") return;

        // BUGFIX: Não gerar summon se já invocou neste turno
        if ((bot.summonCount || 0) >= 1) return;

        const tributeInfo = this.getTributeRequirementFor(card, bot);
        if ((bot.field?.length || 0) < tributeInfo.tributesNeeded) return;
        if (analysis.fieldCapacity <= 0) return;

        const decision = shouldSummonMonster(card, analysis, tributeInfo, {
          field: bot.field || [],
          oppField: opponent?.field || [],
        });

        if (decision.yes) {
          log(`  ✅ Summon válido: ${card.name} - ${decision.reason}`);

          let finalPriority = decision.priority;
          const macroBuff = calculateMacroPriorityBonus(
            "summon",
            card,
            macroStrategy,
          );
          finalPriority += macroBuff;
          const offensivePlan = buildShadowHeartCostPreferences(analysis).offensivePlan;
          if (
            card.name === "Shadow-Heart Scale Dragon" &&
            offensivePlan?.hasMajorSwing
          ) {
            finalPriority += 3;
          }

          const summonSafety = assessActionSafety(
            { bot, player: opponent },
            bot,
            opponent,
            "summon",
            card,
          );
          if (summonSafety.recommendation === "very_risky") {
            finalPriority -= 10;
          }
          actions.push({
            type: "summon",
            index,
            cardId: card.id,
            position: decision.position,
            // Respect explicit facedown decision from priorities.js
            // Default to facedown only if position is defense AND no explicit decision
            facedown:
              decision.facedown !== undefined
                ? decision.facedown
                : decision.position === "defense",
            priority: finalPriority,
            cardName: card.name,
            macroBuff,
            safetyScore: summonSafety.riskScore,
          });
        }
      });
    }

    // === GERAR AÇÕES DE IGNITION DA MÃO ===
    // Monstros com efeito ignition ativável da mão (ex: Leviathan)
    (bot.hand || []).forEach((card, index) => {
      if (card.cardKind !== "monster") return;

      // Verificar se o monstro tem efeito ignition com requireZone: "hand"
      const handIgnitionEffect = (card.effects || []).find(
        (e) => e && e.timing === "ignition" && e.requireZone === "hand",
      );
      if (!handIgnitionEffect) return;

      // Verificar se pode ativar (tem alvos válidos no campo)
      // Para Leviathan: precisa de Abyssal Eel no campo
      const validation = validateHandIgnitionCandidate({
        card,
        effect: handIgnitionEffect,
        player: bot,
        game: actualGame,
        isSimulatedState,
        activationContext: {
          actionContext: {
            costPreferences: buildShadowHeartCostPreferences(analysis),
          },
        },
      });
      if (!validation.ok) {
        log(
          `  Hand ignition ${card.name}: ${
            validation.reason || "blocked"
          }`,
        );
        return;
      }

      // Calcular prioridade baseada no valor do monstro
      let priority = 8; // Base alta para efeitos que geram vantagem

      // Bonus se for combo conhecido (Eel -> Leviathan)
      if (card.name === "Shadow-Heart Leviathan") {
        priority = 9; // Combo forte: 2200 ATK + burn
        log(`  ✅ Hand ignition: ${card.name} (Eel -> Leviathan combo)`);
      } else {
        log(`  ✅ Hand ignition: ${card.name}`);
      }

      const macroBuff = calculateMacroPriorityBonus(
        "handIgnition",
        card,
        macroStrategy,
      );
      priority += macroBuff;

      actions.push({
        type: "handIgnition",
        index,
        cardId: card.id,
        priority,
        cardName: card.name,
        effectId: handIgnitionEffect.id,
        macroBuff,
      });
    });

    // === GERAR EFEITOS DE CONTINUOUS SPELL/TRAP EM CAMPO ===
    (bot.spellTrap || []).forEach((card, zoneIndex) => {
      if (!card || card.cardKind !== "spell" || card.isFacedown) return;
      const ignitionEffect = (card.effects || []).find(
        (effect) => effect && effect.timing === "ignition",
      );
      if (!ignitionEffect) return;

      if (card.name === "Shadow-Heart Cathedral") {
        const cathedralPlan = evaluateCathedralActivation(card, analysis);
        const predicted = estimateShadowHeartCathedralCounterGain(analysis);
        if (bot?.debug || actualGame?.devModeEnabled) {
          const candidateText = (cathedralPlan.candidateScores || [])
            .map(
              (entry) =>
                `${entry.name}:${entry.score} (${entry.plan || "no plan"})`,
            )
            .join(" | ");
          console.log(
            `[ShadowHeart Cathedral] field=true counters=${cathedralPlan.counterCount || 0} ` +
              `predicted=${predicted.count} target=${
                cathedralPlan.target?.name || "none"
              } specialTrigger=${!!cathedralPlan.hasRelevantSpecialTrigger} ` +
              `candidates=[${candidateText || (cathedralPlan.candidateNames || []).join(", ") || "none"}] ` +
              `plan=${cathedralPlan.expectedPlan || "none"} ` +
              `decision=${cathedralPlan.shouldActivate ? "use" : "hold"} reason=${
                cathedralPlan.reason
              }`,
          );
        }
        if (!cathedralPlan.shouldActivate) {
          log(`  ⏭️ Cathedral segura: ${cathedralPlan.reason}`);
          return;
        }

        if (!isSimulatedState) {
          const check =
            actualGame.effectEngine?.canActivateSpellTrapEffectPreview?.(
              card,
              bot,
              "spellTrap",
            );
          if (check?.ok === false) {
            log(`  ⏭️ Cathedral bloqueada: ${check.reason}`);
            return;
          }
        }

        log(
          `  ✅ Cathedral effect: ${cathedralPlan.target?.name || "target"} ` +
            `(${cathedralPlan.reason})`,
        );
        actions.push({
          type: "spellTrapEffect",
          zoneIndex,
          cardId: card.id,
          cardName: card.name,
          priority: cathedralPlan.priority,
          effectId: ignitionEffect.id,
          cathedralPlan: {
            targetName: cathedralPlan.target?.name || null,
            counterCount: cathedralPlan.counterCount || 0,
            reason: cathedralPlan.reason,
            expectedPlan: cathedralPlan.expectedPlan || null,
            candidateNames: cathedralPlan.candidateNames || [],
            candidateScores: cathedralPlan.candidateScores || [],
          },
          activationContext: {
            sourceZone: "spellTrap",
            actionContext: {
              cathedral: {
                counterCount: cathedralPlan.counterCount || 0,
                predictedCounters: predicted.count,
                targetName: cathedralPlan.target?.name || null,
                reason: cathedralPlan.reason,
                expectedPlan: cathedralPlan.expectedPlan || null,
                candidateNames: cathedralPlan.candidateNames || [],
                candidateScores: cathedralPlan.candidateScores || [],
              },
            },
          },
        });
        return;
      }

      if (!isSimulatedState) {
        const check = actualGame.effectEngine?.canActivateSpellTrapEffectPreview?.(
          card,
          bot,
          "spellTrap",
        );
        if (check?.ok === false) return;
      }

      actions.push({
        type: "spellTrapEffect",
        zoneIndex,
        cardId: card.id,
        cardName: card.name,
        priority: 5,
        effectId: ignitionEffect.id,
      });
    });

    // === STALEMATE BREAKER ===
    // Se não há ações e há capacidade de campo, forçar summon mesmo que já tenha invocado
    // Isso evita que o jogo fique travado quando o bot acumula cartas na mão
    // BUGFIX: Skip durante simulação (BeamSearch lookahead) - não é um stalemate real
    // BUGFIX: Só ativar se summon ainda está disponível (evita tentar invocar em Main2 após já ter invocado)
    if (
      actions.length === 0 &&
      analysis.fieldCapacity > 0 &&
      !isSimulatedState &&
      (bot.summonCount || 0) < 1 // Só força summon se ainda pode invocar
    ) {
      // CRITICAL: Usar estado REAL (this.bot) para fallback, não simulado
      const realBot = this.bot || bot;

      // Log para debug
      if (bot?.debug) {
        console.log(
          `[ShadowHeartStrategy] ⚠️ STALEMATE BREAKER ativado! Hand=${realBot.hand?.length}, Field=${realBot.field?.length}`,
        );
      }
      log(`  ⚠️ STALEMATE BREAKER: Forçando summon alternativo...`);
      let monstersChecked = 0;
      let monstersBlocked = 0;

      (realBot.hand || []).forEach((card, index) => {
        if (card.cardKind !== "monster") return;
        monstersChecked++;

        const tributeInfo = this.getTributeRequirementFor(card, realBot);
        if ((realBot.field?.length || 0) < tributeInfo.tributesNeeded) {
          monstersBlocked++;
          if (bot?.debug) {
            console.log(
              `[ShadowHeartStrategy] ❌ ${card.name} requer ${
                tributeInfo.tributesNeeded
              } tributos (tenho ${realBot.field?.length || 0})`,
            );
          }
          log(
            `    ❌ ${card.name} requer ${
              tributeInfo.tributesNeeded
            } tributos (tenho ${realBot.field?.length || 0})`,
          );
          return;
        }

        if (tributeInfo.tributesNeeded > 0) {
          const tradeCheck = evaluateTributeTrade(
            card,
            realBot.field || [],
            tributeInfo.tributesNeeded,
            { oppField: opponent?.field || [] },
          );
          if (!tradeCheck.ok) {
            if (bot?.debug) {
              console.log(
                `[ShadowHeartStrategy] ❌ Tribute ruim: ${card.name} (${tradeCheck.reason})`,
              );
            }
            log(`    ❌ Tribute ruim: ${card.name} (${tradeCheck.reason})`);
            return;
          }
        }

        // Forcar summon com prioridade baixa. Cartas com remocao ao invocar
        // precisam entrar face-up, ou o fallback desperdiça o proprio payoff.
        const mustResolveOnSummonFaceUp =
          this.cardClearsOpponentBoardOnSummon(card);
        const fallbackPosition = mustResolveOnSummonFaceUp
          ? "attack"
          : "defense";
        const fallbackFacedown = fallbackPosition === "defense";

        if (bot?.debug) {
          console.log(
            `[ShadowHeartStrategy] 🔧 Fallback summon: ${card.name} em ${fallbackPosition}`,
          );
        }
        log(`    🔧 Fallback summon: ${card.name} em ${fallbackPosition}`);
        actions.push({
          type: "summon",
          index,
          cardId: card.id,
          position: fallbackPosition,
          facedown: fallbackFacedown,
          priority: 1,
          cardName: card.name,
          isStalemateBreaker: true,
        });
      });

      if (monstersChecked > 0 && monstersBlocked === monstersChecked) {
        if (bot?.debug) {
          console.log(
            `[ShadowHeartStrategy] ⚠️ Todos ${monstersChecked} monstros na mão requerem tributos!`,
          );
        }
        log(
          `  ⚠️ Todos ${monstersChecked} monstros na mão requerem tributos! Tentando spells...`,
        );
      }
    }

    // === FALLBACK SECUNDÁRIO: Forçar qualquer spell se ainda não há ações ===
    // BUGFIX: Skip durante simulação (BeamSearch lookahead) - usar lógica normal
    if (actions.length === 0 && !isSimulatedState) {
      const realBot2 = this.bot || bot;
      // BUGFIX: Garantir que LP está sempre definido (buscar do game se necessário)
      const botLP = realBot2.lp ?? this.game?.bot?.lp ?? 8000;
      if ((realBot2.hand?.length || 0) > 3) {
        // Log para debug
        if (bot?.debug) {
          console.log(
            `[ShadowHeartStrategy] 🚨 FALLBACK CRÍTICO! Hand=${realBot2.hand?.length}, Field=${realBot2.field?.length}, LP=${botLP}`,
          );
        }
        log(
          `  🆘 FALLBACK CRÍTICO: ${realBot2.hand.length} cartas na mão, 0 ações! Forçando spell...`,
        );

        let spellsFound = 0;
        const canUseFallbackSpell = (card) => {
          const activationContext = buildShadowHeartSpellActivationContext(
            card,
            realBot2,
            opponent,
            analysis,
          );
          const preview = canActivateShadowHeartSpell(
            game,
            card,
            realBot2,
            activationContext,
          );
          return {
            ok: !!preview?.ok,
            reason: preview?.reason || "preview failed",
            activationContext,
          };
        };
        (realBot2.hand || []).forEach((card, index) => {
          if (card.cardKind !== "spell") return;

          const fallbackCheck = canUseFallbackSpell(card);
          if (!fallbackCheck.ok) {
            log(
              `    Fallback spell bloqueada: ${card.name} (${fallbackCheck.reason})`,
            );
            return;
          }

          // VALIDAÇÃO: Polymerization só pode ser ativado se tiver materiais válidos
          if (card.name === "Polymerization") {
            const canActivate =
              actualGame.canActivatePolymerization?.() ?? false;
            if (!canActivate) {
              if (bot?.debug) {
                console.log(
                  `[ShadowHeartStrategy] ⚠️ Polymerization bloqueado: sem materiais válidos`,
                );
              }
              return; // Skip Polymerization sem materiais
            }
          }

          if (
            card.name === "Shadow-Heart Purge" ||
            card.name === "Shadow-Heart Infusion"
          ) {
            const decision = shouldPlaySpell(card, analysis);
            if (!decision.yes) return;
          }

          spellsFound++;
          const activationContext = fallbackCheck.activationContext;

          // Tentar qualquer spell, mesmo sem validação prévia
          if (bot?.debug) {
            console.log(
              `[ShadowHeartStrategy] 🔧 Fallback spell: ${card.name} (prioridade 0.5)`,
            );
          }
          log(`    🔧 Fallback spell: ${card.name} (prioridade forçada: 0.5)`);
          actions.push({
            type: "spell",
            index,
            cardId: card.id,
            priority: 0.5,
            cardName: card.name,
            isCriticalFallback: true,
            ...(activationContext ? { activationContext } : {}),
          });
        });

        // Se ainda não há ações e não há spells, reportar situação crítica
        if (spellsFound === 0 && actions.length === 0) {
          const monsterCount = (realBot2.hand || []).filter(
            (c) => c.cardKind === "monster",
          ).length;
          const trapCount = (realBot2.hand || []).filter(
            (c) => c.cardKind === "trap",
          ).length;

          if (bot?.debug) {
            console.log(
              `[ShadowHeartStrategy] ⚠️ Situação crítica: ${monsterCount}M ${trapCount}T`,
            );
            console.log(
              `[ShadowHeartStrategy] Mão completa: ${(realBot2.hand || [])
                .map((c) => c.name)
                .join(", ")}`,
            );
          }
          log(
            `  ⚠️ Situação crítica: ${monsterCount} monstros (todos precisam tributos?), ${trapCount} traps na mão`,
          );
          log(
            `  📋 Mão: ${(realBot2.hand || []).map((c) => c.name).join(", ")}`,
          );
        }
      }
    }

    // === EFEITOS DE CAMPO ===
    // Em simulação, não verificar checkOncePerTurn
    if (bot.fieldSpell && !isSimulatedState) {
      const effect = (bot.fieldSpell.effects || []).find(
        (e) => e.timing === "on_field_activate",
      );
      if (effect) {
        const actualGame = game._gameRef || game;
        const check = actualGame.effectEngine?.checkOncePerTurn?.(
          bot.fieldSpell,
          bot,
          effect,
        );
        if (check?.ok) {
          actions.push({ type: "fieldEffect", priority: 5 });
        }
      }
    }

    const positionActions = this.getPositionChangeActions(game, bot, opponent);
    if (positionActions.length > 0) {
      actions.push(...positionActions);
    }

    const planningProfile = buildShadowHeartPlanningProfile(analysis, {
      game,
      strategy: this,
    });
    const retainedActions = applyShadowHeartCandidateRetention(actions, analysis, {
      game,
      strategy: this,
      profile: planningProfile,
      isSimulatedState,
    });

    // === P2: GAME TREE SEARCH (OPCIONAL) ===
    // Desativar P2 em simulação para evitar recursão infinita
    if (isSimulatedState) {
      return this.sequenceActions(retainedActions);
    }

    const finalActions = this.integrateP2IntoActionSelection(
      game,
      this.sequenceActions(retainedActions),
      analysis,
    );

    return finalActions;
  }

  /**
   * Ordena ações por prioridade estratégica.
   */
  sequenceActions(actions) {
    const sorted = actions.sort(
      (a, b) => (b.priority || 0) - (a.priority || 0),
    );

    this.think(`\n📋 Sequência de ações ordenada:`);
    sorted.forEach((a, i) => {
      this.think(
        `  ${i + 1}. ${a.type}: ${a.cardName || "?"} (pri: ${a.priority || 0})`,
      );
    });

    return sorted;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers (wrappers para módulos)
  // ─────────────────────────────────────────────────────────────────────────

  isShadowHeart(card) {
    return isShadowHeart(card);
  }

  isShadowHeartByName(name) {
    return isShadowHeartByName(name);
  }

  getTributeRequirementFor(card, playerState) {
    return getTributeRequirementFor(card, playerState);
  }

  selectBestTributes(field, tributesNeeded, cardToSummon, context) {
    return selectBestTributes(field, tributesNeeded, cardToSummon, context);
  }

  simulateMainPhaseAction(state, action) {
    return simAction(state, action, {
      strategy: this,
      placeSpellCard: this.placeSpellCard.bind(this),
      buildActivationContextForEffect: this.buildActivationContextForEffect.bind(this),
      rankSearchCandidates: this.rankSearchCandidates.bind(this),
      evaluateRecruitCandidate: this.evaluateRecruitCandidate.bind(this),
      chooseSpecialSummonPosition: this.chooseSpecialSummonPosition.bind(this),
    });
  }

  simulateSpellEffect(state, card) {
    return simulateSpellEffect(state, card, {
      strategy: this,
      placeSpellCard: this.placeSpellCard.bind(this),
      buildActivationContextForEffect: this.buildActivationContextForEffect.bind(this),
      rankSearchCandidates: this.rankSearchCandidates.bind(this),
      evaluateRecruitCandidate: this.evaluateRecruitCandidate.bind(this),
      chooseSpecialSummonPosition: this.chooseSpecialSummonPosition.bind(this),
    });
  }

  // P2 (evaluateCriticalSituationWithGameTree, analyzeOpponentPosition,
  // integrateP2IntoActionSelection) foi hoisted para BaseStrategy.
}
