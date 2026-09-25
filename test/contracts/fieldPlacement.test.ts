import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";
import type { GameOptions } from "../../src/core/contracts/game.js";
import type { FieldPlacementRequest, FieldPlacementResult } from "../../src/core/contracts/placement.js";
import { FIELD_SLOTS, getAvailableFieldSlots, getFieldOccupants } from "../../src/core/game/zones/placement.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

function createGame(t: TestContext, options: GameOptions = {}): RuntimeGame {
  const game = createRuntimeGame({ disableChains: true, disableTraps: true, randomSeed: 4, ...options });
  game.phase = "main1";
  game.turnCounter = 3;
  t.after(() => game.dispose("field-placement-test"));
  return game;
}

function monster(id: number, owner: "player" | "bot" = "player"): Card {
  return new Card({ id, name: `Placement ${id}`, cardKind: "monster", atk: 1000, def: 1000, level: 4, effects: [] }, owner);
}

test("canonical monster positions preserve a hole and automatically refill it", async (t) => {
  const game = createGame(t);
  const cards = [monster(99100), monster(99101), monster(99102)];
  for (const card of cards) {
    game.player.hand.push(card);
    assert.equal((await game.moveCard(card, game.player, "field", { fromZone: "hand", summonOrigin: "effect_resolution" })).success, true);
  }
  const [first, middle, last] = cards;
  assert.ok(first && middle && last);
  assert.deepEqual(cards.map(card => card.fieldSlot), [0, 1, 2]);
  await game.moveCard(middle, game.player, "graveyard", { fromZone: "field" });
  assert.deepEqual(game.player.field, [first, last]);
  assert.equal(last.fieldSlot, 2);
  assert.equal(middle.fieldSlot, null);
  const added = monster(99103);
  game.player.hand.push(added);
  await game.moveCard(added, game.player, "field", { fromZone: "hand", summonOrigin: "effect_resolution" });
  assert.equal(added.fieldSlot, 1);
  assert.deepEqual(game.player.field, [first, last, added]);
});

test("spell/trap positions are independent of monster positions on both sides", async (t) => {
  const game = createGame(t);
  for (const player of [game.player, game.bot]) {
    const cards = [0, 1, 2].map(index => new Card({ id: 99200 + index, name: `Placed spell ${index}`, cardKind: "spell", subtype: "continuous", effects: [] }, player.id));
    for (const card of cards) {
      player.hand.push(card);
      await game.moveCard(card, player, "spellTrap", { fromZone: "hand" });
    }
    const [first, middle, last] = cards;
    assert.ok(first && middle && last);
    await game.moveCard(middle, player, "graveyard", { fromZone: "spellTrap" });
    assert.deepEqual(player.spellTrap, [first, last]);
    assert.deepEqual(player.spellTrap.map(card => card.fieldSlot), [0, 2]);
  }
});

test("expired temporary control without room destroys by rule into the original owner's graveyard", async (t) => {
  const game = createGame(t);
  game.turnCounter = 7;
  const card = monster(99300);
  card.owner = game.bot.id;
  card.controller = game.bot.id;
  card.fieldSlot = 0;
  game.bot.field.push(card);
  assert.equal((await game.takeControl(card, game.player, { duration: "until_end_phase" })).success, true);
  for (const index of FIELD_SLOTS) {
    const occupant = monster(99301 + index, "bot");
    occupant.fieldSlot = index;
    game.bot.field.push(occupant);
  }
  const movements: Array<{ destroyCause?: string | null; wasDestroyed?: boolean; movedByEffect?: boolean }> = [];
  game.on("card_moved", event => { if (event.card === card) movements.push(event); });
  game.on("control_changed", () => assert.fail("A failed return must not emit a successful transfer."));
  await game.processTemporaryControlEffects();
  assert.equal(game.player.field.includes(card), false);
  assert.equal(game.player.graveyard.includes(card), true);
  assert.equal(game.bot.graveyard.includes(card), false);
  assert.equal(card.fieldSlot, null);
  assert.equal(game.temporaryControlEffects.length, 0);
  assert.equal(movements.length, 1);
  assert.equal(movements[0]?.destroyCause, "rule");
  assert.equal(movements[0]?.wasDestroyed, true);
  assert.equal(movements[0]?.movedByEffect, false);
});

