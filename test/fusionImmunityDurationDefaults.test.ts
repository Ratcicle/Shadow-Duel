import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { ActionOf } from "../src/core/contracts/actions.js";
import { createPlanningCopy } from "../src/core/ai/common/planningCopy.js";
import { fingerprintPlanningState } from "../src/core/ai/common/stateFingerprint.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { createCanonicalStateSnapshot } from "../src/core/game/replay/canonical.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { simulationState } from "./helpers/simulation.js";

function setup(t: TestContext, ownerId: "player" | "bot") {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
  t.after(() => game.dispose("fusion_immunity_duration_defaults"));
  game.disablePresentationDelays = true;
  game.player.controllerType = game.bot.controllerType = "human";
  game.turnCounter = 2;
  const owner = game[ownerId], opponent = game[ownerId === "player" ? "bot" : "player"];
  const fusion = new Card({ ...cardDefinition(227), effects: [] }, ownerId);
  const source = new Card({ ...cardDefinition(210), effects: [] }, ownerId);
  placeFieldCards(owner.field, fusion, source);
  const grant = (durationTurns?: number) => game.effectEngine.applyActions([{
    type: "grant_void_fusion_immunity", archetype: "Void", ...(durationTurns !== undefined ? { durationTurns } : {}),
  }], { player: owner, opponent, source, summonedCard: fusion }, {});
  return { game, owner, opponent, fusion, source, grant };
}

for (const ownerId of ["player", "bot"] as const) {
  test(`durationless fusion immunity survives turns/source exit and ends face-down (${ownerId})`, async t => {
    const { game, owner, opponent, fusion, source, grant } = setup(t, ownerId);
    assert.equal((await grant()).success, true);
    await game.moveCard(source, owner, "graveyard", { fromZone: "field" });
    game.cleanupTempBoosts(owner);
    game.turnCounter = 10;
    assert.equal(game.effectEngine.checkImmunity(fusion, opponent, { sourceCard: source }).immune, true);
    assert.equal(game.effectEngine.checkImmunity(fusion, owner, { sourceCard: source }).immune, false);
    const initialAtk = fusion.atk;
    const opponentSource = new Card({ ...cardDefinition(210), effects: [] }, opponent.id);
    const buff: ActionOf<"buff_stats_temp"> = { type: "buff_stats_temp", targetRef: "target", atkBoost: 100, duration: "end_of_turn" };
    await game.effectEngine.applyActions([buff], { player: opponent, opponent: owner, source: opponentSource }, { target: [fusion] });
    assert.equal(fusion.atk, initialAtk, "the opponent's stat effect cannot affect the protected Fusion");
    await game.effectEngine.applyActions([buff], { player: owner, opponent, source: fusion }, { target: [fusion] });
    assert.equal(fusion.atk, initialAtk + 100, "the controller's stat effect still resolves");
    await game.effectEngine.applyActions([{ type: "set_facedown_defense", targetRef: "target" }],
      { player: owner, opponent, source }, { target: [fusion] });
    assert.equal(game.effectEngine.checkImmunity(fusion, opponent, { sourceCard: source }).immune, false);
    fusion.isFacedown = false;
    assert.equal(game.effectEngine.checkImmunity(fusion, opponent, { sourceCard: source }).immune, false);
    await grant();
    await game.moveCard(fusion, owner, "graveyard", { fromZone: "field" });
    assert.equal(Reflect.get(fusion, "unaffectedByOpponentCardEffects"), undefined);
  });

  test(`explicit fusion-immunity duration still ends after the next turn (${ownerId})`, async t => {
    const { game, owner, opponent, fusion, source, grant } = setup(t, ownerId);
    assert.equal((await grant(1)).success, true);
    assert.equal(fusion.immuneToOpponentEffectsUntilTurn, 3);
    assert.equal(Object.hasOwn(fusion.faceupStatuses, "unaffectedByOpponentCardEffects"), false);
    for (const turnCounter of [2, 3, 4]) {
      game.turnCounter = turnCounter;
      game.cleanupTempBoosts(owner);
      assert.equal(game.effectEngine.checkImmunity(fusion, opponent, { sourceCard: source }).immune, turnCounter <= 3);
    }
  });
}

test("presence immunity survives planning clones and contributes to fingerprints/canonical state", async t => {
  const { game, fusion, grant } = setup(t, "player");
  await grant();
  for (const planningOnly of [false, true]) {
    const clone = createPlanningCopy(planningOnly).cloneCardForSim(fusion);
    assert.equal(Reflect.get(clone, "unaffectedByOpponentCardEffects"), true);
    const state = simulationState({ player: { field: [clone] } });
    const before = fingerprintPlanningState(state);
    Reflect.set(clone, "unaffectedByOpponentCardEffects", false);
    assert.notEqual(fingerprintPlanningState(state), before);
    assert.equal(fusion.unaffectedByOpponentCardEffects, true);
  }
  const projected = required(createCanonicalStateSnapshot(game).players.player.zones.field[0]);
  assert.deepEqual(projected.statuses.faceupStatuses, { unaffectedByOpponentCardEffects: { previous: null, current: true } });
});

test("shared simulation continues to reject unmodeled fusion-immunity actions explicitly", () => {
  const state = simulationState();
  const action: ActionOf<"grant_void_fusion_immunity"> = { type: "grant_void_fusion_immunity", archetype: "Void" };
  applySimulatedActions({ state, actions: [action] });
  assert.deepEqual(state._simUnsupportedActions, ["grant_void_fusion_immunity"]);
});
