import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { cardDefinition, required, chainSelections } from "./helpers/fixtures.js";

function setup(t: TestContext, seat: "player" | "bot" = "player") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = game.bot.controllerType = "ai";
  const owner = game[seat], opponent = seat === "player" ? game.bot : game.player;
  const make = (id: number) => new Card(cardDefinition(id), owner.id);
  return { game, owner, opponent, make };
}

for (const seat of ["player", "bot"] as const) {
  test(`Hymn affects the face-up resolution board without targeting (${seat})`, async t => {
    const { game, owner, make } = setup(t, seat);
    const source = make(105), initial = make(101), entered = make(102), hidden = make(103);
    owner.hand.push(source, entered); placeFieldCards(owner.field, initial, hidden); hidden.isFacedown = true;
    const enteredAtk = entered.atk, initialAtk = initial.atk;
    let targeted = 0;
    game.on("effect_targeted", () => { targeted++; });
    game.on("spell_activated", async event => {
      if (event.card !== source) return;
      initial.isFacedown = true;
      await game.moveCard(entered, owner, "field", { fromZone: "hand", position: "attack", isFacedown: false, summonOrigin: "effect_resolution", summonMethodOverride: "special", summonProcedure: "card_effect" });
    });
    const result = await game.tryActivateSpell(source, owner.hand.indexOf(source), null, { owner });
    assert.equal(result.success, true, result.reason || undefined);
    assert.equal(targeted, 0);
    assert.ok(owner.field.includes(entered), "response must summon newcomer");
    assert.equal(entered.atk, enteredAtk + 500);
    assert.equal(initial.atk, initialAtk);
  });

  for (const id of [107, 122] as const) {
    test(`${id} chooses the candidate remaining at resolution (${seat})`, async t => {
      const { game, owner, make } = setup(t, seat);
      const source = make(id), old = make(101), replacement = make(102);
      placeFieldCards(owner.field, source);
      const zone = id === 107 ? "hand" : "graveyard";
      owner[zone].push(old);
      const effect = required(source.effects.find(effect => effect.id === (id === 107 ? "shadow_heart_imp_on_summon" : "shadow_heart_warlord_revive")));
      const prepared = game.chainSystem.createPreparedActivation({ card: source, controller: owner, effect, activationZone: "field", committed: true });
      required(game.chainSystem.addToChain(prepared));
      await game.moveCard(old, owner, "banished", { fromZone: zone });
      owner[zone].push(replacement);
      let choices = 0;
      game.on("decision_made", event => { if (event.kind === "choice") choices++; });
      await game.chainSystem.resolveChain();
      assert.ok(owner.field.includes(replacement));
      assert.equal(choices, 1);
      assert.equal(id === 122 ? replacement.cannotAttackThisTurn : false, id === 122);
    });
  }

  test(`Infusion previews an empty GY and revives a freshly discarded monster (${seat})`, async t => {
    const { game, owner, make } = setup(t, seat);
    const source = make(110), recruit = make(102), discard = make(105);
    owner.hand.push(source, recruit, discard);
    let targeted = 0, discarded = 0;
    game.on("effect_targeted", () => { targeted++; });
    game.on("card_to_grave", event => { if (event.card === recruit || event.card === discard) discarded++; });
    const result = await game.tryActivateSpell(source, owner.hand.indexOf(source), null, { owner });
    assert.equal(result.success, true, result.reason || undefined);
    assert.ok(owner.field.includes(recruit));
    assert.equal(discarded, 2);
    assert.equal(targeted, 0);
  });
}

