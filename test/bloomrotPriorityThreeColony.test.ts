import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { AiCardInput, AiStateShape } from "../src/core/contracts/aiState.js";
import type { PassiveRuleDefinition } from "../src/core/contracts/effects.js";
import { createPlanningCopy } from "../src/core/ai/common/planningCopy.js";
import { setCounterValue } from "../src/core/ai/common/counters.js";
import { attachSimulatedEquip, moveCardToZone, refreshSimulatedFieldAuras } from "../src/core/ai/common/zones.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { greedySearchWithEvalV2 } from "../src/core/ai/BeamSearch.js";
import { turnLineSearch } from "../src/core/ai/TurnLineSearch.js";
import { cloneBotGameState } from "../src/core/bot/simulationBridge.js";
import { getModeledPassiveContributions } from "../src/core/effects/passives/passiveBuffs.js";
import { fixtureGameTreeSearch } from "./helpers/gameTree.js";
import { cardDefinition, required, unsafeFixture } from "./helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "./helpers/game.js";
import { simulationState } from "./helpers/simulation.js";

type Seat = "player" | "bot";

function runtime(t: TestContext, seat: Seat) {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false });
  t.after(() => game.dispose("bloomrot_priority_three_colony"));
  game.disablePresentationDelays = true;
  game.turn = seat; game.phase = "main1"; game.turnCounter = 2;
  game.player.controllerType = game.bot.controllerType = "human";
  game.ui.showConfirmPrompt = async () => false;
  return game;
}

function setup(t: TestContext, seat: Seat) {
  const game = runtime(t, seat), owner = game[seat];
  const otherSeat: Seat = seat === "player" ? "bot" : "player";
  const opponent = game[otherSeat];
  const source = new Card(cardDefinition(410), owner.id);
  const ownTarget = new Card(cardDefinition(401), owner.id);
  const target = new Card(cardDefinition(401), opponent.id);
  owner.fieldSpell = source; source.location = "fieldSpell";
  placeFieldCards(owner.field, ownTarget); placeFieldCards(opponent.field, target);
  return { game, owner, opponent, source, ownTarget, target, seat, otherSeat };
}

function clone(game: Pick<RuntimeGame, "player" | "bot" | "turnCounter">) {
  const copy = createPlanningCopy();
  const player = (owner: RuntimeGame["player"]) => ({
    field: owner.field.map(copy.cloneCardForSim), spellTrap: owner.spellTrap.map(copy.cloneCardForSim),
    fieldSpell: owner.fieldSpell ? copy.cloneCardForSim(owner.fieldSpell) : null,
    hand: owner.hand.map(copy.cloneCardForSim), graveyard: owner.graveyard.map(copy.cloneCardForSim),
    banished: owner.banished.map(copy.cloneCardForSim),
  });
  return simulationState({ turnCounter: game.turnCounter, player: player(game.player), bot: player(game.bot) });
}

function stats(card: AiCardInput) {
  return { atk: card.atk, def: card.def, buffs: card.dynamicBuffs || {} };
}

function reconcile(game: RuntimeGame, state: AiStateShape) {
  game.effectEngine.updatePassiveBuffs(); refreshSimulatedFieldAuras(state);
  for (const seat of ["player", "bot"] as const) {
    assert.equal(state[seat].field.length, game[seat].field.length);
    game[seat].field.forEach((card, index) => assert.deepEqual(stats(required(state[seat].field[index])), stats(card),
      `runtime oracle ${seat} field[${index}]`));
  }
}

