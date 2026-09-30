import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { cardDefinition, required, chainSelections } from "./helpers/fixtures.js";
import type { DecisionMadeEventPayload } from "../src/core/contracts/events.js";
import { getCounterLimitSummonOptions } from "../src/core/actionHandlers/summon/counterLimit.js";

function setup(t: TestContext, seat: "player" | "bot" = "player") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = game.bot.controllerType = "ai";
  const owner = game[seat];
  const opponent = seat === "player" ? game.bot : game.player;
  const make = (id: number) => new Card(cardDefinition(id), owner.id);
  return { game, owner, opponent, make };
}

for (const id of [117, 119] as const) {
  for (const phase of ["battle", "standby"] as const) {
    test(`${id} rejects ${phase} without paying`, async t => {
      const { game, owner, make } = setup(t);
      const source = make(id), eel = make(101);
      placeFieldCards(owner.field, eel);
      if (id === 117) owner.hand.push(source);
      else { placeFieldCards(owner.spellTrap, source); source.addCounter("judgment_marker", 3); owner.deck.push(make(125)); }
      game.phase = phase;
      const result = id === 117
        ? await game.tryActivateMonsterEffect(source, { leviathan_cost: [eel] }, "hand", owner)
        : await game.tryActivateSpellTrapEffect(source, null, { owner });
      assert.equal(result.success, false);
      assert.ok(owner.field.includes(eel));
      assert.equal(owner.graveyard.length, 0);
    });
  }
  for (const late of [false, true]) {
    test(`${id} respects summon restrictions introduced ${late ? "after" : "before"} cost`, async t => {
      const { game, owner, make } = setup(t);
      const source = make(id), eel = make(101);
      placeFieldCards(owner.field, eel);
      if (id === 117) owner.hand.push(source);
      else { placeFieldCards(owner.spellTrap, source); source.addCounter("judgment_marker", 3); owner.deck.push(make(125)); }
      const restrict = () => { game.registerSpecialSummonRestriction(owner, { allowedFilters: { type: "Machine" }, duration: "until_end_turn" }); };
      if (late) game.on("effect_activated", event => { if (event.card === source) restrict(); });
      else restrict();
      if (id === 117) await game.tryActivateMonsterEffect(source, { leviathan_cost: [eel] }, "hand", owner);
      else await game.tryActivateSpellTrapEffect(source, null, { owner });
      assert.equal(owner.graveyard.includes(id === 117 ? eel : source), late);
      assert.equal(owner.field.some(card => card.id === id || card.id === 125), false);
    });
  }
  test(`${id} activation negation retains the cost`, async t => {
    const { game, owner, make } = setup(t);
    const source = make(id), eel = make(101);
    placeFieldCards(owner.field, eel);
    if (id === 117) owner.hand.push(source);
    else { placeFieldCards(owner.spellTrap, source); source.addCounter("judgment_marker", 3); owner.deck.push(make(125)); }
    const effect = required(source.effects.find(effect => effect.timing === "ignition"));
    const prepared = game.chainSystem.createPreparedActivation({ card: source, controller: owner, effect,
      activationZone: id === 117 ? "hand" : "spellTrap", committed: true, activationNegated: true,
      costSelections: chainSelections(id === 117 ? { leviathan_cost: [eel] } : {}) });
    assert.equal((await game.chainSystem.payActivationCosts(prepared)).success, true);
    required(game.chainSystem.addToChain(prepared));
    await game.chainSystem.resolveChain();
    assert.ok(owner.graveyard.includes(id === 117 ? eel : source));
    assert.equal(owner.field.some(card => card.id === id || card.id === 125), false);
    if (id === 119) assert.equal(game.chainSystem.checkActivationUsage(make(119), owner, effect).ok, false);
  });
}

