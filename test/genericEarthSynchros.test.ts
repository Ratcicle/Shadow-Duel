import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import type { TestContext } from "node:test";
import test from "node:test";
import Player from "../src/core/Player.js";
import type { CardConstructorData } from "../src/core/contracts/cards.js";
import type { FixtureCard } from "./helpers/fixtures.js";
import { chainSelections, required } from "./helpers/fixtures.js";
import {
  runtimeCard as completeCard,
  createRuntimeGame,
} from "./helpers/game.js";

import Card from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import { evaluateSimulatedConditions } from "../src/core/ai/common/simulatedConditions.js";
import { cardDatabaseById } from "./helpers/fixtures.js";

const RED_FURY_HORROR_ID = 30;
const IRON_SMASHER_ID = 31;

function getCard(id: number) {
  const card = cardDatabaseById.get(id);
  assert.ok(card, `Expected card ${id} in the database.`);
  return card;
}

function getEffect(card: FixtureCard, id: string) {
  const effect = required(card.effects).find((entry) => entry.id === id);
  assert.ok(effect, `Expected effect ${id}.`);
  return effect;
}

function makeRuntimeCard(definition: CardConstructorData, ownerId: string) {
  const card = new Card(definition, ownerId);
  card.owner = ownerId;
  card.controller = ownerId;
  return card;
}

function createGame(t: TestContext) {
  const game = createRuntimeGame({
    captureReplay: false,
    disableChains: true,
    laboratoryMode: true,
  });
  game.player.controllerType = "ai";
  game.bot.controllerType = "ai";
  t.after(() => game.dispose("generic_earth_synchros_test_complete"));
  return game;
}

function material(
  instanceId: number | string,
  level: number,
  isTuner: boolean,
) {
  return completeCard({
    instanceId,
    cardKind: "monster",
    level,
    isTuner,
    isFacedown: false,
  });
}

