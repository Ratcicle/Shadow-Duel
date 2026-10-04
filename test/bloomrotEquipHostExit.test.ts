import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { CardMovedEventPayload, EventEquipHostExitBinding } from "../src/core/contracts/events.js";
import { cardDefinition, required, unsafeFixture } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

async function setup(t: TestContext, seat: "player" | "bot", kind: "normal" | "banished" | "token", borrowed = false) {
  const game = createRuntimeGame({ laboratoryMode: true, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.turn = seat; game.turnCounter = 3; game.phase = "main1";
  game.player.controllerType = game.bot.controllerType = "ai";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  const actor = game[seat], other = game[seat === "player" ? "bot" : "player"];
  const host = new Card({ ...cardDefinition(1), effects: [] }, other.id);
  host.isToken = kind === "token";
  host.banishWhenLeavesField = kind === "banished";
  const target = new Card({ ...cardDefinition(1), effects: [] }, other.id);
  placeFieldCards(other.field, host, target);
  const equip = new Card(cardDefinition(415), borrowed ? other.id : actor.id);
  if (borrowed) {
    equip.owner = equip.controller = actor.id; placeFieldCards(actor.spellTrap, equip);
    equip.equippedTo = equip.equipTarget = host; host.equips.push(equip); host.addCounter("spore", 1);
  } else {
    actor.hand.push(equip);
    const activated = await game.tryActivateSpell(equip, 0, { bloomrot_overgrowth_equip_target: [host] }, { owner: actor });
    assert.equal(activated.success, true);
  }
  assert.equal(equip.equippedTo, host);
  assert.equal(host.getCounter("spore"), 1);
  return { game, actor, other, host, target, equip };
}

for (const seat of ["player", "bot"] as const) {
  for (const kind of ["normal", "banished", "token"] as const) {
    for (const cause of ["battle", "effect"] as const) {
      test(`Overgrowth observes ${cause} host destruction at ${kind} (${seat})`, async t => {
        const { game, actor, other, host, target, equip } = await setup(t, seat, kind);
        const activations: string[] = [];
        game.on("effect_activated", event => { if (event.card === equip) activations.push(event.effect?.id || ""); });
        await game.destroyCard(host, { cause });
        assert.ok(actor.graveyard.includes(equip));
        assert.equal(equip.equippedTo, null);
        assert.equal(target.getCounter("spore"), 1);
        assert.deepEqual(activations, ["bloomrot_overgrowth_destroyed_host_spread"]);
        assert.equal(other.field.includes(host), false);
      });
    }
    test(`negated Overgrowth still publishes its ${kind} exit effect (${seat})`, async t => {
      const { game, actor, other, host, target, equip } = await setup(t, seat, kind);
      await game.effectEngine.applyActions([{ type: "add_status", targetRef: "equip", status: "effectsNegated", value: true }],
        { source: equip, player: actor, opponent: other }, { equip: [equip] });
      assert.equal(game.effectEngine.isEffectNegated(equip), true);
      let activations = 0;
      game.on("effect_activated", event => { if (event.card === equip && event.effect?.id === "bloomrot_overgrowth_destroyed_host_spread") activations++; });
      await game.destroyCard(host, { cause: "effect" });
      assert.equal(activations, 1);
      assert.equal(target.getCounter("spore"), 0);
      assert.equal(equip.effectsNegated, false);
    });
  }
  for (const operation of ["hand", "banished", "tribute"] as const) {
    test(`Overgrowth ignores non-destructive ${operation} (${seat})`, async t => {
      const { game, other, host, target } = await setup(t, seat, "normal");
      await game.moveCard(host, other, operation === "tribute" ? "graveyard" : operation, {
        fromZone: "field", contextLabel: operation, awaitEvents: true, awaitCardMovedEvent: true });
      assert.equal(target.getCounter("spore"), 0);
    });
  }
  test(`Overgrowth receipt rejects a source moved during cleanup callbacks (${seat})`, async t => {
    const { game, actor, host, target, equip } = await setup(t, seat, "token");
    let movedAgain = false;
    game.on("card_to_grave", async event => {
      if (event.card !== equip || movedAgain) return;
      movedAgain = true;
      await game.moveCard(equip, actor, "hand", { fromZone: "graveyard", awaitEvents: true, awaitCardMovedEvent: true });
      await game.moveCard(equip, actor, "graveyard", { fromZone: "hand", awaitEvents: true, awaitCardMovedEvent: true });
    });
    await game.destroyCard(host, { cause: "effect" });
    assert.equal(movedAgain, true);
    assert.ok(actor.graveyard.includes(equip));
    assert.equal(target.getCounter("spore"), 0);
  });
  test(`borrowed Overgrowth keeps its actor and returns to its original owner (${seat})`, async t => {
    const { game, actor, other, host, target, equip } = await setup(t, seat, "normal", true);
    const ownTarget = new Card({ ...cardDefinition(1), effects: [] }, actor.id); placeFieldCards(actor.field, ownTarget);
    const players: Array<string | null> = [];
    game.on("effect_activated", event => { if (event.card === equip) players.push(event.player.id); });
    await game.destroyCard(host, { cause: "effect", awaitCardMovedEvent: true });
    assert.ok(other.graveyard.includes(equip)); assert.equal(actor.graveyard.includes(equip), false);
    assert.deepEqual(players, [actor.id]);
    assert.equal(target.getCounter("spore"), 1); assert.equal(ownTarget.getCounter("spore"), 0);
  });
  test(`independent Overgrowth bindings each observe one host exit (${seat})`, async t => {
    const { game, actor, host, target } = await setup(t, seat, "token");
    const second = new Card(cardDefinition(415), actor.id); actor.hand.push(second);
    assert.equal((await game.tryActivateSpell(second, 0, { bloomrot_overgrowth_equip_target: [host] }, { owner: actor })).success, true);
    await game.destroyCard(host, { cause: "effect", awaitCardMovedEvent: true });
    assert.equal(target.getCounter("spore"), 2);
  });
  test(`queued Overgrowth requires its exact cleanup presence before SEGOC (${seat})`, async t => {
    const { game, actor, host, target, equip } = await setup(t, seat, "normal");
    game.chainSystem.isPreparingActivation = true;
    await game.destroyCard(host, { cause: "effect", awaitCardMovedEvent: true });
    assert.ok(game.chainSystem.pendingTriggerOccurrences.some(occurrence => occurrence.eventName === "card_moved"));
    await game.moveCard(equip, actor, "hand", { fromZone: "graveyard", awaitEvents: true, awaitCardMovedEvent: true });
    await game.moveCard(equip, actor, "graveyard", { fromZone: "hand", awaitEvents: true, awaitCardMovedEvent: true });
    game.chainSystem.isPreparingActivation = false;
    await game.flushPendingTriggerOccurrences();
    assert.equal(target.getCounter("spore"), 0);
  });
  test(`queued Overgrowth survives automatic cleanup until SEGOC (${seat})`, async t => {
    const { game, actor, host, target, equip } = await setup(t, seat, "token");
    game.chainSystem.isPreparingActivation = true;
    await game.destroyCard(host, { cause: "effect", awaitCardMovedEvent: true });
    assert.ok(actor.graveyard.includes(equip)); assert.equal(target.getCounter("spore"), 0);
    game.chainSystem.isPreparingActivation = false;
    await game.flushPendingTriggerOccurrences();
    assert.equal(target.getCounter("spore"), 1);
  });
  test(`Overgrowth publishes immutable host bindings and movement receipts (${seat})`, async t => {
    const { game, host, target } = await setup(t, seat, "token");
    let checked = false;
    game.on("card_moved", event => {
      if (event.card !== host) return;
      const bindings = required(event.equipBindingsAtFieldExit), binding = required(bindings[0]);
      const receipt = required(binding.equipAfterCleanup), version = receipt.locationVersion;
      assert.equal(Object.isFrozen(bindings), true); assert.equal(Object.isFrozen(binding), true);
      assert.equal(Object.isFrozen(binding.hostBeforeExit), true); assert.equal(Object.isFrozen(binding.equipBeforeExit), true);
      assert.equal(Object.isFrozen(receipt), true);
      assert.equal(Reflect.set(receipt, "locationVersion", 999), false);
      assert.equal(Reflect.set(binding, "equipAfterCleanup", null), false);
      assert.equal(receipt.locationVersion, version); checked = true;
    });
    await game.destroyCard(host, { cause: "effect", awaitCardMovedEvent: true });
    assert.equal(checked, true); assert.equal(target.getCounter("spore"), 1);
  });
  test(`an explicit Chain effect negation still stops committed Overgrowth (${seat})`, async t => {
    const { game, host, target, equip } = await setup(t, seat, "normal");
    game.on("effect_activated", event => {
      if (event.card !== equip || event.effect?.id !== "bloomrot_overgrowth_destroyed_host_spread") return;
      const link = required(game.chainSystem.chainStack.find(entry => entry.card === equip));
      game.chainSystem.markChainLinkEffectNegated(link);
    });
    await game.destroyCard(host, { cause: "effect", awaitCardMovedEvent: true });
    assert.equal(target.getCounter("spore"), 0);
  });
  for (const field of ["cardId", "duelCardId", "instanceId"] as const) {
    for (const mode of ["corrupted", "missing"] as const) test(`Overgrowth rejects ${mode} host ${field} (${seat})`, async t => {
      const { game, host, equip } = await setup(t, seat, "token");
      const captured: { payload: CardMovedEventPayload | null } = { payload: null };
      game.on("card_moved", payload => { if (payload.card === host) captured.payload = payload; });
      game.chainSystem.isPreparingActivation = true;
      await game.destroyCard(host, { cause: "effect", awaitCardMovedEvent: true });
      const payload = required(captured.payload), binding = required(payload.equipBindingsAtFieldExit?.[0]);
      const invalid = { ...binding, hostBeforeExit: { ...binding.hostBeforeExit } };
      if (mode === "corrupted") Reflect.set(invalid.hostBeforeExit, field, -999);
      else Reflect.deleteProperty(invalid.hostBeforeExit, field);
      const broken = unsafeFixture<EventEquipHostExitBinding>(invalid, `Deliberately ${mode} host identity tests fail-closed observer proof.`);
      const pack = await game.effectEngine.collectCardMovedTriggers({ ...payload, equipBindingsAtFieldExit: [broken] });
      assert.equal(pack.entries.some(entry => entry.card === equip), false);
      game.chainSystem.isPreparingActivation = false;
    });
  }
}

test("an off-field Equip cannot reconstruct historical eligibility from an incomplete host event", async t => {
  const { game, actor, other, host, equip } = await setup(t, "player", "normal");
  await game.moveCard(equip, actor, "graveyard", { fromZone: "spellTrap", awaitEvents: true, awaitCardMovedEvent: true });
  const pack = await game.effectEngine.collectCardMovedTriggers({ card: host, fromZone: "field", toZone: "graveyard",
    player: other, fromPlayer: other, toPlayer: other, wasDestroyed: true, destroyCause: "effect", wasFaceupBeforeMove: true });
  assert.equal(pack.entries.some(entry => entry.card === equip), false);
  assert.equal(required(equip.effects.find(effect => effect.id === "bloomrot_overgrowth_destroyed_host_spread")).event, "card_moved");
});
