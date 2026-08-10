/**
 * Public Chain Link classification values. Existing replay, analytics and
 * response-window consumers depend on both these keys and literal values.
 */
export const CHAIN_ACTIVATION_KINDS = Object.freeze({
  SPELL_TRAP_CARD: "spell_trap_card_activation",
  SPELL_TRAP_EFFECT: "spell_trap_effect_activation",
  MONSTER_EFFECT: "monster_effect_activation",
} as const);

export type ChainActivationKind =
  (typeof CHAIN_ACTIVATION_KINDS)[keyof typeof CHAIN_ACTIVATION_KINDS];

export const CHAIN_EFFECT_KINDS = Object.freeze({
  TRIGGER: "trigger_effect",
  QUICK: "quick_effect",
  IGNITION: "ignition_effect",
  SPELL_TRAP: "spell_trap_effect",
  OTHER: "other_effect",
} as const);

export type ChainEffectKind =
  (typeof CHAIN_EFFECT_KINDS)[keyof typeof CHAIN_EFFECT_KINDS];

export const CHAIN_RESPONSE_CONTEXTS = Object.freeze({
  CARD_ACTIVATION: "card_activation",
  EFFECT_ACTIVATION: "effect_activation",
} as const);

export type ChainResponseContextType =
  (typeof CHAIN_RESPONSE_CONTEXTS)[keyof typeof CHAIN_RESPONSE_CONTEXTS];

/** Spell Speed values are intentionally numeric at every runtime boundary. */
export type SpellSpeed = 1 | 2 | 3;

/**
 * Registered response-window contexts. The object carrying one of these
 * discriminants lives in chainRuntime.ts so this foundational module remains
 * free of Game, Card, EffectEngine and selection dependencies.
 */
export const CHAIN_CONTEXT_TYPES = Object.freeze([
  "card_activation",
  "attack_declaration",
  "battle_step_open",
  "summon",
  "summon_attempt",
  "phase_change",
  "main_phase_action",
  "action_without_chain",
  "post_chain",
  "battle_damage",
  "damage_step",
  "battle_destroy",
  "effect_activation",
  "effect_targeted",
] as const);

export type ChainContextType = (typeof CHAIN_CONTEXT_TYPES)[number];

export function isChainContextType(value: unknown): value is ChainContextType {
  if (typeof value !== "string") return false;
  switch (value) {
    case "card_activation":
    case "attack_declaration":
    case "battle_step_open":
    case "summon":
    case "summon_attempt":
    case "phase_change":
    case "main_phase_action":
    case "action_without_chain":
    case "post_chain":
    case "battle_damage":
    case "damage_step":
    case "battle_destroy":
    case "effect_activation":
    case "effect_targeted":
      return true;
    default:
      return false;
  }
}

/**
 * Fast Effect timing also receives post-action labels which are not registered
 * response windows. Keeping the input vocabulary separate prevents those
 * labels from weakening the canonical ChainContext discriminant.
 */
export const FAST_EFFECT_CONTEXT_TYPES = Object.freeze([
  ...CHAIN_CONTEXT_TYPES,
  "after_summon",
  "monster_set",
  "summon_failed",
  "summon_negated",
  "trigger_chain",
] as const);

export type FastEffectContextType =
  (typeof FAST_EFFECT_CONTEXT_TYPES)[number];

/** Runtime values are re-exported by chain/timing and the ChainSystem facade. */
export const FAST_EFFECT_STATES = Object.freeze({
  OPEN: "open",
  ACTION_WITHOUT_CHAIN: "action_without_chain",
  TRIGGER_CHECK: "trigger_check",
  TRIGGER_CHAIN: "trigger_chain",
  FAST_EFFECT_WINDOW: "fast_effect_window",
  RESOLVING_CHAIN: "resolving_chain",
  POST_CHAIN_CHECK: "post_chain_check",
  PHASE_TRANSITION_INTENT: "phase_transition_intent",
} as const);

export type FastEffectStateName =
  (typeof FAST_EFFECT_STATES)[keyof typeof FAST_EFFECT_STATES];

export const FAST_EFFECT_ORIGINS = Object.freeze({
  PHASE_START: "phase_start",
  ACTION_WITHOUT_CHAIN: "action_without_chain",
  ACTIVATION: "activation",
  TRIGGER_CHAIN: "trigger_chain",
  POST_CHAIN: "post_chain",
  PHASE_TRANSITION_INTENT: "phase_transition_intent",
  SUMMON_ATTEMPT: "summon_attempt",
} as const);

export type FastEffectOrigin =
  (typeof FAST_EFFECT_ORIGINS)[keyof typeof FAST_EFFECT_ORIGINS];

/** Runtime values are re-exported by chain/segoc and the ChainSystem facade. */
export const SEGOC_GROUPS = Object.freeze({
  TURN_MANDATORY: "turn_player_mandatory",
  OPPONENT_MANDATORY: "opponent_mandatory",
  TURN_OPTIONAL: "turn_player_optional",
  OPPONENT_OPTIONAL: "opponent_optional",
} as const);

export type SegocGroup =
  (typeof SEGOC_GROUPS)[keyof typeof SEGOC_GROUPS];

export const TRIGGER_ELIGIBILITY_STATUSES = Object.freeze([
  "pending",
  "eligible",
  "rejected",
] as const);

export type TriggerEligibilityStatus =
  (typeof TRIGGER_ELIGIBILITY_STATUSES)[number];

/** Mutable lifecycle values stored directly on each Chain Link. */
export const CHAIN_PREPARATION_STATUSES = Object.freeze([
  "prepared",
  "committed",
] as const);

export type ChainPreparationStatus =
  (typeof CHAIN_PREPARATION_STATUSES)[number];

export const CHAIN_RESOLUTION_STATUSES = Object.freeze([
  "pending",
  "resolving",
  "resolved",
  "no_effect",
  "failed",
] as const);

export type ChainResolutionStatus =
  (typeof CHAIN_RESOLUTION_STATUSES)[number];

export const CHAIN_FINALIZATION_STATUSES = Object.freeze([
  "pending",
  "queued",
  "cancelled",
  "completed",
  "failed",
  "already_moved",
  "retained",
] as const);

export type ChainFinalizationStatus =
  (typeof CHAIN_FINALIZATION_STATUSES)[number];
