import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../../src/core/Card.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { getCounterValue } from "../../src/core/ai/common/counters.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { captureSimulatedReferences } from "../../src/core/ai/common/simulatedActions/shared.js";
import type { ActionOf, CardAction } from "../../src/core/contracts/actions.js";
import type { EffectDefinition, EffectTarget } from "../../src/core/contracts/effects.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { simulationState } from "../helpers/simulation.js";

type Seat = "player" | "bot";
function resolutionEffect(actions: readonly CardAction[], targets: readonly EffectTarget[] = []): EffectDefinition {
  return { id: "resolution_choice", timing: "ignition", activationZones: ["field"], actions, targets };
}
const choice = (actions: readonly CardAction[] = [{ type: "add_counter", targetRef: "chosen", counterType: "spore", amount: 1 }], max = 1): ActionOf<"optional_target_actions"> => ({
  type: "optional_target_actions", optional: false, allowCancel: false,
  targets: [{ id: "chosen", owner: "opponent", zone: "field", requireFaceup: true, intent: "reference", count: { min: 1, max } }],
  actions,
});
function setup(t: TestContext, seat: Seat, sourceId = 405) {
  const game = createRuntimeGame({ laboratoryMode: true, disableChains: true });
  t.after(() => game.dispose());
  game.turn = seat; game.phase = "main1"; game.turnCounter = 3;
  game.player.controllerType = game.bot.controllerType = "ai";
  const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
  const source = new Card({ ...cardDefinition(sourceId), effects: [] }, owner.id);
  const first = new Card({ ...cardDefinition(1), effects: [] }, opponent.id);
  const second = new Card({ ...cardDefinition(1), effects: [] }, opponent.id);
  placeFieldCards(owner.field, source); placeFieldCards(opponent.field, first, second);
  const clone = () => {
    const copy = createPlanningCopy();
    return simulationState({ turn: seat, phase: "main1", turnCounter: 3,
      [seat]: { field: owner.field.map(copy.cloneCardForSim), graveyard: owner.graveyard.map(copy.cloneCardForSim), hand: owner.hand.map(copy.cloneCardForSim) },
      [opponent.id]: { field: opponent.field.map(copy.cloneCardForSim), hand: opponent.hand.map(copy.cloneCardForSim) },
    });
  };
  return { game, owner, opponent, source, first, second, clone };
}

const realEffects = [
  [405, "bloomrot_carrioncap_battle_destroy_spore_counter"],
  [407, "bloomrot_gravecap_widow_destroyed_infected_spore"],
  [408, "bloomrot_ancient_husk_ignition_spore_counters"],
  [408, "bloomrot_ancient_husk_destroyed_infected_spore"],
  [413, "bloomrot_fungal_armor_grave_spore_counter"],
] as const;

