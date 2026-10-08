import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { cardMatchesFilter } from "../../src/core/ai/common/cardFilters.js";
import { hasActionSummonCapacity, hasActionZoneCandidates } from "../../src/core/ai/common/actionValidation.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { withPlanningExecutionContext } from "../../src/core/ai/common/planningExecution.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { applyGrantVoidFusionImmunity } from "../../src/core/effects/actions/immunity.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

for (const actor of ["bot", "player"] as const) {
  test(`public description remains available to declared text filters (${actor})`, t => {
    const game = createRuntimeGame({ laboratoryMode: true });
    t.after(() => game.dispose());
    const owner = game[actor];
    const card = new Card(cardDefinition(205), actor);
    owner.deck.push(card);
    const state = createGameTreeCopy(game, owner).state;
    const projected = required(state.bot.deck[0]);
    const filter = { textIncludes: "Void Hollow" };
    assert.equal(cardMatchesFilter(card, filter), true);
    assert.equal(projected.description, card.description);
    assert.equal(cardMatchesFilter(projected, filter), true);
    const copy = createPlanningCopy(true);
    const hiddenProjection = { _simUnknownCard: true, instanceId: "opaque" };
    copy.registerCardProjection(card, hiddenProjection);
    const opaque = copy.cloneCardForSim(card);
    assert.equal(cardMatchesFilter(opaque, filter), false);
    assert.equal("description" in opaque, false);
    assert.equal("name" in opaque, false);
    state.bot.deck = [opaque];
    withPlanningExecutionContext(state, () => null, () => {
      assert.equal(cardMatchesFilter(opaque, filter), false);
    });
    assert.equal(state._simRequiresReplan, true, "A hidden text read remains an unresolved planning fact.");
  });

  test(`mandatory summon capacity preserves optional noops and pending cost space (${actor})`, t => {
    const game = createRuntimeGame({ laboratoryMode: true });
    t.after(() => game.dispose());
    const owner = game[actor];
    placeFieldCards(owner.field, ...[202, 201, 201, 201, 203].map(id => new Card(cardDefinition(id), actor)));
    const source = required(owner.field[0]);
    owner.deck.push(new Card(cardDefinition(204), actor));
    const action = { type: "special_summon_from_zone" as const, zone: "deck" as const,
      filters: { name: "Void Hollow" } };
    assert.equal(game.effectEngine.checkActionPreviewRequirements([action], { source, player: owner }).ok, false);
    assert.equal(hasActionZoneCandidates(owner, action, source), false);
    const opponent = game[actor === "bot" ? "player" : "bot"];
    const opposingDestination = { ...action, summonToOwner: "opponent" as const };
    assert.equal(game.effectEngine.checkActionPreviewRequirements([opposingDestination], { source, player: owner, opponent }).ok, true);
    assert.equal(hasActionZoneCandidates(owner, opposingDestination, source), true,
      "A full source field cannot veto a summon to an empty opposing field.");
    assert.equal(hasActionSummonCapacity(owner, opposingDestination, {
      occupiedMonsterZones: 5, fieldSlotsFreedBeforeSummon: 0,
    }), false);
    for (const optional of [{ ...action, optional: true }, { ...action, count: { min: 0, max: 1 } }]) {
      assert.equal(game.effectEngine.checkActionPreviewRequirements([optional], { source, player: owner }).ok, true);
      assert.equal(hasActionZoneCandidates(owner, optional, source), true);
    }
    const allowance = { ...action, fieldSlotsFreedBeforeSummon: 1 };
    assert.equal(game.effectEngine.checkActionPreviewRequirements([allowance], { source, player: owner }).ok, true);
    assert.equal(hasActionZoneCandidates(owner, allowance, source), true);
    const effect = { id: "capacity_cost_control", timing: "ignition" as const, activationZones: ["field" as const],
      activationCosts: [{ type: "move" as const, targetRef: "self", to: "hand" as const }], actions: [action] };
    assert.equal(game.effectEngine.checkActionPreviewRequirements([action], { source, player: owner, effect }).ok, true);
    assert.equal(hasActionSummonCapacity(owner, action, {
      occupiedMonsterZones: 5, fieldSlotsFreedBeforeSummon: 1,
    }), true);
    assert.equal(hasActionSummonCapacity(owner, action, {
      occupiedMonsterZones: 5, fieldSlotsFreedBeforeSummon: 0,
    }), false);
  });

  for (const durationTurns of [undefined, 1]) {
    test(`fusion immunity delegates the runtime action to the exact contextual copy (${actor}/${durationTurns})`, t => {
      const game = createRuntimeGame({ laboratoryMode: true });
      t.after(() => game.dispose());
      game.turnCounter = 3;
      const owner = game[actor];
      const first = new Card(cardDefinition(207), actor);
      const second = new Card(cardDefinition(207), actor);
      placeFieldCards(owner.field, first, second);
      const state = createGameTreeCopy(game, owner).state;
      const projected = required(state.bot.field[1]);
      const sibling = required(state.bot.field[0]);
      const action = { type: "grant_void_fusion_immunity" as const, archetype: "Void",
        ...(durationTurns === undefined ? {} : { durationTurns }) };
      assert.equal(applyGrantVoidFusionImmunity.call({ game, ui: null }, action,
        { player: owner, summonedCard: second }), true);
      assert.equal(applySimulatedActions({ state, actions: [action], options: {
        actionContext: { summonedCard: projected },
      } }), true);
      assert.equal(projected.immuneToOpponentEffectsUntilTurn, second.immuneToOpponentEffectsUntilTurn);
      assert.equal(projected.unaffectedByOpponentCardEffects, second.unaffectedByOpponentCardEffects);
      assert.equal(sibling.immuneToOpponentEffectsUntilTurn, first.immuneToOpponentEffectsUntilTurn);
      assert.equal(sibling.unaffectedByOpponentCardEffects, first.unaffectedByOpponentCardEffects);
      assert.deepEqual(state._simUnsupportedActions ?? [], []);
    });
  }

  test(`fusion immunity cannot substitute a sibling for absent or opaque context (${actor})`, t => {
    const game = createRuntimeGame({ laboratoryMode: true });
    t.after(() => game.dispose());
    const owner = game[actor];
    placeFieldCards(owner.field, new Card(cardDefinition(207), actor));
    const state = createGameTreeCopy(game, owner).state;
    const sibling = required(state.bot.field[0]);
    const action = { type: "grant_void_fusion_immunity" as const, archetype: "Void", durationTurns: 1 };
    assert.equal(applyGrantVoidFusionImmunity.call({ game, ui: null }, action, { player: owner }), false);
    assert.equal(applySimulatedActions({ state, actions: [action] }), false);
    const { monsterType: _hiddenMonsterType, cardKind: _hiddenKind, ...publicCard } = sibling;
    const opaque = { ...publicCard, _simUnknownCard: true };
    assert.equal(applySimulatedActions({ state, actions: [action], options: {
      actionContext: { summonedCard: opaque },
    } }), false);
    assert.ok(!sibling.immuneToOpponentEffectsUntilTurn);
    assert.deepEqual(state._simUnsupportedActions ?? [], []);
  });
}
