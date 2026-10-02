import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards } from "./helpers/game.js";

const make = (id: number, owner = "player") => new Card(cardDefinition(id), owner);
function setup(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false });
  game.turn = "player"; game.phase = "main1"; game.turnCounter = 3;
  game.player.controllerType = game.bot.controllerType = "ai";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = game.waitForAiPresentationStep = async () => {};
  game.ui.showConfirmPrompt = async () => false;
  t.after(() => game.dispose());
  return game;
}
const passes = () => ({ offers: 1, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false });

for (const change of ["negate", "fill_field", "change_candidates", "leave"] as const) {
  test(`Library pays at 2100 LP and keeps its activation mode: ${change}`, async t => {
    const game = setup(t), library = make(312), initial = make(306), replacement = make(307);
    game.player.fieldSpell = library; game.player.deck = [initial]; game.player.lp = 2100;
    assert.equal(game.effectEngine.canActivateFieldSpellEffectPreview(library, game.player).ok, true);
    let windows = 0;
    game.chainSystem.offerChainResponses = async () => {
      const link = game.chainSystem.chainStack.find(entry => entry.card === library);
      if (!link) return passes();
      windows++;
      assert.equal(game.player.lp, 100);
      assert.equal(link.effect?.id, "arcanist_grand_library_ignition");
      assert.equal(link.effect?.activationCaseId, "arcanist_grand_library_summon");
      assert.equal(game.chainSystem.getChainSummary()[0]?.activationCaseId, "arcanist_grand_library_summon");
      assert.equal(game.player.field.length, 0);
      if (change === "negate") link.effectNegated = true;
      if (change === "fill_field") placeFieldCards(game.player.field, make(306));
      if (change === "change_candidates") { game.player.deck = [replacement]; game.player.hand.push(initial); }
      if (change === "leave") await game.moveCard(library, game.player, "graveyard", { fromZone: "fieldSpell" });
      return passes();
    };
    const activationResult = await game.activateFieldSpellEffect(library);
    if (change === "fill_field" || change === "change_candidates") assert.equal(activationResult.success, true, activationResult.reason || "Library must resolve");
    assert.equal(windows, 1); assert.equal(game.player.lp, 100);
    if (change === "negate" || change === "leave") assert.equal(game.player.field.length, 0);
    else assert.ok(game.player.field.includes(change === "change_candidates" ? replacement : initial));
    assert.equal(game.player.field.length, change === "fill_field" ? 2 : change === "negate" || change === "leave" ? 0 : 1);
  });
}

test("Library search keeps its mode after the Arcanist leaves; choice and position are resolution decisions", async t => {
  const game = setup(t), library = make(312), arcanist = make(306), equip = make(301);
  game.player.fieldSpell = library; game.player.deck = [equip]; placeFieldCards(game.player.field, arcanist);
  game.chainSystem.offerChainResponses = async () => {
    const link = game.chainSystem.chainStack.find(entry => entry.card === library);
    if (!link) return passes();
    assert.equal(link.effect?.activationCaseId, "arcanist_grand_library_search_equip");
    assert.equal(game.player.lp, 8000);
    await game.moveCard(arcanist, game.player, "hand", { fromZone: "field" });
    return passes();
  };
  await game.activateFieldSpellEffect(library);
  assert.ok(game.player.hand.includes(equip)); assert.equal(game.player.lp, 8000);
});

test("Library preview requires a benefit and never pays or chooses", t => {
  const game = setup(t), library = make(312); game.player.fieldSpell = library;
  game.player.deck = []; let choices = 0;
  game.autoSelector.select = () => { choices++; return { ok: false, selections: {} }; };
  assert.equal(game.effectEngine.canActivateFieldSpellEffectPreview(library, game.player).ok, false);
  game.player.deck.push(make(306)); game.player.lp = 1999;
  assert.equal(game.effectEngine.canActivateFieldSpellEffectPreview(library, game.player).ok, false);
  assert.equal(game.player.lp, 1999); assert.equal(choices, 0);
});

