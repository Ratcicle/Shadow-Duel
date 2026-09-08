import type { AIAction, AIActivationContext, AIState, AIStrategyBotPort } from "../contracts/ai.js";
import type { SimulatedCardState, SimulatedPlayerState } from "../contracts/aiState.js";
import type { ChainStrategyPort, ChainActivationCandidate, ChainStrategyResponse } from "../contracts/chainRuntime.js";
import type { BloomrotCard, BloomrotAnalysis, BloomrotPlanningGame } from "./bloomrot/analysis.js";
import type { BloomrotDefenseContext } from "./bloomrot/defense.js";
type ExtraDeckInput = NonNullable<Parameters<typeof getBloomrotExtraDeckActions>[0]>;
type BloomrotGame = AIState & NonNullable<ExtraDeckInput["game"]> & BloomrotPlanningGame;
type PlanningContext = NonNullable<Parameters<typeof buildBloomrotPlanningProfile>[1]> & { analysis?: BloomrotAnalysis };
type ActivationContext = ReturnType<typeof buildBloomrotActivationContext>;
type ActivationInput = { sourceCard?: BloomrotCard; effect?: AIActivationContext["effect"]; player?: AIStrategyBotPort; game?: BloomrotGame; activationZone?: AIActivationContext["activationZone"] };
type ChainInput = Partial<Parameters<NonNullable<ChainStrategyPort["chooseChainResponse"]>>[0]>;
type ChainOption = ChainActivationCandidate & { card: BloomrotCard };
type SearchContext = { game?: BloomrotGame; ctx?: { game?: BloomrotGame }; analysis?: BloomrotAnalysis };
import BaseStrategy from "./BaseStrategy.js";
import { buildStrategyAnalysis } from "./common/analysis.js";
import {
  getGenericHandSpellActions,
  getGenericIgnitionEffectActions,
  getGenericNormalSummonActions,
} from "./common/actionGeneration.js";
import { getGenericSetBackrowActions } from "./common/backrowPlanning.js";
import { sequenceActionsByPriority } from "./common/actionSequencing.js";
import { findIgnitionEffect } from "./common/effectDiscovery.js";
import {
  canActivateFieldSpellEffect,
  canActivateMonsterEffect,
  canActivateSpellFromHand,
  canActivateSpellTrapEffect,
} from "./common/previewGuards.js";
import {
  BLOOMROT_NAMES,
  buildBloomrotAnalysis,
  isBloomrot,
  isFaceUpBloomrotMonster,
} from "./bloomrot/analysis.js";
import {
  applyBloomrotSimulatedBattleRewards,
  prepareBloomrotSimulatedBattle,
  scoreBloomrotBattleAttackCandidate,
} from "./bloomrot/battle.js";
import {
  BLOOMROT_DEFENSE_NAMES,
  evaluateSuddenGerminationResponse,
  hasBloomrotDefenseResponseInChain,
} from "./bloomrot/defense.js";
import { getBloomrotExtraDeckActions } from "./bloomrot/extraDeck.js";
import {
  buildBloomrotPlanningProfile,
  describeBloomrotPlannedLine,
  scoreBloomrotLineMilestones,
  scoreBloomrotLineTerminal,
} from "./bloomrot/linePlanning.js";
import {
  buildBloomrotActivationContext,
  shouldActivateBloomrotFieldEffect,
  shouldActivateBloomrotHandIgnition,
  shouldActivateBloomrotMonsterEffect,
  shouldActivateBloomrotSpellTrapEffect,
  shouldPlayBloomrotSpell,
  shouldSetBloomrotBackrow,
  shouldSkipDuplicateBloomrotBackrow,
  shouldSummonBloomrotMonster,
} from "./bloomrot/priorities.js";
import { evaluateBoardBloomrot } from "./bloomrot/scoring.js";
import { rankBloomrotSearchCandidates } from "./bloomrot/targeting.js";

