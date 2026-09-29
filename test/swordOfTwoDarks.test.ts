import { placeFieldCards } from "./helpers/game.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TestContext } from "node:test";
import test from "node:test";
import type { CardConstructorData } from "../src/core/contracts/cards.js";
import type { GamePlayer } from "../src/core/contracts/player.js";
import type { CanonicalZone } from "../src/core/contracts/zones.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import type { RuntimeGame } from "./helpers/game.js";
import { createRuntimeGame } from "./helpers/game.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";
import { evaluateSimulatedConditions } from "../src/core/ai/common/simulatedConditions.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { attachSimulatedEquip, detachSimulatedEquip } from "../src/core/ai/common/zones.js";
import { createPlanningCopy } from "../src/core/ai/common/planningCopy.js";

import Card from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import { cardDatabaseByName } from "./helpers/fixtures.js";

const CARD_NAME = "Sword of Two Darks";
const EQUIP_EFFECT_ID = "sword_of_two_darks_equip";
const GRAVE_EFFECT_ID = "sword_of_two_darks_pop_backrow";

async function equipSword(game: RuntimeGame, host: Card) {
  const sword = makeCard(CARD_NAME, game.player);
  game.player.hand.push(sword);
  const result = await game.tryActivateSpell(sword, game.player.hand.indexOf(sword), {
    sotd_equip_target: [host],
  });
  assert.equal(result.success, true);
  return sword;
}

async function setEquipNegation(game: RuntimeGame, sword: Card, remove = false) {
  const result = await game.effectEngine.applyActions([
    { type: "add_status", targetRef: "equip", status: "effectsNegated", value: true,
      duration: "while_faceup", ...(remove ? { remove: true } : {}) },
  ], { source: sword, player: game.player, opponent: game.bot }, { equip: [sword] });
  assert.equal(result.success, true);
}

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

