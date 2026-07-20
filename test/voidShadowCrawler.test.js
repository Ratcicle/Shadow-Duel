import assert from "node:assert/strict";
import test from "node:test";

import Card from "../src/core/Card.js";
import Game from "../src/core/Game.js";
import { cardDatabaseById } from "../src/data/cards.js";

const SHADOW_CRAWLER_ID = 226;
const VOID_COST_ID = 201;
const LEVEL_FIVE_TARGET_ID = 205;
const EFFECT_ID = "void_shadow_crawler_destroy_high_level";

function getEffect() {
  const card = cardDatabaseById.get(SHADOW_CRAWLER_ID);
  assert.ok(card, "Void Shadow Crawler must exist in the card database.");
  const effect = card.effects.find((entry) => entry.id === EFFECT_ID);
  assert.ok(effect, `Expected effect ${EFFECT_ID}.`);
  return effect;
}

function createGame(t) {
  const game = new Game({
    captureReplay: false,
    laboratoryMode: true,
    phaseDelayMs: 0,
    animationDelayMs: 0,
    chainResponseTimeoutMs: 1,
  });
  game.turn = game.player.id;
  game.turnCounter = 2;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.player.controllerType = "ai";
  game.bot.controllerType = "ai";
  t.after(() => game.dispose("void_shadow_crawler_test_complete"));
  return game;
}

function makeCard(definitionId, owner) {
  const card = new Card(cardDatabaseById.get(definitionId), owner.id);
  card.owner = owner.id;
  card.controller = owner.id;
  card.isFacedown = false;
  card.position = "attack";
  return card;
}

test("Void Shadow Crawler exige alvo de Nível 5 ou maior com a face para cima", (t) => {
  const game = createGame(t);
  const effect = getEffect();
  const crawler = makeCard(SHADOW_CRAWLER_ID, game.player);
  const cost = makeCard(VOID_COST_ID, game.player);
  const faceupTarget = makeCard(LEVEL_FIVE_TARGET_ID, game.bot);
  const facedownTarget = makeCard(LEVEL_FIVE_TARGET_ID, game.bot);
  facedownTarget.isFacedown = true;
  facedownTarget.position = "defense";
  game.player.field.push(crawler, cost);
  game.bot.field.push(faceupTarget, facedownTarget);

  const preview = game.effectEngine.resolveTargets(
    effect.targets,
    {
      source: crawler,
      player: game.player,
      opponent: game.bot,
      activationZone: "field",
      activationContext: { preview: true },
    },
    null,
  );
  const targetRequirement = preview.selectionContract.requirements.find(
    (requirement) =>
      requirement.id === "void_shadow_crawler_destroy_target",
  );

  assert.equal(effect.oncePerTurnScope, "card");
  assert.equal(
    effect.targets.find(
      (target) => target.id === "void_shadow_crawler_destroy_target",
    ).requireFaceup,
    true,
  );
  assert.deepEqual(
    targetRequirement.candidates.map((candidate) => candidate.cardRef),
    [faceupTarget],
  );
});

test("cada cópia de Void Shadow Crawler pode usar seu efeito uma vez no turno", async (t) => {
  const game = createGame(t);
  const firstCrawler = makeCard(SHADOW_CRAWLER_ID, game.player);
  const secondCrawler = makeCard(SHADOW_CRAWLER_ID, game.player);
  const firstCost = makeCard(VOID_COST_ID, game.player);
  const secondCost = makeCard(VOID_COST_ID, game.player);
  const firstTarget = makeCard(LEVEL_FIVE_TARGET_ID, game.bot);
  const secondTarget = makeCard(LEVEL_FIVE_TARGET_ID, game.bot);
  firstTarget.effects = [];
  secondTarget.effects = [];
  game.player.field.push(
    firstCrawler,
    secondCrawler,
    firstCost,
    secondCost,
  );
  game.bot.field.push(firstTarget, secondTarget);

  const activate = (crawler, cost, target) =>
    game.tryActivateMonsterEffect(
      crawler,
      {
        void_shadow_crawler_destroy_target: [target],
        void_shadow_crawler_cost: [cost],
      },
      "field",
      game.player,
      { effectId: EFFECT_ID },
    );

  const firstResult = await activate(firstCrawler, firstCost, firstTarget);
  const secondResult = await activate(secondCrawler, secondCost, secondTarget);

  assert.equal(firstResult.success, true);
  assert.equal(secondResult.success, true);
  assert.equal(game.player.graveyard.includes(firstCost), true);
  assert.equal(game.player.graveyard.includes(secondCost), true);
  assert.equal(game.bot.graveyard.includes(firstTarget), true);
  assert.equal(game.bot.graveyard.includes(secondTarget), true);
});
