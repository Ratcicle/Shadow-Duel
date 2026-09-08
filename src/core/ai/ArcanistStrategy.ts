import type { AIAction, AIPlannedAction, AIPlanningContext, AIPlanningProfile, AIState, AIStrategyBotPort, AIActivationContext, StrategyRuntimePort } from "../contracts/ai.js";
import type { AiStateShape, SimulatedCardState, SimulatedPlayerState } from "../contracts/aiState.js";
import type { GameCard } from "../contracts/cards.js";
import type { PreviewGamePort } from "./common/previewGuards.js";

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
type PreferenceAction = Partial<AIAction> & { actionContext?: { targetPreferences?: TargetPreferences } };
type SearchAction = { type?: string; zone?: string; cardKind?: string; archetype?: string; source?: StrategyCard; targetRef?: string; filters?: { cardKind?: string; archetype?: string } };
type SearchContext = { game?: AIState | null; ctx?: { game?: AIState }; player?: AIStrategyBotPort; source?: StrategyCard; action?: AIAction; analysis?: Partial<Analysis> | null; activationContext?: AIActivationContext };
type TributeContext = { evaluationContext?: Partial<Analysis>; botState?: AIStrategyBotPort; oppField?: StrategyCard[] };
type ChoiceCase = { id?: string; label?: string; description?: string };
type ChoiceContext = { source?: StrategyCard; activationContext?: AIActivationContext; state?: AiStateShape };

import BaseStrategy from "./BaseStrategy.js";
import { sequenceActionsByPriority } from "./common/actionSequencing.js";
import {
  getGenericHandSpellActions,
  getGenericIgnitionEffectActions,
  getGenericNormalSummonActions,
} from "./common/actionGeneration.js";
import { getGenericSetBackrowActions } from "./common/backrowPlanning.js";
import { buildStrategyAnalysis } from "./common/analysis.js";
import { findIgnitionEffect } from "./common/effectDiscovery.js";
import { canUsePreview as canUsePreviewGuard } from "./common/previewGuards.js";
import {
  getStrongestAttackThreat,
  getStrongestBattleThreat,
} from "./common/cardStats.js";
import {
  applyGenericSimulatedMainPhaseAction,
  resolveSimulatedHandIndex,
} from "./common/simulation.js";
import {
  getCardInstanceId,
  getSimStateSignature,
  pushToZone,
  removeFromZone,
  useSimOpt as useSimOptBucket,
} from "./common/simStateUtils.js";
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
  getBestGrimoireHostNames,
  getTributeRequirementFor as getArcanistTributeRequirementFor,
  rankSearchCandidates as rankArcanistSearchCandidates,
  selectBestTributes as selectBestArcanistTributes,
  shouldActivateHandIgnition,
  shouldActivateMonsterEffect,
  shouldActivateSpellTrapEffect,
  shouldPlaySpell,
  shouldSummonMonster,
} from "./arcanist/priorities.js";
import {
  evaluateArcanistCardValue,
  evaluateBoardArcanist,
} from "./arcanist/scoring.js";

function isSimulatedState(game: AIState) {
  return game?._isPerspectiveState === true;
}

function findOpponentTarget(state: AiStateShape) {
  const opponent = state?.player;
  const candidates = [
    ...(opponent?.field || []),
    ...(opponent?.spellTrap || []),
    ...(opponent?.fieldSpell ? [opponent.fieldSpell] : []),
  ].filter(Boolean);
  return candidates
    .slice()
    .sort((a, b) => evaluateArcanistCardValue(b) - evaluateArcanistCardValue(a))[0];
}

function removeOpponentCard(state: AiStateShape, card: SimulatedCardState | null | undefined, destination: "graveyard" | "banished") {
  const opponent = state?.player;
  if (!opponent || !card) return false;
  if (opponent.fieldSpell === card) {
    opponent.fieldSpell = null;
  } else if (!removeFromZone(opponent, "field", card)) {
    removeFromZone(opponent, "spellTrap", card);
  }
  pushToZone(opponent, destination, card);
  return true;
}

function isFaceUpArcanistMonster(card: StrategyCard) {
  return isArcanistMonster(card) && !card.isFacedown;
}

function isFaceUpInkRiver(card: StrategyCard) {
  return (
    card?.name === ARCANIST_NAMES.INK_RIVER &&
    card.cardKind === "spell" &&
    !card.isFacedown
  );
}

