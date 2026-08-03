import type {
  TriggerCardFilter,
  TriggerCollectorHost,
  TriggerPlayerReference,
  TriggerRuntimeCard,
  TriggerRuntimePlayer,
} from "../runtime.js";

export function getCardControllerId(
  card: TriggerRuntimeCard | null | undefined,
): string | null {
  return card?.controller || card?.owner || null;
}

export function matchesLastSummonMethod(
  card: TriggerRuntimeCard | null | undefined,
  allowed: string | readonly string[] | null | undefined,
): boolean {
  if (!allowed) return true;
  const allowedMethods = Array.isArray(allowed) ? allowed : [allowed];
  return allowedMethods.includes(card?.lastSummonMethod || null);
}

export function matchesLastSummonProcedure(
  card: TriggerRuntimeCard | null | undefined,
  allowed: string | readonly string[] | null | undefined,
): boolean {
  if (!allowed) return true;
  const allowedProcedures = Array.isArray(allowed) ? allowed : [allowed];
  return allowedProcedures.includes(card?.lastSummonProcedure || null);
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [value];
}

export function debugTriggerLog(
  engine: Pick<TriggerCollectorHost, "game"> | null | undefined,
  ...args: unknown[]
): void {
  if (engine?.game?.devModeEnabled) {
    console.log(...args);
  }
}

function isSameCardReference(
  a: TriggerRuntimeCard | number | string | null | undefined,
  b: TriggerRuntimeCard | number | string | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a.instanceId != null && b.instanceId != null) {
    return a.instanceId === b.instanceId;
  }
  return false;
}

export function matchesZoneFilter(
  actualZone: string | null | undefined,
  filterValue: string | readonly string[] | null | undefined,
): boolean {
  if (!filterValue || filterValue === "any") return true;
  return asArray(filterValue).includes(actualZone);
}

export function matchesOwnerFilter(
  filterValue: string | readonly string[] | null | undefined,
  sourceOwner: TriggerPlayerReference | undefined,
  eventOwner: TriggerPlayerReference | undefined,
): boolean {
  if (!filterValue || filterValue === "any") return true;
  const sourceOwnerId =
    typeof sourceOwner === "string" ? sourceOwner : sourceOwner?.id || null;
  const eventOwnerId =
    typeof eventOwner === "string" ? eventOwner : eventOwner?.id || null;
  if (filterValue === "self") return sourceOwnerId === eventOwnerId;
  if (filterValue === "opponent") return sourceOwnerId !== eventOwnerId;
  return asArray(filterValue).includes(eventOwnerId);
}

export function cardMatchesEventFilters(
  engine: Pick<TriggerCollectorHost, "cardMatchesFilters">,
  eventCard: TriggerRuntimeCard | null | undefined,
  filters: TriggerCardFilter | null | undefined,
  context: {
    readonly sourceOwner?: TriggerRuntimePlayer | null;
    readonly eventOwner?: TriggerRuntimePlayer | null;
    readonly fromZone?: string | null;
    readonly toZone?: string | null;
    readonly sourceCard?: TriggerRuntimeCard | null;
    readonly contextLabel?: string | null;
  } = {},
): boolean {
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