for (const count of [0, 1, 2]) {
  for (const response of ["negate", "leave"] as const) {
    test(`Ink River ${count} counters with ${response}`, async t => {
      const game = setup(t), river = make(311), recovery = make(304);
      placeFieldCards(game.player.spellTrap, river); river.addCounter("ink", count); game.player.graveyard = [recovery];
      let windows = 0;
      game.chainSystem.offerChainResponses = async () => {
        const link = game.chainSystem.chainStack.find(entry => entry.card === river);
        if (!link) return passes();
        windows++; assert.equal(river.getCounter("ink"), 0);
        if (response === "negate") link.effectNegated = true;
        else await game.moveCard(river, game.player, "graveyard", { fromZone: "spellTrap" });
        return passes();
      };
      await game.tryActivateSpellTrapEffect(river);
      assert.equal(windows, count === 2 ? 1 : 0);
      assert.equal(river.getCounter("ink"), count === 2 ? 0 : count);
      assert.ok(game.player.graveyard.includes(recovery));
    });
  }
}

test("Meeting pays only once, in separate discard movements, without declaring the costs as targets", async t => {
  const game = setup(t), meeting = make(309), first = make(306), second = make(307), benefit = make(310);
  placeFieldCards(game.player.spellTrap, meeting); game.player.hand = [first, second]; game.player.deck = [benefit];
  const moved: Card[] = []; let targets = 0;
  game.on("card_to_grave", event => {
    if (event.card !== first && event.card !== second) return;
    assert.equal(event.contextLabel, "discard");
    if (event.card === first) assert.ok(game.player.hand.includes(second));
    moved.push(event.card === first ? first : second);
  });
  game.on("effect_targeted", () => { targets++; });
  game.chainSystem.offerChainResponses = async () => {
    assert.deepEqual(moved, [first, second]); assert.equal(targets, 0);
    return passes();
  };
  await game.tryActivateSpellTrapEffect(meeting);
  assert.deepEqual(moved, [first, second]); assert.ok(game.player.hand.includes(benefit));
});

test("Meeting validates the required discard destination before consuming resources or usage", async t => {
  const game = setup(t), meeting = make(309), first = make(306), second = make(307);
  placeFieldCards(game.player.spellTrap, meeting); game.player.hand = [first, second]; game.player.deck = [make(310)];
  placeFieldCards(game.bot.field, make(273, "bot"));
  const effect = required(meeting.effects?.find(entry => entry.timing === "ignition"));
  await game.tryActivateSpellTrapEffect(meeting);
  assert.deepEqual(game.player.hand, [first, second]); assert.equal(game.player.graveyard.length, 0);
  assert.equal(game.effectEngine.checkOncePerTurn(meeting, game.player, effect).ok, true);
});

test("Library human summon target and position use the candidates after responses", async t => {
  const game = setup(t), library = make(312), old = make(306), current = make(307);
  game.player.controllerType = "human"; game.player.fieldSpell = library; game.player.deck = [old];
  let responded = false;
  game.chainSystem.offerChainResponses = async () => {
    if (!game.chainSystem.chainStack.some(entry => entry.card === library)) return passes();
    assert.equal(game.player.lp, 6000); assert.equal(game.player.field.length, 0);
    game.player.deck = [current]; game.player.hand.push(old); responded = true; return passes();
  };
  const choosePosition = game.effectEngine.chooseSpecialSummonPosition.bind(game.effectEngine);
  game.effectEngine.chooseSpecialSummonPosition = async (card, player, options) => {
    assert.ok(responded); assert.equal(card, current); return choosePosition(card, player, { ...options, position: "defense" });
  };
  const action = Promise.resolve(game.activateFieldSpellEffect(library));
  await completeTestSelections(game, action);
  assert.ok(game.player.field.includes(current)); assert.equal(current.position, "defense");
});

