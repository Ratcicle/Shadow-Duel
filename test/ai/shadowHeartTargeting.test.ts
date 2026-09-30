import assert from "node:assert/strict";
import test from "node:test";
import { simulateMainPhaseAction } from "../../src/core/ai/shadowheart/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { evaluateShadowHeartRecruitCandidate } from "../../src/core/ai/shadowheart/priorities.js";
import { moveCardToZone } from "../../src/core/ai/common/zones.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

const card = (id: number) => simulationCard({ ...cardDefinition(id) });

for (const seat of ["player", "bot"] as const) {
  test(`Infusion simulation discards two then revives from the updated GY (${seat})`, () => {
    const source = card(110), recruit = card(102), discard = card(105);
    const state = simulationState({ _isPerspectiveState: true, phase: "main1", turn: seat, [seat]: { hand: [source, recruit, discard] } });
    const effect = required(source.effects?.[0]);
    applySimulatedActions({ state, selfId: seat, actions: effect.actions || [], options: { sourceCard: source, effect } });
    assert.ok(state[seat].hand.includes(source), "effect cannot discard its own source");
    assert.ok(state[seat].field.includes(recruit));
    assert.ok(state[seat].graveyard.includes(discard));
    assert.equal(recruit.cannotAttackThisTurn, true);
  });
}

test("Imp recruit policy preserves its previous combo preference during resolution", () => {
  const imp = card(107), eel = card(101), specter = card(102), scale = card(111);
  const result = evaluateShadowHeartRecruitCandidate([specter, eel], {
    source: imp, player: { hand: [scale], field: [], graveyard: [] },
  });
  assert.equal(result.best, eel);
});

test("Hymn simulation uses the current face-up scope", () => {
  const source = card(105), faceup = card(101), hidden = card(102); hidden.isFacedown = true;
  const initial = faceup.atk || 0, hiddenAtk = hidden.atk;
  const state = simulationState({ _isPerspectiveState: true, phase: "main1", turn: "bot", bot: { hand: [source], field: [faceup, hidden] } });
  simulateMainPhaseAction(state, { type: "spell", index: 0, cardId: 105 });
  assert.equal(faceup.atk, initial + 500);
  assert.equal(hidden.atk, hiddenAtk);
});

test("simulation preserves Heartbearer's cost but invalidates a reference that leaves and returns", () => {
  const source = card(125), recruit = card(102), other = card(102);
  const state = simulationState({ _isPerspectiveState: true, phase: "main1", turn: "bot", bot: { field: [source], graveyard: [recruit, other] } });
  const effect = required(source.effects?.find(effect => effect.id === "shadow_heart_heartbearer_revive"));
  applySimulatedActions({ state, actions: [...(effect.activationCosts || []), ...(effect.actions || [])],
    selections: { shadow_heart_heartbearer_destroyed_monster: [recruit] }, options: { sourceCard: source, effect,
      emitSimulatedEvent: (event, payload) => {
        if (event !== "card_to_grave" || Reflect.get(payload, "card") !== source) return;
        moveCardToZone(state.bot, recruit, "banished");
        moveCardToZone(state.bot, recruit, "graveyard");
      },
    },
  });
  assert.ok(state.bot.graveyard.includes(source));
  assert.ok(state.bot.graveyard.includes(recruit));
  assert.ok(state.bot.graveyard.includes(other));
  assert.equal(state.bot.field.length, 0);
});
