import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import test from "node:test";
import type { CardConstructorData } from "../src/core/contracts/cards.js";
import type { GamePlayer } from "../src/core/contracts/player.js";
import type { GameUI } from "../src/core/contracts/ui.js";
import { required } from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";

import Card from "../src/core/Card.js";
import { cardDatabaseById } from "./helpers/fixtures.js";

const ARCTURUS_ID = 224;
const VOID_COST_IDS = [201, 202];

function makeCard(definition: CardConstructorData, owner: GamePlayer) {
  const card = new Card(definition, owner.id);
  card.owner = owner.id;
  card.controller = owner.id;
  card.isFacedown = false;
  card.position = "attack";
  return card;
}

function createGame(t: TestContext) {
  const game = createRuntimeGame({
    captureReplay: false,
    disableChains: true,
    laboratoryMode: true,
  });
  game.turn = game.bot.id;
  game.turnCounter = 2;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.player.controllerType = "human";
  game.bot.controllerType = "ai";
  t.after(() => game.dispose("arcturus_protection_test_complete"));
  return game;
}

test("Arcturus abre o modal do Cemitério e bane dois monstros Void para se proteger", async (t) => {
  const game = createGame(t);
  const arcturusDefinition = cardDatabaseById.get(ARCTURUS_ID);
  assert.ok(arcturusDefinition, "Arcturus must exist in the card database.");

  const arcturus = makeCard(arcturusDefinition, game.player);
  const costs = VOID_COST_IDS.map((id) => {
    const definition = cardDatabaseById.get(id);
    assert.ok(definition, `Void cost card ${id} must exist in the database.`);
    return makeCard(definition, game.player);
  });
  const destroyer = makeCard(
    {
      id: 990224,
      name: "Opponent destruction source",
      cardKind: "monster",
      atk: 1000,
      def: 1000,
      effects: [],
    },
    game.bot,
  );

  game.player.field.push(arcturus);
  game.player.graveyard.push(...costs);
  game.bot.field.push(destroyer);
  game.ui.showConfirmPrompt = async () => true;

  let modalContract = null as Parameters<GameUI["showTargetSelection"]>[0];
  let fieldTargetingCalls = 0;
  game.ui.showFieldTargetingControls = () => {
    fieldTargetingCalls += 1;
    return { updateState() {}, close() {} };
  };
  game.ui.showTargetSelection = (contract, confirmSelection) => {
    modalContract = contract;
    const requirement = required(required(contract).requirements)[0];
    queueMicrotask(() => {
      confirmSelection?.({
        [requirement.id]: requirement.candidates.map(({ key }) => key),
      });
    });
    return { close() {} };
  };

  const result = await game.destroyCard(arcturus, {
    cause: "effect",
    sourceCard: destroyer,
    sourcePlayer: game.bot,
    fromZone: "field",
  });

  assert.ok(modalContract, "The graveyard selection modal must be opened.");
  assert.equal(required(modalContract.ui).useFieldTargeting, false);
  assert.equal(fieldTargetingCalls, 0);
  assert.deepEqual(required(required(modalContract.requirements)[0].zones), [
    "graveyard",
  ]);
  assert.deepEqual(
    required(
      required(modalContract.requirements)[0].candidates.map(
        ({ cardRef }) => cardRef,
      ),
    ),
    costs,
  );
  assert.deepEqual(result, { destroyed: false, replaced: true });
  assert.equal(game.player.field.includes(arcturus), true);
  assert.equal(game.player.graveyard.includes(arcturus), false);
  assert.deepEqual(game.player.graveyard, []);
  assert.deepEqual(game.player.banished, costs);
});
