import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { createPlanningCopy } from "../src/core/ai/common/planningCopy.js";
import { moveCardToZone } from "../src/core/ai/common/zones.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "./helpers/game.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { applyGenericSimulatedMainPhaseAction, attachSimulatedEventEmitter, resolveSimulatedEndPhase } from "../src/core/ai/common/simulation.js";
import { processSimulatedDelayedActions } from "../src/core/ai/common/simulatedActions/lifecycle.js";
import { simulateMainPhaseAction as simulateDragonAction } from "../src/core/ai/dragon/simulation.js";
import { isFieldPresenceSummonAttackRestricted } from "../src/core/game/combat/availability.js";
import { fingerprintPlanningState } from "../src/core/ai/common/stateFingerprint.js";
import { createGameTreeCopy } from "../src/core/ai/common/gameTreeSimulation.js";
import { evaluateTechZeroVisibleBattle } from "../src/core/ai/techzero/battle.js";
import { turnLineSearch } from "../src/core/ai/TurnLineSearch.js";
import Bot from "../src/core/Bot.js";
import Player from "../src/core/Player.js";
import { recordFieldPresenceSummon } from "../src/core/effects/triggers/counters.js";
import type { SummonMethod } from "../src/core/contracts/summon.js";
import type { EffectOwner } from "../src/core/contracts/effects.js";

function setup() {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, disableChains: true });
  game.disablePresentationDelays = true;
  game.turn = "player";
  game.turnCounter = 2;
  game.phase = "battle";
  game.player.controllerType = "ai";
  game.bot.controllerType = "ai";
  return game;
}

async function summon(game: RuntimeGame, id: number, ownerId: "player" | "bot") {
  const owner = game[ownerId];
  const card = new Card(cardDefinition(id), owner.id);
  return summonCard(game, card, ownerId);
}

async function summonCard(game: RuntimeGame, card: Card, ownerId: "player" | "bot") {
  const owner = game[ownerId];
  owner.hand.push(card);
  await game.moveCard(card, owner, "field", {
    fromZone: "hand", summonMethodOverride: "special", position: "attack", summonOrigin: "effect_resolution",
  });
  assert.ok(owner.field.includes(card), "the public summon flow must put the card on the field");
  return card;
}

function restrictionSource(ownerId: "player" | "bot") {
  return new Card({ id: 9001, name: "Presence restriction fixture", cardKind: "monster", type: "Dragon", level: 4, atk: 100, def: 100,
    effects: [{ id: "fixture_presence_restriction", timing: "passive", passive: { type: "restrict_opponent_summon_turn_attack" } }],
  }, ownerId);
}

test("a Set is not a summon; a later successful Flip Summon acquires history", async t => {
  const game = setup();
  t.after(() => game.dispose("field_presence_flip_test"));
  const source = await summonCard(game, restrictionSource("bot"), "bot");
  const target = new Card({ ...cardDefinition(252), level: 4 }, "player");
  game.player.hand.push(target);
  await game.moveCard(target, game.player, "field", { fromZone: "hand", summonMode: "set", summonMethodOverride: "normal", summonOrigin: "procedure", isFacedown: true, position: "defense" });
  assert.deepEqual(source.fieldPresenceSummons, []);
  game.turnCounter = 3;
  game.phase = "main1";
  assert.equal((await game.flipSummon(target)).success, true);
  assert.equal(game.getAttackAvailability(target).ok, false);
});

for (const mode of ["common", "dragon"] as const) {
  test(`${mode} simulation keeps Sets separate from successful Flip Summons`, () => {
    const source = simulationCard(restrictionSource("player"));
    source.isFacedown = false;
    const target = simulationCard(new Card({ ...cardDefinition(252), level: 4 }, "bot"));
    const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 2, _isPerspectiveState: true,
      player: { field: [source] }, bot: { hand: [target] } });
    const setAction = { type: "summon" as const, cardId: target.id!, index: 0, position: "defense" as const, facedown: true };
    if (mode === "common") applyGenericSimulatedMainPhaseAction(state, setAction);
    else simulateDragonAction(state, setAction);
    const placed = required(state.bot.field[0]);
    assert.equal(isFieldPresenceSummonAttackRestricted(placed, state.player.field, 2), false);
    state.turnCounter = 3;
    const flipAction = { type: "position_change" as const, cardId: target.id!, cardName: target.name!, fieldIndex: 0, toPosition: "attack" as const };
    if (mode === "common") applyGenericSimulatedMainPhaseAction(state, flipAction);
    else simulateDragonAction(state, flipAction);
    assert.equal(placed.isFacedown, false);
    assert.equal(isFieldPresenceSummonAttackRestricted(placed, state.player.field, 3), true);
  });
}

