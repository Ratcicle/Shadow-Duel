import assert from "node:assert/strict";
import test from "node:test";
import type { GamePlayer } from "../src/core/contracts/player.js";
import {
  getActivatableMonsterIgnitionEffects,
  getFirstActivatableMonsterIgnitionEffect,
  getMonsterIgnitionEffect,
  getHandActivationEffect,
  getSpellTrapActivationEffect,
} from "../src/core/effects/activation/getters.js";
import Card from "../src/core/Card.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import type { ActivationCard } from "../src/core/effects/activation/runtime.js";
import { cardDefinition, required, unsafeFixture } from "./helpers/fixtures.js";

test("monster ignition getters preserve their standalone fallback with a null receiver", () => {
  const card = unsafeFixture<ActivationCard>(
    { effects: [] },
    "Standalone getter fallback only reads the effects collection.",
  );
  const player = unsafeFixture<GamePlayer>(
    {},
    "An empty effect collection never inspects the player fixture.",
  );

  assert.equal(
    Reflect.apply(getMonsterIgnitionEffect, null, [card, "field"]),
    null,
  );
  assert.deepEqual(
    Reflect.apply(getActivatableMonsterIgnitionEffects, null, [
      card,
      player,
      "field",
    ]),
    [],
  );
  assert.equal(
    Reflect.apply(getFirstActivatableMonsterIgnitionEffect, null, [
      card,
      player,
      "field",
    ]),
    null,
  );
});

for (const subtype of ["normal", "equip", "continuous", "quick"] as const) {
  test(`B26 Set ${subtype} Spell selects on_play before Ignition and preserves face-up/other-zone lookup`, () => {
    const card = new Card({ id: 9001, name: "Dual activation fixture", cardKind: "spell", subtype,
      effects: [{ id: "fixture_ignition", timing: "ignition", activationZones: ["spellTrap"], actions: [] },
        { id: "fixture_play", timing: "on_play", actions: [] },
        { id: "fixture_grave", timing: "ignition", activationZones: ["graveyard"], actions: [] }] }, "player");
    const host = { getHandActivationEffect };
    card.isFacedown = true;
    assert.equal(getSpellTrapActivationEffect.call(host, card)?.id, "fixture_play");
    assert.equal(getSpellTrapActivationEffect.call(host, card, { fromHand: true })?.id, "fixture_play");
    assert.equal(getSpellTrapActivationEffect.call(host, card, { activationZone: "graveyard" })?.id, "fixture_grave");
    card.isFacedown = false;
    assert.equal(getSpellTrapActivationEffect.call(host, card)?.id, "fixture_ignition");
  });
}

test("B26 Set Trap continues to select on_activate instead of on_play or Ignition", () => {
  const card = new Card({ id: 9002, name: "Trap activation fixture", cardKind: "trap", subtype: "continuous",
    effects: [{ id: "fixture_play", timing: "on_play", actions: [] },
      { id: "fixture_ignition", timing: "ignition", activationZones: ["spellTrap"], actions: [] },
      { id: "fixture_activate", timing: "on_activate", actions: [] }] }, "player");
  card.isFacedown = true;
  assert.equal(getSpellTrapActivationEffect.call({ getHandActivationEffect }, card)?.id, "fixture_activate");
  card.isFacedown = false;
  assert.equal(getSpellTrapActivationEffect.call({ getHandActivationEffect }, card)?.id, "fixture_ignition");
});

