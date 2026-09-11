import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import test from "node:test";
import type { CardConstructorData } from "../src/core/contracts/cards.js";
import type { GamePlayer } from "../src/core/contracts/player.js";
import type { SelectionKind } from "../src/core/contracts/selection.js";
import type { CanonicalZone } from "../src/core/contracts/zones.js";
import { record, required, unsafeFixture } from "./helpers/fixtures.js";
import type { RuntimeGame } from "./helpers/game.js";
import { createRuntimeGame } from "./helpers/game.js";

import Card from "../src/core/Card.js";
import { cardDatabaseByName } from "./helpers/fixtures.js";

function createGame(t: TestContext) {
  const game = createRuntimeGame({
    captureReplay: false,
    laboratoryMode: true,
  });
  game.turn = game.player.id;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.phaseDelayMs = 0;
  game.aiSuccessfulActionDelayMs = 0;
  game.aiPresentationStepDelayMs = 0;
  game.player.controllerType = "human";
  game.bot.controllerType = "ai";
  t.after(() => game.dispose());
  return game;
}

function createCard(data: CardConstructorData | undefined, player: GamePlayer) {
  assert.ok(data, "Card fixture must exist.");
  const card = new Card(data, player.id);
  card.owner = player.id;
  card.controller = player.id;
  return card;
}

