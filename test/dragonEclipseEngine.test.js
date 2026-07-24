import assert from "node:assert/strict";
import test from "node:test";

import Card from "../src/core/Card.js";
import Game from "../src/core/Game.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import { simulateMainPhaseAction } from "../src/core/ai/dragon/simulation.js";
import { analyzeDragonState } from "../src/core/ai/dragon/stateAnalysis.js";
import { cardDatabaseById } from "../src/data/cards.js";

const CARD_IDS = Object.freeze({
  stelya: 278,
  solar: 279,
  lunar: 280,
  luminous: 251,
  armored: 252,
});

const EFFECT_IDS = Object.freeze({
  stelyaSearch: "stelya_discard_search_dragon",
  solarHand: "solar_eclipse_discard_summon_lunar",
  solarGraveyard: "solar_eclipse_gy_revive_dragon",
  lunarGraveyard: "lunar_eclipse_gy_summon_deck_dragon",
});

function getDefinition(id) {
  const definition = cardDatabaseById.get(id);
  assert.ok(definition, `Card ${id} must exist in the database.`);
  return definition;
}

function getEffect(cardId, effectId) {
  const effect = getDefinition(cardId).effects.find(
    (entry) => entry.id === effectId,
  );
  assert.ok(effect, `Effect ${effectId} must exist.`);
  return effect;
}

function makeCard(id, owner) {
  const card = new Card(getDefinition(id), owner.id);
  card.owner = owner.id;
  card.controller = owner.id;
  card.isFacedown = false;
  card.position = "attack";
  return card;
}

function createGame(t) {
  const game = new Game({
    captureReplay: false,
    laboratoryMode: true,
    phaseDelayMs: 0,
    animationDelayMs: 0,
    chainResponseTimeoutMs: 1,
  });
  game.turn = game.player.id;
  game.turnCounter = 1;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.player.controllerType = "ai";
  game.bot.controllerType = "ai";
  game.chainSystem.offerChainResponses = async () => ({
    consecutivePasses: 2,
    offers: 1,
    activations: 0,
  });
  t.after(() => game.dispose("dragon_eclipse_engine_test_complete"));
  return game;
}

function simulatedCard(id, instanceId) {
  return {
    ...structuredClone(getDefinition(id)),
    instanceId,
    owner: "bot",
    controller: "bot",
    isFacedown: false,
    position: "attack",
  };
}

