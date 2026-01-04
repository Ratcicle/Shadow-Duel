/**
 * Summon execution - flip summon, fusion summon, special summon.
 * Extracted from Game.js as part of B.6 modularization.
 */

/**
 * Perform a Flip Summon on a face-down monster.
 * @param {Object} card - The face-down monster to flip summon
 */
export function flipSummon(card) {
  if (!this.canFlipSummon(card)) return;
  card.isFacedown = false;
  card.revealedTurn = this.turnCounter; // Track when monster was revealed for Ascension timing
  card.position = "attack";
  card.positionChangedThisTurn = true;
  card.cannotAttackThisTurn = true;
  this.ui.log(`${card.name} is Flip Summoned!`);

  this.emit("after_summon", {
    card,
    player: card.owner === "player" ? this.player : this.bot,
    method: "flip",
  });

  this.updateBoard();
}

/**
 * Perform a Fusion Summon using materials from hand/field.
 * @param {Array} materials - Array of material cards
 * @param {number} fusionMonsterIndex - Index in Extra Deck
 * @param {string} position - "attack" or "defense"
 * @param {Array|null} requiredSubset - Subset of required materials
 * @param {Object|null} player - Player performing the summon
 * @returns {boolean} Success status
 */
export function performFusionSummon(
  materials,
  fusionMonsterIndex,
  position = "attack",
  requiredSubset = null,
  player = null
) {
  // Usa o jogador passado ou default para this.player
  const activePlayer = player || this.player;

  // Validate inputs
  if (!materials || materials.length === 0) {
    this.ui.log("No materials selected for Fusion Summon.");
    return false;
  }

  const fusionMonster = activePlayer.extraDeck[fusionMonsterIndex];
  if (!fusionMonster) {
    this.ui.log("Fusion Monster not found in Extra Deck.");
    return false;
  }

  // Check field space
  if (activePlayer.field.length >= 5) {
    this.ui.log("Field is full (max 5 monsters).");
    return false;
  }

  const requiredMaterials =
    requiredSubset && requiredSubset.length ? requiredSubset : materials;
  const requiredSet = new Set(requiredMaterials);
  const extraMaterials = materials.filter((mat) => !requiredSet.has(mat));

  // Send materials to GY
  materials.forEach((material) => {
    this.moveCard(material, activePlayer, "graveyard");
  });

  // Remove fusion monster from Extra Deck
  activePlayer.extraDeck.splice(fusionMonsterIndex, 1);

  // Add to field
  fusionMonster.position = position;
  fusionMonster.isFacedown = false;
  fusionMonster.hasAttacked = false;
  fusionMonster.cannotAttackThisTurn = false;
  fusionMonster.owner = activePlayer.id;
  fusionMonster.summonedTurn = this.turnCounter;
  activePlayer.field.push(fusionMonster);

  const requiredNames = requiredMaterials.map((c) => c.name).join(", ");
  const extraNames = extraMaterials.map((c) => c.name).join(", ");
  const extraNote =
    extraMaterials.length > 0
      ? ` Extra materials also sent to GY: ${extraNames}.`
      : "";

  this.ui.log(
    `Fusion Summoned ${fusionMonster.name} using ${
      requiredNames || "selected materials"
    }.${extraNote}`
  );

  // Emit after_summon event
  this.emit("after_summon", {
    card: fusionMonster,
    player: activePlayer,
    method: "fusion",
    fromZone: "extraDeck",
  });

  this.updateBoard();
  return true;
}

/**
 * Perform a Special Summon from hand (e.g., from Eel effect).
 * @param {number} handIndex - Index in player's hand
 * @param {string} position - "attack" or "defense"
 */
export function performSpecialSummon(handIndex, position) {
  const card = this.player.hand[handIndex];
  if (!card) return;

  // Remove from hand
  this.player.hand.splice(handIndex, 1);

  // Add to field
  card.position = position;
  card.isFacedown = false;
  card.hasAttacked = false;
  card.cannotAttackThisTurn = true; // Cannot attack this turn (from Eel effect)
  card.owner = "player";
  this.player.field.push(card);

  this.ui.log(`Special Summoned ${card.name} from hand.`);

  // Clear pending special summon and unlock actions
  this.pendingSpecialSummon = null;
  this.isResolvingEffect = false;

  // Remove highlight from all hand cards
  if (this.ui && typeof this.ui.applyHandTargetableIndices === "function") {
    this.ui.applyHandTargetableIndices("player", []);
  }

  // Emit after_summon for special summons performed directly from hand
  this.emit("after_summon", {
    card,
    player: this.player,
    opponent: this.bot,
    method: "special",
    fromZone: "hand",
  });

  this.updateBoard();
}
