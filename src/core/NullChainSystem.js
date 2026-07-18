import { createPreparedActivation as normalizePreparedActivation } from "./chain/activation.js";
import {
  FAST_EFFECT_ORIGINS,
  FAST_EFFECT_STATES,
} from "./chain/timing.js";

export default class NullChainSystem {
  constructor(game = null) {
    this.game = game;
    this.chainsDisabled = true;
    this.chainWindowOpen = false;
    this.chainStack = [];
    this.isResolving = false;
    this.currentChainLevel = 0;
    this.activeChainId = null;
    this.nextTimingWindowId = 1;
    this.activeTimingWindowId = null;
    this.nextTriggerOccurrenceId = 1;
    this.nextAtomicEventGroupId = 1;
    this.nextTriggerOpportunityId = 1;
    this.nextFinalizationId = 1;
    this.pendingChainFinalizations = [];
    this.isFinalizingChain = false;
    this.currentFinalizingLink = null;
    this.pendingTriggerOccurrences = [];
    this.fastEffectState = {
      state: FAST_EFFECT_STATES.OPEN,
      origin: FAST_EFFECT_ORIGINS.PHASE_START,
      timingWindowId: null,
      turnPlayerId: null,
      actionPlayerId: null,
      priorityPlayerId: null,
      lastLinkControllerId: null,
      chainId: null,
      consecutivePasses: 0,
      phaseIntent: null,
    };
  }

  log() {}
  isChainResolving() {
    return this.isResolving;
  }
  isChainWindowOpen() {
    return this.chainWindowOpen;
  }
  getActivatableCardsInChain() {
    return [];
  }
  getEffectActivationZones() {
    return [];
  }
  checkActivationUsage(card, player, effect) {
    return { ok: true, policy: effect?.usagePolicy || null };
  }
  reserveUsageForChainLink() {
    return null;
  }
  settleUsageForChainLink() {
    return null;
  }
  releaseAllUsageReservations() {
    this.game?.releaseEffectUsageReservations?.("chain_cancelled");
  }
  queueChainFinalization() {
    return null;
  }
  async finalizeWholeChain() {
    return { ok: true, success: true, entries: [] };
  }
  getChainFinalizationState() {
    return { finalizing: false, pendingCount: 0, entries: [] };
  }
  resetChainFinalizationState() {
    this.pendingChainFinalizations = [];
    this.isFinalizingChain = false;
    this.currentFinalizingLink = null;
    return this.getChainFinalizationState();
  }
  getChainLength() {
    return this.chainStack.length;
  }
  getLastChainLink() {
    return null;
  }
  getChainSummary() {
    return [];
  }
  getFastEffectState() {
    return {
      ...this.fastEffectState,
      phaseIntent: this.fastEffectState.phaseIntent
        ? { ...this.fastEffectState.phaseIntent }
        : null,
    };
  }
  allocateAtomicEventGroupId(providedId = null) {
    if (Number.isInteger(providedId) && providedId > 0) return providedId;
    return this.nextAtomicEventGroupId++;
  }
  createTriggerOccurrence(eventName, payload = {}, options = {}) {
    return {
      occurrenceId: this.nextTriggerOccurrenceId++,
      atomicGroupId: this.allocateAtomicEventGroupId(
        options.atomicGroupId ?? payload?.atomicGroupId ?? null,
      ),
      eventName,
      payload,
      entries: Array.isArray(options.entries) ? options.entries : null,
      entriesProvided: options.entriesProvided === true,
      onComplete: options.onComplete || null,
      orderRule: options.orderRule || null,
    };
  }
  queueTriggerOccurrence(occurrence) {
    if (occurrence) this.pendingTriggerOccurrences.push(occurrence);
    return { ok: true, deferred: true, triggerCount: 0, results: [] };
  }
  async resolveTriggerOccurrences(occurrences = []) {
    for (const occurrence of occurrences) {
      await occurrence?.onComplete?.();
    }
    return {
      ok: true,
      success: true,
      chainBuilt: false,
      needsSelection: false,
      triggerCount: 0,
    };
  }
  getTriggerState() {
    return {
      opportunityId: null,
      pendingOccurrenceCount: this.pendingTriggerOccurrences.length,
      selecting: false,
      occurrenceIds: [],
      groups: {},
    };
  }
  resetTriggerState() {
    this.pendingTriggerOccurrences = [];
    return this.getTriggerState();
  }
  isOpenGameState() {
    return true;
  }
  resetFastEffectTiming() {
    this.fastEffectState.state = FAST_EFFECT_STATES.OPEN;
    this.fastEffectState.origin = FAST_EFFECT_ORIGINS.PHASE_START;
    this.fastEffectState.timingWindowId = null;
    this.fastEffectState.consecutivePasses = 0;
    this.fastEffectState.phaseIntent = null;
    return this.getFastEffectState();
  }
  async runFastEffectTiming(input = {}) {
    this.resetFastEffectTiming();
    const isPhaseIntent =
      input.origin === FAST_EFFECT_ORIGINS.PHASE_TRANSITION_INTENT;
    return {
      ok: true,
      success: true,
      chainBuilt: false,
      needsSelection: false,
      phaseTransitionAllowed: isPhaseIntent,
      phaseTransitionInterrupted: false,
      state: this.getFastEffectState(),
    };
  }
  canActivateInChain() {
    return { ok: false, reason: "chains_disabled" };
  }
  async openChainWindow() {
    this.chainWindowOpen = false;
    this.isResolving = false;
    this.chainStack = [];
    this.activeChainId = null;
    this.releaseAllUsageReservations();
    this.resetChainFinalizationState();
    return false;
  }
  async openActivationChain(preparedActivation = {}) {
    return {
      success: true,
      needsSelection: false,
      activationNegated: false,
      chainsDisabled: true,
      preparedActivation: this.createPreparedActivation(preparedActivation),
    };
  }
  async openEventWindow(context = {}) {
    return {
      ...(await this.runFastEffectTiming({
        origin:
          context.event === "phase_end"
            ? FAST_EFFECT_ORIGINS.PHASE_TRANSITION_INTENT
            : context.event === "phase_start"
              ? FAST_EFFECT_ORIGINS.PHASE_START
              : FAST_EFFECT_ORIGINS.ACTION_WITHOUT_CHAIN,
      })),
      chainsDisabled: true,
    };
  }
  createPreparedActivation(input = {}) {
    return normalizePreparedActivation(input);
  }
  getEffectActivationCosts(effect) {
    return Array.isArray(effect?.activationCosts) ? effect.activationCosts : [];
  }
  getEffectResolutionActions(effect) {
    return Array.isArray(effect?.actions) ? effect.actions : [];
  }
  async offerChainResponse() {
    return { success: false, reason: "chains_disabled" };
  }
  addToChain() {
    return false;
  }
  async resolveChain() {
    this.isResolving = false;
    this.chainWindowOpen = false;
    this.chainStack = [];
    this.currentChainLevel = 0;
    this.activeChainId = null;
    this.resetFastEffectTiming();
    return false;
  }
  cancelChain() {
    this.chainStack = [];
    this.chainWindowOpen = false;
    this.isResolving = false;
    this.currentChainLevel = 0;
    this.activeChainId = null;
    this.releaseAllUsageReservations();
    this.resetChainFinalizationState();
    this.resetTriggerState();
    this.resetFastEffectTiming();
  }
  reset() {
    this.cancelChain();
  }
}
