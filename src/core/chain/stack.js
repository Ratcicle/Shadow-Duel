/**
 * stack.js
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

/**
 * Add a card to the chain stack as a new link.
 */
export function addToChain(preparedActivation) {
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

export function isChainWindowOpen() {
  return this.chainWindowOpen;
}

export function getChainLength() {
  return this.chainStack.length;
}

export function getLastChainLink() {
  if (this.chainStack.length === 0) return null;
  return this.chainStack[this.chainStack.length - 1];
}

export function isChainResolving() {
  return this.isResolving;
}

export function cancelChain() {
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

export function getChainSummary() {
  return this.chainStack
    .map((link) => this.serializeChainLink?.(link))
    .filter(Boolean);
}
