import assert from "node:assert/strict";
import test from "node:test";
import { simulateMainPhaseAction } from "../../src/core/ai/dragon/simulation.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { scoreDragonDiscardCandidate } from "../../src/core/ai/dragon/costPolicy.js";
import { cardDefinition } from "../helpers/fixtures.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

const make = (id: number) => simulationCard({ ...cardDefinition(id), owner: "bot", controller: "bot", instanceId: `cost-${id}` });

test("Dragon planner sends Black Bull costs without Voltaic burn or Luminous recovery", () => {
  const source = make(259), voltaic = make(255), armored = make(252), luminous = make(251), grey = make(254);
  const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4,
    bot: { hand: [source, voltaic, armored], field: [luminous], graveyard: [grey] } });
  simulateMainPhaseAction(state, { type: "handIgnition", cardId: 259, index: 0, effectId: "bbd_special_summon_from_hand" });
  assert.equal(state.player.lp, 8000);
  assert.ok(state.bot.graveyard.includes(grey));
  assert.equal(state.bot.field.filter(card => card.id === 259).length, 1);
  assert.equal(state.bot.graveyard.length, 3);
});

test("Black Bull cost scoring does not reward Voltaic's discard-only burn", () => {
  const voltaic = make(255), blackBull = make(259), darkness = make(258);
  const player = { hand: [voltaic, blackBull], field: [], graveyard: [], deck: [], spellTrap: [], extraDeck: [], fieldSpell: null };
  const sendScore = scoreDragonDiscardCandidate(voltaic, { player, source: blackBull });
  const discardScore = scoreDragonDiscardCandidate(voltaic, { player, source: darkness });
  assert.ok(sendScore > discardScore, "sending preserves body/material value without burn payoff");
});

test("Dragon planner applies Rainbow's resolution choice after paying its GY cost", () => {
  const source = make(267), extreme = make(270), followUp = make(260);
  const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4,
    bot: { graveyard: [source], deck: [extreme], hand: [followUp] } });
  simulateMainPhaseAction(state, { type: "graveyardMonsterEffect", cardId: 267, effectId: "rainbow_cosmic_dragon_gy_send_extremes" });
  assert.ok(state.bot.banished.includes(source));
  assert.ok(state.bot.graveyard.includes(extreme));
});

for (const counters of [6, 7]) for (const representation of ["map", "object"]) {
  test(`Dragon planner uses seven Peak counters (has ${counters}, ${representation})`, () => {
    const source = make(262), recruit = make(257);
    const peak = representation === "map" ? source : { ...source, counters: { dragon_peak: counters } };
    if (representation === "map") source.counters = new Map([["dragon_peak", counters]]);
    const base = simulationState({ turn: "bot", phase: "main1", turnCounter: 4,
      bot: { deck: [recruit] } });
    const state = { ...base, bot: { ...base.bot, fieldSpell: peak } };
    simulateMainPhaseAction(state, { type: "fieldEffect", cardId: 262, effectId: "dragon_peak_ignite_summon" });
    assert.equal(state.bot.graveyard.some(card => card.id === 262), counters === 7);
    assert.equal(state.bot.field.some(card => card.id === recruit.id), counters === 7);
  });
}

test("Dragon planner lets Hellkite's field payment free the summon slot", () => {
  const source = make(260);
  const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4,
    bot: { hand: [source], field: Array.from({ length: 5 }, (_, index) => ({ ...make(252), instanceId: `field-${index}` })) } });
  simulateMainPhaseAction(state, { type: "handIgnition", cardId: 260, index: 0, effectId: "hellkite_dragon_hand_ss_cost" });
  assert.equal(state.bot.field.filter(card => card.id === 260).length, 1);
  assert.equal(state.bot.field.length, 5);
  assert.equal(state.bot.graveyard.length, 1);
});

