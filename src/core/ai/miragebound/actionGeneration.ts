import type { MirageboundAnalysis, MirageboundGame, MirageboundPlayer } from "./contracts.js";
import { getGenericHandSpellActions, getGenericHandSummonProcedureActions, getGenericIgnitionEffectActions, getGenericNormalSummonActions } from "../common/actionGeneration.js";
import { shouldActivateFieldSpell, shouldActivateHandIgnition, shouldActivateMonsterEffect, shouldActivateSpellTrapEffect, shouldPlayMirageboundSpell, shouldSetMirageboundBackrow, shouldSummonMirageboundMonster } from "./resourcePolicy.js";
import { buildMirageboundActivationContext } from "./targeting.js";
import { canActivateFieldSpellEffect, canActivateMonsterEffect, canActivateSpellFromHand, canActivateSpellTrapEffect } from "../common/previewGuards.js";
import { getGenericSetBackrowActions } from "../common/backrowPlanning.js";
import { MB, isFaceUpMirageboundMonster, isMiragebound } from "./knowledge.js";
import { findIgnitionEffect } from "../common/effectDiscovery.js";
import type { AIAction } from "../../contracts/ai.js";
import { sequenceActionsByPriority } from "../common/actionSequencing.js";

import type MirageboundStrategy from "../MirageboundStrategy.js";

type GetSpellActionsPort = Pick<MirageboundStrategy, "bot">;

export function getSpellActions(strategy: GetSpellActionsPort, game: MirageboundGame, bot: MirageboundPlayer, analysis: MirageboundAnalysis) {
  return getGenericHandSpellActions({
    game,
    player: bot,
    analysis,
    shouldPlay: shouldPlayMirageboundSpell,
    buildActivationContext: (card, currentAnalysis, context) =>
      buildMirageboundActivationContext(card, currentAnalysis, {
        zone: "hand",
        activationZone: "hand",
        sourceZone: "hand",
        fromHand: true,
        effect: (context as {effect?: import("../../contracts/effects.js").EffectDefinition})?.effect,
      }),
    canActivate: ({ card, player, activationContext }) =>
      canActivateSpellFromHand(game, card, player, activationContext, {
        bot: strategy.bot,
        debugLabel: "MirageboundStrategy",
      }),
  });
}

export function getSetSpellTrapActions(game: MirageboundGame, bot: MirageboundPlayer, analysis: MirageboundAnalysis) {
  return getGenericSetBackrowActions({
    game,
    player: bot,
    analysis,
    opponent: analysis.opponent,
    policy: {
      acceptsCard: (card) =>
        card?.name === MB.FALSE_HORIZON || card?.name === MB.VANISHING_STEP,
      shouldSet: (card) => shouldSetMirageboundBackrow(card, analysis),
      getPriority: (_card, context) => context.setDecision?.priority,
      getReason: (_card, context) => context.setDecision?.reason,
    },
  });
}

type GetSummonActionsPort = Pick<MirageboundStrategy, "getTributeRequirementFor">;

export function getSummonActions(strategy: GetSummonActionsPort, _game: MirageboundGame, bot: MirageboundPlayer, analysis: MirageboundAnalysis) {
  return getGenericNormalSummonActions<MirageboundAnalysis, MirageboundPlayer>({
    player: bot,
    analysis,
    getTributeRequirement: (card, player) =>
      strategy.getTributeRequirementFor(card, player),
    shouldSummon: shouldSummonMirageboundMonster,
  });
}

type GetHandIgnitionActionsPort = Pick<MirageboundStrategy, "bot">;

export function getHandIgnitionActions(strategy: GetHandIgnitionActionsPort, game: MirageboundGame, bot: MirageboundPlayer, analysis: MirageboundAnalysis) {
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
    buildActivationContext: (card, currentAnalysis, context) =>
      buildMirageboundActivationContext(card, currentAnalysis, {
        zone: "hand",
        activationZone: "hand",
        sourceZone: "hand",
        fromHand: true,
        effect: context?.effect,
      }),
    canActivate: ({ card, player, activationContext }) =>
      canActivateMonsterEffect(game, card, player, "hand", activationContext, {
        bot: strategy.bot,
        debugLabel: "MirageboundStrategy",
      }),
    cardFilter: (card) => card?.cardKind === "monster" && isMiragebound(card),
    includeEffectId: true,
  });
}

type GetMonsterEffectActionsPort = Pick<MirageboundStrategy, "bot">;

