import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { createRuntimeGame, placeFieldCards, completeTestSelections } from "./helpers/game.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import type { CanonicalSelectionMap } from "../src/core/contracts/selection.js";

function setup(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, randomSeed: 251, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.turn = "player"; game.phase = "main1"; game.turnCounter = 3;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = game.bot.controllerType = "ai";
  const make = (id: number) => new Card(cardDefinition(id), game.player.id);
  return { game, owner: game.player, make };
}

const costCases = [
  { id: 256, effectId: "luminescent_dragon_banish_debuff", zone: "graveyard", destination: "banished" },
  { id: 259, effectId: "bbd_special_summon_from_hand", zone: "hand", destination: "graveyard", costId: "bbd_cost" },
  { id: 259, effectId: "bbd_gy_banish_search", zone: "graveyard", destination: "banished" },
  { id: 260, effectId: "hellkite_dragon_hand_ss_cost", zone: "hand", destination: "graveyard", costId: "hellkite_cost_field_dragon" },
  { id: 260, effectId: "hellkite_dragon_field_send_revive", zone: "field", destination: "graveyard" },
  { id: 261, effectId: "hellkite_roar_gy_search_peak", zone: "graveyard", destination: "banished" },
  { id: 262, effectId: "dragon_peak_ignite_summon", zone: "fieldSpell", destination: "graveyard" },
  { id: 267, effectId: "rainbow_cosmic_dragon_gy_send_extremes", zone: "graveyard", destination: "banished" },
  { id: 269, effectId: "boneflame_dragon_gy_revive", zone: "graveyard", destination: "graveyard", costId: "boneflame_cost_target" },
  { id: 276, effectId: "estrelas_convergentes_effect", zone: "hand", destination: "graveyard", costId: "estrelas_convergentes_discard" },
  { id: 277, effectId: "extreme_dragon_awakening_gy_search", zone: "graveyard", destination: "banished" },
] as const;

for (const entry of costCases) {
  test(`${entry.effectId} pays before responses and activation negation retains payment`, async t => {
    const { game, owner, make } = setup(t);
    const source = make(entry.id), first = make(252), second = make(254);
    const target = new Card(cardDefinition(257), game.bot.id);
    placeFieldCards(game.bot.field, target);
    const costId = "costId" in entry ? entry.costId : null;
    const paidCards = costId ? entry.id === 259 ? [first, second] : [first] : [source];
    if (entry.zone === "fieldSpell") { owner.fieldSpell = source; source.addCounter("dragon_peak", 7); }
    else if (entry.zone === "field") placeFieldCards(owner.field, source);
    else owner[entry.zone].push(source);
    if (costId) {
      if (entry.id === 260 || entry.id === 269) placeFieldCards(owner.field, first);
      else owner.hand.push(...paidCards);
    }
    owner.deck.push(make(entry.id === 261 ? 262 : entry.id === 267 || entry.id === 277 ? 270 : 257));
    owner.graveyard.push(make(252));
    const selections: CanonicalSelectionMap = costId ? { [costId]: paidCards } : entry.id === 256 ? { luminescent_debuff_target: [target] } : {};
    let responses = 0;
    game.chainSystem.offerChainResponses = async () => {
      const link = game.chainSystem.getLastChainLink();
      if (link?.effect?.id === entry.effectId) {
        responses++;
        assert.equal(link.costsPaid, true);
        for (const card of paidCards) assert.ok(owner[entry.destination].includes(card), "cost is already paid when responses open");
        assert.equal(link.declaredTargets.length, entry.id === 256 ? 1 : 0, "payments and resolution choices are not declared targets");
        link.activationNegated = true;
      }
      return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
    };
    if (entry.zone === "fieldSpell") await game.activateFieldSpellEffect(source);
    else if (entry.id === 276) await game.tryActivateSpell(source, owner.hand.indexOf(source), selections, { owner });
    else if (source.cardKind === "spell") await game.tryActivateSpellTrapEffect(source, selections, { owner, activationZone: "graveyard", effectId: entry.effectId });
    else await game.tryActivateMonsterEffect(source, selections, entry.zone, owner, { effectId: entry.effectId });
    assert.equal(responses, 1, "activation must reach the response window");
    for (const card of paidCards) assert.ok(owner[entry.destination].includes(card));
    assert.equal(owner.field.includes(source), false);
  });
}

