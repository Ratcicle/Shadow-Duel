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
  buildBloomrotAnalysis,
  isBloomrot,
  isFaceUpBloomrotMonster,
} from "./bloomrot/analysis.js";
import {
  applyBloomrotSimulatedBattleRewards,
  buildBloomrotPlanningProfile,
  prepareBloomrotSimulatedBattle,
  scoreBloomrotBattleAttackCandidate,
} from "./bloomrot/battle.js";
import { getBloomrotExtraDeckActions } from "./bloomrot/extraDeck.js";
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
import { rankBloomrotSearchCandidates } from "./bloomrot/targeting.js";

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
