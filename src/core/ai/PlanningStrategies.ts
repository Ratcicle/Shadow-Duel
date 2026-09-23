import BaseStrategy from "./BaseStrategy.js";
import { resolveRegisteredStrategy } from "./StrategyRegistry.js";
import { getGenericNormalSummonActions } from "./common/actionGeneration.js";
import { getGenericSetBackrowActions } from "./common/backrowPlanning.js";
import { applyGenericSimulatedMainPhaseAction } from "./common/simulation.js";
import { getTributeRequirementFor, selectBestTributes } from "./common/tributePolicy.js";
import { canUseNormalSummonForCard } from "../Player.js";
import { fieldHasTributeValue } from "../game/summon/tributeValue.js";
import type { AIAction } from "../contracts/ai.js";
import type {
  GameTreeModels, PlanningModel, PlanningSimulationOptions, PlanningStrategy,
} from "../contracts/aiPlanning.js";
import type { GameTreeSimulationGameState } from "../contracts/aiState.js";

export interface PlanningParticipant {
  readonly id: string;
  readonly modelId: string | null;
}

/** Conservative shared policy for actors without an explicit registered model. */
class GenericPlanningStrategy implements PlanningStrategy {
  readonly base: BaseStrategy;

  constructor(state: GameTreeSimulationGameState) {
    this.base = new BaseStrategy(state.bot);
  }

  generateMainPhaseActions(state: GameTreeSimulationGameState): AIAction[] {
    const player = state.bot;
    const actions: AIAction[] = getGenericNormalSummonActions({
      player,
      analysis: {
        canNormalSummon: player.hand.some(card => canUseNormalSummonForCard(player, card)),
        // Tribute summons may free a full board; the per-card policy checks space.
        fieldCapacity: Math.max(1, 5 - player.field.length),
      },
      getTributeRequirement: getTributeRequirementFor,
      shouldSummon: (card, _analysis, tributeInfo) => {
        const needed = tributeInfo.tributesNeeded || 0;
        const tributes = selectBestTributes(player.field, needed, card);
        return {
          yes: !card.summonRestrict &&
            canUseNormalSummonForCard(player, card) &&
            fieldHasTributeValue(player.field, needed, card) &&
            player.field.length - tributes.length < 5 &&
            !(card.fieldLimit || card.fieldPresenceRestriction),
          priority: Math.max(1, (card.atk || 0) / 1000),
          position: "attack",
        };
      },
    });
    actions.push(...getGenericSetBackrowActions({
      player, game: state, opponent: state.player,
      policy: { acceptsCard: card => card.cardKind === "trap" && !card.fieldLimit && !card.fieldPresenceRestriction },
    }));
    actions.push(...this.base.getPositionChangeActions(state, player, state.player)
      .filter(action => {
        // This shared generator emits definition IDs/names, not instance IDs.
        // Do not let an ambiguous copy resolve to a different, illegal monster.
        const matches = player.field.filter(card => action.cardId
          ? card.id === action.cardId
          : card.name === action.cardName);
        return matches.length === 1 && matches[0]?.battlePositionLocked !== true;
      }));
    if (actions.length === 0) {
      throw new Error(`Planning model unavailable for ${player.id}: generic policy has no supported legal action`);
    }
    return actions.sort((left, right) => (right.priority || 0) - (left.priority || 0));
  }

  getPlanningSimulationOptions(_state: GameTreeSimulationGameState): PlanningSimulationOptions {
    return {
      guardLabel: "GenericPlanningStrategy",
      selfId: "bot",
      enableSimulatedEvents: true,
      getTributeRequirementFor,
      selectBestTributes: (field, count, card) => selectBestTributes(field, count, card),
      placeSpellCard: this.base.placeSpellCard.bind(this.base),
    };
  }

  simulateMainPhaseAction(state: GameTreeSimulationGameState, action: AIAction) {
    if (!["summon", "set_spell_trap", "position_change"].includes(action.type)) {
      throw new Error(`Planning model unavailable for ${state.bot.id}: generic action ${action.type}`);
    }
    return applyGenericSimulatedMainPhaseAction(state, action, this.getPlanningSimulationOptions(state));
  }
}

/** Capture only the explicit ID and constructor; never a live Bot or strategy. */
export function getPlanningModel(id: string | null | undefined): PlanningModel {
  const StrategyClass = resolveRegisteredStrategy(id);
  if (!StrategyClass || !id) {
    return Object.freeze({
      id: "generic",
      create: (state: GameTreeSimulationGameState) => new GenericPlanningStrategy(state),
    });
  }
  return Object.freeze({
    id,
    create: (state: GameTreeSimulationGameState) => {
      const strategy = new StrategyClass(state.bot);
      strategy.analyzeGameState?.(state);
      return strategy;
    },
  });
}

export function createGameTreeModels(
  rootActorId: string,
  participants: readonly PlanningParticipant[],
): GameTreeModels {
  const actors = new Map<string, PlanningModel>();
  for (const participant of participants) {
    if (!participant.id || actors.has(participant.id)) {
      throw new Error(`Planning model unavailable: ambiguous actor ${participant.id}`);
    }
    actors.set(participant.id, getPlanningModel(participant.modelId));
  }
  const root = actors.get(rootActorId);
  if (!root) throw new Error(`Planning model unavailable: missing root actor ${rootActorId}`);
  return Object.freeze({ root, actors });
}
