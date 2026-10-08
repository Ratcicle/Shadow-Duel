import type { AIAction, AIPlanningContext, AIPlanningProfile, AIState, AIStrategyBotPort, AIActivationContext } from "../contracts/ai.js";
import type { AiStateShape, SimulatedCardState, SimulatedPlayerState } from "../contracts/aiState.js";
import type { GameCard } from "../contracts/cards.js";

type StrategyCard = GameCard | SimulatedCardState;
type Analysis = Omit<ReturnType<typeof buildStrategyAnalysis>, "player"> & {
  player: AIStrategyBotPort; fieldCapacity: number; canNormalSummon: boolean;
  faceUpArcanists: StrategyCard[]; equippedArcanists: StrategyCard[];
  arcanistEquipCount: number; hasArcanistEquip: boolean; validGrimoireHosts: StrategyCard[];
  grimoireStoredCount: number; inkRiverCounters: number; arcanistSpellsInGY: number;
  oppStrongestAtk: number; oppStrongestBattle: number;
  availableCombos: ReturnType<typeof detectAvailableCombos>;
};
type Preference = { preferredInstanceIds?: Array<string | number | null>; avoidInstanceIds?: Array<string | number | null>; preferredNames?: string[]; avoidNames?: string[] };
type TargetPreferences = Record<string, Preference>;
type SearchAction = { type?: string; zone?: string; cardKind?: string; archetype?: string; source?: StrategyCard; targetRef?: string; filters?: { cardKind?: string; archetype?: string } };
type SearchContext = { game?: AIState | null; ctx?: { game?: AIState }; player?: AIStrategyBotPort; source?: StrategyCard; action?: AIAction; analysis?: Partial<Analysis> | null; activationContext?: AIActivationContext | undefined };
type TributeContext = { evaluationContext?: Partial<Analysis>; botState?: AIStrategyBotPort; oppField?: StrategyCard[] };
type ChoiceCase = { id?: string; label?: string; description?: string };
type ChoiceContext = { source?: StrategyCard; activationContext?: AIActivationContext; state?: AiStateShape };

import BaseStrategy from "./BaseStrategy.js";
import { sequenceActionsByPriority } from "./common/actionSequencing.js";
import {
  getGenericHandSpellActions,
  getGenericIgnitionEffectActions,
  getGenericNormalSummonActions,
  getGenericCostlessHandSummonActions,
} from "./common/actionGeneration.js";
import { getGenericSetBackrowActions } from "./common/backrowPlanning.js";
import { buildStrategyAnalysis } from "./common/analysis.js";
import { findIgnitionEffect } from "./common/effectDiscovery.js";
import { canUsePreview as canUsePreviewGuard } from "./common/previewGuards.js";
import {
  getStrongestAttackThreat,
  getStrongestBattleThreat,
} from "./common/cardStats.js";
import { prepareSimulatedEffectActivation } from "./common/simulation.js";
import {
  ARCANIST_NAMES,
  CARD_KNOWLEDGE,
  controlsArcanistEquip,
  getInkCounters,
  getStoredBlueprintCount,
  hasArcanistEquip,
  isArcanist,
  isArcanistMonster,
  isArcanistSpell,
} from "./arcanist/knowledge.js";
import { COMBO_DATABASE, detectAvailableCombos } from "./arcanist/combos.js";
import {
  buildArcanistPlanningProfile,
  describeArcanistPlannedLine,
  scoreArcanistLineMilestones,
  scoreArcanistLineTerminal,
} from "./arcanist/linePlanning.js";
import {
  buildArcanistActivationContext,
  evaluateRecruitCandidate as evaluateArcanistRecruitCandidate,
  getTributeRequirementFor as getArcanistTributeRequirementFor,
  rankSearchCandidates as rankArcanistSearchCandidates,
  selectBestTributes as selectBestArcanistTributes,
  shouldActivateHandIgnition,
  shouldActivateMonsterEffect,
  shouldActivateSpellTrapEffect,
  shouldPlaySpell,
  shouldSummonMonster,
} from "./arcanist/priorities.js";
import { evaluateBoardArcanist } from "./arcanist/scoring.js";

import * as arcanistSimulation from "./arcanist/simulation.js";
import { isSimulatedState } from "./arcanist/simulation.js";
export default class ArcanistStrategy extends BaseStrategy {
  declare cardKnowledge: typeof CARD_KNOWLEDGE;
  declare knownCombos: typeof COMBO_DATABASE;
  declare currentAnalysis: Analysis | null;
  declare thoughtProcess: string[];