test("Red Fury Horror e Iron Smasher declaram dados, arte, localização e materiais canônicos", (t) => {
  const redFury = getCard(RED_FURY_HORROR_ID);
  const ironSmasher = getCard(IRON_SMASHER_ID);
  const validation = validateCardDatabase();
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 0);

  assert.deepEqual(
    {
      name: redFury.name,
      monsterType: redFury.monsterType,
      level: redFury.level,
      type: redFury.type,
      attribute: redFury.attribute,
      atk: redFury.atk,
      def: redFury.def,
      synchro: redFury.synchro,
    },
    {
      name: "Red Fury Horror",
      monsterType: "synchro",
      level: 8,
      type: "Fiend",
      attribute: "Earth",
      atk: 2700,
      def: 1800,
      synchro: { tunerCount: 1, nonTunerMin: 1 },
    },
  );
  assert.deepEqual(
    {
      name: ironSmasher.name,
      monsterType: ironSmasher.monsterType,
      level: ironSmasher.level,
      type: ironSmasher.type,
      attribute: ironSmasher.attribute,
      atk: ironSmasher.atk,
      def: ironSmasher.def,
      synchro: ironSmasher.synchro,
    },
    {
      name: "Iron Smasher",
      monsterType: "synchro",
      level: 6,
      type: "Warrior",
      attribute: "Earth",
      atk: 2400,
      def: 2400,
      synchro: { tunerCount: 1, nonTunerMin: 1 },
    },
  );

  assert.equal(
    existsSync(
      new URL("../public/assets/Red Fury Horror.png", import.meta.url),
    ),
    true,
  );
  assert.equal(
    existsSync(new URL("../public/assets/Iron Smasher.png", import.meta.url)),
    true,
  );

  const locale = JSON.parse(
    readFileSync(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(locale.cards[RED_FURY_HORROR_ID].name, "Terror Fúria Vermelha");
  assert.equal(locale.cards[IRON_SMASHER_ID].name, "Esmagador de Ferro");

  const redMaterials = [
    material("red-tuner", 3, true),
    material("red-non", 5, false),
  ];
  const ironMaterials = [
    material("iron-tuner", 2, true),
    material("iron-non", 4, false),
  ];
  const materialGame = createRuntimeGame({
    disableChains: true,
    captureReplay: false,
    laboratoryMode: true,
  });
  t.after(() => materialGame.dispose());
  assert.deepEqual(
    materialGame.getSynchroMaterialCombos(
      Object.assign(new Player("player", "Material fixture"), {
        field: redMaterials,
      }),
      completeCard({ ...redFury, instanceId: "red-extra" }),
    ),
    [redMaterials],
  );
  assert.deepEqual(
    materialGame.getSynchroMaterialCombos(
      Object.assign(new Player("player", "Material fixture"), {
        field: ironMaterials,
      }),
      completeCard({ ...ironSmasher, instanceId: "iron-extra" }),
    ),
    [ironMaterials],
  );
});

test("Red Fury Horror dispara para todos os métodos de Invocação-Especial do oponente", async (t) => {
  const game = createGame(t);
  const redFury = makeRuntimeCard(getCard(RED_FURY_HORROR_ID), game.player.id);
  const graveTarget = makeRuntimeCard(
    { id: 9901, name: "GY monster", cardKind: "monster", atk: 1000, def: 1000 },
    game.bot.id,
  );
  const summoned = makeRuntimeCard(
    {
      id: 9902,
      name: "Summoned monster",
      cardKind: "monster",
      atk: 1000,
      def: 1000,
    },
    game.bot.id,
  );
  game.player.field.push(redFury);
  game.bot.graveyard.push(graveTarget);
  game.bot.field.push(summoned);

  for (const method of ["special", "fusion", "synchro", "ascension"] as const) {
    const collected = await game.effectEngine.collectAfterSummonTriggers({
      card: summoned,
      player: game.bot,
      method,
      fromZone: method === "special" ? "hand" : "extraDeck",
    });
    assert.equal(
      collected.entries.length,
      1,
      `Expected trigger for ${method}.`,
    );
    assert.equal(
      collected.entries[0].effect.id,
      "red_fury_horror_banish_and_gain",
    );
  }

  for (const method of ["normal", "flip"] as const) {
    const collected = await game.effectEngine.collectAfterSummonTriggers({
      card: summoned,
      player: game.bot,
      method,
      fromZone: "field",
    });
    assert.equal(
      collected.entries.length,
      0,
      `Unexpected trigger for ${method}.`,
    );
  }

  const ownSummon = await game.effectEngine.collectAfterSummonTriggers({
    card: redFury,
    player: game.player,
    method: "synchro",
    fromZone: "extraDeck",
  });
  assert.equal(ownSummon.entries.length, 0);
});

test("Red Fury Horror bane antes de aplicar o bônus e não ganha ATK se o alvo falhar", async (t) => {
  const game = createGame(t);
  const definition = getCard(RED_FURY_HORROR_ID);
  const effect = getEffect(definition, "red_fury_horror_banish_and_gain");
  const redFury = makeRuntimeCard(definition, game.player.id);
  const validTarget = makeRuntimeCard(
    {
      id: 9903,
      name: "Valid target",
      cardKind: "monster",
      atk: 1000,
      def: 1000,
    },
    game.bot.id,
  );
  game.player.field.push(redFury);
  game.bot.graveyard.push(validTarget);

  const resolved = await game.effectEngine.applyActions(
    required(effect.actions),
    { source: redFury, player: game.player, opponent: game.bot, effect },
    { red_fury_horror_graveyard_target: [validTarget] },
  );
  assert.ok(resolved.success === true);
  assert.equal(game.bot.banished.includes(validTarget), true);
  assert.equal(redFury.atk, 3000);

  const staleTarget = makeRuntimeCard(
    {
      id: 9904,
      name: "Stale target",
      cardKind: "monster",
      atk: 1000,
      def: 1000,
    },
    game.bot.id,
  );
  game.bot.hand.push(staleTarget);
  const failed = await game.effectEngine.applyActions(
    required(effect.actions),
    { source: redFury, player: game.player, opponent: game.bot, effect },
    { red_fury_horror_graveyard_target: [staleTarget] },
  );
  assert.ok(failed.success === false);
  assert.equal(redFury.atk, 3000);
});

test("Iron Smasher recebe proteção somente de outro monstro TERRA com a face para cima", async (t) => {
  const game = createGame(t);
  const ironSmasher = makeRuntimeCard(getCard(IRON_SMASHER_ID), game.player.id);
  const earthAlly = makeRuntimeCard(
    {
      id: 9905,
      name: "EARTH ally",
      cardKind: "monster",
      attribute: "Earth",
      atk: 1000,
      def: 1000,
    },
    game.player.id,
  );
  game.player.field.push(ironSmasher, earthAlly);

  const protectedResult = await game.destroyCard(ironSmasher, {
    cause: "effect",
    sourcePlayer: game.bot,
  });
  assert.ok("destroyed" in protectedResult);
  assert.equal(protectedResult.destroyed, false);
  assert.equal(protectedResult.reason, "protected");
  assert.equal(game.player.field.includes(ironSmasher), true);

  earthAlly.isFacedown = true;
  const unprotectedResult = await game.destroyCard(ironSmasher, {
    cause: "effect",
    sourcePlayer: game.bot,
  });
  assert.ok("destroyed" in unprotectedResult);
  assert.equal(unprotectedResult.destroyed, true);
  assert.equal(game.player.graveyard.includes(ironSmasher), true);
});

test("a resposta de Iron Smasher exige destruição de card próprio no runtime e na simulação", (t) => {
  const game = createGame(t);
  const definition = getCard(IRON_SMASHER_ID);
  const ironSmasher = makeRuntimeCard(definition, game.player.id);
  const ownVictim = makeRuntimeCard(
    { id: 9906, name: "Own victim", cardKind: "monster", atk: 1000, def: 1000 },
    game.player.id,
  );
  const opponentVictim = makeRuntimeCard(
    {
      id: 9907,
      name: "Opponent victim",
      cardKind: "monster",
      atk: 1000,
      def: 1000,
    },
    game.bot.id,
  );
  const activatedCard = makeRuntimeCard(
    {
      id: 9908,
      name: "Destroying effect",
      cardKind: "monster",
      atk: 1000,
      def: 1000,
    },
    game.bot.id,
  );
  const destructiveEffect = {
    id: "test_destroy_target",
    actions: [{ type: "destroy_targeted_cards", targetRef: "victim" }],
  };
  const responseEffect = getEffect(
    definition,
    "iron_smasher_destroy_facedown_response",
  );
  game.player.field.push(ironSmasher, ownVictim);
  game.bot.field.push(opponentVictim, activatedCard);

  const makeActionContext = (victim: Card) => ({
    activationAttempt: {
      card: activatedCard,
      effect: destructiveEffect,
      controller: game.bot,
    },
    card: activatedCard,
    effect: destructiveEffect,
    player: game.bot,
    respondingToChainLink: {
      targetSelections: chainSelections({ victim: [victim] }),
    },
  });
  const evaluateRuntime = (victim: Card) =>
    game.effectEngine.evaluateConditions(responseEffect.conditions, {
      source: ironSmasher,
      player: game.player,
      opponent: game.bot,
      activationContext: { context: makeActionContext(victim) },
    }).ok;
  const evaluateSimulation = (victim: Card) =>
    evaluateSimulatedConditions(responseEffect.conditions, {
      state: { player: game.player, bot: game.bot },
      selfId: game.player.id,
      sourceCard: ironSmasher,
      options: { actionContext: makeActionContext(victim) },
    });

  assert.equal(evaluateRuntime(ownVictim), true);
  assert.equal(evaluateSimulation(ownVictim), true);
  assert.equal(evaluateRuntime(opponentVictim), false);
  assert.equal(evaluateSimulation(opponentVictim), false);

  assert.deepEqual(required(responseEffect.targets)[0].filters, {
    facedown: true,
  });
  assert.equal(
    required(responseEffect.actions)[0].type,
    "destroy_targeted_cards",
  );
  assert.equal(
    required(responseEffect.actions)[0].targetRef,
    required(responseEffect.targets)[0].id,
  );
});
