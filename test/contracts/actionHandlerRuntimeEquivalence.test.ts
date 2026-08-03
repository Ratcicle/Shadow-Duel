import assert from "node:assert/strict";
import test from "node:test";
import { handleRegisterTemporaryEventEffect } from "../../src/core/actionHandlers/conditional.js";
import { applyEndBattlePhase } from "../../src/core/effects/actions/combat.js";
import { applyAddCounter } from "../../src/core/effects/actions/counters.js";
import { applyDestroyAllOthersAndDraw } from "../../src/core/effects/actions/destroy.js";
import type { ActionOf } from "../../src/core/contracts/actions.js";

type RuntimeCallable = (...arguments_: unknown[]) => unknown;

function isRuntimeCallable(value: unknown): value is RuntimeCallable {
  return typeof value === "function";
}

async function invokeRuntime(
  candidate: unknown,
  thisArgument: unknown,
  argumentsList: unknown[],
): Promise<unknown> {
  assert.equal(isRuntimeCallable(candidate), true);
  if (!isRuntimeCallable(candidate)) {
    throw new TypeError("Expected runtime function.");
  }
  return await Reflect.apply(candidate, thisArgument, argumentsList);
}

test("temporary effects preserve legacy declared-value reference shapes", async () => {
  const stringDeclaration = {
    property: "type",
    value: "Dragon",
    duration: "end_of_turn",
  };
  const stateKeyDeclaration = {
    property: "attribute",
    value: "FIRE",
  };
  const keyDeclaration = {
    property: "level",
    value: 4,
  };
  const source = {
    id: 999,
    instanceId: 42,
    name: "Runtime Source",
    cardKind: "monster",
    declaredValues: {
      string_ref: stringDeclaration,
      state_key_ref: stateKeyDeclaration,
      key_ref: keyDeclaration,
    },
  };
  const player = {
    id: "player",
  };
  const game = {
    turnCounter: 7,
    temporaryEventEffects: [],
  };
  const action = {
    type: "register_temporary_event_effect",
    event: "battle_destroy",
    triggerRequirement: "mandatory",
    triggerTiming: "if",
    actions: [],
    declaredValueRef: "string_ref",
  } satisfies ActionOf<"register_temporary_event_effect">;

  Reflect.set(action, "declaredValueStateKey", {
    stateKey: "state_key_ref",
  });
  Reflect.set(action, "stateKey", { key: "key_ref" });

  const candidate: unknown = handleRegisterTemporaryEventEffect;
  assert.equal(isRuntimeCallable(candidate), true);
  if (!isRuntimeCallable(candidate)) {
    throw new TypeError("Expected temporary-effect handler to be callable.");
  }

  const result = await Reflect.apply(candidate, undefined, [
    action,
    { player, source },
    {},
    { game },
  ]);

  assert.equal(result, true);
  assert.equal(game.temporaryEventEffects.length, 1);
  const declaredValues = Reflect.get(
    game.temporaryEventEffects[0] ?? {},
    "declaredValues",
  );
  assert.deepEqual(declaredValues, {
    string_ref: stringDeclaration,
    state_key_ref: stateKeyDeclaration,
    key_ref: keyDeclaration,
  });
  assert.notStrictEqual(Reflect.get(declaredValues, "string_ref"), stringDeclaration);
  assert.notStrictEqual(
    Reflect.get(declaredValues, "state_key_ref"),
    stateKeyDeclaration,
  );
  assert.notStrictEqual(Reflect.get(declaredValues, "key_ref"), keyDeclaration);
});

test("counter events preserve legacy owner sentinels on partial games", async () => {
  const observedOwners: unknown[] = [];
  const host = {
    game: {
      turnCounter: 4,
      _arenaTracker: {
        recordEvent(_event: string, payload: object) {
          observedOwners.push(Reflect.get(payload, "player"));
        },
      },
    },
    ui: null,
  };

  for (const owner of ["player", "bot"] as const) {
    let counter = 0;
    const card = {
      name: `${owner} counter card`,
      cardKind: "monster",
      owner,
      controller: owner,
      addCounter() {
        counter += 1;
      },
      getCounter() {
        return counter;
      },
    };

    const result = await invokeRuntime(applyAddCounter, host, [
      { type: "add_counter", counterType: "charge", amount: 1 },
      { source: card },
      {},
    ]);
    assert.equal(result, true);
  }

  assert.deepEqual(observedOwners, ["player", "bot"]);
});

test("destroy-and-draw fails instead of reporting draws without a draw method", async () => {
  const source = { name: "Source", cardKind: "monster" };
  const otherMonster = { name: "Other", cardKind: "monster" };
  const player = {
    id: "player",
    field: [source, otherMonster],
  };
  let logCount = 0;
  const host = {
    game: {
      async destroyCard() {
        return { destroyed: true };
      },
    },
    ui: {
      log() {
        logCount += 1;
      },
    },
  };

  await assert.rejects(
    invokeRuntime(applyDestroyAllOthersAndDraw, host, [
      { type: "destroy_self_monsters_and_draw" },
      { player, source },
    ]),
    { name: "TypeError", message: "player.draw is not a function" },
  );
  assert.equal(logCount, 0);
});

test(
  "scheduled AI move preserves the legacy failure when makeMove disappears",
  { concurrency: false },
  () => {
    const originalSetTimeout = globalThis.setTimeout;
    const animationFrameDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "requestAnimationFrame",
    );
    const scheduledCallbacks: RuntimeCallable[] = [];
    const captureTimeout = (callback: unknown): number => {
      if (!isRuntimeCallable(callback)) {
        throw new TypeError("Expected timeout callback.");
      }
      scheduledCallbacks.push(callback);
      return scheduledCallbacks.length;
    };

    Reflect.set(globalThis, "setTimeout", captureTimeout);
    Reflect.deleteProperty(globalThis, "requestAnimationFrame");

    try {
      const actor = {
        id: "bot",
        controllerType: "ai",
        makeMove() {
          return true;
        },
      };
      const game = {
        phase: "battle",
        battleStep: "damage",
        turn: "bot",
        gameOver: false,
        player: { id: "player" },
        bot: actor,
      };

      const result = Reflect.apply(applyEndBattlePhase, { game }, []);
      assert.equal(result, true);
      assert.equal(scheduledCallbacks.length, 1);

      Reflect.deleteProperty(actor, "makeMove");
      assert.throws(
        () => Reflect.apply(scheduledCallbacks[0]!, undefined, []),
        /makeMove/,
      );
    } finally {
      Reflect.set(globalThis, "setTimeout", originalSetTimeout);
      if (animationFrameDescriptor) {
        Object.defineProperty(
          globalThis,
          "requestAnimationFrame",
          animationFrameDescriptor,
        );
      } else {
        Reflect.deleteProperty(globalThis, "requestAnimationFrame");
      }
    }
  },
);
