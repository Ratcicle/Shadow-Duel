import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { CardAction } from "../src/core/contracts/actions.js";
import { cardDefinition, chainSelections, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { cleanupSimulatedEndTurn } from "../src/core/ai/common/simulatedActions/lifecycle.js";
import { createPlanningCopy } from "../src/core/ai/common/planningCopy.js";
import { createCanonicalStateSnapshot, hashCanonicalGameState } from "../src/core/game/replay/canonical.js";

function setup(t: TestContext, sourceId = 515) {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false });
  t.after(() => game.dispose());
  game.disablePresentationDelays = true;
  game.turn = "player"; game.turnCounter = 2; game.phase = "main1";
  game.player.controllerType = game.bot.controllerType = "human";
  const source = new Card(cardDefinition(sourceId), "player");
  const target = new Card(cardDefinition(1), "bot");
  placeFieldCards(game.player.field, source); placeFieldCards(game.bot.field, target);
  const apply = (action: CardAction) => game.effectEngine.applyActions([action],
    { source, player: game.player, opponent: game.bot }, { victim: [target] });
  return { game, source, target, apply };
}

test("durationless negation survives turn cleanup and source exit, then ends when the victim is set", async t => {
  const { game, source, target, apply } = setup(t);
  await apply({ type: "add_status", targetRef: "victim", status: "effectsNegated" });
  await game.moveCard(source, game.player, "graveyard", { fromZone: "field" });
  game.cleanupTempBoosts(game.bot);
  assert.equal(target.effectsNegated, true);
  assert.equal(target.effectsNegatedDuration, "while_faceup");
  await apply({ type: "set_facedown_defense", targetRef: "victim" });
  assert.equal(target.effectsNegated, false);
  target.isFacedown = false;
  assert.equal(target.effectsNegated, false);
});

test("untilEndOfTurn remains an explicit negation duration", async t => {
  const { game, target, apply } = setup(t);
  await apply({ type: "add_status", targetRef: "victim", status: "effectsNegated", untilEndOfTurn: true });
  assert.equal(target.effectsNegatedDuration, "until_end_turn");
  game.cleanupTempBoosts(game.bot);
  assert.equal(target.effectsNegated, false);
});

test("durationless ordinary status survives the turn and restores its baseline on setting or departure", async t => {
  const { game, target, apply } = setup(t);
  const grant: CardAction = { type: "add_status", targetRef: "victim", status: "mustBeAttacked" };
  await apply(grant);
  game.cleanupTempBoosts(game.bot);
  assert.equal(target.mustBeAttacked, true);
  await apply({ type: "set_facedown_defense", targetRef: "victim" });
  assert.equal(target.mustBeAttacked, false);
  target.isFacedown = false;
  await apply(grant);
  await game.moveCard(target, game.bot, "graveyard", { fromZone: "field" });
  assert.equal(target.mustBeAttacked, false);
});

test("simulation applies the same default negation and status lifetime", () => {
  const source = simulationCard(new Card(cardDefinition(515), "bot"));
  const victim = simulationCard(new Card(cardDefinition(1), "player"));
  const state = simulationState({ bot: { field: [source] }, player: { field: [victim] } });
  const selections = { victim: [victim] };
  applySimulatedActions({ state, actions: [
    { type: "add_status", targetRef: "victim", status: "effectsNegated" },
    { type: "add_status", targetRef: "victim", status: "mustBeAttacked" },
  ], selections, options: { sourceCard: source } });
  cleanupSimulatedEndTurn(state);
  assert.equal(victim.effectsNegated, true);
  assert.equal(victim.mustBeAttacked, true);
  applySimulatedActions({ state, actions: [{ type: "set_facedown_defense", targetRef: "victim" }], selections,
    options: { sourceCard: source } });
  assert.equal(victim.effectsNegated, false);
  assert.equal(victim.mustBeAttacked, false);
});

test("presence status baselines remain detached in clones, rollback and canonical hashes", async t => {
  const { game, target, apply } = setup(t);
  await apply({ type: "add_status", targetRef: "victim", status: "mustBeAttacked" });
  const before = hashCanonicalGameState(game);
  const snapshot = game.captureZoneSnapshot();
  const canonical = createCanonicalStateSnapshot(game);
  for (const planningOnly of [false, true]) {
    const clone = createPlanningCopy(planningOnly).cloneCardForSim(target);
    Reflect.set(required(clone.faceupStatuses), "mustBeAttacked", true);
    assert.equal(Reflect.get(target.faceupStatuses, "mustBeAttacked"), false);
  }
  Reflect.set(target.faceupStatuses, "mustBeAttacked", true);
  assert.notEqual(hashCanonicalGameState(game), before, "same current status with a different reset value is a different state");
  game.restoreZoneSnapshot(snapshot);
  assert.equal(hashCanonicalGameState(game), before);
  Reflect.set(target.faceupStatuses, "mustBeAttacked", true);
  assert.deepEqual(required(canonical.players.bot.zones.field[0]).statuses.faceupStatuses,
    { mustBeAttacked: { previous: false, current: true } });
  assert.equal(Reflect.get(required(required(snapshot.cardState.get(target)).faceupStatuses), "mustBeAttacked"), false);
});

