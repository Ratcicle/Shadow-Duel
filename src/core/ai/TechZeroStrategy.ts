import BaseStrategy from "./BaseStrategy.js";
import Card from "../Card.js";
import { scoreTechZeroBattleAttackCandidate } from "./techzero/battle.js";
import type { BotStrategyPort } from "../contracts/bot.js";
import { canUseNormalSummonForCard } from "../Player.js";
import { getTributeCardsFromIndices, getTributeValueTotal } from "../game/summon/tributeValue.js";
import { buildStrategyAnalysis } from "./common/analysis.js";
import { getGenericHandSpellActions, getGenericHandSummonProcedureActions, getGenericIgnitionEffectActions, getGenericNormalSummonActions,
  getGenericSynchroActions } from "./common/actionGeneration.js";
import { getGenericSetBackrowActions } from "./common/backrowPlanning.js";
import { findIgnitionEffect, findSpellActivationEffect } from "./common/effectDiscovery.js";
import { canActivateMonsterEffect, canActivateSpellFromHand, canActivateSpellTrapEffect } from "./common/previewGuards.js";
import { evaluateSimulatedConditions } from "./common/simulatedConditions.js";
import { resolvePerspectivePlayers } from "./common/perspective.js";
import { createPlanningCopy } from "./common/planningCopy.js";
import { assessSummonEntry } from "./common/summonAssessment.js";
import { canUseSimulatedEffectUsage } from "./common/simStateUtils.js";
import { getTributeRequirementFor, selectPayableTributes } from "./common/tributePolicy.js";
import { applyGenericSimulatedMainPhaseAction } from "./common/simulation.js";
import { TECH_ZERO_IDS as TZ } from "./techzero/knowledge.js";
import { buildTechZeroActivationContext, enumerateTechZeroLevelAdjustments, getTechZeroVisibleBattlePolicy, scoreTechZeroSummon, shouldUseTechZeroAssembly, selectTechZeroTributes,
  type TechZeroPolicyContext } from "./techzero/priorities.js";
import { buildTechZeroSimulationOptions, scoreTechZeroSynchro } from "./techzero/simulation.js";
import { getTechZeroPlanningProfile, scoreTechZeroLineMilestones, scoreTechZeroLineTerminal,
  describeTechZeroPlannedLine, selectTechZeroPlanningCandidates } from "./techzero/linePlanning.js";
import { chooseTechZeroChainResponse, getTechZeroPendingResources, type TechZeroChainResponseInput } from "./techzero/responses.js";
import type { AIAction, AIActivationContext, AIPlannedAction, AIPlanningContext, AIState, AIStrategyBotPort } from "../contracts/ai.js";
import type { AiCardInput, AiPlayerInput, AiStateInput, SimulatedCardState, SimulatedPlayerState } from "../contracts/aiState.js";
import type { EffectDefinition } from "../contracts/effects.js";
import type { CanonicalZone } from "../contracts/zones.js";
import type { BattlePositionInput } from "../contracts/cards.js";

type EffectChoiceInput = {
  sourceCard?: AiCardInput; effect?: EffectDefinition | null | undefined;
  player?: AiPlayerInput; game?: AIState | undefined; activationZone?: CanonicalZone | "temporary" | null | undefined;
};

export default class TechZeroStrategy extends BaseStrategy {
  constructor(bot: AIStrategyBotPort) { super(bot); }

  override get archetypeLabel() { return "Tech-Zero"; }

  scoreBattleAttackCandidate(context: Parameters<NonNullable<BotStrategyPort["scoreBattleAttackCandidate"]>>[0]) {
    return scoreTechZeroBattleAttackCandidate(context);
  }

