import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { createCanonicalStateSnapshot, getCardDatabaseSignature, hashCanonicalGameState, validateCanonicalReplay } from "../src/core/game/replay/canonical.js";
import { CANONICAL_REPLAY_ENGINE_VERSION, CANONICAL_REPLAY_FORMAT, CANONICAL_REPLAY_SCHEMA_VERSION } from "../src/core/contracts/replay.js";
import { createPlanningCopy } from "../src/core/ai/common/planningCopy.js";
import { expireFaceupStatBuffs } from "../src/core/effects/actions/stats.js";
import { cleanupTempBoosts } from "../src/core/game/turn/cleanup.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

function setup(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
  t.after(() => game.dispose("stat_buff_serialization"));
  const card = new Card({ ...cardDefinition(501), effects: [] }, "player");
  placeFieldCards(game.player.field, card);
  card.atk += 300;
  card.permanentBuffsBySource = { source_runtime_1: { atk: 300, duration: "while_faceup" } };
  return { game, card };
}

test("canonical stat contributions distinguish expiry and discard runtime source keys", t => {
  const { game, card } = setup(t);
  const faceupHash = hashCanonicalGameState(game);
  card.permanentBuffsBySource = { unrelated_runtime_id: { atk: 300 } };
  assert.notEqual(hashCanonicalGameState(game), faceupHash);
  card.permanentBuffsBySource = { unrelated_runtime_id: { atk: 300, duration: "while_faceup" } };
  assert.equal(hashCanonicalGameState(game), faceupHash);
  card.permanentBuffsBySource = { z: { atk: 200 }, a: { atk: 100, def: -50, duration: "while_faceup" } };
  const first = hashCanonicalGameState(game);
  card.permanentBuffsBySource = { completely_different: { atk: 100, def: -50, duration: "while_faceup" }, other: { atk: 200 } };
  assert.equal(hashCanonicalGameState(game), first);
  const projected = required(createCanonicalStateSnapshot(game).players.player.zones.field[0]);
  assert.deepEqual(Reflect.get(projected, "statBuffContributions"), [
    { atk: 100, def: -50, duration: "while_faceup" }, { atk: 200, def: 0, duration: "until_field_exit" },
  ]);
});

test("zone stat snapshots detach nested contributions on capture and every restore", t => {
  const { game, card } = setup(t);
  const snapshot = game.captureZoneSnapshot("stat_buff_test");
  const stored = required(snapshot.cardState.get(card));
  const entry = required(card.permanentBuffsBySource?.source_runtime_1);
  entry.atk = 999;
  assert.equal(stored.permanentBuffsBySource?.source_runtime_1?.atk, 300);
  game.restoreZoneSnapshot(snapshot);
  assert.equal(card.permanentBuffsBySource?.source_runtime_1?.atk, 300);
  required(card.permanentBuffsBySource?.source_runtime_1).atk = 555;
  game.restoreZoneSnapshot(snapshot);
  assert.equal(card.permanentBuffsBySource?.source_runtime_1?.atk, 300);
  delete card.permanentBuffsBySource;
  const absent = game.captureZoneSnapshot("before_stat_buff");
  card.permanentBuffsBySource = { later: { atk: 400 } };
  game.restoreZoneSnapshot(absent);
  assert.equal(card.permanentBuffsBySource, undefined, "rollback also removes a ledger created after capture");
});

test("canonical snapshots and planning clones detach stat expiry metadata", t => {
  const { game, card } = setup(t);
  const snapshot = required(createCanonicalStateSnapshot(game).players.player.zones.field[0]);
  const clone = createPlanningCopy().cloneCardForSim(card);
  expireFaceupStatBuffs(clone);
  assert.equal(clone.atk, card.baseAtk);
  assert.equal(card.atk, card.baseAtk + 300);
  expireFaceupStatBuffs(card);
  assert.deepEqual(Reflect.get(snapshot, "statBuffContributions"), [{ atk: 300, def: 0, duration: "while_faceup" }]);
});

