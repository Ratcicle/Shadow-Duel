/**
 * Selection session management - start, advance, finish, cancel sessions.
 * Extracted from Game.js as part of B.3 modularization.
 */

import type {
  DecisionBrokerMode,
  DecisionKind,
  DecisionRequest,
  DecisionResult,
  RecordedDecision,
  SelectionDecisionKind,
} from "../../contracts/decisions.js";
import type { DuelCardId, SelectionCandidateKey } from "../../contracts/primitives.js";
import type {
  ActiveSelectionSession,
  NormalizedSelectionContract,
  NormalizedSelectionExecutionResult,
  RawSelectionContract,
  SelectionCandidate,
  SelectionCardReference,
  SelectionExecutionReturn,
  SelectionNormalizationOverrides,
  SelectionNormalizationResult,
  SelectionPlayerReference,
  SelectionRequirement,
  SelectionResult,
  SelectionSessionInput,
  SelectionSessionState,
  SerializedSelectionCandidateIdentity,
  SerializedSelectionValue,
} from "../../contracts/selection.js";

type UnknownObject = { [property: string]: unknown };

interface SelectionModalHandle {
  close(): void;
}

interface SelectionSessionUiPort {
  showFieldTargetingControls?(
    onConfirm: () => void,
    onCancel: (() => void) | null,
    config: {
      allowCancel: boolean;
      message: string | null;
      selectionContract: NormalizedSelectionContract;
      sourceCard: SelectionCardReference | string | null;
      sourceCardName: string | null;
    },
  ): { updateState?(state: object): void } | null | undefined;
  hideFieldTargetingControls?(): void;
  showTargetSelection?(
    contract: NormalizedSelectionContract,
    onConfirm: (selections: SelectionResult) => void,
    onCancel: (() => void) | null,
    config: { allowCancel: boolean; allowEmpty: boolean },
  ): SelectionModalHandle | null | undefined;
  log(message: string): void;
}

interface SelectionDecisionBrokerState {
  mode: DecisionBrokerMode;
}

interface SelectionSessionHost {
  player: SelectionPlayerReference;
  bot: SelectionPlayerReference;
  turn: string;
  targetSelection: ActiveSelectionSession | null;
  graveyardSelection: object | null;
  selectionState: SelectionSessionState;
  selectionSessionCounter: number;
  lastSelectionSessionId: number;
  decisionBroker?: SelectionDecisionBrokerState | null;
  pendingReplayDecisionPromise?: Promise<void> | null;
  _activeDeferredReplayCommandDescriptor?: object | null;
  ui: SelectionSessionUiPort;
  normalizeSelectionContract(
    contract: unknown,
    overrides?: SelectionNormalizationOverrides,
  ): SelectionNormalizationResult;
  canUseFieldTargeting(
    requirements: SelectionRequirement[] | NormalizedSelectionContract,
  ): boolean;
  cancelTargetSelection(): void;
  setSelectionState(state: SelectionSessionState): void;
  clearTargetHighlights(): void;
  setSelectionDimming(active: boolean): void;
  advanceTargetSelection(): void;
  finishTargetSelection(): Promise<void>;
  highlightTargetCandidates(): void;
  updateFieldTargetingProgress(): void;
  devLog(tag: string, detail?: object): void;
  ensureDuelCardId?(card: SelectionCardReference): DuelCardId | number | null;
  requestDecision<Kind extends DecisionKind>(
    input: DecisionRequest<Kind>,
  ): Promise<DecisionResult<Kind>>;
  recordDecision?<Kind extends DecisionKind>(
    input: DecisionRequest<Kind>,
    result?: DecisionResult<Kind>,
  ): RecordedDecision<Kind>;
  notify(eventName: string, payload: object): void;
  normalizeActivationResult(
    result: SelectionExecutionReturn,
  ): NormalizedSelectionExecutionResult;
  recordReplayCommand?(descriptor: object): void;
}

function isObject(value: unknown): value is UnknownObject {
  return typeof value === "object" && value !== null;
}

function readValue(value: UnknownObject, key: string): unknown {
  return Reflect.get(value, key);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  ) && typeof Reflect.get(value, "then") === "function";
}

function getSelectionDecisionKind(
  selection: ActiveSelectionSession,
): SelectionDecisionKind {
  const legacyPurpose = Reflect.get(selection.selectionContract, "purpose");
  return (
    legacyPurpose || selection.kind || "target_selection"
  ) as SelectionDecisionKind;
}

function getCurrentTargetSelection(
  game: SelectionSessionHost,
): ActiveSelectionSession | null {
  return Reflect.get(game, "targetSelection") as ActiveSelectionSession | null;
}

function getSelectionActor(
  game: SelectionSessionHost,
  selection: Partial<SelectionSessionInput> | ActiveSelectionSession = {},
): SelectionPlayerReference {
  return (
    selection.owner ||
    selection.player ||
    selection.controller ||
    (game.turn === "bot" ? game.bot : game.player)
  );
}

