import { required, unsafeFixture } from "../helpers/fixtures.js";
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
import type {
  PlayerId,
  SelectionCandidateKey,
} from "../../src/core/contracts/primitives.js";
import type { CanonicalReplayDecisionOf, ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import type { FieldPlacementResult } from "../../src/core/contracts/placement.js";
import type { ReplayDecisionInput } from "../../src/core/contracts/decisions.js";
import { createCanonicalStateSnapshot, hashCanonicalGameState } from "../../src/core/game/replay/canonical.js";

const deck = [1, 2, 3, 4, 5, 6, 7, 8];

type GameInstance = InstanceType<typeof Game>;

async function initialize(
  game: GameInstance,
  startingPlayer: PlayerId | null = null,
) {
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

for (const placement of [
  { outcome: "chosen", slot: 4 },
  { outcome: "chosen", slot: 0 },
  { outcome: "cancelled" },
] satisfies FieldPlacementResult[]) {
  test(`manual placement ${placement.outcome === "chosen" ? placement.slot : placement.outcome} replays headlessly without consulting local preference`, async (t) => {
    let prompts = 0;
    const game = new Game({
      randomSeed: 123, captureReplay: true, chainResponseTimeoutMs: 0,
      getFieldPlacementMode: () => "manual",
      fieldPlacementProvider: async (request) => {
        prompts++;
        assert.equal(request.allowCancel, true);
        return placement;
      },
    });
    t.after(() => game.dispose());
    await game.startWithDecks({ exactDecks: true, initializeOnly: true, startAtDrawPhase: true, announceStartingPlayer: false, startingPlayer: "player", playerDeck: Array(12).fill(1), botDeck: Array(12).fill(1), playerExtraDeck: [], botExtraDeck: [] });
    game.phase = "main1";
    game.recordReplayCommand({ type: "set_phase", actorId: "player", payload: { phase: "main1" } });
    const card = required(game.player.hand[0]);
    await game.performNormalSummon(game.player, 0, "attack", false);
    assert.equal(prompts, 1);
    assert.equal(card.fieldSlot, placement.outcome === "chosen" ? placement.slot : null);
    assert.equal(game.player.summonCount, placement.outcome === "chosen" ? 1 : 0);
    assert.equal(game.player.hand.includes(card), placement.outcome === "cancelled");
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(game.finalizeReplay({ reason: "placement-test" }))));
    assert.equal(replay.decisions.filter((decision) => decision.kind === "field_placement").length, 1);
    assert.equal(replay.commands.filter((command) => command.type === "summon").length, 1);
    const playback = new Game({ replayMode: "playback", captureReplay: false, chainResponseTimeoutMs: 0, getFieldPlacementMode: () => { throw new Error("Playback must not read local preferences."); } });
    t.after(() => playback.dispose());
    const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Replay driver uses a narrow player projection; this fixture passes only the real Game's own player/card instances.") });
    assert.equal(result.ok, true);
    assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.player.field[0]?.fieldSlot ?? null, placement.outcome === "chosen" ? placement.slot : null);
  });
}

test("D2 broker playback reproduces rule destruction, original graveyard and canonical positions", async (t) => {
  const decisions: ReplayDecisionInput[] = [];
  const live = new Game({ disableChains: true, captureReplay: false, randomSeed: 91, getFieldPlacementMode: () => "manual", fieldPlacementProvider: async () => ({ outcome: "chosen", slot: 4 }) });
  const playback = new Game({ disableChains: true, captureReplay: false, replayMode: "playback", randomSeed: 91, getFieldPlacementMode: () => { throw new Error("Replay must not consult local placement settings."); } });
  t.after(() => { live.dispose(); playback.dispose(); });
  live.on("decision_made", (decision) => { decisions.push(decision); });
  const run = async (game: Game) => {
    game.turnCounter = 7;
    game.applyScenarioSetup({ schemaVersion: 2, player: { hand: [{ id: 3 }] }, bot: { field: [4, 0, 1, 2, 3].map((fieldSlot) => ({ id: 1, fieldSlot })), hand: [{ id: 1 }] } });
    const borrowed = required(game.bot.field[0]);
    const source = required(game.player.hand[0]);
    await game.takeControl(borrowed, game.player, { duration: "until_end_phase", sourceCard: source });
    const pending = createCanonicalStateSnapshot(game);
    assert.equal(borrowed.fieldSlot, 4);
    await game.moveCard(required(game.bot.hand[0]), game.bot, "field", { fromZone: "hand", summonOrigin: "effect_resolution" });
    const causes: unknown[] = [];
    game.on("card_moved", (event) => { if (event.card === borrowed) causes.push(event.destroyCause); });
    await game.processTemporaryControlEffects();
    assert.deepEqual(causes, ["rule"]);
    assert.equal(game.player.field.length, 0);
    assert.deepEqual(game.bot.graveyard, [borrowed]);
    assert.equal(borrowed.fieldSlot, null);
    assert.equal(game.temporaryControlEffects.length, 0);
    return { pending, final: createCanonicalStateSnapshot(game), hash: hashCanonicalGameState(game) };
  };
  const expected = await run(live);
  assert.equal(decisions.filter((decision) => decision.kind === "field_placement").length, 2);
  playback.decisionBroker.loadReplayDecisions(decisions);
  const actual = await run(playback);
  assert.deepEqual(actual, expected);
  assert.equal(playback.decisionBroker.replayCursor, decisions.length);
});

