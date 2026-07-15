/**
 * Event Resolver for Game
 * Handles: resolveEvent, resolveEventEntries, resumePendingEventSelection
 */

/**
 * Resolve an event by collecting and executing triggers
 * @this {import('../../Game.js').default}
 */
async function presentDamageCalculationStatChanges(game) {
  if (!game?.damageCalculationStatChangePending) return;

  game.updateBoard?.({
    animateCards: false,
    animateFeedback: true,
  });
  await game.waitForBoardPresentation?.();
  await game.waitForPresentationDelay?.(
    game.damageCalculationStatPresentationDelayMs ?? 500,
  );
  game.damageCalculationStatChangePending = false;
}

export async function resolveEvent(eventName, payload, options = {}) {
  if (!eventName) {
    return { ok: false, reason: "missing_event" };
  }
  const collectTriggersOnly = options?.collectTriggersOnly === true;

  this.eventResolutionDepth += 1;
  this.eventResolutionCounter += 1;
  const eventCounter = this.eventResolutionCounter;
  const eventId = `${eventName}:${eventCounter}`;
  const depth = this.eventResolutionDepth;

  this.devLog("EVENT_START", {
    summary: `${eventName} (#${eventCounter})`,
    event: eventName,
    depth,
    id: eventId,
  });
  if (eventName === "after_summon" && payload?.card && payload?.player) {
    const methodMap = {
      normal: "Normal",
      tribute: "Tribute",
      special: "Special",
      fusion: "Fusion",
      synchro: "Synchro",
      ascension: "Ascension",
      flip: "Flip",
    };
    const zoneMap = {
      hand: "Hand",
      field: "Field",
      graveyard: "Graveyard",
      deck: "Deck",
      extraDeck: "Extra Deck",
      spellTrap: "Spell/Trap",
      fieldSpell: "Field Spell",
      banished: "Banished",
      token: "Token",
    };
    const methodRaw = payload.method || "unknown";
    const methodLabel = methodMap[methodRaw] || methodRaw;
    const fromZoneRaw = payload.fromZone || null;
    const fromZoneLabel = fromZoneRaw
      ? zoneMap[fromZoneRaw] || fromZoneRaw
      : null;
    const ownerLabel = payload.player.name || payload.player.id || "Unknown";
    const fromZoneText = fromZoneLabel ? ` | From: ${fromZoneLabel}` : "";
    this.ui?.log?.(
      `Summon Method: ${methodLabel}${fromZoneText} | ${ownerLabel} -> ${payload.card.name}`,
    );
  }

  const occurrence = this.chainSystem?.createTriggerOccurrence?.(
    eventName,
    payload,
    {
      atomicGroupId: options.atomicGroupId ?? payload?.atomicGroupId ?? null,
      sequence: eventCounter,
    },
  );
  let entries = [];
  let orderRule = null;
  let onComplete = null;

  let resolutionResult = null;
  try {
    if (collectTriggersOnly) {
      let triggerPackage = null;
      try {
        triggerPackage = await this.effectEngine?.collectEventTriggers?.(
          eventName,
          payload,
        );
      } catch (err) {
        console.error(`[Game] Failed to collect triggers for "${eventName}":`, err);
      }
      entries = Array.isArray(triggerPackage)
        ? triggerPackage
        : Array.isArray(triggerPackage?.entries)
          ? triggerPackage.entries
          : [];
      orderRule = triggerPackage?.orderRule || null;
      onComplete =
        typeof triggerPackage?.onComplete === "function"
          ? triggerPackage.onComplete
          : null;
      if (occurrence) {
        occurrence.entries = entries;
        occurrence.entriesProvided = true;
        occurrence.orderRule = orderRule;
        occurrence.onComplete = onComplete;
      }
      this.devLog("TRIGGERS_COLLECTED", {
        summary: `${eventName} (${entries.length})`,
        event: eventName,
        count: entries.length,
        order: entries.map((entry) => entry?.summary).filter(Boolean),
        orderRule,
        depth,
      });
      resolutionResult = {
        ok: true,
        collectedOnly: true,
        eventName,
        payload,
        occurrence,
        entries,
        orderRule,
        onComplete,
        triggerCount: entries.length,
        results: [],
      };
    } else if (
      this.chainSystem?.isChainResolving?.() === true ||
      this.chainSystem?.isPreparingActivation === true ||
      this.chainSystem?.isChainWindowOpen?.() === true
    ) {
      resolutionResult = this.queueTriggerOccurrence(occurrence);
    } else {
      resolutionResult = await this.resolveEventEntries(
        eventName,
        payload,
        null,
        {
          occurrence,
        },
      );
    }
  } catch (err) {
    console.error(`[Game] Error resolving event "${eventName}":`, err);
  } finally {
    this.eventResolutionDepth = Math.max(0, this.eventResolutionDepth - 1);

    if (this.devModeEnabled) {
      const cleanupState =
        typeof this.devGetSelectionCleanupState === "function"
          ? this.devGetSelectionCleanupState()
          : {};
      const selectionActive =
        cleanupState.selectionActive === true ||
        this.selectionState === "selecting" ||
        this.selectionState === "confirming" ||
        this.pendingEventSelection != null ||
        this.pendingTriggerSelection != null ||
        this.chainSystem?.pendingTriggerSelection != null;
      if (
        (eventName !== "target_selection_options" &&
          cleanupState.selectionActive) ||
        cleanupState.controlsVisible ||
        cleanupState.highlightCount > 0
      ) {
        if (selectionActive) {
          this.devLog("EVENT_CLEANUP_SKIPPED", {
            summary: `${eventName} cleanup skipped (selection active)`,
            cleanupState,
          });
        } else {
          this.devLog("EVENT_CLEANUP_FORCED", {
            summary: `${eventName} cleanup`,
            cleanupState,
          });
          if (typeof this.devForceTargetCleanup === "function") {
            this.devForceTargetCleanup();
          }
        }
      }
    }

    this.assertStateInvariants(`event_${eventName}`, { failFast: false });

    this.devLog("EVENT_END", {
      summary: `${eventName} (#${eventCounter})`,
      event: eventName,
      depth: this.eventResolutionDepth,
      id: eventId,
    });
  }

  return (
    resolutionResult || {
      ok: true,
      triggerCount: entries.length,
      results: [],
    }
  );
}

