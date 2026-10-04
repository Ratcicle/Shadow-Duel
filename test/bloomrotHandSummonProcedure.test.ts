import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { HandSummonProcedure } from "../src/core/contracts/cards.js";
import type { DecisionKind, DecisionRequest, DecisionResult } from "../src/core/contracts/decisions.js";
import type { SelectionResult } from "../src/core/contracts/selection.js";
import type { HandSummonProcedureOptions } from "../src/core/game/summon/handProcedure.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

function setup(t: TestContext, seat: "player" | "bot" = "player", amount = 2) {
  const game = createRuntimeGame({ chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.phase = "main1"; game.turn = seat; game.turnCounter = 3;
  game.player.controllerType = game.bot.controllerType = "ai";
  game.disablePresentationDelays = true;
  game.ui.showChainResponseModal = async () => null;
  const owner = game[seat], opponent = seat === "player" ? game.bot : game.player;
  const procedure: HandSummonProcedure = {
    id: "generic_counter_hand_procedure", counterCost: {
      counterType: "spore", amount, owner: "any", zones: ["field", "spellTrap", "fieldSpell"], requireFaceup: true,
    }, oncePerTurn: true, oncePerTurnName: "generic_counter_hand_procedure", oncePerTurnConsumeOn: "success",
  };
  const source = new Card({ name: "Counter procedure monster", cardKind: "monster", level: 4, atk: 100, def: 100, handSummonProcedure: procedure }, owner.id);
  const other = new Card({ name: source.name, cardKind: "monster", level: 4, atk: 100, def: 100, handSummonProcedure: procedure }, owner.id);
  owner.hand.push(source, other);
  const pool = [new Card({ name: "Own counter pool", cardKind: "monster" }, owner.id), new Card({ name: "Enemy counter pool", cardKind: "monster" }, opponent.id)];
  placeFieldCards(owner.field, required(pool[0])); placeFieldCards(opponent.field, required(pool[1]));
  for (const card of pool) card.addCounter("spore", 4);
  const options = (sources = pool): HandSummonProcedureOptions => ({ position: "attack", counterSources: sources });
  return { game, owner, opponent, source, other, pool, options, procedure };
}

for (const amount of [2, 3, 4]) for (const seat of ["player", "bot"] as const) {
  test(`counter hand procedure pays ${amount} before the public summon attempt (${seat})`, async t => {
    const { game, owner, source, other, pool, options, procedure } = setup(t, seat, amount);
    let activationCount = 0, removalCount = 0;
    const trace: string[] = [];
    game.on("effect_activated", () => { activationCount++; });
    game.on("counter_removed", event => { removalCount++; assert.equal(event.amount, amount); trace.push("removed"); });
    const offer = game.offerSummonAttempt.bind(game);
    game.offerSummonAttempt = async (card, actor, input) => {
      assert.equal(pool.reduce((sum, entry) => sum + entry.getCounter("spore"), 0), 8 - amount);
      assert.equal(game.canUseOncePerTurn(other, owner, procedure).ok, true, "usage remains free until success");
      assert.equal(game.canSummonFromHandByProcedure(other, owner).ok, false, "transaction reserves the action");
      trace.push("attempt"); return offer(card, actor, input);
    };
    const result = await game.performHandSummonProcedure(source, owner, options());
    assert.equal(result.success, true);
    assert.deepEqual(trace, ["removed", "attempt"]);
    assert.equal(removalCount, 1); assert.equal(activationCount, 0);
    assert.equal(game.canUseOncePerTurn(other, owner, procedure).ok, false);
    assert.equal(result.transaction?.costs.length, amount);
    assert.ok(result.transaction?.costs.every(cost => cost.kind === "counter" && cost.paid && cost.counterType === "spore" && cost.amount === 1));
  });
}

for (const seat of ["player", "bot"] as const) test(`human chooses procedural counters manually before payment (${seat})`, async t => {
  const { game, owner, source, pool } = setup(t, seat);
  owner.controllerType = "human";
  game.autoSelector.select = () => assert.fail("human cost selection cannot call AutoSelector");
  const result = await game.performHandSummonProcedure(source, owner, { position: "attack" });
  assert.equal(result.needsSelection, true);
  assert.ok(owner.hand.includes(source));
  assert.equal(pool.reduce((sum, entry) => sum + entry.getCounter("spore"), 0), 8);
  const session = required(game.targetSelection), requirement = required(session.requirements[0]);
  session.selections[requirement.id] = [required(requirement.candidates[1]).key];
  await game.finishTargetSelection();
  assert.ok(owner.field.includes(source));
  assert.equal(required(pool[0]).getCounter("spore"), 4);
  assert.equal(required(pool[1]).getCounter("spore"), 2);
});

for (const changed of ["source", "counter_source"] as const) test(`AI broker cannot reuse a ${changed} that left and returned while deciding`, async t => {
  const { game, owner, source, pool } = setup(t);
  const decide = game.requestDecision.bind(game);
  function changedDecision(): Promise<SelectionResult | null>;
  function changedDecision<Kind extends DecisionKind>(input: DecisionRequest<Kind>): Promise<DecisionResult<Kind>>;
  async function changedDecision(input?: DecisionRequest<DecisionKind>): Promise<DecisionResult<DecisionKind>> {
    if (!input) return decide();
    const result = await decide(input);
    if (input.kind === "cost") {
      const card = changed === "source" ? source : required(pool[0]);
      await game.moveCard(card, owner, "graveyard", { fromZone: changed === "source" ? "hand" : "field" });
      if (changed === "source") await game.moveCard(card, owner, "hand", { fromZone: "graveyard" });
      else await game.moveCard(card, owner, "field", { fromZone: "graveyard", summonOrigin: "effect_resolution", position: "attack" });
      if (changed === "counter_source" && card.getCounter("spore") === 0) card.addCounter("spore", 4);
    }
    return result;
  }
  game.requestDecision = changedDecision;
  const result = await game.performHandSummonProcedure(source, owner, { position: "attack" });
  assert.equal(result.success, false);
  assert.ok(owner.hand.includes(source));
  assert.equal(pool.reduce((sum, card) => sum + card.getCounter("spore"), 0), 8);
  assert.notEqual(game.lastSummonTransaction?.card?.name, source.name);
});

test("Rootling's public procedure requires a Bloomrot Token and has no summon turn limit", async t => {
  const { game, owner } = setup(t);
  owner.hand.length = 0; owner.field.length = 0;
  const copies = [new Card(cardDefinition(402), owner.id), new Card(cardDefinition(402), owner.id)];
  owner.hand.push(...copies);
  assert.equal(game.canSummonFromHandByProcedure(required(copies[0]), owner).ok, false);
  const token = new Card({ name: "Bloomrot Token", cardKind: "monster", archetype: "Bloomrot" }, owner.id); token.isToken = true;
  placeFieldCards(owner.field, token);
  let activations = 0; game.on("effect_activated", () => { activations++; });
  for (const copy of copies) assert.equal((await game.performHandSummonProcedure(copy, owner, { position: "defense" })).success, true);
  assert.equal(activations, 0);
  assert.ok(copies.every(copy => owner.field.includes(copy) && copy.position === "defense"));
});

for (const id of [404, 407, 408]) test(`Bloomrot ${id} declares and publicly pays its approved counter procedure`, async t => {
  const { game, owner, pool } = setup(t);
  owner.hand.length = 0;
  const source = new Card(cardDefinition(id), owner.id); owner.hand.push(source);
  game.ui.showConfirmPrompt = async () => false;
  const procedure = required(source.handSummonProcedure), amount = required(procedure.counterCost).amount;
  const offer = game.offerSummonAttempt.bind(game);
  game.offerSummonAttempt = async (card, actor, input) => {
    assert.equal(pool.reduce((sum, card) => sum + card.getCounter("spore"), 0), 8 - amount);
    return offer(card, actor, input);
  };
  const result = await game.performHandSummonProcedure(source, owner, { counterSources: pool, position: "attack" });
  assert.equal(result.success, true);
  assert.equal(result.transaction?.costs.reduce((sum, cost) => sum + (cost.amount ?? 0), 0), amount);
  assert.equal(source.lastSummonProcedure, procedure.id);
});

test("a real Chain summon negation sees committed counter payments and permits another successful attempt", async t => {
  const { game, owner, opponent, source, other, pool, options, procedure } = setup(t);
  opponent.controllerType = "human";
  const negator = new Card(cardDefinition(275), opponent.id); placeFieldCards(opponent.field, negator);
  let chosen = false, sourceActivations = 0;
  const contexts: string[] = [];
  game.on("effect_activated", event => { if (event.card === source) sourceActivations++; });
  game.ui.showChainResponseModal = async (candidates, context) => {
    contexts.push(context?.type ?? "unknown");
    const response = candidates.find(candidate => candidate.card === negator);
    if (response && !chosen) {
      assert.equal(context?.type, "summon_attempt");
      assert.equal(pool.reduce((sum, card) => sum + card.getCounter("spore"), 0), 6);
      chosen = true; return response;
    }
    return null;
  };
  const negated = await game.performHandSummonProcedure(source, owner, options());
  assert.equal(chosen, true); assert.equal(negated.summonNegated, true); assert.equal(negated.success, false);
  assert.equal(sourceActivations, 0); assert.ok(owner.graveyard.includes(source));
  assert.equal(game.canUseOncePerTurn(other, owner, procedure).ok, true);
  assert.equal(game.activeSummonTransaction, null);
  const success = await game.performHandSummonProcedure(other, owner, options());
  assert.equal(success.success, true);
  assert.equal(game.canUseOncePerTurn(other, owner, procedure).ok, false);
  assert.equal(pool.reduce((sum, card) => sum + card.getCounter("spore"), 0), 4);
  assert.ok(contexts.includes("summon_attempt"));
});

test("Living Colony receives one aggregate counter removal after all units and generates one Token", async t => {
  const { game, owner, source, options } = setup(t, "player", 4);
  owner.fieldSpell = new Card(cardDefinition(410), owner.id);
  let events = 0;
  game.on("counter_removed", event => { events++; assert.equal(event.amount, 4); });
  assert.equal((await game.performHandSummonProcedure(source, owner, options())).success, true);
  assert.equal(events, 1);
  assert.equal(owner.field.filter(card => card.isToken && card.name === "Bloomrot Token").length, 1);
});

test("counter source discovery preserves face-up Spell/Trap and Field Spell zones on either side", async t => {
  const { game, owner, opponent, source, pool } = setup(t, "player", 4);
  for (const card of pool) card.removeCounter("spore", 4);
  const ownSpell = new Card({ name: "Own counter Spell", cardKind: "spell", subtype: "continuous" }, owner.id);
  const enemyField = new Card({ name: "Enemy counter Field", cardKind: "spell", subtype: "field" }, opponent.id);
  const hidden = new Card({ name: "Hidden pool", cardKind: "trap" }, opponent.id); hidden.isFacedown = true;
  ownSpell.addCounter("spore", 2); enemyField.addCounter("spore", 2); hidden.addCounter("spore", 8);
  placeFieldCards(owner.spellTrap, ownSpell); opponent.fieldSpell = enemyField; placeFieldCards(opponent.spellTrap, hidden);
  const check = game.canSummonFromHandByProcedure(source, owner);
  assert.deepEqual(check.counterCandidates, [ownSpell, enemyField]);
  assert.equal((await game.performHandSummonProcedure(source, owner, { position: "attack" })).success, true);
  assert.equal(ownSpell.getCounter("spore"), 0); assert.equal(enemyField.getCounter("spore"), 0); assert.equal(hidden.getCounter("spore"), 8);
  assert.deepEqual(game.lastSummonTransaction?.costs.map(cost => cost.fromZone), ["spellTrap", "fieldSpell", "spellTrap", "fieldSpell"]);
});

for (const seat of ["player", "bot"] as const) test(`cancelling a human procedural counter choice pays nothing (${seat})`, async t => {
  const { game, owner, source, other, pool, procedure } = setup(t, seat);
  owner.controllerType = "human";
  assert.equal((await game.performHandSummonProcedure(source, owner, { position: "attack" })).needsSelection, true);
  game.cancelTargetSelection();
  assert.equal(game.targetSelection, null); assert.ok(owner.hand.includes(source));
  assert.equal(pool.reduce((sum, card) => sum + card.getCounter("spore"), 0), 8);
  assert.equal(game.canUseOncePerTurn(other, owner, procedure).ok, true);
});

for (const changed of ["source", "counter_source", "counter_count", "control", "face"] as const) test(`manual placement revalidates ${changed} before any procedural counter payment`, async t => {
  const { game, owner, opponent, source, other, pool, options, procedure } = setup(t);
  owner.controllerType = "human"; game.getFieldPlacementMode = () => "manual";
  const first = required(pool[0]);
  game.fieldPlacementProvider = async () => {
    if (changed === "counter_count") first.removeCounter("spore", 4);
    else if (changed === "face") first.isFacedown = true;
    else if (changed === "control") await game.transferControl(first, opponent);
    else {
      const card = changed === "source" ? source : first;
      await game.moveCard(card, owner, "graveyard", { fromZone: changed === "source" ? "hand" : "field" });
      if (changed === "source") await game.moveCard(card, owner, "hand", { fromZone: "graveyard" });
      else await game.moveCard(card, owner, "field", { fromZone: "graveyard", summonOrigin: "effect_resolution", position: "attack" });
    }
    return { outcome: "chosen", slot: 4 };
  };
  const result = await game.performHandSummonProcedure(source, owner, options([first]));
  assert.equal(result.success, false); assert.notEqual(game.lastSummonTransaction?.card?.name, source.name);
  assert.equal(required(pool[1]).getCounter("spore"), 4);
  assert.equal(game.canUseOncePerTurn(other, owner, procedure).ok, true);
  assert.ok(owner.hand.includes(source));
});

test("partial procedural counter failure records paid units without refund or usage consumption", async t => {
  const { game, owner, source, other, pool, options, procedure } = setup(t);
  let steps = 0, removed = 0;
  game.waitForPresentationDelay = async () => { if (++steps === 1) required(pool[1]).removeCounter("spore", 4); };
  game.on("counter_removed", event => { removed += event.amount; });
  const result = await game.performHandSummonProcedure(source, owner, options());
  assert.equal(result.success, false); assert.equal(required(pool[0]).getCounter("spore"), 3);
  assert.deepEqual(result.transaction?.costs.map(cost => cost.paid), [true, false]);
  assert.equal(removed, 1); assert.equal(game.activeSummonTransaction, null);
  assert.equal(game.canUseOncePerTurn(other, owner, procedure).ok, true);
});

test("a negated counter procedure keeps its payment and releases the successful-summon limit", async t => {
  const { game, owner, source, other, pool, options, procedure } = setup(t);
  game.offerSummonAttempt = async (_card, _actor, input) => {
    const transaction = required(input?.summonTransaction);
    game.markSummonNegated(transaction.summonId, { destination: "graveyard" });
    return { ok: false, summonNegated: true, transaction, ownsTransaction: false };
  };
  const result = await game.performHandSummonProcedure(source, owner, options());
  assert.equal(result.summonNegated, true);
  assert.equal(pool.reduce((sum, entry) => sum + entry.getCounter("spore"), 0), 6);
  assert.ok(owner.graveyard.includes(source));
  assert.equal(game.canUseOncePerTurn(other, owner, procedure).ok, true);
  assert.equal(game.activeSummonTransaction, null);
});

test("insufficient counters reject a procedure before commitment", async t => {
  const { game, owner, source, other, pool, options, procedure } = setup(t);
  for (const card of pool) card.removeCounter("spore", 4);
  required(pool[0]).addCounter("spore", 1);
  assert.equal(game.canSummonFromHandByProcedure(source, owner).ok, false);
  assert.equal((await game.performHandSummonProcedure(source, owner, options())).success, false);
  assert.equal(game.canUseOncePerTurn(other, owner, procedure).ok, true);
  assert.ok(owner.hand.includes(source));
  assert.equal(game.lastSummonTransaction, null);
});
