/**
 * players.js
 *
 * Player navigation helpers extracted from Game.js.
 *
 * Methods:
 *  - getOpponent
 *  - resolvePlayerById
 */

export function getOpponent(player) {
  return player.id === "player" ? this.bot : this.player;
}

export function resolvePlayerById(id = "player") {
  return id === "bot" ? this.bot : this.player;
}
