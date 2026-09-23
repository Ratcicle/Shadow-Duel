import type { SimulatedPlayerState } from "../../contracts/aiState.js";
import type {
  SimulatedOwnerPolicy,
  SimulatedRuntimeState,
} from "./simulatedActions/shared.js";

export type PlanningOwnerPolicyResolver = (
  state: SimulatedRuntimeState,
  owner: SimulatedPlayerState,
) => SimulatedOwnerPolicy | null;

// The resolver belongs to the synchronous execution, never to cloneable state.
const executionResolvers = new WeakMap<object, PlanningOwnerPolicyResolver>();
const executionViews = new WeakMap<object, SimulatedRuntimeState>();

export function registerPlanningExecutionView(
  view: SimulatedRuntimeState,
  sourceState: SimulatedRuntimeState,
): void {
  if (view !== sourceState) executionViews.set(view, executionViews.get(sourceState) || sourceState);
}

export function hasPlanningExecutionContext(state: object): boolean {
  return executionResolvers.has(state) || executionResolvers.has(executionViews.get(state) || state);
}

export function withPlanningExecutionContext<Result>(
  state: SimulatedRuntimeState,
  resolver: PlanningOwnerPolicyResolver,
  run: () => Result,
): Result {
  const previous = executionResolvers.get(state);
  executionResolvers.set(state, resolver);
  try {
    return run();
  } finally {
    if (previous) executionResolvers.set(state, previous);
    else executionResolvers.delete(state);
  }
}

export function resolvePlanningOwnerPolicy(
  state: SimulatedRuntimeState,
  owner: SimulatedPlayerState,
): SimulatedOwnerPolicy | null | undefined {
  const source = executionResolvers.has(state) ? state : executionViews.get(state) || state;
  return executionResolvers.get(source)?.(source, owner);
}
