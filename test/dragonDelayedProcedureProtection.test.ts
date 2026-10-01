import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

function setup(t: TestContext, seat: "player" | "bot" = "player") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.turn = seat;
  game.phase = "main1";
  game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = game.bot.controllerType = "ai";
  game.autoSelector.orderTriggerCandidates = candidates => [...candidates];
  const owner = game[seat];
  const opponent = game[seat === "player" ? "bot" : "player"];
  const make = (id: number, player = owner) => {
    const card = new Card(cardDefinition(id), player.id);
    card.isFacedown = false;
    card.position = "attack";
    return card;
  };
  const standby = async () => {
    game.turn = opponent.id;
    game.turnCounter = 5;
    game.phase = "standby";
    await game.processDelayedActions("standby", opponent.id);
  };
  return { game, owner, opponent, make, standby };
}

for (const seat of ["player", "bot"] as const) {
  test(`Abyssal returns both original graveyard presences for ${seat}`, async t => {
    const { game, owner, opponent, make, standby } = setup(t, seat);
    const source = make(263), target = make(257, opponent);
    placeFieldCards(owner.field, source);
    placeFieldCards(opponent.field, target);
    assert.equal((await game.tryActivateMonsterEffect(source, { abyssal_target: [target] }, "field", owner,
      { effectId: "abyssal_serpent_delayed_summon_effect" })).success, true);
    await standby();
    assert.ok(owner.field.includes(source));
    assert.ok(opponent.field.includes(target));
    assert.equal(game.delayedActions.length, 0);
  });
}

test("Abyssal uses the actual graveyard owner of a controlled opponent card", async t => {
  const { game, owner, opponent, make, standby } = setup(t);
  const source = make(263, opponent), target = make(257, opponent);
  source.owner = owner.id;
  source.controller = owner.id;
  placeFieldCards(owner.field, source);
  placeFieldCards(opponent.field, target);
  assert.equal((await game.tryActivateMonsterEffect(source, { abyssal_target: [target] }, "field", owner,
    { effectId: "abyssal_serpent_delayed_summon_effect" })).success, true);
  assert.ok(opponent.graveyard.includes(source));
  await standby();
  assert.ok(opponent.field.includes(source));
  assert.ok(opponent.field.includes(target));
  assert.equal(owner.field.length, 0);
});

test("Abyssal does not return a card that left and reentered the graveyard", async t => {
  const { game, owner, opponent, make, standby } = setup(t);
  const source = make(263), target = make(257, opponent);
  placeFieldCards(owner.field, source);
  placeFieldCards(opponent.field, target);
  await game.tryActivateMonsterEffect(source, { abyssal_target: [target] }, "field", owner,
    { effectId: "abyssal_serpent_delayed_summon_effect" });
  await game.moveCard(source, owner, "banished", { fromZone: "graveyard" });
  await game.moveCard(source, owner, "graveyard", { fromZone: "banished" });
  await standby();
  assert.ok(owner.graveyard.includes(source));
  assert.ok(opponent.field.includes(target));
});

test("Abyssal revalidates its graveyard presence after the position decision", async t => {
  const { game, owner, opponent, make, standby } = setup(t);
  const source = make(263), target = make(257, opponent);
  placeFieldCards(owner.field, source);
  placeFieldCards(opponent.field, target);
  await game.tryActivateMonsterEffect(source, { abyssal_target: [target] }, "field", owner,
    { effectId: "abyssal_serpent_delayed_summon_effect" });
  const choosePosition = game.chooseSpecialSummonPosition.bind(game);
  game.chooseSpecialSummonPosition = async (player, card, options) => {
    if (card === source) {
      await game.moveCard(card, owner, "banished", { fromZone: "graveyard" });
      await game.moveCard(card, owner, "graveyard", { fromZone: "banished" });
    }
    return choosePosition(player, card, options);
  };
  await standby();
  assert.ok(owner.graveyard.includes(source));
  assert.ok(opponent.field.includes(target));
});

test("Abyssal never schedules a departure redirected away from the graveyard", async t => {
  const { game, owner, opponent, make, standby } = setup(t);
  const source = make(263), target = make(257, opponent);
  source.banishWhenLeavesField = true;
  placeFieldCards(owner.field, source);
  placeFieldCards(opponent.field, target);
  await game.tryActivateMonsterEffect(source, { abyssal_target: [target] }, "field", owner,
    { effectId: "abyssal_serpent_delayed_summon_effect" });
  assert.ok(owner.banished.includes(source));
  await game.moveCard(source, owner, "graveyard", { fromZone: "banished" });
  await standby();
  assert.ok(owner.graveyard.includes(source));
  assert.ok(opponent.field.includes(target));
});

