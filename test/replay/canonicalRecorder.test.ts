import test from "node:test";
import assert from "node:assert/strict";

import type {
  ReplayRecorderGamePort,
  ReplayRuntimeCard,
  ReplayRuntimePlayer,
} from "../../src/core/contracts/replay.js";
import {
  createCanonicalStateSnapshot,
  getCardDatabaseSignature,
  hashCanonicalGameState,
  hashCanonicalValue,
  isReplayEvent,
  serializeReplayEventPayload,
  stableStringify,
  validateCanonicalReplay,
} from "../../src/core/game/replay/canonical.js";
import {
  captureReplaySetup,
  exportReplay,
  finalizeReplay,
  hasCanonicalReplay,
  recordReplayCommand,
  recordReplayDecision,
  recordReplayEvent,
  startReplayRecording,
} from "../../src/core/game/replay/recorder.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";

function player(id: "player" | "bot"): ReplayRuntimePlayer {
  return {
    id,
    lp: 8000,
    deck: [],
    extraDeck: [],
    hand: [],
    field: [],
    spellTrap: [],
    graveyard: [],
    banished: [],
    fieldSpell: null,
  };
}

function recorderGame(): ReplayRecorderGamePort {
  let nextDuelCardId = 1;
  return {
    randomSeed: 123,
    turn: "player",
    phase: "main1",
    turnCounter: 2,
    winner: null,
    player: player("player"),
    bot: player("bot"),
    getRandomState() {
      return { seed: 123, state: 456, calls: 7 };
    },
    ensureDuelCardId(card: ReplayRuntimeCard) {
      if (card.duelCardId == null) card.duelCardId = nextDuelCardId++;
      return card.duelCardId;
    },
    startReplayRecording,
    finalizeReplay,
  };
}

test("APIs canônicas preservam as aridades públicas", () => {
  assert.deepEqual(
    {
      stableStringify: stableStringify.length,
      hashCanonicalValue: hashCanonicalValue.length,
      createCanonicalStateSnapshot: createCanonicalStateSnapshot.length,
      validateCanonicalReplay: validateCanonicalReplay.length,
      serializeReplayEventPayload: serializeReplayEventPayload.length,
      isReplayEvent: isReplayEvent.length,
      replayCanonicalDuel: replayCanonicalDuel.length,
      startReplayRecording: startReplayRecording.length,
      captureReplaySetup: captureReplaySetup.length,
      recordReplayCommand: recordReplayCommand.length,
      recordReplayDecision: recordReplayDecision.length,
      recordReplayEvent: recordReplayEvent.length,
      finalizeReplay: finalizeReplay.length,
      exportReplay: exportReplay.length,
      hasCanonicalReplay: hasCanonicalReplay.length,
    },
    {
      stableStringify: 1,
      hashCanonicalValue: 1,
      createCanonicalStateSnapshot: 1,
      validateCanonicalReplay: 1,
      serializeReplayEventPayload: 2,
      isReplayEvent: 1,
      replayCanonicalDuel: 1,
      startReplayRecording: 0,
      captureReplaySetup: 0,
      recordReplayCommand: 0,
      recordReplayDecision: 0,
      recordReplayEvent: 2,
      finalizeReplay: 0,
      exportReplay: 0,
      hasCanonicalReplay: 0,
    },
  );
});

test("recorder preserva key order, defaults e assinatura do formato", () => {
  const game = recorderGame();
  const recording = startReplayRecording.call(game);

  assert.deepEqual(Object.keys(recording), [
    "format",
    "schemaVersion",
    "engineVersion",
    "cardDatabaseSignature",
    "setup",
    "commands",
    "decisions",
    "events",
    "result",
    "finalized",
  ]);
  assert.equal(recording.format, "shadow-duel-canonical-replay");
  assert.equal(recording.schemaVersion, 1);
  assert.equal(recording.engineVersion, "phase-9");
  assert.equal(recording.cardDatabaseSignature, getCardDatabaseSignature());
  assert.equal(recording.cardDatabaseSignature, "1cc622e3");
  assert.deepEqual(Object.keys(recording.setup), [
    "seed",
    "randomState",
    "startingPlayer",
    "playerDeck",
    "playerExtraDeck",
    "botDeck",
    "botExtraDeck",
  ]);
  assert.equal(hasCanonicalReplay.call(game), true);
});

test("gates de captura impedem setup, comandos, decisões e eventos quando desabilitados", () => {
  const game = recorderGame();
  startReplayRecording.call(game, { enabled: false });

  assert.equal(captureReplaySetup.call(game), null);
  assert.equal(recordReplayCommand.call(game, { type: "noop", payload: {} }), null);
  assert.equal(recordReplayDecision.call(game, { kind: "chain_response" }), null);
  assert.equal(recordReplayEvent.call(game, "chain_cleanup", {}), null);
  assert.equal(game._canonicalReplay?.commands.length, 0);
  assert.equal(game._canonicalReplay?.decisions.length, 0);
  assert.equal(game._canonicalReplay?.events.length, 0);
});

test("setup captura Decks com duelCardId e comandos preservam defaults permissivos", () => {
  const game = recorderGame();
  game.player?.deck.push({ id: 1 });
  game.player?.extraDeck.push({ id: 101 });
  game.bot?.deck.push({ id: 2 });
  game.bot?.extraDeck.push({ id: 102 });
  startReplayRecording.call(game);

  const captured = captureReplaySetup.call(game);
  assert.deepEqual(captured, {
    seed: 123,
    randomState: { seed: 123, state: 456, calls: 7 },
    startingPlayer: "player",
    playerDeck: [{ id: 1, duelCardId: 1 }],
    playerExtraDeck: [{ id: 101, duelCardId: 2 }],
    botDeck: [{ id: 2, duelCardId: 3 }],
    botExtraDeck: [{ id: 102, duelCardId: 4 }],
  });

  const command = recordReplayCommand.call(game);
  assert.equal(command?.sequence, 1);
  assert.equal(command?.type, "unknown");
  assert.equal(command?.actorId, null);
  assert.deepEqual(command?.payload, {});
  assert.match(command?.stateHash ?? "", /^[0-9a-f]{8}$/);

  const decision = recordReplayDecision.call(game);
  assert.deepEqual(decision, { sequence: 1 });
});

test("eventos usam whitelist, sequência e payload serializado", () => {
  const game = recorderGame();
  startReplayRecording.call(game);

  assert.equal(recordReplayEvent.call(game, "not_canonical", {}), null);
  const entry = recordReplayEvent.call(game, "chain_cleanup", {
    amount: Number.NaN,
    ignored: undefined,
  });
  assert.deepEqual(entry, {
    sequence: 1,
    event: "chain_cleanup",
    turn: 2,
    phase: "main1",
    payload: { amount: null },
  });
  assert.deepEqual(recordReplayEvent.call(game, "chain_cleanup", undefined), {
    sequence: 2,
    event: "chain_cleanup",
    turn: 2,
    phase: "main1",
    payload: null,
  });
});

test("finalização e export sem download preservam key order do resultado", () => {
  const game = recorderGame();
  startReplayRecording.call(game);
  const recording = finalizeReplay.call(game, { reason: "test" });

  assert.equal(recording?.finalized, true);
  assert.deepEqual(Object.keys(recording?.result ?? {}), [
    "winner",
    "reason",
    "finalStateHash",
    "finalState",
  ]);
  assert.equal(recording?.result?.winner, null);
  assert.equal(recording?.result?.reason, "test");
  assert.equal(recording?.result?.finalStateHash, hashCanonicalGameState(game));
  assert.strictEqual(exportReplay.call(game, { download: false }), recording);
});
