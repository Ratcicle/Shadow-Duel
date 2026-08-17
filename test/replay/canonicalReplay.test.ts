import test from "node:test";
import assert from "node:assert/strict";

import Game from "../../src/core/Game.js";
import {
  getCardDatabaseSignature,
  hashCanonicalValue,
  isReplayEvent,
  validateCanonicalReplay,
} from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import type { PlayerId, SelectionCandidateKey } from "../../src/core/contracts/primitives.js";
import type { CanonicalReplayDecisionOf } from "../../src/core/contracts/replay.js";

const deck = [1, 2, 3, 4, 5, 6, 7, 8];

type GameInstance = InstanceType<typeof Game>;

async function initialize(game: GameInstance, startingPlayer: PlayerId | null = null) {
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

function selectionAt(value: unknown, requirementId: string, index: number): unknown {
  assert.ok(typeof value === "object" && value !== null);
  const selections = Reflect.get(value, requirementId);
  assert.ok(Array.isArray(selections));
  return selections[index];
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
  Reflect.apply(game.recordReplayCommand, game, [{
    type: "set_phase",
    actorId: "player",
    payload: { phase: "main1" },
  }]);
  game.player.lp = 7100;
  Reflect.apply(game.recordReplayCommand, game, [{
    type: "set_lp",
    actorId: "player",
    payload: { lp: 7100 },
  }]);
  const replay = JSON.parse(
    JSON.stringify(Reflect.apply(game.finalizeReplay, game, [{ reason: "test" }])),
  );
  assert.equal(replay.format, "shadow-duel-canonical-replay");
  assert.equal(replay.schemaVersion, 1);
  assert.equal(replay.cardDatabaseSignature, getCardDatabaseSignature());
  assert.deepEqual(
    replay.commands.map((command: { stateHash: string }) => command.stateHash),
    ["26771e66", "0339db06"],
  );
  assert.equal(replay.result.finalStateHash, "0339db06");
  assert.equal(hashCanonicalValue(replay), "fea9e5fc");
  assert.equal(JSON.stringify(replay).length, 8526);

  const result = await replayCanonicalDuel(replay);
  assert.equal(result.ok, true);
  assert.equal(result.finalStateHash, replay.result.finalStateHash);
  game.dispose();
  const disposePlayback = Reflect.get(result.game, "dispose");
  assert.ok(typeof disposePlayback === "function");
  Reflect.apply(disposePlayback, result.game, []);
});

test("replay adulterado para na primeira divergência", async () => {
  const game = new Game({ randomSeed: 55, captureReplay: true });
  await initialize(game, "player");
  game.phase = "main1";
  Reflect.apply(game.recordReplayCommand, game, [{
    type: "set_phase",
    actorId: "player",
    payload: { phase: "main1" },
  }]);
  const replay = JSON.parse(JSON.stringify(
    Reflect.apply(game.finalizeReplay, game, [{ reason: "test" }]),
  ));
  replay.commands[0].payload.phase = "end";
  await assert.rejects(() => replayCanonicalDuel(replay), (error: unknown) => {
    assert.ok(error instanceof Error);
    const divergence = error as Error & {
      sequence?: number;
      command?: { sequence: number; type: string };
      expectedHash?: string;
      observedHash?: string;
    };
    assert.match(divergence.message, /Replay divergence at command 1/);
    assert.equal(divergence.sequence, 1);
    assert.strictEqual(divergence.command, replay.commands[0]);
    assert.equal(divergence.command?.type, "set_phase");
    assert.equal(divergence.expectedHash, replay.commands[0].stateHash);
    assert.match(divergence.observedHash ?? "", /^[0-9a-f]{8}$/);
    assert.notEqual(divergence.observedHash, divergence.expectedHash);
    return true;
  });
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
  let recordedSelection: unknown = null;
  Reflect.apply(recording.startTargetSelectionSession, recording, [{
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
    execute: async (selections: unknown) => {
      recordedSelection = selections;
      return { success: true, needsSelection: false };
    },
  }]);
  const targetSelection = recording.targetSelection;
  assert.ok(targetSelection);
  targetSelection.selections = {
    target: [recordedCandidates[0].key as SelectionCandidateKey],
  };
  await Reflect.apply(recording.finishTargetSelection, recording, []);
  assert.equal(selectionAt(recordedSelection, "target", 0), recordedCandidates[0].key);
  const replayBuffer = recording._canonicalReplay;
  assert.ok(replayBuffer);
  const decision = structuredClone(
    replayBuffer.decisions[0],
  ) as CanonicalReplayDecisionOf<"target">;
  assert.ok("selections" in decision.value);
  const serializedTarget = decision.value.selections.target[0];
  assert.ok(serializedTarget && "duelCardId" in serializedTarget);
  assert.equal(
    serializedTarget.duelCardId,
    recording.player.hand[0].duelCardId,
  );
  assert.equal(serializedTarget.key, null);

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
  let playbackSelection: unknown = null;
  await Reflect.apply(playback.startTargetSelectionSession, playback, [{
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
    execute: async (selections: unknown) => {
      playbackSelection = selections;
      return { success: true, needsSelection: false };
    },
  }]);
  assert.equal(selectionAt(playbackSelection, "target", 0), playbackCandidates[0].key);
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
    Reflect.apply(game.notify, game, [event, {
      chainId: 1,
      linkId: 1,
      summonId: 1,
      damageStepId: 1,
      stage: event,
    }]);
  }
  const replayBuffer = game._canonicalReplay;
  assert.ok(replayBuffer);
  assert.deepEqual(
    replayBuffer.events.map((entry: { event: string }) => entry.event),
    requiredEvents,
  );
  assert.doesNotThrow(() => JSON.stringify(replayBuffer.events));
  game.dispose();
});
