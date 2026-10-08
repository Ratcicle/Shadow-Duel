import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { refreshSimulatedFieldAuras } from "../../src/core/ai/common/zones.js";
import { getTributeRequirementFor } from "../../src/core/ai/common/tributePolicy.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { simulationState } from "../helpers/simulation.js";

// Runtime oracle: successful Normal/Tribute field entry reconciles continuous
// contributions before summon observers. No strategy preference is changed.
for (const seat of ["bot", "player"] as const) {
  for (const scenario of [
    { name: "normal", id: 101, facedown: false, tribute: false, boosted: true },
    { name: "tribute", id: 114, facedown: false, tribute: true, boosted: true },
    { name: "facedown set", id: 101, facedown: true, tribute: false, boosted: false },
    { name: "unrelated archetype", id: 1, facedown: false, tribute: false, boosted: false },
  ]) {
    test(`Normal Summon continuous aura matches runtime before callbacks (${seat}/${scenario.name})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true, captureReplay: false });
      t.after(() => game.dispose("architecture_normal_aura"));
      game.disablePresentationDelays = true;
      game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
      const owner = game[seat];
      owner.controllerType = "ai";
      const valley = new Card(cardDefinition(115), seat);
      valley.isFacedown = false;
      owner.fieldSpell = valley;
      const incoming = new Card(cardDefinition(scenario.id), seat);
      const baseAtk = incoming.atk;
      owner.hand.push(incoming);
      if (scenario.tribute) placeFieldCards(owner.field, new Card(cardDefinition(101), seat));
      const copy = createPlanningCopy();
      const simIncoming = copy.cloneCardForSim(incoming);
      const state = simulationState({ _isPerspectiveState: true, turn: seat, phase: "main1", turnCounter: 4,
        bot: { id: seat, hand: [simIncoming], field: owner.field.map(card => copy.cloneCardForSim(card)),
          fieldSpell: copy.cloneCardForSim(valley) },
        player: { id: seat === "bot" ? "player" : "bot" } });
      const observedRuntime: number[] = [];
      game.on("after_summon", payload => { if (payload.card === incoming) observedRuntime.push(incoming.atk); });
      const runtime = await game.performNormalSummon(owner, 0, scenario.facedown ? "defense" : "attack",
        scenario.facedown, scenario.tribute ? [0] : null);
      assert.equal(runtime?.success, true);
      assert.equal(owner.field.includes(incoming), true);
      const expected = baseAtk + (scenario.boosted ? 300 : 0);
      assert.equal(incoming.atk, expected, "real continuous aura applies only to a face-up matching recipient");
      if (!scenario.facedown) assert.deepEqual(observedRuntime, [expected]);
      const observedSim: number[] = [];
      applyGenericSimulatedMainPhaseAction(state, { type: "summon", index: 0, cardId: incoming.id,
        position: scenario.facedown ? "defense" : "attack", facedown: scenario.facedown }, {
        getTributeRequirementFor,
        selectBestTributes: () => scenario.tribute ? [0] : [],
        onAfterSummon: () => observedSim.push(required(state.bot.field.find(card => card.instanceId === incoming.instanceId)).atk || 0),
      });
      const simulated = required(state.bot.field.find(card => card.instanceId === incoming.instanceId));
      assert.equal(simulated.atk, incoming.atk);
      assert.deepEqual(observedSim, [expected], "policy callbacks already see the reconciled aura");
      assert.equal(simulated.isFacedown, incoming.isFacedown);
      assert.equal(state.bot.summonCount, owner.summonCount);
      assert.equal(state.bot.hand.length, 0);
      assert.equal(state.bot.graveyard.length, owner.graveyard.length);
      refreshSimulatedFieldAuras(state);
      assert.equal(simulated.atk, expected, "refreshing again cannot duplicate a continuous contribution");
    });
  }
}
