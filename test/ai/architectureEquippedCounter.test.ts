import assert from "node:assert/strict";
import test from "node:test";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { refreshSimulatedFieldAuras } from "../../src/core/ai/common/zones.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { cleanupSimulatedEndTurn } from "../../src/core/ai/common/simulatedActions/lifecycle.js";
import { hasPendingPassiveRestoration } from "../../src/core/ai/common/planningCopy.js";
import { getModeledPassiveContributions } from "../../src/core/effects/passives/passiveBuffs.js";
import { cleanupTempBoosts } from "../../src/core/game/turn/cleanup.js";
import { required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

for (const actor of ["bot", "player"] as const) {
  for (const variant of ["refresh", "negate", "source_exit", "host_exit", "zone_gate", "suppression"] as const) {
    test(`equipped counter contribution follows runtime ${variant} (${actor})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, disableChains: true });
      t.after(() => game.dispose("architecture_equipped_counter"));
      game.turn = actor; game.phase = "main1"; game.turnCounter = 4;
      const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
      const host = required(game.createCardForOwner(151, owner));
      const blade = required(game.createCardForOwner(166, owner));
      blade.addCounter("solar", 2);
      if (variant === "zone_gate") blade.effects = blade.effects.map(effect => effect.id === "luminarch_sunforged_blade_counter_buff"
        ? { ...effect, requireZone: "field" } : effect);
      placeFieldCards(owner.field, host);
      placeFieldCards(owner.spellTrap, blade);
      await game.effectEngine.applyEquip({ type: "equip", targetRef: "host" },
        { source: blade, player: owner, opponent }, { host: [host] });
      game.effectEngine.updatePassiveBuffs();
      const initial = [host.atk, host.def];
      assert.deepEqual(initial, [required(host.baseAtk) + (variant === "zone_gate" ? 0 : 400),
        required(host.baseDef) + (variant === "zone_gate" ? 0 : 400)]);
      const { state } = createGameTreeCopy(game, owner);
      const simHost = required(state.bot.field.find(card => card.instanceId === host.instanceId));
      const simBlade = required(state.bot.spellTrap.find(card => card.instanceId === blade.instanceId));
      for (let repeat = 0; repeat < 3; repeat++) refreshSimulatedFieldAuras(state);
      assert.deepEqual([simHost.atk, simHost.def], initial, "cloned applied contributions are refreshed without addition twice");
      if (variant === "negate") {
        const negate = { type: "add_status" as const, targetRef: "target", status: "effectsNegated" as const };
        await game.effectEngine.applyActions([negate], { player: owner, opponent }, { target: [blade] });
        applySimulatedActions({ state, actions: [negate], selections: { target: [simBlade] } });
        game.effectEngine.updatePassiveBuffs();
        assert.deepEqual([simHost.atk, simHost.def], [host.atk, host.def]);
        const clear = { ...negate, remove: true };
        await game.effectEngine.applyActions([clear], { player: owner, opponent }, { target: [blade] });
        applySimulatedActions({ state, actions: [clear], selections: { target: [simBlade] } });
      } else if (variant === "source_exit" || variant === "host_exit") {
        const moving = variant === "source_exit" ? blade : host;
        const simMoving = variant === "source_exit" ? simBlade : simHost;
        const action = { type: "move" as const, targetRef: "target", to: "graveyard" as const };
        await game.effectEngine.applyActions([action], { player: owner, opponent }, { target: [moving] });
        applySimulatedActions({ state, actions: [action], selections: { target: [simMoving] } });
      } else if (variant === "suppression") {
        assert.deepEqual(getModeledPassiveContributions(simHost), getModeledPassiveContributions(host));
        const action = { type: "modify_stats_temp" as const, targetRef: "target", atkFactor: 0, defFactor: 0 };
        await game.effectEngine.applyActions([action], { player: owner, opponent }, { target: [host] });
        applySimulatedActions({ state, actions: [action], selections: { target: [simHost] } });
        game.effectEngine.updatePassiveBuffs();
        refreshSimulatedFieldAuras(state);
        assert.deepEqual([simHost.atk, simHost.def], [host.atk, host.def]);
        assert.equal(hasPendingPassiveRestoration(state), false);
        cleanupTempBoosts(owner);
        cleanupSimulatedEndTurn(state);
        cleanupSimulatedEndTurn(state);
      }
      game.effectEngine.updatePassiveBuffs();
      refreshSimulatedFieldAuras(state);
      assert.deepEqual([simHost.atk, simHost.def], [host.atk, host.def]);
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }
}
