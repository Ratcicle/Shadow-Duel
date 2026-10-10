import { required, unsafeFixture } from "../helpers/fixtures.js";
import test from "node:test";
import assert from "node:assert/strict";

import Card from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";
import {
  getCardDatabaseSignature,
  createCanonicalStateSnapshot,
  hashCanonicalGameState,
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

const deck = [1, 2, 3, 4, 5, 6, 7, 8];

type GameInstance = InstanceType<typeof Game>;

// Snapshot fields added by the engine-rules-v27 hash completion.
const V27_PLAYER_FIELDS = [
  "damageReceivedThisTurn",
  "normalSummonsThisTurn",
  "additionalNormalSummonPermissions",
  "lpGainMultiplier",
  "opponentCannotActivateDuringBattle",
] as const;
const V27_CARD_FIELDS = [
  "characteristics",
  "statusRegistries",
  "turnState",
  "statBookkeeping",
  "bindings",
] as const;
const V27_CARD_STATUS_FIELDS = [
  "battleIndestructible",
  "tempBattleIndestructible",
  "battleDamageHealsControllerThisTurn",
  "extraAttacks",
] as const;

/** Project a current replay onto the engine-rules-v26 snapshot shape. */
function stripV27SnapshotFields(replay: object): void {
  const result: unknown = Reflect.get(replay, "result");
  const finalState: unknown = result && typeof result === "object" ? Reflect.get(result, "finalState") : null;
  assert.ok(finalState && typeof finalState === "object");
  Reflect.deleteProperty(finalState, "ruleState");
  const players: unknown = Reflect.get(finalState, "players");
  assert.ok(players && typeof players === "object");
  for (const player of Object.values(players)) {
    for (const field of V27_PLAYER_FIELDS) Reflect.deleteProperty(player, field);
    for (const zone of Object.values(Reflect.get(player, "zones") ?? {})) {
      for (const card of Array.isArray(zone) ? zone : zone ? [zone] : []) {
        if (!card || typeof card !== "object") continue;
        for (const field of V27_CARD_FIELDS) Reflect.deleteProperty(card, field);
        const statuses: unknown = Reflect.get(card, "statuses");
        if (statuses && typeof statuses === "object") {
          for (const field of V27_CARD_STATUS_FIELDS) Reflect.deleteProperty(statuses, field);
        }
      }
    }
  }
}

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

test("hand procedure capture replays the human's five costs and manual slot without an activation command", async (t) => {
  // The shared starting fixture isolates procedure capture from unrelated turns.
  const installStartingFixture = (game: GameInstance) => {
    const start = game.startWithDecks.bind(game);
    game.startWithDecks = async (options) => {
      await start(options);
      const cards = [...game.player.hand, ...game.player.deck];
      game.player.hand = [required(cards.find(card => card.id === 24))];
      game.player.graveyard = cards.filter(card => card.id === 23);
      game.player.deck = [];
      game.phase = "main1";
      game.disablePresentationDelays = true;
      game.waitForBoardPresentation = async () => {};
    };
  };
  const recording = new Game({
    randomSeed: 712, captureReplay: true,
    getFieldPlacementMode: () => "manual",
    fieldPlacementProvider: async () => ({ outcome: "chosen", slot: 4 }),
  });
  const playback = new Game({
    randomSeed: 712, captureReplay: false, replayMode: "playback",
    getFieldPlacementMode: () => { throw new Error("Playback must use the recorded placement."); },
  });
  t.after(() => { recording.dispose(); playback.dispose(); });
  installStartingFixture(recording);
  installStartingFixture(playback);
  await recording.startWithDecks({
    exactDecks: true, initializeOnly: true, startAtDrawPhase: true,
    announceStartingPlayer: false, startingPlayer: "player",
    playerDeck: [24, 23, 23, 23, 23, 23], playerExtraDeck: [],
    botDeck: deck, botExtraDeck: [],
  });
  const hyperion = required(recording.player.hand[0]);
  const result = await recording.performHandSummonProcedure(hyperion, recording.player, { position: "attack" });
  assert.equal(result.needsSelection, true);
  const selection = required(recording.targetSelection);
  selection.selections.hand_summon_cost = required(selection.requirements[0]).candidates.map(candidate => candidate.key);
  await recording.finishTargetSelection();
  assert.equal(recording.player.field.includes(hyperion), true);
  assert.equal(hyperion.fieldSlot, 4);
  const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(
    Reflect.apply(recording.finalizeReplay, recording, [{ reason: "test" }]),
  )));
  assert.deepEqual(replay.commands.map(command => command.type), ["hand_summon_procedure"]);
  assert.equal(replay.decisions.filter(decision => decision.kind === "cost").length, 1);
  assert.equal(replay.decisions.filter(decision => decision.kind === "field_placement").length, 1);
  // As in the driver factory, this read port refers to this Game's real cards and players.
  const replayed = await replayCanonicalDuel(replay, { game: playback as ReplayDriverGamePort });
  assert.equal(replayed.ok, true);
  assert.equal(playback.player.banished.length, 5);
  assert.equal(required(playback.player.field[0]).fieldSlot, 4);
  assert.equal(required(playback.player.field[0]).lastSummonProcedure, hyperion.lastSummonProcedure);
  assert.equal(replayed.finalStateHash, replay.result?.finalStateHash);
  assert.deepEqual(createCanonicalStateSnapshot(playback), replay.result?.finalState);
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
  const replay = validateCanonicalReplay(JSON.parse(
    JSON.stringify(
      Reflect.apply(game.finalizeReplay, game, [{ reason: "test" }]),
    ),
  ));
  assert.equal(replay.format, "shadow-duel-canonical-replay");
  assert.equal(replay.schemaVersion, 2);
  assert.equal(replay.cardDatabaseSignature, getCardDatabaseSignature());
  // Presence durations participate in the canonical state as well.
  assert.deepEqual(
    replay.commands.map(command => command.stateHash),
    ["0a69cfa6", "a196a87e"],
  );
  const replayResult = required(replay.result);
  assert.equal(replayResult.finalStateHash, "a196a87e");
  // Historical envelopes retain their exact version and declaration signature.
  // engine-rules-v26: the snapshot before the v27 hash completion.
  const beforeHashCompletion = structuredClone(replay);
  stripV27SnapshotFields(beforeHashCompletion);
  required(beforeHashCompletion.commands[0]).stateHash = "387cada4";
  required(beforeHashCompletion.commands[1]).stateHash = "f9154acc";
  required(beforeHashCompletion.result).finalStateHash = "f9154acc";
  assert.equal(hashCanonicalValue({ ...beforeHashCompletion, engineVersion: "engine-rules-v26" }), "bbfb1fb5");
  assert.equal(JSON.stringify({ ...beforeHashCompletion, engineVersion: "engine-rules-v26" }).length, 14016);
  const beforeEffectlessCardActivations = { ...beforeHashCompletion, engineVersion: "engine-rules-v25" };
  assert.deepEqual(beforeEffectlessCardActivations.commands.map(command => command.stateHash), ["387cada4", "f9154acc"]);
  assert.equal(hashCanonicalValue(beforeEffectlessCardActivations), "5569d130");
  assert.equal(JSON.stringify(beforeEffectlessCardActivations).length, 14016);
  const beforeTurnActionState = structuredClone(beforeHashCompletion);
  for (const player of Object.values(required(required(beforeTurnActionState.result).finalState).players)) {
    for (const zone of Object.values(player.zones)) {
      for (const card of Array.isArray(zone) ? zone : zone ? [zone] : []) {
        if (!card) continue;
        for (const field of ["attacksUsedThisTurn", "hasAttacked", "summonedTurn", "positionChangedThisTurn"]) {
          Reflect.deleteProperty(card, field);
        }
      }
    }
  }
  required(beforeTurnActionState.commands[0]).stateHash = "07b23806";
  required(beforeTurnActionState.commands[1]).stateHash = "2b228622";
  required(beforeTurnActionState.result).finalStateHash = "2b228622";
  assert.equal(hashCanonicalValue({ ...beforeTurnActionState, engineVersion: "engine-rules-v24" }), "1958ef50");
  assert.equal(JSON.stringify({ ...beforeTurnActionState, engineVersion: "engine-rules-v24" }).length, 12864);
  const beforeCapturedTriggers = structuredClone(beforeTurnActionState);
  const formerTriggerState = required(required(beforeCapturedTriggers.result).finalState).chain.triggers;
  assert.ok(formerTriggerState !== null && typeof formerTriggerState === "object");
  for (const key of ["pendingOccurrences", "activeOccurrences", "lastRelevantAtomicGroupId"]) Reflect.deleteProperty(formerTriggerState, key);
  required(beforeCapturedTriggers.commands[0]).stateHash = "adfa2802";
  required(beforeCapturedTriggers.commands[1]).stateHash = "9f6adbc6";
  required(beforeCapturedTriggers.result).finalStateHash = "9f6adbc6";
  const historical = structuredClone(beforeCapturedTriggers);
  for (const player of Object.values(required(required(historical.result).finalState).players)) {
    for (const zone of Object.values(player.zones)) {
      for (const card of Array.isArray(zone) ? zone : zone ? [zone] : []) {
        if (!card) continue;
        Reflect.deleteProperty(card, "originalLevel");
        Reflect.deleteProperty(card, "levelModificationContributions");
      }
    }
  }
  required(historical.commands[0]).stateHash = "5a03f26c";
  required(historical.commands[1]).stateHash = "c2ec633c";
  required(historical.result).finalStateHash = "c2ec633c";
  historical.cardDatabaseSignature = "c30857b8";
  assert.equal(hashCanonicalValue({ ...historical, cardDatabaseSignature: "a2cd2bdb", engineVersion: "engine-rules-v12" }), "c418b563");
  assert.equal(hashCanonicalValue({ ...historical, cardDatabaseSignature: "a2cd2bdb", engineVersion: "engine-rules-v14" }), "69ee977d");
  assert.equal(hashCanonicalValue({ ...historical, cardDatabaseSignature: "db5833d7", engineVersion: "engine-rules-v14" }), "bc1e3cb7");
  assert.equal(hashCanonicalValue({ ...historical, cardDatabaseSignature: "0f23140c", engineVersion: "engine-rules-v14" }), "76f5c866");
  assert.equal(hashCanonicalValue({ ...historical, cardDatabaseSignature: "0f2a7a85", engineVersion: "engine-rules-v15" }), "a4af185c");
  assert.equal(hashCanonicalValue({ ...historical, cardDatabaseSignature: "e1469707", engineVersion: "engine-rules-v16" }), "e161e690");
  assert.equal(hashCanonicalValue({ ...historical, engineVersion: "engine-rules-v17" }), "accbf7e6");
  assert.equal(hashCanonicalValue({ ...historical, engineVersion: "engine-rules-v18" }), "1133b3cb");
  assert.equal(hashCanonicalValue({ ...beforeCapturedTriggers, cardDatabaseSignature: "c6aef06c", engineVersion: "engine-rules-v19" }), "30c6d3d0");
  assert.equal(hashCanonicalValue({ ...beforeCapturedTriggers, cardDatabaseSignature: "f68bdfd5", engineVersion: "engine-rules-v20" }), "be73b885");
  assert.equal(hashCanonicalValue({ ...beforeCapturedTriggers, cardDatabaseSignature: "c0327049", engineVersion: "engine-rules-v21" }), "5894e47f");
  assert.equal(hashCanonicalValue({ ...beforeCapturedTriggers, cardDatabaseSignature: "4d85a5a8", engineVersion: "engine-rules-v22" }), "49c80dfc");
  assert.equal(hashCanonicalValue({ ...beforeCapturedTriggers, cardDatabaseSignature: "c1fecb57", engineVersion: "engine-rules-v22" }), "2a2e3f30");
  assert.equal(hashCanonicalValue({ ...beforeCapturedTriggers, cardDatabaseSignature: "f60cba87", engineVersion: "engine-rules-v22" }), "b1bbca51");
  assert.equal(hashCanonicalValue({ ...beforeCapturedTriggers, cardDatabaseSignature: "7e5d54cb", engineVersion: "engine-rules-v23" }), "7bfe1e4a");
  assert.equal(hashCanonicalValue({ ...beforeCapturedTriggers, cardDatabaseSignature: "feeb687b", engineVersion: "engine-rules-v23" }), "6b0653a2");
  assert.equal(hashCanonicalValue(replay), "43ba430d");
  assert.equal(JSON.stringify(replay).length, 33776);

  const result = await replayCanonicalDuel(replay);
  assert.equal(result.ok, true);
  assert.equal(result.finalStateHash, replayResult.finalStateHash);
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

interface RuleFieldMutation {
  readonly field: string;
  readonly mutate: (game: GameInstance) => void;
}

// Every rule-relevant mutable field must reach the canonical hash: two duels
// that differ only there must not be reported as identical.
const RULE_FIELD_MUTATIONS: readonly RuleFieldMutation[] = [
  { field: "player.damageReceivedThisTurn", mutate: game => { game.player.damageReceivedThisTurn = 500; } },
  { field: "player.normalSummonsThisTurn", mutate: game => { game.player.normalSummonsThisTurn = [{ unknown: true }]; } },
  { field: "player.additionalNormalSummonPermissions", mutate: game => {
    game.player.additionalNormalSummonPermissions = [{ count: 1, filters: {} }];
  } },
  { field: "player.lpGainMultiplier", mutate: game => { game.player.lpGainMultiplier = 2; } },
  { field: "player.opponentCannotActivateDuringBattle", mutate: game => {
    Reflect.set(game.player, "opponentCannotActivateDuringBattle", true);
  } },
  { field: "gameOver", mutate: game => { game.gameOver = true; } },
  { field: "winner", mutate: game => { game.winner = "bot"; } },
  { field: "battleStep", mutate: game => { game.battleStep = "damage"; } },
  { field: "lastAttackNegated", mutate: game => { game.lastAttackNegated = true; } },
  { field: "damageCalculationStatChangePending", mutate: game => { game.damageCalculationStatChangePending = true; } },
  { field: "damageCalculationTempBuffs", mutate: game => {
    game.damageCalculationTempBuffs = [{ card: required(game.player.hand[0]), atk: 500, def: 0 }];
  } },
  { field: "endOfDamageStepTempBuffs", mutate: game => {
    game.endOfDamageStepTempBuffs = [{ card: required(game.player.hand[0]), atk: 0, def: 300 }];
  } },
  { field: "temporaryBattlePairEffects", mutate: game => {
    game.temporaryBattlePairEffects = [{ timing: "before_damage_calculation", sourceCardId: 1 }];
  } },
  { field: "pendingSynchroMaterialFollowups", mutate: game => {
    game.pendingSynchroMaterialFollowups = [{ type: "synchro_material_followup", synchroSummonContextId: "synchro:1" }];
  } },
  { field: "pendingSynchroMaterialTriggerContinuation", mutate: game => {
    game.pendingSynchroMaterialTriggerContinuation = {
      stage: "material_triggers", synchroSummonContextId: "synchro:1",
      summonedCard: required(game.player.hand[0]), playerId: "player",
    };
  } },
  { field: "synchroSummonContextCounter", mutate: game => { game.synchroSummonContextCounter = 3; } },
  { field: "eventResolutionCounter", mutate: game => { game.eventResolutionCounter += 1; } },
  { field: "generatedIdCounters", mutate: game => { game.createDeterministicId("battle_pair"); } },
  { field: "materialDuelStats", mutate: game => {
    game.materialDuelStats.player.activatedEffectIdsByMaterialId.set(1, new Set(["effect"]));
  } },
  { field: "specialSummonTypeCounts", mutate: game => { game.specialSummonTypeCounts.player.set("Dragon", 1); } },
  { field: "card.equips", mutate: game => {
    required(game.player.hand[0]).equips = [required(game.player.hand[1])];
  } },
  { field: "card.boundTrapSource", mutate: game => {
    required(game.player.hand[0]).boundTrapSource = required(game.player.hand[1]);
  } },
  { field: "card.boundMonsterTarget", mutate: game => {
    required(game.player.hand[0]).boundMonsterTarget = required(game.player.hand[1]);
  } },
  { field: "card.ascensionMaterials", mutate: game => {
    const material = required(game.player.hand[1]);
    required(game.player.hand[0]).ascensionMaterials = [{
      instanceId: material.instanceId, cardId: material.id ?? null, name: material.name,
      ownerId: "player", controllerId: "player", usedOnTurn: 1,
    }];
  } },
  { field: "card.synchroMaterials", mutate: game => {
    const material = required(game.player.hand[1]);
    required(game.player.hand[0]).synchroMaterials = [{
      instanceId: material.instanceId, cardId: material.id ?? null, name: material.name, level: 1,
      isTuner: true, ownerId: "player", controllerId: "player", usedOnTurn: 1,
    }];
  } },
  { field: "card.attackedMonstersThisTurn", mutate: game => {
    const target = required(game.bot.hand[0]);
    required(game.player.hand[0]).attackedMonstersThisTurn = new Set([target.instanceId]);
  } },
  ...[
    ["cardKind", "trap"], ["originalCardKind", "trap"], ["treatedAsCardKinds", ["trap"]],
    ["isTrapMonster", true], ["trapMonsterSummonProcedure", "card_effect"],
    ["trapMonsterOriginalState", { cardKind: "trap" }], ["monsterType", "effect"],
    ["type", "Machine"], ["types", ["Machine"]], ["attribute", "DARK"], ["subtype", "continuous"],
    ["isTuner", true], ["synchroMaterialRoles", { tuner: true }], ["isToken", true],
    ["battleIndestructible", true], ["tempBattleIndestructible", true],
    ["battleDamageHealsControllerThisTurn", true], ["extraAttacks", 1],
    ["tempStatuses", { battleIndestructible: false }], ["fieldExitStatuses", { isTuner: false }],
    ["canMakeSecondAttackThisTurn", true], ["secondAttackUsedThisTurn", true],
    ["canAttackAllOpponentMonstersThisTurn", true], ["canAttackDirectlyThisTurn", true],
    ["extraAttackTargetRestriction", "monster"], ["passiveExtraAttackTargetRestriction", "monster"],
    ["passiveExtraAttackBonuses", { effect: { amount: 1, targetRestriction: null } }],
    ["cannotAttackUntilTurn", 4], ["immuneToOpponentEffectsUntilTurn", 4],
    ["battleIndestructibleOncePerTurnLastUsedTurn", 1], ["setTurn", 1], ["turnSetOn", 1],
    ["revealedTurn", 1], ["lastSummonProcedure", "synchro"],
    ["tempAtkBoost", 300], ["tempDefBoost", 300],
    ["turnBasedBuffs", [{ id: "buff_1_1", stat: "atk", value: 300, expiresOnTurn: 2 }]],
    ["originalAtk", 1000], ["originalDef", 1000], ["originalStatsOverride", { atk: 0, def: 0 }],
    ["dynamicBuffs", { aura: { value: 300, stats: ["atk"], appliedValues: { atk: 300 } } }],
    ["suppressedDynamicBuffStatsByKey", { aura: { atk: 300 } }],
    ["temporarySuppressedDynamicBuffStatsByKey", { aura: { atk: 300 } }],
    ["equipAtkBonus", 500], ["equipDefBonus", 500], ["equipExtraAttacks", 1], ["equipExtraAttacksApplied", 1],
    ["grantsBattleIndestructible", true],
    ["effectMarkers", { marker: { key: "marker", sourceEffectId: "effect", createdOnTurn: 1 } }],
    ["pendingSpellTrapFinalization", { destination: "graveyard", ownerId: "player", activationZone: "spellTrap" }],
    ["lastSentToGraveAsMaterial", { method: "synchro", turn: 1 }],
  ].map(([key, value]): RuleFieldMutation => ({
    field: `card.${String(key)}`,
    mutate: game => { Reflect.set(required(game.player.hand[0]), String(key), value); },
  })),
];

test("every rule-relevant mutable field changes the canonical hash", async (t) => {
  for (const mutation of RULE_FIELD_MUTATIONS) {
    const game = new Game({ randomSeed: 123, captureReplay: false });
    t.after(() => game.dispose());
    await initialize(game, "player");
    const before = hashCanonicalGameState(game);
    mutation.mutate(game);
    assert.notEqual(hashCanonicalGameState(game), before, `${mutation.field} must change the canonical hash`);
  }
});

test("rule records hash by duel identity, not by process-local instance ids", async (t) => {
  const hashWithRecords = async (instanceShift: number) => {
    // Shift the process-global instance counter between otherwise equal duels.
    for (let index = 0; index < instanceShift; index++) {
      new Card({ id: 1, name: "Instance shift", cardKind: "monster", atk: 0, def: 0, level: 1, effects: [] }, "player");
    }
    const game = new Game({ randomSeed: 123, captureReplay: false });
    t.after(() => game.dispose());
    await initialize(game, "player");
    const source = required(game.player.hand[0]);
    const target = required(game.bot.hand[0]);
    game.temporaryBattlePairEffects = [{
      id: `${String(source.instanceId)}:pair:${game.createDeterministicId("battle_pair")}`,
      source, sourceInstanceId: source.instanceId, firstTarget: target, firstInstanceId: target.instanceId,
    }];
    game.pendingSynchroMaterialFollowups = [{
      id: `${String(source.instanceId)}:followup:1`, source, sourceInstanceId: source.instanceId,
    }];
    game.damageCalculationTempBuffs = [{ card: target, atk: 100, def: 0 }];
    source.attackedMonstersThisTurn = new Set([target.instanceId]);
    source.ascensionMaterials = [{
      instanceId: target.instanceId, cardId: target.id ?? null, name: target.name,
      ownerId: "bot", controllerId: "bot", usedOnTurn: 1,
    }];
    Reflect.set(source, "effectMarkers", { marker: { key: "marker", sourceInstanceId: target.instanceId } });
    return hashCanonicalGameState(game);
  };
  assert.equal(await hashWithRecords(0), await hashWithRecords(7));
});
