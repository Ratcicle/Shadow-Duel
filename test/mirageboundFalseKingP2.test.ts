import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import Bot from "../src/core/Bot.js";
import MirageboundStrategy from "../src/core/ai/MirageboundStrategy.js";
import { getGenericCostlessHandSummonActions, getGenericHandSummonProcedureActions } from "../src/core/ai/common/actionGeneration.js";
import { applyGenericSimulatedMainPhaseAction } from "../src/core/ai/common/simulation.js";
import { canUseSimulatedEffectUsage } from "../src/core/ai/common/simStateUtils.js";
import { cardDefinition, required, unsafeFixture } from "./helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import type { AiLiveGamePort } from "../src/core/contracts/aiState.js";
import type { BotGamePort } from "../src/core/contracts/bot.js";
import type { BotCloneGamePort } from "../src/core/bot/simulationBridge.js";

function setup(t: TestContext, seat: "player" | "bot" = "player") {
  const bot = new Bot();
  const game = createRuntimeGame({ opponentOverride: bot, laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0, randomSeed: 2 });
  t.after(() => game.dispose());
  game.phase = "main1"; game.turn = seat; game.turnCounter = 3;
  game.player.controllerType = game.bot.controllerType = "ai";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = game.waitForAiPresentationStep = async () => {};
  game.ui.showConfirmPrompt = async () => false;
  game.ui.showChainResponseModal = async () => null;
  const owner = game[seat];
  const king = new Card(cardDefinition(358), owner.id);
  const cost = new Card(cardDefinition(356), owner.id);
  owner.hand.push(king); placeFieldCards(owner.field, cost);
  for (const card of [king, cost]) game.ensureDuelCardId(card);
  const port = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game, "concrete Game with Bot and clone methods");
  return { game, owner, king, cost, bot, port };
}

