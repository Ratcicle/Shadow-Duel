import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import Card from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { selectSimulatedTargets } from "../src/core/ai/common/targetSelection.js";
import Game from "../src/core/Game.js";
import { getSynchroMaterialCombos } from "../src/core/game/summon/synchro.js";
import { cardDatabaseById } from "../src/data/cards.js";
import { getCardIdRangeByKey } from "../src/data/cards/ranges.js";
import {
  createChainHarness,
  createTestCard,
  placeCard,
} from "./chain/helpers/chainHarness.js";

const SURVEYOR_ID = 551;
const EXCAVATOR_ID = 552;
const COREBREAKER_ID = 553;
const EXCAVATION_ID = 554;

function getCardDefinition(id) {
  const card = cardDatabaseById.get(id);
  assert.ok(card, `Expected card definition ${id}.`);
  return card;
}

function getEffect(cardId, effectId) {
  const effect = getCardDefinition(cardId).effects.find(
    (entry) => entry.id === effectId,
  );
  assert.ok(effect, `Expected ${effectId}.`);
  return effect;
}

function makeRuntimeCard(definition, ownerId) {
  const card = new Card(structuredClone(definition), ownerId);
  card.owner = ownerId;
  card.controller = ownerId;
  return card;
}

function makeMonster(overrides = {}, ownerId = "player") {
  return makeRuntimeCard(
    {
      id: overrides.id ?? 9900,
      name: overrides.name || "Test EARTH Monster",
      cardKind: "monster",
      atk: overrides.atk ?? 1000,
      def: overrides.def ?? 1000,
      level: overrides.level ?? 4,
      type: overrides.type || "Machine",
      attribute: overrides.attribute || "Earth",
      ...overrides,
    },
    ownerId,
  );
}

test("Vulcanomaton registra IDs, artes, Reguladores e contratos canônicos", () => {
  const validation = validateCardDatabase();
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 0);

  const range = getCardIdRangeByKey("vulcanomaton");
  assert.deepEqual(
    { start: range.start, end: range.end },
    { start: 551, end: 600 },
  );

  const surveyor = getCardDefinition(SURVEYOR_ID);
  const excavator = getCardDefinition(EXCAVATOR_ID);
  for (const card of [surveyor, excavator]) {
    assert.equal(card.cardKind, "monster");
    assert.equal(card.type, "Machine");
    assert.equal(card.attribute, "Earth");
    assert.equal(card.isTuner, true);
    assert.equal(card.archetype, "Vulcanomaton");
    assert.equal(existsSync(card.image), true, `${card.name} art must exist.`);
  }
  assert.deepEqual(
    [surveyor.level, surveyor.atk, surveyor.def],
    [3, 1300, 1500],
  );
  assert.deepEqual(
    [excavator.level, excavator.atk, excavator.def],
    [4, 1600, 1800],
  );

  const surveyorNormal = getEffect(
    SURVEYOR_ID,
    "vulcanomaton_surveyor_normal_search_and_summon",
  );
  assert.equal(surveyorNormal.usagePolicy, "use");
  assert.equal(surveyorNormal.targets[0].intent, "cost");
  assert.equal(surveyorNormal.activationCosts[0].type, "move");
  assert.deepEqual(
    surveyorNormal.actions.map((action) => action.type),
    ["search_any", "special_summon_from_zone"],
  );

  const excavatorMaterial = getEffect(
    EXCAVATOR_ID,
    "vulcanomaton_excavator_synchro_draw",
  );
  assert.equal(excavatorMaterial.triggerRequirement, "mandatory");
  assert.equal(excavatorMaterial.contextLabel, "synchro_material");
  assert.equal(excavatorMaterial.actions[0].type, "draw");
});