for (const returns of [false, true]) {
  test(`Leviathan source leaving hand cannot summon (returns=${returns})`, async t => {
    const { game, owner, make } = setup(t);
    const source = make(117), eel = make(101);
    owner.hand.push(source); placeFieldCards(owner.field, eel);
    game.on("effect_activated", async event => {
      if (event.card !== source) return;
      await game.moveCard(source, owner, "graveyard", { fromZone: "hand" });
      if (returns) await game.moveCard(source, owner, "hand", { fromZone: "graveyard" });
    });
    await game.tryActivateMonsterEffect(source, { leviathan_cost: [eel] }, "hand", owner);
    assert.ok(owner.graveyard.includes(eel));
    assert.equal(owner.field.includes(source), false);
  });
}

test("Cathedral snapshot survives counter cleanup during payment", async t => {
  const { game, owner, make } = setup(t);
  const source = make(119), recruit = make(125);
  source.addCounter("judgment_marker", 3); placeFieldCards(owner.spellTrap, source); owner.deck.push(recruit);
  game.on("card_to_grave", event => { if (event.card === source) source.counters.clear(); });
  const result = await game.tryActivateSpellTrapEffect(source, null, { owner });
  assert.equal(result.success, true, result.reason || undefined);
  assert.ok(owner.field.includes(recruit));
});

for (const invalid of ["empty deck", "no counters", "full field", "presence", "facedown", "opponent turn"] as const) {
  test(`Cathedral rejects ${invalid} without spending cost or hard OPT`, async t => {
    const { game, owner, opponent, make } = setup(t);
    const source = make(119), recruit = make(125);
    source.addCounter("judgment_marker", invalid === "no counters" ? 0 : 3);
    source.isFacedown = invalid === "facedown";
    placeFieldCards(owner.spellTrap, source);
    if (invalid !== "empty deck") owner.deck.push(recruit);
    if (invalid === "full field") placeFieldCards(owner.field, ...Array.from({ length: 5 }, () => make(101)));
    if (invalid === "presence") {
      const exclusive = make(111);
      exclusive.fieldPresenceRestriction = { type: "only_monster_you_control_while_faceup" };
      placeFieldCards(owner.field, exclusive);
    }
    if (invalid === "opponent turn") game.turn = opponent.id;
    const result = await game.tryActivateSpellTrapEffect(source, null, { owner });
    assert.equal(result.success, false);
    assert.ok(owner.spellTrap.includes(source));
    assert.equal(game.chainSystem.checkActivationUsage(source, owner, required(source.effects[1])).ok, true);
  });
}

test("Leviathan rejects a field presence restriction before spending Eel", async t => {
  const { game, owner, make } = setup(t);
  const source = make(117), eel = make(101), exclusive = make(125);
  exclusive.fieldPresenceRestriction = { type: "only_monster_you_control_while_faceup" };
  owner.hand.push(source); placeFieldCards(owner.field, eel, exclusive);
  const result = await game.tryActivateMonsterEffect(source, { leviathan_cost: [eel] }, "hand", owner);
  assert.equal(result.success, false);
  assert.ok(owner.field.includes(eel));
  assert.equal(owner.graveyard.length, 0);
});

for (const useKeys of [false, true]) {
test(`generic monster preview accounts for a field slot freed by activation cost (keys=${useKeys})`, async t => {
  const { game, owner, make } = setup(t);
  const source = make(201), cost = make(202);
  owner.graveyard.push(source);
  placeFieldCards(owner.field, cost, ...Array.from({ length: 4 }, () => make(202)));
  const chosen = useKeys ? [game.buildSelectionCandidateKey({ controller: owner.id, zone: "field", zoneIndex: 0, cardRef: cost })] : [cost];
  const result = await game.tryActivateMonsterEffect(source, { void_conjurer_cost: chosen }, "graveyard", owner);
  assert.equal(result.success, true, result.reason || undefined);
  assert.ok(owner.field.includes(source));
  assert.ok(owner.graveyard.includes(cost));
  assert.equal(owner.field.length, 5);
});

test(`generic preview preserves full-field summons with legacy action costs (keys=${useKeys})`, async t => {
  const { game, owner, make } = setup(t);
  const source = make(358);
  const cost = make(351);
  owner.hand.push(source); placeFieldCards(owner.field, cost, ...Array.from({ length: 4 }, () => make(101)));
  const chosen = useKeys ? [game.buildSelectionCandidateKey({ controller: owner.id, zone: "field", zoneIndex: 0, cardRef: cost })] : [cost];
  const result = await game.tryActivateMonsterEffect(source, { miragebound_false_king_return_cost: chosen }, "hand", owner);
  assert.equal(result.success, true, result.reason || undefined);
  assert.ok(owner.field.includes(source));
  assert.ok(owner.hand.includes(cost));
});
}

