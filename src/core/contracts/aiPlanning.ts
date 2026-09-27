import type { AIAction } from "./ai.js";
import type { GameTreeSimulationGameState, PerspectiveGameState, SimulationGameState, TurnLineSimulationGameState } from "./aiState.js";
import type { applyGenericSimulatedMainPhaseAction } from "../ai/common/simulation.js";

export type PlanningSimulationOptions = NonNullable<Parameters<typeof applyGenericSimulatedMainPhaseAction>[2]>;

export type PlanningSimulationState = GameTreeSimulationGameState | (TurnLineSimulationGameState & {
  _isPerspectiveState: true;
  turnCounter: number;
});

/** A fresh instance bound exclusively to the supplied planning snapshot. */
export interface PlanningStrategy<Action extends AIAction = AIAction> {
  generateMainPhaseActions(state: GameTreeSimulationGameState): Action[];
  simulateMainPhaseAction(state: GameTreeSimulationGameState, action: Action): GameTreeSimulationGameState | SimulationGameState | PerspectiveGameState | void;
  getPlanningSimulationOptions?(state: PlanningSimulationState): PlanningSimulationOptions;
}

export interface PlanningModel<Action extends AIAction = AIAction> {
  readonly id: string;
  create(state: PlanningSimulationState): PlanningStrategy<Action>;
}

export interface GameTreeModels<Action extends AIAction = AIAction> {
  readonly root: PlanningModel<Action>;
  readonly actors: ReadonlyMap<string, PlanningModel>;
}