test("attack-limit duration affects canonical state and survives rollback", t => {
  const { game, card } = setup(t);
  card.attackLimitThisTurn = 3;
  card.attackLimitDuration = "while_faceup";
  const persistent = hashCanonicalGameState(game);
  const snapshot = game.captureZoneSnapshot("attack_limit");
  card.attackLimitDuration = "until_end_turn";
  assert.notEqual(hashCanonicalGameState(game), persistent);
  game.restoreZoneSnapshot(snapshot);
  assert.equal(card.attackLimitDuration, "while_faceup");
  assert.equal(hashCanonicalGameState(game), persistent);
  cleanupTempBoosts(game.player);
  assert.equal(card.attackLimitThisTurn, 3);
});

test("rollback restores turn status expiry after a later presence application", async t => {
  const { game, card } = setup(t);
  const originalPiercingGranted = card.piercingGrantedByEffect;
  const apply = (untilEndOfTurn: boolean) => game.effectEngine.applyActions([{
    type: "add_status", targetRef: "target", status: "piercing", value: true, ...(untilEndOfTurn ? { untilEndOfTurn } : {}),
  }], { player: game.player, opponent: game.bot, source: card }, { target: [card] });
  await apply(true);
  card.fieldExitStatuses.extraAttacks = 2;
  const snapshot = game.captureZoneSnapshot("temporary_status");
  await apply(false);
  card.fieldExitStatuses.extraAttacks = 99;
  assert.equal(Object.hasOwn(card.tempStatuses, "piercing"), false);
  game.restoreZoneSnapshot(snapshot);
  assert.equal(Object.hasOwn(card.tempStatuses, "piercing"), true);
  assert.equal(card.fieldExitStatuses.extraAttacks, 2);
  cleanupTempBoosts(game.player);
  assert.equal(card.piercing, false);
  assert.equal(card.piercingGrantedByEffect, originalPiercingGranted);
});

test("canonical replay validates optional stat contributions deeply", t => {
  const { game } = setup(t);
  const state = createCanonicalStateSnapshot(game);
  const replay = {
    format: CANONICAL_REPLAY_FORMAT, schemaVersion: CANONICAL_REPLAY_SCHEMA_VERSION,
    engineVersion: CANONICAL_REPLAY_ENGINE_VERSION, cardDatabaseSignature: getCardDatabaseSignature(),
    setup: { seed: 123, randomState: { seed: 123, state: 456, calls: 7 }, startingPlayer: "player",
      playerDeck: [], playerExtraDeck: [], botDeck: [], botExtraDeck: [] },
    commands: [], decisions: [], result: { finalState: state },
  };
  assert.doesNotThrow(() => validateCanonicalReplay(replay));
  const projected = required(state.players.player.zones.field[0]);
  for (const malformed of [null, {}, [{ atk: "300", def: 0, duration: "while_faceup" }],
    [{ atk: 300, def: 0, duration: "unknown" }], [{ atk: 300, def: "0", duration: "while_faceup" }],
    [{ atk: Number.POSITIVE_INFINITY, def: 0, duration: "while_faceup" }],
    [{ atk: 300, def: 0, duration: ["while_faceup"] }]]) {
    Reflect.set(projected, "statBuffContributions", malformed);
    assert.throws(() => validateCanonicalReplay(replay), /statBuffContributions/);
  }
  Reflect.deleteProperty(projected, "statBuffContributions");
  assert.doesNotThrow(() => validateCanonicalReplay(replay));
  for (const malformed of [null, { amount: "3", duration: "while_faceup" }, { amount: 3, duration: [] },
    { amount: Number.POSITIVE_INFINITY, duration: "while_faceup" }, { amount: 3, duration: Number.POSITIVE_INFINITY }]) {
    Reflect.set(projected.statuses, "attackLimit", malformed);
    assert.throws(() => validateCanonicalReplay(replay), /attackLimit/);
  }
  Reflect.deleteProperty(projected.statuses, "attackLimit");
  assert.doesNotThrow(() => validateCanonicalReplay(replay));
});
