import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { cardMatchesFilter as cardMatchesSimFilter } from "../src/core/ai/common/cardFilters.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import Card from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import Game from "../src/core/Game.js";
import { cardMatchesFilters } from "../src/core/effects/filters/cardFilters.js";
import { createCanonicalStateSnapshot } from "../src/core/game/replay/canonical.js";
import {
  checkSpecialSummonEligibility,
} from "../src/core/game/summon/eligibility.js";
import {
  canUseAsSynchroMaterial,
  getSynchroMaterialCombos,
} from "../src/core/game/summon/synchro.js";
import {
  SUMMON_MODES,
  SUMMON_ORIGINS,
} from "../src/core/game/summon/transaction.js";
import { cardDatabaseById } from "../src/data/cards.js";

const ORATHUS_ID = 32;

function getOrathus() {
  const card = cardDatabaseById.get(ORATHUS_ID);
  assert.ok(card, "Orathus must be registered in the card database.");
  return card;
}

function getEffect(id) {
  const effect = getOrathus().effects.find((entry) => entry.id === id);
  assert.ok(effect, `Expected effect ${id}.`);
  return effect;
}

function runtimeCard(data, owner) {
  const card = new Card(data, owner.id);
  card.owner = owner.id;
  card.controller = owner.id;
  return card;
}

function createGame(t, options = {}) {
  const game = new Game({
    captureReplay: false,
    laboratoryMode: true,
    disableChains: options.disableChains === true,
    phaseDelayMs: 0,
    animationDelayMs: 0,
  });
  game.turn = game.player.id;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.player.controllerType = "ai";
  game.bot.controllerType = "ai";
  t.after(() => game.dispose("orathus_test_complete"));
  return game;
}

function material(overrides = {}) {
  return {
    instanceId: overrides.instanceId,
    cardKind: "monster",
    level: overrides.level,
    isTuner: overrides.isTuner === true,
    isFacedown: false,
    monsterType: overrides.monsterType || null,
    attribute: overrides.attribute || "Earth",
  };
}

async function waitUntil(predicate, message, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

test("Orathus declara dados, arte, localização e materiais Sincro canônicos", () => {
  const card = getOrathus();
  const validation = validateCardDatabase();
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 0);
  assert.deepEqual(
    {
      name: card.name,
      monsterType: card.monsterType,
      level: card.level,
      type: card.type,
      attribute: card.attribute,
      atk: card.atk,
      def: card.def,
      mustFirst: card.mustFirstBeSpecialSummonedBy,
      mustBeAttacked: card.mustBeAttacked,
    },
    {
      name: "Orathus, The Fallen Angel",
      monsterType: "synchro",
      level: 10,
      type: "Warrior",
      attribute: "Earth",
      atk: 3200,
      def: 2800,
      mustFirst: ["synchro"],
      mustBeAttacked: true,
    },
  );
  assert.equal(
    existsSync(
      new URL("../assets/Orathus, The Fallen Angel.png", import.meta.url),
    ),
    true,
  );
  const locale = JSON.parse(
    readFileSync(new URL("../src/locales/pt-br.json", import.meta.url), "utf8"),
  );
  assert.equal(locale.cards[ORATHUS_ID].name, "Orathus, o Anjo Caído");

  const tuner = material({ instanceId: "tuner", level: 2, isTuner: true });
  const earthSynchro = material({
    instanceId: "earth-synchro",
    level: 8,
    monsterType: "synchro",
    attribute: "Earth",
  });
  const ordinaryMonster = material({
    instanceId: "ordinary",
    level: 8,
    monsterType: null,
    attribute: "Earth",
  });
  const waterSynchro = material({
    instanceId: "water-synchro",
    level: 8,
    monsterType: "synchro",
    attribute: "Water",
  });
  const target = { ...card, instanceId: "orathus-extra" };
  const materialGame = { canUseAsSynchroMaterial };
  assert.deepEqual(
    getSynchroMaterialCombos.call(
      materialGame,
      { field: [tuner, earthSynchro, ordinaryMonster, waterSynchro] },
      target,
    ),
    [[tuner, earthSynchro]],
  );
});

