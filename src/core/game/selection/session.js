/**
 * Selection session management - start, advance, finish, cancel sessions.
 * Extracted from Game.js as part of B.3 modularization.
 */

function getSelectionActor(game, selection = {}) {
  return (
    selection.owner ||
    selection.player ||
    selection.controller ||
    (game.turn === "bot" ? game.bot : game.player)
  );
}

function serializeSelectionCandidate(game, candidate = {}) {
  const card = candidate.cardRef || candidate.card || null;
  const duelCardId = card ? game.ensureDuelCardId?.(card) ?? null : null;
  return {
    duelCardId,
    cardId: card?.id ?? null,
    effectId: candidate.effectId || candidate.effect?.id || null,
    candidateKey: candidate.candidateKey || null,
    key: duelCardId == null ? candidate.key ?? candidate.id ?? null : null,
  };
}

function serializeSelectionValue(game, selection = {}) {
  const selections = {};
  for (const requirement of selection.requirements || []) {
    const selectedKeys = selection.selections?.[requirement.id] || [];
    selections[requirement.id] = selectedKeys.map((selectedKey) => {
      const candidate = (requirement.candidates || []).find(
        (entry) => String(entry.key ?? entry.id) === String(selectedKey),
      );
      return candidate
        ? serializeSelectionCandidate(game, candidate)
        : { key: selectedKey };
    });
  }
  return { selections };
}

function deserializeSelectionValue(game, selection, value = {}) {
  const output = {};
  for (const requirement of selection.requirements || []) {
    const recorded = value.selections?.[requirement.id] || [];
    output[requirement.id] = recorded
      .map((identity) => {
        const match = (requirement.candidates || []).find((candidate) => {
          const current = serializeSelectionCandidate(game, candidate);
          if (identity.duelCardId != null) {
            return (
              Number(current.duelCardId) === Number(identity.duelCardId) &&
              (identity.effectId == null || current.effectId === identity.effectId)
            );
          }
          if (identity.candidateKey != null) {
            return String(current.candidateKey) === String(identity.candidateKey);
          }
          return String(candidate.key ?? candidate.id) === String(identity.key);
        });
        return match?.key ?? match?.id ?? null;
      })
      .filter((key) => key != null);
  }
  return output;
}

/**
 * Set the current selection state.
 * @param {string} state - New state ("idle"|"selecting"|"confirming"|"resolving")
 */
export function setSelectionState(state) {
  this.selectionState = state;
  if (this.targetSelection) {
    this.targetSelection.state = state;
  }
}

/**
 * Force clear target selection (invariant cleanup).
 * @param {string} reason - Reason for clearing
 */
export function forceClearTargetSelection(reason = "invariant_cleanup") {
  if (!this.targetSelection) return;
  this.devLog("SELECTION_FORCE_CLEAR", {
    summary: `Selection cleared (${reason})`,
  });
  this.clearTargetHighlights();
  this.setSelectionDimming(false);
  if (this.ui && typeof this.ui.hideFieldTargetingControls === "function") {
    this.ui.hideFieldTargetingControls();
  }
  if (this.targetSelection?.closeModal) {
    this.targetSelection.closeModal();
  }
  this.targetSelection = null;
  this.setSelectionState("idle");
}

/**
 * Start a new target selection session.
 * @param {Object} session - Session configuration with selectionContract
 */
