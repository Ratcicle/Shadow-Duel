import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import * as generation from "../../src/core/ai/common/actionGeneration.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { moveCardToZone } from "../../src/core/ai/common/zones.js";
import { beamSearchTurn, greedySearchWithEvalV2 } from "../../src/core/ai/BeamSearch.js";
import { turnLineSearch } from "../../src/core/ai/TurnLineSearch.js";
import { fixtureGameTreeSearch } from "../helpers/gameTree.js";
import type { AIAction, AIPlannedAction, AIState, SynchroAIAction } from "../../src/core/contracts/ai.js";
import type { AiLiveGamePort, AiStateShape } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { CardFilter } from "../../src/core/contracts/effects.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function setup(t: TestContext, actor: "player" | "bot" = "bot") {
  const first = new Bot("techzero");
  first.id = "player";
  const second = new Bot("techzero");
  const game = createRuntimeGame({ opponentOverride: second, captureReplay: false, laboratoryMode: true });
  game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot extends Player and supports action-runtime selection");
  t.after(() => game.dispose("synchro_ai_test_complete"));
  const bot = actor === "player" ? first : second;
  game.turn = actor;
  game.phase = "main1";
  game.turnCounter = 2;
  game.disablePresentationDelays = true;
  game.ui.showConfirmPrompt = async () => true;
  game.ui.showTrapActivationModal = async () => true;
  const botGame = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(
    game, "Concrete Game and Bot provide the attached runtime and clone capabilities",
  );
  first.game = botGame;
  second.game = botGame;
  const make = (id: number) => new Card(cardDefinition(id), bot.id);
  const multimodal = make(503);
  const portal = make(509);
  const phoenix = make(514);
  const lancer = make(516);
  const singularity = make(517);
  placeFieldCards(bot.field, multimodal, portal, phoenix);
  bot.extraDeck.push(lancer, singularity);
  bot.deck.push(make(518), make(520));
  return { game, botGame, bot, make, multimodal, portal, phoenix, lancer, singularity };
}

function synchroActions(game: AiLiveGamePort) {
  assert.equal(typeof generation.getGenericSynchroActions, "function", "shared Synchro action generation is available");
  return generation.getGenericSynchroActions(game);
}