test("Invocação correta é estabelecida somente após Sincro bem-sucedida e reinicia no Deck Adicional", async (t) => {
  const game = createGame(t, { disableChains: true });
  const orathus = runtimeCard(getOrathus(), game.player);
  game.player.extraDeck.push(orathus);

  assert.equal(
    checkSpecialSummonEligibility(orathus, {
      summonProcedure: "card_effect",
      fromZone: "graveyard",
    }).ok,
    false,
  );

  game.player.extraDeck.splice(game.player.extraDeck.indexOf(orathus), 1);
  game.player.graveyard.push(orathus);
  const blockedNextId = game.nextSummonId;
  const blockedRevival = await game.executeSummonTransaction(
    game.createPreparedSummon({
      card: orathus,
      controller: game.player,
      sourceZone: "graveyard",
      summonOrigin: SUMMON_ORIGINS.EFFECT_RESOLUTION,
      summonMode: SUMMON_MODES.SUMMON,
      summonMethod: "special",
      summonProcedure: "card_effect",
      perform: () => ({ success: true }),
    }),
  );
  assert.equal(blockedRevival.success, false);
  assert.equal(blockedRevival.summonId, null);
  assert.equal(game.nextSummonId, blockedNextId);
  game.player.graveyard.splice(game.player.graveyard.indexOf(orathus), 1);
  game.player.extraDeck.push(orathus);

  const prepared = game.createPreparedSummon({
    card: orathus,
    controller: game.player,
    sourceZone: "extraDeck",
    summonOrigin: SUMMON_ORIGINS.EFFECT_RESOLUTION,
    summonMode: SUMMON_MODES.SUMMON,
    summonMethod: "synchro",
    summonProcedure: "synchro",
    position: "attack",
    perform: (transaction) =>
      game.moveCard(orathus, game.player, "field", {
        fromZone: "extraDeck",
        position: "attack",
        isFacedown: false,
        summonMethodOverride: "synchro",
        summonProcedure: "synchro",
        summonOrigin: SUMMON_ORIGINS.EFFECT_RESOLUTION,
        summonTransaction: transaction,
      }),
  });
  const result = await game.executeSummonTransaction(prepared);
  assert.equal(result.success, true);
  assert.equal(orathus.properSummonEstablished, true);
  assert.equal(orathus.properSummonProcedure, "synchro");

  await game.moveCard(orathus, game.player, "graveyard", { fromZone: "field" });
  assert.equal(
    checkSpecialSummonEligibility(orathus, {
      summonProcedure: "card_effect",
      fromZone: "graveyard",
    }).ok,
    true,
  );
  await game.moveCard(orathus, game.player, "extraDeck", {
    fromZone: "graveyard",
  });
  assert.equal(orathus.properSummonEstablished, false);
  assert.equal(orathus.properSummonProcedure, null);
});

test("tentativa Sincro negada não estabelece a elegibilidade de revival", async (t) => {
  const game = createGame(t, { disableChains: true });
  const orathus = runtimeCard(getOrathus(), game.player);
  game.player.extraDeck.push(orathus);
  const prepared = game.createPreparedSummon({
    card: orathus,
    controller: game.player,
    sourceZone: "extraDeck",
    summonOrigin: SUMMON_ORIGINS.PROCEDURE,
    summonMode: SUMMON_MODES.SUMMON,
    summonMethod: "synchro",
    summonProcedure: "synchro",
    perform: async (transaction) => {
      game.markSummonNegated(transaction.summonId, {
        destination: "graveyard",
      });
      return { success: false, summonNegated: true };
    },
  });
  const result = await game.executeSummonTransaction(prepared);
  assert.equal(result.success, false);
  assert.equal(result.summonNegated, true);
  assert.equal(orathus.properSummonEstablished, false);
});

