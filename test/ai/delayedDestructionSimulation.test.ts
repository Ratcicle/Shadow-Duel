import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { processSimulatedDelayedActions } from "../../src/core/ai/common/simulatedActions/lifecycle.js";
import { cardDefinition } from "../helpers/fixtures.js";
import { simulationState } from "../helpers/simulation.js";

function fixture(sourceOwner: "self" | "opponent" | "unknown") {
  const copy = createPlanningCopy();
  const target = copy.cloneCardForSim(new Card(cardDefinition(501), "bot"));
  const source = copy.cloneCardForSim(new Card(cardDefinition(502), sourceOwner === "self" ? "bot" : "player"));
  const state = simulationState({ turnCounter: 4, bot: { field: [target] } });
  const sourcePlayer = sourceOwner === "unknown" ? null : sourceOwner === "self" ? state.bot : state.player;
  state.delayedActions = [{ id: "destroy:one", actionType: "delayed_destroy",
    triggerCondition: { phase: "end", player: "player" }, scheduledTurn: 4, priority: 0,
    payload: { card: target, owner: "bot", sourceCard: source, sourcePlayer } }];
  return { state, target, source };
}

for (const sourceOwner of ["self", "opponent"] as const) {
  test(`delayed destruction respects opponent-only protection against a ${sourceOwner} source`, () => {
    const { state, target, source } = fixture(sourceOwner);
    target.protectionEffects = [{ type: "effect_destruction", source: "fixture", sourceOwner: "opponent",
      duration: "end_of_next_turn", grantedOnTurn: 4, expiresOnTurn: 5, removeOnLeave: true }];
    const events: string[] = [];
    processSimulatedDelayedActions(state, "end", "player", { emitSimulatedEvent(event, payload) {
      assert.equal(Reflect.get(payload, "sourceCard"), source);
      assert.equal(state.bot.field.length, 0);
      assert.equal(state.bot.graveyard[0], target);
      events.push(event);
    } });
    assert.equal(state.bot.field.includes(target), sourceOwner === "opponent");
    assert.deepEqual(events, sourceOwner === "opponent" ? [] : ["card_to_grave", "card_moved"]);
    assert.deepEqual(state.delayedActions, []);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });
}

test("delayed destruction waits for its exact phase/seat and ignores a card already off field", () => {
  const { state, target } = fixture("self");
  processSimulatedDelayedActions(state, "standby", "player");
  processSimulatedDelayedActions(state, "end", "bot");
  assert.equal(state.delayedActions?.length, 1);
  state.bot.field = [];
  state.bot.hand.push(target);
  processSimulatedDelayedActions(state, "end", "player", { emitSimulatedEvent() { assert.fail("off-field target must not move"); } });
  assert.equal(state.bot.hand[0], target);
  assert.deepEqual(state.delayedActions, []);
});

test("delayed destruction reports an unknown source player instead of inventing one", () => {
  const { state, target } = fixture("unknown");
  processSimulatedDelayedActions(state, "end", "player");
  assert.equal(state.bot.field[0], target);
  assert.deepEqual(state.delayedActions, []);
  assert.deepEqual(state._simUnsupportedActions, ["delayed_destroy_source_player"]);
});
