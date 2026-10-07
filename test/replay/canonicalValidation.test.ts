import test from "node:test";
import assert from "node:assert/strict";

import {
  createCanonicalStateSnapshot,
  getCardDatabaseSignature,
  validateCanonicalReplay,
} from "../../src/core/game/replay/canonical.js";
import { CANONICAL_REPLAY_EVENT_NAMES, CANONICAL_REPLAY_ENGINE_VERSION } from "../../src/core/contracts/replay.js";
import Card from "../../src/core/Card.js";
import { cardDefinition, record, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import type { SerializedTriggerOccurrenceState } from "../../src/core/contracts/chainRuntime.js";
import type { ChainId, ChainLinkId } from "../../src/core/contracts/primitives.js";

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
    schemaVersion: 2,
    engineVersion: CANONICAL_REPLAY_ENGINE_VERSION,
    cardDatabaseSignature: getCardDatabaseSignature(),
    setup: setup(),
    commands: [],
    decisions: [],
    ...overrides,
  };
}

test("engine version is required and rejects recordings with previous semantics", () => {
  assert.equal(CANONICAL_REPLAY_ENGINE_VERSION, "engine-rules-v24");
  assert.equal(getCardDatabaseSignature(), "feeb687b");
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "engine-rules-v23" })), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "engine-rules-v22" })), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "engine-rules-v18" })), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "engine-rules-v13" })), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "engine-rules-v12" })), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "engine-rules-v11" })), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "engine-rules-v10" })), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "engine-rules-v9" })), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "engine-rules-v8" })), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "engine-rules-v7" })), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "engine-rules-v6" })), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "dragon-rules-v6" })), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "engine-rules-v4" })), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "dragon-rules-v5" })), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "dragon-rules-v4" })), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "dragon-rules-v3" })), /engineVersion/);
  const missing = replay();
  delete missing.engineVersion;
  assert.throws(() => validateCanonicalReplay(missing), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "field-positions-v2" })), /engineVersion/);
});

test("canonical validation requires a numeric presence-state map in card snapshots", t => {
  const game = createRuntimeGame({ disableChains: true, captureReplay: false });
  t.after(() => game.dispose());
  const source = new Card(cardDefinition(253), "player");
  placeFieldCards(game.player.field, source);
  source.fieldPresenceState = { summon_count_Dragon: 2, anotherCounter: 0 };
  const snapshot = createCanonicalStateSnapshot(game);
  assert.doesNotThrow(() => validateCanonicalReplay(replay({ result: { finalState: snapshot } })));
  for (const invalid of [null, [], { summon_count_Dragon: "2" }, { summon_count_Dragon: null }]) {
    const changed = structuredClone(snapshot);
    Reflect.set(required(changed.players.player.zones.field[0]), "fieldPresenceState", invalid);
    assert.throws(() => validateCanonicalReplay(replay({ result: { finalState: changed } })), /fieldPresenceState/);
  }
  const absent = structuredClone(snapshot);
  Reflect.deleteProperty(required(absent.players.player.zones.field[0]), "fieldPresenceState");
  assert.throws(() => validateCanonicalReplay(replay({ result: { finalState: absent } })), /fieldPresenceState/);
});

test("canonical validation requires nonnegative LP gained in player snapshots", t => {
  const game = createRuntimeGame({ disableChains: true, captureReplay: false });
  t.after(() => game.dispose());
  const snapshot = createCanonicalStateSnapshot(game);
  for (const invalid of [-1, "200", null]) {
    const changed = structuredClone(snapshot);
    Reflect.set(changed.players.player, "lpGainedThisTurn", invalid);
    assert.throws(() => validateCanonicalReplay(replay({ result: { finalState: changed } })), /lpGainedThisTurn/);
  }
  const absent = structuredClone(snapshot);
  Reflect.deleteProperty(absent.players.player, "lpGainedThisTurn");
  assert.throws(() => validateCanonicalReplay(replay({ result: { finalState: absent } })), /lpGainedThisTurn/);
});

