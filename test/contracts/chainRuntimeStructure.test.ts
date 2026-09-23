import assert from "node:assert/strict";
import test from "node:test";

import ChainSystem from "../../src/core/ChainSystem.js";
import NullChainSystem from "../../src/core/NullChainSystem.js";
import { CHAIN_METHOD_NAMES } from "../../src/core/chain/attachments.js";

const DIRECT_CHAIN_METHODS = [
  "constructor",
  "log",
  "getUI",
  "getOpponent",
  "getCurrentTurnPlayer",
  "getNonTurnPlayer",
] as const;

test("ChainSystem exposes callable module methods without shadowing them on instances", () => {
  assert.deepEqual(
    Object.getOwnPropertyNames(ChainSystem.prototype).slice(0, 6),
    DIRECT_CHAIN_METHODS,
  );
  const directNames = new Set<string>(DIRECT_CHAIN_METHODS);
  const attachmentNames = Object.getOwnPropertyNames(ChainSystem.prototype)
    .filter((name) => !directNames.has(name));

  assert.deepEqual(attachmentNames, CHAIN_METHOD_NAMES);
  const chain = new ChainSystem(null);

  for (const name of attachmentNames) {
    assert.equal(Object.hasOwn(chain, name), false);
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
