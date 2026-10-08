import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import ShadowHeartStrategy from "../../src/core/ai/ShadowHeartStrategy.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { canUseSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { createArchitectureFixture } from "../helpers/architectureBaseline.js";

function scenario(t: TestContext, actor: "bot" | "player") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: false });
  t.after(() => game.dispose("architecture_shadowheart_runtime_policy"));
  const owner = Object.assign(new Bot("shadowheart"), { oncePerDuelUsageByName: {} as Record<string, number> });
  owner.id = actor;
  game[actor] = owner;
  const executionGame = unsafeFixture<BotGamePort>(game,
    "Concrete Game supplies all Bot execution methods; public EffectEngine projections are narrower than BotGamePort.");
  owner.game = executionGame;
  const strategy = new ShadowHeartStrategy(owner);
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

for (const actor of ["bot", "player"] as const) {
  for (const configuration of ["defense", "finisher", "full_field"] as const) {
    test(`real Bot Tribute payment preserves policy material order in ${configuration} (${actor})`, async t => {
      const { game, executionGame, owner, opponent, strategy } = scenario(t, actor);
      const fixture = createArchitectureFixture("shadowheart", configuration, actor).state;
      game.turnCounter = fixture.turnCounter;
      owner.lp = fixture.bot.lp;
      opponent.lp = fixture.player.lp;
      for (const zone of ["hand", "field", "deck", "graveyard", "extraDeck"] as const) {
        for (const projection of fixture.bot[zone]) {
          const card = required(game.createCardForOwner(projection.id, owner));
          if (zone === "field") {
            card.position = required(projection.position);
            card.isFacedown = required(projection.isFacedown);
            card.lastSummonMethod = "special";
            card.lastSummonedTurn = 3;
            card.enteredFieldTurn = 3;
          }
          if (zone === "field") placeFieldCards(owner.field, card);
          else owner[zone].push(card);
        }
      }
      for (const projection of fixture.player.field) {
        const card = required(game.createCardForOwner(projection.id, opponent));
        placeFieldCards(opponent.field, card);
      }
      const source = required(owner.hand.find(card => card.id === 111));
      const action = required(strategy.generateMainPhaseActions(game).find(candidate =>
        candidate.type === "summon" && candidate.cardId === source.id));
      assert.equal(action.type, "summon");
      const needed = owner.getTributeRequirementFor(source, owner).tributesNeeded;
      const indices = owner.selectBestTributes(owner.field, needed, source, { oppField: opponent.field, game: executionGame });
      const selected = indices.map(index => required(owner.field[index]));
      const expectedIds = configuration === "full_field" ? [117, 114] : [107, 108];
      assert.deepEqual(selected.map(card => card.id), expectedIds,
        "the unchanged production policy chooses these physical materials in this order");
      const paymentEvents: number[] = [];
      game.on("card_to_grave", payload => {
        if (payload.player === owner && payload.fromZone === "field") {
          const instanceId = payload.card.instanceId;
          assert.ok(typeof instanceId === "number");
          paymentEvents.push(instanceId);
        }
      });
      const { state } = createGameTreeCopy(game, owner);
      assert.equal(await owner.executeMainPhaseAction(executionGame, action), true);
      assert.deepEqual(paymentEvents, selected.map(card => card.instanceId),
        "runtime executes individual tribute costs in the policy's declared order");
      assert.deepEqual(owner.graveyard.map(card => card.instanceId), selected.map(card => card.instanceId));
      strategy.simulateMainPhaseAction(state, action);
      assert.deepEqual(state.bot.graveyard.map(card => card.instanceId), owner.graveyard.map(card => card.instanceId));
      const simulatedSource = required(state.bot.field.find(card => card.instanceId === source.instanceId));
      assert.deepEqual(simulatedSource.lastTributeMaterialNames, selected.map(card => card.name),
        "simulation provenance records the same material order actually paid by runtime");
      assert.equal(simulatedSource.lastTributeMaterialCount, selected.length);
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }
  test(`an explicit optional-trigger refusal is different from Imp's empty named preference (${actor})`, async t => {
    const { game, executionGame, owner, strategy } = scenario(t, actor);
    const source = required(game.createCardForOwner(107, owner));
    const second = required(game.createCardForOwner(107, owner));
    owner.hand.push(source, second);
    const effect = required(source.effects.find(entry => entry.id === "shadow_heart_imp_on_summon"));
    const context = required(strategy.buildActivationContextForEffect({ sourceCard: source, effect, player: owner, game }));
    assert.deepEqual(required(context.actionContext.targetPreferences.imp_special_from_hand).preferredNames, []);
    // A controlled policy extension exercises the optional refusal capability;
    // the positive case below uses the unmodified production Strategy.
    Object.assign(strategy, {
      shouldActivateEffect: ({ effect: candidate }: { effect?: EffectDefinition }) => candidate?.id !== effect.id,
    });
    const action = required(strategy.generateMainPhaseActions(game).find(entry =>
      entry.type === "summon" && entry.index === 0 && entry.cardId === source.id));
    assert.equal(await owner.executeMainPhaseAction(executionGame, action), true);
    assert.deepEqual(owner.field, [source]);
    assert.deepEqual(owner.hand, [second]);
    assert.equal(game.oncePerTurnUsage[actor].has("once_per_turn:shadow_heart_imp_on_summon"), false);
    assert.equal(game.canUseOncePerTurn(source, owner, effect).ok, true);
  });

  test(`the real ShadowHeart Bot accepts Imp's optional trigger with an empty named preference (${actor})`, async t => {
    const { game, executionGame, owner, strategy } = scenario(t, actor);
    const source = required(game.createCardForOwner(107, owner));
    const second = required(game.createCardForOwner(107, owner));
    owner.hand.push(source, second);
    const effect = required(source.effects.find(entry => entry.id === "shadow_heart_imp_on_summon"));
    const context = required(strategy.buildActivationContextForEffect({ sourceCard: source, effect, player: owner, game }));
    const preference = required(context.actionContext.targetPreferences.imp_special_from_hand);
    assert.deepEqual(preference.preferredNames, []);
    assert.equal(preference.reason, "fallback");
    const action = required(strategy.generateMainPhaseActions(game).find(entry =>
      entry.type === "summon" && entry.index === 0 && entry.cardId === source.id));
    assert.equal(action.type, "summon");
    const { state } = createGameTreeCopy(game, owner);

    assert.equal(await owner.executeMainPhaseAction(executionGame, action), true);
    assert.deepEqual(owner.field, [source, second]);
    assert.deepEqual(owner.hand, []);
    assert.equal(second.lastSummonMethod, "special");
    assert.equal(second.lastSummonedFromZone, "hand");
    assert.equal(second.position, "attack");
    assert.equal(game.oncePerTurnUsage[actor].get("once_per_turn:shadow_heart_imp_on_summon"), 4);
    assert.equal(game.canUseOncePerTurn(second, owner, effect).ok, false,
      "the optional trigger consumes the shared name limit for both copies");

    strategy.simulateMainPhaseAction(state, action);
    assert.deepEqual(state.bot.field.map(card => card.instanceId), owner.field.map(card => card.instanceId));
    assert.deepEqual(state.bot.hand, []);
    assert.equal(canUseSimulatedEffectUsage(state, effect, second), false);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  test(`the real ShadowHeart Bot resolves Specter's paid-Tribute recovery and consumes its ledger (${actor})`, async t => {
    const { game, executionGame, owner, opponent, strategy } = scenario(t, actor);
    const boss = required(game.createCardForOwner(104, owner));
    const specter = required(game.createCardForOwner(102, owner));
    const gecko = required(game.createCardForOwner(108, owner));
    const enemy = required(game.createCardForOwner(1, opponent));
    owner.hand.push(boss);
    placeFieldCards(owner.field, specter, gecko);
    placeFieldCards(opponent.field, enemy);
    const effect = required(specter.effects.find(entry => entry.id === "shadow_heart_specter_recycle"));
    const action = required(strategy.generateMainPhaseActions(game).find(entry =>
      entry.type === "summon" && entry.index === 0 && entry.cardId === boss.id));
    assert.equal(action.type, "summon");
    const { state } = createGameTreeCopy(game, owner);

    assert.equal(await owner.executeMainPhaseAction(executionGame, action), true);
    assert.deepEqual(owner.field, [boss]);
    assert.deepEqual(owner.hand, [gecko]);
    assert.deepEqual(owner.graveyard, [specter]);
    assert.equal(boss.lastSummonMethod, "tribute");
    assert.equal(owner.summonCount, 1);
    assert.equal(game.oncePerTurnUsage[actor].get("once_per_turn:shadow_heart_specter_recycle"), 4);
    assert.equal(game.canUseOncePerTurn(specter, owner, effect).ok, false);

    strategy.simulateMainPhaseAction(state, action);
    assert.deepEqual(state.bot.field.map(card => card.instanceId), owner.field.map(card => card.instanceId));
    assert.deepEqual(state.bot.hand.map(card => card.instanceId), [gecko.instanceId]);
    assert.deepEqual(state.bot.graveyard.map(card => card.instanceId), [specter.instanceId]);
    assert.equal(canUseSimulatedEffectUsage(state, effect, specter), false);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });
}