/** Queue a canonical event occurrence for the next post-Chain Trigger check. */
export function queueTriggerOccurrence(occurrence) {
  const result = this.chainSystem?.queueTriggerOccurrence?.(occurrence) || {
    ok: false,
    deferred: false,
    reason: "trigger_coordinator_unavailable",
  };
  this.devLog?.("CHAIN_EVENT_DEFERRED", {
    summary: `${occurrence?.eventName || "event"} queued until Chain completion`,
    event: occurrence?.eventName || null,
    pendingCount:
      this.chainSystem?.pendingTriggerOccurrences?.length || 0,
  });
  return result;
}

/**
 * Phase 9 compatibility adapter. New callers must create/queue occurrences.
 */
export function queuePendingChainEvent(entry = {}) {
  const occurrence =
    entry?.occurrence ||
    this.chainSystem?.createTriggerOccurrence?.(
      entry.eventName,
      entry.payload || {},
      {
        entries: Array.isArray(entry.entries) ? entry.entries : [],
        entriesProvided: Object.hasOwn(entry, "entries"),
        orderRule: entry.orderRule || null,
        onComplete: entry.onComplete || null,
        atomicGroupId: entry.atomicGroupId || null,
      },
    );
  return this.queueTriggerOccurrence(occurrence);
}

/** Drain one complete post-Chain occurrence batch into a single SEGOC check. */
export async function flushPendingTriggerOccurrences({ reason = null } = {}) {
  const chain = this.chainSystem;
  if (this._flushingPendingChainEvents === true) {
    return { ok: true, flushed: 0, deferred: true };
  }
  if (
    chain?.isChainResolving?.() === true ||
    chain?.isChainWindowOpen?.() === true ||
    chain?.isPreparingActivation === true
  ) {
    return { ok: true, flushed: 0, deferred: true };
  }
  if (!Array.isArray(chain?.pendingTriggerOccurrences) ||
      chain.pendingTriggerOccurrences.length === 0) {
    return { ok: true, flushed: 0 };
  }

  this._flushingPendingChainEvents = true;
  chain._flushingPendingTriggerOccurrences = true;
  let flushed = 0;
  let chainBuilt = false;
  try {
    while (chain.pendingTriggerOccurrences.length > 0) {
      const occurrences = chain.pendingTriggerOccurrences.splice(0);
      flushed += occurrences.length;
      this.devLog?.("CHAIN_EVENT_FLUSHED", {
        summary: `${occurrences.length} occurrence(s) resumed after Chain`,
        reason,
      });
      const result = await chain.resolveTriggerOccurrences(occurrences, {
        context: { type: "post_chain", event: "post_chain", reason },
        deferPostChainWindow: true,
      });
      chainBuilt = chainBuilt || result?.chainBuilt === true;
      if (result?.needsSelection || result?.ok === false) {
        return { ...result, chainBuilt, flushed };
      }
    }
    return { ok: true, success: true, chainBuilt, flushed };
  } finally {
    chain._flushingPendingTriggerOccurrences = false;
    this._flushingPendingChainEvents = false;
  }
}

