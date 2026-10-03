import assert from "node:assert/strict";
import test from "node:test";
import Card from "../src/core/Card.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, completeTestSelections } from "./helpers/game.js";

for (const seat of ["player", "bot"] as const) {
  for (const [id, effectId] of [[354, "miragebound_oasis_ignition"], [355, "miragebound_glass_sovereign_bounce"], [359, "miragebound_mirror_path_destroy_spell_trap"]] as const) {
    test(`P2 ${effectId} has independent copy/presence usage (${seat})`, async t => {
      const game = createRuntimeGame({ captureReplay: false }); t.after(() => game.dispose());
      const owner = game[seat], first = new Card(cardDefinition(id), seat), second = new Card(cardDefinition(id), seat);
      const effect = required(first.effects.find(entry => entry.id === effectId));
      game.markOncePerTurnUsed(first, owner, effect);
      assert.equal(game.canUseOncePerTurn(first, owner, effect).ok, false);
      assert.equal(game.canUseOncePerTurn(second, owner, effect).ok, true);
      if (id === 354) owner.fieldSpell = first;
      else placeFieldCards(id === 359 ? owner.spellTrap : owner.field, first);
      await game.moveCard(first, owner, "graveyard", { fromZone: id === 354 ? "fieldSpell" : id === 359 ? "spellTrap" : "field", awaitEvents: true });
      assert.equal(game.canUseOncePerTurn(first, owner, effect).ok, true, "a new presence receives its own soft OPT");
    });
  }
  for (const controller of ["human", "ai"] as const) test(`P2 both Rebel copies return in End Phase (${seat}, ${controller})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, chainResponseTimeoutMs: 0 });
    t.after(() => game.dispose());
    game.turn = seat; game.phase = "end";
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "ai";
    const owner = game[seat]; owner.controllerType = controller;
    game.ui.showConfirmPrompt = async () => assert.fail("mandatory Rebel return must not ask confirmation");
    game.ui.showChainResponseModal = async () => null;
    game.ui.showTriggerOrderModal = async options => (options?.candidates || []).map(candidate => candidate.candidateId);
    const first = new Card(cardDefinition(364), seat), second = new Card(cardDefinition(364), seat);
    placeFieldCards(owner.field, first, second);
    const returned: string[] = [];
    game.on("card_moved", event => { if (event.toZone === "hand" && (event.card === first || event.card === second)) returned.push(event.card.name || "Rebel"); });
    const action = game.emit("end_phase", { player: owner, opponent: game.getOpponent(owner) });
    await completeTestSelections(game, action); await action;
    assert.equal(owner.field.length, 0); assert.ok(owner.hand.includes(first)); assert.ok(owner.hand.includes(second));
    assert.equal(returned.length, 2);
  });
}