test("canonical replay preserves fractional LP without changing its schema", async (t) => {
  const game = new Game({ randomSeed: 456, captureReplay: true });
  t.after(() => game.dispose());
  await initialize(game, "player");
  for (const lp of [1.5, 0.5, 0.25]) {
    game.player.lp = lp;
    Reflect.apply(game.recordReplayCommand, game, [{ type: "set_lp", actorId: "player", payload: { lp } }]);
  }
  const replay = JSON.parse(JSON.stringify(Reflect.apply(game.finalizeReplay, game, [{ reason: "test" }])));
  const result = await replayCanonicalDuel(replay);
  assert.equal(result.ok, true);
  assert.equal(result.game.player.lp, 0.25);
  assert.equal(result.finalStateHash, replay.result.finalStateHash);
  const dispose = Reflect.get(result.game, "dispose");
  assert.ok(typeof dispose === "function");
  Reflect.apply(dispose, result.game, []);
});

function selectionAt(
  value: unknown,
  requirementId: string,
  index: number,
): unknown {
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
  Reflect.apply(game.recordReplayCommand, game, [
    {
      type: "set_phase",
      actorId: "player",
      payload: { phase: "main1" },
    },
  ]);
  game.player.lp = 7100;
  Reflect.apply(game.recordReplayCommand, game, [
    {
      type: "set_lp",
      actorId: "player",
      payload: { lp: 7100 },
    },
  ]);
  const replay = JSON.parse(
    JSON.stringify(
      Reflect.apply(game.finalizeReplay, game, [{ reason: "test" }]),
    ),
  );
  assert.equal(replay.format, "shadow-duel-canonical-replay");
  assert.equal(replay.schemaVersion, 2);
  assert.equal(replay.cardDatabaseSignature, getCardDatabaseSignature());
  assert.deepEqual(
    replay.commands.map((command: { stateHash: string }) => command.stateHash),
    ["f2d08f36", "6dff35de"],
  );
  assert.equal(replay.result.finalStateHash, "6dff35de");
  assert.equal(hashCanonicalValue(replay), "29c1cb35");
  assert.equal(JSON.stringify(replay).length, 9044);

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
  Reflect.apply(game.recordReplayCommand, game, [
    {
      type: "set_phase",
      actorId: "player",
      payload: { phase: "main1" },
    },
  ]);
  const replay = JSON.parse(
    JSON.stringify(
      Reflect.apply(game.finalizeReplay, game, [{ reason: "test" }]),
    ),
  );
  replay.commands[0].payload.phase = "end";
  await assert.rejects(
    () => replayCanonicalDuel(replay),
    (error: unknown) => {
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
    },
  );
  game.dispose();
});

test("banco incompatível e relatórios v4 são rejeitados explicitamente", () => {
  assert.throws(
    () =>
      validateCanonicalReplay({
        format: "shadow-duel-canonical-replay",
        schemaVersion: 2,
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
  Reflect.apply(recording.startTargetSelectionSession, recording, [
    {
      kind: "target",
      owner: recording.player,
      selectionContract: {
        kind: "target",
        ui: { useFieldTargeting: false },
        requirements: [
          {
            id: "target",
            min: 1,
            max: 1,
            zones: ["hand"],
            candidates: recordedCandidates,
          },
        ],
      },
      execute: async (selections: unknown) => {
        recordedSelection = selections;
        return { success: true, needsSelection: false };
      },
    },
  ]);
  const targetSelection = recording.targetSelection;
  assert.ok(targetSelection);
  targetSelection.selections = {
    target: [required(recordedCandidates[0]).key as SelectionCandidateKey],
  };
  await Reflect.apply(recording.finishTargetSelection, recording, []);
  assert.equal(
    selectionAt(recordedSelection, "target", 0),
    required(recordedCandidates[0]).key,
  );
  const replayBuffer = recording._canonicalReplay;
  assert.ok(replayBuffer);
  const decision = structuredClone(
    replayBuffer.decisions[0],
  ) as CanonicalReplayDecisionOf<"target">;
  assert.ok("selections" in decision.value);
  const serializedTarget = required(decision.value.selections.target)[0];
  assert.ok(serializedTarget && "duelCardId" in serializedTarget);
  assert.equal(
    serializedTarget.duelCardId,
    required(recording.player.hand[0]).duelCardId,
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
  await Reflect.apply(playback.startTargetSelectionSession, playback, [
    {
      kind: "target",
      owner: playback.player,
      selectionContract: {
        kind: "target",
        ui: { useFieldTargeting: false },
        requirements: [
          {
            id: "target",
            min: 1,
            max: 1,
            zones: ["hand"],
            candidates: playbackCandidates,
          },
        ],
      },
      execute: async (selections: unknown) => {
        playbackSelection = selections;
        return { success: true, needsSelection: false };
      },
    },
  ]);
  assert.equal(
    selectionAt(playbackSelection, "target", 0),
    required(playbackCandidates[0]).key,
  );
  assert.notEqual(
    required(playbackCandidates[0]).key,
    required(recordedCandidates[0]).key,
  );
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
    Reflect.apply(game.notify, game, [
      event,
      {
        chainId: 1,
        linkId: 1,
        summonId: 1,
        damageStepId: 1,
        stage: event,
      },
    ]);
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
