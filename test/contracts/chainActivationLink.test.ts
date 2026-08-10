import assert from "node:assert/strict";
import test from "node:test";

import ChainSystem from "../../src/core/ChainSystem.js";
import { createPreparedActivation } from "../../src/core/chain/activation.js";
import type {
  ChainCard,
  ChainEffect,
  ChainPlayer,
} from "../../src/core/contracts/chainRuntime.js";

const PREPARED_ACTIVATION_KEYS = [
  "card",
  "controller",
  "effect",
  "activationZone",
  "costSelections",
  "targetSelections",
  "resolutionSelections",
  "costPayment",
  "activationCommitment",
  "activationContext",
  "activationAttempt",
  "activationKind",
  "effectKind",
  "responseContextType",
  "sourceAtTrigger",
  "sourceAtActivation",
  "usagePolicy",
  "committed",
  "costsPaid",
  "prepared",
  "requiresSourceAtResolution",
  "requiresSourceFaceUpAtResolution",
] as const;

const CHAIN_LINK_KEYS = [
  "chainId",
  "linkId",
  "chainLevel",
  "controller",
  "opponent",
  "card",
  "effect",
  "effectId",
  "spellSpeed",
  "activationZone",
  "activationKind",
  "effectKind",
  "responseContextType",
  "context",
  "activationContext",
  "activationAttempt",
  "costSelections",
  "targetSelections",
  "resolutionSelections",
  "resolvedSelectionCounts",
  "costPayment",
  "activationCommitment",
  "declaredTargets",
  "declaredTargetSnapshots",
  "targetValidation",
  "committed",
  "costsPaid",
  "usagePolicy",
  "usageReservation",
  "sourceAtTrigger",
  "sourceAtActivation",
  "requiresSourceAtResolution",
  "requiresSourceFaceUpAtResolution",
  "preparationStatus",
  "resolutionStatus",
  "finalizationStatus",
  "finalizationQueued",
  "activationNegated",
  "effectNegated",
  "sourceMoved",
  "sourceDestroyed",
  "latestSourceLocation",
  "resolvedWithoutEffect",
  "activationPublished",
  "effectTargetedResolved",
  "pipelineCompletion",
  "pipelineFinalization",
  "pipelineManaged",
  "skipDefaultFinalization",
  "triggerOpportunityId",
  "triggerOccurrenceId",
  "atomicGroupId",
  "segocGroup",
  "segocOrder",
] as const;

function createPlayer(): ChainPlayer {
  return {
    id: "player",
    name: "Player",
    controllerType: "human",
    lp: 8000,
    deck: [],
    extraDeck: [],
    hand: [],
    field: [],
    spellTrap: [],
    graveyard: [],
    banished: [],
    fieldSpell: null,
  };
}

test("PreparedActivation preserves its canonical key order and defaults", () => {
  const prepared = createPreparedActivation();

  assert.deepEqual(Object.keys(prepared), PREPARED_ACTIVATION_KEYS);
  assert.deepEqual(prepared.activationContext, {
    sourceWasFacedown: false,
    sourceZone: null,
    activationZone: null,
    sourceAtTrigger: null,
    sourceAtActivation: null,
  });
  assert.deepEqual(prepared.activationAttempt, {
    card: null,
    controller: null,
    effect: null,
    effectId: null,
    activationKind: "monster_effect_activation",
    activationZone: null,
    activationNegated: false,
  });
  assert.deepEqual(prepared.usagePolicy, {
    consumption: null,
    oncePerTurn: false,
    oncePerDuel: false,
    name: null,
    scope: null,
    perEventCard: false,
    limit: null,
  });
  assert.equal(prepared.prepared, true);
  assert.equal(prepared.committed, false);
  assert.equal(prepared.costsPaid, false);
  assert.equal(prepared.requiresSourceAtResolution, false);
  assert.equal(prepared.requiresSourceFaceUpAtResolution, false);
});

test("PreparedActivation rejects every removed legacy field at runtime", () => {
  for (const field of [
    "player",
    "zone",
    "activationType",
    "negated",
    "selections",
    "skipUsageRegistration",
  ]) {
    assert.throws(
      () => Reflect.apply(createPreparedActivation, null, [{ [field]: null }]),
      new RegExp(`PreparedActivation contains removed fields: ${field}`),
    );
  }

  assert.throws(
    () =>
      Reflect.apply(createPreparedActivation, null, [
        { activationAttempt: { player: null } },
      ]),
    /activationAttempt\.player/,
  );
  assert.throws(
    () =>
      Reflect.apply(createPreparedActivation, null, [
        { activationContext: { selections: {} } },
      ]),
    /activationContext\.selections/,
  );
});

test("Chain Link allocator brands stable integer identities and preserves shape", () => {
  const player = createPlayer();
  const card: ChainCard = {
    id: 700,
    name: "Chain source",
    cardKind: "monster",
    instanceId: 1700,
    locationVersion: 0,
  };
  const effect: ChainEffect = {
    id: "chain_source_effect",
    timing: "ignition",
    actions: [],
  };
  player.field.push(card);
  const chain = new ChainSystem(null);

  const first = chain.createChainLink({
    card,
    controller: player,
    effect,
    activationZone: "field",
  });
  const second = chain.createChainLink({
    card,
    controller: player,
    effect,
    activationZone: "field",
    committed: true,
    costsPaid: true,
  });

  assert.deepEqual(Object.keys(first), CHAIN_LINK_KEYS);
  assert.equal(first.chainId, 1);
  assert.equal(first.linkId, 1);
  assert.equal(first.chainLevel, 1);
  assert.equal(first.preparationStatus, "prepared");
  assert.equal(first.resolutionStatus, "pending");
  assert.equal(first.finalizationStatus, "pending");
  assert.equal(first.activationNegated, false);
  assert.equal(first.effectNegated, false);
  assert.deepEqual(first.sourceAtActivation, {
    cardInstanceId: 1700,
    controllerId: "player",
    zone: "field",
    faceUp: true,
    locationVersion: 0,
  });
  assert.deepEqual(first.declaredTargets, []);
  assert.deepEqual(first.declaredTargetSnapshots, []);
  assert.deepEqual(Object.keys(first.activationAttempt), [
    "chainId",
    "linkId",
    "card",
    "controller",
    "effect",
    "effectId",
    "activationKind",
    "activationZone",
    "activationNegated",
  ]);
  assert.equal(first.activationAttempt.chainId, first.chainId);
  assert.equal(first.activationAttempt.linkId, first.linkId);

  assert.equal(second.chainId, first.chainId);
  assert.equal(second.linkId, 2);
  assert.equal(second.preparationStatus, "committed");
  assert.equal(Number.isInteger(first.chainId), true);
  assert.equal(Number.isInteger(first.linkId), true);

  chain.activeChainId = null;
  const nextChain = chain.createChainLink({
    card,
    controller: player,
    effect,
    activationZone: "field",
  });
  assert.equal(nextChain.chainId, 2);
  assert.equal(nextChain.linkId, 3);
});