test("Topógrafo ativa somente na Invocação-Normal e paga o descarte antes da resolução", async (t) => {
  const game = new Game({
    captureReplay: false,
    disableChains: true,
    laboratoryMode: true,
  });
  t.after(() => game.dispose());
  game.player.controllerType = "ai";

  const surveyor = makeRuntimeCard(getCardDefinition(SURVEYOR_ID), game.player.id);
  const deckCard = makeRuntimeCard(getCardDefinition(EXCAVATOR_ID), game.player.id);
  const discard = makeMonster({ id: 9901, name: "Discard" }, game.player.id);
  game.player.field.push(surveyor);
  game.player.deck.push(deckCard);
  game.player.hand.push(discard);

  const normal = await game.effectEngine.collectAfterSummonTriggers({
    card: surveyor,
    player: game.player,
    method: "normal",
    fromZone: "hand",
  });
  assert.equal(normal.entries.length, 1);
  assert.equal(
    normal.entries[0].effect.id,
    "vulcanomaton_surveyor_normal_search_and_summon",
  );

  const special = await game.effectEngine.collectAfterSummonTriggers({
    card: surveyor,
    player: game.player,
    method: "special",
    fromZone: "hand",
  });
  assert.equal(special.entries.length, 0);

  let harness;
  harness = createChainHarness({
    async onActions(actions, _ctx, targets) {
      for (const action of actions || []) {
        if (action.type !== "move") continue;
        for (const card of targets[action.targetRef] || []) {
          await harness.game.moveCard(card, harness.player, action.to, {
            fromZone: action.fromZone,
            contextLabel: action.contextLabel,
          });
        }
      }
      return { success: true };
    },
  });
  const source = createTestCard({
    ...structuredClone(getCardDefinition(SURVEYOR_ID)),
    instanceId: "surveyor-source",
  });
  const cost = createTestCard({ instanceId: "surveyor-discard" });
  placeCard(harness.player, "field", source);
  placeCard(harness.player, "hand", cost);
  const effect = getEffect(
    SURVEYOR_ID,
    "vulcanomaton_surveyor_normal_search_and_summon",
  );
  const prepared = await harness.chain.prepareChainResponse(
    {
      card: source,
      effect,
      effectId: effect.id,
      sourceZone: "field",
      sourceLocationVersion: 0,
      context: {
        type: "main_phase_action",
        event: "after_summon",
        player: harness.player,
        triggerPlayer: harness.player,
        openState: true,
        legalWindow: true,
      },
    },
    harness.player,
    {
      type: "main_phase_action",
      event: "after_summon",
      player: harness.player,
      triggerPlayer: harness.player,
      openState: true,
      legalWindow: true,
    },
  );
  assert.equal(prepared.success, true);
  assert.equal(harness.player.graveyard.includes(cost), true);
  assert.equal(harness.trace.moves[0].options.contextLabel, "cost");
  assert.deepEqual(prepared.preparedActivation.targetSelections, {});
});

test("Topógrafo busca antes de Invocar da mão e nega o monstro Invocado enquanto face-up", async (t) => {
  const game = new Game({
    captureReplay: false,
    disableChains: true,
    laboratoryMode: true,
  });
  t.after(() => game.dispose());
  game.player.controllerType = "ai";

  const surveyor = makeRuntimeCard(getCardDefinition(SURVEYOR_ID), game.player.id);
  const searched = makeRuntimeCard(getCardDefinition(EXCAVATOR_ID), game.player.id);
  const earthMonster = makeMonster({ id: 9902, name: "Hand EARTH" }, game.player.id);
  game.player.field.push(surveyor);
  game.player.deck.push(searched);
  game.player.hand.push(earthMonster);

  const effect = getEffect(
    SURVEYOR_ID,
    "vulcanomaton_surveyor_normal_search_and_summon",
  );
  const result = await game.effectEngine.applyActions(
    [
      effect.actions[0],
      { ...effect.actions[1], position: "attack" },
    ],
    {
      source: surveyor,
      player: game.player,
      opponent: game.bot,
      effect,
    },
    {},
  );

  assert.equal(result.success, true);
  assert.equal(game.player.deck.includes(searched), false);
  assert.equal(game.player.field.includes(searched), true);
  assert.equal(searched.effectsNegated, true);
  assert.equal(searched.effectsNegatedDuration, "while_faceup");
  assert.equal(game.player.hand.includes(earthMonster), true);
});

