import type { MirageboundCard, MirageboundPlayer, MirageboundAnalysis, MirageboundGame, MirageboundContext, MirageboundLineAction, MirageboundChainOption, MirageboundBattleContext, MirageboundStatCard } from "./miragebound/contracts.js";
import type { AIAction, AIState, AIPlanningContext, AIStrategyBotPort } from "../contracts/ai.js";
import type { SimulatedPlayerState } from "../contracts/aiState.js";
import BaseStrategy from "./BaseStrategy.js";
import { applyGenericSimulatedMainPhaseAction } from "./common/simulation.js";
import { buildMirageboundPlanningProfile, describeMirageboundPlannedLine, scoreMirageboundBattleAttackCandidate, scoreMirageboundLineMilestones, scoreMirageboundLineTerminal } from "./miragebound/linePlanning.js";
import { MIRAGEBOUND } from "./miragebound/knowledge.js";
import { buildChainActivationContext, chooseChainResponse, evaluateFalseHorizonChainResponse, evaluateVanishingStepChainResponse } from "./miragebound/defense.js";
import { selectBestTributes } from "./miragebound/resourcePolicy.js";
import { buildActivationContextForEffect, chooseActionCase, chooseSpecialSummonPosition, rankByNameOrder, rankSearchCandidates } from "./miragebound/targeting.js";
import { chooseAutomaticAscensionPosition, getExtraDeckActions, selectAutomaticAscension, shouldUseAutomaticAscensionShortcut } from "./miragebound/extraDeck.js";
import { analyzeGameState } from "./miragebound/analysis.js";
import { generateMainPhaseActions, getFieldEffectActions, getHandIgnitionActions, getMonsterEffectActions, getSetSpellTrapActions, getSpellActions, getSpellTrapEffectActions, getSummonActions, sequenceActions } from "./miragebound/actionGeneration.js";
import { evaluateBoard } from "./miragebound/scoring.js";


export default class MirageboundStrategy extends BaseStrategy {
  declare currentAnalysis: MirageboundAnalysis | null;
  declare thoughtProcess: string[];
  constructor(bot: AIStrategyBotPort) {
    super(bot);
    this.currentAnalysis = null;
    this.thoughtProcess = [];
  }

  override get archetypeLabel() {
    return "Miragebound";
  }

  override think(thought: string) {
    this.thoughtProcess.push(thought);
    if (this.bot?.debug) {
      console.log(`[Miragebound AI] ${thought}`);
    }
  }

  override getPlanningProfile(game: MirageboundGame, context: AIPlanningContext = {}) {
    if (!game) return super.getPlanningProfile(game, context);
    const analysis = (context as MirageboundContext).analysis || this.analyzeGameState(game);
    return buildMirageboundPlanningProfile(analysis, {
      ...(context as MirageboundContext),
      game,
      bot: ((context as MirageboundContext).bot || this.bot || game.bot) as MirageboundPlayer,
      strategy: this,
    });
  }

  override shouldUseDeepPlanning(game: MirageboundGame, context: AIPlanningContext = {}) {
    const profile =
      context.profile || this.getPlanningProfile(game, context) || {};
    return game?.turnLineSearchEnabled === true || profile.enabled === true;
  }

  override scoreLineMilestones(context: AIPlanningContext = {}) {
    return scoreMirageboundLineMilestones(context as MirageboundContext);
  }

  override scoreLineTerminal(context: AIPlanningContext = {}) {
    return scoreMirageboundLineTerminal(context as MirageboundContext);
  }

  override describePlannedLine(context: AIPlanningContext = {}) {
    return describeMirageboundPlannedLine(context as MirageboundContext);
  }

  scoreBattleAttackCandidate(context: MirageboundBattleContext = {}) {
    return scoreMirageboundBattleAttackCandidate(context);
  }

  analyzeGameState(game: MirageboundGame): MirageboundAnalysis {
    return analyzeGameState(this, game);
  }

  buildActivationContextForEffect(options: MirageboundContext = {}) {
    return buildActivationContextForEffect(this, options);
  }

  buildChainActivationContext(option: MirageboundChainOption, analysis: MirageboundAnalysis, context: MirageboundContext = {}) {
    return buildChainActivationContext(option, analysis, context);
  }

  evaluateFalseHorizonChainResponse(option: MirageboundChainOption, analysis: MirageboundAnalysis, context: MirageboundContext = {}) {
    return evaluateFalseHorizonChainResponse(option, analysis, context);
  }

  evaluateVanishingStepChainResponse(option: MirageboundChainOption, analysis: MirageboundAnalysis, context: MirageboundContext = {}) {
    return evaluateVanishingStepChainResponse(option, analysis, context);
  }

  async chooseChainResponse(options: Partial<Parameters<NonNullable<import("../contracts/chainRuntime.js").ChainStrategyPort["chooseChainResponse"]>>[0]> = {}): Promise<import("../contracts/chainRuntime.js").ChainStrategyResponse | null> {
    return chooseChainResponse(this, options);
  }

  getSpellActions(game: MirageboundGame, bot: MirageboundPlayer, analysis: MirageboundAnalysis) {
    return getSpellActions(this, game, bot, analysis);
  }

