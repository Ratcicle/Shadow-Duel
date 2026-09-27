import assert from "node:assert/strict";
import test from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import { getGenericSynchroActions } from "../../src/core/ai/common/actionGeneration.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import * as lifecycle from "../../src/core/ai/common/simulatedActions/lifecycle.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { applyScheduleSpecialSummon } from "../../src/core/ai/common/simulatedActions/flow.js";
import { applyGenericSimulatedMainPhaseAction, attachSimulatedEventEmitter, resolveSimulatedEndPhase } from "../../src/core/ai/common/simulation.js";
import type { SimulatedRuntimeState } from "../../src/core/ai/common/simulatedActions/shared.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import type { AiLiveGamePort } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import { cardDefinition, required, record, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function fixture(actor: "player" | "bot" = "bot") {
  const player = (id: string) => ({ id, lp: 8000, hand: [], field: [], graveyard: [], deck: [], extraDeck: [], banished: [], spellTrap: [], fieldSpell: null, summonCount: 0, additionalNormalSummons: 0 });
  const state = unsafeFixture<SimulatedRuntimeState>({ bot: player(actor), player: player(actor === "bot" ? "player" : "bot"), turn: actor, phase: "main1", turnCounter: 4, _isPerspectiveState: true },
    "Minimal perspective graph for isolated phase lifecycle simulation");
  const make = (id: number) => createPlanningCopy().cloneCardForSim(new Card(cardDefinition(id), actor));
  const schedule = (card: ReturnType<typeof make>, position: "choice" | "attack" | "defense" = "choice") => {
    applyScheduleSpecialSummon({ state, self: state.bot, opponent: state.player, selfId: "bot", targets: [], selections: {},
      options: { sourceCard: card }, action: { type: "schedule_special_summon", cardRef: "self", fromZone: "graveyard", phase: "end", triggerPlayer: "current", position,
        statusesOnSummon: [{ status: "banishWhenLeavesField" }] }, applySimulatedActions });
  };
  return { state, make, schedule };
}

for (const actor of ["player", "bot"] as const) {
  test(`Raptor token plans rebuild with live identities before Synchro revalidation (${actor})`, async t => {
    const first = new Bot("techzero");
    first.id = "player";
    const second = new Bot("techzero");
    const game = createRuntimeGame({ opponentOverride: second, captureReplay: false, laboratoryMode: true, disableChains: true });
    game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot extends Player and supplies action-runtime selection");
    t.after(() => game.dispose("tech_zero_token_replanning"));
    game.turn = actor;
    game.phase = "main1";
    game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.effectEngine.chooseSpecialSummonPosition = async () => "attack";
    const bot = actor === "player" ? first : second;
    const botGame = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game,
      "Concrete Game and Bot supply attached action validation and clone capabilities");
    const raptor = new Card(cardDefinition(505), actor);
    const slasher = new Card(cardDefinition(510), actor);
    placeFieldCards(bot.field, raptor);
    bot.extraDeck.push(slasher);
    const actions = required(required(raptor.effects.find(effect => effect.id === "tech_zero_iron_raptor_synchro_tokens")).actions);

    const plannedState = bot.cloneGameState(botGame);
    applySimulatedActions({ state: plannedState, actions, options: { sourceCard: required(plannedState.bot.field[0]) } });
    const simulatedTokens = plannedState.bot.field.filter(card => card.isToken);
    assert.equal(simulatedTokens.length, 2);
    assert.equal(new Set(simulatedTokens.map(card => card.instanceId)).size, 2);
    assert.ok(simulatedTokens.every(card => typeof card.instanceId === "string" && card.instanceId.startsWith("sim:token:")));
    const staleAction = required(getGenericSynchroActions(plannedState).find(action => action.synchroInstanceId === slasher.instanceId));
    assert.ok(staleAction.materialInstanceIds.some(id => typeof id === "string" && id.startsWith("sim:token:")));

    await game.effectEngine.applyActions(actions, {
      source: raptor, player: game[actor], opponent: game[actor === "player" ? "bot" : "player"],
    }, {});
    const realTokens = bot.field.filter(card => card.isToken);
    assert.equal(realTokens.length, 2);
    assert.ok(realTokens.every(card => typeof card.instanceId === "number"));
    const refreshedState = bot.cloneGameState(botGame);
    assert.deepEqual(refreshedState.bot.field.filter(card => card.isToken).map(card => card.instanceId),
      realTokens.map(card => card.instanceId));

    const before = { field: [...bot.field], graveyard: [...bot.graveyard], extraDeck: [...bot.extraDeck] };
    assert.deepEqual(bot.filterValidActionsForCurrentState([staleAction], botGame), []);
    assert.equal(await bot.executeMainPhaseAction(botGame, staleAction), false);
    assert.deepEqual({ field: bot.field, graveyard: bot.graveyard, extraDeck: bot.extraDeck }, before);
    const freshAction = required(getGenericSynchroActions(refreshedState).find(action => action.synchroInstanceId === slasher.instanceId));
    assert.ok(freshAction.materialInstanceIds.includes(raptor.instanceId));
    assert.ok(freshAction.materialInstanceIds.some(id => realTokens.some(token => token.instanceId === id)));
    assert.ok(freshAction.materialInstanceIds.every(id => typeof id === "number"));
    assert.deepEqual(bot.filterValidActionsForCurrentState([freshAction], botGame), [freshAction]);
  });
}