for (const seat of ["player", "bot"] as const) {
  test(`B12 real Living Colony counts each opposing recipient, refreshes and excludes facedown targets (${seat})`, t => {
    const { game, source, target, ownTarget, otherSeat } = setup(t, seat);
    const state = clone(game), simulatedTarget = required(state[otherSeat].field[0]);
    ownTarget.addCounter("spore", 4);
    for (const count of [0, 3, 4, 0, 20, 2]) {
      target.counters.set("spore", count); setCounterValue(simulatedTarget, "spore", count);
      for (let refresh = 0; refresh < 3; refresh++) reconcile(game, state);
      assert.equal(target.atk, Math.max(0, target.baseAtk - count * 100));
      assert.equal(target.def, Math.max(0, target.baseDef - count * 100));
      assert.equal(ownTarget.atk, ownTarget.baseAtk);
    }
    target.isFacedown = simulatedTarget.isFacedown = true; reconcile(game, state);
    assert.equal(target.atk, target.baseAtk);
    target.isFacedown = simulatedTarget.isFacedown = false; reconcile(game, state);
    assert.equal(target.atk, target.baseAtk - 200);
    const key = `bloomrot_living_colony_spore_debuff_${source.fieldPresenceId || source.instanceId}_spore`;
    assert.equal(target.dynamicBuffs?.[key]?.value, -200);
    assert.deepEqual(getModeledPassiveContributions(simulatedTarget), [[key, "field_counter_stat_aura"]]);
  });

  test(`B12 Living Colony source negation, face, controller, departure and restoration match runtime (${seat})`, async t => {
    const { game, owner, opponent, source, target, ownTarget, otherSeat } = setup(t, seat);
    target.addCounter("spore", 3); ownTarget.addCounter("spore", 1);
    const state = clone(game), simSource = required(state[seat].fieldSpell);
    reconcile(game, state);
    for (const flag of ["effectsNegated", "isFacedown"] as const) {
      source[flag] = simSource[flag] = true; reconcile(game, state);
      assert.equal(target.atk, target.baseAtk);
      source[flag] = simSource[flag] = false; reconcile(game, state);
      assert.equal(target.atk, target.baseAtk - 300);
    }
    await game.moveCard(source, opponent, "fieldSpell", { fromZone: "fieldSpell" });
    assert.equal(moveCardToZone(state[otherSeat], simSource, "fieldSpell", state[seat], { state }), true);
    reconcile(game, state);
    assert.equal(target.atk, target.baseAtk);
    assert.equal(ownTarget.atk, ownTarget.baseAtk - 100);
    await game.moveCard(source, opponent, "hand", { fromZone: "fieldSpell" });
    assert.equal(moveCardToZone(state[otherSeat], simSource, "hand", state[otherSeat], { state }), true);
    reconcile(game, state);
    assert.equal(ownTarget.atk, ownTarget.baseAtk);
    await game.moveCard(source, owner, "fieldSpell", { fromZone: "hand" });
    assert.equal(moveCardToZone(state[seat], simSource, "fieldSpell", state[otherSeat], { state }), true);
    reconcile(game, state);
    assert.equal(target.atk, target.baseAtk - 300);
    await completeTestSelections(game, Promise.resolve(game.moveCard(target, opponent, "hand", { fromZone: "field" })));
    assert.equal(moveCardToZone(state[otherSeat], required(state[otherSeat].field[0]), "hand", state[otherSeat], { state }), true);
    assert.deepEqual([target.atk, target.def], [target.baseAtk, target.baseDef]);
    assert.deepEqual(getModeledPassiveContributions(required(state[otherSeat].hand.find(card => card.id === 401))), []);
  });

  test(`B12 counter actions update the aura and runtime-derived clones reconcile independent keys (${seat})`, t => {
    const { game, target, source, otherSeat } = setup(t, seat);
    target.addCounter("spore", 3); game.effectEngine.updatePassiveBuffs();
    const state = clone(game), simulatedTarget = required(state[otherSeat].field[0]);
    refreshSimulatedFieldAuras(state);
    assert.deepEqual(stats(simulatedTarget), stats(target));
    applySimulatedActions({ state, options: { sourceCard: required(state[seat].fieldSpell) }, actions: [
      { type: "add_counter", targetRef: "target", counterType: "spore", amount: 1 },
    ], selections: { target: [simulatedTarget] } });
    assert.equal(simulatedTarget.atk, target.baseAtk - 400);
    assert.equal(target.getCounter("spore"), 3);
    assert.equal(target.atk, target.baseAtk - 300);
    const branch = clone({ player: game.player, bot: game.bot, turnCounter: game.turnCounter });
    required(branch[seat].fieldSpell).effectsNegated = true;
    refreshSimulatedFieldAuras(branch);
    assert.equal(required(branch[otherSeat].field[0]).atk, target.baseAtk);
    assert.equal(source.effectsNegated, false);
    assert.equal(target.atk, target.baseAtk - 300);
  });

  test(`B12 source zones and filters, per-target filters and independent copies match runtime (${seat})`, t => {
    const game = runtime(t, seat), opponentSeat = seat === "player" ? "bot" : "player";
    const effect = { id: "generic_counter_aura", timing: "passive" as const, requireZone: "field" as const,
      passive: { type: "field_counter_stat_aura" as const, amount: -100, targetOwners: ["self", "opponent"] as const,
        sourceFilters: { archetype: "Bloomrot" }, targetFilters: { archetype: "Bloomrot" }, includeSelf: false } };
    const first = new Card({ ...cardDefinition(401), effects: [effect] }, seat);
    const second = new Card({ ...cardDefinition(401), effects: [effect] }, seat);
    const wrongZone = new Card({ ...cardDefinition(409), subtype: "continuous", effects: [effect] }, seat);
    const wrongSource = new Card({ ...cardDefinition(401), archetype: "other", effects: [effect] }, seat);
    const target = new Card({ ...cardDefinition(401), effects: [] }, opponentSeat);
    const filtered = new Card({ ...cardDefinition(401), archetype: "other", effects: [] }, opponentSeat);
    for (const card of [first, second, target, filtered]) card.addCounter("default", 3);
    placeFieldCards(game[seat].field, first, second, wrongSource);
    placeFieldCards(game[seat].spellTrap, wrongZone);
    placeFieldCards(game[opponentSeat].field, target, filtered);
    const state = clone(game), simulatedFirst = required(state[seat].field[0]);
    reconcile(game, state);
    assert.equal(target.atk, target.baseAtk - 600);
    assert.equal(first.atk, first.baseAtk - 300, "includeSelf=false excludes only that source's contribution");
    assert.equal(filtered.atk, filtered.baseAtk);
    assert.equal(getModeledPassiveContributions(required(state[opponentSeat].field[0])).length, 2);
    first.effectsNegated = simulatedFirst.effectsNegated = true; reconcile(game, state);
    assert.equal(target.atk, target.baseAtk - 300);
    first.effectsNegated = simulatedFirst.effectsNegated = false; reconcile(game, state);
    assert.equal(target.atk, target.baseAtk - 600);
  });

  test(`B12 add_status negation/restoration is supported and overlapping reduction preserves zero-floor cleanup (${seat})`, async t => {
    const { game, owner, opponent, source, target, ownTarget, otherSeat } = setup(t, seat);
    target.addCounter("spore", 3);
    const state = clone(game), simSource = required(state[seat].fieldSpell), simTarget = required(state[otherSeat].field[0]);
    reconcile(game, state);
    for (const remove of [false, true]) {
      const action = { type: "add_status" as const, targetRef: "source", status: "effectsNegated", duration: "until_end_turn" as const, remove };
      await game.effectEngine.applyActions([action], { player: owner, source: ownTarget }, { source: [source] });
      applySimulatedActions({ state, selfId: seat, actions: [action], selections: { source: [simSource] } });
      reconcile(game, state);
      assert.deepEqual(state._simUnsupportedActions || [], []);
      assert.equal(target.atk, remove ? target.baseAtk - 300 : target.baseAtk);
    }
    const reduction = { type: "buff_stats_temp" as const, targetRef: "target", atkBoost: -2200, defBoost: -3500, permanent: true };
    await game.effectEngine.applyActions([reduction], { player: owner, source: ownTarget }, { target: [target] });
    applySimulatedActions({ state, selfId: seat, actions: [reduction], selections: { target: [simTarget] } });
    for (let refresh = 0; refresh < 3; refresh++) reconcile(game, state);
    assert.deepEqual([target.atk, target.def], [0, 0]);
    await game.moveCard(source, owner, "hand", { fromZone: "fieldSpell" });
    assert.equal(moveCardToZone(state[seat], simSource, "hand", state[seat], { state }), true);
    reconcile(game, state);
    // The runtime tracks the reduction actually applied at zero; removing the
    // negative aura restores its applied -300 contribution on both engines.
    assert.deepEqual([target.atk, target.def], [300, 300]);
    await completeTestSelections(game, Promise.resolve(game.moveCard(target, opponent, "hand", { fromZone: "field" })));
    assert.equal(moveCardToZone(state[otherSeat], simTarget, "hand", state[otherSeat], { state }), true);
    assert.deepEqual(stats(simTarget), stats(target));
    assert.deepEqual([target.atk, target.def], [target.baseAtk, target.baseDef]);
  });

  test(`B12 producer expansion keeps two Armor sources fully negated through add_status (${seat})`, () => {
    const copy = createPlanningCopy(), opponentSeat = seat === "player" ? "bot" : "player";
    const host = copy.cloneCardForSim(new Card(cardDefinition(401), seat));
    const carrier = copy.cloneCardForSim(new Card(cardDefinition(401), opponentSeat));
    const sources = [copy.cloneCardForSim(new Card(cardDefinition(413), seat)), copy.cloneCardForSim(new Card(cardDefinition(413), seat))];
    const state = simulationState({ [seat]: { field: [host], spellTrap: sources }, [opponentSeat]: { field: [carrier] } });
    for (const source of sources) assert.equal(attachSimulatedEquip(source, host), true);
    setCounterValue(carrier, "spore", 3); refreshSimulatedFieldAuras(state);
    assert.deepEqual([host.atk, host.def], [1800, 2500]);
    applySimulatedActions({ state, selfId: seat, actions: [{ type: "add_status", targetRef: "equips", status: "effectsNegated" }], selections: { equips: sources } });
    refreshSimulatedFieldAuras(state); assert.deepEqual([host.atk, host.def], [1200, 1500]);
    assert.deepEqual(state._simUnsupportedActions || [], []);
    applySimulatedActions({ state, selfId: seat, actions: [{ type: "add_status", targetRef: "equips", status: "effectsNegated", remove: true }], selections: { equips: sources } });
    refreshSimulatedFieldAuras(state); assert.deepEqual([host.atk, host.def], [1800, 2500]);
  });

  test(`B12 generated valid aura domain uses runtime as oracle over delta and zero-floor transitions (${seat})`, t => {
    const game = runtime(t, seat), opponentSeat = seat === "player" ? "bot" : "player";
    // Cartesian generation keeps positions, counters and declared effects valid;
    // every case is a trace, not an expected value copied from the producer.
    for (const count of [0, 1, 3, 20]) for (const amount of [-100, 50])
      for (const statSet of [["atk"], ["def"], ["atk", "def"]] as const)
        for (const sources of [1, 2]) for (const targetFaceup of [false, true]) {
          game.player.field = []; game.bot.field = [];
          const passive: PassiveRuleDefinition = { type: "field_counter_stat_aura", counterType: "spore",
            amountPerCounter: amount, stats: statSet, targetOwners: ["self", "opponent"],
            targetCardKinds: ["monster"], targetRequireFaceup: true, includeSelf: false,
            sourceFilters: { archetype: "Bloomrot" }, targetFilters: { archetype: "Bloomrot" } };
          const liveSources = Array.from({ length: sources }, (_, index) => new Card({ ...cardDefinition(401),
            effects: [{ id: index ? "generated_aura_second" : "generated_aura", timing: "passive", requireZone: "field", passive }] }, seat));
          const target = new Card({ ...cardDefinition(401), atk: 250, def: 400, effects: [] }, opponentSeat);
          target.isFacedown = !targetFaceup; target.addCounter("spore", count);
          placeFieldCards(game[seat].field, ...liveSources); placeFieldCards(game[opponentSeat].field, target);
          const state = clone(game), simTarget = required(state[opponentSeat].field[0]);
          const label = JSON.stringify({ count, amount, statSet, sources, targetFaceup });
          for (let refresh = 0; refresh < 2; refresh++) assert.doesNotThrow(() => reconcile(game, state), label);
          target.counters.set("spore", count + 2); setCounterValue(simTarget, "spore", count + 2);
          reconcile(game, state);
          required(liveSources[0]).effectsNegated = required(state[seat].field[0]).effectsNegated = true;
          reconcile(game, state);
          required(liveSources[0]).effectsNegated = required(state[seat].field[0]).effectsNegated = false;
          reconcile(game, state);
          target.counters.set("spore", 0); setCounterValue(simTarget, "spore", 0);
          reconcile(game, state);
          assert.deepEqual([target.atk, target.def], [250, 400], label);
        }
  });
}

