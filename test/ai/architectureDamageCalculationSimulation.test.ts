import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../../src/core/Card.js";
import BloomrotStrategy from "../../src/core/ai/BloomrotStrategy.js";
import { turnLineSearch, type BattleCandidateScoreInput } from "../../src/core/ai/TurnLineSearch.js";
import type { CardAction } from "../../src/core/contracts/actions.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { clearSimulatedDamageCalculationBuffs, clearSimulatedEndOfDamageStepBuffs } from "../../src/core/ai/common/simulatedActions/stats.js";
import { fingerprintPlanningState } from "../../src/core/ai/common/stateFingerprint.js";
import { moveCardToZone } from "../../src/core/ai/common/zones.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function scenario(t: TestContext, actor: "bot" | "player") {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
  t.after(() => game.dispose("architecture_damage_calculation"));
  game.turn = actor; game.turnCounter = 4; game.phase = "battle"; game.battleStep = "damage";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
  const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
  const card = new Card({ ...cardDefinition(1), effects: [], atk: 100, def: 200 }, owner.id);
  card.isFacedown = false; card.position = "attack";
  placeFieldCards(owner.field, card);
  const { state } = createGameTreeCopy(game, owner);
  const simulated = required(state.bot.field.find(entry => entry.instanceId === card.instanceId));
  const apply = async (actions: CardAction[]) => {
    await game.effectEngine.applyActions(actions, { source: card, player: owner, opponent }, { chosen: [card] });
    applySimulatedActions({ actions, state, selfId: "bot", selections: { chosen: [simulated] }, options: { sourceCard: simulated } });
    assert.deepEqual([simulated.atk, simulated.def, simulated.tempAtkBoost, simulated.tempDefBoost],
      [card.atk, card.def, card.tempAtkBoost, card.tempDefBoost]);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  };
  const clear = () => {
    game.clearDamageCalculationBuffs(); game.clearEndOfDamageStepBuffs();
    clearSimulatedDamageCalculationBuffs(state); clearSimulatedEndOfDamageStepBuffs(state);
    assert.deepEqual([simulated.atk, simulated.def, simulated.tempAtkBoost, simulated.tempDefBoost],
      [card.atk, card.def, card.tempAtkBoost, card.tempDefBoost]);
  };
  return { game, owner, card, state, simulated, apply, clear };
}

