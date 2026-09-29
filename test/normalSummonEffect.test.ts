import assert from "node:assert/strict";
import test from "node:test";
import Card from "../src/core/Card.js";
import { handleNormalSummonFromHand } from "../src/core/actionHandlers/summon/normalFromHand.js";
import { getNormalSummonTributeOptions } from "../src/core/game/summon/tributeValue.js";
import { cardDatabaseByName, required, unsafeFixture } from "./helpers/fixtures.js";
import type { ActionHandlerEnginePort } from "../src/core/contracts/actionRuntime.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { simulationState, simulationCard } from "./helpers/simulation.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";

function setup(name = "Shadow-Heart Imp") {
  const game = createRuntimeGame({ disableChains: true });
  game.turn = "bot";
  game.phase = "main1";
  game.player.controllerType = "ai";
  game.player.hand = [];
  game.player.field = [];
  game.player.graveyard = [];
  const card = new Card(required(cardDatabaseByName.get(name)), "player");
  game.player.hand.push(card);
  const source = new Card({ name: "Summon source", cardKind: "trap" }, "player");
  return { game, card, source };
}

test("normal summon effect consumes the off-turn allowance and preserves summon origin", async (t) => {
  const { game, card, source } = setup();
  t.after(() => game.dispose());
  const run = () => handleNormalSummonFromHand(
    { type: "normal_summon_from_hand", filters: { archetype: "Shadow-Heart" } },
    { player: game.player, opponent: game.bot, source }, {}, unsafeFixture<ActionHandlerEnginePort>(game.effectEngine, "Real engine with concrete player strategy projection."),
  );
  assert.equal(await run(), true);
  assert.ok(game.player.field.includes(card));
  assert.equal(game.player.summonCount, 1);
  assert.equal(card.lastSummonMethod, "normal");
  assert.equal(game.lastSummonTransaction?.summonOrigin, "effect_resolution");
  game.player.hand.push(new Card(required(cardDatabaseByName.get("Shadow-Heart Imp")), "player"));
  assert.equal(await run(), false);
  assert.equal(game.player.summonCount, 1);
});

test("normal summon eligibility accounts for two-value Tributes and a full field", async (t) => {
  const { game, card, source } = setup("Shadow-Heart Demon Arctroth");
  t.after(() => game.dispose());
  const material = new Card(required(cardDatabaseByName.get("Shadow-Heart Heartbearer")), "player");
  placeFieldCards(game.player.field, material, ...Array.from({ length: 4 }, (_, i) =>
    new Card({ name: `Material ${i}`, cardKind: "monster", level: 1 }, "player")));
  assert.ok(getNormalSummonTributeOptions(game.player, card).some(option => option.length === 1 && option[0] === material));
  assert.equal(await handleNormalSummonFromHand(
    { type: "normal_summon_from_hand" },
    { player: game.player, opponent: game.bot, source }, {}, unsafeFixture<ActionHandlerEnginePort>(game.effectEngine, "Real engine with concrete player strategy projection."),
  ), true);
  assert.equal(game.player.field.length <= 5, true);
  assert.equal(card.lastSummonMethod, "tribute");
  assert.equal(game.player.summonCount, 1);
});

test("normal summon eligibility rejects missing Tributes and forbidden monsters", (t) => {
  const { game, card } = setup("Shadow-Heart Demon Arctroth");
  t.after(() => game.dispose());
  assert.deepEqual(getNormalSummonTributeOptions(game.player, card), []);
  card.cannotBeNormalSummonedOrSet = true;
  placeFieldCards(game.player.field, ...Array.from({ length: 2 }, (_, i) =>
    new Card({ name: `Material ${i}`, cardKind: "monster" }, "player")));
  assert.deepEqual(getNormalSummonTributeOptions(game.player, card), []);
});

test("Shadow-Heart Grave is registered with independent use limits and a banish cost", () => {
  const card = required(cardDatabaseByName.get("Shadow-Heart Grave"));
  assert.equal(card.id, 126);
  assert.equal(card.cardKind, "trap");
  const summon = required(card.effects?.[0]);
  const recover = required(card.effects?.[1]);
  assert.equal(summon.actions?.[0]?.type, "normal_summon_from_hand");
  assert.equal(recover.speed, 1);
  assert.ok(recover.activationCosts?.length);
  assert.notEqual(summon.oncePerTurnName, recover.oncePerTurnName);
  assert.equal(summon.usagePolicy, "use");
  assert.equal(recover.usagePolicy, "use");
});

