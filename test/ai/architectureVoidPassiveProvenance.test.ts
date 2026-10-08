import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../../src/core/Card.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { hasPendingPassiveRestoration } from "../../src/core/ai/common/planningCopy.js";
import { refreshSimulatedFieldAuras } from "../../src/core/ai/common/zones.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { cleanupSimulatedEndTurn } from "../../src/core/ai/common/simulatedActions/lifecycle.js";
import { getModeledPassiveContributions } from "../../src/core/effects/passives/passiveBuffs.js";
import { cleanupTempBoosts } from "../../src/core/game/turn/cleanup.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

const families = [
  { id: 211, effectId: "void_tenebris_horn_field_aura", family: "archetype_count_buff" },
  { id: 209, effectId: "void_forgotten_knight_atk_boost", family: "graveyard_card_count_buff" },
  { id: 224, effectId: "arturus_atk_gy_buff", family: "graveyard_archetype_count_buff" },
] as const;

function scenario(t: TestContext, actor: "bot" | "player", spec: typeof families[number], override?: EffectDefinition) {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, disableChains: true });
  t.after(() => game.dispose("architecture_void_passive_provenance"));
  game.turn = actor; game.phase = "main1"; game.turnCounter = 3;
  const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
  const definition = cardDefinition(spec.id);
  const effect = override || required(definition.effects?.find(entry => entry.id === spec.effectId));
  const source = new Card({ ...definition, effects: [effect] }, actor);
  placeFieldCards(owner.field, source);
  owner.graveyard.push(new Card(cardDefinition(204), actor), new Card(cardDefinition(204), actor));
  const project = () => {
    const state = createGameTreeCopy(game, owner).state;
    const target = required(state.bot.field.find(card => card.instanceId === source.instanceId));
    return { state, target };
  };
  return { game, owner, opponent, source, project };
}

