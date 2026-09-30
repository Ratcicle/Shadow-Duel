import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { cardDefinition } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

function setup(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
  game.turn = "player";
  game.turnCounter = 5;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = game.bot.controllerType = "ai";
  game.ui.showChainResponseModal = async () => null;
  const mage = new Card(cardDefinition(118), game.player.id);
  const cathedral = new Card(cardDefinition(119), game.player.id);
  game.player.deck.push(new Card(cardDefinition(101), game.player.id));
  t.after(() => game.dispose());
  return { game, mage, cathedral };
}

test("LP damage queued during preparation excludes sources revealed afterward", async (t) => {
  const { game, mage, cathedral } = setup(t);
  mage.isFacedown = cathedral.isFacedown = true;
  placeFieldCards(game.player.field, mage);
  placeFieldCards(game.player.spellTrap, cathedral);
  game.chainSystem.isPreparingActivation = true;
  await game.inflictDamage(game.bot, 500);
  assert.equal(game.chainSystem.pendingTriggerOccurrences.length, 1);
  mage.isFacedown = cathedral.isFacedown = false;
  game.chainSystem.isPreparingActivation = false;

  await game.flushPendingTriggerOccurrences();
  assert.equal(game.player.hand.length, 0);
  assert.equal(cathedral.getCounter("judgment_marker"), 0);
});

test("LP cost queued during preparation excludes a source entering afterward", async (t) => {
  const { game, mage, cathedral } = setup(t);
  game.chainSystem.isPreparingActivation = true;
  await game.effectEngine.applyActions([{ type: "pay_lp", amount: 800 }], {
    player: game.bot,
    opponent: game.player,
    source: mage,
  }, {});
  assert.equal(game.chainSystem.pendingTriggerOccurrences.length, 1);
  placeFieldCards(game.player.field, mage);
  placeFieldCards(game.player.spellTrap, cathedral);
  game.chainSystem.isPreparingActivation = false;

  await game.flushPendingTriggerOccurrences();
  assert.equal(game.player.hand.length, 0);
  assert.equal(cathedral.getCounter("judgment_marker"), 0);
});

test("eligible LP sources still activate when a queued occurrence is flushed", async (t) => {
  const { game, mage, cathedral } = setup(t);
  placeFieldCards(game.player.field, mage);
  placeFieldCards(game.player.spellTrap, cathedral);
  game.chainSystem.isPreparingActivation = true;
  await game.inflictDamage(game.bot, 500);
  assert.equal(game.player.hand.length, 0);
  assert.equal(cathedral.getCounter("judgment_marker"), 0);
  game.chainSystem.isPreparingActivation = false;

  await game.flushPendingTriggerOccurrences();
  assert.equal(game.player.hand.length, 1);
  assert.equal(cathedral.getCounter("judgment_marker"), 1);
});

test("queued LP trigger rejects a source that leaves and returns before flush", async (t) => {
  const { game, mage, cathedral } = setup(t);
  placeFieldCards(game.player.field, mage);
  placeFieldCards(game.player.spellTrap, cathedral);
  game.chainSystem.isPreparingActivation = true;
  await game.inflictDamage(game.bot, 500);
  await game.moveCard(cathedral, game.player, "graveyard", { fromZone: "spellTrap" });
  await game.moveCard(cathedral, game.player, "spellTrap", { fromZone: "graveyard" });
  game.chainSystem.isPreparingActivation = false;

  await game.flushPendingTriggerOccurrences();
  assert.equal(game.player.hand.length, 1);
  assert.equal(cathedral.getCounter("judgment_marker"), 0);
});