test("manual Normal Summon chooses slot 4 without changing the packed index", async (t) => {
  const requests: FieldPlacementRequest[] = [];
  const game = createGame(t, { getFieldPlacementMode: () => "manual", fieldPlacementProvider: async request => {
    requests.push(request);
    return { outcome: "chosen", slot: 4 };
  } });
  const card = monster(99400);
  game.player.hand.push(card);
  const result = await game.performNormalSummon(game.player, 0);
  assert.equal(result?.success, true);
  assert.equal(game.player.field.indexOf(card), 0);
  assert.equal(card.fieldSlot, 4);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.allowCancel, true);
  assert.equal(game.player.summonCount, 1);
});

test("cancelling placement before a Normal Summon preserves card and usage", async (t) => {
  const game = createGame(t, { getFieldPlacementMode: () => "manual", fieldPlacementProvider: async () => ({ outcome: "cancelled" }) });
  const card = monster(99401);
  game.player.hand.push(card);
  const result = await game.performNormalSummon(game.player, 0, "defense", true);
  assert.equal(result?.success, false);
  assert.deepEqual(game.player.hand, [card]);
  assert.deepEqual(game.player.field, []);
  assert.equal(card.fieldSlot, null);
  assert.equal(card.isFacedown, false);
  assert.equal(game.player.summonCount, 0);
  assert.equal(game.getSummonState().active, false);
});

test("a full field permits Tribute Summon using the vacancy freed by its material", async (t) => {
  const game = createGame(t, { getFieldPlacementMode: () => "manual", fieldPlacementProvider: async () => assert.fail("Only one vacancy must not open a prompt.") });
  const occupants = FIELD_SLOTS.map(slot => monster(99410 + slot));
  placeFieldCards(game.player.field, ...occupants);
  const tribute = occupants[2];
  assert.ok(tribute);
  const summoned = monster(99415);
  summoned.level = 6;
  game.player.hand.push(summoned);
  const result = await game.performNormalSummon(game.player, 0, "attack", false, [2]);
  assert.equal(result?.success, true);
  assert.equal(summoned.fieldSlot, 2);
  assert.equal(tribute.fieldSlot, null);
  assert.ok(game.player.graveyard.includes(tribute));
  assert.deepEqual(game.player.field.map(card => card.fieldSlot), [0, 1, 3, 4, 2]);
});

test("a pending preference is frozen and invalidated intents require a new recorded choice", async (t) => {
  let manual = true;
  let decide: ((value: FieldPlacementResult) => void) | undefined;
  const game = createGame(t, { getFieldPlacementMode: () => manual ? "manual" : "automatic", fieldPlacementProvider: () => new Promise(resolve => { decide = resolve; }) });
  const card = monster(99420);
  game.player.hand.push(card);
  const pending = game.prepareFieldPlacement(card, game.player, "field", { allowCancel: true });
  assert.ok(decide);
  manual = false;
  decide({ outcome: "chosen", slot: 4 });
  const chosen = await pending;
  assert.equal(chosen.outcome, "chosen");
  if (chosen.outcome !== "chosen") assert.fail("Expected chosen intent.");
  assert.equal(chosen.intent.slot, 4);
  const blocker = monster(99421);
  blocker.fieldSlot = 4;
  game.player.field.push(blocker);
  const revalidated = await game.prepareFieldPlacement(card, game.player, "field", { intent: chosen.intent });
  assert.equal(revalidated.outcome, "chosen");
  if (revalidated.outcome !== "chosen") assert.fail("Expected replacement decision.");
  assert.equal(revalidated.intent.slot, 0);
  assert.equal(revalidated.intent.allowCancel, false);
  assert.notEqual(revalidated.intent.procedureId, chosen.intent.procedureId);
  assert.equal(card.fieldSlot, null, "Choosing an intent must not occupy a position.");
});

