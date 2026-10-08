import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import VoidStrategy from "../../src/core/ai/VoidStrategy.js";
import { getMaterialEffectActivationCount, getSimulatedVoidAscensionCandidates } from "../../src/core/ai/void/analysis.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { attachSimulatedEventEmitter } from "../../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame } from "../helpers/game.js";
import type { GameTreeSimulationGameState } from "../../src/core/contracts/aiState.js";

function independentPlanningView(input: GameTreeSimulationGameState) {
  const { _gameRef: _liveGame, ...view } = input;
  return view;
}

for (const seat of ["bot", "player"] as const) {
  for (const mirror of ["state_only", "player_only", "both", "player_map"] as const) {
    test(`canonical material count preserves inherited history without adding legacy mirrors (${seat}/${mirror})`, t => {
      const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
      t.after(() => game.dispose("void_material_fallback"));
      const owner = game[seat], walker = new Card(cardDefinition(202), seat);
      game.recordMaterialEffectActivation(owner, walker, { effectId: "void_walker_no_attack_when_summoned" });
      game.recordMaterialEffectActivation(owner, walker, { effectId: "void_walker_no_attack_when_summoned" });
      const state = independentPlanningView(createGameTreeCopy(game, owner).state);
      // Stage8 removes the mirrored deltas; successful effects update this single snapshot ledger.
      required(state.materialDuelStats)[seat].effectActivationsByMaterialId.set(202, 5);
      if (mirror === "state_only" || mirror === "both") Reflect.set(state, "_simMaterialEffectActivationsByMaterialId", { [seat]: { 202: 3 } });
      if (mirror === "player_only" || mirror === "both") Reflect.set(state.bot, "_simMaterialEffectActivationsByMaterialId", { 202: 3 });
      if (mirror === "player_map") Reflect.set(state.bot, "_simMaterialEffectActivationsByMaterialId", new Map([[202, 3]]));
      assert.equal(getMaterialEffectActivationCount(state, state.bot, 202), 5);
      const clone = independentPlanningView(createGameTreeCopy(state).state);
      assert.equal(getMaterialEffectActivationCount(clone, clone.bot, 202), 5);
    });
  }

  for (const summons of [1, 2] as const) {
    test(`Walker counts each resolved Special-Summon trigger once and requires two for Cosmic Walker (${seat}/${summons})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true, captureReplay: false });
      t.after(() => game.dispose("void_material_count"));
      game.disablePresentationDelays = true;
      game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
      const owner = game[seat]; owner.controllerType = "ai";
      owner.extraDeck.push(new Card(cardDefinition(222), seat));
      for (let index = 0; index < summons; index++) owner.hand.push(new Card(cardDefinition(202), seat));
      const state = independentPlanningView(createGameTreeCopy(game, owner).state);
      // The oracle then advances the live game; the planning branch keeps its
      // own initial material history rather than reading future live outcomes.
      const strategy = new VoidStrategy(state.bot);
      const options = attachSimulatedEventEmitter(state, strategy.getPlanningSimulationOptions(state));
      for (let index = 0; index < summons; index++) {
        const actualIncoming = required(owner.hand[0]);
        await game.performSpecialSummon(0, "attack", owner);
        assert.ok(owner.field.includes(actualIncoming));
        const collected = await game.effectEngine.collectAfterSummonTriggers({ card: actualIncoming, player: owner,
          method: "special", fromZone: "hand" });
        const trigger = required(collected.entries.find(entry => entry.card === actualIncoming &&
          entry.effect.id === "void_walker_no_attack_when_summoned"));
        await trigger.config.activate(null, { ...trigger.config.activationContext, confirmed: true });
        assert.equal(applySimulatedActions({ state, options,
          actions: [{ type: "special_summon_from_zone", zone: "hand", count: { min: 1, max: 1 },
            filters: { name: "Void Walker" }, position: "attack" }] }), true);
      }
      const physicalMaterial = required(owner.field.find(card => card.id === 202));
      const simulatedMaterial = required(state.bot.field.find(card => card.instanceId === physicalMaterial.instanceId));
      const ascension = required(owner.extraDeck[0]);
      assert.equal(game.materialDuelStats[seat].effectActivationsByMaterialId.get(202), summons,
        "actual trigger resolution is the gameplay oracle, not either planning mirror");
      assert.equal(physicalMaterial.cannotAttackThisTurn, true);
      assert.equal(simulatedMaterial.cannotAttackThisTurn, true);
      assert.equal(game.checkAscensionRequirements(owner, ascension, physicalMaterial).ok, summons === 2);
      assert.equal(getMaterialEffectActivationCount(state, state.bot, 202), summons);
      assert.equal(getSimulatedVoidAscensionCandidates(state, state.bot, simulatedMaterial).some(card => card.id === 222), summons === 2);
      assert.equal(strategy.generateMainPhaseActions(state).some(action => action.type === "ascension" && action.ascensionCard?.id === 222), summons === 2);
      for (const cloned of [independentPlanningView(createGameTreeCopy(state).state), independentPlanningView(createGameTreeCopy(createGameTreeCopy(state).state).state)]) {
        assert.equal(getMaterialEffectActivationCount(cloned, cloned.bot, 202), summons,
          "copying a planning state does not create another resolved material effect");
        assert.equal(new VoidStrategy(cloned.bot).generateMainPhaseActions(cloned).some(action => action.type === "ascension" && action.ascensionCard?.id === 222), summons === 2);
      }
    });
  }
}
