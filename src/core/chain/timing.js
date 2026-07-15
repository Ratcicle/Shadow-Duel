/**
 * Canonical Fast Effect Timing coordinator.
 *
 * Phase 2 owns priority, passes and the transition back to an open game state.
 * Trigger collection/SEGOC remains owned by Phase 3.
 */

export const FAST_EFFECT_STATES = Object.freeze({
  OPEN: "open",
  ACTION_WITHOUT_CHAIN: "action_without_chain",
  TRIGGER_CHECK: "trigger_check",
  TRIGGER_CHAIN: "trigger_chain",
  FAST_EFFECT_WINDOW: "fast_effect_window",
  RESOLVING_CHAIN: "resolving_chain",
  POST_CHAIN_CHECK: "post_chain_check",
  PHASE_TRANSITION_INTENT: "phase_transition_intent",
});

export const FAST_EFFECT_ORIGINS = Object.freeze({
  PHASE_START: "phase_start",
  ACTION_WITHOUT_CHAIN: "action_without_chain",
  ACTIVATION: "activation",
  TRIGGER_CHAIN: "trigger_chain",
  POST_CHAIN: "post_chain",
  PHASE_TRANSITION_INTENT: "phase_transition_intent",
  // Phase 6 removes this procedural compatibility origin.
  SUMMON_ATTEMPT: "summon_attempt",
});

function playerId(player) {
  return player?.id ?? null;
}

function clonePhaseIntent(intent) {
  if (!intent) return null;
  return {
    fromPhase: intent.fromPhase ?? null,
    toPhase: intent.toPhase ?? null,
  };
}

function createState(chainSystem, overrides = {}) {
  const turnPlayer =
    overrides.turnPlayer || chainSystem.getCurrentTurnPlayer?.() || null;
  return {
    state: overrides.state || FAST_EFFECT_STATES.OPEN,
    origin: overrides.origin || FAST_EFFECT_ORIGINS.PHASE_START,
    timingWindowId: overrides.timingWindowId ?? null,
    turnPlayerId: playerId(turnPlayer),
    actionPlayerId: playerId(overrides.actionPlayer),
    priorityPlayerId: playerId(overrides.priorityPlayer),
    lastLinkControllerId: playerId(overrides.lastLinkController),
    chainId: overrides.chainId ?? null,
    consecutivePasses: Number(overrides.consecutivePasses || 0),
    phaseIntent: clonePhaseIntent(overrides.phaseIntent),
  };
}

export function getFastEffectState() {
  const state = this.fastEffectState || createState(this);
  return {
    ...state,
    phaseIntent: clonePhaseIntent(state.phaseIntent),
  };
}

export function transitionFastEffectState(state, details = {}) {
  const previous = this.fastEffectState || createState(this);
  const turnPlayer = details.turnPlayer || this.getCurrentTurnPlayer?.() || null;
  const next = createState(this, {
    state,
    origin: details.origin ?? previous.origin,
    timingWindowId:
      details.timingWindowId !== undefined
        ? details.timingWindowId
        : this.activeTimingWindowId,
    turnPlayer,
    actionPlayer:
      details.actionPlayer !== undefined
        ? details.actionPlayer
        : this.resolveTimingPlayer?.(previous.actionPlayerId),
    priorityPlayer:
      details.priorityPlayer !== undefined
        ? details.priorityPlayer
        : this.resolveTimingPlayer?.(previous.priorityPlayerId),
    lastLinkController:
      details.lastLinkController !== undefined
        ? details.lastLinkController
        : this.resolveTimingPlayer?.(previous.lastLinkControllerId),
    chainId:
      details.chainId !== undefined ? details.chainId : this.activeChainId,
    consecutivePasses:
      details.consecutivePasses !== undefined
        ? details.consecutivePasses
        : previous.consecutivePasses,
    phaseIntent:
      details.phaseIntent !== undefined
        ? details.phaseIntent
        : previous.phaseIntent,
  });
  this.fastEffectState = next;
  this.game?.notify?.("fast_effect_timing", this.getFastEffectState());
  return this.getFastEffectState();
}

export function resolveTimingPlayer(id) {
  if (id == null) return null;
  if (this.game?.player?.id === id) return this.game.player;
  if (this.game?.bot?.id === id) return this.game.bot;
  return null;
}

export function isOpenGameState() {
  return (
    (this.fastEffectState?.state || FAST_EFFECT_STATES.OPEN) ===
      FAST_EFFECT_STATES.OPEN &&
    this.chainWindowOpen !== true &&
    this.isResolving !== true &&
    this.pendingChainSelection == null &&
    this.pendingTriggerSelection == null &&
    this.activeTriggerOpportunity?.selecting !== true
  );
}

