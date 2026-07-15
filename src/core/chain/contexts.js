/**
 * contexts.js
 *
 * Chain window context definitions extracted from ChainSystem.js.
 * Tells the spell-speed validator which speeds are allowed inside each
 * type of chain window, and whether the window must be explicitly opened.
 */

export const CHAIN_CONTEXTS = {
  card_activation: {
    description: "In response to another card's activation",
    allowedSpeeds: [2, 3],
    requiresChainWindow: false,
  },

  attack_declaration: {
    description: "When an attack is declared",
    allowedSpeeds: [2, 3],
    requiresChainWindow: true,
  },

  battle_step_open: {
    description: "During an open Battle Step before the Damage Step",
    allowedSpeeds: [2, 3],
    requiresChainWindow: true,
  },

  summon: {
    description: "When a monster is summoned",
    allowedSpeeds: [2, 3],
    requiresChainWindow: true,
  },

  summon_attempt: {
    description: "When a monster would be summoned",
    allowedSpeeds: [2, 3],
    requiresChainWindow: true,
  },

  phase_change: {
    description: "During phase transition",
    allowedSpeeds: [2, 3],
    requiresChainWindow: true,
  },

  main_phase_action: {
    description: "During own Main Phase (quick action)",
    allowedSpeeds: [1, 2, 3],
    requiresChainWindow: false,
  },

  action_without_chain: {
    description: "After an action that did not start a Chain",
    allowedSpeeds: [2, 3],
    requiresChainWindow: true,
  },

  post_chain: {
    description: "After a Chain resolves with no pending Trigger Chain",
    allowedSpeeds: [2, 3],
    requiresChainWindow: true,
  },

  battle_damage: {
    description: "When battle damage is about to be inflicted",
    allowedSpeeds: [2, 3],
    requiresChainWindow: true,
  },

  battle_destroy: {
    description: "When a monster is destroyed by battle",
    allowedSpeeds: [2, 3],
    requiresChainWindow: true,
  },

  effect_activation: {
    description: "In response to an effect activation",
    allowedSpeeds: [2, 3],
    requiresChainWindow: false,
  },

  effect_targeted: {
    description: "When a card effect targets your card",
    allowedSpeeds: [2, 3],
    requiresChainWindow: true,
  },
};