test("Escavador ativa após Invocação-Normal ou Especial e encadeia reviver para recuperar", async (t) => {
  const game = new Game({
    captureReplay: false,
    disableChains: true,
    laboratoryMode: true,
  });
  t.after(() => game.dispose());
  game.player.controllerType = "ai";

  const excavator = makeRuntimeCard(getCardDefinition(EXCAVATOR_ID), game.player.id);
  const revive = makeMonster({ id: 9903, name: "Revive EARTH" }, game.player.id);
  const recover = makeRuntimeCard(getCardDefinition(SURVEYOR_ID), game.player.id);
  game.player.field.push(excavator);
  game.player.graveyard.push(revive, recover);
  const effect = getEffect(
    EXCAVATOR_ID,
    "vulcanomaton_excavator_summon_revive_and_recover",
  );

  for (const method of ["normal", "special"]) {
    const triggers = await game.effectEngine.collectAfterSummonTriggers({
      card: excavator,
      player: game.player,
      method,
      fromZone: "hand",
    });
    assert.equal(triggers.entries.length, 1, `Expected ${method} trigger.`);
  }

  const result = await game.effectEngine.applyActions(
    [
      { ...effect.actions[0], position: "attack" },
      effect.actions[1],
    ],
    {
      source: excavator,
      player: game.player,
      opponent: game.bot,
      effect,
    },
    { vulcanomaton_excavator_revive_target: [revive] },
  );
  assert.equal(result.success, true);
  assert.equal(game.player.field.includes(revive), true);
  assert.equal(revive.effectsNegated, true);
  assert.equal(game.player.hand.includes(recover), true);
  assert.equal(game.player.graveyard.includes(recover), false);
});

test("Escavador não recupera se o alvo de reviver não estiver mais no Cemitério", async (t) => {
  const game = new Game({
    captureReplay: false,
    disableChains: true,
    laboratoryMode: true,
  });
  t.after(() => game.dispose());

  const excavator = makeRuntimeCard(getCardDefinition(EXCAVATOR_ID), game.player.id);
  const invalid = makeMonster({ id: 9904, name: "Invalid revive" }, game.player.id);
  const recover = makeRuntimeCard(getCardDefinition(SURVEYOR_ID), game.player.id);
  game.player.field.push(excavator);
  game.player.hand.push(invalid);
  game.player.graveyard.push(recover);
  const effect = getEffect(
    EXCAVATOR_ID,
    "vulcanomaton_excavator_summon_revive_and_recover",
  );

  const result = await game.effectEngine.applyActions(
    [{ ...effect.actions[0], position: "attack" }, effect.actions[1]],
    {
      source: excavator,
      player: game.player,
      opponent: game.bot,
      effect,
    },
    { vulcanomaton_excavator_revive_target: [invalid] },
  );
  assert.equal(result.success, false);
  assert.equal(game.player.graveyard.includes(recover), true);
  assert.equal(game.player.hand.includes(recover), false);
});

test("Triggers de Matéria Sincro exigem o contexto canônico e o do Escavador compra", async (t) => {
  const game = new Game({
    captureReplay: false,
    disableChains: true,
    laboratoryMode: true,
  });
  t.after(() => game.dispose());

  const surveyor = makeRuntimeCard(getCardDefinition(SURVEYOR_ID), game.player.id);
  const excavator = makeRuntimeCard(getCardDefinition(EXCAVATOR_ID), game.player.id);
  const handVulcanomaton = makeRuntimeCard(getCardDefinition(EXCAVATOR_ID), game.player.id);
  const drawCard = makeMonster({ id: 9905, name: "Draw card" }, game.player.id);
  game.player.field.push(surveyor, excavator);
  game.player.hand.push(handVulcanomaton);
  game.player.deck.push(drawCard);

  const wrongContext = await game.effectEngine.collectCardToGraveTriggers({
    card: surveyor,
    player: game.player,
    opponent: game.bot,
    fromZone: "field",
    toZone: "graveyard",
    contextLabel: "effect_cost",
  });
  assert.equal(wrongContext.entries.length, 0);

  const surveyorMaterial = await game.effectEngine.collectCardToGraveTriggers({
    card: surveyor,
    player: game.player,
    opponent: game.bot,
    fromZone: "field",
    toZone: "graveyard",
    contextLabel: "synchro_material",
  });
  assert.equal(surveyorMaterial.entries.length, 1);
  assert.equal(
    surveyorMaterial.entries[0].effect.id,
    "vulcanomaton_surveyor_synchro_summon",
  );

  const excavatorMaterial = await game.effectEngine.collectCardToGraveTriggers({
    card: excavator,
    player: game.player,
    opponent: game.bot,
    fromZone: "field",
    toZone: "graveyard",
    contextLabel: "synchro_material",
  });
  assert.equal(excavatorMaterial.entries.length, 1);
  const drawEffect = excavatorMaterial.entries[0].effect;
  const drawResult = await game.effectEngine.applyActions(
    drawEffect.actions,
    {
      source: excavator,
      player: game.player,
      opponent: game.bot,
      effect: drawEffect,
    },
    {},
  );
  assert.equal(drawResult.success, true);
  assert.equal(game.player.hand.includes(drawCard), true);
});

