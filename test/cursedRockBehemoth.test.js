import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { simulateGenericSpellEffect } from "../src/core/ai/common/simulation.js";
import { selectSimulatedTargets } from "../src/core/ai/common/targetSelection.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import Card from "../src/core/Card.js";
import Game from "../src/core/Game.js";
import { createCanonicalStateSnapshot } from "../src/core/game/replay/canonical.js";
import {
  canUseAsSynchroMaterial,
  getSynchroMaterialCombos,
} from "../src/core/game/summon/synchro.js";
import { cardDatabaseById } from "../src/data/cards.js";

const CURSED_ROCK_BEHEMOTH_ID = 29;

function getBehemoth() {
  const card = cardDatabaseById.get(CURSED_ROCK_BEHEMOTH_ID);
  assert.ok(card, "Cursed Rock Behemoth must be in the card database");
  return card;
}

function getEffect(id) {
  const effect = getBehemoth().effects.find((entry) => entry.id === id);
  assert.ok(effect, `Expected ${id}.`);
  return effect;
}

function createRuntimeCard(data, ownerId) {
  const card = new Card(data, ownerId);
  card.owner = ownerId;
  card.controller = ownerId;
  return card;
}

function createGame(t) {
  const game = new Game({
    captureReplay: false,
    disableChains: true,
    laboratoryMode: true,
    phaseDelayMs: 0,
    animationDelayMs: 0,
  });
  game.player.controllerType = "ai";
  game.bot.controllerType = "ai";
  t.after(() => game.dispose());
  return game;
}

function moveBetweenZones(card, from, to) {
  const index = from.indexOf(card);
  assert.ok(index >= 0, "Expected card in source zone.");
  from.splice(index, 1);
  to.push(card);
}

test("Cursed Rock Behemoth declara dados, arte, materiais e contratos canônicos", () => {
  const card = getBehemoth();
  const validation = validateCardDatabase();
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 0);

  assert.equal(card.name, "Cursed Rock Behemoth");
  assert.equal(card.monsterType, "synchro");
  assert.equal(card.level, 7);
  assert.equal(card.type, "Rock");
  assert.equal(card.attribute, "Earth");
  assert.equal(card.atk, 2300);
  assert.equal(card.def, 2400);
  assert.equal(
    existsSync(new URL("../public/assets/Cursed Rock Behemoth.png", import.meta.url)),
    true,
  );
  assert.deepEqual(card.synchro, {
    tunerCount: 1,
    nonTunerMin: 1,
    materialFilters: { tuner: { attribute: "Earth", isTuner: true } },
  });

  const gain = getEffect("cursed_rock_behemoth_gain_original_def");
  assert.equal(gain.timing, "ignition");
  assert.equal(gain.speed, 1);
  assert.deepEqual(gain.activationZones, ["field"]);
  assert.equal(gain.requireFaceup, true);
  assert.equal(gain.usagePolicy, "use");
  assert.deepEqual(gain.actions[0].atkBoostFromTarget, {
    targetRef: "cursed_rock_behemoth_atk_target",
    stat: "baseDef",
  });

  const control = getEffect("cursed_rock_behemoth_battle_control");
  assert.equal(control.event, "battle_destroy");
  assert.equal(control.requireSelfAsDestroyed, true);
  assert.equal(control.usagePolicy, "use");
  assert.equal(control.targets[0].targetFromContext, "battleDestroyer");
  assert.equal(control.targets[0].zone, "field");
  assert.equal(control.actions[0].type, "take_control");
  assert.equal(control.actions[0].duration, "until_end_phase");
  assert.equal(control.actions[1].bindEventTargetRef, control.targets[0].id);
  assert.equal(control.actions[1].duration, "until_consumed");
});

test("materiais exigem Regulador TERRA e aceitam não-Reguladores livres", () => {
  const behemoth = { ...getBehemoth(), instanceId: "behemoth" };
  const earthTuner = {
    instanceId: "earth-tuner",
    cardKind: "monster",
    isTuner: true,
    attribute: "Earth",
    level: 3,
    isFacedown: false,
  };
  const waterTuner = {
    instanceId: "water-tuner",
    cardKind: "monster",
    isTuner: true,
    attribute: "Water",
    level: 3,
    isFacedown: false,
  };
  const nonTuner = {
    instanceId: "non-tuner",
    cardKind: "monster",
    isTuner: false,
    attribute: "Fire",
    level: 4,
    isFacedown: false,
  };
  const player = { field: [earthTuner, waterTuner, nonTuner] };

  assert.deepEqual(getSynchroMaterialCombos.call({ canUseAsSynchroMaterial }, player, behemoth), [
    [earthTuner, nonTuner],
  ]);
});

