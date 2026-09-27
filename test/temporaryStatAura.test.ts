import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { cleanupTempBoosts } from "../src/core/game/turn/cleanup.js";
import { applyPassiveBuffValue } from "../src/core/effects/passives/passiveBuffs.js";
import { createPlanningCopy } from "../src/core/ai/common/planningCopy.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { beamSearchTurn, greedySearchWithEvalV2 } from "../src/core/ai/BeamSearch.js";
import { turnLineSearch } from "../src/core/ai/TurnLineSearch.js";
import type { AIAction, AIState } from "../src/core/contracts/ai.js";
import type { SimulationGameState } from "../src/core/contracts/aiState.js";
import { fixtureGameTreeSearch } from "./helpers/gameTree.js";
import type { ActionOf } from "../src/core/contracts/actions.js";
import { cardDefinition } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { simulationState } from "./helpers/simulation.js";

function scenario(t: TestContext, ownerId: "player" | "bot") {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
  t.after(() => game.dispose("temporary_stat_aura_test"));
  game.disablePresentationDelays = true;
  game.player.controllerType = "human";
  game.bot.controllerType = "human";
  const owner = game[ownerId];
  const opponent = game[ownerId === "player" ? "bot" : "player"];
  game.turn = opponent.id;
  game.turnCounter = 2;
  game.phase = "main1";
  const dragon = new Card(cardDefinition("Shadow-Heart Scale Dragon"), owner.id);
  const valley = new Card(cardDefinition("Darkness Valley"), owner.id);
  const attacker = new Card(cardDefinition("Luminarch Valiant - Knight of the Dawn"), opponent.id);
  const spear = new Card(cardDefinition("Luminarch Spear of Dawnfall"), opponent.id);
  owner.fieldSpell = valley;
  placeFieldCards(owner.field, dragon);
  placeFieldCards(opponent.field, attacker);
  opponent.hand.push(spear);
  game.effectEngine.updatePassiveBuffs();
  const activateSpear = () => game.tryActivateSpell(spear, 0, {
    spear_luminarch_check: [attacker], spear_zero_target: [dragon],
  }, { owner: opponent });
  return { game, owner, opponent, dragon, valley, attacker, spear, activateSpear };
}

for (const { factor, expected } of [
  { factor: 0, expected: [0, 0] },
  { factor: 0.05, expected: [165, 140] },
  { factor: 0.5, expected: [1650, 1400] },
]) {
  test(`temporary factors preserve ATK/DEF aura accounting in runtime and simulation (${factor})`, async t => {
    const { game, owner, opponent, dragon, spear } = scenario(t, "player");
    owner.fieldSpell = new Card({ ...cardDefinition("Darkness Valley"), effects: [{
      id: "both_stat_aura", timing: "passive", requireZone: "fieldSpell", passive: {
        type: "field_archetype_aura_buff", archetype: "Shadow-Heart", targetOwners: ["self"],
        amount: 300, stats: ["atk", "def"],
      },
    }] }, owner.id);
    game.effectEngine.updatePassiveBuffs();
    const copy = createPlanningCopy();
    const simulated = copy.cloneCardForSim(dragon);
    const state = simulationState({ player: { field: [simulated] } });
    const action: ActionOf<"modify_stats_temp"> = {
      type: "modify_stats_temp", targetRef: "target", atkFactor: factor, defFactor: factor,
    };
    await game.effectEngine.applyActions([action], { player: opponent, opponent: owner, source: spear }, { target: [dragon] });
    applySimulatedActions({ state, selfId: "bot", actions: [action], selections: { target: [simulated] } });
    for (const [key, entry] of Object.entries(simulated.dynamicBuffs || {})) {
      applyPassiveBuffValue(simulated, key, entry.value || 0, entry.stats);
    }
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([dragon.atk, dragon.def], expected);
    assert.deepEqual([simulated.atk, simulated.def], expected);
    assert.deepEqual([simulated.tempAtkBoost, simulated.tempDefBoost], [dragon.tempAtkBoost, dragon.tempDefBoost]);
    assert.deepEqual(state._simUnsupportedActions || [], factor < 0.5
      ? ["modify_stats_temp:passive_recalculation"] : []);
    cleanupTempBoosts(owner);
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([dragon.atk, dragon.def], [3300, 2800]);
  });
}

