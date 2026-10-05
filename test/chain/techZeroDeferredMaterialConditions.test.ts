import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../../src/core/Card.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { applyGenericSimulatedMainPhaseAction, createDeferredSimulatedEventFrame, getSimulatedPendingEffectPlans } from "../../src/core/ai/common/simulation.js";
import type { SimulatedRuntimeState } from "../../src/core/ai/common/simulatedActions/shared.js";
import type { EffectCondition, EffectDefinition } from "../../src/core/contracts/effects.js";
import { captureProcedureTriggerConditions } from "../../src/core/effects/conditions/runtime.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards } from "../helpers/game.js";

const capacity: EffectCondition = { type: "field_card_count", owner: "self", zone: "field", max: 3 };
const fact: EffectCondition = { type: "event_card_matches_filters", cardRef: "eventCard", filters: { name: cardDefinition(505).name } };

function raptorDefinition(conditions?: readonly EffectCondition[], canonicalCost = false) {
  const data = cardDefinition(505);
  return { ...data, effects: required(data.effects).map(effect => effect.id === "tech_zero_iron_raptor_synchro_tokens" && conditions
    ? { ...effect, conditions, ...(canonicalCost ? { activationCosts: [{ type: "pay_lp" as const, amount: 100, player: "self" as const }] } : {}) } : effect) };
}

function runtime(t: TestContext, seat: "player" | "bot", full = true, conditions?: readonly EffectCondition[], canonicalCost = false) {
  const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
  Object.assign(game, { turn: seat, turnCounter: 4, phase: "main1", disablePresentationDelays: true });
  game.player.controllerType = game.bot.controllerType = "human";
  game.ui.showConfirmPrompt = async message => message.includes("Raptor") || message.includes("Changed after the event");
  game.ui.showChainResponseModal = async () => null;
  game.ui.showTriggerOrderModal = async options => (options?.candidates || [])
    .filter(candidate => candidate.effect?.promptMessage?.includes("Raptor")).map(candidate => candidate.candidateId);
  game.ui.showSpecialSummonPositionModal = (_card, choose) => choose("attack");
  t.after(() => game.dispose("deferred_material_conditions"));
  const player = game[seat];
  const make = (id: number) => new Card(cardDefinition(id), seat);
  const raptor = new Card(raptorDefinition(conditions, canonicalCost), seat), prism = make(506), extra = make(513);
  const token = new Card({ name: "Original material token", cardKind: "monster", level: 1, type: "Machine", atk: 0, def: 0 }, seat);
  token.isToken = true;
  placeFieldCards(player.field, raptor, prism, token, make(504));
  if (full) placeFieldCards(player.field, make(504));
  player.extraDeck.push(extra);
  return { game, player, raptor, prism, token, extra, make };
}

