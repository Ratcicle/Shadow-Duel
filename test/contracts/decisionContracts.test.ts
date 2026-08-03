import assert from "node:assert/strict";
import test from "node:test";
import type {
  ChainResponseDecisionCandidate,
  RecordedDecision,
  SegocOrderDecisionCandidate,
} from "../../src/core/contracts/decisions.js";
import { DecisionBroker } from "../../src/core/game/decisions/broker.js";
import { buildSelectionCandidateKey } from "../../src/core/game/selection/contract.js";

function createHarness() {
  const decisions: RecordedDecision[] = [];
  const notifications: Array<{ eventName: string; payload: object }> = [];
  const broker = new DecisionBroker({
    recordReplayDecision(decision) {
      decisions.push(decision);
    },
    notify(eventName, payload) {
      notifications.push({ eventName, payload });
    },
  });
  return { broker, decisions, notifications };
}

function chainCandidate(key: string): ChainResponseDecisionCandidate {
  return {
    candidateKey: key,
    card: { name: key },
    effect: { id: `${key}_effect` },
    effectId: `${key}_effect`,
  };
}

function segocCandidate(id: number): SegocOrderDecisionCandidate {
  return {
    candidateId: id,
    controller: { id: "player", controllerType: "human" },
    card: { name: `trigger-${id}` },
    effect: { id: `effect-${id}` },
  };
}

test("DecisionBroker records exact legacy values and monotonic branded ids", () => {
  const { broker, decisions, notifications } = createHarness();
  const first = chainCandidate("first");
  const second = chainCandidate("second");

  const pass = broker.recordDecision(
    { kind: "chain_response", candidates: [first], actorId: "player" },
    null,
  );
  const chosen = broker.recordDecision(
    {
      kind: "chain_response",
      candidates: [first, second],
      actor: { id: "bot", controllerType: "ai" },
      contextSnapshot: {
        type: "effect_activation",
        chainId: 9,
        respondingToLinkId: 3,
      },
    },
    second,
  );

  assert.deepEqual(pass, {
    decisionId: 1,
    kind: "chain_response",
    actorId: "player",
    candidateKeys: ["first"],
    value: { pass: true },
    context: null,
  });
  assert.deepEqual(chosen.value, {
    pass: false,
    candidateKey: "second",
    effectId: "second_effect",
  });
  assert.equal(chosen.decisionId, 2);
  assert.equal(chosen.actorId, "bot");
  assert.equal(decisions.length, 2);
  assert.deepEqual(
    notifications.map(({ eventName }) => eventName),
    ["decision_made", "decision_made"],
  );
});

test("DecisionBroker keeps the legacy numeric SEGOC serialization behavior", async () => {
  const { broker, decisions } = createHarness();
  const first = segocCandidate(1);
  const second = segocCandidate(2);
  const result = await broker.requestDecision({
    kind: "segoc_order",
    actor: first.controller,
    candidates: [first, second],
    contextSnapshot: { group: "turn_player_mandatory", optional: false },
    resolveHuman: () => [2, 1],
  });

  assert.deepEqual(result, [2, 1]);
  assert.deepEqual(decisions[0].candidateKeys, [1, 2]);
  assert.deepEqual(decisions[0].value, { orderedCandidateKeys: [] });
});

test("DecisionBroker selects the provider, rejects illegal values and records once", async () => {
  const { broker, decisions, notifications } = createHarness();
  const legal = chainCandidate("legal");
  let aiCalls = 0;
  let humanCalls = 0;

  const aiResult = await broker.requestDecision({
    kind: "chain_response",
    actor: { id: "bot", controllerType: "ai" },
    candidates: [legal],
    resolveAI: () => {
      aiCalls += 1;
      return legal;
    },
    resolveHuman: () => {
      humanCalls += 1;
      return null;
    },
  });
  assert.strictEqual(aiResult, legal);

  const rejected = await broker.requestDecision({
    kind: "chain_response",
    actor: { id: "player", controllerType: "human" },
    candidates: [legal],
    resolveHuman: () => chainCandidate("illegal"),
  });
  assert.equal(rejected, null);
  assert.equal(aiCalls, 1);
  assert.equal(humanCalls, 0);
  assert.equal(decisions.length, 2);
  assert.ok(
    notifications.some(({ eventName }) => eventName === "decision_rejected"),
  );
});

test("DecisionBroker playback matches scalar, ordered, selection and custom values", async () => {
  const { broker } = createHarness();
  const first = chainCandidate("first");
  const second = chainCandidate("second");
  broker.loadReplayDecisions([
    {
      decisionId: 7,
      kind: "chain_response",
      value: { pass: false, candidateKey: "second", effectId: null },
    },
    {
      decisionId: 8,
      kind: "segoc_order",
      value: { orderedCandidateKeys: [2, 1] },
    },
    {
      decisionId: 9,
      kind: "target",
      value: { selections: { target: [{ key: "recorded" }] } },
    },
  ]);

  assert.strictEqual(
    await broker.requestDecision({
      kind: "chain_response",
      candidates: [first, second],
    }),
    second,
  );

  const firstTrigger = segocCandidate(1);
  const secondTrigger = segocCandidate(2);
  assert.deepEqual(
    await broker.requestDecision({
      kind: "segoc_order",
      candidates: [firstTrigger, secondTrigger],
    }),
    [secondTrigger, firstTrigger],
  );

  const selectionCandidate = {
    key: buildSelectionCandidateKey({ name: "runtime" }),
    name: "runtime candidate",
  };
  assert.deepEqual(
    await broker.requestDecision({
      kind: "target",
      candidates: [selectionCandidate],
      requireCandidate: false,
      deserializeReplayValue: (value) =>
        "selections" in value ? { target: [selectionCandidate.key] } : null,
    }),
    { target: [selectionCandidate.key] },
  );
});

test("DecisionBroker reports mismatch and replay illegality at the exact cursor", async () => {
  const { broker } = createHarness();
  const candidate = chainCandidate("legal");
  broker.loadReplayDecisions([
    { decisionId: 11, kind: "segoc_order", value: { pass: true } },
  ]);
  await assert.rejects(
    () =>
      broker.requestDecision({
        kind: "chain_response",
        candidates: [candidate],
      }),
    /mismatch at 1: expected chain_response/,
  );

  broker.loadReplayDecisions([
    {
      decisionId: 12,
      kind: "chain_response",
      value: { pass: false, candidateKey: "missing", effectId: null },
    },
  ]);
  await assert.rejects(
    () =>
      broker.requestDecision({
        kind: "chain_response",
        candidates: [candidate],
      }),
    /Replay decision 12 is no longer legal/,
  );
});
