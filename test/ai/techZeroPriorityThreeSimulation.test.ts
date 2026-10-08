import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { selectSimulatedTargets } from "../../src/core/ai/common/targetSelection.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { clearSimulatedDamageCalculationBuffs, clearSimulatedEndOfDamageStepBuffs } from "../../src/core/ai/common/simulatedActions/stats.js";
import { areRequiredContextualReferencesValid, captureSimulatedReferences, type SimulatedActionOptions } from "../../src/core/ai/common/simulatedActions/shared.js";
import { evaluateTechZeroVisibleBattle } from "../../src/core/ai/techzero/battle.js";
import { buildTechZeroActivationContext } from "../../src/core/ai/techzero/priorities.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

for (const seat of ["player", "bot"] as const) for (const direction of ["attack", "defense"] as const) {
  const setup = () => {
    const other = seat === "player" ? "bot" : "player";
    const ghost = simulationCard(new Card(cardDefinition(511), seat));
    const opponent = simulationCard(new Card(cardDefinition(501), other));
    ghost.position = opponent.position = "attack"; opponent.effects = [];
    opponent.lastSummonMethod = "special"; opponent.atk = 2000;
    const state = simulationState({ turn: seat, turnCounter: 4, phase: "battle", _isPerspectiveState: true,
      bot: { id: seat, field: [ghost] }, player: { id: other, field: [opponent] } });
    const effect = required(ghost.effects?.find(entry => entry.id === `tech_zero_ghost_samurai_${direction === "attack" ? "attack" : "defend"}_special_summoned_boost`));
    const actionContext = { attacker: direction === "attack" ? ghost : opponent, defender: direction === "attack" ? opponent : ghost };
    const options: SimulatedActionOptions = { sourceCard: ghost, effect, actionContext };
    const selections = selectSimulatedTargets({ effect, targets: effect.targets || [], actions: effect.actions || [], state, sourceCard: ghost, options });
    return { state, ghost, opponent, effect, options, selections };
  };
  test(`P3 Ghost references the exact Special Summoned battle opponent without targeting (${seat}/${direction})`, () => {
    const { state, ghost, opponent, effect, selections, options } = setup();
    const reference = required(effect.targets?.[0]);
    assert.equal(reference.intent, "reference");
    assert.equal(reference.targetFromContext, direction === "attack" ? "defender" : "attacker");
    assert.deepEqual(selections[reference.id], [opponent]);
    assert.ok(effect.actions?.every(action => action.type !== "buff_stats_temp" || action.duration === "end_of_damage_step"));
    options.referenceSnapshots = captureSimulatedReferences(effect, selections, state.bot, state.player);
    assert.equal(areRequiredContextualReferencesValid(options, state.bot, state.player), true);
    assert.equal(ghost.atk, 1900, "reference validation does not apply a combat effect");
  });
  test(`P3 Ghost rejects a changed battle-opponent presence without substituting another copy (${seat}/${direction})`, () => {
    const { state, ghost, opponent, effect, selections, options } = setup();
    options.referenceSnapshots = captureSimulatedReferences(effect, selections, state.bot, state.player);
    opponent.locationVersion = (opponent.locationVersion || 0) + 2;
    const replacement = simulationCard(new Card(cardDefinition(501), state.player.id));
    replacement.lastSummonMethod = "special";
    state.player.field.push(replacement);
    const selected = selectSimulatedTargets({ effect, targets: effect.targets || [], actions: effect.actions || [], state, sourceCard: ghost, options });
    assert.deepEqual(selected[required(effect.targets?.[0]).id], []);
    assert.equal(areRequiredContextualReferencesValid(options, state.bot, state.player), false);
  });
  test(`P3 Ghost revalidates the Special Summon filter of its contextual reference (${seat}/${direction})`, () => {
    const { state, opponent, effect, selections, options } = setup();
    options.referenceSnapshots = captureSimulatedReferences(effect, selections, state.bot, state.player);
    opponent.lastSummonMethod = "normal";
    assert.equal(areRequiredContextualReferencesValid(options, state.bot, state.player), false);
  });
  test(`P3 Ghost preserves an explicitly empty reference despite an eligible context (${seat}/${direction})`, () => {
    const { state, ghost, effect, options } = setup();
    const reference = required(effect.targets?.[0]);
    options.referenceSnapshots = captureSimulatedReferences(effect, { [reference.id]: [] }, state.bot, state.player);
    const selected = selectSimulatedTargets({ effect, targets: effect.targets || [], actions: effect.actions || [], state, sourceCard: ghost, options });
    assert.deepEqual(selected[reference.id], []);
    assert.equal(areRequiredContextualReferencesValid(options, state.bot, state.player), false);
    assert.equal(applySimulatedActions({ actions: effect.actions || [], selections: selected, state, options }), false);
    assert.equal(ghost.atk, 1900);
    assert.deepEqual(state._simUnsupportedActions || [], [], "preflight stops before projecting the buff");
  });
  test(`P3 Ghost never replaces its Normal Summoned battle participant with a Special Summoned bystander (${seat}/${direction})`, () => {
    const { state, ghost, opponent, effect, options } = setup();
    opponent.lastSummonMethod = "normal";
    const bystander = simulationCard(new Card(cardDefinition(501), state.player.id));
    bystander.lastSummonMethod = "special";
    state.player.field.push(bystander);
    const selected = selectSimulatedTargets({ effect, targets: effect.targets || [], actions: effect.actions || [], state, sourceCard: ghost, options });
    assert.deepEqual(selected[required(effect.targets?.[0]).id], []);
    options.referenceSnapshots = captureSimulatedReferences(effect, selected, state.bot, state.player);
    assert.equal(areRequiredContextualReferencesValid(options, state.bot, state.player), false);
  });
  for (const change of ["face-down", "control"] as const) {
    test(`P3 Ghost invalidates its exact reference after ${change} changes (${seat}/${direction})`, () => {
      const { state, ghost, opponent, effect, selections, options } = setup();
      options.referenceSnapshots = captureSimulatedReferences(effect, selections, state.bot, state.player);
      if (change === "face-down") opponent.isFacedown = true;
      else opponent.controller = state.bot.id;
      const selected = selectSimulatedTargets({ effect, targets: effect.targets || [], actions: effect.actions || [], state, sourceCard: ghost, options });
      assert.deepEqual(selected[required(effect.targets?.[0]).id], []);
      assert.equal(areRequiredContextualReferencesValid(options, state.bot, state.player), false);
      assert.equal(applySimulatedActions({ actions: effect.actions || [], selections: selected, state, options }), false);
      assert.equal(ghost.atk, 1900);
    });
  }
  test(`P3 battle-duration buffs are tracked and expire at their Damage Step boundary (${seat}/${direction})`, () => {
    for (const duration of ["end_of_damage_step", "damage_calculation"] as const) {
      const { state, ghost, effect, selections, options } = setup();
      const action = required(effect.actions?.find(entry => entry.type === "buff_stats_temp"));
      assert.equal(action.type, "buff_stats_temp");
      if (action.type !== "buff_stats_temp") return;
      assert.equal(applySimulatedActions({ actions: [{ ...action, duration }], selections, state, options }), true);
      assert.equal(ghost.atk, 2400);
      assert.deepEqual(state._simUnsupportedActions || [], []);
      const tracked = duration === "damage_calculation" ? state.damageCalculationTempBuffs : state.endOfDamageStepTempBuffs;
      const otherBoundary = duration === "damage_calculation" ? state.endOfDamageStepTempBuffs : state.damageCalculationTempBuffs;
      assert.equal(tracked?.length, 1);
      assert.equal(tracked?.[0]?.card, ghost);
      assert.equal(otherBoundary?.length ?? 0, 0, "the buff is tracked only at its own Damage Step boundary");
      if (duration === "damage_calculation") clearSimulatedDamageCalculationBuffs(state);
      else clearSimulatedEndOfDamageStepBuffs(state);
      assert.equal(ghost.atk, 1900);
    }
  });
}