for (const seat of ["player", "bot"] as const) {
  test(`False King procedure returns a face-up cost without activating Viper (${seat})`, async t => {
    const { game, owner, king, cost } = setup(t, seat);
    const chainLinks = t.mock.method(game.chainSystem, "addToChain");
    const events: string[] = [];
    game.on("effect_activated", event => { events.push(`activated:${event.card?.id}`); });
    game.on("card_moved", event => {
      if (event.card === cost) { assert.equal(event.movedByEffect, false); events.push("cost"); }
      if (event.card === king) events.push("king");
    });
    const result = await game.performHandSummonProcedure(king, owner, { materials: [cost], position: "attack" });
    assert.equal(result.success, true, result.reason || undefined);
    assert.equal(chainLinks.mock.callCount(), 0);
    assert.deepEqual(events, ["cost", "king"]);
    assert.ok(owner.hand.includes(cost));
    assert.notEqual(cost.banishWhenLeavesField, true);
    assert.equal(king.lastSummonProcedure, "miragebound_false_king_special_summon");
    const second = new Card(cardDefinition(358), owner.id); owner.hand.push(second);
    assert.equal(game.canSummonFromHandByProcedure(second, owner).ok, false);
  });

  test(`False King's procedure cost still permits Jackal's any-return trigger (${seat})`, async t => {
    const { game, owner, king, cost } = setup(t, seat);
    const opponent = game.getOpponent(owner);
    const jackal = new Card(cardDefinition(353), owner.id); owner.hand.push(jackal);
    const foe = new Card({ name: "Jackal target", cardKind: "monster", level: 4, atk: 2000, def: 1000 }, opponent.id);
    placeFieldCards(opponent.field, foe);
    game.ui.showConfirmPrompt = async () => true;
    let jackalActivations = 0;
    game.on("effect_activated", event => { if (event.effectId === "miragebound_jackal_hand_summon_on_return") jackalActivations++; });
    await completeTestSelections(game, game.performHandSummonProcedure(king, owner, { materials: [cost], position: "attack" }));
    assert.equal(jackalActivations, 1);
    assert.ok(owner.field.includes(jackal)); assert.ok(owner.field.includes(king));
    assert.ok(owner.hand.includes(cost)); assert.equal(foe.position, "defense");
  });

  test(`False King's procedure cost still permits Sand Priestess's own-return trigger (${seat})`, async t => {
    const { game, owner, king } = setup(t, seat);
    const priestess = new Card(cardDefinition(357), owner.id);
    owner.field = []; placeFieldCards(owner.field, priestess);
    const recovery = new Card(cardDefinition(351), owner.id); owner.graveyard.push(recovery);
    game.ui.showConfirmPrompt = async () => true;
    let activations = 0;
    game.on("effect_activated", event => { if (event.effectId === "miragebound_sand_priestess_recover") activations++; });
    await completeTestSelections(game, game.performHandSummonProcedure(king, owner, { materials: [priestess], position: "attack" }));
    assert.equal(activations, 1);
    assert.ok(owner.field.includes(king));
    assert.ok(owner.hand.includes(priestess)); assert.ok(owner.hand.includes(recovery));
    assert.equal(owner.graveyard.includes(recovery), false);
  });

  test(`False King returns its controlled opponent-owned cost to the physical original owner in runtime and projection (${seat})`, async t => {
    const { game, owner, king, bot, port } = setup(t, seat);
    const opponent = game.getOpponent(owner);
    owner.field = [];
    const borrowed = new Card(cardDefinition(356), opponent.id); placeFieldCards(opponent.field, borrowed);
    assert.equal((await game.takeControl(borrowed, owner)).success, true);
    assert.equal(borrowed.owner, seat); assert.equal(borrowed.originalOwner, opponent.id);
    const state = bot.cloneGameState(port);
    if (seat === "player") [state.bot, state.player] = [state.player, state.bot];
    const action = required(getGenericHandSummonProcedureActions(state)[0]);
    assert.deepEqual(action.materials, [{ zone: "field", index: 0, cardId: 356, instanceId: borrowed.instanceId }]);
    assert.equal((await game.performHandSummonProcedure(king, owner, { materials: [borrowed], position: "attack" })).success, true);
    assert.ok(opponent.hand.includes(borrowed)); assert.equal(owner.hand.includes(borrowed), false);
    assert.equal(borrowed.owner, opponent.id); assert.equal(borrowed.controller, opponent.id);
    const costEvents: Array<{ playerId: string | undefined; sourceId: number | undefined; movedByEffect: boolean | undefined }> = [];
    applyGenericSimulatedMainPhaseAction(state, action, { emitSimulatedEvent: (event, payload) => {
      const moved: unknown = Reflect.get(payload, "card");
      if (event !== "card_moved" || typeof moved !== "object" || moved === null || Reflect.get(moved, "instanceId") !== borrowed.instanceId) return;
      const destination: unknown = Reflect.get(payload, "player");
      const source: unknown = Reflect.get(payload, "sourceCard");
      assert.ok(typeof destination === "object" && destination !== null);
      assert.ok(typeof source === "object" && source !== null);
      const playerId: unknown = Reflect.get(destination, "id");
      const sourceId: unknown = Reflect.get(source, "id");
      const movedByEffect: unknown = Reflect.get(payload, "movedByEffect");
      assert.equal(typeof playerId, "string"); assert.equal(typeof sourceId, "number"); assert.equal(typeof movedByEffect, "boolean");
      if (typeof playerId === "string" && typeof sourceId === "number" && typeof movedByEffect === "boolean") costEvents.push({ playerId, sourceId, movedByEffect });
    } });
    const moved = required(state.player.hand.find(card => card.instanceId === borrowed.instanceId));
    assert.equal(moved.owner, opponent.id); assert.equal(moved.controller, opponent.id);
    assert.equal(state.bot.hand.some(card => card.instanceId === borrowed.instanceId), false);
    assert.equal(state.bot.field.some(card => card.instanceId === borrowed.instanceId), false);
    assert.equal(state.bot.field[0]?.id, 358);
    assert.deepEqual(costEvents, [{ playerId: opponent.id, sourceId: 358, movedByEffect: false }]);
  });
}

