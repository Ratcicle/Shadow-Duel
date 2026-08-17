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
    findFusionMaterialCombos?(
      fusion: GameCard,
      materials: GameCard[],
      options: { materialInfo: FusionMaterialLocation[] },
    ): GameCard[][];
    canSummonFusion?(
      fusion: GameCard,
      materials: GameCard[],
      player: GamePlayer,
      options: { materialInfo: FusionMaterialLocation[] },
    ): boolean;
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

  const fieldFull = (currentPlayer.field || []).length >= 5;

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

  let hasFusion = false;
  for (const fusion of currentPlayer.extraDeck) {
    const combos = this.effectEngine?.findFusionMaterialCombos
      ? this.effectEngine.findFusionMaterialCombos(fusion, availableMaterials, {
          materialInfo,
        })
      : this.effectEngine?.canSummonFusion?.(
            fusion,
            availableMaterials,
            currentPlayer,
            { materialInfo },
          )
        ? [availableMaterials]
        : [];
    if (!combos || combos.length === 0) continue;
    hasFusion = true;

    if (!fieldFull) {
      debugPolymerization(`Allowed: can summon ${fusion.name}`);
      return true;
    }

    const usesFieldMaterial = combos.some((combo) =>
      combo.some((mat) => fieldMonsters.includes(mat)),
    );
    if (usesFieldMaterial) {
      debugPolymerization(`Allowed: can summon ${fusion.name}`);
      return true;
    }
  }

  if (fieldFull && hasFusion) {
    debugPolymerization("Blocked: field full without field material in fusion");
  } else {
    debugPolymerization("Blocked: no possible fusion with available materials");
  }
  return false;
}
