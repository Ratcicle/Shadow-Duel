import {
  CANONICAL_REPLAY_FORMAT,
  CANONICAL_REPLAY_SCHEMA_VERSION,
  createCanonicalStateSnapshot,
  getCardDatabaseSignature,
  hashCanonicalGameState,
  isReplayEvent,
  serializeReplayEventPayload,
} from "./canonical.js";

function deckEntries(game, cards = []) {
  return cards
    .filter(Boolean)
    .map((card) => ({
      id: card.id,
      duelCardId: game.ensureDuelCardId(card),
    }));
}

export function startReplayRecording(options = {}) {
  this._canonicalReplay = {
    format: CANONICAL_REPLAY_FORMAT,
    schemaVersion: CANONICAL_REPLAY_SCHEMA_VERSION,
    engineVersion: "phase-9",
    cardDatabaseSignature: getCardDatabaseSignature(),
    setup: {
      seed: this.randomSeed,
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

export function captureReplaySetup() {
  if (!this.captureReplayEnabled || !this._canonicalReplay) return null;
  this._canonicalReplay.setup = {
    seed: this.randomSeed,
    randomState: this.getRandomState?.() || null,
    startingPlayer: this.turn,
    playerDeck: deckEntries(this, this.player?.deck),
    playerExtraDeck: deckEntries(this, this.player?.extraDeck),
    botDeck: deckEntries(this, this.bot?.deck),
    botExtraDeck: deckEntries(this, this.bot?.extraDeck),
  };
  return this._canonicalReplay.setup;
}

export function recordReplayCommand(command = {}) {
  if (!this.captureReplayEnabled || !this._canonicalReplay?.setup) return null;
  const entry = {
    sequence: this._canonicalReplay.commands.length + 1,
    type: command.type || "unknown",
    actorId: command.actorId || command.playerId || null,
    payload: command.payload || {},
    stateHash: hashCanonicalGameState(this),
  };
  this._canonicalReplay.commands.push(entry);
  return entry;
}

export function recordReplayDecision(decision = {}) {
  if (!this.captureReplayEnabled || !this._canonicalReplay) return null;
  const entry = { ...decision, sequence: this._canonicalReplay.decisions.length + 1 };
  this._canonicalReplay.decisions.push(entry);
  return entry;
}

export function recordReplayEvent(eventName, payload) {
  if (!this.captureReplayEnabled || !this._canonicalReplay || !isReplayEvent(eventName)) {
    return null;
  }
  const entry = {
    sequence: this._canonicalReplay.events.length + 1,
    event: eventName,
    turn: this.turnCounter,
    phase: this.phase,
    payload: serializeReplayEventPayload(this, payload),
  };
  this._canonicalReplay.events.push(entry);
  return entry;
}

export function finalizeReplay(result = {}) {
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

export function exportReplay(options = {}) {
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

export function hasCanonicalReplay() {
  return !!this._canonicalReplay;
}
