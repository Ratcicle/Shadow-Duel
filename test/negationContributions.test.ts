import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { EffectContext } from "../src/core/contracts/actionRuntime.js";
import type { EffectTarget } from "../src/core/contracts/effects.js";
import type { EffectDefinition } from "../src/core/contracts/effects.js";
import { cardDefinition, required, chainSelections, unsafeFixture } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { createPlanningCopy } from "../src/core/ai/common/planningCopy.js";
import { createCanonicalStateSnapshot, hashCanonicalGameState } from "../src/core/game/replay/canonical.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { cleanupSimulatedEndTurn } from "../src/core/ai/common/simulatedActions/lifecycle.js";
import { simulationState, simulationCard } from "./helpers/simulation.js";

function setup(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, randomSeed: 19 });
  t.after(() => game.dispose());
  game.disablePresentationDelays = true;
  game.turn = "player"; game.turnCounter = 2; game.phase = "main1";
  game.player.controllerType = "human"; game.bot.controllerType = "human";
  const source = new Card(cardDefinition("Orathus, The Fallen Angel"), "player");
  const short = new Card(cardDefinition("Darkness Dragon"), "player");
  const target = new Card(cardDefinition("Shadow-Heart Scale Dragon"), "bot");
  placeFieldCards(game.player.field, source, short); placeFieldCards(game.bot.field, target);
  for (const card of [source, short, target]) game.ensureDuelCardId(card);
  const longEffect = required(source.effects.find(effect => effect.id === "orathus_synchro_summon_negate"));
  const shortEffect = required(short.effects.find(effect => effect.id === "darkness_dragon_negate"));
  const apply = async (duration: "while_faceup" | "until_end_turn") => {
    const from = duration === "while_faceup" ? source : short;
    return game.effectEngine.applyActions([{ type: "add_status", targetRef: "victim", status: "effectsNegated", value: true, duration }],
      { source: from, player: game.player, opponent: game.bot, effect: duration === "while_faceup" ? longEffect : shortEffect }, { victim: [target] });
  };
  return { game, source, short, target, longEffect, shortEffect, apply };
}

function selectCandidates(game: ReturnType<typeof createRuntimeGame>, definition: EffectTarget, ctx: EffectContext) {
  return game.effectEngine.selectCandidates(
    unsafeFixture<Parameters<typeof game.effectEngine.selectCandidates>[0]>(definition, "These concrete target fixtures have no array-valued nested zone filter."),
    unsafeFixture<Parameters<typeof game.effectEngine.selectCandidates>[1]>(ctx, "Real runtime Cards satisfy selection reads; their nullable fieldPresenceId is unused here."),
  );
}

for (const duration of ["while_faceup", "until_end_turn"] as const) {
  test(`negation-only activation excludes an already negated target (${duration}) before paying its cost`, async t => {
    const { game, target, source, short, longEffect, shortEffect, apply } = setup(t);
    await apply(duration);
    const cost = new Card(cardDefinition(1), "player"); game.player.hand.push(cost);
    const longTarget = required(longEffect.targets?.[0]);
    assert.deepEqual(selectCandidates(game, longTarget, { source, effect: longEffect, player: game.player, opponent: game.bot }).candidates, []);
    assert.equal(game.effectEngine.canActivateMonsterEffectPreview(short, game.player, "field", null, { effectId: shortEffect.id }).ok, false);
    const result = await game.tryActivateMonsterEffect(short, { darkness_dragon_discard_cost: [cost], darkness_dragon_negate_target: [target] }, "field", game.player, { effectId: shortEffect.id });
    assert.equal(result.success, false);
    assert.ok(game.player.hand.includes(cost));
  });
}

