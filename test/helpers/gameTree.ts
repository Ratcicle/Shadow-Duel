import { gameTreeSearch as search } from "../../src/core/ai/GameTreeSearch.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import type { AiStateInput } from "../../src/core/contracts/aiState.js";
import type { PlanningModel } from "../../src/core/contracts/aiPlanning.js";
import { unsafeFixture } from "./fixtures.js";

/** Explicit identical models for legacy, stateless search-mechanics fixtures.
 * Real strategy construction/isolation is exercised in gameTreeModels/planningStrategies.
 */
export function fixtureGameTreeSearch<State extends AiStateInput, Action extends AIAction>(
  ...[state, strategy, perspective, depth]: Parameters<typeof search<State, Action>>
) {
  const model: PlanningModel<Action> = {
    id: "stateless-test-policy",
    create: () => ({
      generateMainPhaseActions(snapshot) {
        return strategy.generateMainPhaseActions(unsafeFixture<State>(snapshot, "Stateless fixture accepts the planner projection"));
      },
      simulateMainPhaseAction(snapshot, action) {
        return strategy.simulateMainPhaseAction(snapshot, action);
      },
    }),
  };
  return search(state, {
    ...strategy,
    bot: {
      debug: strategy.bot?.debug ?? false,
      getGameTreeModels: () => ({
        root: model,
        actors: new Map([state.bot, state.player, state.opponent, perspective].flatMap(player => player?.id ? [[player.id, model] as const] : [])),
      }),
    },
  }, perspective, depth);
}
