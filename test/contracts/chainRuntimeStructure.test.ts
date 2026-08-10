import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import ChainSystem, * as chainFacade from "../../src/core/ChainSystem.js";
import NullChainSystem from "../../src/core/NullChainSystem.js";
import * as chainBarrel from "../../src/core/chain/index.js";

const DIRECT_CHAIN_METHODS = [
  "constructor",
  "log",
  "getUI",
  "getOpponent",
  "getCurrentTurnPlayer",
  "getNonTurnPlayer",
] as const;

const LEGACY_ATTACHMENT_ORDER_SHA256 =
  "ff2fd082e95fc3f5112be4714ed44d78f18a8aa2698996bd4f9526df404a4ec6";
const LEGACY_CHAIN_INSTANCE_KEYS_SHA256 =
  "bd0d23fba93df5197278eea556d6e6fd570f1bd1fbf18a3ad2bea9f2458208d6";
const LEGACY_NULL_INSTANCE_KEYS_SHA256 =
  "f54a18657c12f8642bb90b1e69b621646cc6a9926550446111dc927afaa90817";
const LEGACY_NULL_PROTOTYPE_KEYS_SHA256 =
  "876404defbc57248603f6d889f2f224f48b3235463f6016d6e1705e91fdd8057";

const CHAIN_FACADE_EXPORTS = [
  "CHAIN_ACTIVATION_KINDS",
  "CHAIN_EFFECT_KINDS",
  "CHAIN_RESPONSE_CONTEXTS",
  "FAST_EFFECT_ORIGINS",
  "FAST_EFFECT_STATES",
  "SEGOC_GROUPS",
  "TRIGGER_REQUIREMENTS",
  "TRIGGER_TIMINGS",
  "USAGE_POLICIES",
  "default",
] as const;

const CHAIN_BARREL_EXPORTS = [
  "CHAIN_ACTIVATION_KINDS",
  "CHAIN_CONTEXTS",
  "CHAIN_EFFECT_KINDS",
  "CHAIN_RESPONSE_CONTEXTS",
  "FAST_EFFECT_ORIGINS",
  "FAST_EFFECT_STATES",
  "SEGOC_GROUPS",
  "TRIGGER_REQUIREMENTS",
  "TRIGGER_TIMINGS",
  "USAGE_POLICIES",
  "activation",
  "activationDiscovery",
  "botResponsePolicy",
  "effectMatching",
  "finalization",
  "link",
  "playerResponse",
  "responseWindow",
  "segoc",
  "selection",
  "spellSpeed",
  "stack",
  "timing",
  "usage",
] as const;

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function constructWithNullGame<Instance>(
  Constructor: abstract new (...args: never[]) => Instance,
): Instance {
  return Reflect.construct(Constructor, [null]) as Instance;
}

test("Chain facade and barrel preserve their exact runtime exports", () => {
  assert.deepEqual(Object.keys(chainFacade), CHAIN_FACADE_EXPORTS);
  assert.deepEqual(Object.keys(chainBarrel), CHAIN_BARREL_EXPORTS);
  assert.equal("CHAIN_CONTEXTS" in chainFacade, false);
});

test("ChainSystem preserves the 89 attached methods and their descriptors", () => {
  assert.equal(Object.getOwnPropertyNames(ChainSystem.prototype).length, 95);
  assert.deepEqual(
    Object.getOwnPropertyNames(ChainSystem.prototype).slice(0, 6),
    DIRECT_CHAIN_METHODS,
  );
  const directNames = new Set<string>(DIRECT_CHAIN_METHODS);
  const attachmentNames = Object.getOwnPropertyNames(ChainSystem.prototype)
    .filter((name) => !directNames.has(name));

  assert.equal(attachmentNames.length, 89);
  assert.equal(new Set(attachmentNames).size, 89);
  assert.equal(attachmentNames[0], "createChainLink");
  assert.equal(attachmentNames.at(-1), "determineCardZone");
  assert.equal(sha256(attachmentNames), LEGACY_ATTACHMENT_ORDER_SHA256);

  for (const name of attachmentNames) {
    const descriptor = Object.getOwnPropertyDescriptor(
      ChainSystem.prototype,
      name,
    );
    assert.equal(typeof descriptor?.value, "function", `${name} must be callable`);
    assert.deepEqual(
      descriptor && {
        writable: descriptor.writable,
        enumerable: descriptor.enumerable,
        configurable: descriptor.configurable,
      },
      {
        writable: true,
        enumerable: true,
        configurable: true,
      },
      `${name} must preserve its assignment descriptor`,
    );
  }

  for (const name of DIRECT_CHAIN_METHODS.slice(1)) {
    assert.equal(
      Object.getOwnPropertyDescriptor(ChainSystem.prototype, name)?.enumerable,
      false,
      `${name} must remain a non-enumerable class method`,
    );
  }
});

test("typed facades do not emit new instance fields", () => {
  const chain = constructWithNullGame(ChainSystem);
  const nullChain = constructWithNullGame(NullChainSystem);

  assert.equal(Object.keys(chain).length, 34);
  assert.equal(sha256(Object.keys(chain)), LEGACY_CHAIN_INSTANCE_KEYS_SHA256);
  assert.equal(Object.keys(nullChain).length, 18);
  assert.equal(sha256(Object.keys(nullChain)), LEGACY_NULL_INSTANCE_KEYS_SHA256);
});

test("NullChainSystem remains a small runtime facade", () => {
  const nullMethodNames = Object.getOwnPropertyNames(NullChainSystem.prototype);
  const nullMethods = new Set(nullMethodNames);
  const sharedRuntimeMethods = [
    "createPreparedActivation",
    "getPlayerSelectionsForDefinitions",
    "openActivationChain",
    "resolveTriggerOccurrences",
    "runFastEffectTiming",
    "cancelChain",
  ];

  for (const name of sharedRuntimeMethods) {
    assert.equal(nullMethods.has(name), true, `${name} must remain available`);
  }
  for (const internalName of [
    "buildTriggerOpportunity",
    "collectTriggerCandidates",
    "resolveChainLink",
    "startPendingChainSelection",
  ]) {
    assert.equal(
      nullMethods.has(internalName),
      false,
      `${internalName} belongs only to the full Chain host`,
    );
  }
  assert.ok(
    nullMethods.size < Object.getOwnPropertyNames(ChainSystem.prototype).length,
  );
  assert.equal(nullMethodNames.length, 47);
  assert.equal(sha256(nullMethodNames), LEGACY_NULL_PROTOTYPE_KEYS_SHA256);
  for (const name of nullMethodNames.slice(1)) {
    const descriptor = Object.getOwnPropertyDescriptor(
      NullChainSystem.prototype,
      name,
    );
    assert.equal(typeof descriptor?.value, "function", `${name} must be callable`);
    assert.equal(descriptor?.enumerable, false, `${name} must stay a class method`);
    assert.equal(descriptor?.writable, true);
    assert.equal(descriptor?.configurable, true);
  }
});