test("mixed resolution results preserve ordinary negated targets, while cost targets are not filtered", async t => {
  const { game, target, source, longEffect, apply } = setup(t); await apply("while_faceup");
  const def = required(longEffect.targets?.[0]);
  const mixed: EffectDefinition = { ...longEffect, actions: [...required(longEffect.actions), { type: "damage", amount: 100, player: "opponent" }] };
  assert.ok(selectCandidates(game, def, { source, effect: mixed, player: game.player, opponent: game.bot }).candidates.some(card => card.instanceId === target.instanceId));
  assert.ok(selectCandidates(game, { ...def, intent: "cost" }, { source, effect: longEffect, player: game.player, opponent: game.bot }).candidates.some(card => card.instanceId === target.instanceId));
});

for (const durations of [["while_faceup", "until_end_turn"], ["until_end_turn", "while_faceup"]] as const) {
  test(`independent negation contributions survive End Phase (${durations.join(", ")})`, async t => {
    const { game, target, source, short, apply } = setup(t);
    for (const duration of durations) await apply(duration);
    assert.equal(target.effectsNegatedDuration, "while_faceup");
    const entries = Reflect.get(target, "effectsNegationContributions");
    assert.equal(entries?.length, 2);
    assert.deepEqual(new Set(entries.map(entry => entry.sourceDuelCardId)), new Set([source.duelCardId, short.duelCardId]));
    game.cleanupTempBoosts(game.bot);
    assert.equal(target.effectsNegated, true);
    assert.equal(target.effectsNegatedDuration, "while_faceup");
    assert.equal(Reflect.get(target, "effectsNegationContributions").length, 1);
  });
}

test("target face-down expires only while-faceup contributions; field exit clears remaining negation", async t => {
  const { game, target, source, apply } = setup(t);
  await apply("while_faceup"); await apply("until_end_turn");
  await game.moveCard(source, game.player, "graveyard", { fromZone: "field" });
  assert.equal(target.effectsNegated, true, "source departure does not end target-presence negation");
  await game.effectEngine.applyActions([{ type: "set_facedown_defense", targetRef: "victim" }], { source, player: game.player, opponent: game.bot }, { victim: [target] });
  assert.equal(target.effectsNegated, true);
  assert.equal(Reflect.get(target, "effectsNegationContributions")?.length, 1);
  game.cleanupTempBoosts(game.bot);
  assert.equal(target.effectsNegated, false);
  target.isFacedown = false; await apply("while_faceup");
  await game.moveCard(target, game.bot, "graveyard", { fromZone: "field" });
  assert.equal(target.effectsNegated, false);
  assert.deepEqual(Reflect.get(target, "effectsNegationContributions"), []);
});

test("negation records are isolated in planning, rollback and canonical snapshots", async t => {
  const { game, target, apply } = setup(t); await apply("while_faceup"); await apply("until_end_turn");
  for (const planningOnly of [false, true]) {
    const clone = createPlanningCopy(planningOnly).cloneCardForSim(target);
    const entries = Reflect.get(clone, "effectsNegationContributions");
    assert.equal(entries?.length, 2);
    assert.notEqual(entries, Reflect.get(target, "effectsNegationContributions"));
    required(entries[0]).duration = "until_end_turn";
    assert.equal(required(target.effectsNegationContributions[0]).duration, "while_faceup");
  }
  const snapshot = game.captureZoneSnapshot();
  const canonical = createCanonicalStateSnapshot(game);
  const beforeHash = hashCanonicalGameState(game);
  const liveEntries = Reflect.get(target, "effectsNegationContributions");
  required(liveEntries[0]).duration = "until_end_turn";
  assert.notEqual(hashCanonicalGameState(game), beforeHash);
  const serializedTarget = required(canonical.players.bot.zones.field[0]);
  assert.equal(required(serializedTarget.statuses.effectsNegationContributions[0]).duration, "while_faceup");
  game.restoreZoneSnapshot(snapshot);
  assert.equal(hashCanonicalGameState(game), beforeHash);
  assert.notEqual(Reflect.get(target, "effectsNegationContributions"), Reflect.get(required(snapshot.cardState.get(target)), "effectsNegationContributions"));
});