function isContinuousFieldOrEquipSpell(card: StrategyCard) {
  return ["continuous", "field", "equip"].includes(card?.subtype!);
}

function getEffectiveAtk(card: StrategyCard) {
  return (
    (card?.atk || 0) +
    (card?.tempAtkBoost || 0) +
    (card?.equipAtkBonus || 0)
  );
}

function getEffectiveDef(card: StrategyCard) {
  return (
    (card?.def || 0) +
    (card?.tempDefBoost || 0) +
    (card?.equipDefBonus || 0)
  );
}

function getArcanistSimStateSignature(state: AiStateShape) {
  return getSimStateSignature(state, {
    getSpellTrapCounters: getInkCounters,
    extraState: (simState) => ({
      simActivations: (simState as AiStateShape)?._simArcanistSpellActivations || 0,
    }),
  });
}

function ensureCounterObject(card: { counters?: Map<string, number> | Record<string, number> }) {
  if (!card) return null;
  if (card.counters instanceof Map) return card.counters;
  if (!card.counters || typeof card.counters !== "object") {
    card.counters = {};
  }
  return card.counters;
}

function setInkCounters(card: SimulatedCardState, value: number) {
  const counters = ensureCounterObject(card);
  if (!counters) return;
  const nextValue = Math.max(0, Math.floor(value || 0));
  if (counters instanceof Map) {
    counters.set("ink", nextValue);
  } else {
    counters.ink = nextValue;
  }
}

function addInkCounterToFaceUpRivers(player: SimulatedPlayerState, amount = 1) {
  for (const card of player?.spellTrap || []) {
    if (!isFaceUpInkRiver(card)) continue;
    setInkCounters(card, getInkCounters(card) + amount);
  }
}

function clearSimulatedArcanistPassiveStats(player: SimulatedPlayerState) {
  for (const card of player?.field || []) {
    if (!card) continue;
    const aura = card._simArcanistApprenticeAuraAtk || 0;
    if (aura) {
      card.tempAtkBoost = (card.tempAtkBoost || 0) - aura;
      delete card._simArcanistApprenticeAuraAtk;
    }

    const debuffAtk = card._simArcanistAzrathSpellDebuffAtk || 0;
    if (debuffAtk) {
      card.tempAtkBoost = (card.tempAtkBoost || 0) - debuffAtk;
      delete card._simArcanistAzrathSpellDebuffAtk;
    }

    const debuffDef = card._simArcanistAzrathSpellDebuffDef || 0;
    if (debuffDef) {
      card.tempDefBoost = (card.tempDefBoost || 0) - debuffDef;
      delete card._simArcanistAzrathSpellDebuffDef;
    }

    const elementalistBuff = card._simArcanistElementalistSpellBuffAtk || 0;
    if (elementalistBuff) {
      card.tempAtkBoost = (card.tempAtkBoost || 0) - elementalistBuff;
      delete card._simArcanistElementalistSpellBuffAtk;
    }
  }
}

function bestPreferredCard<Card extends StrategyCard>(candidates: Card[] = [], preference: Preference = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const preferredIds = new Set(preference.preferredInstanceIds || []);
  const avoidIds = new Set(preference.avoidInstanceIds || []);
  const preferredNames = new Set(preference.preferredNames || []);
  const avoidNames = new Set(preference.avoidNames || []);
  return candidates
    .slice()
    .sort((a, b) => {
      const idA = getCardInstanceId(a);
      const idB = getCardInstanceId(b);
      const score = (card: Card, id: string | number | null) => {
        let value = evaluateArcanistCardValue(card);
        if (id !== null && preferredIds.has(id)) value += 1000;
        if (preferredNames.has(card?.name!)) value += 500;
        if (id !== null && avoidIds.has(id)) value -= 1000;
        if (avoidNames.has(card?.name!)) value -= 500;
        return value;
      };
      return score(b, idB) - score(a, idA);
    })[0];
}

function useSimOpt(state: AiStateShape, key: string) {
  return useSimOptBucket(state, key, "_simArcanistOptUsed");
}

function removeEquipRelation(equip: SimulatedCardState) {
  const host = (equip?.equippedTo || equip?.equipTarget || null) as SimulatedCardState | null;
  if (host && Array.isArray(host.equips)) {
    host.equips = host.equips.filter((entry) => entry !== equip);
  }
  if (equip) {
    equip.equippedTo = null;
    equip.equipTarget = null;
  }
}

