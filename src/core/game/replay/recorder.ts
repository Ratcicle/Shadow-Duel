import type {
  ReplayCommandRecordingInput,
  ReplayDecisionRecordingInput,
  ReplayDeckEntry,
  ReplayExportOptions,
  ReplayFinalizeInput,
  ReplayRecordedCommandEntry,
  ReplayRecordedDecisionEntry,
  ReplayRecordedEventEntry,
  ReplayRecorderGamePort,
  ReplayRecordingBuffer,
  ReplayRecordingOptions,
  ReplayRuntimeCard,
} from "../../contracts/replay.js";
import type { PlayerId } from "../../contracts/primitives.js";
import { CANONICAL_REPLAY_ENGINE_VERSION } from "../../contracts/replay.js";
import {
  CANONICAL_REPLAY_FORMAT,
  CANONICAL_REPLAY_SCHEMA_VERSION,
  createCanonicalStateSnapshot,
  getCardDatabaseSignature,
  hashCanonicalGameState,
  isReplayEvent,
  serializeReplayEventPayload,
} from "./canonical.js";

function replayPlayerId(value: string | null | undefined): PlayerId | null {
  return value === "player" || value === "bot" ? value : null;
}

function isReplayRuntimeCard(
  card: ReplayRuntimeCard | null | undefined,
): card is ReplayRuntimeCard {
  return Boolean(card);
}

function deckEntries(
  game: ReplayRecorderGamePort,
  cards: Array<ReplayRuntimeCard | null | undefined> = [],
): ReplayDeckEntry[] {
  return cards
    .filter(isReplayRuntimeCard)
    .map((card) => ({
      id: card.id!,
      duelCardId: game.ensureDuelCardId(card),
    }));
}

export function startReplayRecording(
  this: ReplayRecorderGamePort,
  options: ReplayRecordingOptions = {},
): ReplayRecordingBuffer {
  this._canonicalReplay = {
    format: CANONICAL_REPLAY_FORMAT,
    schemaVersion: CANONICAL_REPLAY_SCHEMA_VERSION,
    engineVersion: CANONICAL_REPLAY_ENGINE_VERSION,
    cardDatabaseSignature: getCardDatabaseSignature(),
    setup: {
      seed: this.randomSeed!,
      randomState: this.getRandomState?.() || null,
      startingPlayer: null,
      playerDeck: [],
      playerExtraDeck: [],
      botDeck: [],
      botExtraDeck: [],
    },
    commands: [],
    decisions: [],
    events: [],
    result: null,
    finalized: false,
  };
  this.captureReplayEnabled = options.enabled !== false;
  return this._canonicalReplay;
}

export function captureReplaySetup(
  this: ReplayRecorderGamePort,
) {
  if (!this.captureReplayEnabled || !this._canonicalReplay) return null;
  this._canonicalReplay.setup = {
    seed: this.randomSeed!,
    randomState: this.getRandomState?.() || null,
    startingPlayer: replayPlayerId(this.turn),
    playerDeck: deckEntries(this, this.player?.deck),
    playerExtraDeck: deckEntries(this, this.player?.extraDeck),
    botDeck: deckEntries(this, this.bot?.deck),
    botExtraDeck: deckEntries(this, this.bot?.extraDeck),
  };
  return this._canonicalReplay.setup;
}

export function recordReplayCommand(
  this: ReplayRecorderGamePort,
  command: ReplayCommandRecordingInput = {},
): ReplayRecordedCommandEntry | null {
  if (!this.captureReplayEnabled || !this._canonicalReplay?.setup) return null;
  const entry: ReplayRecordedCommandEntry = {
    sequence: this._canonicalReplay.commands.length + 1,
    type: command.type || "unknown",
    actorId: command.actorId || command.playerId || null,
    payload: command.payload || {},
    stateHash: hashCanonicalGameState(this),
  };
  this._canonicalReplay.commands.push(entry);
  return entry;
}

export function recordReplayDecision(
  this: ReplayRecorderGamePort,
  decision: ReplayDecisionRecordingInput = {},
): ReplayRecordedDecisionEntry | null {
  if (!this.captureReplayEnabled || !this._canonicalReplay) return null;
  const entry: ReplayRecordedDecisionEntry = {
    ...decision,
    sequence: this._canonicalReplay.decisions.length + 1,
  };
  this._canonicalReplay.decisions.push(entry);
  return entry;
}

export function recordReplayEvent(
  this: ReplayRecorderGamePort,
  eventName: string,
  payload: unknown,
): ReplayRecordedEventEntry | null {
  if (
    !this.captureReplayEnabled ||
    !this._canonicalReplay ||
    !isReplayEvent(eventName)
  ) {
    return null;
  }
  const entry: ReplayRecordedEventEntry = {
    sequence: this._canonicalReplay.events.length + 1,
    event: eventName,
    turn: this.turnCounter!,
    phase: this.phase!,
    payload: serializeReplayEventPayload(this, payload) ?? null,
  };
  this._canonicalReplay.events.push(entry);
  return entry;
}

export function finalizeReplay(
  this: ReplayRecorderGamePort,
  result: ReplayFinalizeInput = {},
): ReplayRecordingBuffer | null {
  if (!this._canonicalReplay) return null;
  this._canonicalReplay.result = {
    winner: result.winner || this.winner || null,
    reason: result.reason || null,
    finalStateHash: hashCanonicalGameState(this),
    finalState: createCanonicalStateSnapshot(this),
  };
  this._canonicalReplay.finalized = true;
  return this._canonicalReplay;
}

export function exportReplay(
  this: ReplayRecorderGamePort,
  options: ReplayExportOptions = {},
): ReplayRecordingBuffer | null {
  const replay = this._canonicalReplay?.finalized
    ? this._canonicalReplay
    : this.finalizeReplay({ winner: this.winner });
  if (!replay) return null;
  const json = JSON.stringify(replay, null, 2);
  if (options.download !== false && typeof document !== "undefined") {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = options.filename || `shadow-duel-replay-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return replay;
}

export function hasCanonicalReplay(this: ReplayRecorderGamePort): boolean {
  return !!this._canonicalReplay;
}