for (const actor of ["player", "bot"] as const) {
  test(`Bot generates distinct Lancer and Singularity materials in both positions (${actor})`, t => {
    const { bot, botGame, multimodal, portal, phoenix, lancer, singularity } = setup(t, actor);
    const actions = bot.generateMainPhaseActions(botGame).filter(action => action.type === "synchro");
    assert.equal(actions.length, 4);
    for (const position of ["attack", "defense"] as const) {
      const lancerAction = required(actions.find(action => action.synchroInstanceId === lancer.instanceId && action.position === position));
      const singularityAction = required(actions.find(action => action.synchroInstanceId === singularity.instanceId && action.position === position));
      assert.deepEqual(new Set(lancerAction.materialInstanceIds), new Set([multimodal.instanceId, phoenix.instanceId]));
      assert.deepEqual(new Set(singularityAction.materialInstanceIds), new Set([multimodal.instanceId, portal.instanceId, phoenix.instanceId]));
    }
    assert.equal(bot.filterValidActionsForCurrentState(actions, botGame).length, 4);
    assert.ok(actions.every(action => action.priority !== undefined), "strategy scores survive the generic fallback");
  });

  test(`Bot supplements partial strategy Synchros without replacing its choices (${actor})`, t => {
    const { bot, botGame, lancer } = setup(t, actor);
    const chosen = { ...required(synchroActions(botGame).find(action =>
      action.synchroInstanceId === lancer.instanceId && action.position === "defense")), priority: 123 };
    bot.strategy.generateMainPhaseActions = () => [chosen];
    const actions = bot.generateMainPhaseActions(botGame).filter(action => action.type === "synchro");
    assert.equal(actions.length, 4);
    assert.equal(actions.find(action => action.synchroInstanceId === lancer.instanceId &&
      action.position === "defense"), chosen, "retain the scored strategy action");
    bot.strategy.generateMainPhaseActions = () => [];
    assert.equal(bot.generateMainPhaseActions(botGame).filter(action => action.type === "synchro").length, 4,
      "strategies without Synchro generation still receive every generic procedure");
  });

  for (const position of ["attack", "defense"] as const) {
    test(`Bot executes the chosen Synchro through real material moves (${actor}, ${position})`, async t => {
      const { game, bot, botGame, multimodal, portal, phoenix, singularity } = setup(t, actor);
      const action: SynchroAIAction = {
        type: "synchro", synchroInstanceId: singularity.instanceId,
        materialInstanceIds: [multimodal.instanceId, portal.instanceId, phoenix.instanceId], position,
      };
      const moves: string[] = [];
      game.on("card_moved", ({ card, fromZone, toZone }) => { moves.push(`${card.id}:${fromZone}->${toZone}`); });
      assert.equal(await bot.executeMainPhaseAction(botGame, action), true);
      assert.deepEqual(moves.slice(0, 4), ["503:field->graveyard", "509:field->graveyard", "514:field->graveyard", "517:extraDeck->field"]);
      assert.deepEqual(bot.field, [singularity]);
      assert.equal(singularity.position, position);
      assert.equal(singularity.lastSummonMethod, "synchro");
      assert.equal(bot.extraDeck.includes(singularity), false);
      assert.deepEqual(new Set(bot.graveyard), new Set([multimodal, portal, phoenix]));
      assert.equal(bot.hand.length, 1, "Multimodal's real material trigger still draws");
      assert.equal(bot.summonCount, 0);
    });
  }
}

test("shared generation works on a clone without reading its live Game", t => {
  const { bot, botGame, lancer, singularity } = setup(t);
  const state = bot.cloneGameState(botGame);
  Object.defineProperty(state, "_gameRef", { configurable: true, get() { throw new Error("live game access"); } });
  const actions = synchroActions(state);
  assert.deepEqual(actions.map(action => action.synchroInstanceId).sort(),
    [lancer.instanceId, lancer.instanceId, singularity.instanceId, singularity.instanceId].sort());
  required(state.bot.field.find(card => card.id === 503)).level = 2;
  assert.deepEqual(synchroActions(state), [], "legality uses the clone's changed level");
});

test("Reactor requires a Synchro non-Tuner instead of an equal-level main-deck monster", t => {
  const { bot, botGame, make } = setup(t);
  const raptor = make(505);
  const connector = make(507);
  const mage = make(512);
  const reactor = make(515);
  bot.field = [];
  bot.extraDeck = [reactor];
  placeFieldCards(bot.field, raptor, connector);
  assert.deepEqual(synchroActions(botGame), []);
  bot.field = [];
  placeFieldCards(bot.field, raptor, mage);
  assert.equal(synchroActions(botGame).length, 2);
});

test("Synchro generation applies generic material stat filters", t => {
  const { bot, botGame, game, lancer, phoenix } = setup(t);
  bot.extraDeck = [lancer];
  lancer.synchro = {
    ...required(lancer.synchro),
    materialFilters: { ...lancer.synchro?.materialFilters, nonTuner: { minAtk: phoenix.atk + 1 } },
  };
  assert.deepEqual(game.getSynchroMaterialCombos(bot, lancer), []);
  assert.deepEqual(synchroActions(botGame), []);
  phoenix.atk += 1;
  assert.equal(game.getSynchroMaterialCombos(bot, lancer).length, 1);
  assert.equal(synchroActions(botGame).length, 2);
});

