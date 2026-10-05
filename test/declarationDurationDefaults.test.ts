import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { createPlanningCopy } from "../src/core/ai/common/planningCopy.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { moveCardToZone } from "../src/core/ai/common/zones.js";
import { createCanonicalStateSnapshot, hashCanonicalGameState } from "../src/core/game/replay/canonical.js";
import type { CardAction } from "../src/core/contracts/actions.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { simulationState } from "./helpers/simulation.js";

function scenario(t: TestContext, seat: "player" | "bot") {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, disableChains: true });
  t.after(() => game.dispose());
  game.turn = seat;
  game.phase = "main1";
  game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.player.controllerType = game.bot.controllerType = "ai";
  const owner = game[seat];
  const opponent = game[seat === "player" ? "bot" : "player"];
  const card = new Card(cardDefinition(503), seat);
  placeFieldCards(owner.field, card);
  const simulated = createPlanningCopy().cloneCardForSim(card);
  const state = simulationState({ turn: seat, phase: "main1", turnCounter: 4, [seat]: { field: [simulated] } });
  const apply = async (actions: readonly CardAction[]) => {
    await game.effectEngine.applyActions(actions, { source: card, player: owner, opponent }, { chosen: [card] });
    applySimulatedActions({ state, actions, selfId: seat, options: { sourceCard: simulated }, selections: { chosen: [simulated] } });
  };
  const declare = (stateKey: string, duration?: string): CardAction => ({
    type: "declare_card_property", property: "type", value: "Machine", stateKey,
    ...(duration ? { duration } : {}),
  });
  return { game, owner, card, simulated, state, apply, declare };
}

test("declaration snapshots restore detached objects and remove maps created after capture", async t => {
  const { game, card, apply, declare } = scenario(t, "player");
  await apply([declare("lasting")]);
  card.declaredValues = { ...card.declaredValues, legacy: "Machine" };
  const snapshot = game.captureZoneSnapshot("declared_values");
  const declaration = required(card.declaredValues.lasting);
  assert.equal(typeof declaration, "object");
  if (typeof declaration !== "object") return;
  declaration.value = "Pyro";
  game.restoreZoneSnapshot(snapshot);
  assert.equal(typeof card.declaredValues?.lasting === "object" && card.declaredValues.lasting.value, "Machine");
  const restored = required(card.declaredValues?.lasting);
  if (typeof restored !== "object") return;
  restored.value = "Dragon";
  game.restoreZoneSnapshot(snapshot);
  assert.equal(typeof card.declaredValues?.lasting === "object" && card.declaredValues.lasting.value, "Machine");
  assert.equal(card.declaredValues?.legacy, "Machine");
  delete card.declaredValues;
  const absent = game.captureZoneSnapshot("no_declaration");
  await apply([declare("later")]);
  game.restoreZoneSnapshot(absent);
  assert.equal(card.declaredValues, undefined);
});

test("canonical declarations distinguish expiry and ignore localized value labels", async t => {
  const { game, card, apply, declare } = scenario(t, "player");
  await apply([declare("lasting")]);
  const lastingHash = hashCanonicalGameState(game);
  const declaration = required(card.declaredValues?.lasting);
  if (typeof declaration !== "object") return;
  declaration.valueLabel = "Máquina";
  assert.equal(hashCanonicalGameState(game), lastingHash);
  const projected = required(createCanonicalStateSnapshot(game).players.player.zones.field[0]);
  assert.deepEqual(Reflect.get(projected, "declaredValues"), {
    lasting: { property: "type", value: "Machine", declaredOnTurn: 4, expiresOnTurn: null, duration: "while_faceup" },
  });
  declaration.duration = "end_of_turn";
  declaration.expiresOnTurn = 4;
  assert.notEqual(hashCanonicalGameState(game), lastingHash);
});