for (const seat of ["player", "bot"] as const) {
  test(`B26 Set Meeting with only Ignition places without choosing a mode or paying costs (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, chainResponseTimeoutMs: 0 });
    t.after(() => game.dispose());
    game.turn = seat; game.phase = "main1"; game.turnCounter = 3; game.disablePresentationDelays = true;
    game.player.controllerType = game.bot.controllerType = "ai";
    const owner = game[seat], meeting = new Card(cardDefinition(309), seat);
    meeting.isFacedown = true; meeting.setTurn = 1;
    placeFieldCards(owner.spellTrap, meeting);
    const ignition = required(meeting.effects?.find(effect => effect.timing === "ignition"));
    assert.equal(game.effectEngine.getSpellTrapActivationEffect(meeting), null);
    assert.equal(game.effectEngine.canActivateSpellTrapEffectPreview(meeting, owner).ok, true);
    const result = await game.tryActivateSpellTrapEffect(meeting, null, { owner });
    assert.equal(result.success, true, result.reason ?? undefined);
    assert.equal(result.placementOnly, true);
    assert.equal(meeting.isFacedown, false);
    assert.deepEqual([owner.hand.length, owner.graveyard.length, owner.lp], [0, 0, 8000]);
    assert.equal(game.effectEngine.checkOncePerTurn(meeting, owner, ignition).ok, true);
    assert.equal(game.effectEngine.getSpellTrapActivationEffect(meeting)?.id, ignition.id);
  });

  for (const dual of [false, true]) {
    test(`B26 public Set continuous resolves its on_play through a real Chain (${seat}/${dual ? "dual" : "single"})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, chainResponseTimeoutMs: 0 });
      t.after(() => game.dispose());
      game.turn = seat; game.phase = "main1"; game.turnCounter = 3; game.disablePresentationDelays = true;
      game.player.controllerType = game.bot.controllerType = "ai";
      const owner = game[seat];
      const card = new Card({ id: 9005, name: "Continuous activation fixture", cardKind: "spell", subtype: "continuous",
        effects: [{ id: "fixture_play", timing: "on_play", actions: [{ type: "heal", amount: 100, player: "self" }] },
          ...(dual ? [{ id: "fixture_ignition", timing: "ignition" as const, activationZones: ["spellTrap" as const],
            actions: [{ type: "heal" as const, amount: 200, player: "self" as const }] }] : [])] }, seat);
      card.isFacedown = true; card.setTurn = 1;
      placeFieldCards(owner.spellTrap, card);
      const slot = card.fieldSlot;
      let activations = 0, links = 0;
      game.on("spell_activated", event => { if (event.card === card) activations++; });
      game.chainSystem.offerChainResponses = async () => {
        if (game.chainSystem.chainStack.length) {
          links++;
          assert.equal(game.chainSystem.chainStack[0]?.effect?.id, "fixture_play");
          assert.equal(card.isFacedown, false);
        }
        return { offers: 1, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false };
      };
      assert.equal(game.effectEngine.canActivateSpellTrapEffectPreview(card, owner).ok, true);
      const result = await game.tryActivateSpellTrapEffect(card, {}, { owner });
      assert.equal(result.success, true, result.reason ?? undefined);
      assert.equal(owner.lp, 8100);
      assert.equal(card.isFacedown, false);
      assert.equal(card.fieldSlot, slot);
      assert.ok(owner.spellTrap.includes(card));
      assert.deepEqual([activations, links], [1, 1]);
      assert.equal(game.effectEngine.getSpellTrapActivationEffect(card)?.id, dual ? "fixture_ignition" : undefined);
    });
  }

  test(`B26 prepared continuous on_play survives the committed face-up source (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, chainResponseTimeoutMs: 0 });
    t.after(() => game.dispose());
    game.turn = seat; game.phase = "main1"; game.turnCounter = 3;
    game.disablePresentationDelays = true;
    const owner = game[seat];
    const card = new Card({ id: 9003, name: "Prepared continuous fixture", cardKind: "spell", subtype: "continuous",
      effects: [{ id: "fixture_play", timing: "on_play", actions: [{ type: "heal", amount: 100, player: "self" }] }] }, seat);
    const effect = card.effects?.[0];
    assert.ok(effect);
    placeFieldCards(owner.spellTrap, card);
    assert.equal(card.isFacedown, false);
    const result = await game.effectEngine.activateSpellTrapEffect(card, owner, {}, "spellTrap", {
      committed: true, costsPaid: true, preparedEffect: effect,
    });
    assert.equal(result.success, true, result.reason ?? undefined);
    assert.equal(result.placementOnly, undefined);
    assert.equal(owner.lp, 8100);
  });

  test(`B26 Set continuous without on_play still activates as placement (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, chainResponseTimeoutMs: 0 });
    t.after(() => game.dispose());
    game.turn = seat; game.phase = "main1"; game.turnCounter = 3;
    game.disablePresentationDelays = true;
    game.player.controllerType = game.bot.controllerType = "ai";
    const owner = game[seat];
    const card = new Card({ id: 9004, name: "Placement continuous fixture", cardKind: "spell", subtype: "continuous", effects: [] }, seat);
    card.isFacedown = true; card.setTurn = 1;
    placeFieldCards(owner.spellTrap, card);
    assert.equal(game.effectEngine.canActivateSpellTrapEffectPreview(card, owner).ok, true);
    assert.equal((await game.tryActivateSpellTrapEffect(card, {}, { owner })).success, true);
    assert.equal(card.isFacedown, false);
    assert.ok(owner.spellTrap.includes(card));
    assert.equal(owner.lp, 8000);
  });
}
