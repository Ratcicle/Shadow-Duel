import type { ActionOf } from "../../contracts/actions.js";
import type {
  ActionRuntimeCard,
  EffectContext,
} from "../../contracts/actionRuntime.js";

export function resolveContextualSummonPosition(
  action: ActionOf<"conditional_summon_from_hand">,
  ctx: EffectContext,
  card: ActionRuntimeCard,
) {
  const directPreferences =
    ctx.actionContext && typeof ctx.actionContext === "object"
      ? Reflect.get(ctx.actionContext, "specialSummonPositions")
      : null;
  const nestedActionContext = ctx.activationContext?.actionContext;
  const nestedPreferences =
    nestedActionContext && typeof nestedActionContext === "object"
      ? Reflect.get(nestedActionContext, "specialSummonPositions")
      : null;
  const preferences =
    directPreferences && typeof directPreferences === "object"
      ? directPreferences
      : nestedPreferences && typeof nestedPreferences === "object"
        ? nestedPreferences
        : null;
  const targetRef = action?.targetRef || null;
  const byTargetRef = preferences ? Reflect.get(preferences, "byTargetRef") : null;
  const byTarget =
    targetRef && byTargetRef && typeof byTargetRef === "object"
      ? Reflect.get(byTargetRef, targetRef)
      : null;
  const byNameMap = preferences ? Reflect.get(preferences, "byName") : null;
  const byName =
    card?.name && byNameMap && typeof byNameMap === "object"
      ? Reflect.get(byNameMap, card.name)
      : null;
  const preferred =
    byTarget || byName || (preferences ? Reflect.get(preferences, "default") : null);
  return preferred === "attack" || preferred === "defense"
    ? preferred
    : action.position;
}