for (const seat of ["player", "bot"] as const) {
  test(`declarations without duration persist across turn boundaries (${seat})`, async t => {
    const { game, card, simulated, state, apply, declare } = scenario(t, seat);
    await apply([declare("lasting"), declare("turn", "end_of_turn"), declare("next", "end_of_next_turn")]);
    for (const source of [card, simulated]) {
      assert.deepEqual(source.declaredValues?.lasting && typeof source.declaredValues.lasting === "object"
        ? [source.declaredValues.lasting.expiresOnTurn, source.declaredValues.lasting.duration] : null,
      [null, "while_faceup"]);
      assert.equal(typeof source.declaredValues?.turn === "object" && source.declaredValues.turn.expiresOnTurn, 4);
      assert.equal(typeof source.declaredValues?.next === "object" && source.declaredValues.next.expiresOnTurn, 5);
    }
    game.turnCounter = state.turnCounter = 5;
    game.cleanupExpiredDeclaredValues();
    assert.ok(card.declaredValues?.lasting);
    assert.equal(card.declaredValues?.turn, undefined);
    assert.ok(card.declaredValues?.next);
    game.turnCounter = state.turnCounter = 6;
    game.cleanupExpiredDeclaredValues();
    assert.ok(card.declaredValues?.lasting);
    assert.equal(card.declaredValues?.next, undefined);
  });

  test(`face-down removes only declarations tied to the face-up presence (${seat})`, async t => {
    const { card, simulated, apply, declare } = scenario(t, seat);
    await apply([declare("lasting"), declare("explicit", "while_faceup"), declare("turn", "end_of_turn"), declare("permanent", "permanent")]);
    card.declaredValues = { ...card.declaredValues, legacy: "Machine" };
    simulated.declaredValues = { ...simulated.declaredValues, legacy: "Machine" };
    await apply([{ type: "set_facedown_defense", targetRef: "chosen" }]);
    for (const source of [card, simulated]) {
      assert.equal(source.declaredValues?.lasting, undefined);
      assert.equal(source.declaredValues?.explicit, undefined);
      assert.ok(source.declaredValues?.turn);
      assert.ok(source.declaredValues?.permanent);
      assert.equal(source.declaredValues?.legacy, "Machine");
    }
  });

  test(`field exit clears declarations in runtime and simulation (${seat})`, async t => {
    const { game, owner, card, simulated, state, apply, declare } = scenario(t, seat);
    await apply([declare("lasting"), declare("turn", "end_of_turn")]);
    await game.moveCard(card, owner, "graveyard", { fromZone: "field" });
    moveCardToZone(state[seat], simulated, "graveyard", state[seat], { state });
    assert.equal(card.declaredValues, undefined);
    assert.equal(simulated.declaredValues, undefined);
  });
}

for (const [id, expiry, duration] of [[452, 5, "end_of_next_turn"], [459, 4, "end_of_turn"], [461, null, "while_faceup"]] as const) {
  test(`existing declaration producer ${id} retains its explicit duration in runtime and simulation`, async t => {
    const { card, simulated, apply } = scenario(t, "player");
    const action = required((cardDefinition(id).effects || []).flatMap(effect => effect.actions || [])
      .find(action => action.type === "declare_card_property"));
    if (action.type !== "declare_card_property") return;
    await apply([{ ...action, value: "Machine" }]);
    for (const source of [card, simulated]) {
      const entry = required(source.declaredValues?.[action.stateKey]);
      assert.equal(typeof entry, "object");
      if (typeof entry !== "object") return;
      assert.equal(entry.expiresOnTurn, expiry);
      assert.equal(entry.duration, duration);
    }
  });
}

test("numeric declaration deadlines take precedence over omitted or explicit duration", async t => {
  const { card, simulated, apply } = scenario(t, "player");
  const actions = [
    { type: "declare_card_property", property: "type", value: "Machine", stateKey: "turns", durationTurns: 2 },
    { type: "declare_card_property", property: "type", value: "Machine", stateKey: "deadline", expiresOnTurn: 9, durationTurns: 2 },
    { type: "declare_card_property", property: "type", value: "Machine", stateKey: "override", expiresOnTurn: 8, duration: "while_faceup" },
  ] as const;
  await apply(actions);
  for (const source of [card, simulated]) {
    assert.equal(typeof source.declaredValues?.turns === "object" && source.declaredValues.turns.expiresOnTurn, 6);
    assert.equal(typeof source.declaredValues?.deadline === "object" && source.declaredValues.deadline.expiresOnTurn, 9);
    assert.equal(typeof source.declaredValues?.override === "object" && source.declaredValues.override.expiresOnTurn, 8);
  }
  await apply([{ type: "set_facedown_defense", targetRef: "chosen" }]);
  for (const source of [card, simulated]) {
    assert.ok(source.declaredValues?.turns);
    assert.ok(source.declaredValues?.deadline);
    assert.ok(source.declaredValues?.override);
  }
});