test("simulação preserva o custo, a busca e a negação do Topógrafo", () => {
  const effect = getEffect(
    SURVEYOR_ID,
    "vulcanomaton_surveyor_normal_search_and_summon",
  );
  const source = {
    ...structuredClone(getCardDefinition(SURVEYOR_ID)),
    instanceId: "sim-surveyor",
    owner: "bot",
    controller: "bot",
  };
  const searched = {
    ...structuredClone(getCardDefinition(EXCAVATOR_ID)),
    instanceId: "sim-excavator",
    owner: "bot",
    controller: "bot",
  };
  const discard = {
    id: 9906,
    instanceId: "sim-discard",
    name: "Simulation discard",
    cardKind: "monster",
    attribute: "Earth",
    level: 4,
    owner: "bot",
    controller: "bot",
  };
  const state = {
    bot: {
      id: "bot",
      field: [source],
      spellTrap: [],
      fieldSpell: null,
      hand: [discard],
      deck: [searched],
      graveyard: [],
      banished: [],
    },
    player: {
      id: "player",
      field: [],
      spellTrap: [],
      fieldSpell: null,
      hand: [],
      deck: [],
      graveyard: [],
      banished: [],
    },
  };
  const actions = [...effect.activationCosts, ...effect.actions];
  const selections = selectSimulatedTargets({
    targets: effect.targets,
    actions,
    state,
    sourceCard: source,
    selfId: "bot",
  });
  applySimulatedActions({
    actions,
    selections,
    state,
    selfId: "bot",
    options: { sourceCard: source },
  });

  assert.equal(state.bot.graveyard.includes(discard), true);
  assert.equal(state.bot.deck.includes(searched), false);
  assert.equal(state.bot.field.includes(searched), true);
  assert.equal(searched.effectsNegated, true);
  assert.equal(searched.effectsNegatedDuration, "while_faceup");
  assert.doesNotThrow(() => JSON.stringify(state));
});

test("Corebreaker and Excavation declare canonical contracts, limits, and art", () => {
  const corebreaker = getCardDefinition(COREBREAKER_ID);
  const excavation = getCardDefinition(EXCAVATION_ID);

  assert.deepEqual(
    [corebreaker.cardKind, corebreaker.type, corebreaker.attribute, corebreaker.isTuner],
    ["monster", "Machine", "Earth", true],
  );
  assert.deepEqual(
    [corebreaker.level, corebreaker.atk, corebreaker.def],
    [5, 1900, 2100],
  );
  assert.equal(existsSync(corebreaker.image), true);
  assert.equal(existsSync(excavation.image), true);
  assert.equal(excavation.cardKind, "spell");
  assert.equal(excavation.subtype, "normal");

  const handSummon = getEffect(
    COREBREAKER_ID,
    "vulcanomaton_corebreaker_hand_tribute_summon",
  );
  assert.deepEqual(handSummon.activationZones, ["hand"]);
  assert.equal(handSummon.timing, "ignition");
  assert.equal(handSummon.usagePolicy, "use");
  assert.equal(handSummon.targets[0].intent, "cost");
  assert.equal(handSummon.targets[0].requireFaceup, true);
  assert.equal(handSummon.activationCosts[0].contextLabel, "tribute_summon_cost");
  assert.equal(handSummon.actions[0].fieldSlotsFreedBeforeSummon, 1);

  const makeNonTuner = getEffect(
    COREBREAKER_ID,
    "vulcanomaton_corebreaker_make_non_tuner",
  );
  assert.equal(makeNonTuner.targets[0].excludeSelf, true);
  assert.equal(makeNonTuner.targets[0].isTuner, true);
  assert.deepEqual(makeNonTuner.actions[0], {
    type: "add_status",
    targetRef: "vulcanomaton_corebreaker_other_tuner",
    status: "isTuner",
    value: false,
    untilEndOfTurn: true,
  });

  const materialDestroy = getEffect(
    COREBREAKER_ID,
    "vulcanomaton_corebreaker_synchro_destroy",
  );
  assert.equal(materialDestroy.contextLabel, "synchro_material");
  assert.deepEqual(materialDestroy.targets[0].zones, [
    "field",
    "spellTrap",
    "fieldSpell",
  ]);
  assert.equal(materialDestroy.actions[0].type, "destroy_targeted_cards");

  const excavationEffect = getEffect(
    EXCAVATION_ID,
    "vulcanomaton_excavation_search_and_summon",
  );
  assert.equal(excavationEffect.usagePolicy, "activate");
  assert.equal(excavationEffect.actions[0].type, "add_from_zone_to_hand");
  assert.equal(
    excavationEffect.actions[0].resultRef,
    "vulcanomaton_excavation_added_monster",
  );
  assert.equal(excavationEffect.actions[1].type, "optional_target_actions");
});

