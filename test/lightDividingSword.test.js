import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Card from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import Game from "../src/core/Game.js";
import { cardDatabaseByName } from "../src/data/cards.js";

const CARD_NAME = "Light-Dividing Sword";
const GRAVE_EFFECT_ID = "light_dividing_sword_pop_backrow";

function makeCard(dataOrName, owner) {
  const data =
    typeof dataOrName === "string"
      ? structuredClone(cardDatabaseByName.get(dataOrName))
      : structuredClone(dataOrName);
  const card = new Card(data, owner.id);
  card.owner = owner.id;
  card.controller = owner.id;
  return card;
}

function createGame(t) {
  const game = new Game({
    animationDelayMs: 0,
    captureReplay: false,
    laboratoryMode: true,
    phaseDelayMs: 0,
  });
  game.turn = game.player.id;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = "human";
  game.bot.controllerType = "ai";
  for (const participant of [game.player, game.bot]) {
    participant.hand = [];
    participant.deck = [];
    participant.field = [];
    participant.spellTrap = [];
    participant.graveyard = [];
  }
  t.after(() => game.dispose("light_dividing_sword_test"));
  return game;
}

async function waitUntil(predicate, message, attempts = 500) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

async function selectCard(game, ownerId, index, zone) {
  await waitUntil(
    () => game.targetSelection?.kind === "target",
    "Expected target selection.",
  );
  assert.equal(
    game.handleTargetSelectionClick(ownerId, index, null, zone),
    true,
  );
  game.advanceTargetSelection();
}

test("Light-Dividing Sword declares the corrected target and text", () => {
  const card = cardDatabaseByName.get(CARD_NAME);
  assert.ok(card);
  assert.equal(
    card.description,
    "If the equipped monster destroys an opponent's monster by battle: gain 500 LP. If this card is sent to the Graveyard: target 1 Spell/Trap your opponent controls; destroy that target.",
  );

  const effect = card.effects.find((entry) => entry.id === GRAVE_EFFECT_ID);
  assert.ok(effect);
  assert.equal(effect.fromZone, undefined);
  assert.deepEqual(effect.targets[0].cardKind, ["spell", "trap"]);

  const locale = JSON.parse(
    readFileSync(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    locale.cards["10"].description,
    "Se o monstro equipado destruir um monstro do oponente em batalha: ganhe 500 PV. Se este card for enviado para o Cemitério: escolha 1 Magia/Armadilha que seu oponente controla; destrua-a.",
  );

  const validation = validateCardDatabase();
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(validation.warnings, []);
});

test("the equipped monster gains 500 LP after destroying by battle", async (t) => {
  const game = createGame(t);
  const sword = makeCard(CARD_NAME, game.player);
  const attacker = makeCard(
    {
      id: 99110,
      name: "Equipped attacker",
      cardKind: "monster",
      level: 4,
      atk: 2000,
      def: 1000,
      effects: [],
    },
    game.player,
  );
  const defender = makeCard(
    {
      id: 99111,
      name: "Battle target",
      cardKind: "monster",
      level: 4,
      atk: 1000,
      def: 1000,
      effects: [],
    },
    game.bot,
  );
  game.player.hand.push(sword);
  game.player.field.push(attacker);
  game.bot.field.push(defender);

  const equipPromise = game.tryActivateSpell(sword, 0);
  await selectCard(game, game.player.id, 0, "field");
  await equipPromise;
  await waitUntil(
    () =>
      sword.equippedTo === attacker && game.player.spellTrap.includes(sword),
    "Equip effect did not resolve.",
  );

  const lpBefore = game.player.lp;
  game.phase = "battle";
  const result = await game.resolveCombat(attacker, defender);

  assert.equal(result.ok, true);
  assert.equal(game.bot.graveyard.includes(defender), true);
  assert.equal(game.player.lp, lpBefore + 500);
  assert.equal(game.chainSystem.getFastEffectState().state, "open");
});

for (const { cardKind, fromZone } of [
  { cardKind: "spell", fromZone: "spellTrap" },
  { cardKind: "trap", fromZone: "hand" },
]) {
  test(`the Graveyard effect destroys an opponent ${cardKind} when sent from ${fromZone}`, async (t) => {
    const game = createGame(t);
    const sword = makeCard(CARD_NAME, game.player);
    const target = makeCard(
      {
        id: cardKind === "spell" ? 99112 : 99113,
        name: `Opponent ${cardKind}`,
        cardKind,
        subtype: "normal",
        effects: [],
      },
      game.bot,
    );
    game.player[fromZone].push(sword);
    game.bot.spellTrap.push(target);

    const movePromise = game.moveCard(sword, game.player, "graveyard", {
      fromZone,
    });
    await selectCard(game, game.bot.id, 0, "spellTrap");
    await movePromise;
    await waitUntil(
      () => game.bot.graveyard.includes(target),
      `${cardKind} target was not destroyed.`,
    );

    assert.equal(game.player.graveyard.includes(sword), true);
    assert.equal(game.bot.spellTrap.includes(target), false);
    assert.equal(game.chainSystem.getFastEffectState().state, "open");
  });
}
