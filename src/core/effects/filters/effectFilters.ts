import type { EffectDefinition } from "../../contracts/effects.js";

type FilterEffect = Pick<
  EffectDefinition,
  "id" | "timing" | "event" | "requireZone"
>;
interface RuntimeEffectFilter {
  effectId?: string;
  id?: string;
  effectIds?: readonly string[];
  ids?: readonly string[];
  timing?: string | readonly string[];
  event?: string | readonly string[];
  requireZone?: string | readonly string[];
  activationZone?: string | readonly string[];
  effectType?: string | readonly string[];
  placementOnly?: boolean;
}
interface EffectFilterContext {
  activationZone?: string | null;
  effectType?: string | null;
  placementOnly?: boolean;
}

export function effectMatchesFilters(
  effect: FilterEffect | null | undefined,
  filters: RuntimeEffectFilter = {},
  context: EffectFilterContext = {},
) {
  if (!effect) return false;

  const idFilter = filters.effectId ?? filters.id;
  if (idFilter !== undefined && idFilter !== null && effect.id !== idFilter) {
    return false;
  }

  const idsFilter = filters.effectIds ?? filters.ids;
  if (
    Array.isArray(idsFilter) &&
    idsFilter.length > 0 &&
    !idsFilter.includes(effect.id)
  ) {
    return false;
  }

  if (filters.timing) {
    const timings: readonly unknown[] = Array.isArray(filters.timing)
      ? filters.timing
      : [filters.timing];
    if (!timings.includes(effect.timing)) return false;
  }

  if (filters.event) {
    const events: readonly unknown[] = Array.isArray(filters.event)
      ? filters.event
      : [filters.event];
    if (!events.includes(effect.event)) return false;
  }

  if (filters.requireZone) {
    const zones: readonly unknown[] = Array.isArray(filters.requireZone)
      ? filters.requireZone
      : [filters.requireZone];
    if (!zones.includes(effect.requireZone)) return false;
  }

  if (filters.activationZone) {
    const zones: readonly unknown[] = Array.isArray(filters.activationZone)
      ? filters.activationZone
      : [filters.activationZone];
    if (!zones.includes(context.activationZone || null)) return false;
  }

  if (filters.effectType) {
    const types: readonly unknown[] = Array.isArray(filters.effectType)
      ? filters.effectType
      : [filters.effectType];
    if (!types.includes(context.effectType || null)) return false;
  }

  if (
    typeof filters.placementOnly === "boolean" &&
    context.placementOnly !== filters.placementOnly
  ) {
    return false;
  }

  return true;
}
