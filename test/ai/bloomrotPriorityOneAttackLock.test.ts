import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { turnLineSearch } from "../../src/core/ai/TurnLineSearch.js";
import { evaluateTechZeroVisibleBattle } from "../../src/core/ai/techzero/battle.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import type { AIState } from "../../src/core/contracts/ai.js";
import type { SimulationGameState } from "../../src/core/contracts/aiState.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

function setup(seat: "player" | "bot", counters = 5) {
  const other = seat === "player" ? "bot" : "player";
  const attacker = simulationCard(new Card({ name: "Planner attacker", cardKind: "monster", atk: 3000, def: 0 }, seat));
  attacker.counters = new Map([["spore", counters]]);
  const network = simulationCard(new Card({ ...cardDefinition(412),
    effects: required(cardDefinition(412).effects).filter(effect => effect.timing === "passive") }, other));
  const state: SimulationGameState = simulationState({ phase: "main1", turn: seat, turnCounter: 4,
    bot: { id: seat, field: [attacker] }, player: { id: other, spellTrap: [network], lp: 2500 } });
  return { state, attacker, network };
}

const strategy = {
  generateMainPhaseActions: () => [],
  simulateMainPhaseAction: () => undefined,
  evaluateBoard: (snapshot: AIState) => 8000 - (snapshot.player?.lp || 0),
};

for (const seat of ["player", "bot"] as const) {
  test(`TurnLine excludes attacks locked by counters and restores them after negation (${seat})`, async () => {
    const { state, network } = setup(seat);
    const options = { turnMode: "mainBattleMain2" as const, maxDepth: 1, battleStepLimit: 1 };
    const blocked = await turnLineSearch(state, strategy, options);
    assert.equal(blocked, null, "a blocked board has no legal action or battle bridge");
    network.effectsNegated = true;
    const allowed = required(await turnLineSearch(state, strategy, options));
    assert.equal(allowed.finalState?.player.lp, 0);
    network.effectsNegated = false;
    assert.equal(await turnLineSearch(state, strategy, options), null);
    assert.equal(state.player.lp, 2500, "planning leaves the live fixture unchanged");
  });

  test(`Tech-Zero excludes locked attacks without treating the modeled aura as uncertain (${seat})`, () => {
    const { state, attacker, network } = setup(seat);
    let result = evaluateTechZeroVisibleBattle(state.bot, state.player, 4);
    assert.deepEqual(result.attacks, []); assert.equal(result.damage, 0); assert.equal(result.lethal, false);
    assert.equal(result.complete, true);
    network.effectsNegated = true;
    result = evaluateTechZeroVisibleBattle(state.bot, state.player, 4);
    assert.equal(result.lethal, true); assert.equal(result.damage, 2500);
    network.effectsNegated = false;
    attacker.counters?.set("spore", 4);
    assert.equal(evaluateTechZeroVisibleBattle(state.bot, state.player, 4).lethal, true);
    attacker.counters?.set("spore", 5);
    state.player.spellTrap = [];
    state.player.graveyard.push(network);
    assert.equal(evaluateTechZeroVisibleBattle(state.bot, state.player, 4).lethal, true);
  });

  test(`simulated negation of the modeled counter aura needs no passive recalculation (${seat})`, () => {
    const { state, network } = setup(seat);
    applySimulatedActions({ state, selfId: state.bot.id, selections: { lock_source: [network] },
      actions: [{ type: "add_status", targetRef: "lock_source", status: "effectsNegated" }] });
    assert.equal(network.effectsNegated, true);
    assert.deepEqual(state._simUnsupportedActions || [], []);
    assert.equal(evaluateTechZeroVisibleBattle(state.bot, state.player, 4).lethal, true);
    applySimulatedActions({ state, selfId: state.bot.id, selections: { lock_source: [network] },
      actions: [{ type: "add_status", targetRef: "lock_source", status: "effectsNegated", remove: true }] });
    assert.deepEqual(state._simUnsupportedActions || [], []);
    assert.equal(evaluateTechZeroVisibleBattle(state.bot, state.player, 4).damage, 0);
  });

  test(`Tech-Zero reads every independent active source and its current zone (${seat})`, () => {
    const { state, network } = setup(seat);
    const other = simulationCard(new Card({ ...cardDefinition(412),
      effects: required(cardDefinition(412).effects).filter(effect => effect.timing === "passive") }, state.player.id));
    state.player.spellTrap.push(other);
    network.effectsNegated = true;
    assert.equal(evaluateTechZeroVisibleBattle(state.bot, state.player, 4).damage, 0);
    other.isFacedown = true;
    assert.equal(evaluateTechZeroVisibleBattle(state.bot, state.player, 4).damage, 2500);
    other.isFacedown = false;
    state.player.spellTrap = [];
    state.player.fieldSpell = other;
    assert.equal(evaluateTechZeroVisibleBattle(state.bot, state.player, 4).damage, 2500,
      "a spellTrap-only aura does not apply from the fieldSpell zone");
  });

  test(`Tech-Zero releases a counter lock after destroying its monster source within the projection (${seat})`, () => {
    const { state, attacker } = setup(seat);
    const source = simulationCard(new Card({ name: "Monster counter-lock source", cardKind: "monster", atk: 1000, def: 0,
      effects: [{ id: "monster_counter_lock", timing: "passive", requireZone: "field", passive: {
        type: "counter_attack_lock", counterType: "spore", minCounters: 5, targetOwners: ["opponent"],
        targetFilters: { cardKind: "monster", requireFaceup: true },
      } }] }, state.player.id));
    const unblocked = simulationCard(new Card({ name: "Unblocked attacker", cardKind: "monster", atk: 1200, def: 0 }, seat));
    state.bot.field.push(unblocked);
    state.player.spellTrap = []; state.player.field = [source]; state.player.lp = 2500;
    const result = evaluateTechZeroVisibleBattle(state.bot, state.player, 4);
    assert.equal(result.lethal, true);
    assert.deepEqual(result.attacks, [
      { attackerInstanceId: unblocked.instanceId, targetInstanceId: source.instanceId },
      { attackerInstanceId: attacker.instanceId, targetInstanceId: null },
    ]);
    assert.equal(state.player.field[0], source, "the projection cannot destroy the live source");
  });
}