  chooseChainResponse(input: TechZeroChainResponseInput) {
    const copy = createPlanningCopy(true);
    let incompleteEffects = false;
    const visible = (card: TechZeroChainResponseInput["player"]["field"][number]) => {
      if (card.isFacedown) return copy.cloneCardForSim({ isFacedown: true, position: card.position });
      if (card instanceof Card) return copy.cloneCardForSim(card);
      // Chain fixtures expose nullable fields and partial effects. Preserve the
      // public arithmetic without claiming those effects are canonical rules.
      incompleteEffects ||= !!card.effects?.length;
      const projection: AiCardInput = {
        name: card.name, cardKind: card.cardKind ?? undefined,
        position: card.position, atk: card.atk, def: card.def, level: card.level,
        ...(card.id == null ? {} : { id: card.id }),
        ...(card.instanceId == null ? {} : { instanceId: card.instanceId }),
        ...(card.owner == null ? {} : { owner: card.owner }),
        ...(card.monsterType == null ? {} : { monsterType: card.monsterType }),
        ...(card.archetype == null ? {} : { archetype: card.archetype }),
        ...(card.archetypes ? { archetypes: card.archetypes } : {}),
      };
      if (card.subtype === "field" || card.subtype === "continuous" || card.subtype === "equip" ||
          card.subtype === "normal" || card.subtype === "quick" || card.subtype === "counter") {
        projection.subtype = card.subtype;
      }
      return copy.cloneCardForSim(projection);
    };
    const opponent = input.opponent;
    const state = {
      bot: this.bot,
      player: opponent ? {
        id: opponent.id, lp: opponent.lp,
        field: opponent.field.map(visible), graveyard: opponent.graveyard.map(visible),
        banished: opponent.banished.map(visible), spellTrap: opponent.spellTrap.map(visible),
        fieldSpell: opponent.fieldSpell ? visible(opponent.fieldSpell) : null,
        hand: opponent.hand.map(() => ({})), deck: [], extraDeck: [],
      } : null,
      chainSystem: input.chainSystem,
      _isPerspectiveState: true,
      turn: input.game?.turn, phase: input.game?.phase,
      ...(input.game ? { turnCounter: input.game.turnCounter } : {}),
    };
    const policy = this.policyContext(state);
    if (incompleteEffects) policy.directLethalAvailable = false;
    return chooseTechZeroChainResponse(input, policy);
  }

  override getPlanningProfile(game: AIState, context: AIPlanningContext = {}) {
    return getTechZeroPlanningProfile(game, context);
  }

  selectPlanningCandidates(actions: readonly AIAction[], _state: AIState, limit: number) {
    return selectTechZeroPlanningCandidates(actions, limit);
  }

  override scoreLineMilestones(context: AIPlanningContext = {}) {
    return scoreTechZeroLineMilestones(context);
  }

  override scoreLineTerminal(context: AIPlanningContext = {}) {
    return scoreTechZeroLineTerminal(context);
  }

  override describePlannedLine(context: AIPlanningContext = {}) {
    return describeTechZeroPlannedLine(context);
  }

  analyzeGameState(game: AIState) {
    const { self: player } = resolvePerspectivePlayers(game, this.bot);
    return buildStrategyAnalysis({ game, strategy: this, player: player || this.bot });
  }

  policyContext(game?: AiStateInput, player: AiPlayerInput = this.bot, source?: AiCardInput, effect?: EffectDefinition): TechZeroPolicyContext {
    const { opponent } = resolvePerspectivePlayers(game, player);
    return { player, ...(opponent ? { opponent } : {}),
      ...getTechZeroPendingResources(game, player.id, source, effect?.id),
      ...getTechZeroVisibleBattlePolicy(game, player),
      ...(game?.turnCounter === undefined ? {} : { turnCounter: game.turnCounter }),
      ...(game?.phase ? { phase: game.phase } : {}) };
  }

  chooseSpecialSummonPosition(card: Parameters<typeof assessSummonEntry>[0], context: {
    game?: AIState; player?: AiPlayerInput; actionPosition?: BattlePositionInput | null | undefined;
    action?: NonNullable<Parameters<typeof assessSummonEntry>[1]>["action"];
  } = {}) {
    if (context.actionPosition === "attack" || context.actionPosition === "defense") return context.actionPosition;
    const { self, opponent } = resolvePerspectivePlayers(context.game, context.player || this.bot);
    return assessSummonEntry(card, { player: self, opponent, phase: context.game?.phase,
      action: context.action,
      profile: { isEnginePiece: candidate => candidate.archetype === "Tech-Zero",
        isBoss: candidate => (candidate.level || 0) >= 8 && candidate.monsterType === "synchro" },
    }).position;
  }

  buildActivationContextForEffect({ sourceCard, effect, player = this.bot, game, activationZone }: EffectChoiceInput = {}) {
    if (!sourceCard || !effect) return null;
    return {
      ...buildTechZeroActivationContext(sourceCard, effect, this.policyContext(game, player, sourceCard, effect)),
      effectId: effect.id,
      ...(activationZone && activationZone !== "temporary" ? { activationZone, sourceZone: activationZone } : {}),
    };
  }