test("reset aborts a pending move and a late provider result cannot mutate the next duel", async (t) => {
  let decide: ((value: FieldPlacementResult) => void) | undefined;
  const game = createGame(t, { getFieldPlacementMode: () => "manual", fieldPlacementProvider: () => new Promise(resolve => { decide = resolve; }) });
  const card = monster(99430);
  game.player.hand.push(card);
  const movement = game.moveCard(card, game.player, "field", { fromZone: "hand", summonOrigin: "effect_resolution" });
  assert.ok(decide);
  game.resetDuelState();
  const resetHand = [...game.player.hand];
  decide({ outcome: "chosen", slot: 4 });
  const result = await movement;
  assert.equal(result.success, false);
  assert.deepEqual(game.player.hand, resetHand);
  assert.equal(game.player.field.length, 0);
  assert.equal(game.pendingFieldPlacement, null);
  assert.equal(game.zoneOpDepth, 0);
});

test("unsupported headless manual configuration fails before a duel starts", () => {
  assert.throws(() => new Game({ getFieldPlacementMode: () => "manual" }), /requires a renderer or decision provider/);
});

test("Flip Summon keeps its physical position occupied while awaiting a response", async (t) => {
  const game = createGame(t);
  const card = monster(99440);
  card.fieldSlot = 4;
  card.isFacedown = true;
  card.position = "defense";
  card.setTurn = 1;
  game.player.field.push(card);
  const offer = game.offerSummonAttempt.bind(game);
  game.offerSummonAttempt = async (...args) => {
    assert.equal(game.player.field.includes(card), false);
    assert.equal(getAvailableFieldSlots(getFieldOccupants(game, game.player, "field")).includes(4), false);
    return offer(...args);
  };
  const result = await game.flipSummon(card);
  assert.equal(result.success, true);
  assert.equal(card.fieldSlot, 4);
  assert.equal(card.isFacedown, false);
  assert.equal(game.generatedIdCounters.get("field_placement"), undefined);
});

test("temporary return preserves presence and stale records cannot destroy a re-entered card", async (t) => {
  const game = createGame(t);
  const card = monster(99450, "bot");
  game.bot.hand.push(card);
  await game.moveCard(card, game.bot, "field", { fromZone: "hand", summonOrigin: "effect_resolution" });
  const presence = card.fieldPresenceId;
  const locationVersion = card.locationVersion;
  await game.takeControl(card, game.player, { duration: "until_end_phase" });
  assert.equal(card.fieldPresenceId, presence);
  assert.equal(card.locationVersion, locationVersion);
  const stale = game.temporaryControlEffects[0];
  assert.ok(stale);
  await game.processTemporaryControlEffects();
  assert.ok(game.bot.field.includes(card));
  assert.equal(card.fieldPresenceId, presence);
  assert.equal(card.locationVersion, locationVersion);
  await game.moveCard(card, game.bot, "graveyard", { fromZone: "field" });
  await game.moveCard(card, game.player, "field", { fromZone: "graveyard", summonOrigin: "effect_resolution" });
  assert.notEqual(card.fieldPresenceId, presence);
  game.temporaryControlEffects.push(stale);
  for (const slot of FIELD_SLOTS) {
    const occupant = monster(99460 + slot, "bot");
    occupant.fieldSlot = slot;
    game.bot.field.push(occupant);
  }
  await game.processTemporaryControlEffects();
  assert.ok(game.player.field.includes(card));
  assert.equal(game.temporaryControlEffects.length, 0);
});

test("rule destruction bypasses battle/effect protection and replacement", async (t) => {
  const game = createGame(t);
  const card = monster(99470);
  placeFieldCards(game.player.field, card);
  card.protectionEffects = [
    { type: "effect_destruction", duration: "while_faceup", grantedOnTurn: game.turnCounter },
    { type: "battle_destruction", duration: "while_faceup", grantedOnTurn: game.turnCounter },
  ];
  game.resolveDestructionWithReplacement = async () => assert.fail("Rule destruction must not be classified as effect destruction.");
  const result = await game.destroyCard(card, { cause: "rule", fromZone: "field", awaitCardToGraveEvent: true });
  assert.ok("destroyed" in result && result.destroyed);
  assert.ok(game.player.graveyard.includes(card));
  assert.equal(card.fieldSlot, null);
});