  constructor(bot: AIStrategyBotPort) {
    super(bot);
    this.cardKnowledge = CARD_KNOWLEDGE;
    this.knownCombos = COMBO_DATABASE;
    this.currentAnalysis = null;
    this.thoughtProcess = [];
  }

  override get archetypeLabel() {
    return "Arcanist";
  }

  override think(thought: string) {
    this.thoughtProcess.push(thought);
    if (this.bot?.debug) {
      console.log(`[Arcanist AI] ${thought}`);
    }
  }

  override getPlanningProfile(game: AIState, context: AIPlanningContext & { analysis?: Analysis } = {}): AIPlanningProfile {
    if (!game) return super.getPlanningProfile(game, context);
    const analysis = context.analysis || this.analyzeGameState(game);
    return buildArcanistPlanningProfile(analysis as Parameters<typeof buildArcanistPlanningProfile>[0], {
      ...context,
      game: game as AiStateShape,
    } as Parameters<typeof buildArcanistPlanningProfile>[1]);
  }

  override shouldUseDeepPlanning(game: AIState, context: AIPlanningContext = {}) {
    const profile =
      context.profile || this.getPlanningProfile(game, context) || {};
    return (game as AIState & { turnLineSearchEnabled?: boolean })?.turnLineSearchEnabled === true || profile.enabled === true;
  }

  override scoreLineMilestones(context: AIPlanningContext = {}) {
    return scoreArcanistLineMilestones(context as Parameters<typeof scoreArcanistLineMilestones>[0]);
  }

  override scoreLineTerminal(context: AIPlanningContext = {}) {
    return scoreArcanistLineTerminal(context as Parameters<typeof scoreArcanistLineTerminal>[0]);
  }

  override describePlannedLine(context: AIPlanningContext = {}) {
    return describeArcanistPlannedLine(context as Parameters<typeof describeArcanistPlannedLine>[0]);
  }

  analyzeGameState(game: AIState): Analysis {
    this.thoughtProcess = [];

    const simulated = isSimulatedState(game);
    const actor = (simulated ? game.bot : this.bot || game.bot) as AIStrategyBotPort;
    const opponent = this.getOpponent(game, actor);
    const base = buildStrategyAnalysis({
      bot: actor,
      opponent,
      game,
      strategy: this,
    });

    const faceUpArcanists = (base.field || []).filter(
      (card) => isArcanistMonster(card) && !card.isFacedown,
    );
    const equippedArcanists = faceUpArcanists.filter(hasArcanistEquip);
    const arcanistSpellsInGY = (base.graveyard || []).filter(isArcanistSpell);
    const inkRivers = (base.spellTrap || []).filter(
      (card) => card?.name === ARCANIST_NAMES.INK_RIVER && !card.isFacedown,
    );
    const grimoireCards = (base.spellTrap || []).filter(
      (card) => card?.name === ARCANIST_NAMES.GRIMOIRE && !card.isFacedown,
    );

    const analysis = {
      ...base,
      player: actor,
      opponent,
      fieldCapacity: Math.max(0, 5 - (base.field || []).length),
      canNormalSummon: base.summonAvailable,
      faceUpArcanists,
      equippedArcanists,
      arcanistEquipCount: (base.spellTrap || []).filter(
        (card) => !card.isFacedown && card.subtype === "equip" && isArcanist(card),
      ).length,
      hasArcanistEquip: controlsArcanistEquip(actor),
      validGrimoireHosts: faceUpArcanists.filter(
        (card) => !hasArcanistEquip(card),
      ),
      grimoireStoredCount: grimoireCards.reduce(
        (sum, card) => sum + getStoredBlueprintCount(card),
        0,
      ),
      inkRiverCounters: inkRivers.reduce(
        (sum, card) => sum + getInkCounters(card),
        0,
      ),
      arcanistSpellsInGY: arcanistSpellsInGY.length,
      oppStrongestAtk: getStrongestAttackThreat(base.oppField || [], {
        includeBoosts: true,
      }),
      oppStrongestBattle: getStrongestBattleThreat(base.oppField || [], {
        includeBoosts: true,
      }),
      availableCombos: [] as ReturnType<typeof detectAvailableCombos>,
    };

    analysis.availableCombos = detectAvailableCombos(analysis);
    this.currentAnalysis = analysis;
    return analysis;
  }

