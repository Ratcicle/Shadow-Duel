import type { AiStateShape, SimulatedCardState, SimulatedPlayerState } from "../../contracts/aiState.js";
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

/** The simulated state behind a planning owner view (the state itself otherwise). */
export function resolvePlanningExecutionState(state: object): object {
  return executionViews.get(state) || state;
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

function collectUnknownCardLocations(
  state: Pick<AiStateShape, "bot" | "player">,
): Map<SimulatedCardState, string> {
  const locations = new Map<SimulatedCardState, string>();
  for (const player of [state.bot, state.player]) {
    for (const zone of PLANNING_ZONES) {
      for (const card of player[zone]) if (card._simUnknownCard) {
        locations.set(card, `${player.id}:${zone}:${card.isFacedown === true}`);
      }
    }
    if (player.fieldSpell?._simUnknownCard) {
      locations.set(player.fieldSpell, `${player.id}:fieldSpell:${player.fieldSpell.isFacedown === true}`);
    }
  }
  return locations;
}

/** Requests a replan when an opaque card moves or changes face: the real card is unknown. */
export function runWithUnknownLocationGuard<Result>(
  state: Pick<AiStateShape, "bot" | "player" | "_simRequiresReplan">,
  run: () => Result,
): Result {
  const before = collectUnknownCardLocations(state);
  const result = run();
  const after = collectUnknownCardLocations(state);
  if ([...before].some(([card, location]) => after.get(card) !== location)) {
    state._simRequiresReplan = true;
  }
  return result;
}