test("Black Bull sending Dragons does not trigger either discard effect", async t => {
  const { game, owner, make } = setup(t);
  const source = make(259), voltaic = make(255), armored = make(252), luminous = make(251), grey = make(254);
  owner.hand.push(source, voltaic, armored); owner.graveyard.push(grey); placeFieldCards(owner.field, luminous);
  const result = await game.tryActivateMonsterEffect(source, { bbd_cost: [voltaic, armored] }, "hand", owner, { effectId: "bbd_special_summon_from_hand" });
  assert.equal(result.success, true, result.reason || undefined);
  assert.equal(game.bot.lp, 8000);
  assert.ok(owner.graveyard.includes(grey));
  assert.ok(owner.field.includes(source));
});

test("Converging Stars actually discards and triggers Voltaic and Luminous", async t => {
  const { game, owner, make } = setup(t);
  const source = make(276), voltaic = make(255), luminous = make(251), grey = make(254);
  owner.hand.push(source, voltaic); owner.graveyard.push(grey); placeFieldCards(owner.field, luminous);
  await game.tryActivateSpell(source, 0, { estrelas_convergentes_discard: [voltaic] }, { owner });
  assert.equal(game.bot.lp, 7200);
  assert.ok(owner.hand.includes(grey));
});

test("Luminescent declares its revival target before responses and cannot replace a lost target", async t => {
  const { game, owner, make } = setup(t);
  const source = make(256), target = make(252), reserve = make(255);
  owner.hand.push(source); owner.graveyard.push(target);
  let declared = 0;
  game.on("effect_targeted", event => { if (event.source === source) declared++; });
  game.chainSystem.offerChainResponses = async () => {
    const link = game.chainSystem.getLastChainLink();
    if (link?.effect?.id === "luminescent_dragon_normal_summon_revive") {
      assert.equal(link.declaredTargets.length, 1);
      await game.moveCard(target, owner, "banished", { fromZone: "graveyard" });
      await game.moveCard(target, owner, "graveyard", { fromZone: "banished" });
      owner.graveyard.push(reserve);
    }
    return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
  };
  await game.performNormalSummon(owner, 0, "attack");
  assert.equal(declared, 1);
  assert.equal(owner.field.includes(target), false, "a returned target is a different presence");
  assert.equal(owner.field.includes(reserve), false);
});

for (const human of [false, true]) {
  test(`Rainbow chooses at resolution through the broker (${human ? "human singleton" : "AI"})`, async t => {
    const { game, owner, make } = setup(t);
    const source = make(267), extreme = make(270);
    owner.graveyard.push(source); owner.deck.push(extreme);
    owner.controllerType = human ? "human" : "ai";
    let choices = 0, targets = 0;
    game.on("decision_made", event => { if (event.kind === "choice") choices++; });
    game.on("effect_targeted", () => { targets++; });
    game.chainSystem.offerChainResponses = async () => ({ lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 });
    const activation = game.tryActivateMonsterEffect(source, null, "graveyard", owner, { effectId: "rainbow_cosmic_dragon_gy_send_extremes" });
    if (human) {
      for (let i = 0; i < 100 && !game.targetSelection; i++) await new Promise<void>(resolve => setTimeout(resolve, 1));
      const session = required(game.targetSelection);
      assert.equal(session.kind, "choice");
      assert.ok(owner.banished.includes(source), "the resolution choice follows the committed cost");
      assert.equal(session.allowCancel, false);
      await completeTestSelections(game, activation);
    } else await activation;
    assert.ok(owner.graveyard.includes(extreme));
    assert.ok(owner.banished.includes(source));
    assert.equal(targets, 0);
    assert.equal(choices, 1);
  });
}