  shouldActivateEffect({ sourceCard, effect, player = this.bot, game }: EffectChoiceInput): boolean {
    if (!sourceCard || !effect || effect.triggerRequirement !== "optional") return true;
    const decisions = this.buildActivationContextForEffect({ sourceCard, effect, player, game })?.decisions;
    if (effect.targets?.some(target => {
      const ids = decisions?.selections?.[target.id];
      const min = typeof target.count === "number" ? target.count : target.count?.min ?? 1;
      return ids !== undefined && ids.length < min;
    })) return false;
    if (sourceCard.id === TZ.CORE && effect.id === "tech_zero_energy_core_level_mod")
      return Object.keys(decisions?.cases || {}).length > 0;
    if ([TZ.GHOST, TZ.KAISER, TZ.PORTAL].some(id => id === sourceCard.id) ||
        (sourceCard.id === TZ.ELECTROCATAPULT && effect.id === "tech_zero_electrocatapult_normal_summon") ||
        (sourceCard.id === TZ.PRISM && effect.id === "tech_zero_prism_activator_synchro_summon")) {
      const groups = [...Object.values(decisions?.selections || {}), ...Object.values(decisions?.specialSummons || {})];
      if (groups.length) return groups.some(ids => ids.length > 0);
    }
    return true;
  }

