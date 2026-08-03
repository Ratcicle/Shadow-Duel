import assert from "node:assert/strict";
import test from "node:test";
import { ActionHandlerRegistry } from "../../src/core/actionHandlers/registry.js";
import type {
  EffectContext,
  LegacyActionHandlerResult,
  ResolvedTargetMap,
} from "../../src/core/contracts/actionRuntime.js";
import type { ActionOf, CardAction } from "../../src/core/contracts/actions.js";
import {
  actionResultSucceeded,
  applyActions,
} from "../../src/core/effects/actions/core.js";

type RuntimeCallable = (...arguments_: unknown[]) => unknown;

const DRAW_ACTION = {
  type: "draw",
  amount: 1,
  player: "self",
} as const satisfies ActionOf<"draw">;

function isRuntimeCallable(candidate: unknown): candidate is RuntimeCallable {
  return typeof candidate === "function";
}

function asResultRecord(value: unknown): object {
  assert.equal(value !== null && typeof value === "object", true);
  if (value === null || typeof value !== "object") {
    throw new TypeError("Expected an action result object.");
  }
  return value;
}

function resultValue(result: object, key: string): unknown {
  return Reflect.get(result, key);
}

async function invokeApplyActions(
  host: object,
  actions: readonly CardAction[],
  context: EffectContext = {},
  targets: ResolvedTargetMap = {},
): Promise<unknown> {
  const candidate: unknown = applyActions;
  assert.equal(isRuntimeCallable(candidate), true);
  if (!isRuntimeCallable(candidate)) {
    throw new TypeError("Expected applyActions to be callable.");
  }
  return await Reflect.apply(candidate, host, [actions, context, targets]);
}

function createHost(
  result: LegacyActionHandlerResult,
  options: { readonly skipForImmunity?: boolean } = {},
): object {
  const actionHandlers = new ActionHandlerRegistry();
  actionHandlers.register("draw", () => result);

  return {
    game: {},
    actionHandlers,
    filterTargetsByImmunity() {
      return options.skipForImmunity
        ? {
            skipAction: true,
            skippedCount: 1,
            allowedCount: 0,
            filteredTargets: {},
          }
        : {
            skipAction: false,
            skippedCount: 0,
            allowedCount: 0,
            filteredTargets: {},
          };
    },
  };
}

test("actionResultSucceeded preserves the legacy nullish semantics", () => {
  assert.equal(actionResultSucceeded(true), true);
  assert.equal(actionResultSucceeded(false), false);
  assert.equal(actionResultSucceeded(null), null);
  assert.equal(actionResultSucceeded(undefined), undefined);
  assert.equal(actionResultSucceeded({}), true);
  assert.equal(actionResultSucceeded({ success: true }), true);
  assert.equal(actionResultSucceeded({ success: false }), false);
  assert.equal(
    actionResultSucceeded({ needsSelection: true, selectionContract: {} }),
    false,
  );
});

test("applyActions normalizes every legacy handler result", async (t) => {
  const cases: readonly {
    readonly name: string;
    readonly handlerResult: LegacyActionHandlerResult;
    readonly success: boolean;
    readonly executed: boolean;
  }[] = [
    { name: "true", handlerResult: true, success: true, executed: true },
    { name: "false", handlerResult: false, success: false, executed: false },
    { name: "null", handlerResult: null, success: true, executed: false },
    {
      name: "undefined",
      handlerResult: undefined,
      success: true,
      executed: false,
    },
    { name: "empty object", handlerResult: {}, success: true, executed: true },
    {
      name: "explicit object success",
      handlerResult: { success: true },
      success: true,
      executed: true,
    },
    {
      name: "explicit object failure",
      handlerResult: { success: false, reason: "denied" },
      success: false,
      executed: false,
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const result = asResultRecord(
        await invokeApplyActions(createHost(entry.handlerResult), [DRAW_ACTION]),
      );
      assert.equal(resultValue(result, "success"), entry.success);
      assert.equal(resultValue(result, "executed"), entry.executed);
      assert.equal(resultValue(result, "needsSelection"), false);
      if (!entry.success) {
        assert.equal(resultValue(result, "failedAction"), "draw");
      }
    });
  }
});

test("applyActions stops for selection after preserving prior execution", async () => {
  const selectionContract = { kind: "cards", min: 1, max: 1 };
  const actionHandlers = new ActionHandlerRegistry();
  let invocation = 0;
  actionHandlers.register("draw", () => {
    invocation += 1;
    return invocation === 1
      ? true
      : { needsSelection: true, selectionContract };
  });
  const host = {
    ...createHost(undefined),
    actionHandlers,
  };

  const result = asResultRecord(
    await invokeApplyActions(host, [DRAW_ACTION, DRAW_ACTION]),
  );
  assert.equal(invocation, 2);
  assert.equal(resultValue(result, "needsSelection"), true);
  assert.equal(resultValue(result, "success"), false);
  assert.equal(resultValue(result, "executed"), true);
  assert.strictEqual(resultValue(result, "selectionContract"), selectionContract);
});

