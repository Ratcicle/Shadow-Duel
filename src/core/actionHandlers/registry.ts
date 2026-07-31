/**
 * Typed action-handler registry and compatibility proxy.
 *
 * The Map is intentionally heterogeneous. Its key/value correlation is erased
 * only while stored and restored by `get`, which is the single audited cast at
 * this runtime boundary.
 */

import type {
  ActionHandler,
  ActionHandlerEnginePort,
  EffectContext,
  LegacyActionHandlerResult,
  MaybePromise,
  ProxyActionType,
  ProxyMethodByAction,
  ResolvedTargetMap,
} from "../contracts/actionRuntime.js";
import type {
  ActionType,
  CardAction,
} from "../contracts/actions.js";
export type ProxyMethodName = ProxyMethodByAction[ProxyActionType];

export type ActionHandlerUnion = {
  [Type in ActionType]: ActionHandler<Type>;
}[ActionType];

type StoredActionHandler = (
  action: never,
  context: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) => MaybePromise<LegacyActionHandlerResult>;

function readStoredHandler(
  handlers: ReadonlyMap<string, StoredActionHandler>,
  actionType: string,
): StoredActionHandler | null {
  return handlers.get(actionType) || null;
}

export class ActionHandlerRegistry {
  readonly handlers = new Map<ActionType, StoredActionHandler>();

  register<Type extends ActionType>(
    actionType: Type,
    handler: ActionHandler<NoInfer<Type>>,
  ): void {
    this.handlers.set(actionType, handler);
  }

  get<Type extends ActionType>(actionType: Type): ActionHandler<Type> | null;
  get(actionType: string): ActionHandlerUnion | null;
  get(actionType: string): ActionHandlerUnion | null {
    const handler = readStoredHandler(this.handlers, actionType);
    if (!handler) return null;

    // The registry only accepts a handler correlated with this key in register().
    return handler as ActionHandlerUnion;
  }

  has(actionType: string): actionType is ActionType {
    return Boolean(
      Reflect.apply(Map.prototype.has, this.handlers, [actionType]),
    );
  }

  listTypes(): ActionType[] {
    return Array.from(this.handlers.keys());
  }
}

type RuntimeProxyMethod = (
  this: ActionHandlerEnginePort,
  action: CardAction,
  context: EffectContext,
  targets: ResolvedTargetMap,
) => MaybePromise<LegacyActionHandlerResult>;

function isRuntimeProxyMethod(value: unknown): value is RuntimeProxyMethod {
  return typeof value === "function";
}

/**
 * Create the legacy wrapper used by proxy bindings. Method discovery remains
 * defensive because plugins and tests may supply a partial engine at runtime.
 */
export function proxyEngineMethod<Type extends ProxyActionType>(
  methodName: ProxyMethodByAction[Type] & ProxyMethodName,
): ActionHandler<Type> {
  return async (action, context, targets, engine) => {
    if (
      engine === null ||
      (typeof engine !== "object" && typeof engine !== "function")
    ) {
      return false;
    }
    const candidate: unknown = Reflect.get(engine, methodName);
    if (!isRuntimeProxyMethod(candidate)) return false;

    return await Reflect.apply(candidate, engine, [action, context, targets]);
  };
}