test("False King accepts a full field freed by its return cost, rejecting facedown, foreign or non-Miragebound costs", async t => {
  const { game, owner, king, cost } = setup(t);
  placeFieldCards(owner.field, ...Array.from({ length: 4 }, () => new Card(cardDefinition(101), owner.id)));
  cost.isFacedown = true;
  assert.equal(game.canSummonFromHandByProcedure(king, owner).ok, false);
  assert.equal((await game.performHandSummonProcedure(king, owner, { materials: [cost], position: "attack" })).success, false);
  assert.ok(owner.field.includes(cost)); assert.ok(owner.hand.includes(king));
  cost.isFacedown = false;
  const foreign = new Card(cardDefinition(356), game.bot.id); placeFieldCards(game.bot.field, foreign);
  const nonMiragebound = required(owner.field.find(card => card.id === 101));
  for (const invalid of [foreign, nonMiragebound]) {
    assert.equal((await game.performHandSummonProcedure(king, owner, { materials: [invalid], position: "attack" })).success, false);
    assert.ok(owner.field.includes(cost)); assert.ok(owner.hand.includes(king));
    assert.equal(game.canUseOncePerTurn(king, owner, required(king.handSummonProcedure)).ok, true);
  }
  const slot = cost.fieldSlot;
  assert.equal((await game.performHandSummonProcedure(king, owner, { materials: [cost], position: "defense" })).success, true);
  assert.equal(king.fieldSlot, slot);
  assert.equal(owner.field.length, 5);
});

test("cancelling False King's manual slot decision pays no return cost or named summon limit", async t => {
  const { game, owner, king, cost } = setup(t);
  owner.controllerType = "human"; game.getFieldPlacementMode = () => "manual";
  let decisions = 0;
  game.fieldPlacementProvider = async request => {
    decisions++;
    assert.equal(request.allowCancel, true);
    assert.ok(owner.field.includes(cost));
    assert.equal(game.canUseOncePerTurn(king, owner, required(king.handSummonProcedure)).ok, true);
    return { outcome: "cancelled" };
  };
  const result = await game.performHandSummonProcedure(king, owner, { materials: [cost], position: "attack" });
  assert.equal(decisions, 1);
  assert.equal(result.cancelled, true);
  assert.ok(owner.field.includes(cost)); assert.ok(owner.hand.includes(king));
  assert.equal(game.canUseOncePerTurn(king, owner, required(king.handSummonProcedure)).ok, true);
});

test("cancelling False King's human cost selection pays nothing and leaves another copy available", async t => {
  const { game, owner, king, cost } = setup(t);
  const second = new Card(cardDefinition(358), owner.id); owner.hand.push(second);
  owner.controllerType = "human";
  game.autoSelector.select = () => assert.fail("human procedure cost must remain a manual selection");
  let moves = 0;
  game.on("card_moved", () => { moves++; });
  const result = await game.performHandSummonProcedure(king, owner, { position: "attack" });
  assert.equal(result.needsSelection, true);
  assert.ok(game.targetSelection);
  game.cancelTargetSelection();
  assert.equal(game.targetSelection, null);
  assert.equal(moves, 0);
  assert.ok(owner.field.includes(cost)); assert.ok(owner.hand.includes(king));
  assert.equal(game.canSummonFromHandByProcedure(second, owner).ok, true);
});

