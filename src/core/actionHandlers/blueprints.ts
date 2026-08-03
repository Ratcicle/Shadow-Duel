/**
 * Blueprint action handlers.
 */

import type { ActionOf } from "../contracts/actions.js";
import type {
  ActionHandlerEnginePort,
  EffectContext,
  ResolvedTargetMap,
} from "../contracts/actionRuntime.js";

/**
 * Action: activate stored blueprint on a storage card (e.g., Grimorio).
 */
export async function handleActivateStoredBlueprint(
  action: ActionOf<"activate_stored_blueprint">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  if (!engine || typeof engine.activateStoredBlueprint !== "function") {
    return false;
  }
  return engine.activateStoredBlueprint(action, ctx, targets);
}
