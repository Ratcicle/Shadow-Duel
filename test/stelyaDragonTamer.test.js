import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import Game from "../src/core/Game.js";
import { simulateMainPhaseAction } from "../src/core/ai/dragon/simulation.js";
import {
  DRAGON_OPT_NAMES,
  analyzeDragonState,
} from "../src/core/ai/dragon/stateAnalysis.js";
import { cardDatabaseById } from "../src/data/cards.js";

const STELYA_ID = 278;
const SHARED_USAGE_KEY = "stelya_effect_choice";

const EFFECT_IDS = Object.freeze({
  handSummon: "stelya_hand_banish_dragon_summon",
  graveyardSummon: "stelya_graveyard_banish_dragon_summon",
  search: "stelya_discard_search_dragon",
});

function getStelya() {
  const card = cardDatabaseById.get(STELYA_ID);
  assert.ok(card, "Stelya must be registered in the card database.");
  return card;
}

function getEffect(id) {
  const effect = getStelya().effects.find((entry) => entry.id === id);
  assert.ok(effect, `Expected Stelya effect ${id}.`);
  return effect;
}

function createGame(t) {
  const game = new Game({
    captureReplay: false,
    laboratoryMode: true,
    phaseDelayMs: 0,
    animationDelayMs: 0,
  });
  game.turn = game.player.id;
  game.phase = "main1";
  game.player.controllerType = "ai";
  game.bot.controllerType = "ai";
  t.after(() => game.dispose("stelya_test_complete"));
  return game;
}

function simulatedCard(definition, instanceId) {
  return { ...structuredClone(definition), instanceId };
}

function makeSimulationState({ stelyaZone = "hand", secondStelya = false } = {}) {
  const stelya = simulatedCard(getStelya(), "stelya-primary");
  const otherStelya = secondStelya
    ? simulatedCard(getStelya(), "stelya-secondary")
    : null;
  const discard = {
    id: 99001,
    instanceId: "discard",
    name: "Discardable Dragon",
    cardKind: "monster",
    type: "Dragon",
    attribute: "Earth",
    level: 2,
    atk: 500,
    def: 500,
  };
  const fieldCost = {
    id: 99002,
    instanceId: "field-cost",
    name: "Expendable Dragon",
    cardKind: "monster",
    type: "Dragon",
    attribute: "Earth",
    level: 1,
    atk: 0,
    def: 0,
    isFacedown: false,
  };
  const searchTarget = {
    id: 99003,
    instanceId: "search-target",
    name: "Searchable Dragon",
    cardKind: "monster",
    type: "Dragon",
    attribute: "Earth",
    level: 8,
    atk: 2500,
    def: 2000,
  };
  const hand = [discard];
  const graveyard = [];
  if (stelyaZone === "hand") hand.unshift(stelya);
  else graveyard.push(stelya);
  if (otherStelya) hand.unshift(otherStelya);

  return {
    _isPerspectiveState: true,
    turnCounter: 1,
    bot: {
      id: "bot",
      hand,
      field: [fieldCost],
      deck: [searchTarget],
      graveyard,
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
  };
}

test("Stelya declara o novo texto e um único limite compartilhado", () => {
  const card = getStelya();
  const validation = validateCardDatabase();
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 0);
  assert.deepEqual(
    {
      name: card.name,
      level: card.level,
      isTuner: card.isTuner,
      type: card.type,
      attribute: card.attribute,
      atk: card.atk,
      def: card.def,
      tributeValue: card.tributeValue,
    },
    {
      name: "Stelya, Dragon Tamer",
      level: 4,
      isTuner: true,
      type: "Dragon",
      attribute: "Earth",
      atk: 1700,
      def: 1200,
      tributeValue: {
        countAs: 2,
        summonMethods: ["tribute"],
        summonedCardFilters: { type: "Dragon" },
      },
    },
  );
  assert.match(
    card.description,
    /only use 1 of the following effects[\s\S]*and only once that turn/,
  );
  assert.equal((card.description.match(/●/g) || []).length, 2);

  const locale = JSON.parse(
    readFileSync(new URL("../public/locales/pt-br.json", import.meta.url), "utf8"),
  );
  assert.equal(locale.cards[STELYA_ID].name, "Stelya, Domadora de Dragões");
  assert.match(
    locale.cards[STELYA_ID].description,
    /só pode usar 1 dos seguintes efeitos[\s\S]*apenas uma vez por turno/,
  );
  assert.equal(
    (locale.cards[STELYA_ID].description.match(/●/g) || []).length,
    2,
  );

  const effects = Object.values(EFFECT_IDS).map(getEffect);
  assert.equal(new Set(effects.map((effect) => effect.oncePerTurnName)).size, 1);
  for (const effect of effects) {
    assert.equal(effect.oncePerTurn, true);
    assert.equal(effect.oncePerTurnName, SHARED_USAGE_KEY);
    assert.equal(effect.usagePolicy, "use");
  }

  const handSummon = getEffect(EFFECT_IDS.handSummon);
  const graveyardSummon = getEffect(EFFECT_IDS.graveyardSummon);
  const search = getEffect(EFFECT_IDS.search);
  assert.deepEqual(handSummon.activationZones, ["hand"]);
  assert.deepEqual(graveyardSummon.activationZones, ["graveyard"]);
  assert.equal(handSummon.targets[0].intent, "cost");
  assert.equal(graveyardSummon.targets[0].intent, "cost");
  assert.equal(handSummon.activationCosts[0].to, "banished");
  assert.equal(graveyardSummon.activationCosts[0].to, "banished");
  assert.equal(search.targets[0].excludeSelf, true);
  assert.deepEqual(
    search.activationCosts.map((action) => action.targetRef),
    ["self", "stelya_discard_other_card"],
  );
  assert.equal(search.actions[0].minLevel, 5);
});