function createSimulationState() {
  return {
    _isPerspectiveState: true,
    turnCounter: 1,
    bot: {
      id: "bot",
      hand: [],
      field: [],
      deck: [],
      graveyard: [],
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

test("Solar e Lunar declaram auto-banimento como custo e escolha na resolução", () => {
  const validation = validateCardDatabase();
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 0);

  for (const [cardId, effectId, zone] of [
    [CARD_IDS.solar, EFFECT_IDS.solarGraveyard, "graveyard"],
    [CARD_IDS.lunar, EFFECT_IDS.lunarGraveyard, "deck"],
  ]) {
    const effect = getEffect(cardId, effectId);
    assert.deepEqual(effect.activationCosts, [
      {
        type: "move",
        targetRef: "self",
        player: "self",
        fromZone: "graveyard",
        to: "banished",
        contextLabel: "cost",
      },
    ]);
    assert.deepEqual(effect.targets || [], []);
    assert.equal(effect.actions.length, 1);
    assert.deepEqual(effect.actions[0], {
      type: "special_summon_from_zone",
      zone,
      filters: {
        cardKind: "monster",
        type: "Dragon",
        maxLevel: 4,
      },
      count: { min: 1, max: 1 },
      position: "choice",
      promptPlayer: true,
    });
  }
});

test("fontes descartadas como custo continuam a ativação canônica", async (t) => {
  await t.test("Solar Eclipse Dragon", async (t) => {
    const game = createGame(t);
    const solar = makeCard(CARD_IDS.solar, game.player);
    const lunar = makeCard(CARD_IDS.lunar, game.player);
    game.player.hand.push(solar);
    game.player.deck.push(lunar);

    const result = await game.tryActivateMonsterEffect(
      solar,
      null,
      "hand",
      game.player,
      { effectId: EFFECT_IDS.solarHand },
    );

    assert.equal(result.success, true);
    assert.equal(game.player.graveyard.includes(solar), true);
    assert.equal(game.player.field.includes(lunar), true);
  });

  await t.test("Stelya, Dragon Tamer", async (t) => {
    const game = createGame(t);
    const stelya = makeCard(CARD_IDS.stelya, game.player);
    const discard = makeCard(CARD_IDS.solar, game.player);
    const searched = makeCard(CARD_IDS.luminous, game.player);
    game.player.hand.push(stelya, discard);
    game.player.deck.push(searched);

    const result = await game.tryActivateMonsterEffect(
      stelya,
      { stelya_discard_other_card: [discard] },
      "hand",
      game.player,
      { effectId: EFFECT_IDS.stelyaSearch },
    );

    assert.equal(result.success, true);
    assert.equal(game.player.graveyard.includes(stelya), true);
    assert.equal(game.player.graveyard.includes(discard), true);
    assert.equal(game.player.hand.includes(searched), true);
    assert.equal(
      game.checkEffectUsage({
        card: stelya,
        player: game.player,
        effect: getEffect(CARD_IDS.stelya, EFFECT_IDS.stelyaSearch),
      }).ok,
      false,
    );
  });
});

test("Solar e Lunar pagam o custo antes da resposta e não declaram alvo", async (t) => {
  for (const scenario of [
    {
      label: "Solar",
      cardId: CARD_IDS.solar,
      effectId: EFFECT_IDS.solarGraveyard,
      targetZone: "graveyard",
    },
    {
      label: "Lunar",
      cardId: CARD_IDS.lunar,
      effectId: EFFECT_IDS.lunarGraveyard,
      targetZone: "deck",
    },
  ]) {
    await t.test(scenario.label, async (t) => {
      const game = createGame(t);
      const source = makeCard(scenario.cardId, game.player);
      const target = makeCard(CARD_IDS.armored, game.player);
      game.player.graveyard.push(source);
      game.player[scenario.targetZone].push(target);

      let observedAtResponse = false;
      game.chainSystem.offerChainResponses = async () => {
        const link = game.chainSystem.getLastChainLink();
        if (link) {
          observedAtResponse =
            observedAtResponse ||
            (game.player.banished.includes(source) &&
              link.costsPaid === true &&
              link.sourceMoved === true &&
              link.sourceAtActivation?.zone === "graveyard" &&
              Object.keys(link.targetSelections || {}).length === 0);
          link.effectNegated = true;
        }
        return { consecutivePasses: 2, offers: 1, activations: 0 };
      };

      const result = await game.tryActivateMonsterEffect(
        source,
        null,
        "graveyard",
        game.player,
        { effectId: scenario.effectId },
      );

      assert.equal(result.success, true);
      assert.equal(observedAtResponse, true);
      assert.equal(game.player.banished.includes(source), true);
      assert.equal(game.player[scenario.targetZone].includes(target), true);
      assert.equal(game.player.field.includes(target), false);
    });
  }
});

test("Solar e Lunar escolhem e Invocam somente durante a resolução", async (t) => {
  for (const scenario of [
    {
      label: "Solar",
      cardId: CARD_IDS.solar,
      effectId: EFFECT_IDS.solarGraveyard,
      targetZone: "graveyard",
    },
    {
      label: "Lunar",
      cardId: CARD_IDS.lunar,
      effectId: EFFECT_IDS.lunarGraveyard,
      targetZone: "deck",
    },
  ]) {
    await t.test(scenario.label, async (t) => {
      const game = createGame(t);
      const source = makeCard(scenario.cardId, game.player);
      const target = makeCard(CARD_IDS.armored, game.player);
      game.player.graveyard.push(source);
      game.player[scenario.targetZone].push(target);

      const result = await game.tryActivateMonsterEffect(
        source,
        null,
        "graveyard",
        game.player,
        { effectId: scenario.effectId },
      );

      assert.equal(result.success, true);
      assert.equal(game.player.banished.includes(source), true);
      assert.equal(game.player[scenario.targetZone].includes(target), false);
      assert.equal(game.player.field.includes(target), true);
    });
  }
});

test("modal do Cemitério aceita a fonte banida pelo próprio custo", async (t) => {
  const game = createGame(t);
  const solar = makeCard(CARD_IDS.solar, game.player);
  const target = makeCard(CARD_IDS.armored, game.player);
  const effect = getEffect(CARD_IDS.solar, EFFECT_IDS.solarGraveyard);
  game.player.graveyard.push(solar, target);

  const result = await game.runActivationPipeline({
    card: solar,
    owner: game.player,
    activationZone: "graveyard",
    activationContext: {
      fromHand: false,
      activationZone: "graveyard",
      sourceZone: "graveyard",
      effectId: effect.id,
      committed: false,
    },
    selectionKind: "graveyardEffect",
    guardKind: "graveyard_effect",
    phaseReq: ["main1", "main2"],
    oncePerTurn: { card: solar, player: game.player, effect },
    activate: (chosen, context) =>
      game.effectEngine.activateMonsterFromGraveyard(
        solar,
        game.player,
        chosen,
        context,
      ),
    finalize: () => {},
  });

  assert.equal(result.success, true);
  assert.equal(game.player.banished.includes(solar), true);
  assert.equal(game.player.field.includes(target), true);
});

test("simulação Dragon respeita os limites dos efeitos Eclipse", () => {
  const solarHandState = createSimulationState();
  solarHandState.bot.hand.push(
    simulatedCard(CARD_IDS.solar, "solar-hand-1"),
    simulatedCard(CARD_IDS.solar, "solar-hand-2"),
  );
  solarHandState.bot.deck.push(
    simulatedCard(CARD_IDS.lunar, "lunar-deck-1"),
    simulatedCard(CARD_IDS.lunar, "lunar-deck-2"),
  );
  simulateMainPhaseAction(solarHandState, {
    type: "handIgnition",
    index: 0,
    cardId: CARD_IDS.solar,
    effectId: EFFECT_IDS.solarHand,
  });
  simulateMainPhaseAction(solarHandState, {
    type: "handIgnition",
    index: solarHandState.bot.hand.findIndex(
      (card) => card.id === CARD_IDS.solar,
    ),
    cardId: CARD_IDS.solar,
    effectId: EFFECT_IDS.solarHand,
  });
  assert.equal(
    solarHandState.bot.field.filter((card) => card.id === CARD_IDS.lunar)
      .length,
    1,
  );
  assert.equal(
    solarHandState.bot.graveyard.filter((card) => card.id === CARD_IDS.solar)
      .length,
    1,
  );

  for (const scenario of [
    {
      cardId: CARD_IDS.solar,
      effectId: EFFECT_IDS.solarGraveyard,
      targetZone: "graveyard",
    },
    {
      cardId: CARD_IDS.lunar,
      effectId: EFFECT_IDS.lunarGraveyard,
      targetZone: "deck",
    },
  ]) {
    const state = createSimulationState();
    state.bot.graveyard.push(
      simulatedCard(scenario.cardId, `${scenario.effectId}-1`),
      simulatedCard(scenario.cardId, `${scenario.effectId}-2`),
    );
    if (scenario.cardId === CARD_IDS.solar) {
      state.bot.graveyard.push(
        simulatedCard(scenario.cardId, `${scenario.effectId}-3`),
      );
    }
    state.bot[scenario.targetZone].push(
      simulatedCard(CARD_IDS.armored, `${scenario.effectId}-target-1`),
      simulatedCard(CARD_IDS.armored, `${scenario.effectId}-target-2`),
    );
    state.player.field.push({
      ...simulatedCard(CARD_IDS.armored, `${scenario.effectId}-threat`),
      owner: "player",
      controller: "player",
    });

    simulateMainPhaseAction(state, {
      type: "graveyardMonsterEffect",
      cardId: scenario.cardId,
      effectId: scenario.effectId,
    });
    simulateMainPhaseAction(state, {
      type: "graveyardMonsterEffect",
      cardId: scenario.cardId,
      effectId: scenario.effectId,
    });

    assert.equal(
      state.bot.banished.filter((card) => card.id === scenario.cardId).length,
      1,
    );
    assert.equal(
      state.bot.field.length,
      1,
    );
    assert.equal(
      state.bot.graveyard.some((card) => card.id === scenario.cardId),
      true,
    );
    assert.equal(
      analyzeDragonState({
        game: state,
        bot: state.bot,
        opponent: state.player,
        isSimulatedState: true,
      }).opt[
        scenario.effectId === EFFECT_IDS.solarGraveyard ? "solarGy" : "lunarGy"
      ].canUse,
      false,
    );
  }
});
