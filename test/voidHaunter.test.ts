import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import test from "node:test";
import ChainSystem from "../src/core/ChainSystem.js";
import type { RuntimeEventMap } from "../src/core/contracts/events.js";
import type { GamePlayer } from "../src/core/contracts/player.js";
import { required, selectedCards } from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";

import Card from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { moveCardToZone } from "../src/core/ai/common/zones.js";
import { cardDatabaseById } from "./helpers/fixtures.js";

const VOID_HAUNTER_ID = 205;
const VOID_HOLLOW_ID = 204;
const HAND_EFFECT_ID = "void_haunter_special_summon_hand";
const GRAVEYARD_EFFECT_ID = "void_haunter_gy_effect";

function getDefinition(id: number) {
  const definition = cardDatabaseById.get(id);
  assert.ok(definition, `Card ${id} must exist in the database.`);
  return definition;
}

function getEffect(id: string) {
  const effect = required(getDefinition(VOID_HAUNTER_ID).effects).find(
    (entry) => entry.id === id,
  );
  assert.ok(effect, `Void Haunter effect ${id} must exist.`);
  return effect;
}

function makeCard(id: number, owner: GamePlayer) {
  const card = new Card(getDefinition(id), owner.id);
  card.owner = owner.id;
  card.controller = owner.id;
  card.isFacedown = false;
  card.position = "attack";
  return card;
}

