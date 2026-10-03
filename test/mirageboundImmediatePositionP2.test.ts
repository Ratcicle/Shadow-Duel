import assert from "node:assert/strict";
import test from "node:test";
import Card from "../src/core/Card.js";
import { createPlanningCopy } from "../src/core/ai/common/planningCopy.js";
import { applyGenericSimulatedMainPhaseAction, attachSimulatedEventEmitter } from "../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { cardDefinition } from "./helpers/fixtures.js";
import { simulationState } from "./helpers/simulation.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { cleanupSimulatedEndTurn } from "../src/core/ai/common/simulatedActions/lifecycle.js";
import { getImmediateEventEffectValidationError } from "../src/core/effects/passives/passiveBuffs.js";
import { required, unsafeFixture } from "./helpers/fixtures.js";
import type { CardFilter, EffectDefinition } from "../src/core/contracts/effects.js";

const clone = createPlanningCopy().cloneCardForSim;
const make = (id: number, seat: "player" | "bot") => clone(new Card(cardDefinition(id), seat));

const canonicalFilterCases: readonly {
  name: string;
  filters: CardFilter;
  prepare(card: Card): void;
  matches: boolean;
}[] = [
  { name: "missing counters", filters: { minCounters: 2, counterType: "charge" }, prepare: () => {}, matches: false },
  { name: "different counter type", filters: { minCounters: 2, counterType: "charge" },
    prepare: card => { card.counters.set("other", 2); }, matches: false },
  { name: "enough named counters", filters: { minCounters: 2, counterType: "charge" },
    prepare: card => { card.counters.set("charge", 2); }, matches: true },
  { name: "default counter type", filters: { minCounters: 2 },
    prepare: card => { card.counters.set("default", 2); }, matches: true },
  { name: "default level operator rejects lower level", filters: { level: 3 },
    prepare: card => { card.level = 2; }, matches: false },
  { name: "default level operator accepts equal level", filters: { level: 3 },
    prepare: card => { card.level = 3; }, matches: true },
  { name: "explicit level operator accepts lower level", filters: { level: 3, levelOp: "lte" },
    prepare: card => { card.level = 2; }, matches: true },
  { name: "name alias takes precedence when matching", filters: { name: "Canonical Match", cardName: "Different" },
    prepare: card => { card.name = "Canonical Match"; }, matches: true },
  { name: "name alias takes precedence when rejecting", filters: { name: "Different", cardName: "Canonical Match" },
    prepare: card => { card.name = "Canonical Match"; }, matches: false },
  { name: "original card kind", filters: { cardKind: "spell" },
    prepare: card => { card.originalCardKind = "spell"; }, matches: true },
  { name: "treated-as card kind", filters: { cardKind: "spell" },
    prepare: card => { card.treatedAsCardKinds = ["spell"]; }, matches: true },
  { name: "unmatched card kind", filters: { cardKind: "spell" }, prepare: () => {}, matches: false },
  { name: "archetype array excludes primary alias", filters: { archetype: "Miragebound" },
    prepare: card => { card.archetype = "Miragebound"; card.archetypes = ["Other"]; }, matches: false },
  { name: "archetype array includes requested archetype", filters: { archetype: "Miragebound" },
    prepare: card => { card.archetype = "Other"; card.archetypes = ["Miragebound"]; }, matches: true },
  { name: "combined scalar predicates", filters: { cardKind: "monster", name: "Canonical Match",
    type: "Beast", attribute: "Earth", archetype: "Miragebound", requireFaceup: true,
    level: 3, minLevel: 2, maxLevel: 4, minAtk: 1000, maxAtk: 2000, minDef: 500, maxDef: 1500,
    monsterType: "fusion", subtype: "normal", isToken: true, isTuner: true, textIncludes: "Canonical text",
    excludeCardName: "Excluded", excludeCardNames: ["Also excluded"], excludeMonsterTypes: ["ascension"] },
    prepare: card => { card.name = "Canonical Match"; card.description = "Canonical text"; card.type = "Beast";
      card.types = ["Beast"]; card.attribute = "Earth"; card.archetypes = ["Miragebound"]; card.level = 3;
      card.monsterType = "fusion"; card.subtype = "normal"; card.isToken = true; card.isTuner = true;
      card.atk = 1400; card.def = 1000; }, matches: true },
];