for (const temporaryFirst of [false, true]) {
  test(`status applications with an explicit turn duration preserve the presence baseline (${temporaryFirst})`, async t => {
    const { game, target, apply } = setup(t);
    const persistent: CardAction = { type: "add_status", targetRef: "victim", status: "mustBeAttacked" };
    const temporary: CardAction = { ...persistent, value: false, untilEndOfTurn: true };
    for (const action of temporaryFirst ? [temporary, persistent] : [persistent, temporary]) await apply(action);
    game.cleanupTempBoosts(game.bot);
    assert.equal(target.mustBeAttacked, true);
    await apply({ type: "set_facedown_defense", targetRef: "victim" });
    assert.equal(target.mustBeAttacked, false);
  });
}

for (const zone of ["spellTrap", "fieldSpell"] as const) {
  test(`ordinary presence status resets when a card leaves ${zone}`, async t => {
    const { game, source } = setup(t);
    const spell = new Card(cardDefinition(518), "bot"); spell.isFacedown = false;
    if (zone === "fieldSpell") game.bot.fieldSpell = spell;
    else game.bot.spellTrap.push(spell);
    await game.effectEngine.applyActions([{ type: "add_status", targetRef: "victim", status: "mustBeAttacked" }],
      { source, player: game.player, opponent: game.bot }, { victim: [spell] });
    assert.equal(spell.mustBeAttacked, true);
    await game.moveCard(spell, game.bot, "graveyard", { fromZone: zone });
    assert.equal(spell.mustBeAttacked, false);
    assert.deepEqual(spell.faceupStatuses, {});
  });
}

test("moving a monster into facedown position ends its durationless stat buff", async t => {
  const { game, source } = setup(t);
  const monster = new Card(cardDefinition(1), "player");
  placeFieldCards(game.player.field, monster);
  const initialAtk = monster.atk;
  await game.effectEngine.applyActions([{ type: "buff_stats_temp", targetRef: "victim", atkBoost: 300 }],
    { source, player: game.player, opponent: game.bot }, { victim: [monster] });
  assert.equal(monster.atk, initialAtk + 300);
  await game.moveCard(monster, game.player, "field", { fromZone: "field", position: "defense", isFacedown: true });
  assert.equal(monster.isFacedown, true);
  assert.equal(monster.atk, initialAtk);
});

for (const sourceId of [515, 517]) {
  test(`Tech-Zero ${sourceId} resolves persistent negation once and leaves later entrants unaffected`, async t => {
    const { game, source, target } = setup(t, sourceId);
    const effect = required(source.effects.find(entry => entry.id === (sourceId === 515
      ? "tech_zero_reactor_dragon_synchro_negate" : "tech_zero_final_singularity_synchro_negate_all")));
    assert.ok(game.chainSystem.addToChain(game.chainSystem.createPreparedActivation({
      card: source, controller: game.player, effect, activationZone: "field", committed: true, costsPaid: true,
      targetSelections: chainSelections(sourceId === 515 ? { tech_zero_reactor_dragon_negate_target: [target] } : {}),
    })));
    await game.chainSystem.resolveChain();
    assert.equal(target.effectsNegated, true);
    await game.moveCard(source, game.player, "graveyard", { fromZone: "field" });
    game.cleanupTempBoosts(game.bot);
    assert.equal(target.effectsNegated, true);
    const later = new Card(cardDefinition(1), "bot"); game.bot.hand.push(later);
    await game.moveCard(later, game.bot, "field", { fromZone: "hand", summonOrigin: "effect_resolution", isFacedown: false, position: "attack" });
    assert.equal(later.effectsNegated, false);
    await game.moveCard(target, game.bot, "graveyard", { fromZone: "field" });
    assert.equal(target.effectsNegated, false);
    await game.moveCard(target, game.bot, "field", { fromZone: "graveyard", summonOrigin: "effect_resolution", isFacedown: false, position: "attack" });
    assert.equal(target.effectsNegated, false);
  });
}