test("B12 mixed opposing field and field-spell producers preserve runtime order at the zero floor", t => {
  const game = runtime(t, "player");
  const negative = new Card(cardDefinition(410), "player");
  game.player.fieldSpell = negative; negative.location = "fieldSpell";
  const positive = new Card({ ...cardDefinition(401), effects: [{ id: "positive_counter_aura", timing: "passive", requireZone: "field",
    passive: { type: "field_counter_stat_aura", amountPerCounter: 50, counterType: "spore", includeSelf: false,
      targetOwners: ["self"], stats: ["atk", "def"] } }] }, "bot");
  const target = new Card({ ...cardDefinition(401), atk: 250, def: 400, effects: [] }, "bot");
  target.addCounter("spore", 3); placeFieldCards(game.bot.field, positive, target);
  const state = clone(game);
  reconcile(game, state);
  assert.deepEqual([target.atk, target.def], [100, 250]);
  for (const count of [4, 20, 1, 0, 3]) {
    target.counters.set("spore", count); setCounterValue(required(state.bot.field[1]), "spore", count);
    for (let refresh = 0; refresh < 3; refresh++) reconcile(game, state);
  }
});

const probeAction = { type: "position_change" as const, fieldIndex: 0, toPosition: "attack" as const, priority: 1 };
const capturedState = (value: unknown) => unsafeFixture<AiStateShape>(required(value),
  "The actual search profile exposes its branded simulation clone to this probe");