for (const filter of [{ level: 8 }, { minCounters: 1 }] satisfies CardFilter[]) {
  test(`Synchro generation matches runtime for ${JSON.stringify(filter)}`, t => {
    const { bot, botGame, game, lancer, phoenix } = setup(t);
    bot.extraDeck = [lancer];
    lancer.synchro = {
      ...required(lancer.synchro),
      materialFilters: { ...lancer.synchro?.materialFilters, nonTuner: filter },
    };
    assert.deepEqual(game.getSynchroMaterialCombos(bot, lancer), []);
    assert.deepEqual(synchroActions(botGame), []);
    if ("minCounters" in filter) {
      phoenix.addCounter("default", 1);
      assert.equal(game.getSynchroMaterialCombos(bot, lancer).length, 1);
      assert.equal(synchroActions(botGame).length, 2);
      assert.equal(synchroActions(bot.cloneGameState(botGame)).length, 2);
    }
  });
}

for (const actor of ["player", "bot"] as const) {
test(`Synchro material equip filters require an attached equip in its owner's zone (${actor})`, t => {
  const { bot, botGame, game, make, lancer, phoenix } = setup(t, actor);
  const equip = make(301);
  bot.extraDeck = [lancer];
  lancer.synchro = {
    ...required(lancer.synchro),
    materialFilters: { ...lancer.synchro?.materialFilters, nonTuner: { equippedWithFilters: { cardKind: "spell" } } },
  };
  phoenix.equips = [equip];
  equip.equippedTo = phoenix;
  assert.deepEqual(game.getSynchroMaterialCombos(bot, lancer), []);
  assert.deepEqual(synchroActions(botGame), [], "a stale equips reference does not qualify");
  bot.spellTrap.push(equip);
  assert.equal(game.getSynchroMaterialCombos(bot, lancer).length, 1);
  assert.equal(synchroActions(botGame).length, 2);
  assert.equal(synchroActions(bot.cloneGameState(botGame)).length, 2);
  equip.equippedTo = null;
  assert.deepEqual(game.getSynchroMaterialCombos(bot, lancer), []);
  assert.deepEqual(synchroActions(botGame), []);
});
}

test("Synchro summon restrictions and field limits use canonical level filters", t => {
  const { bot, botGame, game, lancer } = setup(t);
  bot.extraDeck = [lancer];
  game.registerSpecialSummonRestriction(bot, { allowedFilters: { level: 11 } });
  assert.equal(game.canSummonSynchroCard(bot, lancer).ok, false);
  assert.deepEqual(synchroActions(botGame), []);
  bot.specialSummonRestrictions = [];
  lancer.fieldLimit = {
    key: "level_eleven", label: "Level eleven", scope: "controller",
    max: 1, filters: { level: 11 },
  };
  assert.equal(game.canSummonSynchroCard(bot, lancer).ok, true);
  assert.equal(synchroActions(botGame).length, 2);
});

test("a blocked material combination does not hide another legal Synchro combination", async t => {
  const { bot, botGame, game, make, multimodal, phoenix, lancer } = setup(t);
  const existing = make(516);
  existing.level = 7;
  bot.field = [];
  placeFieldCards(bot.field, multimodal, phoenix, existing);
  bot.extraDeck = [lancer];
  lancer.fieldLimit = {
    key: "synchro_copy_limit", label: "Synchro copy", scope: "controller",
    max: 1, filters: { cardId: required(lancer.id) },
  };
  const actions = synchroActions(botGame);
  assert.equal(actions.length, 2);
  const action = required(actions[0]);
  assert.deepEqual(new Set(action.materialInstanceIds), new Set([multimodal.instanceId, existing.instanceId]));
  assert.equal(game.canSummonSynchroCard(bot, lancer).ok, true);
  assert.equal(bot.filterValidActionsForCurrentState(actions, botGame).length, 2);
  assert.equal(await bot.executeMainPhaseAction(botGame, action), true);
  assert.ok(bot.field.includes(lancer) && bot.field.includes(phoenix));
});