test("Trigger de Sincro nega qualquer card face-up enquanto ele permanecer face-up", async (t) => {
  const game = createGame(t, { disableChains: true });
  const orathus = runtimeCard(getOrathus(), game.player);
  const target = runtimeCard(
    {
      id: 99320,
      name: "Negated monster",
      cardKind: "monster",
      atk: 1000,
      def: 1000,
    },
    game.bot,
  );
  game.player.field.push(orathus);
  game.bot.field.push(target);

  const synchroTriggers = await game.effectEngine.collectAfterSummonTriggers({
    card: orathus,
    player: game.player,
    method: "synchro",
    fromZone: "extraDeck",
  });
  assert.equal(
    synchroTriggers.entries.some(
      (entry) => entry.effect.id === "orathus_synchro_summon_negate",
    ),
    true,
  );
  const otherSummon = await game.effectEngine.collectAfterSummonTriggers({
    card: orathus,
    player: game.player,
    method: "special",
    fromZone: "graveyard",
  });
  assert.equal(
    otherSummon.entries.some(
      (entry) => entry.effect.id === "orathus_synchro_summon_negate",
    ),
    false,
  );

  const effect = getEffect("orathus_synchro_summon_negate");
  const applied = await game.effectEngine.applyActions(
    effect.actions,
    { source: orathus, player: game.player, opponent: game.bot, effect },
    { orathus_negate_target: [target] },
  );
  assert.equal(applied.success, true);
  assert.equal(target.effectsNegated, true);
  assert.equal(target.effectsNegatedDuration, "while_faceup");

  await game.transferControl(target, game.player, { reason: "test_control" });
  assert.equal(target.effectsNegated, true);
  await game.effectEngine.applyActions(
    [{ type: "set_facedown_defense", targetRef: "target" }],
    { source: orathus, player: game.player, opponent: game.bot },
    { target: [target] },
  );
  assert.equal(target.effectsNegated, false);
  assert.equal(target.effectsNegatedDuration, null);

  const faceupSpell = runtimeCard(
    { id: 99321, name: "Face-up spell", cardKind: "spell", subtype: "continuous" },
    game.bot,
  );
  game.bot.spellTrap.push(faceupSpell);
  await game.effectEngine.applyActions(
    effect.actions,
    { source: orathus, player: game.player, opponent: game.bot, effect },
    { orathus_negate_target: [faceupSpell] },
  );
  assert.equal(faceupSpell.effectsNegated, true);
  await game.moveCard(faceupSpell, game.bot, "graveyard", {
    fromZone: "spellTrap",
  });
  assert.equal(faceupSpell.effectsNegated, false);
});

test("obrigação de ataque usa a lista canônica e é desligada por face-down ou negação", (t) => {
  const game = createGame(t, { disableChains: true });
  const first = runtimeCard(getOrathus(), game.player);
  const second = runtimeCard(getOrathus(), game.player);
  game.player.field.push(first, second);
  assert.equal(game.isActiveAttackPriorityTarget(first), true);
  assert.equal(game.isActiveAttackPriorityTarget(second), true);
  first.effectsNegated = true;
  assert.equal(game.isActiveAttackPriorityTarget(first), false);
  second.isFacedown = true;
  assert.equal(game.isActiveAttackPriorityTarget(second), false);
});

test("filtro de última origem distingue Deck Adicional de revival no runtime e na simulação", () => {
  const fromExtra = {
    cardKind: "monster",
    lastSummonedFromZone: "extraDeck",
  };
  const revived = {
    cardKind: "monster",
    monsterType: "synchro",
    lastSummonedFromZone: "graveyard",
  };
  const filter = {
    cardKind: "monster",
    lastSummonedFromZone: "extraDeck",
  };
  assert.equal(cardMatchesFilters(fromExtra, filter), true);
  assert.equal(cardMatchesFilters(revived, filter), false);
  assert.equal(cardMatchesSimFilter(fromExtra, filter), true);
  assert.equal(cardMatchesSimFilter(revived, filter), false);
});

test("compromisso da ativação proíbe ataque antes do Chain Link e é serializado", async (t) => {
  const game = createGame(t);
  const orathus = runtimeCard(getOrathus(), game.player);
  const effect = getEffect("orathus_destroy_extra_deck_summoned_monster");
  game.player.field.push(orathus);
  const prepared = game.chainSystem.createPreparedActivation({
    card: orathus,
    controller: game.player,
    effect,
    activationZone: "field",
    committed: true,
    costsPaid: true,
  });
  assert.equal(orathus.cannotAttackThisTurn, false);
  const committed = await game.chainSystem.applyActivationCommitActions(
    prepared,
  );
  assert.equal(committed.success, true);
  assert.equal(orathus.cannotAttackThisTurn, true);
  assert.equal(prepared.activationCommitment.status, "applied");

  const link = game.chainSystem.addToChain(prepared);
  assert.ok(link);
  assert.deepEqual(link.activationCommitment.actions, [
    { index: 0, type: "forbid_attack_this_turn", targetRef: null },
  ]);
  const summary = game.chainSystem.getChainSummary();
  assert.equal(summary[0].activationCommitment.status, "applied");
  assert.doesNotThrow(() => JSON.stringify(summary));
  link.activationNegated = true;
  assert.equal(orathus.cannotAttackThisTurn, true);

  const cancelledSource = runtimeCard(getOrathus(), game.player);
  game.player.field.push(cancelledSource);
  game.chainSystem.createPreparedActivation({
    card: cancelledSource,
    controller: game.player,
    effect,
    activationZone: "field",
  });
  assert.equal(cancelledSource.cannotAttackThisTurn, false);
});

