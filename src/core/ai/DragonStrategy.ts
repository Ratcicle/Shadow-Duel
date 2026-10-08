import { generateDragonMainPhaseActions, buildDragonActionContext, buildActivationContext } from "./dragon/generation.js";
import type { DragonStrategyGame } from "./dragon/generation.js";
import type { SimulatedActionOptions } from "./common/simulatedActions/shared.js";
// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/DragonStrategy.js
// Dragon deck AI strategy — orchestrates dragon/* modules.
//
// DRAGON DECK PHILOSOPHY:
// - Mid-range Dragon beatdown with powerful singletons
// - Early game: Eclipse engine, Armored search, Luminescent revive
// - Mid game: Stelya bridge, Jagged Peak counters, Hellkite recursion
// - Late game: Radiant/Tech fusion, Awakening bosses, and GY resource loops
// - Key constraint: Only 1 face-up Extreme Dragon on field at a time
// - Key constraint: Extreme Dragons in GY are useful resources, not an automatic win plan
// ─────────────────────────────────────────────────────────────────────────────

import BaseStrategy from "./BaseStrategy.js";
import { canUseNormalSummonForCard } from "../Player.js";

import type { BotStrategyPort } from "../contracts/bot.js";
import { getCounterCount } from "./common/counters.js";

import type { AIAction, AIPlannedAction, AIPlanningContext, AIState, AIStrategyBotPort } from "../contracts/ai.js";
import type { GameTreeSimulationGameState, PerspectiveGameState, SimulatedPlayerState, SimulationGameState } from "../contracts/aiState.js";
import type { CanonicalZone } from "../contracts/zones.js";
import type { DragonCard, DragonPlayer, DragonGame, DragonAnalysis, DragonPolicyContext, DragonSearchAction, DragonAscensionChoice } from "./dragon/contracts.js";
import type { DragonLineContext } from "./dragon/linePlanning.js";

type StrategySimulation = SimulationGameState | PerspectiveGameState | GameTreeSimulationGameState;

import { sequenceActionsByPriority } from "./common/actionSequencing.js";

import { detectLethalOpportunity, detectDefensiveNeed, detectComeback, decideMacroStrategy } from "./MacroPlanning.js";

import { CARD_KNOWLEDGE, getDragonStrategicCardValue } from "./dragon/knowledge.js";
import { COMBO_DATABASE, detectAvailableCombos } from "./dragon/combos.js";
import { getTributeRequirementFor as dragonGetTributeRequirementFor, selectBestTributes } from "./dragon/priorities.js";
import { assessDragonExtremeResourcePolicy, analyzeExtremeDragonEconomy, evaluateBoardDragon } from "./dragon/scoring.js";
import { analyzeDragonState } from "./dragon/stateAnalysis.js";
import { rankDragonSearchCandidates } from "./dragon/searchPolicy.js";

import { evaluateDragonRecruitCandidate } from "./dragon/actionPolicy.js";

import { chooseDragonAscensionPosition, selectDragonAscensionChoice, selectDragonFusionPlan } from "./dragon/extraDeckPolicy.js";

import { simulateMainPhaseAction as simulateDragonAction } from "./dragon/simulation.js";
import { applyDragonSimulatedBattleRewards, prepareDragonSimulatedBattle, buildDragonPlanningProfile, describeDragonPlannedLine, scoreDragonBattleAttackCandidate, scoreDragonLineMilestones, scoreDragonLineTerminal } from "./dragon/linePlanning.js";

const cardStrategicValue = getDragonStrategicCardValue;

export default class DragonStrategy extends BaseStrategy {
  declare cardKnowledge: typeof CARD_KNOWLEDGE;
  declare knownCombos: typeof COMBO_DATABASE;
  declare currentAnalysis: DragonAnalysis | null;
  declare thoughtProcess: string[];
  constructor(bot: AIStrategyBotPort) {
    super(bot);
    this.cardKnowledge = CARD_KNOWLEDGE;
    this.knownCombos = COMBO_DATABASE;
    this.currentAnalysis = null;
    this.thoughtProcess = [];
  }

  override simulateMainPhaseAction(state: StrategySimulation, action: AIPlannedAction) {
    return (simulateDragonAction as (state: StrategySimulation, action: AIPlannedAction,
      options: ReturnType<DragonStrategy["getPlanningSimulationOptions"]>) => StrategySimulation)(
        state, action, this.getPlanningSimulationOptions(state));
  }

