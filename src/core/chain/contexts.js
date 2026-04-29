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

  summon: {
    description: "When a monster is summoned",
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

  battle_damage: {
    description: "When battle damage is about to be inflicted",
    allowedSpeeds: [2, 3],
    requiresChainWindow: true,
  },

  effect_activation: {
    description: "In response to a monster effect activation",
    allowedSpeeds: [2, 3],
    requiresChainWindow: false,
  },

  effect_targeted: {
    description: "When a card effect targets your card",
    allowedSpeeds: [2, 3],
    requiresChainWindow: true,
  },
};
