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
import * as chainActivation from "./chain/activation.js";
import * as chainLink from "./chain/link.js";
import * as chainTiming from "./chain/timing.js";
import * as chainSegoc from "./chain/segoc.js";
import * as chainUsage from "./chain/usage.js";
import * as chainFinalization from "./chain/finalization.js";
export {
  CHAIN_ACTIVATION_KINDS,
  CHAIN_EFFECT_KINDS,
  CHAIN_RESPONSE_CONTEXTS,
} from "./chain/link.js";
export { FAST_EFFECT_ORIGINS, FAST_EFFECT_STATES } from "./chain/timing.js";
export {
  SEGOC_GROUPS,
  TRIGGER_REQUIREMENTS,
  TRIGGER_TIMINGS,
} from "./chain/segoc.js";
export { USAGE_POLICIES } from "./chain/usage.js";

/**
 * @typedef {Object} PreparedActivation
 * @property {Object} card
 * @property {Object} controller
 * @property {Object} effect
 * @property {string} activationZone
 * @property {Object} costSelections
 * @property {Object} targetSelections
 * @property {Object} resolutionSelections
 * @property {Object} activationContext
 * @property {Object} activationAttempt
 * @property {boolean} committed
 * @property {boolean} costsPaid
 * @property {boolean} requiresSourceAtResolution
 */

/**
 * @typedef {Object} ChainLink
 * @property {number} chainId - Deterministic chain identity
 * @property {number} linkId - Deterministic link identity
 * @property {Object} controller - Player who controls the activation
 * @property {Object} opponent - Opponent of the controller
 * @property {Object} card - The card being activated
 * @property {Object} effect - The effect being activated
 * @property {string} effectId
 * @property {number} spellSpeed
 * @property {string} activationKind
 * @property {string} effectKind
 * @property {string} responseContextType
 * @property {Object} context - Activation context
 * @property {string} activationZone - Zone the source occupied at activation
 * @property {Object} costSelections - Choices made while paying costs
 * @property {Object} targetSelections - Targets declared at activation
 * @property {Object} resolutionSelections - Non-targeting choices made at resolution
 * @property {number} chainLevel - Position in chain (1, 2, 3...)
 * @property {boolean} costsPaid - Whether activationCosts were paid
 * @property {string} preparationStatus
 * @property {string} resolutionStatus
 * @property {string} finalizationStatus
 * @property {boolean} requiresSourceAtResolution - Whether the source must remain active
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
  constructor(game, options = {}) {
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

    /** @type {boolean} Whether an activation is being committed/paid */
    this.isPreparingActivation = false;

    /** @type {AbortController|null} Active human response prompt */
    this.activeResponseAbortController = null;

    /** @type {number} Human response timeout */
    this.responseTimeoutMs = Number.isFinite(options.responseTimeoutMs)
      ? Math.max(0, options.responseTimeoutMs)
      : 30000;

    /** @type {Function[]} Collector completion hooks for activation triggers */
    this.chainEventCompletions = [];

    /** @type {Map<Object, Set<Object>>} Trigger effects already offered in this window */
    this.chainTriggerEffectsOffered = new Map();

    /** @type {number} Current chain level counter */
    this.currentChainLevel = 0;

    /** @type {number} Next deterministic Fast Effect window identity */
    this.nextTimingWindowId = 1;

    /** @type {number} Next deterministic Trigger occurrence identity */
    this.nextTriggerOccurrenceId = 1;

    /** @type {number} Next deterministic atomic event-group identity */
    this.nextAtomicEventGroupId = 1;

    /** @type {number} Next deterministic Trigger opportunity identity */
    this.nextTriggerOpportunityId = 1;

    /** @type {number} Next deterministic Trigger candidate identity */
    this.nextTriggerCandidateId = 1;

    /** @type {Object[]} Event occurrences awaiting the next Trigger check */
    this.pendingTriggerOccurrences = [];

    /** @type {Object|null} Current auditable SEGOC opportunity */
    this.activeTriggerOpportunity = null;

    /** @type {Object|null} Trigger ordering/selection session */
    this.pendingTriggerSelection = null;

    /** @type {boolean} Re-entry guard for post-Chain Trigger flushing */
    this._flushingPendingTriggerOccurrences = false;

    /** @type {number|null} Active Fast Effect window identity */
    this.activeTimingWindowId = null;

    /** @type {number} Controlled timing-continuation depth */
    this.timingDepth = 0;

    /** @type {number} Next deterministic chain identity */
    this.nextChainId = 1;

    /** @type {number} Next deterministic link identity */
    this.nextLinkId = 1;

    /** @type {number} Next deterministic activation-usage reservation */

    /** @type {Map<number, Object>} Provisional "activate" limit reservations */

    /** @type {number} Next deterministic post-Chain finalization identity */
    this.nextFinalizationId = 1;

    /** @type {Object[]} Finalizations awaiting the end of CL1 */
    this.pendingChainFinalizations = [];

    /** @type {boolean} Whether post-Chain cleanup is currently running */
    this.isFinalizingChain = false;

    /** @type {ChainLink|null} Link whose deferred cleanup is running */
    this.currentFinalizingLink = null;

    /** @type {number|null} Identity of the chain currently being built/resolved */
    this.activeChainId = null;

    /** @type {ChainLink|null} Link currently outside the stack during resolution */
    this.currentResolvingLink = null;

    /** @type {Object} Serializable Fast Effect Timing state */
    this.fastEffectState = {
      state: chainTiming.FAST_EFFECT_STATES.OPEN,
      origin: chainTiming.FAST_EFFECT_ORIGINS.PHASE_START,
      timingWindowId: null,
      turnPlayerId: this.getCurrentTurnPlayer()?.id ?? null,
      actionPlayerId: this.getCurrentTurnPlayer()?.id ?? null,
      priorityPlayerId: this.getCurrentTurnPlayer()?.id ?? null,
      lastLinkControllerId: null,
      chainId: null,
      consecutivePasses: 0,
      phaseIntent: null,
    };

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
  //   botChooseChainResponse
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
// Canonical Chain Link contract
// -----------------------------------------------------------------------------

