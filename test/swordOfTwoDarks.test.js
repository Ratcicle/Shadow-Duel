import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Card from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import Game from "../src/core/Game.js";
import { cardDatabaseByName } from "../src/data/cards.js";

const CARD_NAME = "Sword of Two Darks";
const EQUIP_EFFECT_ID = "sword_of_two_darks_equip";
const GRAVE_EFFECT_ID = "sword_of_two_darks_pop_backrow";

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
  t.after(() => game.dispose("sword_of_two_darks_test"));
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

test("Sword of Two Darks declares its effects and control limit", () => {
  const card = cardDatabaseByName.get(CARD_NAME);
  assert.ok(card);
  assert.equal(
    card.description,
    'The equipped monster can make 1 additional attack during each Battle Phase. If this card is sent to the Graveyard: target 1 Spell/Trap your opponent controls; destroy that target. You can only control 1 "Sword of Two Darks".',
  );

  const equipEffect = card.effects.find(
    (effect) => effect.id === EQUIP_EFFECT_ID,
  );
  assert.equal(equipEffect.actions[0].extraAttacks, 1);
  assert.deepEqual(equipEffect.conditions, [
    {
      type: "control_card_max",
      zone: "spellTrap",
      max: 0,
      includeFacedown: true,
      filters: { cardId: 11 },
      excludeSource: true,
      reason: 'You can only control 1 "Sword of Two Darks".',
    },
  ]);

  const graveEffect = card.effects.find(
    (effect) => effect.id === GRAVE_EFFECT_ID,
  );
  assert.equal(graveEffect.fromZone, undefined);
  assert.deepEqual(graveEffect.targets[0].cardKind, ["spell", "trap"]);

  const locale = JSON.parse(
    readFileSync(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    locale.cards["11"].description,
    "O monstro equipado pode realizar 1 ataque adicional durante cada Fase de Batalha.\n\nSe este card for enviado para o Cemitério: escolha 1 Magia/Armadilha que seu oponente controla; destrua-a.\n\nVocê só pode controlar 1 “Espada das Duas Trevas”.",
  );

  const validation = validateCardDatabase();
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(validation.warnings, []);
});

test("the equipped monster can attack twice during the Battle Phase", async (t) => {
  const game = createGame(t);
  const sword = makeCard(CARD_NAME, game.player);
  const attacker = makeCard(
    {
      id: 99120,
      name: "Twice-attacking monster",
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
      id: 99121,
      name: "First battle target",
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

  assert.equal(attacker.extraAttacks, 1);
  game.phase = "battle";
  const firstAttack = await game.resolveCombat(attacker, defender);
  assert.equal(firstAttack.ok, true);
  assert.equal(game.bot.graveyard.includes(defender), true);

  const lpBeforeSecondAttack = game.bot.lp;
  const secondAttack = await game.resolveCombat(attacker, null);
  assert.equal(secondAttack.ok, true);
  assert.equal(game.bot.lp, lpBeforeSecondAttack - attacker.atk);
  assert.equal(attacker.attacksUsedThisTurn, 2);
});

test("a second copy cannot be activated while another copy is controlled", async (t) => {
  const game = createGame(t);
  const controlledSword = makeCard(CARD_NAME, game.player);
  const secondSword = makeCard(CARD_NAME, game.player);
  const equipTarget = makeCard(
    {
      id: 99122,
      name: "Equip target",
      cardKind: "monster",
      level: 4,
      atk: 1500,
      def: 1500,
      effects: [],
    },
    game.player,
  );
  controlledSword.isFacedown = true;
  game.player.spellTrap.push(controlledSword);
  game.player.hand.push(secondSword);
  game.player.field.push(equipTarget);

  const result = await game.tryActivateSpell(secondSword, 0);

  assert.equal(result.ok, false);
  assert.equal(game.player.hand.includes(secondSword), true);
  assert.equal(game.player.spellTrap.includes(secondSword), false);
  assert.equal(game.targetSelection, null);
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
        id: cardKind === "spell" ? 99123 : 99124,
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
