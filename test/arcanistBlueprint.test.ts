import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { hashCanonicalGameState } from "../src/core/game/replay/canonical.js";

function setup(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, randomSeed: 42 });
  game.turn = "player";
  game.phase = "main1";
  game.turnCounter = 2;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.ui.showConfirmPrompt = async () => false;
  game.player.controllerType = "human";
  game.bot.controllerType = "ai";
  game.player.deck = Array.from({ length: 10 }, () => make(3));
  t.after(() => game.dispose());
  return game;
}

const make = (id: number, owner = "player") => new Card(cardDefinition(id), owner);

async function equipAndStore(game: ReturnType<typeof setup>, copiedId: number) {
  const host = make(306), grimoire = make(301), original = make(copiedId);
  placeFieldCards(game.player.field, host);
  game.player.hand.push(grimoire);
  assert.equal((await game.tryActivateSpell(grimoire, 0, { grimoire_equip_target: [host] })).success, true);
  const blueprint = required(game.effectEngine.buildEffectBlueprint(original, required(original.effects?.[0])));
  game.effectEngine.getBlueprintStorageState(grimoire, true).storedBlueprints.push(blueprint);
  return { host, grimoire, original };
}

for (const controller of ["human", "ai"] as const) {
  test(`Grimoire pays copied cost and declares its target before responses (${controller})`, async t => {
    const game = setup(t);
    const { grimoire, host } = await equipAndStore(game, 316);
    // A second generic Equip fixture isolates copied payment from source permanence.
    const payment = new Card({ ...cardDefinition(315), subtype: "equip", effects: [] }, "player");
    payment.equippedTo = host;
    host.equips.push(payment);
    placeFieldCards(game.player.spellTrap, payment);
    game.player.controllerType = controller;
    const enemy = make(306, "bot");
    placeFieldCards(game.bot.field, enemy);
    const trace: string[] = [];
    game.on("effect_targeted", payload => { if (payload.target === enemy) trace.push("target"); });
    game.on("card_to_grave", payload => { if (payload.card === payment) trace.push("cost"); });
    let responses = 0;
    game.chainSystem.offerChainResponses = async () => {
      if (!game.chainSystem.chainStack.length) return { offers: 0, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false };
      responses++;
      assert.ok(game.player.graveyard.includes(payment));
      assert.ok(trace.includes("target"));
      assert.ok(game.bot.field.includes(enemy));
      trace.push("responses");
      return { offers: 1, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false };
    };
    const action = game.tryActivateSpellTrapEffect(grimoire, { seismic_impact_equip_cost: [payment] });
    await completeTestSelections(game, action);
    const result = await action;
    assert.equal(result.success, true, result.reason || JSON.stringify(trace));
    assert.equal(responses, 1);
    assert.equal(trace.filter(entry => entry === "cost").length, 1);
    assert.ok(trace.indexOf("cost") < trace.indexOf("target"));
    assert.ok(game.bot.banished.includes(enemy));
    assert.ok(game.player.spellTrap.includes(grimoire));
    assert.equal(game.chainSystem.pendingChainSelection, null);
    assert.equal(game.canStartAction({ actor: game.player, kind: "spell" }).ok, true);
  });
}

test("Grimoire does not replace an activation target that leaves and returns", async t => {
  const game = setup(t);
  const { grimoire, host } = await equipAndStore(game, 304);
  game.chainSystem.offerChainResponses = async () => {
    await game.moveCard(host, game.player, "hand", { fromZone: "field", awaitEvents: true });
    await game.moveCard(host, game.player, "field", { fromZone: "hand", summonOrigin: "effect_resolution", summonMethodOverride: "special" });
    assert.ok(game.player.field.includes(host));
    return { offers: 1, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false };
  };
  const action = game.tryActivateSpellTrapEffect(grimoire, { lightning_magic_lance_target: [host] });
  await completeTestSelections(game, action);
  assert.equal(host.atk, cardDefinition(306).atk);
  assert.equal(game.chainSystem.pendingChainSelection, null);
});

test("Grimoire uses only its own OPT and each replacement copy has its own use", async t => {
  const game = setup(t);
  const { grimoire, host, original } = await equipAndStore(game, 310);
  game.effectEngine.commitEffectUsage(original, game.player, required(original.effects?.[0]));
  assert.equal(game.effectEngine.checkOncePerTurn(original, game.player, required(original.effects?.[0])).ok, false);
  const first = game.tryActivateSpellTrapEffect(grimoire, { arcanist_ice_barrier_target: [host] });
  await completeTestSelections(game, first);
  assert.equal((await first).success, true);
  assert.equal((await game.tryActivateSpellTrapEffect(grimoire)).success, false);
  await game.moveCard(grimoire, game.player, "graveyard", { fromZone: "spellTrap", awaitEvents: true });
  const second = make(301);
  game.player.hand.push(second);
  await game.tryActivateSpell(second, game.player.hand.indexOf(second), { grimoire_equip_target: [host] });
  game.effectEngine.getBlueprintStorageState(second, true).storedBlueprints.push(
    required(game.effectEngine.buildEffectBlueprint(original, required(original.effects?.[0]))),
  );
  const secondAction = game.tryActivateSpellTrapEffect(second, { arcanist_ice_barrier_target: [host] });
  await completeTestSelections(game, secondAction);
  assert.equal((await secondAction).success, true);
});

