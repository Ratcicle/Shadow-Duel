/**
 * ChainSystem.js
 *
 * Sistema de Chain e Spell Speed para Shadow Duel.
 * Gerencia chain windows, validação de spell speed, e resolução de chains em ordem LIFO.
 *
 * Spell Speed Rules:
 * - Speed 1: Normal Spells, Ignition Effects (only during own Main Phase)
 * - Speed 2: Quick-Play Spells, Normal Traps, Continuous Traps, Quick Effects
 * - Speed 3: Counter Traps (can respond to anything, including Speed 2)
 *
 * Chain Resolution: Last In, First Out (LIFO)
 */

import * as chainSpellSpeed from "./chain/spellSpeed.js";
import * as chainStack from "./chain/stack.js";
import * as chainResolution from "./chain/resolution.js";
import * as chainEffectMatching from "./chain/effectMatching.js";
import * as chainActivationDiscovery from "./chain/activationDiscovery.js";
import * as chainResponseWindow from "./chain/responseWindow.js";
import * as chainBotResponsePolicy from "./chain/botResponsePolicy.js";
import * as chainPlayerResponse from "./chain/playerResponse.js";
import * as chainSelection from "./chain/selection.js";
import { CHAIN_CONTEXTS } from "./chain/contexts.js";

// Re-export for backwards compatibility (CHAIN_CONTEXTS used to live here)
export { CHAIN_CONTEXTS };

/**
 * @typedef {Object} ChainLink
 * @property {Object} card - The card being activated
 * @property {Object} player - The player activating the card
 * @property {Object} effect - The effect being activated
 * @property {Object} context - Activation context
 * @property {string} zone - Zone the card was activated from (hand, field, spellTrap, graveyard)
 * @property {Object|null} selections - Selected targets (if any)
 * @property {number} chainLevel - Position in chain (1, 2, 3...)
 */

/**
 * @typedef {Object} ChainContext
 * @property {string} type - Context type (from CHAIN_CONTEXTS)
 * @property {Object} [card] - Card that triggered the chain window
 * @property {Object} [player] - Player who triggered the chain window
 * @property {Object} [triggerPlayer] - Player whose action triggered this
 * @property {Object} [attacker] - Attacking monster (for attack_declaration)
 * @property {Object} [target] - Attack target (for attack_declaration)
 * @property {string} [fromPhase] - Previous phase (for phase_change)
 * @property {string} [toPhase] - New phase (for phase_change)
 * @property {string} [method] - Summon method (for summon)
 */

export default class ChainSystem {
  constructor(game) {
    /** @type {Object} Reference to main Game instance */
    this.game = game;

    /** @type {boolean} Whether a chain window is currently open */
    this.chainWindowOpen = false;

    /** @type {ChainContext|null} Current chain window context */
    this.chainWindowContext = null;

    /** @type {ChainLink[]} Stack of chain links (resolved LIFO) */
    this.chainStack = [];

    /** @type {boolean} Whether chain is currently resolving */
    this.isResolving = false;

    /** @type {Set<Object>} Cards currently being resolved (to prevent re-offering) */
    this.cardsBeingResolved = new Set();

    /** @type {Object|null} Paused chain link waiting on a human selection */
    this.pendingChainSelection = null;

    /** @type {number} Current chain level counter */
    this.currentChainLevel = 0;

    /** @type {boolean} Dev mode logging */
    this.devMode =
      typeof localStorage !== "undefined" &&
      localStorage.getItem("shadow_duel_dev_mode") === "true";
  }

  /**
   * Log message if dev mode is enabled
   * @param {...any} args - Arguments to log
   */
  log(...args) {
    if (this.devMode) {
      console.log("[ChainSystem]", ...args);
    }
  }

  /**
   * Get the UI reference from game
   * @returns {Object|null}
   */
  getUI() {
    return this.game?.ui || this.game?.renderer || null;
  }

  /**
   * Get the opponent of a player
   * @param {Object} player
   * @returns {Object}
   */
  getOpponent(player) {
    if (!this.game) return null;
    return player === this.game.player ? this.game.bot : this.game.player;
  }

  /**
   * Get the current turn player
   * @returns {Object}
   */
  getCurrentTurnPlayer() {
    if (!this.game) return null;
    return this.game.turn === "player" ? this.game.player : this.game.bot;
  }

  /**
   * Get the non-turn player
   * @returns {Object}
   */
  getNonTurnPlayer() {
    if (!this.game) return null;
    return this.game.turn === "player" ? this.game.bot : this.game.player;
  }

  // ============================================================
  // SPELL SPEED VALIDATION
  // Methods moved to src/core/chain/spellSpeed.js
  //   - getEffectSpellSpeed
  //   - getRequiredSpellSpeed
  //   - canActivateInChain
  // ============================================================

  // ============================================================
  // ACTIVATABLE CARDS FILTERING
  // Method moved to src/core/chain/activationDiscovery.js
  //   - getActivatableCardsInChain
  // ============================================================

  // ============================================================
  // CHAIN WINDOW MANAGEMENT
  // Methods moved to src/core/chain/responseWindow.js:
  //   openChainWindow, offerChainResponses, offerChainResponse
  // ============================================================

  // ============================================================
  // CHAIN RESPONSE POLICY AND SELECTION
  // Methods moved to src/core/chain/botResponsePolicy.js:
  //   botChooseChainResponse, getBotSelectionsForEffect, selectBestTargets
  // Methods moved to src/core/chain/playerResponse.js:
  //   playerChooseChainResponse
  // Methods moved to src/core/chain/selection.js:
  //   effectRequiresTargets, getPlayerSelectionsForEffect,
  //   resolveSelectionsToCards
  // ============================================================

