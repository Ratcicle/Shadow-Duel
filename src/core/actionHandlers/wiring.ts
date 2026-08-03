import {
  ACTION_BINDINGS,
  listActionBindingTypes,
} from "./actionBindings.js";
import {
  ActionHandlerRegistry,
  proxyEngineMethod,
} from "./registry.js";
import type { ActionType } from "../contracts/actions.js";

type ErasedRegister = (actionType: ActionType, handler: unknown) => void;

/**
 * Register the canonical binding manifest in its observable legacy order.
 *
 * ACTION_BINDINGS proves every key/handler correlation at compile time. This
 * bound call is the single erasure required to iterate that heterogeneous map.
 */
export function registerDefaultHandlers(registry: ActionHandlerRegistry): void {
  const register = registry.register.bind(registry) as ErasedRegister;

  for (const actionType of listActionBindingTypes()) {
    const binding = ACTION_BINDINGS[actionType];
    const handler =
      binding.kind === "direct"
        ? binding.handler
        : proxyEngineMethod(binding.method);
    register(actionType, handler);
  }
}