for (const changed of ["source", "cost"] as const) test(`False King revalidates ${changed} presence after manual placement`, async t => {
  const { game, owner, king, cost } = setup(t);
  owner.controllerType = "human"; game.getFieldPlacementMode = () => "manual";
  game.fieldPlacementProvider = async () => {
    const card = changed === "source" ? king : cost;
    game.getFieldPlacementMode = () => "automatic";
    await game.moveCard(card, owner, "graveyard", { fromZone: changed === "source" ? "hand" : "field" });
    await game.moveCard(card, owner, "hand", { fromZone: "graveyard", movedByEffect: false });
    if (changed === "cost") await game.moveCard(card, owner, "field", { fromZone: "hand", summonOrigin: "effect_resolution", summonMethod: "special", position: "attack" });
    return { outcome: "chosen", slot: 4 };
  };
  const result = await game.performHandSummonProcedure(king, owner, { materials: [cost], position: "attack" });
  assert.equal(result.success, false);
  assert.ok(owner.hand.includes(king)); assert.ok(owner.field.includes(cost));
  assert.equal(game.canUseOncePerTurn(king, owner, required(king.handSummonProcedure)).ok, true);
});

for (const seat of ["player", "bot"] as const) test(`False King's negated summon retains its cost and permits a second copy until a successful summon (${seat})`, async t => {
  const { game, owner, king, cost, bot, port } = setup(t, seat);
  const second = new Card(cardDefinition(358), owner.id); owner.hand.push(second);
  const spareCost = new Card(cardDefinition(351), owner.id); placeFieldCards(owner.field, spareCost);
  const offer = game.offerSummonAttempt.bind(game);
  game.offerSummonAttempt = async (card, actor, options) => {
    if (card !== king) return offer(card, actor, options);
    const transaction = required(options?.summonTransaction);
    assert.ok(owner.hand.includes(cost), "return cost precedes summon responses");
    game.markSummonNegated(transaction.summonId, { destroyed: true });
    return { ok: false, summonNegated: true, reason: "summon_negated", transaction, ownsTransaction: false };
  };
  const result = await game.performHandSummonProcedure(king, owner, { materials: [cost], position: "attack" });
  assert.equal(result.success, false);
  assert.equal(result.summonNegated, true);
  assert.ok(owner.hand.includes(cost)); assert.equal(owner.field.includes(king), false);
  assert.equal(result.transaction?.costs.length, 1);
  assert.ok(result.transaction?.costs.every(payment => payment.paid));
  assert.equal(game.canUseOncePerTurn(second, owner, required(second.handSummonProcedure)).ok, true);
  assert.equal(game.canSummonFromHandByProcedure(second, owner).ok, true);
  const state = bot.cloneGameState(port);
  if (seat === "player") [state.bot, state.player] = [state.player, state.bot];
  const retry = required(getGenericHandSummonProcedureActions(state).find(action => action.cardId === second.id));
  applyGenericSimulatedMainPhaseAction(state, retry);
  assert.ok(state.bot.field.some(card => card.instanceId === second.instanceId));
  assert.equal(getGenericHandSummonProcedureActions(state).some(action => action.cardId === 358), false);
  assert.equal((await game.performHandSummonProcedure(second, owner, { materials: [spareCost], position: "attack" })).success, true);
  assert.ok(owner.hand.includes(spareCost)); assert.ok(owner.field.includes(second));
  const third = new Card(cardDefinition(358), owner.id); owner.hand.push(third);
  assert.equal(game.canSummonFromHandByProcedure(third, owner).ok, false);
});

for (const seat of ["player", "bot"] as const) test(`False King's named summon limit is available at the paid attempt and consumed on success (${seat})`, async t => {
  const { game, owner, king, cost } = setup(t, seat);
  const second = new Card(cardDefinition(358), owner.id); owner.hand.push(second);
  const offer = game.offerSummonAttempt.bind(game);
  let attempts = 0;
  game.offerSummonAttempt = async (card, actor, options) => {
    attempts++;
    assert.ok(owner.hand.includes(cost)); assert.equal(owner.field.includes(king), false);
    assert.equal(game.canUseOncePerTurn(second, owner, required(second.handSummonProcedure)).ok, true);
    assert.equal(game.canSummonFromHandByProcedure(second, owner).ok, false, "the active transaction reserves the action without consuming the limit");
    return offer(card, actor, options);
  };
  assert.equal((await game.performHandSummonProcedure(king, owner, { materials: [cost], position: "attack" })).success, true);
  assert.equal(attempts, 1);
  assert.equal(game.canUseOncePerTurn(second, owner, required(second.handSummonProcedure)).ok, false);
  assert.equal(game.canSummonFromHandByProcedure(second, owner).ok, false);
});