for (const actor of ["bot", "player"] as const) {
  for (const spec of families) {
    test(`declarative negation reconciles and restores ${spec.family} without unsupported actions (${actor})`, async t => {
      const { game, owner, opponent, source, project } = scenario(t, actor, spec);
      game.effectEngine.updatePassiveBuffs();
      const initial = [source.atk, source.def];
      const { state, target } = project();
      const negate = { type: "add_status" as const, targetRef: "target", status: "effectsNegated" as const };
      await game.effectEngine.applyActions([negate], { player: opponent, opponent: owner }, { target: [source] });
      applySimulatedActions({ state, actions: [negate], selections: { target: [target] } });
      game.effectEngine.updatePassiveBuffs();
      refreshSimulatedFieldAuras(state);
      const negatedRuntime = [source.atk, source.def];
      const negatedSimulation = [target.atk, target.def];
      assert.equal(source.effectsNegated, true);
      assert.equal(target.effectsNegated, true);
      assert.deepEqual(negatedRuntime, [source.baseAtk, source.baseDef]);

      const clear = { ...negate, remove: true };
      await game.effectEngine.applyActions([clear], { player: opponent, opponent: owner }, { target: [source] });
      applySimulatedActions({ state, actions: [clear], selections: { target: [target] } });
      game.effectEngine.updatePassiveBuffs();
      refreshSimulatedFieldAuras(state);
      assert.equal(source.effectsNegated, false);
      assert.equal(target.effectsNegated, false);
      assert.deepEqual([source.atk, source.def], initial);
      assert.deepEqual(state._simUnsupportedActions || [], [],
        "the declarative negation path must recognize the passive family it can reconcile");
      assert.deepEqual(negatedSimulation, negatedRuntime);
      assert.deepEqual([target.atk, target.def], initial);
    });

    test(`a produced ${spec.family} proof survives projection and temporary suppression (${actor})`, async t => {
      const { game, owner, opponent, source, project } = scenario(t, actor, spec);
      game.effectEngine.updatePassiveBuffs();
      const expected = [source.atk, source.def];
      const { state, target } = project();
      assert.deepEqual(getModeledPassiveContributions(source), [[spec.effectId, spec.family]]);
      assert.deepEqual(getModeledPassiveContributions(target), getModeledPassiveContributions(source));
      const action = { type: "modify_stats_temp" as const, targetRef: "target", atkFactor: 0, defFactor: 0 };
      await game.effectEngine.applyActions([action], { player: opponent, opponent: owner }, { target: [source] });
      applySimulatedActions({ state, actions: [action], selections: { target: [target] } });
      game.effectEngine.updatePassiveBuffs();
      refreshSimulatedFieldAuras(state);
      assert.deepEqual([target.atk, target.def], [source.atk, source.def]);
      assert.deepEqual(state._simUnsupportedActions || [], []);
      assert.equal(hasPendingPassiveRestoration(state), false);
      cleanupTempBoosts(owner);
      game.effectEngine.updatePassiveBuffs();
      cleanupSimulatedEndTurn(state);
      cleanupSimulatedEndTurn(state);
      assert.deepEqual([source.atk, source.def], expected);
      assert.deepEqual([target.atk, target.def], expected);
    });

    test(`refresh cannot certify an imported ${spec.family} suppression (${actor})`, t => {
      const { game, source, project } = scenario(t, actor, spec);
      // Deliberately imported state: this physical object has never visited a
      // contribution producer, despite carrying a familiar declaration/key.
      source.atk = 0;
      source.temporarySuppressedDynamicBuffStatsByKey = { [spec.effectId]: { atk: true } };
      const { state, target } = project();
      assert.equal(hasPendingPassiveRestoration(state), true);
      for (let repeat = 0; repeat < 2; repeat++) {
        game.effectEngine.updatePassiveBuffs();
        refreshSimulatedFieldAuras(state);
        assert.equal(target.atk, 0);
        assert.equal(source.atk, 0);
        assert.deepEqual(getModeledPassiveContributions(source), []);
        assert.deepEqual(getModeledPassiveContributions(target), []);
        assert.equal(hasPendingPassiveRestoration(state), true);
      }
    });

    test(`removing ${spec.family} preserves an unrelated while-faceup buff (${actor})`, async t => {
      const { game, owner, opponent, source, project } = scenario(t, actor, spec);
      const buff = { type: "buff_stats_temp" as const, targetRef: "target", atkBoost: 500,
        duration: "while_faceup" as const };
      await game.effectEngine.applyActions([buff], { player: owner, opponent }, { target: [source] });
      game.effectEngine.updatePassiveBuffs();
      const { state, target } = project();
      const independentAtk = required(source.baseAtk) + 500;
      source.effectsNegated = target.effectsNegated = true;
      game.effectEngine.updatePassiveBuffs();
      refreshSimulatedFieldAuras(state);
      assert.equal(source.atk, independentAtk);
      assert.equal(target.atk, source.atk);
      assert.equal(target.def, source.def);
      assert.deepEqual(getModeledPassiveContributions(target), []);
    });

    test(`a modeled ${spec.family} never proves a separate unknown suppression (${actor})`, t => {
      const { game, project } = scenario(t, actor, spec);
      game.effectEngine.updatePassiveBuffs();
      const { state, target } = project();
      target.temporarySuppressedDynamicBuffStatsByKey = { unknown_origin: { atk: true } };
      refreshSimulatedFieldAuras(state);
      assert.equal(hasPendingPassiveRestoration(state), true);
      assert.ok(getModeledPassiveContributions(target).every(([key]) => key !== "unknown_origin"));
    });
  }

  for (const variant of ["self", "opponent", "bothWithoutSelf", "spellKind", "countFacedown"] as const) {
    test(`field archetype count follows owners/self/kind/face gates (${actor}/${variant})`, t => {
      const spec = families[0];
      const baseEffect = required(new Card(cardDefinition(spec.id), actor).effects.find(effect => effect.id === spec.effectId));
      if (baseEffect.timing !== "passive" || !("passive" in baseEffect) || !baseEffect.passive ||
          baseEffect.passive.type !== "archetype_count_buff") throw new Error("count rule required");
      const passive: NonNullable<typeof baseEffect.passive> = { ...baseEffect.passive,
        countOwners: variant === "opponent" ? ["opponent"] : variant === "self" ? ["self"] : ["self", "opponent"],
        includeSelf: variant !== "bothWithoutSelf", cardKinds: variant === "spellKind" ? ["spell"] : ["monster"],
        requireFaceup: variant !== "countFacedown" };
      const effect: EffectDefinition = { ...baseEffect, passive };
      const { game, owner, opponent, source, project } = scenario(t, actor, spec, effect);
      const own = new Card(cardDefinition(204), actor), opposing = new Card(cardDefinition(204), opponent.id);
      placeFieldCards(owner.field, own);
      placeFieldCards(opponent.field, opposing);
      game.effectEngine.updatePassiveBuffs();
      const { state, target } = project();
      const simOwn = required(state.bot.field.find(card => card.instanceId === own.instanceId));
      const simOpp = required(state.player.field.find(card => card.instanceId === opposing.instanceId));
      own.isFacedown = simOwn.isFacedown = true;
      opposing.isFacedown = simOpp.isFacedown = true;
      game.effectEngine.updatePassiveBuffs();
      refreshSimulatedFieldAuras(state);
      assert.deepEqual([target.atk, target.def], [source.atk, source.def]);
      const expectedCount = variant === "spellKind" || variant === "bothWithoutSelf" || variant === "opponent"
        ? 0 : variant === "countFacedown" ? 3 : 1;
      assert.equal(target.atk, required(source.baseAtk) + expectedCount * 100);
    });
  }
}
