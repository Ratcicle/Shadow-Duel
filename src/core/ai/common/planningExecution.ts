import type { SimulatedCardState, SimulatedPlayerState } from "../../contracts/aiState.js";
import { PLANNING_ZONES } from "./stateFingerprint.js";
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
const unknownCardExecutions = new WeakMap<object, SimulatedRuntimeState>();

/** An opaque card failing a filter does not establish that the real card fails. */
export function markPlanningUnknownCardRead(card: object): void {
  const state = unknownCardExecutions.get(card);
  if (state) state._simRequiresReplan = true;
}

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
  const previousCards = new Map<SimulatedCardState, SimulatedRuntimeState | undefined>();
  for (const player of [state.player, state.bot]) {
    for (const card of [...PLANNING_ZONES.flatMap(zone => player[zone]), player.fieldSpell]) {
      if (!card?._simUnknownCard || previousCards.has(card)) continue;
      previousCards.set(card, unknownCardExecutions.get(card));
      unknownCardExecutions.set(card, state);
    }
  }
  executionResolvers.set(state, resolver);
  try {
    return run();
  } finally {
    if (previous) executionResolvers.set(state, previous);
    else executionResolvers.delete(state);
    for (const [card, previousState] of previousCards) {
      if (previousState) unknownCardExecutions.set(card, previousState);
      else unknownCardExecutions.delete(card);
    }
  }
}

export function resolvePlanningOwnerPolicy(
  state: SimulatedRuntimeState,
  owner: SimulatedPlayerState,
): SimulatedOwnerPolicy | null | undefined {
  const source = executionResolvers.has(state) ? state : executionViews.get(state) || state;
  return executionResolvers.get(source)?.(source, owner);
}
