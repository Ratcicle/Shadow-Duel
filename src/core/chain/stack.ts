/**
 * stack.ts
 *
 * Chain stack manipulation and queries extracted from ChainSystem.js.
 * Pure operations on `this.chainStack` plus a few status flags.
 *
 * Methods (bound via prototype on ChainSystem):
 *  - addToChain
 *  - isChainWindowOpen
 *  - getChainLength
 *  - getLastChainLink
 *  - isChainResolving
 *  - cancelChain
 *  - getChainSummary
 */

import type {
  ChainLink,
  FullChainHost,
  PreparedActivation,
  SerializedChainLink,
} from "../contracts/chainRuntime.js";

/**
 * Add a card to the chain stack as a new link.
 */
export function addToChain(
  this: FullChainHost,
  preparedActivation: PreparedActivation,
): ChainLink | null {
  if (
    preparedActivation?.prepared !== true ||
    !preparedActivation.card ||
    !preparedActivation.controller ||
    !preparedActivation.effect
  ) {
    throw new TypeError("addToChain requires a canonical PreparedActivation.");
  }

  const chainLink = this.createChainLink(
    preparedActivation,
    preparedActivation.context || null,
  );
  const usageReservation = this.reserveUsageForChainLink?.(chainLink);
  if (usageReservation?.success === false) {
    return null;
  }
  this.currentChainLevel = chainLink.chainLevel;

  this.chainStack.push(chainLink);

  this.log(
    "CHAIN_LINK_ADDED",
    this.serializeChainLink?.(chainLink),
  );

  const ui = this.getUI();
  if (ui?.log) {
    ui.log(`Chain Link ${this.currentChainLevel}: ${chainLink.card.name}`);
  }

  return chainLink;
}

export function isChainWindowOpen(this: FullChainHost): boolean {
  return this.chainWindowOpen;
}

export function getChainLength(this: FullChainHost): number {
  return this.chainStack.length;
}

export function getLastChainLink(this: FullChainHost): ChainLink | null {
  if (this.chainStack.length === 0) return null;
  return this.chainStack[this.chainStack.length - 1];
}

export function isChainResolving(this: FullChainHost): boolean {
  return this.isResolving;
}

export function cancelChain(this: FullChainHost): void {
  this.log("Chain cancelled");
  this.activeResponseAbortController?.abort?.("chain_cancelled");
  this.activeResponseAbortController = null;
  this.chainStack = [];
  this.chainWindowOpen = false;
  this.chainWindowContext = null;
  this.isResolving = false;
  this.pendingChainSelection = null;
  this.currentChainLevel = 0;
  this.activeChainId = null;
  this.currentResolvingLink = null;
  this.cardsBeingResolved.clear();
  this.isPreparingActivation = false;
  this.chainEventCompletions = [];
  this.chainTriggerEffectsOffered = new Map();
  this.releaseAllUsageReservations?.("chain_cancelled");
  this.resetChainFinalizationState?.("chain_cancelled");
  this.resetTriggerState?.({ clearPending: true });
  this.resetFastEffectTiming?.();
}

export function getChainSummary(
  this: FullChainHost,
): SerializedChainLink[] {
  return this.chainStack
    .map((link) => this.serializeChainLink?.(link))
    .filter((link): link is SerializedChainLink => Boolean(link));
}
