/**
 * modal.js
 *
 * Extra Deck modal methods extracted from Game.js.
 * Handles extra deck viewing UI.
 *
 * Methods: openExtraDeckModal, closeExtraDeckModal
 */

/**
 * Opens the Extra Deck modal for a player.
 * @param {Object} player - The player whose Extra Deck to show
 */
export function openExtraDeckModal(player) {
  this.ui.renderExtraDeckModal(player.extraDeck);
  this.ui.toggleExtraDeckModal(true);
}

/**
 * Closes the Extra Deck modal.
 */
export function closeExtraDeckModal() {
  this.ui.toggleExtraDeckModal(false);
}