export function startTargetSelectionSession(session) {
  if (!session || !session.selectionContract) return;

  const normalizedContract = this.normalizeSelectionContract(
    session.selectionContract,
    {
      kind: session.kind,
      message: session.message,
      ui: {
        allowCancel: session.allowCancel,
        preventCancel: session.preventCancel,
        useFieldTargeting: session.useFieldTargeting,
        allowEmpty: session.allowEmpty,
      },
    }
  );

  if (!normalizedContract.ok) {
    console.warn("[Game] Invalid selection contract:", normalizedContract);
    return;
  }

  const selectionContract = normalizedContract.contract;

  this.cancelTargetSelection();
  if (this.targetSelection) {
    return;
  }

  // Field-only target prompts resolve directly on the board unless the
  // contract explicitly opts in or out.
  const usingFieldTargeting =
    typeof selectionContract.ui.useFieldTargeting === "boolean"
      ? selectionContract.ui.useFieldTargeting
      : this.canUseFieldTargeting(selectionContract.requirements);
  selectionContract.ui.useFieldTargeting = usingFieldTargeting;

  this.selectionSessionCounter += 1;
  this.lastSelectionSessionId = this.selectionSessionCounter;
  this.targetSelection = {
    ...session,
    selectionContract,
    requirements: selectionContract.requirements,
    selections: {},
    currentRequirement: 0,
    sessionId: this.lastSelectionSessionId,
    usingFieldTargeting,
    allowCancel: selectionContract.ui.allowCancel !== false,
    allowEmpty: selectionContract.ui.allowEmpty === true,
    autoAdvanceOnMax:
      typeof session.autoAdvanceOnMax === "boolean"
        ? session.autoAdvanceOnMax
        : !usingFieldTargeting,
  };
  this.setSelectionState("selecting");

  if (this.decisionBroker?.mode === "replay") {
    const replaySelection = this.targetSelection;
    const actor = getSelectionActor(this, replaySelection);
    const decisionKind =
      replaySelection.selectionContract?.purpose ||
      replaySelection.kind ||
      "target_selection";
    const pending = this.requestDecision({
      kind: decisionKind,
      actor,
      candidates: (replaySelection.requirements || []).flatMap(
        (requirement) => requirement.candidates || [],
      ),
      requireCandidate: false,
      deserializeReplayValue: (value) =>
        deserializeSelectionValue(this, replaySelection, value),
    }).then(async (selections) => {
      if (this.targetSelection?.sessionId !== replaySelection.sessionId) {
        throw new Error("Replay selection session changed before its decision was applied.");
      }
      this.targetSelection.selections = selections || {};
      this.targetSelection.currentRequirement =
        this.targetSelection.requirements.length;
      this.setSelectionState("confirming");
      await this.finishTargetSelection();
    });
    let trackedPromise = null;
    trackedPromise = pending.finally(() => {
      if (this.pendingReplayDecisionPromise === trackedPromise) {
        this.pendingReplayDecisionPromise = null;
      }
    });
    this.pendingReplayDecisionPromise = trackedPromise;
    return this.pendingReplayDecisionPromise;
  }

  // Generic decision observability for the live human provider.
  if (this.turn === "player" && selectionContract.requirements?.length > 0) {
    const firstReq = selectionContract.requirements[0];
    if (firstReq?.candidates?.length > 0) {
      // Usar primeiro efeito como ID padrão, ou kind da sessão como fallback
      // Na maioria dos casos, o primeiro efeito é o que está sendo ativado
      const effectId = session.card?.effects?.[0]?.id || session.kind;
      
      this.notify("decision_requested", {
        player: "player",
        candidates: firstReq.candidates.map(c => ({
          id: c.cardRef?.id,
          name: c.cardRef?.name,
          zone: c.zone || "field",
          key: c.key,
        })),
        effectId,
        sourceCard: session.card,
        allowCancel: selectionContract.ui.allowCancel !== false,
      });
    }
  }

  if (usingFieldTargeting) {
    if (this.ui && typeof this.ui.showFieldTargetingControls === "function") {
      const allowCancel =
        this.targetSelection.allowCancel !== false &&
        !this.targetSelection.preventCancel;
      const controlsHandle = this.ui.showFieldTargetingControls(
        () => this.advanceTargetSelection(),
        allowCancel ? () => this.cancelTargetSelection() : null,
        {
          allowCancel,
          message: selectionContract.message || session.message || null,
          selectionContract,
          sourceCard:
            session.card || selectionContract.metadata?.sourceCard || null,
          sourceCardName:
            session.card?.name ||
            selectionContract.metadata?.sourceCardName ||
            null,
        }
      );
      this.targetSelection.controlsHandle = controlsHandle || null;
    }
    this.setSelectionDimming(true);
  } else if (this.ui && typeof this.ui.showTargetSelection === "function") {
    const allowCancel =
      this.targetSelection.allowCancel !== false &&
      !this.targetSelection.preventCancel;
    const modalHandle = this.ui.showTargetSelection(
      selectionContract,
      (chosenMap) => {
        if (!this.targetSelection) return;
        this.setSelectionState("confirming");
        this.targetSelection.selections = chosenMap || {};
        this.targetSelection.currentRequirement =
          this.targetSelection.requirements.length;
        this.finishTargetSelection();
      },
      allowCancel ? () => this.cancelTargetSelection() : null,
      {
        allowCancel,
        allowEmpty: this.targetSelection.allowEmpty === true,
      }
    );
    if (modalHandle && typeof modalHandle.close === "function") {
      this.targetSelection.closeModal = modalHandle.close;
    }
  }

  if (selectionContract.message) {
    this.ui.log(selectionContract.message);
  }
  if (usingFieldTargeting) {
    this.highlightTargetCandidates();
    this.updateFieldTargetingProgress();
  }
}

/**
 * Advance to the next requirement in the selection session.
 */
