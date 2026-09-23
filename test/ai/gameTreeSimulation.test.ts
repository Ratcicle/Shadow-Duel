import assert from "node:assert/strict";
import test from "node:test";
import { fixtureGameTreeSearch as gameTreeSearch } from "../helpers/gameTree.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import type { AiStateInput, SimulationGameState } from "../../src/core/contracts/aiState.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";
import { required } from "../helpers/fixtures.js";
import { canUseSimOncePerTurn, useSimOpt } from "../../src/core/ai/common/simStateUtils.js";
import { canUseNormalSummonForCard } from "../../src/core/Player.js";
import { fingerprintPlanningState } from "../../src/core/ai/common/stateFingerprint.js";

const idle: AIAction = { type: "position_change", fieldIndex: 99, toPosition: "attack" };
const spell: AIAction = { type: "spell", index: 0, cardName: "Draw" };
const monsterEffect: AIAction = { type: "monsterEffect", fieldIndex: 0 };

function observeAction(input: SimulationGameState, action: AIAction) {
  let after: AiStateInput | undefined;
  let simulations = 0;
  let generations = 0;
  const start = performance.now();
  const result = gameTreeSearch(input, {
    generateMainPhaseActions(state: AiStateInput): AIAction[] {
      generations++;
      if (state.bot?.id === input.bot.id) return [action];
      after = state;
      return [idle];
    },
    simulateMainPhaseAction(state: SimulationGameState, chosen: AIAction) {
      simulations++;
      return applyGenericSimulatedMainPhaseAction(state, chosen, { enableSimulatedEvents: true });
    },
  }, input.bot, 2);
  console.log("gametree-simulation", JSON.stringify({ action: action.type, result, generations, simulations, ms: performance.now() - start }));
  return { result, after: required(after), simulations };
}

test("GameTree spell draws from its supplied Deck and changes the evaluated resources", () => {
  const input = simulationState({ bot: {
    hand: [simulationCard({ name: "Draw", cardKind: "spell", subtype: "normal", effects: [{ id: "draw", timing: "on_play", actions: [{ type: "draw", amount: 2 }] }] })],
    deck: [simulationCard({ name: "First", cardKind: "monster" }), simulationCard({ name: "Second", cardKind: "monster" })],
  } });
  const before = structuredClone(input);
  const { result, after, simulations } = observeAction(input, spell);
  assert.deepEqual(after.player?.hand?.map(card => card.name), ["First", "Second"]);
  assert.deepEqual(after.player?.graveyard?.map(card => card.name), ["Draw"]);
  assert.equal(after.player?.deck?.length, 0);
  assert.equal(result.score, 1.3 * 0.85 ** 3 * 0.85 ** 2);
  assert.equal(simulations, 2);
  assert.deepEqual(input, before);
});

test("GameTree monsterEffect executes its declarative damage", () => {
  const input = simulationState({ bot: { field: [simulationCard({
    name: "Emitter", cardKind: "monster", atk: 1000,
    effects: [{ id: "damage", timing: "ignition", activationZones: ["field"], actions: [{ type: "damage", amount: 1500, player: "opponent" }] }],
  })] } });
  const { result, after } = observeAction(input, monsterEffect);
  assert.equal(after.bot?.lp, 6500);
  assert.equal(result.score, 3.5 * 0.85 ** 3 * 0.85 ** 2);
  assert.equal(input.player.lp, 8000);
});

test("GameTree Extra Deck procedure sends materials to GY and consumes the Extra Deck card", () => {
  const material = simulationCard({ instanceId: 1, name: "Material", cardKind: "monster", atk: 500 });
  const fusion = simulationCard({ instanceId: 2, name: "Fusion", cardKind: "monster", monsterType: "fusion", atk: 3000 });
  const input = simulationState({ bot: { field: [material], extraDeck: [fusion] } });
  const action: AIAction = { type: "extraDeckProcedure", extraDeckIndex: 0, materialIndices: [0], requiredMaterialCount: 1 };
  const { result, after } = observeAction(input, action);
  assert.deepEqual(after.player?.field?.map(card => card.name), ["Fusion"]);
  assert.deepEqual(after.player?.graveyard?.map(card => card.name), ["Material"]);
  assert.equal(after.player?.extraDeck?.length, 0);
  assert.equal(result.score, 6.3 * 0.85 ** 3 * 0.85 ** 2);
  assert.deepEqual(input.bot.field, [material]);
});

