import assert from "node:assert/strict";
import Card from "../../src/core/Card.js";
import type { SimulatedRuntimeStateFields } from "../../src/core/ai/common/simulatedActions/shared.js";
import type {
  AiCardInput,
  SimulatedCardShape,
  SimulatedCardState,
  SimulationGameState,
} from "../../src/core/contracts/aiState.js";
import type { CardConstructorData } from "../../src/core/contracts/cards.js";

type CardInput = AiCardInput &
  Omit<
    Partial<SimulatedCardShape>,
    keyof AiCardInput | keyof CardConstructorData
  > &
  Omit<CardConstructorData, keyof AiCardInput>;

/** Direct simulation fixtures have no live Card aliases. The brand is type-only. */
export function simulationCard(card: CardInput | Card): SimulatedCardState {
  if (card instanceof Card) {
    assert.ok(
      Reflect.get(card, "game") == null,
      "A simulation fixture cannot alias a live Game.",
    );
    assert.equal(card.equips.length, 0);
    assert.equal(card.equippedTo, null);
    assert.ok(card.equipTarget == null || typeof card.equipTarget !== "object");
  }
  return card as SimulatedCardState;
}

type DragonState = Parameters<
  typeof import("../../src/core/ai/dragon/simulation.js").simulateMainPhaseAction
>[0];
type FixtureState = SimulationGameState &
  DragonState &
  SimulatedRuntimeStateFields;
type FixturePlayer = FixtureState["player"] & { id: "player" | "bot" };

function simulationPlayer(
  id: "player" | "bot",
  values: Partial<FixturePlayer> = {},
): FixturePlayer {
  return {
    id,
    lp: 8000,
    hand: [],
    field: [],
    graveyard: [],
    deck: [],
    extraDeck: [],
    banished: [],
    spellTrap: [],
    fieldSpell: null,
    summonCount: 0,
    additionalNormalSummons: 0,
    ...values,
  };
}

type StateInput = Partial<Omit<FixtureState, "player" | "bot">> & {
  player?: Partial<FixturePlayer>;
  bot?: Partial<FixturePlayer>;
};

export function simulationState(
  values: StateInput = {},
): FixtureState & { player: FixturePlayer; bot: FixturePlayer } {
  const state = {
    turn: null,
    phase: null,
    turnCounter: 0,
    ...values,
    player: simulationPlayer("player", values.player),
    bot: simulationPlayer("bot", values.bot),
  };
  return state as FixtureState & { player: FixturePlayer; bot: FixturePlayer };
}