  // addToChain moved to src/core/chain/stack.js

  // ============================================================
  // CHAIN RESOLUTION
  // ============================================================

  // Resolution methods moved to src/core/chain/resolution.js:
  //   resolveChain, resolveChainLink, isCardStillValid, determineCardZone

  // ============================================================
  // UTILITY METHODS
  // Stack queries moved to src/core/chain/stack.js:
  //   isChainWindowOpen, getChainLength, getLastChainLink,
  //   isChainResolving, cancelChain, getChainSummary
  // ============================================================
}

// -----------------------------------------------------------------------------
// Spell Speed: Attach methods from modular chain/spellSpeed.js
// -----------------------------------------------------------------------------

ChainSystem.prototype.getEffectSpellSpeed = chainSpellSpeed.getEffectSpellSpeed;
ChainSystem.prototype.getRequiredSpellSpeed =
  chainSpellSpeed.getRequiredSpellSpeed;
ChainSystem.prototype.canActivateInChain = chainSpellSpeed.canActivateInChain;

// -----------------------------------------------------------------------------
// Effect Matching: Attach methods from modular chain/effectMatching.js
// -----------------------------------------------------------------------------

ChainSystem.prototype.effectCanRespondToContext =
  chainEffectMatching.effectCanRespondToContext;
ChainSystem.prototype.effectHasAction = chainEffectMatching.effectHasAction;
ChainSystem.prototype.isSummonNegationResponse =
  chainEffectMatching.isSummonNegationResponse;
ChainSystem.prototype.requiresExplicitSummonResponse =
  chainEffectMatching.requiresExplicitSummonResponse;
ChainSystem.prototype.isExplicitAfterSummonEventResponse =
  chainEffectMatching.isExplicitAfterSummonEventResponse;
ChainSystem.prototype.canOfferEffectInChainContext =
  chainEffectMatching.canOfferEffectInChainContext;
ChainSystem.prototype.findActivatableEffect =
  chainEffectMatching.findActivatableEffect;
ChainSystem.prototype.findQuickMonsterEffect =
  chainEffectMatching.findQuickMonsterEffect;

// -----------------------------------------------------------------------------
// Activation Discovery: Attach methods from modular chain/activationDiscovery.js
// -----------------------------------------------------------------------------

ChainSystem.prototype.getActivatableCardsInChain =
  chainActivationDiscovery.getActivatableCardsInChain;

// -----------------------------------------------------------------------------
// Response Window: Attach methods from modular chain/responseWindow.js
// -----------------------------------------------------------------------------

ChainSystem.prototype.openChainWindow = chainResponseWindow.openChainWindow;
ChainSystem.prototype.offerChainResponses =
  chainResponseWindow.offerChainResponses;
ChainSystem.prototype.offerChainResponse = chainResponseWindow.offerChainResponse;

// -----------------------------------------------------------------------------
// Bot Response Policy: Attach methods from modular chain/botResponsePolicy.js
// -----------------------------------------------------------------------------

ChainSystem.prototype.botChooseChainResponse =
  chainBotResponsePolicy.botChooseChainResponse;
ChainSystem.prototype.getBotSelectionsForEffect =
  chainBotResponsePolicy.getBotSelectionsForEffect;
ChainSystem.prototype.selectBestTargets = chainBotResponsePolicy.selectBestTargets;

// -----------------------------------------------------------------------------
// Player Response: Attach methods from modular chain/playerResponse.js
// -----------------------------------------------------------------------------

ChainSystem.prototype.playerChooseChainResponse =
  chainPlayerResponse.playerChooseChainResponse;

// -----------------------------------------------------------------------------
// Selection: Attach methods from modular chain/selection.js
// -----------------------------------------------------------------------------

ChainSystem.prototype.effectRequiresTargets = chainSelection.effectRequiresTargets;
ChainSystem.prototype.getPlayerSelectionsForEffect =
  chainSelection.getPlayerSelectionsForEffect;
ChainSystem.prototype.resolveSelectionsToCards =
  chainSelection.resolveSelectionsToCards;

// -----------------------------------------------------------------------------
// Stack: Attach methods from modular chain/stack.js
// -----------------------------------------------------------------------------

ChainSystem.prototype.addToChain = chainStack.addToChain;
ChainSystem.prototype.isChainWindowOpen = chainStack.isChainWindowOpen;
ChainSystem.prototype.getChainLength = chainStack.getChainLength;
ChainSystem.prototype.getLastChainLink = chainStack.getLastChainLink;
ChainSystem.prototype.isChainResolving = chainStack.isChainResolving;
ChainSystem.prototype.cancelChain = chainStack.cancelChain;
ChainSystem.prototype.getChainSummary = chainStack.getChainSummary;

// -----------------------------------------------------------------------------
// Resolution: Attach methods from modular chain/resolution.js
// -----------------------------------------------------------------------------

ChainSystem.prototype.resolveChain = chainResolution.resolveChain;
ChainSystem.prototype.resolveChainLink = chainResolution.resolveChainLink;
ChainSystem.prototype.startPendingChainSelection =
  chainResolution.startPendingChainSelection;
ChainSystem.prototype.resumePendingChainSelection =
  chainResolution.resumePendingChainSelection;
ChainSystem.prototype.isCardStillValid = chainResolution.isCardStillValid;
ChainSystem.prototype.determineCardZone = chainResolution.determineCardZone;