test("GameTree honors a returned state and invokes mutating/void simulators exactly once", () => {
  for (const returnsState of [true, false]) {
    const input = simulationState();
    let calls = 0;
    const result = gameTreeSearch(input, {
      generateMainPhaseActions: (): AIAction[] => [idle],
      simulateMainPhaseAction(state: SimulationGameState) {
        calls++;
        if (returnsState) return { ...state, bot: { ...state.bot, lp: 9000 } };
        state.bot.lp = 9000;
        return undefined;
      },
    }, input.bot, 1);
    assert.equal(calls, 1);
    assert.equal(result.score, 1 * 0.85 ** 3); // Root gains LP in either return convention.
    assert.equal(input.bot.lp, 8000);
  }
});

test("GameTree preserves named OPT for its physical owner across four plies", () => {
  const input = simulationState();
  for (const player of [input.bot, input.player]) player.field.push(simulationCard({
    name: "Same effect", cardKind: "monster", atk: 0,
    effects: [{ id: "reward", timing: "ignition", activationZones: ["field"], oncePerTurn: true, oncePerTurnName: "shared", actions: [{ type: "heal", amount: 100, player: "self" }] }],
  }));
  const availability: Array<[string, boolean, number]> = [];
  const result = gameTreeSearch(input, {
    generateMainPhaseActions(state: SimulationGameState): AIAction[] {
      const legal = canUseSimOncePerTurn(state, "shared");
      availability.push([state.bot.id, legal, state.bot.lp]);
      return [legal ? monsterEffect : idle];
    },
    simulateMainPhaseAction: applyGenericSimulatedMainPhaseAction,
  }, input.bot, 4);
  assert.deepEqual(availability, [["bot", true, 8000], ["player", true, 8000], ["bot", false, 8100], ["player", false, 8100]]);
  assert.equal(result.score, 0);
  assert.equal(input._simOncePerTurn, undefined);
});

test("GameTree restores actor-local sets, flags and physical-id ledgers without sibling aliases", () => {
  const input = simulationState({ _dragonSimOnce: { bot: { prior: true } }, _simMaterialEffectActivationsByMaterialId: { bot: { 42: 1 } } });
  const availability: Array<[string, boolean]> = [];
  const result = gameTreeSearch(input, {
    generateMainPhaseActions(state: SimulationGameState): AIAction[] {
      availability.push([state.bot.id, !state._simArcanistApprenticeSearchUsed]);
      assert.deepEqual(state._dragonSimOnce, { bot: { prior: true } });
      assert.deepEqual(state._simMaterialEffectActivationsByMaterialId, { bot: { 42: 1 } });
      return [idle];
    },
    simulateMainPhaseAction(state: SimulationGameState) {
      if (useSimOpt(state, "shared", "_simArcanistOptUsed")) state.bot.lp += 100;
      state._simArcanistApprenticeSearchUsed = true;
    },
  }, input.bot, 4);
  assert.deepEqual(availability, [["bot", true], ["player", true], ["bot", false], ["player", false]]);
  assert.equal(result.score, 0);
  assert.equal(input._simArcanistApprenticeSearchUsed, undefined);
});

test("GameTree equipment removal updates only its cloned host and keeps sibling links intact", () => {
  const host = simulationCard({ instanceId: 1, name: "Host", cardKind: "monster", atk: 1500,
    effects: [{ id: "unequip", timing: "ignition", activationZones: ["field"], actions: [{ type: "move", to: "graveyard", targetScope: { owner: "self", zone: "spellTrap" } }] }],
  });
  const equip = simulationCard({ instanceId: 2, name: "Equip", cardKind: "spell", subtype: "equip", equipAtkBonus: 500 });
  host.equips = [equip]; equip.equippedTo = host; equip.equipTarget = host;
  const input = simulationState({ bot: { field: [host], spellTrap: [equip] } });
  const branches: number[] = [];
  const result = gameTreeSearch(input, {
    generateMainPhaseActions(state: SimulationGameState): AIAction[] {
      if (state.bot.id === "bot") return [monsterEffect, idle];
      const clonedHost = required(state.player.field[0]);
      branches.push(required(clonedHost.atk));
      if (state.player.spellTrap.length) {
        const clonedEquip = required(state.player.spellTrap[0]);
        assert.equal(clonedEquip.equippedTo, clonedHost);
        assert.equal(clonedHost.equips?.[0], clonedEquip);
        assert.notEqual(clonedEquip, equip);
      } else {
        assert.deepEqual(clonedHost.equips, []);
        assert.equal(state.player.graveyard[0]?.equippedTo, null);
      }
      return [idle];
    },
    simulateMainPhaseAction: applyGenericSimulatedMainPhaseAction,
  }, input.bot, 2);
  assert.deepEqual(branches, [1000, 1500]);
  assert.equal(result.action, idle);
  assert.equal(host.atk, 1500);
  assert.equal(host.equips[0], equip);
  assert.equal(equip.equippedTo, host);
});