test("Radiant chooses a current GY monster after responses without declaring a target", async t => {
  const { game, owner, make } = setup(t);
  const source = make(266), early = make(252), late = make(255);
  placeFieldCards(owner.field, source); owner.graveyard.push(early);
  let targeted = 0, responses = 0;
  game.on("effect_targeted", event => { if (event.source === source) targeted++; });
  game.chainSystem.offerChainResponses = async () => {
    const link = game.chainSystem.getLastChainLink();
    if (link?.effect?.id === "radiant_cosmic_dragon_destroyed_revive") {
      responses++;
      assert.equal(link.declaredTargets.length, 0);
      await game.moveCard(early, owner, "banished", { fromZone: "graveyard" });
      owner.graveyard.push(late);
    }
    return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
  };
  await game.destroyCard(source, { cause: "effect", sourcePlayer: game.bot });
  assert.equal(responses, 1); assert.equal(targeted, 0);
  assert.ok(owner.field.includes(late));
});

for (const counters of [6, 7]) {
  test(`Peak requires seven markers and resolves after its source cost (has ${counters})`, async t => {
    const { game, owner, make } = setup(t);
    const source = make(262), recruit = make(257);
    owner.fieldSpell = source; source.addCounter("dragon_peak", counters); owner.deck.push(recruit);
    let responses = 0;
    game.chainSystem.offerChainResponses = async () => {
      const link = game.chainSystem.getLastChainLink();
      if (link?.effect?.id === "dragon_peak_ignite_summon") {
        responses++;
        assert.ok(owner.graveyard.includes(source));
        assert.equal(link.sourceAtActivation?.counters?.dragon_peak, 7);
      }
      return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
    };
    await game.activateFieldSpellEffect(source);
    assert.equal(responses, counters === 7 ? 1 : 0);
    assert.equal(owner.field.includes(recruit), counters === 7);
    assert.equal(owner.graveyard.includes(source), counters === 7);
  });
}

for (const effectId of ["hellkite_dragon_hand_ss_cost", "hellkite_dragon_field_send_revive", "boneflame_dragon_gy_revive"]) {
  test(`${effectId} can pay a field cost to free its summon slot`, async t => {
    const { game, owner, make } = setup(t);
    const isHand = effectId === "hellkite_dragon_hand_ss_cost";
    const source = make(effectId === "boneflame_dragon_gy_revive" ? 269 : 260);
    const cost = effectId === "hellkite_dragon_field_send_revive" ? source : make(252);
    placeFieldCards(owner.field, cost, ...Array.from({ length: 4 }, () => make(252)));
    if (isHand) owner.hand.push(source);
    else if (effectId === "boneflame_dragon_gy_revive") owner.graveyard.push(source);
    else owner.graveyard.push(make(255));
    const selections = isHand ? { hellkite_cost_field_dragon: [cost] } : effectId === "boneflame_dragon_gy_revive" ? { boneflame_cost_target: [cost] } : null;
    const result = await game.tryActivateMonsterEffect(source, selections, isHand ? "hand" : effectId === "boneflame_dragon_gy_revive" ? "graveyard" : "field", owner, { effectId });
    assert.equal(result.success, true, result.reason || undefined);
    assert.ok(owner.graveyard.includes(cost)); assert.equal(owner.field.length, 5);
    assert.ok(owner.field.some(card => card.id === (effectId === "hellkite_dragon_field_send_revive" ? 255 : source.id)));
  });
}

test("Black Bull can cancel cost selection before commitment", async t => {
  const { game, owner, make } = setup(t);
  const source = make(259), first = make(252), second = make(254);
  owner.hand.push(source, first, second); owner.controllerType = "human";
  const activation = game.tryActivateMonsterEffect(source, null, "hand", owner, { effectId: "bbd_special_summon_from_hand" });
  for (let i = 0; i < 100 && !game.targetSelection; i++) await new Promise<void>(resolve => setTimeout(resolve, 1));
  assert.ok(game.targetSelection); game.cancelTargetSelection(); await activation;
  assert.deepEqual(owner.hand, [source, first, second]); assert.equal(owner.graveyard.length, 0);
});