test("Synchro generation and execution remain available in Main2", async t => {
  const { game, bot, botGame } = setup(t);
  game.phase = "main2";
  const actions = synchroActions(botGame);
  assert.equal(actions.length, 4);
  assert.equal(await bot.executeMainPhaseAction(botGame, required(actions[0])), true);
});

for (const blockedWindow of ["battle", "opponent_turn"] as const) {
  test(`Synchro execution refuses ${blockedWindow}`, async t => {
    const { game, bot, botGame } = setup(t);
    const action = required(synchroActions(botGame)[0]);
    if (blockedWindow === "battle") {
      game.phase = "battle";
      assert.deepEqual(synchroActions(botGame), []);
    } else {
      game.turn = "player";
    }
    const field = [...bot.field];
    assert.equal(await bot.executeMainPhaseAction(botGame, action), false);
    assert.deepEqual(bot.field, field);
  });
}

test("Synchro execution retains the chosen copy after field order changes", async t => {
  const { bot, botGame, make, multimodal, phoenix, lancer } = setup(t);
  const second = make(503);
  placeFieldCards(bot.field, second);
  const actions = synchroActions(botGame).filter(action => action.synchroInstanceId === lancer.instanceId && action.position === "defense");
  assert.equal(actions.length, 2);
  const chosen = required(actions.find(action => action.materialInstanceIds.includes(second.instanceId)));
  bot.field.reverse();
  assert.equal(await bot.executeMainPhaseAction(botGame, chosen), true);
  assert.ok(bot.field.includes(multimodal));
  assert.ok(bot.graveyard.includes(second) && bot.graveyard.includes(phoenix));
  assert.equal(lancer.position, "defense");
});

for (const invalidation of ["removed", "facedown", "duplicate", "level", "destination", "foreign"] as const) {
  test(`Synchro refuses ${invalidation} instances without moving cards`, async t => {
    const { game, bot, botGame, make, multimodal, phoenix, lancer } = setup(t);
    const action: SynchroAIAction = {
      type: "synchro", synchroInstanceId: lancer.instanceId,
      materialInstanceIds: [multimodal.instanceId, phoenix.instanceId], position: "attack",
    };
    // A homonymous legal replacement cannot satisfy a stale reference.
    const replacement = make(503);
    placeFieldCards(bot.field, replacement);
    if (invalidation === "removed") await game.moveCard(multimodal, bot, "graveyard", { fromZone: "field" });
    if (invalidation === "facedown") multimodal.isFacedown = true;
    if (invalidation === "duplicate") action.materialInstanceIds = [multimodal.instanceId, multimodal.instanceId, phoenix.instanceId];
    if (invalidation === "level") multimodal.level = 2;
    if (invalidation === "destination") bot.extraDeck = [make(516)];
    if (invalidation === "foreign") action.materialInstanceIds[0] = `missing:${multimodal.instanceId}`;
    const before = { field: [...bot.field], graveyard: [...bot.graveyard], extraDeck: [...bot.extraDeck] };
    const moves: unknown[] = [];
    game.on("card_moved", payload => { moves.push(payload); });
    assert.deepEqual(bot.filterValidActionsForCurrentState([action], botGame), []);
    assert.equal(await bot.executeMainPhaseAction(botGame, action), false);
    assert.deepEqual({ field: bot.field, graveyard: bot.graveyard, extraDeck: bot.extraDeck }, before);
    assert.deepEqual(moves, []);
  });
}