export function getMonsterEffectActions(strategy: GetMonsterEffectActionsPort, game: MirageboundGame, bot: MirageboundPlayer, analysis: MirageboundAnalysis) {
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
    buildActivationContext: (card, currentAnalysis, context) =>
      buildMirageboundActivationContext(card, currentAnalysis, {
        zone: "field",
        activationZone: "field",
        sourceZone: "field",
        effect: context?.effect,
      }),
    canActivate: ({ card, player, activationContext }) =>
      canActivateMonsterEffect(game, card, player, "field", activationContext, {
        bot: strategy.bot,
        debugLabel: "MirageboundStrategy",
      }),
    cardFilter: (card) => isFaceUpMirageboundMonster(card),
    includeEffectId: true,
  });
}

type GetFieldEffectActionsPort = Pick<MirageboundStrategy, "bot">;

export function getFieldEffectActions(strategy: GetFieldEffectActionsPort, game: MirageboundGame, bot: MirageboundPlayer, analysis: MirageboundAnalysis) {
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
    shouldActivate: shouldActivateFieldSpell,
    buildActivationContext: (card, currentAnalysis, context) =>
      buildMirageboundActivationContext(card, currentAnalysis, {
        zone: "fieldSpell",
        activationZone: "fieldSpell",
        sourceZone: "fieldSpell",
        effect: context?.effect,
      }),
    canActivate: ({ card, player, activationContext }) =>
      canActivateFieldSpellEffect(game, card, player, activationContext, {
        bot: strategy.bot,
        debugLabel: "MirageboundStrategy",
      }),
    includeEffectId: true,
  });
}

type GetSpellTrapEffectActionsPort = Pick<MirageboundStrategy, "bot">;

export function getSpellTrapEffectActions(strategy: GetSpellTrapEffectActionsPort, game: MirageboundGame, bot: MirageboundPlayer, analysis: MirageboundAnalysis) {
  return getGenericIgnitionEffectActions({
    game,
    player: bot,
    cards: bot.spellTrap,
    analysis,
    type: "spellTrapEffect",
    sourceZone: "spellTrap",
    indexFields: ["index", "zoneIndex"],
    findEffect: (card) => findIgnitionEffect(card, "spellTrap"),
    shouldActivate: shouldActivateSpellTrapEffect,
    buildActivationContext: (card, currentAnalysis, context) =>
      buildMirageboundActivationContext(card, currentAnalysis, {
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
          bot: strategy.bot,
          debugLabel: "MirageboundStrategy",
        },
      ),
    includeEffectId: true,
  });
}

type GenerateMainPhaseActionsPort = Pick<MirageboundStrategy, "analyzeGameState" | "getExtraDeckActions" | "getFieldEffectActions" | "getHandIgnitionActions" | "getMonsterEffectActions" | "getPositionChangeActions" | "getSetSpellTrapActions" | "getSpellActions" | "getSpellTrapEffectActions" | "getSummonActions" | "integrateP2IntoActionSelection" | "sequenceActions">;

export function generateMainPhaseActions(strategy: GenerateMainPhaseActionsPort, game: MirageboundGame) {
  const analysis = strategy.analyzeGameState(game);
  const bot = analysis.player;
  if (!bot) return [];

  const actions = [
    ...strategy.getSpellActions(game, bot, analysis),
    ...strategy.getHandIgnitionActions(game, bot, analysis),
    ...getGenericHandSummonProcedureActions(game),
    ...strategy.getFieldEffectActions(game, bot, analysis),
    ...strategy.getSpellTrapEffectActions(game, bot, analysis),
    ...strategy.getMonsterEffectActions(game, bot, analysis),
    ...strategy.getExtraDeckActions(game, bot, analysis),
    ...strategy.getSummonActions(game, bot, analysis),
    ...strategy.getSetSpellTrapActions(game, bot, analysis),
    ...(analysis.hasLeviathanLine && analysis.opponentMonsters.length >= 2
      ? []
      : strategy.getPositionChangeActions(game, bot, analysis.opponent)),
  ];

  const sequenced = strategy.sequenceActions(actions);
  return strategy.integrateP2IntoActionSelection(game, sequenced, analysis);
}

export function sequenceActions(actions: AIAction[] = []) {
  return sequenceActionsByPriority(actions, {
    typeOrder: {
      spell: 0,
      handIgnition: 1,
      handSummonProcedure: 1,
      fieldEffect: 2,
      spellTrapEffect: 3,
      monsterEffect: 4,
      ascension: 5,
      extraDeckProcedure: 5,
      summon: 6,
      set_spell_trap: 7,
      position_change: 8,
    },
  });
}