test("Dragon planner does not pay Peak when no Dragon can be summoned", () => {
  const source = make(262); source.counters = new Map([["dragon_peak", 7]]);
  const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4, bot: { fieldSpell: source } });
  simulateMainPhaseAction(state, { type: "fieldEffect", cardId: 262, effectId: "dragon_peak_ignite_summon" });
  assert.equal(state.bot.fieldSpell, source);
  assert.equal(state.bot.graveyard.length, 0);
});

for (const negated of [false, true]) {
  test(`Common planner rejects Black Bull's redirected GY costs (Galaxy negated: ${negated})`, () => {
    const source = make(259), first = make(252), second = make(254);
    const galaxy = { ...make(273), owner: "player", controller: "player", effectsNegated: negated };
    const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4, _isPerspectiveState: true,
      bot: { hand: [source, first, second] }, player: { field: [galaxy] } });
    applyGenericSimulatedMainPhaseAction(state, { type: "handIgnition", cardId: 259, index: 0, effectId: "bbd_special_summon_from_hand" });
    assert.equal(state.bot.field.some(card => card.id === source.id), negated);
    assert.equal(state.bot.graveyard.length, negated ? 2 : 0);
    assert.equal(state.bot.banished.length, 0);
    assert.equal(state.bot.hand.length, negated ? 0 : 3);
  });
  test(`Dragon planner rejects Black Bull's redirected GY costs (Galaxy negated: ${negated})`, () => {
    const source = make(259), first = make(252), second = make(254);
    const galaxy = { ...make(273), owner: "player", controller: "player", effectsNegated: negated };
    const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4,
      bot: { hand: [source, first, second] }, player: { field: [galaxy] } });
    simulateMainPhaseAction(state, { type: "handIgnition", cardId: 259, index: 0, effectId: "bbd_special_summon_from_hand" });
    assert.equal(state.bot.field.some(card => card.id === source.id), negated);
    assert.equal(state.bot.graveyard.length, negated ? 2 : 0);
    assert.equal(state.bot.banished.length, 0);
    assert.equal(state.bot.hand.length, negated ? 0 : 3);
  });
  for (const route of ["hellkiteHand", "hellkiteField", "peak", "boneflame"] as const) {
    test(`Dragon planner preserves redirected ${route} payment (Galaxy negated: ${negated})`, () => {
      const source = make(route === "peak" ? 262 : route === "boneflame" ? 269 : 260);
      const cost = { ...make(252), atk: 0 }, recruit = make(255);
      const galaxy = { ...make(273), owner: "player", controller: "player", effectsNegated: negated };
      const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 4,
        player: { field: [galaxy] } });
      let summonedId: number;
      if (route === "peak") {
        source.counters = new Map([["dragon_peak", 7]]); state.bot.fieldSpell = source; state.bot.deck.push(recruit);
        simulateMainPhaseAction(state, { type: "fieldEffect", cardId: 262, effectId: "dragon_peak_ignite_summon" });
        assert.equal(state.bot.fieldSpell === source, !negated); summonedId = recruit.id!;
      } else if (route === "hellkiteField") {
        state.bot.field.push(source); state.bot.graveyard.push(recruit);
        simulateMainPhaseAction(state, { type: "monsterEffect", cardId: 260, effectId: "hellkite_dragon_field_send_revive" });
        assert.equal(state.bot.field.includes(source), !negated); summonedId = recruit.id!;
      } else if (route === "hellkiteHand") {
        state.bot.hand.push(source); state.bot.field.push(cost);
        simulateMainPhaseAction(state, { type: "handIgnition", cardId: 260, index: 0, effectId: "hellkite_dragon_hand_ss_cost" });
        assert.equal(state.bot.field.includes(cost), !negated); summonedId = source.id!;
      } else {
        state.bot.graveyard.push(source); state.bot.field.push(cost);
        simulateMainPhaseAction(state, { type: "graveyardMonsterEffect", cardId: 269, effectId: "boneflame_dragon_gy_revive" });
        assert.equal(state.bot.field.includes(cost), !negated); summonedId = source.id!;
      }
      assert.equal(state.bot.field.some(card => card.id === summonedId), negated);
      assert.equal(state.bot.banished.length, 0);
    });
  }
}