test("replays com a assinatura parcial antiga são rejeitados antes da reprodução", () => {
  assert.throws(
    () => validateCanonicalReplay(replay({ cardDatabaseSignature: "6cbacf19" })),
    /card database signature does not match/,
  );
  assert.doesNotThrow(() => validateCanonicalReplay(replay()));
});

test("Miragebound S02 integration rejects previous full signatures and uses schema 2 with the current engine", () => {
  assert.equal(CANONICAL_REPLAY_ENGINE_VERSION, "engine-rules-v24");
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "engine-rules-v14" })), /engineVersion/);
  assert.throws(
    () => validateCanonicalReplay(replay({ cardDatabaseSignature: "98009b78" })),
    /card database signature does not match/,
  );
  assert.equal(validateCanonicalReplay(replay()).schemaVersion, 2);
  assert.throws(() => validateCanonicalReplay(replay({ cardDatabaseSignature: "d0615be5" })), /card database signature does not match/);
  assert.throws(() => validateCanonicalReplay(replay({ cardDatabaseSignature: "c2d58ded" })), /card database signature does not match/);
  assert.throws(() => validateCanonicalReplay(replay({ cardDatabaseSignature: "37f6c19a" })), /card database signature does not match/);
  assert.throws(() => validateCanonicalReplay(replay({ cardDatabaseSignature: "cdcd7e32" })), /card database signature does not match/);
  assert.throws(() => validateCanonicalReplay(replay({ cardDatabaseSignature: "7bbe98b0" })), /card database signature does not match/);
  assert.throws(() => validateCanonicalReplay(replay({ cardDatabaseSignature: "a2cd2bdb" })), /card database signature does not match/);
  assert.throws(() => validateCanonicalReplay(replay({ cardDatabaseSignature: "db5833d7" })), /card database signature does not match/);
  assert.throws(() => validateCanonicalReplay(replay({ cardDatabaseSignature: "0f23140c" })), /card database signature does not match/);
});

