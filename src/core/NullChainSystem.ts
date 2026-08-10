import type { CardAction } from "./contracts/actions.js";
import type {
  ChainActivationCandidate,
  ChainCard,
  ChainRuntimeTriggerOccurrence,
  ChainRuntimeTriggerState,
  DisabledChainTriggerOccurrence,
  DisabledChainTriggerState,
  ChainEffect,
  ChainEffectTarget,
  ChainEventPayload,
  ChainFinalizationEntry,
  ChainFinalizationState,
  ChainGamePort,
  ChainLink,
  ChainOperationResult,
  ChainPlayer,
  ChainRuntimePort,
  ChainSelectionMap,
  ChainTriggerOccurrenceOptions,
  ChainUsageCheck,
  FastEffectContextInput,
  FastEffectState,
  FastEffectTimingInput,
  PreparedActivation,
  PreparedActivationInput,
} from "./contracts/chainRuntime.js";
import type { ChainId } from "./contracts/primitives.js";
import type { CanonicalZone } from "./contracts/zones.js";
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

const CARD_LIST_ZONES = Object.freeze([
  "hand",
  "field",
  "spellTrap",
  "graveyard",
  "banished",
  "deck",
  "extraDeck",
] as const satisfies readonly CanonicalZone[]);

function isChainPlayer(value: ChainPlayer | null | undefined): value is ChainPlayer {
  return value != null;
}

function playerZoneContains(
  player: ChainPlayer,
  zone: (typeof CARD_LIST_ZONES)[number],
  card: ChainCard | null,
): boolean {
  const cards = Reflect.get(player, zone);
  return (
    Array.isArray(cards) &&
    Reflect.apply(Array.prototype.includes, cards, [card]) === true
  );
}

function actionTargetRef(action: CardAction): string | null {
  const targetRef = Reflect.get(action, "targetRef");
  return typeof targetRef === "string" ? targetRef : null;
}

