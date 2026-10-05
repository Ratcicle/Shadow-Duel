import assert from "node:assert/strict";
import test from "node:test";
import Card from "../src/core/Card.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, type RuntimeGame } from "./helpers/game.js";

const first = "tech_zero_development_lab_synchro_target";
const second = "tech_zero_development_lab_shuffle_choice";

async function nextSelection(game: RuntimeGame, previous: RuntimeGame["targetSelection"] = null) {
  for (let count = 0; (!game.targetSelection || game.targetSelection === previous) && count < 200; count++) {
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  return required(game.targetSelection);
}
test("Lab declares only its Synchro target before selecting a monster during resolution", async t => {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.turn = "player"; game.phase = "main1"; game.turnCounter = 4; game.disablePresentationDelays = true;
  const owner = game.player, source = new Card(cardDefinition(518), owner.id);
  const synchro = new Card(cardDefinition(509), owner.id), monster = new Card(cardDefinition(501), owner.id);
  owner.controllerType = game.bot.controllerType = "ai"; owner.strategy = null;
  owner.fieldSpell = source; owner.graveyard.push(synchro, monster);
  const windows: string[][] = [];
  const original = game.chainSystem.offerChainResponses.bind(game.chainSystem);
  game.chainSystem.offerChainResponses = async (...args) => {
    const link = game.chainSystem.getLastChainLink();
    if (link?.effect?.id === "tech_zero_development_lab_recycle") windows.push((link.declaredTargets || []).map(target => required(target.targetId)));
    return original(...args);
  };
  assert.equal((await game.activateFieldSpellEffect(source)).success, true);
  assert.deepEqual(windows, [[first]]);
  assert.ok(owner.extraDeck.includes(synchro));
  assert.ok(owner.deck.includes(monster));
});
for (const seat of ["player", "bot"] as const) {
  test(`Lab returns its sole activation target without requiring a second monster (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, chainResponseTimeoutMs: 0 });
    t.after(() => game.dispose());
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4; game.disablePresentationDelays = true;
    const owner = game[seat], source = new Card(cardDefinition(518), seat), card = new Card(cardDefinition(509), seat);
    owner.controllerType = "human"; owner.fieldSpell = source; owner.graveyard.push(card);
    game.ui.showChainResponseModal = async () => null;
    const activation = game.activateFieldSpellEffect(source);
    const session = await nextSelection(game);
    assert.deepEqual(session.requirements.map(requirement => requirement.id), [first]);
    session.selections[first] = [required(required(session.requirements[0]).candidates.find(candidate => candidate.cardRef === card)).key];
    await game.finishTargetSelection();
    assert.equal((await activation).success, true);
    assert.deepEqual(owner.graveyard, []);
    assert.ok(owner.extraDeck.includes(card));
    assert.equal(game.targetSelection, null);
  });

  test(`Lab chooses a current graveyard monster after returning its declared target (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, chainResponseTimeoutMs: 0 });
    t.after(() => game.dispose());
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    const owner = game[seat], source = new Card(cardDefinition(518), seat);
    const a = new Card(cardDefinition(509), seat), b = new Card(cardDefinition(509), seat), arriving = new Card(cardDefinition(501), seat);
    owner.controllerType = "human"; owner.fieldSpell = source; owner.graveyard.push(a, b); owner.hand.push(arriving);
    game.ui.showChainResponseModal = async () => null;
    const targeted: Card[] = [];
    game.on("effect_targeted", event => { if (event.sourceCard === source && event.target instanceof Card) targeted.push(event.target); });
    const original = game.chainSystem.offerChainResponses.bind(game.chainSystem);
    let arrived = false;
    game.chainSystem.offerChainResponses = async (...args) => {
      const link = game.chainSystem.getLastChainLink();
      if (link?.effect?.id === "tech_zero_development_lab_recycle") {
        assert.deepEqual((link.declaredTargets || []).map(target => target.targetId), [first]);
        if (!arrived) {
          arrived = true;
          const moved = await game.moveCard(arriving, owner, "graveyard", { fromZone: "hand", awaitCardMovedEvent: true });
          assert.equal(moved.success, true);
        }
      }
      return original(...args);
    };
    const activation = game.activateFieldSpellEffect(source);
    const session = await nextSelection(game);
    assert.deepEqual(session.requirements.map(requirement => requirement.id), [first]);
    session.selections[first] = [required(required(session.requirements[0]).candidates.find(candidate => candidate.cardRef === a)).key];
    const completion = game.finishTargetSelection();
    const resolution = await nextSelection(game, session);
    assert.notEqual(resolution, session);
    assert.ok(owner.extraDeck.includes(a), "the first movement completes before the next choice");
    assert.deepEqual(resolution.requirements.map(requirement => requirement.id), [second]);
    const requirement = required(resolution.requirements[0]);
    assert.deepEqual(new Set(requirement.candidates.map(candidate => candidate.cardRef)), new Set([b, arriving]));
    assert.equal(resolution.preventCancel, true);
    resolution.selections[second] = [required(requirement.candidates.find(candidate => candidate.cardRef === arriving)).key];
    await game.finishTargetSelection(); await completion;
    assert.equal((await activation).success, true);
    assert.equal(game.targetSelection, null);
    assert.deepEqual(targeted, [a], "the resolution choice never publishes targeting");
    assert.deepEqual(owner.graveyard, [b]);
    assert.ok(owner.deck.includes(arriving));
  });

  test(`Lab skips its resolution choice when its declared target cannot return (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, chainResponseTimeoutMs: 0 });
    t.after(() => game.dispose());
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4; game.disablePresentationDelays = true;
    const owner = game[seat], source = new Card(cardDefinition(518), seat);
    const synchro = new Card(cardDefinition(509), seat), remaining = new Card(cardDefinition(501), seat);
    game.player.controllerType = game.bot.controllerType = "ai";
    owner.strategy = null; owner.fieldSpell = source; owner.graveyard.push(synchro, remaining);
    const original = game.chainSystem.offerChainResponses.bind(game.chainSystem);
    let removed = false;
    game.chainSystem.offerChainResponses = async (...args) => {
      if (!removed && game.chainSystem.getLastChainLink()?.effect?.id === "tech_zero_development_lab_recycle") {
        removed = true;
        await game.moveCard(synchro, owner, "banished", { fromZone: "graveyard", awaitCardMovedEvent: true });
      }
      return original(...args);
    };
    let resolutionChoices = 0;
    const select = game.autoSelector.select.bind(game.autoSelector);
    game.autoSelector.select = (contract, context) => {
      if ("requirements" in contract && Array.isArray(contract.requirements) && contract.requirements.some(requirement => requirement.id === second)) resolutionChoices++;
      return select(contract, context);
    };
    await game.activateFieldSpellEffect(source);
    assert.deepEqual(owner.graveyard, [remaining]);
    assert.ok(owner.banished.includes(synchro));
    assert.equal(owner.deck.includes(remaining), false);
    assert.equal(resolutionChoices, 0);
  });
}
