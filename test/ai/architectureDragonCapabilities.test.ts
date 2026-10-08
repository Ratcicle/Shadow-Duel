import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { refreshSimulatedFieldAuras, moveCardToZone } from "../../src/core/ai/common/zones.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { processSimulatedDelayedActions } from "../../src/core/ai/common/simulatedActions/lifecycle.js";
import { getModeledPassiveContributions } from "../../src/core/effects/passives/passiveBuffs.js";
import { establishProperSummon } from "../../src/core/game/summon/eligibility.js";
import { required } from "../helpers/fixtures.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { getMaterialEffectActivationCount } from "../../src/core/ai/void/analysis.js";

function scenario(t: TestContext, actor: "bot" | "player") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
  t.after(() => game.dispose("architecture_dragon_capabilities"));
  game.turn = actor; game.phase = "main1"; game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.bot.controllerType = game.player.controllerType = "ai";
  const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
  return { game, owner, opponent };
}

for (const actor of ["bot", "player"] as const) {
  test(`material snapshot history remains immutable after later real activations (${actor})`, async t => {
    const { game, owner } = scenario(t, actor);
    const source = required(game.createCardForOwner(264, owner));
    const target = required(game.createCardForOwner(257, owner));
    placeFieldCards(owner.field, source, target);
    const activate = async () => {
      assert.equal((await game.tryActivateMonsterEffect(source, { purified_protection_target: [target] }, "field", owner,
        { effectId: "purified_crystal_protection" })).success, true);
    };
    await activate();
    const { state } = createGameTreeCopy(game, owner);
    assert.equal(state.materialDuelStats?.[actor].effectActivationsByMaterialId.get(264), 1);
    assert.ok(state._gameRef, "retain the ordinary projection reference to expose the preexisting Void reader gap");
    for (const turn of [5, 6]) {
      game.turnCounter = turn;
      await activate();
    }
    assert.equal(game.materialDuelStats[actor].effectActivationsByMaterialId.get(264), 3);
    assert.equal(state.materialDuelStats?.[actor].effectActivationsByMaterialId.get(264), 1,
      "later runtime events must not mutate the inherited planning history");
    const clone = createGameTreeCopy(state).state;
    assert.equal(clone.materialDuelStats?.[actor].effectActivationsByMaterialId.get(264), 1);
    // Stage8 migrates Dragon/history consumers to the canonical snapshot. The
    // existing Void reader currently prefers _gameRef and leaks later history.
    // Expose only the live reader's public history/player fields: VoidGame's
    // legacy type is narrower than the general planning-reference input.
    const liveHistory = { player: game.player, bot: game.bot, materialDuelStats: game.materialDuelStats };
    assert.equal(getMaterialEffectActivationCount({ ...state, _gameRef: liveHistory }, state.bot, 264), 1);
    assert.equal(getMaterialEffectActivationCount({ ...clone, _gameRef: liveHistory }, clone.bot, 264), 1);
  });

  test(`Purified's real successful activations update canonical material history in the common interpreter (${actor})`, async t => {
    const { game, owner } = scenario(t, actor);
    const source = required(game.createCardForOwner(264, owner));
    const target = required(game.createCardForOwner(257, owner));
    const ascension = required(game.createCardForOwner(267, owner));
    placeFieldCards(owner.field, source, target);
    owner.extraDeck.push(ascension);
    const { state } = createGameTreeCopy(game, owner);
    const projectedSource = required(state.bot.field[0]);
    const projectedTarget = required(state.bot.field[1]);
    for (let count = 1; count <= 3; count++) {
      game.turnCounter = state.turnCounter = 3 + count;
      assert.equal((await game.tryActivateMonsterEffect(source, { purified_protection_target: [target] }, "field", owner,
        { effectId: "purified_crystal_protection" })).success, true);
      assert.equal(game.materialDuelStats[actor].effectActivationsByMaterialId.get(264), count);
      assert.equal(game.checkAscensionRequirements(owner, ascension, source).ok, count >= 3);
      applyGenericSimulatedMainPhaseAction(state, { type: "monsterEffect", index: 0, cardId: source.id,
        effectId: "purified_crystal_protection", activationContext: { decisions: { selections: {
          purified_protection_target: [required(projectedTarget.instanceId)],
        } } } });
    }
    assert.equal(state.materialDuelStats?.[actor].effectActivationsByMaterialId.get(264), 3);
    assert.equal(state.materialDuelStats?.[actor].activatedEffectIdsByMaterialId.get(264)?.has("purified_crystal_protection"), true);
    assert.ok(state.bot.field.includes(projectedSource));
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  for (const count of [2, 3]) test(`projected canonical material history gates the three-activation Ascension (${actor}/${count})`, async t => {
    const { game, owner } = scenario(t, actor);
    const source = required(game.createCardForOwner(264, owner));
    const target = required(game.createCardForOwner(257, owner));
    const ascension = required(game.createCardForOwner(267, owner));
    source.summonedTurn = 3; // A real Ascension material must predate the current turn.
    placeFieldCards(owner.field, source, target);
    owner.extraDeck.push(ascension);
    for (let used = 0; used < count; used++) {
      game.turnCounter = 4 + used;
      assert.equal((await game.tryActivateMonsterEffect(source, { purified_protection_target: [target] }, "field", owner,
        { effectId: "purified_crystal_protection" })).success, true);
    }
    const allowed = game.checkAscensionRequirements(owner, ascension, source).ok;
    assert.equal(allowed, count >= 3);
    const { state } = createGameTreeCopy(game, owner);
    assert.equal(state.materialDuelStats?.[actor].effectActivationsByMaterialId.get(264), count);
    assert.equal((await game.performAscensionSummon(owner, source, ascension, { position: "attack" })).success, allowed);
    applyGenericSimulatedMainPhaseAction(state, { type: "ascension", materialIndex: 0,
      ascensionCard: required(state.bot.extraDeck[0]), cardId: 267, position: "attack" });
    assert.equal(state.bot.field.some(card => card.id === 267), allowed);
    assert.equal(state.bot.extraDeck.some(card => card.id === 267), !allowed);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  for (const variant of ["ordinary", "fusion", "expired_source"] as const) {
    test(`shared declarative delayed summon matches actual source/target presence: ${variant} (${actor})`, async t => {
      const { game, owner, opponent } = scenario(t, actor);
      const source = required(game.createCardForOwner(263, owner));
      const target = required(game.createCardForOwner(variant === "fusion" ? 173 : 257, opponent));
      if (variant === "fusion") establishProperSummon(target, { summonProcedure: "fusion", sourceZone: "extraDeck" });
      placeFieldCards(owner.field, source);
      placeFieldCards(opponent.field, target);
      const effect = required(source.effects.find(entry => entry.id === "abyssal_serpent_delayed_summon_effect"));
      const { state } = createGameTreeCopy(game, owner);
      const projectedSource = required(state.bot.field[0]);
      const projectedTarget = required(state.player.field[0]);
      await game.effectEngine.applyActions(effect.actions || [], { source, player: owner, opponent, effect }, { abyssal_target: [target] });
      assert.deepEqual(owner.graveyard, [source]);
      assert.deepEqual(opponent.graveyard, [target]);
      assert.equal(game.delayedActions.length, 1);
      if (variant === "expired_source") {
        await game.moveCard(source, owner, "banished", { fromZone: "graveyard" });
        await game.moveCard(source, owner, "graveyard", { fromZone: "banished" });
      }
      game.turn = opponent.id; game.turnCounter = 5; game.phase = "standby";
      await game.processDelayedActions("standby", opponent.id);
      assert.equal(owner.field.includes(source), variant !== "expired_source");
      assert.equal(opponent.field.includes(target), true);
      assert.equal(source.atk, variant === "fusion" ? 3000 : 2200);
      assert.equal(game.delayedActions.length, 0);

      applySimulatedActions({ state, actions: effect.actions, selfId: "bot",
        selections: { abyssal_target: [projectedTarget] }, options: { sourceCard: projectedSource, effect } });
      assert.equal(state.delayedActions?.length, 1, "the real declared action must schedule through the common interpreter");
      if (variant === "expired_source") {
        assert.equal(moveCardToZone(state.bot, projectedSource, "banished", state.bot, { state }), true);
        assert.equal(moveCardToZone(state.bot, projectedSource, "graveyard", state.bot, { state }), true);
      }
      state.turn = state.player.id; state.turnCounter = 5; state.phase = "standby";
      processSimulatedDelayedActions(state, "standby", state.player.id);
      assert.equal(state.bot.field.includes(projectedSource), owner.field.includes(source));
      assert.equal(state.player.field.includes(projectedTarget), true);
      assert.equal(projectedSource.atk, source.atk);
      assert.equal(state.delayedActions?.length, 0);
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }

  test(`Boneflame's real graveyard-type contribution is certified and survives a planning clone (${actor})`, t => {
    const { game, owner } = scenario(t, actor);
    const source = required(game.createCardForOwner(269, owner));
    const dragon = required(game.createCardForOwner(256, owner));
    const unrelated = required(game.createCardForOwner(302, owner));
    placeFieldCards(owner.field, source);
    owner.graveyard.push(dragon, unrelated);
    const base = source.atk;
    game.effectEngine.updatePassiveBuffs();
    assert.equal(source.atk, base + 400);
    const { state } = createGameTreeCopy(game, owner);
    const projectedSource = required(state.bot.field[0]);
    assert.deepEqual(getModeledPassiveContributions(source), [["boneflame_dragon_grave_buff", "graveyard_type_count_buff"]]);
    assert.deepEqual(getModeledPassiveContributions(projectedSource), getModeledPassiveContributions(source));
    assert.equal(projectedSource.atk, source.atk);
  });

  test(`Boneflame recalculates a real GY departure and negation through the shared path (${actor})`, async t => {
    const { game, owner, opponent } = scenario(t, actor);
    const source = required(game.createCardForOwner(269, owner));
    const first = required(game.createCardForOwner(256, owner));
    const second = required(game.createCardForOwner(264, owner));
    placeFieldCards(owner.field, source);
    owner.graveyard.push(first, second);
    const base = source.atk;
    game.effectEngine.updatePassiveBuffs();
    assert.equal(source.atk, base + 800);
    const { state } = createGameTreeCopy(game, owner);
    const projectedSource = required(state.bot.field[0]);
    const projectedFirst = required(state.bot.graveyard.find(card => card.instanceId === first.instanceId));
    await game.moveCard(first, owner, "hand", { fromZone: "graveyard" });
    game.effectEngine.updatePassiveBuffs();
    assert.equal(source.atk, base + 400);
    assert.equal(moveCardToZone(state.bot, projectedFirst, "hand", state.bot, { state }), true);
    refreshSimulatedFieldAuras(state);
    assert.equal(projectedSource.atk, source.atk);
    const action = { type: "add_status", targetRef: "target", status: "effectsNegated" } as const;
    await game.effectEngine.applyActions([action], { player: opponent, opponent: owner }, { target: [source] });
    game.effectEngine.updatePassiveBuffs();
    assert.equal(source.atk, base);
    applySimulatedActions({ state, actions: [action], selfId: "player", selections: { target: [projectedSource] } });
    refreshSimulatedFieldAuras(state);
    assert.equal(projectedSource.atk, source.atk);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });
}