/** Phase 9 compatibility adapter. */
export async function flushPendingChainEvents(options = {}) {
  return await this.flushPendingTriggerOccurrences(options);
}

async function offerPostEventFastWindow(game, eventName, payload) {
  if (eventName === "after_summon" && payload?.player) {
    return await game.checkAndOfferTraps(eventName, { ...payload });
  }
  if (eventName === "position_change" && payload?.player) {
    return await game.checkAndOfferTraps(eventName, { ...payload });
  }
  if (eventName === "attack_declared") {
    const defenderOwner = payload?.defenderOwner || null;
    const attackerOwnerId = payload?.attackerOwner?.id || null;
    const defenderOwnerId = defenderOwner?.id || null;
    const trapEventData = {
      ...payload,
      isOpponentAttack:
        !!attackerOwnerId &&
        !!defenderOwnerId &&
        attackerOwnerId !== defenderOwnerId,
    };
    const timing = await game.checkAndOfferTraps(eventName, trapEventData);
    if (trapEventData.attackRedirect) {
      payload.attackRedirect = trapEventData.attackRedirect;
    }
    if (trapEventData.redirectedTarget) {
      payload.redirectedTarget = trapEventData.redirectedTarget;
    }
    if (trapEventData.redirectedTargetOwner) {
      payload.redirectedTargetOwner = trapEventData.redirectedTargetOwner;
    }
    return timing;
  }
  if (eventName === "battle_damage") {
    const defenderOwner = payload?.defenderOwner || payload?.targetOwner || null;
    if (payload?.attackerOwner && defenderOwner) {
      return await game.checkAndOfferTraps(eventName, {
        ...payload,
        defenderOwner,
        targetOwner: payload?.targetOwner || defenderOwner,
        isOpponentAttack: payload.attackerOwner.id !== defenderOwner.id,
      });
    }
  }
  if (eventName === "battle_destroy") {
    return await game.checkAndOfferTraps(eventName, {
      ...payload,
      target: payload?.destroyed || payload?.target || null,
      targetOwner:
        payload?.destroyedOwner ||
        payload?.targetOwner ||
        payload?.defenderOwner ||
        null,
      defender: payload?.destroyed || payload?.defender || payload?.target || null,
      defenderOwner:
        payload?.destroyedOwner ||
        payload?.defenderOwner ||
        payload?.targetOwner ||
        null,
    });
  }
  return null;
}

/** Resolve one event occurrence through the canonical SEGOC coordinator. */
export async function resolveEventEntries(
  eventName,
  payload,
  entries,
  {
    onComplete = null,
    orderRule = null,
    occurrence = null,
  } = {},
) {
  const providedEntries = Array.isArray(entries);
  const triggerOccurrence =
    occurrence ||
    this.chainSystem?.createTriggerOccurrence?.(eventName, payload || {}, {
      entries: providedEntries ? entries : [],
      entriesProvided: providedEntries,
      onComplete,
      orderRule,
      atomicGroupId: payload?.atomicGroupId || null,
    });
  const result = await this.chainSystem?.resolveTriggerOccurrences?.(
    triggerOccurrence ? [triggerOccurrence] : [],
    {
      actionPlayer:
        payload?.player ||
        payload?.attackerOwner ||
        (this.turn === "player" ? this.player : this.bot),
      context: {
        ...(payload || {}),
        type: eventName,
        event: eventName,
      },
    },
  ) || {
    ok: true,
    success: true,
    chainBuilt: false,
    triggerCount: 0,
  };

  let timing = null;
  if (!result.needsSelection && result.chainBuilt !== true) {
    timing = await offerPostEventFastWindow(this, eventName, payload || {});
  }

  if (eventName === "battle_damage") {
    await presentDamageCalculationStatChanges(this);
  }

  return {
    ...result,
    results: result.results || [],
    timing,
  };
}

