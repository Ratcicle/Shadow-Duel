import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { moveCardToZone } from "../../src/core/ai/common/zones.js";
import type { ActionOf } from "../../src/core/contracts/actions.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { simulationState } from "../helpers/simulation.js";

for (const ownerId of ["player", "bot"] as const) {
  for (const sourceZone of ["fieldSpell", "field"] as const) {
    test(`destroying an aura source in ${sourceZone} removes only its contribution (${ownerId})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
      t.after(() => game.dispose("departing_aura_simulation_test"));
      game.disablePresentationDelays = true;
      const owner = game[ownerId];
      const otherId = ownerId === "player" ? "bot" : "player";
      const other = game[otherId];
      for (const player of [owner, other]) {
        player.fieldSpell = new Card(cardDefinition("Darkness Valley"), player.id);
        placeFieldCards(player.field, new Card(cardDefinition("Shadow-Heart Void Mage"), player.id));
      }
      const support = new Card({ ...cardDefinition("Shadow-Heart Void Mage"), effects: [{
        id: "support_aura_fixture", timing: "passive", requireZone: "field", passive: {
          type: "field_archetype_aura_buff", archetype: "Shadow-Heart", targetOwners: ["self"], atkBoost: 100,
        },
      }] }, owner.id);
      support.fieldPresenceId = `aura-source-${ownerId}`;
      placeFieldCards(owner.field, support);
      const mage = required(owner.field[0]);
      mage.atk += 200;
      mage.tempAtkBoost = 200;
      game.effectEngine.updatePassiveBuffs();
      assert.equal(mage.atk, 2100);
      const source = sourceZone === "fieldSpell" ? required(owner.fieldSpell) : support;
      const copy = createPlanningCopy();
      const state = simulationState({
        player: { field: game.player.field.map(copy.cloneCardForSim), fieldSpell: copy.cloneCardForSim(required(game.player.fieldSpell)) },
        bot: { field: game.bot.field.map(copy.cloneCardForSim), fieldSpell: copy.cloneCardForSim(required(game.bot.fieldSpell)) },
      });
      const simulatedSource = sourceZone === "fieldSpell" ? required(state[ownerId].fieldSpell) : required(state[ownerId].field[1]);
      const action: ActionOf<"destroy"> = { type: "destroy", targetRef: "aura" };
      await game.effectEngine.applyActions([action], { player: other, opponent: owner, source: required(other.field[0]) }, { aura: [source] });
      assert.equal(mage.atk, sourceZone === "fieldSpell" ? 1800 : 2000);
      const events: string[] = [];
      applySimulatedActions({ state, selfId: otherId, actions: [action], selections: { aura: [simulatedSource] }, options: {
        sourceCard: required(state[otherId].field[0]), emitSimulatedEvent(event, payload) {
          assert.equal(Reflect.get(payload, "card"), simulatedSource);
          assert.equal(required(state[ownerId].field[0]).atk, mage.atk, "aura removal precedes each movement event");
          events.push(event);
        },
      } });
      assert.equal(required(state[ownerId].field[0]).atk, mage.atk);
      assert.equal(required(state[ownerId].field[0]).tempAtkBoost, 200);
      assert.equal(required(state[otherId].field[0]).atk, required(other.field[0]).atk);
      assert.deepEqual(required(state[ownerId].field[0]).dynamicBuffs, mage.dynamicBuffs);
      assert.deepEqual(events, ["card_to_grave", "card_moved"]);
      assert.equal(state[ownerId].graveyard[0], simulatedSource);
      assert.deepEqual(state._simUnsupportedActions || [], []);
      assert.equal(moveCardToZone(state[ownerId], simulatedSource, "hand", state[ownerId], { state }), true);
      assert.equal(required(state[ownerId].field[0]).atk, mage.atk, "later off-field movement cannot subtract the same aura again");
    });
  }
  test(`negating a field aura matches runtime and preserves another source (${ownerId})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
    t.after(() => game.dispose("negated_aura_simulation_test"));
    game.disablePresentationDelays = true;
    const owner = game[ownerId];
    const other = game[ownerId === "player" ? "bot" : "player"];
    for (const player of [owner, other]) {
      player.fieldSpell = new Card(cardDefinition("Darkness Valley"), player.id);
      placeFieldCards(player.field, new Card(cardDefinition("Shadow-Heart Void Mage"), player.id));
    }
    const mage = required(owner.field[0]);
    mage.atk += 200;
    mage.tempAtkBoost = 200;
    game.effectEngine.updatePassiveBuffs();
    assert.equal(mage.atk, 2000);
    assert.equal(required(other.field[0]).atk, 1800);
    const copy = createPlanningCopy();
    const state = simulationState({
      player: { field: game.player.field.map(copy.cloneCardForSim), fieldSpell: copy.cloneCardForSim(required(game.player.fieldSpell)) },
      bot: { field: game.bot.field.map(copy.cloneCardForSim), fieldSpell: copy.cloneCardForSim(required(game.bot.fieldSpell)) },
    });
    const action: ActionOf<"add_status"> = { type: "add_status", targetRef: "aura", status: "effectsNegated", duration: "until_end_turn" };
    await game.effectEngine.applyActions([action], { player: other, opponent: owner, source: required(other.field[0]) },
      { aura: [required(owner.fieldSpell)] });
    applySimulatedActions({ state, actions: [action], selections: { aura: [required(state[ownerId].fieldSpell)] } });
    assert.equal(mage.atk, 1700, "negation removes only the 300 ATK aura contribution");
    assert.equal(required(state[ownerId].field[0]).atk, mage.atk);
    assert.equal(required(state[other.id === "player" ? "player" : "bot"].field[0]).atk, required(other.field[0]).atk);
    assert.deepEqual(state._simUnsupportedActions || [], []);
    applySimulatedActions({ state, actions: [action], selections: { aura: [required(state[ownerId].fieldSpell)] } });
    assert.equal(required(state[ownerId].field[0]).atk, mage.atk, "repeated negation cannot remove the same contribution twice");
  });
}

test("removing aura negation reports unsupported recalculation instead of accepting stale stats", () => {
  const aura = createPlanningCopy().cloneCardForSim(new Card(cardDefinition("Darkness Valley"), "player"));
  aura.effectsNegated = true;
  const state = simulationState({ player: { fieldSpell: aura } });
  applySimulatedActions({ state, actions: [{ type: "add_status", targetRef: "aura", status: "effectsNegated", remove: true }],
    selections: { aura: [aura] } });
  assert.deepEqual(state._simUnsupportedActions, ["add_status:passive_recalculation:field_archetype_aura_buff"]);
});

test("negating passives without a supported contribution map reports an explicit limit", () => {
  const aura = createPlanningCopy().cloneCardForSim(new Card({ ...cardDefinition("Darkness Valley"), effects: [{
    id: "conditional_protection_fixture", timing: "passive", passive: { type: "conditional_status", status: "battleIndestructible" },
  }] }, "player"));
  const state = simulationState({ player: { fieldSpell: aura } });
  applySimulatedActions({ state, actions: [{ type: "add_status", targetRef: "aura", status: "effectsNegated" }],
    selections: { aura: [aura] } });
  assert.deepEqual(state._simUnsupportedActions, ["add_status:passive_recalculation:conditional_status"]);
});
