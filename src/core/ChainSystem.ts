/**
 * ChainSystem.ts
 *
 * Sistema de Chain e Spell Speed para Shadow Duel.
 * Gerencia chain windows, validação de spell speed e resolução de Chains
 * em ordem LIFO. A implementação fica nos módulos de `core/chain/` e é
 * anexada ao prototype pelo manifest canônico.
 */

import {
  attachChainMethods,
} from "./chain/attachments.js";
import { FAST_EFFECT_ORIGINS, FAST_EFFECT_STATES } from "./chain/timing.js";
import type {
  ChainCard,
  ChainEffect,
  ChainFinalizationEntry,
  ChainGamePort,
  ChainLink,
  ChainPlayer,
  ChainTriggerCompletion,
  ChainTriggerOccurrence,
  ChainTriggerOpportunity,
  ChainUiPort,
  FastEffectContextInput,
  FastEffectState,
  FullChainHost,
  PendingChainSelection,
  PendingTriggerSelection,
} from "./contracts/chainRuntime.js";
import type { ChainId } from "./contracts/primitives.js";

export {
  CHAIN_ACTIVATION_KINDS,
  CHAIN_EFFECT_KINDS,
  CHAIN_RESPONSE_CONTEXTS,
} from "./chain/link.js";
export { FAST_EFFECT_ORIGINS, FAST_EFFECT_STATES } from "./chain/timing.js";
export {
  SEGOC_GROUPS,
  TRIGGER_REQUIREMENTS,
  TRIGGER_TIMINGS,
} from "./chain/segoc.js";
export { USAGE_POLICIES } from "./chain/usage.js";

export interface ChainSystemOptions {
  responseTimeoutMs?: number;
}

class ChainSystem implements FullChainHost {
  constructor(
    game: ChainGamePort | null,
    options: ChainSystemOptions = {},
  ) {
    this.game = game;
    this.chainWindowOpen = false;
    this.chainWindowContext = null as FastEffectContextInput | null;
    this.chainStack = [] as ChainLink[];
    this.isResolving = false;
    this.cardsBeingResolved = new Set<ChainCard>();
    this.pendingChainSelection = null as PendingChainSelection | null;
    this.isPreparingActivation = false;
    this.activeResponseAbortController = null as AbortController | null;
    this.responseTimeoutMs = Number.isFinite(options.responseTimeoutMs)
      ? Math.max(0, options.responseTimeoutMs ?? 0)
      : 30000;
    this.chainEventCompletions = [] as ChainTriggerCompletion[];
    this.chainTriggerEffectsOffered = new Map<ChainCard, Set<ChainEffect>>();
    this.currentChainLevel = 0;
    this.nextTimingWindowId = 1;
    this.nextTriggerOccurrenceId = 1;
    this.nextAtomicEventGroupId = 1;
    this.nextTriggerOpportunityId = 1;
    this.nextTriggerCandidateId = 1;
    this.pendingTriggerOccurrences = [] as ChainTriggerOccurrence[];
    this.activeTriggerOpportunity = null as ChainTriggerOpportunity | null;
    this.pendingTriggerSelection = null as PendingTriggerSelection | null;
    this._flushingPendingTriggerOccurrences = false;
    this.activeTimingWindowId = null as number | null;
    this.timingDepth = 0;
    this.nextChainId = 1;
    this.nextLinkId = 1;
    this.nextFinalizationId = 1;
    this.pendingChainFinalizations = [] as ChainFinalizationEntry[];
    this.isFinalizingChain = false;
    this.currentFinalizingLink = null as ChainLink | null;
    this.activeChainId = null as ChainId | null;
    this.currentResolvingLink = null as ChainLink | null;
    this.fastEffectState = {
      state: FAST_EFFECT_STATES.OPEN,
      origin: FAST_EFFECT_ORIGINS.PHASE_START,
      timingWindowId: null,
      turnPlayerId: this.getCurrentTurnPlayer()?.id ?? null,
      actionPlayerId: this.getCurrentTurnPlayer()?.id ?? null,
      priorityPlayerId: this.getCurrentTurnPlayer()?.id ?? null,
      lastLinkControllerId: null,
      chainId: null,
      consecutivePasses: 0,
      phaseIntent: null,
    } satisfies FastEffectState;
    this.devMode =
      typeof localStorage !== "undefined" &&
      localStorage.getItem("shadow_duel_dev_mode") === "true";
  }

  /** Log a message when development diagnostics are enabled. */
  log(...args: unknown[]): void {
    if (this.devMode) {
      console.log("[ChainSystem]", ...args);
    }
  }

  /** Resolve the UI adapter exposed by the game facade. */
  getUI(): ChainUiPort | null {
    return this.game?.ui || this.game?.renderer || null;
  }

  /** Resolve the opponent while preserving the legacy player/bot fallback. */
  getOpponent(player: ChainPlayer | null): ChainPlayer | null {
    if (!this.game) return null;
    return player === this.game.player ? this.game.bot : this.game.player;
  }

  /** Return the player whose turn is active. */
  getCurrentTurnPlayer(): ChainPlayer | null {
    if (!this.game) return null;
    return this.game.turn === "player" ? this.game.player : this.game.bot;
  }

  /** Return the player who does not currently hold the turn. */
  getNonTurnPlayer(): ChainPlayer | null {
    if (!this.game) return null;
    return this.game.turn === "player" ? this.game.bot : this.game.player;
  }
}

/**
 * Declaration merging exposes the functions attached to the prototype without
 * emitting class fields or changing the legacy instance shape.
 */
interface ChainSystem extends FullChainHost {}

attachChainMethods(ChainSystem.prototype);

export default ChainSystem;
