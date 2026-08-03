import assert from "node:assert/strict";
import test from "node:test";

import {
  handleBanish,
  handleRegisterReplacementEffect,
} from "../../src/core/actionHandlers/destruction.js";

type RuntimeCallable = (...arguments_: unknown[]) => unknown;

function isRuntimeCallable(candidate: unknown): candidate is RuntimeCallable {
  return typeof candidate === "function";
}

async function invokeRuntime(
  candidate: unknown,
  argumentsList: unknown[],
): Promise<unknown> {
  assert.equal(isRuntimeCallable(candidate), true);
  if (!isRuntimeCallable(candidate)) throw new TypeError("Expected function.");
  return await Reflect.apply(candidate, undefined, argumentsList);
}

function readProperty(value: unknown, key: string): unknown {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Expected object.");
  }
  return Reflect.get(value, key);
}

test("replacement action fallback preserves every legacy top-level option", async () => {
  const temporaryReplacementEffects: unknown[] = [];
  const player = { id: "player" };
  const opponent = { id: "opponent" };
  const game = {
    player,
    bot: opponent,
    turnCounter: 7,
    temporaryReplacementEffects,
  };
  const action = {
    type: "register_replacement_effect",
    replacementEffect: { type: "prevent_destruction" },
    owner: "opponent",
    id: "legacy-id",
    key: "legacy-key",
    durationTurns: 2,
    usesRemaining: 3,
    sourceName: "Legacy protection",
  };

  const result = await invokeRuntime(handleRegisterReplacementEffect, [
    action,
    { player, opponent },
    {},
    { game },
  ]);

  assert.equal(result, true);
  assert.equal(game.temporaryReplacementEffects.length, 1);
  const registered = game.temporaryReplacementEffects[0];
  assert.equal(readProperty(registered, "id"), "legacy-id");
  assert.equal(readProperty(registered, "uniqueKey"), "legacy-key");
  assert.equal(readProperty(registered, "ownerId"), "opponent");
  assert.equal(readProperty(registered, "usesRemaining"), 3);
  assert.equal(readProperty(registered, "expiresOnTurn"), 9);
});

test("banish tolerates partial players whose zone arrays are absent", async () => {
  const card = { name: "Partial-zone target", owner: "player" };
  const player = { id: "player" };
  const opponent = { id: "opponent" };
  let observedMoveOptions: unknown;
  let boardUpdates = 0;
  const game = {
    player,
    bot: opponent,
    async moveCard(
      _card: unknown,
      _owner: unknown,
      _destination: unknown,
      options: unknown,
    ) {
      observedMoveOptions = options;
      return { success: true };
    },
    updateBoard() {
      boardUpdates += 1;
    },
  };

  const result = await invokeRuntime(handleBanish, [
    { type: "banish", targetRef: "chosen" },
    { player },
    { chosen: [card] },
    { game },
  ]);

  assert.equal(result, true);
  assert.equal(readProperty(observedMoveOptions, "fromZone"), null);
  assert.equal(boardUpdates, 1);
});