function createGame(t: TestContext) {
  const game = createRuntimeGame({
    captureReplay: false,
    laboratoryMode: true,
  });
  game.turn = game.player.id;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = "human";
  game.bot.controllerType = "ai";
  for (const participant of [game.player, game.bot] as const) {
    participant.hand = [];
    participant.deck = [];
    participant.field = [];
    participant.spellTrap = [];
    participant.graveyard = [];
  }
  t.after(() => game.dispose("sword_of_two_darks_test"));
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

async function selectCard(
  game: RuntimeGame,
  ownerId: string,
  index: number,
  zone: CanonicalZone,
) {
  await waitUntil(
    () => game.targetSelection?.kind === "target",
    "Expected target selection.",
  );
  assert.equal(
    game.handleTargetSelectionClick(ownerId, index, null, zone),
    true,
  );
  game.advanceTargetSelection();
}

test("Sword of Two Darks declares its effects and control limit", () => {
  const card = cardDatabaseByName.get(CARD_NAME);
  assert.ok(card);
  assert.equal(
    card.description,
    'Equip only to a monster you control.\n\nThe equipped monster can make 1 additional attack during each Battle Phase.\n\nIf this card is sent to the Graveyard: target 1 Spell/Trap your opponent controls; destroy that target.\n\nYou can only control 1 "Sword of Two Darks".',
  );

  const equipEffect = required(
    required(card.effects).find((effect) => effect.id === EQUIP_EFFECT_ID),
  );
  assert.equal(required(required(equipEffect.actions)[0]).extraAttacks, 1);
  assert.deepEqual(equipEffect.conditions, [
    {
      type: "control_card_max",
      zone: "spellTrap",
      max: 0,
      includeFacedown: false,
      filters: { cardId: 11 },
      excludeSource: true,
      reason: 'You can only control 1 "Sword of Two Darks".',
    },
  ]);

  const graveEffect = required(
    required(card.effects).find((effect) => effect.id === GRAVE_EFFECT_ID),
  );
  assert.equal(graveEffect.fromZone, undefined);
  assert.deepEqual(required(required(graveEffect.targets)[0]).cardKind, [
    "spell",
    "trap",
  ]);

  const locale = JSON.parse(
    readFileSync(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    locale.cards["11"].description,
    "Equipe apenas a um monstro que você controla.\n\nO monstro equipado pode realizar 1 ataque adicional durante cada Fase de Batalha.\n\nSe este card for enviado para o Cemitério: escolha 1 Magia/Armadilha que seu oponente controla; destrua-a.\n\nVocê só pode controlar 1 “Espada das Duas Trevas”.",
  );

  const validation = validateCardDatabase();
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(validation.warnings, []);
});

test("the equipped monster can attack twice during the Battle Phase", async (t) => {
  const game = createGame(t);
  const sword = makeCard(CARD_NAME, game.player);
  const attacker = makeCard(
    {
      id: 99120,
      name: "Twice-attacking monster",
      cardKind: "monster",
      level: 4,
      atk: 2000,
      def: 1000,
      effects: [],
    },
    game.player,
  );
  const defender = makeCard(
    {
      id: 99121,
      name: "First battle target",
      cardKind: "monster",
      level: 4,
      atk: 1000,
      def: 1000,
      effects: [],
    },
    game.bot,
  );
  game.player.hand.push(sword);
  placeFieldCards(game.player.field, attacker);
  placeFieldCards(game.bot.field, defender);

  const equipPromise = game.tryActivateSpell(sword, 0);
  await selectCard(game, game.player.id, 0, "field");
  await equipPromise;
  await waitUntil(
    () =>
      sword.equippedTo === attacker && game.player.spellTrap.includes(sword),
    "Equip effect did not resolve.",
  );

  assert.equal(attacker.extraAttacks, 1);
  game.phase = "battle";
  const firstAttack = required(await game.resolveCombat(attacker, defender));
  assert.ok(firstAttack.ok === true);
  assert.equal(game.bot.graveyard.includes(defender), true);

  const lpBeforeSecondAttack = game.bot.lp;
  const secondAttack = required(await game.resolveCombat(attacker, null));
  assert.ok(secondAttack.ok === true);
  assert.equal(game.bot.lp, lpBeforeSecondAttack - attacker.atk);
  assert.equal(attacker.attacksUsedThisTurn, 2);
});

test("Orathus negates the equip's additional attack and removing negation restores it once", async (t) => {
  const game = createGame(t);
  game.bot.controllerType = "human";
  game.ui.showChainResponseModal = async () => null;
  game.ui.showConfirmPrompt = async () => true;
  const host = makeCard("Nightmare Steed", game.player);
  placeFieldCards(game.player.field, host);
  const sword = await equipSword(game, host);
  host.attacksUsedThisTurn = 1;
  assert.equal(game.getMonsterAttackLimit(host), 2);
  const orathus = makeCard("Orathus, The Fallen Angel", game.bot);
  game.bot.extraDeck.push(orathus);
  game.turn = "bot";
  const summon = game.executeSummonTransaction(game.createPreparedSummon({
    card: orathus, controller: game.bot, sourceZone: "extraDeck",
    summonOrigin: "procedure", summonMode: "summon", summonMethod: "synchro",
    summonProcedure: "synchro", position: "attack",
    perform: (transaction) => game.moveCard(orathus, game.bot, "field", {
      fromZone: "extraDeck", position: "attack", isFacedown: false,
      summonMethodOverride: "synchro", summonProcedure: "synchro",
      summonOrigin: "procedure", summonTransaction: transaction,
    }),
  }));
  await selectCard(game, "player", 0, "spellTrap");
  assert.equal((await summon).success, true);
  assert.equal(sword.effectsNegated, true);
  assert.equal(game.getMonsterAttackLimit(host), 1);
  assert.equal(host.hasAttacked, true);
  await setEquipNegation(game, sword, true);
  game.effectEngine.updatePassiveBuffs();
  game.effectEngine.updatePassiveBuffs();
  assert.equal(game.getMonsterAttackLimit(host), 2);
  assert.equal(host.hasAttacked, false);
});

for (const destination of ["graveyard", "hand", "banished"] as const) {
  test(`removing a negated equip to ${destination} preserves the host's other extra attacks`, async (t) => {
    const game = createGame(t);
    const host = makeCard({ id: 99125, name: "Innate extra attacks", cardKind: "monster",
      atk: 1500, def: 1000, extraAttacks: 2 }, game.player);
    placeFieldCards(game.player.field, host);
    const sword = await equipSword(game, host);
    assert.equal(game.getMonsterAttackLimit(host), 4);
    await setEquipNegation(game, sword);
    assert.equal(game.getMonsterAttackLimit(host), 3);
    await game.moveCard(sword, game.player, destination, { fromZone: "spellTrap" });
    game.effectEngine.updatePassiveBuffs();
    assert.equal(game.getMonsterAttackLimit(host), 3);
    assert.equal(sword.equippedTo, null);
  });
}

test("re-equipping a negated source moves only its contribution and repeated equip does not stack", async (t) => {
  const game = createGame(t);
  const first = makeCard({ id: 99126, name: "First host", cardKind: "monster", extraAttacks: 2 }, game.player);
  const second = makeCard("Nightmare Steed", game.player);
  placeFieldCards(game.player.field, first, second);
  const sword = await equipSword(game, first);
  await setEquipNegation(game, sword);
  for (let index = 0; index < 2; index++) {
    assert.equal(await game.effectEngine.applyEquip({ type: "equip", targetRef: "host", extraAttacks: 1 },
      { source: sword, player: game.player, opponent: game.bot }, { host: [second] }), true);
  }
  assert.equal(game.getMonsterAttackLimit(first), 3);
  assert.equal(game.getMonsterAttackLimit(second), 1);
  await setEquipNegation(game, sword, true);
  assert.equal(game.getMonsterAttackLimit(first), 3);
  assert.equal(game.getMonsterAttackLimit(second), 2);
  await game.moveCard(second, game.player, "graveyard", { fromZone: "field" });
  assert.equal(game.player.graveyard.includes(sword), true);
  assert.equal(game.getMonsterAttackLimit(first), 3);
});

test("simulation and planning copies preserve independent equipment contributions through negation and detach", () => {
  const host = simulationCard({ id: 99127, instanceId: "host", cardKind: "monster", extraAttacks: 2 });
  const sword = simulationCard({ ...cardDefinition(CARD_NAME), instanceId: "sword" });
  const secondEquip = simulationCard({ id: 99128, instanceId: "other-equip", cardKind: "spell", subtype: "equip" });
  const state = simulationState({ player: { field: [host], spellTrap: [sword, secondEquip] } });
  assert.equal(attachSimulatedEquip(sword, host, { extraAttacks: 1 }), true);
  assert.equal(attachSimulatedEquip(secondEquip, host, { extraAttacks: 2 }), true);
  assert.equal(host.extraAttacks, 5);
  applySimulatedActions({ state, selfId: "player", selections: { equip: [sword] },
    actions: [{ type: "add_status", targetRef: "equip", status: "effectsNegated", duration: "while_faceup" }] });
  assert.equal(host.extraAttacks, 4);
  const copy = createPlanningCopy();
  const clonedHost = copy.cloneCardForSim(host);
  const clonedSword = copy.cloneCardForSim(sword);
  const clonedSecond = copy.cloneCardForSim(secondEquip);
  const clonedState = simulationState({ player: { field: [clonedHost], spellTrap: [clonedSword, clonedSecond] } });
  applySimulatedActions({ state: clonedState, selfId: "player", selections: { equip: [clonedSword] },
    actions: [{ type: "add_status", targetRef: "equip", status: "effectsNegated", remove: true }] });
  assert.equal(clonedHost.extraAttacks, 5);
  assert.equal(host.extraAttacks, 4, "Restoring the clone must not alter its parent state");
  detachSimulatedEquip(sword);
  assert.equal(host.extraAttacks, 4, "Negated equipment has no active bonus to subtract");
  detachSimulatedEquip(clonedSword);
  assert.equal(clonedHost.extraAttacks, 4);
  detachSimulatedEquip(clonedSecond);
  assert.equal(clonedHost.extraAttacks, 2);
  assert.equal(host.extraAttacks, 4);
});

test("equipment recovered after its token disappears can grant its attack to a new host", async (t) => {
  const game = createGame(t);
  const token = makeCard({ id: 99129, name: "Token host", cardKind: "monster" }, game.player);
  token.isToken = true;
  const host = makeCard("Nightmare Steed", game.player);
  placeFieldCards(game.player.field, token, host);
  const sword = await equipSword(game, token);
  await game.moveCard(token, game.player, "graveyard", { fromZone: "field" });
  assert.equal(game.player.graveyard.includes(sword), true);
  await game.moveCard(sword, game.player, "hand", { fromZone: "graveyard" });
  assert.equal((await game.tryActivateSpell(sword, game.player.hand.indexOf(sword),
    { sotd_equip_target: [host] })).success, true);
  assert.equal(game.getMonsterAttackLimit(host), 2);
});

for (const swordName of ["Light-Dividing Sword", CARD_NAME]) {
  test(`${swordName} can equip only a monster on its controller's field`, async (t) => {
    const game = createGame(t);
    const sword = makeCard(swordName, game.player);
    const ownMonster = makeCard("Nightmare Steed", game.player);
    const opponentMonster = makeCard("Nightmare Steed", game.bot);
    game.player.hand.push(sword);
    placeFieldCards(game.bot.field, opponentMonster);
    assert.equal((await game.tryActivateSpell(sword, 0)).ok, false);
    assert.equal(game.player.hand.includes(sword), true);
    placeFieldCards(game.player.field, ownMonster);
    game.effectEngine.clearTargetingCache();
    const activation = game.tryActivateSpell(sword, 0);
    await waitUntil(() => game.targetSelection?.kind === "target", "Expected equip selection.");
    const session = required(game.targetSelection);
    const previousSelections = structuredClone(session.selections);
    game.handleTargetSelectionClick(game.bot.id, 0, null, "field");
    assert.deepEqual(session.selections, previousSelections);
    await selectCard(game, game.player.id, 0, "field");
    await activation;
    assert.equal(sword.equippedTo, ownMonster);
  });
}

for (const cardName of [
  CARD_NAME,
  "Luminarch Sunforged Blade",
  "Extreme Dragon Awakening",
  "Grimoire of the Apprentice Arcanist",
  "Miragebound Mirror Path",
]) {
  test(`${cardName} counts only other face-up copies for its control limit`, (t) => {
    const game = createGame(t);
    const source = makeCard(cardName, game.player);
    const other = makeCard(cardName, game.player);
    const conditions = required(
      required(source.effects).find((effect) =>
        effect.conditions?.some((condition) =>
          "type" in condition && condition.type === "control_card_max",
        ),
      )?.conditions,
    );
    const context = { source, player: game.player, opponent: game.bot };
    other.isFacedown = true;
    placeFieldCards(game.player.spellTrap, other);
    assert.equal(game.effectEngine.evaluateConditions(conditions, context).ok, true);
    // The source can already be face-up during activation; it must not count itself.
    source.isFacedown = false;
    placeFieldCards(game.player.spellTrap, source);
    assert.equal(game.effectEngine.evaluateConditions(conditions, context).ok, true);
    other.isFacedown = false;
    assert.equal(game.effectEngine.evaluateConditions(conditions, context).ok, false);
  });
  test(`${cardName} uses the same face-up control limit in AI simulation`, () => {
    const definition = cardDefinition(cardName);
    const conditions = required(required(definition.effects).find((effect) =>
      effect.conditions?.some((condition) =>
        "type" in condition && condition.type === "control_card_max",
      ),
    )?.conditions);
    const source = simulationCard({ ...definition, instanceId: "source", isFacedown: false });
    const other = simulationCard({ ...definition, instanceId: "other", isFacedown: true });
    const state = simulationState({ player: { spellTrap: [other] } });
    const context = { state, selfId: "player", sourceCard: source };
    assert.equal(evaluateSimulatedConditions(conditions, context), true);
    placeFieldCards(state.player.spellTrap, source);
    assert.equal(evaluateSimulatedConditions(conditions, context), true);
    other.isFacedown = false;
    assert.equal(evaluateSimulatedConditions(conditions, context), false);
  });
}

test("control_card_max defaults to face-up copies and supports explicit facedown counting", (t) => {
  const game = createGame(t);
  const source = makeCard(CARD_NAME, game.player);
  const other = makeCard(CARD_NAME, game.player);
  other.isFacedown = true;
  placeFieldCards(game.player.spellTrap, other);
  const context = { source, player: game.player, opponent: game.bot };
  const condition = {
    type: "control_card_max",
    zone: "spellTrap",
    max: 0,
    filters: { cardId: 11 },
    excludeSource: true,
  } as const;
  assert.equal(game.effectEngine.evaluateConditions([condition], context).ok, true);
  assert.equal(game.effectEngine.evaluateConditions([
    { ...condition, includeFacedown: true },
  ], context).ok, false);
  other.isFacedown = false;
  assert.equal(game.effectEngine.evaluateConditions([condition], context).ok, false);
});

test("AI control_card_max ignores Set copies by default but honors explicit inclusion", () => {
  const other = simulationCard({ ...cardDefinition(CARD_NAME), isFacedown: true });
  const state = simulationState({ player: { spellTrap: [other] } });
  const condition = { type: "control_card_max", zone: "spellTrap", max: 0, filters: { cardId: 11 } };
  const context = { state, selfId: "player" };
  assert.equal(evaluateSimulatedConditions(condition, context), true);
  assert.equal(evaluateSimulatedConditions({ ...condition, includeFacedown: true }, context), false);
  other.isFacedown = false;
  assert.equal(evaluateSimulatedConditions(condition, context), false);
});

test("multiple copies can be Set, but only one can be activated face-up", async (t) => {
  const game = createGame(t);
  const first = makeCard(CARD_NAME, game.player);
  const second = makeCard(CARD_NAME, game.player);
  const third = makeCard(CARD_NAME, game.player);
  const equipTarget = makeCard("Nightmare Steed", game.player);
  game.player.hand.push(first, second, third);
  placeFieldCards(game.player.field, equipTarget);
  for (const sword of [first, second]) {
    const result = required(await game.setSpellOrTrap(
      sword, game.player.hand.indexOf(sword), game.player,
    ));
    assert.equal(result.ok, true);
    assert.equal(sword.isFacedown, true);
  }
  // The runtime requires a later turn to activate a Set Spell.
  game.turnCounter += 2;
  const activation = game.tryActivateSpellTrapEffect(first);
  await selectCard(game, game.player.id, 0, "field");
  await activation;
  assert.equal(first.isFacedown, false);
  assert.equal(first.equippedTo, equipTarget);
  assert.equal(second.isFacedown, true);
  assert.equal(
    game.effectEngine.canActivateSpellTrapEffectPreview(first, game.player).ok,
    false,
  );
  // Setting another copy remains legal even after one has been activated.
  const setResult = required(await game.setSpellOrTrap(
    third, game.player.hand.indexOf(third), game.player,
  ));
  assert.equal(setResult.ok, true);
  const blocked = await game.tryActivateSpellTrapEffect(second);
  assert.equal(blocked.ok, false);
  assert.equal(second.isFacedown, true);
  assert.equal(third.isFacedown, true);
  assert.equal(game.targetSelection, null);
});

test("a second copy cannot be activated while another copy is face-up", async (t) => {
  const game = createGame(t);
  const controlledSword = makeCard(CARD_NAME, game.player);
  const secondSword = makeCard(CARD_NAME, game.player);
  const equipTarget = makeCard(
    {
      id: 99122,
      name: "Equip target",
      cardKind: "monster",
      level: 4,
      atk: 1500,
      def: 1500,
      effects: [],
    },
    game.player,
  );
  controlledSword.isFacedown = false;
  placeFieldCards(game.player.spellTrap, controlledSword);
  game.player.hand.push(secondSword);
  placeFieldCards(game.player.field, equipTarget);

  const result = await game.tryActivateSpell(secondSword, 0);

  assert.ok(result.ok === false);
  assert.equal(game.player.hand.includes(secondSword), true);
  assert.equal(game.player.spellTrap.includes(secondSword), false);
  assert.equal(game.targetSelection, null);
});

for (const { cardKind, fromZone, targetZone } of [
  { cardKind: "spell", fromZone: "spellTrap", targetZone: "spellTrap" },
  { cardKind: "trap", fromZone: "hand", targetZone: "spellTrap" },
  { cardKind: "spell", fromZone: "hand", targetZone: "fieldSpell" },
] as const) {
  test(`the Graveyard effect destroys an opponent ${cardKind} in ${targetZone} when sent from ${fromZone}`, async (t) => {
    const game = createGame(t);
    const sword = makeCard(CARD_NAME, game.player);
    const target = makeCard(
      {
        id: cardKind === "spell" ? 99123 : 99124,
        name: `Opponent ${cardKind}`,
        cardKind,
        subtype: targetZone === "fieldSpell" ? "field" : "normal",
        effects: [],
      },
      game.bot,
    );
    game.player[fromZone].push(sword);
    if (targetZone === "fieldSpell") game.bot.fieldSpell = target;
    else placeFieldCards(game.bot.spellTrap, target);

    const movePromise = game.moveCard(sword, game.player, "graveyard", {
      fromZone,
    });
    await selectCard(game, game.bot.id, 0, targetZone);
    await movePromise;
    await waitUntil(
      () => game.bot.graveyard.includes(target),
      `${cardKind} target was not destroyed.`,
    );

    assert.equal(game.player.graveyard.includes(sword), true);
    assert.equal(game.bot.spellTrap.includes(target), false);
    assert.notEqual(game.bot.fieldSpell, target);
    assert.equal(game.chainSystem.getFastEffectState().state, "open");
  });
}
