import assert from "node:assert/strict";
import test from "node:test";

import Card from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";
import Player from "../../src/core/Player.js";

test("Game decision facades forward default inputs and results to the broker", async (t) => {
  const game = new Game({ disableChains: true, captureReplay: false });
  t.after(() => game.dispose("decision-broker-test"));

  let requestedInput: unknown;
  let recordedInput: unknown;
  let recordedResult: unknown;
  Reflect.set(game, "decisionBroker", {
    requestDecision(input: unknown) {
      requestedInput = input;
      return Promise.resolve(null);
    },
    recordDecision(input: unknown, result: unknown) {
      recordedInput = input;
      recordedResult = result;
      return { kind: "choice" };
    },
  });

  await game.requestDecision();
  const marker = { selected: true };
  Reflect.apply(game.recordDecision, game, [undefined, marker]);

  assert.deepEqual(requestedInput, {});
  assert.deepEqual(recordedInput, {});
  assert.strictEqual(recordedResult, marker);
});

test("Activation callbacks retain the configuration object as receiver", async (t) => {
  const game = new Game({
    disableChains: true,
    disableTraps: true,
    disableEffectActivation: true,
  });
  t.after(() => game.dispose("activation-receiver-test"));
  const card = new Card(
    {
      id: 9_994,
      name: "Activation receiver",
      cardKind: "spell",
      subtype: "normal",
      effects: [],
    },
    "player",
  );
  game.player.hand.push(card);

  let activationReceiver: unknown;
  let finalizationReceiver: unknown;
  const config = {
    card,
    owner: game.player,
    activationZone: "hand" as const,
    prepareForExistingChain: true,
    openActivationWindow: false,
    activate(this: unknown) {
      activationReceiver = this;
      return { success: true, ok: true, needsSelection: false };
    },
    finalize(this: unknown) {
      finalizationReceiver = this;
    },
  };

  const result = await game.runActivationPipeline(config);

  assert.equal(result.success, true);
  assert.strictEqual(activationReceiver, config);
  assert.strictEqual(finalizationReceiver, config);
});

test("Player summon re-reads a monkeypatched Game port during the transaction", async () => {
  const player = new Player("player", "Player");
  const card = new Card(
    {
      id: 9_995,
      name: "Dynamic Game port",
      cardKind: "monster",
      atk: 1_000,
      def: 1_000,
      level: 4,
      effects: [],
    },
    "player",
  );
  player.hand.push(card);

  const calls: string[] = [];
  const replacementGame = {
    async executeSummonTransaction(prepared: object) {
      calls.push("replacement:execute");
      const perform = Reflect.get(prepared, "perform");
      assert.equal(typeof perform, "function");
      return Reflect.apply(perform, prepared, [
        { summonId: 1, status: "committed" },
      ]);
    },
    async moveCard() {
      calls.push("replacement:move");
      return { success: true };
    },
    effectEngine: {
      clearTargetingCache() {
        calls.push("replacement:clear-cache");
      },
    },
  };
  const initialGame = {
    createPreparedSummon(input: object) {
      calls.push("initial:prepare");
      Reflect.set(player, "game", replacementGame);
      return input;
    },
    async executeSummonTransaction() {
      calls.push("initial:execute");
      return { success: false };
    },
  };
  Reflect.set(player, "game", initialGame);

  const result = await player.summon(0);

  assert.equal(result?.success, true);
  assert.deepEqual(calls, [
    "initial:prepare",
    "replacement:execute",
    "replacement:move",
    "replacement:clear-cache",
  ]);
});

test("board presentation callbacks retain the UI object as receiver", async (t) => {
  const game = new Game({ disableChains: true, captureReplay: false });
  t.after(() => game.dispose("board-receiver-test"));
  const ui = game.ui;
  const receivers: unknown[] = [];

  Reflect.set(ui, "playQueuedCardAnimations", function (this: unknown) {
    receivers.push(this);
  });
  Reflect.set(ui, "playVisualFeedback", function (this: unknown) {
    receivers.push(this);
  });
  Reflect.set(ui, "setPlayerFieldTributeable", () => {});
  Reflect.set(ui, "setPlayerFieldSelected", function (this: unknown) {
    receivers.push(this);
  });
  game.cardAnimationsReady = true;
  Reflect.set(game, "pendingCardAnimations", [{}]);
  Reflect.set(game, "pendingVisualFeedback", [{}]);
  Reflect.set(game, "pendingTributeSummonSelection", {
    active: true,
    ownerId: "player",
    tributeableIndices: [0],
    selectedTributes: [0],
  });

  await game.updateBoard();

  assert.deepEqual(receivers, [ui, ui, ui]);
});

test("repeated root zone ops with the same label always run the invariant check", (t) => {
  // The decision to roll back must never depend on wall-clock spacing.
  t.mock.method(Date, "now", () => 0);
  const errors: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    errors.push(args);
  });
  const game = new Game({ disableChains: true, captureReplay: false });
  t.after(() => game.dispose("zone-invariant-repeat-test"));
  const card = new Card(
    {
      id: 9_996,
      name: "Duplicated zone card",
      cardKind: "monster",
      atk: 1_000,
      def: 1_000,
      level: 4,
      effects: [],
    },
    "player",
  );
  game.player.hand.push(card);

  const valid = game.runZoneOp("repeated_label", () => "committed");
  assert.equal(valid, "committed");

  const corrupt = () =>
    game.runZoneOp("repeated_label", () => {
      game.player.graveyard.push(card);
      return "corrupted";
    });
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual(corrupt(), {
      success: false,
      reason: "STATE_INVARIANTS_FAILED",
      rolledBack: true,
    });
    assert.deepEqual(game.player.hand, [card]);
    assert.deepEqual(game.player.graveyard, []);
  }
  // Only the log is de-duplicated, by label and issue signature.
  assert.equal(errors.length, 1);
});

