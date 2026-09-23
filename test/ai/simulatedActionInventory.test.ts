import assert from "node:assert/strict";
import test from "node:test";

import { walkEffectActions } from "../../src/core/actionHandlers/actionWalker.js";
import { ACTION_CATALOG } from "../../src/core/actionHandlers/actionCatalog.js";
import {
  SIMULATED_ACTION_HANDLERS,
  applySimulatedActions,
} from "../../src/core/ai/common/simulatedActions/index.js";
import { cardDatabase } from "../../src/data/cards.js";

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

test("simulated action handlers implement declared action types", () => {
  for (const [type, handler] of Object.entries(SIMULATED_ACTION_HANDLERS)) {
    assert.equal(typeof handler, "function", type);
    assert.ok(Object.hasOwn(ACTION_CATALOG, type), type);
  }
});

test("the simulation inventory traverses valid database actions", () => {
  for (const type of collectUsedActionTypes()) {
    assert.ok(Object.hasOwn(ACTION_CATALOG, type), type);
  }
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
