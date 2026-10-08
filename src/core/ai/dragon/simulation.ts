import type { MaterialDuelStats } from "../../contracts/gameRuntime.js";
import type { AIPlannedAction } from "../../contracts/ai.js";
import type {
  AiLiveGamePort,
  SimulatedCardState,
  SimulatedPlayerState,
  SimulationGameState,
} from "../../contracts/aiState.js";
import { applyGenericSimulatedMainPhaseAction } from "../common/simulation.js";
import { placeSimulatedSpellCard } from "../common/zones.js";
import type { DragonPlayer as DragonReadPlayer } from "./contracts.js";
import { selectBestTributes } from "./priorities.js";
import { rankDragonSearchCandidates } from "./searchPolicy.js";
import { evaluateDragonRecruitCandidate } from "./actionPolicy.js";


type DragonCounterObject = Partial<Record<string, number>>;
type DragonCard = Omit<SimulatedCardState, "counters"> & {
  counters?: ReadonlyMap<string, number> | DragonCounterObject;
};

function normalizeDragonCounters(counters: DragonCard["counters"]): Map<string, number> {
  return counters instanceof Map
    ? counters
    : new Map(Object.entries(counters || {}).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
}
type DragonPlayer = Omit<
  SimulatedPlayerState,
  | "hand"
  | "field"
  | "graveyard"
  | "deck"
  | "extraDeck"
  | "banished"
  | "fieldSpell"
  | "spellTrap"
> & {
  hand: DragonCard[];
  field: DragonCard[];
  graveyard: DragonCard[];
  deck: DragonCard[];
  extraDeck: DragonCard[];
  banished: DragonCard[];
  fieldSpell: DragonCard | null;
  spellTrap: DragonCard[];
};

/** Bridge legacy counter objects without replacing cards referenced by delayed actions. */
function sharedSimulationPlayer(player: DragonPlayer): SimulatedPlayerState {
  const normalize = (card: DragonCard): SimulatedCardState =>
    Object.assign(card, { counters: normalizeDragonCounters(card.counters) });
  return Object.assign(player, {
    hand: player.hand.map(normalize), field: player.field.map(normalize),
    graveyard: player.graveyard.map(normalize), deck: player.deck.map(normalize),
    extraDeck: player.extraDeck.map(normalize), banished: player.banished.map(normalize),
    spellTrap: player.spellTrap.map(normalize),
    fieldSpell: player.fieldSpell ? normalize(player.fieldSpell) : null,
  });
}

/** Keep live Game references outside the shared simulation boundary. */
function sharedDragonSimulationState(state: DragonSimulationState) {
  const { _gameRef: _liveGameRef, ...simulatedState } = state;
  return {
    ...simulatedState,
    bot: sharedSimulationPlayer(state.bot), player: sharedSimulationPlayer(state.player),
    opponent: state.opponent ? sharedSimulationPlayer(state.opponent) : null,
  };
}

type DragonMaterialStats = MaterialDuelStats;

interface DragonGameReference extends Omit<AiLiveGamePort, "player" | "bot" | "_gameRef"> {
  player: DragonReadPlayer;
  bot: DragonReadPlayer;
  _gameRef?: DragonGameReference;
  materialDuelStats?: DragonMaterialStats;
}

type DragonSimulationState = Omit<
  SimulationGameState,
  | "player"
  | "bot"
  | "opponent"
  | "_gameRef"
> & {
  player: DragonPlayer;
  bot: DragonPlayer;
  opponent?: DragonPlayer | null;
  _gameRef?: DragonGameReference;
  game?: DragonGameReference | null;
  materialDuelStats?: DragonMaterialStats;
};

/**
 * Simulates a main-phase action on a cloned game state.
 * @param state Cloned game state.
 * @param action Action to simulate.
 * @returns Modified state.
 */
export function simulateMainPhaseAction<State extends DragonSimulationState>(
  state: State,
  action: AIPlannedAction,
  options: NonNullable<Parameters<typeof applyGenericSimulatedMainPhaseAction>[2]> = {},
): State {
  if (!action || !state?.bot) return state;
  switch (action.type) {
    case "summon":
    case "set_spell_trap":
    case "position_change":
    case "handSummonProcedure":
    case "ascension":
    case "synchro":
    case "extraDeckProcedure":
    case "spell":
    case "handIgnition":
    case "graveyardMonsterEffect":
    case "spellTrapEffect":
    case "fieldEffect":
    case "monsterEffect":
    case "graveyardSpellEffect": {
      const shared = sharedDragonSimulationState(state);
      const sharedOptions: NonNullable<Parameters<typeof applyGenericSimulatedMainPhaseAction>[2]> = {
        selectBestTributes: (field, tributesNeeded, card, context) => selectBestTributes(field, tributesNeeded, card, {
          player: context.botState, bot: context.botState, opponent: { field: context.oppField }, game: shared,
        }),
        rankSearchCandidates: rankDragonSearchCandidates,
        evaluateRecruitCandidate: evaluateDragonRecruitCandidate,
        placeSpellCard: placeSimulatedSpellCard,
        ...options,
        enableSimulatedEvents: true,
      };
      applyGenericSimulatedMainPhaseAction(shared, action, sharedOptions);
      Object.assign(state, shared);
      return state;
    }
  }

  switch (action.type) {
    // These variants retain the existing no-op in Dragon's main-phase simulation.
    case "special_summon_sanctum_protector":
    case "simulatedBattle":
      break;
    default:
      action satisfies never;
  }

  return state;
}
