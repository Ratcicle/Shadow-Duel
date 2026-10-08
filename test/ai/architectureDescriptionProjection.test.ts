import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import DragonStrategy from "../../src/core/ai/DragonStrategy.js";
import { calculateMacroPriorityBonus, decideMacroStrategy } from "../../src/core/ai/MacroPlanning.js";
import { inferRole } from "../../src/core/ai/RoleAnalyzer.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createArchitectureFixture } from "../helpers/architectureBaseline.js";

for (const actor of ["bot", "player"] as const) {
  for (const scenario of ["starter", "scarce", "full_field", "defense", "finisher", "recovery"] as const) {
    test(`Dragon macro description projection agrees with the live policy (${actor}/${scenario})`, () => {
      const { state } = createArchitectureFixture("dragon", scenario, actor);
      const projected = required(state.bot.hand.find(card => card.id === 262));
      const live = new Card(cardDefinition(262), actor);
      const macro = decideMacroStrategy(state, state.bot, state.player);
      const expected = scenario === "starter" ? 10 : scenario === "full_field" || scenario === "finisher" ? 8 : 12;
      const liveBonus = calculateMacroPriorityBonus("spell", live, macro);
      assert.equal(liveBonus, expected);
      assert.equal(projected.description, live.description);
      assert.equal(calculateMacroPriorityBonus("spell", projected, macro), liveBonus);
      assert.equal(inferRole(projected), inferRole(live));
      const current = required(new DragonStrategy(state.bot).generateMainPhaseActions(state)
        .find(action => action.type === "spell" && action.cardId === 262));
      assert.equal(Reflect.get(current, "macroBuff"), liveBonus);
      assert.equal(current.priority, 10 + liveBonus);

      // Model exactly the old projection omission, without modifying policy.
      delete projected.description;
      const omitted = calculateMacroPriorityBonus("spell", projected, macro);
      assert.equal(omitted, scenario === "starter" ? 10 : 0);
      assert.equal(inferRole(projected), inferRole(live), "Role inference uses declared actions, not card prose.");
      const previous = required(new DragonStrategy(state.bot).generateMainPhaseActions(state)
        .find(action => action.type === "spell" && action.cardId === 262));
      assert.equal(Reflect.get(previous, "macroBuff"), omitted);
      assert.equal(previous.priority, 10 + omitted);
      assert.equal(current.priority - previous.priority, liveBonus - omitted);
    });
  }
}