function createGame(t: TestContext, { disableChains = false } = {}) {
  const game = createRuntimeGame({
    captureReplay: false,
    disableChains,
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
  t.after(() => game.dispose("void_haunter_test_complete"));
  return game;
}

test("Void Haunter declara custos e alvos no contrato canônico", () => {
  const handEffect = getEffect(HAND_EFFECT_ID);
  const graveyardEffect = getEffect(GRAVEYARD_EFFECT_ID);
  const validation = validateCardDatabase();

  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 0);
  assert.deepEqual(required(handEffect.activationCosts), [
    {
      type: "move",
      targetRef: "void_haunter_cost",
      player: "self",
      fromZone: "field",
      to: "graveyard",
      contextLabel: "cost",
    },
  ]);
  assert.equal(
    required(handEffect.actions)[0].type,
    "special_summon_from_zone",
  );
  assert.equal(required(handEffect.actions)[0].requireSource, true);
  assert.equal(required(handEffect.actions)[0].fieldSlotsFreedBeforeSummon, 1);
  assert.equal("costTargetRef" in required(handEffect.actions)[0], false);

  assert.deepEqual(required(graveyardEffect.targets)[0].count, {
    min: 1,
    max: 3,
  });
  assert.equal(required(graveyardEffect.targets)[0].zone, "graveyard");
  assert.equal(required(graveyardEffect.targets)[0].cardName, "Void Hollow");
  assert.equal(required(graveyardEffect.activationCosts)[0].targetRef, "self");
  assert.equal(required(graveyardEffect.activationCosts)[0].to, "banished");
  assert.equal(
    required(graveyardEffect.actions)[0].targetRef,
    "void_haunter_gy_targets",
  );
  assert.equal("banishCost" in required(graveyardEffect.actions)[0], false);
  assert.deepEqual(required(graveyardEffect.actions)[0].statusesOnSummon, [
    { status: "atk", value: 0, restoreOnFieldExit: true },
    { status: "def", value: 0, restoreOnFieldExit: true },
  ]);
});

test("efeito da mão paga o custo e Invoca com o campo inicialmente cheio", async (t) => {
  for (const disableChains of [false, true] as const) {
    const game = createGame(t, { disableChains });
    const haunter = makeCard(VOID_HAUNTER_ID, game.player);
    const cost = makeCard(VOID_HOLLOW_ID, game.player);
    const otherMonsters = [201, 202, 203, 206].map((id) =>
      makeCard(id, game.player),
    );
    game.player.hand.push(haunter);
    game.player.field.push(cost, ...otherMonsters);

    const preview = game.effectEngine.canActivateMonsterEffectPreview(
      haunter,
      game.player,
      "hand",
      null,
      { effectId: HAND_EFFECT_ID },
    );
    const moves: string[] = [];
    game.on("card_moved", ({ card, fromZone, toZone }) => {
      moves.push(`${card.name}:${fromZone}->${toZone}`);
    });

    const result = await game.tryActivateMonsterEffect(
      haunter,
      { void_haunter_cost: [cost] },
      "hand",
      game.player,
      { effectId: HAND_EFFECT_ID },
    );

    assert.equal(
      preview.ok,
      true,
      `preview failed with disableChains=${disableChains}`,
    );
    assert.ok(result.success === true);
    assert.equal(game.player.field.length, 5);
    assert.equal(game.player.field.includes(haunter), true);
    assert.equal(game.player.graveyard.includes(cost), true);
    assert.deepEqual(moves.slice(0, 2), [
      "Void Hollow:field->graveyard",
      "Void Haunter:hand->field",
    ]);
  }
});

test("custo da mão já está pago quando a janela de respostas abre", async (t) => {
  const game = createGame(t);
  const haunter = makeCard(VOID_HAUNTER_ID, game.player);
  const cost = makeCard(VOID_HOLLOW_ID, game.player);
  game.player.hand.push(haunter);
  game.player.field.push(cost);

  let observedAtResponse = false;
  assert.ok(game.chainSystem instanceof ChainSystem);
  game.chainSystem.offerChainResponses = async () => {
    const link = game.chainSystem.getLastChainLink();
    if (link?.effectId === HAND_EFFECT_ID) {
      observedAtResponse ||=
        game.player.graveyard.includes(cost) &&
        link.costsPaid === true &&
        selectedCards(link.costSelections, "void_haunter_cost")?.[0] === cost;
    }
    return {
      lastActivator: null,
      chainBuilt: false,
      consecutivePasses: 2,
      offers: 1,
      activations: 0,
    };
  };

  const result = await game.tryActivateMonsterEffect(
    haunter,
    { void_haunter_cost: [cost] },
    "hand",
    game.player,
    { effectId: HAND_EFFECT_ID },
  );

  assert.ok(result.success === true);
  assert.equal(observedAtResponse, true);
  assert.equal(game.player.graveyard.includes(cost), true);
  assert.equal(game.player.hand.includes(haunter), false);
  assert.equal(game.player.field.includes(haunter), true);
});

test("efeito do Cemitério exige alvos e os declara antes das respostas", async (t) => {
  const emptyGame = createGame(t);
  const emptyHaunter = makeCard(VOID_HAUNTER_ID, emptyGame.player);
  emptyGame.player.graveyard.push(emptyHaunter);
  const unavailable = emptyGame.effectEngine.canActivateMonsterEffectPreview(
    emptyHaunter,
    emptyGame.player,
    "graveyard",
    null,
    { effectId: GRAVEYARD_EFFECT_ID },
  );
  assert.ok(unavailable.ok === false);

  const game = createGame(t);
  const haunter = makeCard(VOID_HAUNTER_ID, game.player);
  const hollows = [
    makeCard(VOID_HOLLOW_ID, game.player),
    makeCard(VOID_HOLLOW_ID, game.player),
  ];
  game.player.graveyard.push(haunter, ...hollows);

  let observedAtResponse = false;
  assert.ok(game.chainSystem instanceof ChainSystem);
  game.chainSystem.offerChainResponses = async () => {
    const link = game.chainSystem.getLastChainLink();
    if (link?.effectId === GRAVEYARD_EFFECT_ID) {
      observedAtResponse ||=
        game.player.banished.includes(haunter) &&
        link.costsPaid === true &&
        selectedCards(link.targetSelections, "void_haunter_gy_targets")
          ?.length === 2;
    }
    return {
      lastActivator: null,
      chainBuilt: false,
      consecutivePasses: 2,
      offers: 1,
      activations: 0,
    };
  };

  const result = await game.tryActivateMonsterEffect(
    haunter,
    { void_haunter_gy_targets: hollows },
    "graveyard",
    game.player,
    { effectId: GRAVEYARD_EFFECT_ID },
  );

  assert.ok(result.success === true);
  assert.equal(observedAtResponse, true);
  assert.equal(game.player.banished.includes(haunter), true);
  assert.deepEqual(game.player.graveyard, []);
  assert.deepEqual(game.player.field, hollows);
});

test("Hollows são observados como 0/0 e permanecem assim até saírem do campo", async (t) => {
  const game = createGame(t, { disableChains: true });
  const haunter = makeCard(VOID_HAUNTER_ID, game.player);
  const hollows = [
    makeCard(VOID_HOLLOW_ID, game.player),
    makeCard(VOID_HOLLOW_ID, game.player),
    makeCard(VOID_HOLLOW_ID, game.player),
  ];
  game.player.graveyard.push(haunter, ...hollows);
  const observedSummons: Array<{
    card: RuntimeEventMap["after_summon"]["card"];
    atk: number | undefined;
    def: number | undefined;
  }> = [];
  game.on("after_summon", ({ card }) => {
    observedSummons.push({ card, atk: card.atk, def: card.def });
  });

  const result = await game.tryActivateMonsterEffect(
    haunter,
    { void_haunter_gy_targets: hollows },
    "graveyard",
    game.player,
    { effectId: GRAVEYARD_EFFECT_ID },
  );

  assert.ok(result.success === true);
  assert.equal(game.player.banished.includes(haunter), true);
  assert.deepEqual(
    observedSummons.map(({ atk, def }) => [atk, def]),
    [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  );
  assert.deepEqual(
    hollows.map(({ atk, def }) => [atk, def]),
    [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  );

  game.cleanupTempBoosts(game.player);
  assert.deepEqual(
    hollows.map(({ atk, def }) => [atk, def]),
    [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  );

  await game.moveCard(hollows[0], game.player, "graveyard", {
    fromZone: "field",
  });
  assert.deepEqual([hollows[0].atk, hollows[0].def], [1300, 1200]);
  assert.equal(Object.keys(hollows[0].fieldExitStatuses).length, 0);
});

test("simulação da IA paga custos e restaura o 0/0 somente ao sair do campo", () => {
  const effect = getEffect(GRAVEYARD_EFFECT_ID);
  const haunter = simulationCard({
    ...structuredClone(getDefinition(VOID_HAUNTER_ID)),
    instanceId: "sim-haunter",
  });
  const hollow = simulationCard({
    ...structuredClone(getDefinition(VOID_HOLLOW_ID)),
    instanceId: "sim-hollow",
  });
  const state = simulationState({
    turnCounter: 2,
    bot: {
      id: "bot",
      hand: [],
      field: [],
      deck: [],
      graveyard: [haunter, hollow],
      banished: [],
      spellTrap: [],
      extraDeck: [],
      fieldSpell: null,
    },
    player: {
      id: "player",
      hand: [],
      field: [],
      deck: [],
      graveyard: [],
      banished: [],
      spellTrap: [],
      extraDeck: [],
      fieldSpell: null,
    },
  });
  const selections = { void_haunter_gy_targets: [hollow] };

  applySimulatedActions({
    actions: [...required(effect.activationCosts), ...required(effect.actions)],
    selections,
    state,
    selfId: "bot",
    options: { sourceCard: haunter, effect },
  });

  assert.equal(state.bot.banished.includes(haunter), true);
  assert.equal(state.bot.field.includes(hollow), true);
  assert.deepEqual([hollow.atk, hollow.def], [0, 0]);
  moveCardToZone(state.bot, hollow, "graveyard");
  assert.deepEqual([hollow.atk, hollow.def], [1300, 1200]);
});
