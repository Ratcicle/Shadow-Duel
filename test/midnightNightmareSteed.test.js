import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Card from "../src/core/Card.js";
import Game from "../src/core/Game.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import { cardDatabaseByName } from "../src/data/cards.js";

const CARD_NAME = "Midnight Nightmare Steed";
const COST_NAME = "Nightmare Steed";
const SUMMON_EFFECT_ID = "midnight_nightmare_steed_hand_tribute_summon";
const DAMAGE_EFFECT_ID = "midnight_nightmare_steed_battle_damage";

function getDefinition(name) {
  const definition = cardDatabaseByName.get(name);
  assert.ok(definition, `${name} must exist in the card database.`);
  return definition;
}

function getEffect(id) {
  const effect = getDefinition(CARD_NAME).effects.find(
    (entry) => entry.id === id,
  );
  assert.ok(effect, `${CARD_NAME} effect ${id} must exist.`);
  return effect;
}

function makeCard(definition, owner) {
  const card = new Card(definition, owner.id);
  card.owner = owner.id;
  card.controller = owner.id;
  card.isFacedown = false;
  card.position = "attack";
  return card;
}

function makeFiller(id, owner) {
  return makeCard(
    {
      id,
      name: `Midnight Nightmare Steed test filler ${id}`,
      cardKind: "monster",
      atk: 1000,
      def: 1000,
      level: 4,
      type: "Beast",
      attribute: "Dark",
      effects: [],
    },
    owner,
  );
}

function createGame(t, { phase = "main1" } = {}) {
  const game = new Game({
    captureReplay: false,
    laboratoryMode: true,
    phaseDelayMs: 0,
    animationDelayMs: 0,
    chainResponseTimeoutMs: 1,
  });
  game.turn = game.player.id;
  game.turnCounter = 2;
  game.phase = phase;
  game.battleStep = phase === "battle" ? "battle" : null;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.player.controllerType = "ai";
  game.bot.controllerType = "ai";
  t.after(() => game.dispose("midnight_nightmare_steed_test_complete"));
  return game;
}

