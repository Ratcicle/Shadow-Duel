import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import type { TestContext } from "node:test";
import test from "node:test";
import type { RuntimeEventMap } from "../src/core/contracts/events.js";
import { required } from "./helpers/fixtures.js";
import type { RuntimeGame } from "./helpers/game.js";
import { createRuntimeGame } from "./helpers/game.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";

import Card from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { cardDatabaseByName } from "./helpers/fixtures.js";

const CARD_NAME = "Cheap Necromancy";
const EFFECT_ID = "cheap_necromancy";
const TOKEN_NAME = "Summoned Skeleton Token";

function getCardData() {
  const card = cardDatabaseByName.get(CARD_NAME);
  assert.ok(card, `${CARD_NAME} must exist in the card database.`);
  return card;
}

function getEffect() {
  const effect = required(getCardData().effects).find(
    (entry) => entry.id === EFFECT_ID,
  );
  assert.ok(effect, `Expected effect ${EFFECT_ID}.`);
  return effect;
}

function createRuntimeCard(game: RuntimeGame) {
  const card = new Card(getCardData(), game.player.id);
  card.owner = game.player.id;
  card.controller = game.player.id;
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
  game.player.controllerType = "ai";
  game.bot.controllerType = "ai";
  game.effectEngine.chooseSpecialSummonPosition = async () => "defense";
  t.after(() => game.dispose("cheap_necromancy_test_complete"));
  return game;
}

test("Cheap Necromancy declara a nova Ficha e a localização PT-BR", () => {
  const card = getCardData();
  const effect = getEffect();
  const action = required(effect.actions)[0];
  const locale = JSON.parse(
    readFileSync(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  const validation = validateCardDatabase();

  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 0);
  assert.equal(card.cardKind, "spell");
  assert.equal(card.subtype, "normal");
  assert.equal(
    card.description,
    'Special Summon 1 "Summoned Skeleton Token" (Zombie/DARK/Level 1/ATK 500/DEF 500).',
  );
  assert.equal(
    existsSync(
      new URL("../public/assets/Summoned Skeleton.jpg", import.meta.url),
    ),
    true,
  );
  assert.deepEqual(locale.cards[String(card.id)], {
    name: "Necromancia Barata",
    description:
      "Invoque por Invocação-Especial 1 “Ficha de Esqueleto Invocado” (Zumbi/TREVAS/Nível 1/ATK 500/DEF 500).",
  });
  assert.deepEqual(action, {
    type: "special_summon_token",
    player: "self",
    position: "choice",
    cannotAttackThisTurn: false,
    token: {
      name: TOKEN_NAME,
      atk: 500,
      def: 500,
      level: 1,
      type: "Zombie",
      attribute: "Dark",
      image: "assets/Summoned Skeleton.jpg",
      description: "A Skeleton Token Special Summoned by necromancy.",
    },
  });
});

test("Cheap Necromancy resolve e Invoca a Ficha com os atributos corretos", async (t) => {
  const game = createGame(t);
  const spell = createRuntimeCard(game);
  const summonEvents: Array<RuntimeEventMap["after_summon"]> = [];
  game.player.hand.push(spell);
  game.on("after_summon", (payload) => {
    if (payload.card && Reflect.get(payload.card, "isToken")) {
      summonEvents.push(payload);
    }
  });

  assert.ok(
    game.effectEngine.canActivateSpellFromHandPreview(spell, game.player).ok ===
      true,
  );
  const result = await game.tryActivateSpell(spell, 0);

  assert.ok(result.success === true);
  assert.equal(game.player.graveyard.includes(spell), true);
  assert.equal(game.player.field.length, 1);
  const [token] = game.player.field;
  assert.equal(token.name, TOKEN_NAME);
  assert.equal(token.cardKind, "monster");
  assert.equal(token.type, "Zombie");
  assert.equal(token.attribute, "Dark");
  assert.equal(token.level, 1);
  assert.equal(token.atk, 500);
  assert.equal(token.def, 500);
  assert.equal(token.baseAtk, 500);
  assert.equal(token.baseDef, 500);
  assert.equal(token.isToken, true);
  assert.equal(token.position, "defense");
  assert.equal(token.cannotAttackThisTurn, false);
  assert.equal(token.lastSummonMethod, "special");
  assert.equal(token.lastSummonedFromZone, "token");
  assert.equal(summonEvents.length, 1);
  assert.equal(summonEvents[0].method, "special");
  assert.equal(summonEvents[0].fromZone, "token");
  assert.equal(game.chainSystem.getFastEffectState().state, "open");
  assert.equal(game.chainSystem.getChainLength(), 0);
});

test("Cheap Necromancy não pode ser ativada sem uma Zona de Monstro livre", (t) => {
  const game = createGame(t);
  const spell = createRuntimeCard(game);
  game.player.hand.push(spell);
  for (let index = 0; index < 5; index += 1) {
    const monster = new Card(
      {
        id: 99000 + index,
        name: `Occupied Zone ${index + 1}`,
        cardKind: "monster",
        level: 1,
        atk: 0,
        def: 0,
        effects: [],
      },
      game.player.id,
    );
    monster.owner = game.player.id;
    monster.controller = game.player.id;
    game.player.field.push(monster);
  }

  assert.ok(
    game.effectEngine.canActivateSpellFromHandPreview(spell, game.player).ok ===
      false,
  );
  assert.equal(game.player.hand.includes(spell), true);
  assert.equal(game.player.graveyard.includes(spell), false);
});

test("a simulação resolve position choice e preserva os dados da Ficha", () => {
  const action = required(getEffect().actions)[0];
  const source = simulationCard({ id: getCardData().id, name: CARD_NAME });
  const state = simulationState({
    turnCounter: 3,
    bot: { id: "bot", field: [] },
    player: { id: "player", field: [] },
  });
  const events: Array<{ event: string; payload: object }> = [];

  applySimulatedActions({
    actions: [action],
    selections: {},
    state,
    selfId: "bot",
    options: {
      sourceCard: source,
      chooseSpecialSummonPosition: () => "defense",
      emitSimulatedEvent: (event, payload) => events.push({ event, payload }),
    },
  });

  assert.equal(state.bot.field.length, 1);
  const [token] = state.bot.field;
  assert.equal(token.name, TOKEN_NAME);
  assert.equal(token.type, "Zombie");
  assert.equal(token.attribute, "Dark");
  assert.equal(token.level, 1);
  assert.equal(token.atk, 500);
  assert.equal(token.def, 500);
  assert.equal(token.position, "defense");
  assert.equal(token.isToken, true);
  assert.equal(token.cannotAttackThisTurn, false);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "after_summon");
  assert.equal(Reflect.get(events[0].payload, "fromZone"), "token");
});