for (const actor of ["player", "bot"] as const) {
  test(`delayed Phoenix revival matches runtime position, status and event sequence (${actor})`, async t => {
    assert.equal(typeof lifecycle.processSimulatedDelayedActions, "function");
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
    t.after(() => game.dispose("lifecycle_simulation_test"));
    game.turn = actor;
    game.turnCounter = 4;
    game.disablePresentationDelays = true;
    const phoenix = new Card(cardDefinition(514), actor);
    phoenix.properSummonEstablished = true;
    phoenix.properSummonProcedure = "synchro";
    game[actor].graveyard.push(phoenix);
    const { state, schedule } = fixture(actor);
    const simulated = createPlanningCopy().cloneCardForSim(phoenix);
    state.bot.graveyard.push(simulated);
    schedule(simulated, "defense");
    lifecycle.processSimulatedDelayedActions(state, "standby", actor);
    assert.deepEqual(state.bot.field, []);
    lifecycle.processSimulatedDelayedActions(state, "end", state.player.id);
    assert.deepEqual(state.bot.field, []);
    const realEvents: string[] = [];
    game.on("card_moved", payload => { if (payload.card === phoenix) realEvents.push("card_moved"); });
    game.on("after_summon", payload => { if (payload.card === phoenix) realEvents.push("after_summon"); });
    await game.resolveDelayedSummon({ summons: [{ card: phoenix, owner: actor, fromZone: "graveyard", position: "defense", statusesOnSummon: [{ status: "banishWhenLeavesField" }] }] });
    const events: string[] = [];
    lifecycle.processSimulatedDelayedActions(state, "end", actor, { emitSimulatedEvent: event => events.push(event) });
    assert.equal(required(state.bot.field[0]), simulated);
    assert.equal(simulated.position, phoenix.position);
    assert.equal(simulated.banishWhenLeavesField, phoenix.banishWhenLeavesField);
    assert.deepEqual(events, realEvents);
    assert.deepEqual(state.delayedActions, []);
    assert.equal(state.turnCounter, 4);
  });
}

for (const invalid of ["improper", "moved", "singularity", "restriction", "full"] as const) {
  test(`delayed summon revalidates ${invalid} at resolution`, () => {
    assert.equal(typeof lifecycle.processSimulatedDelayedActions, "function");
    const { state, make, schedule } = fixture();
    const card = make(invalid === "singularity" ? 517 : 514);
    card.properSummonEstablished = invalid !== "improper";
    card.properSummonProcedure = invalid === "improper" ? null : "synchro";
    if (invalid === "improper") card.mustFirstBeSpecialSummonedBy = ["synchro"];
    state.bot.graveyard.push(card);
    schedule(card);
    if (invalid === "moved") { state.bot.graveyard.length = 0; state.bot.banished.push(card); }
    if (invalid === "full") placeFieldCards(state.bot.field, make(501), make(502), make(504), make(505), make(506));
    if (invalid === "restriction") state.bot.specialSummonRestrictions = [{ allowedFilters: { archetype: "Void" }, duration: "until_end_turn", expiresOnTurn: 4,
      reason: null, sourceName: null, sourceId: null, effectId: null }];
    lifecycle.processSimulatedDelayedActions(state, "end", "bot");
    assert.equal(state.bot.field.includes(card), false);
    assert.deepEqual(state.delayedActions, [], "failed delayed summon is consumed, not retried next turn");
  });
}