test("face-down and field departure end source history; a new face-up presence starts empty", async t => {
  const game = setup();
  t.after(() => game.dispose("field_presence_lifecycle_test"));
  const source = await summonCard(game, restrictionSource("bot"), "bot");
  const attacker = await summon(game, 252, "player");
  const context = { player: game.player, opponent: game.bot, source: attacker };
  assert.equal(game.getAttackAvailability(attacker).ok, false);
  await game.effectEngine.applyActions([{ type: "switch_position", targetRef: "source" }], context, { source: [source] });
  assert.equal(game.getAttackAvailability(attacker).ok, false, "ordinary position changes preserve face-up presence");
  await game.effectEngine.applyActions([{ type: "set_facedown_defense", targetRef: "source" }], context, { source: [source] });
  assert.equal(game.getAttackAvailability(attacker).ok, true);
  await game.effectEngine.applyActions([{ type: "switch_position", targetRef: "source" }], context, { source: [source] });
  assert.equal(source.isFacedown, false);
  assert.equal(game.getAttackAvailability(attacker).ok, true, "turning face-up must not resurrect old history");
  const later = await summon(game, 252, "player");
  assert.equal(game.getAttackAvailability(later).ok, false);
  await game.moveCard(source, game.bot, "hand", { fromZone: "field" });
  assert.equal(game.getAttackAvailability(later).ok, true);
  await game.moveCard(source, game.bot, "field", { fromZone: "hand", summonMethodOverride: "special", position: "attack", summonOrigin: "effect_resolution" });
  assert.equal(game.getAttackAvailability(later).ok, true);
  const final = await summon(game, 252, "player");
  assert.equal(game.getAttackAvailability(final).ok, false);
  game.cleanupTempBoosts(game.bot);
  assert.equal(source.fieldPresenceSummons.length, 0, "end-turn cleanup removes the expired facts");
});

test("control changes exclude a target even after control returns; independent sources retain their own histories", async t => {
  const game = setup();
  t.after(() => game.dispose("field_presence_control_test"));
  const first = await summonCard(game, restrictionSource("bot"), "bot");
  const oldTarget = await summon(game, 252, "player");
  const second = await summonCard(game, restrictionSource("bot"), "bot");
  const sharedTarget = await summon(game, 252, "player");
  first.effectsNegated = true;
  assert.equal(game.getAttackAvailability(oldTarget).ok, true);
  assert.equal(game.getAttackAvailability(sharedTarget).ok, false, "the second source remains active");
  const presence = sharedTarget.fieldPresenceId;
  assert.equal((await game.transferControl(sharedTarget, game.bot)).success, true);
  assert.equal((await game.transferControl(sharedTarget, game.player)).success, true);
  assert.equal(sharedTarget.fieldPresenceId, presence);
  first.effectsNegated = false;
  assert.equal(game.getAttackAvailability(sharedTarget).ok, true, "returning control does not restore any source's old record");
  assert.equal(game.getAttackAvailability(oldTarget).ok, false);
  await game.moveCard(oldTarget, game.player, "hand", { fromZone: "field" });
  await game.moveCard(oldTarget, game.player, "field", { fromZone: "hand", summonMethodOverride: "special", position: "attack", summonOrigin: "effect_resolution" });
  assert.equal(game.getAttackAvailability(oldTarget).ok, false, "a fresh successful summon creates a new restriction");
  assert.equal(second.fieldPresenceSummons.some(record => record.targetFieldPresenceId === oldTarget.fieldPresenceId), true);
});

for (const simulation of ["common", "dragon"] as const) {
  test(`${simulation} simulation records successful summons under negated sources without aliasing runtime history`, async t => {
    const game = setup();
    t.after(() => game.dispose("simulated_field_presence_test"));
    const source = await summonCard(game, restrictionSource("player"), "player");
    source.effectsNegated = true;
    const incoming = new Card({ ...cardDefinition(252), level: 4 }, "bot");
    game.bot.hand.push(incoming);
    const copy = createPlanningCopy();
    const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 2, _isPerspectiveState: true,
      player: { field: game.player.field.map(copy.cloneCardForSim) }, bot: { hand: game.bot.hand.map(copy.cloneCardForSim) } });
    if (simulation === "common") applyGenericSimulatedMainPhaseAction(state, { type: "summon", index: 0, cardId: incoming.id });
    else simulateDragonAction(state, { type: "summon", index: 0 });
    const simulatedSource = required(state.player.field[0]);
    const summoned = required(state.bot.field[0]);
    assert.equal(isFieldPresenceSummonAttackRestricted(summoned, state.player.field, 2), false);
    simulatedSource.effectsNegated = false;
    assert.equal(isFieldPresenceSummonAttackRestricted(summoned, state.player.field, 2), true);
    assert.deepEqual(source.fieldPresenceSummons, []);
    const changed = fingerprintPlanningState(state);
    simulatedSource.fieldPresenceSummons = [];
    assert.notEqual(fingerprintPlanningState(state), changed, "history affects planning deduplication");
  });
}