  override evaluateBoard(gameOrState: AIState, perspectivePlayer?: SimulatedPlayerState): number {
    return evaluateBoardArcanist(
      gameOrState,
      perspectivePlayer,
      this.getOpponent.bind(this),
    );
  }

  override evaluateBoardV2(gameOrState: AIState, perspectivePlayer?: SimulatedPlayerState): number {
    return this.evaluateBoard(gameOrState, perspectivePlayer);
  }

  buildActivationContextForEffect({ sourceCard, player, game }: { sourceCard?: StrategyCard; player?: AIStrategyBotPort; game?: AIState } = {}) {
    if (!sourceCard || !player || !game) return null;
    const analysis = this.analyzeGameState(game);
    return this.buildActivationContext(sourceCard, analysis);
  }

  buildActivationContext(card: StrategyCard, analysis: Analysis): AIActivationContext {
    const activationContext = buildArcanistActivationContext(card, analysis);
    const effect = card.effects?.find(candidate => candidate.activationCases?.length);
    if (!effect || !analysis.game || !analysis.opponent) return activationContext;
    // Only the actor's public simulation projection is consulted. The mode is
    // carried by stable ID so runtime cannot reinterpret translated labels.
    const state = { ...analysis.game, bot: analysis.player, player: analysis.opponent } as Parameters<typeof prepareSimulatedEffectActivation>[0];
    const prepared = prepareSimulatedEffectActivation(state, card as SimulatedCardState, effect, {
      activationContext,
      chooseActionCase: (cases, context) => this.chooseActionCase(cases, context),
    });
    const caseId = prepared?.effect.activationCaseId;
    return caseId ? { ...activationContext, decisions: { cases: { [effect.id]: caseId } } } : activationContext;
  }

  canUsePreview(game: AIState, previewFn: Parameters<typeof canUsePreviewGuard>[1]) {
    return canUsePreviewGuard(game, previewFn, {
      bot: this.bot,
      debugLabel: "ArcanistStrategy",
    });
  }

  getSpellActions(game: AIState, bot: AIStrategyBotPort, analysis: Analysis): AIAction[] {
    return getGenericHandSpellActions({
      game,
      player: bot,
      analysis,
      shouldPlay: shouldPlaySpell,
      buildActivationContext: buildArcanistActivationContext,
      canActivate: ({ card, player, activationContext }) =>
        this.canUsePreview(game, (actualGame) =>
          actualGame.effectEngine!.canActivateSpellFromHandPreview!(card, player, {
            activationContext,
          }),
        ),
    });
  }

  getSetSpellTrapActions(game: AIState, bot: AIStrategyBotPort, analysis?: Analysis): ReturnType<typeof getGenericSetBackrowActions>;
  getSetSpellTrapActions(game: AIState, bot: AIStrategyBotPort) {
    return getGenericSetBackrowActions({ game, player: bot });
  }

  getSummonActions(game: AIState, bot: AIStrategyBotPort, analysis: Analysis): AIAction[] {
    return getGenericNormalSummonActions<Analysis>({
      player: bot,
      analysis,
      getTributeRequirement: (card, player) =>
        this.getTributeRequirementFor(card, player),
      shouldSummon: shouldSummonMonster,
    });
  }

  getHandIgnitionActions(game: AIState, bot: AIStrategyBotPort, analysis: Analysis): AIAction[] {
    return getGenericIgnitionEffectActions({
      game,
      player: bot,
      cards: bot.hand,
      analysis,
      type: "handIgnition",
      sourceZone: "hand",
      indexFields: ["index"],
      findEffect: (card) => findIgnitionEffect(card, "hand"),
      shouldActivate: shouldActivateHandIgnition,
      buildActivationContext: buildArcanistActivationContext,
      canActivate: ({ card, player, activationContext }) =>
        this.canUsePreview(game, (actualGame) =>
          actualGame.effectEngine!.canActivateMonsterEffectPreview!(
            card,
            player,
            "hand",
            null,
            { activationContext },
          ),
        ),
      cardFilter: (card) => card?.cardKind === "monster",
      includeEffectId: true,
    });
  }

