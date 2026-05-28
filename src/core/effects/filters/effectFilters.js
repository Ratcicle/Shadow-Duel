export function effectMatchesFilters(effect, filters = {}, context = {}) {
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
    const timings = Array.isArray(filters.timing)
      ? filters.timing
      : [filters.timing];
    if (!timings.includes(effect.timing)) return false;
  }

  if (filters.event) {
    const events = Array.isArray(filters.event)
      ? filters.event
      : [filters.event];
    if (!events.includes(effect.event)) return false;
  }

  if (filters.requireZone) {
    const zones = Array.isArray(filters.requireZone)
      ? filters.requireZone
      : [filters.requireZone];
    if (!zones.includes(effect.requireZone)) return false;
  }

  if (filters.activationZone) {
    const zones = Array.isArray(filters.activationZone)
      ? filters.activationZone
      : [filters.activationZone];
    if (!zones.includes(context.activationZone || null)) return false;
  }

  if (filters.effectType) {
    const types = Array.isArray(filters.effectType)
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
