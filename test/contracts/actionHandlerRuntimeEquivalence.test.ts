import assert from "node:assert/strict";
import test from "node:test";
import { handleRegisterTemporaryEventEffect } from "../../src/core/actionHandlers/conditional.js";
import type { ActionOf } from "../../src/core/contracts/actions.js";

type RuntimeCallable = (...arguments_: unknown[]) => unknown;

function isRuntimeCallable(value: unknown): value is RuntimeCallable {
  return typeof value === "function";
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
