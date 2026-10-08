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
import { simulateGenericSpellEffect, attachSimulatedEventEmitter } from "../src/core/ai/common/simulation.js";
import { scoreDragonLineTerminal } from "../src/core/ai/dragon/linePlanning.js";
import { createCanonicalStateSnapshot } from "../src/core/game/replay/canonical.js";
import { cardDatabaseById } from "./helpers/fixtures.js";

const BLACK_FLAME_ID = 33;

test("shared Standby keeps Black Flame's temporary registration active in both players' phases", () => {
  const source = simulationCard({ ...getBlackFlame(), instanceId: "sim-every-standby", owner: "bot", controller: "bot" });
  const state = simulationState({ turnCounter: 4, phase: "standby", bot: { lp: 4000, hand: [source] } });
  simulateGenericSpellEffect(state, source);
  const events = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true });
  for (const active of [state.bot, state.player]) {
    const before = state.player.lp;
    events.emitSimulatedEvent?.("standby_phase", { player: active, opponent: active === state.bot ? state.player : state.bot });
    assert.equal(state.player.lp, before - 300);
    assert.equal(state.temporaryEventEffects?.length, 1);
  }
});

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

function createGame(t: TestContext, disableChains = true) {
  const game = createRuntimeGame({
    captureReplay: false,
    disableChains,
    laboratoryMode: true,
  });
  game.player.controllerType = "ai";
  game.bot.controllerType = "ai";
  game.disablePresentationDelays = true;
  game.turn = game.player.id;
  game.phase = "main1";
  game.turnCounter = 2;
  t.after(() => game.dispose());
  return game;
}

async function activateBlackFlame(game: RuntimeGame, source: Card) {
  const result = await game.tryActivateSpell(
    source, game.player.hand.indexOf(source), null, { owner: game.player },
  );
  assert.equal(result.success, true, result.reason ?? undefined);
  assert.ok(game.player.graveyard.includes(source));
}

for (const zone of ["graveyard", "banished", "deck", "hand", "spellTrap"] as const) {
  test(`Chain: persistent burn leaves its physical source unchanged in ${zone}`, async (t) => {
    const game = createGame(t, false);
    const source = createRuntimeCard(game);
    game.player.hand.push(source);
    await activateBlackFlame(game, source);
    assert.equal(game.player.lp, 7000);
    if (zone !== "graveyard") {
      await game.moveCard(source, game.player, zone, {
        fromZone: "graveyard", awaitEvents: true, isFacedown: zone === "spellTrap",
      });
    }
    const version = source.locationVersion;
    const facedown = source.isFacedown;
    for (const activePlayer of [game.player, game.bot]) {
      const before = game.bot.lp;
      await game.emit("standby_phase", {
        player: activePlayer, opponent: game.getOpponent(activePlayer),
      });
      assert.equal(game.bot.lp, before - 300);
      assert.ok(game.player[zone].includes(source), `source must remain in ${zone}`);
      assert.equal(source.isFacedown, facedown);
      assert.equal(source.locationVersion, version);
      assert.equal(game.player.lp, 7000, "the persistent effect must not pay the cost again");
      assert.equal(game.temporaryEventEffects.length, 1);
    }
  });
}

for (const sameCopy of [true, false]) {
  test(`Chain: two registrations stack independently (same copy: ${sameCopy})`, async (t) => {
    const game = createGame(t, false);
    const first = createRuntimeCard(game);
    const second = sameCopy ? first : createRuntimeCard(game);
    game.player.hand.push(first);
    await activateBlackFlame(game, first);
    game.turnCounter += 1;
    if (sameCopy) {
      await game.moveCard(second, game.player, "hand", { fromZone: "graveyard", awaitEvents: true });
    } else {
      game.player.hand.push(second);
    }
    await activateBlackFlame(game, second);
    assert.equal(game.player.lp, 6000);
    assert.equal(game.temporaryEventEffects.length, 2);
    for (const activePlayer of [game.player, game.bot]) {
      const before = game.bot.lp;
      await game.emit("standby_phase", {
        player: activePlayer, opponent: game.getOpponent(activePlayer),
      });
      assert.equal(game.bot.lp, before - 600);
      assert.equal(game.temporaryEventEffects.length, 2);
    }
  });
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
      'Pague 1000 PV; cause 300 de dano ao seu oponente durante cada Fase de Apoio pelo resto deste Duelo.\n\nVocê só pode ativar 1 "A Chama Negra" por turno.',
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

  const publicEntry = required(
    game.getPublicState(game.player.id).temporaryEffects.event[0],
  );
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
  const entry = required(required(state.temporaryEventEffects)[0]);
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

test("Black Flame simulation preserves the runtime's legal payment of the last 1000 LP", async (t) => {
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
  assert.equal(state.bot.lp, 0);
  assert.equal(state.temporaryEventEffects?.length, 1);
});

test("Dragon terminal evaluation penalizes Black Flame self-defeat independently of payment legality", () => {
  const source = simulationCard({ ...getBlackFlame(), instanceId: "terminal-black-flame", owner: "bot", controller: "bot" });
  const initialState = simulationState({ turn: "bot", phase: "main1", turnCounter: 1,
    bot: { lp: 1000, hand: [source] } });
  const finalState = structuredClone(initialState);
  simulateGenericSpellEffect(finalState, required(finalState.bot.hand[0]), { selfId: "bot" });
  const losingScore = scoreDragonLineTerminal({ initialState, finalState, baseScore: 1000 });
  const preservedScore = scoreDragonLineTerminal({ initialState, finalState: initialState });
  assert.equal(finalState.bot.lp, 0);
  assert.equal(losingScore, -10000, "terminal defeat overrides a favorable intermediate score");
  assert.ok(losingScore < preservedScore);
  assert.equal(initialState.bot.lp, 1000);
});

function requiredReservation(
  value: ReturnType<RuntimeGame["reserveEffectUsage"]>,
) {
  assert.ok(value && "reservationId" in value);
  return value;
}
