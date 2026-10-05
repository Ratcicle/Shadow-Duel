import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { ActionOf } from "../src/core/contracts/actions.js";
import { cleanupTempBoosts } from "../src/core/game/turn/cleanup.js";
import { cleanupSimulatedEndTurn } from "../src/core/ai/common/simulatedActions/lifecycle.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { createPlanningCopy } from "../src/core/ai/common/planningCopy.js";
import { moveCardToZone } from "../src/core/ai/common/zones.js";
import { walkActionList } from "../src/core/actionHandlers/actionWalker.js";
import { cardDefinition } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { simulationState } from "./helpers/simulation.js";

function setup(t: TestContext, ownerId: "player" | "bot") {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
  t.after(() => game.dispose("default_stat_durations"));
  game.disablePresentationDelays = true;
  const owner = game[ownerId], opponent = game[ownerId === "player" ? "bot" : "player"];
  const target = new Card({ ...cardDefinition(501), atk: 1000, def: 800, effects: [] }, ownerId);
  const source = new Card({ ...cardDefinition(502), effects: [] }, ownerId);
  placeFieldCards(owner.field, target, source);
  const copy = createPlanningCopy();
  const simulated = copy.cloneCardForSim(target), simulatedSource = copy.cloneCardForSim(source);
  const state = simulationState({ turnCounter: 2, [ownerId]: { field: [simulated, simulatedSource] } });
  return { game, owner, opponent, target, source, simulated, simulatedSource, state, ownerId };
}

async function apply(s: ReturnType<typeof setup>, action: ActionOf<"buff_stats_temp"> | ActionOf<"buff_stats_temp_with_second_attack"> | ActionOf<"set_attack_limit_from_zone_count">) {
  const result = await s.game.effectEngine.applyActions([action], { player: s.owner, opponent: s.opponent, source: s.source }, { target: [s.target] });
  assert.equal(result.success, true);
  applySimulatedActions({ state: s.state, selfId: s.ownerId, actions: [action], selections: { target: [s.simulated] }, options: { sourceCard: s.simulatedSource } });
  assert.deepEqual(s.state._simUnsupportedActions || [], []);
}

function endTurn(s: ReturnType<typeof setup>) {
  cleanupTempBoosts(s.owner);
  cleanupSimulatedEndTurn(s.state);
}

async function faceDown(s: ReturnType<typeof setup>) {
  const action: ActionOf<"set_facedown_defense"> = { type: "set_facedown_defense", targetRef: "target" };
  assert.equal((await s.game.effectEngine.applyActions([action], { player: s.owner, opponent: s.opponent, source: s.source }, { target: [s.target] })).success, true);
  applySimulatedActions({ state: s.state, selfId: s.ownerId, actions: [action], selections: { target: [s.simulated] } });
}

async function leaveAndReturn(s: ReturnType<typeof setup>) {
  assert.notEqual(await s.game.moveCard(s.target, s.owner, "graveyard", { fromZone: "field" }), false);
  assert.equal(moveCardToZone(s.state[s.ownerId], s.simulated, "graveyard", s.state[s.ownerId], { state: s.state }), true);
  assert.equal((await s.game.effectEngine.applyActions([{ type: "special_summon_from_zone", targetRef: "revive", zone: "graveyard", position: "attack" }], { player: s.owner, opponent: s.opponent, source: s.source }, { revive: [s.target] })).success, true);
  assert.equal(moveCardToZone(s.state[s.ownerId], s.simulated, "field", s.state[s.ownerId], { state: s.state }), true);
}

