import assert from "node:assert/strict";
import test from "node:test";
import { gameTreeSearch } from "../../src/core/ai/GameTreeSearch.js";
import type { PlanningModel, GameTreeModels } from "../../src/core/contracts/aiPlanning.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import { simulationState, simulationCard } from "../helpers/simulation.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { getCounterValue } from "../../src/core/ai/common/counters.js";
import type { SimulationGameState } from "../../src/core/contracts/aiState.js";
import { useSimOpt } from "../../src/core/ai/common/simStateUtils.js";

const idle: AIAction = { type: "position_change", fieldIndex: 99, toPosition: "attack" };
const live = {
  bot: { debug: false },
  generateMainPhaseActions(): AIAction[] { throw new Error("Live strategy must not generate"); },
  simulateMainPhaseAction() { throw new Error("Live strategy must not simulate"); },
};

test("GameTree uses fixed physical models and fresh snapshot-bound instances at generation and execution", () => {
  const input = simulationState({ bot: { lp: 8000 }, player: { lp: 8000 } });
  const consulted: string[] = [];
  const instances: object[] = [];
  function model(id: string, damage: number): PlanningModel {
    return { id, create(snapshot) {
      const actor = snapshot.bot;
      const cache: string[] = [];
      const instance = {
        generateMainPhaseActions(state: typeof snapshot) {
          assert.equal(actor, state.bot);
          assert.equal(cache.length, 0);
          cache.push("generation");
          consulted.push(`${id}:${actor.id}:generate:${actor.lp}`);
          return [idle];
        },
        simulateMainPhaseAction(state: typeof snapshot) {
          assert.equal(actor, state.bot, "The simulator binds to this branch, not its generation clone");
          assert.equal(cache.length, 0);
          cache.push("execution");
          consulted.push(`${id}:${actor.id}:simulate`);
          state.player.lp -= damage;
        },
      };
      instances.push(instance);
      return instance;
    } };
  }
  const arcanist = model("arcanist", 100);
  const shadowheart = model("shadowheart", 400);
  const models: GameTreeModels = { root: arcanist, actors: new Map([["bot", arcanist], ["player", shadowheart]]) };
  const result = gameTreeSearch(input, live, input.bot, 3, models);
  assert.equal(result.error, undefined);
  assert.equal(result.action, idle);
  assert.equal(result.score, -0.2 * 0.85 ** 6);
  assert.deepEqual(consulted, ["arcanist:bot:generate:8000", "arcanist:bot:simulate", "shadowheart:player:generate:7900", "shadowheart:player:simulate", "arcanist:bot:generate:7600", "arcanist:bot:simulate"]);
  assert.equal(new Set(instances).size, 6);
  assert.equal(input.bot.lp, 8000);
  assert.equal(input.player.lp, 8000);
});

for (const depth of [1, 2, 3, 4]) {
  for (const delta of [-1000, 1000]) {
    test(`GameTree scores the physical root at depth ${depth}, delta ${delta}, including early leaves`, () => {
      const input = simulationState();
      const root: PlanningModel = { id: "root", create: () => ({ generateMainPhaseActions: () => [idle], simulateMainPhaseAction(state) { state.bot.lp += delta; } }) };
      const opponent: PlanningModel = { id: "opponent", create: () => ({ generateMainPhaseActions: () => [], simulateMainPhaseAction() {} }) };
      const result = gameTreeSearch(input, live, input.bot, depth, { root, actors: new Map([["bot", root], ["player", opponent]]) });
      assert.equal(result.error, undefined);
      assert.equal(result.score, (delta / 1000) * 0.85 ** (4 - depth));
    });
  }
}