test("normal summon eligibility preserves alternate costs, field limits and archetype filters", async (t) => {
  const { game, card, source } = setup("Shadow-Heart Demon Arctroth");
  t.after(() => game.dispose());
  card.altTribute = { type: "no_tribute_if_empty_field" };
  assert.deepEqual(getNormalSummonTributeOptions(game.player, card), [[]]);
  const material = new Card({ name: "Alternate material", cardKind: "monster", type: "Fiend" }, "player");
  placeFieldCards(game.player.field, material);
  card.altTribute = { requiresName: material.name, tributes: 1 };
  assert.deepEqual(getNormalSummonTributeOptions(game.player, card), [[material]]);
  assert.deepEqual(getNormalSummonTributeOptions(game.player, card, () => false), []);
  assert.equal(await handleNormalSummonFromHand(
    { type: "normal_summon_from_hand", filters: { archetype: "Luminarch" } },
    { player: game.player, opponent: game.bot, source }, {},
    unsafeFixture<ActionHandlerEnginePort>(game.effectEngine, "Concrete engine for filtered normal-summon legality."),
  ), false);
  card.requiredTributes = 0;
  placeFieldCards(game.player.field, ...Array.from({ length: 4 }, (_, i) => new Card({ name: `Occupied ${i}`, cardKind: "monster" }, "player")));
  assert.deepEqual(getNormalSummonTributeOptions(game.player, card), [], "no space without a Tribute cost");
});

test("normal summon revalidates a human choice before paying any Tribute", async (t) => {
  const { game, card, source } = setup("Shadow-Heart Demon Arctroth");
  t.after(() => game.dispose());
  game.player.controllerType = "human";
  const material = new Card(required(cardDatabaseByName.get("Shadow-Heart Heartbearer")), "player");
  placeFieldCards(game.player.field, material);
  const pending = handleNormalSummonFromHand({ type: "normal_summon_from_hand" },
    { player: game.player, opponent: game.bot, source }, {},
    unsafeFixture<ActionHandlerEnginePort>(game.effectEngine, "Concrete engine for selection revalidation."));
  const session = required(game.targetSelection);
  const requirement = required(session.requirements[0]);
  session.selections[requirement.id] = [required(requirement.candidates[0]).key];
  game.player.summonCount = 1;
  await game.finishTargetSelection();
  assert.equal(await pending, false);
  assert.ok(game.player.field.includes(material));
  assert.ok(game.player.hand.includes(card));
  assert.equal(game.player.graveyard.length, 0);
});

test("Grave recovery activates from the Graveyard, pays banishment and returns two level-eight monsters", async (t) => {
  const { game } = setup();
  t.after(() => game.dispose());
  game.turn = "player";
  const source = new Card(required(cardDatabaseByName.get("Shadow-Heart Grave")), "player");
  const first = new Card(required(cardDatabaseByName.get("Shadow-Heart Demon Arctroth")), "player");
  const second = new Card(required(cardDatabaseByName.get("Shadow-Heart Demon Arctroth")), "player");
  game.player.graveyard.push(source, first, second);
  assert.equal(game.effectEngine.canActivateSpellTrapEffectPreview(source, game.player, "graveyard").ok, true);
  const result = await game.tryActivateSpellTrapEffect(source, null, { owner: game.player, activationZone: "graveyard" });
  assert.equal(result.success, true);
  assert.ok(game.player.banished.includes(source));
  assert.ok(game.player.hand.includes(first));
  assert.ok(game.player.hand.includes(second));
  const copy = new Card(required(cardDatabaseByName.get("Shadow-Heart Grave")), "player");
  game.player.graveyard.push(copy, new Card(required(cardDatabaseByName.get("Shadow-Heart Demon Arctroth")), "player"));
  assert.equal(game.effectEngine.canActivateSpellTrapEffectPreview(copy, game.player, "graveyard").ok, false);
});

test("simulation pays a legal double Tribute and consumes the normal allowance once", () => {
  const card = simulationCard({ ...required(cardDatabaseByName.get("Shadow-Heart Demon Arctroth")) });
  const material = simulationCard({ ...required(cardDatabaseByName.get("Shadow-Heart Heartbearer")), atk: 0 });
  const state = simulationState({ bot: { id: "bot", hand: [card], field: [material] }, player: { id: "player" } });
  const events: string[] = [];
  applySimulatedActions({ actions: [{ type: "normal_summon_from_hand", filters: { archetype: "Shadow-Heart" } }],
    state, selfId: "bot", selections: {}, options: { emitSimulatedEvent: event => { events.push(event); } } });
  assert.equal(state.bot.field[0]?.name, "Shadow-Heart Demon Arctroth");
  assert.equal(state.bot.graveyard[0]?.name, "Shadow-Heart Heartbearer");
  assert.equal(state.bot.summonCount, 1);
  assert.equal(state.bot.field[0]?.lastSummonMethod, "tribute");
  assert.ok(events.includes("after_summon"));
});

test("an off-turn human selection belongs to the summoning player", async (t) => {
  const { game, source } = setup();
  t.after(() => game.dispose());
  game.player.controllerType = "human";
  const pending = handleNormalSummonFromHand({ type: "normal_summon_from_hand" },
    { player: game.player, opponent: game.bot, source }, {},
    unsafeFixture<ActionHandlerEnginePort>(game.effectEngine, "Real engine with concrete player strategy projection."));
  const selection = required(game.targetSelection);
  assert.equal(selection.owner?.id || selection.player?.id, "player");
  const requirement = required(selection.requirements[0]);
  selection.selections[requirement.id] = [required(requirement.candidates[0]).key];
  await game.finishTargetSelection();
  assert.equal(await pending, true);
});