test("Corebreaker pays its Tribute before the Chain Link and Special Summons without a Normal Summon", async (t) => {
  let harness;
  harness = createChainHarness({
    async onActions(actions, _ctx, targets) {
      for (const action of actions || []) {
        if (action.type !== "move") continue;
        for (const card of targets[action.targetRef] || []) {
          await harness.game.moveCard(card, harness.player, action.to, {
            fromZone: action.fromZone,
            contextLabel: action.contextLabel,
          });
        }
      }
      return { success: true };
    },
  });
  const source = createTestCard({
    ...structuredClone(getCardDefinition(COREBREAKER_ID)),
    instanceId: "corebreaker-source",
  });
  const tribute = createTestCard({
    instanceId: "corebreaker-tribute",
    cardKind: "monster",
    attribute: "Earth",
    isFacedown: false,
  });
  placeCard(harness.player, "hand", source);
  placeCard(harness.player, "field", tribute);
  const effect = getEffect(
    COREBREAKER_ID,
    "vulcanomaton_corebreaker_hand_tribute_summon",
  );
  const context = {
    type: "main_phase_action",
    event: "main_phase_action",
    player: harness.player,
    triggerPlayer: harness.player,
    openState: true,
    legalWindow: true,
  };
  const prepared = await harness.chain.prepareChainResponse(
    {
      card: source,
      effect,
      effectId: effect.id,
      sourceZone: "hand",
      sourceLocationVersion: 0,
      context,
    },
    harness.player,
    context,
  );
  assert.equal(prepared.success, true);
  assert.equal(harness.player.graveyard.includes(tribute), true);
  assert.equal(harness.player.hand.includes(source), true);
  assert.equal(harness.trace.moves[0].options.contextLabel, "tribute_summon_cost");
  assert.deepEqual(prepared.preparedActivation.targetSelections, {});

  const game = new Game({
    captureReplay: false,
    disableChains: true,
    laboratoryMode: true,
  });
  t.after(() => game.dispose());
  game.player.controllerType = "ai";
  const runtimeSource = makeRuntimeCard(
    getCardDefinition(COREBREAKER_ID),
    game.player.id,
  );
  const runtimeTribute = makeMonster(
    { id: 9910, name: "EARTH tribute" },
    game.player.id,
  );
  const fillers = [1, 2, 3, 4].map((index) =>
    makeMonster({ id: 9910 + index, name: `Filler ${index}` }, game.player.id),
  );
  game.player.hand.push(runtimeSource);
  game.player.field.push(runtimeTribute, ...fillers);
  const execution = await game.effectEngine.applyActions(
    [...effect.activationCosts, ...effect.actions],
    {
      source: runtimeSource,
      player: game.player,
      opponent: game.bot,
      effect,
    },
    { vulcanomaton_corebreaker_tribute_cost: [runtimeTribute] },
  );
  assert.equal(execution.success, true);
  assert.equal(game.player.graveyard.includes(runtimeTribute), true);
  assert.equal(game.player.field.includes(runtimeSource), true);
  assert.equal(game.player.field.length, 5);
  assert.equal(game.player.summonCount, 0);
});

