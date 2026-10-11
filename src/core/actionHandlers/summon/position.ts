import type { ActionOf } from "../../contracts/actions.js";
import type {
  ActionRuntimeCard,
  EffectContext,
} from "../../contracts/actionRuntime.js";

function isObjectValue(value: unknown): value is object {
  return !!value && typeof value === "object";
}

/**
 * Contextual Special Summon position from action contexts in precedence order.
 * The first `specialSummonPositions` object wins whole, even when it is empty;
 * inside it, `byTargetRef` precedes `byName`, which precedes `default`.
 */
export function resolveSummonPositionPreference(
  sources: readonly unknown[],
  targetRef: string | null | undefined,
  cardName: string | null | undefined,
): "attack" | "defense" | null {
  const candidates = sources.map((source): unknown =>
    isObjectValue(source) ? Reflect.get(source, "specialSummonPositions") : null);
  const preferences = candidates.find(isObjectValue) ?? null;
  const byTargetRef: unknown = preferences ? Reflect.get(preferences, "byTargetRef") : null;
  const byTarget: unknown =
    targetRef && isObjectValue(byTargetRef)
      ? Reflect.get(byTargetRef, targetRef)
      : null;
  const byNameMap: unknown = preferences ? Reflect.get(preferences, "byName") : null;
  const byName: unknown =
    cardName && isObjectValue(byNameMap)
      ? Reflect.get(byNameMap, cardName)
      : null;
  const preferred: unknown =
    byTarget || byName || (preferences ? Reflect.get(preferences, "default") : null);
  return preferred === "attack" || preferred === "defense" ? preferred : null;
}

export function resolveContextualSummonPosition(
  action: Pick<ActionOf<"conditional_summon_from_hand">, "targetRef" | "position">,
  ctx: EffectContext,
  card: ActionRuntimeCard,
) {
  const preferred = resolveSummonPositionPreference(
    [ctx.actionContext, ctx.activationContext?.actionContext],
    action?.targetRef,
    card?.name,
  );
  return preferred ?? action.position;
}
