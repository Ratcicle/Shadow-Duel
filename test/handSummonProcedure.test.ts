import assert from "node:assert/strict";
import test from "node:test";
import Card from "../src/core/Card.js";
import { cardDatabaseByName, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

function setup() {
  const game = createRuntimeGame();
  game.phase = "main1";
  game.turn = "player";
  game.player.controllerType = "human";
  game.bot.controllerType = "ai";
  game.player.hand = [];
  game.player.field = [];
  game.player.graveyard = [];
  game.player.banished = [];
  game.bot.field = [];
  game.bot.hand = [];
  const card = new Card(required(cardDatabaseByName.get("Luminous God Hyperion")), game.player.id);
  game.player.hand.push(card);
  const materials = Array.from({ length: 5 }, (_, index) => new Card({
    name: `Light cost ${index}`, cardKind: "monster", attribute: "Light", level: 1, atk: 100, def: 100,
  }, game.player.id));
  game.player.graveyard.push(...materials);
  return { game, card, materials };
}

test("hand summon procedure pays five sequential costs and creates no activation or Chain Link", async (t) => {
  const { game, card, materials } = setup();
  t.after(() => game.dispose());
  assert.equal(typeof game.performHandSummonProcedure, "function");
  const chainLinks = t.mock.method(game.chainSystem, "addToChain");
  const events: string[] = [];
  game.on("card_moved", ({ card: moved }) => { events.push(moved.name || ""); });
  game.on("effect_activated", () => { events.push("activation"); });
  game.on("chain_link_resolution", () => { events.push("chain"); });
  const result = await game.performHandSummonProcedure(card, game.player, { materials, position: "attack" });
  assert.equal(result.success, true);
  assert.equal(chainLinks.mock.callCount(), 0);
  assert.deepEqual(events, [...materials.map((material) => material.name), card.name]);
  assert.deepEqual(game.player.banished, materials);
  assert.equal(card.lastSummonProcedure, card.handSummonProcedure?.id);
  assert.equal(game.lastSummonTransaction?.summonOrigin, "procedure");
  assert.equal(card.counters.size, 0);
  assert.equal(card.effectMarkers, undefined);
  const source = new Card({ name: "Opponent effect", cardKind: "spell" }, game.bot.id);
  const blocked = await game.destroyCard(card, { cause: "effect", sourceCard: source, sourcePlayer: game.bot });
  assert.ok("destroyed" in blocked && blocked.destroyed === false);
  const destroyed = await game.destroyCard(card, { cause: "effect", sourceCard: card, sourcePlayer: game.player });
  assert.ok("destroyed" in destroyed && destroyed.destroyed === true);
});

test("human hand procedure requires explicit cost selection, even with exactly five candidates", async (t) => {
  const { game, card } = setup();
  t.after(() => game.dispose());
  assert.equal(typeof game.performHandSummonProcedure, "function");
  const result = await game.performHandSummonProcedure(card, game.player, { position: "attack" });
  assert.equal(result.needsSelection, true);
  assert.equal(game.player.banished.length, 0);
  assert.ok(game.player.hand.includes(card));
  assert.equal(game.targetSelection?.selectionContract.requirements[0]?.min, 5);
  assert.equal(game.targetSelection?.selectionContract.requirements[0]?.max, 5);
  const selection = required(game.targetSelection);
  selection.selections.hand_summon_cost = required(selection.requirements[0]).candidates.map((candidate) => candidate.key);
  await game.finishTargetSelection();
  assert.ok(game.player.field.includes(card));
  assert.equal(game.player.banished.length, 5);
});

test("hand procedure validates exact distinct own LIGHT costs before moving any card", async (t) => {
  const { game, card, materials } = setup();
  t.after(() => game.dispose());
  const first = required(materials[0]);
  const foreign = new Card({ name: "Foreign Light", cardKind: "monster", attribute: "Light" }, game.bot.id);
  game.bot.graveyard.push(foreign);
  for (const invalid of [materials.slice(0, 4), [...materials, first], [first, first, ...materials.slice(2)], [foreign, ...materials.slice(1)]]) {
    assert.equal((await game.performHandSummonProcedure(card, game.player, { materials: invalid, position: "attack" })).success, false);
    assert.equal(game.player.banished.length, 0);
  }
  first.attribute = "Dark";
  assert.equal((await game.performHandSummonProcedure(card, game.player, { materials, position: "attack" })).success, false);
  assert.equal(game.player.banished.length, 0);
});

test("hand procedure can free a full field using its own facedown LIGHT monster", async (t) => {
  const { game, card, materials } = setup();
  t.after(() => game.dispose());
  const fieldCost = required(materials[0]);
  game.player.graveyard.splice(0, 1);
  fieldCost.isFacedown = true;
  placeFieldCards(game.player.field, fieldCost, ...Array.from({ length: 4 }, (_, index) => new Card({ name: `Field ${index}`, cardKind: "monster", attribute: "Dark" }, game.player.id)));
  const freedSlot = fieldCost.fieldSlot;
  assert.equal(game.canSummonFromHandByProcedure(card, game.player).ok, true);
  assert.equal((await game.performHandSummonProcedure(card, game.player, { materials, position: "defense" })).success, true);
  assert.equal(game.player.field.length, 5);
  assert.equal(card.position, "defense");
  assert.equal(card.fieldSlot, freedSlot);
  assert.equal(fieldCost.fieldSlot, null);
});

test("procedure is unavailable with a full field and no selected field cost", async (t) => {
  const { game, card, materials } = setup();
  t.after(() => game.dispose());
  placeFieldCards(game.player.field, ...Array.from({ length: 5 }, (_, index) => new Card({ name: `Field ${index}`, cardKind: "monster", attribute: "Dark" }, game.player.id)));
  assert.equal(game.canSummonFromHandByProcedure(card, game.player).ok, false);
  assert.equal((await game.performHandSummonProcedure(card, game.player, { materials, position: "attack" })).success, false);
  assert.equal(game.player.banished.length, 0);
});

test("ordinary summons and revival never gain the own-procedure protection", async (t) => {
  const { game, card, materials } = setup();
  t.after(() => game.dispose());
  assert.equal((await game.performHandSummonProcedure(card, game.player, { materials, position: "attack" })).success, true);
  await game.moveCard(card, game.player, "graveyard", { fromZone: "field" });
  await game.moveCard(card, game.player, "field", { fromZone: "graveyard", summonOrigin: "effect_resolution", summonMethodOverride: "special", summonProcedure: "card_effect" });
  assert.ok(game.player.field.includes(card));
  assert.equal(card.lastSummonProcedure, "card_effect");
  const source = new Card({ name: "Opponent effect", cardKind: "spell" }, game.bot.id);
  const destroyed = await game.destroyCard(card, { cause: "effect", sourceCard: source, sourcePlayer: game.bot });
  assert.ok("destroyed" in destroyed && destroyed.destroyed === true);
});

test("pending hand procedure cannot use a source that left and returned to hand", async (t) => {
  const { game, card } = setup();
  t.after(() => game.dispose());
  await game.performHandSummonProcedure(card, game.player, { position: "attack" });
  const selection = required(game.targetSelection);
  selection.selections.hand_summon_cost = required(selection.requirements[0]).candidates.map((candidate) => candidate.key);
  await game.moveCard(card, game.player, "graveyard", { fromZone: "hand" });
  await game.moveCard(card, game.player, "hand", { fromZone: "graveyard" });
  await game.finishTargetSelection();
  assert.equal(game.player.banished.length, 0);
  assert.ok(game.player.hand.includes(card));
});

test("AI procedure selects a legal field-releasing cost when the field is full", async (t) => {
  const { game, card } = setup();
  t.after(() => game.dispose());
  game.player.controllerType = "ai";
  const fieldCost = new Card({ name: "Field Light", cardKind: "monster", attribute: "Light", atk: 3000 }, game.player.id);
  placeFieldCards(game.player.field, fieldCost, ...Array.from({ length: 4 }, (_, index) => new Card({ name: `Field ${index}`, cardKind: "monster", attribute: "Dark" }, game.player.id)));
  const result = await game.performHandSummonProcedure(card, game.player, { position: "attack" });
  assert.equal(result.success, true);
  assert.ok(game.player.banished.includes(fieldCost));
  assert.ok(game.player.field.includes(card));
});

test("cancelling the human cost selection spends no cards", async (t) => {
  const { game, card } = setup();
  t.after(() => game.dispose());
  await game.performHandSummonProcedure(card, game.player);
  game.cancelTargetSelection();
  assert.equal(game.targetSelection, null);
  assert.equal(game.player.banished.length, 0);
  assert.ok(game.player.hand.includes(card));
});

test("special summon restrictions reject the procedure before paying costs", async (t) => {
  const { game, card, materials } = setup();
  t.after(() => game.dispose());
  card.cannotBeSpecialSummoned = true;
  assert.equal(game.canSummonFromHandByProcedure(card, game.player).ok, false);
  assert.equal((await game.performHandSummonProcedure(card, game.player, { materials, position: "attack" })).success, false);
  assert.equal(game.player.banished.length, 0);
});

test("a normally summoned copy has no procedure destruction protection", async (t) => {
  const { game, card } = setup();
  t.after(() => game.dispose());
  await game.moveCard(card, game.player, "field", { fromZone: "hand", summonOrigin: "procedure", summonMethodOverride: "normal" });
  assert.ok(game.player.field.includes(card));
  const source = new Card({ name: "Opponent effect", cardKind: "spell" }, game.bot.id);
  const destroyed = await game.destroyCard(card, { cause: "effect", sourceCard: source, sourcePlayer: game.bot });
  assert.ok("destroyed" in destroyed && destroyed.destroyed === true);
});
