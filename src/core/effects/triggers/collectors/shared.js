export function getCardControllerId(card) {
  return card?.controller || card?.owner || null;
}

export function matchesLastSummonMethod(card, allowed) {
  if (!allowed) return true;
  const allowedMethods = Array.isArray(allowed) ? allowed : [allowed];
  return allowedMethods.includes(card?.lastSummonMethod || null);
}

export function matchesLastSummonProcedure(card, allowed) {
  if (!allowed) return true;
  const allowedProcedures = Array.isArray(allowed) ? allowed : [allowed];
  return allowedProcedures.includes(card?.lastSummonProcedure || null);
}

export function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

export function debugTriggerLog(engine, ...args) {
  if (engine?.game?.devModeEnabled) {
    console.log(...args);
  }
}

function isSameCardReference(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.instanceId != null && b.instanceId != null) {
    return a.instanceId === b.instanceId;
  }
  return false;
}

export function matchesZoneFilter(actualZone, filterValue) {
  if (!filterValue || filterValue === "any") return true;
  return asArray(filterValue).includes(actualZone);
}

export function matchesOwnerFilter(filterValue, sourceOwner, eventOwner) {
  if (!filterValue || filterValue === "any") return true;
  const sourceOwnerId = sourceOwner?.id || sourceOwner || null;
  const eventOwnerId = eventOwner?.id || eventOwner || null;
  if (filterValue === "self") return sourceOwnerId === eventOwnerId;
  if (filterValue === "opponent") return sourceOwnerId !== eventOwnerId;
  return asArray(filterValue).includes(eventOwnerId);
}

export function cardMatchesEventFilters(
  engine,
  eventCard,
  filters,
  context = {},
) {
  if (!filters || typeof filters !== "object") return true;
  if (!eventCard) return false;

  if (
    !matchesOwnerFilter(filters.owner, context.sourceOwner, context.eventOwner)
  ) {
    return false;
  }
  if (!matchesZoneFilter(context.fromZone, filters.fromZone)) {
    return false;
  }
  if (!matchesZoneFilter(context.toZone, filters.toZone)) {
    return false;
  }
  if (
    filters.eventCardIsEquippedToSource === true &&
    !(
      isSameCardReference(context.sourceCard?.equippedTo, eventCard) ||
      isSameCardReference(context.sourceCard?.equipTarget, eventCard) ||
      isSameCardReference(context.sourceCard?.lastEquippedCardLeftField, eventCard)
    )
  ) {
    return false;
  }

  const cardFilters = { ...filters };
  delete cardFilters.owner;
  delete cardFilters.fromZone;
  delete cardFilters.toZone;
  delete cardFilters.eventCardIsEquippedToSource;

  return engine.cardMatchesFilters(eventCard, cardFilters);
}