test("delayed summons resolve one at a time and revalidate slots after each event", () => {
  assert.equal(typeof lifecycle.processSimulatedDelayedActions, "function");
  const { state, make, schedule } = fixture();
  const first = make(514);
  const second = make(514);
  for (const card of [first, second]) { card.properSummonEstablished = true; card.properSummonProcedure = "synchro"; state.bot.graveyard.push(card); schedule(card); }
  placeFieldCards(state.bot.field, make(501), make(502), make(504), make(505));
  const events: Array<{ event: string; instanceId: unknown; fieldCount: number }> = [];
  lifecycle.processSimulatedDelayedActions(state, "end", "bot", {
    chooseSpecialSummonPosition: () => "defense",
    emitSimulatedEvent(event, payload) {
      events.push({ event, instanceId: record(record(payload).card).instanceId, fieldCount: state.bot.field.length });
      if (event === "after_summon" && record(payload).card === first) {
        state.bot.field.splice(state.bot.field.indexOf(first), 1);
        state.bot.banished.push(first);
      }
    },
  });
  assert.deepEqual(events.map(entry => [entry.event, entry.instanceId, entry.fieldCount]), [
    ["after_summon", first.instanceId, 5], ["card_moved", first.instanceId, 4],
    ["after_summon", second.instanceId, 5], ["card_moved", second.instanceId, 5],
  ]);
  assert.equal(second.position, "defense");
});

test("End Phase cleanup restores temporary levels and retains field-presence negation", () => {
  assert.equal(typeof lifecycle.cleanupSimulatedEndTurn, "function");
  const { state, make } = fixture();
  const core = make(501); core.level = 3; core.originalLevel = 1; core.effectsNegated = true; core.effectsNegatedDuration = "while_faceup";
  const hand = make(503); hand.level = 1; hand.originalLevel = 3;
  const timed = make(502); timed.effectsNegated = true; timed.effectsNegatedDuration = "end_of_turn";
  placeFieldCards(state.bot.field, core, timed);
  state.bot.hand.push(hand);
  state.bot.forbidDirectAttacksThisTurn = true;
  lifecycle.cleanupSimulatedEndTurn(state);
  assert.equal(core.level, 1);
  assert.equal(hand.level, 3);
  assert.equal(core.originalLevel, null);
  assert.equal(core.effectsNegated, true);
  assert.equal(timed.effectsNegated, false);
  assert.equal(state.bot.forbidDirectAttacksThisTurn, false);
});

test("protection, turn buffs and restrictions expire after their inclusive final turn", () => {
  assert.equal(typeof lifecycle.cleanupExpiredSimulatedTurnEffects, "function");
  const { state, make } = fixture();
  const card = make(516);
  card.protectionEffects = [{ type: "battle_destruction", duration: "end_of_next_turn", expiresOnTurn: 5 }];
  card.turnBasedBuffs = [{ id: "boost", stat: "atk", value: 800, expiresOnTurn: 5 }];
  card.atk = 4000;
  placeFieldCards(state.bot.field, card);
  state.bot.specialSummonRestrictions = [{ allowedFilters: { archetype: "Tech-Zero" }, duration: "until_end_turn", expiresOnTurn: 5,
    reason: null, sourceName: null, sourceId: null, effectId: null }];
  state.bot.effectActivationRestrictions = [{ blockedNames: ["probe"], duration: "until_end_turn", expiresOnTurn: 5,
    allowedAttributes: [], restrictedCardFilters: {}, reason: null, sourceName: null, sourceId: null, effectId: null }];
  state.turnCounter = 5;
  lifecycle.cleanupExpiredSimulatedTurnEffects(state);
  assert.equal(card.protectionEffects.length, 1);
  assert.equal(card.atk, 4000);
  assert.equal(state.bot.specialSummonRestrictions?.length, 1);
  state.turnCounter = 6;
  lifecycle.cleanupExpiredSimulatedTurnEffects(state);
  assert.deepEqual(card.protectionEffects, []);
  assert.equal(card.atk, 3200);
  assert.deepEqual(card.turnBasedBuffs, []);
  assert.deepEqual(state.bot.specialSummonRestrictions, []);
  assert.deepEqual(state.bot.effectActivationRestrictions, []);
});

test("granted protection checks faceup duration, source ownership and inclusive expiry", () => {
  assert.equal(typeof lifecycle.hasSimulatedProtection, "function");
  const { make } = fixture();
  const card = make(516);
  card.protectionEffects = [{ type: "effect_destruction", duration: "while_faceup", sourceOwner: "opponent" }];
  assert.equal(lifecycle.hasSimulatedProtection(card, "effect_destruction", 4, { ownerId: "bot", sourceOwnerId: "player" }), true);
  assert.equal(lifecycle.hasSimulatedProtection(card, "effect_destruction", 4, { ownerId: "bot", sourceOwnerId: "bot" }), false);
  card.isFacedown = true;
  assert.equal(lifecycle.hasSimulatedProtection(card, "effect_destruction", 4, { ownerId: "bot", sourceOwnerId: "player" }), false);
  card.protectionEffects = [{ type: "battle_destruction", duration: "end_of_next_turn", expiresOnTurn: 5 }];
  assert.equal(lifecycle.hasSimulatedProtection(card, "battle_destruction", 5), true);
  assert.equal(lifecycle.hasSimulatedProtection(card, "battle_destruction", 6), false);
});

