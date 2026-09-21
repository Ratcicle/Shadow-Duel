import assert from "node:assert/strict";
import test from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";
import {
  fingerprintMainPhaseAction as actionKey,
  fingerprintMainPhaseState as stateKey,
} from "../../src/core/bot/mainPhaseIdentity.js";
import { cardDefinition, required } from "../helpers/fixtures.js";

function fixture() {
  const bot = new Bot();
  const game = new Game({ opponentOverride: bot, disableChains: true, randomSeed: 1 });
  game.phase = "main1";
  game.turn = bot.id;
  game.turnCounter = 4;
  game.resetOncePerTurnUsage();
  bot.hand = [new Card(cardDefinition("Luminarch Aegisbearer"), bot.id), new Card(cardDefinition("Luminarch Aegisbearer"), bot.id)];
  bot.field = [new Card(cardDefinition("Luminarch Aegisbearer"), bot.id), new Card(cardDefinition("Luminarch Aegisbearer"), bot.id)];
  for (const card of [...bot.hand, ...bot.field]) game.ensureDuelCardId(card);
  return { game, bot };
}

test("main-phase identity reads actual player and card OPT ledgers without invoking previews", () => {
  const { game, bot } = fixture();
  const source = required(bot.field[0]);
  const effect: EffectDefinition = { id: "identity_opt", timing: "ignition", activationZones: ["field"], oncePerTurn: true, actions: [] };
  const initial = stateKey(game, bot);
  game.markOncePerTurnUsed(source, bot, effect);
  const playerUsed = stateKey(game, bot);
  assert.notEqual(playerUsed, initial);
  game.markOncePerTurnUsed(source, bot, { ...effect, oncePerTurnScope: "card" });
  assert.notEqual(stateKey(game, bot), playerUsed);
  const cardUsed = stateKey(game, bot);
  Object.assign(game.effectEngine, { usedThisTurn: new Map([["engine-use", game.turnCounter]]) });
  assert.notEqual(stateKey(game, bot), cardUsed);
});

test("main-phase identity observes gameplay changes and ignores presentation and logs", () => {
  const { game, bot } = fixture();
  const baseline = stateKey(game, bot);
  game.pendingVisualFeedback.push({ kind: "test", amount: 5 });
  game.aiActionDelayMs = 123;
  game.devModeEnabled = !game.devModeEnabled;
  assert.equal(stateKey(game, bot), baseline);
  required(bot.field[0]).counters = new Map([["charge", 1]]);
  assert.notEqual(stateKey(game, bot), baseline);
  const counters = stateKey(game, bot);
  required(bot.field[0]).effectsNegated = true;
  assert.notEqual(stateKey(game, bot), counters);
  const negated = stateKey(game, bot);
  bot.additionalNormalSummons++;
  assert.notEqual(stateKey(game, bot), negated);
  const summon = stateKey(game, bot);
  game.materialDuelStats.bot.effectActivationsByMaterialId.set(1, 1);
  assert.notEqual(stateKey(game, bot), summon);
});

test("identity never follows _gameRef, preview, UI or live effect getters", () => {
  const { game, bot } = fixture();
  for (const key of ["_gameRef", "ui", "renderer"] as const) {
    Object.defineProperty(game, key, { configurable: true, get() { throw new Error(`read ${key}`); } });
  }
  for (const key of ["getMonsterIgnitionEffect", "canActivateMonsterEffectPreview"] as const) {
    Object.defineProperty(game.effectEngine, key, { configurable: true, get() { throw new Error(`read ${key}`); } });
  }
  assert.doesNotThrow(() => stateKey(game, bot));
  assert.doesNotThrow(() => actionKey({ type: "monsterEffect", fieldIndex: 0, effectId: "effect" }, game, bot));
});

test("contextual action identity separates copies, effects, preferences and actor", () => {
  const { game, bot } = fixture();
  const base: AIAction = { type: "monsterEffect", fieldIndex: 0, effectId: "first" };
  const fingerprint = actionKey(base, game, bot);
  assert.notEqual(actionKey({ ...base, fieldIndex: 1 }, game, bot), fingerprint);
  assert.notEqual(actionKey({ ...base, effectId: "second" }, game, bot), fingerprint);
  assert.notEqual(actionKey({ ...base, activationContext: { actionContext: { preferredCase: "draw" } } }, game, bot), fingerprint);
  assert.notEqual(actionKey({ ...base, activationContext: { targetPreferences: { target: [1] } } }, game, bot), fingerprint);
  assert.equal(actionKey({ ...base, score: 200, reason: "diagnostic", activationContext: { logTargets: true } }, game, bot), fingerprint);
  bot.id = "player";
  assert.notEqual(actionKey(base, game, bot), fingerprint);
});

test("index zero resolves live source and unchanged instance survives action regeneration after reorder", () => {
  const { game, bot } = fixture();
  const first = required(bot.hand[0]);
  const second = required(bot.hand[1]);
  const key = actionKey({ type: "summon", index: 0, cardId: first.id }, game, bot);
  assert.notEqual(actionKey({ type: "summon", index: 1, cardId: second.id }, game, bot), key);
  bot.hand.reverse();
  assert.equal(actionKey({ type: "summon", index: 1, cardId: first.id }, game, bot), key);
  assert.notEqual(actionKey({ type: "summon", index: 0, cardId: first.id }, game, bot), key);
});