test("Demon Dragon has a declared frozen opponent target before responses", async t => {
  const { game, owner, opponent, make } = setup(t);
  const source = make(121), victim = new Card(cardDefinition(10), opponent.id);
  placeFieldCards(owner.field, source); placeFieldCards(opponent.spellTrap, victim); victim.isFacedown = true;
  const effect = required(source.effects[0]);
  const definition = required(effect.targets?.[0]);
  const prepared = game.chainSystem.createPreparedActivation({ card: source, controller: owner, effect, activationZone: "field", targetSelections: chainSelections({ [definition.id]: [victim] }), committed: true });
  const link = required(game.chainSystem.addToChain(prepared));
  assert.ok(link);
  assert.equal(link.declaredTargets[0]?.cards[0], victim);
  await game.moveCard(victim, opponent, "graveyard", { fromZone: "spellTrap" });
  await game.moveCard(victim, opponent, "spellTrap", { fromZone: "graveyard" });
  await game.chainSystem.resolveChain();
  assert.ok(opponent.spellTrap.includes(victim));
});

test("Warlord protection and revival each share their own hard OPT across copies", t => {
  const { game, owner, make } = setup(t);
  const first = make(122), second = make(122);
  placeFieldCards(owner.field, first, second);
  const protect = required(first.effects[0]), revive = required(first.effects[1]);
  game.markOncePerTurnUsed(first, owner, protect);
  assert.equal(game.chainSystem.checkActivationUsage(second, owner, protect).ok, false);
  assert.equal(game.chainSystem.checkActivationUsage(second, owner, revive).ok, true);
});

for (const movement of ["none", "leave", "return"] as const) {
  test(`Heartbearer binds the event copy without declaring a target (${movement})`, async t => {
    const { game, owner, make } = setup(t);
    const source = make(125), eventCard = make(102), other = make(102);
    placeFieldCards(owner.field, source, ...Array.from({ length: 4 }, () => make(101)));
    owner.graveyard.push(eventCard, other);
    const effect = required(source.effects.find(effect => effect.id === "shadow_heart_heartbearer_revive"));
    const prepared = game.chainSystem.createPreparedActivation({ card: source, controller: owner, effect,
      activationZone: "field", context: { eventCard }, committed: true,
      targetSelections: chainSelections({ shadow_heart_heartbearer_destroyed_monster: [eventCard] }) });
    assert.equal((await game.chainSystem.payActivationCosts(prepared)).success, true);
    const link = required(game.chainSystem.addToChain(prepared));
    assert.ok(link);
  assert.equal(link.declaredTargets.length, 0);
    assert.ok(owner.graveyard.includes(source));
    if (movement !== "none") await game.moveCard(eventCard, owner, "banished", { fromZone: "graveyard" });
    if (movement === "return") await game.moveCard(eventCard, owner, "graveyard", { fromZone: "banished" });
    await game.chainSystem.resolveChain();
    assert.equal(owner.field.includes(eventCard), movement === "none");
    assert.ok(owner.graveyard.includes(other));
  });
}

for (const id of [107, 110, 122, 125] as const) {
  for (const invalid of ["full", "restriction", "no candidate"] as const) {
    test(`${id} preview rejects ${invalid} without mutation`, t => {
      const { game, owner, opponent, make } = setup(t);
      const source = make(id), recruit = make(102);
      if (id === 110) owner.hand.push(source, make(105), make(105));
      else placeFieldCards(owner.field, source);
      if (invalid !== "no candidate") owner[id === 107 ? "hand" : "graveyard"].push(recruit);
      if (invalid === "full") {
        while (owner.field.length < 5) placeFieldCards(owner.field, make(101));
        if (id === 125) return; // Its activation cost opens a zone; covered above.
      }
      if (invalid === "restriction") game.registerSpecialSummonRestriction(owner, { allowedFilters: { type: "Machine" }, duration: "until_end_turn" });
      const effect = required(source.effects.find(effect => effect.actions?.some(action => action.type === "special_summon_from_zone")));
      const snapshot = [owner.hand.length, owner.field.length, owner.graveyard.length];
      const preview = game.effectEngine.checkActionPreviewRequirements(effect.actions || [], { source, player: owner, opponent, effect, eventCard: recruit });
      assert.equal(preview.ok, false);
      assert.deepEqual([owner.hand.length, owner.field.length, owner.graveyard.length], snapshot);
    });
  }
}