for (const profile of ["bot", "beamGreedy", "gameTree", "turnLine"] as const) for (const seat of ["player", "bot"] as const) {
  test(`B12 ${profile} clone preserves Colony origin and isolates negation/counter refresh (${seat})`, async t => {
    const { game, owner, opponent, target, source } = setup(t, seat);
    target.addCounter("spore", 3); game.effectEngine.updatePassiveBuffs();
    let captured: unknown;
    const strategy = { bot: owner,
      generateMainPhaseActions(state: unknown) { if (profile === "gameTree") captured ??= state; return [probeAction]; },
      simulateMainPhaseAction(state: unknown) { captured ??= state; capturedState(state).bot.lp++; },
      simulateSpellEffect: () => undefined,
      evaluateBoardV2: (state: unknown) => capturedState(state).bot.lp,
      evaluateBoard: (state: unknown) => capturedState(state).bot.lp };
    if (profile === "bot") captured = cloneBotGameState(unsafeFixture<Parameters<typeof cloneBotGameState>[0]>(
      { ...owner, strategy, resolveOpponent: () => opponent }, "Public actor and probe strategy test the actual Bot clone"),
      unsafeFixture<Parameters<typeof cloneBotGameState>[1]>(game, "Live Game supplies canonical aura state"));
    else if (profile === "beamGreedy") await greedySearchWithEvalV2(game, strategy, { preGeneratedActions: [probeAction] });
    else if (profile === "gameTree") fixtureGameTreeSearch(game, { ...strategy, bot: { debug: false } }, owner, 1);
    else await turnLineSearch(unsafeFixture<Parameters<typeof turnLineSearch>[0]>(game, "Live Game supplies the TurnLine clone"),
      strategy, { maxDepth: 1, beamWidth: 1, nodeBudget: 2 });
    const state = capturedState(captured), simTarget = required(state.player.field[0]);
    const simSource = required(state.bot.fieldSpell);
    assert.notEqual(simSource, source); assert.notEqual(simTarget, target);
    assert.notEqual(simTarget.dynamicBuffs, target.dynamicBuffs);
    assert.deepEqual(stats(simTarget), stats(target));
    simSource.effectsNegated = true; refreshSimulatedFieldAuras(state);
    assert.equal(simTarget.atk, target.baseAtk);
    simSource.effectsNegated = false; setCounterValue(simTarget, "spore", 4); refreshSimulatedFieldAuras(state);
    assert.equal(simTarget.atk, target.baseAtk - 400);
    assert.equal(target.atk, target.baseAtk - 300); assert.equal(target.getCounter("spore"), 3);
  });
}
