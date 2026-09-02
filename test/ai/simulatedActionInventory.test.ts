import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { walkEffectActions } from "../../src/core/actionHandlers/actionWalker.js";
import {
  SIMULATED_ACTION_HANDLERS,
  applySimulatedActions,
} from "../../src/core/ai/common/simulatedActions/index.js";
import { cardDatabase } from "../../src/data/cards.js";

const HANDLER_ORDER_SHA256 =
  "391c71c468cbb6939bfe55d2c7931219721a2425777bda3e1f7c780bbd9b32a6";
const USED_SUPPORTED_ORDER_SHA256 =
  "c566804f9ed363d08977a4ff19dfe1ce6d1634081f0f91417e7507631758f9f7";
const USED_UNSUPPORTED_ORDER_SHA256 =
  "77297e416750aa77d8d31a4a29922ee46e1986f0775af6e02a46f3406d191e57";

function digest(values: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function collectUsedActionTypes(): string[] {
  const types: string[] = [];
  const seen = new Set<string>();

  for (const card of cardDatabase) {
    for (const effect of card.effects ?? []) {
      const result = walkEffectActions(effect);
      assert.deepEqual(result.diagnostics, []);
      for (const visit of result.visits) {
        const action = visit.action;
        if (
          !action ||
          typeof action !== "object" ||
          !("type" in action) ||
          typeof action.type !== "string" ||
          seen.has(action.type)
        ) {
          continue;
        }
        seen.add(action.type);
        types.push(action.type);
      }
    }
  }

  return types;
}

function createState() {
  const player = {
    id: "player",
    lp: 8000,
    deck: [],
    hand: [],
    field: [],
    spellTrap: [],
    graveyard: [],
    extraDeck: [],
    banished: [],
    fieldSpell: null,
    summonCount: 0,
    additionalNormalSummons: 0,
  };
  const bot = {
    ...player,
    id: "bot",
    deck: [],
    hand: [],
    field: [],
    spellTrap: [],
    graveyard: [],
    extraDeck: [],
    banished: [],
    fieldSpell: null,
  };
  return {
    player,
    bot,
    turn: "bot",
    phase: "main1",
    turnCounter: 1,
  };
}

function applyRuntimeSimulatedActions(input: object): void {
  const runtimeApply: unknown = applySimulatedActions;
  if (typeof runtimeApply !== "function") {
    throw new TypeError("applySimulatedActions must remain callable");
  }
  Reflect.apply(runtimeApply, undefined, [input]);
}

test("simulated action handlers preserve the complete legacy order", () => {
  const types = Object.keys(SIMULATED_ACTION_HANDLERS);

  assert.equal(types.length, 64);
  assert.equal(digest(types), HANDLER_ORDER_SHA256);
  for (const [type, handler] of Object.entries(SIMULATED_ACTION_HANDLERS)) {
    assert.equal(typeof handler, "function", type);
  }
});

test("simulated action coverage preserves the database inventory", () => {
  const usedTypes = collectUsedActionTypes();
  const supported = usedTypes.filter((type) =>
    Object.hasOwn(SIMULATED_ACTION_HANDLERS, type),
  );
  const unsupported = usedTypes.filter(
    (type) => !Object.hasOwn(SIMULATED_ACTION_HANDLERS, type),
  );

  assert.equal(usedTypes.length, 100);
  assert.equal(supported.length, 62);
  assert.equal(unsupported.length, 38);
  assert.equal(digest(supported), USED_SUPPORTED_ORDER_SHA256);
  assert.equal(digest(unsupported), USED_UNSUPPORTED_ORDER_SHA256);
});

test("unknown simulated actions are recorded in encounter order and skipped", () => {
  const state = createState();

  applyRuntimeSimulatedActions({
    actions: [
      { type: "unknown_first" },
      { type: "unknown_second" },
      { type: "damage", player: "opponent", amount: 500 },
    ],
    selections: {},
    state,
  });

  assert.deepEqual(Reflect.get(state, "_simUnsupportedActions"), [
    "unknown_first",
    "unknown_second",
  ]);
  assert.equal(state.player.lp, 7500);
});

test("STOP_SIMULATION prevents all later actions from being applied", () => {
  const state = createState();

  applyRuntimeSimulatedActions({
    actions: [
      { type: "pay_lp", amount: 0 },
      { type: "damage", player: "opponent", amount: 500 },
    ],
    selections: {},
    state,
  });

  assert.equal(state.bot.lp, 8000);
  assert.equal(state.player.lp, 8000);
});

test("malformed action containers retain their permissive no-op behavior", () => {
  const state = createState();

  applyRuntimeSimulatedActions({
    actions: null,
    selections: {},
    state,
  });
  applyRuntimeSimulatedActions({
    actions: [null, undefined, {}, { type: "" }],
    selections: {},
    state,
  });

  assert.equal("_simUnsupportedActions" in state, false);
  assert.equal(state.bot.lp, 8000);
  assert.equal(state.player.lp, 8000);
});