for (const filterField of ["eventCardFilters", "positionChangeSourceFilters"] as const) {
  for (const filterCase of canonicalFilterCases) {
    test(`immediate canonical ${filterField}: ${filterCase.name}`, async t => {
      for (const seat of ["player", "bot"] as const) {
        const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false }); t.after(() => game.dispose());
        const opposingSeat = seat === "player" ? "bot" : "player";
        game.turn = seat; game.phase = "main1"; game.chainSystem.isResolving = true;
        const observer = new Card(cardDefinition(363), seat), source = new Card(cardDefinition(353), seat);
        const changed = new Card(cardDefinition(351), opposingSeat);
        filterCase.prepare(filterField === "eventCardFilters" ? changed : source);
        const startingAtk = changed.atk;
        const effect: EffectDefinition = { id: "canonical_filter_immediate", timing: "passive",
          passive: { type: "event_actions" }, event: "position_change", requireZone: "field", changedCardOwner: "opponent",
          [filterField]: filterCase.filters,
          actions: [{ type: "buff_stats_temp", targetRef: "changedCard", atkBoost: -300, duration: "end_of_turn" }] };
        assert.equal(getImmediateEventEffectValidationError(effect), null);
        observer.effects = [effect];
        placeFieldCards(game[seat].field, observer, source); placeFieldCards(game[opposingSeat].field, changed);
        const simObserver = clone(observer), simSource = clone(source), simChanged = clone(changed);
        const state = simulationState({ turn: seat, phase: "main1",
          [seat]: { field: [simObserver, simSource] }, [opposingSeat]: { field: [simChanged] } });
        changed.position = "defense"; simChanged.position = "defense";
        await game.emit("position_change", { card: changed, player: game[opposingSeat],
          fromPosition: "attack", toPosition: "defense", sourceCard: source });
        attachSimulatedEventEmitter(state, { enableSimulatedEvents: true }).emitSimulatedEvent?.("position_change", {
          card: simChanged, player: state[opposingSeat], fromPosition: "attack", toPosition: "defense", sourceCard: simSource,
        });
        assert.equal(changed.atk, startingAtk - (filterCase.matches ? 300 : 0), `runtime expectation (${seat})`);
        assert.equal(simChanged.atk, changed.atk, `simulation parity (${seat})`);
      }
    });
  }
}

