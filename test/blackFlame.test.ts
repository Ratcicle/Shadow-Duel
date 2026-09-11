import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import type { TestContext } from "node:test";
import test from "node:test";
import type Player from "../src/core/Player.js";
import type { CardAction } from "../src/core/contracts/actions.js";
import type { GameCard } from "../src/core/contracts/cards.js";
import type { GamePlayer } from "../src/core/contracts/player.js";
import { array, objectResult, record, required } from "./helpers/fixtures.js";
import type { RuntimeGame } from "./helpers/game.js";
import { createRuntimeGame } from "./helpers/game.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";

import Card from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import { ACTION_CATALOG } from "../src/core/actionHandlers/actionCatalog.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { simulateGenericSpellEffect } from "../src/core/ai/common/simulation.js";
import { createCanonicalStateSnapshot } from "../src/core/game/replay/canonical.js";
import { cardDatabaseById } from "./helpers/fixtures.js";

const BLACK_FLAME_ID = 33;

function getBlackFlame() {
  const card = cardDatabaseById.get(BLACK_FLAME_ID);
  assert.ok(card, "The Black Flame must be in the card database.");
  return card;
}

function getEffect() {
  const effect = required(getBlackFlame().effects).find(
    (entry) => entry.id === "the_black_flame_activation",
  );
  assert.ok(effect, "The Black Flame activation effect must exist.");
  return effect;
}

function createGame(t: TestContext) {
  const game = createRuntimeGame({
    captureReplay: false,
    disableChains: true,
    laboratoryMode: true,
  });
  game.player.controllerType = "ai";
  game.bot.controllerType = "ai";
  t.after(() => game.dispose());
  return game;
}

function createRuntimeCard(game: RuntimeGame, owner: GamePlayer = game.player) {
  const card = new Card(getBlackFlame(), owner.id);
  card.owner = owner.id;
  card.controller = owner.id;
  return card;
}

async function applyEffectActions(
  game: RuntimeGame,
  source: GameCard,
  actions: readonly CardAction[],
) {
  const effect = getEffect();
  return game.effectEngine.applyActions(
    actions,
    {
      source,
      player: game.player,
      opponent: game.bot,
      effect,
    },
    {},
  );
}

async function resolveStandbyBurns(game: RuntimeGame, activePlayer: Player) {
  const opponent = game.getOpponent(activePlayer);
  const triggerPackage = await game.effectEngine.collectEventTriggers(
    "standby_phase",
    { player: activePlayer, opponent },
  );
  for (const entry of triggerPackage.entries) {
    assert.equal(entry.triggerRequirement, "mandatory");
    assert.equal(entry.triggerTiming, "if");
    const result = objectResult(
      await entry.config.activate(null, entry.config.activationContext),
    );
    assert.ok(required(result.success) === true);
  }
  return triggerPackage.entries;
}

test("A Chama Negra declara dados, localização e contrato persistente", () => {
  const card = getBlackFlame();
  const effect = getEffect();
  const validation = validateCardDatabase();
  const locale = JSON.parse(
    readFileSync(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );

  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 0);
  assert.equal(card.name, "The Black Flame");
  assert.equal(card.cardKind, "spell");
  assert.equal(card.subtype, "normal");
  assert.equal(
    existsSync(
      new URL("../public/assets/The Black Flame.png", import.meta.url),
    ),
    true,
  );
  assert.deepEqual(locale.cards[String(BLACK_FLAME_ID)], {
    name: "A Chama Negra",
    description:
      'Pague 1000 PV; pelo restante deste Duelo, cause 300 de dano ao seu oponente durante cada Fase de Apoio. Você só pode ativar 1 "A Chama Negra" por turno.',
  });

  assert.equal(effect.timing, "on_play");
  assert.equal(effect.speed, 1);
  assert.equal(effect.oncePerTurn, true);
  assert.equal(effect.oncePerTurnName, "the_black_flame_activation");
  assert.equal(effect.usagePolicy, "activate");
  assert.deepEqual(required(effect.activationCosts), [
    { type: "pay_lp", player: "self", amount: 1000 },
  ]);
  assert.deepEqual(required(effect.actions)[0], {
    type: "register_temporary_event_effect",
    event: "standby_phase",
    triggerRequirement: "mandatory",
    triggerTiming: "if",
    duration: "duel",
    unlimitedUses: true,
    effectId: "the_black_flame_standby_burn",
    promptUser: false,
    actions: [{ type: "damage", player: "opponent", amount: 300 }],
  });

  const catalog = ACTION_CATALOG.register_temporary_event_effect;
  assert.equal(catalog.fields.unlimitedUses.type, "boolean");
  assert.equal(catalog.optional.includes("unlimitedUses"), true);
});

