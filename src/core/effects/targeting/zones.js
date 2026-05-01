/**
 * Targeting Zones Module
 * Extracted from EffectEngine.js - zone access and card location utilities
 *
 * All functions assume `this` = EffectEngine instance
 */

/**
 * Get a specific zone array from a player
 * @param {Object} player - The player object
 * @param {string} zone - Zone name: "field", "hand", "graveyard", "deck", "extraDeck", "spellTrap", "fieldSpell", "banished"
 * @returns {Array} The zone array
 */
export function getZone(player, zone) {
  switch (zone) {
    case "hand":
      return player.hand;
    case "graveyard":
      return player.graveyard;
    case "deck":
      return player.deck;
    case "extraDeck":
      return player.extraDeck;
    case "spellTrap":
      return player.spellTrap;
    case "banished":
      player.banished = player.banished || [];
      return player.banished;
    case "fieldSpell":
      return player.fieldSpell ? [player.fieldSpell] : [];
    case "field":
    default:
      return player.field;
  }
}

/**
 * Find which zone a card is currently in for a given player
 * @param {Object} player - The player object
 * @param {Object} card - The card to find
 * @returns {string|null} The zone name or null if not found
 */
export function findCardZone(player, card) {
  if (!player || !card) return null;
  if (player.field && player.field.includes(card)) return "field";
  if (player.spellTrap && player.spellTrap.includes(card)) return "spellTrap";
  if (player.fieldSpell === card) return "fieldSpell";
  if (player.hand && player.hand.includes(card)) return "hand";
  if (player.graveyard && player.graveyard.includes(card)) return "graveyard";
  if (player.deck && player.deck.includes(card)) return "deck";
  if (player.extraDeck && player.extraDeck.includes(card)) return "extraDeck";
  if (player.banished && player.banished.includes(card)) return "banished";
  return null;
}

/**
 * Get the owner player object for a card
 * @param {Object} card - The card to check
 * @returns {Object|null} The owner player or null
 */
export function getOwnerByCard(card) {
  if (!card || !this.game) return null;
  return card.owner === "player" ? this.game.player : this.game.bot;
}
