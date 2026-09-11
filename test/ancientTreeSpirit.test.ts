import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TestContext } from "node:test";
import test from "node:test";
import type { CardConstructorData } from "../src/core/contracts/cards.js";
import type { GamePlayer } from "../src/core/contracts/player.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";

import Card, { cardMatchesKind } from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import { cardDatabaseByName } from "./helpers/fixtures.js";

const CARD_NAME = "Ancient Tree Spirit";

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
  for (const participant of [game.player, game.bot] as const) {
    participant.hand = [];
    participant.deck = [];
    participant.field = [];
    participant.spellTrap = [];
    participant.graveyard = [];
  }
  t.after(() => game.dispose("ancient_tree_spirit_test"));
  return game;
}

test("Ancient Tree Spirit declares the separated text and Trap Monster contract", () => {
  const card = cardDatabaseByName.get(CARD_NAME);
  assert.ok(card);
  assert.equal(
    card.description,
    "Special Summon this card in Defense Position as an Effect Monster (Spirit/DARK/Level 4/ATK 1700/DEF 1900). This card is still treated as a Trap.\n\nIf this card Special Summoned this way is destroyed by battle: inflict 500 damage to your opponent.",
  );

  const summonEffect = required(
    required(card.effects).find(
      (effect) => effect.id === "ancient_tree_spirit_summon",
    ),
  );
  assert.deepEqual(required(summonEffect.actions)[0], {
    type: "special_summon_self_as_trap_monster",
    position: "defense",
    monster: {
      type: "Spirit",
      attribute: "Dark",
      level: 4,
      atk: 1700,
      def: 1900,
    },
    treatedAsCardKinds: ["monster", "trap"],
    summonProcedure: "trap_monster",
  });

  const damageEffect = required(
    required(card.effects).find(
      (effect) => effect.id === "ancient_tree_spirit_battle_destroy_damage",
    ),
  );
  assert.equal(damageEffect.event, "battle_destroy");
  assert.equal(damageEffect.requireSelfAsDestroyed, true);
  assert.equal(damageEffect.requireSelfSummonProcedure, "trap_monster");
  assert.equal(required(damageEffect.actions)[0].amount, 500);

  const locale = JSON.parse(
    readFileSync(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    locale.cards["16"].description,
    "Invoque este card por Invocação-Especial em Posição de Defesa como um Monstro de Efeito (Espírito/TREVAS/Nível 4/ATK 1700/DEF 1900). Este card ainda é considerado uma Armadilha.\n\nSe este card Invocado desta forma for destruído em batalha: cause 500 de dano ao seu oponente.",
  );

  const validation = validateCardDatabase();
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(validation.warnings, []);
});

test("Ancient Tree Spirit becomes a Trap Monster and inflicts damage when destroyed by battle", async (t) => {
  const game = createGame(t);
  const spirit = makeCard(CARD_NAME, game.player);
  spirit.isFacedown = true;
  spirit.setTurn = 1;
  spirit.turnSetOn = 1;
  game.player.spellTrap.push(spirit);

  const activation = await game.tryActivateSpellTrapEffect(spirit, null, {
    owner: game.player,
  });

  assert.ok(activation.success === true);
  assert.equal(game.player.spellTrap.includes(spirit), false);
  assert.equal(game.player.field.includes(spirit), true);
  assert.equal(spirit.cardKind, "monster");
  assert.equal(cardMatchesKind(spirit, "monster"), true);
  assert.equal(cardMatchesKind(spirit, "trap"), true);
  assert.equal(spirit.isTrapMonster, true);
  assert.equal(spirit.position, "defense");
  assert.deepEqual(
    [spirit.type, spirit.attribute, spirit.level, spirit.atk, spirit.def],
    ["Spirit", "Dark", 4, 1700, 1900],
  );
  assert.equal(spirit.lastSummonMethod, "special");
  assert.equal(spirit.lastSummonProcedure, "trap_monster");

  const attacker = makeCard(
    {
      id: 99130,
      name: "Ancient Tree Spirit attacker",
      cardKind: "monster",
      level: 4,
      atk: 2000,
      def: 1000,
      effects: [],
    },
    game.bot,
  );
  game.bot.field.push(attacker);
  game.turn = game.bot.id;
  game.phase = "battle";
  const opponentLpBefore = game.bot.lp;

  const result = required(await game.resolveCombat(attacker, spirit));

  assert.ok(result.ok === true);
  assert.equal(game.player.field.includes(spirit), false);
  assert.equal(game.player.graveyard.includes(spirit), true);
  assert.equal(spirit.cardKind, "trap");
  assert.equal(spirit.isTrapMonster, undefined);
  assert.equal(game.bot.lp, opponentLpBefore - 500);
  assert.equal(game.chainSystem.getFastEffectState().state, "open");
});
