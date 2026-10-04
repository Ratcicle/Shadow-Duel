import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../../src/core/Card.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { getCounterValue } from "../../src/core/ai/common/counters.js";
import { getStrategyFor } from "../../src/core/ai/StrategyRegistry.js";
import BloomrotStrategy from "../../src/core/ai/BloomrotStrategy.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { replaceSimulatedBattleDestruction } from "../../src/core/ai/common/simulatedActions/destruction.js";
import { cleanupSimulatedEndTurn } from "../../src/core/ai/common/simulatedActions/lifecycle.js";
import { attachSimulatedEquip, moveCardToZone } from "../../src/core/ai/common/zones.js";
import { attachSimulatedEventEmitter, createDeferredSimulatedEventFrame, prepareSimulatedEffectActivation } from "../../src/core/ai/common/simulation.js";
import type { CardAction } from "../../src/core/contracts/actions.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

class InterruptibleCounterMap extends Map<string, number> {
  onPayment?: () => void;
  override set(key: string, value: number): this {
    super.set(key, value);
    if (key === "spore") this.onPayment?.();
    return this;
  }
}

type Seat = "player" | "bot";
function setup(t: TestContext, seat: Seat, chain = false) {
  const game = createRuntimeGame({ laboratoryMode: true, disableChains: !chain, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.turn = seat; game.phase = "main1"; game.turnCounter = 3;
  game.player.controllerType = game.bot.controllerType = "ai";
  game.disablePresentationDelays = true;
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.ui.showConfirmPrompt = async () => true;
  const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
  const make = (id: number, player = owner, actualEffects = false) => new Card({
    ...cardDefinition(id), ...(actualEffects ? {} : { effects: [] }),
  }, player.id);
  const clone = () => {
    const copy = createPlanningCopy();
    const cloneOwner = (player: typeof owner) => ({
      field: player.field.map(copy.cloneCardForSim), spellTrap: player.spellTrap.map(copy.cloneCardForSim),
      fieldSpell: player.fieldSpell ? copy.cloneCardForSim(player.fieldSpell) : null,
      hand: player.hand.map(copy.cloneCardForSim), deck: player.deck.map(copy.cloneCardForSim),
    });
    return simulationState({ turn: seat, phase: "main1", turnCounter: 3,
      player: cloneOwner(game.player), bot: cloneOwner(game.bot) });
  };
  return { game, owner, opponent, make, clone };
}

for (const seat of ["player", "bot"] as const) {
  for (const ranged of [false, true]) test(`L01 legacy removal mirrors runtime greedy/max and conservation (${seat}/${ranged})`, async t => {
    for (const [left, right] of [[0, 0], [1, 0], [0, 2], [1, 1], [2, 3]] as const) {
      const { game, owner, opponent, make, clone } = setup(t, seat);
      const first = make(402), second = make(301, opponent), hidden = make(402, opponent);
      first.addCounter("spore", left); second.addCounter("spore", right); hidden.addCounter("spore", 9); hidden.isFacedown = true;
      placeFieldCards(owner.field, first); placeFieldCards(opponent.spellTrap, second); placeFieldCards(opponent.field, hidden);
      const state = clone(), simFirst = required(state[seat].field[0]);
      const simOther = state[seat === "player" ? "bot" : "player"], simSecond = required(simOther.spellTrap[0]);
      const action: CardAction = { type: "remove_counters_from_field", counterType: "spore", owner: "any",
        zones: ["field", "spellTrap", "fieldSpell"], requireFaceup: true, contextKey: "paid",
        ...(ranged ? { variableAmount: true, minAmount: 1, maxAmount: 4 } : { amount: 2 }), haltOnFailure: true };
      const liveContext = { player: owner, opponent, source: first };
      const simContext: Record<string, unknown> = {};
      const events: number[] = [], simEvents: number[] = [];
      game.on("counter_removed", payload => { events.push(payload.amount); });
      const result = await game.effectEngine.applyActions([action], liveContext, {});
      const simulated = applySimulatedActions({ state, selfId: seat, actions: [action], options: { sourceCard: simFirst,
        actionContext: simContext, emitSimulatedEvent: (event, payload) => {
          if (event === "counter_removed") simEvents.push(Number(Reflect.get(payload, "amount")));
        } } });
      assert.equal(simulated, typeof result === "object" && result !== null ? result.success : result);
      assert.deepEqual([getCounterValue(simFirst, "spore"), getCounterValue(simSecond, "spore")],
        [first.getCounter("spore"), second.getCounter("spore")]);
      assert.deepEqual(simEvents, events);
      assert.equal(simContext.paid, Reflect.get(liveContext, "paid"));
      assert.equal(left + right - getCounterValue(simFirst, "spore") - getCounterValue(simSecond, "spore"), simEvents[0] || 0);
      assert.equal(getCounterValue(required(simOther.field[0]), "spore"), 9);
      assert.deepEqual(state._simUnsupportedActions || [], []);
    }
  });

  for (const amount of [1, 4, 8]) test(`L01 real Harvest consumes aggregate removal before exact optional destruction and buff (${seat}/${amount})`, async t => {
    const { game, owner, opponent, make, clone } = setup(t, seat);
    const source = make(414, owner, true), ally = make(401), first = make(1, opponent), second = make(1, opponent);
    placeFieldCards(owner.spellTrap, source); placeFieldCards(owner.field, ally); placeFieldCards(opponent.field, first, second);
    first.addCounter("spore", amount);
    const state = clone(), self = state[seat], other = state[seat === "player" ? "bot" : "player"];
    const simSource = required(self.spellTrap[0]), simAlly = required(self.field[0]);
    const effect = required(source.effects[0]);
    const exact = [second, first].slice(0, Math.floor(amount / 4)).map(card => card.instanceId);
    const result = await game.effectEngine.applyActions(effect.actions || [], {
      source, effect, player: owner, opponent, activationContext: { decisions: { selections: { destroy_targets: exact } } },
    }, {});
    const success = applySimulatedActions({ state, selfId: seat, actions: effect.actions, options: {
      sourceCard: simSource, effect, actionContext: {}, activationContext: { decisions: { selections: { destroy_targets: exact } } },
    } });
    assert.equal(typeof result === "object" && result !== null && result.success, true);
    assert.equal(success, true);
    assert.deepEqual([simAlly.atk, simAlly.def, other.field.length], [ally.atk, ally.def, opponent.field.length]);
    assert.equal(getCounterValue(required([...other.field, ...other.graveyard].find(card => card.instanceId === first.instanceId)), "spore"), 0);
    assert.deepEqual(state._simUnsupportedActions || [], []);
    game.cleanupTempBoosts(owner); cleanupSimulatedEndTurn(state);
    assert.deepEqual([simAlly.atk, simAlly.def], [ally.atk, ally.def]);
  });

  for (const initial of [0, 3]) test(`L01 Carrioncap counter debuff uses the counter count at execution (${seat}/${initial})`, async t => {
    const { game, owner, opponent, make, clone } = setup(t, seat);
    const source = make(405, owner, true), target = make(401, opponent);
    placeFieldCards(owner.field, source); placeFieldCards(opponent.field, target); target.addCounter("spore", initial);
    const state = clone(), other = state[seat === "player" ? "bot" : "player"], simTarget = required(other.field[0]);
    const effect = required(source.effects.find(entry => entry.timing === "ignition"));
    await game.effectEngine.applyActions(effect.actions || [], { source, effect, player: owner, opponent }, { bloomrot_carrioncap_spore_target: [target] });
    assert.equal(applySimulatedActions({ state, selfId: seat, actions: effect.actions, selections: { bloomrot_carrioncap_spore_target: [simTarget] },
      options: { sourceCard: required(state[seat].field[0]), effect } }), true);
    assert.deepEqual([simTarget.atk, simTarget.def, getCounterValue(simTarget, "spore")], [target.atk, target.def, target.getCounter("spore")]);
    game.cleanupTempBoosts(opponent); cleanupSimulatedEndTurn(state);
    assert.deepEqual([simTarget.atk, simTarget.def], [target.atk, target.def]);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  for (const mode of ["two", "none", "negated"] as const) test(`L01 Armor pays legacy counters and consumes usage per copy (${seat}/${mode})`, async t => {
    const { game, owner, opponent, make, clone } = setup(t, seat);
    const host = make(401), carrier = make(402, opponent), first = make(413, owner, true), second = make(413, owner, true);
    placeFieldCards(owner.field, host); placeFieldCards(opponent.field, carrier); placeFieldCards(owner.spellTrap, first, second);
    first.equippedTo = second.equippedTo = host; host.equips = [first, second];
    if (mode !== "none") carrier.addCounter("spore", 3);
    if (mode === "negated") first.effectsNegated = second.effectsNegated = true;
    const state = clone(), self = state[seat], other = state[seat === "player" ? "bot" : "player"], simHost = required(self.field[0]);
    for (const equip of self.spellTrap) assert.equal(attachSimulatedEquip(equip, simHost), true);
    for (let attempt = 0; attempt < 3; attempt++) {
      const live = await game.resolveDestructionWithReplacement(host, { cause: "battle", sourcePlayer: opponent });
      const simulated = replaceSimulatedBattleDestruction(state, simHost);
      assert.equal(simulated !== null, live.replaced);
      assert.equal(getCounterValue(required(other.field[0]), "spore"), carrier.getCounter("spore"));
      assert.equal(live.replaced, mode === "two" && attempt < 2);
    }
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  test(`L01 Harvest aggregate removal triggers Colony before its bonus and keeps clones independent (${seat})`, async t => {
    const { game, owner, opponent, make, clone } = setup(t, seat, true);
    const source = make(414, owner, true), colony = make(410, owner, true), ally = make(401), carrier = make(1, opponent);
    owner.fieldSpell = colony; placeFieldCards(owner.spellTrap, source); placeFieldCards(owner.field, ally);
    placeFieldCards(opponent.field, carrier); carrier.addCounter("spore", 4);
    const state = clone(), untouched = clone(), self = state[seat], other = state[seat === "player" ? "bot" : "player"];
    const effect = required(source.effects[0]), simAlly = required(self.field[0]);
    const liveAmounts: number[] = [], simulatedAmounts: number[] = [];
    game.on("counter_removed", event => {
      liveAmounts.push(event.amount); assert.equal(carrier.getCounter("spore"), 0); assert.equal(ally.atk, 1200);
    });
    const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true,
      sourceCard: required(self.spellTrap[0]), effect, actionContext: {},
      activationContext: { decisions: { selections: { destroy_targets: [] } } },
      onSimulatedEvent: (name, payload) => { if (name === "counter_removed") {
        simulatedAmounts.push(Number(Reflect.get(payload, "amount")));
        assert.equal(getCounterValue(required(other.field[0]), "spore"), 0); assert.equal(simAlly.atk, 1200);
      } },
    });
    const result = await game.effectEngine.applyActions(effect.actions || [], { source, effect, player: owner, opponent,
      activationContext: { decisions: { selections: { destroy_targets: [] } } } }, {});
    assert.equal(typeof result === "object" && result !== null && result.success, true);
    assert.equal(applySimulatedActions({ state, selfId: seat, actions: effect.actions, options }), true);
    assert.deepEqual(simulatedAmounts, liveAmounts);
    assert.deepEqual(self.field.map(card => [card.name, card.atk, card.def]), owner.field.map(card => [card.name, card.atk, card.def]));
    assert.equal(self.field.filter(card => card.isToken).length, 1);
    assert.equal(getCounterValue(required(untouched[seat === "player" ? "bot" : "player"].field[0]), "spore"), 4);
    assert.equal(untouched[seat].field.length, 1);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  for (const choice of ["refuse", "stale", "duplicate", "too_many", "immune"] as const) {
    test(`L01 Harvest ${choice} choice mirrors runtime after committed removal (${seat})`, async t => {
      const { game, owner, opponent, make, clone } = setup(t, seat);
      const source = make(414, owner, true), ally = make(401), first = make(1, opponent), second = make(1, opponent);
      placeFieldCards(owner.spellTrap, source); placeFieldCards(owner.field, ally); placeFieldCards(opponent.field, first, second);
      first.addCounter("spore", 4);
      if (choice === "immune") first.immuneToOpponentEffectsUntilTurn = 3;
      const state = clone(), self = state[seat], other = state[seat === "player" ? "bot" : "player"];
      const effect = required(source.effects[0]);
      const exact = choice === "refuse" ? [] : choice === "stale" ? ["absent"] : choice === "duplicate"
        ? [first.instanceId, first.instanceId] : choice === "too_many" ? [first.instanceId, second.instanceId] : [first.instanceId];
      const result = await game.effectEngine.applyActions(effect.actions || [], { source, effect, player: owner, opponent,
        activationContext: { decisions: { selections: { destroy_targets: exact } } } }, {});
      const simulated = applySimulatedActions({ state, selfId: seat, actions: effect.actions, options: {
        sourceCard: required(self.spellTrap[0]), effect, actionContext: {}, activationContext: { decisions: { selections: { destroy_targets: exact } } },
      } });
      assert.equal(simulated, typeof result === "object" && result !== null ? result.success : result);
      assert.deepEqual([required(self.field[0]).atk, other.field.length, getCounterValue(required(other.field[0]), "spore")],
        [ally.atk, opponent.field.length, first.getCounter("spore")]);
    });
  }

  test(`L01 legacy exact plans remain explicitly unsupported and reserve no invented payment (${seat})`, t => {
    const { owner, opponent, make, clone } = setup(t, seat);
    const source = make(402), first = make(402), planned = make(1, opponent);
    placeFieldCards(owner.field, source, first); placeFieldCards(opponent.field, planned);
    first.addCounter("spore", 2); planned.addCounter("spore", 2);
    const state = clone();
    assert.equal(applySimulatedActions({ state, selfId: seat, actions: [{ type: "remove_counters_from_field", counterType: "spore", owner: "any", amount: 1 }],
      options: { activationContext: { decisions: { selections: { counter_payment: [planned.instanceId] } } } } }), false);
    assert.equal(getCounterValue(required(state[seat].field[1]), "spore"), 2);
    assert.equal(getCounterValue(required(state[seat === "player" ? "bot" : "player"].field[0]), "spore"), 2);
    assert.deepEqual(state._simUnsupportedActions, ["exact_selection:counter_payment"]);
  });

  test(`L01 legacy activation cost preflight reserves sequential costs without touching the pool (${seat})`, t => {
    const { owner, make, clone } = setup(t, seat);
    const source = make(402); placeFieldCards(owner.field, source); source.addCounter("spore", 3);
    const state = clone(), simSource = required(state[seat].field[0]);
    const cost = { type: "remove_counters_from_field", counterType: "spore", owner: "self", amount: 2 } as const;
    const effect = { id: "legacy_cost", timing: "ignition", requireZone: "field", activationZones: ["field"], activationCosts: [cost], actions: [] } as const;
    assert.ok(prepareSimulatedEffectActivation(state, simSource, effect, { selfId: seat }));
    assert.equal(prepareSimulatedEffectActivation(state, simSource, { ...effect, activationCosts: [cost, cost] }, { selfId: seat }), null);
    assert.equal(getCounterValue(simSource, "spore"), 3);
  });

  test(`L01 counter debuff at zero stats preserves runtime success and later actions (${seat})`, async t => {
    const { game, owner, opponent, make, clone } = setup(t, seat);
    const source = make(405), target = make(401, opponent);
    target.atk = target.def = 0; target.addCounter("spore", 2);
    placeFieldCards(owner.field, source); placeFieldCards(opponent.field, target);
    const state = clone();
    const actions: CardAction[] = [{ type: "buff_stats_by_counter", targetRef: "target", counterType: "spore", atkPerCounter: -300, defPerCounter: -300 },
      { type: "heal", amount: 17, player: "self" }];
    const live = await game.effectEngine.applyActions(actions, { source, player: owner, opponent }, { target: [target] });
    const simulated = applySimulatedActions({ state, selfId: seat, actions, selections: { target: [required(state[seat === "player" ? "bot" : "player"].field[0])] },
      options: { sourceCard: required(state[seat].field[0]) } });
    assert.equal(simulated, typeof live === "object" && live !== null ? live.success : live);
    assert.equal(state[seat].lp, owner.lp);
  });

  for (const optional of [false, true]) test(`L01 context destruction clamps to available candidates (${seat}/${optional})`, async t => {
    const { game, owner, opponent, make, clone } = setup(t, seat);
    const source = make(414), first = make(1, opponent), second = make(1, opponent);
    placeFieldCards(owner.spellTrap, source); placeFieldCards(opponent.field, first, second);
    const state = clone(), other = state[seat === "player" ? "bot" : "player"];
    const actions: CardAction[] = [{ type: "destroy_targeted_cards", minTargets: optional ? 0 : 1,
      targetCountFromContext: { key: "removed", divideBy: 2, multiplier: 2, round: "floor" } }];
    const exact = optional ? [] : ["ignored_mandatory_plan"];
    const context: Record<string, unknown> = { removed: 4 };
    const live = await game.effectEngine.applyActions(actions, { source, player: owner, opponent,
      actionContext: context, activationContext: { decisions: { selections: { destroy_targets: exact } } } }, {});
    const simulated = applySimulatedActions({ state, selfId: seat, actions, options: { sourceCard: required(state[seat].spellTrap[0]),
      actionContext: { ...context }, activationContext: { decisions: { selections: { destroy_targets: exact } } } } });
    assert.equal(simulated, typeof live === "object" && live !== null ? live.success : live);
    assert.equal(other.field.length, opponent.field.length);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  test(`L01 remove-all preserves scoped resources and aggregate metadata (${seat})`, async t => {
    const { game, owner, opponent, make, clone } = setup(t, seat);
    const first = make(401), second = make(301, opponent), field = make(410, opponent), hidden = make(402), grave = make(402);
    placeFieldCards(owner.field, first, hidden); placeFieldCards(opponent.spellTrap, second); opponent.fieldSpell = field;
    owner.graveyard.push(grave); hidden.isFacedown = true; first.immuneToOpponentEffectsUntilTurn = 3;
    for (const [card, amount] of [[first, 3], [second, 2], [field, 4], [hidden, 9], [grave, 7]] as const) {
      card.addCounter("spore", amount); card.addCounter("other", 2);
    }
    const state = clone(), self = state[seat], other = state[seat === "player" ? "bot" : "player"];
    const context: Record<string, unknown> = {}, simContext: Record<string, unknown> = {};
    const live: Array<{ amount: number; zones: readonly string[]; cards: number }> = [], simulated: typeof live = [];
    game.on("counter_removed", payload => { live.push({ amount: payload.amount, zones: payload.zones || [], cards: payload.cards?.length || 0 }); });
    const action: CardAction = { type: "remove_all_counters_from_field", counterType: "spore", owner: "any",
      zones: ["field", "spellTrap", "fieldSpell"], requireFaceup: true };
    const liveContext = { source: first, player: owner, opponent, actionContext: context };
    await game.effectEngine.applyActions([action], liveContext, {});
    assert.equal(applySimulatedActions({ state, selfId: seat, actions: [action], options: { actionContext: simContext,
      emitSimulatedEvent: (event, payload) => { if (event === "counter_removed") {
        simulated.push({ amount: Number(Reflect.get(payload, "amount")), zones: Reflect.get(payload, "zones"), cards: Reflect.get(payload, "cards").length });
      } },
    } }), true);
    assert.deepEqual(simulated, live);
    assert.equal(simContext.removedSporeCounterCount, 9);
    assert.equal(Reflect.get(liveContext, "removedSporeCounterCount"), 9);
    assert.equal(simContext.lastRemovedCounterCount, 9);
    assert.deepEqual(simContext.removedCounterCounts, { spore: 9 });
    assert.equal(getCounterValue(required(self.field[1]), "spore"), 9);
    for (const card of [required(self.field[0]), required(other.spellTrap[0]), required(other.fieldSpell)]) {
      assert.equal(getCounterValue(card, "spore"), 0); assert.equal(getCounterValue(card, "other"), 2);
    }
    assert.equal(grave.getCounter("spore"), 7);
  });

  test(`L01 counterSourceRef totals and minimums mirror the runtime (${seat})`, async t => {
    const { game, owner, opponent, make, clone } = setup(t, seat);
    const source = make(405), pool = make(301), target = make(401, opponent);
    placeFieldCards(owner.field, source); placeFieldCards(owner.spellTrap, pool); placeFieldCards(opponent.field, target);
    source.addCounter("spore", 1); pool.addCounter("spore", 3);
    const state = clone(), self = state[seat], other = state[seat === "player" ? "bot" : "player"];
    const actions: CardAction[] = [{ type: "buff_stats_by_counter", targetRef: "target", counterSourceRef: "pool", counterType: "spore",
      atkBoostPerCounter: -100, defBoostPerCounter: 25, minCounters: 4, duration: "end_of_turn" }];
    await game.effectEngine.applyActions(actions, { source, player: owner, opponent }, { target: [target], pool: [source, pool] });
    assert.equal(applySimulatedActions({ state, selfId: seat, actions, selections: { target: [required(other.field[0])],
      pool: [required(self.field[0]), required(self.spellTrap[0])] }, options: { sourceCard: required(self.field[0]) } }), true);
    assert.deepEqual([required(other.field[0]).atk, required(other.field[0]).def], [target.atk, target.def]);
  });

  test(`L01 interrupted exact payment emits its partial amount and halts continuation (${seat})`, async t => {
    const { game, owner, opponent, make, clone } = setup(t, seat);
    const first = make(402), second = make(402, opponent);
    placeFieldCards(owner.field, first); placeFieldCards(opponent.field, second); first.addCounter("spore", 2); second.addCounter("spore", 1);
    const state = clone(), self = state[seat], other = state[seat === "player" ? "bot" : "player"], simFirst = required(self.field[0]), simSecond = required(other.field[0]);
    let interrupted = false;
    game.waitForPresentationDelay = async () => { if (!interrupted) { interrupted = true; second.removeCounter("spore", 1); } };
    const counters = new InterruptibleCounterMap(simFirst.counters instanceof Map ? simFirst.counters : []);
    counters.onPayment = () => { delete counters.onPayment; simSecond.counters = new Map([["spore", 0]]); };
    simFirst.counters = counters;
    const actions: CardAction[] = [{ type: "remove_counters_from_field", targetRef: "payment", counterType: "spore", owner: "any", amount: 3,
      contextKey: "paid", haltOnFailure: true }, { type: "heal", player: "self", amount: 10 }];
    const events: number[] = [], simEvents: number[] = [], context: Record<string, unknown> = {}, simContext: Record<string, unknown> = {};
    game.on("counter_removed", payload => { events.push(payload.amount); });
    const liveContext = { source: first, player: owner, opponent, actionContext: context };
    const result = await game.effectEngine.applyActions(actions, liveContext, { payment: [first, second] });
    const success = applySimulatedActions({ state, selfId: seat, actions, selections: { payment: [simFirst, simSecond] }, options: { sourceCard: simFirst,
      actionContext: simContext, emitSimulatedEvent: (event, payload) => { if (event === "counter_removed") simEvents.push(Number(Reflect.get(payload, "amount"))); } } });
    assert.equal(typeof result === "object" && result !== null && result.success, false); assert.equal(success, false);
    assert.deepEqual(simEvents, events); assert.deepEqual(simEvents, [1]);
    assert.equal(Reflect.get(liveContext, "paid"), 1); assert.equal(simContext.paid, 1);
    assert.deepEqual([getCounterValue(simFirst, "spore"), getCounterValue(simSecond, "spore")], [first.getCounter("spore"), second.getCounter("spore")]);
    assert.equal(self.lp, 8000); assert.equal(owner.lp, 8000);
  });

  test(`L01 public Harvest creates Colony's Token after the completed bonus (${seat})`, async t => {
    const { game, owner, opponent, make, clone } = setup(t, seat, true);
    const source = make(414, owner, true), colony = make(410, owner, true), ally = make(401), carrier = make(1, opponent), victim = make(1, opponent);
    owner.fieldSpell = colony; owner.hand.push(source); placeFieldCards(owner.field, ally); placeFieldCards(opponent.field, carrier, victim);
    carrier.addCounter("spore", 4);
    const physical = clone();
    const state = simulationState({ turn: seat, phase: "main1", turnCounter: 3, _isPerspectiveState: true,
      bot: physical[seat], player: physical[seat === "player" ? "bot" : "player"] });
    const liveOrder: string[] = [], simOrder: string[] = [];
    game.on("card_to_grave", event => { if (event.card === victim) liveOrder.push("destroy"); });
    game.on("after_summon", event => { if (event.card.name === "Bloomrot Token") liveOrder.push("token"); });
    const strategy = getStrategyFor("bloomrot", owner);
    assert.ok(strategy instanceof BloomrotStrategy);
    const planningOptions = strategy.getPlanningSimulationOptions.bind(strategy);
    strategy.getPlanningSimulationOptions = current => ({ ...planningOptions(current), onSimulatedEvent: (name: string, payload: object) => {
      const card = Reflect.get(payload, "card");
      if (name === "card_to_grave" && card?.instanceId === victim.instanceId) simOrder.push("destroy");
      if (name === "after_summon" && card?.isToken) simOrder.push("token");
    } });
    const activationContext = { decisions: { selections: { destroy_targets: [victim.instanceId] } } };
    assert.equal((await game.tryActivateSpell(source, 0, null, { owner, activationContext })).success, true);
    strategy.simulateMainPhaseAction(state, { type: "spell", index: 0, cardId: 414, activationContext });
    const token = required(owner.field.find(card => card.isToken)), simToken = required(state.bot.field.find(card => card.isToken));
    assert.deepEqual([token.atk, token.def], [0, 0]);
    assert.deepEqual([simToken.atk, simToken.def], [token.atk, token.def]);
    assert.deepEqual([required(state.bot.field.find(card => card.instanceId === ally.instanceId)).atk, state.player.field.length], [ally.atk, opponent.field.length]);
    assert.deepEqual(simOrder, liveOrder); assert.deepEqual(liveOrder, ["destroy", "token"]);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  test(`L01 duplicate legacy field scopes fail before counter mutation (${seat})`, async t => {
    const { game, owner, opponent, make, clone } = setup(t, seat);
    const source = make(402); source.addCounter("spore", 1); placeFieldCards(owner.field, source);
    const state = clone();
    const actions: CardAction[] = [{ type: "remove_counters_from_field", owner: "self", counterType: "spore", amount: 2,
      zones: ["field", "field"], haltOnFailure: true }];
    const live = await game.effectEngine.applyActions(actions, { source, player: owner, opponent }, {});
    assert.equal(typeof live === "object" && live !== null && live.success, false);
    assert.equal(applySimulatedActions({ state, selfId: seat, actions }), false);
    assert.equal(getCounterValue(required(state[seat].field[0]), "spore"), source.getCounter("spore"));
  });

  test(`L01 completed Armor cost keeps its receipt if aggregate event negates the source (${seat})`, async t => {
    const { game, owner, opponent, make, clone } = setup(t, seat);
    const host = make(401), pool = make(402, opponent), armor = make(413, owner, true);
    placeFieldCards(owner.field, host); placeFieldCards(opponent.field, pool); placeFieldCards(owner.spellTrap, armor);
    armor.equippedTo = host; host.equips = [armor]; pool.addCounter("spore", 3);
    const state = clone(), self = state[seat], other = state[seat === "player" ? "bot" : "player"], simArmor = required(self.spellTrap[0]);
    assert.equal(attachSimulatedEquip(simArmor, required(self.field[0])), true);
    game.on("counter_removed", () => { armor.effectsNegated = true; });
    const live = await game.resolveDestructionWithReplacement(host, { cause: "battle", sourcePlayer: opponent });
    const simulated = replaceSimulatedBattleDestruction(state, required(self.field[0]), {
      emitSimulatedEvent: event => { if (event === "counter_removed") simArmor.effectsNegated = true; },
    });
    assert.equal(live.replaced, true); assert.equal(simulated !== null, live.replaced);
    assert.equal(getCounterValue(required(other.field[0]), "spore"), pool.getCounter("spore"));
    assert.equal(replaceSimulatedBattleDestruction(state, required(self.field[0])), null);
  });

  test(`L01 mandatory context destruction of protected card preserves runtime continuation (${seat})`, async t => {
    const { game, owner, opponent, make, clone } = setup(t, seat);
    const source = make(414), target = new Card({ ...cardDefinition(401), effects: [{ id: "protection", timing: "passive", requireZone: "field",
      passive: { type: "conditional_protection", protectionType: "effect_destruction" } }] }, opponent.id);
    placeFieldCards(owner.spellTrap, source); placeFieldCards(opponent.field, target);
    const state = clone(), context: Record<string, unknown> = { removed: 1 };
    const actions: CardAction[] = [{ type: "destroy_targeted_cards", minTargets: 1, targetCountFromContext: { key: "removed" } },
      { type: "heal", amount: 17, player: "self" }];
    const live = await game.effectEngine.applyActions(actions, { source, player: owner, opponent, actionContext: context }, {});
    const simulated = applySimulatedActions({ state, selfId: seat, actions, options: { sourceCard: required(state[seat].spellTrap[0]), actionContext: { ...context } } });
    assert.equal(typeof live === "object" && live !== null && live.success, true); assert.equal(simulated, true);
    assert.equal(state[seat].lp, owner.lp); assert.equal(owner.lp, 8017);
    assert.equal(state[seat === "player" ? "bot" : "player"].field.length, opponent.field.length);
  });

  test(`L01 deferred frame preserves an external dispatch port with explicit timing limitation (${seat})`, t => {
    const { owner, make, clone } = setup(t, seat);
    owner.fieldSpell = make(410, owner, true);
    const state = clone();
    let calls = 0;
    const emitter: (event: string, payload: object) => void = () => { calls += 1; };
    const frame = createDeferredSimulatedEventFrame(state, { enableSimulatedEvents: true, emitSimulatedEvent: emitter });
    assert.equal(frame.options.emitSimulatedEvent, emitter);
    frame.options.emitSimulatedEvent?.("counter_removed", { counterType: "spore", amount: 1, fromField: true });
    frame.finishResolution();
    assert.equal(calls, 1); assert.equal(state[seat].field.length, 0);
    assert.deepEqual(state._simUnsupportedActions, ["deferred_event_frame:custom_emitter"]);
  });

  for (const batched of [false, true]) test(`L01 deferred observer receives each ingress once and Token waits for flush (${seat}/${batched})`, t => {
    const { owner, make, clone } = setup(t, seat);
    owner.fieldSpell = make(410, owner, true);
    const state = clone();
    let customCalls = 0, observedCalls = 0;
    const frame = createDeferredSimulatedEventFrame(state, {
      enableSimulatedEvents: true, emitSimulatedEvent: event => { if (event === "counter_removed") customCalls += 1; },
      onSimulatedEvent: event => { if (event === "counter_removed") observedCalls += 1; },
    }, () => true, "observer");
    const payload = { counterType: "spore", amount: 1, fromField: true };
    if (batched) frame.options.emitSimulatedEvents?.([{ event: "counter_removed", payload }]);
    else frame.options.emitSimulatedEvent?.("counter_removed", payload);
    assert.equal(customCalls, 1); assert.equal(observedCalls, 1); assert.equal(state[seat].field.length, 0);
    frame.finishResolution(); frame.finishResolution();
    assert.equal(state[seat].field.length, 1);
    assert.equal(customCalls, 1); assert.equal(observedCalls, 1);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  for (const mode of ["single", "batch", "observed"] as const) test(`L01 nested frame retains the parent's counter queue (${seat}/${mode})`, t => {
    const { owner, make, clone } = setup(t, seat);
    owner.fieldSpell = make(410, owner, true);
    const state = clone();
    let calls = 0;
    const parent = createDeferredSimulatedEventFrame(state, { enableSimulatedEvents: true,
      onSimulatedEvent: event => { if (event === "counter_removed") calls += 1; } }, event => event === "counter_removed");
    const child = createDeferredSimulatedEventFrame(state, parent.options, () => true);
    const payload = { counterType: "spore", amount: 1, fromField: true };
    if (mode === "single") child.options.emitSimulatedEvent?.("counter_removed", payload);
    else child.options.emitSimulatedEvents?.([{ event: "counter_removed", payload, observed: mode === "observed" }]);
    assert.equal(calls, mode === "observed" ? 0 : 1);
    child.finishResolution(); assert.equal(state[seat].field.length, 0);
    parent.finishResolution(); child.finishResolution(); parent.finishResolution();
    assert.equal(state[seat].field.length, 1);
    assert.equal(calls, mode === "observed" ? 0 : 1);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  test(`L01 nested frame preserves event depth overrides (${seat})`, t => {
    const { owner, make, clone } = setup(t, seat);
    owner.fieldSpell = make(410, owner, true);
    const state = clone();
    const parent = createDeferredSimulatedEventFrame(state, { enableSimulatedEvents: true, maxSimulatedEventDepth: 1 }, event => event === "counter_removed");
    const child = createDeferredSimulatedEventFrame(state, parent.options, () => true);
    Reflect.apply(required(child.options.emitSimulatedEvent), undefined, ["counter_removed", {
      counterType: "spore", amount: 1, fromField: true,
    }, { _simEventDepth: 1 }]);
    child.finishResolution(); parent.finishResolution();
    assert.equal(state[seat].field.length, 0);
    assert.deepEqual(state._simUnsupportedActions, ["simulated_event_depth"]);
  });

  for (const mutation of ["none", "observer", "before-flush"] as const) test(`L01 deferred noncontextual departure has explicit source timing limit (${seat}/${mutation})`, async t => {
    const { game, owner, make } = setup(t, seat, true);
    const source = make(401, owner, true), spell = make(414);
    placeFieldCards(owner.field, source); owner.deck.push(spell);
    let changed = false;
    if (mutation === "observer") game.on("card_moved", async payload => {
      if (payload.card !== source || changed) return;
      changed = true;
      await game.moveCard(source, owner, "hand", { fromZone: "graveyard", awaitCardMovedEvent: true });
      await game.moveCard(source, owner, "graveyard", { fromZone: "hand", awaitCardMovedEvent: true });
    });
    const projected = simulationCard(make(401, owner, true)), simSpell = simulationCard(make(414));
    const state = simulationState({ turn: seat, phase: "main1", turnCounter: 3,
      [seat]: { graveyard: [projected], deck: [simSpell] } });
    const reenter = () => {
      assert.equal(moveCardToZone(state[seat], projected, "hand", state[seat], { state }), true);
      assert.equal(moveCardToZone(state[seat], projected, "graveyard", state[seat], { state }), true);
    };
    const frame = createDeferredSimulatedEventFrame(state, { enableSimulatedEvents: true,
      onSimulatedEvent: event => { if (event === "card_moved" && mutation === "observer") reenter(); } });
    const movement = await game.moveCard(source, owner, "graveyard", { fromZone: "field", awaitCardMovedEvent: true });
    assert.equal(typeof movement === "boolean" ? movement : movement.success, true);
    assert.ok(owner.hand.includes(spell));
    frame.options.emitSimulatedEvent?.("card_moved", { card: projected, player: state[seat], fromPlayer: state[seat], toPlayer: state[seat],
      fromZone: "field", toZone: "graveyard", wasFaceupBeforeMove: true, movedByEffect: false });
    if (mutation === "before-flush") reenter();
    frame.finishResolution();
    if (mutation === "none") {
      assert.ok(state[seat].hand.includes(simSpell)); assert.deepEqual(state._simUnsupportedActions || [], []);
    } else {
      assert.ok(state[seat].deck.includes(simSpell));
      assert.deepEqual(state._simUnsupportedActions, ["deferred_trigger_source_presence"]);
    }
  });

  test(`L01 queued duplicate Sporelings consume hard OPT in publication order before LIFO (${seat})`, async t => {
    const { game, owner, make } = setup(t, seat, true);
    const token = make(401); token.isToken = true;
    const first = make(401, owner, true), second = make(401, owner, true), root = make(402), fusion = make(420, owner, true), spell = make(414);
    placeFieldCards(owner.field, token, first, second, root); owner.extraDeck.push(fusion); owner.deck.push(spell);
    const projectedFirst = simulationCard(first), projectedSecond = simulationCard(second);
    const state = simulationState({ turn: seat, phase: "main1", turnCounter: 3,
      [seat]: { field: [simulationCard(token), projectedFirst, projectedSecond, simulationCard(root)],
        extraDeck: [simulationCard(fusion)], deck: [simulationCard(spell)] } });
    const actualSources: number[] = [], simulatedSources: number[] = [];
    const id = "bloomrot_sporeling_leave_field_search_spell";
    game.on("effect_activated", payload => { if (payload.effect?.id === id) actualSources.push(payload.card === first ? 1 : 2); });
    const polymerization = new Card(cardDefinition("Polymerization"), owner.id); owner.hand.push(polymerization);
    assert.equal((await game.tryActivateSpell(polymerization, 0, null, { owner })).success, true);
    const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true,
      onEffectActivated: payload => {
        if (Reflect.get(payload, "effect")?.id === id) simulatedSources.push(Reflect.get(payload, "card") === projectedFirst ? 1 : 2);
      },
    });
    assert.equal(applySimulatedActions({ state, selfId: seat, actions: [{ type: "polymerization_fusion_summon" }], options }), true);
    assert.deepEqual(actualSources, [1]); assert.deepEqual(simulatedSources, actualSources);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  test(`L01 queued mandatory effects prepare before optional effects and resolve LIFO (${seat})`, t => {
    const { owner, opponent } = setup(t, seat);
    const makeTrigger = (player: typeof owner, optional: boolean) => {
      const effect: EffectDefinition = { id: `${player.id}_${optional ? "optional" : "mandatory"}`, timing: "on_event", event: "counter_removed",
        triggerTiming: "if", requireZone: "field", activationZones: ["field"],
        triggerRequirement: optional ? "optional" : "mandatory", oncePerTurn: true, oncePerTurnName: "l01_fixture_publication_order",
        actions: [{ type: "heal", amount: 11, player: "self" }] };
      return new Card({ ...cardDefinition(1), effects: [effect] }, player.id);
    };
    // Optional cards enter the physical list first, so SEGOC groups must win over insertion order.
    const selfOptional = makeTrigger(owner, true), selfMandatory = makeTrigger(owner, false);
    const otherOptional = makeTrigger(opponent, true), otherMandatory = makeTrigger(opponent, false);
    placeFieldCards(owner.field, selfOptional, selfMandatory); placeFieldCards(opponent.field, otherOptional, otherMandatory);
    const state = simulationState({ turn: seat, phase: "main1", turnCounter: 3,
      [seat]: { field: [simulationCard(selfOptional), simulationCard(selfMandatory)] },
      [seat === "player" ? "bot" : "player"]: { field: [simulationCard(otherOptional), simulationCard(otherMandatory)] } });
    const resolvedEffects: string[] = [], simulatedResolution: string[] = [];
    const frame = createDeferredSimulatedEventFrame(state, { enableSimulatedEvents: true,
      onLpGain: payload => { simulatedResolution.push(payload.player.id); },
      onEffectActivated: payload => { resolvedEffects.push(Reflect.get(payload, "effect").id); } });
    frame.options.emitSimulatedEvent?.("counter_removed", { player: state[seat], counterType: "spore", amount: 1, fromField: true });
    frame.finishResolution();
    assert.deepEqual(resolvedEffects, [`${opponent.id}_mandatory`, `${owner.id}_mandatory`]);
    assert.deepEqual(simulatedResolution, [opponent.id, owner.id]);
    assert.equal(state[seat].lp, 8011); assert.equal(state[seat === "player" ? "bot" : "player"].lp, 8011);
  });

  test(`L01 invalid first queued source leaves the shared usage available to the next source (${seat})`, t => {
    const { owner, make } = setup(t, seat);
    const first = simulationCard(make(401, owner, true)), second = simulationCard(make(401, owner, true)), spell = simulationCard(make(414));
    const state = simulationState({ turn: seat, phase: "main1", turnCounter: 3, [seat]: { graveyard: [first, second], deck: [spell] } });
    const resolved: object[] = [];
    const frame = createDeferredSimulatedEventFrame(state, { enableSimulatedEvents: true,
      onEffectActivated: payload => { resolved.push(Reflect.get(payload, "card")); } });
    for (const card of [first, second]) frame.options.emitSimulatedEvent?.("card_moved", { card, player: state[seat], fromPlayer: state[seat],
      toPlayer: state[seat], fromZone: "field", toZone: "graveyard", wasFaceupBeforeMove: true, movedByEffect: false });
    assert.equal(moveCardToZone(state[seat], first, "hand", state[seat], { state }), true);
    frame.finishResolution();
    assert.deepEqual(resolved, [second]); assert.ok(state[seat].hand.includes(spell));
    assert.deepEqual(state._simUnsupportedActions, ["deferred_trigger_source_presence"]);
  });
}
