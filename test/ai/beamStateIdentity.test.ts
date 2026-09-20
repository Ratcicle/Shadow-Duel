import assert from "node:assert/strict";
import test from "node:test";
import { beamSearchTurn } from "../../src/core/ai/BeamSearch.js";
import { canUseSimOncePerTurn, markSimOncePerTurnUsed } from "../../src/core/ai/common/simStateUtils.js";
import { detachSimulatedEquip } from "../../src/core/ai/common/zones.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import type { SimulatedRuntimeStateFields } from "../../src/core/ai/common/simulatedActions/shared.js";
import type { AIAction, AIState, SearchStrategyPort } from "../../src/core/contracts/ai.js";
import type { AiStateShape, BeamPerspectiveGameState, SimulatedCardShape, SimulatedCardState, SimulatedPlayerState } from "../../src/core/contracts/aiState.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";

function card(instanceId: number, name = "copy"): SimulatedCardState {
  return unsafeFixture<SimulatedCardState>({ instanceId, name, cardKind: "monster", atk: 1000, def: 800, level: 4, position: "defense", counters: new Map() } satisfies SimulatedCardShape,
    "Minimal branded simulation card for controlled Beam transitions");
}

function player(id: string): SimulatedPlayerState {
  return { id, lp: 8000, hand: [], field: [], spellTrap: [], graveyard: [], deck: [], extraDeck: [], banished: [], fieldSpell: null, summonCount: 0, additionalNormalSummons: 0 };
}

function game(): AiStateShape {
  const bot = player("bot");
  bot.field.push(card(1));
  return { bot, player: player("player"), turn: "bot", phase: "main1", turnCounter: 1 };
}

function requireBeamState(state: AIState): asserts state is BeamPerspectiveGameState & SimulatedRuntimeStateFields {
  assert.equal(state._isPerspectiveState, true);
  assert.ok(state.bot && state.player && "deck" in state.bot && "deck" in state.player);
}

function score(state: AIState): number {
  requireBeamState(state);
  return state.bot.lp - 8000;
}

const setup: AIAction = { type: "position_change", fieldIndex: 0, toPosition: "attack" };
const reward: AIAction = { type: "position_change", fieldIndex: 0, toPosition: "defense" };

for (const kind of ["stats", "position", "counters"] as const) {
  test(`Beam retains ${kind}-only setup and explores its useful continuation`, async () => {
    const input = game();
    const ready = (state: AiStateShape) => {
      const host = required(state.bot.field[0]);
      return kind === "stats" ? host.atk === 2000 : kind === "position" ? host.position === "attack" : host.counters?.get("charge") === 2;
    };
    const strategy: SearchStrategyPort = {
      generateMainPhaseActions(state) { requireBeamState(state); return state.bot.lp > 8000 ? [] : [ready(state) ? reward : setup]; },
      simulateMainPhaseAction(state, action) {
        requireBeamState(state);
        const host = required(state.bot.field[0]);
        if (action === reward) state.bot.lp += 100;
        else if (kind === "stats") host.atk = 2000;
        else if (kind === "position") host.position = "attack";
        else host.counters?.set("charge", 2);
      },
      evaluateBoard: score,
    };
    const start = performance.now();
    const result = required(await beamSearchTurn(input, strategy, { maxDepth: 2, beamWidth: 2, nodeBudget: 20 }));
    console.log(`identity-baseline ${kind}: sequence=${result.sequence.map(a => a === setup ? "setup" : "reward")} nodes=${result.nodesEvaluated} score=${result.score} ms=${(performance.now() - start).toFixed(2)}`);
    assert.deepEqual(result.sequence, [setup, reward]);
    assert.equal(result.score, 80);
    assert.equal(result.nodesEvaluated, 2);
    assert.equal(required(input.bot.field[0]).atk, 1000);
    assert.equal(required(input.bot.field[0]).counters?.size, 0);
  });
}

test("Beam distinguishes equal-sized resource branches and follows the stronger one", async () => {
  const input = game();
  input.bot.hand.push(card(10, "weak"), card(11, "strong"));
  const weak: AIAction = { type: "position_change", fieldIndex: 0, toPosition: "attack" };
  const strong: AIAction = { type: "position_change", fieldIndex: 1, toPosition: "attack" };
  const visited: string[] = [];
  const strategy: SearchStrategyPort = {
    generateMainPhaseActions(state) {
      requireBeamState(state);
      if (state.bot.lp > 8000) return [];
      if (!state.bot.graveyard.length) return [weak, strong];
      visited.push(required(state.bot.graveyard[0]).name || "");
      return [reward];
    },
    simulateMainPhaseAction(state, action) {
        requireBeamState(state);
      if (action === reward) state.bot.lp += state.bot.graveyard[0]?.name === "strong" ? 100 : 10;
      else state.bot.graveyard.push(required(state.bot.hand.splice(action === strong ? 1 : 0, 1)[0]));
    },
    evaluateBoard: score,
  };
  const start = performance.now();
  const result = required(await beamSearchTurn(input, strategy, { maxDepth: 2, beamWidth: 2, nodeBudget: 20 }));
  console.log(`identity-baseline resources: selected=${result.action === strong ? "strong" : "weak"} nodes=${result.nodesEvaluated} score=${result.score} ms=${(performance.now() - start).toFixed(2)}`);
  assert.deepEqual(visited, ["weak", "strong"]);
  assert.deepEqual(result.sequence, [strong, reward]);
  assert.equal(result.score, 80);
  assert.equal(result.nodesEvaluated, 4);
});

