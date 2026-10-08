import assert from "node:assert/strict";
import test from "node:test";
import { canUseNormalSummonForCard } from "../../src/core/Player.js";
import { getGenericNormalSummonActions } from "../../src/core/ai/common/actionGeneration.js";
import { getTributeRequirementFor, selectBestTributes } from "../../src/core/ai/common/tributePolicy.js";
import { getNormalSummonTributeOptions, getNormalTributeRequirement } from "../../src/core/game/summon/tributeValue.js";
import type { SimulatedCardState, SimulatedPlayerState } from "../../src/core/contracts/aiState.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";
import { cardDefinition } from "../helpers/fixtures.js";

const monster = (id: number, level = 4): SimulatedCardState => simulationCard({
  id, instanceId: `architecture-${id}`, name: `Monster ${id}`, cardKind: "monster",
  type: "Dragon", archetype: "Dragon", level, atk: 1000, def: 1000,
});

function actionsFor(player: SimulatedPlayerState) {
  return getGenericNormalSummonActions({
    player,
    analysis: { canNormalSummon: true, fieldCapacity: 5 - player.field.length },
    getTributeRequirement: getTributeRequirementFor,
    shouldSummon: () => ({ yes: true, priority: 7, position: "attack" }),
  });
}

// Bounded oracle property: explicit overrides must survive every level boundary.
// Literal expected costs also prevent both adapters drifting together unnoticed.
for (const level of [1, 4, 5, 6, 7, 10]) for (const requiredTributes of [0, 1, 3]) {
  test(`AI tribute requirement preserves requiredTributes=${requiredTributes} at Level ${level}`, () => {
    const incoming = { ...monster(100, level), requiredTributes };
    const field = [monster(101), monster(102), monster(103)];
    const canonical = getNormalTributeRequirement(incoming, field);
    const projected = getTributeRequirementFor(incoming, { field });
    assert.equal(canonical.tributesNeeded, requiredTributes);
    assert.equal(projected.tributesNeeded, requiredTributes);
    assert.equal(projected.usingAlt, canonical.usingAlt);
  });
}

for (const facedown of [false, true]) {
  test(`AI alternate Type tribute uses the canonical face-up condition (facedown=${facedown})`, () => {
    const incoming = { ...monster(110, 8), altTribute: { requiresType: "Dragon", tributes: 1 } as const };
    const field = [{ ...monster(111), isFacedown: facedown }];
    const canonical = getNormalTributeRequirement(incoming, field);
    const projected = getTributeRequirementFor(incoming, { field });
    assert.equal(canonical.tributesNeeded, facedown ? 2 : 1);
    assert.equal(projected.tributesNeeded, facedown ? 2 : 1);
    assert.equal(projected.usingAlt, !facedown);
  });
}

test("AI alternate Name tribute and empty-field alternative retain canonical costs", () => {
  const named = { ...monster(120, 8), altTribute: { requiresName: "Monster 121", tributes: 1 } as const };
  const field = [monster(121)];
  assert.equal(getTributeRequirementFor(named, { field }).tributesNeeded, 1);
  assert.equal(getTributeRequirementFor(named, { field: [] }).tributesNeeded, 2);
  const empty = { ...monster(122, 8), altTribute: { type: "no_tribute_if_empty_field" } as const };
  assert.equal(getTributeRequirementFor(empty, { field: [] }).tributesNeeded, 0);
  assert.equal(getTributeRequirementFor(empty, { field }).tributesNeeded, 2);
});

test("generic generation admits a legal Tribute Summon that frees a full field", () => {
  const incoming = monster(130, 8);
  const state = simulationState({ bot: { hand: [incoming], field: [131, 132, 133, 134, 135].map(id => monster(id)) } });
  assert.ok(getNormalSummonTributeOptions(state.bot, incoming).length > 0);
  assert.deepEqual(actionsFor(state.bot).map(action => action.cardId), [130]);
  assert.equal(actionsFor(state.bot)[0]?.priority, 7, "Legality must preserve the strategic callback priority.");
  assert.equal(state.bot.field.length, 5, "Generation must not pay projected tributes.");
  assert.deepEqual(state.bot.hand, [incoming]);
});

test("generic generation keeps a full field closed to a summon with no tribute cost", () => {
  const incoming = monster(140);
  const state = simulationState({ bot: { hand: [incoming], field: [141, 142, 143, 144, 145].map(id => monster(id)) } });
  assert.deepEqual(getNormalSummonTributeOptions(state.bot, incoming), []);
  assert.deepEqual(actionsFor(state.bot), []);
});

