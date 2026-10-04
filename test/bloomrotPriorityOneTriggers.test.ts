import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, completeTestSelections } from "./helpers/game.js";

function setup(t: TestContext, seat: "player" | "bot") {
  const game = createRuntimeGame({ laboratoryMode: true, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.turn = seat; game.turnCounter = 3; game.phase = "main1";
  game.player.controllerType = game.bot.controllerType = "ai";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  const actor = game[seat], destination = seat === "player" ? game.bot : game.player;
  return { game, actor, destination };
}

for (const seat of ["player", "bot"] as const) {
  for (const costKind of ["normal", "source", "token", "redirected"] as const) {
    test(`Myco-Weaver requires actual Graveyard cost arrival (${seat}, ${costKind})`, async t => {
      const { game, actor, destination } = setup(t, seat);
      const source = new Card(cardDefinition(403), actor.id);
      const cost = costKind === "source" ? source : new Card({ ...cardDefinition(402), effects: [] }, actor.id);
      cost.isToken = costKind === "token";
      const target = new Card({ ...cardDefinition(1), effects: [] }, destination.id);
      placeFieldCards(actor.field, source); if (cost !== source) placeFieldCards(actor.field, cost);
      placeFieldCards(destination.field, target);
      if (costKind === "redirected") placeFieldCards(destination.field, new Card(cardDefinition(273), destination.id));
      const selections = { bloomrot_myco_weaver_cost: [cost], bloomrot_myco_weaver_spore_target: [target] };
      const result = await game.tryActivateMonsterEffect(source, selections, "field", actor);
      const expected = costKind === "normal" || costKind === "source";
      assert.equal(result.success, expected, result.reason || String(result.code));
      assert.equal(actor.graveyard.includes(cost), expected);
      assert.equal(actor.field.includes(cost), !expected);
      assert.equal(target.getCounter("spore"), expected ? 3 : 0);
    });
  }
  for (const id of [406, 420] as const) {
    for (const banished of [false, true]) {
      test(`${id} destruction benefit stays with historical controller (${seat}, banished=${banished})`, async t => {
        const { game, actor, destination } = setup(t, seat);
        const source = new Card(cardDefinition(id), destination.id);
        source.owner = source.controller = actor.id; source.banishWhenLeavesField = banished;
        const spores = new Card({ ...cardDefinition(1), effects: [] }, destination.id); spores.addCounter("spore", 4);
        const candidate = new Card({ ...cardDefinition(402), effects: [] }, actor.id);
        const wrong = new Card({ ...cardDefinition(402), effects: [] }, destination.id);
        placeFieldCards(actor.field, source); placeFieldCards(destination.field, spores);
        if (id === 406) { actor.hand.push(candidate); destination.hand.push(wrong); }
        else { actor.graveyard.push(candidate); destination.graveyard.push(wrong); }
        await game.destroyCard(source, { cause: id === 406 ? "battle" : "effect" });
        assert.ok(actor.field.includes(candidate));
        assert.equal(destination.field.includes(wrong), false);
        assert.ok((banished ? destination.banished : destination.graveyard).includes(source));
      });
    }
  }
  test(`Queen departure marks historical opponent and consumes historical OPT (${seat})`, async t => {
    const { game, actor, destination } = setup(t, seat);
    const source = new Card(cardDefinition(419), destination.id); source.owner = source.controller = actor.id;
    const mine = new Card({ ...cardDefinition(1), effects: [] }, actor.id);
    const theirs = new Card({ ...cardDefinition(1), effects: [] }, destination.id);
    placeFieldCards(actor.field, source, mine); placeFieldCards(destination.field, theirs);
    await game.moveCard(source, actor, "banished", { fromZone: "field", awaitEvents: true, awaitCardMovedEvent: true });
    assert.equal(mine.getCounter("spore"), 0); assert.equal(theirs.getCounter("spore"), 1);
    const effect = required(source.effects.find(entry => entry.event === "card_moved"));
    assert.equal(game.canUseOncePerTurn(source, actor, effect).ok, false);
    assert.equal(game.canUseOncePerTurn(source, destination, effect).ok, true);
  });
  for (const destinationKind of ["graveyard", "banished", "token"] as const) {
    test(`infected destruction is observed at ${destinationKind} (${seat})`, async t => {
      const { game, actor, destination } = setup(t, seat);
      const widow = new Card(cardDefinition(407), actor.id);
      const husk = new Card(cardDefinition(408), actor.id);
      const infected = new Card({ ...cardDefinition(1), effects: [] }, destination.id);
      infected.isToken = destinationKind === "token";
      const target = new Card({ ...cardDefinition(1), effects: [] }, destination.id);
      if (destinationKind === "banished") infected.banishWhenLeavesField = true;
      infected.addCounter("spore", 1);
      placeFieldCards(actor.field, widow, husk); placeFieldCards(destination.field, infected, target);
      let movement: object | null = null;
      game.on("card_moved", payload => { if (payload.card === infected) movement = payload; });
      await game.destroyCard(infected, { cause: "effect", sourceCard: widow, sourcePlayer: actor });
      assert.equal(target.getCounter("spore"), 2);
      assert.ok(movement);
      assert.equal(Reflect.get(movement, "fromPlayer"), destination);
      assert.equal(Reflect.get(movement, "toPlayer"), destinationKind === "token" ? null : destination);
      assert.equal(Reflect.get(movement, "wasDestroyed"), true);
      assert.equal(Reflect.get(movement, "toZone"), destinationKind === "token" ? "removed" : destinationKind);
    });
  }
  for (const previouslyOpponent of [true, false]) {
    test(`Widow uses destroyed controller, not original owner (${seat}, opponent=${previouslyOpponent})`, async t => {
      const { game, actor, destination } = setup(t, seat);
      const widow = new Card(cardDefinition(407), actor.id);
      const target = new Card({ ...cardDefinition(1), effects: [] }, destination.id);
      placeFieldCards(actor.field, widow); placeFieldCards(destination.field, target);
      const oldController = previouslyOpponent ? destination : actor;
      const originalOwner = previouslyOpponent ? actor : destination;
      const infected = new Card({ ...cardDefinition(1), effects: [] }, originalOwner.id);
      infected.owner = infected.controller = oldController.id; infected.addCounter("spore", 1);
      placeFieldCards(oldController.field, infected);
      await game.destroyCard(infected, { cause: "effect", sourceCard: widow, sourcePlayer: actor });
      assert.ok(originalOwner.graveyard.includes(infected));
      assert.equal(target.getCounter("spore"), previouslyOpponent ? 1 : 0);
    });
  }
  for (const operation of ["hand", "banished", "tribute"] as const) {
    test(`non-destructive ${operation} does not trigger Widow or Husk (${seat})`, async t => {
      const { game, actor, destination } = setup(t, seat);
      const widow = new Card(cardDefinition(407), actor.id), husk = new Card(cardDefinition(408), actor.id);
      const infected = new Card({ ...cardDefinition(1), effects: [] }, destination.id);
      const target = new Card({ ...cardDefinition(1), effects: [] }, destination.id);
      infected.addCounter("spore", 1);
      placeFieldCards(actor.field, widow, husk); placeFieldCards(destination.field, infected, target);
      await game.moveCard(infected, destination, operation === "tribute" ? "graveyard" : operation, {
        fromZone: "field", movedByEffect: operation !== "tribute", contextLabel: operation,
        awaitEvents: true, awaitCardMovedEvent: true });
      assert.equal(target.getCounter("spore"), 0);
    });
  }
  test(`human historical controller owns Sporeling choices (${seat})`, async t => {
    const { game, actor, destination } = setup(t, seat);
    actor.controllerType = "human";
    game.ui.showConfirmPrompt = async () => true;
    game.autoSelector.select = () => assert.fail("Human historical controller must choose through the broker");
    const source = new Card(cardDefinition(401), destination.id);
    source.owner = source.controller = actor.id;
    placeFieldCards(actor.field, source);
    const candidate = new Card({ ...cardDefinition(410), effects: [] }, actor.id);
    actor.deck.push(candidate);
    const decisionActors: Array<string | null> = [];
    game.on("decision_made", decision => { decisionActors.push(decision.actorId); });
    await completeTestSelections(game, Promise.resolve(game.moveCard(source, actor, "graveyard", { fromZone: "field",
      awaitEvents: true, awaitCardMovedEvent: true })));
    assert.ok(actor.hand.includes(candidate));
    assert.ok(decisionActors.length > 0);
    assert.ok(decisionActors.every(id => id === actor.id));
  });
}

test("a movement trigger without the ownership opt-in retains destination semantics", async t => {
  const { game, actor, destination } = setup(t, "player");
  const definition = cardDefinition(356);
  const effect = required(definition.effects?.find(entry => entry.event === "card_moved"));
  assert.equal(effect.movementTriggerOwnership, undefined);
  const source = new Card({ ...definition, effects: [effect] }, destination.id);
  destination.hand.push(source);
  const pack = await game.effectEngine.collectCardMovedTriggers({ card: source, fromZone: "field", toZone: "hand",
    player: destination, fromPlayer: actor, toPlayer: destination, movedByEffect: true, wasFaceupBeforeMove: true });
  assert.equal(required(pack.entries[0]).owner, destination);
});

test("historical ownership fails closed when field-exit provenance is absent", async t => {
  const { game, actor, destination } = setup(t, "player");
  const source = new Card(cardDefinition(401), destination.id);
  destination.graveyard.push(source);
  actor.deck.push(new Card({ ...cardDefinition(410), effects: [] }, actor.id));
  destination.deck.push(new Card({ ...cardDefinition(410), effects: [] }, destination.id));
  const pack = await game.effectEngine.collectCardMovedTriggers({ card: source, fromZone: "field", toZone: "graveyard",
    player: destination, fromPlayer: null, toPlayer: destination, wasFaceupBeforeMove: true });
  assert.equal(pack.entries.length, 0);
});

test("card_to_grave producer carries controller provenance for generic opt-in triggers", async t => {
  const { game, actor, destination } = setup(t, "player");
  const definition = cardDefinition(401);
  const leaveEffect = required(definition.effects?.find(entry => entry.event === "card_moved"));
  const source = new Card({ ...definition, effects: [{ ...leaveEffect, id: "generic_historical_grave",
    oncePerTurnName: "generic_historical_grave", event: "card_to_grave" }] }, destination.id);
  source.owner = source.controller = actor.id; placeFieldCards(actor.field, source);
  const candidate = new Card({ ...cardDefinition(410), effects: [] }, actor.id); actor.deck.push(candidate);
  const movements: Array<{ from: unknown; to: unknown; player: unknown }> = [];
  game.on("card_to_grave", event => { if (event.card === source) movements.push({ from: event.fromPlayer,
    to: event.toPlayer, player: event.player }); });
  await game.moveCard(source, actor, "graveyard", { fromZone: "field", awaitEvents: true, awaitCardMovedEvent: true });
  assert.equal(movements.length, 1);
  assert.equal(movements[0]?.from, actor); assert.equal(movements[0]?.to, destination);
  assert.equal(movements[0]?.player, destination);
  assert.ok(actor.hand.includes(candidate)); assert.ok(destination.graveyard.includes(source));
});

test("SEGOC rejects a historical-controller trigger after its physical source leaves and returns", async t => {
  const { game, actor, destination } = setup(t, "player");
  const source = new Card(cardDefinition(401), destination.id); destination.graveyard.push(source);
  actor.deck.push(new Card({ ...cardDefinition(410), effects: [] }, actor.id));
  const payload = { card: source, fromZone: "field" as const, toZone: "graveyard" as const,
    player: destination, fromPlayer: actor, toPlayer: destination, wasFaceupBeforeMove: true };
  const occurrence = required(game.chainSystem.createTriggerOccurrence("card_moved", payload));
  assert.ok("sequence" in occurrence, "the fixture uses the real ChainSystem occurrence");
  const opportunity = required(game.chainSystem.buildTriggerOpportunity([occurrence]));
  const candidate = required((await game.chainSystem.collectTriggerCandidates(opportunity))[0]);
  assert.equal(game.chainSystem.revalidateTriggerCandidate(candidate, opportunity).ok, true);
  await game.moveCard(source, destination, "banished", { fromZone: "graveyard", awaitEvents: true });
  await game.moveCard(source, destination, "graveyard", { fromZone: "banished", awaitEvents: true });
  assert.deepEqual(game.chainSystem.revalidateTriggerCandidate(candidate, opportunity),
    { ok: false, reason: "source_location_changed" });
});

for (const seat of ["player", "bot"] as const) {
  test(`field-exit self trigger belongs to previous controller with a physical destination snapshot (${seat})`, async t => {
    const { game, actor, destination } = setup(t, seat);
    const definition = cardDefinition(401);
    const effect = { ...required(definition.effects?.find(entry => entry.event === "card_moved")) };
    Reflect.set(effect, "movementTriggerOwnership", "field_exit_controller");
    const source = new Card({ ...definition, effects: [effect] }, destination.id);
    source.owner = source.controller = destination.id;
    destination.graveyard.push(source);
    const candidate = new Card({ ...cardDefinition(410), effects: [] }, actor.id);
    actor.deck.push(candidate);
    const pack = await game.effectEngine.collectCardMovedTriggers({ card: source,
      fromZone: "field", toZone: "graveyard", player: destination, fromPlayer: actor,
      toPlayer: destination, wasFaceupBeforeMove: true });
    const entry = required(pack.entries[0]);
    assert.equal(entry.owner, actor);
    assert.equal(entry.config?.owner, actor);
    const snapshot = required(entry.config?.activationContext?.sourceAtTrigger);
    assert.equal(Reflect.get(snapshot, "controllerId"), destination.id);
    assert.equal(Reflect.get(snapshot, "zone"), "graveyard");
  });

  test(`Sporeling departure benefits previous controller through real movement and SEGOC (${seat})`, async t => {
    const { game, actor, destination } = setup(t, seat);
    const source = new Card(cardDefinition(401), destination.id);
    source.owner = source.controller = actor.id;
    placeFieldCards(actor.field, source);
    const candidate = new Card({ ...cardDefinition(410), effects: [] }, actor.id);
    const wrong = new Card({ ...cardDefinition(410), effects: [] }, destination.id);
    actor.deck.push(candidate); destination.deck.push(wrong);
    await game.moveCard(source, actor, "graveyard", { fromZone: "field", awaitEvents: true,
      awaitCardMovedEvent: true });
    assert.ok(destination.graveyard.includes(source));
    assert.ok(actor.hand.includes(candidate));
    assert.ok(destination.deck.includes(wrong));
  });
}
