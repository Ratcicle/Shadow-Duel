import { resolvePerspectivePlayers } from "./perspective.js";
import { createPlanningCopy } from "./planningCopy.js";
import {
  PLANNING_PLAYER_FIELDS,
  PLANNING_STATE_FIELDS,
} from "./stateFingerprint.js";
import type {
  AiStateInput,
  AiPlayerInput,
  GameTreeActorState,
  GameTreeSimulationGameState,
  GameTreeSimulatedPlayerState,
} from "../../contracts/aiState.js";

// These existing simulator fields belong to the current bot, unlike Dragon /
// material / passive ledgers, whose keys already identify physical players.
export const GAME_TREE_ACTOR_FIELDS = [
  "_simOptUsed",
  "_simArcanistOptUsed",
  "_simLuminarch",
  "_simBurningWest",
  "_simGrandLibraryBattleRewardUsed",
  "_simArcanistApprenticeSearchUsed",
  "_simArcanistSpellActivations",
  "_simVoidBeastSearchUsed",
  "_simVoidHollowRecruitUsed",
] as const satisfies readonly (keyof GameTreeActorState)[];

/** GameTree's own profile; shared graph copying does not select Beam's fields. */
export function createGameTreeCopy(
  input: AiStateInput & { currentPlayer?: AiPlayerInput | null },
  perspective = input.bot || input.currentPlayer,
) {
  const copy = createPlanningCopy(true);
  const clonePlayer = (
    source: AiStateInput["bot"],
  ): GameTreeSimulatedPlayerState => {
    const safe = source || {};
    const result: GameTreeSimulatedPlayerState = {
      id: safe.id || "unknown",
      lp: safe.lp || 0,
      hand: (safe.hand || []).map(copy.cloneCardForSim),
      field: (safe.field || []).map(copy.cloneCardForSim),
      spellTrap: (safe.spellTrap || []).map(copy.cloneCardForSim),
      fieldSpell: safe.fieldSpell
        ? copy.cloneCardForSim(safe.fieldSpell)
        : null,
      // Generic search/draw, GY effects and Extra Deck procedures consume these.
      deck: (safe.deck || []).map(copy.cloneCardForSim),
      graveyard: (safe.graveyard || []).map(copy.cloneCardForSim),
      banished: (safe.banished || []).map(copy.cloneCardForSim),
      extraDeck: (safe.extraDeck || []).map(copy.cloneCardForSim),
      summonCount: safe.summonCount || 0,
      additionalNormalSummons: safe.additionalNormalSummons || 0,
    };
    // Player summon legality, activation restrictions, passive usage and stats.
    copy.copyFields(safe, result, [...PLANNING_PLAYER_FIELDS, "name", "debug"]);
    return result;
  };
  const resolved = resolvePerspectivePlayers(input, perspective);
  const state = {
    bot: clonePlayer(resolved.self || input.bot || input.currentPlayer || input.player),
    player: clonePlayer(resolved.opponent || input.player || input.opponent || input.bot),
    turn: input.turn,
    phase: input.phase,
    turnCounter: input.turnCounter || 0,
    _isPerspectiveState: true,
    _gameRef: input._gameRef || input,
  } as GameTreeSimulationGameState;
  copy.copyFields(
    input,
    state,
    PLANNING_STATE_FIELDS.filter((key) => key !== "_isPerspectiveState"),
  );
  // Only supplied material history is available to Dragon / Void policies.
  copy.copyFields(input, state, [
    "materialDuelStats",
    "_gameTreeActors",
    "_simUnsupportedActions",
  ]);
  state._gameTreeActors ||= { [state.bot.id]: {}, [state.player.id]: {} };
  const previousActor = input.bot?.id || input.currentPlayer?.id || "unknown";
  const previous: GameTreeActorState = {};
  copy.copyFields(input, previous, GAME_TREE_ACTOR_FIELDS);
  state._gameTreeActors[previousActor] = previous;
  for (const key of GAME_TREE_ACTOR_FIELDS) delete state[key];
  const active = state._gameTreeActors[state.bot.id] || {};
  for (const key of GAME_TREE_ACTOR_FIELDS) {
    if (key in active) Reflect.set(state, key, active[key]);
  }
  return { state, copyAction: copy.copyValue };
}

/** Never let strategy fallbacks hydrate a projected node from the live duel. */
export function withoutLiveGameReference<Result>(
  state: GameTreeSimulationGameState,
  run: () => Result,
): Result {
  const external = state._gameRef;
  delete state._gameRef;
  try {
    return run();
  } finally {
    if (external !== undefined) state._gameRef = external;
  }
}