test("Synchro simulation establishes the summon using the exact material instances", t => {
  const { bot, botGame, multimodal, phoenix, lancer } = setup(t);
  const state = bot.cloneGameState(botGame);
  const action: SynchroAIAction = {
    type: "synchro", synchroInstanceId: lancer.instanceId,
    materialInstanceIds: [multimodal.instanceId, phoenix.instanceId], position: "attack",
  };
  const remaining = required(state.bot.field.find(card => card.id === 509));
  applyGenericSimulatedMainPhaseAction(state, action);
  assert.deepEqual(state._simUnsupportedActions || [], []);
  assert.deepEqual(state.bot.field.map(card => card.instanceId), [remaining.instanceId, lancer.instanceId]);
  assert.deepEqual(state.bot.graveyard.map(card => card.instanceId), [multimodal.instanceId, phoenix.instanceId]);
  assert.equal(required(state.bot.field.find(card => card.instanceId === lancer.instanceId)).lastSummonMethod, "synchro");
  assert.equal(bot.field.length, 3);
});

for (const search of ["beam", "greedy", "gameTree", "turnLine"] as const) {
  for (const withSupportedAction of [false, true]) {
    test(`${search} excludes incomplete Synchro simulations and fallback (alternative: ${withSupportedAction})`, async t => {
      const { bot, botGame, multimodal, phoenix, lancer } = setup(t);
      const state = bot.cloneGameState(botGame);
      const unsupported: SynchroAIAction = {
        type: "synchro", synchroInstanceId: lancer.instanceId,
        materialInstanceIds: [multimodal.instanceId, phoenix.instanceId], position: "attack",
      };
      const supported: AIAction = { type: "position_change", fieldIndex: 0, toPosition: "defense" };
      const candidates: AIAction[] = [unsupported, ...(withSupportedAction ? [supported] : [])];
      // This policy would wrongly reward an unimplemented transition if search allowed it.
      const strategy = {
        generateMainPhaseActions: () => candidates,
        simulateMainPhaseAction(snapshot: AiStateShape, action: AIPlannedAction) {
          snapshot.bot.lp += action.type === "synchro" ? 1_000_000 : 100;
          if (action.type === "synchro") snapshot._simUnsupportedActions = ["synchro_effect_missing"];
        },
        evaluateBoard: (snapshot: AIState) => snapshot.bot?.lp || 0,
      };
      const result = search === "beam" ? await beamSearchTurn(state, strategy, { maxDepth: 1, beamWidth: 2, preGeneratedActions: candidates }) :
        search === "greedy" ? await greedySearchWithEvalV2(state, strategy, { preGeneratedActions: candidates }) :
        search === "gameTree" ? fixtureGameTreeSearch(state, strategy, state.bot, 1) :
        await turnLineSearch(state, strategy, { maxDepth: 1, beamWidth: 2, candidateLimit: 2, preGeneratedActions: candidates });
      assert.equal(result?.action?.type ?? null, withSupportedAction ? "position_change" : null);
      assert.equal(state.bot.lp, 8000, "search never mutates the input state");
    });
  }

  test(`${search} can select a completely simulated Synchro`, async t => {
    const { bot, botGame } = setup(t);
    const state = bot.cloneGameState(botGame);
    const strategy = {
      generateMainPhaseActions: generation.getGenericSynchroActions,
      simulateMainPhaseAction: (snapshot: Parameters<typeof applyGenericSimulatedMainPhaseAction>[0], action: AIPlannedAction) => {
        if (action.type !== "simulatedBattle") applyGenericSimulatedMainPhaseAction(snapshot, action, { enableSimulatedEvents: true });
      },
      evaluateBoard: (snapshot: AIState) => snapshot.bot?.field?.reduce((sum, card) => sum + (card.atk || 0), 0) || 0,
    };
    const result = search === "beam" ? await beamSearchTurn(state, strategy, { maxDepth: 1, beamWidth: 4 }) :
      search === "greedy" ? await greedySearchWithEvalV2(state, strategy) :
      search === "gameTree" ? fixtureGameTreeSearch(state, strategy, state.bot, 1) :
      await turnLineSearch(state, strategy, { maxDepth: 1, beamWidth: 4 });
    assert.equal(result?.action?.type, "synchro");
    assert.equal(bot.field.length, 3);
  });
}

