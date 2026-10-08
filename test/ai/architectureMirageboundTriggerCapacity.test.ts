import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, completeTestSelections } from "../helpers/game.js";

for (const seat of ["player", "bot"] as const) for (const id of [353, 364] as const) for (const moment of ["before", "after_publication"] as const) {
  test(`full field ${moment} trigger opportunity preserves commitment boundary ${id} ${seat}`, async t => {
    t.mock.method(console, "log", () => {});
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
    t.after(() => game.dispose("stage9_capacity_oracle"));
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.player.controllerType = game.bot.controllerType = "ai";
    game.chainSystem.botChooseChainResponse = async () => null;
    game.ui.showConfirmPrompt = async () => true;
    const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
    const source = new Card(cardDefinition(id), seat), returned = new Card(cardDefinition(351), seat);
    const target = new Card(cardDefinition(351), opponent.id); target.effects = []; target.position = "defense";
    owner.hand.push(source, returned);
    placeFieldCards(opponent.field, target);
    const filler = () => { const card = new Card(cardDefinition(351), seat); card.effects = []; return card; };
    placeFieldCards(owner.field, ...Array.from({ length: moment === "before" ? 5 : 4 }, () => {
      const card = new Card(cardDefinition(351), seat); card.effects = []; return card;
    }));
    const effect = required(source.effects[0]);
    let published = 0, summons = 0;
    game.on("effect_activated", payload => {
      if (payload.card !== source) return;
      published++;
      if (moment === "after_publication") placeFieldCards(owner.field, filler());
    });
    game.on("after_summon", payload => { if (payload.card === source) summons++; });
    const preview = game.effectEngine.checkActionPreviewRequirements(effect.actions || [], {
      source, player: owner, opponent, effect, activationZone: "hand",
    });
    if (moment === "before") assert.deepEqual(preview, { ok: false, reason: "Field is full." });
    else assert.equal(preview.ok, true);
    const event = id === 353
      ? game.emit("card_moved", { card: returned, player: owner, fromZone: "field", toZone: "hand", movedByEffect: true })
      : game.emit("position_change", { card: target, player: opponent, fromPosition: "attack", toPosition: "defense", positionChangedByEffect: true, sourceCard: returned });
    await completeTestSelections(game, event); await event;
    assert.equal(published, moment === "before" ? 0 : 1); assert.equal(summons, 0);
    assert.equal(owner.hand.includes(source), true); assert.equal(owner.field.length, 5);
    assert.equal(target.position, "defense");
    assert.equal(game.canUseOncePerTurn(source, owner, effect).ok, moment === "before");
  });
}