for (const seat of ["player", "bot"] as const) {
  for (const order of [
    ["raptor", "prism", "token"], ["raptor", "token", "prism"],
    ["prism", "raptor", "token"], ["prism", "token", "raptor"],
    ["token", "raptor", "prism"], ["token", "prism", "raptor"],
  ] as const) {
    test(`Raptor checks capacity after all sequential materials (${seat}/${order.join("→")})`, async t => {
      const { game, player, raptor, prism, token, extra } = runtime(t, seat);
      const cards = { raptor, prism, token };
      const materials = order.map(role => cards[role]);
      const events: string[] = [];
      const materialFieldCounts: number[] = [];
      const tokenPositions: string[] = [];
      const manualPositions: string[] = [];
      game.on("card_moved", payload => {
        const index = materials.findIndex(card => card === payload.card);
        if (index < 0) return;
        assert.equal(payload.fromZone, "field");
        events.push(`move:${order[index]}:${payload.toZone}`);
        materialFieldCounts.push(player.field.length);
      });
      game.on("after_summon", payload => {
        if (payload.card === extra) {
          assert.equal(player.field.length, 3);
          events.push("summon:synchro");
        } else if (Reflect.get(payload.card, "isToken") === true && payload.card !== token) {
          events.push(`summon:token:${tokenPositions.length}:${payload.card.position}`);
          tokenPositions.push(String(payload.card.position));
          assert.equal(player.field.length, 3 + tokenPositions.length);
        }
      });
      game.ui.showSpecialSummonPositionModal = (card, choose) => {
        if (!card || Reflect.get(card, "isToken") !== true) { choose("attack"); return; }
        assert.ok(events.includes("summon:synchro"), "each Token choice happens after the Synchro summon");
        assert.equal(tokenPositions.length, manualPositions.length, "the previous Token must finish before the next choice");
        const position = manualPositions.length === 0 ? "attack" : "defense";
        events.push(`prompt:token:${manualPositions.length}:${position}`);
        manualPositions.push(position);
        choose(position);
      };
      const action = game.performSynchroSummonFromExtraDeck(extra, player, { materials });
      await completeTestSelections(game, action);
      assert.equal((await action).success, true);
      assert.equal(player.field.filter(card => card.isToken).length, 2);
      assert.deepEqual(materialFieldCounts, [4, 3, 2]);
      assert.deepEqual(events, [
        ...order.map(role => `move:${role}:${role === "token" ? "removed" : "graveyard"}`),
        "summon:synchro", "prompt:token:0:attack", "summon:token:0:attack",
        "prompt:token:1:defense", "summon:token:1:defense",
      ]);
      assert.deepEqual(manualPositions, ["attack", "defense"]);
      assert.deepEqual(tokenPositions, manualPositions);
      assert.equal(game.summonProcedureDepth, 0);
      assert.equal(game.chainSystem.pendingTriggerOccurrences.length, 0);
    });
  }
  test(`mixed AND/any_of keeps event facts frozen while capacity changes (${seat})`, async t => {
    const conditions: readonly EffectCondition[] = [fact, { type: "any_of", conditions: [
      { ...fact, filters: { archetype: "Never matched" } }, { type: "any_of", conditions: [capacity] },
    ] }];
    const { game, player, raptor, prism, token, extra } = runtime(t, seat, true, conditions);
    game.on("card_to_grave", payload => { if (payload.card === prism) raptor.name = "Changed after the event"; });
    const action = game.performSynchroSummonFromExtraDeck(extra, player, { materials: [raptor, prism, token] });
    await completeTestSelections(game, action);
    assert.equal((await action).success, true);
    assert.equal(player.field.filter(card => card.isToken).length, 2);
  });
  test(`canonical trigger cost preflight uses frozen facts (${seat})`, async t => {
    const { game, player, raptor, prism, token, extra } = runtime(t, seat, true, [fact, capacity], true);
    game.on("card_to_grave", payload => { if (payload.card === prism) raptor.name = "Changed after the event"; });
    const action = game.performSynchroSummonFromExtraDeck(extra, player, { materials: [raptor, prism, token] });
    await completeTestSelections(game, action);
    assert.equal((await action).success, true);
    assert.equal(player.lp, 7900);
    assert.equal(player.field.filter(card => card.isToken).length, 2);
  });
  test(`material source changing presence is rejected before activation (${seat})`, async t => {
    const { game, player, raptor, prism, token, extra } = runtime(t, seat);
    game.on("card_to_grave", async payload => {
      if (payload.card === prism) await game.moveCard(raptor, player, "banished", { fromZone: "graveyard", awaitEvents: true });
    });
    const action = game.performSynchroSummonFromExtraDeck(extra, player, { materials: [raptor, prism, token] });
    await completeTestSelections(game, action);
    assert.equal((await action).success, true);
    assert.equal(player.field.filter(card => card.isToken).length, 0);
    assert.ok(player.banished.includes(raptor));
  });
  test(`no two free zones at the opportunity means no Raptor activation (${seat})`, async t => {
    const { game, player, raptor, prism, token, extra, make } = runtime(t, seat);
    const activations: string[] = [];
    game.on("effect_activated", payload => { if (payload.effectId) activations.push(payload.effectId); });
    game.on("card_to_grave", payload => { if (payload.card === prism) placeFieldCards(player.field, make(508)); });
    const action = game.performSynchroSummonFromExtraDeck(extra, player, { materials: [raptor, prism, token] });
    await completeTestSelections(game, action);
    assert.equal((await action).success, true);
    assert.equal(player.field.filter(card => card.isToken).length, 0);
    assert.equal(activations.includes("tech_zero_iron_raptor_synchro_tokens"), false);
    assert.equal(game.canUseOncePerTurn(raptor, player, required(raptor.effects.find(effect => effect.id === "tech_zero_iron_raptor_synchro_tokens"))).ok, true);
  });
  test(`normal field exit does not defer its capacity condition (${seat})`, async t => {
    const { game, player, raptor } = runtime(t, seat);
    const result = await game.moveCard(raptor, player, "graveyard", { fromZone: "field", contextLabel: "synchro_material",
      deferCardToGraveTriggerResolution: true, awaitCardToGraveEvent: true });
    assert.equal(result.success, true);
    assert.equal(result.deferredCardToGraveTriggerPackage?.entries?.length, 0);
  });
  test(`a real Chain response occupies one zone before sequential Tokens (${seat})`, async t => {
    const { game, player, raptor, prism, token, extra, make } = runtime(t, seat);
    const definition = cardDefinition("Call of the Haunted");
    const call = new Card({ ...definition, effects: required(definition.effects).map(effect => ({ ...effect,
      ...(effect.targets ? { targets: effect.targets.map(target => ({ ...target, name: cardDefinition(504).name })) } : {}),
    })) }, seat);
    call.isFacedown = true; call.setTurn = 2;
    placeFieldCards(player.spellTrap, call);
    const revived = make(504); player.graveyard.push(revived);
    let offered = false;
    game.ui.showChainResponseModal = async candidates => {
      if (offered || game.chainSystem.getLastChainLink()?.effect?.id !== "tech_zero_iron_raptor_synchro_tokens") return null;
      const candidate = candidates.find(entry => entry.card === call);
      if (candidate) offered = true;
      return candidate ?? null;
    };
    const action = game.performSynchroSummonFromExtraDeck(extra, player, { materials: [raptor, prism, token] });
    await completeTestSelections(game, action);
    assert.equal((await action).success, true);
    assert.equal(offered, true);
    assert.ok(player.field.includes(revived));
    assert.equal(player.field.filter(card => card.isToken).length, 1, "the first summon remains when the second has no zone");
    assert.equal(game.chainSystem.pendingTriggerOccurrences.length, 0);
  });
  test(`materialization publishes the AI plan through the captured config (${seat})`, async t => {
    const { game, player, raptor, prism, token, extra } = runtime(t, seat);
    player.controllerType = "ai";
    let plans = 0;
    player.strategy = unsafeFixture<NonNullable<typeof player.strategy>>({
      shouldActivateEffect: () => true,
      buildActivationContextForEffect: () => { plans++; return { decisions: { cases: { audit: "ready" } } }; },
    }, "Only the trigger planning capabilities are needed for this lifecycle assertion");
    let capturedConfig: NonNullable<ReturnType<typeof game.effectEngine.buildTriggerEntry>>["config"] | undefined;
    const collect = game.effectEngine.collectCardToGraveTriggers.bind(game.effectEngine);
    game.effectEngine.collectCardToGraveTriggers = async payload => {
      const result = await collect(payload);
      if (payload.card === raptor) {
        assert.equal(plans, 0, "planning must wait until the procedure completes");
        capturedConfig = required(result.entries.find(entry => entry.card === raptor)).config;
      }
      return result;
    };
    const action = game.performSynchroSummonFromExtraDeck(extra, player, { materials: [raptor, prism, token] });
    await completeTestSelections(game, action);
    assert.equal((await action).success, true);
    assert.equal(required(capturedConfig).activationContext.decisions?.cases?.audit, "ready");
  });
}