  getSetSpellTrapActions(game: MirageboundGame, bot: MirageboundPlayer, analysis: MirageboundAnalysis) {
    return getSetSpellTrapActions(game, bot, analysis);
  }

  getSummonActions(_game: MirageboundGame, bot: MirageboundPlayer, analysis: MirageboundAnalysis) {
    return getSummonActions(this, _game, bot, analysis);
  }

  getHandIgnitionActions(game: MirageboundGame, bot: MirageboundPlayer, analysis: MirageboundAnalysis) {
    return getHandIgnitionActions(this, game, bot, analysis);
  }

  getMonsterEffectActions(game: MirageboundGame, bot: MirageboundPlayer, analysis: MirageboundAnalysis) {
    return getMonsterEffectActions(this, game, bot, analysis);
  }

  getFieldEffectActions(game: MirageboundGame, bot: MirageboundPlayer, analysis: MirageboundAnalysis) {
    return getFieldEffectActions(this, game, bot, analysis);
  }

  getSpellTrapEffectActions(game: MirageboundGame, bot: MirageboundPlayer, analysis: MirageboundAnalysis) {
    return getSpellTrapEffectActions(this, game, bot, analysis);
  }

  getExtraDeckActions(game: MirageboundGame, bot: MirageboundPlayer, analysis: MirageboundAnalysis) {
    return getExtraDeckActions(this, game, bot, analysis);
  }

  override generateMainPhaseActions(game: MirageboundGame) {
    return generateMainPhaseActions(this, game);
  }

  override sequenceActions(actions: AIAction[] = []) {
    return sequenceActions(actions);
  }

  override evaluateBoard(gameOrState: MirageboundGame, perspectivePlayer: SimulatedPlayerState) {
    return evaluateBoard(this, gameOrState, perspectivePlayer, super.evaluateBoardV2(gameOrState, perspectivePlayer));
  }

  override evaluateBoardV2(gameOrState: MirageboundGame, perspectivePlayer: SimulatedPlayerState) {
    return this.evaluateBoard(gameOrState, perspectivePlayer);
  }

  override simulateMainPhaseAction(state: Parameters<BaseStrategy["simulateMainPhaseAction"]>[0], action: import("../contracts/ai.js").AIPlannedAction) {
    return applyGenericSimulatedMainPhaseAction(state as Parameters<typeof applyGenericSimulatedMainPhaseAction>[0], action as AIAction, this.getPlanningSimulationOptions(state));
  }

  getPlanningSimulationOptions(_state: Parameters<BaseStrategy["simulateMainPhaseAction"]>[0]) {
    return {
      guardLabel: "MirageboundStrategy",
      selfId: "bot",
      archetype: MIRAGEBOUND,
      strategy: this,
      enableSimulatedEvents: true,
      rankSearchCandidates: this.rankSearchCandidates.bind(this),
      getTributeRequirementFor: this.getTributeRequirementFor.bind(this),
      selectBestTributes: this.selectBestTributes.bind(this),
      placeSpellCard: this.placeSpellCard.bind(this),
      chooseSpecialSummonPosition: this.chooseSpecialSummonPosition.bind(this),
      chooseActionCase: this.chooseActionCase.bind(this),
    };
  }

  chooseActionCase<Case extends object>(cases: readonly Case[] = [], context: object = {}) {
    return chooseActionCase<Case>(cases, context);
  }

  rankSearchCandidates(cards: MirageboundCard[] = [], action: MirageboundLineAction = {}, ctx: MirageboundContext = {}) {
    return rankSearchCandidates(this, cards, action, ctx);
  }

  rankByNameOrder(cards: MirageboundCard[] = [], preferredNames: string[] = []) {
    return rankByNameOrder(cards, preferredNames);
  }

  chooseSpecialSummonPosition(card: MirageboundStatCard & {name?:string}, context: {game?:AIState;player?:AIStrategyBotPort;opponent?:AIStrategyBotPort|null;analysis?:MirageboundAnalysis} = {}) {
    return chooseSpecialSummonPosition(this, card, context);
  }

  selectAutomaticAscension<Card extends MirageboundCard | import("../contracts/cards.js").GameCard>(options: {choices?:Array<{ascensionCard:Card;material:Card;position?:import("../contracts/cards.js").BattlePositionInput|undefined}>;bot?:AIStrategyBotPort;game?:AIState;opponent?:AIStrategyBotPort|null} = {}) {
    return selectAutomaticAscension<Card>(this, options);
  }

  shouldUseAutomaticAscensionShortcut() {
    return shouldUseAutomaticAscensionShortcut();
  }

  chooseAutomaticAscensionPosition(options: {ascensionCard?:MirageboundCard | import("../contracts/cards.js").GameCard;bot?:AIStrategyBotPort;opponent?:AIStrategyBotPort|null | undefined;game?:AIState | undefined;material?:MirageboundCard | import("../contracts/cards.js").GameCard} = {}) {
    return chooseAutomaticAscensionPosition(this, options);
  }

  override selectBestTributes(field: MirageboundCard[] = [], tributesNeeded = 0, cardToSummon: MirageboundCard | null = null) {
    return selectBestTributes(field, tributesNeeded, cardToSummon);
  }
}