test("a nested zone op failing its invariant check leaves its depth level once", async (t) => {
  t.mock.method(console, "error", () => {});
  const game = new Game({ disableChains: true, captureReplay: false });
  t.after(() => game.dispose("zone-nested-failure-test"));
  const card = new Card(
    {
      id: 9_997,
      name: "Nested zone card",
      cardKind: "monster",
      atk: 1_000,
      def: 1_000,
      level: 4,
      effects: [],
    },
    "player",
  );
  game.player.hand.push(card);
  // Nested ops skip the real invariant scan, so the inner check is forced
  // critical; the root check of the outer op still runs for real.
  const assertStateInvariants = game.assertStateInvariants;
  Reflect.set(
    game,
    "assertStateInvariants",
    function (this: Game, ...args: Parameters<Game["assertStateInvariants"]>) {
      if (args[0] === "nested_inner") return { hasCritical: true };
      return Reflect.apply(assertStateInvariants, this, args);
    },
  );
  const corruptInner = () => {
    game.player.graveyard.push(card);
    return "corrupted";
  };

  for (const mode of ["sync", "async"] as const) {
    let depthAfterInner = -1;
    let innerError: unknown = null;
    const outer = async () => {
      try {
        await (mode === "sync"
          ? game.runZoneOp("nested_inner", corruptInner)
          : game.runZoneOp("nested_inner", async () => corruptInner()));
      } catch (error) {
        innerError = error;
      }
      depthAfterInner = game.zoneOpDepth;
      return "outer";
    };

    const result = await game.runZoneOp("nested_outer", outer);

    assert.equal(depthAfterInner, 1, `${mode}: the outer level stays open`);
    assert.ok(innerError instanceof Error);
    assert.equal(innerError.message, "STATE_INVARIANTS_FAILED");
    assert.deepEqual(result, {
      success: false,
      reason: "STATE_INVARIANTS_FAILED",
      rolledBack: true,
    });
    assert.equal(game.zoneOpDepth, 0);
    assert.deepEqual(game.player.hand, [card]);
    assert.deepEqual(game.player.graveyard, []);
  }
});

test("root invariant checks keep a pending selection and an active resolution lock", (t) => {
  const game = new Game({ disableChains: true, captureReplay: false });
  t.after(() => game.dispose("zone-invariant-selection-test"));
  // A selection pending in the middle of a resolution, outside any event.
  const pending = { state: "selecting", requirements: [], selections: {} };
  Reflect.set(game, "targetSelection", pending);
  game.setSelectionState("selecting");
  game.eventResolutionDepth = 0;
  for (let op = 0; op < 2; op++) {
    assert.equal(game.runZoneOp("pending_selection", () => "ok"), "ok");
    assert.strictEqual(game.targetSelection, pending);
    assert.equal(game.selectionState, "selecting");
  }

  Reflect.set(game, "targetSelection", null);
  game.setSelectionState("resolving");
  game.isResolvingEffect = true;
  assert.equal(game.runZoneOp("effect_resolution", () => "ok"), "ok");
  assert.equal(game.selectionState, "resolving");
});

test("zone rollback preserves messages from non-Error throwables", () => {
  const game = new Game({ disableChains: true, captureReplay: false });
  try {
    const result = game.runZoneOp("custom_throwable", () => {
      throw { message: "custom_zone_reason" };
    });
    assert.deepEqual(result, {
      success: false,
      reason: "custom_zone_reason",
      rolledBack: true,
    });
  } finally {
    game.dispose("zone-error-test");
  }
});

test("a failed summon cleanup records its move fault and still releases the summon guard", async (t) => {
  t.mock.method(console, "error", () => {});
  // The cleanup contains the fault even in strict mode: rethrowing here
  // would skip the release of the summon procedure guard.
  const game = new Game({ captureReplay: false, strictEngineFaults: true });
  t.after(() => game.dispose("summon-cleanup-fault-test"));
  const card = new Card(
    {
      id: 9_998,
      name: "Failed summon card",
      cardKind: "monster",
      atk: 1_000,
      def: 1_000,
      level: 4,
      effects: [],
    },
    "player",
  );
  game.player.hand.push(card);
  Reflect.set(game, "moveCard", async () => {
    throw new Error("cleanup move exploded");
  });

  const result = await game.executeSummonTransaction(
    game.createPreparedSummon({
      card,
      controller: game.player,
      sourceZone: "hand",
      summonOrigin: "effect_resolution",
      summonMode: "summon",
      summonMethod: "special",
      position: "attack",
      perform: () => ({ success: false, reason: "perform_failed" }),
    }),
  );

  assert.equal(result.success, false);
  assert.equal(game.engineFaults.length, 1);
  assert.equal(game.engineFaults[0]?.scope, "summon_transaction_cleanup");
  assert.equal(game.engineFaults[0]?.message, "cleanup move exploded");
  assert.equal(game.summonProcedureDepth, 0);
  assert.equal(game.activeSummonTransaction, null);
});
