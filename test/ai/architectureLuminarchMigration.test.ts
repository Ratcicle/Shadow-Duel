import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import LuminarchStrategy from "../../src/core/ai/LuminarchStrategy.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { buildLuminarchSimulationOptions } from "../../src/core/ai/luminarch/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function scenario(t: TestContext, actor: "bot" | "player") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: false });
  t.after(() => game.dispose("architecture_luminarch_migration"));
  const owner = Object.assign(new Bot("luminarch"), { oncePerDuelUsageByName: {} as Record<string, number> });
  owner.id = actor;
  game[actor] = owner;
  const executionGame = unsafeFixture<BotGamePort>(game,
    "Concrete Game supplies Bot execution methods; its public EffectEngine projection is narrower than BotGamePort.");
  owner.game = executionGame;
  const strategy = new LuminarchStrategy(owner);
  owner.strategy = strategy;
  game.turn = actor;
  game.phase = "main1";
  game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForAiPresentationStep = async () => {};
  const opponent = game[actor === "bot" ? "player" : "bot"];
  opponent.controllerType = "ai";
  return { game, executionGame, owner, opponent, strategy };
}

function publicBoard(cards: ReadonlyArray<{ instanceId?: number | string | undefined; position?: string | undefined; atk?: number | undefined; def?: number | undefined; cannotAttackThisTurn?: boolean | undefined }>) {
  return cards.map(card => ({ instanceId: card.instanceId, position: card.position,
    atk: card.atk, def: card.def, cannotAttackThisTurn: card.cannotAttackThisTurn === true }));
}