export function advanceTargetSelection() {
  if (!this.targetSelection) return;
  if (
    this.targetSelection.state &&
    this.targetSelection.state !== "selecting"
  ) {
    return;
  }
  const requirement =
    this.targetSelection.requirements[this.targetSelection.currentRequirement];
  if (!requirement) return;

  const selections = this.targetSelection.selections[requirement.id] || [];
  if (selections.length < requirement.min) {
    return;
  }

  this.targetSelection.currentRequirement++;
  if (
    this.targetSelection.currentRequirement >=
    this.targetSelection.requirements.length
  ) {
    this.setSelectionState("confirming");
    this.finishTargetSelection();
  } else {
    this.highlightTargetCandidates();
    this.updateFieldTargetingProgress();
  }
}

/**
 * Finish the current target selection session and execute callback.
 */
export async function finishTargetSelection() {
  if (!this.targetSelection) return;
  const selection = this.targetSelection;
  this.setSelectionState("resolving");
  this.targetSelection = null;
  this.graveyardSelection = null;
  this.clearTargetHighlights();
  this.setSelectionDimming(false);
  if (this.ui && typeof this.ui.hideFieldTargetingControls === "function") {
    this.ui.hideFieldTargetingControls();
  }
  if (selection?.closeModal) {
    selection.closeModal();
  }

  // Generic decision observability for the live human provider.
  if (this.turn === "player" && selection.selections) {
    const selectedKeys = Object.values(selection.selections).flat();
    if (selectedKeys.length > 0 && selection.requirements?.length > 0) {
      const firstReq = selection.requirements[0];
      const selectedCards = selectedKeys
        .map(key => firstReq?.candidates?.find(c => c.key === key)?.cardRef)
        .filter(Boolean);
      
      if (selectedCards.length > 0) {
        // Usar primeiro efeito como ID padrão, ou kind da sessão como fallback
        const effectId = selection.card?.effects?.[0]?.id || selection.kind;
        
        this.notify("decision_completed", {
          player: "player",
          sourceCard: selection.card,
          effectId,
          selectedTargets: selectedCards.map(c => ({
            id: c.id,
            name: c.name,
          })),
          selectedCount: selectedCards.length,
        });
      }
    }
  }

  const actor = getSelectionActor(this, selection);
  this.recordDecision?.(
    {
      kind:
        selection.selectionContract?.purpose ||
        selection.kind ||
        "target_selection",
      actor,
      candidates: (selection.requirements || []).flatMap(
        (requirement) => requirement.candidates || [],
      ),
      requireCandidate: false,
      serializeResult: () => serializeSelectionValue(this, selection),
    },
    selection.selections || {},
  );

  let normalized = {
    success: false,
    needsSelection: false,
    reason: "Selection failed.",
  };
  const deferredReplayCommand = selection.replayCommandDescriptor || null;
  if (deferredReplayCommand) {
    this._activeDeferredReplayCommandDescriptor = deferredReplayCommand;
  }

  try {
    if (typeof selection.execute !== "function") {
      console.warn("[Game] Selection missing execute handler:", selection);
    } else {
      const result = await selection.execute(selection.selections || {});
      normalized = this.normalizeActivationResult(result);
    }

    if (
      selection.rollback &&
      selection.activationContext?.committed === true &&
      !normalized.needsSelection &&
      !normalized.success
    ) {
      try {
        selection.rollback();
      } catch (err) {
        console.error("[Game] Rollback failed:", err);
      }
    }

    if (typeof selection.onResult === "function") {
      const result = selection.onResult(normalized);
      if (result && typeof result.then === "function") {
        await result;
      }
    }
  } catch (err) {
    console.error("[Game] Error resolving selection:", err);
  } finally {
    if (this._activeDeferredReplayCommandDescriptor === deferredReplayCommand) {
      this._activeDeferredReplayCommandDescriptor = null;
    }
    const replayCommand = deferredReplayCommand;
    if (replayCommand) {
      if (normalized.needsSelection && this.targetSelection) {
        this.targetSelection.replayCommandDescriptor = replayCommand;
      } else {
        this.recordReplayCommand?.(replayCommand);
      }
    }
    if (!this.targetSelection) {
      this.setSelectionState("idle");
    }
  }
}

/**
 * Cancel the current target selection session.
 */
export function cancelTargetSelection() {
  if (!this.targetSelection) return;
  if (this.targetSelection.preventCancel) {
    return;
  }
  const selection = this.targetSelection;
  if (typeof selection.onCancel === "function") {
    selection.onCancel();
  }
  if (selection?.resolve) {
    selection.resolve([]);
  }
  this.clearTargetHighlights();
  this.setSelectionDimming(false);
  if (this.ui && typeof this.ui.hideFieldTargetingControls === "function") {
    this.ui.hideFieldTargetingControls();
  }
  if (selection?.closeModal) {
    selection.closeModal();
  }
  this.targetSelection = null;
  this.setSelectionState("idle");
}