test("o custo é pago antes da resolução e não é devolvido", async (t) => {
  const game = createGame(t);
  const source = createRuntimeCard(game);
  const effect = getEffect();

  const result = await applyEffectActions(
    game,
    source,
    required(effect.activationCosts),
  );
  assert.ok(result.success === true);
  assert.equal(game.player.lp, 7000);
  assert.equal(game.temporaryEventEffects.length, 0);

  const reservation = game.reserveEffectUsage({
    card: source,
    player: game.player,
    effect,
  });
  const settled = required(
    game.settleEffectUsage(requiredReservation(reservation), {
      activationNegated: true,
    }),
  );
  assert.ok(typeof settled === "object");
  assert.equal(settled.status, "released");
  assert.equal(game.player.lp, 7000, "activation negation must not refund LP");
  assert.equal(game.temporaryEventEffects.length, 0);
  assert.ok(
    game.checkEffectUsage({ card: source, player: game.player, effect }).ok ===
      true,
  );
});

test("a política activate distingue negação da ativação e do efeito", (t) => {
  const game = createGame(t);
  const effect = getEffect();
  const first = createRuntimeCard(game);
  const second = createRuntimeCard(game);

  const activationReservation = game.reserveEffectUsage({
    card: first,
    player: game.player,
    effect,
  });
  assert.ok(
    game.checkEffectUsage({ card: second, player: game.player, effect }).ok ===
      false,
  );
  game.settleEffectUsage(requiredReservation(activationReservation), {
    activationNegated: true,
  });
  assert.ok(
    game.checkEffectUsage({ card: second, player: game.player, effect }).ok ===
      true,
  );

  const effectReservation = game.reserveEffectUsage({
    card: second,
    player: game.player,
    effect,
  });
  const effectSettlement = required(
    game.settleEffectUsage(
      requiredReservation(effectReservation),
      Object.assign({ activationNegated: false }, { effectNegated: true }),
    ),
  );
  assert.ok(typeof effectSettlement === "object");
  assert.equal(effectSettlement.status, "consumed");
  assert.ok(
    game.checkEffectUsage({ card: first, player: game.player, effect }).ok ===
      false,
  );

  game.turnCounter += 1;
  assert.ok(
    game.checkEffectUsage({ card: first, player: game.player, effect }).ok ===
      true,
  );
});

test("o efeito dispara em cada Fase de Apoio e persiste sem a Magia", async (t) => {
  const game = createGame(t);
  const source = createRuntimeCard(game);

  const registered = await applyEffectActions(
    game,
    source,
    required(getEffect().actions),
  );
  assert.ok(registered.success === true);
  assert.equal(game.temporaryEventEffects.length, 1);
  assert.equal(record(game.temporaryEventEffects[0]).expiresOnTurn, null);
  assert.equal(record(game.temporaryEventEffects[0]).usesRemaining, null);

  const first = await resolveStandbyBurns(game, game.player);
  assert.equal(first.length, 1);
  assert.equal(game.bot.lp, 7700);

  game.turnCounter = 8;
  const second = await resolveStandbyBurns(game, game.bot);
  assert.equal(second.length, 1);
  assert.equal(game.bot.lp, 7400);
  assert.equal(game.temporaryEventEffects.length, 1);
  assert.equal(record(game.temporaryEventEffects[0]).usesRemaining, null);
});