test("A failing actor factory is unavailable modeling, never an opponent with no responses", () => {
  const input = simulationState();
  const root: PlanningModel = { id: "root", create: () => ({ generateMainPhaseActions: () => [idle], simulateMainPhaseAction() {} }) };
  const opponent: PlanningModel = { id: "unavailable", create() { throw new Error("opponent unavailable"); } };
  const result = gameTreeSearch(input, live, input.bot, 2, { root, actors: new Map([["bot", root], ["player", opponent]]) });
  assert.equal(result.action, null);
  assert.equal(result.confidence, 0);
  assert.match(result.error || "", /opponent unavailable/);
});

test("A search freezes model choices and separate calls cannot share policy evaluations", () => {
  const input = simulationState();
  const opponent: PlanningModel = { id: "old", create: () => ({ generateMainPhaseActions: () => [idle], simulateMainPhaseAction(state) { state.player.lp -= 1000; } }) };
  const replacement: PlanningModel = { id: "new", create: () => ({ generateMainPhaseActions: () => [idle], simulateMainPhaseAction(state) { state.player.lp -= 2000; } }) };
  const actors = new Map([["player", opponent]]);
  const root: PlanningModel = { id: "root", create: () => ({
    generateMainPhaseActions() { actors.set("player", replacement); opponent.create = replacement.create; return [idle]; },
    simulateMainPhaseAction() {},
  }) };
  const first = gameTreeSearch(input, live, input.bot, 2, { root, actors });
  const second = gameTreeSearch(input, live, input.bot, 2, { root, actors });
  assert.ok(Math.abs(first.score + 0.85 ** 5) < 1e-12);
  assert.ok(Math.abs(second.score + 2 * 0.85 ** 5) < 1e-12);
  assert.equal(first.transpositionHits, 2);
  assert.equal(second.transpositionHits, 2);
});

for (const temporary of [false, true]) {
  test(`GameTree effect owner chooses its own target on the branch (temporary=${temporary})`, () => {
    const input = simulationState();
    const left = simulationCard({ instanceId: 10, name: "Left", cardKind: "monster" });
    const right = simulationCard({ instanceId: 11, name: "Right", cardKind: "monster" });
    input.player.field.push(left, right);
    const reward = {
      id: "reward", timing: "on_event", event: "after_summon", triggerRequirement: "mandatory", triggerTiming: "if",
      targets: [{ id: "target", owner: "self", zone: "field", cardKind: "monster" }],
      actions: [{ type: "add_counter", targetRef: "target", counterType: "reward", amount: 1 }],
    } as const;
    left.effects = temporary ? [] : [reward];
    if (temporary) {
      input.temporaryEventEffects = [{ event: "after_summon", ownerId: "player", sourceCardId: null, sourceName: "Left", sourceCardKind: "monster", sourceCardSubtype: null, sourceArchetype: null, sourceArchetypes: [], sourceEffectId: "reward", sourceInstanceId: 10, boundEventTargetInstanceId: null, requireBoundTargetLeavesField: false, duration: "until_consumed", createdOnTurn: 0, expiresOnTurn: null, usesRemaining: 1, declaredValues: {}, effect: reward }];
    }
    input.bot.hand.push(simulationCard({ instanceId: 12, name: "Summon", cardKind: "monster", level: 4 }));
    let executions = 0;
    let observations = 0;
    let ownerDecisions = 0;
    const root: PlanningModel = { id: "A", create(snapshot) { return {
      generateMainPhaseActions: () => [{ type: "summon", index: 0, cardName: "Summon" }],
      simulateMainPhaseAction(state, action) {
        assert.equal(snapshot.bot, state.bot);
        executions++;
        return applyGenericSimulatedMainPhaseAction(state, action, { enableSimulatedEvents: true, targetPreferences: { target: { preferredNames: ["Left"] } } });
      },
    }; } };
    const opponent: PlanningModel = { id: "B", create(snapshot) { const actor = snapshot.bot; return {
      generateMainPhaseActions(state) {
        observations++;
        assert.equal(getCounterValue(state.bot.field[0], "reward"), 0);
        assert.equal(getCounterValue(state.bot.field[1], "reward"), 1);
        assert.equal(state.bot.id, "player");
        assert.ok(state._simOptUsed instanceof Set && state._simOptUsed.has("owner-hook"));
        return [];
      },
      simulateMainPhaseAction() { throw new Error("No opponent main action"); },
      getPlanningSimulationOptions() { return { onEffectActivated({ state }: { state: SimulationGameState }) {
        assert.equal(state.bot, actor);
        assert.equal(Object.hasOwn(state, "_simOptUsed"), false);
        useSimOpt(state, "owner-hook");
        assert.equal(Object.hasOwn(state, "_simOptUsed"), true);
        assert.equal({ ...state }._simOptUsed, state._simOptUsed);
      }, strategy: {
        buildActivationContextForEffect({ game, player }: { game: SimulationGameState; player: object }) {
          ownerDecisions++;
          assert.equal(actor, game.bot);
          assert.equal(player, actor);
          assert.equal(game.bot.id, "player");
          assert.equal(game._gameRef, undefined);
          return { actionContext: { targetPreferences: { target: { preferredNames: ["Right"] } } } };
        },
      } }; },
    }; } };
    const result = gameTreeSearch(input, live, input.bot, 2, { root, actors: new Map([["bot", root], ["player", opponent]]) });
    assert.equal(result.error, undefined);
    assert.equal(result.action?.type, "summon");
    assert.equal(executions, 1);
    assert.equal(observations, 1);
    assert.equal(ownerDecisions, 1);
    assert.equal(getCounterValue(right, "reward"), 0, "Live graph remains untouched");
  });
}