for (const actor of ["bot", "player"] as const) {
  test(`Damage Step durations expire at distinct runtime boundaries (${actor})`, async t => {
    const f = scenario(t, actor);
    await f.apply([{ type: "buff_stats_temp", targetRef: "chosen", duration: "damage_calculation", atkBoost: 500 },
      { type: "buff_stats_temp", targetRef: "chosen", duration: "end_of_damage_step", defBoost: 300 }]);
    f.game.clearDamageCalculationBuffs(); clearSimulatedDamageCalculationBuffs(f.state);
    assert.deepEqual([f.simulated.atk, f.simulated.def], [f.card.atk, f.card.def]);
    assert.deepEqual([f.simulated.atk, f.simulated.def], [100, 500]);
    assert.equal(f.state.endOfDamageStepTempBuffs?.length, 1);
    f.game.clearEndOfDamageStepBuffs(); clearSimulatedEndOfDamageStepBuffs(f.state);
    assert.deepEqual([f.simulated.atk, f.simulated.def], [f.card.atk, f.card.def]);
    assert.deepEqual([f.simulated.atk, f.simulated.def], [100, 200]);
  });

  test(`battle bridge captures boosted ATK but expires it before destruction rewards (${actor})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false,
      captureReplay: false, chainResponseTimeoutMs: 0 });
    t.after(() => game.dispose("architecture_battle_cleanup_timing"));
    game.turn = actor; game.turnCounter = 4; game.phase = "battle"; game.battleStep = "battle";
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "ai";
    game.ui.showChainResponseModal = async () => null;
    const owner = game[actor], other = game[actor === "bot" ? "player" : "bot"];
    owner.lp = other.lp = 5000;
    const definition = cardDefinition(404);
    const attacker = new Card({ ...definition, effects: definition.effects?.filter(effect => effect.event === "battle_damage") || [] }, owner.id);
    const victim = new Card({ ...cardDefinition(1), effects: [], atk: 2300, def: 2300 }, other.id);
    attacker.isFacedown = victim.isFacedown = false;
    attacker.position = victim.position = "attack"; victim.addCounter("spore", 1);
    placeFieldCards(owner.field, attacker); placeFieldCards(other.field, victim);
    const { state } = createGameTreeCopy(game, owner);
    state.phase = "main1";
    const bloom = new BloomrotStrategy(state.bot);
    const scored: BattleCandidateScoreInput[] = [], rewardStats: number[] = [];
    await turnLineSearch({ ...state, player: { ...state.player, name: state.player.name || "Opponent" },
      bot: { ...state.bot, name: state.bot.name || "Owner" } }, {
      generateMainPhaseActions: () => [], simulateMainPhaseAction: () => undefined, evaluateBoard: () => 0,
      prepareSimulatedBattle: context => bloom.prepareSimulatedBattle({ state: context.state,
        attacker: context.attacker || null, target: context.target || null }),
      applySimulatedBattleRewards(context) {
        rewardStats.push(Number(context.battlePlan.attackerCard?.atk));
        return bloom.applySimulatedBattleRewards({ state: context.state,
          battlePlan: { attackerCard: context.battlePlan.attackerCard || null },
          ...(context.summary ? { summary: context.summary } : {}) });
      },
      scoreBattleAttackCandidate(context) { if (context.target?.instanceId === victim.instanceId) scored.push(context); return 0; },
    }, { turnMode: "mainBattleMain2", maxDepth: 1, nodeBudget: 4, battleStepLimit: 1 });
    const observed = required(scored[0]);
    assert.equal(observed.summary.damage, 200);
    assert.ok(observed.simState.player.graveyard.some(card => card.instanceId === victim.instanceId));
    assert.equal(observed.attacker?.atk, 2000); assert.deepEqual(rewardStats, [2000]);
    assert.equal(observed.simState.damageCalculationTempBuffs?.length, 0);
    assert.equal(required(state.bot.field[0]).atk, 2000, "search input stays unchanged");
    const runtimeStats: number[] = [], resolvingStats: number[] = [];
    game.on("battle_destroy", () => runtimeStats.push(attacker.atk));
    game.on("chain_link_resolution", event => {
      if (event.stage === "completed" && event.effectId === "bloomrot_rot_stag_attack_spore_boost") resolvingStats.push(attacker.atk);
    });
    await game.resolveCombat(attacker, victim);
    assert.deepEqual(resolvingStats, [2500]); assert.deepEqual(runtimeStats, rewardStats);
    assert.equal(other.lp, observed.simState.player.lp);
    assert.equal(attacker.atk, observed.attacker?.atk);
  });

  for (const duration of ["damage_calculation", "end_of_damage_step"] as const) {
    for (const input of [
      { name: "positive delta", extra: {}, atkBoost: 500, defBoost: 300 },
      { name: "clamped negative delta", extra: {}, atkBoost: -500, defBoost: -300 },
      { name: "damage duration overrides turn expiry", extra: { durationTurns: 3, expiresOnTurn: 99 }, atkBoost: 500, defBoost: 300 },
      { name: "runtime permanent registration precedence", extra: { permanent: true }, atkBoost: 500, defBoost: 300 },
    ]) test(`Damage Step delta/cleanup matches runtime (${actor}, ${duration}, ${input.name})`, async t => {
      const f = scenario(t, actor);
      await f.apply([{ type: "buff_stats_temp", targetRef: "chosen", duration,
        atkBoost: input.atkBoost, defBoost: input.defBoost, ...input.extra }]);
      const key = duration === "damage_calculation" ? "damageCalculationTempBuffs" : "endOfDamageStepTempBuffs";
      assert.deepEqual(f.state[key]?.map(entry => [entry.card?.instanceId, entry.atk, entry.def]),
        f.game[key].map(entry => [entry.card?.instanceId, entry.atk, entry.def]));
      f.clear(); f.clear();
      assert.deepEqual([f.simulated.atk, f.simulated.def], [100, 200]);
      assert.equal(f.state[key]?.length, 0);
    });

    test(`Damage Step clone retains physical registration without double application (${actor}, ${duration})`, async t => {
      const f = scenario(t, actor);
      await f.apply([{ type: "buff_stats_temp", targetRef: "chosen", duration, atkBoost: 500 }]);
      const copied = createGameTreeCopy(f.state, f.state.bot).state;
      const cloned = required(copied.bot.field.find(entry => entry.instanceId === f.simulated.instanceId));
      const key = duration === "damage_calculation" ? "damageCalculationTempBuffs" : "endOfDamageStepTempBuffs";
      assert.equal(copied[key]?.[0]?.card, cloned);
      assert.notEqual(cloned, f.simulated); assert.equal(cloned.atk, 600);
      const originalHash = fingerprintPlanningState(f.state);
      const withoutExpiry = { ...copied, [key]: [] };
      assert.notEqual(fingerprintPlanningState(copied), fingerprintPlanningState(withoutExpiry),
        "equal stats with different future cleanup are different planning states");
      clearSimulatedDamageCalculationBuffs(copied); clearSimulatedEndOfDamageStepBuffs(copied);
      assert.equal(cloned.atk, 100); assert.equal(f.simulated.atk, 600);
      assert.equal(fingerprintPlanningState(f.state), originalHash);
      f.clear();
    });

    test(`Damage Step departure retires old presence before another modifier (${actor}, ${duration})`, async t => {
      const f = scenario(t, actor);
      await f.apply([{ type: "buff_stats_temp", targetRef: "chosen", duration, atkBoost: 500, defBoost: 300 }]);
      assert.equal((await f.game.moveCard(f.card, f.owner, "graveyard", { fromZone: "field" })).success, true);
      assert.equal(moveCardToZone(f.state.bot, f.simulated, "graveyard", f.state.bot, { state: f.state }), true);
      assert.deepEqual([f.simulated.atk, f.simulated.def], [100, 200]);
      assert.equal((await f.game.moveCard(f.card, f.owner, "field", { fromZone: "graveyard", position: "attack",
        summonMethodOverride: "special", summonOrigin: "effect_resolution" })).success, true);
      assert.equal(moveCardToZone(f.state.bot, f.simulated, "field", f.state.bot, { state: f.state }), true);
      await f.apply([{ type: "buff_stats_temp", targetRef: "chosen", duration: "end_of_turn", atkBoost: 200 }]);
      f.clear(); assert.equal(f.simulated.atk, 300);
    });

    test(`Damage Step partial stat removal preserves a later independent modifier (${actor}, ${duration})`, async t => {
      const f = scenario(t, actor);
      await f.apply([{ type: "buff_stats_temp", targetRef: "chosen", duration, atkBoost: 500, defBoost: 300 }]);
      await f.apply([{ type: "remove_stat_increases", targetRef: "chosen", stats: ["atk"] },
        { type: "buff_stats_temp", targetRef: "chosen", duration: "end_of_turn", atkBoost: 200 }]);
      f.clear();
      assert.deepEqual([f.simulated.atk, f.simulated.def], [300, 200]);
    });
  }
}
