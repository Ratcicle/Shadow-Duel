import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import test from "node:test";
import type { GamePlayer } from "../src/core/contracts/player.js";
import { required } from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";

import Card from "../src/core/Card.js";
import { cardDatabaseById } from "./helpers/fixtures.js";

const SHADOW_CRAWLER_ID = 226;
const VOID_COST_ID = 201;
const LEVEL_FIVE_TARGET_ID = 205;
const EFFECT_ID = "void_shadow_crawler_destroy_high_level";

function getEffect() {
  const card = cardDatabaseById.get(SHADOW_CRAWLER_ID);
  assert.ok(card, "Void Shadow Crawler must exist in the card database.");
  const effect = required(card.effects).find((entry) => entry.id === EFFECT_ID);
  assert.ok(effect, `Expected effect ${EFFECT_ID}.`);
  return effect;
}

function createGame(t: TestContext) {
  const game = createRuntimeGame({
    captureReplay: false,
    laboratoryMode: true,

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

function makeCard(definitionId: number, owner: GamePlayer) {
  const card = new Card(required(cardDatabaseById.get(definitionId)), owner.id);
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
    required(effect.targets),
    {
      source: crawler,
      player: game.player,
      opponent: game.bot,
      activationZone: "field",
      activationContext: { preview: true },
    },
    null,
  );
  assert.ok(preview.needsSelection);
  const targetRequirement = required(
    preview.selectionContract.requirements,
  ).find(
    (requirement) => requirement.id === "void_shadow_crawler_destroy_target",
  );

  assert.equal(effect.oncePerTurnScope, "card");
  assert.equal(
    required(
      required(effect.targets).find(
        (target) => target.id === "void_shadow_crawler_destroy_target",
      ),
    ).requireFaceup,
    true,
  );
  assert.deepEqual(
    required(required(targetRequirement).candidates).map(
      (candidate) => candidate.cardRef,
    ),
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
  game.player.field.push(firstCrawler, secondCrawler, firstCost, secondCost);
  game.bot.field.push(firstTarget, secondTarget);

  const activate = (crawler: Card, cost: Card, target: Card) =>
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

  assert.ok(firstResult.success === true);
  assert.ok(secondResult.success === true);
  assert.equal(game.player.graveyard.includes(firstCost), true);
  assert.equal(game.player.graveyard.includes(secondCost), true);
  assert.equal(game.bot.graveyard.includes(firstTarget), true);
  assert.equal(game.bot.graveyard.includes(secondTarget), true);
});