test("Cathedral uses independent immutable activation counts and accepts ATK at the boundary", async t => {
  const { game, owner, opponent, make } = setup(t);
  const low = make(119), high = make(119), small = make(102), large = make(118);
  low.addCounter("judgment_marker", 2); high.addCounter("judgment_marker", 3);
  owner.deck.push(small, large);
  const effect = required(low.effects[1]);
  const lowSnapshot = game.chainSystem.createPreparedActivation({ card: low, controller: owner, effect, activationZone: "spellTrap" }).sourceAtActivation;
  const highSnapshot = game.chainSystem.createPreparedActivation({ card: high, controller: owner, effect, activationZone: "spellTrap" }).sourceAtActivation;
  low.counters.clear(); high.addCounter("judgment_marker", 10);
  const action = { type: "special_summon_from_deck_with_counter_limit", counterSource: "activation", counterType: "judgment_marker", archetype: "Shadow-Heart" } as const;
  assert.deepEqual(getCounterLimitSummonOptions(action, { source: low, player: owner, opponent, activationContext: { sourceAtActivation: lowSnapshot } }, game.effectEngine).candidates, [small]);
  assert.deepEqual(getCounterLimitSummonOptions(action, { source: high, player: owner, opponent, activationContext: { sourceAtActivation: highSnapshot } }, game.effectEngine).candidates, [small, large]);
  assert.equal(getCounterLimitSummonOptions(action, { source: high, player: owner, opponent }, game.effectEngine).candidates.length, 0, "missing snapshot cannot read live counters");
});

test("Shield with insufficient LP records no payment choice and emits no loss", async t => {
  const { game, owner, opponent, make } = setup(t);
  const source = make(113); placeFieldCards(owner.spellTrap, source); owner.lp = 799;
  let changes = 0, decisions = 0;
  game.on("lp_change", () => { changes++; });
  game.on("decision_made", () => { decisions++; });
  await game.effectEngine.applyActions([{ type: "upkeep_pay_or_send_to_grave", lpCost: 800 }], { source, player: owner, opponent }, {});
  assert.equal(owner.lp, 799); assert.ok(owner.graveyard.includes(source));
  assert.equal(changes, 0); assert.equal(decisions, 0);
});

test("Shield does not authorize human payment through the inert UI adapter", async t => {
  const { game, owner, opponent, make } = setup(t);
  const source = make(113); placeFieldCards(owner.spellTrap, source);
  owner.controllerType = "human";
  await game.effectEngine.applyActions([{ type: "upkeep_pay_or_send_to_grave", lpCost: 800 }], { source, player: owner, opponent }, {});
  assert.equal(owner.lp, 8000);
  assert.ok(owner.graveyard.includes(source));
});

