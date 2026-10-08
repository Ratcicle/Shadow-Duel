import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { addEffectNegation } from "../../src/core/effects/negation.js";
import DragonStrategy from "../../src/core/ai/DragonStrategy.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { moveCardToZone } from "../../src/core/ai/common/zones.js";
import { canUseSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { applyDragonRetentionPriorities, applyDragonSimulatedBattleRewards, type DragonPlanningAction } from "../../src/core/ai/dragon/linePlanning.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

for (const actor of ["bot", "player"] as const) {
  for (const count of [2, 3] as const) test(`Dragon Rainbow retention reads declared material history (${actor}, ${count})`, t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
    t.after(() => game.dispose("architecture_dragon_history"));
    const owner = game[actor];
    const material = required(game.createCardForOwner(264, owner));
    const rainbow = required(game.createCardForOwner(267, owner));
    owner.extraDeck.push(rainbow);
    game.materialDuelStats[owner.id].effectActivationsByMaterialId.set(264, count);
    // An unrelated old material ID must never unlock this Ascension.
    game.materialDuelStats[owner.id].effectActivationsByMaterialId.set(29, 3);
    const runtime = game.checkAscensionRequirements(owner, rainbow, material).ok;
    const action = required(applyDragonRetentionPriorities<DragonPlanningAction>([{ type: "monsterEffect", card: material, priority: 5 }],
      { game, bot: owner, opponent: game[actor === "bot" ? "player" : "bot"] })[0]);
    assert.equal(action.dragonRetentionReasons?.includes("purified_unlocks_rainbow"), runtime);
  });

  for (const kind of ["purified", "purified_negated", "purified_exhausted", "purified_vs_rainbow", "rainbow", "rainbow_negated", "jagged", "jagged_negated", "jagged_renamed", "jagged_non_dragon"] as const) {
    test(`Dragon declarative battle reward matches runtime (${actor}, ${kind})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, disableChains: false });
      t.after(() => game.dispose("architecture_dragon_battle_reward"));
      game.turn = actor; game.phase = "battle"; game.battleStep = "battle"; game.turnCounter = 4;
      game.disablePresentationDelays = true;
      game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
      game.ui.showChainResponseModal = async () => null;
      const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
      owner.controllerType = opponent.controllerType = "ai"; owner.lp = opponent.lp = 5000;
      const attacker = required(game.createCardForOwner(kind.startsWith("purified") ? 264 : kind.startsWith("rainbow") ? 267 : 251, owner));
      const enemy = new Card(kind === "purified_vs_rainbow" ? { ...cardDefinition(267), atk: 500, def: 500, level: 4 } :
        { ...cardDefinition(1), effects: [], atk: 500, def: 500, level: 4 }, opponent.id);
      enemy.atk = 700; // Rainbow uses original ATK, not current ATK.
      placeFieldCards(owner.field, attacker); placeFieldCards(opponent.field, enemy);
      if (kind.startsWith("jagged")) owner.fieldSpell = required(game.createCardForOwner(262, owner));
      if (kind === "jagged_renamed") required(owner.fieldSpell).name = "Declarative field reward";
      if (kind === "jagged_non_dragon") attacker.type = "Warrior";
      if (kind.endsWith("negated")) addEffectNegation(kind.startsWith("jagged") ? required(owner.fieldSpell) : attacker, "while_faceup");
      if (kind === "purified_exhausted") game.markOncePerTurnUsed(attacker, owner, required(attacker.effects.find(e => e.id === "purified_crystal_heal_on_destroy")));
      owner.updatePassiveEffects();
      const { state: cloned } = createGameTreeCopy(game, owner);
      const { _gameRef: _liveGame, ...state } = cloned;
      const simAttacker = required(state.bot.field.find(c => c.instanceId === attacker.instanceId));
      const simEnemy = required(state.player.field.find(c => c.instanceId === enemy.instanceId));
      await game.resolveCombat(attacker, enemy);
      assert.ok(opponent.graveyard.includes(enemy), "runtime must actually destroy the physical target");
      state.player.lp -= required(simAttacker.atk) - required(simEnemy.atk);
      moveCardToZone(state.player, simEnemy, "graveyard", undefined, { state });
      const rewards = applyDragonSimulatedBattleRewards({ state, target: simEnemy, battlePlan: { attackerCard: simAttacker, targetIndex: 0 }, summary: {
        destroyedCards: [{ ...simEnemy, card: simEnemy, destroyedBy: "battle", owner: "opponent" }],
      } });
      if (kind === "purified_vs_rainbow") assert.deepEqual(rewards, ["Purified battle heal"], "an opponent's unactivated effect never names the own reward");
      assert.equal(state.bot.lp, owner.lp);
      assert.equal(state.player.lp, opponent.lp);
      assert.equal(state.bot.fieldSpell?.counters?.get("dragon_peak") || 0, owner.fieldSpell?.getCounter("dragon_peak") || 0);
      assert.equal(state.materialDuelStats?.[state.bot.id === "player" ? "player" : "bot"].effectActivationsByMaterialId.get(264) || 0,
        game.materialDuelStats[owner.id].effectActivationsByMaterialId.get(264) || 0);
      if (kind.startsWith("purified")) {
        const effect = required(attacker.effects.find(e => e.id === "purified_crystal_heal_on_destroy"));
        assert.equal(canUseSimulatedEffectUsage(state, effect, simAttacker, state.bot.id, true),
          game.canUseOncePerTurn(attacker, owner, effect).ok, "negated activation still consumes its declared hard OPT");
      }
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }

  for (const kind of ["attacker", "defender", "direct", "negated", "lethal", "losing", "cancelled"] as const) test(`Dragon Volcanic declaration precedes combat (${actor}, ${kind})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, disableChains: false });
    t.after(() => game.dispose("architecture_dragon_attack_declaration"));
    game.turn = actor; game.phase = "battle"; game.battleStep = "battle"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.ui.showChainResponseModal = async () => null;
    const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
    owner.controllerType = opponent.controllerType = "ai"; owner.lp = 5000; opponent.lp = kind === "lethal" ? 500 : 5000;
    const volcanic = required(game.createCardForOwner(271, kind === "defender" ? opponent : owner));
    const ordinary = new Card({ ...cardDefinition(1), effects: [], atk: kind === "losing" ? 3500 : 500, def: 500 }, kind === "defender" ? owner.id : opponent.id);
    const attacker = kind === "defender" ? ordinary : volcanic;
    const target = kind === "direct" ? null : kind === "defender" ? volcanic : ordinary;
    placeFieldCards(owner.field, attacker); if (target) placeFieldCards(opponent.field, target);
    if (kind === "losing") placeFieldCards(owner.field, required(game.createCardForOwner(251, owner)));
    if (kind === "negated") addEffectNegation(volcanic, "while_faceup");
    owner.updatePassiveEffects(); opponent.updatePassiveEffects();
    const { state: cloned } = createGameTreeCopy(game, owner);
    const { _gameRef: _liveGame, ...state } = cloned;
    const simAttacker = required(state.bot.field[0]), simTarget = state.player.field[0] || null;
    let declaredLp: [number, number] | undefined;
    const createDamageStep = game.createDamageStepTransaction;
    // Trigger publication can be deferred until the response window closes.
    // This boundary records the LP after that window and before battle damage.
    game.createDamageStepTransaction = function(input) {
      declaredLp = [owner.lp, opponent.lp];
      return createDamageStep.call(this, input);
    };
    if (kind === "cancelled") game.on("attack_declared", () => { game.lastAttackNegated = true; });
    await game.resolveCombat(attacker, target);
    if (kind === "cancelled") {
      assert.ok(opponent.field.includes(ordinary), "a negated attack keeps its physical target on the board");
      declaredLp = [owner.lp, opponent.lp];
    } else assert.ok(declaredLp, "runtime must reach the damage-step boundary");
    const strategy = new DragonStrategy(game.bot);
    const prepare: unknown = Reflect.get(strategy, "prepareSimulatedBattle");
    assert.equal(typeof prepare, "function", "Dragon exposes a declaration hook before combat");
    Reflect.apply(prepare as (...args: unknown[]) => unknown, strategy, [{ state, bot: state.bot, opponent: state.player,
      attacker: simAttacker, target: simTarget, battlePlan: { attackerCard: simAttacker, attackerIndex: 0, targetIndex: simTarget ? 0 : null } }]);
    assert.deepEqual([state.bot.lp, state.player.lp], declaredLp);
    const projectedVolcanicOwner = kind === "defender" ? state.player : state.bot;
    const runtimeVolcanicOwner = kind === "defender" ? opponent : owner;
    assert.equal(state.materialDuelStats?.[projectedVolcanicOwner.id === "player" ? "player" : "bot"].effectActivationsByMaterialId.get(271) || 0,
      game.materialDuelStats[runtimeVolcanicOwner.id].effectActivationsByMaterialId.get(271) || 0,
      "a published trigger records activation even when its effect is negated");
    if (kind === "losing") {
      assert.ok(owner.graveyard.includes(volcanic), `runtime must remove the attacker after declaration damage: ${JSON.stringify({ attackerAtk: volcanic.atk, targetAtk: ordinary.atk, position: ordinary.position, protection: volcanic.battleIndestructible })}`);
      state.bot.lp -= required(simTarget?.atk) - required(simAttacker.atk);
      moveCardToZone(state.bot, simAttacker, "graveyard", undefined, { state });
      const summary = { damage: -(required(simTarget?.atk) - required(simAttacker.atk)), destroyedCards: [
        { ...simAttacker, card: simAttacker, owner: "self", destroyedBy: "battle" },
      ] };
      applyDragonSimulatedBattleRewards({ state, battlePlan: { attackerCard: simAttacker }, summary });
      assert.deepEqual([state.bot.lp, state.player.lp], [owner.lp, opponent.lp], "post-combat rewards never pay declaration damage again");
      assert.equal(summary.damage, -300, "battle metadata includes the factual declaration delta once");
      applyDragonSimulatedBattleRewards({ state, battlePlan: { attackerCard: simAttacker }, summary: { damage: summary.damage } });
      assert.equal(summary.damage, -300);
    }
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  test(`Purified battle HOPT is shared by physical copies (${actor})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, disableChains: false });
    t.after(() => game.dispose("architecture_dragon_battle_hopt"));
    game.turn = actor; game.phase = "battle"; game.battleStep = "battle"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.ui.showChainResponseModal = async () => null;
    const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
    owner.controllerType = opponent.controllerType = "ai"; owner.lp = opponent.lp = 5000;
    const copies = [required(game.createCardForOwner(264, owner)), required(game.createCardForOwner(264, owner))];
    const enemies = copies.map(() => new Card({ ...cardDefinition(1), effects: [], atk: 500, def: 500, level: 4 }, opponent.id));
    placeFieldCards(owner.field, ...copies); placeFieldCards(opponent.field, ...enemies);
    const { state: cloned } = createGameTreeCopy(game, owner);
    const { _gameRef: _liveGame, ...state } = cloned;
    for (let index = 0; index < copies.length; index++) {
      const attacker = required(copies[index]), enemy = required(enemies[index]);
      const simAttacker = required(state.bot.field.find(c => c.instanceId === attacker.instanceId));
      const simEnemy = required(state.player.field.find(c => c.instanceId === enemy.instanceId));
      await game.resolveCombat(attacker, enemy);
      state.player.lp -= required(simAttacker.atk) - required(simEnemy.atk);
      moveCardToZone(state.player, simEnemy, "graveyard", undefined, { state });
      applyDragonSimulatedBattleRewards({ state, battlePlan: { attackerCard: simAttacker }, summary: {
        destroyedCards: [{ ...simEnemy, card: simEnemy, owner: "opponent", destroyedBy: "battle" }],
      } });
      assert.equal(state.bot.lp, owner.lp);
      assert.equal(owner.lp, 5400, "only the first physical copy heals in this turn");
    }
    assert.equal(state.materialDuelStats?.[state.bot.id === "player" ? "player" : "bot"].effectActivationsByMaterialId.get(264), 1);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });
}
