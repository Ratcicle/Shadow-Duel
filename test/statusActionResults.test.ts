import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { validateActionShape } from "../src/core/actionHandlers/actionCatalog.js";
import { handleAddStatus } from "../src/core/actionHandlers/stats.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { createPlanningCopy } from "../src/core/ai/common/planningCopy.js";
import { applyGenericSimulatedMainPhaseAction } from "../src/core/ai/common/simulation.js";
import { canUseSimulatedEffectUsage } from "../src/core/ai/common/simStateUtils.js";
import { moveCardToZone } from "../src/core/ai/common/zones.js";
import type { ActionOf } from "../src/core/contracts/actions.js";
import type { ResolvedTargetMap } from "../src/core/contracts/actionRuntime.js";
import type { CanonicalSelectionMap } from "../src/core/contracts/selection.js";
import type { EffectDefinition } from "../src/core/contracts/effects.js";
import type { SimulatedActionOptions } from "../src/core/ai/common/simulatedActions/shared.js";
import { addEffectNegation } from "../src/core/effects/negation.js";
import { cardDefinition, unsafeFixture } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";

type RuntimeActionContext = Parameters<ReturnType<typeof createRuntimeGame>["effectEngine"]["applyActions"]>[1];

function setup(t: TestContext, seat: "player" | "bot" = "player") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false });
  t.after(() => game.dispose("status_action_results"));
  game.disablePresentationDelays = true;
  game.turnCounter = 2;
  const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
  const source = new Card({ ...cardDefinition(501), atk: 1000, effects: [] }, seat);
  const fresh = new Card({ ...cardDefinition(502), effects: [] }, opponent.id);
  const negated = new Card({ ...cardDefinition(503), effects: [] }, opponent.id);
  const immune = new Card({ ...cardDefinition(504), effects: [] }, opponent.id);
  const facedown = new Card({ ...cardDefinition(505), effects: [] }, opponent.id);
  Reflect.set(fresh, "cannotBeTargeted", true);
  Reflect.set(immune, "unaffectedByOpponentCardEffects", true);
  facedown.isFacedown = true;
  addEffectNegation(negated, "while_faceup");
  placeFieldCards(owner.field, source);
  placeFieldCards(opponent.field, fresh, negated, immune, facedown);
  const copy = createPlanningCopy();
  const simulatedSource = copy.cloneCardForSim(source);
  const simulatedFresh = copy.cloneCardForSim(fresh);
  const simulatedNegated = copy.cloneCardForSim(negated);
  const simulatedImmune = copy.cloneCardForSim(immune);
  const simulatedFacedown = copy.cloneCardForSim(facedown);
  const state = simulationState({ turnCounter: 2,
    [seat]: { field: [simulatedSource] },
    [opponent.id]: { field: [simulatedFresh, simulatedNegated, simulatedImmune, simulatedFacedown] },
  });
  const context: RuntimeActionContext = { source, player: owner, opponent };
  return { game, owner, opponent, source, fresh, negated, immune, facedown,
    simulatedSource, simulatedFresh, simulatedNegated, simulatedImmune, simulatedFacedown, state, context, seat };
}

const negate: ActionOf<"add_status"> = {
  type: "add_status", status: "effectsNegated", value: true, duration: "until_end_turn",
  targetScope: { owner: "opponent", zones: ["field"], requireFaceup: true,
    filters: { cardKind: "monster" } },
  storeResultAs: "newlyNegated",
};
const grow: ActionOf<"buff_stats_temp"> = {
  type: "buff_stats_temp", targetRef: "self", duration: "while_faceup",
  atkBoostFromContext: { key: "_actionTargets.newlyNegated.length", multiplier: 300 },
};

test("add_status result contract accepts a reusable result reference", () => {
  assert.deepEqual(validateActionShape(negate), { errors: [], warnings: [] });
});