  getFieldEffectActions(game: AIState, bot: AIStrategyBotPort, analysis: Analysis): AIAction[] {
    const card = bot.fieldSpell;
    if (!card || card.name !== ARCANIST_NAMES.GRAND_LIBRARY) return [];

    const hasMonster = analysis.faceUpArcanists.length > 0;
    const canPayStarter = !hasMonster && (bot.lp || 0) > 2200;
    if (!hasMonster && !canPayStarter) return [];
    if (hasMonster) {
      const hasActiveGrimoire = (bot.spellTrap || []).some(
        (spell) =>
          spell?.name === ARCANIST_NAMES.GRIMOIRE && !spell.isFacedown,
      );
      const hasDeckGrimoire = (bot.deck || []).some(
        (candidate) => candidate?.name === ARCANIST_NAMES.GRIMOIRE,
      );
      if (hasActiveGrimoire || !hasDeckGrimoire) return [];
    }

    const activationContext = this.buildActivationContext(card, analysis);
    const effect = findIgnitionEffect(card, "fieldSpell");
    if (effect?.activationCases?.length && !activationContext.decisions?.cases?.[effect.id]) return [];
    const canActivate = this.canUsePreview(game, (actualGame) =>
      actualGame.effectEngine!.canActivateFieldSpellEffectPreview!(
        card,
        bot,
        null,
        { activationContext },
      ),
    );
    if (!canActivate) return [];

    return [
      {
        type: "fieldEffect",
        cardId: card.id,
        cardName: card.name,
        priority: hasMonster ? 12 : 13,
        reason: hasMonster ? "search Grimoire" : "recruit Arcanist starter",
        activationContext,
      },
    ];
  }

  getSpellTrapEffectActions(game: AIState, bot: AIStrategyBotPort, analysis: Analysis): AIAction[] {
    return getGenericIgnitionEffectActions({
      game,
      player: bot,
      cards: bot.spellTrap,
      analysis,
      type: "spellTrapEffect",
      sourceZone: "spellTrap",
      indexFields: ["index", "zoneIndex"],
      cardFilter: card => card.cardKind === "spell" && (!card.isFacedown ||
        (card.setTurn ?? card.turnSetOn ?? Number.POSITIVE_INFINITY) < (game.turnCounter ?? 0)),
      findEffect: card => card.isFacedown
        ? card.effects?.find(effect => effect.timing === "on_play") || null
        : findIgnitionEffect(card, "spellTrap"),
      shouldActivate: (card, currentAnalysis) => card.isFacedown
        ? shouldPlaySpell(card, currentAnalysis)
        : shouldActivateSpellTrapEffect(card, currentAnalysis),
      buildActivationContext: (card, _currentAnalysis, { effect }) => ({
        ...this.buildActivationContext(card, analysis), effectId: effect.id,
      }),
      includeEffectId: true,
      canActivate: ({ card, player, effect, activationContext }) =>
        (!effect.activationCases?.length || !!activationContext?.decisions?.cases?.[effect.id]) && this.canUsePreview(game, (actualGame) =>
          actualGame.effectEngine!.canActivateSpellTrapEffectPreview!(
            card,
            player,
            "spellTrap",
            null,
            { activationContext },
          ),
        ),
    });
  }

  getMonsterEffectActions(game: AIState, bot: AIStrategyBotPort, analysis: Analysis): AIAction[] {
    return getGenericIgnitionEffectActions({
      game,
      player: bot,
      cards: bot.field,
      analysis,
      type: "monsterEffect",
      sourceZone: "field",
      indexFields: ["fieldIndex"],
      findEffect: (card) => findIgnitionEffect(card, "field"),
      shouldActivate: shouldActivateMonsterEffect,
      buildActivationContext: buildArcanistActivationContext,
      canActivate: ({ card, player, activationContext }) =>
        this.canUsePreview(game, (actualGame) =>
          actualGame.effectEngine!.canActivateMonsterEffectPreview!(
            card,
            player,
            "field",
            null,
            { activationContext },
          ),
        ),
    });
  }

  override generateMainPhaseActions(game: AIState): AIAction[] {
    const analysis = this.analyzeGameState(game);
    const bot = analysis.player;
    const actions = [
      ...getGenericCostlessHandSummonActions(game).map(action => ({ ...action, priority: 10, reason: "free Arcanist body from hand" })),
      ...this.getHandIgnitionActions(game, bot, analysis),
      ...this.getFieldEffectActions(game, bot, analysis),
      ...this.getSpellTrapEffectActions(game, bot, analysis),
      ...this.getMonsterEffectActions(game, bot, analysis),
      ...this.getSpellActions(game, bot, analysis),
      ...this.getSummonActions(game, bot, analysis),
      ...this.getSetSpellTrapActions(game, bot, analysis),
    ];

    if (bot?.debug) {
      this.think(
        `Generated ${actions.length} Arcanist actions: ${actions
          .map((action) => `${action.type}:${action.cardName || action.cardId}`)
          .join(", ")}`,
      );
    }

    return this.integrateP2IntoActionSelection(
      game,
      this.sequenceActions(actions),
      analysis,
    );
  }

