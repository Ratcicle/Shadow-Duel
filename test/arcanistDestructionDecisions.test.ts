import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { CardAction } from "../src/core/contracts/actions.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

function setup(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, disableChains: true });
  t.after(() => game.dispose());
  game.disablePresentationDelays = true;
  game.turn = "player";
  game.turnCounter = 4;
  game.phase = "main1";
  game.player.controllerType = game.bot.controllerType = "ai";
  const make = (id: number, owner = game.player) => {
    const card = new Card(cardDefinition(id), owner.id);
    card.isFacedown = false;
    card.position = "attack";
    return card;
  };
  const source = make(310);
  const context = { source, player: game.player, opponent: game.bot };
  const register = (target: Card) => game.effectEngine.applyActions([{
    type: "register_replacement_effect", targetRef: "target", uses: 1,
    duration: "end_of_next_turn", replacementEffect: {
      type: "destruction", reason: "any", targetOwner: "self", targetZones: ["field"], auto: true,
    },
  }], context, { target: [target] });
  const destroy = async (target: Card, cause: "battle" | "effect") => {
    const result = await game.destroyCard(target, { cause });
    assert.ok("destroyed" in result, JSON.stringify(result));
    return result.destroyed;
  };
  return { game, make, source, context, register, destroy };
}

test("Crimson Explosion captures each current ATK and controller immediately before its destruction", async t => {
  const { game, make, context } = setup(t);
  const stolen = make(302, game.bot), second = make(302, game.bot);
  placeFieldCards(game.bot.field, stolen, second);
  assert.equal((await game.takeControl(stolen, game.player)).success, true);
  stolen.atk = 2500;
  stolen.tempAtkBoost = 1000;
  second.atk = 3000;
  second.tempAtkBoost = 1500;
  const movements: string[] = [];
  game.on("card_moved", event => {
    if (event.card === stolen) {
      movements.push("first");
      second.atk = 2200;
      second.tempAtkBoost = 700;
    } else if (event.card === second) movements.push("second");
  });
  const before = [game.player.lp, game.bot.lp];
  const actions: CardAction[] = [{ type: "destroy_and_damage_by_target_atk", entries: [
    { targetRef: "first", damagePlayer: "owner", multiplier: 0.5 },
    { targetRef: "second", damagePlayer: "owner", multiplier: 0.5 },
  ] }];
  await game.effectEngine.applyActions(actions, context, { first: [stolen], second: [second] });
  assert.deepEqual(movements, ["first", "second"]);
  assert.equal(stolen.owner, "bot", "the stolen card returns to its original owner's GY");
  assert.deepEqual([game.player.lp, game.bot.lp], [required(before[0]) - 1250, required(before[1]) - 1100]);
});

test("Crimson Explosion only applies damage for monsters actually destroyed", async t => {
  const { game, make, context } = setup(t);
  const protectedCard = make(302), destroyed = make(302, game.bot);
  protectedCard.protectionEffects = [{ type: "effect_destruction", duration: "while_faceup" }];
  destroyed.atk = 2400;
  destroyed.tempAtkBoost = 900;
  placeFieldCards(game.player.field, protectedCard);
  placeFieldCards(game.bot.field, destroyed);
  const before = [game.player.lp, game.bot.lp];
  await game.effectEngine.applyActions([{ type: "destroy_and_damage_by_target_atk", entries: [
    { targetRef: "targets", damagePlayer: "owner", multiplier: 0.5 },
  ] }], context, { targets: [protectedCard, destroyed] });
  assert.ok(game.player.field.includes(protectedCard));
  assert.ok(game.bot.graveyard.includes(destroyed));
  assert.deepEqual([game.player.lp, game.bot.lp], [required(before[0]), required(before[1]) - 1200]);
});

test("each Meeting of the Arcanists copy has its own automatic prevention each turn", async t => {
  const { game, make, destroy } = setup(t);
  game.player.controllerType = "human";
  game.ui.showConfirmPrompt = async () => assert.fail("Automatic prevention must not ask for confirmation.");
  const first = make(309), second = make(309), target = make(301);
  placeFieldCards(game.player.spellTrap, first, second, target);
  assert.equal(await destroy(target, "effect"), false);
  assert.equal(await destroy(target, "effect"), false);
  assert.equal(await destroy(target, "effect"), true);
  game.turnCounter += 1;
  assert.equal(await destroy(first, "effect"), false);
  assert.equal(await destroy(first, "effect"), false);
  assert.equal(await destroy(first, "effect"), true);
});

for (const firstCause of ["battle", "effect"] as const) {
  test(`Ice Barrier shares its one prevention across both destruction causes (${firstCause} first)`, async t => {
    const { game, make, context, destroy } = setup(t);
    const target = make(302), other = make(302);
    placeFieldCards(game.player.field, target, other);
    const actions = required(cardDefinition(310).effects?.[0]).actions;
    assert.ok(actions);
    await game.effectEngine.applyActions(actions, context, { arcanist_ice_barrier_target: [target] });
    assert.equal(await destroy(other, firstCause), true);
    assert.equal(await destroy(target, firstCause), false);
    assert.equal(await destroy(target, firstCause === "battle" ? "effect" : "battle"), true);
    assert.equal(game.player.hand.length, 0);
  });
}

test("equipped Ice Barrier draws two but still protects only its selected monster once", async t => {
  const { game, make, context, destroy } = setup(t);
  const target = make(302), other = make(302), equip = make(301);
  placeFieldCards(game.player.field, target, other);
  placeFieldCards(game.player.spellTrap, equip);
  target.equips.push(equip);
  equip.equippedTo = target;
  game.player.deck.push(make(302), make(302), make(302));
  const actions = required(cardDefinition(310).effects?.[0]).actions;
  assert.ok(actions);
  await game.effectEngine.applyActions(actions, context, { arcanist_ice_barrier_target: [target] });
  assert.equal(game.player.hand.length, 2);
  assert.equal(await destroy(other, "effect"), true);
  assert.equal(await destroy(target, "effect"), false);
  assert.equal(await destroy(target, "battle"), true);
});

for (const turn of [5, 6]) {
  test(`targeted temporary replacement expires after the next turn (${turn})`, async t => {
    const { game, make, register, destroy } = setup(t);
    const target = make(302);
    placeFieldCards(game.player.field, target);
    await register(target);
    game.turnCounter = turn;
    assert.equal(await destroy(target, "effect"), turn > 5);
  });
}

test("a targeted temporary replacement cannot follow its card out of and back onto the field", async t => {
  const { game, make, context, register, destroy } = setup(t);
  const target = make(302);
  placeFieldCards(game.player.field, target);
  await register(target);
  await game.moveCard(target, game.player, "hand", { fromZone: "field" });
  await game.effectEngine.applyActions([{
    type: "special_summon_from_zone", zone: "hand", targetRef: "target", position: "attack",
  }], context, { target: [target] });
  assert.ok(game.player.field.includes(target));
  assert.equal(await destroy(target, "effect"), true);
});

test("Ice Barrier remains on the same field presence after its controller changes", async t => {
  const { game, make, context, destroy } = setup(t);
  const target = make(302);
  placeFieldCards(game.player.field, target);
  const actions = required(cardDefinition(310).effects?.[0]).actions;
  assert.ok(actions);
  await game.effectEngine.applyActions(actions, context, { arcanist_ice_barrier_target: [target] });
  assert.equal((await game.takeControl(target, game.bot)).success, true);
  assert.equal(await destroy(target, "effect"), false);
  assert.equal(await destroy(target, "effect"), true);
});