/**
 * Resume a pending event selection
 * @this {import('../../Game.js').default}
 */
export async function resumePendingEventSelection(
  selections,
  { actionContext } = {},
) {
  const pending = this.pendingEventSelection;
  this.devLog("EVENT_RESUME_SELECTION", {
    summary: `hasPending=${!!pending}, selections=${selections ? Object.keys(selections).join(",") : "(none)"}, entryCount=${pending?.entries?.length || 0}, event=${pending?.eventName || "(none)"}`,
  });
  if (!pending) {
    return { ok: false, reason: "No pending event selection." };
  }

  this.pendingEventSelection = null;
  this.eventResolutionDepth += 1;
  this.eventResolutionCounter += 1;
  const eventCounter = this.eventResolutionCounter;
  const eventId = `${pending.eventName}:${eventCounter}`;

  this.devLog("EVENT_RESUME_START", {
    summary: `${pending.eventName} (resume #${eventCounter})`,
    event: pending.eventName,
    depth: this.eventResolutionDepth,
    id: eventId,
  });

  let resolutionResult = null;
  try {
    const payload = {
      ...(pending.payload || {}),
      actionContext: actionContext || pending.payload?.actionContext || null,
    };
    resolutionResult = await this.resolveEventEntries(
      pending.eventName,
      payload,
      pending.entries || [],
      {
        onComplete: pending.onComplete || null,
        orderRule: pending.orderRule || null,
        startIndex: pending.entryIndex || 0,
        results: pending.results || [],
        selections,
      },
    );
  } catch (err) {
    console.error(`[Game] Error resuming event "${pending.eventName}":`, err);
  } finally {
    this.eventResolutionDepth = Math.max(0, this.eventResolutionDepth - 1);
    this.devLog("EVENT_RESUME_END", {
      summary: `${pending.eventName} (resume #${eventCounter})`,
      event: pending.eventName,
      depth: this.eventResolutionDepth,
      id: eventId,
    });
  }

  // After resolving card_to_grave selections from battle, continue the
  // battle_destroy window only after the graveyard trigger has fully resolved.
  if (
    this.pendingBattleDestroyAfterSelection &&
    resolutionResult?.ok &&
    !resolutionResult?.needsSelection
  ) {
    const pendingBattleDestroy = this.pendingBattleDestroyAfterSelection;
    this.pendingBattleDestroyAfterSelection = null;
    this.devLog("BATTLE_DESTROY_RESUME", {
      summary: `Resuming battle_destroy for ${pendingBattleDestroy.destroyed?.name || "(none)"}`,
    });

    const battleDestroyResult = await this.applyBattleDestroyEffect(
      pendingBattleDestroy.attacker,
      pendingBattleDestroy.destroyed,
      pendingBattleDestroy.extras || {},
    );

    if (battleDestroyResult?.needsSelection) {
      return battleDestroyResult;
    }
  }

  const synchroContinuationResult =
    await this.finishPendingSynchroMaterialTriggerContinuation?.(
      resolutionResult,
      pending.eventName,
    );
  if (synchroContinuationResult?.needsSelection) {
    return synchroContinuationResult;
  }
  if (synchroContinuationResult?.ok === false) {
    return synchroContinuationResult;
  }

  // After resolving the event, check if there's a pending tie destruction to continue
  if (
    this.pendingTieDestruction &&
    resolutionResult?.ok &&
    !resolutionResult?.needsSelection
  ) {
    const tieInfo = this.pendingTieDestruction;
    this.pendingTieDestruction = null;
    this.devLog("TIE_DESTRUCTION", {
      summary: `Resuming pending tie destruction for ${tieInfo.target?.name || "(none)"}`,
    });

    // Continue the combat by destroying the target
    const tieResult = await this.finishCombat(
      tieInfo.attacker,
      tieInfo.target,
      {
        resumeFromTie: true,
      },
    );

    // If this also needs selection, return that
    if (tieResult?.needsSelection) {
      return tieResult;
    }
  }

  return (
    resolutionResult || {
      ok: true,
      triggerCount: pending.entries?.length || 0,
      results: pending.results || [],
    }
  );
}