for (const phase of ["main1", "main2", "battle"] as const) for (const seat of ["player", "bot"] as const) {
  test(`immediate phase restrictions match runtime and simulation (${phase}, ${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false }); t.after(() => game.dispose());
    const owner = game[seat], opposingSeat = seat === "player" ? "bot" : "player", opponent = game[opposingSeat];
    game.turn = seat; game.phase = phase; game.turnCounter = 3; game.chainSystem.isResolving = true;
    const observer = new Card(cardDefinition(363), seat), source = new Card(cardDefinition(353), seat);
    const changed = new Card(cardDefinition(351), opposingSeat);
    const effect: EffectDefinition = { id: "generic_phase_limited_immediate", timing: "passive",
      passive: { type: "event_actions" }, event: "position_change", requireZone: "field", requirePhase: ["main2"],
      changedCardOwner: "opponent", actions: [{ type: "buff_stats_temp", targetRef: "changedCard", atkBoost: -300, duration: "end_of_turn" }] };
    assert.equal(getImmediateEventEffectValidationError(effect), null);
    observer.effects = [effect];
    placeFieldCards(owner.field, observer, source); placeFieldCards(opponent.field, changed);
    const simObserver = clone(observer), simSource = clone(source), simChanged = clone(changed);
    const state = simulationState({ turn: seat, phase, turnCounter: 3,
      [seat]: { field: [simObserver, simSource] }, [opposingSeat]: { field: [simChanged] } });
    changed.position = "defense"; simChanged.position = "defense";
    await game.emit("position_change", { card: changed, player: opponent,
      fromPosition: "attack", toPosition: "defense", sourceCard: source });
    attachSimulatedEventEmitter(state, { enableSimulatedEvents: true }).emitSimulatedEvent?.("position_change", {
      card: simChanged, player: state[opposingSeat], fromPosition: "attack", toPosition: "defense", sourceCard: simSource,
    });
    assert.equal(changed.atk, simChanged.atk);
    assert.equal(changed.atk, phase === "main2" ? 1100 : 1400);
  });
}

test("manual simulated position change emits one occurrence without an effect source", () => {
  const changed = make(351, "bot"), unrelated = make(353, "bot");
  const state = simulationState({ _isPerspectiveState: true, turn: "bot", phase: "main1", turnCounter: 3, bot: { field: [changed] } });
  const occurrences: object[] = [];
  applyGenericSimulatedMainPhaseAction(state, { type: "position_change", fieldIndex: 0, cardId: 351, toPosition: "defense" }, {
    enableSimulatedEvents: true, sourceCard: unrelated,
    onSimulatedEvent: (event, payload) => { if (event === "position_change") occurrences.push(payload); },
  });
  assert.equal(occurrences.length, 1);
  const occurrence = occurrences[0];
  assert.ok(occurrence);
  assert.equal(Reflect.get(occurrence, "sourceCard"), null);
  assert.equal(Reflect.get(occurrence, "effectId"), null);
  assert.equal(Reflect.get(occurrence, "positionChangedByEffect"), false);
});

test("manual position occurrence never inherits the dispatch caller's effect source", () => {
  const changed = make(351, "bot"), observer = make(353, "player"), unrelated = make(353, "bot");
  observer.effects = [{ id: "effect_only_position_observer", timing: "on_event", event: "position_change",
    triggerRequirement: "mandatory", triggerTiming: "if", positionChangedByEffect: true,
    actions: [{ type: "draw", amount: 1, player: "self" }] }];
  const draw = make(351, "player");
  const state = simulationState({ turn: "bot", bot: { field: [changed] }, player: { field: [observer], deck: [draw] } });
  const events = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true, sourceCard: unrelated });
  events.emitSimulatedEvent?.("position_change", { card: changed, player: state.bot,
    fromPosition: "attack", toPosition: "defense", sourceCard: null, effectId: null, positionChangedByEffect: false });
  assert.equal(state.player.hand.length, 0);
});

test("immediate canonical source filters honor explicit manual provenance", async t => {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false }); t.after(() => game.dispose());
  game.phase = "main1"; game.chainSystem.isResolving = true;
  const observer = new Card(cardDefinition(363), "player"), source = new Card(cardDefinition(353), "player");
  const changed = new Card(cardDefinition(351), "bot");
  placeFieldCards(game.player.field, observer, source); placeFieldCards(game.bot.field, changed);
  const simObserver = clone(observer), simSource = clone(source), simChanged = clone(changed);
  const state = simulationState({ phase: "main1", player: { field: [simObserver, simSource] }, bot: { field: [simChanged] } });
  // Even a contradictory supplied source must not turn a manual occurrence into an effect change.
  await game.emit("position_change", { card: changed, player: game.bot, fromPosition: "attack", toPosition: "defense",
    sourceCard: source, positionChangedByEffect: false });
  attachSimulatedEventEmitter(state, { enableSimulatedEvents: true, sourceCard: simSource }).emitSimulatedEvent?.("position_change", {
    card: simChanged, player: state.bot, fromPosition: "attack", toPosition: "defense", sourceCard: simSource, positionChangedByEffect: false,
  });
  assert.equal(changed.atk, 1400); assert.equal(simChanged.atk, changed.atk);
});

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const) {
  test(`immediate position observers apply per copy before the occurrence is queued (${seat}, ${controller})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
    t.after(() => game.dispose());
    const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
    owner.controllerType = controller; opponent.controllerType = "ai";
    game.turn = seat; game.phase = "main1"; game.turnCounter = 3;
    const first = new Card(cardDefinition(363), seat), second = new Card(cardDefinition(363), seat);
    const source = new Card(cardDefinition(353), seat), changed = new Card(cardDefinition(351), opponent.id);
    placeFieldCards(owner.field, first, second, source); placeFieldCards(opponent.field, changed);
    Reflect.set(changed, "cannotBeTargeted", true);
    game.chainSystem.isResolving = true;
    let targeted = 0, activated = 0, occurrences = 0;
    game.on("effect_targeted", event => { if (event.target === changed) targeted++; });
    game.on("effect_activated", event => { if (event.card === first || event.card === second) activated++; });
    const capture = game.chainSystem.createTriggerOccurrence.bind(game.chainSystem);
    game.chainSystem.createTriggerOccurrence = (...args) => {
      if (args[0] === "position_change") { occurrences++; assert.equal(changed.atk, 800); assert.equal(changed.def, 400); }
      const occurrence = capture(...args);
      return occurrence && "sequence" in occurrence ? occurrence : null;
    };
    changed.position = "defense";
    const result = await game.emit("position_change", { card: changed, player: opponent,
      fromPosition: "attack", toPosition: "defense", sourceCard: source });
    assert.equal(required(result).ok, true);
    assert.equal(changed.position, "defense");
    assert.equal(changed.atk, 800); assert.equal(changed.def, 400);
    assert.equal(occurrences, 1); assert.equal(game.chainSystem.pendingTriggerOccurrences.filter(event => event.eventName === "position_change").length, 1);
    assert.equal(targeted, 0); assert.equal(activated, 0); assert.equal(game.targetSelection, null);
    assert.equal(game.materialDuelStats[seat].effectActivationsByMaterialId.get(363) ?? 0, 0);
    assert.equal(game.materialDuelStats[seat].activatedEffectIdsByMaterialId.has(363), false);
    const collected = await game.effectEngine.collectEventTriggers("position_change", {
      card: changed, player: opponent, fromPosition: "attack", toPosition: "defense", sourceCard: source,
    });
    assert.equal(collected.entries.some(entry => entry.card === first || entry.card === second), false);
    await game.moveCard(first, owner, "graveyard", { fromZone: "field" });
    await game.moveCard(second, owner, "graveyard", { fromZone: "field" });
    assert.equal(changed.atk, 800, "the applied modifier survives its observer's departure");
    game.cleanupTempBoosts(opponent);
    assert.equal(changed.atk, 1400); assert.equal(changed.def, 1000);
    assert.equal(game.eventResolutionDepth, 0);
  });
}

