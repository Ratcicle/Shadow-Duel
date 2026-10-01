import assert from "node:assert/strict";
import test from "node:test";
import Card from "../src/core/Card.js";
import { createPlanningCopy } from "../src/core/ai/common/planningCopy.js";
import { moveCardToZone } from "../src/core/ai/common/zones.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "./helpers/game.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { applyGenericSimulatedMainPhaseAction, resolveSimulatedEndPhase } from "../src/core/ai/common/simulation.js";
import { simulateMainPhaseAction as simulateDragonAction } from "../src/core/ai/dragon/simulation.js";
import { isFieldPresenceSummonAttackRestricted } from "../src/core/game/combat/availability.js";
import { fingerprintPlanningState } from "../src/core/ai/common/stateFingerprint.js";
import { createGameTreeCopy } from "../src/core/ai/common/gameTreeSimulation.js";
import { evaluateTechZeroVisibleBattle } from "../src/core/ai/techzero/battle.js";
import { turnLineSearch } from "../src/core/ai/TurnLineSearch.js";
import Bot from "../src/core/Bot.js";
import Player from "../src/core/Player.js";
import { recordFieldPresenceSummon } from "../src/core/effects/triggers/counters.js";

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