test("simulated overlapping negation retains the same persistent contribution after cleanup", () => {
  const source = new Card(cardDefinition("Orathus, The Fallen Angel"), "bot");
  const target = new Card(cardDefinition(1), "player");
  const state = simulationState({ bot: { field: [simulationCard(source)] }, player: { field: [simulationCard(target)] } });
  for (const duration of ["while_faceup", "until_end_turn"] as const) {
    applySimulatedActions({ state, actions: [{ type: "add_status", targetRef: "victim", status: "effectsNegated", duration }], selections: { victim: [target] }, options: { sourceCard: simulationCard(source) } });
  }
  cleanupSimulatedEndTurn(state);
  assert.equal(target.effectsNegated, true);
  assert.equal(target.effectsNegatedDuration, "while_faceup");
});

test("backrow set_source finalization expires face-up negation", async t => {
  const { game, source } = setup(t);
  const trap = new Card(cardDefinition("Call of the Haunted"), "bot"); game.bot.spellTrap.push(trap);
  await game.effectEngine.applyActions([{ type: "add_status", targetRef: "victim", status: "effectsNegated", duration: "while_faceup" }],
    { source, player: game.player, opponent: game.bot }, { victim: [trap] });
  const { applySpellTrapFinalizationOverride } = await import("../src/core/game/spellTrap/finalization.js");
  assert.equal(applySpellTrapFinalizationOverride.call(game, trap, game.bot, "spellTrap", {
    activationContext: { spellTrapFinalization: { type: "set_source" } },
  }), true);
  assert.equal(trap.isFacedown, true);
  assert.equal(trap.effectsNegated, false);
});

test("temporary status restoration cannot erase surviving negation contributions", async t => {
  const { game, target, apply } = setup(t); await apply("while_faceup");
  target.tempStatuses.effectsNegated = false;
  game.cleanupTempBoosts(game.bot);
  assert.equal(target.effectsNegated, true);
  assert.equal(target.effectsNegatedDuration, "while_faceup");
});

for (const persistentFirst of [false, true]) {
  test(`two legally declared Chain links keep both negations (persistent first: ${persistentFirst})`, async t => {
    const { game, source, short, target, longEffect, shortEffect } = setup(t);
    const declarations = persistentFirst ? [[source, longEffect], [short, shortEffect]] as const
      : [[short, shortEffect], [source, longEffect]] as const;
    for (const [card, effect] of declarations) {
      const targetDef = required(effect.targets?.find(def => def.intent !== "cost"));
      assert.ok(selectCandidates(game, targetDef, { source: card, effect, player: game.player, opponent: game.bot }).candidates.some(card => card.instanceId === target.instanceId));
      assert.ok(game.chainSystem.addToChain(game.chainSystem.createPreparedActivation({
        card, controller: game.player, effect, activationZone: "field", committed: true, costsPaid: true,
        targetSelections: chainSelections({ [targetDef.id]: [target] }),
      })));
    }
    assert.equal(target.effectsNegated, false);
    await game.chainSystem.resolveChain();
    assert.equal(target.effectsNegationContributions.length, 2);
    game.cleanupTempBoosts(game.bot);
    assert.equal(target.effectsNegated, true);
    assert.equal(target.effectsNegationContributions.length, 1);
  });
}

test("controller transfer preserves target presence and all contribution records", async t => {
  const { game, target, apply } = setup(t); await apply("while_faceup"); await apply("until_end_turn");
  const version = target.locationVersion;
  const entries = structuredClone(target.effectsNegationContributions);
  const result = await game.transferControl(target, game.player);
  assert.equal(result.success, true);
  assert.equal(target.locationVersion, version);
  assert.deepEqual(target.effectsNegationContributions, entries);
  game.cleanupTempBoosts(game.player);
  assert.equal(target.effectsNegated, true);
});

