import type { PlanningModel } from "../../contracts/aiPlanning.js";
import type { GameTreeSimulationGameState, SimulatedPlayerState } from "../../contracts/aiState.js";
import type { SimulatedOwnerPolicy } from "./simulatedActions/shared.js";
import { GAME_TREE_ACTOR_FIELDS } from "./gameTreeSimulation.js";
import { resolvePerspectiveSlotForPlayer } from "./perspective.js";
import { normalizePlanningOwnerPolicy } from "./simulation.js";
import { registerPlanningExecutionView } from "./planningExecution.js";

/** A decision view of the same branch graph, never another effect execution. */
function ownerView(state: GameTreeSimulationGameState, owner: SimulatedPlayerState): GameTreeSimulationGameState {
  const slot = resolvePerspectiveSlotForPlayer(state, owner);
  if (!slot) throw new Error(`Planning effect owner unavailable: ${owner.id}`);
  const actorKeys = new Set<string>(GAME_TREE_ACTOR_FIELDS);
  const actorData = () => {
    state._gameTreeActors ||= {};
    return state._gameTreeActors[owner.id] ||= {};
  };
  const view = new Proxy(state, {
    get(target, key) {
      if (key === "bot") return target[slot];
      if (key === "player") return target[slot === "bot" ? "player" : "bot"];
      if (key === "_gameRef") return undefined;
      if (key === "_isPerspectiveState" || key === "_suppressP2Analysis") return true;
      if (slot !== "bot" && typeof key === "string" && actorKeys.has(key)) return Reflect.get(actorData(), key);
      return Reflect.get(target, key);
    },
    set(target, key, value: unknown) {
      if (key === "bot") return Reflect.set(target, slot, value);
      if (key === "player") return Reflect.set(target, slot === "bot" ? "player" : "bot", value);
      if (slot !== "bot" && typeof key === "string" && actorKeys.has(key)) return Reflect.set(actorData(), key, value);
      return Reflect.set(target, key, value);
    },
    deleteProperty(target, key) {
      if (slot !== "bot" && typeof key === "string" && actorKeys.has(key)) return Reflect.deleteProperty(actorData(), key);
      return Reflect.deleteProperty(target, key);
    },
    has(target, key) {
      if (key === "_gameRef") return false;
      if (slot !== "bot" && typeof key === "string" && actorKeys.has(key)) return key in actorData();
      return key in target;
    },
    ownKeys(target) {
      const keys = Reflect.ownKeys(target).filter(key => key !== "_gameRef" &&
        !(slot !== "bot" && typeof key === "string" && actorKeys.has(key)));
      return slot === "bot" ? keys : [...keys, ...Object.keys(actorData())];
    },
    getOwnPropertyDescriptor(target, key) {
      if (key === "_gameRef") return undefined;
      if (slot !== "bot" && typeof key === "string" && actorKeys.has(key)) return Object.getOwnPropertyDescriptor(actorData(), key);
      return Object.getOwnPropertyDescriptor(target, key);
    },
  });
  registerPlanningExecutionView(view, state);
  return view;
}

export function createPlanningOwnerPolicy(
  state: GameTreeSimulationGameState,
  owner: SimulatedPlayerState,
  models: ReadonlyMap<string, PlanningModel>,
): SimulatedOwnerPolicy {
  const model = models.get(owner.id);
  if (!model) throw new Error(`Planning effect model unavailable: ${owner.id}`);
  const view = ownerView(state, owner);
  const strategy = model.create(view);
  const policy = normalizePlanningOwnerPolicy(strategy.getPlanningSimulationOptions?.(view) || {});
  const context = (input: object) => ({ ...input, state: view, game: view, selfId: "bot" });
  const result = { ...policy };
  if (policy.rankSearchCandidates) result.rankSearchCandidates = (cards, action, ctx) => policy.rankSearchCandidates!(cards, action, context(ctx));
  if (policy.evaluateRecruitCandidate) result.evaluateRecruitCandidate = (cards, ctx) => policy.evaluateRecruitCandidate!(cards, context(ctx));
  if (policy.chooseSpecialSummonPosition) result.chooseSpecialSummonPosition = (card, ctx) => policy.chooseSpecialSummonPosition!(card, context(ctx));
  if (policy.chooseActionCase) result.chooseActionCase = (cases, ctx) => policy.chooseActionCase!(cases, context(ctx));
  if (policy.evaluateSimulatedConditions) result.evaluateSimulatedConditions = (conditions, ctx) => policy.evaluateSimulatedConditions!(conditions, context(ctx));
  if (policy.onEffectActivated) result.onEffectActivated = payload => policy.onEffectActivated!(context(payload));
  if (policy.onAfterSpecialSummon) result.onAfterSpecialSummon = payload => policy.onAfterSpecialSummon!(context(payload));
  if (policy.onFusionSummon) result.onFusionSummon = payload => policy.onFusionSummon!(context(payload));
  if (policy.buildActivationContextForEffect) result.buildActivationContextForEffect = input => policy.buildActivationContextForEffect!({ ...input, game: view, player: view.bot });
  return result;
}
