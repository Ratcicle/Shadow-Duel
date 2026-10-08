import assert from "node:assert/strict";
import test from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import { bindPlanningActionPresence, getPlanningActionPresence, getPlanningIdentityGame, isPlanningActionPresenceCurrent, resolvePlanningCard } from "../../src/core/ai/common/actionIdentity.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { applyGenericSimulatedMainPhaseAction, resolveSimulatedHandIndex } from "../../src/core/ai/common/simulation.js";
import { getGenericNormalSummonActions } from "../../src/core/ai/common/actionGeneration.js";
import { fingerprintMainPhaseAction } from "../../src/core/bot/mainPhaseIdentity.js";
import { resolveHandIndexForAction } from "../../src/core/bot/actionValidation.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame } from "../helpers/game.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

for (const actor of ["bot", "player"] as const) {
  test(`private physical presence survives spreads and planning copies, and expires with movement (${actor})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
    t.after(() => game.dispose("architecture_action_identity"));
    const owner = Object.assign(new Bot("dragon"), { oncePerDuelUsageByName: {} as Record<string, number> }); owner.id = actor; game[actor] = owner;
    owner.game = unsafeFixture<BotGamePort>(game, "Concrete runtime owner retains its Game capability for stable card IDs.");
    const source = required(game.createCardForOwner(256, owner));
    owner.hand.push(source);
    const action = bindPlanningActionPresence({ type: "summon" as const, card: source, index: 0, cardId: source.id }, source, actor, "hand", game);
    const decorated = { ...action, priority: 7 };
    const copied = createPlanningCopy().copyValue(decorated);
    assert.ok(copied && typeof copied === "object");
    const frame = required(getPlanningActionPresence(action));
    assert.equal(getPlanningActionPresence(decorated), frame);
    assert.equal(getPlanningActionPresence(copied), frame);
    assert.ok(Object.isFrozen(frame) && Object.isFrozen(frame.source));
    assert.deepEqual(JSON.parse(JSON.stringify(action)), JSON.parse(JSON.stringify({
      type: "summon", card: source, index: 0, cardId: source.id,
    })), "the private binding adds no serialized action fields");
    assert.equal(isPlanningActionPresenceCurrent(copied, owner), true);
    await game.moveCard(source, owner, "banished", { fromZone: "hand" });
    await game.moveCard(source, owner, "hand", { fromZone: "banished" });
    assert.equal(isPlanningActionPresenceCurrent(action, owner), false);
    assert.equal(isPlanningActionPresenceCurrent(decorated, owner), false);
    assert.equal(isPlanningActionPresenceCurrent(copied, owner), false);
    assert.equal(frame.source.locationVersion + 2, source.locationVersion);
  });

  test(`a bound shared Normal candidate cannot be replaced by an identical sibling (${actor})`, t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
    t.after(() => game.dispose("architecture_bound_normal"));
    game.turn = actor; game.phase = "main1"; game.turnCounter = 4;
    const owner = Object.assign(new Bot("dragon"), { oncePerDuelUsageByName: {} as Record<string, number> }); owner.id = actor; game[actor] = owner;
    const first = new Card(cardDefinition(256), actor);
    const sibling = new Card(cardDefinition(256), actor);
    owner.hand.push(first, sibling);
    owner.game = unsafeFixture<BotGamePort>(game, "Concrete runtime owner retains its Game capability for stable card IDs.");
    const action = required(getGenericNormalSummonActions({ player: owner, analysis: { canNormalSummon: true } })[0]);
    assert.ok(first.duelCardId != null, "the runtime producer establishes canonical identity before binding");
    assert.equal(resolveHandIndexForAction(owner, action), 0);
    owner.hand.splice(0, 1); owner.banished.push(first);
    assert.equal(resolveHandIndexForAction(owner, action), -1);
    const { state } = createGameTreeCopy(game, owner);
    applyGenericSimulatedMainPhaseAction(state, action);
    assert.equal(state.bot.field.length, 0);
    assert.equal(state.bot.hand[0]?.instanceId, sibling.instanceId);
    assert.equal(owner.hand[0], sibling);
    assert.equal(getPlanningIdentityGame({ game }), undefined, "a detached projection cannot use a runtime owner's Game");
  });

  test(`action fingerprints separate physical copies and a new presence of the same copy (${actor})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
    t.after(() => game.dispose("architecture_action_fingerprint"));
    const owner = Object.assign(new Bot("dragon"), { oncePerDuelUsageByName: {} as Record<string, number> }); owner.id = actor; game[actor] = owner;
    const port = unsafeFixture<BotGamePort>(game, "Concrete runtime Game has the Bot capabilities; public EffectEngine projection is narrower.");
    const source = required(game.createCardForOwner(256, owner));
    const sibling = required(game.createCardForOwner(256, owner));
    owner.hand.push(source, sibling);
    const make = (card: Card) => bindPlanningActionPresence({ type: "summon" as const, cardId: card.id, index: owner.hand.indexOf(card) }, card, actor, "hand", game);
    const original = make(source);
    const originalKey = fingerprintMainPhaseAction(original, port, owner);
    assert.notEqual(fingerprintMainPhaseAction(make(sibling), port, owner), originalKey);
    assert.equal(fingerprintMainPhaseAction({ ...original, priority: 123 }, port, owner), originalKey);
    await game.moveCard(source, owner, "banished", { fromZone: "hand" });
    await game.moveCard(source, owner, "hand", { fromZone: "banished" });
    assert.throws(() => fingerprintMainPhaseAction(original, port, owner), TypeError);
    assert.notEqual(fingerprintMainPhaseAction(make(source), port, owner), originalKey);
  });

  test(`explicit ambiguous instance references fail while unbound legacy hints remain usable (${actor})`, () => {
    const first = new Card(cardDefinition(256), actor);
    const sibling = new Card(cardDefinition(256), actor);
    const owner = { id: actor, hand: [first, sibling] };
    assert.equal(resolveHandIndexForAction(owner, { cardId: first.id, index: 1 }), 1);
    assert.equal(resolvePlanningCard(owner.hand, first, actor, "hand").card, first);
    sibling.instanceId = first.instanceId;
    assert.equal(resolvePlanningCard(owner.hand, first, actor, "hand").card, undefined);
    const legacy = bindPlanningActionPresence({ index: 0, cardId: first.id }, { id: first.id }, actor, "hand");
    assert.equal(getPlanningActionPresence(legacy), undefined);
    assert.equal(resolveHandIndexForAction(owner, legacy), 0);
  });

  test(`a legacy index-only hand action preserves its occupied slot and expected kind (${actor})`, () => {
    const monster = simulationCard(new Card(cardDefinition(256), actor));
    const spell = simulationCard(new Card(cardDefinition(262), actor));
    const state = simulationState({ bot: { id: actor, hand: [monster, spell] } });
    assert.equal(resolveSimulatedHandIndex(state.bot, { index: 0 }, "monster"), 0);
    assert.equal(resolveSimulatedHandIndex(state.bot, { index: 1 }, "spell"), 1);
    assert.equal(resolveSimulatedHandIndex(state.bot, { index: 1 }, ["spell", "trap"]), 1);
    assert.equal(resolveSimulatedHandIndex(state.bot, { index: 1 }, "monster"), -1);
    assert.equal(resolveSimulatedHandIndex(state.bot, { index: -1 }, "monster"), -1);
    assert.equal(resolveSimulatedHandIndex(state.bot, { index: 2 }, "monster"), -1);
    assert.equal(resolveSimulatedHandIndex(state.bot, {}, "monster"), -1);
    assert.equal(resolveSimulatedHandIndex(state.bot, { index: 0, cardId: 99999 }, "monster"), -1);
  });

  test(`an index-only hint never overrides a missing or expired explicit hand presence (${actor})`, () => {
    const source = simulationCard(new Card(cardDefinition(256), actor));
    const sibling = simulationCard(new Card(cardDefinition(256), actor));
    const state = simulationState({ bot: { id: actor, hand: [source, sibling] } });
    const action = bindPlanningActionPresence({ index: 0 }, source, actor, "hand");
    assert.equal(resolveSimulatedHandIndex(state.bot, action, "monster"), 0);
    state.bot.hand.shift();
    assert.equal(resolveSimulatedHandIndex(state.bot, action, "monster"), -1);
    state.bot.hand.unshift(source);
    source.locationVersion = (source.locationVersion || 0) + 2;
    assert.equal(resolveSimulatedHandIndex(state.bot, action, "monster"), -1);
    assert.equal(resolveSimulatedHandIndex(state.bot, { index: 0, card: new Card(cardDefinition(256), actor) }, "monster"), -1);
  });
}
