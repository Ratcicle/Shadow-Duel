import assert from "node:assert/strict";
import test from "node:test";
import BaseStrategy from "../../src/core/ai/BaseStrategy.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { getNormalTributeRequirement } from "../../src/core/game/summon/tributeValue.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

const strategy = new BaseStrategy(null);

// The inherited query is consumed by policies before the common simulator.
// Cover explicit costs at every level boundary rather than just default costs.
for (const level of [1, 4, 5, 6, 7, 10]) for (const requiredTributes of [0, 1, 3]) {
  test(`default strategy preserves the canonical ${requiredTributes}-Tribute requirement at Level ${level}`, () => {
    const incoming = simulationCard({ id: 900, cardKind: "monster", level, requiredTributes });
    const state = simulationState({ bot: { field: [901, 902, 903].map(id =>
      simulationCard({ id, cardKind: "monster", type: "Dragon", isFacedown: false })) } });
    const expected = getNormalTributeRequirement(incoming, state.bot.field);
    assert.equal(expected.tributesNeeded, requiredTributes);
    assert.deepEqual(strategy.getTributeRequirementFor(incoming, state.bot), expected);
  });
}

for (const isFacedown of [false, true]) {
  test(`default strategy honors a Type alternative only on a face-up material (${isFacedown})`, () => {
    const incoming = simulationCard({ id: 904, cardKind: "monster", level: 8,
      altTribute: { requiresType: "Dragon", tributes: 1 } });
    const material = simulationCard({ id: 905, cardKind: "monster", type: "Dragon", isFacedown });
    const state = simulationState({ bot: { field: [material] } });
    const expected = getNormalTributeRequirement(incoming, state.bot.field);
    assert.equal(expected.tributesNeeded, isFacedown ? 2 : 1);
    assert.deepEqual(strategy.getTributeRequirementFor(incoming, state.bot), expected);
  });
}

for (const actor of ["bot", "player"] as const) for (const kind of ["explicit", "alternative"] as const) {
  for (const staleCallback of [false, true]) {
    test(`shared Normal Summon derives its cost from the canonical query (${actor}/${kind}/${staleCallback})`, () => {
      const incoming = simulationCard({ id: 906, cardKind: "monster", owner: actor, controller: actor, level: kind === "explicit" ? 4 : 8,
        ...(kind === "explicit" ? { requiredTributes: 3 } : { altTribute: { requiresType: "Dragon", tributes: 1 } }) });
      const state = simulationState({ _isPerspectiveState: true, turn: actor, phase: "main1", turnCounter: 3,
        bot: { id: actor, hand: [incoming], field: [907, 908, 909, 910, 911].map(id =>
          simulationCard({ id, cardKind: "monster", owner: actor, controller: actor, type: "Dragon", isFacedown: false })) },
        player: { id: actor === "bot" ? "player" : "bot" } });
      const expected = getNormalTributeRequirement(incoming, state.bot.field);
      assert.equal(expected.tributesNeeded, kind === "explicit" ? 3 : 1);
      const materials = state.bot.field.slice(0, expected.tributesNeeded);
      let requestedCost: number | undefined;
      applyGenericSimulatedMainPhaseAction(state, { type: "summon", index: 0, cardId: 906, position: "attack" }, {
        ...(staleCallback ? { getTributeRequirementFor: () => ({ tributesNeeded: 0 }) } : {}),
        selectBestTributes: (_field, amount) => {
          requestedCost = amount;
          return Array.from({ length: amount }, (_, index) => index);
        },
      });
      assert.equal(requestedCost, expected.tributesNeeded,
        "The callback ranks materials; an absent or obsolete requirement callback cannot redefine the cost.");
      assert.equal(state.bot.field.filter(card => card.id === incoming.id).length, 1);
      assert.deepEqual(state.bot.hand, []);
      assert.deepEqual(state.bot.graveyard, materials);
      assert.equal(state.bot.field.length, 6 - expected.tributesNeeded);
    });
  }
}
