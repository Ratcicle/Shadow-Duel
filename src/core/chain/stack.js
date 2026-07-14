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
  this.currentChainLevel++;

  const preparedInput =
    cardOrPrepared?.prepared === true && cardOrPrepared?.card
      ? cardOrPrepared
      : null;
  const card = preparedInput?.card || cardOrPrepared;
  player = preparedInput?.player || player;
  effect = preparedInput?.effect || effect;
  context = preparedInput?.context || context;
  selections = preparedInput?.selections || selections;
  zone = preparedInput?.zone || zone;

  const activationZone = zone || this.determineCardZone(card, player);

  const chainLink = {
    ...(preparedInput || {}),
    card,
    player,
    effect,
    context,
    zone: activationZone,
    selections,
    chainLevel: this.currentChainLevel,
    prepared: preparedInput?.prepared === true,
    costsPaid: preparedInput?.costsPaid === true,
    committed: preparedInput?.committed === true,
    activationAttempt: preparedInput?.activationAttempt || context?.activationAttempt || null,
    activationContext:
      preparedInput?.activationContext || context?.activationContext || null,
  };

  this.chainStack.push(chainLink);

  this.log(
    `Chain Link ${this.currentChainLevel}: ${card.name} (${player.id})`,
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
  this.cardsBeingResolved.clear();
  this.isPreparingActivation = false;
  this.chainEventCompletions = [];
  this.chainTriggerEffectsOffered = new Map();
}

export function getChainSummary() {
  return this.chainStack.map((link) => ({
    level: link.chainLevel,
    cardName: link.card?.name || "Unknown",
    playerName: link.player?.name || link.player?.id || "Unknown",
  }));
}