test("captured trigger occurrences require canonical identities and deeply validated facts", t => {
  const game = createRuntimeGame({ captureReplay: false });
  t.after(() => game.dispose());
  const presence = { cardId: 17, duelCardId: 7, controllerId: "player", zone: "spellTrap", faceUp: true, locationVersion: 2 } as const;
  const occurrence: SerializedTriggerOccurrenceState = {
    occurrenceId: 1, atomicGroupId: 2, eventName: "card_to_grave", sequence: 1,
    turnCounter: 4, phase: "main1",
    chainId: unsafeFixture<ChainId>(1, "Canonical scalar fixture used to validate serialized occurrence identities."),
    resolvingLinkId: unsafeFixture<ChainLinkId>(2, "Canonical scalar fixture used to validate serialized occurrence identities."),
    timingRelevance: "semantic", entriesProvided: true,
    entries: [{ entryId: "1:0", cardId: 17, duelCardId: 7, effectId: "court_counter", controllerId: "player", registrationId: null, sourceAtTrigger: presence }],
    referenceSnapshots: [{ sourceDuelCardId: 7, effectId: "court_counter", sourcePresence: presence,
      references: [{ targetId: "event_card", cards: [presence] }] }],
    snapshot: { eventName: "card_to_grave", card: { id: 204, duelCardId: 8 } },
  };
  const withOccurrence = (value: unknown, active = false) => {
    const snapshot = createCanonicalStateSnapshot(game);
    Reflect.set(snapshot.chain, "triggers", {
      ...game.chainSystem.getTriggerState(),
      pendingOccurrences: active ? [] : [value], pendingOccurrenceCount: active ? 0 : 1,
      activeOccurrences: active ? [value] : [], opportunityId: active ? 1 : null,
      occurrenceIds: active ? [1] : [], lastRelevantAtomicGroupId: active ? 2 : null,
    });
    return replay({ result: { finalState: snapshot } });
  };
  assert.doesNotThrow(() => validateCanonicalReplay(withOccurrence(occurrence)));
  assert.doesNotThrow(() => validateCanonicalReplay(withOccurrence(occurrence, true)));
  assert.doesNotThrow(() => validateCanonicalReplay(withOccurrence({ ...occurrence, timingRelevance: "source_cleanup", entries: [], referenceSnapshots: [] })));
  const invalidFields: readonly [readonly string[], unknown][] = [
    [["occurrenceId"], 0], [["atomicGroupId"], -1], [["sequence"], 1.5], [["turnCounter"], -1],
    [["eventName"], null], [["phase"], "later"], [["chainId"], 0], [["resolvingLinkId"], "2"],
    [["timingRelevance"], "cleanup"], [["entriesProvided"], "true"], [["entries"], null],
    [["entries", "0", "entryId"], null], [["entries", "0", "duelCardId"], -1],
    [["entries", "0", "controllerId"], "outsider"], [["entries", "0", "registrationId"], {}],
    [["entries", "0", "sourceAtTrigger", "zone"], "hand_or_field"],
    [["entries", "0", "sourceAtTrigger", "faceUp"], 1],
    [["entries", "0", "sourceAtTrigger", "locationVersion"], -1],
    [["entries", "0", "sourceAtTrigger", "counters"], { funeral: -1 }],
    [["entries", "0", "sourceAtTrigger", "counters"], { funeral: "1" }],
    [["entries", "0", "sourceAtTrigger", "instanceId"], 123],
    [["entries", "0", "cardInstanceId"], 123], [["entries", "0", "materialize"], "callback"],
    [["referenceSnapshots"], {}], [["referenceSnapshots", "0", "sourceDuelCardId"], "7"],
    [["referenceSnapshots", "0", "references"], null],
    [["referenceSnapshots", "0", "references", "0", "targetId"], 1],
    [["referenceSnapshots", "0", "references", "0", "cards", "0", "duelCardId"], 0],
    [["snapshot", "card", "instanceId"], 123],
  ];
  for (const [path, value] of invalidFields) {
    const invalid = structuredClone(occurrence);
    let parent: object = invalid;
    for (const part of path.slice(0, -1)) {
      const next: unknown = Reflect.get(parent, part);
      assert.ok(next !== null && typeof next === "object");
      parent = next;
    }
    Reflect.set(parent, required(path.at(-1)), value);
    assert.throws(() => validateCanonicalReplay(withOccurrence(invalid)), /chain\.triggers/, path.join("."));
  }
  for (const field of ["timingRelevance", "entriesProvided", "entries", "referenceSnapshots", "snapshot"]) {
    const invalid = structuredClone(occurrence);
    Reflect.deleteProperty(invalid, field);
    assert.throws(() => validateCanonicalReplay(withOccurrence(invalid, true)), /chain\.triggers/, field);
  }
  const invalidCount = withOccurrence(occurrence);
  const invalidState = record(record(invalidCount.result).finalState);
  const invalidTriggers = record(record(invalidState.chain).triggers);
  invalidTriggers.pendingOccurrenceCount = 0;
  assert.throws(() => validateCanonicalReplay(invalidCount), /pendingOccurrenceCount/);
});

test("Miragebound editorial alignment rejects the former database signature with the current engine", () => {
  assert.throws(() => validateCanonicalReplay(replay({ cardDatabaseSignature: "4d85a5a8" })), /card database signature does not match/);
  assert.equal(validateCanonicalReplay(replay()).schemaVersion, 2);
});

test("Bloomrot editorial alignment rejects the former database signature with the current engine", () => {
  assert.throws(() => validateCanonicalReplay(replay({ cardDatabaseSignature: "c1fecb57" })), /card database signature does not match/);
  assert.equal(validateCanonicalReplay(replay()).schemaVersion, 2);
});

test("Tech-Zero procedure and resolution-choice alignment rejects the former database signature with the current engine", () => {
  assert.throws(() => validateCanonicalReplay(replay({ cardDatabaseSignature: "f60cba87" })), /card database signature does not match/);
  assert.equal(validateCanonicalReplay(replay()).schemaVersion, 2);
});