test("GameTree keeps restrictions and additional Normal Summon permission for a later ply", () => {
  const recruit = simulationCard({ instanceId: 2, name: "Recruit", cardKind: "monster", level: 4, atk: 1000 });
  const input = simulationState({ bot: { summonCount: 1, hand: [recruit], field: [simulationCard({
    name: "Enabler", cardKind: "monster", atk: 0,
    effects: [{ id: "permission", timing: "ignition", activationZones: ["field"], actions: [
      { type: "grant_additional_normal_summon", count: 1, filters: { cardKind: "monster" } },
      { type: "restrict_special_summons", allowedFilters: { archetype: "Arcanist" }, duration: "turn" },
      { type: "restrict_effect_activations_by_names", names: ["Blocked"], duration: "turn" },
      { type: "forbid_direct_attack_this_turn", player: "self" },
    ] }],
  })] } });
  let calls = 0;
  let summoned = false;
  const result = gameTreeSearch(input, {
    generateMainPhaseActions(state: SimulationGameState): AIAction[] {
      calls++;
      if (calls === 1) return [monsterEffect];
      if (calls === 2) return [idle];
      assert.equal(state.bot.specialSummonRestrictions?.length, 1);
      assert.deepEqual(state.bot.effectActivationRestrictions?.[0]?.blockedNames, ["Blocked"]);
      assert.equal(state.bot.forbidDirectAttacksThisTurn, true);
      assert.equal(canUseNormalSummonForCard(state.bot, required(state.bot.hand[0])), true);
      return [{ type: "summon", index: 0, cardName: "Recruit" }];
    },
    simulateMainPhaseAction(state: SimulationGameState, action: AIAction) {
      applyGenericSimulatedMainPhaseAction(state, action);
      if (action.type === "summon") {
        summoned = state.bot.field.some(card => card.name === "Recruit");
        assert.equal(state.bot.normalSummonsThisTurn?.length, 1);
      }
    },
  }, input.bot, 3);
  assert.equal(result.error, undefined);
  assert.equal(summoned, true);
  assert.equal(input.bot.additionalNormalSummonPermissions, undefined);
  assert.equal(input.bot.field.length, 1);
});

test("GameTree preserves unsupported declarative action diagnostics into descendants", () => {
  const input = simulationState({ bot: { field: [simulationCard({
    name: "Unsupported", cardKind: "monster", atk: 0,
    effects: [{ id: "unsupported", timing: "ignition", activationZones: ["field"], actions: [{ type: "heal_from_destroyed_atk", fraction: 0.5 }] }],
  })] } });
  const { after, result } = observeAction(input, monsterEffect);
  assert.deepEqual(Reflect.get(after, "_simUnsupportedActions"), ["heal_from_destroyed_atk"]);
  assert.equal(result.score, 0);
  assert.equal(input._simUnsupportedActions, undefined);
});