for (const count of [0, 1, 2]) {
  test(`Infusion resolves with ${count} cards remaining without a partial discard`, async t => {
    const { game, owner, make } = setup(t);
    const source = make(110), recruit = make(102);
    owner.graveyard.push(recruit);
    placeFieldCards(owner.spellTrap, source);
    owner.hand.push(...Array.from({ length: count }, () => make(105)));
    const effect = required(source.effects[0]);
    const link = game.chainSystem.addToChain(game.chainSystem.createPreparedActivation({ card: source, controller: owner, effect, activationZone: "spellTrap", committed: true }));
    assert.ok(link);
    await game.chainSystem.resolveChain();
    assert.equal(owner.hand.length, count < 2 ? count : 0);
    assert.equal(owner.field.includes(recruit), count === 2);
  });
}

test("Infusion excludes itself from the two discardable cards in preview", t => {
  const { game, owner, opponent, make } = setup(t);
  const source = make(110), recruit = make(102);
  owner.hand.push(source, recruit);
  const effect = required(source.effects[0]);
  assert.equal(game.effectEngine.checkActionPreviewRequirements(effect.actions || [], { source, player: owner, opponent, effect }).ok, false);
});

test("mandatory human summon keeps duplicate copies distinct and cannot cancel", async t => {
  const { game, owner, opponent, make } = setup(t);
  owner.controllerType = "human";
  const source = make(107), first = make(102), second = make(102);
  owner.hand.push(first, second); placeFieldCards(owner.field, source);
  game.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
  const effect = required(source.effects[0]);
  const action = game.effectEngine.applyActions(effect.actions || [], { source, player: owner, opponent, effect }, {});
  for (let attempt = 0; attempt < 100 && !game.targetSelection; attempt++) await new Promise<void>(resolve => setTimeout(resolve, 1));
  const session = required(game.targetSelection);
  assert.equal(owner.field.includes(first), false, "no UI fallback may choose the first copy");
  const requirement = required(session.requirements[0]);
  assert.equal(requirement.min, 1);
  assert.equal(requirement.candidates.length, 2);
  game.cancelTargetSelection();
  assert.equal(game.targetSelection, session, "Escape must not cancel a mandatory resolution choice");
  const selected = required(requirement.candidates.find(candidate => candidate.cardRef === second));
  session.selections[requirement.id] = [selected.key];
  await game.finishTargetSelection();
  await action;
  assert.ok(owner.hand.includes(first));
  assert.ok(owner.field.includes(second));
  assert.equal(second.position, "defense");
});

test("optional resolution cancellation records an empty choice", async t => {
  const { game, owner, opponent, make } = setup(t);
  owner.controllerType = "human";
  const source = make(111), recruit = make(102);
  owner.graveyard.push(recruit);
  let choices = 0;
  game.on("decision_made", event => { if (event.kind === "choice") choices++; });
  const action = game.effectEngine.applyActions([{ type: "special_summon_from_zone", zone: "graveyard", filters: { cardKind: "monster" }, count: { min: 0, max: 1 } }], { source, player: owner, opponent }, {});
  for (let attempt = 0; attempt < 100 && !game.targetSelection; attempt++) await new Promise<void>(resolve => setTimeout(resolve, 1));
  required(game.targetSelection);
  game.cancelTargetSelection();
  assert.equal((await action).executed, true);
  assert.equal(choices, 1);
  assert.ok(owner.graveyard.includes(recruit));
});

test("planned AI discards preserve the recorded order of instances", async t => {
  const { game, owner, opponent, make } = setup(t);
  const source = make(110), first = make(105), second = make(112);
  owner.hand.push(first, second);
  const moved: number[] = [];
  game.on("card_to_grave", event => { if (event.card?.id != null) moved.push(event.card.id); });
  const result = await game.effectEngine.applyActions([{ type: "discard_from_hand", count: 2, selectionId: "ordered_discard" }], {
    source, player: owner, opponent, activationContext: { decisions: { selections: { ordered_discard: [second.instanceId, first.instanceId] } } },
  }, {});
  assert.equal(result.success, true);
  assert.deepEqual(moved, [112, 105]);
});

