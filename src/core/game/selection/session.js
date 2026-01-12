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

  // v4 REPLAY: Emitir evento de opções de targeting para captura
  // Apenas para jogador humano e se tem um requirement com candidatos
  if (this.turn === "player" && selectionContract.requirements?.length > 0) {
    const firstReq = selectionContract.requirements[0];
    if (firstReq?.candidates?.length > 0) {
      // Usar primeiro efeito como ID padrão, ou kind da sessão como fallback
      // Na maioria dos casos, o primeiro efeito é o que está sendo ativado
      const effectId = session.card?.effects?.[0]?.id || session.kind;
      
      this.emit("target_selection_options", {
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

  // v4 REPLAY: Emitir evento de seleção concluída para captura
  // Apenas para jogador humano e se houve seleções
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
        
        this.emit("target_selected", {
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