for (const window of ["activation", "chain_window", "summon_procedure", "damage_procedure"] as const) {
  test(`immediate observer executes before ${window} defers ordinary triggers`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false }); t.after(() => game.dispose());
    const leviathan = new Card(cardDefinition(363), "player"), source = new Card(cardDefinition(353), "player");
    const changed = new Card(cardDefinition(351), "bot");
    placeFieldCards(game.player.field, leviathan, source); placeFieldCards(game.bot.field, changed);
    if (window === "activation") game.chainSystem.isPreparingActivation = true;
    if (window === "chain_window") game.chainSystem.isChainWindowOpen = () => true;
    if (window === "summon_procedure") game.summonProcedureDepth = 1;
    if (window === "damage_procedure") game.damageStepProcedureDepth = 1;
    changed.position = "defense";
    await game.emit("position_change", { card: changed, player: game.bot, fromPosition: "attack", toPosition: "defense", sourceCard: source });
    assert.equal(changed.atk, 1100);
    assert.equal(game.chainSystem.pendingTriggerOccurrences.filter(event => event.eventName === "position_change").length, 1);
    assert.equal(game.eventResolutionDepth, 0);
  });
}

test("immediate passive source gates and effect immunity are checked at the occurrence", async t => {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false }); t.after(() => game.dispose());
  const leviathan = new Card(cardDefinition(363), "player"), source = new Card(cardDefinition(353), "player");
  const changed = new Card(cardDefinition(351), "bot");
  placeFieldCards(game.player.field, leviathan, source); placeFieldCards(game.bot.field, changed);
  game.chainSystem.isResolving = true;
  const emit = async () => {
    const fromPosition = changed.position; changed.position = fromPosition === "attack" ? "defense" : "attack";
    await game.emit("position_change", { card: changed, player: game.bot, fromPosition, toPosition: changed.position, sourceCard: source });
  };
  leviathan.effectsNegated = true; await emit(); assert.equal(changed.atk, 1400);
  leviathan.effectsNegated = false; leviathan.isFacedown = true; await emit(); assert.equal(changed.atk, 1400);
  leviathan.isFacedown = false; Reflect.set(changed, "unaffectedByOpponentCardEffects", true);
  await emit(); assert.equal(changed.atk, 1400);
  Reflect.set(changed, "unaffectedByOpponentCardEffects", false); await emit(); assert.equal(changed.atk, 1100);
  await emit(); assert.equal(changed.atk, 800, "the immediate rule has no per-turn lock");
});