for (const seat of ["player", "bot"] as const) {
  test(`runtime status result counts only new negations and feeds the next stat action (${seat})`, async t => {
    const s = setup(t, seat);
    const result = await s.game.effectEngine.applyActions([negate, grow], s.context, {});
    assert.equal(result.success, true);
    assert.equal(s.source.atk, 1300);
    assert.deepEqual(s.context._actionTargets?.newlyNegated, [s.fresh]);
    assert.equal(s.fresh.effectsNegated, true);
    assert.equal(s.negated.effectsNegationContributions.length, 2);
    assert.equal(s.immune.effectsNegated, false);
    assert.equal(s.facedown.effectsNegated, false);
    await s.game.effectEngine.applyActions([negate, grow], s.context, {});
    assert.equal(s.source.atk, 1300);
    assert.deepEqual(s.context._actionTargets?.newlyNegated, []);
    assert.equal(s.negated.effectsNegationContributions.length, 3);
  });

  test(`simulation status result counts only new negations and feeds the next stat action (${seat})`, t => {
    const s = setup(t, seat);
    const selections: CanonicalSelectionMap = {};
    const options: SimulatedActionOptions = { sourceCard: s.simulatedSource, actionResults: {} };
    assert.equal(applySimulatedActions({ state: s.state, selfId: seat, actions: [negate, grow], selections, options }), true);
    assert.equal(s.simulatedSource.atk, 1300);
    assert.deepEqual(selections.newlyNegated, [s.simulatedFresh]);
    assert.deepEqual(options.actionResults?.newlyNegated, [s.simulatedFresh]);
    assert.equal(s.simulatedNegated.effectsNegationContributions?.length, 2);
    assert.equal(s.simulatedImmune.effectsNegated, false);
    assert.equal(s.simulatedFacedown.effectsNegated, false);
    assert.equal(applySimulatedActions({ state: s.state, selfId: seat, actions: [negate, grow], selections, options }), true);
    assert.equal(s.simulatedSource.atk, 1300);
    assert.deepEqual(selections.newlyNegated, []);
    assert.equal(s.simulatedNegated.effectsNegationContributions?.length, 3);
    assert.deepEqual(s.state._simUnsupportedActions ?? [], []);
  });
}

test("runtime empty status result replaces stale results even when every recipient is immune", async t => {
  const s = setup(t);
  const context: RuntimeActionContext = { ...s.context, _actionTargets: { changed: [s.fresh] } };
  const targets: ResolvedTargetMap = { victim: [s.immune], changed: [s.fresh] };
  await handleAddStatus({ type: "add_status", targetRef: "victim", status: "effectsNegated", storeResultAs: "changed" },
    context, targets, unsafeFixture<Parameters<typeof handleAddStatus>[3]>(s.game.effectEngine,
      "Concrete runtime engine satisfies status/immunity capabilities; strategy projections are unused."));
  assert.deepEqual(context._actionTargets?.changed, []);
  assert.deepEqual(targets.changed, []);
  assert.equal(s.immune.effectsNegated, false);
});

test("simulation empty status result replaces stale results when every recipient is immune", t => {
  const s = setup(t);
  const selections: CanonicalSelectionMap = { victim: [s.simulatedImmune], changed: [s.simulatedFresh] };
  const options: SimulatedActionOptions = { sourceCard: s.simulatedSource, actionResults: { changed: [s.simulatedFresh] } };
  applySimulatedActions({ state: s.state, selfId: s.seat,
    actions: [{ type: "add_status", targetRef: "victim", status: "effectsNegated", storeResultAs: "changed" }], selections, options });
  assert.deepEqual(selections.changed, []);
  assert.deepEqual(options.actionResults?.changed, []);
  assert.equal(s.simulatedImmune.effectsNegated, false);
});