test("invalid occupancy is rejected rather than repaired, including repeated invariant checks", (t) => {
  const game = createGame(t);
  const card = monster(99480);
  placeFieldCards(game.player.field, card);
  assert.equal(game.assertStateInvariants("positions").ok, true);
  const duplicate = monster(99481);
  duplicate.fieldSlot = card.fieldSlot;
  game.player.field.push(duplicate);
  assert.equal(game.assertStateInvariants("positions", { failFast: false }).hasCritical, true);
  assert.equal(duplicate.fieldSlot, 0);
});

test("committed effect placement never offers cancellation even when a caller requests it", async (t) => {
  const game = createGame(t, { getFieldPlacementMode: () => "manual", fieldPlacementProvider: async request => {
    assert.equal(request.allowCancel, false);
    return { outcome: "chosen", slot: 3 };
  } });
  const card = monster(99500);
  game.player.hand.push(card);
  const result = await game.moveCard(card, game.player, "field", { fromZone: "hand", summonOrigin: "effect_resolution", allowPlacementCancel: true });
  assert.equal(result.success, true);
  assert.equal(card.fieldSlot, 3);
});

test("cancelling a Spell/Trap Set preserves facing, usage markers and the hand", async (t) => {
  const game = createGame(t, { getFieldPlacementMode: () => "manual", fieldPlacementProvider: async () => ({ outcome: "cancelled" }) });
  const card = new Card({ id: 99501, name: "Cancelled set", cardKind: "spell", subtype: "continuous", effects: [] }, "player");
  game.player.hand.push(card);
  const oldSetTurn = card.setTurn;
  const result = await game.setSpellOrTrap(card, 0, game.player);
  assert.equal(result.ok, false);
  assert.deepEqual(game.player.hand, [card]);
  assert.equal(card.fieldSlot, null);
  assert.equal(card.isFacedown, false);
  assert.equal(card.setTurn, oldSetTurn);
  assert.equal(game.player.spellTrap.length, 0);
});

test("rule destruction qualifies a general destroyed trigger but not battle/effect triggers", async (t) => {
  const game = createGame(t);
  const card = new Card({ id: 99502, name: "Cause probe", cardKind: "monster", level: 4, atk: 1000, def: 1000, effects: [
    { id: "general", timing: "on_event", event: "card_to_grave", triggerRequirement: "mandatory", triggerTiming: "if", requireSelfAsDestroyed: true, actions: [{ type: "heal", amount: 100, player: "self" }] },
    { id: "battle", timing: "on_event", event: "card_to_grave", triggerRequirement: "mandatory", triggerTiming: "if", condition: { type: "destroyed_by_battle" }, actions: [{ type: "heal", amount: 200, player: "self" }] },
    { id: "either", timing: "on_event", event: "card_to_grave", triggerRequirement: "mandatory", triggerTiming: "if", condition: { type: "destroyed_by_battle_or_effect" }, actions: [{ type: "heal", amount: 800, player: "self" }] },
  ] }, "player");
  placeFieldCards(game.player.field, card);
  const qualified: string[] = [];
  game.on("card_to_grave", async payload => {
    const triggers = await game.effectEngine.collectCardToGraveTriggers(payload);
    for (const entry of triggers.entries) {
      assert.ok(entry.effect.id);
      qualified.push(entry.effect.id);
    }
  });
  await game.destroyCard(card, { cause: "rule", fromZone: "field", awaitCardToGraveEvent: true });
  assert.deepEqual(qualified, ["general"]);
});