test("AI resolution discards preserve resource preferences without becoming activation costs", async t => {
  const { game, owner, opponent, make } = setup(t);
  const source = make(110), hymn = make(105), imp = make(107), eel = make(101);
  owner.hand.push(hymn, imp, eel);
  await game.effectEngine.applyActions([{ type: "discard_from_hand", count: 2, selectionId: "infusion_discard", contextLabel: "discard" }], {
    source, player: owner, opponent,
    activationContext: { actionContext: { costPreferences: { forceNames: [hymn.name, eel.name] } } },
  }, {});
  assert.deepEqual(owner.hand, [imp]);
});

test("Chain resolution retains the activation resource policy for late discards", async t => {
  const { game, owner, make } = setup(t);
  const source = make(110), hymn = make(105), imp = make(107), eel = make(101);
  placeFieldCards(owner.spellTrap, source); owner.hand.push(hymn, imp, eel);
  const prepared = game.chainSystem.createPreparedActivation({ card: source, controller: owner,
    effect: required(source.effects[0]), activationZone: "spellTrap", committed: true,
    activationContext: { actionContext: { costPreferences: { forceNames: [hymn.name, eel.name] } } },
  });
  assert.ok(game.chainSystem.addToChain(prepared));
  await game.chainSystem.resolveChain();
  assert.deepEqual(owner.hand, [imp]);
  assert.ok(owner.field.includes(eel));
});

test("planned AI summon still records its exact instance through the broker", async t => {
  const { game, owner, opponent, make } = setup(t);
  const source = make(107), first = make(102), second = make(102);
  placeFieldCards(owner.field, source); owner.hand.push(first, second);
  let choices = 0;
  game.on("decision_made", event => { if (event.kind === "choice") choices++; });
  const effect = required(source.effects[0]);
  await game.effectEngine.applyActions(effect.actions || [], { source, player: owner, opponent, effect,
    activationContext: { decisions: { specialSummons: { [effect.id]: [second.instanceId] } } },
  }, {});
  assert.ok(owner.field.includes(second));
  assert.ok(owner.hand.includes(first));
  assert.equal(choices, 1);
});

test("Cova resolves above Hymn and its Normal Summon receives the temporary buff", async t => {
  const { game, owner, make } = setup(t);
  const hymn = make(105), grave = make(126), eel = make(101), recruit = make(107);
  placeFieldCards(owner.field, eel); placeFieldCards(owner.spellTrap, hymn, grave); owner.hand.push(recruit);
  const atk = recruit.atk;
  for (const source of [hymn, grave]) {
    assert.ok(game.chainSystem.addToChain(game.chainSystem.createPreparedActivation({ card: source, controller: owner,
      effect: required(source.effects[0]), activationZone: "spellTrap", committed: true })));
  }
  await game.chainSystem.resolveChain();
  assert.ok(owner.field.includes(recruit));
  assert.equal(recruit.atk, atk + 500);
  game.cleanupTempBoosts(owner);
  assert.equal(recruit.atk, atk);
});

for (const negated of [true, false]) {
  test(`Warlord revive consumes hard OPT under negation=${negated} and resets next turn`, async t => {
    const { game, owner, make } = setup(t);
    const source = make(122), other = make(122), recruit = make(101);
    placeFieldCards(owner.field, source); owner.graveyard.push(recruit);
    const effect = required(source.effects[1]);
    assert.ok(game.chainSystem.addToChain(game.chainSystem.createPreparedActivation({ card: source, controller: owner,
      effect, activationZone: "field", committed: true, activationNegated: negated })));
    await game.chainSystem.resolveChain();
    assert.equal(owner.field.includes(recruit), !negated);
    assert.equal(game.chainSystem.checkActivationUsage(other, owner, effect).ok, false);
    assert.equal(game.chainSystem.checkActivationUsage(other, owner, required(source.effects[0])).ok, true);
    await game.moveCard(source, owner, "graveyard", { fromZone: "field" });
    assert.equal(game.chainSystem.checkActivationUsage(source, owner, effect).ok, false);
    game.turnCounter++;
    assert.equal(game.chainSystem.checkActivationUsage(source, owner, effect).ok, true);
  });
}