test("pipeline humano aplica a proibição antes de solicitar o alvo", async (t) => {
  const game = createGame(t);
  game.player.controllerType = "human";
  const orathus = runtimeCard(getOrathus(), game.player);
  const target = runtimeCard(
    { id: 99324, name: "Extra Deck target", cardKind: "monster", atk: 2500, def: 2000 },
    game.bot,
  );
  target.lastSummonedFromZone = "extraDeck";
  game.player.field.push(orathus);
  game.bot.field.push(target);

  void game.tryActivateMonsterEffect(orathus, null, "field", game.player);
  await waitUntil(
    () => game.targetSelection?.kind === "target",
    "Orathus did not open its target selection.",
  );
  assert.equal(orathus.cannotAttackThisTurn, true);
  assert.equal(
    game.handleTargetSelectionClick(game.bot.id, 0, null, "field"),
    true,
  );
  game.advanceTargetSelection();
  await waitUntil(
    () => game.bot.graveyard.includes(target),
    "Orathus did not destroy the declared target.",
  );
  assert.equal(orathus.cannotAttackThisTurn, true);
});

test("alvo que deixa o campo não é substituído por outro monstro elegível", async (t) => {
  const game = createGame(t, { disableChains: true });
  const orathus = runtimeCard(getOrathus(), game.player);
  const effect = getEffect("orathus_destroy_extra_deck_summoned_monster");
  const declared = runtimeCard(
    { id: 99322, name: "Declared", cardKind: "monster", atk: 2000, def: 2000 },
    game.bot,
  );
  const replacement = runtimeCard(
    { id: 99323, name: "Replacement", cardKind: "monster", atk: 2100, def: 2100 },
    game.bot,
  );
  declared.lastSummonedFromZone = "extraDeck";
  replacement.lastSummonedFromZone = "extraDeck";
  game.player.field.push(orathus);
  game.bot.field.push(declared, replacement);
  await game.moveCard(declared, game.bot, "graveyard", { fromZone: "field" });

  await game.effectEngine.applyActions(
    effect.actions,
    { source: orathus, player: game.player, opponent: game.bot, effect },
    { orathus_destroy_target: [declared] },
  );
  assert.equal(game.bot.field.includes(replacement), true);
  assert.equal(game.bot.graveyard.includes(replacement), false);
});

test("Ignition rejeita Orathus que já atacou e simulação aplica a restrição de compromisso", (t) => {
  const game = createGame(t, { disableChains: true });
  const orathus = runtimeCard(getOrathus(), game.player);
  const effect = getEffect("orathus_destroy_extra_deck_summoned_monster");
  orathus.attacksUsedThisTurn = 1;
  const condition = game.effectEngine.evaluateConditions(effect.conditions, {
    source: orathus,
    player: game.player,
    opponent: game.bot,
    effect,
  });
  assert.equal(condition.ok, false);

  const simSource = {
    id: ORATHUS_ID,
    name: getOrathus().name,
    cardKind: "monster",
    cannotAttackThisTurn: false,
  };
  const state = {
    turnCounter: 3,
    bot: { id: "bot", field: [simSource] },
    player: { id: "player", field: [] },
  };
  applySimulatedActions({
    actions: effect.activationCommitActions,
    selections: {},
    state,
    selfId: "bot",
    options: { sourceCard: simSource },
  });
  assert.equal(simSource.cannotAttackThisTurn, true);

  orathus.properSummonEstablished = true;
  orathus.properSummonProcedure = "synchro";
  orathus.lastSummonMethod = "synchro";
  orathus.lastSummonedFromZone = "extraDeck";
  game.player.field.push(orathus);
  const publicState = game.getPublicState(game.player.id);
  const replayState = createCanonicalStateSnapshot(game);
  assert.equal(publicState.players.self.field[0].properSummonEstablished, true);
  assert.equal(publicState.players.self.field[0].lastSummonedFromZone, "extraDeck");
  assert.equal(
    replayState.players.player.zones.field[0].properSummonProcedure,
    "synchro",
  );
});
