/**
 * players.js
 *
 * Player navigation helpers extracted from Game.js.
 *
 * Methods:
 *  - getOpponent
 *  - resolvePlayerById
 */

import type Player from "../../Player.js";
import type { PlayerId } from "../../contracts/primitives.js";

interface PlayerNavigationHost {
  player: Player;
  bot: Player;
}

export function getOpponent(this: PlayerNavigationHost, player: Player) {
  return player.id === "player" ? this.bot : this.player;
}

export function resolvePlayerById(
  this: PlayerNavigationHost,
  id: PlayerId = "player",
) {
  return id === "bot" ? this.bot : this.player;
}