test("generic generation rejects an insufficient physical Tribute cost despite positive policy", () => {
  const incoming = monster(150, 8);
  const state = simulationState({ bot: { hand: [incoming], field: [monster(151)] } });
  assert.deepEqual(getNormalSummonTributeOptions(state.bot, incoming), []);
  assert.deepEqual(actionsFor(state.bot), []);
});

for (const negated of [false, true]) {
  test(`generic generation respects special Tribute value and its negation (${negated})`, () => {
    const incoming = monster(160, 8);
    const material = { ...monster(161), effectsNegated: negated, tributeValue: { countAs: 2, requireFaceup: true } };
    const state = simulationState({ bot: { hand: [incoming], field: [material] } });
    assert.equal(getNormalSummonTributeOptions(state.bot, incoming).length, negated ? 0 : 1);
    assert.deepEqual(actionsFor(state.bot).map(action => action.cardId), negated ? [] : [160]);
  });
}

test("generic generation checks remaining restricted Normal Summon permissions per card", () => {
  const dragon = monster(170);
  const fiend = { ...monster(171), type: "Fiend" as const, archetype: "Void" };
  const state = simulationState({ bot: {
    hand: [dragon, fiend], summonCount: 1,
    additionalNormalSummonPermissions: [{ count: 1, filters: { type: "Dragon" } }],
  } });
  assert.equal(canUseNormalSummonForCard(state.bot, dragon), true);
  assert.equal(canUseNormalSummonForCard(state.bot, fiend), false);
  assert.deepEqual(actionsFor(state.bot).map(action => action.cardId), [170]);
});

test("generic generation cannot invent another summon after every allowance is spent", () => {
  const incoming = monster(180);
  const state = simulationState({ bot: { hand: [incoming], summonCount: 1 } });
  assert.equal(canUseNormalSummonForCard(state.bot, incoming), false);
  assert.deepEqual(actionsFor(state.bot), []);
});

test("generic generation keeps a public passive's restricted additional summon", () => {
  const connector = simulationCard({ ...cardDefinition(507), owner: "bot", controller: "bot", instanceId: "connector" });
  const supported = { ...monster(181), archetype: "Tech-Zero" };
  const other = monster(182);
  const state = simulationState({ bot: { hand: [supported, other], field: [connector], summonCount: 1 } });
  assert.equal(canUseNormalSummonForCard(state.bot, supported), true);
  assert.equal(canUseNormalSummonForCard(state.bot, other), false);
  assert.deepEqual(actionsFor(state.bot).map(action => action.cardId), [181]);
});

test("generic legality preserves caller veto, hand order, priorities and summon position", () => {
  const state = simulationState({ bot: { hand: [monster(183), monster(184), monster(185)] } });
  const actions = getGenericNormalSummonActions({
    player: state.bot,
    analysis: { canNormalSummon: true, fieldCapacity: 5 },
    getTributeRequirement: getTributeRequirementFor,
    shouldSummon: card => ({ yes: card.id !== 184, priority: card.id === 183 ? 2 : 12, position: "defense" }),
    extra: { facedown: true },
  });
  assert.deepEqual(actions.map(action => ({ id: action.cardId, priority: action.priority,
    position: action.position, facedown: action.facedown })), [
    { id: 183, priority: 2, position: "defense", facedown: true },
    { id: 185, priority: 12, position: "defense", facedown: true },
  ]);
});

test("shared Tribute selection preserves strategy ranking among legal physical subsets", () => {
  const incoming = monster(190, 8);
  const protectedDouble = { ...monster(191), tributeValue: { countAs: 2 } };
  const expendableFirst = monster(192), expendableSecond = monster(193);
  const field = [protectedDouble, expendableFirst, expendableSecond];
  assert.deepEqual(selectBestTributes(field, 2, incoming, {}, {
    evaluateCardValue: card => card.id === 191 ? 100 : 1,
  }), [1, 2]);
  assert.deepEqual(selectBestTributes(field, 2, incoming, {}, {
    evaluateCardValue: card => card.id === 191 ? 0 : 10,
  }), [0]);
  const negated: SimulatedCardState[] = [{ ...protectedDouble, effectsNegated: true }];
  assert.deepEqual(selectBestTributes(negated, 2, incoming), []);
});
