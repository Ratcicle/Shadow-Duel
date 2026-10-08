import assert from "node:assert/strict";
import test from "node:test";
import { createDeferredSimulatedEventFrame } from "../../src/core/ai/common/simulation.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { createPlanningOwnerPolicy } from "../../src/core/ai/common/planningOwner.js";
import { withPlanningExecutionContext } from "../../src/core/ai/common/planningExecution.js";
import { getPlanningModel } from "../../src/core/ai/PlanningStrategies.js";
import type { PlanningModel } from "../../src/core/contracts/aiPlanning.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { placeSimulationCards, simulationCard, simulationState } from "../helpers/simulation.js";

for (const seat of ["bot", "player"] as const) for (const nested of [false, true]) for (const failure of [false, true]) {
  test(`foreign owner finalizes paid receipts after the inherited queue (${seat}, nested=${nested}, failure=${failure})`, () => {
    const { state } = createGameTreeCopy(simulationState({ turn: seat, turnCounter: 4 }));
    const payer = state[seat], other = state[seat === "bot" ? "player" : "bot"];
    payer.lp = other.lp = 5000;
    const marshal = simulationCard({ ...cardDefinition(155), owner: payer.id, controller: payer.id, instanceId: 551 });
    const halberd = simulationCard({ ...cardDefinition(168), owner: payer.id, controller: payer.id, instanceId: 568 });
    const eventCard = simulationCard({ ...cardDefinition(1), owner: other.id, controller: other.id, instanceId: 501 });
    eventCard.effects = []; placeSimulationCards(other.field, eventCard);
    marshal.effects = [{ id: "completion-paid-owner-trigger", timing: "on_event", event: "after_summon",
      triggerRequirement: "mandatory", triggerTiming: "if",
      activationZones: ["hand"], oncePerTurn: true, oncePerTurnScope: "card",
      actions: [{ type: "pay_lp", amount: failure ? 500 : 2000 },
        { type: "special_summon_from_zone", zone: "hand", requireSource: true, position: "defense" },
        ...(failure ? [{ type: "draw" as const, amount: 1 }] : [])] }];
    payer.hand.push(marshal, halberd);
    const ownerPolicy = createPlanningOwnerPolicy(state, payer, new Map([[payer.id, getPlanningModel("luminarch")]]));
    let parentCompletions = 0;
    withPlanningExecutionContext(state, (_state, actor) => actor === payer ? ownerPolicy : null, () => {
      const parent = createDeferredSimulatedEventFrame(state, { enableSimulatedEvents: true,
        onSimulatedResolutionComplete: () => { parentCompletions++; } });
      const child = nested ? createDeferredSimulatedEventFrame(state, {
        ...ownerPolicy, enableSimulatedEvents: true, emitSimulatedEvent: required(parent.options.emitSimulatedEvent),
      }) : null;
      (child || parent).options.emitSimulatedEvent?.("after_summon", { card: eventCard, player: other, method: "special", fromZone: "hand" });
      child?.finishResolution();
      assert.equal(payer.lp, 5000, "the parent owns publication timing");
      assert.equal(parentCompletions, 0);
      parent.finishResolution(); parent.finishResolution();
    });
    const metadata = seat === "bot" ? state._simLuminarch : state._gameTreeActors?.[payer.id]?._simLuminarch;
    const payment = required(metadata?.lpPayments?.[0]);
    assert.equal(metadata?.lpPayments?.length, 1);
    assert.deepEqual([payment.cost, payment.beforeLp, payment.afterLp], failure ? [500, 5000, 4500] : [2000, 5000, 3000]);
    assert.equal(typeof payment.createsPayoff, "boolean", "enrichment happens without a Strategy wrapper even on failure");
    assert.equal(payment.createsPayoff, true, "the deferred Halberd trigger completes before enrichment");
    assert.equal(payer.lp, failure ? 4500 : 3000); assert.equal(other.lp, 5000);
    assert.equal(payer.field.includes(halberd), true);
    assert.equal(halberd.cannotAttackThisTurn, true);
    assert.equal(parentCompletions, 1);
    for (const milestone of new Set(metadata?.milestones || [])) {
      assert.equal(metadata?.milestones?.filter(entry => entry === milestone).length, 1, "receipt enrichment cannot duplicate milestones");
    }
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });
}

for (const seat of ["bot", "player"] as const) {
  test(`resolution completion receives the same canonical owner view as payment hooks (${seat})`, () => {
    const { state } = createGameTreeCopy(simulationState());
    const owner = state[seat];
    let completions = 0;
    const model: PlanningModel = { id: "completion-owner-view", create: view => ({
      generateMainPhaseActions: () => [], simulateMainPhaseAction: () => {},
      getPlanningSimulationOptions: () => ({ onSimulatedResolutionComplete: payload => {
        completions++;
        assert.equal(payload.state, view);
        assert.equal(payload.state.bot, owner);
      } }),
    }) };
    const policy = createPlanningOwnerPolicy(state, owner, new Map([[owner.id, model]]));
    const frame = createDeferredSimulatedEventFrame(state, { ...policy, enableSimulatedEvents: true });
    frame.finishResolution(); frame.finishResolution();
    assert.equal(completions, 1);
  });
}
