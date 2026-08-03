import type {
  CanonicalReplay,
  CanonicalReplayCommand,
  CanonicalReplayDecision,
  CanonicalReplayEvent,
  SerializableValue,
} from "../../src/core/contracts/replay.js";

const drawCommand: CanonicalReplayCommand = {
  sequence: 1,
  type: "draw",
  actorId: "player",
  payload: { amount: 2 },
  stateHash: "26771e66",
};

const extraDeckCommand: CanonicalReplayCommand = {
  sequence: 2,
  type: "extra_deck_summon",
  actorId: "bot",
  payload: {
    duelCardId: 20,
    cardId: 120,
    summonType: "synchro",
    position: "attack",
    materialIds: [3, 4],
  },
};

const unknownCommand: CanonicalReplayCommand = {
  sequence: 3,
  // contract-negative: command names are a closed 15-member union
  // @ts-expect-error
  type: "special_summon",
  actorId: "player",
  payload: {},
};

// contract-negative: draw amount must remain numeric
// @ts-expect-error
const invalidDrawAmount: CanonicalReplayCommand = {
  sequence: 4,
  type: "draw",
  actorId: "player",
  payload: { amount: "two" },
};

const compatibleExtraDeckCommand: CanonicalReplayCommand = {
  sequence: 5,
  type: "extra_deck_summon",
  actorId: "player",
  payload: {
    cardId: 130,
  },
};

const chainDecision: CanonicalReplayDecision = {
  sequence: 1,
  decisionId: 1,
  kind: "chain_response",
  actorId: "player",
  candidateKeys: ["chain:1"],
  value: { pass: true },
  context: {
    type: null,
    chainId: 1,
    respondingToLinkId: null,
  },
};

const invalidChainDecision: CanonicalReplayDecision = {
  sequence: 2,
  decisionId: 2,
  kind: "chain_response",
  actorId: "player",
  candidateKeys: [],
  // contract-negative: a chain response cannot contain a SEGOC ordering value
  // @ts-expect-error
  value: { orderedCandidateKeys: [1] },
  context: null,
};

const invalidSerializedContext: CanonicalReplayDecision = {
  sequence: 3,
  decisionId: 3,
  kind: "target",
  actorId: "player",
  candidateKeys: [],
  value: { pass: true },
  context: {
    // contract-negative: replay contexts cannot retain runtime callbacks
    // @ts-expect-error
    closeModal: () => undefined,
  },
};

const historicalEvent: CanonicalReplayEvent = {
  sequence: 1,
  event: "chain_cleanup",
  turn: 2,
  phase: "end",
  payload: { chainId: 4 },
};

const unknownEvent: CanonicalReplayEvent = {
  sequence: 2,
  // contract-negative: replay events are restricted to the canonical 34 names
  // @ts-expect-error
  event: "decision_made",
  turn: 2,
  phase: "end",
  payload: {},
};

const serializable: SerializableValue = {
  array: [1, "two", false, null],
  nested: { key: "value" },
};

// contract-negative: undefined is omitted by normalization, not serialized
// @ts-expect-error
const undefinedValue: SerializableValue = undefined;

// contract-negative: bigint must cross the normalizer before serialization
// @ts-expect-error
const bigintValue: SerializableValue = 1n;

// contract-negative: functions cannot enter the canonical replay tree
// @ts-expect-error
const functionValue: SerializableValue = () => true;

const replay: CanonicalReplay = {
  format: "shadow-duel-canonical-replay",
  schemaVersion: 1,
  engineVersion: "phase-9",
  cardDatabaseSignature: "1cc622e3",
  setup: {
    seed: 123,
    randomState: { seed: 123, state: 123, calls: 0 },
    startingPlayer: "player",
    playerDeck: [{ id: 1, duelCardId: 1 }],
    playerExtraDeck: [],
    botDeck: [{ id: 1, duelCardId: 2 }],
    botExtraDeck: [],
  },
  commands: [drawCommand, extraDeckCommand],
  decisions: [chainDecision],
  events: [historicalEvent],
};

const wrongSchema: CanonicalReplay = {
  ...replay,
  // contract-negative: schema version remains the literal 1
  // @ts-expect-error
  schemaVersion: 2,
};

const wrongEngine: CanonicalReplay = {
  ...replay,
  // contract-negative: the optional engine version is fixed when present
  // @ts-expect-error
  engineVersion: "phase-10",
};

void unknownCommand;
void invalidDrawAmount;
void compatibleExtraDeckCommand;
void invalidChainDecision;
void invalidSerializedContext;
void unknownEvent;
void serializable;
void undefinedValue;
void bigintValue;
void functionValue;
void replay;
void wrongSchema;
void wrongEngine;
