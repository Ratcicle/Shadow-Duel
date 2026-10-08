import assert from "node:assert/strict";
import test from "node:test";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";
import { resolveSimulatedLpCost } from "../../src/core/ai/common/simulatedActions/shared.js";
import { canUseSimulatedEffectUsage, markSimulatedEffectUsage, getSimulatedEffectUsageKey } from "../../src/core/ai/common/simStateUtils.js";

for (const actor of ["bot", "player"] as const) {
  for (const used of [0, 1, 2]) {
    test(`LP preview is read-only and respects remaining reducer uses: ${actor}/${used}`, () => {
      const knight = simulationCard({ ...cardDefinition(173), instanceId: 901, isFacedown: false });
      const source = simulationCard({ ...cardDefinition(163), instanceId: 902 });
      const state = simulationState({ turnCounter: 4, [actor]: { field: [knight], hand: [source] } });
      const effect = required(knight.effects?.find(entry => entry.timing === "passive" && "passive" in entry && entry.passive?.type === "lp_cost_reduction"));
      for (let index = 0; index < used; index++) markSimulatedEffectUsage(state, effect, knight, actor, true);
      const before = structuredClone(state);
      for (let repeat = 0; repeat < 3; repeat++) {
        const quote = resolveSimulatedLpCost({
          action: { type: "pay_lp", amount: 2000 }, baseAmount: 2000,
          targetPlayer: state[actor], self: state[actor], opponent: state[actor === "bot" ? "player" : "bot"],
          state, options: { sourceCard: source },
        });
        assert.equal(quote.finalAmount, used < 2 ? 1000 : 2000);
        assert.deepEqual(state, before, "a cost query must not create, normalize, reset or consume usage state");
      }
    });
  }
}

for (const stale of [false, true]) {
  test(`usage query preserves legacy records, including turn reset: stale=${stale}`, () => {
    const knight = simulationCard({ ...cardDefinition(173), instanceId: 901 });
    const effect = required(knight.effects?.find(entry => entry.timing === "passive" && "passive" in entry && entry.passive?.type === "lp_cost_reduction"));
    const key = required(getSimulatedEffectUsageKey(effect, knight));
    for (const bucket of [new Map([[key, 2]]), new Set([key]), [[key, 2]], { [key]: 2 }]) {
      const state = simulationState({ turnCounter: 4, bot: { field: [knight] } });
      // Exercise the supported legacy boundary without widening the serialized schema.
      Reflect.set(state, "_simOncePerTurn", { bot: bucket });
      state._simOncePerTurnTurn = stale ? 3 : 4;
      const before = structuredClone(state);
      const available = canUseSimulatedEffectUsage(state, effect, knight, "bot", true);
      assert.equal(available, stale || bucket instanceof Set);
      assert.deepEqual(state, before);
      markSimulatedEffectUsage(state, effect, knight, "bot", true);
      assert.equal(canUseSimulatedEffectUsage(state, effect, knight, "bot", true), stale);
    }
  });
}