test("projected Miragebound discovery and simulation preserve return-cost material identity and hard OPT", t => {
  const { game, bot, king, cost, port } = setup(t, "bot");
  placeFieldCards(bot.field, ...Array.from({ length: 4 }, () => new Card(cardDefinition(101), bot.id)));
  bot.summonCount = 1; bot.strategy = new MirageboundStrategy(bot);
  const state = bot.cloneGameState(port);
  const strategy = new MirageboundStrategy(state.bot);
  const actions = strategy.generateMainPhaseActions(state).filter(action => action.type === "handSummonProcedure");
  assert.equal(actions.length, 1);
  const action = required(actions[0]);
  assert.deepEqual(action.materials, [{ zone: "field", index: 0, cardId: 356, instanceId: cost.instanceId }]);
  assert.equal(strategy.generateMainPhaseActions(state).some(action => action.type === "handIgnition" && action.cardId === king.id), false);
  assert.equal(bot.generateMainPhaseActions(port).filter(action => action.type === "handSummonProcedure").length, 1);
  const projectedKing = required(state.bot.hand[0]);
  const procedure = required(projectedKing.handSummonProcedure);
  const usageDuringEvents: boolean[] = [];
  applyGenericSimulatedMainPhaseAction(state, action, { onSimulatedEvent: event => {
    if (event === "card_moved" || event === "after_summon") {
      usageDuringEvents.push(canUseSimulatedEffectUsage(state, procedure, projectedKing, state.bot.id, true));
    }
  } });
  assert.deepEqual(usageDuringEvents, [true, false], "the return cost precedes success-only usage consumption");
  assert.equal(state.bot.field.length, 5);
  assert.equal(state.bot.summonCount, 1);
  assert.equal(state.bot.field.some(card => card.id === 356), false);
  assert.equal(state.bot.hand[0]?.id, 356);
  assert.equal(state.bot.field.find(card => card.id === 358)?.lastSummonProcedure, "miragebound_false_king_special_summon");
  state.bot.hand.push({ ...required(state.bot.field.find(card => card.id === 358)), instanceId: "second-king" });
  assert.equal(strategy.generateMainPhaseActions(state).some(action => action.type === "handSummonProcedure"), false);
  assert.equal(getGenericCostlessHandSummonActions(state).length, 0, "costless compatibility helper remains costless");
});

for (const seat of ["player", "bot"] as const) test(`projected False King completes a full-field procedure before Jackal's return trigger (${seat})`, t => {
  const { game, owner, king, cost, bot, port } = setup(t, seat);
  const opponent = game.getOpponent(owner);
  placeFieldCards(owner.field, ...Array.from({ length: 4 }, () => new Card(cardDefinition(101), owner.id)));
  const jackal = new Card(cardDefinition(353), owner.id); owner.hand.push(jackal);
  placeFieldCards(opponent.field, new Card(cardDefinition(351), opponent.id));
  const state = bot.cloneGameState(port);
  if (seat === "player") [state.bot, state.player] = [state.player, state.bot];
  const action = required(getGenericHandSummonProcedureActions(state)[0]);
  new MirageboundStrategy(state.bot).simulateMainPhaseAction(state, action);
  assert.equal(state.bot.field.length, 5);
  assert.ok(state.bot.field.some(card => card.instanceId === king.instanceId), "the procedure's King receives the slot vacated by its cost");
  assert.ok(state.bot.hand.some(card => card.instanceId === jackal.instanceId), "Jackal cannot consume the procedure's reserved slot");
  assert.ok(state.bot.hand.some(card => card.instanceId === cost.instanceId));
  const allZones = [state.bot, state.player].flatMap(player => [player.hand, player.field, player.graveyard, player.banished, player.deck, player.extraDeck].flat());
  assert.equal(allZones.filter(card => card.instanceId === king.instanceId).length, 1);
});

