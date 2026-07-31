/**
 * Canonical summon methods recorded by rules, events and replay state.
 */
export const SUMMON_METHODS = Object.freeze([
  "normal",
  "tribute",
  "flip",
  "special",
  "fusion",
  "synchro",
  "ascension",
] as const);

export type SummonMethod = (typeof SUMMON_METHODS)[number];

/**
 * These keys and values are shared with the legacy transaction export. Their
 * runtime shape must remain stable for existing consumers.
 */
export const SUMMON_ORIGINS = Object.freeze({
  PROCEDURE: "procedure",
  EFFECT_RESOLUTION: "effect_resolution",
} as const);

export type SummonOrigin =
  (typeof SUMMON_ORIGINS)[keyof typeof SUMMON_ORIGINS];
