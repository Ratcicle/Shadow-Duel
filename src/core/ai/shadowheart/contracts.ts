import type { AIState, AIPlanningProfile } from "../../contracts/ai.js";
import type { GameCard } from "../../contracts/cards.js";
import type { SimulatedCardShape } from "../../contracts/aiState.js";
import type { buildStrategyAnalysis } from "../common/analysis.js";

/** Read projections used by the facade summaries and simulated boards. */
export type ShadowHeartCard = (GameCard | SimulatedCardShape) & { cannotBeDestroyedByBattle?: boolean };
export type ShadowHeartPlanningGame = Partial<AIState> & {
  devModeEnabled?: boolean;
  turnLineSearchEnabled?: boolean;
  turnLineSearchTurnMode?: AIPlanningProfile["turnMode"];
  turnLineSearchBeamWidth?: number;
  turnLineSearchNodeBudget?: number;
  turnLineSearchCandidateLimit?: number;
};
export type ShadowHeartAnalysis = Omit<
  Partial<ReturnType<typeof buildStrategyAnalysis>>,
  "hand" | "field" | "oppField" | "fieldSpell" | "oppHand" | "game"
> & {
  hand?: ShadowHeartCard[];
  field?: ShadowHeartCard[];
  oppField?: ShadowHeartCard[];
  fieldSpell?: ShadowHeartCard | string | null;
  oppHand?: number | ShadowHeartCard[];
  game?: ShadowHeartPlanningGame | null;
  canNormalSummon?: boolean;
};