ChainSystem.prototype.createChainLink = chainLink.createChainLink;
ChainSystem.prototype.serializeChainLink = chainLink.serializeChainLink;
ChainSystem.prototype.markChainLinkActivationNegated =
  chainLink.markChainLinkActivationNegated;
ChainSystem.prototype.markChainLinkEffectNegated =
  chainLink.markChainLinkEffectNegated;
ChainSystem.prototype.recordChainSourceMovement =
  chainLink.recordChainSourceMovement;
ChainSystem.prototype.setChainLinkResolutionStatus =
  chainLink.setChainLinkResolutionStatus;

ChainSystem.prototype.getUsagePolicy = chainUsage.getUsagePolicy;
ChainSystem.prototype.checkActivationUsage = chainUsage.checkActivationUsage;
ChainSystem.prototype.reserveUsageForChainLink =
  chainUsage.reserveUsageForChainLink;
ChainSystem.prototype.settleUsageForChainLink =
  chainUsage.settleUsageForChainLink;
ChainSystem.prototype.releaseAllUsageReservations =
  chainUsage.releaseAllUsageReservations;

ChainSystem.prototype.queueChainFinalization =
  chainFinalization.queueChainFinalization;
ChainSystem.prototype.finalizeWholeChain =
  chainFinalization.finalizeWholeChain;
ChainSystem.prototype.getChainFinalizationState =
  chainFinalization.getChainFinalizationState;
ChainSystem.prototype.resetChainFinalizationState =
  chainFinalization.resetChainFinalizationState;

// -----------------------------------------------------------------------------
// Fast Effect Timing
// -----------------------------------------------------------------------------

ChainSystem.prototype.getFastEffectState = chainTiming.getFastEffectState;
ChainSystem.prototype.transitionFastEffectState =
  chainTiming.transitionFastEffectState;
ChainSystem.prototype.resolveTimingPlayer = chainTiming.resolveTimingPlayer;
ChainSystem.prototype.isOpenGameState = chainTiming.isOpenGameState;
ChainSystem.prototype.resetFastEffectTiming = chainTiming.resetFastEffectTiming;
ChainSystem.prototype.recordFastEffectPriority =
  chainTiming.recordFastEffectPriority;
ChainSystem.prototype.runFastEffectTiming = chainTiming.runFastEffectTiming;

// -----------------------------------------------------------------------------
// Simultaneous Trigger Effects / SEGOC
// -----------------------------------------------------------------------------

ChainSystem.prototype.allocateAtomicEventGroupId =
  chainSegoc.allocateAtomicEventGroupId;