test("Natural Selection's genuine discard still triggers Dragon discard effects", async t => {
  const { game, owner, make } = setup(t);
  const spell = make(21), voltaic = make(255), luminous = make(251), grey = make(254);
  const target = new Card(cardDefinition(257), game.bot.id);
  owner.hand.push(spell, voltaic); placeFieldCards(owner.field, luminous); owner.graveyard.push(grey);
  placeFieldCards(game.bot.field, target);
  await game.tryActivateSpell(spell, 0, { natural_selection_cost: [voltaic], natural_selection_target: [target] }, { owner });
  assert.equal(game.bot.lp, 7200); assert.ok(owner.hand.includes(grey));
  assert.ok(game.bot.graveyard.includes(target));
});

for (const negated of [false, true]) {
  for (const entry of costCases.filter(candidate => candidate.destination === "graveyard")) {
    test(`${entry.effectId} requires a payable GY destination (Galaxy negated: ${negated})`, async t => {
      const { game, owner, make } = setup(t);
      const source = make(entry.id), first = make(252), second = make(254);
      const galaxy = new Card(cardDefinition(273), game.bot.id);
      galaxy.effectsNegated = negated; placeFieldCards(game.bot.field, galaxy);
      const costId = "costId" in entry ? entry.costId : null;
      const paidCards = costId ? entry.id === 259 ? [first, second] : [first] : [source];
      if (entry.zone === "fieldSpell") { owner.fieldSpell = source; source.addCounter("dragon_peak", 7); }
      else if (entry.zone === "field") placeFieldCards(owner.field, source);
      else owner[entry.zone].push(source);
      if (costId) {
        if (entry.id === 260 || entry.id === 269) placeFieldCards(owner.field, first);
        else owner.hand.push(...paidCards);
      }
      owner.deck.push(make(257)); owner.graveyard.push(make(255));
      const selections: CanonicalSelectionMap = costId ? { [costId]: paidCards } : {};
      let responses = 0;
      game.chainSystem.offerChainResponses = async () => {
        const link = game.chainSystem.getLastChainLink();
        if (link?.effect?.id === entry.effectId) responses++;
        return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
      };
      if (entry.zone === "fieldSpell") await game.activateFieldSpellEffect(source);
      else if (entry.id === 276) await game.tryActivateSpell(source, 0, selections, { owner });
      else await game.tryActivateMonsterEffect(source, selections, entry.zone, owner, { effectId: entry.effectId });
      assert.equal(responses, negated ? 1 : 0);
      assert.equal(owner.banished.length, 0, "an impossible exact-destination cost must not consume cards");
      for (const card of paidCards) assert.equal(owner.graveyard.includes(card), negated);
      if (!negated) {
        if (entry.zone === "fieldSpell") assert.equal(owner.fieldSpell, source);
        else assert.ok(owner[entry.zone].includes(source));
      }
    });
  }
}

test("a chosen field cost that must be banished cannot pay an exact GY destination", async t => {
  const { game, owner, make } = setup(t);
  const source = make(260), cost = make(252), alternate = make(254);
  owner.hand.push(source); placeFieldCards(owner.field, cost, alternate); cost.banishWhenLeavesField = true;
  const result = await game.tryActivateMonsterEffect(source, { hellkite_cost_field_dragon: [cost] }, "hand", owner, { effectId: "hellkite_dragon_hand_ss_cost" });
  assert.equal(result.success, false);
  assert.ok(owner.hand.includes(source)); assert.ok(owner.field.includes(cost)); assert.ok(owner.field.includes(alternate));
  assert.equal(owner.banished.length, 0);
});
