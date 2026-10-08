import assert from "node:assert/strict";
import test from "node:test";
import { createPlanningOwnerPolicy } from "../../src/core/ai/common/planningOwner.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { getPlanningModel } from "../../src/core/ai/PlanningStrategies.js";
import type { PlanningModel } from "../../src/core/contracts/aiPlanning.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";
import { placeSimulationCards, simulationCard, simulationState } from "../helpers/simulation.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { cardDefinition, required } from "../helpers/fixtures.js";

for (const slot of ["bot", "player"] as const) {
  test(`LP policy receives its owner view and original physical references (${slot})`, () => {
    const { state } = createGameTreeCopy(simulationState({ _isPerspectiveState: true }));
    const owner = state[slot];
    const source = simulationCard({ ...cardDefinition(155), instanceId: 90551 });
    placeSimulationCards(owner.field, source);
    const effect: EffectDefinition = { id: "physical-payment-context", timing: "ignition", activationZones: ["field"],
      actions: [{ type: "pay_lp", amount: 500 }] };
    let observations = 0;
    const model: PlanningModel = {
      id: "lp-owner-view-control",
      create(view) {
        return {
          generateMainPhaseActions: () => [],
          simulateMainPhaseAction: () => {},
          getPlanningSimulationOptions: () => ({
            onLpPayment(fact) {
              observations++;
              assert.equal(fact.state, view, "the observer receives the same owner view as all other policy hooks");
              assert.equal(fact.state.bot, owner);
              assert.equal(fact.player, owner, "physical payer is not copied or rebound");
              assert.equal(fact.sourceCard, source, "physical source is not copied or rebound");
              assert.equal(fact.effect, effect);
              assert.equal(fact.amount, 500);
            },
          }),
        };
      },
    };
    const policy = createPlanningOwnerPolicy(state, owner, new Map([[owner.id, model]]));
    applySimulatedActions({ state, selfId: slot, actions: effect.actions,
      options: { ...policy, sourceCard: source, effect } });
    assert.equal(observations, 1);
    assert.equal(owner.lp, 7500);
    assert.equal(state[slot === "bot" ? "player" : "bot"].lp, 8000);
  });
}

for (const actor of ["bot", "player"] as const) for (const external of [false, true]) {
  test(`Luminarch payment metadata belongs only to its actor (${actor}, external=${external})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: false });
    t.after(() => game.dispose("architecture_luminarch_owner_lp"));
    const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
    owner.lp = opponent.lp = 5000;
    game.turnCounter = 4;
    const source = required(game.createCardForOwner(155, owner));
    placeFieldCards(owner.field, source);
    const effect: EffectDefinition = { id: "owner-lp-receipt-control", timing: "ignition", activationZones: ["field"],
      actions: [{ type: "pay_lp", amount: 500 }] };
    const { state } = createGameTreeCopy(game, external ? opponent : owner);
    const slot = external ? "player" : "bot";
    const payer = state[slot];
    const simSource = required(payer.field.find(card => card.instanceId === source.instanceId));
    const policy = createPlanningOwnerPolicy(state, payer, new Map([[payer.id, getPlanningModel("luminarch")]]));
    assert.equal(applySimulatedActions({ state, selfId: slot, actions: effect.actions,
      options: { ...policy, sourceCard: simSource, effect } }), true);
    policy.onEffectActivated?.({ state, player: payer, card: simSource, effect, action: null, zone: "field" });
    await game.effectEngine.applyActions(effect.actions || [], { source, player: owner, opponent, effect }, {});
    assert.equal(payer.lp, owner.lp);
    assert.equal(state[external ? "bot" : "player"].lp, opponent.lp);
    const metadata = external ? state._gameTreeActors?.[payer.id]?._simLuminarch : state._simLuminarch;
    assert.equal(metadata?.lpPayments?.length, 1);
    const receipt = required(metadata?.lpPayments?.[0]);
    assert.deepEqual([receipt.cardName, receipt.cost, receipt.beforeLp, receipt.afterLp], [source.name, 500, 5000, 4500]);
    const other = state[external ? "bot" : "player"];
    assert.equal(external ? state._simLuminarch : state._gameTreeActors?.[other.id]?._simLuminarch, undefined,
      "the other actor cannot inherit this payment receipt");
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });
}