for (const ownerId of ["player", "bot"] as const) {
  for (const departure of ["face_down", "field_exit"] as const) {
    test(`unspecified stat duration persists across turns and expires on ${departure} (${ownerId})`, async t => {
      const s = setup(t, ownerId);
      await apply(s, { type: "buff_stats_temp", targetRef: "target", atkBoost: 300, defBoost: -200 });
      endTurn(s); endTurn(s);
      assert.deepEqual([s.target.atk, s.target.def, s.simulated.atk, s.simulated.def], [1300, 600, 1300, 600]);
      assert.equal(s.target.tempAtkBoost || 0, 0);
      const branch = createPlanningCopy().cloneCardForSim(s.target);
      const branchState = simulationState({ [ownerId]: { field: [branch] } });
      applySimulatedActions({ state: branchState, selfId: ownerId,
        actions: [{ type: "set_facedown_defense", targetRef: "target" }], selections: { target: [branch] } });
      assert.deepEqual([branch.atk, branch.def], [1000, 800], "a fresh planning clone retains the expiry metadata");
      assert.deepEqual([s.target.atk, s.target.def], [1300, 600], "branch expiry never mutates the live ledger");
      if (departure === "face_down") {
        await faceDown(s);
        s.target.isFacedown = false; s.simulated.isFacedown = false;
      } else await leaveAndReturn(s);
      assert.deepEqual([s.target.atk, s.target.def, s.simulated.atk, s.simulated.def], [1000, 800, 1000, 800]);
    });
  }

  test(`explicit end-of-turn stats and intrinsic second-attack wrapper remain temporary (${ownerId})`, async t => {
    const s = setup(t, ownerId);
    await apply(s, { type: "buff_stats_temp", targetRef: "target", atkBoost: 300, defBoost: -200, duration: "end_of_turn" });
    await apply(s, { type: "buff_stats_temp_with_second_attack", targetRef: "target", atkBoost: 100 });
    assert.deepEqual([s.target.atk, s.simulated.atk], [1400, 1400]);
    endTurn(s);
    assert.deepEqual([s.target.atk, s.target.def, s.simulated.atk, s.simulated.def], [1000, 800, 1000, 800]);
  });

  test(`permanent stats remain distinct from face-up changes by the same source (${ownerId})`, async t => {
    const s = setup(t, ownerId);
    await apply(s, { type: "buff_stats_temp", targetRef: "target", atkBoost: 400, sourceName: "shared", permanent: true });
    await apply(s, { type: "buff_stats_temp", targetRef: "target", atkBoost: 300, sourceName: "shared" });
    endTurn(s);
    assert.deepEqual([s.target.atk, s.simulated.atk], [1700, 1700]);
    await faceDown(s);
    assert.deepEqual([s.target.atk, s.simulated.atk], [1400, 1400]);
    await leaveAndReturn(s);
    assert.deepEqual([s.target.atk, s.simulated.atk], [1000, 1000]);
  });

  for (const duration of [undefined, "until_end_turn"] as const) {
    test(`attack limits use ${duration ?? "face-up default"} (${ownerId})`, async t => {
      const s = setup(t, ownerId);
      await apply(s, { type: "set_attack_limit_from_zone_count", targetRef: "target", minAttacks: 3, ...(duration ? { duration } : {}) });
      endTurn(s);
      assert.deepEqual([s.target.attackLimitThisTurn, s.simulated.attackLimitThisTurn], duration ? [undefined, undefined] : [3, 3]);
      if (!duration) {
        await faceDown(s);
        assert.deepEqual([s.target.attackLimitThisTurn, s.simulated.attackLimitThisTurn], [undefined, undefined]);
        await apply(s, { type: "set_attack_limit_from_zone_count", targetRef: "target", minAttacks: 3 });
        await leaveAndReturn(s);
        assert.deepEqual([s.target.attackLimitThisTurn, s.simulated.attackLimitThisTurn], [undefined, undefined]);
      }
    });
  }
}

for (const duration of [undefined, "end_of_turn", "permanent"] as const) {
  test(`banish-and-buff uses ${duration ?? "face-up default"} and clears its target's departed presence`, async t => {
    const s = setup(t, "player");
    const fuel = new Card({ ...cardDefinition(501), atk: 300, effects: [] }, "player");
    s.owner.graveyard.push(fuel);
    const action: ActionOf<"banish_and_buff"> = { type: "banish_and_buff", targetRef: "fuel", buffTarget: "target", buffSource: "atk", buffType: "both", ...(duration ? { duration } : {}) };
    assert.equal((await s.game.effectEngine.applyActions([action], { player: s.owner, opponent: s.opponent, source: s.source }, { fuel: [fuel], target: [s.target] })).success, true);
    assert.ok(s.owner.banished.includes(fuel));
    cleanupTempBoosts(s.owner);
    assert.deepEqual([s.target.atk, s.target.def], duration === "end_of_turn" ? [1000, 800] : [1300, 1100]);
    await faceDown(s);
    assert.deepEqual([s.target.atk, s.target.def], duration === "permanent" ? [1300, 1100] : [1000, 800]);
    await leaveAndReturn(s);
    assert.deepEqual([s.target.atk, s.target.def], [1000, 800]);
  });
}

for (const [id, effectId, atkDelta, defDelta] of [
  [124, "shadow_heart_devastation_dragon_ascension_boost", 700, 0],
  [156, "luminarch_magic_sickle_damage_boost", 1200, 1700],
  [162, "sanctum_luminarch_citadel_buff", 500, 500],
  [163, "luminarch_holy_ascension_boost", 800, 0],
  [207, "void_hollow_king_quick_boost", 1000, 0],
  [227, "void_aberration_void_to_grave_buff", 100, 100],
  [254, "grey_dragon_special_summon_buff", 500, 0],
  [256, "luminescent_dragon_banish_debuff", -600, -600],
  [304, "lightning_magic_lance_effect", 500, 0],
  [314, "azrath_spell_debuff", -100, -100],
  [352, "miragebound_dancer_bounce_buff", 600, 0],
  [356, "miragebound_glass_viper_special_summon_debuff", -500, -500],
  [361, "miragebound_vanishing_step", -500, -500],
] as const) {
  test(`textually temporary stat change ${id}/${effectId} still expires in runtime and simulation`, async t => {
    const s = setup(t, "player");
    const effect = cardDefinition(id).effects?.find(entry => entry.id === effectId);
    assert.ok(effect);
    const raw = walkActionList(effect.actions).visits.find(entry =>
      typeof entry.action === "object" && entry.action !== null && "type" in entry.action && entry.action.type === "buff_stats_temp",
    )?.action;
    assert.ok(typeof raw === "object" && raw !== null && "type" in raw && raw.type === "buff_stats_temp");
    const action = raw as ActionOf<"buff_stats_temp">;
    // Isolate this action's lifetime from the surrounding costs and target selection.
    await apply(s, { ...action, targetRef: "target" });
    assert.deepEqual([s.target.atk, s.target.def, s.simulated.atk, s.simulated.def],
      [1000 + atkDelta, 800 + defDelta, 1000 + atkDelta, 800 + defDelta]);
    endTurn(s);
    assert.deepEqual([s.target.atk, s.target.def, s.simulated.atk, s.simulated.def], [1000, 800, 1000, 800]);
  });
}
