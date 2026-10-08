import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { moveCardToZone, refreshSimulatedFieldAuras } from "../../src/core/ai/common/zones.js";
import { applyLuminarchSimulatedBattleRewards } from "../../src/core/ai/luminarch/simulation.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

for (const actor of ["bot", "player"] as const) for (const kind of ["aurora", "marshal", "converted_damage"] as const) {
  test(`Luminarch battle LP adapter pays one factual heal and counter (${actor}, ${kind})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, disableChains: false });
    t.after(() => game.dispose("architecture_luminarch_battle_lp"));
    game.turn = actor; game.phase = "battle"; game.battleStep = "battle"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.ui.showChainResponseModal = async () => null;
    const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
    owner.controllerType = opponent.controllerType = "ai";
    owner.lp = 5000;
    const attacker = required(game.createCardForOwner(kind === "aurora" ? 159 : kind === "marshal" ? 155 : 151, owner));
    if (kind === "marshal") {
      // This reward requires an actual destruction after the once-per-turn
      // protection has already been consumed; keep the real card rule.
      attacker.battleIndestructibleOncePerTurnUsed = true;
      attacker.battleIndestructibleOncePerTurnLastUsedTurn = game.turnCounter;
    }
    const barbarias = required(game.createCardForOwner(171, owner));
    const blade = required(game.createCardForOwner(166, owner));
    const enemy = new Card({ ...cardDefinition(1), effects: [], atk: kind === "aurora" ? 500 : 2600, def: 500 }, opponent.id);
    placeFieldCards(owner.field, attacker, barbarias);
    placeFieldCards(opponent.field, enemy);
    placeFieldCards(owner.spellTrap, blade);
    await game.effectEngine.applyEquip({ type: "equip", targetRef: "host" },
      { source: blade, player: owner, opponent }, { host: [barbarias] });
    owner.updatePassiveEffects();
    const { state } = createGameTreeCopy(game, owner);
    const simAttacker = required(state.bot.field.find(card => card.instanceId === attacker.instanceId));
    const simHost = required(state.bot.field.find(card => card.instanceId === barbarias.instanceId));
    const simBlade = required(state.bot.spellTrap.find(card => card.instanceId === blade.instanceId));
    const simEnemy = required(state.player.field.find(card => card.instanceId === enemy.instanceId));
    if (kind === "converted_damage") {
      // The battle bridge has already applied a base receipt. This isolates
      // its LP conversion boundary from attack choice and damage calculation.
      await game.effectEngine.applyActions([{ type: "heal", amount: 400 }], { player: owner, opponent, source: attacker }, {});
      state.bot.lp += 400;
      const summary = { attackerName: attacker.name, lpGains: [{ playerId: state.bot.id, amount: 400,
        sourceName: attacker.name, reason: "battle_damage_heal" }] };
      applyLuminarchSimulatedBattleRewards({ state, battlePlan: { attackerCard: simAttacker }, summary });
      const after = state.bot.lp;
      applyLuminarchSimulatedBattleRewards({ state, battlePlan: { attackerCard: simAttacker }, summary });
      assert.equal(state.bot.lp, after, "the same base receipt cannot heal twice");
    } else {
      await game.resolveCombat(attacker, enemy);
      assert.ok((kind === "aurora" ? opponent : owner).graveyard.includes(kind === "aurora" ? enemy : attacker),
        "runtime must destroy the card before the reward adapter is exercised");
      const destroyed = kind === "aurora" ? simEnemy : simAttacker;
      if (kind === "aurora") state.player.lp -= required(simAttacker.atk) - required(simEnemy.atk);
      else state.bot.lp -= required(simEnemy.atk) - required(simAttacker.atk);
      moveCardToZone(kind === "aurora" ? state.player : state.bot, destroyed, "graveyard", undefined, { state });
      applyLuminarchSimulatedBattleRewards({ state, battlePlan: { attackerCard: simAttacker }, summary: {
        attackerName: attacker.name, destroyedCards: [{ card: destroyed, owner: kind === "aurora" ? "opponent" : "self",
          name: destroyed.name || "", cardKind: "monster", baseAtk: required(destroyed.baseAtk) }],
      } });
    }
    assert.equal(state.bot.lp, owner.lp);
    assert.equal(state.player.lp, opponent.lp);
    assert.equal(blade.getCounter("solar"), 1);
    assert.equal(simBlade.counters?.get("solar"), 1);
    for (let repeat = 0; repeat < 3; repeat++) refreshSimulatedFieldAuras(state);
    assert.deepEqual([simHost.atk, simHost.def], [barbarias.atk, barbarias.def], "a later main-phase refresh never adds the counter buff twice");
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });
}

test("battle LP follows player reference in a rotated owner view", () => {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
  try {
    const physicalOwner = game.player;
    physicalOwner.lp = game.bot.lp = 5000;
    const attacker = required(game.createCardForOwner(159, physicalOwner));
    placeFieldCards(physicalOwner.field, attacker);
    const { state } = createGameTreeCopy(game);
    const rotated = { ...state, bot: state.player, player: state.bot };
    const simAttacker = required(rotated.bot.field.find(card => card.instanceId === attacker.instanceId));
    assert.equal(rotated.bot.id, "player", "physical ID differs from the perspective slot");
    applyLuminarchSimulatedBattleRewards({ state: rotated, battlePlan: { attackerCard: simAttacker }, summary: {
      attackerName: attacker.name, destroyedCards: [{ owner: "opponent", cardKind: "monster", name: "Destroyed", baseAtk: 1000 }],
    } });
    assert.equal(rotated.bot.lp, 5500);
    assert.equal(rotated.player.lp, 5000);
  } finally { game.dispose("architecture_luminarch_rotated_battle"); }
});
