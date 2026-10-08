import assert from "node:assert/strict";
import test from "node:test";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { getCounterValue } from "../../src/core/ai/common/counters.js";
import { checkSimulatedAscension } from "../../src/core/ai/common/ascensionPlanning.js";
import { architectureState } from "../helpers/architectureBaseline.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { required } from "../helpers/fixtures.js";

for (const actor of ["bot", "player"] as const) {
  test(`Ascension counter filters read the projected turn (${actor})`, t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
    t.after(() => game.dispose("architecture_ascension_filter_turn"));
    game.turn = actor; game.phase = "main1"; game.turnCounter = 4;
    const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
    const material = required(game.createCardForOwner(408, owner));
    const queen = required(game.createCardForOwner(419, owner));
    const counterSource = required(game.createCardForOwner(252, opponent));
    material.summonedTurn = 3;
    counterSource.counters.set("spore", 1);
    placeFieldCards(owner.field, material); placeFieldCards(opponent.field, counterSource);
    owner.extraDeck.push(queen);
    queen.ascension = { ...required(queen.ascension), requirements: [{
      type: "field_counters_at_least", owner: "opponent", zone: "field", counterType: "spore",
      min: 1, requireFaceup: true, filters: { sentToGraveAsMaterialThisTurn: true },
    }] };
    for (const markerTurn of [3, 4]) {
      counterSource.lastSentToGraveAsMaterial = {
        // This historical flag is written at movement; the recorded turn and
        // current query turn determine whether it still counts now.
        type: "fusion", turn: markerTurn, thisTurn: true,
        ownerId: opponent.id, fromZone: "field", contextLabel: "fusion_material",
      };
      const runtime = game.checkAscensionRequirements(owner, queen, material);
      assert.equal(runtime.ok, markerTurn === 4);
      const { state } = createGameTreeCopy(game, owner);
      const before = architectureState(state, new Map());
      assert.equal(checkSimulatedAscension(state, required(state.bot.field[0]), required(state.bot.extraDeck[0])).ok, runtime.ok);
      assert.deepEqual(architectureState(state, new Map()), before);
    }
  });

  for (const variant of ["seven", "eight", "nine", "facedown", "graveyard", "different_counter"] as const) {
    test(`shared Ascension query reads the projected public counters (${actor}/${variant})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
      t.after(() => game.dispose("architecture_ascension_counter_query"));
      game.turn = actor; game.phase = "main1"; game.turnCounter = 4;
      game.bot.controllerType = game.player.controllerType = "ai";
      game.disablePresentationDelays = true;
      game.waitForBoardPresentation = async () => {};
      game.waitForPresentationDelay = async () => {};
      game.waitForAiPresentationStep = async () => {};
      const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
      const material = required(game.createCardForOwner(408, owner));
      const queen = required(game.createCardForOwner(419, owner));
      const ownSpell = required(game.createCardForOwner(412, owner));
      const opposingMonster = required(game.createCardForOwner(252, opponent));
      const opposingField = required(game.createCardForOwner(417, opponent));
      material.summonedTurn = 3;
      placeFieldCards(owner.field, material);
      placeFieldCards(opponent.field, opposingMonster);
      owner.extraDeck.push(queen); placeFieldCards(owner.spellTrap, ownSpell); opponent.fieldSpell = opposingField;
      // Keep counters off the paid material: this oracle isolates the query's
      // read capability, not the runtime's post-cost summon revalidation.
      ownSpell.counters.set("spore", 3);
      opposingMonster.counters.set("spore", 2);
      opposingField.counters.set("spore", variant === "eight" ? 3 : variant === "nine" ? 4 : 2);
      if (variant === "facedown") {
        const hidden = required(game.createCardForOwner(415, opponent));
        hidden.isFacedown = true; hidden.counters.set("spore", 8); placeFieldCards(opponent.spellTrap, hidden);
      }
      if (variant === "graveyard") {
        const buried = required(game.createCardForOwner(401, owner));
        buried.counters.set("spore", 8); owner.graveyard.push(buried);
      }
      if (variant === "different_counter") ownSpell.counters.set("judgment_marker", 8);
      const allowed = variant === "eight" || variant === "nine";
      assert.equal(game.checkAscensionRequirements(owner, queen, material).ok, allowed);
      const { state } = createGameTreeCopy(game, owner);
      const projectedQueen = required(state.bot.extraDeck[0]);
      const projectedMaterial = required(state.bot.field[0]);
      const beforeQueries = architectureState(state, new Map());
      for (let repeat = 0; repeat < 2; repeat++)
        assert.equal(checkSimulatedAscension(state, projectedMaterial, projectedQueen).ok, allowed);
      assert.deepEqual(architectureState(state, new Map()), beforeQueries);
      assert.equal(Reflect.get(projectedMaterial, "getCounter"), undefined,
        "The query must not attach runtime methods to the physical planning card.");
      const runtimeResult = await game.performAscensionSummon(owner, material, queen, { position: "defense" });
      assert.equal(runtimeResult.success, allowed, JSON.stringify(runtimeResult));
      applyGenericSimulatedMainPhaseAction(state, { type: "ascension", materialIndex: 0,
        ascensionCard: projectedQueen, position: "defense" });
      assert.equal(state.bot.field.includes(projectedQueen), allowed);
      assert.deepEqual(state.bot.field.map(card => card.id), owner.field.map(card => card.id));
      assert.deepEqual(state.bot.extraDeck.map(card => card.id), owner.extraDeck.map(card => card.id));
      for (const [projected, actual] of [[state.bot.spellTrap[0], ownSpell],
        [state.player.field[0], opposingMonster], [state.player.fieldSpell, opposingField]] as const) {
        assert.equal(getCounterValue(required(projected), "spore"), actual.getCounter("spore"));
      }
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }
}