async function waitUntil(
  predicate: () => unknown,
  message: string,
  attempts = 200,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

async function selectCard(
  game: RuntimeGame,
  kind: SelectionKind,
  ownerId: string,
  index: number,
  zone: CanonicalZone,
) {
  await waitUntil(
    () => game.targetSelection?.kind === kind,
    `Expected a ${kind} selection session.`,
  );
  assert.equal(
    game.handleTargetSelectionClick(ownerId, index, null, zone),
    true,
  );
  game.advanceTargetSelection();
}

test("seleção humana do Behemoth sobrevive à revalidação canônica", async (t) => {
  const game = createGame(t);
  const behemoth = createCard(
    cardDatabaseByName.get("Cursed Rock Behemoth"),
    game.player,
  );
  const target = createCard(
    {
      id: 99101,
      name: "Original DEF target",
      cardKind: "monster",
      atk: 1000,
      def: 1800,
    },
    game.bot,
  );
  game.player.field.push(behemoth);
  game.bot.field.push(target);

  void game.tryActivateMonsterEffect(behemoth, null, "field", game.player);
  await selectCard(game, "target", game.bot.id, 0, "field");
  await waitUntil(
    () => behemoth.atk === 4100,
    "Behemoth did not resolve after its human target selection.",
  );

  assert.equal(behemoth.atk, behemoth.baseAtk + target.baseDef);
});

test("Natural Selection paga custo humano, declara alvo e resolve", async (t) => {
  const game = createGame(t);
  const naturalSelection = createCard(
    cardDatabaseByName.get("Natural Selection"),
    game.player,
  );
  const discard = createCard(
    { id: 99102, name: "Discard cost", cardKind: "monster" },
    game.player,
  );
  const target = createCard(
    {
      id: 99103,
      name: "Face-up Natural Selection target",
      cardKind: "monster",
      atk: 1000,
      def: 1000,
    },
    game.bot,
  );
  game.player.hand.push(naturalSelection, discard);
  game.bot.field.push(target);

  void game.tryActivateSpell(naturalSelection, 0);
  await selectCard(game, "cost", game.player.id, 1, "hand");
  await selectCard(game, "target", game.bot.id, 0, "field");
  await waitUntil(
    () =>
      game.player.graveyard.includes(naturalSelection) &&
      game.bot.graveyard.includes(target),
    "Natural Selection did not finish its Chain resolution.",
  );

  assert.equal(game.player.graveyard.includes(discard), true);
  assert.equal(game.bot.field.includes(target), false);
});

test("Topógrafo aceita descarte humano sem candidato prévio para a Invocação opcional", async (t) => {
  const game = createGame(t);
  const surveyor = createCard(
    cardDatabaseByName.get("Vulcanomaton Surveyor"),
    game.player,
  );
  const discard = createCard(
    {
      id: 99104,
      name: "Non-EARTH discard",
      cardKind: "monster",
      attribute: "Dark",
      level: 8,
    },
    game.player,
  );
  const searchable = createCard(
    cardDatabaseByName.get("Vulcanomaton Excavator"),
    game.player,
  );
  game.player.field.push(surveyor);
  game.player.hand.push(discard);
  game.player.deck.push(searchable);

  const triggerPackage = await game.effectEngine.collectAfterSummonTriggers({
    card: surveyor,
    player: game.player,
    method: "normal",
    fromZone: "hand",
  });
  const trigger = triggerPackage.entries.find(
    (entry) =>
      entry.effect?.id === "vulcanomaton_surveyor_normal_search_and_summon",
  );
  assert.ok(
    trigger,
    "The optional post-search Summon must not hide the Trigger.",
  );

  const preparationPromise = game.runActivationPipelineWait(
    unsafeFixture<Parameters<typeof game.runActivationPipelineWait>[0]>(
      {
        ...trigger.config,
        activationContext: Object.assign(
          {},
          {
            ...(trigger.config.activationContext || {}),
            confirmed: true,
            triggeredByEvent: "after_summon",
          },
        ),
        prepareForExistingChain: true,
        allowDuringChainWindow: true,
        allowDuringResolving: true,
        allowDuringOpponentTurn: true,
      },
      "Legacy collector context includes optional alias zones; this fixture came from an actual normal summon and uses the field zone.",
    ),
  );
  await selectCard(game, "cost", game.player.id, 0, "hand");
  const preparation = await preparationPromise;

  assert.ok(preparation.success === true);
  assert.ok(preparation.preparedActivation);
  assert.equal(game.player.graveyard.includes(discard), true);
  assert.deepEqual(preparation.preparedActivation.costSelections, {
    vulcanomaton_surveyor_discard_cost: [discard],
  });
});

test("Behemoth destroi Abyssal Eel sem prender a transicao para Main Phase 2", async (t) => {
  const game = createGame(t);
  const behemoth = createCard(
    cardDatabaseByName.get("Cursed Rock Behemoth"),
    game.player,
  );
  behemoth.position = "attack";
  const eel = createCard(
    cardDatabaseByName.get("Shadow-Heart Abyssal Eel"),
    game.bot,
  );
  eel.position = "defense";
  eel.isFacedown = false;
  const darknessValley = createCard(
    cardDatabaseByName.get("Darkness Valley"),
    game.bot,
  );
  game.player.field.push(behemoth);
  game.bot.field.push(eel);
  game.bot.graveyard.push(darknessValley);

  void game.tryActivateMonsterEffect(behemoth, null, "field", game.player);
  await selectCard(game, "target", game.bot.id, 0, "field");
  await waitUntil(
    () => behemoth.atk === behemoth.baseAtk + eel.baseDef,
    "Behemoth buff did not resolve before battle.",
  );

  game.phase = "battle";
  game.battleStep = "battle";
  const combatResult = required(await game.resolveCombat(behemoth, eel));

  assert.ok(combatResult.ok === true);
  assert.equal(game.bot.graveyard.includes(eel), true);
  assert.equal(game.bot.hand.includes(darknessValley), true);
  assert.equal(game.chainSystem.isOpenGameState(), true);

  const phaseResult = await game.nextPhase();
  assert.notEqual(
    phaseResult == null ? undefined : record(phaseResult).ok,
    false,
  );
  assert.equal(game.phase, "main2");
});

test("falha de Trigger no fim do Damage Step recupera o Fast Effect Timing", async (t) => {
  const game = createGame(t);
  game.player.controllerType = "ai";
  const attacker = createCard(
    {
      id: 99105,
      name: "Damage Step recovery attacker",
      cardKind: "monster",
      atk: 3000,
      def: 1000,
      effects: [],
    },
    game.player,
  );
  attacker.position = "attack";
  const brokenEelData = required(
    structuredClone(cardDatabaseByName.get("Shadow-Heart Abyssal Eel")),
  );
  const recoverEffect = required(
    required(brokenEelData.effects).find(
      (effect) => effect.id === "shadow_heart_abyssal_eel_recover",
    ),
  );
  // Deliberately corrupt the cloned definition to exercise failed-trigger recovery.
  Reflect.set(
    required(recoverEffect.actions)[0],
    "targetRef",
    "missing_target_ref",
  );
  const eel = createCard(brokenEelData, game.bot);
  eel.position = "attack";
  const darknessValley = createCard(
    cardDatabaseByName.get("Darkness Valley"),
    game.bot,
  );
  game.player.field.push(attacker);
  game.bot.field.push(eel);
  game.bot.graveyard.push(darknessValley);
  game.phase = "battle";
  game.battleStep = "battle";

  const combatResult = required(await game.resolveCombat(attacker, eel));

  assert.ok(combatResult.ok === false);
  assert.match(required(combatResult.reason), /Action "move" failed/);
  assert.equal(game.chainSystem.isOpenGameState(), true);
  const phaseResult = await game.nextPhase();
  assert.notEqual(
    phaseResult == null ? undefined : record(phaseResult).ok,
    false,
  );
  assert.equal(game.phase, "main2");
});