test("simulated negation, control, face changes and cleanup preserve the same history rules", () => {
  const source = simulationCard(restrictionSource("player"));
  source.isFacedown = false;
  const incoming = simulationCard(new Card({ ...cardDefinition(252), level: 4 }, "bot"));
  const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 2, _isPerspectiveState: true,
    player: { field: [source] }, bot: { hand: [incoming] } });
  applyGenericSimulatedMainPhaseAction(state, { type: "summon", index: 0, cardId: incoming.id });
  const target = required(state.bot.field[0]);
  const locked = () => isFieldPresenceSummonAttackRestricted(target, state.player.field, 2);
  assert.equal(locked(), true);
  applySimulatedActions({ state, actions: [{ type: "add_status", targetRef: "source", status: "effectsNegated" }], selections: { source: [source] } });
  assert.equal(locked(), false);
  applySimulatedActions({ state, actions: [{ type: "add_status", targetRef: "source", status: "effectsNegated", remove: true }], selections: { source: [source] } });
  assert.equal(locked(), true);
  assert.deepEqual(state._simUnsupportedActions || [], [], "these passives are queried dynamically and need no unsupported recalculation");
  applySimulatedActions({ state, selfId: "player", actions: [{ type: "take_control", targetRef: "target" }], selections: { target: [target] } });
  applySimulatedActions({ state, selfId: "bot", actions: [{ type: "take_control", targetRef: "target" }], selections: { target: [target] } });
  assert.equal(locked(), false);
  assert.ok(state.bot.field.includes(target));
  const next = simulationCard(new Card({ ...cardDefinition(252), level: 4 }, "bot"));
  state.bot.hand.push(next);
  applySimulatedActions({ state, selfId: "bot", actions: [{ type: "special_summon_from_zone", zone: "hand", targetRef: "next", position: "attack" }], selections: { next: [next] } });
  assert.equal(isFieldPresenceSummonAttackRestricted(next, state.player.field, 2), true);
  applySimulatedActions({ state, actions: [{ type: "set_facedown_defense", targetRef: "source" }], selections: { source: [source] } });
  applySimulatedActions({ state, actions: [{ type: "switch_position", targetRef: "source" }], selections: { source: [source] } });
  assert.equal(isFieldPresenceSummonAttackRestricted(next, state.player.field, 2), false);
  resolveSimulatedEndPhase(state);
  assert.deepEqual(source.fieldPresenceSummons, []);
});

test("all planning copies isolate summon histories and planning fingerprints include their contents", async () => {
  const source = restrictionSource("bot");
  source.fieldPresenceSummons = [{ targetFieldPresenceId: "target-presence", summoningPlayerId: "player", turn: 2 }];
  source.fieldPresenceId = "source-presence";
  source.isFacedown = false;
  source.position = "defense";
  const bot = new Bot();
  const player = new Player("player", "Player");
  placeFieldCards(bot.field, source);
  const game = { bot, player, turn: "bot", phase: "main1", turnCounter: 2 };
  const copies = [
    createPlanningCopy().cloneCardForSim(source),
    required(createGameTreeCopy(game).state.bot.field[0]),
    required(bot.cloneGameState(game).bot.field[0]),
  ];
  for (const copy of copies) {
    assert.deepEqual(copy.fieldPresenceSummons, source.fieldPresenceSummons);
    required(copy.fieldPresenceSummons?.[0]).turn = 3;
    assert.equal(source.fieldPresenceSummons[0]?.turn, 2);
  }
  let inspectedTurnLine = false;
  await turnLineSearch(game, {
    bot, generateMainPhaseActions: () => [{ type: "position_change", fieldIndex: 0, toPosition: "attack" }],
    simulateMainPhaseAction(copy) {
      const clonedSource = required(copy.bot.field[0]);
      assert.deepEqual(clonedSource.fieldPresenceSummons, source.fieldPresenceSummons);
      required(clonedSource.fieldPresenceSummons?.[0]).turn = 3;
      inspectedTurnLine = true;
    },
    evaluateBoard: copy => copy.bot.field[0]?.fieldPresenceSummons?.[0]?.turn === 3 ? 100 : 0,
  }, { maxDepth: 1, nodeBudget: 5 });
  assert.equal(inspectedTurnLine, true);
  assert.equal(source.fieldPresenceSummons[0]?.turn, 2);
});

