import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { createNormalSummonRecord } from "../../src/core/Player.js";
import { getGenericHandSpellActions, getGenericNormalSummonActions, getGenericIgnitionEffectActions } from "../../src/core/ai/common/actionGeneration.js";
import { findIgnitionEffect } from "../../src/core/ai/common/effectDiscovery.js";
import { cardDefinition } from "../helpers/fixtures.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

for (const seat of ["bot", "player"] as const) {
  test(`shared Normal generator accepts the coherent canonical passive view (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, disableChains: true });
    t.after(() => game.dispose("generation_query_view"));
    game.disablePresentationDelays = true; game.phase = "main1"; game.turn = seat; game.turnCounter = 3;
    const owner = game[seat]; owner.controllerType = "ai";
    const incoming = new Card(cardDefinition(201), seat);
    const source = new Card(cardDefinition(1), seat);
    source.effects = [{ id: "architecture_generation_permission", timing: "passive", requireZone: "field", requireFaceup: true,
      passive: { type: "additional_normal_summon", count: 1 } }];
    placeFieldCards(owner.field, source); owner.hand.push(incoming);
    owner.summonCount = 1; owner.normalSummonsThisTurn = [createNormalSummonRecord(source)];
    const options = { player: owner, analysis: { canNormalSummon: true }, shouldSummon: () => ({ yes: true, priority: 7 }) };
    const defaultCandidates = getGenericNormalSummonActions(options);
    const candidates = getGenericNormalSummonActions({ ...options, summonPlayer: owner });
    assert.deepEqual(candidates, defaultCandidates, "self passives retain the previous default results");
    assert.equal(candidates.length, 1); assert.equal(candidates[0]?.index, 0);
    source.effectsNegated = true;
    assert.deepEqual(getGenericNormalSummonActions({ ...options, summonPlayer: owner }), []);
    source.effectsNegated = false;
    assert.equal(owner.hand[0], incoming); assert.equal(owner.field[0], source); assert.equal(owner.summonCount, 1);
    const result = await game.performNormalSummon(owner, 0, "attack", false);
    assert.equal(result?.success, true); assert.ok(owner.field.includes(incoming));
  });

  test(`shared hand generators retain physical indices and callback order (${seat})`, () => {
    const hand = [201, 219, 201, 219].map((id, index) => simulationCard({ ...cardDefinition(id), instanceId: 39000 + index }));
    const state = simulationState({ bot: { id: seat, hand } });
    const calls: number[] = [];
    const spells = getGenericHandSpellActions({ player: state.bot, shouldPlay: (_card, _analysis, { index }) => {
      calls.push(index); return { yes: true, priority: index + 2 };
    } });
    assert.deepEqual(calls, [1, 3]);
    calls.length = 0;
    const selectedSpell = getGenericHandSpellActions({ player: state.bot, entries: [{ card: hand[3]!, sourceIndex: 3 }],
      shouldPlay: (_card, _analysis, { index }) => { calls.push(index); return { yes: true, priority: index + 2 }; } });
    assert.deepEqual(selectedSpell, [spells[1]]);
    assert.deepEqual(calls, [3]);
    const options = { player: state.bot, summonPlayer: state.bot, analysis: { canNormalSummon: true },
      shouldSummon: () => ({ yes: true, priority: 7, position: "defense" as const }) };
    const normals = getGenericNormalSummonActions(options);
    assert.deepEqual(normals.map(action => action.index), [0, 2]);
    assert.deepEqual(getGenericNormalSummonActions({ ...options, entries: [{ card: hand[2]!, sourceIndex: 2 }] }), [normals[1]]);
    assert.equal(state.bot.hand[2], hand[2]);
    assert.notEqual(hand[0], hand[2]);
  });

  test(`shared ignition entries preserve zone index and single-effect discovery (${seat})`, () => {
    const sources = [201, 201].map((id, index) => simulationCard({ ...cardDefinition(id), instanceId: 39100 + index }));
    const state = simulationState({ bot: { id: seat, field: sources } });
    const seen: Array<[number, typeof sources[number]]> = [];
    const options = { player: state.bot, cards: sources, type: "monsterEffect" as const, sourceZone: "field",
      indexFields: ["fieldIndex" as const], includeEffectId: true,
      findEffect: (card: typeof sources[number]) => findIgnitionEffect(card, "field"),
      validateCandidate: ({ sourceIndex, card }: { sourceIndex: number; card: typeof sources[number] }) => { seen.push([sourceIndex, card]); return true; },
      shouldActivate: () => ({ yes: true, priority: 4 }) };
    const all = getGenericIgnitionEffectActions(options);
    assert.deepEqual(all.map(action => action.fieldIndex), [0, 1]);
    assert.deepEqual(seen, [[0, sources[0]], [1, sources[1]]]);
    seen.length = 0;
    assert.deepEqual(getGenericIgnitionEffectActions({ ...options, entries: [{ card: sources[1]!, sourceIndex: 1 }] }), [all[1]]);
    assert.deepEqual(seen, [[1, sources[1]]]);
    assert.equal(seen[0]?.[1], sources[1]);
    assert.equal(all[0]?.effectId, findIgnitionEffect(sources[0], "field")?.id);
  });

  test(`shared ignition default preflight and explicit policy remain separate (${seat})`, () => {
    const source = simulationCard({ ...cardDefinition(201), instanceId: 39201,
      effects: [{ id: "entries_preflight", timing: "ignition", activationZones: ["field"],
        actions: [{ type: "bounce_and_summon", bounceSource: true, filters: { cardId: 204 } }] }] });
    const state = simulationState({ bot: { id: seat, field: [source] } });
    const options = { player: state.bot, cards: state.bot.field, type: "monsterEffect" as const, sourceZone: "field",
      findEffect: (card: typeof source) => findIgnitionEffect(card, "field"), shouldActivate: () => ({ yes: true }) };
    assert.deepEqual(getGenericIgnitionEffectActions(options), []);
    assert.equal(getGenericIgnitionEffectActions({ ...options, validateCandidate: () => true }).length, 1);
    assert.deepEqual(getGenericIgnitionEffectActions({ ...options, validateCandidate: () => ({ ok: false }) }), []);
    assert.equal(state.bot.field[0], source);
    assert.deepEqual(state.bot.hand, []);
  });
}
