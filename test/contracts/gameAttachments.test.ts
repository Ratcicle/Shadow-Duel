import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import Game from "../../src/core/Game.js";
import {
  GAME_ATTACHMENT_GROUPS,
  GAME_ATTACHMENT_NAMES,
  installGameAttachments,
  preflightGameAttachments,
} from "../../src/core/game/attachments.js";
import type { GameAttachmentGroupInput } from "../../src/core/game/attachments.js";
import {
  installReplayCommandCaptureBindings,
  REPLAY_CAPTURE_BINDINGS,
  REPLAY_CAPTURE_METHOD_NAMES,
} from "../../src/core/game/replay/capture.js";

const ATTACHMENT_ORDER_SHA256 =
  "fc6400fba83e32f89f7a234d36cd9fc7b6774032a2978bb50901ebc1d6cbc267";
const INSTALLED_NAME_ARITY_SHA256 =
  "961f066cace11f1bbd5378655f6c374855f8ec59af166a8f4ce78728fcde8e75";
const INSTALLED_DESCRIPTOR_SHA256 =
  "b199dbbf5359b2951631c37126edc06e0a92320f0eb4494d1de36fcae47bf82c";
const GROUP_ORDER_SHA256 =
  "2ccf3b785d43a0eeaaf3050dd5cadd613129e2aefb0210dd323e623ae9e9b85a";
const GROUP_SIZES_SHA256 =
  "da126f01ec034fd434177816923225d07d17290e5a18f36af171fa29044c7f28";
const REPLAY_CAPTURE_ORDER_SHA256 =
  "b36e191f856be3b4c0b71d8e62615082f51e851b481602f2686a0e8cef1c5010";

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function attachmentEntries() {
  const entries: Array<
    readonly [string, (...arguments_: never[]) => unknown]
  > = [];
  const groups: readonly GameAttachmentGroupInput[] = GAME_ATTACHMENT_GROUPS;
  for (const group of groups) {
    for (const [name, method] of group.entries) {
      assert.equal(typeof method, "function", `${group.name}.${name}`);
      if (typeof method === "function") {
        entries.push([
          name,
          method as (...arguments_: never[]) => unknown,
        ]);
      }
    }
  }
  return entries;
}