test("summon history follows the event's actor and attack queries also require that actor to control the target", () => {
  const source = simulationCard(restrictionSource("player"));
  source.isFacedown = false;
  const target = simulationCard(new Card({ ...cardDefinition(252), effects: [] }, "player"));
  target.fieldPresenceId = "opponent-summoned-on-this-side";
  target.isFacedown = false;
  const state = simulationState({ turnCounter: 2, player: { field: [source, target] } });
  recordFieldPresenceSummon(state, { card: target, player: state.bot });
  assert.deepEqual(source.fieldPresenceSummons, [{ targetFieldPresenceId: target.fieldPresenceId, summoningPlayerId: "bot", turn: 2 }]);
  assert.equal(isFieldPresenceSummonAttackRestricted(target, [source], 2), false);
  target.owner = "bot";
  target.controller = "bot";
  assert.equal(isFieldPresenceSummonAttackRestricted(target, [source], 2), true);
});

test("battle projections reject a recorded summon and unlock it after an earlier attack removes the source", async () => {
  const source = simulationCard(restrictionSource("player"));
  source.isFacedown = false;
  source.position = "attack";
  source.fieldPresenceSummons = [{ targetFieldPresenceId: "newcomer", summoningPlayerId: "bot", turn: 2 }];
  const attacker = simulationCard(new Card({ id: 9002, name: "Newcomer", cardKind: "monster", atk: 2000, def: 0 }, "bot"));
  attacker.fieldPresenceId = "newcomer";
  attacker.position = "attack";
  attacker.isFacedown = false;
  const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 2, _isPerspectiveState: true,
    bot: { field: [attacker] }, player: { field: [source], lp: 1500 } });
  assert.equal(evaluateTechZeroVisibleBattle(state.bot, state.player, 2).attacks.length, 0);
  const blocked = await turnLineSearch({ player: state.player, bot: state.bot, turn: state.turn, phase: state.phase, turnCounter: state.turnCounter, _isPerspectiveState: true }, {
    generateMainPhaseActions: () => [], simulateMainPhaseAction: () => undefined,
    evaluateBoard: snapshot => 8000 - (snapshot.player?.lp || 0),
  }, { turnMode: "mainBattleMain2", maxDepth: 1, battleStepLimit: 2 });
  assert.equal(blocked?.finalState.player.lp ?? 1500, 1500);
  const earlier = simulationCard(new Card({ id: 9003, name: "Earlier", cardKind: "monster", atk: 500, def: 0 }, "bot"));
  earlier.isFacedown = false;
  earlier.position = "attack";
  placeFieldCards(state.bot.field, earlier);
  const released = evaluateTechZeroVisibleBattle(state.bot, state.player, 2);
  assert.equal(released.attacks[0]?.attackerInstanceId, earlier.instanceId);
  assert.equal(released.attacks[1]?.attackerInstanceId, attacker.instanceId);
  assert.equal(released.lethal, true);
});

