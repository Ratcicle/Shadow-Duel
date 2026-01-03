/**
 * Selection session management - start, advance, finish, cancel sessions.
 * Extracted from Game.js as part of B.3 modularization.
 */

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

  // Por padrão, evitamos field-targeting em prompts genéricos de alvo,
  // exceto quando explicitamente habilitado pelo contrato (ex.: combate).
  const usingFieldTargeting =
    typeof selectionContract.ui.useFieldTargeting === "boolean"
      ? selectionContract.ui.useFieldTargeting
      : false;
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

  if (usingFieldTargeting) {
    if (this.ui && typeof this.ui.showFieldTargetingControls === "function") {
      const allowCancel =
        this.targetSelection.allowCancel !== false &&
        !this.targetSelection.preventCancel;
      const controlsHandle = this.ui.showFieldTargetingControls(
        () => this.advanceTargetSelection(),
        allowCancel ? () => this.cancelTargetSelection() : null,
        { allowCancel }
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

  let normalized = {
    success: false,
    needsSelection: false,
    reason: "Selection failed.",
  };

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