for (const id of [107, 110, 122, 125] as const) {
  test(`${id} revalidates a restriction introduced after commitment`, async t => {
    const { game, owner, make } = setup(t);
    const source = make(id), recruit = make(101);
    const zone = id === 110 ? "spellTrap" : "field";
    placeFieldCards(owner[zone], source); owner[id === 107 ? "hand" : "graveyard"].push(recruit);
    if (id === 110) owner.hand.push(make(105), make(105));
    const effect = required(source.effects.find(effect => effect.actions?.some(action => action.type === "special_summon_from_zone")));
    const prepared = game.chainSystem.createPreparedActivation({ card: source, controller: owner, effect, activationZone: zone,
      context: { eventCard: recruit }, committed: true });
    assert.equal((await game.chainSystem.payActivationCosts(prepared)).success, true);
    assert.ok(game.chainSystem.addToChain(prepared));
    game.registerSpecialSummonRestriction(owner, { allowedFilters: { type: "Machine" }, duration: "until_end_turn" });
    await game.chainSystem.resolveChain();
    assert.equal(owner.field.includes(recruit), false);
    if (id === 125) assert.ok(owner.graveyard.includes(source));
    if (id === 110) assert.equal(owner.hand.length, 0, "resolved discards remain paid as part of the effect");
  });
}

for (const zone of ["field", "spellTrap", "fieldSpell"] as const) {
  test(`Demon Dragon declares a ${zone} target once before resolution`, async t => {
    const { game, owner, opponent, make } = setup(t);
    const source = make(121), victim = new Card(cardDefinition(zone === "field" ? 101 : zone === "spellTrap" ? 10 : 115), opponent.id);
    placeFieldCards(owner.field, source);
    if (zone === "fieldSpell") opponent.fieldSpell = victim;
    else placeFieldCards(opponent[zone], victim);
    victim.isFacedown = true;
    let targeted = 0;
    game.on("effect_targeted", event => { if (event.source === source) { targeted++; assert.equal(event.target, victim); } });
    await game.emit("after_summon", { card: source, player: owner, method: "fusion", fromZone: "extraDeck" });
    assert.equal(targeted, 1);
    assert.ok(opponent.graveyard.includes(victim));
  });
}

test("declining Warlord's replacement does not consume the shared protection", async t => {
  const { game, owner, make } = setup(t);
  owner.controllerType = "human";
  const first = make(122), second = make(122), cost = make(101);
  placeFieldCards(owner.field, first, second, cost);
  game.ui.showConfirmPrompt = async () => false;
  let links = 0;
  game.on("effect_activated", () => { links++; });
  await game.destroyCard(first, { cause: "battle" });
  assert.ok(owner.graveyard.includes(first));
  assert.equal(game.chainSystem.checkActivationUsage(second, owner, required(first.effects[0])).ok, true);
  assert.equal(links, 0);
});

test("Infusion negation performs no discard and preserves the cards in hand", async t => {
  const { game, owner, make } = setup(t);
  const source = make(110), first = make(101), second = make(107);
  placeFieldCards(owner.spellTrap, source); owner.hand.push(first, second);
  assert.ok(game.chainSystem.addToChain(game.chainSystem.createPreparedActivation({ card: source, controller: owner,
    effect: required(source.effects[0]), activationZone: "spellTrap", committed: true, activationNegated: true })));
  await game.chainSystem.resolveChain();
  assert.deepEqual(owner.hand, [first, second]);
  assert.equal(owner.field.length, 0);
});
