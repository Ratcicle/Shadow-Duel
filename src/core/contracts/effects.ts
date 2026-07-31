/**
 * Effect timings currently accepted by CardDatabaseValidator. Values are kept
 * in validator order to make the runtime contract easy to audit.
 */
export const EFFECT_TIMINGS = Object.freeze([
  "on_play",
  "on_event",
  "on_activate",
  "ignition",
  "on_field_activate",
  "passive",
  "manual",
] as const);

export type EffectTiming = (typeof EFFECT_TIMINGS)[number];

/**
 * Trigger event names currently accepted by CardDatabaseValidator. This is not
 * yet a payload map; informational event-bus names remain outside this union.
 */
export const DUEL_EVENT_NAMES = Object.freeze([
  "after_summon",
  "battle_destroy",
  "battle_completed",
  "damage_step",
  "card_flipped",
  "battle_damage_inflicted",
  "card_to_grave",
  "card_moved",
  "counter_removed",
  "standby_phase",
  "end_phase",
  "attack_declared",
  "battle_damage",
  "opponent_damage",
  "before_destroy",
  "effect_targeted",
  "card_activation",
  "effect_activation",
  "card_equipped",
  "lp_change",
  "spell_activated",
  "effect_activated",
  "position_change",
] as const);

export type DuelEventName = (typeof DUEL_EVENT_NAMES)[number];

export const USAGE_POLICIES = Object.freeze({
  USE: "use",
  ACTIVATE: "activate",
} as const);

export type UsagePolicy =
  (typeof USAGE_POLICIES)[keyof typeof USAGE_POLICIES];

export const TRIGGER_REQUIREMENTS = Object.freeze({
  MANDATORY: "mandatory",
  OPTIONAL: "optional",
} as const);

export type TriggerRequirement =
  (typeof TRIGGER_REQUIREMENTS)[keyof typeof TRIGGER_REQUIREMENTS];

export const TRIGGER_TIMINGS = Object.freeze({
  IF: "if",
  WHEN: "when",
} as const);

export type TriggerTiming =
  (typeof TRIGGER_TIMINGS)[keyof typeof TRIGGER_TIMINGS];

/**
 * Damage Step ordering is persisted in transaction and event payloads. Keep
 * these values identical to the established quick-spell rule surface.
 */
export const DAMAGE_STEP_TIMINGS = Object.freeze({
  START: "start_of_damage_step",
  BEFORE_CALCULATION: "before_damage_calculation",
  CALCULATION: "damage_calculation",
  AFTER_CALCULATION: "after_damage_calculation",
  END: "end_of_damage_step",
} as const);

export type DamageStepTiming =
  (typeof DAMAGE_STEP_TIMINGS)[keyof typeof DAMAGE_STEP_TIMINGS];
