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