test("Abyssal consumes the scheduled return once when only one field has space", async t => {
  const { game, owner, opponent, make, standby } = setup(t);
  const source = make(263), target = make(257, opponent);
  placeFieldCards(owner.field, source);
  placeFieldCards(opponent.field, target);
  await game.tryActivateMonsterEffect(source, { abyssal_target: [target] }, "field", owner,
    { effectId: "abyssal_serpent_delayed_summon_effect" });
  placeFieldCards(owner.field, ...Array.from({ length: 5 }, () => make(255)));
  await standby();
  assert.ok(owner.graveyard.includes(source));
  assert.ok(opponent.field.includes(target));
  assert.equal(game.delayedActions.length, 0);
  await game.moveCard(required(owner.field[0]), owner, "graveyard", { fromZone: "field" });
  await game.processDelayedActions("standby", opponent.id);
  assert.ok(owner.graveyard.includes(source));
});

function purified(t: TestContext) {
  const fixture = setup(t);
  const first = fixture.make(264), second = fixture.make(264);
  const costs = Array.from({ length: 6 }, () => fixture.make(255));
  fixture.owner.hand.push(first, second);
  fixture.owner.graveyard.push(...costs);
  return { ...fixture, first, second, costs };
}

test("Purified summons by procedure with sequential costs and no material effect activation", async t => {
  const { game, owner, first, second, costs } = purified(t);
  const movements: Card["name"][] = [];
  let activations = 0, targeted = 0;
  game.on("card_moved", event => { movements.push(event.card.name || ""); });
  game.on("effect_activated", event => { if (event.card === first) activations++; });
  game.on("effect_targeted", event => { if (event.card === first) targeted++; });
  const result = await game.performHandSummonProcedure(first, owner, { materials: costs.slice(0, 3), position: "attack" });
  assert.equal(result.success, true);
  assert.deepEqual(movements, [...costs.slice(0, 3).map(card => card.name), first.name]);
  assert.equal(activations, 0);
  assert.equal(targeted, 0);
  assert.equal(game.materialDuelStats.player.effectActivationsByMaterialId.get(264) || 0, 0);
  assert.equal(game.lastSummonTransaction?.summonOrigin, "procedure");
  assert.equal(game.canSummonFromHandByProcedure(second, owner).ok, false);
  game.turnCounter++;
  assert.equal(game.canSummonFromHandByProcedure(second, owner).ok, true);
});

test("Purified commits its name limit before costs and keeps it after summon negation", async t => {
  const { game, owner, first, second, costs } = purified(t);
  let availableAfterFirstCost: boolean | undefined;
  game.on("card_moved", event => {
    if (event.card === costs[0]) availableAfterFirstCost = game.canUseOncePerTurn(second, owner, required(second.handSummonProcedure)).ok;
  });
  game.offerSummonAttempt = async (_card, _player, options) => {
    assert.equal(owner.banished.length, 3);
    const transaction = required(required(options).summonTransaction);
    game.markSummonNegated(transaction.summonId, { destination: "graveyard", destroyed: false });
    return { ok: false, summonNegated: true, transaction };
  };
  const result = await game.performHandSummonProcedure(first, owner, { materials: costs.slice(0, 3), position: "attack" });
  assert.equal(result.summonNegated, true);
  assert.equal(availableAfterFirstCost, false);
  assert.ok(owner.graveyard.includes(first));
  assert.equal(game.canSummonFromHandByProcedure(second, owner).ok, false);
  assert.equal(game.materialDuelStats.player.effectActivationsByMaterialId.get(264) || 0, 0);
});

test("Purified human cancellation and invalid costs leave the procedure available", async t => {
  const { game, owner, first, second, costs } = purified(t);
  owner.controllerType = "human";
  const pending = await game.performHandSummonProcedure(first, owner, { position: "attack" });
  assert.equal(pending.needsSelection, true);
  game.cancelTargetSelection();
  assert.equal(game.canSummonFromHandByProcedure(second, owner).ok, true);
  assert.equal((await game.performHandSummonProcedure(first, owner, { materials: costs.slice(0, 2), position: "attack" })).success, false);
  assert.equal(game.canSummonFromHandByProcedure(first, owner).ok, true);
  assert.equal(owner.banished.length, 0);
});