for (const actor of ["bot", "player"] as const) {
  for (const configuration of ["valiant", "arbiter_used", "moonblade"] as const) {
    test(`declarative after-summon search and revival match Bot policy (${configuration}, ${actor})`, async t => {
      const { game, executionGame, owner, strategy } = scenario(t, actor);
      const source = required(game.createCardForOwner(configuration === "valiant" ? 151 : configuration === "arbiter_used" ? 160 : 154, owner));
      owner.hand.push(source);
      owner.deck.push(required(game.createCardForOwner(153, owner)), required(game.createCardForOwner(156, owner)),
        required(game.createCardForOwner(162, owner)));
      if (configuration === "arbiter_used") game.markOncePerTurnUsed(source, owner,
        required(source.effects.find(effect => effect.id === "luminarch_sanctified_arbiter_search")));
      if (configuration === "moonblade") {
        placeFieldCards(owner.field, required(game.createCardForOwner(151, owner)));
        owner.graveyard.push(required(game.createCardForOwner(153, owner)));
        owner.hand.push(required(game.createCardForOwner(168, owner)));
      }
      const action = required(strategy.generateMainPhaseActions(unsafeFixture<Parameters<typeof strategy.generateMainPhaseActions>[0]>(game,
        "The concrete Bot-owned Game supplies generation capabilities; its test EffectEngine projection is narrower than LuminarchGame.")).find(candidate => candidate.type === "summon" && candidate.cardId === source.id));
      const { state } = createGameTreeCopy(game, owner);
      assert.equal(await owner.executeMainPhaseAction(executionGame, action), true);
      strategy.simulateMainPhaseAction(state, action);
      assert.deepEqual(publicBoard(state.bot.field), publicBoard(owner.field));
      assert.deepEqual(state.bot.hand.map(card => card.instanceId), owner.hand.map(card => card.instanceId));
      assert.deepEqual(state.bot.deck.map(card => card.instanceId), owner.deck.map(card => card.instanceId));
      assert.deepEqual(state.bot.graveyard.map(card => card.instanceId), owner.graveyard.map(card => card.instanceId));
      if (configuration === "arbiter_used") assert.equal(owner.hand.length, 0, "an already used name limit prevents a second search");
      if (configuration === "moonblade") {
        assert.equal(required(owner.field.find(card => card.id === 153)).def, 2500);
        assert.equal(required(owner.field.find(card => card.id === 168)).cannotAttackThisTurn, true);
      }
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }
  for (const configuration of ["valid", "full_field", "stale_material", "facedown_material", "negated_material"] as const) {
    test(`Protector public shortcut delegates its exact cost and summon to runtime (${configuration}, ${actor})`, async t => {
      const { game, executionGame, owner, strategy } = scenario(t, actor);
      const protector = required(game.createCardForOwner(157, owner));
      const aegis = required(game.createCardForOwner(153, owner));
      const sister = required(game.createCardForOwner(153, owner));
      owner.hand.push(protector);
      placeFieldCards(owner.field, aegis, sister);
      if (configuration === "facedown_material") sister.isFacedown = true;
      if (configuration === "negated_material") sister.effectsNegated = true;
      if (configuration === "full_field") {
        for (let index = 0; index < 3; index++) placeFieldCards(owner.field, required(game.createCardForOwner(151, owner)));
      }
      const action: AIAction = { type: "special_summon_sanctum_protector", index: 0,
        cardName: protector.name, cardId: protector.id, materialIndex: configuration === "stale_material" ? 9 : 1,
        position: "defense", priority: 1 };
      const { state } = createGameTreeCopy(game, owner);
      const executed = await owner.executeMainPhaseAction(executionGame, action);
      strategy.simulateMainPhaseAction(state, action);
      assert.equal(executed, configuration !== "stale_material" && configuration !== "facedown_material");
      assert.deepEqual(publicBoard(state.bot.field), publicBoard(owner.field));
      assert.deepEqual(state.bot.hand.map(card => card.instanceId), owner.hand.map(card => card.instanceId));
      assert.deepEqual(state.bot.graveyard.map(card => card.instanceId), owner.graveyard.map(card => card.instanceId));
      assert.ok(owner.field.includes(aegis), "the unselected sister copy remains on the field");
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }
  for (const configuration of ["valid", "full_field", "wrong_phase", "blocked_source"] as const) {
    test(`Marshal declarative hand activation matches Bot runtime in ${configuration} (${actor})`, async t => {
      const { game, executionGame, owner, strategy } = scenario(t, actor);
      owner.lp = 5000;
      const marshal = required(game.createCardForOwner(155, owner));
      const halberd = required(game.createCardForOwner(168, owner));
      owner.hand.push(marshal, halberd);
      if (configuration === "full_field") {
        for (let index = 0; index < 5; index++) placeFieldCards(owner.field, required(game.createCardForOwner(151, owner)));
      }
      if (configuration === "wrong_phase") game.phase = "battle";
      if (configuration === "blocked_source") marshal.cannotBeSpecialSummoned = true;
      const action: AIAction = { type: "handIgnition", index: 0, cardName: marshal.name,
        cardId: marshal.id, effectId: "luminarch_celestial_marshal_hand_summon", priority: 1 };
      const { state } = createGameTreeCopy(game, owner);
      const executed = await owner.executeMainPhaseAction(executionGame, action);
      strategy.simulateMainPhaseAction(state, action);
      assert.equal(executed, configuration === "valid");
      assert.equal(state.bot.lp, owner.lp, "payment uses runtime preflight and the actual declarative cost");
      assert.deepEqual(publicBoard(state.bot.field), publicBoard(owner.field));
      assert.deepEqual(state.bot.hand.map(card => card.instanceId), owner.hand.map(card => card.instanceId));
      assert.deepEqual(state._simUnsupportedActions || [], []);
      if (configuration === "valid") {
        assert.equal(owner.lp, 3000);
        assert.ok(owner.field.includes(marshal));
        assert.ok(owner.field.includes(halberd));
        assert.equal(halberd.cannotAttackThisTurn, true);
        const payment = required(state._simLuminarch?.lpPayments?.[0]);
        assert.deepEqual([payment.cost, payment.beforeLp, payment.afterLp, payment.createsPayoff], [2000, 5000, 3000, true]);
      }
    });
  }
  test(`Pure Knight fusion delegates search and retains its available reducer (${actor})`, async t => {
    const { game, executionGame, owner, strategy } = scenario(t, actor);
    const fusion = required(game.createCardForOwner(173, owner));
    const spell = required(game.createCardForOwner(cardDefinition("Polymerization").id, owner));
    owner.extraDeck.push(fusion);
    owner.hand.push(spell, required(game.createCardForOwner(151, owner)), required(game.createCardForOwner(153, owner)));
    const citadel = required(game.createCardForOwner(162, owner));
    owner.deck.push(citadel);
    const action: AIAction = { type: "spell", index: 0, cardName: spell.name, cardId: spell.id, priority: 1,
      fusionTargetHint: fusion.name, activationContext: { actionContext: { fusionPositions: { byName: { [fusion.name]: "defense" } } } } };
    const { state } = createGameTreeCopy(game, owner);
    assert.equal(await owner.executeMainPhaseAction(executionGame, action), true);
    strategy.simulateMainPhaseAction(state, action);
    assert.ok(owner.field.includes(fusion));
    assert.ok(owner.hand.includes(citadel));
    assert.deepEqual(publicBoard(state.bot.field), publicBoard(owner.field));
    assert.deepEqual(state.bot.hand.map(card => card.instanceId), owner.hand.map(card => card.instanceId));
    assert.deepEqual(state.bot.graveyard.map(card => card.instanceId), owner.graveyard.map(card => card.instanceId));
    const simulatedFusion = required(state.bot.field.find(card => card.instanceId === fusion.instanceId));
    assert.equal(simulatedFusion._simulatedCitadelSearch, true);
    assert.equal(simulatedFusion._simulatedLpCostReductionAvailable, true);
    assert.equal(state._simLuminarch?.milestones?.filter(milestone => milestone === "citadel_access").length, 1,
      "the actual Citadel search contributes its reward once");
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });
  test(`Fortress Ascension resolves its counted heal and LP counter once (${actor})`, async t => {
    const { game, executionGame, owner, opponent, strategy } = scenario(t, actor);
    owner.lp = 5000;
    const material = required(game.createCardForOwner(153, owner));
    material.summonedTurn = 1;
    const fortress = required(game.createCardForOwner(172, owner));
    const barbarias = required(game.createCardForOwner(171, owner));
    const blade = required(game.createCardForOwner(166, owner));
    placeFieldCards(owner.field, material, barbarias);
    placeFieldCards(owner.spellTrap, blade);
    owner.extraDeck.push(fortress);
    await game.effectEngine.applyEquip({ type: "equip", targetRef: "host" },
      { source: blade, player: game[actor], opponent }, { host: [barbarias] });
    owner.updatePassiveEffects();
    const action: AIAction = { type: "ascension", materialIndex: 0, materialId: material.id,
      material, ascensionCard: fortress, cardName: fortress.name, position: "defense", priority: 1 };
    const { state } = createGameTreeCopy(game, owner);
    // The action intentionally carries live physical objects. Observe the
    // snapshot before runtime moves them and changes their presence versions.
    strategy.simulateMainPhaseAction(state, action);
    assert.equal(await owner.executeMainPhaseAction(executionGame, action), true);
    assert.equal(owner.lp, 7000);
    assert.equal(state.bot.lp, owner.lp);
    assert.equal(blade.getCounter("solar"), 1);
    assert.equal(state.bot.spellTrap.find(card => card.instanceId === blade.instanceId)?.counters?.get("solar"), 1);
    assert.deepEqual(publicBoard(state.bot.field), publicBoard(owner.field));
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });
}

for (const actor of ["bot", "player"] as const) {
  test(`a failed paid effect keeps its factual receipt without the Luminarch wrapper (${actor})`, async t => {
    const { game, owner, opponent } = scenario(t, actor);
    owner.lp = 5000;
    const marshal = required(game.createCardForOwner(155, owner));
    placeFieldCards(owner.field, marshal);
    const effect: EffectDefinition = { id: "paid-stop-control", timing: "ignition", activationZones: ["field"],
      actions: [{ type: "pay_lp", amount: 500 }, { type: "draw", amount: 1 }] };
    const { state } = createGameTreeCopy(game, owner);
    const simSource = required(state.bot.field.find(card => card.instanceId === marshal.instanceId));
    const observer = buildLuminarchSimulationOptions(state, null);
    const options = { onLpPayment: observer.onLpPayment, sourceCard: simSource, effect };
    // The common owner dispatcher consumes these options directly and does
    // not call the Strategy's post-action finalizer on a failed resolution.
    const runtimeResult = await game.effectEngine.applyActions(effect.actions || [], { player: game[actor], opponent, source: marshal, effect }, {});
    assert.equal(typeof runtimeResult === "object" && runtimeResult.success, false);
    assert.equal(applySimulatedActions({ state, selfId: "bot", actions: effect.actions, options }), false);
    assert.equal(state.bot.lp, owner.lp);
    assert.equal(state.bot.lp, 4500);
    assert.deepEqual(state._simLuminarch?.lpPayments?.map(payment => [payment.cost, payment.beforeLp, payment.afterLp]),
      [[500, 5000, 4500]]);
    observer.finalizeLpPayments();
    observer.finalizeLpPayments();
    assert.equal(state._simLuminarch?.lpPayments?.length, 1, "enrichment never counts a payment twice");
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });
}