for (const initialFact of [false, true]) for (const currentCapacity of [false, true]) {
  test(`captured AND/OR preserves Boolean composition (fact=${initialFact},capacity=${currentCapacity})`, () => {
    let factValue = initialFact, capacityValue = false;
    const read = (condition: EffectCondition) => ({ ok: "type" in condition && condition.type === "field_card_count" ? capacityValue : factValue });
    const and = captureProcedureTriggerConditions([fact, capacity], read);
    const or = captureProcedureTriggerConditions([{ type: "any_of", conditions: [fact, capacity] }], read);
    factValue = !initialFact; capacityValue = currentCapacity;
    assert.equal(and.possible, initialFact);
    assert.equal(or.possible, true);
    assert.equal(and.check().ok, initialFact && currentCapacity);
    assert.equal(or.check().ok, initialFact || currentCapacity);
  });
}

test("filtered/minimum/exact field counts remain frozen facts", () => {
  let result = false;
  for (const condition of [
    { ...capacity, filters: { archetype: "Tech-Zero" } }, { ...capacity, min: 1 }, { ...capacity, count: 1 },
  ]) {
    const captured = captureProcedureTriggerConditions([condition], () => ({ ok: result }));
    assert.equal(captured.possible, false);
    result = true;
    assert.equal(captured.check().ok, false);
    result = false;
  }
});