ChainSystem.prototype.createTriggerOccurrence =
  chainSegoc.createTriggerOccurrence;
ChainSystem.prototype.queueTriggerOccurrence = chainSegoc.queueTriggerOccurrence;
ChainSystem.prototype.buildTriggerOpportunity =
  chainSegoc.buildTriggerOpportunity;
ChainSystem.prototype.collectTriggerCandidates =
  chainSegoc.collectTriggerCandidates;
ChainSystem.prototype.revalidateTriggerCandidate =
  chainSegoc.revalidateTriggerCandidate;
ChainSystem.prototype.orderTriggerCandidates =
  chainSegoc.orderTriggerCandidates;
ChainSystem.prototype.prepareTriggerOpportunity =
  chainSegoc.prepareTriggerOpportunity;
ChainSystem.prototype.prepareTriggerPackages = chainSegoc.prepareTriggerPackages;
ChainSystem.prototype.resolveTriggerOccurrences =
  chainSegoc.resolveTriggerOccurrences;
ChainSystem.prototype.getTriggerState = chainSegoc.getTriggerState;
ChainSystem.prototype.resetTriggerState = chainSegoc.resetTriggerState;

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
ChainSystem.prototype.getCurrentChainActivationContext =
  chainEffectMatching.getCurrentChainActivationContext;
ChainSystem.prototype.getEffectChainResponseContext =
  chainEffectMatching.getEffectChainResponseContext;
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
ChainSystem.prototype.getEffectActivationZones =
  chainActivationDiscovery.getEffectActivationZones;
ChainSystem.prototype.getActivationCandidateKey =
  chainActivationDiscovery.getActivationCandidateKey;
ChainSystem.prototype.revalidateActivationCandidate =
  chainActivationDiscovery.revalidateActivationCandidate;

// -----------------------------------------------------------------------------
// Activation lifecycle: preparation, costs, and root Chain Link
// -----------------------------------------------------------------------------

ChainSystem.prototype.createPreparedActivation =
  chainActivation.createPreparedActivation;
ChainSystem.prototype.effectRequiresSourceAtResolution =
  chainActivation.effectRequiresSourceAtResolution;
ChainSystem.prototype.getEffectActivationCosts =
  chainActivation.getEffectActivationCosts;
ChainSystem.prototype.getEffectActivationCommitActions =
  chainActivation.getEffectActivationCommitActions;
ChainSystem.prototype.getEffectResolutionActions =
  chainActivation.getEffectResolutionActions;
ChainSystem.prototype.payActivationCosts = chainActivation.payActivationCosts;
ChainSystem.prototype.applyActivationCommitActions =
  chainActivation.applyActivationCommitActions;
ChainSystem.prototype.publishChainLinkActivation =
  chainActivation.publishChainLinkActivation;
ChainSystem.prototype.appendActivationTriggerPackages =
  chainActivation.appendActivationTriggerPackages;
ChainSystem.prototype.completeActivationTriggerPackages =
  chainActivation.completeActivationTriggerPackages;
ChainSystem.prototype.prepareChainResponse =
  chainActivation.prepareChainResponse;
ChainSystem.prototype.openActivationChain =
  chainActivation.openActivationChain;
ChainSystem.prototype.openEventWindow = chainActivation.openEventWindow;

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

// -----------------------------------------------------------------------------
// Player Response: Attach methods from modular chain/playerResponse.js
// -----------------------------------------------------------------------------

ChainSystem.prototype.playerChooseChainResponse =
  chainPlayerResponse.playerChooseChainResponse;

// -----------------------------------------------------------------------------
// Selection: Attach methods from modular chain/selection.js
// -----------------------------------------------------------------------------

ChainSystem.prototype.effectRequiresTargets = chainSelection.effectRequiresTargets;
ChainSystem.prototype.getActivationCostTargetDefinitions =
  chainSelection.getActivationCostTargetDefinitions;
ChainSystem.prototype.getDeclaredTargetDefinitions =
  chainSelection.getDeclaredTargetDefinitions;
ChainSystem.prototype.getPlayerSelectionsForDefinitions =
  chainSelection.getPlayerSelectionsForDefinitions;
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
ChainSystem.prototype.getChainSourceValidity =
  chainResolution.getChainSourceValidity;
ChainSystem.prototype.isCardStillValid = chainResolution.isCardStillValid;
ChainSystem.prototype.determineCardZone = chainResolution.determineCardZone;
