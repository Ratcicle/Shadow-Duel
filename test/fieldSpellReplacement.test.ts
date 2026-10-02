import assert from "node:assert/strict";
import test from "node:test";
import Card from "../src/core/Card.js";
import { cardDefinition } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

for (const seat of ["player", "bot"] as const) {
  test(`field replacement accepts canonical redirection of incumbent departure (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
    t.after(() => game.dispose());
    const owner = game[seat], opponent = game.getOpponent(owner);
    const previous = new Card(cardDefinition(217), seat), incoming = new Card(cardDefinition(115), seat);
    const galaxy = new Card(cardDefinition(273), opponent.id);
    galaxy.isFacedown = false;
    placeFieldCards(opponent.field, galaxy);
    owner.fieldSpell = previous; owner.hand.push(incoming);
    const result = await game.moveCard(incoming, owner, "fieldSpell", { fromZone: "hand" });
    assert.equal(result.success, true);
    assert.equal(owner.fieldSpell, incoming);
    assert.deepEqual(owner.banished, [previous]);
    assert.deepEqual(owner.hand, []);
  });

  for (const interruption of ["source-moved", "slot-refilled"] as const) {
    test(`field replacement revalidates state after incumbent events (${seat}/${interruption})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
      t.after(() => game.dispose());
      const owner = game[seat], previous = new Card(cardDefinition(217), seat), incoming = new Card(cardDefinition(115), seat);
      const third = new Card(cardDefinition(262), seat);
      owner.fieldSpell = previous; owner.hand.push(incoming, third);
      // Controlled event subscriber models another movement while departure is awaited.
      game.on("card_moved", async event => {
        if (event.card !== previous) return;
        await game.moveCard(interruption === "source-moved" ? incoming : third, owner,
          interruption === "source-moved" ? "graveyard" : "fieldSpell", { fromZone: "hand", awaitCardMovedEvent: true });
      });
      const result = await game.moveCard(incoming, owner, "fieldSpell", { fromZone: "hand" });
      assert.equal(result.success, false);
      assert.equal(result.reason, interruption === "source-moved" ? "field_spell_source_changed" : "field_spell_slot_occupied");
      assert.ok(owner.graveyard.includes(previous));
      assert.equal(owner.fieldSpell, interruption === "source-moved" ? null : third);
      assert.equal(owner.hand.includes(incoming), interruption === "slot-refilled");
      assert.equal(owner.graveyard.includes(incoming), interruption === "source-moved");
    });
  }

  test(`field activation awaits incumbent departure and preserves both cards (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, randomSeed: 601 });
    t.after(() => game.dispose());
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.player.controllerType = game.bot.controllerType = "human";
    game.disablePresentationDelays = true;
    game.ui.showChainResponseModal = async () => null;
    const owner = game[seat];
    const previous = new Card(cardDefinition(217), seat);
    const incoming = new Card(cardDefinition(115), seat);
    owner.hand.push(previous, incoming);
    assert.equal((await game.tryActivateSpell(previous, 0, null, { owner })).success, true);
    const events: string[] = [];
    game.on("card_moved", async event => {
      if (event.card === previous) {
        await Promise.resolve();
        events.push(`old:${event.toZone}`);
        assert.equal(owner.fieldSpell, null, "the new slot must wait for the old movement event");
        assert.ok(owner.graveyard.includes(previous));
      }
      if (event.card === incoming) events.push(`new:${event.toZone}`);
    });
    assert.equal((await game.tryActivateSpell(incoming, owner.hand.indexOf(incoming), null, { owner })).success, true);
    assert.equal(owner.fieldSpell, incoming);
    assert.deepEqual(owner.graveyard, [previous]);
    assert.deepEqual(owner.hand, []);
    assert.deepEqual(events, ["old:graveyard", "new:fieldSpell"]);
    assert.equal(previous.locationVersion, 2);
    assert.equal(incoming.locationVersion, 1);
  });

  test(`field replacement cannot evict the incumbent for a missing source (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
    t.after(() => game.dispose());
    const owner = game[seat], previous = new Card(cardDefinition(217), seat), missing = new Card(cardDefinition(115), seat);
    owner.fieldSpell = previous;
    const result = await game.moveCard(missing, owner, "fieldSpell", { fromZone: "hand" });
    assert.equal(result.success, false);
    assert.equal(owner.fieldSpell, previous);
    assert.deepEqual(owner.graveyard, []);
  });

  test(`field replacement preserves incoming source when incumbent movement refuses (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
    t.after(() => game.dispose());
    const owner = game[seat], previous = new Card(cardDefinition(217), seat), incoming = new Card(cardDefinition(115), seat);
    owner.fieldSpell = previous; owner.hand.push(incoming);
    const move = game.moveCard.bind(game);
    t.mock.method(game, "moveCard", (...args: Parameters<typeof game.moveCard>) => args[0] === previous
      ? { success: false, reason: "test_departure_refused" }
      : move(...args));
    const result = await game.moveCard(incoming, owner, "fieldSpell", { fromZone: "hand" });
    assert.equal(result.success, false);
    assert.equal(result.reason, "test_departure_refused");
    assert.equal(owner.fieldSpell, previous);
    assert.deepEqual(owner.hand, [incoming]);
    assert.deepEqual(owner.graveyard, []);
    assert.equal(incoming.locationVersion, 0);
  });
}
