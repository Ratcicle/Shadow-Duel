import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../../src/core/Card.js";
import { attachSimulatedEventEmitter } from "../../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { getCounterValue } from "../../src/core/ai/common/counters.js";
import { moveCardToZone } from "../../src/core/ai/common/zones.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { cardDefinition } from "../helpers/fixtures.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";
import type { ActionOf } from "../../src/core/contracts/actions.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";

function runtime(t: TestContext, seat: "player" | "bot") {
  const game = createRuntimeGame({ laboratoryMode: true, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.turn = seat; game.turnCounter = 3; game.phase = "main1";
  game.player.controllerType = game.bot.controllerType = "ai";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  return game;
}

function cards(seat: "player" | "bot", survivingSpores = 6) {
  const other: "player" | "bot" = seat === "player" ? "bot" : "player";
  const fusion = new Card(cardDefinition(420), seat);
  const token = new Card({ ...cardDefinition(401), effects: [] }, seat); token.isToken = true;
  const materials = [token, ...Array.from({ length: 3 }, () => new Card({ ...cardDefinition(402), effects: [] }, seat))];
  const spores = new Card({ ...cardDefinition(1), effects: [] }, other); spores.addCounter("spore", survivingSpores);
  return { fusion, token, materials, spores, other };
}

for (const seat of ["player", "bot"] as const) {
  for (const key of ["source.level", "player.lp", "opponent.lp"] as const) {
    test(`set_original_stats reads canonical ${key} alongside nested context (${seat})`, async t => {
      const game = runtime(t, seat), other = seat === "player" ? "bot" : "player";
      game[seat].lp = 6100; game[other].lp = 4300;
      const actual = new Card({ ...cardDefinition(420), effects: [] }, seat);
      const source = new Card({ ...cardDefinition(401), effects: [] }, seat);
      const nested = new Card({ ...cardDefinition(402), effects: [] }, seat);
      nested.level = 9;
      placeFieldCards(game[seat].field, actual, source);
      const projected = simulationCard(new Card({ ...cardDefinition(420), effects: [] }, seat));
      const simSource = simulationCard(source), simNested = simulationCard(nested);
      const state = simulationState({ [seat]: { field: [projected, simSource], lp: 6100 }, [other]: { lp: 4300 } });
      const action: ActionOf<"set_original_stats"> = { type: "set_original_stats", targetRef: "chosen",
        atkFromContext: { key, multiplier: 3, divideBy: 2, round: "ceil" } };
      await game.effectEngine.applyActions([action], { source, player: game[seat], opponent: game[other],
        actionContext: { card: nested } }, { chosen: [actual] });
      assert.equal(applySimulatedActions({ state, selfId: seat, actions: [action], selections: { chosen: [projected] },
        options: { sourceCard: simSource, actionContext: { card: simNested } } }), true);
      assert.equal(projected.baseAtk, actual.baseAtk);
      assert.equal(projected.atk, actual.atk);
    });
  }
  for (const survivingSpores of [0, 1, 6, 13]) {
  test(`Devourer Fusion matches runtime original ATK with ${survivingSpores} surviving Spores (${seat})`, async t => {
    const game = runtime(t, seat), actual = cards(seat, survivingSpores);
    game[seat].extraDeck.push(actual.fusion);
    placeFieldCards(game[seat].field, actual.token);
    game[seat].hand.push(...actual.materials.slice(1));
    placeFieldCards(game[actual.other].field, actual.spores);
    const polymerization = new Card(cardDefinition("Polymerization"), seat);
    game[seat].hand.push(polymerization);
    assert.equal((await game.tryActivateSpell(polymerization, game[seat].hand.indexOf(polymerization), null,
      { owner: game[seat] })).success, true);
    assert.equal(actual.fusion.atk, survivingSpores * 500);
    assert.equal(actual.fusion.baseAtk, survivingSpores * 500);

    const projected = cards(seat, survivingSpores), fusion = simulationCard(projected.fusion);
    const materials = projected.materials.map(card => simulationCard(card));
    const state = simulationState({ turn: seat, phase: "main1", turnCounter: 3,
      [seat]: { extraDeck: [fusion], field: [materials[0]!], hand: materials.slice(1) },
      [projected.other]: { field: [simulationCard(projected.spores)] } });
    const events: string[] = [];
    const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true,
      onSimulatedEvent: event => { events.push(event); } });
    assert.equal(applySimulatedActions({ state, selfId: seat, actions: [{ type: "polymerization_fusion_summon" }], options }), true);
    assert.ok(state[seat].field.includes(fusion));
    assert.deepEqual([fusion.atk, fusion.def, fusion.baseAtk, fusion.baseDef, fusion.originalStatsOverride],
      [actual.fusion.atk, actual.fusion.def, actual.fusion.baseAtk, actual.fusion.baseDef, actual.fusion.originalStatsOverride]);
    assert.equal(events.filter(event => event === "after_summon").length, 1);
    assert.deepEqual(state._simUnsupportedActions ?? [], []);
  });
  }

  for (const sourceRole of ["self-exit", "self-exit-late", "observer-reference"] as const) {
    test(`Fusion captures ${sourceRole} at its runtime ingress around a material callback (${seat})`, async t => {
      const game = runtime(t, seat), actual = cards(seat), projected = cards(seat);
      const referenceEffect: EffectDefinition = { id: "b14_fixture_frozen_material_reference", timing: "on_event",
        event: "card_moved", fromZone: "field", toZone: "graveyard", triggerRequirement: "mandatory",
        triggerTiming: "if", triggerPlayer: "self",
        targets: [{ id: "event_material", intent: "reference", targetFromContext: "eventCard",
          owner: "self", zones: ["graveyard"], count: { min: 1, max: 1 }, minAtResolution: 1 }],
        actions: [{ type: "heal", amount: 100, player: "self" },
          { type: "add_counter", targetRef: "event_material", counterType: "spore", amount: 1 }] };
      const isSelfExit = sourceRole !== "observer-reference";
      const definition = { ...cardDefinition(isSelfExit ? 401 : 402),
        ...(sourceRole === "observer-reference" ? { effects: [] } : {}) };
      const actualMaterial = new Card(definition, seat), material = simulationCard(new Card(definition, seat));
      const actualObserver = new Card({ ...cardDefinition(1), effects: [referenceEffect] }, seat);
      const observer = simulationCard(new Card({ ...cardDefinition(1), effects: [referenceEffect] }, seat));
      const deckCard = new Card({ ...cardDefinition(414), effects: [] }, seat);
      game[seat].deck.push(deckCard);
      game[seat].extraDeck.push(actual.fusion);
      placeFieldCards(game[seat].field, actual.token, actualMaterial,
        ...(sourceRole === "observer-reference" ? [actualObserver] : []));
      const spell = new Card(cardDefinition("Polymerization"), seat);
      game[seat].hand.push(...actual.materials.slice(2), spell);
      placeFieldCards(game[actual.other].field, actual.spores);
      let actualMoved = false;
      const callbackEvent = sourceRole === "self-exit" ? "card_to_grave" : "card_moved";
      game.on(callbackEvent, async payload => {
        if (payload.card !== actualMaterial || payload.fromZone !== "field" || actualMoved) return;
        actualMoved = true;
        await game.moveCard(actualMaterial, game[seat], "hand", { fromZone: "graveyard", awaitCardMovedEvent: true });
        await game.moveCard(actualMaterial, game[seat], "graveyard", { fromZone: "hand", awaitCardMovedEvent: true });
      });
      const rejections: [string, string | null | undefined, string | null | undefined][] = [];
      game.on("trigger_candidate_rejected", event => {
        const role = event.cardInstanceId === actualMaterial.instanceId ? "material"
          : event.cardInstanceId === actualObserver.instanceId ? "observer" : String(event.cardName);
        rejections.push([role, event.effectId, event.rejectionReason]);
      });
      assert.equal((await game.tryActivateSpell(spell, game[seat].hand.indexOf(spell), null, { owner: game[seat] })).success, true);
      assert.equal(actualMoved, true);
      assert.equal(game[seat].lp, 8000);
      // D2 (official rule): a "leaves the field" trigger is lost when its source moves again before
      // activation. The material went GY -> hand -> GY, so the runtime refuses the self-exit search.
      assert.equal(game[seat].deck.includes(deckCard), true);
      assert.deepEqual(rejections, isSelfExit
        ? [["material", "bloomrot_sporeling_leave_field_search_spell", "source_location_changed"]] : []);
      assert.equal(actualMaterial.getCounter("spore"), 0);

      const fusion = simulationCard(projected.fusion), simDeckCard = simulationCard(deckCard);
      const state = simulationState({ turn: seat, phase: "main1", turnCounter: 3,
        [seat]: { deck: [simDeckCard], extraDeck: [fusion], field: [simulationCard(projected.token), material,
          ...(sourceRole === "observer-reference" ? [observer] : [])],
          hand: projected.materials.slice(2).map(card => simulationCard(card)) },
        [projected.other]: { field: [simulationCard(projected.spores)] } });
      let moved = false, observed = 0;
      const options = { enableSimulatedEvents: true, onSimulatedEvent: (event: string, payload: object = {}) => {
        if (event !== callbackEvent || Reflect.get(payload, "card") !== material || Reflect.get(payload, "fromZone") !== "field") return;
        observed++;
        if (moved) return;
        moved = true;
        assert.equal(moveCardToZone(state[seat], material, "hand", state[seat], { state }), true);
        assert.equal(moveCardToZone(state[seat], material, "graveyard", state[seat], { state }), true);
      } };
      assert.equal(applySimulatedActions({ state, selfId: seat, actions: [{ type: "polymerization_fusion_summon" }], options }), true);
      assert.equal(moved, true); assert.equal(observed, 1);
      assert.equal(state[seat].lp, game[seat].lp);
      // Known divergence, fixed in Phase 1.5 Etapa 7: in self-exit the simulation still searches while the
      // runtime refuses it. The runtime snapshots the source's current locationVersion after the synchronous
      // listener prefix; the synchronous simulation already sees the card back in the GY. Etapa 7 moves both
      // to the payload locationVersion; only then this expects `true` and self-exit-late drops the
      // deferred_trigger_source_presence fallback asserted below.
      assert.equal(state[seat].deck.includes(simDeckCard), sourceRole !== "self-exit");
      assert.equal(getCounterValue(material, "spore"), 0);
      assert.equal(fusion.atk, actual.fusion.atk);
      assert.deepEqual(state._simUnsupportedActions ?? [], sourceRole === "self-exit-late"
        ? ["deferred_trigger_source_presence"] : []);
    });
  }

  test(`Fusion preserves an external rules dispatcher without executing its effects twice (${seat})`, async t => {
    const game = runtime(t, seat), actual = cards(seat);
    const effect: EffectDefinition = { id: "b14_fixture_external_fusion_heal", timing: "on_event", event: "after_summon",
      requireSelfAsSummoned: true, summonMethods: ["fusion"], triggerRequirement: "mandatory", triggerTiming: "if",
      actions: [{ type: "heal", player: "self", amount: 17 }] };
    actual.fusion.effects = [effect];
    game[seat].extraDeck.push(actual.fusion);
    placeFieldCards(game[seat].field, actual.token);
    const spell = new Card(cardDefinition("Polymerization"), seat);
    game[seat].hand.push(spell, ...actual.materials.slice(1));
    const projected = cards(seat), fusion = simulationCard(projected.fusion);
    fusion.effects = [effect];
    const state = simulationState({ turn: seat, phase: "main1", turnCounter: 3,
      [seat]: { field: [simulationCard(projected.token)], hand: projected.materials.slice(1).map(card => simulationCard(card)),
        extraDeck: [fusion] } });
    const dispatcher = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true });
    let summons = 0;
    const externalDispatcher = (event: string, payload: object) => {
      if (event === "after_summon") summons++;
      dispatcher.emitSimulatedEvent?.(event, payload);
    };
    assert.equal((await game.tryActivateSpell(spell, 0, null, { owner: game[seat] })).success, true);
    assert.equal(game[seat].lp, 8017);
    assert.equal(applySimulatedActions({ state, selfId: seat, actions: [{ type: "polymerization_fusion_summon" }],
      options: { emitSimulatedEvent: externalDispatcher } }), true);
    assert.equal(summons, 1);
    assert.equal(state[seat].lp, game[seat].lp);
    assert.deepEqual(state._simUnsupportedActions ?? [], ["deferred_event_frame:custom_emitter"]);
  });

  test(`generic set_original_stats follows runtime partial updates and exact instance (${seat})`, async t => {
    const game = runtime(t, seat), other = seat === "player" ? "bot" : "player";
    const actual = new Card({ ...cardDefinition(420), effects: [] }, seat);
    const untouched = new Card({ ...cardDefinition(420), effects: [] }, seat);
    placeFieldCards(game[seat].field, actual, untouched);
    actual.atk = 125; actual.def = 3210; actual.level = 5;
    const projected = simulationCard(new Card({ ...cardDefinition(420), effects: [] }, seat));
    const copy = simulationCard(new Card({ ...cardDefinition(420), effects: [] }, seat));
    projected.atk = 125; projected.def = 3210; projected.level = 5;
    const state = simulationState({ turn: seat, phase: "main1", turnCounter: 3, [seat]: { field: [projected, copy] } });
    const actions: ActionOf<"set_original_stats">[] = [
      { type: "set_original_stats", targetRef: "chosen", atkFromContext: { key: "card.level", multiplier: 500, divideBy: 2 } },
      { type: "set_original_stats", targetRef: "chosen", def: 1500.9, updateCurrentStats: false },
      { type: "set_original_stats", targetRef: "chosen", baseAtk: -30, baseDef: 1234 },
    ];
    for (const action of actions) {
      await game.effectEngine.applyActions([action], { source: actual, player: game[seat], opponent: game[other],
        actionContext: { card: actual } }, { chosen: [actual] });
      assert.equal(applySimulatedActions({ state, selfId: seat, actions: [action], selections: { chosen: [projected] },
        options: { sourceCard: projected, actionContext: { card: projected } } }), true);
      assert.deepEqual([projected.atk, projected.def, projected.baseAtk, projected.baseDef, projected.originalStatsOverride],
        [actual.atk, actual.def, actual.baseAtk, actual.baseDef, actual.originalStatsOverride]);
      assert.deepEqual([copy.atk, copy.def, copy.originalStatsOverride], [untouched.atk, untouched.def, untouched.originalStatsOverride]);
      assert.deepEqual(state._simUnsupportedActions ?? [], []);
    }
  });

  test(`negated Devourer does not apply original-stat changes during Fusion (${seat})`, async t => {
    const game = runtime(t, seat), actual = cards(seat), projected = cards(seat);
    actual.fusion.effectsNegated = projected.fusion.effectsNegated = true;
    game[seat].extraDeck.push(actual.fusion);
    placeFieldCards(game[seat].field, actual.token);
    const spell = new Card(cardDefinition("Polymerization"), seat);
    game[seat].hand.push(...actual.materials.slice(1), spell);
    placeFieldCards(game[actual.other].field, actual.spores);
    assert.equal((await game.tryActivateSpell(spell, game[seat].hand.indexOf(spell), null, { owner: game[seat] })).success, true);
    const fusion = simulationCard(projected.fusion);
    const state = simulationState({ turn: seat, phase: "main1", turnCounter: 3,
      [seat]: { extraDeck: [fusion], field: [simulationCard(projected.token)],
        hand: projected.materials.slice(1).map(card => simulationCard(card)) },
      [projected.other]: { field: [simulationCard(projected.spores)] } });
    assert.equal(applySimulatedActions({ state, selfId: seat, actions: [{ type: "polymerization_fusion_summon" }],
      options: { enableSimulatedEvents: true } }), true);
    assert.deepEqual([fusion.baseAtk, fusion.atk, fusion.originalStatsOverride],
      [actual.fusion.baseAtk, actual.fusion.atk, actual.fusion.originalStatsOverride]);
    assert.deepEqual([fusion.baseAtk, fusion.originalStatsOverride], [0, undefined]);
    assert.deepEqual(state._simUnsupportedActions ?? [], []);
  });

  for (const destination of ["graveyard", "banished"] as const) {
    test(`original stats and tracked buffs reset on ${destination} departure (${seat})`, async t => {
      const game = runtime(t, seat), other = seat === "player" ? "bot" : "player";
      const actual = new Card({ ...cardDefinition(420), effects: [] }, seat);
      const projected = simulationCard(new Card({ ...cardDefinition(420), effects: [] }, seat));
      placeFieldCards(game[seat].field, actual);
      const state = simulationState({ [seat]: { field: [projected] } });
      const actions: ActionOf<"set_original_stats" | "buff_stats_temp">[] = [
        { type: "buff_stats_temp", targetRef: "self", atkBoost: 200, defBoost: 100 },
        { type: "set_original_stats", atk: 3000 },
      ];
      await game.effectEngine.applyActions(actions, { source: actual, player: game[seat], opponent: game[other] }, {});
      assert.equal(applySimulatedActions({ state, selfId: seat, actions, options: { sourceCard: projected } }), true);
      assert.deepEqual([projected.atk, projected.def, projected.originalStatsOverride],
        [actual.atk, actual.def, actual.originalStatsOverride]);
      await game.moveCard(actual, game[seat], destination, { fromZone: "field", awaitCardMovedEvent: true });
      assert.equal(moveCardToZone(state[seat], projected, destination, state[seat], { state }), true);
      assert.deepEqual([projected.atk, projected.def, projected.baseAtk, projected.baseDef, projected.originalStatsOverride],
        [actual.atk, actual.def, actual.baseAtk, actual.baseDef, actual.originalStatsOverride]);
      assert.deepEqual([projected.baseAtk, projected.baseDef, projected.originalStatsOverride], [0, 3000, undefined]);
      assert.deepEqual(state._simUnsupportedActions ?? [], []);
    });
  }

  for (const materialState of ["faceup", "facedown", "redirected", "borrowed"] as const) {
    test(`Fusion material events preserve ${materialState} identity, destination and controller (${seat})`, async t => {
      const game = runtime(t, seat), actual = cards(seat), projected = cards(seat);
      const actualMaterial = actual.materials[1]!, material = simulationCard(projected.materials[1]!);
      if (materialState === "facedown") actualMaterial.isFacedown = material.isFacedown = true;
      if (materialState === "redirected") actualMaterial.banishWhenLeavesField = material.banishWhenLeavesField = true;
      if (materialState === "borrowed") actualMaterial.originalOwner = material.originalOwner = actual.other;
      // These consumed counters cannot contribute to the Fusion's original ATK.
      actualMaterial.addCounter("spore", 8); material.counters = new Map([["spore", 8]]);
      game[seat].extraDeck.push(actual.fusion);
      placeFieldCards(game[seat].field, actual.token, actualMaterial);
      const spell = new Card(cardDefinition("Polymerization"), seat);
      game[seat].hand.push(...actual.materials.slice(2), spell);
      placeFieldCards(game[actual.other].field, actual.spores);
      const actualEvents: unknown[] = [];
      const summary = (payload: object, event: string) => [Reflect.get(payload, "fromZone"), Reflect.get(payload, "toZone"),
        Reflect.get(payload, "fromPlayer")?.id, Reflect.get(payload, "toPlayer")?.id ?? null,
        Reflect.get(payload, "player")?.id, ...(event === "card_moved" ? [Reflect.get(payload, "wasFaceupBeforeMove"),
        Reflect.get(payload, "locationVersion"), Reflect.get(payload, "movedByEffect")] : [])];
      for (const event of ["card_to_grave", "card_moved"] as const) game.on(event, payload => {
        if (payload.card === actualMaterial || payload.card === actual.token)
          actualEvents.push([event, payload.card === actual.token ? "token" : "material", summary(payload, event)]);
      });
      assert.equal((await game.tryActivateSpell(spell, game[seat].hand.indexOf(spell), null, { owner: game[seat] })).success, true);
      const fusion = simulationCard(projected.fusion);
      const token = simulationCard(projected.token), simEvents: unknown[] = [];
      const state = simulationState({ turn: seat, phase: "main1", turnCounter: 3,
        [seat]: { extraDeck: [fusion], field: [token, material], hand: projected.materials.slice(2).map(card => simulationCard(card)) },
        [projected.other]: { field: [simulationCard(projected.spores)] } });
      assert.equal(applySimulatedActions({ state, selfId: seat, actions: [{ type: "polymerization_fusion_summon" }],
        options: { enableSimulatedEvents: true, onSimulatedEvent: (event, payload) => {
          if ((event === "card_to_grave" || event === "card_moved") &&
              (Reflect.get(payload, "card") === material || Reflect.get(payload, "card") === token))
            simEvents.push([event, Reflect.get(payload, "card") === token ? "token" : "material", summary(payload, event)]);
        } } }), true);
      const byRole = (list: unknown[]) => [...list].sort((a, b) => String(a).localeCompare(String(b)));
      assert.deepEqual(byRole(simEvents), byRole(actualEvents));
      assert.equal(fusion.baseAtk, actual.fusion.baseAtk);
      assert.equal(fusion.baseAtk, 3000);
      const holder = materialState === "borrowed" ? actual.other : seat;
      const zone = materialState === "redirected" ? "banished" : "graveyard";
      assert.ok(state[holder][zone].includes(material));
      assert.equal(material.controller, actualMaterial.controller);
      assert.deepEqual(state._simUnsupportedActions ?? [], []);
    });
  }

  test(`set_original_stats rejects missing configuration and non-monster recipients (${seat})`, async t => {
    const game = runtime(t, seat), other = seat === "player" ? "bot" : "player";
    const actual = new Card(cardDefinition("Polymerization"), seat), projected = simulationCard(actual);
    game[seat].hand.push(actual);
    const state = simulationState({ [seat]: { hand: [projected] } });
    for (const action of [{ type: "set_original_stats" as const }, { type: "set_original_stats" as const, atk: 700 }]) {
      const result = await game.effectEngine.applyActions([action], { source: actual, player: game[seat], opponent: game[other] }, {});
      assert.equal(typeof result === "object" && result !== null ? result.success : result, false);
      assert.equal(applySimulatedActions({ state, selfId: seat, actions: [action], options: { sourceCard: projected } }), false);
      assert.equal(projected.originalStatsOverride, undefined);
    }
    assert.deepEqual(state._simUnsupportedActions ?? [], []);
  });

  test(`Fusion holds material triggers until placement and resolves pending effects LIFO (${seat})`, async t => {
    const effect: EffectDefinition = { id: "b14_fixture_material_spore", timing: "on_event", event: "card_to_grave",
      fromZone: "field", triggerRequirement: "mandatory", triggerTiming: "if",
      actions: [{ type: "add_counter", targetScope: { owner: "opponent", zones: ["field"] }, counterType: "spore", amount: 1 }] };
    const game = runtime(t, seat), actual = cards(seat), actualMaterial = actual.materials[1]!;
    actualMaterial.effects = [effect];
    const actualTimeline: string[] = [];
    game.on("after_summon", payload => { if (payload.card === actual.fusion) actualTimeline.push("summon"); });
    game.on("original_stats_changed", payload => { if (payload.card === actual.fusion)
      actualTimeline.push(`fusion:${actual.spores.getCounter("spore")}`); });
    game[seat].extraDeck.push(actual.fusion);
    placeFieldCards(game[seat].field, actual.token, actualMaterial);
    const spell = new Card(cardDefinition("Polymerization"), seat);
    game[seat].hand.push(...actual.materials.slice(2), spell);
    placeFieldCards(game[actual.other].field, actual.spores);
    assert.equal((await game.tryActivateSpell(spell, game[seat].hand.indexOf(spell), null, { owner: game[seat] })).success, true);

    const projected = cards(seat), material = simulationCard(projected.materials[1]!);
    material.effects = [effect];
    const fusion = simulationCard(projected.fusion), sporeCard = simulationCard(projected.spores);
    const state = simulationState({ turn: seat, phase: "main1", turnCounter: 3,
      [seat]: { extraDeck: [fusion], field: [simulationCard(projected.token), material],
        hand: projected.materials.slice(2).map(card => simulationCard(card)) }, [projected.other]: { field: [sporeCard] } });
    const timeline: string[] = [];
    const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true,
      onSimulatedEvent: (event, payload) => {
        if (event === "after_summon" && Reflect.get(payload, "card") === fusion) timeline.push("summon");
        if (event === "original_stats_changed" && Reflect.get(payload, "card") === fusion)
          timeline.push(`fusion:${getCounterValue(sporeCard, "spore")}`);
      } });
    applySimulatedActions({ state, selfId: seat, actions: [{ type: "polymerization_fusion_summon" }], options });
    assert.deepEqual(timeline, actualTimeline);
    assert.deepEqual([fusion.atk, fusion.baseAtk, getCounterValue(sporeCard, "spore")],
      [actual.fusion.atk, actual.fusion.baseAtk, actual.spores.getCounter("spore")]);
    assert.deepEqual(state._simUnsupportedActions ?? [], []);
  });
}
