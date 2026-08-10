import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import ChainSystem from "../../src/core/ChainSystem.js";
import * as activation from "../../src/core/chain/activation.js";
import * as activationDiscovery from "../../src/core/chain/activationDiscovery.js";
import {
  attachChainMethods,
  CHAIN_ATTACHMENT_GROUPS,
  CHAIN_METHOD_MANIFEST,
  CHAIN_METHOD_NAMES,
  preflightChainAttachments,
} from "../../src/core/chain/attachments.js";
import type { ChainAttachmentGroupInput } from "../../src/core/chain/attachments.js";
import * as botResponsePolicy from "../../src/core/chain/botResponsePolicy.js";
import * as effectMatching from "../../src/core/chain/effectMatching.js";
import * as finalization from "../../src/core/chain/finalization.js";
import * as link from "../../src/core/chain/link.js";
import * as playerResponse from "../../src/core/chain/playerResponse.js";
import * as resolution from "../../src/core/chain/resolution.js";
import * as responseWindow from "../../src/core/chain/responseWindow.js";
import * as segoc from "../../src/core/chain/segoc.js";
import * as selection from "../../src/core/chain/selection.js";
import * as spellSpeed from "../../src/core/chain/spellSpeed.js";
import * as stack from "../../src/core/chain/stack.js";
import * as timing from "../../src/core/chain/timing.js";
import * as usage from "../../src/core/chain/usage.js";

const ATTACHMENT_ORDER_SHA256 =
  "ff2fd082e95fc3f5112be4714ed44d78f18a8aa2698996bd4f9526df404a4ec6";
const ATTACHMENT_ARITY_SHA256 =
  "be60c9a9ebd713db480c5a8b3105e1475d5c424ffd20e6901b80ca750bd8379e";

const EXPECTED_GROUP_IDS = [
  "link",
  "usage",
  "finalization",
  "timing",
  "segoc",
  "spellSpeed",
  "effectMatching",
  "activationDiscovery",
  "activation",
  "responseWindow",
  "botResponsePolicy",
  "playerResponse",
  "selection",
  "stack",
  "resolution",
] as const;

const EXPECTED_MODULE_BY_GROUP = {
  link,
  usage,
  finalization,
  timing,
  segoc,
  spellSpeed,
  effectMatching,
  activationDiscovery,
  activation,
  responseWindow,
  botResponsePolicy,
  playerResponse,
  selection,
  stack,
  resolution,
} as const;

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

test("the 15 groups install 89 direct references in canonical order", () => {
  assert.deepEqual(
    CHAIN_ATTACHMENT_GROUPS.map((group) => group.id),
    EXPECTED_GROUP_IDS,
  );
  assert.deepEqual(Object.keys(CHAIN_METHOD_MANIFEST), CHAIN_METHOD_NAMES);
  assert.equal(CHAIN_METHOD_NAMES.length, 89);
  assert.equal(new Set(CHAIN_METHOD_NAMES).size, 89);
  assert.equal(CHAIN_METHOD_NAMES[0], "createChainLink");
  assert.equal(CHAIN_METHOD_NAMES.at(-1), "determineCardZone");
  assert.equal(sha256(CHAIN_METHOD_NAMES), ATTACHMENT_ORDER_SHA256);

  const arities: Array<readonly [string, number]> = [];
  for (const group of CHAIN_ATTACHMENT_GROUPS) {
    const sourceModule = EXPECTED_MODULE_BY_GROUP[group.id];
    for (const [name, method] of Object.entries(group.methods)) {
      const sourceReference = Reflect.get(sourceModule, name);
      assert.equal(method, sourceReference, `${group.id}.${name}`);
      assert.equal(Reflect.get(CHAIN_METHOD_MANIFEST, name), method);
      assert.equal(Reflect.get(ChainSystem.prototype, name), method);
      arities.push([name, method.length]);

      const descriptor = Object.getOwnPropertyDescriptor(
        ChainSystem.prototype,
        name,
      );
      assert.deepEqual(descriptor, {
        value: method,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }
  assert.equal(sha256(arities), ATTACHMENT_ARITY_SHA256);
});

test("attachment is idempotent for all 89 existing references", () => {
  const before = Object.getOwnPropertyDescriptors(ChainSystem.prototype);
  const entries = preflightChainAttachments(ChainSystem.prototype);

  assert.equal(entries.length, 89);
  assert.equal(entries.every((entry) => entry.alreadyAttached), true);
  assert.doesNotThrow(() => attachChainMethods(ChainSystem.prototype));
  assert.deepEqual(
    Object.getOwnPropertyDescriptors(ChainSystem.prototype),
    before,
  );
});

test("attachment preflight rejects malformed groups and duplicates", () => {
  const method = (): true => true;
  const malformedCases: Array<{
    groups: readonly ChainAttachmentGroupInput[];
    message: RegExp;
  }> = [
    {
      groups: [{ id: "", methods: { method } }],
      message: /require a non-empty id/,
    },
    {
      groups: [{ id: "missing", methods: { method: undefined } }],
      message: /missing\.method is not a function/,
    },
    {
      groups: [
        { id: "first", methods: { method } },
        { id: "second", methods: { method } },
      ],
      message: /Duplicate Chain attachment: method/,
    },
  ];

  for (const malformed of malformedCases) {
    assert.throws(
      () => preflightChainAttachments({}, malformed.groups),
      malformed.message,
    );
  }
});

test("attachment collisions fail atomically before the first write", () => {
  const early = (): string => "early";
  const expectedLate = (): string => "expected";
  const incompatibleLate = (): string => "incompatible";
  const prototype = {};
  Object.defineProperty(prototype, "late", {
    value: incompatibleLate,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  const groups: readonly ChainAttachmentGroupInput[] = [
    { id: "early", methods: { early } },
    { id: "late", methods: { late: expectedLate } },
  ];

  assert.throws(
    () => attachChainMethods(prototype, groups),
    /Incompatible Chain prototype collision: late/,
  );
  assert.equal(Object.hasOwn(prototype, "early"), false);
  assert.equal(Reflect.get(prototype, "late"), incompatibleLate);
});

test("attachment rejects a non-extensible target without partial writes", () => {
  const prototype = Object.preventExtensions({});
  const groups: readonly ChainAttachmentGroupInput[] = [
    { id: "test", methods: { first(): void {}, second(): void {} } },
  ];

  assert.throws(
    () => attachChainMethods(prototype, groups),
    /Chain prototype is not extensible/,
  );
  assert.deepEqual(Object.keys(prototype), []);
});

test("instances can monkeypatch an attached method without changing the prototype", () => {
  const chain = new ChainSystem(null);
  const prototypeMethod = chain.createChainLink;
  const replacement = (): null => null;

  Object.defineProperty(chain, "createChainLink", {
    value: replacement,
    writable: true,
    enumerable: true,
    configurable: true,
  });

  assert.equal(chain.createChainLink, replacement);
  assert.equal(ChainSystem.prototype.createChainLink, prototypeMethod);
  assert.notEqual(chain.createChainLink, ChainSystem.prototype.createChainLink);
});