test("o ganho usa DEF original inclusive contra alvo com a face para baixo e expira no fim do turno", async (t) => {
  const game = createGame(t);
  const behemoth = createRuntimeCard(getBehemoth(), game.player.id);
  const target = createRuntimeCard(
    {
      id: 9901,
      name: "Modified defender",
      cardKind: "monster",
      atk: 1000,
      def: 2600,
    },
    game.bot.id,
  );
  target.def = 400;
  target.isFacedown = true;
  game.player.field.push(behemoth);
  game.bot.field.push(target);

  const effect = getEffect("cursed_rock_behemoth_gain_original_def");
  const result = await game.effectEngine.applyActions(
    effect.actions,
    { source: behemoth, player: game.player, opponent: game.bot, effect },
    { cursed_rock_behemoth_atk_target: [target] },
  );

  assert.equal(result.success, true);
  assert.equal(behemoth.atk, 2300 + 2600);
  game.cleanupTempBoosts(game.player);
  assert.equal(behemoth.atk, 2300);
});

test("o Trigger usa somente o destruidor em campo e recusa destruição mútua ou alvo que saiu", async (t) => {
  const game = createGame(t);
  const behemoth = createRuntimeCard(getBehemoth(), game.player.id);
  const destroyer = createRuntimeCard(
    { id: 9902, name: "Battle destroyer", cardKind: "monster", atk: 3000, def: 1000 },
    game.bot.id,
  );
  game.player.graveyard.push(behemoth);
  game.bot.field.push(destroyer);

  const payload = {
    attacker: destroyer,
    destroyed: behemoth,
    attackerOwner: game.bot,
    destroyedOwner: game.player,
    battleDestroyer: destroyer,
    battleDestroyers: [destroyer],
  };
  const available = await game.effectEngine.collectBattleDestroyTriggers(payload);
  assert.equal(available.entries.length, 1);
  assert.equal(available.entries[0].effect.id, "cursed_rock_behemoth_battle_control");

  moveBetweenZones(destroyer, game.bot.field, game.bot.graveyard);
  const unavailable = await game.effectEngine.collectBattleDestroyTriggers(payload);
  assert.equal(unavailable.entries.length, 0);
});

test("destruição em batalha prepara a Chain e toma controle do destruidor", async (t) => {
  const game = new Game({
    captureReplay: false,
    laboratoryMode: true,
  });
  game.turn = game.bot.id;
  game.phase = "battle";
  game.battleStep = "battle";
  game.turnCounter = 2;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.player.controllerType = "human";
  game.bot.controllerType = "ai";
  game.ui.showTriggerOrderModal = ({ candidates }) => candidates;
  game.ui.showConfirmPrompt = () => true;
  t.after(() => game.dispose("cursed_rock_behemoth_chain_test_complete"));

  const behemoth = createRuntimeCard(getBehemoth(), game.player.id);
  behemoth.position = "attack";
  const destroyer = createRuntimeCard(
    {
      id: 9910,
      name: "Live battle destroyer",
      cardKind: "monster",
      atk: 3000,
      def: 1000,
      level: 7,
      type: "Warrior",
      attribute: "Dark",
      effects: [],
    },
    game.bot.id,
  );
  destroyer.position = "attack";
  game.player.field.push(behemoth);
  game.bot.field.push(destroyer);

  const preparedCounts = [];
  game.on("trigger_chain_prepared", ({ preparedCount }) => {
    preparedCounts.push(preparedCount);
  });

  const result = await game.resolveCombat(destroyer, behemoth);

  assert.equal(result.ok, true);
  assert.equal(game.player.graveyard.includes(behemoth), true);
  assert.equal(game.player.field.includes(destroyer), true);
  assert.equal(game.bot.field.includes(destroyer), false);
  assert.equal(destroyer.controller, game.player.id);
  assert.equal(game.getTemporaryControlState().length, 1);
  assert.equal(game.temporaryEventEffects.length, 1);
  assert.equal(preparedCounts.includes(1), true);
  assert.equal(game.chainSystem.isOpenGameState(), true);
});

