import test from "node:test";
import assert from "node:assert/strict";

import {
  getCardDatabaseSignature,
  validateCanonicalReplay,
} from "../../src/core/game/replay/canonical.js";
import { CANONICAL_REPLAY_EVENT_NAMES } from "../../src/core/contracts/replay.js";

type MutableReplay = Record<string, unknown>;

function setup() {
  return {
    seed: 123,
    randomState: { seed: 123, state: 456, calls: 7 },
    startingPlayer: "player",
    playerDeck: [{ id: 1, duelCardId: 1 }],
    playerExtraDeck: [],
    botDeck: [{ id: 2, duelCardId: 2 }],
    botExtraDeck: [],
  };
}

function replay(overrides: MutableReplay = {}): MutableReplay {
  return {
    format: "shadow-duel-canonical-replay",
    schemaVersion: 1,
    cardDatabaseSignature: getCardDatabaseSignature(),
    setup: setup(),
    commands: [],
    decisions: [],
    ...overrides,
  };
}

const commandPayloads = [
  ["noop", {}],
  ["draw", { amount: 2 }],
  ["shuffle", {}],
  ["set_phase", { phase: "main1" }],
  ["set_lp", { lp: 7000 }],
  ["phase_intent", { fromPhase: "main1", toPhase: "battle" }],
  ["summon", {
    duelCardId: 1,
    cardId: 1,
    position: "attack",
    facedown: false,
    tributeIndices: [0],
  }],
  ["set_monster", {
    duelCardId: 2,
    cardId: 2,
    position: "defense",
    facedown: true,
    tributeIndices: null,
  }],
  ["set_spell_trap", { duelCardId: 3, cardId: 3 }],
  ["flip_summon", { duelCardId: 4, cardId: 4 }],
  ["extra_deck_summon", {
    duelCardId: 5,
    cardId: 5,
    summonType: "synchro",
    position: "attack",
    materialIds: [1, 2],
  }],
  ["activate_effect", {
    duelCardId: 6,
    cardId: 6,
    sourceZone: "field",
    effectId: "effect-1",
  }],
  ["activate_card", {
    duelCardId: 7,
    cardId: 7,
    sourceZone: "hand",
    effectId: null,
  }],
  ["change_position", {
    duelCardId: 8,
    cardId: 8,
    position: "defense",
  }],
  ["attack", { attackerId: 8, targetId: null }],
] as const;

test("validator aceita shape mínimo compatível, extras serializáveis e mantém referência", () => {
  const input = replay({
    extraMetadata: { producer: "legacy", flags: [true, null, 2] },
  });
  const before = structuredClone(input);
  const result = validateCanonicalReplay(input);

  assert.strictEqual(result, input);
  assert.deepEqual(input, before);
  assert.equal("engineVersion" in input, false);
  assert.equal("events" in input, false);
  assert.equal("result" in input, false);
  assert.equal("finalized" in input, false);
});

test("validator aceita os 15 comandos discriminados", () => {
  const commands = commandPayloads.map(([type, payload], index) => ({
    sequence: index + 1,
    type,
    actorId: index % 2 === 0 ? "player" : "bot",
    payload,
    stateHash: index === 0 ? null : "0123abcd",
  }));

  assert.doesNotThrow(() => validateCanonicalReplay(replay({ commands })));
});

test("validator preserva defaults compatíveis de comandos e resultado", () => {
  const commands = [
    { sequence: 1, type: "phase_intent", actorId: "player", payload: {} },
    {
      sequence: 2,
      type: "extra_deck_summon",
      actorId: "player",
      payload: { cardId: 5 },
    },
    {
      sequence: 3,
      type: "activate_effect",
      actorId: "player",
      payload: { duelCardId: 6 },
    },
    {
      sequence: 4,
      type: "attack",
      actorId: "player",
      payload: { attackerId: 8 },
    },
  ];

  assert.doesNotThrow(() =>
    validateCanonicalReplay(replay({ commands, result: {} }))
  );
});

test("validator valida campos opcionais quando eles estão presentes", () => {
  const invalidCommands = [
    { type: "draw", payload: { amount: 0 } },
    { type: "set_spell_trap", payload: { duelCardId: null, cardId: null } },
    {
      type: "extra_deck_summon",
      payload: { cardId: 5, materialIds: [0] },
    },
    {
      type: "activate_effect",
      payload: { cardId: 6, sourceZone: "any" },
    },
  ];

  invalidCommands.forEach((entry, index) => {
    assert.throws(() =>
      validateCanonicalReplay(replay({
        commands: [{
          sequence: 1,
          actorId: "player",
          ...entry,
        }],
      })),
    `invalid optional command payload ${index}`);
  });
});

test("validator preserva a mensagem pública para comando desconhecido", () => {
  assert.throws(
    () => validateCanonicalReplay(replay({
      commands: [{
        sequence: 1,
        type: "unsupported_action",
        actorId: "player",
        payload: {},
      }],
    })),
    /Unsupported canonical replay command "unsupported_action"\./,
  );
});

