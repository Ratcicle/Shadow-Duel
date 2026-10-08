import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import VoidStrategy from "../../src/core/ai/VoidStrategy.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { moveCardToZone, refreshSimulatedFieldAuras } from "../../src/core/ai/common/zones.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

for (const actor of ["bot", "player"] as const) {
  for (const id of [211, 209, 224]) {
    for (const condition of ["active", "negated", "facedown"] as const) {
      test(`Void passive agrees with runtime and refresh is idempotent (${actor}/${id}/${condition})`, t => {
        const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
        t.after(() => game.dispose());
        game.turn = actor; game.turnCounter = 3; game.phase = "main1";
        const owner = game[actor];
        const opponent = game[actor === "bot" ? "player" : "bot"];
        const make = (key: number, side = owner) => new Card(cardDefinition(key), side.id);
        const source = make(id);
        source.isFacedown = condition === "facedown";
        source.effectsNegated = condition === "negated";
        placeFieldCards(owner.field, source);
        if (id !== 224) placeFieldCards(owner.field, make(204));
        owner.graveyard.push(make(204), make(204), make(203));
        placeFieldCards(opponent.field, make(204, opponent));
        opponent.graveyard.push(make(204, opponent));
        game.effectEngine.updatePassiveBuffs();
        const expected = [source.atk, source.def];
        const state = createGameTreeCopy(game, owner).state;
        const simulatedSource = required(state.bot.field.find(card => card.instanceId === source.instanceId));
        const strategy = new VoidStrategy(state.bot);
        for (let repeat = 0; repeat < 3; repeat++) {
          strategy.applySimulatedVoidPassives(state);
          assert.deepEqual([simulatedSource.atk, simulatedSource.def], expected);
        }
        assert.deepEqual([source.atk, source.def], expected, "refresh does not mutate the live source");
      });
    }

    test(`shared Void passive refresh tracks graveyard and solo transitions (${actor}/${id})`, t => {
      const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
      t.after(() => game.dispose());
      game.turn = actor; game.turnCounter = 3; game.phase = "main1";
      const owner = game[actor];
      const source = new Card(cardDefinition(id), actor);
      const hollow = new Card(cardDefinition(204), actor);
      placeFieldCards(owner.field, source);
      owner.graveyard.push(hollow);
      game.effectEngine.updatePassiveBuffs();
      const state = createGameTreeCopy(game, owner).state;
      const simulatedSource = required(state.bot.field.find(card => card.instanceId === source.instanceId));
      const simulatedHollow = required(state.bot.graveyard.find(card => card.instanceId === hollow.instanceId));
      owner.graveyard.splice(owner.graveyard.indexOf(hollow), 1);
      state.bot.graveyard.splice(state.bot.graveyard.indexOf(simulatedHollow), 1);
      game.effectEngine.updatePassiveBuffs();
      refreshSimulatedFieldAuras(state);
      assert.deepEqual([simulatedSource.atk, simulatedSource.def], [source.atk, source.def]);
      placeFieldCards(owner.field, hollow);
      // Both views acquire a new field presence through their public fixture boundary.
      simulatedHollow.fieldSlot = required(hollow.fieldSlot);
      state.bot.field.push(simulatedHollow);
      game.effectEngine.updatePassiveBuffs();
      refreshSimulatedFieldAuras(state);
      assert.deepEqual([simulatedSource.atk, simulatedSource.def], [source.atk, source.def]);
    });

    test(`shared Void passive removes stale contributions on negation, face change and exit (${actor}/${id})`, async t => {
      const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
      t.after(() => game.dispose());
      game.turn = actor; game.phase = "main1"; game.turnCounter = 3;
      const owner = game[actor];
      const source = new Card(cardDefinition(id), actor);
      placeFieldCards(owner.field, source);
      owner.graveyard.push(new Card(cardDefinition(204), actor));
      game.effectEngine.updatePassiveBuffs();
      const state = createGameTreeCopy(game, owner).state;
      const simulated = required(state.bot.field.find(card => card.instanceId === source.instanceId));
      for (const condition of ["negated", "active", "facedown", "active"] as const) {
        source.effectsNegated = simulated.effectsNegated = condition === "negated";
        source.isFacedown = simulated.isFacedown = condition === "facedown";
        game.effectEngine.updatePassiveBuffs();
        refreshSimulatedFieldAuras(state);
        assert.deepEqual([simulated.atk, simulated.def], [source.atk, source.def], condition);
      }
      await game.moveCard(source, owner, "graveyard", { fromZone: "field" });
      moveCardToZone(state.bot, simulated, "graveyard", state.bot, { state });
      refreshSimulatedFieldAuras(state);
      assert.deepEqual([simulated.atk, simulated.def], [source.atk, source.def]);
      assert.ok(state.bot.graveyard.includes(simulated));
    });
  }
}
