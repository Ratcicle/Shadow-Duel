import assert from "node:assert/strict";
import test from "node:test";
import Card, { restoreTemporaryStatuses } from "../src/core/Card.js";
import { getPiercingDamage } from "../src/core/ai/common/cardStats.js";
import { getActivePiercingMultiplier } from "../src/core/game/combat/availability.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { simulationCard, simulationState, placeSimulationCards } from "./helpers/simulation.js";

for (const seat of ["player", "bot"] as const) for (const id of [355, 364, 174]) {
  test(`P2 innate piercing is suppressed under negation (${id}, ${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
    t.after(() => game.dispose());
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "ai";
    game.ui.showChainResponseModal = async () => null;
    game.turn = seat; game.phase = "battle"; game.battleStep = "battle";
    const owner = game[seat], opponent = game.getOpponent(owner);
    const attacker = new Card(cardDefinition(id), seat);
    attacker.effectsNegated = true;
    const defender = new Card({ name: "P2 defender", cardKind: "monster", atk: 100, def: 500 }, opponent.id);
    defender.position = "defense";
    placeFieldCards(owner.field, attacker); placeFieldCards(opponent.field, defender);
    assert.equal(getPiercingDamage(attacker, attacker.atk, defender.def), 0);
    await game.resolveCombat(attacker, defender);
    assert.equal(opponent.lp, 8000);
    assert.ok(opponent.graveyard.includes(defender), "negation suppresses piercing without preventing battle destruction");
  });
}

for (const seat of ["player", "bot"] as const) {
  test(`P2 external simple piercing survives own negation and expires (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
    t.after(() => game.dispose());
    const owner = game[seat], opponent = game.getOpponent(owner);
    const lancer = new Card(cardDefinition(174), seat);
    const grant = new Card(cardDefinition(312), seat);
    lancer.effectsNegated = true;
    placeFieldCards(owner.field, lancer, grant);
    const actions = [{ type: "add_status" as const, targetRef: "chosen", status: "piercing", duration: "until_end_turn" as const }];
    await game.effectEngine.applyActions(actions, { player: owner, opponent: game[opponent.id === "player" ? "player" : "bot"], source: grant }, { chosen: [lancer] });
    assert.equal(getPiercingDamage(lancer, 2100, 500), 1600, "external grant must not retain negated double piercing");
    restoreTemporaryStatuses(lancer);
    assert.equal(getPiercingDamage(lancer, 2100, 500), 0);
    lancer.effectsNegated = false;
    assert.equal(getPiercingDamage(lancer, 2100, 500), 3200);

    const state = simulationState();
    const simulated = simulationCard({ ...cardDefinition(174), instanceId: 17401, owner: seat, piercing: true, effectsNegated: true });
    const simulatedGrant = simulationCard({ ...cardDefinition(312), instanceId: 31201, owner: seat });
    placeSimulationCards(state[seat].field, simulated, simulatedGrant);
    assert.equal(applySimulatedActions({ state, selfId: seat, actions, selections: { chosen: [simulated] }, options: { sourceCard: simulatedGrant } }), true);
    assert.equal(getPiercingDamage(simulated, 2100, 500), 1600);
    restoreTemporaryStatuses(simulated);
    assert.equal(getPiercingDamage(simulated, 2100, 500), 0);
    simulated.effectsNegated = false;
    assert.equal(getPiercingDamage(simulated, 2100, 500), 3200);
  });
}

test("P2 public negation and external grant projections produce the same piercing", () => {
  assert.equal(getPiercingDamage({ piercing: true, status: { effectsNegated: true } }, 2000, 500), 0);
  assert.equal(getPiercingDamage({ piercing: false, status: { effectsNegated: true, piercingDamage: true } }, 2000, 500), 1500);
});

test("P2 public piercing provenance follows visibility", t => {
  const game = createRuntimeGame({ captureReplay: false }); t.after(() => game.dispose());
  const card = new Card(cardDefinition(174), "player");
  card.effectsNegated = true; card.piercingGrantedByEffect = true;
  placeFieldCards(game.player.field, card);
  const visible = required(game.getPublicState("bot").players.opponent.field[0]);
  assert.equal(visible.piercingGrantedByEffect, true);
  assert.equal(getActivePiercingMultiplier(visible), 1);
  card.isFacedown = true;
  const hidden = required(game.getPublicState("bot").players.opponent.field[0]);
  assert.equal(hidden.piercingGrantedByEffect, null);
  assert.equal(getActivePiercingMultiplier(hidden), 0);
});
