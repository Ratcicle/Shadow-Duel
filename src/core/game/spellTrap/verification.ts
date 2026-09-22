// src/core/game/spellTrap/verification.js
// Spell/Trap verification and validation methods for Game.

import type { GameCard } from "../../contracts/cards.js";
import type { GamePlayer } from "../../contracts/player.js";

interface FusionMaterialLocation {
  zone: "field" | "hand";
}

interface SpellTrapVerificationHost {
  player: GamePlayer;
  bot: GamePlayer;
  turn: string;
  turnCounter: number;
  effectEngine?: {
    getAvailableFusions(
      extraDeck: GameCard[],
      materials: GameCard[],
      player: GamePlayer,
      options: { materialInfo: FusionMaterialLocation[] },
    ): readonly { readonly fusion: GameCard }[];
  } | null;
  devLog?(eventName: string, payload: { summary: string }): void;
}

/**
 * Checks if a trap can be activated (must be set and not set this turn).
 * @param {Card} card - The trap card to check.
 * @returns {boolean} True if the trap can be activated.
 */
export function canActivateTrap(
  this: SpellTrapVerificationHost,
  card: GameCard | null | undefined,
): boolean {
  this.devLog?.("CAN_ACTIVATE_TRAP", {
    summary: `Checking ${card?.name}: kind=${card?.cardKind}, facedown=${card?.isFacedown}, turnSetOn=${card?.turnSetOn}, currentTurn=${this.turnCounter}`,
  });
  if (!card || card.cardKind !== "trap") return false;
  if (!card.isFacedown) return false;
  if (card.turnSetOn === null || card.turnSetOn === undefined) return false;

  const result = this.turnCounter > card.turnSetOn;
  this.devLog?.("CAN_ACTIVATE_TRAP", {
    summary: `Result ${result} (${this.turnCounter} > ${card.turnSetOn})`,
  });
  return result;
}

/**
 * Checks if Polymerization can be activated by the player.
 * @returns {boolean} True if Polymerization can be activated.
 */
export function canActivatePolymerization(
  this: SpellTrapVerificationHost,
  playerOverride: GamePlayer | null = null,
): boolean {
  const debugPolymerization = (summary: string): void => {
    this.devLog?.("CAN_ACTIVATE_POLYMERIZATION", { summary });
  };

  const currentPlayer =
    playerOverride ||
    (this.turn === "bot" ? this.bot : this.player) ||
    this.player;

  if (!currentPlayer?.extraDeck || currentPlayer.extraDeck.length === 0) {
    debugPolymerization("Blocked: no Extra Deck");
    return false;
  }

  const fieldMonsters = (currentPlayer.field || []).filter(
    (card) => card && card.cardKind === "monster",
  );
  const handMonsters = (currentPlayer.hand || []).filter(
    (card) => card && card.cardKind === "monster",
  );
  const availableMaterials = [...fieldMonsters, ...handMonsters];
  const materialInfo: FusionMaterialLocation[] = [
    ...fieldMonsters.map((): FusionMaterialLocation => ({ zone: "field" })),
    ...handMonsters.map((): FusionMaterialLocation => ({ zone: "hand" })),
  ];

  if (availableMaterials.length === 0) {
    debugPolymerization("Blocked: no available monsters");
    return false;
  }

  const available = this.effectEngine?.getAvailableFusions(
    currentPlayer.extraDeck, availableMaterials, currentPlayer, { materialInfo },
  ) || [];
  debugPolymerization(available.length > 0
    ? "Allowed: legal Fusion available"
    : "Blocked: no legal Fusion available");
  return available.length > 0;
}
