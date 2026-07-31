import assert from "node:assert/strict";
import test from "node:test";
import {
  readContextValue,
  writeContextValue,
} from "../../src/core/contracts/actionRuntime.js";
import type {
  ActionHandler,
  EffectContext,
  ResolvedTargetMap,
} from "../../src/core/contracts/actionRuntime.js";
import {
  ActionHandlerRegistry,
  proxyEngineMethod,
} from "../../src/core/actionHandlers/registry.js";

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

const drawHandler: ActionHandler<"draw"> = (action) =>
  Number(action.amount) > 0;
const replacementDrawHandler: ActionHandler<"draw"> = () => null;

test("registry preserves identity, overwrite behavior, and insertion order", () => {
  const registry = new ActionHandlerRegistry();
  assert.deepEqual(registry.listTypes(), []);
  assert.equal(registry.get("draw"), null);
  assert.equal(registry.has("draw"), false);

  registry.register("draw", drawHandler);
  assert.strictEqual(registry.get("draw"), drawHandler);
  assert.equal(registry.has("draw"), true);
  assert.deepEqual(registry.listTypes(), ["draw"]);
  assert.strictEqual(registry.handlers.get("draw"), drawHandler);

  registry.register("draw", replacementDrawHandler);
  assert.strictEqual(registry.get("draw"), replacementDrawHandler);
  assert.deepEqual(registry.listTypes(), ["draw"]);

  registry.register("heal", () => true);
  assert.deepEqual(registry.listTypes(), ["draw", "heal"]);
});

test("registry has() preserves Map membership independently from get()", () => {
  const registry = new ActionHandlerRegistry();
  Reflect.apply(Map.prototype.set, registry.handlers, ["draw", undefined]);

  assert.equal(registry.has("draw"), true);
  assert.equal(registry.get("draw"), null);
  assert.deepEqual(registry.listTypes(), ["draw"]);
});

test("proxy forwards arguments, receiver, and asynchronous result", async () => {
  const action = { type: "draw", amount: 2, player: "self" } as const;
  const context: EffectContext = {};
  const targets: ResolvedTargetMap = {};
  let observedReceiver: unknown;
  let observedArguments: readonly unknown[] = [];
  const engine = {
    marker: "engine",
    async applyDraw(
      receivedAction: unknown,
      receivedContext: unknown,
      receivedTargets: unknown,
    ) {
      observedReceiver = this;
      observedArguments = [
        receivedAction,
        receivedContext,
        receivedTargets,
      ];
      return { success: true };
    },
  };

  const proxy = proxyEngineMethod<"draw">("applyDraw");
  const result = await invokeRuntime(proxy, [action, context, targets, engine]);

  assert.deepEqual(result, { success: true });
  assert.strictEqual(observedReceiver, engine);
  assert.strictEqual(observedArguments[0], action);
  assert.strictEqual(observedArguments[1], context);
  assert.strictEqual(observedArguments[2], targets);
});

test("proxy keeps the defensive missing-method guard and propagates errors", async () => {
  const action = { type: "draw", amount: 1 } as const;
  const context: EffectContext = {};
  const targets: ResolvedTargetMap = {};
  const proxy = proxyEngineMethod<"draw">("applyDraw");

  assert.equal(
    await invokeRuntime(proxy, [action, context, targets, {}]),
    false,
  );
  assert.equal(
    await invokeRuntime(proxy, [action, context, targets, null]),
    false,
  );
  assert.equal(
    await invokeRuntime(proxy, [action, context, targets, "engine"]),
    false,
  );
  assert.equal(
    await invokeRuntime(proxy, [action, context, targets, { applyDraw: 1 }]),
    false,
  );

  const failure = new Error("proxy failure");
  await assert.rejects(
    invokeRuntime(proxy, [
      action,
      context,
      targets,
      {
        applyDraw() {
          throw failure;
        },
      },
    ]),
    failure,
  );
});

test("context helpers isolate dynamic reads and writes", () => {
  const context: EffectContext = {};

  assert.equal(readContextValue(context, "storedCount"), undefined);
  assert.equal(writeContextValue(context, "storedCount", 3), true);
  assert.equal(readContextValue(context, "storedCount"), 3);
  assert.equal(writeContextValue(context, "", 4), false);
  assert.equal(writeContextValue(undefined, "storedCount", 4), false);
  assert.equal(readContextValue(null, "storedCount"), undefined);
});