test("GameTree isolates nested counters, timed buffs and stored blueprints in each branch", () => {
  const host = simulationCard({ name: "Host", cardKind: "monster", atk: 0,
    counters: new Map([["charge", 1]]),
    turnBasedBuffs: [{ id: "buff", stat: "atk", value: 100, expiresOnTurn: 5 }],
    state: { blueprintStorage: { storedBlueprints: [] } },
  });
  const input = simulationState({ bot: { field: [host] } });
  const observed: number[] = [];
  const result = gameTreeSearch(input, {
    generateMainPhaseActions(state: SimulationGameState): AIAction[] {
      if (state.bot.id === "bot") return [monsterEffect, idle];
      observed.push(required(required(state.player.field[0]).counters?.get("charge")));
      return [idle];
    },
    simulateMainPhaseAction(state: SimulationGameState, action: AIAction) {
      const copy = required((state.bot.id === "bot" ? state.bot : state.player).field[0]);
      if (action.type !== "monsterEffect") return;
      copy.counters?.set("charge", 7);
      required(copy.turnBasedBuffs?.[0]).expiresOnTurn = 20;
      required(copy.state?.blueprintStorage).storedBlueprints.push({
        blueprintId: "captured", shortRulesText: "draw", _simStoredByGrimoire: true,
        effectSnapshot: { id: "draw", timing: "on_play", actions: [{ type: "draw", amount: 1 }] },
      });
    },
  }, input.bot, 2);
  assert.equal(result.error, undefined);
  assert.deepEqual(observed, [7, 1]);
  assert.equal(host.counters?.get("charge"), 1);
  assert.equal(host.turnBasedBuffs?.[0]?.expiresOnTurn, 5);
  assert.deepEqual(host.state?.blueprintStorage?.storedBlueprints, []);
});

test("GameTree identity includes inactive actor resources but excludes their diagnostic histories", () => {
  const input = simulationState({ _gameTreeActors: { player: { _simArcanistOptUsed: new Set(["shared"]) } } });
  const before = fingerprintPlanningState(input);
  required(input._gameTreeActors?.player?._simArcanistOptUsed).add("another");
  assert.notEqual(fingerprintPlanningState(input), before);
  const actor = required(input._gameTreeActors?.player);
  actor._simLuminarch = { pureKnightDiscountAvailable: true, milestones: ["first"] };
  const resources = fingerprintPlanningState(input);
  actor._simLuminarch.milestones?.push("diagnostic only");
  assert.equal(fingerprintPlanningState(input), resources);
  actor._simLuminarch.pureKnightDiscountAvailable = false;
  assert.notEqual(fingerprintPlanningState(input), resources);
});

test("GameTree never fills missing resources from the external live reference", () => {
  const input = simulationState();
  Object.defineProperty(input, "_gameRef", { value: new Proxy({}, { get() { assert.fail("live lookup"); } }) });
  let calls = 0;
  const result = gameTreeSearch(input, {
    generateMainPhaseActions(state: SimulationGameState): AIAction[] {
      assert.equal(state._gameRef, undefined);
      assert.deepEqual(state.bot.deck, []);
      return [idle];
    },
    simulateMainPhaseAction(state: SimulationGameState) {
      calls++;
      assert.equal(state._gameRef, undefined);
      assert.equal(Reflect.get(state, "materialDuelStats"), undefined);
    },
  }, input.bot, 2);
  assert.equal(result.error, undefined);
  assert.equal(calls, 2);
});

test("GameTree retains its currentPlayer/opponent input aliases", () => {
  const players = simulationState();
  const input = { currentPlayer: players.bot, opponent: players.player, turn: "bot", phase: "main1", turnCounter: 1 };
  let opponent: string | undefined;
  const result = gameTreeSearch(input, {
    generateMainPhaseActions(state: AiStateInput): AIAction[] {
      opponent = state.player?.id;
      return [idle];
    },
    simulateMainPhaseAction: () => undefined,
  }, players.bot, 1);
  assert.equal(opponent, "player");
  assert.equal(result.score, 0);
});

test("GameTree equipment graph copies only planning data, even on linked cards outside zones", () => {
  const host = simulationCard({ name: "Host", cardKind: "monster", atk: 1000 });
  const equip = simulationCard({ name: "Equip", cardKind: "spell", subtype: "equip" });
  host.equips = [equip]; equip.equippedTo = host;
  Object.defineProperty(equip, "ui", { enumerable: true, get() { assert.fail("equipment UI read"); } });
  const input = simulationState({ bot: { field: [host] } });
  let calls = 0;
  const result = gameTreeSearch(input, {
    generateMainPhaseActions: (): AIAction[] => [idle],
    simulateMainPhaseAction(state: SimulationGameState) {
      calls++;
      const clonedHost = required(state.bot.field[0]);
      const clonedEquip = required(clonedHost.equips?.[0]);
      assert.equal(clonedEquip.equippedTo, clonedHost);
      assert.equal(Object.hasOwn(clonedEquip, "ui"), false);
    },
  }, input.bot, 1);
  assert.equal(result.error, undefined);
  assert.equal(calls, 1);
});
