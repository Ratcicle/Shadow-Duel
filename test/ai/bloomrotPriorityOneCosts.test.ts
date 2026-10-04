import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { applyGenericSimulatedMainPhaseAction, prepareSimulatedEffectActivation } from "../../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { getCounterValue } from "../../src/core/ai/common/counters.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { simulationState } from "../helpers/simulation.js";

const make = (id: number, owner: string) => createPlanningCopy().cloneCardForSim(new Card(cardDefinition(id), owner));

for (const actor of ["bot", "player"] as const) for (const amount of [1, 2, 3]) {
  test(`419 pays ${amount} distributed Esporos before healing (${actor})`, () => {
    const source = make(419, actor);
    const enemy = actor === "bot" ? "player" : "bot";
    const pool = [make(402, actor), make(301, enemy), make(312, enemy)];
    for (const card of pool) card.counters = new Map([["spore", 1]]);
    const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 5, _isPerspectiveState: true,
      bot: { id: actor, field: [source, required(pool[0])] },
      player: { id: enemy, spellTrap: [required(pool[1])], fieldSpell: required(pool[2]) } });
    applyGenericSimulatedMainPhaseAction(state, { type: "monsterEffect", cardId: 419, fieldIndex: 0,
      activationContext: { decisions: { cases: { bloomrot_queen_hollow_grove_remove_and_heal: `remove_${amount}` } } } });
    assert.equal(pool.reduce((sum, card) => sum + getCounterValue(card, "spore"), 0), 3 - amount);
    assert.equal(state.bot.lp, 8000 + 500 * amount);
    assert.equal(state._simUnsupportedActions?.includes("remove_counters_from_field") ?? false, false);
  });
}

test("a planned insufficient pooled selection is rejected without substituting sources or consuming usage", () => {
  const source = make(419, "bot"), selected = make(402, "bot"), spare = make(402, "player");
  selected.counters = new Map([["spore", 1]]); spare.counters = new Map([["spore", 5]]);
  const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 5, _isPerspectiveState: true,
    bot: { field: [source, selected] }, player: { field: [spare] } });
  const effect = required(source.effects?.find(entry => entry.timing === "ignition"));
  const prepared = prepareSimulatedEffectActivation(state, source, effect, { activationContext: { decisions: {
    cases: { [effect.id]: "remove_3" }, selections: { bloomrot_queen_hollow_grove_cost: [required(selected.instanceId)] },
  } } });
  assert.equal(prepared, null);
  assert.equal(getCounterValue(selected, "spore"), 1);
  assert.equal(getCounterValue(spare, "spore"), 5);
  assert.equal(state.bot.lp, 8000);
});

test("pooled simulation emits one aggregate removal for distributed sources", () => {
  const source = make(419, "bot"), first = make(402, "bot"), second = make(402, "player");
  first.counters = new Map([["spore", 1]]); second.counters = new Map([["spore", 1]]);
  const state = simulationState({ bot: { field: [source, first] }, player: { field: [second] } });
  const parent = required(source.effects?.find(entry => entry.timing === "ignition"));
  const mode = required(parent.activationCases?.find(entry => entry.id === "remove_2"));
  const totals: number[] = [];
  const paid = applySimulatedActions({ actions: mode.activationCosts, selections: { bloomrot_queen_hollow_grove_cost: [first, second] }, state,
    options: { sourceCard: source, emitSimulatedEvent: (event, payload) => {
      if (event === "counter_removed") totals.push(Number(Reflect.get(payload, "amount")));
    } } });
  assert.equal(paid, true);
  assert.deepEqual(totals, [2]);
  assert.equal(getCounterValue(first, "spore") + getCounterValue(second, "spore"), 0);
});

for (const mode of ["search_level_4_monster", "recover_graveyard_card"] as const) test(`412 ${mode} pays its prepared cost before searching`, () => {
  const source = make(412, "bot"), ally = make(402, "bot"), enemy = make(402, "player"), spell = make(301, "player");
  for (const card of [ally, enemy, spell]) card.counters = new Map([["spore", 1]]);
  const recruit = make(402, "bot"), recover = make(401, "bot");
  const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 5, _isPerspectiveState: true,
    bot: { spellTrap: [source], field: [ally], deck: [recruit], graveyard: [recover] },
    player: { field: [enemy], spellTrap: [spell] } });
  const parent = required(source.effects?.find(entry => entry.timing === "ignition"));
  const prepared = prepareSimulatedEffectActivation(state, source, parent, { activationContext: { decisions: { cases: { [parent.id]: mode } } } });
  assert.ok(prepared, "Root Network must prepare its selected payable mode");
  applyGenericSimulatedMainPhaseAction(state, { type: "spellTrapEffect", cardId: 412, zoneIndex: 0,
    activationContext: { decisions: { cases: { bloomrot_root_network_recover: mode } } } });
  assert.ok(state.bot.hand.includes(mode === "search_level_4_monster" ? recruit : recover), JSON.stringify({ hand: state.bot.hand.map(card => card.id),
    pool: [ally, enemy, spell].map(card => getCounterValue(card, "spore")), unsupported: state._simUnsupportedActions }));
  assert.equal([ally, enemy, spell].reduce((sum, card) => sum + getCounterValue(card, "spore"), 0), mode === "search_level_4_monster" ? 1 : 0);
});

test("419 simulation pays prepared counters while its negated effect grants no LP", () => {
  const source = make(419, "bot"), pool = make(402, "player");
  source.effectsNegated = true; pool.counters = new Map([["spore", 3]]);
  const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 5, _isPerspectiveState: true, bot: { field: [source] }, player: { field: [pool] } });
  applyGenericSimulatedMainPhaseAction(state, { type: "monsterEffect", cardId: 419, fieldIndex: 0,
    activationContext: { decisions: { cases: { bloomrot_queen_hollow_grove_remove_and_heal: "remove_3" } } } });
  assert.equal(getCounterValue(pool, "spore"), 0);
  assert.equal(state.bot.lp, 8000);
});

test("418 simulation declares a face-down Defense target and pays from separate face-up sources", () => {
  const source = make(418, "bot"), target = make(402, "player"), spell = make(301, "player");
  target.isFacedown = true; target.position = "defense"; spell.counters = new Map([["spore", 2]]);
  const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 5, _isPerspectiveState: true, bot: { field: [source] }, player: { field: [target], spellTrap: [spell] } });
  applyGenericSimulatedMainPhaseAction(state, { type: "monsterEffect", cardId: 418, fieldIndex: 0 });
  assert.equal(getCounterValue(spell, "spore"), 0);
  assert.equal(state.player.field.length, 0);
  assert.ok(state.player.graveyard.includes(target));
});