test("Ascension material editorial alignment rejects the former database signature with the same engine", () => {
  assert.equal(CANONICAL_REPLAY_ENGINE_VERSION, "engine-rules-v24");
  assert.throws(() => validateCanonicalReplay(replay({ cardDatabaseSignature: "7e5d54cb" })), /card database signature does not match/);
  assert.equal(validateCanonicalReplay(replay()).schemaVersion, 2);
});

test("P2 snapshots require typed copy usage and piercing provenance", t => {
  const game = createRuntimeGame({ captureReplay: false }); t.after(() => game.dispose());
  placeFieldCards(game.player.field, new Card(cardDefinition(355), "player"));
  const snapshot = createCanonicalStateSnapshot(game);
  for (const [field, value] of [["oncePerTurnResetVersion", -1], ["oncePerTurnUsageByName", null], ["oncePerTurnUsageByName", { bounce: { turn: 1, count: "1" } }]] as const) {
    const invalid = structuredClone(snapshot);
    Reflect.set(required(invalid.players.player.zones.field[0]), field, value);
    assert.throws(() => validateCanonicalReplay(replay({ result: { finalState: invalid } })), /oncePerTurn/);
  }
  for (const [field, value] of [["piercingGrantedByEffect", "true"], ["piercingDamageMultiplier", 0]] as const) {
    const invalid = structuredClone(snapshot);
    Reflect.set(required(invalid.players.player.zones.field[0]).statuses, field, value);
    assert.throws(() => validateCanonicalReplay(replay({ result: { finalState: invalid } })), /piercing/);
  }
});

test("field placement replay decisions validate actor, destination, candidates and cancellation", () => {
  const placement = {
    sequence: 1, decisionId: 1, kind: "field_placement", actorId: "player",
    candidateKeys: ["bot:field:2", "bot:field:4"],
    value: { outcome: "chosen", slot: 4 },
    context: { procedureId: "placement_1", decidingPlayerId: "player", destinationPlayerId: "bot", row: "field", duelCardId: 7, allowCancel: false },
  };
  assert.doesNotThrow(() => validateCanonicalReplay(replay({ decisions: [placement] })));
  for (const invalid of [
    { ...placement, actorId: "bot" },
    { ...placement, candidateKeys: ["player:field:4"] },
    { ...placement, candidateKeys: ["bot:field:4", "bot:field:4"] },
    { ...placement, value: { outcome: "chosen", slot: 3 } },
    { ...placement, value: { outcome: "chosen", slot: 5 } },
    { ...placement, value: { outcome: "cancelled" } },
    { ...placement, value: { pass: true } },
    { ...placement, context: null },
  ]) assert.throws(() => validateCanonicalReplay(replay({ decisions: [invalid] })), /Invalid canonical replay/);
});

test("Chain response replay validates exact decisions and rejects execution context", () => {
  const value = { pass: false, candidateKey: "1:response:spellTrap", effectId: "response", decisions: {
    selections: { target: [2] }, cases: { mode: "increase" }, specialSummons: { revive: [2, 3] },
    specialSummonRevalidation: { revive: "remaining" },
    synchroSummons: { summon: { synchroDuelCardId: 4, materialDuelCardIds: [2, 3], position: "attack" } },
  } };
  const decision = { sequence: 1, decisionId: 1, kind: "chain_response", actorId: "bot", candidateKeys: [value.candidateKey], value, context: null };
  assert.doesNotThrow(() => validateCanonicalReplay(replay({ decisions: [decision] })));
  for (const invalid of [
    { ...value, activationContext: { costsPaid: true } },
    { ...value, decisions: { selections: { target: ["global-instance"] } } },
    { ...value, decisions: { selections: { target: [0] } } },
    { ...value, decisions: { selections: { target: [2, 2] } } },
    { ...value, decisions: { specialSummonRevalidation: { revive: "all" } } },
    { ...value, decisions: { synchroSummons: { summon: { synchroDuelCardId: 4, materialDuelCardIds: [2], position: "sideways" } } } },
    { ...value, decisions: { allowDuringResolving: true } },
    { pass: true, decisions: value.decisions },
  ]) assert.throws(() => validateCanonicalReplay(replay({ decisions: [{ ...decision, value: invalid }] })), /Invalid canonical replay/);
});