test("registros de turnos diferentes acumulam seu dano", async (t) => {
  const game = createGame(t);
  await applyEffectActions(
    game,
    createRuntimeCard(game),
    required(getEffect().actions),
  );
  game.turnCounter += 1;
  await applyEffectActions(
    game,
    createRuntimeCard(game),
    required(getEffect().actions),
  );

  assert.equal(game.temporaryEventEffects.length, 2);
  assert.notEqual(
    record(game.temporaryEventEffects[0]).id,
    record(game.temporaryEventEffects[1]).id,
  );
  const triggers = await resolveStandbyBurns(game, game.bot);
  assert.equal(triggers.length, 2);
  assert.equal(game.bot.lp, 7400);
  assert.equal(game.temporaryEventEffects.length, 2);
});

test("estado público, replay e reset preservam o contrato do Duelo", async (t) => {
  const game = createGame(t);
  await applyEffectActions(
    game,
    createRuntimeCard(game),
    required(getEffect().actions),
  );

  const publicEntry = game.getPublicState(game.player.id).temporaryEffects
    .event[0];
  assert.equal(publicEntry.duration, "duel");
  assert.equal(publicEntry.expiresOnTurn, null);
  assert.equal(publicEntry.usesRemaining, null);

  const replayEntry = record(
    array(createCanonicalStateSnapshot(game).temporaryEventEffects)[0],
  );
  assert.equal(replayEntry.duration, "duel");
  assert.equal(replayEntry.expiresOnTurn, null);
  assert.equal(replayEntry.usesRemaining, null);
  assert.doesNotThrow(() => JSON.stringify(createCanonicalStateSnapshot(game)));

  game.resetDuelState("black_flame_test");
  assert.deepEqual(game.temporaryEventEffects, []);
});

test("a simulação registra o efeito persistente e aplica o mesmo dano", () => {
  const source = simulationCard({
    ...getBlackFlame(),
    instanceId: "sim-black-flame",
    owner: "bot",
    controller: "bot",
  });
  const state = simulationState({
    turnCounter: 3,
    player: { id: "player", lp: 8000, hand: [], field: [], spellTrap: [] },
    bot: { id: "bot", lp: 2000, hand: [source], field: [], spellTrap: [] },
  });

  simulateGenericSpellEffect(state, source, { selfId: "bot" });
  assert.equal(state.bot.lp, 1000);
  assert.equal(required(state.temporaryEventEffects).length, 1);
  const entry = required(state.temporaryEventEffects)[0];
  assert.equal(entry.expiresOnTurn, null);
  assert.equal(entry.usesRemaining, null);

  applySimulatedActions({
    actions: entry.effect.actions,
    selections: {},
    state,
    selfId: entry.ownerId,
    options: { sourceCard: source, effect: entry.effect },
  });
  assert.equal(state.player.lp, 7700);
});

test("o bot evita pagar seus últimos 1000 PV sem endurecer o runtime", async (t) => {
  const game = createGame(t);
  const source = createRuntimeCard(game);
  game.player.lp = 1000;
  const runtime = await applyEffectActions(
    game,
    source,
    required(getEffect().activationCosts),
  );
  assert.ok(runtime.success === true);
  assert.equal(game.player.lp, 0);

  const simulatedSource = simulationCard({
    ...getBlackFlame(),
    instanceId: "self-ko-check",
    owner: "bot",
    controller: "bot",
  });
  const state = simulationState({
    turnCounter: 1,
    player: { id: "player", lp: 8000, hand: [], field: [], spellTrap: [] },
    bot: {
      id: "bot",
      lp: 1000,
      hand: [simulatedSource],
      field: [],
      spellTrap: [],
    },
  });
  simulateGenericSpellEffect(state, simulatedSource, { selfId: "bot" });
  assert.equal(state.bot.lp, 1000);
  assert.deepEqual(state.temporaryEventEffects || [], []);
});

function requiredReservation(
  value: ReturnType<RuntimeGame["reserveEffectUsage"]>,
) {
  assert.ok(value && "reservationId" in value);
  return value;
}