test("simulated immediate observers all resolve before ordinary trigger decisions and match duration", () => {
  const leviathan = make(363, "bot"), other = make(363, "bot"), source = make(353, "bot"), changed = make(351, "player");
  const observer = make(353, "player");
  observer.effects = [{ id: "ordinary_observer", timing: "on_event", event: "position_change", triggerRequirement: "optional",
    triggerTiming: "if", actions: [{ type: "draw", amount: 1, player: "self" }] }];
  const state = simulationState({ turn: "bot", turnCounter: 3, bot: { field: [leviathan, other, source] }, player: { field: [changed, observer] } });
  Reflect.set(changed, "cannotBeTargeted", true);
  let events = 0, activations = 0, decisions = 0;
  const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true, sourceCard: source,
    onSimulatedEvent: event => { if (event === "position_change") events++; },
    onEffectActivated: () => { activations++; },
    shouldActivateEffect: () => { decisions++; assert.equal(changed.atk, 800); return false; },
  });
  applySimulatedActions({ state, selfId: "bot", actions: [{ type: "switch_position", targetRef: "changed" }], selections: { changed: [changed] }, options });
  assert.equal(changed.atk, 800); assert.equal(events, 1); assert.equal(activations, 0); assert.equal(decisions, 1);
  state.bot.field = [source];
  assert.equal(changed.atk, 800); cleanupSimulatedEndTurn(state); assert.equal(changed.atk, 1400);
  assert.deepEqual(state._simUnsupportedActions || [], []);
});

test("event_actions rejects choices, costs, selections, activation and unsupported actions", () => {
  const effect = required(cardDefinition(363).effects?.find(entry => entry.id === "miragebound_desert_leviathan_position_debuff"));
  assert.equal(getImmediateEventEffectValidationError(effect), null);
  const invalid: EffectDefinition[] = [
    { ...effect, actions: [{ type: "draw", amount: 1, player: "self" }] },
    { ...effect, activationCosts: [{ type: "pay_lp", amount: 100 }] },
    { ...effect, oncePerTurn: true }, { ...effect, promptUser: true },
    { ...effect, targets: [{ id: "choice", zone: "field", cardKind: "monster" }] },
    { ...effect, actions: [{ type: "buff_stats_temp", targetRef: "unknown", atkBoost: -300 }] },
    { ...effect, requireOpponentSummon: true },
    { ...effect, requireSelfAsSummoned: true },
    { ...effect, requireOwnMonsterArchetype: "Miragebound" },
    { ...effect, triggerPlayer: "opponent" },
    { ...effect, contextLabel: "another_occurrence" },
    { ...effect, activationZones: ["graveyard"] },
    { ...effect, speed: 2 },
    { ...effect, requirePhase: [] },
    { ...effect, requireZone: "graveyard" },
    { ...effect, changedCardOwner: "both" },
    { ...effect, condition: { requires: "self_in_hand" } },
    { ...effect, timing: "passive", passive: { type: "event_actions", condition: { type: "playerLpMin", value: 8000 } } },
    { ...effect, eventCardFilters: { fromZone: "graveyard" } },
    { ...effect, eventCardFilters: { eventCardIsEquippedToSource: true } },
    { ...effect, eventCardFilters: { excludeSelf: true } },
    { ...effect, positionChangeSourceFilters: { owner: "opponent" } },
    unsafeFixture<EffectDefinition>({ ...effect, actions: [{ type: "buff_stats_temp", targetRef: "changedCard", atkBoost: -300, haltOnFailure: true }] },
      "Invalid raw immediate action: haltOnFailure is outside the direct stat capability"),
  ];
  for (const entry of invalid) assert.ok(getImmediateEventEffectValidationError(entry));
  assert.ok(getImmediateEventEffectValidationError(unsafeFixture<EffectDefinition>({ ...effect, requirePhase: ["battle"] },
    "Invalid raw database entry: event_actions phase gates are restricted to the canonical MainPhase values")));
});