  getPlanningSimulationOptions(_state: StrategySimulation) {
    let completedFusion: { card: SimulatedPlayerState["field"][number]; plan: NonNullable<ReturnType<typeof selectDragonFusionPlan>> } | null = null;
    const chooseFusionSummon: NonNullable<SimulatedActionOptions["chooseFusionSummon"]> = input => {
      const { _gameRef: _liveGame, ...game } = input.state;
      const plan = selectDragonFusionPlan({ game, player: input.player, bot: input.player,
        opponent: input.opponent, isSimulatedState: true });
      if (!plan?.ok) return null;
      const chosen = input.candidates.find(entry => entry.fusionCard.name === plan.fusionName);
      if (!chosen) return null;
      completedFusion = { card: chosen.fusionCard, plan };
      return chosen;
    };
    return {
      strategy: this,
      placeSpellCard: this.placeSpellCard.bind(this),
      useRuntimeOptionalTargets: true,
      chooseFusionSummon,
      onFusionSummon: () => {
        if (!completedFusion) return;
        const { card, plan } = completedFusion;
        if (plan.fusionName === "Radiant Cosmic Dragon") card.simFutureRevive = plan.futureRevive === true;
      },
      enableSimulatedEvents: true,
      rankSearchCandidates: this.rankSearchCandidates.bind(this),
      evaluateRecruitCandidate: this.evaluateRecruitCandidate.bind(this),
    };
  }

  rankSearchCandidates<Card extends DragonCard>(cards: Card[], action: DragonSearchAction, context: DragonPolicyContext = {}) {
    const game = context.game || null;
    const player = context.player || this.bot || game?.bot || {};
    const opponent =
      context.opponent ||
      (game && player ? this.getOpponent(game as AIState, player as AIStrategyBotPort) : null) ||
      {};
    return rankDragonSearchCandidates(cards, action, {
      ...context,
      player,
      opponent,
      game,
      analysis: context.analysis || this.currentAnalysis,
      fallbackValue: cardStrategicValue,
    });
  }

  evaluateRecruitCandidate<Card extends DragonCard>(candidates: Card[], context: DragonPolicyContext = {}) {
    const game = context.game || null;
    const player = context.player || this.bot || game?.bot || {};
    const opponent =
      context.opponent ||
      (game && player ? this.getOpponent(game as AIState, player as AIStrategyBotPort) : null) ||
      {};
    return evaluateDragonRecruitCandidate(candidates, {
      ...context,
      player,
      opponent,
      game,
      analysis: context.analysis || this.currentAnalysis,
      fallbackValue: cardStrategicValue,
    });
  }

  buildActivationContextForEffect({
    sourceCard,
    effect,
    player,
    game,
    activationZone,
  }: DragonPolicyContext & { activationZone?: CanonicalZone } = {}) {
    const owner = player || this.bot || game?.bot || {};
    const opponent =
      game && owner ? this.getOpponent(game as AIState, owner as AIStrategyBotPort) || {} : {};
    const zone = activationZone || "field";
    const actionContext = buildDragonActionContext({
      analysis: this.currentAnalysis,
      player: owner,
      bot: owner,
      opponent,
      game,
      source: sourceCard,
      sourceCard,
      effect,
    });
    return buildActivationContext(zone, actionContext, {
      logTargets: false,
    });
  }

  override getPlanningProfile(gameInput: AIState, contextInput: AIPlanningContext = {}) {
    const game = gameInput as DragonStrategyGame;
    const context = contextInput as DragonLineContext;
    if (!game) return super.getPlanningProfile(gameInput, contextInput);
    const analysis = context.analysis || this.analyzeGameState(game);
    return buildDragonPlanningProfile(analysis, {
      ...context,
      game,
      bot: context.bot || this.bot || game.bot,
    });
  }

  override shouldUseDeepPlanning(gameInput: AIState, contextInput: AIPlanningContext = {}) {
    const game = gameInput as DragonStrategyGame;
    const context = contextInput as DragonLineContext;
    const profile =
      context.profile || this.getPlanningProfile(gameInput, contextInput) || {};
    return game?.turnLineSearchEnabled === true || profile.enabled === true;
  }

  override scoreLineMilestones(context: AIPlanningContext = {}) {
    return scoreDragonLineMilestones(context as DragonLineContext);
  }

  override scoreLineTerminal(context: AIPlanningContext = {}) {
    return scoreDragonLineTerminal(context as DragonLineContext);
  }

  override describePlannedLine(context: AIPlanningContext = {}) {
    return describeDragonPlannedLine(context as DragonLineContext);
  }

