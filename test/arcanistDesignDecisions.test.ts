import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { cleanupTempBoosts } from "../src/core/game/turn/cleanup.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

function setup(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.turn = "player";
  game.phase = "main1";
  game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.player.controllerType = game.bot.controllerType = "ai";
  const make = (id: number, owner = game.player) => new Card(cardDefinition(id), owner.id);
  return { game, owner: game.player, opponent: game.bot, make };
}

test("Albus summons its own hand presence without activating an effect or selecting a cost", async t => {
  const { game, owner, make } = setup(t);
  const albus = make(307), second = make(307), ally = make(306);
  owner.hand.push(albus, second);
  placeFieldCards(owner.field, ally);
  owner.controllerType = "human";
  const chain = t.mock.method(game.chainSystem, "addToChain");
  let activations = 0;
  game.on("effect_activated", () => { activations++; });
  assert.equal(game.canSummonFromHandByProcedure(albus, owner).ok, true);
  const result = await game.performHandSummonProcedure(albus, owner, { position: "defense" });
  assert.equal(result.success, true);
  assert.equal(game.targetSelection, null);
  assert.equal(chain.mock.callCount(), 0);
  assert.equal(activations, 0);
  assert.ok(owner.field.includes(albus));
  assert.ok(owner.hand.includes(second));
  assert.equal(albus.position, "defense");
  assert.equal(game.lastSummonTransaction?.summonOrigin, "procedure");
  assert.equal(game.canSummonFromHandByProcedure(second, owner).ok, false);
});

test("Albus procedure requires a face-up controlled Arcanist and a free field slot", t => {
  const { game, owner, make } = setup(t);
  const albus = make(307), ally = make(306);
  owner.hand.push(albus);
  assert.equal(game.canSummonFromHandByProcedure(albus, owner).ok, false);
  placeFieldCards(owner.field, ally);
  ally.isFacedown = true;
  assert.equal(game.canSummonFromHandByProcedure(albus, owner).ok, false);
  ally.isFacedown = false;
  assert.equal(game.canSummonFromHandByProcedure(albus, owner).ok, true);
  placeFieldCards(owner.field, make(306), make(306), make(306), make(306));
  assert.equal(game.canSummonFromHandByProcedure(albus, owner).ok, false);
});

for (const changed of ["source_presence", "condition"] as const) {
  test(`Albus revalidates ${changed} after position selection`, async t => {
    const { game, owner, make } = setup(t);
    const albus = make(307), ally = make(306);
    owner.hand.push(albus);
    placeFieldCards(owner.field, ally);
    t.mock.method(game.effectEngine, "chooseSpecialSummonPosition", async () => {
      if (changed === "condition") ally.isFacedown = true;
      else {
        await game.moveCard(albus, owner, "graveyard", { fromZone: "hand" });
        await game.moveCard(albus, owner, "hand", { fromZone: "graveyard" });
      }
      return "attack" as const;
    });
    const result = await game.performHandSummonProcedure(albus, owner);
    assert.equal(result.success, false);
    assert.ok(owner.hand.includes(albus));
    assert.equal(game.canUseOncePerTurn(albus, owner, required(albus.handSummonProcedure)).ok, true);
  });
}

test("Elementalist has immediate continuous protection that suspends under negation", async t => {
  const { game, owner, opponent, make } = setup(t);
  const source = make(313), destruction = make(303, opponent);
  placeFieldCards(owner.field, source);
  const options = { cause: "effect", sourceCard: destruction, sourcePlayer: opponent } as const;
  const protectedResult = await game.destroyCard(source, options);
  assert.ok("destroyed" in protectedResult);
  assert.equal(protectedResult.destroyed, false);
  source.effectsNegated = true;
  const negatedResult = await game.destroyCard(source, options);
  assert.ok("destroyed" in negatedResult);
  assert.equal(negatedResult.destroyed, true);
});

test("Elementalist destruction is an equipped ignition with independent per-copy limits", async t => {
  const { game, owner, opponent, make } = setup(t);
  const first = make(313), second = make(313), target = make(306, opponent), other = make(306, opponent);
  placeFieldCards(owner.field, first, second);
  placeFieldCards(opponent.field, target, other);
  const effect = required(first.effects.find(entry => entry.id === "elementalist_master_destroy"));
  assert.equal(effect.timing, "ignition");
  assert.equal(effect.oncePerTurnScope, "card");
  assert.equal(game.effectEngine.evaluateConditions(effect.conditions, { source: first, player: owner, opponent }).ok, false);
  const equip = make(301);
  placeFieldCards(owner.spellTrap, equip);
  equip.equippedTo = first;
  first.equips = [equip];
  const result = await game.tryActivateMonsterEffect(first, { elementalist_destroy_target: [target] }, "field", owner,
    { effectId: effect.id });
  assert.equal(result.success, true);
  assert.ok(opponent.graveyard.includes(target));
  assert.equal(game.canUseOncePerTurn(second, owner, effect).ok, true);
  assert.equal(game.canUseOncePerTurn(first, owner, effect).ok, false);
});

test("Apprentice aura updates when its equip is removed and applies to new allies", t => {
  const { game, owner, make } = setup(t);
  const apprentice = make(302), ally = make(306), equip = make(301);
  placeFieldCards(owner.field, apprentice, ally);
  placeFieldCards(owner.spellTrap, equip);
  equip.equippedTo = apprentice;
  apprentice.equips = [equip];
  game.effectEngine.updatePassiveBuffs();
  assert.equal(ally.atk, ally.baseAtk + 300);
  const newcomer = make(307);
  placeFieldCards(owner.field, newcomer);
  game.effectEngine.updatePassiveBuffs();
  assert.equal(newcomer.atk, newcomer.baseAtk + 300);
  apprentice.equips = [];
  equip.equippedTo = null;
  game.effectEngine.updatePassiveBuffs();
  assert.equal(ally.atk, ally.baseAtk);
  assert.equal(newcomer.atk, newcomer.baseAtk);
});

test("Lightning Lance attack boost expires at turn end", async t => {
  const { game, owner, make } = setup(t);
  const target = make(306), lance = make(304);
  placeFieldCards(owner.field, target);
  owner.hand.push(lance);
  assert.equal((await game.tryActivateSpell(lance, 0, { lightning_magic_lance_target: [target] }, { owner })).success, true);
  assert.equal(target.atk, target.baseAtk + 500);
  cleanupTempBoosts(owner);
  assert.equal(target.atk, target.baseAtk);
});

test("Azrath debuffs only monsters present for each Arcanist Spell activation", async t => {
  const { game, owner, opponent, make } = setup(t);
  const azrath = make(314), ally = make(306), first = make(306, opponent), later = make(306, opponent);
  placeFieldCards(owner.field, azrath, ally);
  placeFieldCards(opponent.field, first);
  const activate = async () => {
    const lance = make(304);
    owner.hand.push(lance);
    assert.equal((await game.tryActivateSpell(lance, owner.hand.indexOf(lance), { lightning_magic_lance_target: [ally] }, { owner })).success, true);
  };
  await activate();
  assert.deepEqual([first.atk, first.def], [first.baseAtk - 100, first.baseDef - 100]);
  placeFieldCards(opponent.field, later);
  game.effectEngine.updatePassiveBuffs();
  assert.deepEqual([later.atk, later.def], [later.baseAtk, later.baseDef]);
  cleanupTempBoosts(opponent);
  assert.deepEqual([first.atk, first.def], [first.baseAtk, first.baseDef]);
});