function bloomrotInstanceIds(card: BloomrotCard | null | undefined) {
  return [
    card?.instanceId,
    card?.fieldPresenceId,
    card?.uid,
    card?.uuid,
  ].filter((id) => id !== null && id !== undefined);
}

function removeAttackerFromSuddenGerminationBonusPreference(
  activationContext: ActivationContext,
  context: BloomrotDefenseContext = {},
) {
  const attacker = (context?.attacker?.card || context?.attacker || null) as BloomrotCard | null;
  const attackerIds = new Set(bloomrotInstanceIds(attacker));
  if (attackerIds.size === 0) return;

  const preference =
    activationContext?.actionContext?.targetPreferences
      ?.bloomrot_sudden_germination_bonus_target;
  if (!Array.isArray(preference?.preferredInstanceIds)) return;
  preference.preferredInstanceIds = preference.preferredInstanceIds.filter(
    (id) => !attackerIds.has(id),
  );
}

export default class BloomrotStrategy extends BaseStrategy {
  declare currentAnalysis: ReturnType<typeof buildBloomrotAnalysis> | null;
  declare thoughtProcess: string[];
  constructor(bot: AIStrategyBotPort) {
    super(bot);
    this.currentAnalysis = null;
    this.thoughtProcess = [];
  }

  get archetypeLabel() {
    return "Bloomrot";
  }

  think(thought: string) {
    this.thoughtProcess.push(thought);
    if (this.bot?.debug) {
      console.log(`[Bloomrot AI] ${thought}`);
    }
  }

  analyzeGameState(game: BloomrotGame) {
    this.thoughtProcess = [];
    const actor = (this.bot || game?.bot || null) as AIStrategyBotPort | null;
    const opponent = actor ? this.getOpponent(game, actor) : null;
    const baseAnalysis = buildStrategyAnalysis({
      bot: actor,
      opponent,
      game,
      strategy: this,
    });

    const analysis = buildBloomrotAnalysis({
      bot: actor,
      opponent,
      game,
      strategy: this,
      baseAnalysis,
    });

    this.currentAnalysis = analysis;
    return analysis;
  }

  buildActivationContextForEffect({
    sourceCard,
    effect,
    player,
    game,
    activationZone,
  }: ActivationInput = {}) {
    if (!sourceCard || !player || !game) return null;
    const analysis = this.analyzeGameState(game);
    const zone = activationZone || effect?.activationZones?.[0] || "field";
    return buildBloomrotActivationContext(sourceCard, analysis, {
      zone,
      activationZone: zone,
      sourceZone: zone,
      fromHand: zone === "hand",
      effect,
    });
  }

  buildBloomrotActivationContext(card: BloomrotCard | null | undefined, analysis: BloomrotAnalysis | undefined, options: Parameters<typeof buildBloomrotActivationContext>[2] = {}) {
    return buildBloomrotActivationContext(card, analysis, options);
  }

  getPlanningProfile(game: BloomrotGame, context: PlanningContext = {}) {
    if (!game) return super.getPlanningProfile(game, context);
    const analysis = context.analysis || this.analyzeGameState(game);
    return buildBloomrotPlanningProfile(analysis, {
      ...context,
      game,
      strategy: this,
    });
  }

  shouldUseDeepPlanning(game: BloomrotGame, context: PlanningContext = {}) {
    const profile =
      context.profile || this.getPlanningProfile(game, context) || {};
    return game?.turnLineSearchEnabled === true || profile.enabled === true;
  }

  prepareSimulatedBattle(context: Parameters<typeof prepareBloomrotSimulatedBattle>[0] = {}) {
    return prepareBloomrotSimulatedBattle(context);
  }

  applySimulatedBattleRewards(context: Parameters<typeof applyBloomrotSimulatedBattleRewards>[0] = {}) {
    return applyBloomrotSimulatedBattleRewards(context);
  }

  scoreBattleAttackCandidate(context: Parameters<typeof scoreBloomrotBattleAttackCandidate>[0] = {}) {
    return scoreBloomrotBattleAttackCandidate(context);
  }