test("Synchro simulation keeps an unchosen same-name copy after field reordering", t => {
  const { bot, botGame, make, multimodal, phoenix, lancer } = setup(t);
  const second = make(503);
  placeFieldCards(bot.field, second);
  const state = bot.cloneGameState(botGame);
  state.bot.field.reverse();
  applyGenericSimulatedMainPhaseAction(state, { type: "synchro", synchroInstanceId: lancer.instanceId,
    materialInstanceIds: [second.instanceId, phoenix.instanceId], position: "defense" });
  assert.ok(state.bot.field.some(card => card.instanceId === multimodal.instanceId));
  assert.equal(state.bot.field.some(card => card.instanceId === second.instanceId), false);
  assert.deepEqual(new Set(state.bot.graveyard.map(card => card.instanceId)), new Set([second.instanceId, phoenix.instanceId]));
  assert.equal(required(state.bot.field.find(card => card.instanceId === lancer.instanceId)).position, "defense");
});

for (const invalidation of ["removed", "facedown", "duplicate", "level", "destination", "foreign"] as const) {
  test(`Synchro simulation refuses ${invalidation} material references without mutating zones`, t => {
    const { bot, botGame, make, multimodal, phoenix, lancer } = setup(t);
    const second = make(503);
    placeFieldCards(bot.field, second);
    const state = bot.cloneGameState(botGame);
    const original = required(state.bot.field.find(card => card.instanceId === multimodal.instanceId));
    const action: SynchroAIAction = { type: "synchro", synchroInstanceId: lancer.instanceId,
      materialInstanceIds: [multimodal.instanceId, phoenix.instanceId], position: "attack" };
    if (invalidation === "removed") moveCardToZone(state.bot, original, "graveyard");
    if (invalidation === "facedown") original.isFacedown = true;
    if (invalidation === "duplicate") action.materialInstanceIds = [multimodal.instanceId, multimodal.instanceId, phoenix.instanceId];
    if (invalidation === "level") original.level = 2;
    if (invalidation === "destination") required(state.bot.extraDeck.find(card => card.instanceId === lancer.instanceId)).instanceId = `replacement:${lancer.instanceId}`;
    if (invalidation === "foreign") action.materialInstanceIds[0] = `foreign:${multimodal.instanceId}`;
    const before = { field: [...state.bot.field], extraDeck: [...state.bot.extraDeck], graveyard: [...state.bot.graveyard] };
    applyGenericSimulatedMainPhaseAction(state, action, { enableSimulatedEvents: true });
    assert.deepEqual({ field: state.bot.field, extraDeck: state.bot.extraDeck, graveyard: state.bot.graveyard }, before);
  });
}

test("negated Multimodal cannot supply the alternate non-Tuner role", t => {
  const { bot, botGame, make, multimodal, phoenix, lancer } = setup(t);
  const pulse = make(508);
  const samurai = make(511);
  bot.field = [];
  placeFieldCards(bot.field, multimodal, phoenix, pulse);
  bot.extraDeck = [lancer, samurai];
  const state = bot.cloneGameState(botGame);
  assert.ok(synchroActions(state).some(action => action.synchroInstanceId === samurai.instanceId));
  required(state.bot.field.find(card => card.instanceId === multimodal.instanceId)).effectsNegated = true;
  assert.ok(synchroActions(state).every(action => action.synchroInstanceId !== samurai.instanceId));
  assert.ok(synchroActions(state).some(action => action.synchroInstanceId === lancer.instanceId), "its printed Tuner type remains usable");
  const before = [...state.bot.field];
  applyGenericSimulatedMainPhaseAction(state, { type: "synchro", synchroInstanceId: samurai.instanceId,
    materialInstanceIds: [multimodal.instanceId, pulse.instanceId], position: "attack" });
  assert.deepEqual(state.bot.field, before);
  assert.deepEqual(state.bot.graveyard, []);
});