test("Grimoire preview rejects unavailable copied targets without consuming resources", async t => {
  const game = setup(t);
  const { grimoire } = await equipAndStore(game, 316);
  const before = hashCanonicalGameState(game);
  assert.equal(game.effectEngine.canActivateSpellTrapEffectPreview(grimoire, game.player).ok, false);
  assert.equal((await game.tryActivateSpellTrapEffect(grimoire)).success, false);
  assert.equal(hashCanonicalGameState(game), before);
  assert.ok(game.player.spellTrap.includes(grimoire));
});

test("Grimoire storage is part of canonical state and respects source negation", async t => {
  const game = setup(t);
  const { grimoire, host } = await equipAndStore(game, 304);
  const before = hashCanonicalGameState(game);
  game.effectEngine.clearBlueprintStorage(grimoire);
  assert.notEqual(hashCanonicalGameState(game), before);
  const lance = make(304);
  game.player.hand.push(lance);
  grimoire.effectsNegated = true;
  let prompts = 0;
  game.ui.showConfirmPrompt = async () => { prompts++; return true; };
  await game.tryActivateSpell(lance, game.player.hand.indexOf(lance), { lightning_magic_lance_target: [host] });
  assert.equal(prompts, 0);
  assert.equal(game.effectEngine.getStoredBlueprints(grimoire).length, 0);
});

test("Grimoire paying itself retains the cost and usage, but its copied effect does not resolve", async t => {
  const game = setup(t);
  const { grimoire } = await equipAndStore(game, 316);
  const enemy = make(306, "bot");
  placeFieldCards(game.bot.field, enemy);
  const action = game.tryActivateSpellTrapEffect(grimoire, {
    seismic_impact_equip_cost: [grimoire], seismic_impact_target: [enemy],
  });
  await completeTestSelections(game, action);
  assert.equal((await action).success, false);
  assert.ok(game.player.graveyard.includes(grimoire));
  assert.ok(game.bot.field.includes(enemy));
  assert.equal(game.effectEngine.checkOncePerTurn(grimoire, game.player, required(grimoire.effects?.find(effect => effect.timing === "ignition"))).ok, false);
  assert.equal(game.chainSystem.pendingChainSelection, null);
});

test("legacy blueprint execution cannot bypass copied payment or declare targets during resolution", async t => {
  const game = setup(t);
  const { grimoire } = await equipAndStore(game, 316);
  const enemy = make(306, "bot");
  placeFieldCards(game.bot.field, enemy);
  const result = await game.effectEngine.executeEffectBlueprint(
    required(game.effectEngine.getStoredBlueprints(grimoire)[0]),
    { source: grimoire, player: game.player, opponent: game.bot },
    { seismic_impact_target: [enemy] },
  );
  assert.equal(result.success, false);
  assert.equal(result.needsSelection, false);
  assert.ok(game.player.spellTrap.includes(grimoire));
  assert.ok(game.bot.field.includes(enemy));
});

test("Seismic Impact resolves after its only qualifying Equip has been paid as cost", async t => {
  const game = setup(t);
  const { grimoire } = await equipAndStore(game, 304);
  const seismic = make(316), enemy = make(306, "bot");
  game.player.hand.push(seismic);
  placeFieldCards(game.bot.field, enemy);
  const action = game.tryActivateSpell(seismic, game.player.hand.indexOf(seismic), {
    seismic_impact_equip_cost: [grimoire], seismic_impact_target: [enemy],
  });
  await completeTestSelections(game, action);
  assert.equal((await action).success, true);
  assert.ok(game.player.graveyard.includes(grimoire));
  assert.ok(game.player.graveyard.includes(seismic));
  assert.ok(game.bot.banished.includes(enemy));
});

test("Ice Barrier copied by Grimoire preserves protection previously granted to another monster", async t => {
  const game = setup(t);
  const { grimoire, host } = await equipAndStore(game, 310);
  const other = make(306), barrier = make(310);
  placeFieldCards(game.player.field, other);
  game.player.hand.push(barrier);
  const originalAction = game.tryActivateSpell(barrier, game.player.hand.indexOf(barrier), {
    arcanist_ice_barrier_target: [other],
  });
  await completeTestSelections(game, originalAction);
  const originalResult = await originalAction;
  assert.equal(originalResult.success, true, originalResult.reason || "Barrier should resolve without an Equip.");
  const copyAction = game.tryActivateSpellTrapEffect(grimoire, { arcanist_ice_barrier_target: [host] });
  await completeTestSelections(game, copyAction);
  assert.equal((await copyAction).success, true);
  const firstDestruction = await game.destroyCard(other, { cause: "effect" });
  const secondDestruction = await game.destroyCard(host, { cause: "battle" });
  assert.ok("destroyed" in firstDestruction);
  assert.ok("destroyed" in secondDestruction);
  assert.equal(firstDestruction.destroyed, false);
  assert.equal(secondDestruction.destroyed, false);
});