for (const attackerId of ["player", "bot"] as const) {
  const sourceId = attackerId === "player" ? "bot" : "player";
  test(`Mist only restricts summons during its current face-up presence (${attackerId})`, async t => {
    const game = setup();
    t.after(() => game.dispose("field_presence_passive_test"));
    const earlier = await summon(game, 252, attackerId);
    const mist = await summon(game, 272, sourceId);
    assert.equal(game.getAttackAvailability(earlier).ok, true, "a monster already on the field stays eligible");
    const later = await summon(game, 252, attackerId);
    assert.equal(game.getAttackAvailability(later).ok, false);
    assert.equal(later.cannotAttackThisTurn, false, "continuous restrictions do not become sticky card flags");
    assert.equal(game.getPublicState(attackerId).players.self.field.find(card => card?.duelCardId === later.duelCardId)?.status.cannotAttackThisTurn, true);
    mist.effectsNegated = true;
    assert.equal(game.getAttackAvailability(later).ok, true, "negation suspends the passive");
    const duringNegation = await summon(game, 252, attackerId);
    assert.equal(game.getAttackAvailability(duringNegation).ok, true);
    mist.effectsNegated = false;
    assert.equal(game.getAttackAvailability(later).ok, false);
    assert.equal(game.getAttackAvailability(duringNegation).ok, false, "presence history survives source negation");
    game.turnCounter++;
    assert.equal(game.getAttackAvailability(later).ok, true, "the restriction expires with its summon turn");
  });

  test(`Galaxy graveyard replacement stops under negation in runtime and simulation (${attackerId})`, async t => {
    for (const negated of [false, true]) {
      const game = setup();
      t.after(() => game.dispose("negated_graveyard_passive_test"));
      const source = new Card(cardDefinition(273), sourceId);
      source.isFacedown = false;
      source.effectsNegated = negated;
      placeFieldCards(game[sourceId].field, source);
      const incoming = new Card(cardDefinition(252), attackerId);
      game[attackerId].hand.push(incoming);
      const copy = createPlanningCopy();
      const state = simulationState({
        player: { field: game.player.field.map(copy.cloneCardForSim), hand: game.player.hand.map(copy.cloneCardForSim) },
        bot: { field: game.bot.field.map(copy.cloneCardForSim), hand: game.bot.hand.map(copy.cloneCardForSim) },
      });
      const simulatedIncoming = required(state[attackerId].hand[0]);
      await game.moveCard(incoming, game[attackerId], "graveyard", { fromZone: "hand" });
      assert.ok(game[attackerId][negated ? "graveyard" : "banished"].includes(incoming));
      assert.equal(moveCardToZone(state[attackerId], simulatedIncoming, "graveyard", state[attackerId], { state }), true);
      assert.ok(state[attackerId][negated ? "graveyard" : "banished"].includes(simulatedIncoming));
    }
  });
}

function metalRuntime(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, randomSeed: 253, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose("metal_field_presence_test"));
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = game.bot.controllerType = "ai";
  game.turn = "player";
  game.phase = "main1";
  game.turnCounter = 3;
  return game;
}

async function metalSource(game: RuntimeGame, seat: "player" | "bot", countOwner?: EffectOwner | null) {
  const card = new Card(countOwner === undefined ? cardDefinition(253) : { ...cardDefinition(253), effects: [{
    id: "generic_presence_counter_fixture", timing: "passive", passive: {
      type: "field_presence_type_summon_count_buff", typeName: "Dragon", amountPerCard: 100,
      summonMethods: ["special"], stats: ["atk", "def"], ...(countOwner === null ? {} : { countOwner }),
    },
  }] }, seat);
  game[seat].extraDeck.push(card);
  await game.moveCard(card, game[seat], "field", {
    fromZone: "extraDeck", summonMethodOverride: "ascension", position: "defense", summonOrigin: "effect_resolution",
  });
  assert.ok(game[seat].field.includes(card));
  return card;
}

async function metalIncoming(game: RuntimeGame, seat: "player" | "bot", method: SummonMethod = "special", type = "Dragon") {
  const card = new Card({ ...cardDefinition(252), effects: [], type }, seat);
  const owner = game[seat];
  owner.hand.push(card);
  if (method === "special") await game.performSpecialSummon(owner.hand.indexOf(card), "attack", owner);
  else await game.moveCard(card, owner, "field", {
    fromZone: "hand", summonMethodOverride: method, position: "attack", summonOrigin: "effect_resolution",
  });
  assert.ok(owner.field.includes(card));
  return card;
}

function assertMetalGrowth(source: Card, count: number) {
  assert.equal(source.fieldPresenceState?.summon_count_Dragon ?? 0, count);
  assert.equal(source.atk, 1600 + count * 100);
  assert.equal(source.def, 2000 + count * 100);
}

