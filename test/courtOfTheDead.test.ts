import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TestContext } from "node:test";
import test from "node:test";
import type { CardConstructorData } from "../src/core/contracts/cards.js";
import type { GamePlayer } from "../src/core/contracts/player.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";

import Card from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import { cardDatabaseByName } from "./helpers/fixtures.js";

const CARD_NAME = "Court of the Dead";
const TARGET_REF = "court_revive_target";

function makeCard(
  dataOrName: string | CardConstructorData,
  owner: Pick<GamePlayer, "id">,
) {
  const data =
    typeof dataOrName === "string"
      ? structuredClone(cardDefinition(dataOrName))
      : structuredClone(dataOrName);
  const card = new Card(data, owner.id);
  card.owner = owner.id;
  card.controller = owner.id;
  return card;
}

function makeMonster(id: number, name: string, owner: GamePlayer) {
  return makeCard(
    {
      id,
      name,
      cardKind: "monster",
      level: 4,
      atk: 1500,
      def: 1000,
      effects: [],
    },
    owner,
  );
}

function createGame(t: TestContext) {
  const game = createRuntimeGame({
    captureReplay: false,
    laboratoryMode: true,
  });
  game.turn = game.player.id;
  game.turnCounter = 2;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = "human";
  game.bot.controllerType = "ai";
  game.ui.showTrapActivationModal = async () => true;
  game.effectEngine.chooseSpecialSummonPosition = async () => "attack";
  for (const participant of [game.player, game.bot] as const) {
    participant.hand = [];
    participant.deck = [];
    participant.field = [];
    participant.spellTrap = [];
    participant.graveyard = [];
  }
  t.after(() => game.dispose("court_of_the_dead_test"));
  return game;
}

async function waitUntil(
  predicate: () => unknown,
  message: string,
  attempts = 500,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

test("Court of the Dead declares separated text and pays counters before targeting", () => {
  const card = cardDatabaseByName.get(CARD_NAME);
  assert.ok(card);
  assert.equal(
    card.description,
    "Each time a monster is sent to either Graveyard: place 1 Funeral Counter on this card.\n\nOnce per turn: You can remove 8 Funeral Counters from this card, then target 1 monster in either Graveyard; Special Summon it to your field.",
  );

  const counterEffect = required(
    required(card.effects).find(
      (effect) => effect.id === "court_of_the_dead_add_funeral_counter",
    ),
  );
  assert.equal(counterEffect.event, "card_to_grave");
  assert.deepEqual(counterEffect.eventCardFilters, {
    cardKind: "monster",
    toZone: "graveyard",
  });

  const reviveEffect = required(
    required(card.effects).find(
      (effect) => effect.id === "court_of_the_dead_revive",
    ),
  );
  assert.equal(reviveEffect.conditions, undefined);
  assert.deepEqual(required(reviveEffect.activationCosts), [
    {
      type: "remove_counter",
      targetRef: "self",
      counterType: "funeral",
      amount: 8,
      haltOnFailure: true,
    },
  ]);
  assert.equal(
    required(reviveEffect.actions).some(
      (action) => action.type === "remove_counter",
    ),
    false,
  );
  assert.equal(required(reviveEffect.targets)[0].owner, "any");
  assert.equal(required(reviveEffect.actions)[0].scope, "both");

  const locale = JSON.parse(
    readFileSync(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    locale.cards["17"].description,
    "Cada vez que um monstro for enviado para qualquer Cemitério: coloque 1 Marcador Fúnebre neste card.\n\nUma vez por turno: você pode remover 8 Marcadores Fúnebres deste card e, depois, escolher 1 monstro em qualquer Cemitério; Invoque-o por Invocação-Especial no seu campo.",
  );

  const validation = validateCardDatabase();
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(validation.warnings, []);
});

test("Court gains counters from either Graveyard and revives after paying eight", async (t) => {
  const game = createGame(t);
  const court = makeCard(CARD_NAME, game.player);
  court.isFacedown = false;
  game.player.spellTrap.push(court);
  assert.ok(
    game.effectEngine.canActivateSpellTrapEffectPreview(
      court,
      game.player,
      "spellTrap",
    ).ok === false,
  );

  const ownMonster = makeMonster(
    99140,
    "Own Funeral Counter source",
    game.player,
  );
  const opposingMonster = makeMonster(
    99141,
    "Opposing Funeral Counter source",
    game.bot,
  );
  game.player.field.push(ownMonster);
  game.bot.field.push(opposingMonster);

  await game.moveCard(ownMonster, game.player, "graveyard", {
    fromZone: "field",
  });
  await waitUntil(
    () => court.getCounter("funeral") === 1,
    "Expected the first card_to_grave Trigger to add a Funeral Counter.",
  );
  await game.moveCard(opposingMonster, game.bot, "graveyard", {
    fromZone: "field",
  });

  await waitUntil(
    () => court.getCounter("funeral") === 2,
    "Expected both card_to_grave Triggers to add Funeral Counters.",
  );
  assert.equal(court.getCounter("funeral"), 2);
  court.addCounter("funeral", 6);
  assert.ok(
    game.effectEngine.canActivateSpellTrapEffectPreview(
      court,
      game.player,
      "spellTrap",
    ).ok === true,
  );

  let countersAtChainWindow = null;
  const openActivationChain = game.chainSystem.openActivationChain.bind(
    game.chainSystem,
  );
  game.chainSystem.openActivationChain = async (prepared) => {
    countersAtChainWindow = court.getCounter("funeral");
    return openActivationChain(prepared);
  };

  const activation = await game.tryActivateSpellTrapEffect(
    court,
    { [TARGET_REF]: [opposingMonster] },
    { owner: game.player },
  );

  assert.ok(activation.success === true);
  assert.equal(countersAtChainWindow, 0);
  assert.equal(court.getCounter("funeral"), 0);
  assert.equal(game.bot.graveyard.includes(opposingMonster), false);
  assert.equal(game.player.field.includes(opposingMonster), true);
  assert.equal(opposingMonster.position, "attack");
  assert.equal(game.chainSystem.getFastEffectState().state, "open");

  court.addCounter("funeral", 8);
  const secondTarget = makeMonster(99142, "Second revive target", game.player);
  game.player.graveyard.push(secondTarget);
  const secondActivation = await game.tryActivateSpellTrapEffect(
    court,
    { [TARGET_REF]: [secondTarget] },
    { owner: game.player },
  );

  assert.ok(secondActivation.ok === false);
  assert.equal(court.getCounter("funeral"), 8);
  assert.equal(game.player.graveyard.includes(secondTarget), true);
});
