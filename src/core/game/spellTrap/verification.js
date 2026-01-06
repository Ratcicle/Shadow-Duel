// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/spellTrap/verification.js
// Spell/Trap verification/validation methods for Game class — B.9 extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks if a trap can be activated (must be set and not set this turn).
 * @param {Card} card - The trap card to check.
 * @returns {boolean} True if the trap can be activated.
 */
export function canActivateTrap(card) {
  console.log(
    `[canActivateTrap] Checking: ${card?.name}, cardKind: ${card?.cardKind}, isFacedown: ${card?.isFacedown}, turnSetOn: ${card?.turnSetOn}, currentTurn: ${this.turnCounter}`
  );
  if (!card || card.cardKind !== "trap") return false;
  if (!card.isFacedown) return false;
  if (!card.turnSetOn) return false;

  // Trap só pode ser ativada a partir do próximo turno
  const result = this.turnCounter > card.turnSetOn;
  console.log(
    `[canActivateTrap] Result: ${result} (${this.turnCounter} > ${card.turnSetOn})`
  );
  return result;
}

/**
 * Checks if Polymerization can be activated by the player.
 * @returns {boolean} True if Polymerization can be activated.
 */
export function canActivatePolymerization() {
  // Check if player has Extra Deck with Fusion Monsters
  if (!this.player.extraDeck || this.player.extraDeck.length === 0) {
    console.log("[canActivatePolymerization] ❌ Bloqueado: sem Extra Deck");
    return false;
  }

  // Check field space
  if (this.player.field.length >= 5) {
    console.log("[canActivatePolymerization] ❌ Bloqueado: campo cheio (5/5)");
    return false;
  }

  // Get available materials (hand + field)
  const availableMaterials = [
    ...(this.player.hand || []),
    ...(this.player.field || []),
  ].filter((card) => card && card.cardKind === "monster");

  if (availableMaterials.length === 0) {
    console.log("[canActivatePolymerization] ❌ Bloqueado: sem monstros disponíveis");
    return false;
  }

  // Check if at least one Fusion Monster can be summoned
  for (const fusion of this.player.extraDeck) {
    if (
      this.effectEngine.canSummonFusion(fusion, availableMaterials, this.player)
    ) {
      console.log(`[canActivatePolymerization] ✅ Permitido: pode invocar ${fusion.name}`);
      return true;
    }
  }

  console.log("[canActivatePolymerization] ❌ Bloqueado: nenhuma fusão possível com materiais disponíveis");
  return false;
}
