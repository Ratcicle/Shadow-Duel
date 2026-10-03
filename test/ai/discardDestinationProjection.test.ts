import assert from "node:assert/strict";
import test from "node:test";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { simulateMainPhaseAction } from "../../src/core/ai/shadowheart/simulation.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

const card = (id: number, instanceId: number) => simulationCard({
  ...cardDefinition(id), instanceId, locationVersion: 0, isFacedown: false,
});

for (const seat of ["player", "bot"] as const) {
  for (const redirect of ["active", "facedown", "negated"] as const) {
    for (const existingGrave of [false, true]) {
      for (const fullField of [false, true]) {
        test(`simulated discard destinations ${seat}/${redirect}/grave=${existingGrave}/full=${fullField}`, () => {
          const source = card(110, 1), first = card(101, 2), second = card(101, 3);
          const existing = card(101, 4), galaxy = card(273, 5);
          galaxy.isFacedown = redirect === "facedown";
          galaxy.effectsNegated = redirect === "negated";
          const other = seat === "player" ? "bot" : "player";
          const occupants = fullField ? Array.from({ length: 5 }, (_, index) => card(1, index + 6)) : [];
          const state = simulationState({
            _isPerspectiveState: true, turn: seat, phase: "main1", turnCounter: 4,
            [seat]: { hand: [source, first, second], graveyard: existingGrave ? [existing] : [], field: [...occupants] },
            [other]: { field: [galaxy] },
          });
          // The projection must remain sufficient without reading a private live Game.
          Object.defineProperty(state, "_gameRef", { get: () => assert.fail("private Game access") });
          const player = state[seat];
          const inventory = () => [player, state[other]].flatMap(owner => [
            ...owner.hand, ...owner.field, ...owner.graveyard, ...owner.banished,
            ...owner.deck, ...owner.extraDeck, ...owner.spellTrap,
          ]);
          const before = inventory();
          const effect = required(source.effects?.[0]);
          applySimulatedActions({ state, selfId: seat, actions: effect.actions || [], options: { sourceCard: source, effect } });

          assert.deepEqual(player.hand, [source], "the action-only harness does not place or clean up the spell");
          assert.deepEqual(player.banished, redirect === "active" ? [first, second] : []);
          const summoned = player.field.filter(candidate => !occupants.includes(candidate));
          assert.equal(summoned.length, !fullField && (redirect !== "active" || existingGrave) ? 1 : 0);
          if (redirect === "active" && summoned.length) assert.equal(summoned[0], existing);
          for (const discarded of [first, second]) {
            assert.equal(discarded.instanceId, discarded === first ? 2 : 3);
            assert.ok(player[redirect === "active" ? "banished" : "graveyard"].includes(discarded) || summoned.includes(discarded));
          }
          if (summoned[0]) assert.equal(summoned[0].cannotAttackThisTurn, true);
          const after = inventory();
          assert.equal(after.length, before.length);
          for (const physicalCard of before) assert.equal(after.filter(candidate => candidate === physicalCard).length, 1);
        });
      }
    }
  }
}

for (const active of [false, true]) {
  for (const existingGrave of [false, true]) {
    test(`Shadow-Heart adapter preserves discard destinations active=${active}/grave=${existingGrave}`, () => {
      const source = card(110, 1), first = card(101, 2), second = card(101, 3);
      const existing = card(101, 4), galaxy = card(273, 5);
      galaxy.isFacedown = !active;
      const state = simulationState({
        _isPerspectiveState: true, turn: "bot", phase: "main1", turnCounter: 4,
        bot: { hand: [source, first, second], graveyard: existingGrave ? [existing] : [] },
        player: { field: [galaxy] },
      });
      simulateMainPhaseAction(state, { type: "spell", index: 0, cardId: 110 });
      assert.equal(state.bot.field.length, !active || existingGrave ? 1 : 0);
      assert.deepEqual(state.bot.banished.filter(candidate => candidate !== source), active ? [first, second] : []);
      if (active && existingGrave) assert.equal(state.bot.field[0], existing);
    });
  }
}
