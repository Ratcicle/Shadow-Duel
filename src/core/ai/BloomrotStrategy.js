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

function bloomrotInstanceIds(card) {
  return [
    card?.instanceId,
    card?.fieldPresenceId,
    card?.uid,
    card?.uuid,
  ].filter((id) => id !== null && id !== undefined);
}

function removeAttackerFromSuddenGerminationBonusPreference(
  activationContext,
  context = {},
) {
  const attacker = context?.attacker?.card || context?.attacker || null;
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
  constructor(bot) {
    super(bot);
    this.currentAnalysis = null;
    this.thoughtProcess = [];
  }

  get archetypeLabel() {
    return "Bloomrot";
  }

  think(thought) {
    this.thoughtProcess.push(thought);
    if (this.bot?.debug) {
      console.log(`[Bloomrot AI] ${thought}`);
    }
  }

  analyzeGameState(game) {
    this.thoughtProcess = [];
    const actor = this.bot || game?.bot || null;
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
  } = {}) {
    if (!sourceCard || !player || !game) return null;
    const analysis = this.analyzeGameState(game);
    const zone = activationZone || effect?.requireZone || "field";
    return buildBloomrotActivationContext(sourceCard, analysis, {
      zone,
      activationZone: zone,
      sourceZone: zone,
      fromHand: zone === "hand",
      effect,
    });
  }

  buildBloomrotActivationContext(card, analysis, options = {}) {
    return buildBloomrotActivationContext(card, analysis, options);
  }

  getPlanningProfile(game, context = {}) {
    if (!game) return super.getPlanningProfile(game, context);
    const analysis = context.analysis || this.analyzeGameState(game);
    return buildBloomrotPlanningProfile(analysis, {
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

  prepareSimulatedBattle(context = {}) {
    return prepareBloomrotSimulatedBattle(context);
  }

  applySimulatedBattleRewards(context = {}) {
    return applyBloomrotSimulatedBattleRewards(context);
  }

  scoreBattleAttackCandidate(context = {}) {
    return scoreBloomrotBattleAttackCandidate(context);
  }

  scoreLineMilestones(context = {}) {
    return scoreBloomrotLineMilestones(context);
  }

  scoreLineTerminal(context = {}) {
    return scoreBloomrotLineTerminal(context);
  }

  describePlannedLine(context = {}) {
    return describeBloomrotPlannedLine(context);
  }

  chooseSpecialSummonPosition(card, _context = {}) {
    if (
      card?.name === BLOOMROT_NAMES.TOKEN ||
      (card?.isToken === true && card?.archetype === "Bloomrot")
    ) {
      return "defense";
    }
    return undefined;
  }

  evaluateBoard(gameOrState, perspectivePlayer) {
    return this.evaluateBoardV2(gameOrState, perspectivePlayer);
  }

  evaluateBoardV2(gameOrState, perspectivePlayer) {
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
  } = {}) {
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

    const resolvedGame = game || context?.game || this.currentAnalysis?.game || null;
    const analysis = resolvedGame
      ? this.analyzeGameState(resolvedGame)
      : this.currentAnalysis || {};
    if (!analysis.player || analysis.player.id !== player.id) {
      analysis.player = player;
      analysis.opponent = context?.opponent || analysis.opponent;
    }

    const evaluated = relevant
      .map((option) => evaluateSuddenGerminationResponse(option, analysis, context))
      .filter((entry) => entry && entry.pass !== true)
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
        effect: best.option.effect,
      },
    );
    removeAttackerFromSuddenGerminationBonusPreference(
      activationContext,
      context,
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

  getSpellActions(game, bot, analysis) {
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
          effect: context?.effect,
        }),
      canActivate: ({ card, player, activationContext }) =>
        canActivateSpellFromHand(game, card, player, activationContext, {
          bot: this.bot,
          debugLabel: "BloomrotStrategy",
        }),
    });
  }

  getSetSpellTrapActions(game, bot, analysis) {
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

  getSummonActions(_game, bot, analysis) {
    return getGenericNormalSummonActions({
      player: bot,
      analysis,
      getTributeRequirement: (card, player) =>
        this.getTributeRequirementFor(card, player),
      shouldSummon: shouldSummonBloomrotMonster,
    });
  }

  getHandIgnitionActions(game, bot, analysis) {
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

  getFieldEffectActions(game, bot, analysis) {
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

  getSpellTrapEffectActions(game, bot, analysis) {
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

  getMonsterEffectActions(game, bot, analysis) {
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

  getExtraDeckActions(game, bot, analysis) {
    return getBloomrotExtraDeckActions({
      game,
      bot,
      analysis,
      strategy: this,
    });
  }

  generateMainPhaseActions(game) {
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

  sequenceActions(actions = []) {
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

  rankSearchCandidates(cards = [], action = {}, ctx = {}) {
    const game = ctx.game || ctx.ctx?.game || null;
    const analysis = game ? this.analyzeGameState(game) : this.currentAnalysis || {};
    return rankBloomrotSearchCandidates(cards, action, {
      ...ctx,
      analysis,
    });
  }
}
