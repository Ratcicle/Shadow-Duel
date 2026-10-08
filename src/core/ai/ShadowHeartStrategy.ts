import type { AIAction, AIPlannedAction, AIPlanningContext, AIPlanningProfile, AIState, AIStrategyBotPort, StrategyRuntimePort } from "../contracts/ai.js";
import type { SimulatedCardState, SimulatedPlayerState } from "../contracts/aiState.js";
import type { GameCard } from "../contracts/cards.js";
import type { EffectDefinition } from "../contracts/effects.js";
import type { PreviewGamePort } from "./common/previewGuards.js";
import type { CardAction } from "../contracts/actions.js";
type StrategyCard = (GameCard | SimulatedCardState) & { cannotBeDestroyedByBattle?: boolean | undefined };
type Analysis = ReturnType<ShadowHeartStrategy["analyzeGameState"]>;
type ShadowGamePort = PreviewGamePort & { canActivatePolymerization?(): boolean; devModeEnabled?: boolean };
type StrategyGame = AIState & { devModeEnabled?: boolean; turnLineSearchEnabled?: boolean };

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
import { generateShadowHeartMainPhaseActions } from "./shadowheart/actionGeneration.js";

import { buildStrategyAnalysis } from "./common/analysis.js";

import { getEffectiveAtk } from "./common/cardStats.js";

import { detectLethalOpportunity, detectDefensiveNeed, detectComeback, decideMacroStrategy } from "./MacroPlanning.js";

// P2 (gameTreeSearch, analyzeOpponent etc.) está em BaseStrategy.

// Módulos Shadow-Heart refatorados
import { CARD_KNOWLEDGE, isShadowHeart, isShadowHeartByName } from "./shadowheart/knowledge.js";
import { COMBO_DATABASE, detectAvailableCombos } from "./shadowheart/combos.js";
import { selectBestTributes, evaluateTributeTrade, getTributeRequirementFor, buildShadowHeartCostPreferences, buildShadowHeartTargetPreferences, assessShadowHeartSummonEntry, evaluateShadowHeartFinisherPlans, evaluateShadowHeartRecruitCandidate, rankShadowHeartSearchCandidates } from "./shadowheart/priorities.js";
import { evaluateMonster, evaluateBoardShadowHeart, evaluateShadowHeartTributeBossBonus } from "./shadowheart/scoring.js";
import { buildShadowHeartSimulationOptions, simulateMainPhaseAction as simAction, simulateSpellEffect } from "./shadowheart/simulation.js";
import { buildShadowHeartResourceEconomy } from "./shadowheart/resourceEconomy.js";
import { buildShadowHeartPlanningProfile, applyShadowHeartSimulatedBattleRewards, scoreShadowHeartBattleAttackCandidate, scoreShadowHeartLineMilestones, scoreShadowHeartLineTerminal, describeShadowHeartPlannedLine } from "./shadowheart/linePlanning.js";

/**
 * Estratégia Shadow-Heart - IA avançada que pensa como um jogador humano experiente.
 */
export default class ShadowHeartStrategy extends BaseStrategy {
  declare game: StrategyGame | undefined;
  declare cardKnowledge: typeof CARD_KNOWLEDGE;
  declare knownCombos: typeof COMBO_DATABASE;
  declare currentAnalysis: Analysis | null;
  declare thoughtProcess: string[];

  constructor(bot: AIStrategyBotPort) {
    super(bot);

    // Referência ao knowledge (para compatibilidade)
    this.cardKnowledge = CARD_KNOWLEDGE;

    // Combos conhecidos
    this.knownCombos = COMBO_DATABASE;

    // Estado de análise atual
    this.currentAnalysis = null;
    this.thoughtProcess = [];
  }

  override getPlanningProfile(game: StrategyGame, context: AIPlanningContext & { analysis?: Analysis } = {}): AIPlanningProfile {
    if (!game) return super.getPlanningProfile(game, context);
    const analysis = context.analysis || this.analyzeGameState(game);
    return buildShadowHeartPlanningProfile(analysis, {
      ...context,
      game,
      strategy: this,
    });
  }