  scoreLineMilestones(context: Parameters<typeof scoreBloomrotLineMilestones>[0] = {}) {
    return scoreBloomrotLineMilestones(context);
  }

  scoreLineTerminal(context: Parameters<typeof scoreBloomrotLineTerminal>[0] = {}) {
    return scoreBloomrotLineTerminal(context);
  }

  describePlannedLine(context: Parameters<typeof describeBloomrotPlannedLine>[0] = {}) {
    return describeBloomrotPlannedLine(context);
  }

  chooseSpecialSummonPosition(card: BloomrotCard, _context: object = {}) {
    if (
      card?.name === BLOOMROT_NAMES.TOKEN ||
      (card?.isToken === true && card?.archetype === "Bloomrot")
    ) {
      return "defense";
    }
    return undefined;
  }

  evaluateBoard(gameOrState: AIState, perspectivePlayer: SimulatedPlayerState | undefined) {
    return this.evaluateBoardV2(gameOrState, perspectivePlayer);
  }

  evaluateBoardV2(gameOrState: AIState, perspectivePlayer: SimulatedPlayerState | undefined) {
    const baseScore = super.evaluateBoardV2(gameOrState, perspectivePlayer);
    return evaluateBoardBloomrot(gameOrState, perspectivePlayer, {
      baseScore,
    });
  }

  async chooseChainResponse({
    chainSystem,
    game,
    player,
    activatable = [],
    context = {},
  }: ChainInput = {}): Promise<(ChainStrategyResponse & { priority?: number }) | null> {
    if (!player || !Array.isArray(activatable) || activatable.length === 0) {
      return null;
    }

    const relevant = activatable.filter(
      (option) => option?.card?.name === BLOOMROT_DEFENSE_NAMES.SUDDEN_GERMINATION,
    );
    if (relevant.length === 0) return null;
    if (hasBloomrotDefenseResponseInChain(chainSystem, player)) {
      return {
        pass: true,
        reason: "Bloomrot defense already committed to this chain",
      };
    }

    const resolvedGame = (game || (context as typeof context & { game?: BloomrotGame })?.game || this.currentAnalysis?.game || null) as BloomrotGame | null;
    const analysis: BloomrotAnalysis = resolvedGame
      ? this.analyzeGameState(resolvedGame)
      : this.currentAnalysis || {};
    if (!analysis.player || analysis.player.id !== player.id) {
      analysis.player = player as AIStrategyBotPort;
      analysis.opponent = (context?.opponent || analysis.opponent) as AIStrategyBotPort | null | undefined;
    }

    const evaluated = relevant
      .map((option) => evaluateSuddenGerminationResponse(option as ChainOption, analysis, context as BloomrotDefenseContext))
      .filter((entry): entry is NonNullable<typeof entry> => (entry && entry.pass !== true) as boolean)
      .sort((a, b) => b.score - a.score);

    if (evaluated.length === 0) {
      return { pass: true, reason: "no valuable Bloomrot defense response" };
    }

    const best = evaluated[0];
    const activationContext = this.buildBloomrotActivationContext(
      best.option.card,
      analysis,
      {
        zone: "spellTrap",
        activationZone: "spellTrap",
        sourceZone: "spellTrap",
        effect: best.option.effect as NonNullable<AIActivationContext["effect"]>,
      },
    );
    removeAttackerFromSuddenGerminationBonusPreference(
      activationContext,
      context as BloomrotDefenseContext,
    );

    return {
      ...best.option,
      priority: best.score,
      reason: best.reason,
      activationContext,
      context: {
        ...(best.option.context || context || {}),
        activationContext,
      },
    };
  }

