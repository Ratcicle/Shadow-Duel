import { cleanupSimulatedEndTurn } from "../../src/core/ai/common/simulatedActions/lifecycle.js";
import { hasPendingPassiveRestoration } from "../../src/core/ai/common/planningCopy.js";
import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { refreshSimulatedFieldAuras, moveCardToZone } from "../../src/core/ai/common/zones.js";
import { simulateMainPhaseAction } from "../../src/core/ai/shadowheart/simulation.js";
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

test("Shadow-Heart placement and later actions share one negatable aura contribution", () => {
  const copy = createPlanningCopy();
  const valley = copy.cloneCardForSim(new Card(cardDefinition("Darkness Valley"), "bot"));
  const mage = copy.cloneCardForSim(new Card(cardDefinition("Shadow-Heart Void Mage"), "bot"));
  const state = simulationState({ _isPerspectiveState: true, bot: { hand: [valley], field: [mage] } });
  simulateMainPhaseAction(state, { type: "spell", cardId: valley.id, cardName: valley.name, index: 0 });
  assert.equal(mage.atk, required(mage.baseAtk) + 300);
  applySimulatedActions({ state, actions: [{ type: "draw", amount: 0 }] });
  assert.equal(mage.atk, required(mage.baseAtk) + 300);
  applySimulatedActions({ state, actions: [{ type: "add_status", targetRef: "aura", status: "effectsNegated" }],
    selections: { aura: [required(state.bot.fieldSpell)] } });
  assert.equal(mage.atk, mage.baseAtk);
});

test("removing aura negation restores the continuous contribution", () => {
  const aura = createPlanningCopy().cloneCardForSim(new Card(cardDefinition("Darkness Valley"), "player"));
  aura.effectsNegated = true;
  const target = createPlanningCopy().cloneCardForSim(new Card(cardDefinition("Shadow-Heart Void Mage"), "player"));
  const state = simulationState({ player: { fieldSpell: aura, field: [target] } });
  applySimulatedActions({ state, actions: [{ type: "add_status", targetRef: "aura", status: "effectsNegated", remove: true }],
    selections: { aura: [aura] } });
  assert.equal(target.atk, required(target.baseAtk) + 300);
  assert.deepEqual(state._simUnsupportedActions || [], []);
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

for (const seat of ["bot", "player"] as const) {
  for (const change of ["face", "negation", "control"] as const) {
    test(`B27 suppressed aura reconciles ${change} before callbacks (${seat})`, () => {
      const copy = createPlanningCopy();
      const source = copy.cloneCardForSim(new Card({ ...cardDefinition("Shadow-Heart Void Mage"), effects: [{
        id: "b27_visible_aura", timing: "passive", requireZone: "field", passive: {
          type: "field_archetype_aura_buff", archetype: "Shadow-Heart", amount: 300, stats: ["atk"], targetOwners: ["self"],
        },
      }] }, seat));
      const target = copy.cloneCardForSim(new Card(cardDefinition("Shadow-Heart Scale Dragon"), seat));
      const witness = copy.cloneCardForSim(new Card(cardDefinition("Shadow-Heart Scale Dragon"), seat));
      const state = simulationState({ [seat]: { field: [source, target, witness] } });
      refreshSimulatedFieldAuras(state);
      applySimulatedActions({ state, selfId: seat, selections: { target: [target] },
        actions: [{ type: "modify_stats_temp", targetRef: "target", atkFactor: 0 }] });
      assert.equal(target.atk, 0);
      assert.equal(witness.atk, 3300);
      const action: ActionOf<"set_facedown_defense"> | ActionOf<"add_status"> | ActionOf<"take_control"> = change === "face"
        ? { type: "set_facedown_defense", targetRef: "source" } : change === "negation"
          ? { type: "add_status", targetRef: "source", status: "effectsNegated" }
          : { type: "take_control", targetRef: "source" };
      const events: string[] = [];
      applySimulatedActions({ state, selfId: seat === "bot" ? "player" : "bot", actions: [action], selections: { source: [source] },
        options: { emitSimulatedEvent(event) {
          events.push(event);
          assert.equal(witness.atk, 3000, "callbacks see the reconciled aura");
          assert.equal(target.atk, 0);
        } } });
      assert.equal(witness.atk, 3000);
      assert.equal(hasPendingPassiveRestoration(state), false);
      assert.deepEqual(state._simUnsupportedActions || [], []);
      if (change !== "negation") assert.equal(events.length, 1);
      cleanupSimulatedEndTurn(state);
      assert.equal(target.atk, change === "negation" ? 3300 : 3000);
    });
  }
}

test("B27 removes a proven stale contribution after its source identity was cleared", () => {
  const copy = createPlanningCopy();
  const source = copy.cloneCardForSim(new Card(cardDefinition("Darkness Valley"), "bot"));
  source.fieldPresenceId = "prior-presence";
  const target = copy.cloneCardForSim(new Card(cardDefinition("Shadow-Heart Scale Dragon"), "bot"));
  const state = simulationState({ bot: { field: [target], fieldSpell: source } });
  refreshSimulatedFieldAuras(state);
  assert.equal(target.atk, 3300);
  source.fieldPresenceId = null;
  state.bot.fieldSpell = null;
  state.bot.graveyard.push(source);
  refreshSimulatedFieldAuras(state);
  refreshSimulatedFieldAuras(state);
  assert.equal(target.atk, 3000);
  assert.equal(target.dynamicBuffs, null);
});

test("B27 a source outside its declared passive zone cannot reapply the aura", () => {
  const copy = createPlanningCopy();
  const source = copy.cloneCardForSim(new Card(cardDefinition("Darkness Valley"), "bot"));
  const target = copy.cloneCardForSim(new Card(cardDefinition("Shadow-Heart Scale Dragon"), "bot"));
  const state = simulationState({ bot: { field: [target], fieldSpell: source } });
  refreshSimulatedFieldAuras(state);
  assert.equal(target.atk, 3300);
  assert.equal(moveCardToZone(state.bot, source, "spellTrap", state.bot, { state }), true);
  assert.equal(target.atk, 3000);
  refreshSimulatedFieldAuras(state);
  assert.equal(target.atk, 3000);
});