test("qualquer efeito da Stelya bloqueia os outros até o próximo turno", async (t) => {
  for (const firstEffectId of Object.values(EFFECT_IDS)) {
    await t.test(firstEffectId, () => {
      const game = createGame(t);
      const card = { ...getStelya(), instanceId: `runtime-${firstEffectId}` };
      const firstEffect = getEffect(firstEffectId);
      const reservation = game.reserveEffectUsage({
        card,
        player: game.player,
        effect: firstEffect,
      });
      assert.equal(reservation.status, "consumed");

      for (const effectId of Object.values(EFFECT_IDS)) {
        const check = game.checkEffectUsage({
          card,
          player: game.player,
          effect: getEffect(effectId),
        });
        assert.equal(check.ok, false, `${firstEffectId} must block ${effectId}.`);
        assert.equal(check.code, "USAGE_LIMIT_REACHED");
      }

      game.turnCounter += 1;
      for (const effectId of Object.values(EFFECT_IDS)) {
        assert.equal(
          game.checkEffectUsage({
            card,
            player: game.player,
            effect: getEffect(effectId),
          }).ok,
          true,
        );
      }
    });
  }
});

test("a política use mantém a escolha consumida após negar a ativação", (t) => {
  const game = createGame(t);
  const card = { ...getStelya(), instanceId: "negated-stelya" };
  const summon = getEffect(EFFECT_IDS.handSummon);
  const reservation = game.reserveEffectUsage({
    card,
    player: game.player,
    effect: summon,
  });
  const settled = game.settleEffectUsage(reservation, {
    activationNegated: true,
  });

  assert.equal(settled.status, "consumed");
  assert.equal(
    game.checkEffectUsage({
      card,
      player: game.player,
      effect: getEffect(EFFECT_IDS.search),
    }).ok,
    false,
  );
});

test("cancelamento antes do compromisso não consome a escolha compartilhada", async (t) => {
  const game = createGame(t);
  const card = { ...getStelya(), instanceId: "cancelled-stelya" };
  const search = getEffect(EFFECT_IDS.search);
  game.player.hand.push(card);

  const result = await game.runActivationPipeline({
    card,
    owner: game.player,
    effect: search,
    oncePerTurn: { card, player: game.player, effect: search },
    activationZone: "hand",
    selectionKind: "monsterEffect",
    activate: async () => ({
      success: false,
      reason: "Effect activation cancelled.",
    }),
  });

  assert.equal(result.success, false);
  for (const effectId of Object.values(EFFECT_IDS)) {
    assert.equal(
      game.checkEffectUsage({
        card,
        player: game.player,
        effect: getEffect(effectId),
      }).ok,
      true,
    );
  }
});

test("IA e simulação tratam Invocação e busca como a mesma escolha", (t) => {
  assert.equal(DRAGON_OPT_NAMES.stelyaSummon, SHARED_USAGE_KEY);
  assert.equal(DRAGON_OPT_NAMES.stelyaSearch, SHARED_USAGE_KEY);

  const game = createGame(t);
  const runtimeCard = { ...getStelya(), instanceId: "ai-stelya" };
  game.reserveEffectUsage({
    card: runtimeCard,
    player: game.player,
    effect: getEffect(EFFECT_IDS.search),
  });
  const analysis = analyzeDragonState({
    game,
    bot: game.player,
    opponent: game.bot,
  });
  assert.equal(analysis.opt.stelyaSummon.canUse, false);
  assert.equal(analysis.opt.stelyaSearch.canUse, false);

  const searchFirst = makeSimulationState({ stelyaZone: "hand" });
  simulateMainPhaseAction(searchFirst, {
    type: "handIgnition",
    index: 0,
    cardId: STELYA_ID,
    effectId: EFFECT_IDS.search,
  });
  assert.equal(searchFirst.bot.graveyard.some((card) => card.id === STELYA_ID), true);
  assert.equal(searchFirst.bot.hand.some((card) => card.name === "Searchable Dragon"), true);
  const fieldBeforeBlockedSummon = [...searchFirst.bot.field];
  simulateMainPhaseAction(searchFirst, {
    type: "graveyardMonsterEffect",
    cardId: STELYA_ID,
    effectId: EFFECT_IDS.graveyardSummon,
  });
  assert.equal(searchFirst.bot.graveyard.some((card) => card.id === STELYA_ID), true);
  assert.deepEqual(searchFirst.bot.field, fieldBeforeBlockedSummon);

  const summonFirst = makeSimulationState({
    stelyaZone: "graveyard",
    secondStelya: true,
  });
  simulateMainPhaseAction(summonFirst, {
    type: "graveyardMonsterEffect",
    cardId: STELYA_ID,
    effectId: EFFECT_IDS.graveyardSummon,
  });
  assert.equal(summonFirst.bot.field.some((card) => card.id === STELYA_ID), true);
  const handBeforeBlockedSearch = [...summonFirst.bot.hand];
  const deckBeforeBlockedSearch = [...summonFirst.bot.deck];
  simulateMainPhaseAction(summonFirst, {
    type: "handIgnition",
    index: summonFirst.bot.hand.findIndex((card) => card.id === STELYA_ID),
    cardId: STELYA_ID,
    effectId: EFFECT_IDS.search,
  });
  assert.deepEqual(summonFirst.bot.hand, handBeforeBlockedSearch);
  assert.deepEqual(summonFirst.bot.deck, deckBeforeBlockedSearch);
});
