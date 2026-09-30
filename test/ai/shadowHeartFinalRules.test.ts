import assert from "node:assert/strict";
import test from "node:test";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { moveCardToZone } from "../../src/core/ai/common/zones.js";
import { cleanupSimulatedEndTurn } from "../../src/core/ai/common/simulatedActions/lifecycle.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";
import { cardDefinition } from "../helpers/fixtures.js";
import { simulateGenericSpellEffect } from "../../src/core/ai/common/simulation.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { fingerprintPlanningState } from "../../src/core/ai/common/stateFingerprint.js";
import { applyPassiveBuffValue } from "../../src/core/effects/passives/passiveBuffs.js";
import { applyNamedStatChange, expireFaceupStatBuffs } from "../../src/core/effects/actions/stats.js";

for (const actor of ["player", "bot"] as const) {
  for (const declarations of [0, 1]) {
    test(`Rage simulation respects the actor's public attack history (${actor}, ${declarations})`, () => {
      const rage = simulationCard({ ...cardDefinition(112), owner: actor });
      const target = simulationCard({ ...cardDefinition(111), owner: actor });
      const state = simulationState({ phase: "main2", turnCounter: 4, bot: { id: actor, field: [target], hand: [rage], directAttacksDeclaredThisTurn: declarations }, player: { id: actor === "player" ? "bot" : "player" } });
      simulateGenericSpellEffect(state, rage);
      assert.equal(target.atk, 3000 + (declarations ? 0 : 700));
      assert.equal(state.bot.forbidDirectAttacksThisTurn === true, declarations === 0);
    });
  }

  test(`planning clones preserve history and independently own permanent deltas (${actor})`, () => {
    const target = simulationCard({ ...cardDefinition(111), owner: actor, permanentBuffsBySource: { reduction: { atk: -1000 } } });
    const state = simulationState({ bot: { id: actor, field: [target], directAttacksDeclaredThisTurn: 1 }, player: { id: actor === "player" ? "bot" : "player" } });
    const { state: copy } = createGameTreeCopy(state);
    assert.equal(copy.bot.directAttacksDeclaredThisTurn, 1);
    const before = fingerprintPlanningState(copy);
    copy.bot.directAttacksDeclaredThisTurn = 0;
    assert.notEqual(fingerprintPlanningState(copy), before);
    assert.equal(state.bot.directAttacksDeclaredThisTurn, 1);
    const cloneTarget = copy.bot.field[0];
    assert.ok(cloneTarget?.permanentBuffsBySource?.reduction);
    cloneTarget.permanentBuffsBySource.reduction.atk = -500;
    assert.equal(target.permanentBuffsBySource?.reduction?.atk, -1000);
    cleanupSimulatedEndTurn(copy);
    assert.equal(copy.bot.directAttacksDeclaredThisTurn, 0);
  });
  test(`permanent reductions restore their actual delta on simulated exit (${actor})`, () => {
    const source = simulationCard(cardDefinition(103));
    const target = simulationCard({ id: 99971, cardKind: "monster", atk: 600, def: 1000 });
    const state = simulationState({ bot: { id: actor, field: [source] }, player: { id: actor === "player" ? "bot" : "player", field: [target] } });
    applySimulatedActions({ actions: [{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: -1000, permanent: true }], selections: { chosen: [target] }, state, selfId: "bot", options: { sourceCard: source } });
    assert.equal(target.atk, 0);
    moveCardToZone(state.player, target, "hand", state.player, { state });
    assert.equal(target.atk, 600);
  });

  test(`Pursuer simulated modifiers survive turn cleanup and exit independently (${actor})`, () => {
    const source = simulationCard({ ...cardDefinition(123), instanceId: 123 });
    const target = simulationCard({ id: 99971, cardKind: "monster", atk: 2400, def: 2000 });
    const state = simulationState({ bot: { id: actor, field: [source] }, player: { id: actor === "player" ? "bot" : "player", field: [target] } });
    applySimulatedActions({ actions: [{ type: "halve_target_stats_and_gain_removed", targetRef: "chosen", gainTargetRef: "self" }], selections: { chosen: [target] }, state, selfId: "bot", options: { sourceCard: source } });
    assert.equal(source.atk, 4000); assert.equal(target.atk, 1200);
    cleanupSimulatedEndTurn(state);
    assert.equal(source.atk, 4000); assert.equal(target.atk, 1200);
    moveCardToZone(state.bot, source, "graveyard", state.bot, { state });
    assert.equal(source.atk, 2800); assert.equal(target.atk, 1200);
    moveCardToZone(state.player, target, "hand", state.player, { state });
    assert.equal(target.atk, 2400);
  });

  test(`Pursuer simulation does not drain an immune opponent (${actor})`, () => {
    const source = simulationCard({ ...cardDefinition(123), owner: actor });
    const target = simulationCard({ id: 99971, cardKind: "monster", atk: 2400, def: 2000,
      owner: actor === "player" ? "bot" : "player", immuneToOpponentEffectsUntilTurn: 4 });
    const state = simulationState({ turnCounter: 4, bot: { id: actor, field: [source] }, player: { id: actor === "player" ? "bot" : "player", field: [target] } });
    applySimulatedActions({ actions: [{ type: "halve_target_stats_and_gain_removed", targetRef: "chosen", gainTargetRef: "self" }], selections: { chosen: [target] }, state, selfId: "bot", options: { sourceCard: source } });
    assert.equal(target.atk, 2400); assert.equal(source.atk, 2800);
  });

  test(`Purge simulation preserves zero-floor overlap on later departure (${actor})`, () => {
    const source = simulationCard(cardDefinition(103));
    const target = simulationCard({ id: 99971, cardKind: "monster", atk: 600, def: 1000 });
    const state = simulationState({ bot: { id: actor }, player: { id: actor === "player" ? "bot" : "player", field: [target] } });
    applySimulatedActions({ actions: [
      { type: "buff_stats_temp", targetRef: "chosen", atkBoost: 300 },
      { type: "buff_stats_temp", targetRef: "chosen", atkBoost: -1000, permanent: true },
    ], selections: { chosen: [target] }, state, selfId: "bot", options: { sourceCard: source } });
    cleanupSimulatedEndTurn(state);
    assert.equal(target.atk, 0);
    moveCardToZone(state.player, target, "hand", state.player, { state });
    assert.equal(target.atk, 600);
  });

  test(`Pursuer simulation shares Bloomrot's conditional immunity (${actor})`, () => {
    const source = simulationCard({ ...cardDefinition(123), owner: actor });
    const ground = simulationCard({ ...cardDefinition(417), owner: actor });
    const target = simulationCard({ id: 99971, cardKind: "monster", atk: 2400, def: 2000,
      owner: actor === "player" ? "bot" : "player", counters: new Map([["spore", 1]]) });
    const state = simulationState({ bot: { id: actor, field: [source], spellTrap: [ground] }, player: { id: actor === "player" ? "bot" : "player", field: [target] } });
    applySimulatedActions({ actions: [{ type: "halve_target_stats_and_gain_removed", targetRef: "chosen", gainTargetRef: "self" }],
      selections: { chosen: [target] }, state, selfId: "bot", options: { sourceCard: source } });
    assert.equal(target.atk, 2400); assert.equal(source.atk, 2800);
  });

  for (const modifier of ["aura", "while_faceup"] as const) {
    test(`simulated permanent reductions retain cleanup accounting after ${modifier} expires (${actor})`, () => {
      const source = simulationCard(cardDefinition(103));
      const target = simulationCard({ id: 99971, cardKind: "monster", atk: 600, def: 1000 });
      const state = simulationState({ bot: { id: actor }, player: { id: actor === "player" ? "bot" : "player", field: [target] } });
      if (modifier === "aura") applyPassiveBuffValue(target, "valley", 300, ["atk"]);
      else {
        applyNamedStatChange(target, "faceup_bonus", 300);
        const buff = target.permanentBuffsBySource?.faceup_bonus; assert.ok(buff); buff.duration = "while_faceup";
      }
      applySimulatedActions({ actions: [{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: -1000, permanent: true }],
        selections: { chosen: [target] }, state, selfId: "bot", options: { sourceCard: source } });
      if (modifier === "aura") {
        applyPassiveBuffValue(target, "valley", 300, ["atk"]);
        assert.equal(target.atk, 0);
        applyPassiveBuffValue(target, "valley", 0, ["atk"]);
      } else expireFaceupStatBuffs(target);
      assert.equal(target.atk, 0);
      moveCardToZone(state.player, target, "hand", state.player, { state });
      assert.equal(target.atk, 600);
    });
  }

  test(`simulated Equip departure preserves the remaining permanent delta (${actor})`, () => {
    const shield = simulationCard({ ...cardDefinition(113), owner: actor });
    const target = simulationCard({ id: 99971, cardKind: "monster", atk: 600, def: 1000 });
    const state = simulationState({ bot: { id: actor, field: [target], spellTrap: [shield] } });
    applySimulatedActions({ actions: [{ type: "equip", targetRef: "chosen", atkBonus: 500 }],
      selections: { chosen: [target] }, state, selfId: "bot", options: { sourceCard: shield } });
    assert.equal(target.atk, 1100);
    applySimulatedActions({ actions: [{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: -1000, permanent: true }],
      selections: { chosen: [target] }, state, selfId: "bot", options: { sourceCard: simulationCard(cardDefinition(103)) } });
    assert.equal(target.atk, 100);
    moveCardToZone(state.bot, shield, "graveyard", state.bot, { state });
    assert.equal(target.atk, 0);
    moveCardToZone(state.bot, target, "hand", state.bot, { state });
    assert.equal(target.atk, 600);
  });
}