test("Beam still rejects a genuine no-op without expanding the fallback", async () => {
  let generations = 0;
  let evaluations = 0;
  const result = required(await beamSearchTurn(game(), {
    generateMainPhaseActions() { generations++; return [setup]; },
    simulateMainPhaseAction() {},
    evaluateBoard() { evaluations++; return 0; },
  }, { maxDepth: 3 }));
  assert.deepEqual(result.sequence, [setup]); // Existing root fallback is intentional.
  assert.equal(result.nodesEvaluated, 1);
  assert.equal(generations, 1);
  assert.equal(evaluations, 2); // root + exhausted root; no successor evaluation
});

test("Beam preserves simulated usage across depths and isolates sibling ledgers", async () => {
  const input = game();
  input._simOncePerTurn = { bot: new Map([["prior", 1]]) };
  const seen: number[] = [];
  const result = required(await beamSearchTurn(input, {
    generateMainPhaseActions(state) {
      requireBeamState(state);
      seen.push(state._simOncePerTurn?.bot?.get("setup") || 0);
      return canUseSimOncePerTurn(state, "setup") ? [setup, reward] : [];
    },
    simulateMainPhaseAction(state) {
      requireBeamState(state);
      assert.equal(state._simOncePerTurn?.bot?.get("prior"), 1);
      markSimOncePerTurnUsed(state, "setup");
      state.bot.lp += 1;
    },
    evaluateBoard: score,
  }, { maxDepth: 3, nodeBudget: 20 }));
  assert.deepEqual(seen, [0, 1]);
  assert.deepEqual(result.sequence, [setup]);
  assert.equal(result.nodesEvaluated, 2);
  assert.deepEqual([...required(input._simOncePerTurn.bot)], [["prior", 1]]);
});

test("Beam copies mutable resources through depths without changing original or siblings", async () => {
  const input = game();
  input.usedThisTurn = new Map([["effect", 1]]);
  input._simArcanistOptUsed = new Set(["prior"]);
  input._dragonSimOnce = { bot: { prior: true } };
  input._simBurningWest = { wantedRewardUsed: false };
  input.bot.oncePerTurnUsageByName = { effect: { turn: 1, count: 1 } };
  input.bot.additionalNormalSummonPermissions = [{ count: 1, filters: { level: 4 } }];
  const host = required(input.bot.field[0]);
  host.protectionEffects = [{ type: "effect_destruction", duration: "turn", expiresOnTurn: 1 }];
  host.state = { blueprintStorage: { storedBlueprints: [] } };
  host.fieldPresenceState = { activations: 1 };
  host.attackedMonstersThisTurn = new Set([2]);
  const before = structuredClone(input);
  let roots = 0;
  let followups = 0;
  await beamSearchTurn(input, {
    generateMainPhaseActions(state) {
      requireBeamState(state);
      return state.bot.lp === 8000 ? [setup, reward] : state.bot.lp === 8001 ? [setup] : [];
    },
    simulateMainPhaseAction(state) {
      requireBeamState(state);
      const expected = state.bot.lp === 8000 ? 1 : 2;
      const clonedHost = required(state.bot.field[0]);
      assert.equal(state.usedThisTurn?.get("effect"), expected);
      assert.equal(state._simArcanistOptUsed?.has("new"), expected === 2);
      assert.equal(state._simBurningWest?.wantedRewardUsed, expected === 2);
      assert.deepEqual(state._dragonSimOnce?.bot, expected === 1 ? { prior: true } : { prior: true, next: true });
      assert.equal(required(state.bot.additionalNormalSummonPermissions?.[0]).count, expected);
      assert.deepEqual(state.bot.oncePerTurnUsageByName?.effect, { turn: 1, count: expected });
      assert.equal(clonedHost.protectionEffects?.[0]?.expiresOnTurn, expected);
      assert.equal(clonedHost.fieldPresenceState?.activations, expected);
      assert.equal(clonedHost.attackedMonstersThisTurn?.has(3), expected === 2);
      assert.equal(clonedHost.state?.blueprintStorage?.storedBlueprints.length, expected - 1);
      state.usedThisTurn?.set("effect", 2);
      state._simArcanistOptUsed?.add("new");
      required(state._simBurningWest).wantedRewardUsed = true;
      Object.assign(required(state._dragonSimOnce?.bot), { next: true });
      required(state.bot.additionalNormalSummonPermissions?.[0]).count = 2;
      required(state.bot.oncePerTurnUsageByName).effect = { turn: 1, count: 2 };
      required(clonedHost.protectionEffects?.[0]).expiresOnTurn = 2;
      required(clonedHost.fieldPresenceState).activations = 2;
      clonedHost.attackedMonstersThisTurn?.add(3);
      if (expected === 1) {
        roots++;
        clonedHost.state?.blueprintStorage?.storedBlueprints.push({ blueprintId: "stored", shortRulesText: "", effectSnapshot: { id: "stored", timing: "ignition", activationZones: ["field"], actions: [] }, _simStoredByGrimoire: true });
      } else followups++;
      state.bot.lp++;
    },
    evaluateBoard: score,
  }, { maxDepth: 3, nodeBudget: 20 });
  assert.equal(roots, 2);
  assert.equal(followups, 1);
  assert.deepEqual(input, before);
});