function getTargetPreferenceFor(action: PreferenceAction, id: string) {
  return getActivationTargetPreferences(action)?.[id] || {};
}

function getActivationTargetPreferences(action: PreferenceAction): TargetPreferences {
  return (
    (action?.activationContext?.actionContext as { targetPreferences?: TargetPreferences } | undefined)?.targetPreferences ||
    (action?.activationContext?.targetPreferences as TargetPreferences | undefined) ||
    action?.actionContext?.targetPreferences ||
    {}
  );
}

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

  get archetypeLabel() {
    return "Arcanist";
  }

  think(thought: string) {
    this.thoughtProcess.push(thought);
    if (this.bot?.debug) {
      console.log(`[Arcanist AI] ${thought}`);
    }
  }

  getPlanningProfile(game: AIState, context: AIPlanningContext & { analysis?: Analysis } = {}): AIPlanningProfile {
    if (!game) return super.getPlanningProfile(game, context);
    const analysis = context.analysis || this.analyzeGameState(game);
    return buildArcanistPlanningProfile(analysis as Parameters<typeof buildArcanistPlanningProfile>[0], {
      ...context,
      game: game as AiStateShape,
    } as Parameters<typeof buildArcanistPlanningProfile>[1]);
  }

  shouldUseDeepPlanning(game: AIState, context: AIPlanningContext = {}) {
    const profile =
      context.profile || this.getPlanningProfile(game, context) || {};
    return (game as AIState & { turnLineSearchEnabled?: boolean })?.turnLineSearchEnabled === true || profile.enabled === true;
  }

  scoreLineMilestones(context: AIPlanningContext = {}) {
    return scoreArcanistLineMilestones(context as Parameters<typeof scoreArcanistLineMilestones>[0]);
  }

  scoreLineTerminal(context: AIPlanningContext = {}) {
    return scoreArcanistLineTerminal(context as Parameters<typeof scoreArcanistLineTerminal>[0]);
  }

  describePlannedLine(context: AIPlanningContext = {}) {
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

  evaluateBoard(gameOrState: AIState, perspectivePlayer?: SimulatedPlayerState): number {
    return evaluateBoardArcanist(
      gameOrState,
      perspectivePlayer,
      this.getOpponent.bind(this),
    );
  }

  evaluateBoardV2(gameOrState: AIState, perspectivePlayer?: SimulatedPlayerState): number {
    return this.evaluateBoard(gameOrState, perspectivePlayer);
  }

  buildActivationContextForEffect({ sourceCard, player, game }: { sourceCard?: StrategyCard; player?: AIStrategyBotPort; game?: AIState } = {}) {
    if (!sourceCard || !player || !game) return null;
    const analysis = this.analyzeGameState(game);
    return buildArcanistActivationContext(sourceCard, analysis);
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

    const activationContext = buildArcanistActivationContext(card, analysis);
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
      findEffect: (card) => findIgnitionEffect(card, "spellTrap"),
      shouldActivate: shouldActivateSpellTrapEffect,
      buildActivationContext: buildArcanistActivationContext,
      canActivate: ({ card, player, activationContext }) =>
        this.canUsePreview(game, (actualGame) =>
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

  generateMainPhaseActions(game: AIState): AIAction[] {
    const analysis = this.analyzeGameState(game);
    const bot = analysis.player;
    const actions = [
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

  sequenceActions(actions: AIAction[] = []) {
    const typeOrder = {
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

  getTributeRequirementFor(card: StrategyCard, playerState: AIStrategyBotPort) {
    return getArcanistTributeRequirementFor(card, playerState);
  }

  selectBestTributes(field: SimulatedCardState[], tributesNeeded: number, cardToSummon: SimulatedCardState, context: TributeContext = {}) {
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

  chooseActionCase<Case extends ChoiceCase>(cases: Case[] = [], context: ChoiceContext = {}) {
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

  simulateMainPhaseAction(state: Parameters<StrategyRuntimePort["simulateMainPhaseAction"]>[0], action: AIPlannedAction): ReturnType<StrategyRuntimePort["simulateMainPhaseAction"]> {
    const beforeSignature = getArcanistSimStateSignature(state as AiStateShape);
    const result = applyGenericSimulatedMainPhaseAction(state as Parameters<typeof applyGenericSimulatedMainPhaseAction>[0], action as AIAction, {
      archetype: "Arcanist",
      guardLabel: "ArcanistStrategy",
      strategy: this,
      activationContext: (action as AIAction).activationContext,
      rankSearchCandidates: this.rankSearchCandidates.bind(this),
      evaluateRecruitCandidate: this.evaluateRecruitCandidate.bind(this),
      chooseSpecialSummonPosition: this.chooseSpecialSummonPosition.bind(this),
      getTributeRequirementFor: this.getTributeRequirementFor.bind(this),
      selectBestTributes: this.selectBestTributes.bind(this),
      placeSpellCard: this.placeSpellCard.bind(this),
      onAfterSummon: this.simulateArcanistAfterSummon.bind(this),
      actionOverrides: {
        handIgnition: ({ state: simState, action: simAction }) =>
          this.simulateHandIgnition(simState, simAction),
        spell: ({ state: simState, action: simAction }) =>
          this.simulateArcanistSpell(simState, simAction),
        fieldEffect: ({ state: simState }) =>
          this.simulateGrandLibraryEffect(simState),
      },
    });
    const changed = getArcanistSimStateSignature(state as AiStateShape) !== beforeSignature;
    this.applyArcanistSimulationPostProcess(state as AiStateShape, action as AIAction, { changed });
    return result;
  }

  simulateArcanistAfterSummon({ state, action, player, newCard }: { state: AiStateShape; action: AIAction; player: SimulatedPlayerState; newCard: SimulatedCardState }) {
    if (action?.type !== "summon") return;
    if (newCard.isFacedown) return;

    if (newCard?.name === ARCANIST_NAMES.APPRENTICE) {
      if (state._simArcanistApprenticeSearchUsed) return;
      const candidates = (player.deck || []).filter(isArcanistSpell);
      if (candidates.length === 0) return;
      const ranked = this.rankSearchCandidates(
        candidates,
        {
          type: "search_any",
          cardKind: "spell",
          archetype: "Arcanist",
          source: newCard,
        },
        {
          game: state,
          player,
          source: newCard,
          action,
        },
      );
      const chosen = ranked?.[0] || candidates[0];
      if (!chosen) return;
      removeFromZone(player, "deck", chosen);
      pushToZone(player, "hand", chosen);
      state._simArcanistApprenticeSearchUsed = true;
      return;
    }

    if (newCard?.name === ARCANIST_NAMES.MASTER_OF_MIRRORS) {
      this.simulateMasterOfMirrorsNormalSummon(state, player, newCard, action);
      return;
    }

    if (newCard?.name === ARCANIST_NAMES.ELEMENTALIST) {
      newCard.cannotBeDestroyedByCardEffects = true;
      newCard._simEffectDestructionProtected = true;
    }
  }

  simulateMasterOfMirrorsNormalSummon(state: AiStateShape, player: SimulatedPlayerState, source: SimulatedCardState, action: AIAction) {
    if (!useSimOpt(state, "master_mirrors_arcanist_shuffle_draw")) return;
    const candidates = (player.graveyard || []).filter(isArcanistSpell);
    if (candidates.length === 0) return;
    const preference =
      getActivationTargetPreferences(action).master_mirrors_arcanist_spell_targets || {};
    const ordered =
      this.rankSearchCandidates(
        candidates,
        {
          type: "move",
          targetRef: "master_mirrors_arcanist_spell_targets",
          filters: { cardKind: "spell", archetype: "Arcanist" },
        },
        { game: state, player, source, action },
      ) || candidates;
    const chosen = ordered
      .slice()
      .sort((a, b) => {
        const preferredA = (preference.preferredNames || []).includes(a?.name!) ? 1 : 0;
        const preferredB = (preference.preferredNames || []).includes(b?.name!) ? 1 : 0;
        return preferredB - preferredA;
      })
      .slice(0, Math.min(3, ordered.length));
    for (const card of chosen) {
      removeFromZone(player, "graveyard", card);
      pushToZone(player, "deck", card);
    }
    const drawn = player.deck?.shift?.();
    if (drawn) pushToZone(player, "hand", drawn);
    source._simMasterMirrorsShuffleDraw = true;
  }

  applyArcanistSimulationPostProcess(state: AiStateShape, action: AIAction, { changed = false } = {}) {
    const source = this.resolveSimulatedActionSource(state, action);
    if (changed && this.shouldCountSimulatedInkCounter(action, source)) {
      addInkCounterToFaceUpRivers(state.bot, 1);
    }
    if (changed && this.shouldCountSimulatedArcanistSpellActivation(action, source)) {
      state._simArcanistSpellActivations =
        (state._simArcanistSpellActivations || 0) + 1;
    }

    if (changed && action?.type === "spell" && source?.cardKind === "spell") {
      this.simulateArcanistBlueprintStorage(state, source);
    }

    if (changed && source?.name === ARCANIST_NAMES.GRIMOIRE) {
      this.applySimulatedAzrathEquipTrigger(state, action);
    }

    this.applySimulatedArcanistPassiveStats(state);
  }

  resolveSimulatedActionSource(state: AiStateShape, action: AIAction) {
    if (!action) return null;
    if (action.card) return action.card;
    const cardName = action.cardName || action.name;
    if (action.type === "fieldEffect") return state.bot?.fieldSpell || null;
    if (action.type === "spellTrapEffect") {
      const index = Number.isInteger(action.zoneIndex)
        ? action.zoneIndex
        : action.index;
      const byIndex = state.bot?.spellTrap?.[index!];
      if (byIndex) return byIndex;
      return (state.bot?.spellTrap || []).find((card) => card?.name === cardName);
    }
    const pools = [
      state.bot?.hand || [],
      state.bot?.graveyard || [],
      state.bot?.spellTrap || [],
      state.bot?.field || [],
    ];
    return pools.flat().find((card) => card?.name === cardName) || null;
  }

  shouldCountSimulatedInkCounter(action: AIAction, source: StrategyCard | null | undefined) {
    if (!source || !isArcanistSpell(source)) return false;
    if (source.name === ARCANIST_NAMES.INK_RIVER) return false;
    if (action?.type === "spell") {
      return source.subtype === "normal";
    }
    if (action?.type === "fieldEffect") {
      return source.name !== ARCANIST_NAMES.INK_RIVER && isArcanistSpell(source);
    }
    if (action?.type === "spellTrapEffect") {
      return isContinuousFieldOrEquipSpell(source);
    }
    return false;
  }

  shouldCountSimulatedArcanistSpellActivation(action: AIAction, source: StrategyCard | null | undefined) {
    if (!source || !isArcanistSpell(source)) return false;
    if (action?.type === "set_spell_trap") return false;
    return action?.type === "spell";
  }

  applySimulatedLightningLance(state: AiStateShape, action: AIAction) {
    const preferences = getActivationTargetPreferences(action);
    const preference = preferences.lightning_magic_lance_target || {};
    const selfTargets = (state.bot?.field || []).filter(isFaceUpArcanistMonster);
    const opponentTargets = (state.player?.field || []).filter(
      (card) => card?.cardKind === "monster" && !card.isFacedown,
    );
    const candidates = [...selfTargets, ...opponentTargets];
    const target = bestPreferredCard(candidates, preference);
    if (!target) return;

    if (selfTargets.includes(target)) {
      if (!target._simArcanistLightningAtkBoost) {
        target.tempAtkBoost = (target.tempAtkBoost || 0) + 500;
        target._simArcanistLightningAtkBoost = 500;
      }
      target.piercing = true;
      target._simArcanistLightningPiercing = true;
      return;
    }

    target.cannotAttackThisTurn = true;
    target.cannotAttackUntilTurn = Math.max(
      target.cannotAttackUntilTurn || 0,
      (state.turnCounter || 0) + 1,
    );
    target._simArcanistLightningAttackLock = true;
  }

  applySimulatedAzrathEquipTrigger(state: AiStateShape, action: AIAction) {
    const preferences = getActivationTargetPreferences(action);
    const hostPreference = preferences.grimoire_equip_target || {};
    const hosts = (state.bot?.field || []).filter(isFaceUpArcanistMonster);
    const equippedAzrath = hosts.find(
      (card) =>
        card?.name === ARCANIST_NAMES.AZRATH &&
        hasArcanistEquip(card) &&
        !card._simArcanistAzrathEquipHalveUsed,
    );
    if (!equippedAzrath) return;

    const hostWasPreferred =
      (hostPreference.preferredNames || []).includes(ARCANIST_NAMES.AZRATH) ||
      (hostPreference.preferredInstanceIds || []).includes(
        getCardInstanceId(equippedAzrath),
      );
    if (!hostWasPreferred && action?.cardName === ARCANIST_NAMES.GRIMOIRE) {
      const bestHost = bestPreferredCard(hosts, hostPreference);
      if (bestHost && bestHost !== equippedAzrath) return;
    }

    const target = (state.player?.field || [])
      .filter((card) => card?.cardKind === "monster" && !card.isFacedown)
      .sort(
        (a, b) =>
          Math.max(getEffectiveAtk(b), getEffectiveDef(b)) -
          Math.max(getEffectiveAtk(a), getEffectiveDef(a)),
      )[0];
    if (!target) return;
    target.atk = Math.floor((target.atk || 0) * 0.5);
    target.def = Math.floor((target.def || 0) * 0.5);
    target._simArcanistAzrathHalvedByEquip = true;
    equippedAzrath._simArcanistAzrathEquipHalveUsed = true;
  }

  simulateArcanistBlueprintStorage(state: AiStateShape, source: StrategyCard) {
    if (!source || source.name === ARCANIST_NAMES.GRIMOIRE) return;
    if (!isArcanistSpell(source)) return;
    const effect = (source.effects || []).find(
      (entry) => entry?.timing === "on_play" && entry.storableByGrimoire,
    );
    if (!effect) return;
    const grimoire = (state.bot?.spellTrap || []).find(
      (card) =>
        card?.name === ARCANIST_NAMES.GRIMOIRE &&
        !card.isFacedown &&
        card.equippedTo,
    );
    if (!grimoire) return;
    if (!grimoire.state) grimoire.state = {};
    if (!grimoire.state.blueprintStorage) {
      grimoire.state.blueprintStorage = { storedBlueprints: [] };
    }
    const blueprint = {
      blueprintId: `${source.id || source.name}:${effect.id || "effect"}`,
      sourceCardId: source.id,
      sourceCardName: source.name,
      sourceCardKind: source.cardKind,
      sourceCardSubtype: source.subtype,
      displayName: source.name,
      shortRulesText: source.description || "",
      effectSnapshot: JSON.parse(JSON.stringify(effect)) as typeof effect,
      _simStoredByGrimoire: true,
    };
    grimoire.state.blueprintStorage.storedBlueprints = [blueprint];
    grimoire._simStoredBlueprintSource = source.name;
  }

  simulateArcanistOnEquipTriggers(state: AiStateShape, host: SimulatedCardState, equip: SimulatedCardState, action: AIAction) {
    if (!host || !equip || !isFaceUpArcanistMonster(host)) return;
    if (host.name === ARCANIST_NAMES.AZRATH) {
      this.applySimulatedAzrathEquipTrigger(state, action);
      return;
    }
    if (host.name === ARCANIST_NAMES.ELEMENTALIST) {
      this.simulateElementalistEquipTrigger(state, host, action);
      return;
    }
    if (host.name === ARCANIST_NAMES.VIRIDIS) {
      this.simulateRecoverFromGraveyard(state, host, action, {
        optKey: "viridis_arcanist_life_recover_spell",
        targetId: "viridis_recover_target",
        filter: isArcanistSpell,
        zone: "hand",
      });
      return;
    }
    if (host.name === ARCANIST_NAMES.ALBUS) {
      this.simulateRecoverFromGraveyard(state, host, action, {
        optKey: "albus_arcanist_ice_recover_monster",
        targetId: "albus_arcanist_ice_recover_target",
        filter: isArcanistMonster,
        zone: "hand",
      });
      return;
    }
    if (host.name === ARCANIST_NAMES.MASTER_OF_MIRRORS) {
      this.simulateMasterOfMirrorsEquipTrigger(state, host, action);
    }
  }

  simulateElementalistEquipTrigger(state: AiStateShape, host: SimulatedCardState, action: AIAction) {
    if (!useSimOpt(state, "elementalist_master_destroy")) return;
    const preference = getTargetPreferenceFor(action, "elementalist_destroy_target");
    const candidates = (state.player?.field || []).filter(
      (card) => card?.cardKind === "monster" && !card.isFacedown,
    );
    const target = bestPreferredCard(candidates, preference);
    if (!target) return;
    removeOpponentCard(state, target, "graveyard");
    host._simElementalistDestroyedOnEquip = target.name;
  }

  simulateRecoverFromGraveyard(state: AiStateShape, host: SimulatedCardState, action: AIAction, config: { optKey: string; targetId: string; filter: (card: SimulatedCardState) => boolean; zone?: "hand" }) {
    if (!useSimOpt(state, config.optKey)) return;
    const candidates = (state.bot?.graveyard || []).filter(config.filter);
    const target = bestPreferredCard(
      candidates,
      getTargetPreferenceFor(action, config.targetId),
    );
    if (!target) return;
    removeFromZone(state.bot, "graveyard", target);
    pushToZone(state.bot, config.zone || "hand", target);
    host._simRecoveredOnEquip = target.name;
  }

  simulateMasterOfMirrorsEquipTrigger(state: AiStateShape, host: SimulatedCardState, action: AIAction) {
    if (!useSimOpt(state, "master_mirrors_arcanist_revive")) return;
    if ((state.bot?.field || []).length >= 5) return;
    const preference = getTargetPreferenceFor(
      action,
      "master_mirrors_arcanist_revive_target",
    );
    const candidates = (state.bot?.graveyard || []).filter(
      (card) => isArcanistMonster(card) && (card.level || 0) <= 4,
    );
    const target = bestPreferredCard(candidates, preference);
    if (!target) return;
    removeFromZone(state.bot, "graveyard", target);
    target.position = this.chooseSpecialSummonPosition(target, {
      game: state,
      player: state.bot,
      source: host,
      action,
      activationContext: action.activationContext,
    });
    target.isFacedown = false;
    target.hasAttacked = false;
    target.attacksUsedThisTurn = 0;
    pushToZone(state.bot, "field", target);
    host._simMasterRevivedOnEquip = target.name;
  }

  applySimulatedArcanistPassiveStats(state: AiStateShape) {
    clearSimulatedArcanistPassiveStats(state.bot);
    clearSimulatedArcanistPassiveStats(state.player);

    const apprenticeAuras = (state.bot?.field || []).filter(
      (card) =>
        card?.name === ARCANIST_NAMES.APPRENTICE &&
        isFaceUpArcanistMonster(card) &&
        hasArcanistEquip(card),
    ).length;
    if (apprenticeAuras > 0) {
      const amount = apprenticeAuras * 300;
      for (const card of state.bot?.field || []) {
        if (!isFaceUpArcanistMonster(card)) continue;
        const baseAtk = Number.isFinite(card.baseAtk) ? card.baseAtk : null;
        const rawAuraAlreadyPresent =
          baseAtk !== null &&
          (card.atk || 0) >= baseAtk! + amount &&
          !card._simArcanistApprenticeAuraAtk;
        if (rawAuraAlreadyPresent) continue;
        card.tempAtkBoost = (card.tempAtkBoost || 0) + amount;
        card._simArcanistApprenticeAuraAtk = amount;
      }
    }

    const spellActivations = state._simArcanistSpellActivations || 0;
    if (spellActivations > 0) {
      const amount = spellActivations * 100;
      for (const card of state.bot?.field || []) {
        if (
          card?.name !== ARCANIST_NAMES.ELEMENTALIST ||
          !isFaceUpArcanistMonster(card)
        ) {
          continue;
        }
        card.tempAtkBoost = (card.tempAtkBoost || 0) + amount;
        card._simArcanistElementalistSpellBuffAtk = amount;
      }
    }

    const azrathCount = (state.bot?.field || []).filter(
      (card) =>
        card?.name === ARCANIST_NAMES.AZRATH &&
        isFaceUpArcanistMonster(card),
    ).length;
    const debuff = spellActivations * azrathCount * -100;
    if (debuff) {
      for (const card of state.player?.field || []) {
        if (!card || card.cardKind !== "monster" || card.isFacedown) continue;
        card.tempAtkBoost = (card.tempAtkBoost || 0) + debuff;
        card.tempDefBoost = (card.tempDefBoost || 0) + debuff;
        card._simArcanistAzrathSpellDebuffAtk = debuff;
        card._simArcanistAzrathSpellDebuffDef = debuff;
      }
    }
  }

  simulateHandIgnition(state: AiStateShape, action: AIAction) {
    const player = state.bot;
    const handIndex = resolveSimulatedHandIndex(player, action, "monster");
    const card = player.hand?.[handIndex];
    if (!card || card.name !== ARCANIST_NAMES.ALBUS) return false;
    if (!player.field?.some(isArcanistMonster)) return true;
    if ((player.field || []).length >= 5) return true;
    if (!useSimOpt(state, "albus_arcanist_ice_special_summon")) return true;
    player.hand.splice(handIndex, 1);
    player.field.push({
      ...card,
      position: "attack",
      isFacedown: false,
      hasAttacked: false,
      attacksUsedThisTurn: 0,
    });
    return true;
  }

  simulateArcanistSpell(state: AiStateShape, action: AIAction) {
    const player = state.bot;
    const handIndex = resolveSimulatedHandIndex(player, action, "spell");
    const card = player.hand?.[handIndex];
    if (!card) return false;

    if (card.name === ARCANIST_NAMES.GRIMOIRE) {
      const analysis = this.analyzeGameState(state);
      const hostPreference = getTargetPreferenceFor(action, "grimoire_equip_target");
      const hosts = (player.field || []).filter(
        (candidate) => isArcanistMonster(candidate) && !candidate.isFacedown,
      );
      const hostByPreference = bestPreferredCard(hosts, hostPreference);
      const hostName = getBestGrimoireHostNames(analysis)[0];
      const host =
        hostByPreference ||
        hosts.find((candidate) => candidate.name === hostName) ||
        hosts[0];
      if (!host) return true;
      player.hand.splice(handIndex, 1);
      card.equippedTo = host;
      if (!Array.isArray(host.equips)) host.equips = [];
      host.equips.push(card);
      player.spellTrap = player.spellTrap || [];
      player.spellTrap.push(card);
      this.simulateArcanistOnEquipTriggers(state, host, card, action);
      return true;
    }

    if (card.name === ARCANIST_NAMES.SEISMIC_IMPACT) {
      const equippedHost = (player.field || []).find(
        (candidate) =>
          isArcanistMonster(candidate) &&
          !candidate.isFacedown &&
          hasArcanistEquip(candidate),
      );
      const equipCandidates = (player.spellTrap || []).filter(
        (candidate) =>
          candidate &&
          !candidate.isFacedown &&
          isArcanistSpell(candidate) &&
          candidate.subtype === "equip",
      );
      const equipCost =
        bestPreferredCard(
          equipCandidates,
          getTargetPreferenceFor(action, "seismic_impact_equip_cost"),
        ) || equipCandidates[0];
      if (!equippedHost || !equipCost) return true;
      const targetPreference = getTargetPreferenceFor(action, "seismic_impact_target");
      const target =
        bestPreferredCard(
          [
            ...(state.player?.field || []),
            ...(state.player?.spellTrap || []),
            ...(state.player?.fieldSpell ? [state.player.fieldSpell] : []),
          ].filter(Boolean),
          targetPreference,
        ) || findOpponentTarget(state);
      if (!target) return true;
      if (!useSimOpt(state, "seismic_impact_effect")) return true;
      player.hand.splice(handIndex, 1);
      pushToZone(player, "graveyard", card);
      removeFromZone(player, "spellTrap", equipCost);
      for (const monster of player.field || []) {
        if (Array.isArray(monster.equips)) {
          monster.equips = monster.equips.filter((equip) => equip !== equipCost);
        }
      }
      removeEquipRelation(equipCost);
      pushToZone(player, "graveyard", equipCost);
      removeOpponentCard(state, target, "banished");
      return true;
    }

    return false;
  }

  simulateGrandLibraryEffect(state: AiStateShape) {
    const player = state.bot;
    const library = player.fieldSpell;
    if (!library || library.name !== ARCANIST_NAMES.GRAND_LIBRARY) {
      return false;
    }
    if (!useSimOpt(state, "arcanist_grand_library_ignition")) return true;

    const hasMonster = (player.field || []).some(isArcanistMonster);
    if (!hasMonster) {
      if ((player.lp || 0) <= 2200 || (player.field || []).length >= 5) {
        return true;
      }
      const analysis = this.analyzeGameState(state);
      const candidates = (player.deck || []).filter(
        (card) =>
          isArcanistMonster(card) &&
          (card.level || 0) <= 4 &&
          card.cardKind === "monster",
      );
      const recruit = this.evaluateRecruitCandidate(candidates, {
        game: state,
        player,
        source: library,
        analysis,
      }).best;
      if (!recruit) return true;
      removeFromZone(player, "deck", recruit);
      player.lp = Math.max(0, (player.lp || 0) - 2000);
      player.field.push({
        ...recruit,
        position: "attack",
        isFacedown: false,
        hasAttacked: false,
        attacksUsedThisTurn: 0,
      });
      return true;
    }

    const grimoire = (player.deck || []).find(
      (card) => card.name === ARCANIST_NAMES.GRIMOIRE,
    );
    if (grimoire) {
      removeFromZone(player, "deck", grimoire);
      pushToZone(player, "hand", grimoire);
    }
    return true;
  }
}