test("runtime status input and result can share the same reference", async t => {
  const s = setup(t);
  const action: ActionOf<"add_status"> = {
    type: "add_status", targetRef: "changed", status: "effectsNegated", storeResultAs: "changed",
  };
  const result = await s.game.effectEngine.applyActions([action], s.context, { changed: [s.negated, s.source] });
  assert.equal(result.success, true);
  assert.equal(s.source.effectsNegated, true);
  assert.equal(s.negated.effectsNegationContributions.length, 2);
  assert.deepEqual(s.context._actionTargets?.changed, [s.source]);
});

test("simulation status input and result can share the same reference", t => {
  const s = setup(t);
  const selections: CanonicalSelectionMap = { changed: [s.simulatedNegated, s.simulatedSource] };
  const options: SimulatedActionOptions = { sourceCard: s.simulatedSource, actionResults: {} };
  const result = applySimulatedActions({ state: s.state, selfId: s.seat,
    actions: [{ type: "add_status", targetRef: "changed", status: "effectsNegated", storeResultAs: "changed" }],
    selections, options });
  assert.equal(result, true);
  assert.equal(s.simulatedSource.effectsNegated, true);
  assert.equal(s.simulatedNegated.effectsNegationContributions?.length, 2);
  assert.deepEqual(selections.changed, [s.simulatedSource]);
  assert.deepEqual(options.actionResults?.changed, [s.simulatedSource]);
});

for (const value of [true, false, "remove"] as const) {
  test(`generic status results contain only effective public changes (${value})`, async t => {
    const s = setup(t);
    Reflect.set(s.source, "piercing", true);
    Reflect.set(s.source, "piercingGrantedByEffect", true);
    Reflect.set(s.simulatedSource, "piercing", true);
    Reflect.set(s.simulatedSource, "piercingGrantedByEffect", true);
    const action: ActionOf<"add_status"> = {
      type: "add_status", targetRef: "self", status: "piercing", storeResultAs: "changed",
      ...(value === "remove" ? { remove: true } : { value }),
    };
    const context: RuntimeActionContext = { ...s.context };
    const selections: CanonicalSelectionMap = {};
    await s.game.effectEngine.applyActions([action], context, {});
    applySimulatedActions({ state: s.state, selfId: s.seat, actions: [action], selections,
      options: { sourceCard: s.simulatedSource } });
    assert.deepEqual(context._actionTargets?.changed, value === true ? [] : [s.source]);
    assert.deepEqual(selections.changed, value === true ? [] : [s.simulatedSource]);
    await s.game.effectEngine.applyActions([action], context, {});
    applySimulatedActions({ state: s.state, selfId: s.seat, actions: [action], selections,
      options: { sourceCard: s.simulatedSource } });
    assert.deepEqual(context._actionTargets?.changed, []);
    assert.deepEqual(selections.changed, []);
  });
}

for (const clear of ["false", "remove"] as const) {
  const action: ActionOf<"add_status"> = {
    type: "add_status", targetRef: "self", status: "effectsNegated", storeResultAs: "changed",
    ...(clear === "remove" ? { remove: true } : { value: false }),
  };
  test(`runtime clearing negation never counts as a newly negated card (${clear})`, async t => {
    const s = setup(t);
    addEffectNegation(s.source, "while_faceup");
    await s.game.effectEngine.applyActions([action], s.context, {});
    assert.equal(s.source.effectsNegated, false);
    assert.equal(s.source.effectsNegationContributions.length, 0);
    assert.deepEqual(s.context._actionTargets?.changed, []);
  });
  test(`simulation clearing negation never counts as a newly negated card (${clear})`, t => {
    const s = setup(t);
    addEffectNegation(s.simulatedSource, "while_faceup");
    const selections: CanonicalSelectionMap = {};
    applySimulatedActions({ state: s.state, selfId: s.seat, actions: [action], selections,
      options: { sourceCard: s.simulatedSource } });
    assert.equal(s.simulatedSource.effectsNegated, false);
    assert.equal(s.simulatedSource.effectsNegationContributions?.length, 0);
    assert.deepEqual(selections.changed, []);
  });
}