test("Beam equipment movement resolves against the branch host across depths", async () => {
  const input = game();
  const host = required(input.bot.field[0]);
  const equip = card(2, "equip");
  equip.cardKind = "spell";
  equip.equipAtkBonus = 300;
  equip.equippedTo = host;
  equip.equipTarget = host;
  host.equips = [equip];
  input.bot.spellTrap.push(equip);
  let detached = 0;
  const result = required(await beamSearchTurn(input, {
    generateMainPhaseActions(state) {
      requireBeamState(state);
      return state.bot.lp === 8000 ? [setup, reward] : state.bot.lp === 8001 ? [setup] : [];
    },
    simulateMainPhaseAction(state) {
      requireBeamState(state);
      const clonedHost = required(state.bot.field[0]);
      const clonedEquip = required(state.bot.spellTrap[0]);
      if (state.bot.lp === 8000) {
        assert.equal(clonedEquip.equippedTo, clonedHost);
        assert.equal(clonedHost.equips?.[0], clonedEquip);
        detachSimulatedEquip(clonedEquip);
        assert.equal(clonedHost.atk, 700);
        detached++;
      } else {
        assert.equal(clonedEquip.equippedTo, null);
        assert.equal(clonedHost.atk, 700);
        assert.deepEqual(clonedHost.equips, []);
      }
      state.bot.lp++;
    },
    evaluateBoard: score,
  }, { maxDepth: 3 }));
  assert.equal(detached, 2);
  assert.equal(result.nodesEvaluated, 3);
  assert.deepEqual(result.sequence, [setup, setup]);
  assert.equal(host.atk, 1000);
  assert.equal(host.equips[0], equip);
  assert.equal(equip.equippedTo, host);
});

test("Beam retains a registered temporary effect and the real simulator fires it next depth", async () => {
  const input = game();
  const source = required(input.bot.field[0]);
  source.effects = [{
    id: "register-reward", timing: "ignition", activationZones: ["field"],
    actions: [{ type: "register_temporary_event_effect", event: "after_summon", triggerRequirement: "mandatory", triggerTiming: "if", duration: "end_of_turn", uses: 1, actions: [{ type: "heal", amount: 100, player: "self" }] }],
  }];
  input.bot.hand.push(card(2, "follow-up"));
  const activate: AIAction = { type: "monsterEffect", fieldIndex: 0 };
  const summon: AIAction = { type: "summon", index: 0, cardName: "follow-up", position: "attack" };
  const result = required(await beamSearchTurn(input, {
    generateMainPhaseActions(state) {
      requireBeamState(state);
      return state.temporaryEventEffects?.length ? [summon] : [activate];
    },
    simulateMainPhaseAction(state, action) {
      requireBeamState(state);
      assert.notEqual(action.type, "simulatedBattle");
      if (action.type === "simulatedBattle") return;
      applyGenericSimulatedMainPhaseAction(state, action, { enableSimulatedEvents: true });
      if (action === activate) assert.equal(state.temporaryEventEffects?.length, 1);
    },
    evaluateBoard: score,
  }, { maxDepth: 2, nodeBudget: 20 }));
  assert.deepEqual(result.sequence, [activate, summon]);
  assert.equal(result.score, 80);
  assert.equal(result.nodesEvaluated, 2);
  assert.equal(input.bot.lp, 8000);
  assert.equal(Object.hasOwn(input, "temporaryEventEffects"), false);
});