for (const ownerId of ["player", "bot"] as const) {
  for (const search of ["beam", "greedy", "gameTree", "turnLine"] as const) {
    test(`${search} rejects a snapshot with an aura suppressed by the real Spear (${ownerId})`, async t => {
      const { owner, dragon, valley, attacker, activateSpear } = scenario(t, ownerId);
      assert.equal((await activateSpear()).success, true);
      const copy = createPlanningCopy();
      const affected = { field: [copy.cloneCardForSim(dragon)], fieldSpell: copy.cloneCardForSim(valley) };
      const other = { field: [copy.cloneCardForSim(attacker)] };
      const state: SimulationGameState = simulationState({ turn: "bot", phase: "main1", turnCounter: 2,
        player: ownerId === "player" ? affected : other,
        bot: ownerId === "bot" ? affected : other,
      });
      let simulations = 0;
      let evaluations = 0;
      const policy = {
        generateMainPhaseActions: (): AIAction[] => [{ type: "position_change", fieldIndex: 0, toPosition: "defense" }],
        simulateMainPhaseAction() { simulations++; },
        evaluateBoard(_snapshot: AIState) { evaluations++; return 0; },
      };
      const result = search === "beam" ? await beamSearchTurn(state, policy)
        : search === "greedy" ? await greedySearchWithEvalV2(state, policy)
          : search === "gameTree" ? fixtureGameTreeSearch(state, policy, state.bot, 2)
            : await turnLineSearch(state, policy);
      assert.equal(result?.action || null, null);
      assert.equal(simulations, 0);
      assert.equal(evaluations, 0);
      assert.equal(dragon.atk, 0);
      assert.ok(owner.field.includes(dragon));
    });
  }

  test(`temporary zero under an aura restores printed stats on battle destruction and revival (${ownerId})`, async t => {
    const { game, owner, opponent, dragon, spear, attacker, activateSpear } = scenario(t, ownerId);
    const values = [[dragon.atk, dragon.def]];
    assert.equal((await activateSpear()).success, true);
    values.push([dragon.atk, dragon.def]);
    game.effectEngine.updatePassiveBuffs();
    game.effectEngine.updatePassiveBuffs();
    values.push([dragon.atk, dragon.def]);
    game.phase = "battle";
    game.battleStep = "battle";
    await game.resolveCombat(attacker, dragon);
    assert.ok(owner.graveyard.includes(dragon));
    values.push([dragon.atk, dragon.def]);
    const revived = await game.effectEngine.applyActions([{
      type: "special_summon_from_zone", targetRef: "revive", zone: "graveyard", position: "attack",
    }], { player: owner, opponent, source: spear }, { revive: [dragon] });
    assert.equal(revived.success, true);
    assert.ok(owner.field.includes(dragon));
    game.effectEngine.updatePassiveBuffs();
    values.push([dragon.atk, dragon.def]);
    assert.deepEqual(values, [[3300, 2500], [0, 0], [0, 0], [3000, 2500], [3300, 2500]]);
  });

  for (const removeAura of [false, true]) {
    test(`temporary zero restores only active auras at turn end (${ownerId}, removeAura=${removeAura})`, async t => {
      const { game, owner, dragon, valley, activateSpear } = scenario(t, ownerId);
      await activateSpear();
      if (removeAura) await game.moveCard(valley, owner, "graveyard", { fromZone: "fieldSpell" });
      game.effectEngine.updatePassiveBuffs();
      const reduced = [dragon.atk, dragon.def];
      cleanupTempBoosts(owner);
      game.effectEngine.updatePassiveBuffs();
      assert.deepEqual(reduced, [0, 0]);
      assert.deepEqual([dragon.atk, dragon.def], [removeAura ? 3000 : 3300, 2500]);
      game.effectEngine.updatePassiveBuffs();
      assert.equal(dragon.atk, removeAura ? 3000 : 3300);
    });
  }
}