test("controle temporário preserva dono original, não cria movimento e não sobrescreve controle posterior", async (t) => {
  const game = createGame(t);
  game.turnCounter = 7;
  const target = createRuntimeCard(
    { id: 9903, name: "Borrowed monster", cardKind: "monster", atk: 2000, def: 2000 },
    game.bot.id,
  );
  game.bot.field.push(target);
  const initialVersion = target.locationVersion;
  const events = [];
  game.on("control_changed", (payload) => events.push(payload));
  game.on("card_moved", () => assert.fail("Control change must not emit card_moved."));

  const first = await game.takeControl(target, game.player, {
    duration: "until_end_phase",
  });
  assert.equal(first.success, true);
  assert.equal(game.player.field.includes(target), true);
  assert.equal(target.owner, game.player.id);
  assert.equal(target.controller, game.player.id);
  assert.equal(target.originalOwner, game.bot.id);
  assert.equal(target.locationVersion, initialVersion);
  assert.equal(events.length, 1);
  assert.equal(game.getTemporaryControlState().length, 1);

  await game.transferControl(target, game.bot, { reason: "later_control_effect" });
  assert.equal(game.bot.field.includes(target), true);
  assert.equal(game.getTemporaryControlState().length, 0);
  await game.processTemporaryControlEffects();
  assert.equal(game.bot.field.includes(target), true);

  const snapshot = game.getPublicState(game.player.id);
  assert.equal(snapshot.players.opponent.field[0].originalOwner, game.bot.id);
  assert.doesNotThrow(() => JSON.stringify(snapshot));
});

test("vínculo imediato acompanha a instância após a devolução, consome a primeira saída e Invoca o Behemoth banível", async (t) => {
  const game = createGame(t);
  const behemoth = createRuntimeCard(getBehemoth(), game.player.id);
  const destroyer = createRuntimeCard(
    { id: 9904, name: "Bound destroyer", cardKind: "monster", atk: 3000, def: 1000 },
    game.bot.id,
  );
  game.player.graveyard.push(behemoth);
  game.bot.field.push(destroyer);
  const controlEffect = getEffect("cursed_rock_behemoth_battle_control");

  const controlled = await game.effectEngine.applyActions(
    controlEffect.actions,
    {
      source: behemoth,
      player: game.player,
      opponent: game.bot,
      effect: controlEffect,
      battleDestroyer: destroyer,
    },
    { cursed_rock_behemoth_destroyer: [destroyer] },
  );
  assert.equal(controlled.success, true);
  assert.equal(game.player.field.includes(destroyer), true);
  assert.equal(game.temporaryEventEffects.length, 1);

  // The temporary control returns at End Phase, but the instance-bound
  // leave-field watcher remains active independently of its controller.
  await game.processTemporaryControlEffects();
  assert.equal(game.bot.field.includes(destroyer), true);
  assert.equal(game.temporaryEventEffects.length, 1);

  moveBetweenZones(destroyer, game.bot.field, game.bot.graveyard);
  destroyer.owner = game.bot.id;
  destroyer.controller = game.bot.id;
  const triggers = await game.effectEngine.collectEventTriggers("card_moved", {
    card: destroyer,
    fromZone: "field",
    toZone: "graveyard",
    player: game.bot,
    fromPlayer: game.bot,
    toPlayer: game.bot,
    wasFaceupBeforeMove: true,
  });
  assert.equal(triggers.entries.length, 1);
  assert.equal(triggers.entries[0].card, behemoth);
  assert.equal(game.temporaryEventEffects.length, 0);

  const revived = await triggers.entries[0].config.activate(
    null,
    triggers.entries[0].config.activationContext,
  );
  assert.equal(revived.success, true);
  assert.equal(game.player.field.includes(behemoth), true);
  assert.equal(behemoth.banishWhenLeavesField, true);

  const leaveResult = await game.moveCard(behemoth, game.player, "graveyard", {
    fromZone: "field",
    skipAnimation: true,
  });
  assert.equal(leaveResult.success, true);
  assert.equal(game.player.banished.includes(behemoth), true);
  assert.equal(game.player.graveyard.includes(behemoth), false);
});