test("validator rejeita sequências não positivas ou fora de ordem e hashes inválidos", () => {
  for (const commands of [
    [{ sequence: 0, type: "noop", actorId: null, payload: {} }],
    [
      { sequence: 2, type: "noop", actorId: null, payload: {} },
      { sequence: 2, type: "noop", actorId: null, payload: {} },
    ],
  ]) {
    assert.throws(
      () => validateCanonicalReplay(replay({ commands })),
      /sequence/,
    );
  }

  for (const stateHash of ["ABCDEF12", "abcdef1", "abcdefghi", 12345678]) {
    assert.throws(
      () => validateCanonicalReplay(replay({
        commands: [{
          sequence: 1,
          type: "noop",
          actorId: null,
          payload: {},
          stateHash,
        }],
      })),
      /lowercase eight-character hexadecimal hash/,
    );
  }
});

test("validator rejeita decisão incompatível com seu kind", () => {
  const baseDecision = {
    sequence: 1,
    decisionId: 1,
    actorId: "player",
    candidateKeys: [],
    context: null,
  };
  assert.throws(
    () => validateCanonicalReplay(replay({
      decisions: [{
        ...baseDecision,
        kind: "chain_response",
        value: { orderedCandidateKeys: [1] },
      }],
    })),
    /decisions\[0\]\.value\.pass/,
  );
  assert.throws(
    () => validateCanonicalReplay(replay({
      decisions: [{
        ...baseDecision,
        kind: "segoc_order",
        value: { pass: false, candidateKey: 1, effectId: null },
      }],
    })),
    /orderedCandidateKeys/,
  );
});

test("validator aceita os sete eventos históricos separados do runtime", () => {
  const historicalEvents = [
    "trigger_opportunity",
    "trigger_ordered",
    "activation_usage",
    "chain_link_resolved",
    "chain_finalized",
    "summon_attempt",
    "chain_cleanup",
  ];
  const events = historicalEvents.map((event, index) => ({
    sequence: index + 1,
    event,
    turn: 1,
    phase: "main1",
    payload: { historical: true, index },
  }));

  assert.doesNotThrow(() => validateCanonicalReplay(replay({ events })));
});

test("manifest agregado valida exatamente os 34 eventos canônicos", () => {
  assert.equal(CANONICAL_REPLAY_EVENT_NAMES.length, 34);
  const events = CANONICAL_REPLAY_EVENT_NAMES.map((event, index) => ({
    sequence: index + 1,
    event,
    turn: 1,
    phase: "main1",
    payload: { index },
  }));
  assert.doesNotThrow(() => validateCanonicalReplay(replay({ events })));
});

test("validator valida profundamente snapshots presentes", () => {
  assert.throws(
    () => validateCanonicalReplay(replay({
      result: {
        winner: null,
        reason: "invalid snapshot",
        finalStateHash: "0123abcd",
        finalState: {},
      },
    })),
    /result\.finalState\.turn/,
  );
});

test("finalized true exige resultado presente", () => {
  assert.throws(
    () => validateCanonicalReplay(replay({ finalized: true })),
    /result.*when finalized is true/,
  );
  assert.doesNotThrow(() => validateCanonicalReplay(replay({ finalized: false })));
});

test("toda a árvore, inclusive extras e payloads, precisa ser JSON serializável", () => {
  for (const invalidExtra of [
    undefined,
    () => true,
    Symbol("invalid"),
    1n,
    Number.NaN,
    new Date(0),
  ]) {
    assert.throws(
      () => validateCanonicalReplay(replay({ invalidExtra })),
      /JSON-serializable|finite JSON number|plain JSON object/,
    );
  }

  const cyclic: MutableReplay = replay();
  cyclic.self = cyclic;
  assert.throws(
    () => validateCanonicalReplay(cyclic),
    /acyclic JSON-serializable value/,
  );

  const sparse: unknown[] = [];
  sparse.length = 1;
  assert.throws(
    () => validateCanonicalReplay(replay({ sparse })),
    /present JSON array value/,
  );
});

test("ordem dos checks legados permanece formato, schema, assinatura e campos mínimos", () => {
  assert.throws(
    () => validateCanonicalReplay({ reportVersion: 4 }),
    /Unsupported replay format \(legacy\/report version 4\)/,
  );
  assert.throws(
    () => validateCanonicalReplay({
      format: "shadow-duel-canonical-replay",
      schemaVersion: 2,
    }),
    /Unsupported canonical replay schema 2/,
  );
  assert.throws(
    () => validateCanonicalReplay({
      format: "shadow-duel-canonical-replay",
      schemaVersion: 1,
      cardDatabaseSignature: "00000000",
    }),
    /database signature/,
  );
  assert.throws(
    () => validateCanonicalReplay({
      format: "shadow-duel-canonical-replay",
      schemaVersion: 1,
      cardDatabaseSignature: getCardDatabaseSignature(),
    }),
    /missing setup, commands, or decisions/,
  );
});
