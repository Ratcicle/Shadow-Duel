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
export function addToChain(cardOrPrepared, player, effect, context, selections = null, zone = null) {
  const preparedInput =
    cardOrPrepared?.prepared === true && cardOrPrepared?.card
      ? cardOrPrepared
      : null;
  if (!preparedInput) {
    this.warnLegacyChainContract?.("addToChain(card, player, effect, ...)");
  }

  const card = preparedInput?.card || cardOrPrepared;
  const controller = preparedInput?.controller || preparedInput?.player || player;
  const resolvedEffect = preparedInput?.effect || effect;
  const resolvedContext = preparedInput?.context || context || null;
  const resolvedSelections = preparedInput?.selections || selections || {};
  const activationZone =
    preparedInput?.activationZone ||
    preparedInput?.zone ||
    zone ||
    this.determineCardZone(card, controller);
  const normalized = preparedInput ||
    this.createPreparedActivation?.({
      card,
      controller,
      player: controller,
      effect: resolvedEffect,
      context: resolvedContext,
      selections: resolvedSelections,
      activationZone,
      zone: activationZone,
      activationContext:
        resolvedContext?.activationContext || {
          sourceZone: activationZone,
          activationZone,
        },
    }) || {
      card,
      controller,
      player: controller,
      effect: resolvedEffect,
      context: resolvedContext,
      selections: resolvedSelections,
      activationZone,
      zone: activationZone,
    };

  const chainLink = this.createChainLink(normalized, resolvedContext);
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
    ui.log(`Chain Link ${this.currentChainLevel}: ${card.name}`);
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