  override sequenceActions(actions: AIAction[] = []) {
    const typeOrder = {
      handSummonProcedure: 0,
      handIgnition: 0,
      fieldEffect: 1,
      spellTrapEffect: 2,
      monsterEffect: 3,
      spell: 4,
      summon: 5,
      set_spell_trap: 6,
    };

    return sequenceActionsByPriority(actions, {
      typeOrder,
    });
  }

  override getTributeRequirementFor(card: StrategyCard, playerState: AIStrategyBotPort) {
    return getArcanistTributeRequirementFor(card, playerState);
  }

  override selectBestTributes(field: SimulatedCardState[], tributesNeeded: number, cardToSummon: SimulatedCardState, context: TributeContext = {}) {
    const analysis =
      context.evaluationContext ||
      this.currentAnalysis || {
        field: context.botState?.field || field || [],
        oppField: context.oppField || [],
      };
    return selectBestArcanistTributes(field, tributesNeeded, cardToSummon, {
      ...context,
      evaluationContext: analysis,
    });
  }

  rankSearchCandidates<Card extends StrategyCard>(cards: Card[], action: SearchAction = {}, ctx: SearchContext = {}) {
    const game = ctx.game || ctx.ctx?.game || null;
    const analysis = game ? this.analyzeGameState(game) : this.currentAnalysis;
    return rankArcanistSearchCandidates(cards, action, {
      ...ctx,
      analysis: analysis!,
    });
  }

  evaluateRecruitCandidate<Card extends StrategyCard>(candidates: Card[], context: SearchContext = {}) {
    const analysis = context.game
      ? this.analyzeGameState(context.game)
      : this.currentAnalysis;
    return evaluateArcanistRecruitCandidate(candidates, {
      ...context,
      analysis: analysis!,
    });
  }

  chooseSpecialSummonPosition(card: StrategyCard, context: SearchContext = {}) {
    const game = context.game;
    const opponent = game ? this.getOpponent(game, context.player || this.bot) : null;
    const strongest = getStrongestBattleThreat(opponent?.field || [], {
      includeBoosts: true,
    });

    if (card?.name === ARCANIST_NAMES.TERA && strongest >= 1500) {
      return "defense";
    }
    if ((card?.def || 0) > (card?.atk || 0) + 300 && strongest > (card?.atk || 0)) {
      return "defense";
    }
    return "attack";
  }

  chooseActionCase<Case extends ChoiceCase>(cases: readonly Case[] = [], context: ChoiceContext = {}) {
    if (!Array.isArray(cases) || cases.length === 0) return null;
    const source = context.source;
    const preferences =
      (context.activationContext?.actionContext as { targetPreferences?: TargetPreferences } | undefined)?.targetPreferences ||
      (context.activationContext?.targetPreferences as TargetPreferences | undefined) ||
      {};
    const preferredLabels = preferences.action_case_choice?.preferredNames || [];
    const labelMatch = cases.find((choiceCase) =>
      preferredLabels.some(
        (label) =>
          choiceCase?.label === label ||
          choiceCase?.id === label ||
          choiceCase?.description?.includes?.(label),
      ),
    );
    if (labelMatch) return labelMatch;

    if (source?.name === ARCANIST_NAMES.MEETING) {
      const hand = context.state?.bot?.hand || [];
      const monsters = hand.filter(isArcanistMonster).length;
      const spells = hand.filter(isArcanistSpell).length;
      const hasUsefulMonster = (context.state?.bot?.deck || []).some(
        (card) => isArcanistMonster(card) && (card.level || 0) <= 4,
      );
      const hasUsefulSpell = (context.state?.bot?.deck || []).some(isArcanistSpell);
      const discardSpells = cases.find((entry) =>
        entry?.id?.includes?.("discard_spells"),
      );
      const discardMonsters = cases.find((entry) =>
        entry?.id?.includes?.("discard_monsters"),
      );
      if ((context.state?.bot?.field || []).length === 0 && spells >= 2 && hasUsefulMonster) {
        return discardSpells || cases[0];
      }
      if (monsters >= 2 && hasUsefulSpell) return discardMonsters || cases[0];
      if (spells >= 2 && hasUsefulMonster) return discardSpells || cases[0];
    }

    return cases[0];
  }

