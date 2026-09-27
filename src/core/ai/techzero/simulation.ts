import type TechZeroStrategy from "../TechZeroStrategy.js";
import type { SynchroAIAction } from "../../contracts/ai.js";
import type { PlanningSimulationOptions } from "../../contracts/aiPlanning.js";
import { scoreTechZeroSynchro as scoreSynchroDestination, type TechZeroPolicyContext } from "./priorities.js";
import type { BattlePosition } from "../../contracts/cards.js";

/** Configure shared simulation; all card effects still come from the catalog. */
export function buildTechZeroSimulationOptions(strategy: TechZeroStrategy): PlanningSimulationOptions {
  return {
    strategy, selfId: "bot", archetype: "Tech-Zero", guardLabel: "TechZeroStrategy", enableSimulatedEvents: true,
    getTributeRequirementFor: strategy.getTributeRequirementFor.bind(strategy),
    selectBestTributes: strategy.selectBestTributes.bind(strategy),
    placeSpellCard: strategy.placeSpellCard.bind(strategy),
    chooseSpecialSummonPosition: strategy.chooseSpecialSummonPosition.bind(strategy),
    shouldActivateEffect: input => strategy.shouldActivateEffect({ ...input, game: input.state }),
  };
}

/** Initial ordering only. Turn-line search and combo milestones belong to Task 5. */
export function scoreTechZeroSynchro(action: SynchroAIAction, context: TechZeroPolicyContext, preferredPosition: BattlePosition = "attack"): number {
  const card = context.player.extraDeck?.find(candidate => candidate.instanceId === action.synchroInstanceId);
  if (!card) return 0;
  const materialCost = action.materialInstanceIds.reduce<number>((sum, id) => {
    const material = context.player.field?.find(candidate => candidate.instanceId === id);
    return sum + (material?.monsterType === "synchro" ? 0.6 : 0.1);
  }, 0);
  return scoreSynchroDestination(card, context) / 10 - materialCost - (action.position === preferredPosition ? 0 : 0.1);
}