  override generateMainPhaseActions(game: AIState): AIAction[] {
    const analysis = this.analyzeGameState(game);
    const player = analysis.player;
    if (!player || (game.phase !== "main1" && game.phase !== "main2") || game.turn !== player.id) return [];
    const { self: normalSummonPlayer } = resolvePerspectivePlayers(game, player);
    const policy = this.policyContext(game, player);
    const context = (card: AiCardInput, effect: EffectDefinition | null, zone: CanonicalZone) =>
      this.buildActivationContextForEffect({ sourceCard: card, effect, player, game, activationZone: zone });
    const useful = (card: AiCardInput, effect: EffectDefinition, activation: AIActivationContext | null) => {
      if (card.effectsNegated || !this.shouldActivateEffect({ sourceCard: card, effect, player, game })) return false;
      if (card.id === TZ.MULTIMODAL && !Object.keys(activation?.decisions?.cases || {}).length) return false;
      if (effect.targets?.some(target => {
        const ids = activation?.decisions?.selections?.[target.id];
        const min = typeof target.count === "number" ? target.count : target.count?.min ?? 1;
        return ids !== undefined && ids.length < min;
      })) return false;
      if (game._isPerspectiveState) {
        if (!canUseSimulatedEffectUsage(game, effect, card, player.id, true)) return false;
        if (!evaluateSimulatedConditions(effect.conditions, { state: game, selfId: "bot", sourceCard: card })) return false;
      }
      return true;
    };
    const actions: AIAction[] = getGenericNormalSummonActions({
      player,
      analysis: { canNormalSummon: analysis.summonAvailable, fieldCapacity: Math.max(1, 5 - player.field.length) },
      getTributeRequirement: getTributeRequirementFor,
      shouldSummon: (card, _analysis, info) => {
        const needed = info.tributesNeeded || 0;
        const { indices: tributes } = selectPayableTributes(player, player.field, game,
          candidates => selectTechZeroTributes(candidates, needed, card));
        return { yes: canUseNormalSummonForCard(normalSummonPlayer, card) &&
          getTributeValueTotal(getTributeCardsFromIndices(player.field, tributes), card) >= needed &&
          player.field.length - tributes.length < 5, priority: scoreTechZeroSummon(card, policy) / 10,
          position: this.chooseSpecialSummonPosition(card, { game, player }) };
      },
    }).flatMap(action => (["attack", "defense"] as const).map(position => ({
      ...action, position, facedown: position === "defense",
      priority: (action.priority || 0) - (position === action.position ? 0 : 0.1),
    })));
    actions.push(...getGenericHandSpellActions({
      game, player,
      shouldPlay: card => {
        const effect = findSpellActivationEffect(card);
        const decision = card.id === TZ.ASSEMBLY ? shouldUseTechZeroAssembly(policy) : { allow: true, reason: "Support the available Tech-Zero resources" };
        const activation = context(card, effect, "hand");
        return { yes: decision.allow && (effect ? useful(card, effect, activation) : card.subtype === "field"),
          priority: card.id === TZ.ASSEMBLY ? 7 : 4, reason: decision.reason };
      },
      buildActivationContext: card => context(card, findSpellActivationEffect(card), "hand"),
      canActivate: ({ card, activationContext }) => canActivateSpellFromHand(game, card, player, activationContext),
    }));
    actions.push(...getGenericHandSummonProcedureActions(game).map(action => ({
      ...action, priority: 6,
      position: this.chooseSpecialSummonPosition(player.hand[action.index ?? -1], { game, player }),
    })));
    for (const zone of ["hand", "field", "graveyard", "spellTrap", "fieldSpell"] as const) {
      const cards = zone === "fieldSpell" ? (player.fieldSpell ? [player.fieldSpell] : []) : player[zone];
      const type = zone === "hand" ? "handIgnition" : zone === "field" ? "monsterEffect"
        : zone === "graveyard" ? "graveyardMonsterEffect" : zone === "spellTrap" ? "spellTrapEffect" : "fieldEffect";
      const ignitionActions = getGenericIgnitionEffectActions({
        game, player, cards, type, sourceZone: zone,
        indexFields: zone === "field" ? ["fieldIndex"] : zone === "graveyard" ? ["graveyardIndex"] : ["index"],
        findEffect: card => findIgnitionEffect(card, zone), includeEffectId: true,
        shouldActivate: (card, _analysis, input) => ({ yes: useful(card, input.effect, context(card, input.effect, zone)),
          priority: card.id === TZ.MULTIMODAL ? 9 : 6 }),
        buildActivationContext: (card, _analysis, input) => context(card, input.effect, zone),
        canActivate: ({ card, activationContext }) => card.cardKind === "monster"
          ? canActivateMonsterEffect(game, card, player, zone, activationContext)
          : canActivateSpellTrapEffect(game, card, player, zone, activationContext),
      });
      for (const action of ignitionActions) {
        const card = action.type === "monsterEffect" ? cards[action.fieldIndex ?? -1] : undefined;
        if (zone !== "field" || card?.id !== TZ.MULTIMODAL || action.effectId !== "tech_zero_multimodal_machine_level_mod") {
          actions.push(action);
          continue;
        }
        const effect = findIgnitionEffect(card, zone);
        if (!effect) continue;
        for (const adjustment of enumerateTechZeroLevelAdjustments(card, player.field, policy)) {
          const activationContext = { ...buildTechZeroActivationContext(card, effect, policy, adjustment),
            activationZone: zone, sourceZone: zone };
          if (useful(card, effect, activationContext) && canActivateMonsterEffect(game, card, player, zone, activationContext))
            actions.push({ ...action, activationContext });
        }
      }
    }
    actions.push(...getGenericSynchroActions(game).map(action => ({ ...action,
      priority: scoreTechZeroSynchro(action, policy,
        this.chooseSpecialSummonPosition(player.extraDeck.find(card => card.instanceId === action.synchroInstanceId), { game, player })),
      reason: "Convert exact materials into a legal Tech-Zero Synchro" })));
    actions.push(...getGenericSetBackrowActions({ game, player, opponent: analysis.opponent,
      policy: { acceptsCard: card => card.cardKind === "trap" } }));
    return this.sequenceActions(actions);
  }

  override sequenceActions(actions: AIAction[]) {
    return actions.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  override getTributeRequirementFor(card: SimulatedCardState, player: SimulatedPlayerState) {
    return getTributeRequirementFor(card, player);
  }

  override selectBestTributes(field: SimulatedCardState[], count: number, card: SimulatedCardState) {
    return selectTechZeroTributes(field, count, card);
  }

  override simulateMainPhaseAction(state: Parameters<BaseStrategy["simulateMainPhaseAction"]>[0], action: AIPlannedAction) {
    if (action.type === "simulatedBattle") return state;
    return applyGenericSimulatedMainPhaseAction(state, action, {
      ...this.getPlanningSimulationOptions(state), activationContext: action.activationContext,
    });
  }

  getPlanningSimulationOptions(_state: Parameters<BaseStrategy["simulateMainPhaseAction"]>[0]) {
    return buildTechZeroSimulationOptions(this);
  }
}