export function resetFastEffectTiming({ notify = false } = {}) {
  this.activeTimingWindowId = null;
  this.timingDepth = 0;
  this.fastEffectState = createState(this, {
    state: FAST_EFFECT_STATES.OPEN,
    origin: FAST_EFFECT_ORIGINS.PHASE_START,
    turnPlayer: this.getCurrentTurnPlayer?.() || null,
    priorityPlayer: this.getCurrentTurnPlayer?.() || null,
  });
  if (notify) {
    this.game?.notify?.("fast_effect_timing", this.getFastEffectState());
  }
  return this.getFastEffectState();
}

export function recordFastEffectPriority(
  player,
  decision,
  details = {},
) {
  const consecutivePasses = Number(details.consecutivePasses || 0);
  this.transitionFastEffectState(FAST_EFFECT_STATES.FAST_EFFECT_WINDOW, {
    priorityPlayer: player,
    consecutivePasses,
    chainId: details.chainId ?? this.activeChainId,
    lastLinkController: details.lastLinkController,
  });
  this.game?.notify?.("fast_effect_priority", {
    timingWindowId: this.activeTimingWindowId,
    chainId: details.chainId ?? this.activeChainId ?? null,
    playerId: playerId(player),
    decision,
    consecutivePasses,
    linkId: details.linkId ?? null,
    origin: this.fastEffectState?.origin || null,
  });
}

function nextTimingWindow(chainSystem) {
  if (!Number.isInteger(chainSystem.nextTimingWindowId)) {
    chainSystem.nextTimingWindowId = 1;
  }
  const id = chainSystem.nextTimingWindowId++;
  chainSystem.activeTimingWindowId = id;
  return id;
}

function normalizePreparedActivations(input = {}) {
  if (Array.isArray(input.preparedActivations)) {
    return input.preparedActivations.filter(Boolean);
  }
  return input.preparedActivation ? [input.preparedActivation] : [];
}

function lastPreparedController(preparedActivations) {
  const last = preparedActivations[preparedActivations.length - 1] || null;
  return last?.controller || last?.player || null;
}

function timingResult(chainSystem, overrides = {}) {
  const resolutionResult = overrides.resolutionResult || null;
  const ok =
    overrides.ok !== false && resolutionResult?.success !== false;
  return {
    ok,
    success: ok && overrides.needsSelection !== true,
    chainBuilt: overrides.chainBuilt === true,
    needsSelection: overrides.needsSelection === true,
    phaseTransitionAllowed: overrides.phaseTransitionAllowed === true,
    phaseTransitionInterrupted:
      overrides.phaseTransitionInterrupted === true,
    deferred: overrides.deferred === true,
    activationNegated:
      overrides.activationNegated === true ||
      resolutionResult?.activationNegated === true,
    effectNegated:
      overrides.effectNegated === true || resolutionResult?.effectNegated === true,
    // Phase 9 compatibility result alias.
    negated:
      overrides.activationNegated === true ||
      resolutionResult?.activationNegated === true ||
      resolutionResult?.negated === true,
    resolutionResult,
    state: chainSystem.getFastEffectState(),
    ...(overrides.reason ? { reason: overrides.reason } : {}),
  };
}

/**
 * Run one complete Fast Effect Timing session.
 *
 * The session may contain multiple Chains. After every resolved Chain, pending
 * events are flushed and a new post-Chain Fast Effect window starts with the
 * turn player. A manual phase intent is invalidated by any activation.
 */