test("response reference choices retain validated Chain context before costs", () => {
  const context = { type: "chain_response_reference", chainId: 1, respondingToLinkId: 2, sourceDuelCardId: 7, effectId: "response" };
  const decision = { sequence: 1, decisionId: 1, kind: "choice", actorId: "bot", candidateKeys: ["7"],
    value: { selections: { chain_response_reference: [{ duelCardId: 7 }] } }, context };
  assert.doesNotThrow(() => validateCanonicalReplay(replay({ decisions: [decision] })));
  for (const [field, value] of [["chainId", 0], ["respondingToLinkId", "2"], ["sourceDuelCardId", -1], ["effectId", 5]] as const) {
    assert.throws(() => validateCanonicalReplay(replay({ decisions: [{ ...decision, context: { ...context, [field]: value } }] })), /context/);
  }
  assert.throws(() => validateCanonicalReplay(replay({ decisions: [{ ...decision, kind: "target" }] })), /context/);
});

test("active links validate frozen response references with canonical card identity", t => {
  const game = createRuntimeGame({ captureReplay: false });
  t.after(() => game.dispose());
  const presence = { cardDuelCardId: 7, controllerId: "bot", zone: "field", faceUp: true, locationVersion: 0 };
  const withLink = (link: object) => {
    const snapshot = createCanonicalStateSnapshot(game);
    Reflect.set(snapshot.chain, "links", [link]);
    return replay({ result: { finalState: snapshot } });
  };
  const references = [{ targetId: "selected_response_reference", cards: [presence] }];
  const responseReference = { chainId: 1, linkId: 2, duelCardId: 7 };
  assert.doesNotThrow(() => validateCanonicalReplay(withLink({ referenceSnapshots: references, responseReference })));
  for (const [field, value] of [["cardDuelCardId", -1], ["zone", "nowhere"], ["faceUp", null], ["locationVersion", -1], ["cardInstanceId", 55]] as const) {
    assert.throws(() => validateCanonicalReplay(withLink({ referenceSnapshots: [{ targetId: "selected_response_reference", cards: [{ ...presence, [field]: value }] }] })), /referenceSnapshots/);
  }
  for (const [field, value] of [["chainId", 0], ["linkId", "2"], ["duelCardId", -1], ["instanceId", 55]] as const) {
    assert.throws(() => validateCanonicalReplay(withLink({ responseReference: { ...responseReference, [field]: value } })), /responseReference/);
  }
});

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
  ["hand_summon_procedure", {
    duelCardId: 24, cardId: 24, position: "defense", materialIds: [1, 2, 3, 4, 5],
  }],
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
  assert.equal(input.engineVersion, CANONICAL_REPLAY_ENGINE_VERSION);
  assert.equal("events" in input, false);
  assert.equal("result" in input, false);
  assert.equal("finalized" in input, false);
});