function assertAttachmentDescriptor(
  prototype: object,
  name: string,
  expected: (...arguments_: never[]) => unknown,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
  assert.deepEqual(descriptor, {
    value: expected,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

test("the 60 groups declare 219 direct references in canonical order", () => {
  const entries = attachmentEntries();
  const names = entries.map(([name]) => name);
  const groupNames = GAME_ATTACHMENT_GROUPS.map(({ name }) => name);
  const groupSizes = GAME_ATTACHMENT_GROUPS.map(({ name, entries }) => [
    name,
    entries.length,
  ]);

  assert.equal(GAME_ATTACHMENT_GROUPS.length, 60);
  assert.equal(entries.length, 219);
  assert.equal(new Set(names).size, 219);
  assert.deepEqual(names, GAME_ATTACHMENT_NAMES);
  assert.equal(names[0], "devDraw");
  assert.equal(names.at(-1), "hasCanonicalReplay");
  assert.equal(sha256(names), ATTACHMENT_ORDER_SHA256);
  assert.equal(sha256(groupNames), GROUP_ORDER_SHA256);
  assert.equal(sha256(groupSizes), GROUP_SIZES_SHA256);

  assert.equal(Object.isFrozen(GAME_ATTACHMENT_GROUPS), true);
  assert.equal(Object.isFrozen(GAME_ATTACHMENT_NAMES), true);
  for (const group of GAME_ATTACHMENT_GROUPS) {
    assert.equal(Object.isFrozen(group), true, group.name);
    assert.equal(Object.isFrozen(group.entries), true, group.name);
    for (const [name, method] of group.entries) {
      assert.equal(typeof method, "function", `${group.name}.${name}`);
    }
  }
});

test("installation preserves references and legacy descriptors", () => {
  const prototype = {};
  const entries = attachmentEntries();

  installGameAttachments(prototype);

  assert.deepEqual(Object.keys(prototype), GAME_ATTACHMENT_NAMES);
  for (const [name, method] of entries) {
    assert.equal(Reflect.get(prototype, name), method, name);
    assertAttachmentDescriptor(prototype, name, method);
  }
});

test("installation is idempotent for all 219 identical references", () => {
  const prototype = {};
  installGameAttachments(prototype);
  const before = Object.getOwnPropertyDescriptors(prototype);

  assert.doesNotThrow(() => installGameAttachments(prototype));
  assert.deepEqual(Object.getOwnPropertyDescriptors(prototype), before);
});

test("attachment collision preflight fails atomically before writing", () => {
  const prototype = {};
  const incompatible = (): false => false;
  Object.defineProperty(prototype, "hasCanonicalReplay", {
    value: incompatible,
    enumerable: true,
    writable: true,
    configurable: true,
  });

  assert.throws(
    () => installGameAttachments(prototype),
    /Incompatible Game prototype collision: hasCanonicalReplay/,
  );
  assert.equal(Object.hasOwn(prototype, "devDraw"), false);
  assert.equal(Reflect.get(prototype, "hasCanonicalReplay"), incompatible);
});

test("attachment preflight rejects missing, non-callable and duplicate references", () => {
  const method = (): true => true;
  const malformedCases: Array<{
    groups: readonly GameAttachmentGroupInput[];
    message: RegExp;
  }> = [
    {
      groups: [{ name: "missing", entries: [["method", undefined]] }],
      message: /Game attachment reference is missing: method/,
    },
    {
      groups: [{ name: "non-callable", entries: [["method", 1]] }],
      message: /Game attachment is not callable: method/,
    },
    {
      groups: [
        { name: "first", entries: [["method", method]] },
        { name: "second", entries: [["method", method]] },
      ],
      message: /Duplicate Game attachment: method/,
    },
  ];

  for (const malformed of malformedCases) {
    assert.throws(
      () => preflightGameAttachments({}, malformed.groups),
      malformed.message,
    );
  }
});

test("attachment rejects a non-extensible target without partial writes", () => {
  const prototype = Object.preventExtensions({});
  const groups: readonly GameAttachmentGroupInput[] = [
    {
      name: "test",
      entries: [
        ["first", (): void => {}],
        ["second", (): void => {}],
      ],
    },
  ];

  assert.throws(
    () => installGameAttachments(prototype, groups),
    /Game prototype is not extensible/,
  );
  assert.deepEqual(Object.keys(prototype), []);
});

test("the Game facade exposes direct attachments or marked replay wrappers", () => {
  const captureNames = new Set<string>(REPLAY_CAPTURE_METHOD_NAMES);

  for (const [name, method] of attachmentEntries()) {
    const installed = Reflect.get(Game.prototype, name);
    assert.equal(typeof installed, "function", name);
    assertAttachmentDescriptor(Game.prototype, name, installed);

    if (captureNames.has(name)) {
      assert.notEqual(installed, method, `${name} must be wrapped`);
      assert.equal(Reflect.get(installed, "_replayCaptureWrapped"), true, name);
      assert.equal(installed.name, "wrapped", name);
      assert.equal(installed.length, 0, name);
    } else {
      assert.equal(installed, method, name);
    }
  }

  const installedNames = Object.keys(Game.prototype);
  const nameArities = installedNames.map((name) => [
    name,
    Reflect.get(Game.prototype, name).length,
  ]);
  const descriptorFlags = installedNames.map((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(Game.prototype, name);
    return [
      name,
      descriptor?.enumerable,
      descriptor?.writable,
      descriptor?.configurable,
    ];
  });

  assert.deepEqual(installedNames, GAME_ATTACHMENT_NAMES);
  assert.equal(sha256(nameArities), INSTALLED_NAME_ARITY_SHA256);
  assert.equal(sha256(descriptorFlags), INSTALLED_DESCRIPTOR_SHA256);
});

test("an instance can monkeypatch an attachment without changing the prototype", () => {
  const game = new Game({ disableChains: true });
  const prototypeMethod = game.getOpponent;
  const replacement = (): null => null;

  Object.defineProperty(game, "getOpponent", {
    value: replacement,
    writable: true,
    enumerable: true,
    configurable: true,
  });

  assert.equal(game.getOpponent, replacement);
  assert.equal(Game.prototype.getOpponent, prototypeMethod);
  assert.notEqual(game.getOpponent, Game.prototype.getOpponent);
});

test("the 13 replay bindings are exact and wrapper installation is idempotent", () => {
  assert.equal(REPLAY_CAPTURE_METHOD_NAMES.length, 13);
  assert.equal(new Set(REPLAY_CAPTURE_METHOD_NAMES).size, 13);
  assert.equal(
    sha256(REPLAY_CAPTURE_METHOD_NAMES),
    REPLAY_CAPTURE_ORDER_SHA256,
  );
  assert.deepEqual(
    REPLAY_CAPTURE_BINDINGS.map(({ methodName }) => methodName),
    REPLAY_CAPTURE_METHOD_NAMES,
  );

  const before = REPLAY_CAPTURE_METHOD_NAMES.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(Game.prototype, name),
  ]);
  assert.doesNotThrow(() => installReplayCommandCaptureBindings(Game.prototype));
  const after = REPLAY_CAPTURE_METHOD_NAMES.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(Game.prototype, name),
  ]);
  assert.deepEqual(after, before);
});