test("Leviathan can cancel Eel selection before committing its cost", async t => {
  const { game, owner, make } = setup(t);
  const source = make(117), first = make(101), second = make(101);
  owner.controllerType = "human";
  owner.hand.push(source); placeFieldCards(owner.field, first, second);
  const activation = game.tryActivateMonsterEffect(source, null, "hand", owner);
  for (let attempt = 0; attempt < 100 && !game.targetSelection; attempt++) {
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.ok(game.targetSelection);
  game.cancelTargetSelection();
  await activation;
  assert.deepEqual(owner.hand, [source]);
  assert.deepEqual(owner.field, [first, second]);
  assert.equal(owner.graveyard.length, 0);
  assert.equal(game.chainSystem.isResolving, false);
});

test("generic optional hand summon records confirmation, while refusal leaves source in hand", async t => {
  const { game, owner, opponent, make } = setup(t);
  const source = make(101); owner.hand.push(source); owner.controllerType = "human";
  game.ui.showConfirmPrompt = async () => false;
  let choices = 0;
  game.on("decision_made", event => { if (event.kind === "choice") choices++; });
  await game.effectEngine.applyActions([{ type: "conditional_summon_from_hand", targetRef: "self", optional: true }], { source, player: owner, opponent }, {});
  assert.ok(owner.hand.includes(source)); assert.equal(owner.field.length, 0); assert.equal(choices, 1);
});

for (const seat of ["player", "bot"] as const) {
  for (const accepted of [true, false]) {
    test(`Shield records human upkeep ${accepted} in ${seat}`, async t => {
      const { game, owner, opponent, make } = setup(t, seat);
      const shield = make(113), eel = make(101);
      placeFieldCards(owner.field, eel); placeFieldCards(owner.spellTrap, shield);
      shield.equippedTo = eel;
      owner.controllerType = "human";
      game.ui.showConfirmPrompt = async () => accepted;
      const decisions: DecisionMadeEventPayload[] = [];
      game.on("decision_made", event => { if (event.kind === "choice") decisions.push(event); });
      let changes = 0;
      game.on("lp_change", () => { changes++; });
      await game.effectEngine.applyActions([{ type: "upkeep_pay_or_send_to_grave", lpCost: 800 }], {
        source: shield, player: owner, opponent,
      }, {});
      assert.equal(owner.lp, accepted ? 7200 : 8000);
      assert.equal(owner.graveyard.includes(shield), !accepted);
      assert.equal(changes, accepted ? 1 : 0);
      assert.equal(decisions.length, 1, "upkeep must be replayable");
      assert.deepEqual(required(decisions[0]).value, accepted ? { pass: false, candidateKey: "confirm", effectId: null } : { pass: true });
    });
  }
  test(`Cathedral pays before responses and summons using spent counters in ${seat}`, async t => {
    const { game, owner, make } = setup(t, seat);
    const cathedral = make(119), recruit = make(125);
    cathedral.addCounter("judgment_marker", 3);
    placeFieldCards(owner.spellTrap, cathedral); owner.deck.push(recruit);
    let paidAtResponse = false, paidAtSummon = false;
    game.on("effect_activated", event => {
      if (event.source === cathedral || event.card === cathedral) { paidAtResponse = owner.graveyard.includes(cathedral); cathedral.counters.clear(); }
    });
    game.on("after_summon", event => { if (event.card === recruit) paidAtSummon = owner.graveyard.includes(cathedral); });
    const result = await game.tryActivateSpellTrapEffect(cathedral, null, { owner });
    assert.equal(result.success, true, result.reason || undefined);
    assert.ok(paidAtResponse, "cost must precede responses");
    assert.ok(paidAtSummon);
    assert.ok(owner.field.includes(recruit));
    assert.equal(cathedral.getCounter("judgment_marker"), 0);
  });
  test(`Leviathan pays Eel before responses, without targeting, on a full field in ${seat}`, async t => {
    const { game, owner, make } = setup(t, seat);
    const leviathan = make(117), eel = make(101);
    owner.hand.push(leviathan);
    placeFieldCards(owner.field, eel, ...Array.from({ length: 4 }, () => make(108)));
    let paid = false, targeted = 0;
    game.on("effect_activated", event => { if (event.source === leviathan || event.card === leviathan) paid = owner.graveyard.includes(eel); });
    game.on("effect_targeted", event => { if (event.target === eel) targeted++; });
    const result = await game.tryActivateMonsterEffect(leviathan, { leviathan_cost: [eel] }, "hand", owner);
    assert.equal(result.success, true, result.reason || undefined);
    assert.ok(paid);
    assert.equal(targeted, 0);
    assert.ok(owner.field.includes(leviathan));
    assert.equal(owner.field.length, 5);
    assert.equal(owner.graveyard.filter(card => card === eel).length, 1);
  });
}