  getSpellActions(game: BloomrotGame, bot: AIStrategyBotPort, analysis: BloomrotAnalysis) {
    return getGenericHandSpellActions({
      game,
      player: bot,
      analysis,
      shouldPlay: shouldPlayBloomrotSpell,
      buildActivationContext: (card, currentAnalysis, context) =>
        buildBloomrotActivationContext(card, currentAnalysis, {
          zone: "hand",
          activationZone: "hand",
          sourceZone: "hand",
          fromHand: true,
          effect: (context as typeof context & { effect?: AIActivationContext["effect"] })?.effect,
        }),
      canActivate: ({ card, player, activationContext }) =>
        canActivateSpellFromHand(game, card, player, activationContext, {
          bot: this.bot,
          debugLabel: "BloomrotStrategy",
        }),
    });
  }

  getSetSpellTrapActions(game: BloomrotGame, bot: AIStrategyBotPort, analysis: BloomrotAnalysis) {
    return getGenericSetBackrowActions({
      game,
      player: bot,
      analysis,
      opponent: analysis.opponent,
      policy: {
        acceptsCard: (card) =>
          card?.name === "Bloomrot Sudden Germination" ||
          card?.name === "Bloomrot Rotting Ground",
        shouldSet: (card) => shouldSetBloomrotBackrow(card, analysis),
        skipIfAlreadySet: (card) =>
          shouldSkipDuplicateBloomrotBackrow(card, analysis),
        getPriority: (_card, context) => context.setDecision?.priority,
        getReason: (_card, context) => context.setDecision?.reason,
      },
    });
  }

  getSummonActions(_game: BloomrotGame, bot: AIStrategyBotPort, analysis: BloomrotAnalysis) {
    return getGenericNormalSummonActions({
      player: bot,
      analysis,
      getTributeRequirement: (card, player) =>
        this.getTributeRequirementFor(card as SimulatedCardState, player as SimulatedPlayerState),
      shouldSummon: shouldSummonBloomrotMonster,
    });
  }

  getHandIgnitionActions(game: BloomrotGame, bot: AIStrategyBotPort, analysis: BloomrotAnalysis) {
    return getGenericIgnitionEffectActions({
      game,
      player: bot,
      cards: bot.hand,
      analysis,
      type: "handIgnition",
      sourceZone: "hand",
      indexFields: ["index"],
      findEffect: (card) => findIgnitionEffect(card, "hand"),
      shouldActivate: shouldActivateBloomrotHandIgnition,
      buildActivationContext: (card, currentAnalysis, context) =>
        buildBloomrotActivationContext(card, currentAnalysis, {
          zone: "hand",
          activationZone: "hand",
          sourceZone: "hand",
          fromHand: true,
          effect: context?.effect,
        }),
      canActivate: ({ card, player, activationContext }) =>
        canActivateMonsterEffect(game, card, player, "hand", activationContext, {
          bot: this.bot,
          debugLabel: "BloomrotStrategy",
        }),
      cardFilter: (card) => card?.cardKind === "monster" && isBloomrot(card),
      includeEffectId: true,
    });
  }

  getFieldEffectActions(game: BloomrotGame, bot: AIStrategyBotPort, analysis: BloomrotAnalysis) {
    if (!bot.fieldSpell) return [];
    return getGenericIgnitionEffectActions({
      game,
      player: bot,
      cards: [bot.fieldSpell],
      analysis,
      type: "fieldEffect",
      sourceZone: "fieldSpell",
      indexFields: [],
      findEffect: (card) => findIgnitionEffect(card, "fieldSpell"),
      shouldActivate: shouldActivateBloomrotFieldEffect,
      buildActivationContext: (card, currentAnalysis, context) =>
        buildBloomrotActivationContext(card, currentAnalysis, {
          zone: "fieldSpell",
          activationZone: "fieldSpell",
          sourceZone: "fieldSpell",
          effect: context?.effect,
        }),
      canActivate: ({ card, player, activationContext }) =>
        canActivateFieldSpellEffect(game, card, player, activationContext, {
          bot: this.bot,
          debugLabel: "BloomrotStrategy",
        }),
      includeEffectId: true,
    });
  }