test("a replay wrapper preserves results and records its canonical descriptor", async () => {
  const prototype = {
    nextPhase(): string {
      return "advanced";
    },
  };
  installReplayCommandCaptureBindings(prototype);
  const recorded: unknown[] = [];
  const host = Object.assign(Object.create(prototype), {
    captureReplayEnabled: true,
    replayMode: "live",
    _activeDeferredReplayCommandDescriptor: null,
    targetSelection: null,
    turn: "player",
    phase: "main1",
    getNextPhase: (): "battle" => "battle",
    recordReplayCommand(command: unknown): void {
      recorded.push(command);
    },
  });
  const wrapped = Reflect.get(host, "nextPhase");

  assert.equal(typeof wrapped, "function");
  assert.equal(await Reflect.apply(wrapped, host, []), "advanced");
  assert.deepEqual(recorded, [
    {
      type: "phase_intent",
      actorId: "player",
      payload: { fromPhase: "main1", toPhase: "battle" },
    },
  ]);
});

test("a replay wrapper defers its descriptor while selection is pending", async () => {
  const prototype = {
    nextPhase(): { needsSelection: true } {
      return { needsSelection: true };
    },
  };
  installReplayCommandCaptureBindings(prototype);
  const targetSelection: { replayCommandDescriptor?: unknown } = {};
  let recordCount = 0;
  const host = Object.assign(Object.create(prototype), {
    captureReplayEnabled: true,
    replayMode: "live",
    _activeDeferredReplayCommandDescriptor: null,
    targetSelection,
    turn: "bot",
    phase: "battle",
    getNextPhase: (): "main2" => "main2",
    recordReplayCommand(): void {
      recordCount += 1;
    },
  });
  const wrapped = Reflect.get(host, "nextPhase");

  assert.equal(typeof wrapped, "function");
  assert.deepEqual(await Reflect.apply(wrapped, host, []), {
    needsSelection: true,
  });
  assert.equal(recordCount, 0);
  assert.deepEqual(targetSelection.replayCommandDescriptor, {
    type: "phase_intent",
    actorId: "bot",
    payload: { fromPhase: "battle", toPhase: "main2" },
  });
});