test("applyActions skips optional failures and immunity-filtered actions", async () => {
  const optionalAction = {
    type: "destroy",
    targetRef: "target",
    optional: true,
  } as const satisfies ActionOf<"destroy">;
  const actionHandlers = new ActionHandlerRegistry();
  actionHandlers.register("destroy", () => false);
  const optionalHost = {
    ...createHost(undefined),
    actionHandlers,
  };

  const optionalResult = asResultRecord(
    await invokeApplyActions(optionalHost, [optionalAction]),
  );
  assert.equal(resultValue(optionalResult, "success"), true);
  assert.equal(resultValue(optionalResult, "executed"), false);
  assert.equal(resultValue(optionalResult, "skippedCount"), 1);

  const zeroMinimumAction = {
    type: "discard_from_hand",
    count: { min: 0, max: 1 },
  } as const satisfies ActionOf<"discard_from_hand">;
  const zeroMinimumHandlers = new ActionHandlerRegistry();
  zeroMinimumHandlers.register("discard_from_hand", () => false);
  const zeroMinimumHost = {
    ...createHost(undefined),
    actionHandlers: zeroMinimumHandlers,
  };
  const zeroMinimumResult = asResultRecord(
    await invokeApplyActions(zeroMinimumHost, [zeroMinimumAction]),
  );
  assert.equal(resultValue(zeroMinimumResult, "success"), true);
  assert.equal(resultValue(zeroMinimumResult, "executed"), false);
  assert.equal(resultValue(zeroMinimumResult, "skippedCount"), 1);

  let calls = 0;
  const immunityHandlers = new ActionHandlerRegistry();
  immunityHandlers.register("draw", () => {
    calls += 1;
    return true;
  });
  const immunityHost = {
    ...createHost(undefined, { skipForImmunity: true }),
    actionHandlers: immunityHandlers,
  };
  const immunityResult = asResultRecord(
    await invokeApplyActions(immunityHost, [DRAW_ACTION]),
  );
  assert.equal(calls, 0);
  assert.equal(resultValue(immunityResult, "success"), true);
  assert.equal(resultValue(immunityResult, "executed"), false);
  assert.equal(resultValue(immunityResult, "skippedCount"), 1);

  const keptCard = { name: "Kept Target" };
  const filteredTargets: ResolvedTargetMap = { kept: keptCard };
  let observedTargets: ResolvedTargetMap | null = null;
  const filteringHandlers = new ActionHandlerRegistry();
  filteringHandlers.register("draw", (_action, _context, receivedTargets) => {
    observedTargets = receivedTargets;
    return true;
  });
  const filteringHost = {
    ...createHost(undefined),
    actionHandlers: filteringHandlers,
    filterTargetsByImmunity() {
      return {
        skipAction: false,
        skippedCount: 1,
        allowedCount: 1,
        filteredTargets,
      };
    },
  };
  const filteringResult = asResultRecord(
    await invokeApplyActions(filteringHost, [DRAW_ACTION], {}, {
      removed: { name: "Immune Target" },
      kept: keptCard,
    }),
  );
  assert.strictEqual(observedTargets, filteredTargets);
  assert.equal(resultValue(filteringResult, "success"), true);
  assert.equal(resultValue(filteringResult, "executed"), true);
});

test("applyActions reports missing handlers and thrown errors", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  t.mock.method(console, "error", () => undefined);

  const missingHost = {
    ...createHost(undefined),
    actionHandlers: new ActionHandlerRegistry(),
  };
  const missing = asResultRecord(
    await invokeApplyActions(missingHost, [DRAW_ACTION]),
  );
  assert.equal(resultValue(missing, "success"), false);
  assert.equal(resultValue(missing, "failedAction"), "draw");
  assert.match(String(resultValue(missing, "reason")), /No handler/);

  const failure = new Error("handler exploded");
  const throwingHandlers = new ActionHandlerRegistry();
  throwingHandlers.register("draw", () => {
    throw failure;
  });
  const throwingHost = {
    ...createHost(undefined),
    actionHandlers: throwingHandlers,
  };
  const thrown = asResultRecord(
    await invokeApplyActions(throwingHost, [DRAW_ACTION]),
  );
  assert.equal(resultValue(thrown, "success"), false);
  assert.equal(resultValue(thrown, "failedAction"), "draw");
  assert.equal(resultValue(thrown, "reason"), failure.message);
  assert.strictEqual(resultValue(thrown, "error"), failure);

  const legacyThrownValue = { message: "legacy thrown object" };
  const legacyThrowingHandlers = new ActionHandlerRegistry();
  legacyThrowingHandlers.register("draw", () => {
    throw legacyThrownValue;
  });
  const legacyThrown = asResultRecord(
    await invokeApplyActions(
      {
        ...createHost(undefined),
        actionHandlers: legacyThrowingHandlers,
      },
      [DRAW_ACTION],
    ),
  );
  assert.equal(resultValue(legacyThrown, "reason"), legacyThrownValue.message);
  assert.strictEqual(resultValue(legacyThrown, "error"), legacyThrownValue);
});