for (const actor of ["player", "bot"] as const) {
  test(`unpayable redirected materials are excluded before a real summon commits (${actor})`, async t => {
    const { game, bot, botGame, make, phoenix } = setup(t, actor);
    const core = make(501);
    core.banishWhenLeavesField = true;
    const connector = make(507);
    connector.level = 7;
    const reactor = make(515);
    bot.field = [];
    placeFieldCards(bot.field, core, phoenix);
    bot.hand = [connector];
    bot.extraDeck = [reactor];
    const synchro: SynchroAIAction = { type: "synchro", synchroInstanceId: reactor.instanceId,
      materialInstanceIds: [core.instanceId, phoenix.instanceId], position: "attack" };
    const tribute: AIAction = { type: "summon", cardId: connector.id, index: 0, position: "attack" };
    const transactions: string[] = [];
    game.on("summon_transaction", event => { transactions.push(event.status); });
    assert.deepEqual(synchroActions(botGame), [], "generic fallback cannot propose an unpayable material set");
    const clone = bot.cloneGameState(botGame);
    Object.defineProperty(clone, "_gameRef", { get() { throw new Error("live state consulted"); } });
    assert.deepEqual(synchroActions(clone), []);
    assert.deepEqual(bot.filterValidActionsForCurrentState([tribute, synchro], botGame), []);
    assert.equal(await bot.executeMainPhaseAction(botGame, tribute), false);
    assert.equal(await bot.executeMainPhaseAction(botGame, synchro), false);
    assert.deepEqual(transactions, [], "preflight must reject before the destination card is committed");
    assert.deepEqual(bot.field, [core, phoenix]);
    assert.deepEqual(bot.hand, [connector]);
    assert.deepEqual(bot.extraDeck, [reactor]);
    assert.equal(bot.summonCount, 0);
    assert.equal(core.banishWhenLeavesField, true);
    phoenix.effectsNegated = true;
    assert.equal(synchroActions(botGame).length, 2, "negated protection allows both positions");
    assert.equal(bot.filterValidActionsForCurrentState([tribute, synchro], botGame).length, 2);
  });

  test(`simulated tribute refusal preserves all cards and the normal summon (${actor})`, t => {
    const { bot, botGame, make, phoenix } = setup(t, actor);
    const core = make(501);
    core.banishWhenLeavesField = true;
    const connector = make(507);
    connector.level = 7;
    bot.field = [];
    placeFieldCards(bot.field, core, phoenix);
    bot.hand = [connector];
    const state = bot.cloneGameState(botGame);
    const before = [...state.bot.field];
    bot.simulateMainPhaseAction(state, { type: "summon", cardId: connector.id, index: 0, position: "attack" });
    assert.deepEqual(state.bot.field, before);
    assert.deepEqual(state.bot.hand.map(card => card.instanceId), [connector.instanceId]);
    assert.deepEqual(state.bot.graveyard, []);
    assert.deepEqual(state.bot.banished, []);
    assert.equal(state.bot.summonCount, 0);
  });

  test(`payable alternatives remain available beside a protected material (${actor})`, async t => {
    const { bot, botGame, make, phoenix } = setup(t, actor);
    const protectedCore = make(501);
    protectedCore.banishWhenLeavesField = true;
    const legalCore = make(501);
    const connector = make(507);
    const reactor = make(515);
    bot.field = [];
    placeFieldCards(bot.field, protectedCore, legalCore, phoenix);
    bot.hand = [connector];
    bot.extraDeck = [reactor];
    const actions = synchroActions(botGame);
    assert.equal(actions.length, 2);
    assert.ok(actions.every(action => action.materialInstanceIds.includes(legalCore.instanceId) &&
      !action.materialInstanceIds.includes(protectedCore.instanceId)));
    const summon: AIAction = { type: "summon", cardId: connector.id, index: 0, position: "attack" };
    assert.deepEqual(bot.filterValidActionsForCurrentState([summon], botGame), [summon]);
    const state = bot.cloneGameState(botGame);
    bot.simulateMainPhaseAction(state, summon);
    assert.deepEqual(state.bot.graveyard.map(card => card.instanceId), [legalCore.instanceId]);
    assert.ok(state.bot.field.some(card => card.instanceId === protectedCore.instanceId));
    assert.equal(await bot.executeMainPhaseAction(botGame, summon), true);
    assert.deepEqual(bot.graveyard, [legalCore]);
    assert.deepEqual(bot.field, [protectedCore, phoenix, connector]);
    assert.equal(protectedCore.banishWhenLeavesField, true);
  });
}