  scoreBattleAttackCandidate(context: Parameters<NonNullable<BotStrategyPort["scoreBattleAttackCandidate"]>>[0] | DragonPolicyContext = {}) {
    return scoreDragonBattleAttackCandidate(context as DragonPolicyContext);
  }

  applySimulatedBattleRewards(context: DragonLineContext = {}) {
    return applyDragonSimulatedBattleRewards(context);
  }

  prepareSimulatedBattle(context: DragonLineContext = {}) {
    return prepareDragonSimulatedBattle(context);
  }

  override sequenceActions(actions: AIAction[] = []) {
    return sequenceActionsByPriority(actions);
  }

  selectAutomaticAscension<Card extends DragonCard>({ choices = [], game, bot = this.bot, opponent }: DragonPolicyContext & { choices?: DragonAscensionChoice<Card>[] } = {}) {
    const selected = selectDragonAscensionChoice(choices, {
      game,
      player: bot,
      bot,
      opponent,
      analysis: this.currentAnalysis,
    });
    if (!selected) return { skip: true };
    return {
      // scoreAscensionChoice rejects entries missing either card before ranking.
      material: selected.material!,
      ascensionCard: selected.ascensionCard!,
      position: selected.position,
    };
  }

  chooseAutomaticAscensionPosition({
    ascensionCard,
    material,
    game,
    bot = this.bot,
    opponent,
  }: DragonPolicyContext & DragonAscensionChoice = {}) {
    return chooseDragonAscensionPosition({
      ascensionCard,
      material,
      game,
      bot,
      opponent,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Board evaluation
  // ─────────────────────────────────────────────────────────────────────────

  override evaluateBoard(gameOrState: AIState, perspectivePlayer: SimulatedPlayerState | undefined) {
    return evaluateBoardDragon(
      gameOrState as DragonGame,
      perspectivePlayer,
      this.getOpponent.bind(this) as (game: DragonGame, player: DragonPlayer | null | undefined) => DragonPlayer | null,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tribute override — Dragon altTribute logic
  // ─────────────────────────────────────────────────────────────────────────

  override getTributeRequirementFor(card: DragonCard, playerState: DragonPlayer) {
    return dragonGetTributeRequirementFor(card, playerState);
  }

  override selectBestTributes(field: readonly DragonCard[], tributesNeeded: number, cardToSummon: DragonCard, context: DragonPolicyContext = {}) {
    return selectBestTributes(field, tributesNeeded, cardToSummon, context);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Logging
  // ─────────────────────────────────────────────────────────────────────────

  override think(thought: string) {
    this.thoughtProcess.push(thought);
    if (!this.bot?.debug) return;
    console.log(`[Dragon AI] ${thought}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Game state analysis
  // ─────────────────────────────────────────────────────────────────────────

  analyzeGameState(gameInput: AIState) {
    const game = gameInput as DragonStrategyGame;
    this.thoughtProcess = [];

    const isSimulatedState = game._isPerspectiveState === true;
    const bot = isSimulatedState ? game.bot : this.bot || game.bot;
    const opponent = this.getOpponent(game, bot);

    const gyCards = bot.graveyard || [];
    const extremeDragonEconomy = analyzeExtremeDragonEconomy({ graveyard: gyCards });
    const extremeInGY = extremeDragonEconomy.extremeInGY;
    const dragonState = analyzeDragonState({
      game,
      bot,
      opponent: opponent!,
      isSimulatedState,
    });

    const analysis = {
      hand: (bot.hand || []).map((c) => ({
        name: c.name!,
        cardKind: c.cardKind,
        type: c.type,
        attribute: c.attribute,
        level: c.level,
        atk: c.atk,
        def: c.def,
        archetype: c.archetype,
        archetypes: c.archetypes,
      })),
      field: (bot.field || []).map((c) => ({
        name: c.name!,
        atk: c.atk,
        def: c.def,
        level: c.level,
        cardKind: c.cardKind,
        type: c.type,
        attribute: c.attribute,
        position: c.position,
        isFacedown: c.isFacedown,
        hasAttacked: c.hasAttacked,
        battleIndestructible: c.battleIndestructible,
        cannotBeDestroyedByBattle: (c as DragonCard).cannotBeDestroyedByBattle,
        archetype: c.archetype,
      })),
      graveyard: gyCards,
      fieldSpell: bot.fieldSpell || null,
      spellTrap: (bot.spellTrap || []).map((c) => ({
        name: c.name!,
        cardKind: c.cardKind,
        isFacedown: c.isFacedown,
      })),
      lp: bot.lp,
      summonCount: bot.summonCount || 0,
      phase: game.phase || "main1",
      turnCounter: game.turnCounter || 0,

      oppField: (opponent?.field || []).map((c) => ({
        name: c.name!,
        atk: c.atk,
        def: c.def,
        level: c.level,
        cardKind: c.cardKind,
        position: c.position,
        isFacedown: c.isFacedown,
        battleIndestructible: c.battleIndestructible,
        cannotBeDestroyedByBattle: (c as DragonCard).cannotBeDestroyedByBattle,
      })),
      oppBackrow: opponent?.spellTrap?.length || 0,
      oppHand: opponent?.hand?.length || 0,
      oppLp: opponent?.lp || 0,
      lpRatio: opponent?.lp ? bot.lp / opponent.lp : 1,

      canNormalSummon: bot.hand.some(card => card.cardKind === "monster" && canUseNormalSummonForCard(bot, card)),
      fieldCapacity: 5 - (bot.field?.length || 0),

      // Dragon-specific
      extremeInGY,
      extremeDragonEconomy,
      extremeResourcePolicy: assessDragonExtremeResourcePolicy({ extremeDragonEconomy }),
      hasJaggedPeak: bot.fieldSpell?.name === "Jagged Peak of the Dragons",
      jaggedPeakCounters: getCounterCount(bot.fieldSpell, "dragon_peak"),
      dragonState,
      hasSolarInHand: dragonState.hasSolarInHand,
      hasSolarInGY: dragonState.hasSolarInGY,
      hasLunarInHand: dragonState.hasLunarInHand,
      hasLunarInDeck: dragonState.hasLunarInDeck,
      hasLunarInGY: dragonState.hasLunarInGY,
      hasStelyaInHand: dragonState.hasStelyaInHand,
      hasStelyaInDeck: dragonState.hasStelyaInDeck,
      hasStelyaInGY: dragonState.hasStelyaInGY,
      hasUsefulLunarDiscard: dragonState.hasUsefulLunarDiscard,
      hasDragonFieldBodyForStelya: dragonState.hasDragonFieldBodyForStelya,
      hasTwoDragonsForAwakening: dragonState.hasTwoDragonsForAwakening,
      hasLevel7PlusForRoar: dragonState.hasLevel7PlusForRoar,
      hasVoltaicForTechVoid: dragonState.hasVoltaicForTechVoid,
      hasLuminousForRadiant: dragonState.hasLuminousForRadiant,
      hasThreeSafeGYDragonsForPurified: dragonState.hasThreeSafeGYDragonsForPurified,
      hasExtremeDragonFaceup: dragonState.hasExtremeDragonFaceup,

      availableCombos: [] as ReturnType<typeof detectAvailableCombos>,
    };

    this.think(`📊 Dragon AI: ${bot.lp} LP vs ${opponent?.lp} LP`);
    this.think(`🃏 Hand: ${analysis.hand.map((c) => c.name!).join(", ") || "empty"}`);
    this.think(`⚔️ Field: ${analysis.field.map((c) => c.name!).join(", ") || "empty"}`);
    this.think(`☠️ GY Extreme Dragons: ${extremeInGY} resource(s)`);

    analysis.availableCombos = detectAvailableCombos(analysis, (msg) => this.think(msg));

    this.currentAnalysis = analysis;
    return analysis;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Macro planning
  // ─────────────────────────────────────────────────────────────────────────

  evaluateMacroStrategy(game: DragonStrategyGame, analysis: DragonAnalysis) {
    const isSimulatedState = game?._isPerspectiveState === true;
    const actualGame = game;
    const bot = isSimulatedState ? game.bot : this.bot || game.bot;
    const opponent = this.getOpponent(isSimulatedState ? game : actualGame, bot);

    const lethal = detectLethalOpportunity({ bot, player: opponent, field: {} }, bot, opponent, 2);
    const defensive = detectDefensiveNeed({ bot, player: opponent }, bot, opponent!);
    const comeback = detectComeback({ bot, player: opponent }, bot, opponent!);
    const macro = decideMacroStrategy({ bot, player: opponent }, bot, opponent!);

    return macro;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Main phase action generation
  // ─────────────────────────────────────────────────────────────────────────

  override generateMainPhaseActions(gameInput: AIState): AIAction[] {
    return generateDragonMainPhaseActions.call(this, gameInput);
  }
}