test("validator aceita os comandos discriminados, incluindo procedimento da mão", () => {
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
    { type: "hand_summon_procedure", payload: { cardId: 24, materialIds: [0] } },
    { type: "hand_summon_procedure", payload: { cardId: 24, position: "sideways" } },
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
    /result\.finalState\.fieldPlacementSequence/,
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

test("rejeita versões incompatíveis antes de assinatura ou conteúdo", () => {
  assert.throws(
    () => validateCanonicalReplay({ reportVersion: 4 }),
    /Unsupported replay format \(legacy\/report version 4\)/,
  );
  assert.throws(
    () => validateCanonicalReplay({
      format: "shadow-duel-canonical-replay",
      schemaVersion: 1,
    }),
    /Unsupported canonical replay schema 1/,
  );
  assert.throws(
    () => validateCanonicalReplay({
      format: "shadow-duel-canonical-replay",
      schemaVersion: 2,
      cardDatabaseSignature: "00000000",
    }),
    /database signature/,
  );
  assert.throws(
    () => validateCanonicalReplay({
      format: "shadow-duel-canonical-replay",
      schemaVersion: 2,
      cardDatabaseSignature: getCardDatabaseSignature(),
    }),
    /missing setup, commands, or decisions/,
  );
});

test("phase-intent mode accepts canonical next/skip and preserves absent-mode records", () => {
  const withPayload = (payload: Record<string, unknown>) => replay({ commands: [
    { sequence: 1, type: "phase_intent", actorId: "player", payload },
  ] });
  for (const mode of ["next", "skip"]) {
    assert.doesNotThrow(() => validateCanonicalReplay(withPayload({ mode, fromPhase: "main2", toPhase: "end" })));
  }
  assert.doesNotThrow(() => validateCanonicalReplay(withPayload({ fromPhase: "main2", toPhase: "end" })));
  for (const mode of [null, false, 1, "advance", {}]) {
    assert.throws(() => validateCanonicalReplay(withPayload({ mode, fromPhase: "main2", toPhase: "end" })), /payload.mode/);
  }
});

test("paid reference snapshots are optional and deeply validated in serialized Chain state", t => {
  const game = createRuntimeGame({ captureReplay: false });
  t.after(() => game.dispose());
  const valid = { cost: [{ cardDuelCardId: 7, name: "Paid card", level: 4 }] };
  const invalidMaps: unknown[] = [null, [], { cost: null }, { cost: [null] },
    { cost: [{ cardDuelCardId: -1, name: "Paid card", level: 4 }] },
    { cost: [{ cardDuelCardId: 7, name: null, level: 4 }] },
    { cost: [{ cardDuelCardId: 7, name: "Paid card", level: "4" }] },
    { cost: [{ cardDuelCardId: 7, name: "Paid card", level: -1 }] },
    { cost: [{ cardDuelCardId: 7, name: "Paid card", level: 4, instanceId: 999 }] }];
    const withPayment = (payment: object) => {
      const snapshot = createCanonicalStateSnapshot(game);
      Reflect.set(snapshot.chain, "links", [{ costPayment: payment }]);
      return replay({ result: { finalState: snapshot } });
    };
    assert.doesNotThrow(() => validateCanonicalReplay(withPayment({ status: "paid", actions: [] })));
    assert.doesNotThrow(() => validateCanonicalReplay(withPayment({ status: "paid", actions: [], paidReferences: valid })));
    assert.doesNotThrow(() => validateCanonicalReplay(withPayment({ paidReferences:
      { cost: [{ cardDuelCardId: null, name: "", level: 0 }] } })));
    assert.doesNotThrow(() => validateCanonicalReplay(withPayment({ paidReferences:
      { cost: [{ cardDuelCardId: 7, name: "Paid card", level: 3.5 }] } })));
    for (const paidReferences of invalidMaps) {
      assert.throws(() => validateCanonicalReplay(withPayment({ paidReferences })), /paidReferences/,
        JSON.stringify(paidReferences));
    }
});

test("Tech-Zero P1 rejects old rules and old full signature independently", () => {
  assert.equal(CANONICAL_REPLAY_ENGINE_VERSION, "engine-rules-v24");
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "engine-rules-v19" })), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ cardDatabaseSignature: "c6aef06c" })), /database signature/);
  assert.equal(validateCanonicalReplay(replay()).schemaVersion, 2);
});

test("Tech-Zero P2 rejects the historical v20 envelope and signature independently", () => {
  assert.equal(CANONICAL_REPLAY_ENGINE_VERSION, "engine-rules-v24");
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "engine-rules-v20" })), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ cardDatabaseSignature: "f68bdfd5" })), /database signature/);
  assert.equal(validateCanonicalReplay(replay()).schemaVersion, 2);
});

test("Tech-Zero P3 rejects the historical v21 envelope and signature independently", () => {
  assert.equal(CANONICAL_REPLAY_ENGINE_VERSION, "engine-rules-v24");
  assert.throws(() => validateCanonicalReplay(replay({ engineVersion: "engine-rules-v21" })), /engineVersion/);
  assert.throws(() => validateCanonicalReplay(replay({ cardDatabaseSignature: "c0327049" })), /database signature/);
  assert.equal(validateCanonicalReplay(replay()).schemaVersion, 2);
});
