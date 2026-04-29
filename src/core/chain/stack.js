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
export function addToChain(card, player, effect, context, selections = null, zone = null) {
  this.currentChainLevel++;

  const activationZone = zone || this.determineCardZone(card, player);

  const chainLink = {
    card,
    player,
    effect,
    context,
    zone: activationZone,
    selections,
    chainLevel: this.currentChainLevel,
  };

  this.chainStack.push(chainLink);

  this.log(
    `Chain Link ${this.currentChainLevel}: ${card.name} (${player.id})`,
  );

  const ui = this.getUI();
  if (ui?.log) {
    ui.log(`Chain Link ${this.currentChainLevel}: ${card.name}`);
  }
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
  this.chainStack = [];
  this.chainWindowOpen = false;
  this.chainWindowContext = null;
  this.isResolving = false;
  this.currentChainLevel = 0;
  this.cardsBeingResolved.clear();
}

export function getChainSummary() {
  return this.chainStack.map((link) => ({
    level: link.chainLevel,
    cardName: link.card?.name || "Unknown",
    playerName: link.player?.name || link.player?.id || "Unknown",
  }));
}