test("Purified procedure limits are independent of the other player and its field effect", async t => {
  const { game, owner, opponent, make, first, costs } = purified(t);
  const target = make(257), foreign = make(264, opponent);
  placeFieldCards(owner.field, target);
  opponent.hand.push(foreign);
  opponent.graveyard.push(...Array.from({ length: 3 }, () => make(255, opponent)));
  await game.performHandSummonProcedure(first, owner, { materials: costs.slice(0, 3), position: "attack" });
  assert.equal((await game.tryActivateMonsterEffect(first, { purified_protection_target: [target] }, "field", owner,
    { effectId: "purified_crystal_protection" })).success, true);
  assert.equal(game.materialDuelStats.player.effectActivationsByMaterialId.get(264), 1);
  game.turn = opponent.id;
  assert.equal(game.canSummonFromHandByProcedure(foreign, opponent).ok, true);
  assert.equal((await game.performHandSummonProcedure(foreign, opponent,
    { materials: [...opponent.graveyard], position: "attack" })).success, true);
});

for (const destination of ["hand", "graveyard", "banished"] as const) {
  test(`Rainbow protection ends on departure to ${destination} and does not return`, async t => {
    const { game, owner, opponent, make } = setup(t);
    const source = make(267), target = make(257), enemy = make(257, opponent);
    placeFieldCards(owner.field, source, target);
    placeFieldCards(opponent.field, enemy);
    assert.equal((await game.tryActivateMonsterEffect(source, { rainbow_cosmic_protection_target: [target] }, "field", owner,
      { effectId: "rainbow_cosmic_dragon_protect_dragon" })).success, true);
    const protectedResult = await game.destroyCard(target, { cause: "effect", sourceCard: enemy, sourcePlayer: opponent });
    assert.ok("destroyed" in protectedResult && protectedResult.destroyed === false);
    await game.moveCard(target, owner, destination, { fromZone: "field" });
    await game.moveCard(target, owner, "field", { fromZone: destination, summonOrigin: "effect_resolution", summonMethodOverride: "special" });
    const departedResult = await game.destroyCard(target, { cause: "effect", sourceCard: enemy, sourcePlayer: opponent });
    assert.ok("destroyed" in departedResult && departedResult.destroyed === true);
  });
}

test("Rainbow protection survives source departure and expires after the next turn", async t => {
  const { game, owner, opponent, make } = setup(t);
  const source = make(267), target = make(257), enemy = make(257, opponent);
  placeFieldCards(owner.field, source, target);
  placeFieldCards(opponent.field, enemy);
  await game.tryActivateMonsterEffect(source, { rainbow_cosmic_protection_target: [target] }, "field", owner,
    { effectId: "rainbow_cosmic_dragon_protect_dragon" });
  await game.moveCard(source, owner, "hand", { fromZone: "field" });
  for (const turn of [4, 5]) {
    game.turnCounter = turn;
    const effectResult = await game.destroyCard(target, { cause: "effect", sourceCard: enemy, sourcePlayer: opponent });
    const battleResult = await game.destroyCard(target, { cause: "battle", sourceCard: enemy, sourcePlayer: opponent });
    assert.ok("destroyed" in effectResult && effectResult.destroyed === false);
    assert.ok("destroyed" in battleResult && battleResult.destroyed === false);
  }
  game.turnCounter = 6;
  const expiredResult = await game.destroyCard(target, { cause: "effect", sourceCard: enemy, sourcePlayer: opponent });
  assert.ok("destroyed" in expiredResult && expiredResult.destroyed === true);
});

test("Rainbow protection stays with a target whose controller changes without leaving field", async t => {
  const { game, owner, opponent, make } = setup(t);
  const source = make(267), target = make(257);
  placeFieldCards(owner.field, source, target);
  await game.tryActivateMonsterEffect(source, { rainbow_cosmic_protection_target: [target] }, "field", owner,
    { effectId: "rainbow_cosmic_dragon_protect_dragon" });
  await game.moveCard(target, opponent, "field", { fromZone: "field" });
  const result = await game.destroyCard(target, { cause: "effect", sourceCard: source, sourcePlayer: owner });
  assert.ok("destroyed" in result && result.destroyed === false);
  assert.ok(opponent.field.includes(target));
});