  override shouldUseDeepPlanning(game: StrategyGame, context: AIPlanningContext = {}) {
    const profile =
      context.profile || this.getPlanningProfile(game, context) || {};
    return game?.turnLineSearchEnabled === true || profile.enabled === true;
  }

  override scoreLineMilestones(context: AIPlanningContext = {}) {
    return scoreShadowHeartLineMilestones(context as Parameters<typeof scoreShadowHeartLineMilestones>[0]);
  }

  override scoreLineTerminal(context: AIPlanningContext = {}) {
    return scoreShadowHeartLineTerminal(context as Parameters<typeof scoreShadowHeartLineTerminal>[0]);
  }

  override describePlannedLine(context: AIPlanningContext = {}) {
    return describeShadowHeartPlannedLine(context as Parameters<typeof describeShadowHeartPlannedLine>[0]);
  }

  scoreBattleAttackCandidate(context: Parameters<typeof scoreShadowHeartBattleAttackCandidate>[0] = {}) {
    return scoreShadowHeartBattleAttackCandidate(context);
  }

  applySimulatedBattleRewards(context: Parameters<typeof applyShadowHeartSimulatedBattleRewards>[0] = {}) {
    return applyShadowHeartSimulatedBattleRewards(context);
  }

  buildActivationContextForEffect({ sourceCard, effect, player, game }: { sourceCard?: StrategyCard; effect?: EffectDefinition | null | undefined; player?: AIStrategyBotPort; game?: StrategyGame } = {}) {
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

  rankSearchCandidates<Card extends StrategyCard>(cards: Card[], action: Parameters<typeof rankShadowHeartSearchCandidates>[1] = {}, ctx: Parameters<typeof rankShadowHeartSearchCandidates>[2] = {}) {
    return rankShadowHeartSearchCandidates(cards, action, {
      ...ctx,
      strategy: this,
      getOpponent: this.getOpponent.bind(this),
    });
  }

  evaluateRecruitCandidate<Card extends StrategyCard>(candidates: Card[] | undefined, context: Parameters<typeof evaluateShadowHeartRecruitCandidate>[1] = {}) {
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
  chooseSpecialSummonPosition(card: StrategyCard, ctx: Parameters<typeof assessShadowHeartSummonEntry>[1] = {}) {
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
  cardClearsOpponentBoardOnSummon(card: StrategyCard) {
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
      if (actions.some((a: CardAction) => a && removalActionTypes.has(a.type))) {
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
  analyzeGameState(game: StrategyGame) {
    this.thoughtProcess = [];

    // FIDELIDADE: Usar o bot do game/state em vez de this.bot
    // Isso permite que lookahead (BeamSearch/GameTree) funcione corretamente
    const isSimulatedState = game._isPerspectiveState === true;
    const bot = (isSimulatedState ? game.bot : this.bot || game.bot) as AIStrategyBotPort;
    const opponent = this.getOpponent(game, bot);
    const baseAnalysis: ReturnType<typeof buildStrategyAnalysis> = buildStrategyAnalysis({
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
        cannotBeDestroyedByBattle: (c as StrategyCard).cannotBeDestroyedByBattle,
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
        cannotBeDestroyedByBattle: (c as StrategyCard).cannotBeDestroyedByBattle,
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
      threatsOnBoard: [] as Array<{ card?: string | undefined; atk: number; threat: string }>,
      availableCombos: [] as ReturnType<typeof detectAvailableCombos>,
      bestPlays: [] as AIAction[],
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

    this.think(`📊 Analisando situação: ${bot.lp} LP vs ${opponent!.lp} LP`);
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
    (analysis as typeof analysis & { resourceEconomy: ReturnType<typeof buildShadowHeartResourceEconomy> }).resourceEconomy = buildShadowHeartResourceEconomy(analysis);
    (analysis as typeof analysis & { finisherPlans: ReturnType<typeof evaluateShadowHeartFinisherPlans> }).finisherPlans = evaluateShadowHeartFinisherPlans(
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
  override think(thought: string) {
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
  override evaluateBoard(gameOrState: AIState, perspectivePlayer?: SimulatedPlayerState): number {
    return evaluateBoardShadowHeart(
      gameOrState,
      perspectivePlayer!,
      this.getOpponent.bind(this),
    );
  }

  override evaluateBoardV2(gameOrState: AIState, perspectivePlayer?: SimulatedPlayerState): number {
    const perspective = perspectivePlayer?.id
      ? perspectivePlayer
      : gameOrState?.bot as SimulatedPlayerState;
    const opponent = this.getOpponent(gameOrState, perspective);
    return (
      super.evaluateBoardV2(gameOrState, perspectivePlayer) +
      evaluateShadowHeartTributeBossBonus(perspective!, opponent!)
    );
  }

  /**
   * Avalia um monstro individual (wrapper para compatibilidade).
   */
  evaluateMonster(monster: Parameters<typeof evaluateMonster>[0], owner: Parameters<typeof evaluateMonster>[1], opponent: Parameters<typeof evaluateMonster>[2]) {
    return evaluateMonster(monster, owner, opponent);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Macro Planning
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Avalia macro strategy usando MacroPlanning.
   */
  evaluateMacroStrategy(game: AIState, analysis: Analysis) {
    const actualGame = (game._gameRef || game) as ShadowGamePort;
    const bot = this.bot;
    const opponent = this.getOpponent(actualGame as AIState, bot);

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

    const macro = decideMacroStrategy({ bot, player: opponent }, bot, opponent!);

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
  override generateMainPhaseActions(game: StrategyGame): AIAction[] {
    return generateShadowHeartMainPhaseActions.call(this, game);
  }

  /**
   * Ordena ações por prioridade estratégica.
   */
  override sequenceActions(actions: AIAction[]) {
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

  isShadowHeart(card: Parameters<typeof isShadowHeart>[0]) {
    return isShadowHeart(card);
  }

  isShadowHeartByName(name: Parameters<typeof isShadowHeartByName>[0]) {
    return isShadowHeartByName(name);
  }

  override getTributeRequirementFor(card: Parameters<typeof getTributeRequirementFor>[0], playerState: Parameters<typeof getTributeRequirementFor>[1]) {
    return getTributeRequirementFor(card, playerState);
  }

  override selectBestTributes(field: SimulatedCardState[], tributesNeeded: number, cardToSummon: SimulatedCardState, context?: Parameters<typeof selectBestTributes>[3]) {
    return selectBestTributes(field, tributesNeeded, cardToSummon, context);
  }

  evaluateTributeTrade(cardToSummon: SimulatedCardState, field: SimulatedCardState[], tributesNeeded: number, context: Parameters<typeof evaluateTributeTrade>[3] = {}) {
    return evaluateTributeTrade(cardToSummon, field, tributesNeeded, context);
  }

  override simulateMainPhaseAction(state: Parameters<StrategyRuntimePort["simulateMainPhaseAction"]>[0], action: AIPlannedAction) {
    const options = this.getPlanningSimulationOptions(state);
    return simAction(state as Parameters<typeof simAction>[0], action as AIAction, { strategy: this }, options);
  }

  getPlanningSimulationOptions(_state: Parameters<StrategyRuntimePort["simulateMainPhaseAction"]>[0]) {
    return buildShadowHeartSimulationOptions({
      strategy: this,
      placeSpellCard: this.placeSpellCard.bind(this),
      buildActivationContextForEffect: this.buildActivationContextForEffect.bind(this),
      rankSearchCandidates: this.rankSearchCandidates.bind(this),
      evaluateRecruitCandidate: this.evaluateRecruitCandidate.bind(this),
      chooseSpecialSummonPosition: this.chooseSpecialSummonPosition.bind(this),
    });
  }

  override simulateSpellEffect(state: Parameters<StrategyRuntimePort["simulateMainPhaseAction"]>[0], card: SimulatedCardState) {
    return simulateSpellEffect(state as Parameters<typeof simulateSpellEffect>[0], card, {
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
