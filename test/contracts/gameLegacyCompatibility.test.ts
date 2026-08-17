import assert from "node:assert/strict";
import test from "node:test";

import Card from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";
import Player from "../../src/core/Player.js";

test("Game decision facades preserve defaults, arity and broker arguments", async (t) => {
  const game = new Game({ disableChains: true, captureReplay: false });
  t.after(() => game.dispose("decision-compatibility-test"));

  assert.equal(Game.prototype.requestDecision.length, 0);
  assert.equal(Game.prototype.recordDecision.length, 0);

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
    game.dispose("zone-error-compatibility-test");
  }
});