test("Corebreaker makes another Tuner a non-Tuner, restores it, and triggers only as Synchro Material", async (t) => {
  const game = new Game({
    captureReplay: false,
    disableChains: true,
    laboratoryMode: true,
  });
  t.after(() => game.dispose());
  game.player.controllerType = "ai";
  const corebreaker = makeRuntimeCard(
    getCardDefinition(COREBREAKER_ID),
    game.player.id,
  );
  const tuner = makeMonster(
    { id: 9915, name: "Other Tuner", level: 2, isTuner: true },
    game.player.id,
  );
  const facedownTuner = makeMonster(
    {
      id: 9916,
      name: "Facedown Tuner",
      level: 2,
      isTuner: true,
    },
    game.player.id,
  );
  facedownTuner.isFacedown = true;
  game.player.field.push(corebreaker, tuner, facedownTuner);
  const effect = getEffect(
    COREBREAKER_ID,
    "vulcanomaton_corebreaker_make_non_tuner",
  );
  const candidates = game.effectEngine.selectCandidates(effect.targets[0], {
    source: corebreaker,
    player: game.player,
    opponent: game.bot,
    effect,
  }).candidates;
  assert.equal(candidates.includes(corebreaker), false);
  assert.equal(candidates.includes(facedownTuner), false);
  assert.equal(candidates.includes(tuner), true);

  const changed = await game.effectEngine.applyActions(
    effect.actions,
    { source: corebreaker, player: game.player, opponent: game.bot, effect },
    { vulcanomaton_corebreaker_other_tuner: [tuner] },
  );
  assert.equal(changed.success, true);
  assert.equal(tuner.isTuner, false);
  assert.equal(
    game.getPublicState(game.player.id).players.self.field.find(
      (card) => card.name === "Other Tuner",
    ).isTuner,
    false,
  );

  const synchro = {
    id: 9917,
    instanceId: "test-synchro",
    cardKind: "monster",
    monsterType: "synchro",
    level: 7,
    synchro: { tunerCount: 1, nonTunerMin: 1 },
  };
  const combos = getSynchroMaterialCombos.call(game, game.player, synchro);
  assert.equal(
    combos.some(
      (combo) => combo.includes(corebreaker) && combo.includes(tuner),
    ),
    true,
  );

  game.cleanupTempBoosts(game.player);
  assert.equal(tuner.isTuner, true);
  const changedAgain = await game.effectEngine.applyActions(
    effect.actions,
    { source: corebreaker, player: game.player, opponent: game.bot, effect },
    { vulcanomaton_corebreaker_other_tuner: [tuner] },
  );
  assert.equal(changedAgain.success, true);
  await game.moveCard(tuner, game.player, "graveyard", {
    fromZone: "field",
    skipAnimation: true,
    awaitEvents: true,
  });
  assert.equal(tuner.isTuner, true);

  const materialEffect = getEffect(
    COREBREAKER_ID,
    "vulcanomaton_corebreaker_synchro_destroy",
  );
  const opponentMonster = makeMonster(
    { id: 9918, name: "Opponent monster" },
    game.bot.id,
  );
  const opponentSpell = makeRuntimeCard(
    { id: 9919, name: "Opponent spell", cardKind: "spell", subtype: "normal" },
    game.bot.id,
  );
  const opponentField = makeRuntimeCard(
    { id: 9920, name: "Opponent field", cardKind: "spell", subtype: "field" },
    game.bot.id,
  );
  game.bot.field.push(opponentMonster);
  game.bot.spellTrap.push(opponentSpell);
  game.bot.fieldSpell = opponentField;
  const wrongContext = await game.effectEngine.collectCardToGraveTriggers({
    card: corebreaker,
    player: game.player,
    opponent: game.bot,
    fromZone: "field",
    toZone: "graveyard",
    contextLabel: "effect_cost",
  });
  assert.equal(wrongContext.entries.length, 0);
  const materialContext = await game.effectEngine.collectCardToGraveTriggers({
    card: corebreaker,
    player: game.player,
    opponent: game.bot,
    fromZone: "field",
    toZone: "graveyard",
    contextLabel: "synchro_material",
  });
  assert.equal(materialContext.entries.length, 1);
  assert.equal(materialContext.entries[0].effect.id, materialEffect.id);

  for (const target of [opponentMonster, opponentSpell, opponentField]) {
    const result = await game.effectEngine.applyActions(
      materialEffect.actions,
      {
        source: corebreaker,
        player: game.player,
        opponent: game.bot,
        effect: materialEffect,
      },
      { vulcanomaton_corebreaker_destroy_target: [target] },
    );
    assert.equal(result.success, true);
    assert.equal(game.bot.graveyard.includes(target), true);
  }
});

