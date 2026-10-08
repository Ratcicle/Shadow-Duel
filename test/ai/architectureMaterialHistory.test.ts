import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { applySimulatedEffectResolution, prepareSimulatedEffectActivation } from "../../src/core/ai/common/simulation.js";
import { recordMaterialEffectActivationInStats, createMaterialDuelStats } from "../../src/core/game/summon/materialStats.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";

for (const seat of ["bot", "player"] as const) {
  for (const outcome of ["success", "failed_actions", "effect_negated"] as const) {
    test(`canonical material history separates committed identity from successful count (${seat}/${outcome})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: false });
      t.after(() => game.dispose("canonical_material_history"));
      game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
      game.disablePresentationDelays = true;
      const owner = game[seat]; owner.controllerType = "ai";
      const effect: EffectDefinition = { id: "material_history_draw", timing: "ignition", activationZones: ["field"],
        actions: [{ type: "draw", amount: 1, player: "self" }] };
      const source = new Card({ ...cardDefinition(264), effects: [effect] }, seat);
      placeFieldCards(owner.field, source);
      if (outcome === "success") owner.deck.push(new Card(cardDefinition(252), seat));
      const { state } = createGameTreeCopy(game, owner);
      const projectedSource = required(state.bot.field[0]);
      const before = state.materialDuelStats?.[seat].activatedEffectIdsByMaterialId.size;
      prepareSimulatedEffectActivation(state, projectedSource, effect);
      prepareSimulatedEffectActivation(state, projectedSource, effect);
      assert.equal(state.materialDuelStats?.[seat].activatedEffectIdsByMaterialId.size, before,
        "Repeated preparation is a pure query and does not create activation history.");
      const runtime = outcome === "effect_negated" ? await (async () => {
        const link = await game.chainSystem.addToChain(game.chainSystem.createPreparedActivation({
          card: source, controller: owner, effect, activationZone: "field", committed: true, costsPaid: true,
        }));
        assert.ok(link);
        source.effectsNegated = true;
        return game.chainSystem.resolveChainLink(link);
      })() : required(await game.tryActivateMonsterEffect(source, null, "field", owner, { effectId: effect.id }));
      const resolved = applySimulatedEffectResolution({ state, effect, selfId: "bot", selections: {},
        effectActionsAllowed: outcome !== "effect_negated", options: { sourceCard: projectedSource, effect } });
      assert.ok(runtime);
      assert.equal(Reflect.get(runtime, "effectNegated") === true, outcome === "effect_negated");
      assert.equal(resolved, outcome !== "failed_actions");
      assert.deepEqual([...(state.materialDuelStats?.[seat].activatedEffectIdsByMaterialId.get(264) || [])],
        [...(game.materialDuelStats[seat].activatedEffectIdsByMaterialId.get(264) || [])]);
      const expectedCount = outcome === "success" ? 1 : 0;
      assert.equal(game.materialDuelStats[seat].effectActivationsByMaterialId.get(264) || 0, expectedCount);
      assert.equal(state.materialDuelStats?.[seat].effectActivationsByMaterialId.get(264) || 0, expectedCount);
    });
  }
  test(`shared material mutation preserves runtime increment ordering (${seat})`, t => {
    const game = createRuntimeGame({ laboratoryMode: true });
    t.after(() => game.dispose("material_mutation_order"));
    const source = new Card(cardDefinition(264), seat), stats = createMaterialDuelStats();
    const observations: boolean[] = [];
    recordMaterialEffectActivationInStats(stats, seat, source, "purified_crystal_protection", (ownerId, materialId) => {
      observations.push(stats[ownerId].activatedEffectIdsByMaterialId.get(materialId)?.has("purified_crystal_protection") === true);
      stats[ownerId].effectActivationsByMaterialId.set(materialId, 1);
    });
    game.recordMaterialEffectActivation(game[seat], source, { effectId: "purified_crystal_protection" });
    assert.deepEqual(observations, [true]);
    assert.deepEqual(stats, game.materialDuelStats);
  });
}