  getSpellTrapEffectActions(game: BloomrotGame, bot: AIStrategyBotPort, analysis: BloomrotAnalysis) {
    return getGenericIgnitionEffectActions({
      game,
      player: bot,
      cards: bot.spellTrap,
      analysis,
      type: "spellTrapEffect",
      sourceZone: "spellTrap",
      indexFields: ["index", "zoneIndex"],
      findEffect: (card) => findIgnitionEffect(card, "spellTrap"),
      shouldActivate: shouldActivateBloomrotSpellTrapEffect,
      buildActivationContext: (card, currentAnalysis, context) =>
        buildBloomrotActivationContext(card, currentAnalysis, {
          zone: "spellTrap",
          activationZone: "spellTrap",
          sourceZone: "spellTrap",
          effect: context?.effect,
        }),
      canActivate: ({ card, player, activationContext }) =>
        canActivateSpellTrapEffect(
          game,
          card,
          player,
          "spellTrap",
          activationContext,
          {
            bot: this.bot,
            debugLabel: "BloomrotStrategy",
          },
        ),
      includeEffectId: true,
    });
  }

  getMonsterEffectActions(game: BloomrotGame, bot: AIStrategyBotPort, analysis: BloomrotAnalysis) {
    return getGenericIgnitionEffectActions({
      game,
      player: bot,
      cards: bot.field,
      analysis,
      type: "monsterEffect",
      sourceZone: "field",
      indexFields: ["fieldIndex"],
      findEffect: (card) => findIgnitionEffect(card, "field"),
      shouldActivate: shouldActivateBloomrotMonsterEffect,
      buildActivationContext: (card, currentAnalysis, context) =>
        buildBloomrotActivationContext(card, currentAnalysis, {
          zone: "field",
          activationZone: "field",
          sourceZone: "field",
          effect: context?.effect,
        }),
      canActivate: ({ card, player, activationContext }) =>
        canActivateMonsterEffect(game, card, player, "field", activationContext, {
          bot: this.bot,
          debugLabel: "BloomrotStrategy",
        }),
      cardFilter: isFaceUpBloomrotMonster,
      includeEffectId: true,
    });
  }

  getExtraDeckActions(game: BloomrotGame, bot: AIStrategyBotPort, analysis: BloomrotAnalysis) {
    return getBloomrotExtraDeckActions({
      game,
      bot,
      analysis,
      strategy: this,
    });
  }

  generateMainPhaseActions(game: BloomrotGame) {
    const analysis = this.analyzeGameState(game);
    const bot = analysis.player;
    if (!bot) return [];

    const actions = [
      ...this.getSpellActions(game, bot, analysis),
      ...this.getHandIgnitionActions(game, bot, analysis),
      ...this.getFieldEffectActions(game, bot, analysis),
      ...this.getSpellTrapEffectActions(game, bot, analysis),
      ...this.getMonsterEffectActions(game, bot, analysis),
      ...this.getExtraDeckActions(game, bot, analysis),
      ...this.getSummonActions(game, bot, analysis),
      ...this.getSetSpellTrapActions(game, bot, analysis),
    ];

    const sequenced = this.sequenceActions(actions);
    return this.integrateP2IntoActionSelection(game, sequenced, analysis);
  }

  sequenceActions(actions: AIAction[] = []) {
    return sequenceActionsByPriority(actions, {
      typeOrder: {
        spell: 0,
        handIgnition: 1,
        fieldEffect: 2,
        spellTrapEffect: 3,
        monsterEffect: 4,
        ascension: 5,
        summon: 6,
        set_spell_trap: 7,
      },
    });
  }

  rankSearchCandidates(cards: SimulatedCardState[] = [], action: { zone?: string } = {}, ctx: SearchContext = {}) {
    const game = ctx.game || ctx.ctx?.game || null;
    const analysis = game ? this.analyzeGameState(game) : this.currentAnalysis || {};
    return rankBloomrotSearchCandidates(cards, action, {
      ...ctx,
      analysis,
    });
  }
}