test("Excavation searches the exact monster and only Special Summons with its condition", async (t) => {
  const game = new Game({
    captureReplay: false,
    disableChains: true,
    laboratoryMode: true,
  });
  t.after(() => game.dispose());
  game.player.controllerType = "ai";
  const source = makeRuntimeCard(
    getCardDefinition(EXCAVATION_ID),
    game.player.id,
  );
  const conditionMonster = makeRuntimeCard(
    getCardDefinition(SURVEYOR_ID),
    game.player.id,
  );
  const added = makeMonster(
    { id: 9921, name: "Added EARTH", attribute: "Earth", level: 4 },
    game.player.id,
  );
  const existingHand = makeMonster(
    { id: 9922, name: "Existing EARTH", attribute: "Earth", level: 4 },
    game.player.id,
  );
  const invalid = makeMonster(
    { id: 9923, name: "Invalid level", attribute: "Earth", level: 5 },
    game.player.id,
  );
  game.player.field.push(conditionMonster);
  game.player.hand.push(existingHand);
  game.player.deck.push(added, invalid);
  const effect = getEffect(
    EXCAVATION_ID,
    "vulcanomaton_excavation_search_and_summon",
  );
  const result = await game.effectEngine.applyActions(
    effect.actions,
    { source, player: game.player, opponent: game.bot, effect },
    {},
  );
  assert.equal(result.success, true);
  assert.equal(game.player.field.includes(added), true);
  assert.equal(game.player.hand.includes(existingHand), true);
  assert.equal(game.player.deck.includes(invalid), true);

  const noConditionGame = new Game({
    captureReplay: false,
    disableChains: true,
    laboratoryMode: true,
  });
  t.after(() => noConditionGame.dispose());
  noConditionGame.player.controllerType = "ai";
  const noConditionAdded = makeMonster(
    { id: 9924, name: "No-condition EARTH", attribute: "Earth", level: 4 },
    noConditionGame.player.id,
  );
  noConditionGame.player.deck.push(noConditionAdded);
  const noConditionResult = await noConditionGame.effectEngine.applyActions(
    effect.actions,
    {
      source: makeRuntimeCard(getCardDefinition(EXCAVATION_ID), noConditionGame.player.id),
      player: noConditionGame.player,
      opponent: noConditionGame.bot,
      effect,
    },
    {},
  );
  assert.equal(noConditionResult.success, true);
  assert.equal(noConditionGame.player.hand.includes(noConditionAdded), true);
  assert.equal(noConditionGame.player.field.includes(noConditionAdded), false);
});

test("Excavation releases its activate limit when its card activation is negated", () => {
  const { chain, game, player } = createChainHarness();
  const card = createTestCard({
    ...structuredClone(getCardDefinition(EXCAVATION_ID)),
    instanceId: "excavation-source",
  });
  const effect = getEffect(
    EXCAVATION_ID,
    "vulcanomaton_excavation_search_and_summon",
  );
  const link = chain.addToChain(
    chain.createPreparedActivation({
      card,
      controller: player,
      effect,
      activationZone: "spellTrap",
      committed: true,
      costsPaid: true,
    }),
  );

  assert.equal(chain.checkActivationUsage(card, player, effect).ok, false);
  chain.markChainLinkActivationNegated(link.linkId);
  chain.settleUsageForChainLink(link);

  assert.equal(link.usageReservation.status, "released");
  assert.equal(chain.checkActivationUsage(card, player, effect).ok, true);
});