test("field and graveyard executor index resolution takes precedence over stale card hints", () => {
  const { game, bot } = fixture();
  const card = required(bot.field[0]);
  const first = actionKey({ type: "monsterEffect", fieldIndex: 0 }, game, bot);
  assert.equal(actionKey({ type: "monsterEffect", fieldIndex: 0, cardId: 999999 }, game, bot), first);
  bot.graveyard.push(card);
  bot.field.shift();
  const grave = actionKey({ type: "graveyardMonsterEffect", graveyardIndex: 0 }, game, bot);
  assert.notEqual(grave, first);
  assert.equal(actionKey({ type: "graveyardMonsterEffect", cardId: card.id }, game, bot), grave);
});

test("activation metadata canonicalizes object, Map and Set insertion order", () => {
  const { game, bot } = fixture();
  const first = actionKey({ type: "monsterEffect", fieldIndex: 0, activationContext: { actionContext: { choices: new Map([["a", 1], ["b", 2]]), targets: new Set([1, 2]) } } }, game, bot);
  const reordered = actionKey({ type: "monsterEffect", fieldIndex: 0, activationContext: { actionContext: { targets: new Set([2, 1]), choices: new Map([["b", 2], ["a", 1]]) } } }, game, bot);
  assert.equal(reordered, first);
});

test("position, face-down choice and material instances remain distinct", () => {
  const { game, bot } = fixture();
  const normal = actionKey({ type: "summon", index: 0, position: "attack" }, game, bot);
  assert.notEqual(actionKey({ type: "summon", index: 0, position: "defense" }, game, bot), normal);
  assert.notEqual(actionKey({ type: "summon", index: 0, position: "attack", facedown: true }, game, bot), normal);
  const extra = new Card(cardDefinition("Luminarch Aegisbearer"), bot.id);
  bot.extraDeck.push(extra);
  const material = required(bot.field[0]);
  const action: AIAction = { type: "extraDeckProcedure", extraDeckIndex: 0, cardId: extra.id, materials: [{ index: 0, instanceIds: [material.instanceId] }], position: "attack" };
  const before = actionKey(action, game, bot);
  assert.notEqual(actionKey({ ...action, materials: [{ index: 1 }] }, game, bot), before);
  bot.field.reverse();
  assert.equal(actionKey(action, game, bot), before);
  assert.equal(actionKey({ type: "extraDeckProcedure", extraDeckIndex: 0, cardId: extra.id, materialIndices: [1], materialInstanceIds: [[material.instanceId]], position: "attack" }, game, bot), before);
});

test("runtime registration metadata is projected without following card or player live graphs", () => {
  const { game, bot } = fixture();
  const baseline = stateKey(game, bot);
  game.scheduleDelayedAction("delayed_destroy", { phase: "end", player: bot.id }, {
    card: required(bot.field[0]), owner: bot.id, sourceCard: required(bot.field[1]), sourcePlayer: bot,
  });
  const scheduled = stateKey(game, bot);
  assert.notEqual(scheduled, baseline);
  Object.assign(required(game.delayedActions[0]), { callback: () => { throw new Error("callback must not run"); } });
  assert.equal(stateKey(game, bot), scheduled);
  game.temporaryReplacementEffects.push({ sourceCard: required(bot.field[0]), remainingUses: 1 });
  assert.notEqual(stateKey(game, bot), scheduled);
  game.temporaryEventEffects.push({ ownerId: bot.id, event: "after_summon", sourceImage: "old-art.png", usesRemaining: 1 });
  const registered = stateKey(game, bot);
  Object.assign(required(game.temporaryEventEffects[0]), { sourceImage: "new-art.png" });
  assert.equal(stateKey(game, bot), registered, "temporary source artwork is presentation, not progress");
});

test("unresolved sources and cyclic unsupported metadata throw identity failures", () => {
  const { game, bot } = fixture();
  assert.throws(() => actionKey({ type: "monsterEffect", fieldIndex: 99 }, game, bot), /source/i);
  const cyclic: { cycle?: unknown } = {};
  cyclic.cycle = cyclic;
  assert.throws(() => actionKey({ type: "monsterEffect", fieldIndex: 0, activationContext: { actionContext: cyclic } }, game, bot), /cyclic/i);
});

test("planner aggregate battle identity represents a phase bridge without an attacker", () => {
  const { game, bot } = fixture();
  const aggregate = actionKey({ type: "simulatedBattle", phaseBridge: "battle", damage: 1500, destroyedNames: ["Opponent monster"] }, game, bot);
  assert.equal(actionKey({ type: "simulatedBattle", phaseBridge: "battle", damage: 2000 }, game, bot), aggregate);
  assert.notEqual(actionKey({ type: "simulatedBattle", phaseBridge: "main2" }, game, bot), aggregate);
  assert.doesNotThrow(() => actionKey({ type: "simulatedBattle" }, game, bot));
});
