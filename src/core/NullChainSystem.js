import { createPreparedActivation as normalizePreparedActivation } from "./chain/activation.js";
import {
  getActivationCostTargetDefinitions as getCostTargetDefinitions,
  getDeclaredTargetDefinitions as getEffectTargetDefinitions,
  getPlayerSelectionsForDefinitions as collectSelectionsForDefinitions,
} from "./chain/selection.js";
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
  getOpponent(player) {
    return this.game?.getOpponent?.(player) || null;
  }
  determineCardZone(card, player = null) {
    const owners = player
      ? [player]
      : [this.game?.player, this.game?.bot].filter(Boolean);
    for (const owner of owners) {
      if (owner?.fieldSpell === card) return "fieldSpell";
      for (const zone of [
        "hand",
        "field",
        "spellTrap",
        "graveyard",
        "banished",
        "deck",
        "extraDeck",
      ]) {
        if (owner?.[zone]?.includes?.(card)) return zone;
      }
    }
    return null;
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
  getActivationCostTargetDefinitions(effect) {
    return getCostTargetDefinitions(effect);
  }
  getDeclaredTargetDefinitions(effect) {
    return getEffectTargetDefinitions(effect);
  }
  async getPlayerSelectionsForDefinitions(
    card,
    definitions,
    player,
    context,
    options = {},
  ) {
    return collectSelectionsForDefinitions.call(
      this,
      card,
      definitions,
      player,
      context,
      options,
    );
  }
  getEffectActivationCommitActions(effect) {
    return Array.isArray(effect?.activationCommitActions)
      ? effect.activationCommitActions
      : [];
  }
  getEffectResolutionActions(effect) {
    return Array.isArray(effect?.actions) ? effect.actions : [];
  }
  async payActivationCosts(prepared, context = null) {
    const actions = this.getEffectActivationCosts(prepared?.effect);
    if (actions.length === 0) {
      prepared.costsPaid = true;
      prepared.costPayment = { status: "not_required", actions: [] };
      return { success: true, needsSelection: false };
    }
    const player = prepared.controller || null;
    const result = await this.game?.effectEngine?.applyActions?.(
      actions,
      {
        ...(context || {}),
        source: prepared.card,
        sourceCard: prepared.card,
        effect: prepared.effect,
        effectId: prepared.effect?.id || null,
        player,
        opponent: this.game?.getOpponent?.(player) || null,
        activationZone: prepared.activationZone || null,
        actionContext: context || prepared.context || null,
        activationContext: {
          ...(prepared.activationContext || {}),
          payingActivationCosts: true,
          committed: prepared.committed === true,
          costSelections: prepared.costSelections || {},
          targetSelections: prepared.targetSelections || {},
        },
      },
      prepared.costSelections || {},
    );
    if (result?.success === false || result?.needsSelection) return result;
    prepared.costsPaid = true;
    prepared.costPayment = {
      status: "paid",
      actions: actions.map((action, index) => ({
        index,
        type: action?.type || null,
        targetRef: action?.targetRef || null,
      })),
    };
    return { success: true, needsSelection: false };
  }
  async offerChainResponse() {
    return { success: false, reason: "chains_disabled" };
  }
  async applyActivationCommitActions(prepared) {
    if (prepared?.activationCommitment?.status === "applied") {
      return { success: true, needsSelection: false, alreadyApplied: true };
    }
    const actions = this.getEffectActivationCommitActions(prepared?.effect);
    if (actions.length === 0) {
      prepared.activationCommitment = { status: "not_required", actions: [] };
      return { success: true, needsSelection: false };
    }
    const player = prepared.controller || null;
    const result = await this.game?.effectEngine?.applyActions?.(
      actions,
      {
        source: prepared.card,
        sourceCard: prepared.card,
        effect: prepared.effect,
        effectId: prepared.effect?.id || null,
        player,
        opponent: this.game?.getOpponent?.(player) || null,
        activationZone: prepared.activationZone || null,
        activationContext: {
          ...(prepared.activationContext || {}),
          applyingActivationCommitActions: true,
        },
      },
      {
        ...(prepared.costSelections || {}),
        ...(prepared.targetSelections || {}),
      },
    );
    if (result?.success === false || result?.needsSelection) return result;
    prepared.activationCommitment = {
      status: "applied",
      actions: actions.map((action, index) => ({
        index,
        type: action?.type || null,
        targetRef: action?.targetRef || null,
      })),
    };
    return { success: true, needsSelection: false };
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