test("simulação preserva base DEF, controle, vínculo por instância e seleção de contexto por zona", () => {
  const behemoth = {
    ...structuredClone(getBehemoth()),
    instanceId: "sim-behemoth",
    owner: "player",
    controller: "player",
    atk: 2300,
    baseAtk: 2300,
    def: 2400,
    baseDef: 2400,
    cardKind: "monster",
  };
  const destroyer = {
    instanceId: "sim-destroyer",
    id: 9905,
    name: "Sim destroyer",
    cardKind: "monster",
    owner: "bot",
    controller: "bot",
    originalOwner: "bot",
    atk: 2500,
    def: 100,
    baseDef: 1800,
  };
  const state = {
    turnCounter: 3,
    player: { id: "player", field: [behemoth], graveyard: [] },
    bot: { id: "bot", field: [destroyer], graveyard: [] },
  };
  const gain = getEffect("cursed_rock_behemoth_gain_original_def");
  applySimulatedActions({
    actions: gain.actions,
    selections: { cursed_rock_behemoth_atk_target: [destroyer] },
    state,
    selfId: "player",
    options: { sourceCard: behemoth },
  });
  assert.equal(behemoth.atk, 4100);

  const control = getEffect("cursed_rock_behemoth_battle_control");
  applySimulatedActions({
    actions: [control.actions[0]],
    selections: { cursed_rock_behemoth_destroyer: [destroyer] },
    state,
    selfId: "player",
    options: { sourceCard: behemoth },
  });
  assert.equal(state.player.field.includes(destroyer), true);
  assert.equal(destroyer.originalOwner, "bot");
  assert.equal(state.temporaryControlEffects.length, 1);

  const targetDef = control.targets[0];
  assert.deepEqual(
    selectSimulatedTargets({
      targets: [targetDef],
      actions: control.actions,
      state,
      sourceCard: behemoth,
      selfId: "player",
      options: { battleDestroyer: destroyer },
    })[targetDef.id],
    [],
    "The former destroyer is no longer an opponent target after control changes.",
  );

  const canonical = createCanonicalStateSnapshot({
    ...state,
    turn: "player",
    phase: "main1",
    getRandomState: () => null,
    getEffectUsageState: () => null,
    getTemporaryControlState: () => state.temporaryControlEffects,
  });
  assert.equal(canonical.temporaryControlEffects.length, 1);
  assert.doesNotThrow(() => JSON.stringify(canonical));
});

test("simulação consome o vínculo de saída e Invoca a fonte concreta uma vez", () => {
  const behemoth = {
    ...structuredClone(getBehemoth()),
    instanceId: "sim-bound-behemoth",
    owner: "player",
    controller: "player",
    cardKind: "monster",
  };
  const destroyer = {
    instanceId: "sim-bound-destroyer",
    id: 9906,
    name: "Sim bound destroyer",
    cardKind: "monster",
    owner: "bot",
    controller: "bot",
    originalOwner: "bot",
    atk: 3000,
    def: 1000,
  };
  const state = {
    turnCounter: 4,
    player: { id: "player", field: [], graveyard: [behemoth] },
    bot: { id: "bot", field: [destroyer], graveyard: [] },
  };
  const temporaryRegistration = {
    id: "sim_bound_registration",
    timing: "on_play",
    targets: [
      {
        id: "bound_destroyer",
        owner: "opponent",
        zone: "field",
        cardKind: "monster",
        count: { min: 1, max: 1 },
      },
    ],
    actions: [
      {
        type: "register_temporary_event_effect",
        event: "card_moved",
        triggerRequirement: "mandatory",
        triggerTiming: "if",
        bindEventTargetRef: "bound_destroyer",
        requireBoundTargetLeavesField: true,
        duration: "until_consumed",
        uses: 1,
        actions: [
          {
            type: "special_summon_from_zone",
            targetRef: "self",
            zone: "graveyard",
            position: "attack",
            statusesOnSummon: [{ status: "banishWhenLeavesField" }],
          },
        ],
      },
      {
        type: "move",
        targetRef: "bound_destroyer",
        player: "opponent",
        fromZone: "field",
        to: "graveyard",
      },
    ],
  };
  const registrationCard = { ...behemoth, effects: [temporaryRegistration] };

  simulateGenericSpellEffect(state, registrationCard, {
    selfId: "player",
    enableSimulatedEvents: true,
  });

  assert.equal(state.bot.graveyard.includes(destroyer), true);
  assert.equal(state.player.field.includes(behemoth), true);
  assert.equal(behemoth.banishWhenLeavesField, true);
  assert.deepEqual(state.temporaryEventEffects || [], []);
});