test("accepted source conditions and rejected unsupported gates remain identical in immediate runtime and simulation", async t => {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false }); t.after(() => game.dispose());
  game.phase = "main1"; game.chainSystem.isResolving = true;
  const observer = new Card(cardDefinition(363), "player"), source = new Card(cardDefinition(353), "player");
  const changed = new Card(cardDefinition(351), "bot");
  placeFieldCards(game.player.field, observer, source); placeFieldCards(game.bot.field, changed);
  const base = required(cardDefinition(363).effects?.find(effect => effect.id === "miragebound_desert_leviathan_position_debuff"));
  const effect: EffectDefinition = { ...base, conditions: [{ type: "source_counters_at_least", counterType: "charge", min: 1 }] };
  assert.equal(getImmediateEventEffectValidationError(effect), null);
  observer.effects = [effect];
  const simObserver = clone(observer), simSource = clone(source), simChanged = clone(changed);
  const state = simulationState({ phase: "main1", player: { field: [simObserver, simSource] }, bot: { field: [simChanged] } });
  const emit = async () => {
    await game.emit("position_change", { card: changed, player: game.bot, fromPosition: "attack", toPosition: "defense", sourceCard: source });
    attachSimulatedEventEmitter(state, { enableSimulatedEvents: true }).emitSimulatedEvent?.("position_change", {
      card: simChanged, player: state.bot, fromPosition: "attack", toPosition: "defense", sourceCard: simSource,
    });
    assert.equal(changed.atk, simChanged.atk);
  };
  await emit(); assert.equal(changed.atk, 1400);
  observer.counters.set("charge", 1); simObserver.counters = new Map([["charge", 1]]);
  await emit(); assert.equal(changed.atk, 1100);
  observer.effects = [{ ...base, contextLabel: "unimplemented_gate" }]; simObserver.effects = observer.effects;
  await emit(); assert.equal(changed.atk, 1100, "neither path executes a rejected source gate");
});

