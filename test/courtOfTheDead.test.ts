import { placeFieldCards } from "./helpers/game.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TestContext } from "node:test";
import test from "node:test";
import type { CardConstructorData } from "../src/core/contracts/cards.js";
import type { GamePlayer } from "../src/core/contracts/player.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";

import Card from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import { cardDatabaseByName } from "./helpers/fixtures.js";

const CARD_NAME = "Court of the Dead";
const TARGET_REF = "court_revive_target";

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

function makeMonster(id: number, name: string, owner: GamePlayer) {
  return makeCard(
    {
      id,
      name,
      cardKind: "monster",
      level: 4,
      atk: 1500,
      def: 1000,
      effects: [],
    },
    owner,
  );
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
  game.effectEngine.chooseSpecialSummonPosition = async () => "attack";
  for (const participant of [game.player, game.bot] as const) {
    participant.hand = [];
    participant.deck = [];
    participant.field = [];
    participant.spellTrap = [];
    participant.graveyard = [];
  }
  t.after(() => game.dispose("court_of_the_dead_test"));
  return game;
}

async function waitUntil(
  predicate: () => unknown,
  message: string,
  attempts = 500,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

test("Court of the Dead declares separated text and pays counters before targeting", () => {
  const card = cardDatabaseByName.get(CARD_NAME);
  assert.ok(card);
  assert.equal(
    card.description,
    "Each time a monster is sent to either Graveyard: place 1 Funeral Counter on this card.\n\nOnce per turn: You can remove 8 Funeral Counters from this card, then target 1 monster in either Graveyard; Special Summon it to your field.",
  );

  const counterEffect = required(
    required(card.effects).find(
      (effect) => effect.id === "court_of_the_dead_add_funeral_counter",
    ),
  );
  assert.equal(counterEffect.event, "card_to_grave");
  assert.deepEqual(counterEffect.eventCardFilters, {
    cardKind: "monster",
    toZone: "graveyard",
  });

  const reviveEffect = required(
    required(card.effects).find(
      (effect) => effect.id === "court_of_the_dead_revive",
    ),
  );
  assert.equal(reviveEffect.conditions, undefined);
  assert.deepEqual(required(reviveEffect.activationCosts), [
    {
      type: "remove_counter",
      targetRef: "self",
      counterType: "funeral",
      amount: 8,
      haltOnFailure: true,
    },
  ]);
  assert.equal(
    required(reviveEffect.actions).some(
      (action) => action.type === "remove_counter",
    ),
    false,
  );
  assert.equal(required(required(reviveEffect.targets)[0]).owner, "any");
  assert.equal(required(required(reviveEffect.actions)[0]).scope, "both");

  const locale = JSON.parse(
    readFileSync(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    locale.cards["17"].description,
    "Cada vez que um monstro for enviado para qualquer Cemitério: coloque 1 Marcador Fúnebre neste card.\n\nUma vez por turno: você pode remover 8 Marcadores Fúnebres deste card e, depois, escolher 1 monstro em qualquer Cemitério; Invoque-o por Invocação-Especial no seu campo.",
  );

  const validation = validateCardDatabase();
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(validation.warnings, []);
});

for (const turn of ["player", "bot"] as const) {
  test(`set Court activates through the phase response modal during the ${turn} turn`, async (t) => {
    const game = createGame(t);
    game.turn = turn;
    const court = makeCard(CARD_NAME, game.player);
    court.isFacedown = true;
    court.setTurn = 1;
    court.turnSetOn = 1;
    placeFieldCards(game.player.spellTrap, court);
    const slot = court.fieldSlot;
    const effects = court.effects;
    let prompts = 0;
    game.ui.showChainResponseModal = async (candidates) => {
      prompts++;
      const offered = required(candidates.find(candidate => candidate.card === court));
      assert.ok(offered.effect);
      return offered;
    };
    const result = await game.chainSystem.openChainWindow({
      type: "phase_change", event: "phase_end", player: turn === "player" ? game.player : game.bot,
      toPhase: "main1",
    }, { firstPlayer: turn === "player" ? game.player : game.bot });
    assert.equal(prompts, 1);
    assert.ok(result);
    assert.equal(result.chainBuilt, true, "The accepted offer must publish an activation link.");
    assert.equal(court.isFacedown, false);
    assert.deepEqual(game.player.spellTrap, [court]);
    assert.equal(court.fieldSlot, slot);
    assert.strictEqual(court.effects, effects, "The synthetic activation must not replace declared effects.");
    assert.equal(court.getCounter("funeral"), 0);
    const monster = makeMonster(99190, "Counter source after modal activation", game.player);
    game.player.hand.push(monster);
    await game.moveCard(monster, game.player, "graveyard", { fromZone: "hand" });
    await waitUntil(() => court.getCounter("funeral") === 1, "The activated Court must retain its declared counter trigger.");
  });
}

test("Court gains counters from either Graveyard and revives after paying eight", async (t) => {
  const game = createGame(t);
  const court = makeCard(CARD_NAME, game.player);
  court.isFacedown = false;
  placeFieldCards(game.player.spellTrap, court);
  assert.ok(
    game.effectEngine.canActivateSpellTrapEffectPreview(
      court,
      game.player,
      "spellTrap",
    ).ok === false,
  );

  const ownMonster = makeMonster(
    99140,
    "Own Funeral Counter source",
    game.player,
  );
  const opposingMonster = makeMonster(
    99141,
    "Opposing Funeral Counter source",
    game.bot,
  );
  placeFieldCards(game.player.field, ownMonster);
  placeFieldCards(game.bot.field, opposingMonster);

  await game.moveCard(ownMonster, game.player, "graveyard", {
    fromZone: "field",
  });
  await waitUntil(
    () => court.getCounter("funeral") === 1,
    "Expected the first card_to_grave Trigger to add a Funeral Counter.",
  );
  await game.moveCard(opposingMonster, game.bot, "graveyard", {
    fromZone: "field",
  });

  await waitUntil(
    () => court.getCounter("funeral") === 2,
    "Expected both card_to_grave Triggers to add Funeral Counters.",
  );
  assert.equal(court.getCounter("funeral"), 2);
  court.addCounter("funeral", 6);
  assert.ok(
    game.effectEngine.canActivateSpellTrapEffectPreview(
      court,
      game.player,
      "spellTrap",
    ).ok === true,
  );

  let countersAtChainWindow = null;
  const openActivationChain = game.chainSystem.openActivationChain.bind(
    game.chainSystem,
  );
  game.chainSystem.openActivationChain = async (prepared) => {
    countersAtChainWindow = court.getCounter("funeral");
    return openActivationChain(prepared);
  };

  const activation = await game.tryActivateSpellTrapEffect(
    court,
    { [TARGET_REF]: [opposingMonster] },
    { owner: game.player },
  );

  assert.ok(activation.success === true);
  assert.equal(countersAtChainWindow, 0);
  assert.equal(court.getCounter("funeral"), 0);
  assert.equal(game.bot.graveyard.includes(opposingMonster), false);
  assert.equal(game.player.field.includes(opposingMonster), true);
  assert.equal(opposingMonster.position, "attack");
  assert.equal(game.chainSystem.getFastEffectState().state, "open");

  court.addCounter("funeral", 8);
  const secondTarget = makeMonster(99142, "Second revive target", game.player);
  game.player.graveyard.push(secondTarget);
  const secondActivation = await game.tryActivateSpellTrapEffect(
    court,
    { [TARGET_REF]: [secondTarget] },
    { owner: game.player },
  );

  assert.ok(secondActivation.ok === false);
  assert.equal(court.getCounter("funeral"), 8);
  assert.equal(game.player.graveyard.includes(secondTarget), true);
});

test("Court has a soft OPT per copy and resets after leaving the field", async (t) => {
  const game = createGame(t);
  const first = makeCard(CARD_NAME, game.player);
  const second = makeCard(CARD_NAME, game.player);
  placeFieldCards(game.player.spellTrap, first, second);
  first.addCounter("funeral", 8);
  second.addCounter("funeral", 8);
  const targets = [99150, 99151, 99152].map((id) =>
    makeMonster(id, `Revive ${id}`, game.player),
  );
  game.player.graveyard.push(...targets);
  const activate = (court: Card, target: Card) =>
    game.tryActivateSpellTrapEffect(court, { [TARGET_REF]: [target] }, { owner: game.player });
  assert.equal((await activate(first, required(targets[0]))).success, true);
  first.addCounter("funeral", 8);
  assert.equal((await activate(first, required(targets[1]))).ok, false);
  assert.equal(first.getCounter("funeral"), 8);
  assert.equal((await activate(second, required(targets[1]))).success, true);
  await game.moveCard(first, game.player, "graveyard", { fromZone: "spellTrap" });
  await game.moveCard(first, game.player, "spellTrap", { fromZone: "graveyard", isFacedown: false });
  first.addCounter("funeral", 8);
  assert.equal((await activate(first, required(targets[2]))).success, true);
});

test("each Court counts each Synchro Material after the summon", async (t) => {
  const game = createGame(t);
  game.bot.controllerType = "human";
  game.ui.showTriggerOrderModal = async (options) =>
    required(options).optional ? [] : required(required(options).candidates).map((candidate) => candidate.candidateId);
  game.ui.showChainResponseModal = async () => null;
  const courts = [game.player, game.bot].map((owner) => {
    const court = makeCard(CARD_NAME, owner);
    placeFieldCards(owner.spellTrap, court);
    return court;
  });
  const tuner = makeCard("Tech-Zero Pulse Soldier", game.player);
  const material = makeCard("Nightmare Steed", game.player);
  const synchro = makeCard("Iron Smasher", game.player);
  placeFieldCards(game.player.field, tuner, material);
  game.player.extraDeck.push(synchro);
  const result = await game.performSynchroSummonFromExtraDeck(synchro, game.player, {
    materials: [tuner, material],
  });
  assert.equal(result.success, true);
  assert.ok(game.player.field.includes(synchro));
  assert.ok(game.player.graveyard.includes(tuner));
  assert.ok(game.player.graveyard.includes(material));
  assert.deepEqual(courts.map((court) => court.getCounter("funeral")), [2, 2]);
});

test("soft OPT reservations stay with their copy and original field presence", async (t) => {
  const game = createGame(t);
  const first = makeCard(CARD_NAME, game.player);
  const second = makeCard(CARD_NAME, game.player);
  placeFieldCards(game.player.spellTrap, first, second);
  const effect = required(first.effects.find((entry) => entry.id === "court_of_the_dead_revive"));
  const input = { card: first, player: game.player, effect };
  const reservation = required(game.reserveEffectUsage(input));
  assert.ok("status" in reservation);
  assert.equal(game.checkEffectUsage(input).ok, false);
  assert.equal(game.checkEffectUsage({ ...input, card: second }).ok, true);
  await game.moveCard(first, game.bot, "spellTrap", { fromZone: "spellTrap" });
  assert.equal(game.checkEffectUsage({ ...input, player: game.bot }).ok, false);
  await game.moveCard(first, game.player, "graveyard", { fromZone: "spellTrap" });
  await game.moveCard(first, game.player, "spellTrap", { fromZone: "graveyard", isFacedown: false });
  game.settleEffectUsage(reservation);
  assert.equal(game.checkEffectUsage(input).ok, true);
});

test("soft OPT survives a control change, hard OPT survives leaving and returning", async (t) => {
  const game = createGame(t);
  const court = makeCard(CARD_NAME, game.player);
  placeFieldCards(game.player.spellTrap, court);
  const soft = required(court.effects.find((entry) => entry.id === "court_of_the_dead_revive"));
  game.markOncePerTurnUsed(court, game.player, soft);
  await game.moveCard(court, game.bot, "spellTrap", { fromZone: "spellTrap" });
  assert.equal(game.canUseOncePerTurn(court, game.bot, soft).ok, false);

  const hardCard = makeCard("Desperate Gamble", game.player);
  const otherCopy = makeCard("Desperate Gamble", game.player);
  const hard = required(hardCard.effects[0]);
  placeFieldCards(game.player.spellTrap, hardCard);
  game.markOncePerTurnUsed(hardCard, game.player, hard);
  await game.moveCard(hardCard, game.player, "graveyard", { fromZone: "spellTrap" });
  await game.moveCard(hardCard, game.player, "hand", { fromZone: "graveyard" });
  assert.equal(game.canUseOncePerTurn(hardCard, game.player, hard).ok, false);
  assert.equal(game.canUseOncePerTurn(otherCopy, game.player, hard).ok, false);
  game.turnCounter += 1;
  assert.equal(game.canUseOncePerTurn(court, game.bot, soft).ok, true);
  assert.equal(game.canUseOncePerTurn(hardCard, game.player, hard).ok, true);
});

test("a rolled-back departure keeps the soft OPT spent", async (t) => {
  const game = createGame(t);
  const court = makeCard(CARD_NAME, game.player);
  placeFieldCards(game.player.spellTrap, court);
  const effect = required(court.effects.find((entry) => entry.id === "court_of_the_dead_revive"));
  game.markOncePerTurnUsed(court, game.player, effect);
  const snapshot = game.captureZoneSnapshot("soft_opt_rollback");
  await game.moveCard(court, game.player, "graveyard", { fromZone: "spellTrap" });
  game.restoreZoneSnapshot(snapshot);
  assert.ok(game.player.spellTrap.includes(court));
  assert.equal(game.canUseOncePerTurn(court, game.player, effect).ok, false);
});

test("soft OPT keys use duel identity rather than process-global card allocation", (t) => {
  const firstGame = createGame(t);
  const first = makeCard(CARD_NAME, firstGame.player);
  const effect = required(first.effects.find((entry) => entry.id === "court_of_the_dead_revive"));
  const key = firstGame.getOncePerTurnLockKey(first, effect);
  makeCard("Nightmare Steed", firstGame.player);
  const secondGame = createGame(t);
  const second = makeCard(CARD_NAME, secondGame.player);
  assert.notEqual(first.instanceId, second.instanceId);
  assert.equal(secondGame.getOncePerTurnLockKey(second, effect), key);
});

test("legacy per-card OPT also resets when its card leaves the field", async (t) => {
  const game = createGame(t);
  const card = makeCard("Wanted in the Burning West", game.player);
  const effect = required(card.effects.find((entry) => entry.oncePerTurnPerCard));
  placeFieldCards(game.player.spellTrap, card);
  game.markOncePerTurnUsed(card, game.player, effect);
  assert.equal(game.canUseOncePerTurn(card, game.player, effect).ok, false);
  await game.moveCard(card, game.player, "graveyard", { fromZone: "spellTrap" });
  await game.moveCard(card, game.player, "spellTrap", { fromZone: "graveyard", isFacedown: false });
  assert.equal(game.canUseOncePerTurn(card, game.player, effect).ok, true);
});
