import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import ShadowHeartStrategy from "../../src/core/ai/ShadowHeartStrategy.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { refreshSimulatedFieldAuras } from "../../src/core/ai/common/zones.js";
import { getCounterValue } from "../../src/core/ai/common/counters.js";
import { getNormalSummonTributeOptions, getNormalTributeRequirement } from "../../src/core/game/summon/tributeValue.js";
import { getCounterLimitSummonOptions } from "../../src/core/actionHandlers/summon/counterLimit.js";
import { captureSourceSnapshot } from "../../src/core/chain/link.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

for (const seat of ["player", "bot"] as const) {
  test(`Cathedral common action retains pre-cost counters after source departure (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, disableChains: true });
    t.after(() => game.dispose());
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    const owner = game[seat];
    const source = new Card(cardDefinition(119), seat);
    const recruit = new Card(cardDefinition(101), seat);
    const tooLarge = new Card(cardDefinition(104), seat);
    source.isFacedown = false;
    source.addCounter("judgment_marker", 4);
    placeFieldCards(owner.spellTrap, source);
    owner.deck.push(recruit, tooLarge);
    const effect = required(source.effects.find(entry => entry.id === "shadow_heart_cathedral_summon_effect"));
    const action = required(effect.actions?.find(entry => entry.type === "special_summon_from_deck_with_counter_limit"));
    assert.equal(action.type, "special_summon_from_deck_with_counter_limit");
    const snapshot = captureSourceSnapshot(source, owner, "spellTrap");
    assert.deepEqual(snapshot?.counters, { judgment_marker: 4 });
    await game.moveCard(source, owner, "graveyard", { fromZone: "spellTrap", contextLabel: "cost" });
    // Movement currently preserves the Map. Changes after the commitment
    // still cannot change a counterSource=activation resolution limit.
    source.removeCounter("judgment_marker", 4);
    assert.equal(source.getCounter("judgment_marker"), 0);
    const oracle = getCounterLimitSummonOptions(action,
      { source, player: owner, activationContext: { sourceAtActivation: snapshot } }, { game });
    assert.equal(oracle.maxAtk, 2000);
    assert.deepEqual(oracle.candidates, [recruit]);

    const simSource = simulationCard({ ...cardDefinition(119), instanceId: source.instanceId, isFacedown: false,
      counters: new Map([["judgment_marker", 4]]) });
    const simRecruit = simulationCard({ ...cardDefinition(101), instanceId: recruit.instanceId });
    const simLarge = simulationCard({ ...cardDefinition(104), instanceId: tooLarge.instanceId });
    const state = simulationState({ _isPerspectiveState: true, turn: seat, phase: "main1", turnCounter: 4,
      bot: { id: seat, spellTrap: [simSource], deck: [simRecruit, simLarge] },
      player: { id: seat === "bot" ? "player" : "bot" } });
    const strategy = new ShadowHeartStrategy(state.bot);
    const options = strategy.getPlanningSimulationOptions(state);
    // The migration must retain the existing Strategy's selection policies
    // when its gameplay override is retired, rather than lose this action.
    applyGenericSimulatedMainPhaseAction(state,
      { type: "spellTrapEffect", zoneIndex: 0, cardId: 119, effectId: effect.id },
      { ...options, actionOverrides: null, enableSimulatedEvents: true,
        onSimulatedEvent(event, payload) {
          if (event === "card_moved" && "card" in payload && payload.card === simSource) {
            simSource.counters = new Map();
          }
        },
      });
    assert.ok(state.bot.graveyard.includes(simSource));
    assert.equal(getCounterValue(simSource, "judgment_marker"), 0);
    assert.ok(state.bot.field.some(card => card.instanceId === simRecruit.instanceId));
    assert.deepEqual(state.bot.deck, [simLarge]);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  test(`ShadowHeart uses the runtime alternate tribute requirement on a full field (${seat})`, () => {
    const incoming = simulationCard({ ...cardDefinition(257), instanceId: 9801 });
    const dragon = simulationCard({ ...cardDefinition(256), instanceId: 9802, atk: 0, def: 0, isFacedown: false });
    const others = [1, 5, 9, 23].map((id, index) => simulationCard({ ...cardDefinition(id),
      instanceId: 9810 + index, atk: 0, def: 0, isFacedown: false }));
    const state = simulationState({ _isPerspectiveState: true, turn: seat, phase: "main1", turnCounter: 4,
      bot: { id: seat, hand: [incoming], field: [dragon, ...others] },
      player: { id: seat === "bot" ? "player" : "bot" } });
    const legalCosts = getNormalSummonTributeOptions(state.bot, incoming);
    assert.equal(legalCosts.length, 1);
    assert.deepEqual(legalCosts[0], [dragon]);
    const oracle = getNormalTributeRequirement(incoming, state.bot.field);
    assert.equal(oracle.tributesNeeded, 1);
    const strategy = new ShadowHeartStrategy(state.bot);
    assert.equal(strategy.getTributeRequirementFor(incoming, state.bot).tributesNeeded, oracle.tributesNeeded);
    strategy.simulateMainPhaseAction(state, { type: "summon", index: 0, cardId: 257, position: "attack" });
    assert.equal(state.bot.field.length, 5);
    assert.equal(state.bot.graveyard.length, 1);
    assert.equal(state.bot.graveyard[0]?.instanceId, dragon.instanceId);
  });

  test(`ShadowHeart respects explicit requiredTributes precedence over an empty-field alternative (${seat})`, () => {
    // A valid constructor extension exercises the shared declaration contract;
    // it does not change the live card database or claim an existing card uses it.
    const incoming = simulationCard({ ...cardDefinition(104), instanceId: 9821,
      requiredTributes: 3, altTribute: { type: "no_tribute_if_empty_field" } });
    const state = simulationState({ _isPerspectiveState: true, turn: seat, phase: "main1", turnCounter: 4,
      bot: { id: seat, hand: [incoming] }, player: { id: seat === "bot" ? "player" : "bot" } });
    assert.equal(getNormalTributeRequirement(incoming, []).tributesNeeded, 3);
    assert.deepEqual(getNormalSummonTributeOptions(state.bot, incoming), []);
    const strategy = new ShadowHeartStrategy(state.bot);
    assert.equal(strategy.getTributeRequirementFor(incoming, state.bot).tributesNeeded, 3);
    strategy.simulateMainPhaseAction(state, { type: "summon", index: 0, cardId: 104 });
    assert.deepEqual(state.bot.hand, [incoming]);
    assert.deepEqual(state.bot.field, []);
  });

  for (const requiredTributes of [0, 3]) {
    test(`ShadowHeart pays explicit requiredTributes=${requiredTributes} or preserves an illegal full-field action (${seat})`, () => {
      const incoming = simulationCard({ ...cardDefinition(104), instanceId: 9831, requiredTributes });
      const bodies = [1, 5, 9, 23, 26].map((id, index) => simulationCard({ ...cardDefinition(id),
        instanceId: 9840 + index, atk: 0, def: 0, isFacedown: false }));
      const state = simulationState({ _isPerspectiveState: true, turn: seat, phase: "main1", turnCounter: 4,
        bot: { id: seat, hand: [incoming], field: bodies }, player: { id: seat === "bot" ? "player" : "bot" } });
      const legalCosts = getNormalSummonTributeOptions(state.bot, incoming);
      const strategy = new ShadowHeartStrategy(state.bot);
      assert.equal(strategy.getTributeRequirementFor(incoming, state.bot).tributesNeeded, requiredTributes);
      assert.equal(legalCosts.length > 0, requiredTributes === 3);
      strategy.simulateMainPhaseAction(state, { type: "summon", index: 0, cardId: 104, position: "attack" });
      if (requiredTributes === 0) {
        assert.deepEqual(state.bot.hand, [incoming]);
        assert.deepEqual(state.bot.field, bodies);
        assert.equal(state.bot.summonCount, 0);
      } else {
        const summoned = required(state.bot.field.find(card => card.instanceId === incoming.instanceId));
        assert.equal(summoned.lastTributeMaterialCount, 3);
        assert.equal(state.bot.graveyard.length, 3);
        assert.equal(state.bot.field.length, 3);
      }
    });
  }

  test(`Darkness Valley has no activatable Field effect in runtime or Strategy (${seat})`, t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
    t.after(() => game.dispose());
    game.turn = seat; game.phase = "main1";
    const source = new Card(cardDefinition(115), seat);
    source.isFacedown = false;
    game[seat].fieldSpell = source;
    const preview = game.effectEngine.canActivateFieldSpellEffectPreview(source, game[seat]);
    assert.equal(preview.ok, false);
    const valley = simulationCard({ ...cardDefinition(115), isFacedown: false });
    const body = simulationCard({ ...cardDefinition(101), isFacedown: false });
    const state = simulationState({ _isPerspectiveState: true, turn: seat, phase: "main1",
      bot: { id: seat, fieldSpell: valley, field: [body] }, player: { id: seat === "bot" ? "player" : "bot" } });
    refreshSimulatedFieldAuras(state);
    const strategy = new ShadowHeartStrategy(state.bot);
    assert.equal(strategy.generateMainPhaseActions(state).some(action => action.type === "fieldEffect"), false);
    const before = structuredClone(state);
    strategy.simulateMainPhaseAction(state, { type: "fieldEffect", cardId: 115 });
    assert.deepEqual(state, before, "an injected nonexistent activation is inert on an already valid board");
  });
}

for (const seat of ["player", "bot"] as const) {
  for (const key of ["counter_summon", "shadow_heart_cathedral_summon_effect"] as const) {
    for (const available of [true, false]) {
      test(`Cathedral preserves an exact same-name recruit decision (${seat}/${key}/${available})`, () => {
        const source = simulationCard({ ...cardDefinition(119), instanceId: 9901,
          counters: new Map([["judgment_marker", 4]]), isFacedown: false });
        const first = simulationCard({ ...cardDefinition(101), instanceId: 9902 });
        const selected = simulationCard({ ...cardDefinition(101), instanceId: 9903 });
        const state = simulationState({ _isPerspectiveState: true, phase: "main1", turn: seat,
          bot: { id: seat, spellTrap: [source], deck: available ? [first, selected] : [first] },
          player: { id: seat === "bot" ? "player" : "bot" } });
        const strategy = new ShadowHeartStrategy(state.bot);
        strategy.simulateMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0, cardId: 119,
          effectId: "shadow_heart_cathedral_summon_effect",
          activationContext: { decisions: { specialSummons: { [key]: [9903] } } } });
        assert.ok(state.bot.graveyard.includes(source), "the declared cost is paid before resolution selection");
        assert.ok(state.bot.deck.includes(first), "the other physical copy is never substituted");
        if (available) {
          assert.deepEqual(state.bot.field, [selected]);
          assert.deepEqual(state._simUnsupportedActions || [], []);
        } else {
          assert.deepEqual(state.bot.field, []);
          assert.deepEqual(state._simUnsupportedActions, [`exact_special_summon:${key}`]);
        }
      });
    }
  }

  for (const decline of [false, true]) {
    test(`counter-limit summon preserves the caller's explicit card-selection policy (${seat}/${decline})`, () => {
      const source = simulationCard({ ...cardDefinition(119), instanceId: 9911, effects: [],
        counters: new Map([["judgment_marker", 4]]) });
      const first = simulationCard({ ...cardDefinition(101), instanceId: 9912, effects: [] });
      const selected = simulationCard({ ...cardDefinition(101), instanceId: 9913, effects: [] });
      const state = simulationState({ phase: "main1", turn: seat,
        [seat]: { spellTrap: [source], deck: [first, selected] } });
      let calls = 0;
      applySimulatedActions({ state, selfId: seat,
        actions: [{ type: "special_summon_from_deck_with_counter_limit", archetype: "Shadow-Heart" }],
        options: { sourceCard: source, chooseSpecialSummonCards(candidates) {
          calls++; assert.ok(candidates.includes(selected)); return decline ? null : [selected];
        } } });
      assert.equal(calls, 1);
      assert.deepEqual(state[seat].field, decline ? [] : [selected]);
      assert.ok(state[seat].deck.includes(first));
    });
  }

  for (const fillDuringPositionChoice of [false, true]) {
    test(`counter-limit source cleanup follows only a completed summon and emits movement (${seat}/${fillDuringPositionChoice})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, disableChains: true });
      t.after(() => game.dispose());
      game.turn = seat; game.phase = "main1"; game.turnCounter = 4; game.disablePresentationDelays = true;
      const owner = game[seat], opponent = game[seat === "bot" ? "player" : "bot"];
      owner.controllerType = "ai";
      // Isolate this existing action capability from unrelated card triggers.
      const source = new Card({ ...cardDefinition(119), effects: [] }, seat);
      source.isFacedown = false; source.addCounter("judgment_marker", 4);
      const recruit = new Card({ ...cardDefinition(101), effects: [] }, seat);
      placeFieldCards(owner.spellTrap, source); owner.deck.push(recruit);
      const copy = createPlanningCopy();
      const simSource = copy.cloneCardForSim(source), simRecruit = copy.cloneCardForSim(recruit);
      const state = simulationState({ phase: "main1", turn: seat, turnCounter: 4,
        [seat]: { spellTrap: [simSource], deck: [simRecruit] } });
      const runtimeEvents: string[] = [], simulatedEvents: string[] = [];
      game.on("after_summon", event => { if (event.card === recruit) runtimeEvents.push("summon"); });
      game.on("card_moved", event => { if (event.card === source) runtimeEvents.push("source_moved"); });
      game.on("card_to_grave", event => { if (event.card === source) runtimeEvents.push("source_grave"); });
      game.effectEngine.chooseSpecialSummonPosition = async () => {
        if (fillDuringPositionChoice) for (let index = 0; index < 5; index++)
          placeFieldCards(owner.field, new Card({ ...cardDefinition(1), effects: [] }, seat));
        return "attack";
      };
      const action = { type: "special_summon_from_deck_with_counter_limit", archetype: "Shadow-Heart",
        counterType: "judgment_marker", sendSourceToGraveAfter: true } as const;
      await game.effectEngine.applyActions([action], { source, player: owner, opponent }, {});
      applySimulatedActions({ actions: [action], state, selfId: seat, options: { sourceCard: simSource,
        chooseSpecialSummonPosition() {
          if (fillDuringPositionChoice) for (let index = 0; index < 5; index++) state[seat].field.push(simulationCard({
            ...cardDefinition(1), effects: [], instanceId: 9920 + index, owner: seat, controller: seat,
            fieldSlot: index as 0 | 1 | 2 | 3 | 4,
          }));
          return "attack";
        },
        emitSimulatedEvent(event, payload) {
          if (event === "after_summon" && "card" in payload && payload.card === simRecruit) simulatedEvents.push("summon");
          if ("card" in payload && payload.card === simSource) {
            if (event === "card_moved") simulatedEvents.push("source_moved");
            if (event === "card_to_grave") simulatedEvents.push("source_grave");
          }
        },
      } });
      assert.equal(state[seat].spellTrap.includes(simSource), owner.spellTrap.includes(source));
      assert.equal(state[seat].graveyard.includes(simSource), owner.graveyard.includes(source));
      assert.equal(state[seat].deck.includes(simRecruit), owner.deck.includes(recruit));
      assert.equal(state[seat].field.includes(simRecruit), owner.field.includes(recruit));
      if (fillDuringPositionChoice) assert.deepEqual(simulatedEvents, []);
      else {
        assert.ok(simulatedEvents.includes("source_moved")); assert.ok(simulatedEvents.includes("source_grave"));
        for (const events of [runtimeEvents, simulatedEvents])
          assert.ok(events.indexOf("summon") < events.indexOf("source_moved"), JSON.stringify(events));
      }
    });
  }
}
