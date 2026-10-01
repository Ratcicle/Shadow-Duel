import { completeTestSelections, placeFieldCards } from "./helpers/game.js";
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

test("Escape preserves Shadow-Heart Grave's mandatory summon during real Chain resolution", async t => {
  const game = createGame(t);
  game.turn = "bot";
  game.turnCounter = 4;
  const grave = createCard(cardDatabaseByName.get("Shadow-Heart Grave"), game.player);
  const monster = createCard(cardDatabaseByName.get("Shadow-Heart Imp"), game.player);
  grave.isFacedown = true;
  grave.setTurn = 2;
  placeFieldCards(game.player.spellTrap, grave);
  game.player.hand.push(monster);
  let dispatchKey: ((event: KeyboardEvent) => void) | undefined;
  game.ui.bindGlobalKeydown = callback => { dispatchKey = callback; };
  game.bindCardInteractions();
  const context = { type: "phase_change" as const, player: game.bot,
    fromPhase: "main1" as const, toPhase: "battle" as const };
  const candidate = required(game.chainSystem.getActivatableCardsInChain(game.player, context)
    .find(entry => entry.card === grave));
  const prepared = await game.chainSystem.prepareChainResponse(candidate, game.player, context);
  assert.equal(prepared.success, true);
  game.chainSystem.addToChain(required(prepared.preparedActivation));
  const pending = Promise.resolve(game.chainSystem.resolveChain());
  await waitUntil(() => game.targetSelection, "Expected Grave's mandatory monster choice");
  const session = required(game.targetSelection);
  assert.equal(session.allowCancel, false);
  assert.equal(session.preventCancel, false, "Reproduce the allowCancel-only contract");
  required(dispatchKey)(unsafeFixture<KeyboardEvent>({ key: "Escape" }, "Global shortcut only reads the key"));
  assert.equal(game.targetSelection, session, "Escape must retain the mandatory session");
  assert.equal(game.selectionState, "selecting");
  assert.ok(game.player.hand.includes(monster));
  assert.ok(game.player.spellTrap.includes(grave), "Chain cleanup must wait for the summon");
  assert.equal(game.player.summonCount, 0);
  await completeTestSelections(game, pending);
  assert.ok(game.player.field.includes(monster));
  assert.equal(game.player.hand.includes(monster), false);
  assert.equal(game.player.summonCount, 1);
  assert.equal(game.lastSummonTransaction?.summonOrigin, "effect_resolution");
  assert.ok(game.player.graveyard.includes(grave));
  assert.equal(game.player.spellTrap.includes(grave), false);
});

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
  placeFieldCards(game.player.field, behemoth);
  placeFieldCards(game.bot.field, target);

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
  placeFieldCards(game.bot.field, target);

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
  placeFieldCards(game.player.field, surveyor);
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
  placeFieldCards(game.player.field, behemoth);
  placeFieldCards(game.bot.field, eel);
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
    required(required(recoverEffect.actions)[0]),
    "targetRef",
    "missing_target_ref",
  );
  const eel = createCard(brokenEelData, game.bot);
  eel.position = "attack";
  const darknessValley = createCard(
    cardDatabaseByName.get("Darkness Valley"),
    game.bot,
  );
  placeFieldCards(game.player.field, attacker);
  placeFieldCards(game.bot.field, eel);
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

test("system abort settles the legacy activation waiter without player-cancellation or result callbacks", async t => {
  const game = createRuntimeGame({ disableChains: true, captureReplay: false });
  t.after(() => game.dispose());
  const card = new Card({ name: "Selection source", cardKind: "spell", subtype: "normal", effects: [] }, "player");
  game.player.hand.push(card);
  let settled = false;
  const pending = game.runActivationPipelineWait({ card, owner: game.player, activationZone: "hand",
    prepareForExistingChain: true, openActivationWindow: false,
    onCancel: () => assert.fail("System abort must not call player cancellation"),
    onFailure: () => assert.fail("System abort must not finalize an old activation"),
    activate: () => ({ success: false, needsSelection: true,
      selectionContract: { requirements: [{ id: "chosen", min: 1, max: 1, zone: "choice", candidates: [{ key: "yes", zone: "choice" }] }] } }),
  }).then(value => { settled = true; return value; });
  await waitUntil(() => game.targetSelection, "activation must open its choice");
  game.applyScenarioSetup({ player: { lp: 6000 } });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, true);
  assert.equal((await pending).code, "SELECTION_ABORTED");
});

for (const nested of [false, true]) {
  test(`system abort stops the old optional action sequence after scenario replacement (nested=${nested})`, async t => {
    const game = createRuntimeGame({ disableChains: true, captureReplay: false });
    t.after(() => game.dispose());
    game.applyScenarioSetup({ player: { hand: [{ id: 1 }] } });
    const optional = { type: "optional_target_actions" as const, optional: true, allowCancel: false,
      targets: [{ id: "pick", owner: "self" as const, zone: "hand" as const, cardKind: "monster" as const, count: { min: 1, max: 1 } }],
      actions: [{ type: "draw" as const, amount: 1 }] };
    const actions = [nested ? { type: "optional_target_actions" as const, optional: false, targets: [], actions: [optional, { type: "draw" as const, amount: 1 }] } : optional,
      { type: "draw" as const, amount: 1 }];
    const pending = game.effectEngine.applyActions(actions,
      { player: game.player, opponent: game.bot, source: required(game.player.hand[0]), activationContext: { timing: "resolution" } }, {});
    await waitUntil(() => game.targetSelection, "optional action must open selection");
    game.applyScenarioSetup({ player: { hand: [], deck: [{ id: 3 }, { id: 4 }] } });
    const result = await pending;
    assert.equal(result.success, false);
    assert.deepEqual(game.player.hand, []);
    assert.deepEqual(game.player.deck.map(card => card.id), [3, 4]);
  });
}
