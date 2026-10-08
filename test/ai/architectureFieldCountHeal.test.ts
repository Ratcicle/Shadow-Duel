import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { required } from "../helpers/fixtures.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { attachSimulatedEventEmitter } from "../../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import type { ActionOf } from "../../src/core/contracts/actions.js";

for (const actor of ["bot", "player"] as const) {
  for (const kind of ["self", "opponent", "faceup", "hand", "exact_archetype", "zero", "non_array_zone", "recipient"] as const) {
    test(`field count healing preserves runtime filters, recipient and LP facts (${actor}, ${kind})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, disableChains: false, captureReplay: false });
      t.after(() => game.dispose("architecture_field_count_heal"));
      game.turnCounter = 4;
      const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
      owner.controllerType = opponent.controllerType = "ai";
      game.disablePresentationDelays = true;
      game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
      game.ui.showChainResponseModal = async () => null;
      owner.lp = opponent.lp = 5000;
      const source = required(game.createCardForOwner(172, owner));
      const multiplier = required(game.createCardForOwner(171, owner));
      const blade = required(game.createCardForOwner(166, owner));
      const facedown = required(game.createCardForOwner(153, owner));
      facedown.isFacedown = true;
      placeFieldCards(owner.field, source, multiplier, facedown);
      placeFieldCards(opponent.field, required(game.createCardForOwner(151, opponent)));
      placeFieldCards(owner.spellTrap, blade);
      owner.hand.push(required(game.createCardForOwner(151, owner)));
      await game.effectEngine.applyEquip({ type: "equip", targetRef: "host" },
        { source: blade, player: owner, opponent }, { host: [multiplier] });
      owner.updatePassiveEffects();
      if (kind === "exact_archetype") {
        facedown.archetype = "Shadow-Heart";
        facedown.archetypes = ["Shadow-Heart", "Luminarch"];
      }
      const action: ActionOf<"heal_per_field_count"> = { type: "heal_per_field_count", amountPerCard: 500,
        filters: { owner: kind === "opponent" ? "opponent" : "self", zone: kind === "hand" ? "hand" : kind === "non_array_zone" ? "fieldSpell" : "field",
          cardKind: "monster", archetype: kind === "zero" ? "Void" : "Luminarch",
          ...(kind === "faceup" ? { requireFaceup: true } : {}) },
        ...(kind === "recipient" ? { player: "opponent" } : {}) };
      const { state } = createGameTreeCopy(game, owner);
      const simSource = required(state.bot.field.find(card => card.instanceId === source.instanceId));
      const simBlade = required(state.bot.spellTrap.find(card => card.instanceId === blade.instanceId));
      const events: object[] = [], runtimeEvents: object[] = [];
      game.on("lp_change", event => runtimeEvents.push({ before: event.before, after: event.after,
        gained: event.lpGained, source: event.sourceCard?.instanceId }));
      await game.effectEngine.applyActions([action], { source, player: owner, opponent }, {});
      applySimulatedActions({ state, selfId: "bot", actions: [action], options: attachSimulatedEventEmitter(state, {
        enableSimulatedEvents: true, sourceCard: simSource,
        onSimulatedEvent(event, payload) { if (event === "lp_change") events.push({ before: Reflect.get(payload, "before"),
          after: Reflect.get(payload, "after"), gained: Reflect.get(payload, "lpGained"), source: Reflect.get(payload, "sourceCard")?.instanceId }); },
      }) });
      assert.equal(state.bot.lp, owner.lp);
      assert.equal(state.player.lp, opponent.lp);
      assert.deepEqual(events, runtimeEvents);
      assert.equal(simBlade.counters?.get("solar") || 0, blade.getCounter("solar"));
      assert.deepEqual(state._simUnsupportedActions || [], []);
      if (kind === "recipient") assert.equal(opponent.lp, 5000, "runtime heals the activating player even with the legacy recipient field");
    });
  }
}