test("Same archetype factories isolate custom actors, sibling caches and poisoned live state", () => {
  const input: SimulationGameState = simulationState();
  input.bot.id = "south";
  input.player.id = "north";
  Reflect.set(input, "_gameRef", { get bot() { throw new Error("live bot read"); }, get player() { throw new Error("live player read"); } });
  const first: AIAction = { ...idle, fieldIndex: 1 };
  const second: AIAction = { ...idle, fieldIndex: 2 };
  const actors: string[] = [];
  const model: PlanningModel = { id: "arcanist", create(snapshot) {
    const preferences: number[] = [];
    return {
      generateMainPhaseActions(state) {
        assert.equal(snapshot.bot, state.bot);
        assert.equal(preferences.length, 0);
        assert.equal(state._gameRef, undefined);
        actors.push(state.bot.id);
        return state.bot.id === "south" ? [first, second] : [];
      },
      simulateMainPhaseAction(state, action) {
        assert.equal(snapshot.bot, state.bot);
        assert.equal(preferences.length, 0);
        preferences.push(99);
        state.bot.lp += action.type === "position_change" && action.fieldIndex === 1 ? 100 : 200;
      },
    };
  } };
  const result = gameTreeSearch(input, live, input.bot, 2, { root: model, actors: new Map([["south", model], ["north", model]]) });
  assert.equal(result.error, undefined);
  assert.equal(result.action, second);
  assert.deepEqual(actors, ["south", "north", "north"]);
  assert.equal(input.bot.lp, 8000);
});

for (const [depth, rootGains, discountPower] of [[1, 1, 3], [2, 1, 5], [3, 2, 6], [4, 2, 6]] as const) {
  test(`Full-horizon root score keeps its sign at ${depth} plies`, () => {
    const input = simulationState();
    const root: PlanningModel = { id: "root", create: () => ({ generateMainPhaseActions: () => [idle], simulateMainPhaseAction(state) { state.bot.lp += 1000; } }) };
    const opponent: PlanningModel = { id: "opponent", create: () => ({ generateMainPhaseActions: () => [idle], simulateMainPhaseAction() {} }) };
    const result = gameTreeSearch(input, live, input.bot, depth, { root, actors: new Map([["bot", root], ["player", opponent]]) });
    assert.equal(result.error, undefined);
    assert.ok(Math.abs(result.score - rootGains * 0.85 ** discountPower) < 1e-12);
  });
}
