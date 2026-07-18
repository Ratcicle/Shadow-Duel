import test from "node:test";
import assert from "node:assert/strict";

import Game from "../../src/core/Game.js";
import {
  getCardDatabaseSignature,
  isReplayEvent,
  validateCanonicalReplay,
} from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";

const deck = [1, 2, 3, 4, 5, 6, 7, 8];

async function initialize(game, startingPlayer = null) {
  await game.startWithDecks({
    exactDecks: true,
    initializeOnly: true,
    startAtDrawPhase: true,
    announceStartingPlayer: false,
    startingPlayer,
    playerDeck: deck,
    botDeck: deck,
    playerExtraDeck: [],
    botExtraDeck: [],
  });
}

test("a mesma seed reproduz jogador inicial, draws e shuffles", async () => {
  const first = new Game({ randomSeed: "same-seed", captureReplay: false });
  const second = new Game({ randomSeed: "same-seed", captureReplay: false });
  await initialize(first);
  await initialize(second);
  assert.equal(first.turn, second.turn);
  assert.deepEqual(
    first.player.hand.map((card) => card.id),
    second.player.hand.map((card) => card.id),
  );
  first.shuffle(first.player.deck);
  second.shuffle(second.player.deck);
  assert.deepEqual(
    first.player.deck.map((card) => card.id),
    second.player.deck.map((card) => card.id),
  );
  first.dispose();
  second.dispose();
});

test("replay canônico headless termina com o mesmo hash", async () => {
  const game = new Game({ randomSeed: 123, captureReplay: true });
  await initialize(game, "player");
  game.phase = "main1";
  game.recordReplayCommand({
    type: "set_phase",
    actorId: "player",
    payload: { phase: "main1" },
  });
  game.player.lp = 7100;
  game.recordReplayCommand({
    type: "set_lp",
    actorId: "player",
    payload: { lp: 7100 },
  });
  const replay = JSON.parse(
    JSON.stringify(game.finalizeReplay({ reason: "test" })),
  );
  assert.equal(replay.format, "shadow-duel-canonical-replay");
  assert.equal(replay.schemaVersion, 1);
  assert.equal(replay.cardDatabaseSignature, getCardDatabaseSignature());

  const result = await replayCanonicalDuel(replay);
  assert.equal(result.ok, true);
  assert.equal(result.finalStateHash, replay.result.finalStateHash);
  game.dispose();
  result.game.dispose();
});

test("replay adulterado para na primeira divergência", async () => {
  const game = new Game({ randomSeed: 55, captureReplay: true });
  await initialize(game, "player");
  game.phase = "main1";
  game.recordReplayCommand({
    type: "set_phase",
    actorId: "player",
    payload: { phase: "main1" },
  });
  const replay = JSON.parse(JSON.stringify(game.finalizeReplay({ reason: "test" })));
  replay.commands[0].payload.phase = "end";
  await assert.rejects(
    () => replayCanonicalDuel(replay),
    /Replay divergence at command 1/,
  );
  game.dispose();
});

test("banco incompatível e relatórios v4 são rejeitados explicitamente", () => {
  assert.throws(
    () =>
      validateCanonicalReplay({
        format: "shadow-duel-canonical-replay",
        schemaVersion: 1,
        cardDatabaseSignature: "tampered",
        setup: {},
        commands: [],
        decisions: [],
      }),
    /database signature/,
  );
  assert.throws(
    () => validateCanonicalReplay({ reportVersion: 4 }),
    /Unsupported replay format.*version 4/,
  );
});

test("playback remapeia seleções por duelCardId sem reutilizar chaves globais", async () => {
  const recording = new Game({ randomSeed: 91, captureReplay: true });
  await initialize(recording, "player");
  const recordedCandidates = recording.player.hand.slice(0, 2).map((card) => ({
    key: `recording-${card.instanceId}`,
    cardRef: card,
    controller: "player",
    zone: "hand",
  }));
  let recordedSelection = null;
  recording.startTargetSelectionSession({
    kind: "target",
    owner: recording.player,
    selectionContract: {
      kind: "target",
      ui: { useFieldTargeting: false },
      requirements: [{
        id: "target",
        min: 1,
        max: 1,
        zones: ["hand"],
        candidates: recordedCandidates,
      }],
    },
    execute: async (selections) => {
      recordedSelection = selections;
      return { success: true, needsSelection: false };
    },
  });
  recording.targetSelection.selections = {
    target: [recordedCandidates[0].key],
  };
  await recording.finishTargetSelection();
  assert.equal(recordedSelection.target[0], recordedCandidates[0].key);
  const decision = structuredClone(recording._canonicalReplay.decisions[0]);
  assert.equal(
    decision.value.selections.target[0].duelCardId,
    recording.player.hand[0].duelCardId,
  );
  assert.equal(decision.value.selections.target[0].key, null);

  const playback = new Game({
    randomSeed: 91,
    captureReplay: false,
    replayMode: "playback",
  });
  await initialize(playback, "player");
  playback.decisionBroker.loadReplayDecisions([decision]);
  const playbackCandidates = playback.player.hand.slice(0, 2).map((card) => ({
    key: `playback-${card.instanceId}`,
    cardRef: card,
    controller: "player",
    zone: "hand",
  }));
  let playbackSelection = null;
  await playback.startTargetSelectionSession({
    kind: "target",
    owner: playback.player,
    selectionContract: {
      kind: "target",
      ui: { useFieldTargeting: false },
      requirements: [{
        id: "target",
        min: 1,
        max: 1,
        zones: ["hand"],
        candidates: playbackCandidates,
      }],
    },
    execute: async (selections) => {
      playbackSelection = selections;
      return { success: true, needsSelection: false };
    },
  });
  assert.equal(playbackSelection.target[0], playbackCandidates[0].key);
  assert.notEqual(playbackCandidates[0].key, recordedCandidates[0].key);
  recording.dispose();
  playback.dispose();
});

test("trilha canônica cobre ativação, SEGOC, uso, resolução, Invocação e Damage Step", async () => {
  const game = new Game({ randomSeed: 18, captureReplay: true });
  await initialize(game, "player");
  const requiredEvents = [
    "activation_transaction",
    "fast_effect_priority",
    "segoc_order_selected",
    "effect_usage",
    "chain_link_resolution",
    "chain_finalization",
    "summon_transaction",
    "summon_cost_paid",
    "damage_step_timing",
    "card_moved",
    "chain_cleanup",
  ];
  for (const event of requiredEvents) {
    assert.equal(isReplayEvent(event), true, `${event} must be canonical`);
    game.notify(event, {
      chainId: 1,
      linkId: 1,
      summonId: 1,
      damageStepId: 1,
      stage: event,
    });
  }
  assert.deepEqual(
    game._canonicalReplay.events.map((entry) => entry.event),
    requiredEvents,
  );
  assert.doesNotThrow(() => JSON.stringify(game._canonicalReplay.events));
  game.dispose();
});
