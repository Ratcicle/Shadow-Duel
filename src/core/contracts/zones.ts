/**
 * Internal zone state uses only these canonical values. In particular,
 * "banished" is the sole representation of the banished zone.
 */
export const CANONICAL_ZONES = Object.freeze([
  "deck",
  "hand",
  "field",
  "graveyard",
  "spellTrap",
  "fieldSpell",
  "extraDeck",
  "banished",
] as const);

export type CanonicalZone = (typeof CANONICAL_ZONES)[number];

/**
 * Legacy aliases are accepted only at explicit input boundaries and must be
 * normalized before entering duel state.
 */
export const LEGACY_ZONE_ALIASES = Object.freeze(["banish"] as const);

export type LegacyZoneAlias = (typeof LEGACY_ZONE_ALIASES)[number];
export type ZoneInput = CanonicalZone | LegacyZoneAlias;

export function isCanonicalZone(value: unknown): value is CanonicalZone {
  return (
    typeof value === "string" &&
    CANONICAL_ZONES.some((zone) => zone === value)
  );
}

export function isZoneInput(value: unknown): value is ZoneInput {
  return (
    isCanonicalZone(value) ||
    (typeof value === "string" &&
      LEGACY_ZONE_ALIASES.some((alias) => alias === value))
  );
}

/**
 * Normalizes the complete legacy input surface. Invalid values fail closed so
 * they cannot silently contaminate canonical state.
 */
export function normalizeZoneInput(value: ZoneInput): CanonicalZone {
  if (isCanonicalZone(value)) return value;
  if (value === "banish") return "banished";

  throw new TypeError(`Invalid zone input: ${String(value)}`);
}