function simulation(seat: "player" | "bot", conditions?: readonly EffectCondition[]) {
  const player = (id: string) => ({ id, lp: 8000, hand: [], deck: [], field: [], graveyard: [], banished: [],
    extraDeck: [], spellTrap: [], fieldSpell: null, summonCount: 0, additionalNormalSummons: 0 });
  const state = unsafeFixture<SimulatedRuntimeState>({ bot: player(seat), player: player(seat === "player" ? "bot" : "player"),
    turn: seat, phase: "main1", turnCounter: 4, _isPerspectiveState: true }, "Explicit physical owner in either planning perspective");
  const copy = createPlanningCopy();
  const make = (id: number) => copy.cloneCardForSim(new Card(cardDefinition(id), seat));
  const raptor = copy.cloneCardForSim(new Card(raptorDefinition(conditions), seat)), prism = make(506), token = make(501), extra = make(513);
  token.effects = []; token.isToken = true; token.isTuner = false;
  placeFieldCards(state.bot.field, raptor, prism, token, make(504), make(504));
  state.bot.extraDeck.push(extra);
  return { state, raptor, prism, token, extra, copy, make };
}

for (const failPreparation of [false, true]) {
  test(`pending simulated plans restore their scope (${failPreparation ? "throw" : "nested"})`, () => {
    const { state, copy } = simulation("bot");
    state.bot.field.length = 0;
    const makeObserver = (id: string, event: "card_moved" | "standby_phase") => copy.cloneCardForSim(new Card({
      name: id, cardKind: "monster", level: 1, atk: 0, def: 0,
      effects: [{ id, timing: "on_event", event, triggerRequirement: "mandatory", triggerTiming: "if",
        actions: [{ type: "pay_lp", amount: 1, player: "self" }] }],
    }, "bot"));
    placeFieldCards(state.bot.field, makeObserver("outer-a", "card_moved"),
      makeObserver("outer-b", "card_moved"), makeObserver("nested", "standby_phase"));
    const plans = () => getSimulatedPendingEffectPlans(state).map(plan => plan.effect.id);
    let sawNested = false;
    const options = { enableSimulatedEvents: true,
      strategy: { buildActivationContextForEffect: ({ effect }: { effect: EffectDefinition }) => {
        if (effect.id === "outer-b") {
          assert.deepEqual(plans(), ["outer-a"], "the previous prepared plan is visible to the next policy");
          if (failPreparation) throw new Error("intentional preparation failure");
        }
        if (effect.id === "nested") assert.deepEqual(plans(), ["outer-a"]);
        return { decisions: { cases: { plan: effect.id || "" } } };
      } },
      onEffectActivated: ({ effect }: { effect?: EffectDefinition | null }) => {
        if (effect?.id === "outer-b") {
          assert.deepEqual(plans(), ["outer-a"], "the resolving plan has already been removed");
          const nested = createDeferredSimulatedEventFrame(state, options);
          nested.options.emitSimulatedEvent?.("standby_phase", { player: state.bot, deferActivationChecks: true });
          nested.finishResolution();
          assert.deepEqual(plans(), ["outer-a"], "nested scope restores the pending parent plan");
          sawNested = true;
        }
        if (effect?.id === "nested") assert.deepEqual(plans(), ["outer-a"]);
      },
    };
    const frame = createDeferredSimulatedEventFrame(state, options);
    frame.options.emitSimulatedEvent?.("card_moved", { player: state.bot, fromZone: "field", deferActivationChecks: true });
    if (failPreparation) assert.throws(() => frame.finishResolution(), /intentional preparation failure/);
    else { frame.finishResolution(); assert.equal(sawNested, true); }
    assert.deepEqual(plans(), [], "no pending plan survives the operation");
  });
}