for (const seat of ["player", "bot"] as const) {
  const other = seat === "player" ? "bot" : "player";
  test(`Metal counts both controllers' completed Special Summons (${seat})`, async t => {
    const game = metalRuntime(t);
    const source = await metalSource(game, seat);
    assertMetalGrowth(source, 0);
    await metalIncoming(game, seat);
    assertMetalGrowth(source, 1);
    await metalIncoming(game, other);
    assertMetalGrowth(source, 2);
  });

  test(`Metal preserves negated, face-down and transferred history but resets on reentry (${seat})`, async t => {
    const game = metalRuntime(t);
    const source = await metalSource(game, seat, "any");
    const presence = source.fieldPresenceId;
    await metalIncoming(game, seat);
    source.effectsNegated = true;
    game.effectEngine.updatePassiveBuffs();
    await metalIncoming(game, other);
    assert.equal(source.fieldPresenceState?.summon_count_Dragon, 2);
    assert.equal(source.atk, 1600);
    source.effectsNegated = false;
    game.effectEngine.updatePassiveBuffs();
    assertMetalGrowth(source, 2);
    const context = { source, player: game[seat], opponent: game[other] };
    await game.effectEngine.applyActions([{ type: "set_facedown_defense", targetRef: "source" }], context, { source: [source] });
    await metalIncoming(game, other);
    assert.equal(source.fieldPresenceState?.summon_count_Dragon, 2);
    await game.effectEngine.applyActions([{ type: "switch_position", targetRef: "source" }], context, { source: [source] });
    game.effectEngine.updatePassiveBuffs();
    assertMetalGrowth(source, 2);
    assert.equal((await game.transferControl(source, game[other])).success, true);
    assert.equal(source.fieldPresenceId, presence);
    await metalIncoming(game, seat);
    assertMetalGrowth(source, 3);
    await game.moveCard(source, game[other], "graveyard", { fromZone: "field" });
    assert.equal(source.fieldPresenceState, null);
    await game.moveCard(source, game[other], "field", {
      fromZone: "graveyard", summonMethodOverride: "special", position: "attack", summonOrigin: "effect_resolution",
    });
    assert.notEqual(source.fieldPresenceId, presence);
    assertMetalGrowth(source, 0);
    await metalIncoming(game, seat);
    assertMetalGrowth(source, 1);
  });
}

test("Metal sources count independently and exclude only their own entry", async t => {
  const game = metalRuntime(t);
  const first = await metalSource(game, "player", "both");
  const second = await metalSource(game, "bot", "any");
  assertMetalGrowth(first, 1);
  assertMetalGrowth(second, 0);
  await metalIncoming(game, "bot");
  assertMetalGrowth(first, 2);
  assertMetalGrowth(second, 1);
});

for (const method of ["special", "ascension", "fusion", "synchro"] as const) {
  test(`Metal counts each completed ${method} Dragon once`, async t => {
    const game = metalRuntime(t);
    const source = await metalSource(game, "player", "any");
    await metalIncoming(game, "bot", method);
    assertMetalGrowth(source, 1);
    game.effectEngine.updatePassiveBuffs();
    game.effectEngine.updatePassiveBuffs();
    assertMetalGrowth(source, 1);
  });
}

test("Metal ignores Normal/Flip Summons, other types and uncommitted payloads", async t => {
  const game = metalRuntime(t);
  const source = await metalSource(game, "player", "any");
  await metalIncoming(game, "bot", "normal");
  await metalIncoming(game, "bot", "flip");
  await metalIncoming(game, "bot", "special", "Warrior");
  const missing = new Card({ ...cardDefinition(252), effects: [] }, "player");
  missing.fieldPresenceId = "uncommitted_presence";
  await game.emit("after_summon", { card: missing, player: game.player, method: "special" });
  assertMetalGrowth(source, 0);
});

test("generic presence counters keep self/opponent defaults relative to their source controller", async t => {
  const game = metalRuntime(t);
  const self = await metalSource(game, "player", "self");
  const opponent = await metalSource(game, "player", "opponent");
  const defaultSelf = await metalSource(game, "player", null);
  const target = await metalIncoming(game, "player", "normal");
  assertMetalGrowth(self, 2);
  assertMetalGrowth(opponent, 0);
  assertMetalGrowth(defaultSelf, 0);
  await game.emit("after_summon", { card: target, player: game.bot, method: "special" });
  assertMetalGrowth(self, 2);
  assertMetalGrowth(opponent, 1);
  assertMetalGrowth(defaultSelf, 0);
  await game.emit("after_summon", { card: target, player: game.player, method: "special" });
  assertMetalGrowth(self, 3);
  assertMetalGrowth(opponent, 1);
  assertMetalGrowth(defaultSelf, 1);
});

function simulatedMetal(seat: "player" | "bot" = "player") {
  const source = simulationCard({ ...cardDefinition(253), instanceId: `metal-${seat}`,
    owner: seat, controller: seat, fieldPresenceId: `presence-metal-${seat}`,
    fieldPresenceState: {}, isFacedown: false, position: "defense" });
  const state = simulationState({ turn: "bot", phase: "main1", turnCounter: 3, _isPerspectiveState: true,
    [seat]: { field: [source] } });
  return { state, source };
}

function assertSimulatedMetalGrowth(source: ReturnType<typeof simulationCard>, count: number, active = true) {
  assert.equal(source.fieldPresenceState?.summon_count_Dragon ?? 0, count);
  assert.equal(source.atk, 1600 + (active ? count * 100 : 0));
  assert.equal(source.def, 2000 + (active ? count * 100 : 0));
}