export async function runFastEffectTiming(input = {}) {
  const origin = input.origin || FAST_EFFECT_ORIGINS.ACTION_WITHOUT_CHAIN;
  const turnPlayer = input.turnPlayer || this.getCurrentTurnPlayer?.() || null;
  const actionPlayer = input.actionPlayer || input.context?.player || turnPlayer;
  const context = {
    ...(input.context || {}),
    timingOrigin: origin,
    turnPlayer,
    actionPlayer,
    openState: origin === FAST_EFFECT_ORIGINS.PHASE_START,
    legalWindow: origin !== FAST_EFFECT_ORIGINS.PHASE_START,
  };

  if (origin === FAST_EFFECT_ORIGINS.PHASE_START) {
    this.activeTimingWindowId = null;
    this.transitionFastEffectState(FAST_EFFECT_STATES.OPEN, {
      origin,
      timingWindowId: null,
      turnPlayer,
      actionPlayer: turnPlayer,
      priorityPlayer: turnPlayer,
      lastLinkController: null,
      chainId: null,
      consecutivePasses: 0,
      phaseIntent: null,
    });
    return timingResult(this);
  }

  if (
    this.isResolving === true ||
    this.chainWindowOpen === true ||
    this.pendingChainSelection != null ||
    this.pendingTriggerSelection != null ||
    this.activeTriggerOpportunity?.selecting === true
  ) {
    return timingResult(this, {
      ok: false,
      deferred: true,
      reason: "timing_window_busy",
    });
  }

  const nestedFlushContinuation =
    this.timingDepth > 0 && this.game?._flushingPendingChainEvents === true;
  if (this.timingDepth > 0 && !nestedFlushContinuation) {
    return timingResult(this, {
      ok: false,
      deferred: true,
      reason: "timing_reentry_blocked",
    });
  }

  this.timingDepth += 1;
  let chainBuilt = false;
  let rootResolutionResult = null;
  let phaseTransitionInterrupted = false;
  const isPhaseIntent =
    origin === FAST_EFFECT_ORIGINS.PHASE_TRANSITION_INTENT;
  const deferPostChainWindow =
    input.deferPostChainWindow === true || nestedFlushContinuation;

  try {
    const preparedActivations = normalizePreparedActivations(input);
    const phaseIntent = isPhaseIntent
      ? {
          fromPhase:
            input.phaseIntent?.fromPhase ?? context.fromPhase ?? null,
          toPhase: input.phaseIntent?.toPhase ?? context.toPhase ?? null,
        }
      : null;

    if (isPhaseIntent) {
      this.transitionFastEffectState(
        FAST_EFFECT_STATES.PHASE_TRANSITION_INTENT,
        {
          origin,
          turnPlayer,
          actionPlayer: turnPlayer,
          priorityPlayer: this.getOpponent?.(turnPlayer) || null,
          consecutivePasses: 1,
          phaseIntent,
          chainId: null,
          lastLinkController: null,
        },
      );
    } else if (preparedActivations.length > 0) {
      this.transitionFastEffectState(FAST_EFFECT_STATES.TRIGGER_CHAIN, {
        origin,
        turnPlayer,
        actionPlayer,
        lastLinkController: lastPreparedController(preparedActivations),
        priorityPlayer: null,
        consecutivePasses: 0,
        phaseIntent: null,
      });
    } else {
      this.transitionFastEffectState(
        origin === FAST_EFFECT_ORIGINS.POST_CHAIN
          ? FAST_EFFECT_STATES.POST_CHAIN_CHECK
          : FAST_EFFECT_STATES.ACTION_WITHOUT_CHAIN,
        {
          origin,
          turnPlayer,
          actionPlayer,
          priorityPlayer: turnPlayer,
          consecutivePasses: 0,
          phaseIntent: null,
          lastLinkController: null,
          chainId: null,
        },
      );
      this.transitionFastEffectState(FAST_EFFECT_STATES.TRIGGER_CHECK, {
        origin,
        turnPlayer,
        actionPlayer,
        priorityPlayer: turnPlayer,
      });
    }

    let nextPreparedActivations = preparedActivations;
    let nextOrigin = origin;
    let firstPlayer = null;
    let initialPasses = isPhaseIntent ? 1 : 0;

    if (isPhaseIntent) {
      firstPlayer = this.getOpponent?.(turnPlayer) || null;
    } else if (nextPreparedActivations.length > 0) {
      firstPlayer =
        this.getOpponent?.(lastPreparedController(nextPreparedActivations)) ||
        null;
    } else if (origin === FAST_EFFECT_ORIGINS.SUMMON_ATTEMPT) {
      // Phase 6 will replace this explicit procedural adapter.
      firstPlayer =
        input.priorityPlayer || this.getOpponent?.(actionPlayer) || turnPlayer;
    } else {
      firstPlayer = turnPlayer;
    }

    while (firstPlayer) {
      const timingWindowId = nextTimingWindow(this);
      const lastController = lastPreparedController(nextPreparedActivations);
      this.transitionFastEffectState(FAST_EFFECT_STATES.FAST_EFFECT_WINDOW, {
        origin: nextOrigin,
        timingWindowId,
        turnPlayer,
        actionPlayer,
        priorityPlayer: firstPlayer,
        lastLinkController: lastController,
        consecutivePasses: initialPasses,
        phaseIntent,
      });

      const windowContext = {
        ...context,
        type:
          nextOrigin === FAST_EFFECT_ORIGINS.POST_CHAIN
            ? "post_chain"
            : context.type || "action_without_chain",
        event:
          nextOrigin === FAST_EFFECT_ORIGINS.POST_CHAIN
            ? "post_chain"
            : context.event || context.type || "action_without_chain",
        timingOrigin: nextOrigin,
        timingWindowId,
        preparedActivations: nextPreparedActivations,
      };
      const windowResult = await this.openChainWindow(windowContext, {
        firstPlayer,
        secondPlayer: this.getOpponent?.(firstPlayer) || null,
        initialPasses,
        preparedActivations: nextPreparedActivations,
      });

      if (windowResult?.needsSelection) {
        return timingResult(this, {
          ok: windowResult.ok !== false,
          chainBuilt: chainBuilt || windowResult.chainBuilt === true,
          needsSelection: true,
          phaseTransitionInterrupted: isPhaseIntent,
          resolutionResult: windowResult.resolutionResult || null,
        });
      }

      if (windowResult?.resolutionResult?.cancelled === true) {
        this.cancelChain?.();
        this.transitionFastEffectState(FAST_EFFECT_STATES.OPEN, {
          origin: nextOrigin,
          timingWindowId: null,
          turnPlayer,
          actionPlayer: turnPlayer,
          priorityPlayer: turnPlayer,
          lastLinkController: null,
          chainId: null,
          consecutivePasses: 0,
          phaseIntent: null,
        });
        return timingResult(this, {
          ok: false,
          chainBuilt: chainBuilt || windowResult.chainBuilt === true,
          phaseTransitionInterrupted:
            isPhaseIntent && windowResult.chainBuilt === true,
          resolutionResult: windowResult.resolutionResult,
          reason:
            windowResult.resolutionResult.reason ||
            "fast_effect_timing_cancelled",
        });
      }

      if (windowResult?.chainBuilt !== true) {
        this.activeTimingWindowId = null;
        this.transitionFastEffectState(FAST_EFFECT_STATES.OPEN, {
          origin: nextOrigin,
          timingWindowId: null,
          turnPlayer,
          actionPlayer: turnPlayer,
          priorityPlayer: turnPlayer,
          lastLinkController: null,
          chainId: null,
          consecutivePasses: 0,
          phaseIntent: null,
        });
        return timingResult(this, {
          chainBuilt,
          resolutionResult: rootResolutionResult,
          phaseTransitionAllowed: isPhaseIntent && !phaseTransitionInterrupted,
          phaseTransitionInterrupted,
        });
      }

      chainBuilt = true;
      if (rootResolutionResult == null) {
        rootResolutionResult = windowResult.resolutionResult || null;
      }
      if (isPhaseIntent) phaseTransitionInterrupted = true;
      this.activeTimingWindowId = null;
      this.transitionFastEffectState(FAST_EFFECT_STATES.POST_CHAIN_CHECK, {
        origin: FAST_EFFECT_ORIGINS.POST_CHAIN,
        timingWindowId: null,
        turnPlayer,
        actionPlayer,
        priorityPlayer: turnPlayer,
        lastLinkController: windowResult.lastLinkController || null,
        chainId: windowResult.chainId ?? null,
        consecutivePasses: 0,
        phaseIntent: null,
      });

      const flushPending =
        this.game?.flushPendingTriggerOccurrences ||
        // Phase 9: remove after all embedders expose the canonical name.
        this.game?.flushPendingChainEvents;
      const flushResult = await flushPending?.call(this.game, {
        reason: "fast_effect_post_chain",
      });
      if (flushResult?.needsSelection) {
        return timingResult(this, {
          chainBuilt: true,
          needsSelection: true,
          phaseTransitionInterrupted,
          resolutionResult: rootResolutionResult,
        });
      }

      if (deferPostChainWindow) {
        return timingResult(this, {
          chainBuilt: true,
          phaseTransitionInterrupted,
          resolutionResult: rootResolutionResult,
        });
      }

      nextPreparedActivations = [];
      nextOrigin = FAST_EFFECT_ORIGINS.POST_CHAIN;
      firstPlayer = turnPlayer;
      initialPasses = 0;
    }

    this.activeTimingWindowId = null;
    this.transitionFastEffectState(FAST_EFFECT_STATES.OPEN, {
      origin: nextOrigin,
      timingWindowId: null,
      turnPlayer,
      actionPlayer: turnPlayer,
      priorityPlayer: turnPlayer,
      consecutivePasses: 0,
      phaseIntent: null,
    });
    return timingResult(this, {
      chainBuilt,
      phaseTransitionInterrupted,
      resolutionResult: rootResolutionResult,
    });
  } catch (error) {
    // Cancellation is the canonical error cleanup: it aborts any prompt,
    // clears stack/selection state and deliberately preserves monotonic IDs.
    this.cancelChain?.();
    this.activeTimingWindowId = null;
    this.transitionFastEffectState(FAST_EFFECT_STATES.OPEN, {
      origin,
      timingWindowId: null,
      turnPlayer,
      actionPlayer: turnPlayer,
      priorityPlayer: turnPlayer,
      consecutivePasses: 0,
      phaseIntent: null,
    });
    return timingResult(this, {
      ok: false,
      chainBuilt,
      phaseTransitionInterrupted,
      reason: error?.message || "fast_effect_timing_failed",
    });
  } finally {
    this.timingDepth = Math.max(0, this.timingDepth - 1);
  }
}