for (const seat of ["player", "bot"] as const) {
  test(`simulated material freezes factual conditions at its movement (${seat})`, () => {
    const { state, raptor, prism, token, extra } = simulation(seat, [fact, capacity]);
    applyGenericSimulatedMainPhaseAction(state, { type: "synchro", synchroInstanceId: required(extra.instanceId),
      materialInstanceIds: [required(raptor.instanceId), required(prism.instanceId), required(token.instanceId)], position: "attack" },
      { enableSimulatedEvents: true, onSimulatedEvent: (event, payload) => {
        if (event === "card_to_grave" && Reflect.get(payload, "card") === prism) raptor.name = "Changed after the event";
      } });
    assert.equal(state.bot.field.filter(card => card.isToken).length, 2);
  });
  test(`simulated material cannot acquire a later observer (${seat})`, () => {
    const { state, raptor, prism, token, extra, copy } = simulation(seat);
    const observerEffect: EffectDefinition = { id: "observe_original_raptor", timing: "on_event", event: "card_to_grave",
      fromZone: "field", contextLabel: "synchro_material", triggerRequirement: "mandatory", triggerTiming: "if",
      eventCardFilters: { name: required(raptor.name) }, actions: [{ type: "damage", player: "opponent", amount: 321 }] };
    const observer = copy.cloneCardForSim(new Card({ name: "Late observer", cardKind: "monster", level: 1, atk: 0, def: 0,
      effects: [observerEffect] }, seat));
    applyGenericSimulatedMainPhaseAction(state, { type: "synchro", synchroInstanceId: required(extra.instanceId),
      materialInstanceIds: [required(raptor.instanceId), required(prism.instanceId), required(token.instanceId)], position: "attack" },
      { enableSimulatedEvents: true, onSimulatedEvent: (event, payload) => {
        if (event === "card_to_grave" && Reflect.get(payload, "card") === prism) placeFieldCards(state.bot.field, observer);
      } });
    assert.equal(state.player.lp, 8000);
  });
  test(`simulated false event fact cannot become eligible afterward (${seat})`, () => {
    const { state, raptor, prism, token, extra } = simulation(seat, [fact, capacity]);
    const originalName = raptor.name;
    raptor.name = "Initially unmatched material";
    applyGenericSimulatedMainPhaseAction(state, { type: "synchro", synchroInstanceId: required(extra.instanceId),
      materialInstanceIds: [required(raptor.instanceId), required(prism.instanceId), required(token.instanceId)], position: "attack" },
      { enableSimulatedEvents: true, onSimulatedEvent: (event, payload) => {
        if (event === "card_to_grave" && Reflect.get(payload, "card") === prism) raptor.name = originalName;
      } });
    assert.ok(state.bot.field.includes(extra));
    assert.equal(state.bot.field.filter(card => card.isToken).length, 0);
  });
  test(`failed simulated placement retains the existing unpublished material behavior (${seat})`, () => {
    const { state, raptor, prism, token, extra, make } = simulation(seat);
    applyGenericSimulatedMainPhaseAction(state, { type: "synchro", synchroInstanceId: required(extra.instanceId),
      materialInstanceIds: [required(raptor.instanceId), required(prism.instanceId), required(token.instanceId)], position: "attack" },
      { enableSimulatedEvents: true, onSimulatedEvent: (event, payload) => {
        if (event === "card_moved" && Reflect.get(payload, "card") === token)
          placeFieldCards(state.bot.field, make(504), make(504), make(504));
      } });
    assert.ok(state.bot.extraDeck.includes(extra));
    assert.equal(state.bot.field.filter(card => card.isToken).length, 0);
    assert.ok(state.bot.graveyard.includes(raptor));
  });
  test(`an invalid simulated material choice does not begin a procedure (${seat})`, () => {
    const { state, raptor, extra } = simulation(seat);
    const before = [...state.bot.field];
    applyGenericSimulatedMainPhaseAction(state, { type: "synchro", synchroInstanceId: required(extra.instanceId),
      materialInstanceIds: [required(raptor.instanceId), required(raptor.instanceId)], position: "attack" }, { enableSimulatedEvents: true });
    assert.deepEqual(state.bot.field, before);
    assert.equal(state.bot.graveyard.length, 0);
  });
}