test("rule destruction of a Token frees its space, presence and equipment before completion", async (t) => {
  const game = createGame(t);
  const token = monster(99503);
  token.isToken = true;
  await game.moveCard(token, game.player, "field", { fromZone: "token", summonOrigin: "effect_resolution" });
  const equip = new Card({ id: 99504, name: "Token equipment", cardKind: "spell", subtype: "equip", effects: [] }, "bot");
  placeFieldCards(game.bot.spellTrap, equip);
  equip.equippedTo = token;
  equip.equipTarget = token;
  token.equips = [equip];
  const result = await game.destroyCard(token, { cause: "rule", fromZone: "field", awaitCardMovedEvent: true });
  assert.ok("destroyed" in result && result.destroyed);
  assert.equal(token.fieldSlot, null);
  assert.equal(token.fieldPresenceId ?? null, null);
  assert.equal(game.collectAllZoneCards().includes(token), false);
  assert.ok(game.bot.graveyard.includes(equip));
  assert.equal(equip.fieldSlot, null);
  assert.equal(equip.equippedTo, null);
});

test("rule destruction preserves an applicable leave-field banish redirect", async (t) => {
  const game = createGame(t);
  const card = monster(99505);
  card.banishWhenLeavesField = true;
  placeFieldCards(game.player.field, card);
  const result = await game.destroyCard(card, { cause: "rule", fromZone: "field" });
  assert.ok("destroyed" in result && result.destroyed);
  assert.ok(game.player.banished.includes(card));
  assert.equal(card.fieldSlot, null);
});

test("a later control change during publication supersedes the earlier temporary return", async (t) => {
  const game = createGame(t);
  const card = monster(99506, "bot");
  placeFieldCards(game.bot.field, card);
  let nested = false;
  const resolve = game.resolveEvent.bind(game);
  game.resolveEvent = async (...args) => {
    if (args[0] === "control_changed" && !nested) {
      nested = true;
      await game.takeControl(card, game.bot);
      await game.takeControl(card, game.player);
    }
    return resolve(...args);
  };
  await game.takeControl(card, game.player, { duration: "until_end_phase" });
  assert.ok(game.player.field.includes(card));
  assert.equal(game.temporaryControlEffects.length, 0);
  await game.processTemporaryControlEffects();
  assert.ok(game.player.field.includes(card));
});

test("reset during a summon window never publishes the old entrant or emits after_summon", async (t) => {
  const game = createGame(t);
  const card = monster(99507);
  game.player.hand.push(card);
  let summons = 0;
  game.on("after_summon", () => { summons++; });
  game.offerSummonAttempt = async () => {
    game.resetDuelState();
    return { ok: true };
  };
  const result = await game.performNormalSummon(game.player, 0);
  assert.equal(result?.success, false);
  assert.equal(summons, 0);
  assert.equal(card.fieldSlot, null);
  assert.equal(game.player.field.length, 0);
  assert.equal(game.generatedIdCounters.get("field_placement"), undefined);
});

test("an intent from an earlier duel cannot be reused after reset", async (t) => {
  const game = createGame(t);
  const card = monster(99508);
  game.player.hand.push(card);
  const placement = await game.prepareFieldPlacement(card, game.player, "field");
  assert.equal(placement.outcome, "chosen");
  if (placement.outcome !== "chosen") assert.fail("Expected chosen intent.");
  game.resetDuelState();
  await assert.rejects(game.prepareFieldPlacement(card, game.player, "field", { intent: placement.intent }), /ended duel/);
  assert.equal(game.generatedIdCounters.get("field_placement"), undefined);
});

test("concurrent expiry processes each temporary-control return only once", async (t) => {
  const game = createGame(t);
  const card = monster(99509, "bot");
  placeFieldCards(game.bot.field, card);
  await game.takeControl(card, game.player, { duration: "until_end_phase" });
  placeFieldCards(game.bot.field, ...FIELD_SLOTS.map(slot => monster(99510 + slot, "bot")));
  let departures = 0;
  game.on("card_moved", event => { if (event.card === card) departures++; });
  await Promise.all([game.processTemporaryControlEffects(), game.processTemporaryControlEffects()]);
  assert.equal(departures, 1);
  assert.ok(game.bot.graveyard.includes(card));
  assert.equal(game.player.graveyard.includes(card), false);
  assert.equal(game.temporaryControlEffects.length, 0);
});