for (const enabled of [false, true]) for (const seat of ["player", "bot"] as const) {
  test(`shared Metal counts a committed Special Summon once without depending on events (${seat}, ${enabled})`, () => {
    const { state, source } = simulatedMetal(seat);
    const incoming = simulationCard({ ...cardDefinition(252), effects: [], instanceId: "special-incoming" });
    state.bot.hand.push(incoming);
    const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: enabled });
    applySimulatedActions({ state, actions: [{ type: "special_summon_from_zone", zone: "hand", targetRef: "incoming" }],
      selections: { incoming: [incoming] }, options });
    assert.ok(state.bot.field.includes(incoming));
    assertSimulatedMetalGrowth(source, 1);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });
}

for (const enabled of [false, true]) {
  for (const route of ["token", "conditional", "fusion", "synchro", "delayed"] as const) {
    test(`shared Metal observes the existing ${route} summon flow exactly once (events ${enabled})`, () => {
      const { state, source } = simulatedMetal();
      const options = attachSimulatedEventEmitter(state, { enableSimulatedEvents: enabled });
      if (route === "token") {
        applySimulatedActions({ state, actions: [{ type: "special_summon_token",
          token: { name: "Dragon token", type: "Dragon", level: 1, atk: 100, def: 100 } }], options });
        assert.equal(state.bot.field[0]?.isToken, true);
      } else if (route === "conditional") {
        const incoming = simulationCard({ ...cardDefinition(252), effects: [], instanceId: "conditional-incoming" });
        state.bot.hand.push(incoming);
        applySimulatedActions({ state, actions: [{ type: "conditional_summon_from_hand", targetRef: "incoming" }],
          selections: { incoming: [incoming] }, options });
        assert.ok(state.bot.field.includes(incoming));
      } else if (route === "fusion") {
        const material = simulationCard({ ...cardDefinition(252), effects: [], instanceId: "fusion-material" });
        const fusion = simulationCard({ id: 9101, name: "Dragon fusion fixture", cardKind: "monster", type: "Dragon",
          monsterType: "fusion", atk: 2000, def: 1500, level: 6, instanceId: "fusion-result", effects: [],
          fusionMaterials: [{ type: "Dragon", count: 1 }] });
        state.bot.hand.push(material); state.bot.extraDeck.push(fusion);
        applySimulatedActions({ state, actions: [{ type: "polymerization_fusion_summon" }], options });
        assert.ok(state.bot.field.includes(fusion)); assert.ok(state.bot.graveyard.includes(material));
      } else if (route === "synchro") {
        const tuner = simulationCard({ ...cardDefinition(501), effects: [], instanceId: "synchro-tuner", isFacedown: false });
        const other = simulationCard({ ...cardDefinition(502), effects: [], level: 2, instanceId: "synchro-other", isFacedown: false });
        const synchro = simulationCard({ ...cardDefinition(503), effects: [], type: "Dragon", instanceId: "synchro-result" });
        placeFieldCards(state.bot.field, tuner, other); state.bot.extraDeck.push(synchro);
        applyGenericSimulatedMainPhaseAction(state, { type: "synchro", synchroInstanceId: "synchro-result",
          materialInstanceIds: ["synchro-tuner", "synchro-other"], position: "attack" }, { enableSimulatedEvents: enabled });
        assert.ok(state.bot.field.includes(synchro)); assert.equal(state.bot.graveyard.length, 2);
      } else {
        const incoming = simulationCard({ ...cardDefinition(252), effects: [], instanceId: "delayed-incoming" });
        state.bot.hand.push(incoming);
        applySimulatedActions({ state, actions: [{ type: "schedule_special_summon", targetRef: "incoming",
          fromZone: "hand", phase: "standby", triggerPlayer: "opponent", summonMethod: "special" }],
          selections: { incoming: [incoming] }, options });
        assert.equal(state.delayedActions?.length, 1);
        processSimulatedDelayedActions(state, "standby", "bot", options);
        assertSimulatedMetalGrowth(source, 0);
        processSimulatedDelayedActions(state, "standby", "player", options);
        assert.ok(state.bot.field.includes(incoming));
        processSimulatedDelayedActions(state, "standby", "player", options);
      }
      assertSimulatedMetalGrowth(source, 1);
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }
}

for (const mode of ["common", "dragon"] as const) {
  test(`${mode} Metal counts an Ascension and excludes the arriving source's own entry`, () => {
    const { state, source } = simulatedMetal();
    const material = simulationCard({ ...cardDefinition(252), effects: [], instanceId: "ascension-material", isFacedown: false });
    const arriving = simulationCard({ ...cardDefinition(253), instanceId: "arriving-metal" });
    placeFieldCards(state.bot.field, material); state.bot.extraDeck.push(arriving);
    const action = { type: "ascension" as const, materialIndex: 0, ascensionCard: arriving };
    if (mode === "common") applyGenericSimulatedMainPhaseAction(state, action);
    else simulateDragonAction(state, action);
    const arrived = required(state.bot.field.find(card => card.instanceId === arriving.instanceId));
    assertSimulatedMetalGrowth(source, 1);
    assertSimulatedMetalGrowth(arrived, 0);
  });

  for (const rejected of ["normal", "set", "flip", "nondragon"] as const) {
    test(`${mode} Metal excludes ${rejected} entries from its counter`, () => {
      const { state, source } = simulatedMetal();
      const incoming = simulationCard({ ...cardDefinition(rejected === "nondragon" ? 255 : 252), effects: [],
        level: 4, instanceId: "excluded-incoming", type: rejected === "nondragon" ? "Warrior" : "Dragon" });
      if (rejected === "flip") {
        incoming.isFacedown = true; incoming.position = "defense"; incoming.fieldPresenceId = "set-presence";
        placeFieldCards(state.bot.field, incoming);
        const action = { type: "position_change" as const, cardId: incoming.id, cardName: incoming.name, fieldIndex: 0, toPosition: "attack" as const };
        if (mode === "common") applyGenericSimulatedMainPhaseAction(state, action);
        else simulateDragonAction(state, action);
        assert.equal(incoming.isFacedown, false);
      } else {
        state.bot.hand.push(incoming);
        if (rejected === "nondragon") {
          if (mode === "common") applySimulatedActions({ state, actions: [{ type: "special_summon_from_zone", zone: "hand", targetRef: "incoming" }],
            selections: { incoming: [incoming] } });
          else {
            placeFieldCards(state.bot.field, simulationCard({ ...cardDefinition(252), effects: [], isFacedown: false }));
            simulateDragonAction(state, { type: "handIgnition", index: 0 });
          }
        } else {
          const action = { type: "summon" as const, cardId: incoming.id, index: 0, ...(rejected === "set" ? { facedown: true, position: "defense" as const } : {}) };
          if (mode === "common") applyGenericSimulatedMainPhaseAction(state, action);
          else simulateDragonAction(state, action);
        }
        assert.ok(state.bot.field.some(card => card.instanceId === incoming.instanceId), "the excluded entry must still have completed");
      }
      assertSimulatedMetalGrowth(source, 0);
    });
  }
}

for (const sourceStatus of ["active", "negated", "facedown"] as const) {
  test(`Dragon Metal records a private Special Summon while its source is ${sourceStatus}`, () => {
    const { state, source } = simulatedMetal();
    source.effectsNegated = sourceStatus === "negated"; source.isFacedown = sourceStatus === "facedown";
    const incoming = simulationCard({ ...cardDefinition(255), effects: [], instanceId: "private-voltaic" });
    placeFieldCards(state.bot.field, simulationCard({ ...cardDefinition(252), effects: [], isFacedown: false }));
    state.bot.hand.push(incoming);
    simulateDragonAction(state, { type: "handIgnition", index: 0 });
    assert.ok(state.bot.field.some(card => card.instanceId === incoming.instanceId));
    assertSimulatedMetalGrowth(source, sourceStatus === "facedown" ? 0 : 1, sourceStatus === "active");
  });
}

test("Dragon Metal counts the existing private Polymerization Fusion flow once", () => {
  const { state, source } = simulatedMetal();
  const spell = simulationCard({ ...cardDefinition(12), instanceId: "private-polymerization" });
  const voltaic = simulationCard({ ...cardDefinition(255), effects: [], instanceId: "private-fusion-voltaic" });
  const luminous = simulationCard({ ...cardDefinition(251), effects: [], instanceId: "private-fusion-luminous" });
  const fusion = simulationCard({ ...cardDefinition(265), effects: [], instanceId: "private-fusion-result" });
  state.bot.hand.push(spell, voltaic, luminous); state.bot.extraDeck.push(fusion);
  state.bot.graveyard.push(simulationCard({ ...cardDefinition(252), effects: [], instanceId: "private-fusion-buff" }));
  state.player.lp = 2000;
  simulateDragonAction(state, { type: "spell", index: 0 });
  assert.ok(state.bot.field.some(card => card.instanceId === fusion.instanceId));
  assertSimulatedMetalGrowth(source, 1);
});
