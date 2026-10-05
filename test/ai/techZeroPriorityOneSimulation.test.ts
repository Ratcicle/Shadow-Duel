import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { selectSimulatedTargets } from "../../src/core/ai/common/targetSelection.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import type { SimulatedActionOptions, SimulatedRuntimeState } from "../../src/core/ai/common/simulatedActions/shared.js";
import type { ActionOf } from "../../src/core/contracts/actions.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";

function scenario(actor: "player" | "bot") {
  const player = (id: "player" | "bot") => ({ id, lp: 8000, hand: [], deck: [], field: [], graveyard: [],
    banished: [], extraDeck: [], spellTrap: [], fieldSpell: null, summonCount: 0, additionalNormalSummons: 0 });
  const state = unsafeFixture<SimulatedRuntimeState>({ bot: player(actor), player: player(actor === "bot" ? "player" : "bot"),
    turn: actor, phase: "main1", turnCounter: 4, _isPerspectiveState: true }, "Both physical seats in planning perspective slots");
  const copy = createPlanningCopy();
  const make = (id: number, owner: string = actor) => copy.cloneCardForSim(new Card(cardDefinition(id), owner === "player" ? "player" : "bot"));
  const source = make(517);
  state.bot.field.push(source);
  return { state, make, source };
}

for (const actor of ["player", "bot"] as const) {
  test(`non-target status scope respects effect immunity but passes targeting protection (${actor})`, () => {
    const { state, make, source } = scenario(actor);
    const immune = make(275, state.player.id);
    const protectedTarget = make(501, state.player.id);
    Reflect.set(protectedTarget, "cannotBeTargeted", true);
    state.player.field.push(immune, protectedTarget);
    const backrow = make(518, state.player.id);
    backrow.unaffectedByOpponentCardEffects = true;
    state.player.spellTrap.push(backrow);
    assert.equal(applySimulatedActions({ actions: [{ type: "add_status", targetScope: { owner: "opponent", zones: ["field", "spellTrap"] },
      status: "effectsNegated" }], selections: {}, state, selfId: "bot", options: { sourceCard: source } }), true);
    assert.notEqual(immune.effectsNegated, true);
    assert.equal(protectedTarget.effectsNegated, true);
    assert.notEqual(backrow.effectsNegated, true);
  });

  test(`explicit empty status reference never falls back to own field (${actor})`, () => {
    const { state, source, make } = scenario(actor);
    const other = make(501);
    state.bot.field.push(other);
    applySimulatedActions({ actions: [{ type: "add_status", targetRef: "missing", status: "effectsNegated" }], selections: { missing: [] },
      state, selfId: "bot", options: { sourceCard: source } });
    assert.notEqual(source.effectsNegated, true);
    applySimulatedActions({ actions: [{ type: "add_status", status: "piercing" }], selections: {}, state, selfId: "bot", options: { sourceCard: source } });
    assert.equal(source.piercing, true);
    assert.equal(other.piercing, false);
  });

  test(`status reference intent bypasses targeting protection while payment bypass stays scoped (${actor})`, () => {
    const { state, source, make } = scenario(actor);
    const victim = make(501, state.player.id);
    Reflect.set(victim, "cannotBeTargeted", true);
    state.player.field.push(victim);
    const action: ActionOf<"add_status"> = { type: "add_status", targetRef: "recipient", status: "piercing" };
    const selections = { recipient: [victim] };
    applySimulatedActions({ actions: [action], selections, state, options: { sourceCard: source } });
    assert.equal(victim.piercing, false);
    const effect: EffectDefinition = { id: "reference", timing: "ignition", activationZones: ["field"],
      targets: [{ id: "recipient", owner: "opponent", zone: "field", intent: "reference" }], actions: [action] };
    applySimulatedActions({ actions: [action], selections, state, options: { sourceCard: source, effect } });
    assert.equal(victim.piercing, true);
    victim.unaffectedByOtherCardEffects = true;
    const costEffect: EffectDefinition = { ...effect, targets: [{ id: "recipient", owner: "opponent", zone: "field", intent: "cost" }],
      activationCosts: [action] };
    const negation: ActionOf<"add_status"> = { ...action, status: "effectsNegated" };
    applySimulatedActions({ actions: [negation], selections, state,
      options: { sourceCard: source, effect: costEffect, payingActivationCosts: false } });
    assert.notEqual(victim.effectsNegated, true);
    applySimulatedActions({ actions: [negation], selections, state,
      options: { sourceCard: source, effect: costEffect, payingActivationCosts: true } });
    assert.equal(victim.effectsNegated, true);
  });

  test(`skip_action preflights every scoped recipient (${actor})`, () => {
    const { state, make, source } = scenario(actor);
    const normal = make(501, state.player.id);
    const immune = make(275, state.player.id);
    state.player.field.push(normal, immune);
    const action = unsafeFixture<ActionOf<"add_status">>({ type: "add_status", targetScope: { owner: "opponent", zone: "field" },
      status: "effectsNegated", immunityMode: "skip_action" }, "Existing runtime immunity policy projected onto generic simulation action");
    applySimulatedActions({ actions: [action], selections: {}, state, selfId: "bot", options: { sourceCard: source } });
    assert.notEqual(normal.effectsNegated, true);
    assert.notEqual(immune.effectsNegated, true);
  });

  test(`paid reference keeps field Level and name for Battle Mage resolution (${actor})`, () => {
    const { state, make, source } = scenario(actor);
    const cost = make(501);
    cost.originalLevel = cost.level ?? null;
    cost.level = 3;
    state.bot.field.push(cost);
    const sameName = make(501);
    sameName.level = 3;
    const wrongLevel = make(504);
    wrongLevel.level = 1;
    const valid = make(503);
    state.bot.graveyard.push(sameName, wrongLevel, valid);
    const move: ActionOf<"move"> = { type: "move", targetRef: "cost", fromZone: "field", to: "graveyard", requireAll: true,
      requireDestination: true, capturePaidReference: true };
    const effect: EffectDefinition = { id: "paid_reference", timing: "ignition", activationZones: ["field"], activationCosts: [move], actions: [] };
    const options: SimulatedActionOptions = { sourceCard: source, effect, costPayment: { status: "paid", actions: [] } };
    assert.equal(applySimulatedActions({ actions: [move], selections: { cost: [cost] }, state, selfId: "bot", options }), true);
    assert.equal(cost.level, 1);
    assert.deepEqual(options.costPayment?.paidReferences?.cost, [{ cardDuelCardId: cost.duelCardId ?? null, name: cost.name, level: 3 }]);
    const selected = selectSimulatedTargets({ targets: [{ id: "revive", owner: "self", zone: "graveyard", cardKind: "monster",
      excludeNameRef: "cost", compareAttribute: { attr: "level", ref: "cost", op: "eq" }, count: { min: 1, max: 1 } }],
      actions: [{ type: "special_summon_from_zone", targetRef: "revive", zone: "graveyard" }], state, sourceCard: source,
      selfId: "bot", selections: { cost: [cost] }, options });
    assert.deepEqual(selected.revive, [valid]);
    cost.name = "changed after payment";
    assert.equal(required(options.costPayment?.paidReferences?.cost?.[0]).name, sameName.name);
  });

  test(`paid reference capture requires the actual payment stage (${actor})`, () => {
    const { state, source, make } = scenario(actor);
    const moved = make(501);
    state.bot.field.push(moved);
    const move: ActionOf<"move"> = { type: "move", targetRef: "selected", to: "graveyard", capturePaidReference: true };
    const effect: EffectDefinition = { id: "stage", timing: "ignition", activationZones: ["field"], activationCosts: [move], actions: [move] };
    const options: SimulatedActionOptions = { sourceCard: source, effect, payingActivationCosts: false, costPayment: { status: "paid", actions: [] } };
    applySimulatedActions({ actions: [move], selections: { selected: [moved] }, state, options });
    assert.equal(options.costPayment?.paidReferences, undefined);
    assert.ok(state.bot.graveyard.includes(moved));
  });

  test(`Battle Mage public simulation pays the cost before delayed revive choice (${actor})`, () => {
    const { state, make } = scenario(actor);
    const mage = make(512);
    const cost = make(501);
    cost.originalLevel = cost.level ?? null;
    cost.level = 3;
    const valid = make(503);
    const wrongLevel = make(504);
    valid.properSummonEstablished = true;
    wrongLevel.level = 1;
    mage.fieldSlot = 0;
    cost.fieldSlot = 1;
    state.bot.field = [mage, cost];
    state.bot.graveyard.push(valid, wrongLevel);
    const effectIndex = required(mage.effects).findIndex(effect => effect.id === "tech_zero_battle_mage_recycle_revive");
    assert.ok(effectIndex >= 0);
    applyGenericSimulatedMainPhaseAction(state, { type: "monsterEffect", fieldIndex: 0, effectId: "tech_zero_battle_mage_recycle_revive" });
    assert.deepEqual(state.bot.field.map(card => card.id), [mage.id, valid.id]);
    assert.equal(cost.level, 1);
    assert.ok(state.bot.graveyard.includes(cost));
    assert.ok(state.bot.graveyard.includes(wrongLevel));
  });

  for (const kind of ["redirect", "token"] as const) {
    test(`Reactor send-to-Graveyard cost rejects ${kind} before resolution (${actor})`, () => {
      const { state, make } = scenario(actor);
      const reactor = make(515);
      state.bot.field = [reactor];
      if (kind === "redirect") reactor.banishWhenLeavesField = true;
      else reactor.isToken = true;
      const move: ActionOf<"move"> = { type: "move", targetRef: "self", fromZone: "field", to: "graveyard", requireAll: true, requireDestination: true };
      const effect: EffectDefinition = { id: "reactor_cost", timing: "ignition", activationZones: ["field"], activationCosts: [move], actions: [] };
      assert.equal(applySimulatedActions({ actions: [move], selections: {}, state, selfId: "bot",
        options: { sourceCard: reactor, effect, costPayment: { status: "paid", actions: [] } } }), false);
      assert.deepEqual(state.bot.field, [reactor]);
      assert.deepEqual(state.bot.graveyard, []);
      assert.deepEqual(state.bot.banished, []);
    });
  }
}