for (const seat of ["player", "bot"] as const) {
  for (const [id, effectId] of realEffects) for (const immunity of ["target", "effect", "partial"] as const) {
    test(`T01 real ${effectId} runtime/simulation oracle with ${immunity} immunity (${seat})`, async t => {
      const { game, owner, opponent, source, first, second, clone } = setup(t, seat, id);
      const effect = required(cardDefinition(id).effects?.find(candidate => candidate.id === effectId));
      const action = required(effect.actions?.find(candidate => candidate.type === "optional_target_actions"));
      if (action.type !== "optional_target_actions") assert.fail("migrated declarations must compose a local choice");
      const definition = required(action.targets[0]);
      if (immunity === "target") Object.assign(first, { cannotBeTargeted: true });
      else first.immuneToOpponentEffectsUntilTurn = 3;
      if (id === 413) {
        owner.field.splice(owner.field.indexOf(source), 1);
        owner.graveyard.push(source); source.fieldSlot = null;
      }
      const chosen = immunity === "partial" && definition.count?.max === 2 ? [first, second] : [first];
      const plan = { selections: { [definition.id]: chosen.map(card => card.instanceId) } };
      const state = clone(), other = seat === "player" ? "bot" : "player";
      const simSource = required([...state[seat].field, ...state[seat].graveyard].find(card => card.instanceId === source.instanceId));
      let targeted = 0;
      game.on("effect_targeted", () => { targeted++; });
      const projected = applySimulatedActions({ state, selfId: seat, actions: effect.actions, options: { sourceCard: simSource, effect, activationContext: { decisions: plan } } });
      const live = await game.effectEngine.applyActions(effect.actions || [], { source, effect, player: owner, opponent, activationContext: { decisions: plan } }, {});
      assert.equal(projected, typeof live === "object" && live !== null ? live.success : live);
      assert.deepEqual(state[other].field.map(card => getCounterValue(card, "spore")), [first, second].map(card => card.getCounter("spore")));
      assert.equal(first.getCounter("spore"), immunity === "target" ? 1 : 0);
      assert.equal(second.getCounter("spore"), chosen.length === 2 ? 1 : 0, "immune chosen cards are not replaced by another candidate");
      assert.equal(targeted, 0);
      assert.deepEqual(state._simUnsupportedActions ?? [], []);
    });
  }
  test(`T01 resolution choice obeys whole-effect immunity and stops continuation (${seat})`, async t => {
    const { game, owner, opponent, source, first, clone } = setup(t, seat);
    first.immuneToOpponentEffectsUntilTurn = 3;
    const actions: readonly CardAction[] = [choice(), { type: "heal", amount: 17 }];
    const effect = resolutionEffect(actions);
    const plan = { selections: { chosen: [first.instanceId] } };
    const state = clone(), simSource = required(state[seat].field[0]), simFirst = required(state[opponent.id === "player" ? "player" : "bot"].field[0]);
    const result = applySimulatedActions({ state, selfId: seat, actions, options: { sourceCard: simSource, effect, activationContext: { decisions: plan } } });
    const live = await game.effectEngine.applyActions(actions, { source, effect, player: owner, opponent, activationContext: { decisions: plan } }, {});
    assert.equal(result, false);
    assert.equal(typeof live === "object" && live !== null ? live.success : live, false);
    assert.deepEqual([getCounterValue(simFirst, "spore"), state[seat].lp], [first.getCounter("spore"), owner.lp]);
    assert.equal(owner.lp, 8000);
  });

  test(`T01 local choice shadows parent references without creating a presence binding (${seat})`, () => {
    const copy = createPlanningCopy(), other = seat === "player" ? "bot" : "player";
    const source = copy.cloneCardForSim(new Card(cardDefinition(405), seat));
    const selected = copy.cloneCardForSim(new Card(cardDefinition(1), other));
    const actions: readonly CardAction[] = [choice([
      { type: "return_to_hand", targetRef: "chosen" },
      { type: "add_counter", targetRef: "chosen", counterType: "spore", amount: 1 },
    ])];
    const effect = resolutionEffect(actions, [{ id: "chosen", intent: "reference", owner: "opponent", zone: "field" }]);
    const before = JSON.stringify(effect);
    const references = { chosen: [] };
    const state = simulationState({ [seat]: { field: [source] }, [other]: { field: [selected] } });
    assert.equal(applySimulatedActions({ state, selfId: seat, actions, selections: { chosen: [] }, options: {
      sourceCard: source, effect, referenceSnapshots: references,
      activationContext: { decisions: { selections: { chosen: [required(selected.instanceId)] } } },
    } }), true);
    assert.deepEqual(state[other].hand, [selected]);
    assert.equal(getCounterValue(selected, "spore"), 1, "choice identity persists as the runtime action map; it acquires no new field binding");
    assert.equal(JSON.stringify(effect), before);
    assert.deepEqual(references, { chosen: [] });
  });

  for (const exactCount of [undefined, 1, 2]) test(`T01 required choices use runtime minimum or exact ${exactCount} instances (${seat})`, async t => {
    const { game, owner, opponent, source, first, second, clone } = setup(t, seat);
    const actions = [choice(undefined, 2)];
    const effect = resolutionEffect(actions);
    const activationContext = exactCount === undefined ? {} : { decisions: { selections: { chosen: [second, first].slice(0, exactCount).map(card => card.instanceId) } } };
    const state = clone();
    assert.equal(applySimulatedActions({ state, selfId: seat, actions, options: { sourceCard: required(state[seat].field[0]), effect, activationContext } }), true);
    await game.effectEngine.applyActions(actions, { source, effect, player: owner, opponent, activationContext }, {});
    assert.deepEqual(state[opponent.id === "player" ? "player" : "bot"].field.map(card => getCounterValue(card, "spore")), [first, second].map(card => card.getCounter("spore")));
    assert.equal(first.getCounter("spore") + second.getCounter("spore"), exactCount ?? 1);
  });

  for (const invalid of ["stale", "duplicate", "wrong_zone", "empty", "too_many"] as const) test(`T01 invalid exact ${invalid} choice stops instead of falling back (${seat})`, () => {
    const copy = createPlanningCopy(), other = seat === "player" ? "bot" : "player";
    const source = copy.cloneCardForSim(new Card(cardDefinition(405), seat));
    const selected = copy.cloneCardForSim(new Card(cardDefinition(1), other));
    const second = copy.cloneCardForSim(new Card(cardDefinition(1), other));
    const id = required(selected.instanceId), secondId = required(second.instanceId);
    const ids = invalid === "stale" ? ["missing"] : invalid === "duplicate" ? [id, id] : invalid === "empty" ? [] : invalid === "too_many" ? [id, secondId] : [id];
    const state = simulationState({ [seat]: { field: [source] }, [other]: { field: invalid === "wrong_zone" ? [second] : [selected, second], hand: invalid === "wrong_zone" ? [selected] : [] } });
    const actions: readonly CardAction[] = [choice(), { type: "heal", amount: 17 }];
    assert.equal(applySimulatedActions({ state, selfId: seat, actions, options: { sourceCard: source,
      effect: resolutionEffect(actions), activationContext: { decisions: { selections: { chosen: ids } } },
    } }), false);
    assert.equal(state[seat].lp, 8000);
    assert.equal(getCounterValue(selected, "spore") + getCounterValue(second, "spore"), 0);
    assert.ok(state._simUnsupportedActions?.includes("exact_selection:chosen"));
  });

  for (const optional of [true, false]) test(`T01 missing candidates ${optional ? "skip an optional" : "fail a required"} choice (${seat})`, () => {
    const source = createPlanningCopy().cloneCardForSim(new Card(cardDefinition(405), seat));
    const state = simulationState({ [seat]: { field: [source] } });
    const actions: readonly CardAction[] = [{ ...choice(), optional }, { type: "heal", amount: 17 }];
    assert.equal(applySimulatedActions({ state, selfId: seat, actions, options: { sourceCard: source, effect: resolutionEffect(actions) } }), optional);
    assert.equal(state[seat].lp, 8000 + (optional ? 17 : 0));
    assert.deepEqual(state._simUnsupportedActions ?? [], []);
  });

  test(`T01 nested failure and unknown draw stop the enclosing action sequence (${seat})`, () => {
    for (const draw of [false, true]) {
      const copy = createPlanningCopy(), other = seat === "player" ? "bot" : "player";
      const source = copy.cloneCardForSim(new Card(cardDefinition(405), seat));
      const selected = copy.cloneCardForSim(new Card(cardDefinition(1), other));
      selected.battlePositionLocked = true;
      const state = simulationState({ [seat]: { field: [source], deck: [copy.cloneCardForSim(new Card(cardDefinition(1), seat))] }, [other]: { field: [selected] } });
      const actions: readonly CardAction[] = [choice(draw ? [{ type: "draw_and_summon", optional: true }] : [{ type: "switch_position", targetRef: "chosen" }]), { type: "heal", amount: 17 }];
      assert.equal(applySimulatedActions({ state, selfId: seat, actions, options: { sourceCard: source, effect: resolutionEffect(actions) } }), false);
      assert.equal(state[seat].lp, 8000);
      if (draw) assert.equal(state._simRequiresReplan, true);
    }
  });

  test(`T01 an optional wrapper cannot continue through a new knowledge boundary (${seat})`, () => {
    for (const previousReplan of [false, true]) {
      const copy = createPlanningCopy(), other = seat === "player" ? "bot" : "player";
      const source = copy.cloneCardForSim(new Card(cardDefinition(405), seat));
      const selected = copy.cloneCardForSim(new Card(cardDefinition(1), other));
      const drawn = copy.cloneCardForSim(new Card(cardDefinition(1), seat));
      const state = simulationState({ [seat]: { field: [source], deck: [drawn] }, [other]: { field: [selected] },
        _simRequiresReplan: previousReplan, _simUnknownDrawCount: previousReplan ? 1 : 0 });
      const actions: readonly CardAction[] = [{ ...choice([{ type: "draw_and_summon", optional: true }]), optional: true }, { type: "heal", amount: 17 }];
      assert.equal(applySimulatedActions({ state, selfId: seat, actions, options: { sourceCard: source, effect: resolutionEffect(actions) } }), false);
      assert.equal(state[seat].lp, 8000);
      assert.equal(state[seat].hand.length, 1);
      assert.equal(Reflect.get(required(state[seat].hand[0]), "_simUnknownDraw"), true);
      assert.equal(state._simRequiresReplan, true);
    }
    const copy = createPlanningCopy(), other = seat === "player" ? "bot" : "player";
    const source = copy.cloneCardForSim(new Card(cardDefinition(405), seat));
    const selected = copy.cloneCardForSim(new Card(cardDefinition(1), other));
    selected.battlePositionLocked = true;
    const state = simulationState({ [seat]: { field: [source] }, [other]: { field: [selected] }, _simRequiresReplan: true, _simUnknownDrawCount: 1 });
    const actions: readonly CardAction[] = [{ ...choice([{ type: "switch_position", targetRef: "chosen" }]), optional: true }, { type: "heal", amount: 17 }];
    assert.equal(applySimulatedActions({ state, selfId: seat, actions, options: { sourceCard: source, effect: resolutionEffect(actions) } }), true,
      "a prior replan flag does not turn this ordinary optional failure into a new knowledge boundary");
    assert.equal(state[seat].lp, 8017);
  });

  for (const amount of [0, 1]) for (const scoped of [false, true]) test(`T01 add_counter returns runtime success with amount=${amount}, scope=${scoped} (${seat})`, async t => {
    const { game, owner, opponent, source, clone } = setup(t, seat);
    opponent.field.splice(0);
    const state = clone();
    const action: CardAction = { type: "add_counter", counterType: "spore",
      ...(amount === 0 ? { amountFromFieldCount: { owner: "opponent", zone: "field", multiplier: 1 } } : { amount }),
      ...(scoped ? { targetScope: { owner: "opponent", zone: "field" } } : { targetRef: "missing" }) };
    const actions: readonly CardAction[] = [action, { type: "heal", amount: 17 }];
    const result = applySimulatedActions({ state, selfId: seat, actions, selections: {}, options: { sourceCard: required(state[seat].field[0]), effect: resolutionEffect(actions) } });
    const live = await game.effectEngine.applyActions(actions, { source, player: owner, opponent }, {});
    assert.equal(result, typeof live === "object" && live !== null ? live.success : live);
    assert.equal(state[seat].lp, owner.lp);
    assert.equal(owner.lp, amount > 0 && scoped ? 8017 : 8000);
  });

  for (const immunity of [false, true]) test(`T01 Germination supported continuation has the runtime failure boundary (immunity=${immunity}/${seat})`, async t => {
    const { game, owner, opponent, source, first, clone } = setup(t, seat, 416);
    const effect = required(cardDefinition(416).effects?.[0]);
    // negate_attack remains explicitly unsupported by planning. This oracle
    // compares the real declarative continuation after that combat action.
    const actions = (effect.actions || []).filter(action => action.type !== "negate_attack");
    if (immunity) first.unaffectedByOtherCardEffects = true;
    const state = clone(), simSource = required(state[seat].field[0]), other = seat === "player" ? "bot" : "player";
    const simFirst = required(state[other].field[0]), ref = "bloomrot_sudden_germination_attacker";
    const result = applySimulatedActions({ state, selfId: seat, actions, selections: { [ref]: [simFirst] }, options: { sourceCard: simSource, effect } });
    const live = await game.effectEngine.applyActions(actions, { source, effect, player: owner, opponent }, { [ref]: [first] });
    assert.equal(result, false);
    assert.equal(typeof live === "object" && live !== null ? live.success : live, false);
    assert.deepEqual([getCounterValue(simFirst, "spore"), state[seat].field.filter(card => card.name === "Bloomrot Token").length],
      [first.getCounter("spore"), owner.field.filter(card => card.name === "Bloomrot Token").length]);
    assert.equal(first.getCounter("spore"), immunity ? 0 : 1);
    assert.equal(owner.field.filter(card => card.name === "Bloomrot Token").length, immunity ? 0 : 1,
      "all-immune counter failure precedes the Token; absent Colony fails the later optional action");
    assert.deepEqual(state._simUnsupportedActions ?? [], []);
  });

  test(`T01 local projection preserves accepted parent references after their earlier action (${seat})`, () => {
    const copy = createPlanningCopy(), other = seat === "player" ? "bot" : "player";
    const source = copy.cloneCardForSim(new Card(cardDefinition(405), seat));
    const prior = copy.cloneCardForSim(new Card(cardDefinition(1), other));
    const next = copy.cloneCardForSim(new Card(cardDefinition(1), other));
    const state = simulationState({ [seat]: { field: [source] }, [other]: { field: [prior, next] } });
    const actions: readonly CardAction[] = [{ type: "return_to_hand", targetRef: "parent" }, choice()];
    const effect = resolutionEffect(actions, [{ id: "parent", owner: "opponent", zone: "field", intent: "reference", targetFromContext: "attacker", count: { min: 1, max: 1 } }]);
    const selections = { parent: [prior] };
    assert.equal(applySimulatedActions({ state, selfId: seat, actions, selections, options: { sourceCard: source, effect,
      referenceSnapshots: captureSimulatedReferences(effect, selections, state[seat], state[other]),
      activationContext: { decisions: { selections: { chosen: [required(next.instanceId)] } } },
    } }), true);
    assert.deepEqual(state[other].hand, [prior]);
    assert.equal(getCounterValue(next, "spore"), 1);
    assert.deepEqual(state._simUnsupportedActions ?? [], []);
  });
}