test("Assembly plus Phoenix blocks the whole simulated Synchro before any material is consumed", t => {
  const { bot, botGame, multimodal, phoenix, lancer } = setup(t);
  const state = bot.cloneGameState(botGame);
  const marked = required(state.bot.field.find(card => card.instanceId === multimodal.instanceId));
  marked.banishWhenLeavesField = true;
  const before = [...state.bot.field];
  const events: string[] = [];
  applyGenericSimulatedMainPhaseAction(state, { type: "synchro", synchroInstanceId: lancer.instanceId,
    materialInstanceIds: [phoenix.instanceId, multimodal.instanceId], position: "attack" },
    { enableSimulatedEvents: true, onSimulatedEvent: name => { events.push(name); } });
  assert.deepEqual(state.bot.field, before, "even a first material that could leave is preserved");
  assert.deepEqual(state.bot.graveyard, []);
  assert.deepEqual(state.bot.banished, []);
  assert.equal(marked.banishWhenLeavesField, true);
  assert.deepEqual(events, []);
});

test("Synchro simulation never consults live callbacks or its live Game reference", t => {
  const { game, bot, botGame, multimodal, phoenix, lancer } = setup(t);
  const state = bot.cloneGameState(botGame);
  Object.defineProperty(state, "_gameRef", { configurable: true, get() { throw new Error("live Game reference read"); } });
  game.performSynchroSummon = () => { throw new Error("live summon invoked"); };
  game.moveCard = () => { throw new Error("live movement invoked"); };
  applyGenericSimulatedMainPhaseAction(state, { type: "synchro", synchroInstanceId: lancer.instanceId,
    materialInstanceIds: [multimodal.instanceId, phoenix.instanceId], position: "attack" }, { enableSimulatedEvents: true });
  assert.ok(state.bot.field.some(card => card.instanceId === lancer.instanceId));
  assert.equal(bot.field.length, 3);
});

test("Raptor's simulated Tokens have distinct stable identities and disappear when used as materials", t => {
  const { bot, botGame, make, multimodal } = setup(t);
  const raptor = make(505);
  bot.field = [];
  const core = make(501);
  placeFieldCards(bot.field, core);
  bot.extraDeck = [multimodal];
  const effect = required(raptor.effects.find(entry => entry.id === "tech_zero_iron_raptor_synchro_tokens"));
  const state = bot.cloneGameState(botGame);
  applySimulatedActions({ state, actions: required(effect.actions), options: { sourceCard: state.bot.field[0] } });
  const tokens = state.bot.field.filter(card => card.isToken);
  assert.equal(tokens.length, 2);
  assert.ok(tokens.every(card => typeof card.instanceId === "string"));
  assert.notEqual(tokens[0]?.instanceId, tokens[1]?.instanceId);
  const choice = required(synchroActions(state).find(action => action.synchroInstanceId === multimodal.instanceId));
  applyGenericSimulatedMainPhaseAction(state, choice, { enableSimulatedEvents: true });
  assert.ok(state.bot.field.some(card => card.instanceId === multimodal.instanceId));
  assert.equal(state.bot.field.some(card => card.isToken), false);
  assert.equal(state.bot.graveyard.some(card => card.isToken), false);
  assert.equal(state.bot.banished.some(card => card.isToken), false);
});