test("P3 Ghost battle projection preserves its conservative uncertainty boundary", () => {
  const attacker = simulationCard(new Card(cardDefinition(516), "bot"));
  const ghost = simulationCard(new Card(cardDefinition(511), "player"));
  attacker.atk = 2000; attacker.position = ghost.position = "attack"; attacker.lastSummonMethod = "synchro";
  const state = simulationState({ turn: "bot", turnCounter: 4, phase: "battle", bot: { field: [attacker] }, player: { lp: 100, field: [ghost] } });
  const projection = evaluateTechZeroVisibleBattle(state.bot, state.player, 4);
  assert.equal(projection.lethal, false);
  assert.ok(projection.uncertainties.includes("battle_triggers"));
  assert.equal(ghost.atk, 1900);
});

test("P3 Ghost projects a direct attack without participant-only trigger uncertainty", () => {
  const ghost = simulationCard(new Card(cardDefinition(511), "bot"));
  ghost.position = "attack";
  const state = simulationState({ turn: "bot", turnCounter: 4, phase: "battle",
    bot: { field: [ghost] }, player: { lp: 1900, field: [], hand: [] } });
  const projection = evaluateTechZeroVisibleBattle(state.bot, state.player, 4);
  assert.equal(projection.damage, 1900);
  assert.equal(projection.lethal, true);
  assert.equal(projection.uncertainties.includes("battle_triggers"), false);
  assert.deepEqual(projection.attacks, [{ attackerInstanceId: required(ghost.instanceId), targetInstanceId: null }]);
  assert.equal(ghost.atk, 1900, "the direct attack projection neither applies nor anticipates a participant-only bonus");
});

for (const seat of ["player", "bot"] as const) {
  test(`P3 Ghost's legitimate Synchro recovery still declares and moves its exact tuner (${seat})`, () => {
    const other = seat === "player" ? "bot" : "player";
    const ghost = simulationCard(new Card(cardDefinition(511), seat));
    const core = simulationCard(new Card(cardDefinition(501), seat));
    const state = simulationState({ turn: seat, turnCounter: 4, phase: "main1", _isPerspectiveState: true,
      bot: { id: seat, field: [ghost], graveyard: [core] }, player: { id: other } });
    const effect = required(ghost.effects?.find(entry => entry.id === "tech_zero_ghost_samurai_synchro_recover_tuner"));
    assert.notEqual(required(effect.targets?.[0]).intent, "reference");
    assert.equal(required(effect.targets?.[0]).targetFromContext, undefined);
    const activationContext = buildTechZeroActivationContext(ghost, effect, { player: state.bot, opponent: state.player });
    const options: SimulatedActionOptions = { sourceCard: ghost, effect, activationContext: { decisions: required(activationContext.decisions) } };
    const selections = selectSimulatedTargets({ effect, targets: effect.targets || [], actions: effect.actions || [], state, sourceCard: ghost, options });
    assert.deepEqual(selections.tech_zero_ghost_samurai_tuner_target, [core]);
    assert.equal(applySimulatedActions({ actions: effect.actions || [], selections, state, options }), true);
    assert.deepEqual(state.bot.hand, [core]);
    assert.deepEqual(state.bot.graveyard, []);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });
}