test("projected False King flushes Jackal's eligible return trigger after completing an open-field procedure", t => {
  const { game, owner, king, cost, bot, port } = setup(t, "bot");
  const opponent = game.getOpponent(owner);
  const jackal = new Card(cardDefinition(353), owner.id); owner.hand.push(jackal);
  placeFieldCards(opponent.field, new Card(cardDefinition(351), opponent.id));
  const state = bot.cloneGameState(port);
  const action = required(getGenericHandSummonProcedureActions(state)[0]);
  new MirageboundStrategy(state.bot).simulateMainPhaseAction(state, action);
  assert.deepEqual(state.bot.field.map(card => card.instanceId), [king.instanceId, jackal.instanceId]);
  assert.deepEqual(state.bot.hand.map(card => card.instanceId), [cost.instanceId]);
});

test("projected generic discovery keeps paid Hyperion costs and frees a full field", t => {
  const { bot, port } = setup(t, "bot");
  bot.hand = [new Card(cardDefinition("Luminous God Hyperion"), bot.id)];
  bot.field = [];
  const fieldCost = new Card({ name: "Light field", cardKind: "monster", attribute: "Light", level: 1, atk: 100, def: 100 }, bot.id);
  placeFieldCards(bot.field, fieldCost, ...Array.from({ length: 4 }, () => new Card(cardDefinition(101), bot.id)));
  bot.graveyard = Array.from({ length: 4 }, () => new Card({ name: "Light grave", cardKind: "monster", attribute: "Light", level: 1, atk: 100, def: 100 }, bot.id));
  const state = bot.cloneGameState(port);
  const action = required(getGenericHandSummonProcedureActions(state)[0]);
  assert.equal(action.materials.length, 5);
  assert.deepEqual(action.materials.filter(hint => hint.zone === "field").map(hint => hint.instanceId), [fieldCost.instanceId]);
  applyGenericSimulatedMainPhaseAction(state, action);
  assert.equal(state.bot.banished.length, 5);
  assert.equal(state.bot.field.length, 5);
});

test("projected hand procedure costs preserve counter and active Equip filters", t => {
  const { bot, king, cost, port } = setup(t, "bot");
  king.handSummonProcedure = { id: "generic_filtered_hand_procedure", cost: { count: 1, zones: ["field"], destination: "hand",
    filters: { cardKind: "monster", counterType: "charge", minCounters: 1, equippedWithFilters: { cardKind: "spell", subtype: "equip", requireFaceup: true } },
  } };
  cost.addCounter("charge", 1);
  const equip = new Card({ name: "Procedure Equip", cardKind: "spell", subtype: "equip" }, bot.id);
  equip.equippedTo = cost; cost.equips.push(equip); placeFieldCards(bot.spellTrap, equip);
  const state = bot.cloneGameState(port);
  const action = required(getGenericHandSummonProcedureActions(state)[0]);
  required(state.bot.spellTrap[0]).isFacedown = true;
  assert.equal(getGenericHandSummonProcedureActions(state).length, 0);
  required(state.bot.spellTrap[0]).isFacedown = false;
  required(state.bot.field[0]).counters?.set("charge", 0);
  assert.equal(getGenericHandSummonProcedureActions(state).length, 0);
  applyGenericSimulatedMainPhaseAction(state, action);
  assert.equal(state.bot.hand[0]?.id, 358, "a stale filter rejects the payment before returning the material");
  assert.equal(state.bot.field[0]?.id, 356);
});
