import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { ActionOf } from "../src/core/contracts/actions.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { evaluateSimulatedConditions } from "../src/core/ai/common/simulatedConditions.js";
import { moveCardToZone } from "../src/core/ai/common/zones.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "./helpers/game.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";

const key = "generic_search_provenance";
const effectId = "generic_marked_search";

function search(duration?: string): ActionOf<"add_from_zone_to_hand"> {
  return {
    type: "add_from_zone_to_hand", zone: "deck", count: { min: 1, max: 1 },
    filters: { cardKind: "monster" }, promptPlayer: true, selectionId: "marked_choice",
    markAddedCards: { key, sourceEffectId: effectId, ...(duration ? { duration } : {}) },
  };
}

function scenario(t: TestContext, seat: "player" | "bot") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false });
  t.after(() => game.dispose("effect_marker_lifetime"));
  game.disablePresentationDelays = true;
  game.turn = seat; game.turnCounter = 4; game.phase = "main1";
  game.player.controllerType = game.bot.controllerType = "ai";
  const owner = game[seat], source = new Card(cardDefinition(454), seat);
  const first = new Card(cardDefinition(1), seat), chosen = new Card(cardDefinition(1), seat);
  placeFieldCards(owner.field, source); owner.deck.push(first, chosen);
  return { game, owner, source, first, chosen };
}

for (const seat of ["player", "bot"] as const) {
  for (const duration of [undefined, "end_of_turn", "end_of_next_turn"] as const) {
    test(`search markers keep identity and their declared expiry (${seat}, ${duration ?? "omitted"})`, async t => {
      const { game, owner, source, first, chosen } = scenario(t, seat);
      const action = search(duration), effect = { id: effectId, timing: "manual" as const, activationZones: ["field"] as const, actions: [action] };
      await game.effectEngine.applyActions([action], { source, player: owner, opponent: game[seat === "player" ? "bot" : "player"],
        effect, activationContext: { decisions: { selections: { marked_choice: [chosen.instanceId] } } } }, {});
      assert.deepEqual(owner.hand, [chosen]);
      assert.deepEqual(owner.deck, [first]);
      assert.equal(first.effectMarkers, undefined);
      const marker = required(chosen.effectMarkers?.[key]);
      assert.equal(marker.sourceInstanceId, source.instanceId);
      assert.equal(marker.sourceCardId, source.id);
      assert.equal(marker.sourceEffectId, effectId);
      assert.equal(marker.controllerId, seat);

      const simSource = simulationCard(source), simFirst = simulationCard(first), simChosen = simulationCard(new Card(cardDefinition(1), seat));
      const state = simulationState({ turn: seat, turnCounter: 4, phase: "main1", [seat]: { field: [simSource], deck: [simFirst, simChosen] } });
      applySimulatedActions({ state, selfId: seat, actions: [action], options: { sourceCard: simSource, effect,
        activationContext: { decisions: { selections: { marked_choice: [required(simChosen.instanceId)] } } } } });
      assert.deepEqual(state[seat].hand, [simChosen]);
      assert.equal(simFirst.effectMarkers, undefined);
      assert.equal(simChosen.effectMarkers?.[key]?.expiresOnTurn, marker.expiresOnTurn);
      assert.equal(simChosen.effectMarkers?.[key]?.sourceInstanceId, simSource.instanceId);

      game.turnCounter = state.turnCounter = 5;
      game.cleanupExpiredEffectMarkers();
      const conditions = [{ type: "summoned_card_has_marker", key, sourceEffectId: effectId, sourceRef: "self" }] as const;
      const expectedAtFive = duration !== "end_of_turn";
      assert.equal(game.effectEngine.evaluateConditions(conditions, { source, player: owner, summonedCard: chosen }).ok, expectedAtFive);
      assert.equal(evaluateSimulatedConditions(conditions, { state, selfId: seat, sourceCard: simSource, summonedCard: simChosen }), expectedAtFive);
      assert.equal(marker.expiresOnTurn, duration === undefined ? null : duration === "end_of_turn" ? 4 : 5);
      if (expectedAtFive) {
        await game.moveCard(chosen, owner, "field", { fromZone: "hand", summonOrigin: "effect_resolution", position: "attack", isFacedown: false });
        assert.equal(moveCardToZone(state[seat], simChosen, "field", state[seat], { state }), true);
        assert.equal(chosen.effectMarkers?.[key], marker, "hand-to-field movement preserves provenance");
        assert.equal(simChosen.effectMarkers?.[key]?.sourceInstanceId, simSource.instanceId);
      }
      game.turnCounter = state.turnCounter = 6;
      game.cleanupExpiredEffectMarkers();
      assert.equal(game.effectEngine.evaluateConditions(conditions, { source, player: owner, summonedCard: chosen }).ok, duration === undefined);
      assert.equal(evaluateSimulatedConditions(conditions, { state, selfId: seat, sourceCard: simSource, summonedCard: simChosen }), duration === undefined);
    });
  }

  test(`marking a search preserves the human broker choice (${seat})`, async t => {
    const { game, owner, source, first, chosen } = scenario(t, seat);
    owner.controllerType = "human";
    const action = search(), effect = { id: effectId, timing: "manual" as const, activationZones: ["field"] as const, actions: [action] };
    const pending = game.effectEngine.applyActions([action], { source, player: owner, opponent: game[seat === "player" ? "bot" : "player"], effect }, {});
    const session = await selection(game);
    assert.deepEqual(owner.hand, []);
    assert.equal(Reflect.get(chosen, "effectMarkers"), undefined);
    const requirement = required(session.requirements[0]);
    assert.equal(requirement.id, "marked_choice");
    const candidate = required(requirement.candidates.find(entry => entry.cardRef === chosen));
    session.selections[requirement.id] = [candidate.key];
    await game.finishTargetSelection();
    await pending;
    assert.deepEqual(owner.hand, [chosen]);
    assert.deepEqual(owner.deck, [first]);
    assert.equal(chosen.effectMarkers?.[key]?.expiresOnTurn, null);
    assert.equal(first.effectMarkers, undefined);
    assert.equal(game.targetSelection, null);
  });
}

test("simulation keeps a durationless search marker usable after the turn changes", () => {
  const source = simulationCard(new Card(cardDefinition(454), "bot"));
  const chosen = simulationCard(new Card(cardDefinition(1), "bot"));
  const state = simulationState({ turnCounter: 4, bot: { field: [source], deck: [chosen] } });
  applySimulatedActions({ state, actions: [search()], options: { sourceCard: source } });
  state.turnCounter = 5;
  assert.equal(evaluateSimulatedConditions([{ type: "summoned_card_has_marker", key }], { state, summonedCard: chosen }), true);
  assert.equal(chosen.effectMarkers?.[key]?.expiresOnTurn, null);
});

async function selection(game: RuntimeGame) {
  for (let attempt = 0; !game.targetSelection && attempt < 100; attempt++) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  return required(game.targetSelection);
}