for (const returns of [false, true]) {
  test(`Activation mode rejects a source that moves during the human choice (returns=${returns})`, async t => {
    const game = setup(t), library = make(312);
    game.player.controllerType = "human"; game.player.fieldSpell = library; game.player.deck = [make(306)];
    const action = Promise.resolve(game.activateFieldSpellEffect(library));
    for (let attempt = 0; !game.targetSelection && attempt < 50; attempt++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(game.targetSelection?.kind, "choice");
    await game.moveCard(library, game.player, "hand", { fromZone: "fieldSpell" });
    if (returns) await game.moveCard(library, game.player, "fieldSpell", { fromZone: "hand" });
    await completeTestSelections(game, action);
    assert.equal((await action).success, false);
    assert.equal(game.player.lp, 8000); assert.equal(game.player.field.length, 0);
    const effect = required(library.effects?.find(entry => entry.activationCases));
    assert.equal(game.effectEngine.checkOncePerTurn(library, game.player, effect).ok, true);
  });
}

test("Generic monster activation cases retain the parent identity and pay their costs", async t => {
  const game = setup(t);
  const monster = new Card({ ...cardDefinition(306), effects: [{ id: "fixture_modes", timing: "ignition",
    activationZones: ["field"], oncePerTurn: true, usagePolicy: "activate",
    activationCases: [{ id: "draw", activationCosts: [{ type: "pay_lp", amount: 400 }],
      actions: [{ type: "draw", amount: 1, player: "self" }] }],
  }] }, "player");
  placeFieldCards(game.player.field, monster); game.player.deck = [make(3), make(3)];
  game.chainSystem.offerChainResponses = async () => {
    const link = game.chainSystem.getLastChainLink();
    if (!link) return passes();
    assert.equal(game.player.lp, 7600); assert.equal(link.effect?.activationCaseId, "draw");
    assert.equal(link.effect?.id, "fixture_modes"); return passes();
  };
  const result = await game.tryActivateMonsterEffect(monster, null, "field", game.player);
  assert.equal(result.success, true, result.reason || String(result.code)); assert.equal(game.player.hand.length, 1); assert.equal(game.player.lp, 7600);
});

test("A human activation mode without a UI answer never uses the AI selector", async t => {
  const game = setup(t), library = make(312);
  game.player.controllerType = "human"; game.player.fieldSpell = library; game.player.deck = [make(306)];
  game.ui.showTargetSelection = () => ({ close() {} });
  game.autoSelector.select = () => { assert.fail("A human mode must not use AutoSelector"); };
  const action = Promise.resolve(game.activateFieldSpellEffect(library));
  for (let attempt = 0; !game.targetSelection && attempt < 50; attempt++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(game.targetSelection?.kind, "choice"); assert.equal(game.player.lp, 8000);
  game.cancelTargetSelection();
  assert.equal((await action).success, false); assert.equal(game.player.field.length, 0);
});

for (const copied of [false, true]) {
  test(`Tornado requires a controlled equipped bearer, including the Grimoire copy (${copied})`, async t => {
    const game = setup(t), bearer = make(306), other = make(306), grimoire = make(301), tornado = make(315), enemy = make(303, "bot");
    placeFieldCards(game.player.field, bearer, other); placeFieldCards(game.player.spellTrap, grimoire);
    placeFieldCards(game.bot.spellTrap, enemy); grimoire.equippedTo = bearer; bearer.equips.push(grimoire);
    if (copied) {
      const blueprint = required(game.effectEngine.buildEffectBlueprint(tornado, required(tornado.effects[0])));
      game.effectEngine.getBlueprintStorageState(grimoire, true).storedBlueprints.push(blueprint);
    } else game.player.hand.push(tornado);
    const preview = () => copied
      ? game.effectEngine.canActivateSpellTrapEffectPreview(grimoire, game.player, "spellTrap")
      : game.effectEngine.canActivateSpellFromHandPreview(tornado, game.player);
    assert.equal(preview().ok, true);
    await game.takeControl(bearer, game.bot);
    assert.equal(preview().ok, false);
    const result = copied ? await game.tryActivateSpellTrapEffect(grimoire) : await game.tryActivateSpell(tornado, 0);
    assert.equal(result.success, false); assert.ok(game.bot.spellTrap.includes(enemy));
    await game.takeControl(bearer, game.player);
    game.chainSystem.offerChainResponses = async () => {
      if (!game.chainSystem.chainStack.length) return passes();
      // The activation condition has already succeeded; changing the host
      // preserves this Equip source but no longer satisfies the condition.
      bearer.equips = []; grimoire.equippedTo = other; other.equips = [grimoire];
      other.archetype = "Other";
      return passes();
    };
    const resolved = copied ? await game.tryActivateSpellTrapEffect(grimoire) : await game.tryActivateSpell(tornado, 0);
    assert.equal(resolved.success, true, resolved.reason || "Tornado must resolve after its activation condition succeeds");
    assert.ok(game.bot.graveyard.includes(enemy));
  });
}