for (const actor of ["player", "bot"] as const) {
  test(`public destruction and End Phase dispatch revive Phoenix with its exit mark (${actor})`, () => {
    const { state, make } = fixture(actor);
    const phoenix = make(514);
    placeFieldCards(state.bot.field, phoenix);
    const events: string[] = [];
    const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true,
      onSimulatedEvent(event: string) { events.push(event); } });
    applySimulatedActions({ state, actions: [{ type: "destroy", targetRef: "chosen" }], selections: { chosen: [phoenix] }, options });
    assert.equal(state.bot.field.includes(phoenix), false);
    assert.equal(state.bot.graveyard.includes(phoenix), true);
    assert.equal(state.delayedActions?.length, 1);
    const delayed = required(state.delayedActions?.[0]);
    assert.equal(delayed.actionType, "delayed_summon");
    assert.equal(delayed.payload.summons[0]?.card, phoenix);
    resolveSimulatedEndPhase(state, { chooseSpecialSummonPosition: () => "defense" });
    assert.equal(state.bot.field.includes(phoenix), true);
    assert.equal(phoenix.position, "defense");
    assert.equal(phoenix.banishWhenLeavesField, true);
    assert.deepEqual(state.delayedActions, []);
    assert.ok(events.includes("card_to_grave"));
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  for (const phaseOwner of ["self", "opponent"] as const) {
    test(`Phoenix heals its controller's recorded damage during ${phaseOwner} End Phase (${actor})`, () => {
      const { state, make } = fixture(actor);
      const phoenix = make(514);
      placeFieldCards(state.bot.field, phoenix);
      Object.assign(state.bot, { lp: 6500, damageReceivedThisTurn: 1500 });
      Object.assign(state.player, { lp: 7000, damageReceivedThisTurn: 1000 });
      state.turn = phaseOwner === "self" ? state.bot.id : state.player.id;
      resolveSimulatedEndPhase(state);
      assert.equal(state.bot.lp, 8000);
      assert.equal(state.player.lp, 7000);
    });
  }
}

for (const destruction of ["opponent", "self", "expired"] as const) {
  test(`Slasher's direct Synchro result handles ${destruction} effect destruction`, () => {
    const { state, make } = fixture();
    const multimodal = make(503);
    const slasher = make(510);
    const phoenix = make(514);
    placeFieldCards(state.bot.field, multimodal, slasher);
    state.bot.extraDeck.push(phoenix);
    applyGenericSimulatedMainPhaseAction(state, { type: "synchro", synchroInstanceId: required(phoenix.instanceId),
      materialInstanceIds: [required(multimodal.instanceId), required(slasher.instanceId)], position: "attack" }, { enableSimulatedEvents: true });
    assert.equal(state.bot.field.includes(phoenix), true);
    assert.equal(phoenix.protectionEffects?.length, 2);
    if (destruction === "expired") state.turnCounter += 2;
    applySimulatedActions({ state, selfId: destruction === "self" ? "bot" : "player", actions: [{ type: "destroy", targetRef: "chosen" }], selections: { chosen: [phoenix] } });
    assert.equal(state.bot.field.includes(phoenix), destruction === "opponent");
    assert.equal(state.bot.graveyard.includes(phoenix), destruction !== "opponent");
  });
}

test("context-valued healing resolves nested fields with zero and numeric modifiers", () => {
  const { state, make } = fixture();
  Object.assign(state.bot, { damageReceivedThisTurn: 1500 });
  state.bot.lp = 5000;
  applySimulatedActions({ state, actions: [{ type: "heal", amountFromContext: { key: "player.damageReceivedThisTurn", divideBy: 2, multiplier: 3 } }],
    options: { actionContext: { source: make(514), player: state.bot } } });
  assert.equal(state.bot.lp, 7250);
  Object.assign(state.bot, { damageReceivedThisTurn: 0 });
  applySimulatedActions({ state, actions: [{ type: "heal", amountFromContext: { key: "player.damageReceivedThisTurn" } }],
    options: { actionContext: { source: make(514), player: state.bot } } });
  assert.equal(state.bot.lp, 7250);
});
