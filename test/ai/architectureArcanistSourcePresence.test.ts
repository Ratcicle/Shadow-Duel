import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import Player from "../../src/core/Player.js";
import ArcanistStrategy from "../../src/core/ai/ArcanistStrategy.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { bindPlanningActionPresence } from "../../src/core/ai/common/actionIdentity.js";
import { moveCardToZone } from "../../src/core/ai/common/zones.js";
import { fingerprintPlanningState } from "../../src/core/ai/common/stateFingerprint.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { simulationState } from "../helpers/simulation.js";

for (const actor of ["bot", "player"] as const) {
  test(`Arcanist facade classifies and notifies the exact reordered Set Grimoire (${actor})`, () => {
    const make = (id: number) => createPlanningCopy().cloneCardForSim(new Card(cardDefinition(id), actor));
    const host = make(306), filler = make(311), source = make(301), sibling = make(304);
    source.isFacedown = sibling.isFacedown = true;
    source.setTurn = sibling.setTurn = 1;
    const state = simulationState({ turn: actor, phase: "main1", turnCounter: 3, _isPerspectiveState: true,
      bot: { id: actor, field: [host], spellTrap: [filler, source, sibling] } });
    const ai = new ArcanistStrategy(new Player(actor, "Owner"));
    const action = required(ai.generateMainPhaseActions(state).find(candidate => candidate.type === "spellTrapEffect" && candidate.cardId === 301));
    bindPlanningActionPresence(action, source, actor, "spellTrap");
    assert.equal(moveCardToZone(state.bot, filler, "graveyard", state.bot, { state }), true);
    assert.equal(state.bot.spellTrap[0], source); assert.equal(state.bot.spellTrap[1], sibling);
    const notifications: object[] = [];
    const notify = ai.simulateArcanistOnEquipTriggers.bind(ai);
    ai.simulateArcanistOnEquipTriggers = (sim, target, equip, command) => {
      notifications.push(equip); notify(sim, target, equip, command);
    };
    ai.simulateMainPhaseAction(state, action);
    assert.equal(source.equippedTo, host);
    assert.equal(source.isFacedown, false);
    assert.equal(sibling.isFacedown, true);
    assert.deepEqual(notifications, [source]);
    assert.equal(state._simArcanistSpellActivations, 1);
  });

  test(`Arcanist facade rejects an expired binding before preparing its old source (${actor})`, () => {
    const make = (id: number) => createPlanningCopy().cloneCardForSim(new Card(cardDefinition(id), actor));
    const host = make(306), source = make(301);
    source.isFacedown = true; source.setTurn = 1;
    const state = simulationState({ turn: actor, phase: "main1", turnCounter: 3, _isPerspectiveState: true,
      bot: { id: actor, field: [host], spellTrap: [source] } });
    const ai = new ArcanistStrategy(new Player(actor, "Owner"));
    const action = required(ai.generateMainPhaseActions(state).find(candidate => candidate.type === "spellTrapEffect" && candidate.cardId === 301));
    bindPlanningActionPresence(action, source, actor, "spellTrap");
    source.locationVersion = (source.locationVersion || 0) + 2;
    let preparationCalls = 0;
    const context = ai.getPlanningSimulationOptions.bind(ai);
    ai.getPlanningSimulationOptions = sim => { preparationCalls++; return context(sim); };
    const before = fingerprintPlanningState(state);
    ai.simulateMainPhaseAction(state, action);
    assert.equal(fingerprintPlanningState(state), before);
    assert.equal(preparationCalls, 0, "no preview/policy callback runs for an expired command");
  });
}
