/**
 * Blueprint action handlers.
 */

/**
 * Action: activate stored blueprint on a storage card (e.g., Grimorio).
 */
export async function handleActivateStoredBlueprint(
  action,
  ctx,
  targets,
  engine
) {
  if (!engine || typeof engine.activateStoredBlueprint !== "function") {
    return false;
  }
  return engine.activateStoredBlueprint(action, ctx, targets);
}
