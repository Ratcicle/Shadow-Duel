import assert from "node:assert/strict";
import test from "node:test";
import Card from "../src/core/Card.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";

const first = "tech_zero_development_lab_synchro_target";
const second = "tech_zero_development_lab_shuffle_target";
for (const seat of ["player", "bot"] as const) {
  test(`Lab cannot open an impossible dependent selection (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false });
    t.after(() => game.dispose());
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    const owner = game[seat], source = new Card(cardDefinition(518), seat), card = new Card(cardDefinition(509), seat);
    owner.controllerType = "human"; owner.fieldSpell = source; owner.graveyard.push(card);
    const activation = game.activateFieldSpellEffect(source);
    for (let count = 0; !game.targetSelection && count < 30; count++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(game.targetSelection, null, "one physical card cannot fill both mutually exclusive groups");
    assert.equal((await activation).success, false);
    assert.deepEqual(owner.graveyard, [card]); assert.equal(game.effectUsageReservations.size, 0);
  });

  test(`Lab contract and canonical session reject the same instance, then accept its twin (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, chainResponseTimeoutMs: 0 });
    t.after(() => game.dispose());
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    const owner = game[seat], source = new Card(cardDefinition(518), seat);
    const a = new Card(cardDefinition(509), seat), b = new Card(cardDefinition(509), seat);
    owner.controllerType = "human"; owner.fieldSpell = source; owner.graveyard.push(a, b);
    game.ui.showChainResponseModal = async () => null;
    const activation = game.activateFieldSpellEffect(source);
    for (let count = 0; !game.targetSelection && count < 100; count++) await new Promise(resolve => setTimeout(resolve, 1));
    const session = required(game.targetSelection);
    const aKey = required(required(session.requirements.find(requirement => requirement.id === first)).candidates.find(candidate => candidate.cardRef === a)).key;
    const bKey = required(required(session.requirements.find(requirement => requirement.id === second)).candidates.find(candidate => candidate.cardRef === b)).key;
    session.selections[first] = [aKey]; session.selections[second] = [aKey];
    await game.finishTargetSelection();
    assert.equal(game.targetSelection, session, "invalid dependent choice remains uncommitted and editable");
    assert.deepEqual(owner.graveyard, [a, b]); assert.equal(game.chainSystem.chainStack.length, 0);
    session.selections[second] = [bKey];
    await game.finishTargetSelection();
    assert.equal((await activation).success, true);
    assert.equal(game.targetSelection, null);
    assert.ok(owner.extraDeck.includes(a)); assert.ok(owner.extraDeck.includes(b));
  });
}