test("Midnight Nightmare Steed declara a nova Invocação-Especial e o dano correto", () => {
  const definition = getDefinition(CARD_NAME);
  const summonEffect = getEffect(SUMMON_EFFECT_ID);
  const damageEffect = getEffect(DAMAGE_EFFECT_ID);
  const locale = JSON.parse(
    readFileSync(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  const validation = validateCardDatabase();

  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 0);
  assert.equal("altTribute" in definition, false);
  assert.equal(
    definition.description,
    'You can Tribute 1 "Nightmare Steed" you control; Special Summon this card from your hand. If this card destroys an opponent\'s monster by battle: inflict 300 damage to your opponent.',
  );
  assert.deepEqual(summonEffect.activationZones, ["hand"]);
  assert.deepEqual(summonEffect.requirePhase, ["main1", "main2"]);
  assert.deepEqual(summonEffect.targets, [
    {
      id: "midnight_nightmare_steed_tribute_cost",
      owner: "self",
      zone: "field",
      cardKind: "monster",
      cardName: COST_NAME,
      count: { min: 1, max: 1 },
      intent: "cost",
    },
  ]);
  assert.equal(summonEffect.activationCosts[0].to, "graveyard");
  assert.equal(summonEffect.actions[0].type, "special_summon_from_zone");
  assert.equal(summonEffect.actions[0].requireSource, true);
  assert.equal(summonEffect.actions[0].fieldSlotsFreedBeforeSummon, 1);
  assert.equal(damageEffect.requireSelfAsBattleDestroyer, true);
  assert.equal(damageEffect.requireDestroyedIsOpponent, true);
  assert.equal(
    locale.cards["5"].description,
    "Você pode Invocar este card por Invocação-Especial da sua mão ao oferecer como Tributo 1 “Corcel Pesadelo”. Se este card destruir um monstro do oponente em batalha: cause 300 de dano ao seu oponente.",
  );
});

test("o Tributo é pago antes da resposta e libera uma zona para a Invocação", async (t) => {
  const game = createGame(t);
  const source = makeCard(getDefinition(CARD_NAME), game.player);
  const tribute = makeCard(getDefinition(COST_NAME), game.player);
  const fillers = [990501, 990502, 990503, 990504].map((id) =>
    makeFiller(id, game.player),
  );
  game.player.hand.push(source);
  game.player.field.push(tribute, ...fillers);

  const preview = game.effectEngine.canActivateMonsterEffectPreview(
    source,
    game.player,
    "hand",
    null,
    { effectId: SUMMON_EFFECT_ID },
  );
  const moves = [];
  game.on("card_moved", ({ card, fromZone, toZone }) => {
    moves.push(`${card.name}:${fromZone}->${toZone}`);
  });
  let observedAtResponse = false;
  game.chainSystem.offerChainResponses = async () => {
    const link = game.chainSystem.getLastChainLink();
    if (link?.effectId === SUMMON_EFFECT_ID) {
      observedAtResponse =
        game.player.graveyard.includes(tribute) &&
        link.costsPaid === true &&
        link.costSelections?.midnight_nightmare_steed_tribute_cost?.[0] ===
          tribute;
    }
    return { consecutivePasses: 2, offers: 1, activations: 0 };
  };

  const result = await game.tryActivateMonsterEffect(
    source,
    { midnight_nightmare_steed_tribute_cost: [tribute] },
    "hand",
    game.player,
    { effectId: SUMMON_EFFECT_ID },
  );

  assert.equal(preview.ok, true);
  assert.equal(result.success, true);
  assert.equal(observedAtResponse, true);
  assert.equal(game.player.graveyard.includes(tribute), true);
  assert.equal(game.player.field.includes(source), true);
  assert.equal(game.player.field.length, 5);
  assert.equal(game.player.summonCount, 0);
  assert.equal(source.lastSummonMethod, "special");
  assert.deepEqual(moves.slice(0, 2), [
    "Nightmare Steed:field->graveyard",
    "Midnight Nightmare Steed:hand->field",
  ]);
});

test("a Invocação exige exatamente Nightmare Steed e não reduz Tributos da Invocação-Normal", (t) => {
  const game = createGame(t);
  const source = makeCard(getDefinition(CARD_NAME), game.player);
  const wrongTribute = makeFiller(990505, game.player);
  game.player.hand.push(source);
  game.player.field.push(wrongTribute);

  const preview = game.effectEngine.canActivateMonsterEffectPreview(
    source,
    game.player,
    "hand",
    null,
    { effectId: SUMMON_EFFECT_ID },
  );
  const tributeRequirement = game.player.getTributeRequirement(source);

  assert.equal(preview.ok, false);
  assert.equal(tributeRequirement.tributesNeeded, 2);
  assert.equal(tributeRequirement.usingAlt, false);
});

test("destruir um monstro do oponente em batalha causa exatamente 300 de dano", async (t) => {
  const game = createGame(t, { phase: "battle" });
  const attacker = makeCard(getDefinition(CARD_NAME), game.player);
  const defender = makeCard(
    {
      id: 990506,
      name: "Midnight Nightmare Steed battle target",
      cardKind: "monster",
      atk: 1000,
      def: 1000,
      level: 4,
      type: "Warrior",
      attribute: "Light",
      effects: [],
    },
    game.bot,
  );
  defender.position = "defense";
  game.player.field.push(attacker);
  game.bot.field.push(defender);
  game.bot.lp = 8000;

  const result = await game.resolveCombat(attacker, defender);

  assert.equal(result.ok, true);
  assert.equal(game.bot.graveyard.includes(defender), true);
  assert.equal(game.bot.lp, 7700);
  assert.equal(game.chainSystem.isOpenGameState(), true);
});