for (const seat of ["player", "bot"] as const) {
  test(`immediate observer ordering uses the changed owner before its opponent (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false }); t.after(() => game.dispose());
    game.phase = "main1"; game.turn = seat; game.chainSystem.isResolving = true;
    const owner = game[seat], opposingSeat = seat === "player" ? "bot" : "player", opponent = game[opposingSeat];
    const changed = new Card(cardDefinition(363), seat), opposingObserver = new Card(cardDefinition(363), opposingSeat);
    const startingAtk = changed.atk;
    changed.effects = [{ id: "immediate_changed_owner", timing: "passive", event: "position_change", passive: { type: "event_actions" },
      changedCardOwner: "self", actions: [{ type: "buff_stats_temp", targetRef: "self", atkBoost: 300 }] }];
    opposingObserver.effects = [{ id: "immediate_opposing_observer", timing: "passive", event: "position_change", passive: { type: "event_actions" },
      changedCardOwner: "opponent", conditions: [{ type: "context_number_compare", key: "eventCard.atk", op: "gte", value: startingAtk + 100 }],
      actions: [{ type: "buff_stats_temp", targetRef: "changedCard", atkBoost: -100 }] }];
    placeFieldCards(owner.field, changed); placeFieldCards(opponent.field, opposingObserver);
    const simChanged = clone(changed), simObserver = clone(opposingObserver);
    const state = simulationState({ phase: "main1", turn: seat,
      [seat]: { field: [simChanged] }, [opposingSeat]: { field: [simObserver] } });
    await game.emit("position_change", { card: changed, player: owner, fromPosition: "attack", toPosition: "defense" });
    attachSimulatedEventEmitter(state, { enableSimulatedEvents: true }).emitSimulatedEvent?.("position_change", {
      card: simChanged, player: state[seat], fromPosition: "attack", toPosition: "defense",
    });
    assert.equal(changed.atk, startingAtk + 200);
    assert.equal(simChanged.atk, changed.atk);
  });
}

test("immediate observers use spell/trap before field-spell order within one owner", async t => {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false }); t.after(() => game.dispose());
  game.phase = "main1"; game.chainSystem.isResolving = true;
  const changed = new Card(cardDefinition(351), "player"), spell = new Card(cardDefinition(360), "player");
  const fieldSpell = new Card(cardDefinition(354), "player");
  const { positionChangeSourceFilters: _sourceFilters, ...base } = required(cardDefinition(363).effects?.find(effect => effect.id === "miragebound_desert_leviathan_position_debuff"));
  spell.effects = [{ ...base, id: "immediate_spell_observer", requireZone: "spellTrap", changedCardOwner: "self",
    actions: [{ type: "buff_stats_temp", targetRef: "changedCard", atkBoost: 300 }] }];
  fieldSpell.effects = [{ ...base, id: "immediate_field_spell_observer", requireZone: "fieldSpell", changedCardOwner: "self",
    conditions: [{ type: "context_number_compare", key: "eventCard.atk", op: "gte", value: 1500 }],
    actions: [{ type: "buff_stats_temp", targetRef: "changedCard", atkBoost: -100 }] }];
  placeFieldCards(game.player.field, changed); placeFieldCards(game.player.spellTrap, spell); game.player.fieldSpell = fieldSpell;
  const simChanged = clone(changed);
  const state = simulationState({ phase: "main1", player: { field: [simChanged], spellTrap: [clone(spell)], fieldSpell: clone(fieldSpell) } });
  await game.emit("position_change", { card: changed, player: game.player, fromPosition: "attack", toPosition: "defense" });
  attachSimulatedEventEmitter(state, { enableSimulatedEvents: true }).emitSimulatedEvent?.("position_change", {
    card: simChanged, player: state.player, fromPosition: "attack", toPosition: "defense",
  });
  assert.equal(changed.atk, 1600); assert.equal(simChanged.atk, changed.atk);
});

test("event resolver restores its depth when the immediate stage throws", async t => {
  const game = createRuntimeGame({ disableChains: true }); t.after(() => game.dispose());
  const changed = new Card(cardDefinition(351), "bot"); placeFieldCards(game.bot.field, changed);
  game.effectEngine.applyImmediateEventEffects = async () => { throw new Error("expected immediate failure"); };
  const previous = console.error; const errors: unknown[] = [];
  console.error = (...args) => { errors.push(args); }; t.after(() => { console.error = previous; });
  await game.emit("position_change", { card: changed, player: game.bot, fromPosition: "attack", toPosition: "defense" });
  assert.equal(game.eventResolutionDepth, 0); assert.equal(errors.length, 1);
});

test("sequential position changes apply the immediate debuff before the next change and queued Oasis", async t => {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false }); t.after(() => game.dispose());
  const leviathan = new Card(cardDefinition(363), "player"), source = new Card(cardDefinition(353), "player");
  const first = new Card(cardDefinition(351), "bot"), second = new Card(cardDefinition(351), "bot");
  game.player.fieldSpell = new Card(cardDefinition(354), "player");
  game.player.controllerType = game.bot.controllerType = "ai";
  placeFieldCards(game.player.field, leviathan, source); placeFieldCards(game.bot.field, first, second);
  game.chainSystem.isResolving = true;
  const trace: number[][] = [];
  game.on("position_change", event => {
    if (event.card === first || event.card === second) trace.push([first.atk, second.atk]);
  });
  await game.effectEngine.applyActions([{ type: "switch_position", targetRef: "changed" }],
    { source, player: game.player, opponent: game.bot }, { changed: [first, second] });
  assert.deepEqual(trace, [[1400, 1400], [1100, 1400]], "the first occurrence finishes before the second change");
  assert.equal(first.atk, 1100); assert.equal(second.atk, 1100);
  game.chainSystem.isResolving = false;
  game.ui.showChainResponseModal = async () => null;
  await game.flushPendingTriggerOccurrences({ reason: "test_position_changes" });
  assert.equal(first.atk, 700); assert.equal(second.atk, 700);
  game.cleanupTempBoosts(game.bot);
  assert.equal(first.atk, 1000, "the immediate modifier ends this turn; Oasis lasts through the next turn");
  game.turnCounter++; game.cleanupExpiredBuffs(); assert.equal(first.atk, 1000);
  game.turnCounter++; game.cleanupExpiredBuffs(); assert.equal(first.atk, 1400);
});

test("Oasis reference observes a face-up change without targeting and excludes a flip-up occurrence", async t => {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false }); t.after(() => game.dispose());
  game.player.controllerType = game.bot.controllerType = "ai";
  game.ui.showChainResponseModal = async () => null;
  const changed = new Card(cardDefinition(351), "bot"); placeFieldCards(game.bot.field, changed);
  const oasis = new Card(cardDefinition(354), "player"); game.player.fieldSpell = oasis;
  Reflect.set(changed, "cannotBeTargeted", true);
  let targets = 0; game.on("effect_targeted", () => { targets++; });
  await game.emit("position_change", { card: changed, player: game.bot, fromPosition: "defense", toPosition: "attack", wasFlipped: true });
  assert.equal(changed.atk, 1400);
  await game.emit("position_change", { card: changed, player: game.bot, fromPosition: "attack", toPosition: "defense", wasFlipped: false });
  assert.equal(changed.atk, 1000); assert.equal(targets, 0);
  assert.equal(game.targetSelection, null);
});