test("already negated backrow remains eligible and mixed stat/negation stays legal", async t => {
  const { game, source, target, longEffect, apply } = setup(t); await apply("while_faceup");
  const spell = new Card(cardDefinition("Call of the Haunted"), "bot"); game.bot.spellTrap.push(spell);
  await game.effectEngine.applyActions(required(longEffect.actions), { source, effect: longEffect, player: game.player, opponent: game.bot }, { orathus_negate_target: [spell] });
  const def = required(longEffect.targets?.[0]);
  assert.ok(selectCandidates(game, def, { source, effect: longEffect, player: game.player, opponent: game.bot }).candidates.some(card => card.instanceId === spell.instanceId));
  const mixed: EffectDefinition = { ...longEffect, actions: [{ type: "set_stats_to_zero_and_negate", targetRef: def.id }] };
  assert.ok(selectCandidates(game, def, { source, effect: mixed, player: game.player, opponent: game.bot }).candidates.some(card => card.instanceId === target.instanceId));
  const only: EffectDefinition = { ...longEffect, actions: [{ type: "set_stats_to_zero_and_negate", targetRef: def.id, setAtkToZero: false, setDefToZero: false }] };
  assert.equal(selectCandidates(game, def, { source, effect: only, player: game.player, opponent: game.bot }).candidates.some(card => card.instanceId === target.instanceId), false);
});

test("Dragon simulation rejects redundant Darkness negation before discarding", async () => {
  const { simulateMainPhaseAction } = await import("../src/core/ai/dragon/simulation.js");
  const source = simulationCard(new Card(cardDefinition("Darkness Dragon"), "bot"));
  const target = simulationCard(new Card(cardDefinition(1), "player")); target.effectsNegated = true;
  const cost = simulationCard(new Card(cardDefinition(1), "bot"));
  const state = simulationState({ _isPerspectiveState: true, turn: "bot", phase: "main1", bot: { field: [source], hand: [cost] }, player: { field: [target] } });
  simulateMainPhaseAction(state, { type: "monsterEffect", cardId: source.id, fieldIndex: 0, effectId: "darkness_dragon_negate" });
  assert.equal(state.bot.hand.length, 1);
  assert.equal(state.bot.graveyard.length, 0);
});

test("public snapshots detach visible negation records and hide facedown records", async t => {
  const { game, target, apply } = setup(t); await apply("while_faceup"); await apply("until_end_turn");
  const publicState = game.getPublicState("player");
  const projected = required(publicState.players.opponent.field[0]);
  assert.deepEqual(projected.status.effectsNegationContributions, target.effectsNegationContributions);
  const first = required(projected.status.effectsNegationContributions?.[0]);
  first.sourceEffectId = "snapshot_only";
  assert.notEqual(target.effectsNegationContributions[0]?.sourceEffectId, "snapshot_only");
  target.isFacedown = true;
  assert.equal(game.getPublicState("player").players.opponent.field[0]?.status.effectsNegationContributions, null);
});

test("canonical provenance is independent of process-global instance identities", async t => {
  const first = setup(t), second = setup(t);
  for (const fixture of [first, second]) { await fixture.apply("while_faceup"); await fixture.apply("until_end_turn"); }
  assert.notEqual(first.source.instanceId, second.source.instanceId);
  assert.equal(hashCanonicalGameState(first.game), hashCanonicalGameState(second.game));
});

test("Card construction derives negation projections from detached contribution records", () => {
  const entries = [{ duration: "while_faceup" as const, sourceDuelCardId: 2, sourceEffectId: "persistent" }];
  const card = new Card({ ...cardDefinition(1), effectsNegationContributions: entries }, "player");
  assert.equal(card.effectsNegated, true);
  assert.equal(card.effectsNegatedDuration, "while_faceup");
  required(card.effectsNegationContributions[0]).sourceEffectId = "clone";
  assert.equal(entries[0]?.sourceEffectId, "persistent");
});

test("source departure cannot expire while-faceup negation at the next boundary", async t => {
  const { game, source, target, apply } = setup(t); await apply("while_faceup");
  await game.moveCard(source, game.player, "graveyard", { fromZone: "field" });
  game.cleanupTempBoosts(game.bot);
  assert.equal(target.effectsNegated, true);
  assert.equal(target.effectsNegationContributions[0]?.sourceDuelCardId, source.duelCardId);
});