function serializeSelectionCandidate(
  game: SelectionSessionHost,
  candidate: SelectionCandidate,
): SerializedSelectionCandidateIdentity {
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

function serializeSelectionValue(
  game: SelectionSessionHost,
  selection: ActiveSelectionSession,
): SerializedSelectionValue {
  const selections: SerializedSelectionValue["selections"] = {};
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

function deserializeSelectionValue(
  game: SelectionSessionHost,
  selection: ActiveSelectionSession,
  value: unknown = {},
): SelectionResult {
  const output: SelectionResult = {};
  const valueObject = isObject(value) ? value : {};
  const recordedSelections = readValue(valueObject, "selections");
  for (const requirement of selection.requirements || []) {
    const recorded = isObject(recordedSelections)
      ? readValue(recordedSelections, requirement.id)
      : undefined;
    const recordedEntries = Array.isArray(recorded) ? recorded : [];
    output[requirement.id] = recordedEntries
      .map((identity: SerializedSelectionCandidateIdentity) => {
        const match = (requirement.candidates || []).find((candidate) => {
          const current = serializeSelectionCandidate(game, candidate);
          const identityDuelCardId = Reflect.get(identity, "duelCardId");
          const identityEffectId = Reflect.get(identity, "effectId");
          const identityCandidateKey = Reflect.get(identity, "candidateKey");
          const identityKey = Reflect.get(identity, "key");
          if (identityDuelCardId != null) {
            return (
              Number(Reflect.get(current, "duelCardId")) ===
                Number(identityDuelCardId) &&
              (identityEffectId == null ||
                Reflect.get(current, "effectId") === identityEffectId)
            );
          }
          if (identityCandidateKey != null) {
            return (
              String(Reflect.get(current, "candidateKey")) ===
              String(identityCandidateKey)
            );
          }
          return String(candidate.key ?? candidate.id) === String(identityKey);
        });
        return match?.key ?? match?.id ?? null;
      })
      .filter((key) => key != null) as SelectionCandidateKey[];
  }
  return output;
}

/**
 * Set the current selection state.
 */
export function setSelectionState(
  this: SelectionSessionHost,
  state: SelectionSessionState,
): void {
  this.selectionState = state;
  if (this.targetSelection) {
    this.targetSelection.state = state;
  }
}

/**
 * Force clear target selection (invariant cleanup).
 */
export function forceClearTargetSelection(
  this: SelectionSessionHost,
  reason = "invariant_cleanup",
): void {
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
 */
export function startTargetSelectionSession(
  this: SelectionSessionHost,
  session: SelectionSessionInput | null | undefined,
): void | Promise<void> {
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
    const decisionKind = getSelectionDecisionKind(replaySelection);
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
    let trackedPromise: Promise<void> | null = null;
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
        candidates: firstReq.candidates.map((candidate) => ({
          id: candidate.cardRef?.id,
          name: candidate.cardRef?.name,
          zone: candidate.zone || "field",
          key: candidate.key,
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
      (chosenMap: SelectionResult) => {
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
export function advanceTargetSelection(this: SelectionSessionHost): void {
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
export async function finishTargetSelection(
  this: SelectionSessionHost,
): Promise<void> {
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
        .map(
          (key) =>
            firstReq?.candidates?.find((candidate) => candidate.key === key)
              ?.cardRef,
        )
        .filter(
          (card): card is SelectionCardReference => card != null,
        );
      
      if (selectedCards.length > 0) {
        // Usar primeiro efeito como ID padrão, ou kind da sessão como fallback
        const effectId = selection.card?.effects?.[0]?.id || selection.kind;
        
        this.notify("decision_completed", {
          player: "player",
          sourceCard: selection.card,
          effectId,
          selectedTargets: selectedCards.map((card) => ({
            id: card.id,
            name: card.name,
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
        getSelectionDecisionKind(selection),
      actor,
      candidates: (selection.requirements || []).flatMap(
        (requirement) => requirement.candidates || [],
      ),
      requireCandidate: false,
      serializeResult: () => serializeSelectionValue(this, selection),
    },
    selection.selections || {},
  );

  let normalized: NormalizedSelectionExecutionResult = {
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
      if (isPromiseLike(result)) {
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
      const nextSelection = getCurrentTargetSelection(this);
      if (normalized.needsSelection && nextSelection) {
        nextSelection.replayCommandDescriptor = replayCommand;
      } else {
        this.recordReplayCommand?.(replayCommand);
      }
    }
    if (!getCurrentTargetSelection(this)) {
      this.setSelectionState("idle");
    }
  }
}

/**
 * Cancel the current target selection session.
 */
export function cancelTargetSelection(this: SelectionSessionHost): void {
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
