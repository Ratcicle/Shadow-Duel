/**
 * Event Resolver for Game
 * Handles: resolveEvent, resolveEventEntries, resumePendingEventSelection
 */

/**
 * Resolve an event by collecting and executing triggers
 * @this {import('../../Game.js').default}
 */
export async function resolveEvent(eventName, payload) {
  if (!eventName) {
    return { ok: false, reason: "missing_event" };
  }

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

  let triggerPackage = null;
  try {
    if (
      this.effectEngine &&
      typeof this.effectEngine.collectEventTriggers === "function"
    ) {
      triggerPackage = await this.effectEngine.collectEventTriggers(
        eventName,
        payload,
      );
    }
  } catch (err) {
    console.error(`[Game] Failed to collect triggers for "${eventName}":`, err);
  }

  let entries = [];
  let orderRule = null;
  let onComplete = null;
  if (Array.isArray(triggerPackage)) {
    entries = triggerPackage;
  } else if (triggerPackage && typeof triggerPackage === "object") {
    entries = Array.isArray(triggerPackage.entries)
      ? triggerPackage.entries
      : [];
    orderRule =
      typeof triggerPackage.orderRule === "string"
        ? triggerPackage.orderRule
        : null;
    onComplete =
      typeof triggerPackage.onComplete === "function"
        ? triggerPackage.onComplete
        : null;
  }

  const order = entries
    .map((entry) => entry?.summary)
    .filter((value) => typeof value === "string" && value.trim().length > 0);

  this.devLog("TRIGGERS_COLLECTED", {
    summary: `${eventName} (${entries.length})`,
    event: eventName,
    count: entries.length,
    order,
    orderRule,
    depth,
  });

  let resolutionResult = null;
  try {
    resolutionResult = await this.resolveEventEntries(
      eventName,
      payload,
      entries,
      {
        onComplete,
        orderRule,
      },
    );
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
        this.pendingEventSelection != null;
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

/**
 * Resolve event trigger entries sequentially
 * @this {import('../../Game.js').default}
 */
export async function resolveEventEntries(
  eventName,
  payload,
  entries,
  {
    onComplete = null,
    orderRule = null,
    startIndex = 0,
    results = [],
    selections = null,
  } = {},
) {
  const resolvedResults = Array.isArray(results) ? results : [];
  const start = Math.max(0, startIndex);

  for (let i = start; i < entries.length; i += 1) {
    const entry = entries[i];
    const config = entry?.config || entry?.pipeline || entry;
    if (!config || typeof config.activate !== "function") {
      continue;
    }
    const result = await this.runActivationPipelineWait({
      ...config,
      selections: i === start ? selections : null,
    });
    resolvedResults.push({
      id: entry?.summary || entry?.effect?.id || entry?.card?.name || null,
      success: result?.success === true,
      needsSelection: result?.needsSelection === true,
      selectionContract: result?.selectionContract || null,
    });
    if (result?.needsSelection && result?.selectionContract) {
      this.pendingEventSelection = {
        eventName,
        payload,
        entries,
        entryIndex: i,
        results: resolvedResults,
        orderRule,
        onComplete,
      };
      return {
        ok: true,
        triggerCount: entries.length,
        results: resolvedResults,
        needsSelection: true,
        selectionContract: result.selectionContract,
      };
    }
  }

  this.devLog("TRIGGERS_DONE", {
    summary: `${eventName} (${entries.length})`,
    event: eventName,
    count: entries.length,
    depth: this.eventResolutionDepth,
  });

  if (typeof onComplete === "function") {
    try {
      onComplete();
    } catch (err) {
      console.error(`[Game] Error running onComplete for "${eventName}":`, err);
    }
  }

  if (eventName === "after_summon" && payload?.player) {
    const isOpponentSummon = payload.player.id !== "player";
    await this.checkAndOfferTraps(eventName, {
      ...payload,
      isOpponentSummon,
    });
  } else if (eventName === "attack_declared") {
    const defenderOwner = payload?.defenderOwner || null;
    if (defenderOwner === this.player) {
      // Determine if opponent is attacking by checking if attacker owner differs from defender (player)
      const attackerOwnerId = payload?.attackerOwner?.id;
      await this.checkAndOfferTraps(eventName, {
        ...payload,
        isOpponentAttack: attackerOwnerId && attackerOwnerId !== this.player.id,
      });
    }
  }

  return {
    ok: true,
    triggerCount: entries.length,
    results: resolvedResults,
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
  if (this.devModeEnabled) {
    console.log("[Game] resumePendingEventSelection called", {
      hasPending: !!pending,
      selectionsKeys: selections ? Object.keys(selections) : null,
      entryCount: pending?.entries?.length || 0,
      eventName: pending?.eventName,
    });
  }
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

  // After resolving the event, check if there's a pending tie destruction to continue
  if (
    this.pendingTieDestruction &&
    resolutionResult?.ok &&
    !resolutionResult?.needsSelection
  ) {
    const tieInfo = this.pendingTieDestruction;
    this.pendingTieDestruction = null;
    console.log(
      "[Game] Resuming pending tie destruction for target:",
      tieInfo.target?.name,
    );

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