  override simulateMainPhaseAction(...args: Parameters<typeof arcanistSimulation.simulateMainPhaseAction>): ReturnType<typeof arcanistSimulation.simulateMainPhaseAction> {
    return arcanistSimulation.simulateMainPhaseAction.apply(this, args);
  }

  getPlanningSimulationOptions(...args: Parameters<typeof arcanistSimulation.getPlanningSimulationOptions>): ReturnType<typeof arcanistSimulation.getPlanningSimulationOptions> {
    return arcanistSimulation.getPlanningSimulationOptions.apply(this, args);
  }

  simulateArcanistAfterSummon(...args: Parameters<typeof arcanistSimulation.simulateArcanistAfterSummon>): ReturnType<typeof arcanistSimulation.simulateArcanistAfterSummon> {
    return arcanistSimulation.simulateArcanistAfterSummon.apply(this, args);
  }

  simulateMasterOfMirrorsNormalSummon(...args: Parameters<typeof arcanistSimulation.simulateMasterOfMirrorsNormalSummon>): ReturnType<typeof arcanistSimulation.simulateMasterOfMirrorsNormalSummon> {
    return arcanistSimulation.simulateMasterOfMirrorsNormalSummon.apply(this, args);
  }

  applyArcanistSimulationPostProcess(...args: Parameters<typeof arcanistSimulation.applyArcanistSimulationPostProcess>): ReturnType<typeof arcanistSimulation.applyArcanistSimulationPostProcess> {
    return arcanistSimulation.applyArcanistSimulationPostProcess.apply(this, args);
  }

  resolveSimulatedActionSource(...args: Parameters<typeof arcanistSimulation.resolveSimulatedActionSource>): ReturnType<typeof arcanistSimulation.resolveSimulatedActionSource> {
    return arcanistSimulation.resolveSimulatedActionSource.apply(this, args);
  }

  shouldCountSimulatedInkCounter(...args: Parameters<typeof arcanistSimulation.shouldCountSimulatedInkCounter>): ReturnType<typeof arcanistSimulation.shouldCountSimulatedInkCounter> {
    return arcanistSimulation.shouldCountSimulatedInkCounter.apply(this, args);
  }

  shouldCountSimulatedArcanistSpellActivation(...args: Parameters<typeof arcanistSimulation.shouldCountSimulatedArcanistSpellActivation>): ReturnType<typeof arcanistSimulation.shouldCountSimulatedArcanistSpellActivation> {
    return arcanistSimulation.shouldCountSimulatedArcanistSpellActivation.apply(this, args);
  }

  applySimulatedLightningLance(...args: Parameters<typeof arcanistSimulation.applySimulatedLightningLance>): ReturnType<typeof arcanistSimulation.applySimulatedLightningLance> {
    return arcanistSimulation.applySimulatedLightningLance.apply(this, args);
  }

  simulateArcanistBlueprintStorage(...args: Parameters<typeof arcanistSimulation.simulateArcanistBlueprintStorage>): ReturnType<typeof arcanistSimulation.simulateArcanistBlueprintStorage> {
    return arcanistSimulation.simulateArcanistBlueprintStorage.apply(this, args);
  }

  simulateArcanistOnEquipTriggers(...args: Parameters<typeof arcanistSimulation.simulateArcanistOnEquipTriggers>): ReturnType<typeof arcanistSimulation.simulateArcanistOnEquipTriggers> {
    return arcanistSimulation.simulateArcanistOnEquipTriggers.apply(this, args);
  }

  applySimulatedArcanistPassiveStats(...args: Parameters<typeof arcanistSimulation.applySimulatedArcanistPassiveStats>): ReturnType<typeof arcanistSimulation.applySimulatedArcanistPassiveStats> {
    return arcanistSimulation.applySimulatedArcanistPassiveStats.apply(this, args);
  }

  simulateArcanistSpell(...args: Parameters<typeof arcanistSimulation.simulateArcanistSpell>): ReturnType<typeof arcanistSimulation.simulateArcanistSpell> {
    return arcanistSimulation.simulateArcanistSpell.apply(this, args);
  }

}
