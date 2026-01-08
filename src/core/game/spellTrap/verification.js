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
export function canActivatePolymerization(playerOverride = null) {
  // Rate limiting de logs para evitar spam em bot arena
  const now = Date.now();
  this._polyLogCache = this._polyLogCache || { lastLog: 0, count: 0 };
  const LOG_COOLDOWN_MS = 1000; // Max 1 log por segundo
  const shouldLog = now - this._polyLogCache.lastLog > LOG_COOLDOWN_MS;

  const currentPlayer =
    playerOverride ||
    (this.turn === "bot" ? this.bot : this.player) ||
    this.player;
  
  // Check if player has Extra Deck with Fusion Monsters
  if (!currentPlayer?.extraDeck || currentPlayer.extraDeck.length === 0) {
    if (shouldLog) {
      console.log("[canActivatePolymerization] ❌ Bloqueado: sem Extra Deck");
      this._polyLogCache.lastLog = now;
    }
    return false;
  }

  const fieldFull = (currentPlayer.field || []).length >= 5;

  // Get available materials (hand + field)
  const fieldMonsters = (currentPlayer.field || []).filter(
    (card) => card && card.cardKind === "monster"
  );
  const handMonsters = (currentPlayer.hand || []).filter(
    (card) => card && card.cardKind === "monster"
  );
  const availableMaterials = [...fieldMonsters, ...handMonsters];
  const materialInfo = [
    ...fieldMonsters.map(() => ({ zone: "field" })),
    ...handMonsters.map(() => ({ zone: "hand" })),
  ];

  if (availableMaterials.length === 0) {
    if (shouldLog) {
      console.log("[canActivatePolymerization] ❌ Bloqueado: sem monstros disponíveis");
      this._polyLogCache.lastLog = now;
    }
    return false;
  }

  // Check if at least one Fusion Monster can be summoned
  let hasFusion = false;
  for (const fusion of currentPlayer.extraDeck) {
    const combos = this.effectEngine?.findFusionMaterialCombos
      ? this.effectEngine.findFusionMaterialCombos(
          fusion,
          availableMaterials,
          { materialInfo }
        )
      : this.effectEngine?.canSummonFusion?.(
          fusion,
          availableMaterials,
          currentPlayer,
          { materialInfo }
        )
      ? [availableMaterials]
      : [];
    if (!combos || combos.length === 0) continue;
    hasFusion = true;

    if (!fieldFull) {
      // Sempre loga sucessos (raros e importantes)
      console.log(`[canActivatePolymerization] ✅ Permitido: pode invocar ${fusion.name}`);
      return true;
    }

    const usesFieldMaterial = combos.some((combo) =>
      combo.some((mat) => fieldMonsters.includes(mat))
    );
    if (usesFieldMaterial) {
      console.log(`[canActivatePolymerization] ✅ Permitido: pode invocar ${fusion.name}`);
      return true;
    }
  }

  if (shouldLog) {
    if (fieldFull && hasFusion) {
      console.log("[canActivatePolymerization] ❌ Bloqueado: campo cheio sem material de campo na fusão");
    } else {
      console.log("[canActivatePolymerization] ❌ Bloqueado: nenhuma fusão possível com materiais disponíveis");
    }
    this._polyLogCache.lastLog = now;
  }
  return false;
}