class NullChainSystem implements ChainRuntimePort {
  constructor(game: ChainGamePort | null = null) {
    this.game = game;
    this.chainsDisabled = true;
    this.chainWindowOpen = false;
    this.chainStack = [] as ChainLink[];
    this.isResolving = false;
    this.currentChainLevel = 0;
    this.activeChainId = null as ChainId | null;
    this.nextTimingWindowId = 1;
    this.activeTimingWindowId = null as number | null;
    this.nextTriggerOccurrenceId = 1;
    this.nextAtomicEventGroupId = 1;
    this.nextTriggerOpportunityId = 1;
    this.nextFinalizationId = 1;
    this.pendingChainFinalizations = [] as ChainFinalizationEntry[];
    this.isFinalizingChain = false;
    this.currentFinalizingLink = null as ChainLink | null;
    this.pendingTriggerOccurrences = [] as ChainRuntimeTriggerOccurrence[];
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
    } satisfies FastEffectState;
  }

  log(): void {}

  isChainResolving(): boolean {
    return this.isResolving;
  }

  isChainWindowOpen(): boolean {
    return this.chainWindowOpen;
  }

  getActivatableCardsInChain(): ChainActivationCandidate[] {
    return [];
  }

  getEffectActivationZones(): CanonicalZone[] {
    return [];
  }

  getOpponent(player: ChainPlayer | null): ChainPlayer | null {
    return this.game?.getOpponent?.(player) || null;
  }

  determineCardZone(
    card: ChainCard | null,
    player: ChainPlayer | null = null,
  ): CanonicalZone | null {
    const owners = (player
      ? [player]
      : [this.game?.player, this.game?.bot]
    ).filter(isChainPlayer);
    for (const owner of owners) {
      if (owner.fieldSpell === card) return "fieldSpell";
      for (const zone of CARD_LIST_ZONES) {
        if (playerZoneContains(owner, zone, card)) return zone;
      }
    }
    return null;
  }

  checkActivationUsage(
    _card: ChainCard,
    _player: ChainPlayer,
    effect: ChainEffect,
  ): ChainUsageCheck {
    return { ok: true, policy: effect?.usagePolicy || null };
  }

  reserveUsageForChainLink(): null {
    return null;
  }

  settleUsageForChainLink(): null {
    return null;
  }

  releaseAllUsageReservations(): void {
    this.game?.releaseEffectUsageReservations?.("chain_cancelled");
  }

  queueChainFinalization(): null {
    return null;
  }

  async finalizeWholeChain(): Promise<ChainOperationResult> {
    return { ok: true, success: true, entries: [] };
  }

  getChainFinalizationState(): ChainFinalizationState {
    return { finalizing: false, pendingCount: 0, entries: [] };
  }

  resetChainFinalizationState(): ChainFinalizationState {
    this.pendingChainFinalizations = [];
    this.isFinalizingChain = false;
    this.currentFinalizingLink = null;
    return this.getChainFinalizationState();
  }

  getChainLength(): number {
    return this.chainStack.length;
  }

  getLastChainLink(): null {
    return null;
  }

  getChainSummary(): [] {
    return [];
  }

  getFastEffectState(): FastEffectState {
    return {
      ...this.fastEffectState,
      phaseIntent: this.fastEffectState.phaseIntent
        ? { ...this.fastEffectState.phaseIntent }
        : null,
    };
  }

  allocateAtomicEventGroupId(providedId: number | null = null): number {
    if (
      typeof providedId === "number" &&
      Number.isInteger(providedId) &&
      providedId > 0
    ) {
      return providedId;
    }
    return this.nextAtomicEventGroupId++;
  }

  createTriggerOccurrence(
    eventName: string,
    payload: ChainEventPayload = {},
    options: ChainTriggerOccurrenceOptions = {},
  ): DisabledChainTriggerOccurrence {
    return {
      occurrenceId: this.nextTriggerOccurrenceId++,
      atomicGroupId: this.allocateAtomicEventGroupId(
        options.atomicGroupId ?? payload.atomicGroupId ?? null,
      ),
      eventName,
      payload,
      entries: Array.isArray(options.entries) ? options.entries : null,
      entriesProvided: options.entriesProvided === true,
      onComplete: options.onComplete || null,
      orderRule: options.orderRule || null,
    };
  }

  queueTriggerOccurrence(
    occurrence: ChainRuntimeTriggerOccurrence | null | undefined,
  ): ChainOperationResult {
    if (occurrence) this.pendingTriggerOccurrences.push(occurrence);
    return { ok: true, deferred: true, triggerCount: 0, results: [] };
  }

  async resolveTriggerOccurrences(
    occurrences: ChainRuntimeTriggerOccurrence[] = [],
  ): Promise<ChainOperationResult> {
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

  getTriggerState(): DisabledChainTriggerState {
    return {
      opportunityId: null,
      pendingOccurrenceCount: this.pendingTriggerOccurrences.length,
      selecting: false,
      occurrenceIds: [],
      groups: {},
    };
  }

  resetTriggerState(): ChainRuntimeTriggerState {
    this.pendingTriggerOccurrences = [];
    return this.getTriggerState();
  }

  isOpenGameState(): true {
    return true;
  }

  resetFastEffectTiming(): FastEffectState {
    this.fastEffectState.state = FAST_EFFECT_STATES.OPEN;
    this.fastEffectState.origin = FAST_EFFECT_ORIGINS.PHASE_START;
    this.fastEffectState.timingWindowId = null;
    this.fastEffectState.consecutivePasses = 0;
    this.fastEffectState.phaseIntent = null;
    return this.getFastEffectState();
  }

  async runFastEffectTiming(
    input: FastEffectTimingInput = {},
  ): Promise<ChainOperationResult> {
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

  canActivateInChain(): { ok: false; reason: "chains_disabled" } {
    return { ok: false, reason: "chains_disabled" };
  }

  async openChainWindow(): Promise<false> {
    this.chainWindowOpen = false;
    this.isResolving = false;
    this.chainStack = [];
    this.activeChainId = null;
    this.releaseAllUsageReservations();
    this.resetChainFinalizationState();
    return false;
  }

  async openActivationChain(
    preparedActivation: PreparedActivationInput = {},
  ): Promise<ChainOperationResult> {
    return {
      success: true,
      needsSelection: false,
      activationNegated: false,
      chainsDisabled: true,
      preparedActivation: this.createPreparedActivation(preparedActivation),
    };
  }

  async openEventWindow(
    context: Partial<FastEffectContextInput> = {},
  ): Promise<ChainOperationResult> {
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

  createPreparedActivation(
    input: PreparedActivationInput = {},
  ): PreparedActivation {
    return normalizePreparedActivation(input);
  }

  getEffectActivationCosts(
    effect?: ChainEffect | null,
  ): readonly CardAction[] {
    return Array.isArray(effect?.activationCosts) ? effect.activationCosts : [];
  }

  getActivationCostTargetDefinitions(
    effect?: ChainEffect | null,
  ): ChainEffectTarget[] {
    return getCostTargetDefinitions(effect);
  }

  getDeclaredTargetDefinitions(
    effect?: ChainEffect | null,
  ): ChainEffectTarget[] {
    return getEffectTargetDefinitions(effect);
  }

  async getPlayerSelectionsForDefinitions(
    card: ChainCard,
    definitions: readonly ChainEffectTarget[],
    player: ChainPlayer,
    context: FastEffectContextInput | null,
    options: {
      purpose?: "cost" | "target";
      allowCancel?: boolean;
      activationZone?: CanonicalZone | null;
    } = {},
  ): Promise<ChainSelectionMap | null> {
    return collectSelectionsForDefinitions.call(
      this,
      card,
      definitions,
      player,
      context,
      options,
    );
  }

  getEffectActivationCommitActions(
    effect?: ChainEffect | null,
  ): readonly CardAction[] {
    return Array.isArray(effect?.activationCommitActions)
      ? effect.activationCommitActions
      : [];
  }

  getEffectResolutionActions(
    effect?: ChainEffect | null,
  ): readonly CardAction[] {
    return Array.isArray(effect?.actions) ? effect.actions : [];
  }

  async payActivationCosts(
    prepared: PreparedActivation,
    context: FastEffectContextInput | null = null,
  ): Promise<ChainOperationResult> {
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
        type: action.type || null,
        targetRef: actionTargetRef(action),
      })),
    };
    return { success: true, needsSelection: false };
  }

  async offerChainResponse(): Promise<ChainOperationResult> {
    return { success: false, reason: "chains_disabled" };
  }

  async applyActivationCommitActions(
    prepared: PreparedActivation,
  ): Promise<ChainOperationResult> {
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
        type: action.type || null,
        targetRef: actionTargetRef(action),
      })),
    };
    return { success: true, needsSelection: false };
  }

  addToChain(): false {
    return false;
  }

  async resolveChain(): Promise<false> {
    this.isResolving = false;
    this.chainWindowOpen = false;
    this.chainStack = [];
    this.currentChainLevel = 0;
    this.activeChainId = null;
    this.resetFastEffectTiming();
    return false;
  }

  cancelChain(): void {
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

  reset(): void {
    this.cancelChain();
  }
}

/**
 * Type-only instance fields keep the runtime facade at its legacy 18 own keys;
 * no class fields are emitted.
 */
interface NullChainSystem {
  game: ChainGamePort | null;
  chainsDisabled: true;
  chainWindowOpen: boolean;
  chainStack: ChainLink[];
  isResolving: boolean;
  currentChainLevel: number;
  activeChainId: ChainId | null;
  nextTimingWindowId: number;
  activeTimingWindowId: number | null;
  nextTriggerOccurrenceId: number;
  nextAtomicEventGroupId: number;
  nextTriggerOpportunityId: number;
  nextFinalizationId: number;
  pendingChainFinalizations: ChainFinalizationEntry[];
  isFinalizingChain: boolean;
  currentFinalizingLink: ChainLink | null;
  pendingTriggerOccurrences: ChainRuntimeTriggerOccurrence[];
  fastEffectState: FastEffectState;
}

export default NullChainSystem;