test("runtime field-scope stat buffs bypass targeting protection and retain whole-effect immunity", async t => {
  const s = setup(t);
  s.fresh.atk = s.immune.atk = 1000;
  await s.game.effectEngine.applyActions([{ type: "buff_stats_temp", atkBoost: 300,
    targetScope: { owner: "opponent", zones: ["field"], requireFaceup: true } }], s.context, {});
  assert.equal(s.fresh.atk, 1300);
  assert.equal(s.immune.atk, 1000);
});

test("simulation distinguishes field-scope stat buffs from declared targeting", t => {
  const s = setup(t);
  s.simulatedFresh.atk = s.simulatedImmune.atk = 1000;
  applySimulatedActions({ state: s.state, selfId: s.seat,
    actions: [{ type: "buff_stats_temp", atkBoost: 300, targetScope: { owner: "opponent", zones: ["field"], requireFaceup: true } }],
    selections: {}, options: { sourceCard: s.simulatedSource } });
  assert.equal(s.simulatedFresh.atk, 1300);
  assert.equal(s.simulatedImmune.atk, 1000);
  applySimulatedActions({ state: s.state, selfId: s.seat,
    actions: [{ type: "buff_stats_temp", targetRef: "victim", atkBoost: 300 }],
    selections: { victim: [s.simulatedFresh] }, options: { sourceCard: s.simulatedSource } });
  assert.equal(s.simulatedFresh.atk, 1300);
});

for (const presence of ["unchanged", "left", "left and returned"] as const) {
  test(`generic hand ignition binds its source presence before committed costs (${presence})`, () => {
    const effect: EffectDefinition = {
      id: "generic_source_bound_hand_ignition", timing: "ignition", activationZones: ["hand"],
      requiresSourceAtResolution: true, oncePerTurn: true, oncePerTurnName: "generic_source_bound_hand_ignition",
      targets: [{ id: "payment", intent: "cost", owner: "self", zone: "hand", excludeSelf: true,
        count: { min: 1, max: 1 } }],
      activationCosts: [{ type: "move", targetRef: "payment", fromZone: "hand", to: "graveyard",
        requireDestination: true, contextLabel: "discard" }],
      actions: [{ type: "special_summon_from_zone", zone: "hand", requireSource: true, position: "attack",
        haltOnFailure: true }],
    };
    const source = simulationCard(new Card({ ...cardDefinition(501), effects: [effect] }, "bot"));
    const payment = simulationCard(new Card({ ...cardDefinition(502), effects: [] }, "bot"));
    const state = simulationState({ _isPerspectiveState: true, phase: "main1", turn: "bot", turnCounter: 4,
      bot: { hand: [source, payment] } });
    let committedCostEvents = 0;
    applyGenericSimulatedMainPhaseAction(state, { type: "handIgnition", index: 0, cardId: 501, effectId: effect.id }, {
      enableSimulatedEvents: true,
      onSimulatedEvent: (event, payload) => {
        if (event !== "card_to_grave" || Reflect.get(payload, "card") !== payment) return;
        committedCostEvents++;
        if (presence === "unchanged") return;
        assert.equal(moveCardToZone(state.bot, source, "graveyard", state.bot, { state }), true);
        if (presence === "left and returned") {
          assert.equal(moveCardToZone(state.bot, source, "hand", state.bot, { state }), true);
        }
      },
    });
    assert.equal(committedCostEvents, 1);
    assert.ok(state.bot.graveyard.includes(payment));
    assert.equal(state.bot.field.includes(source), presence === "unchanged");
    assert.equal(state.bot.hand.includes(source), presence === "left and returned");
    assert.equal(state.bot.graveyard.includes(source), presence === "left");
    assert.equal(canUseSimulatedEffectUsage(state, effect, source), false);
    assert.deepEqual(state._simUnsupportedActions ?? [], []);
  });
}
