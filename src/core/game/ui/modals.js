// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/ui/modals.js
// Modal display methods for Game class — B.10 extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shows the ignition effect activation modal.
 * @param {Card} card - The card with the ignition effect.
 * @param {Function} onActivate - Callback when user confirms activation.
 */
export function showIgnitionActivateModal(card, onActivate) {
  if (this.ui && typeof this.ui.showIgnitionActivateModal === "function") {
    this.ui.showIgnitionActivateModal(card, onActivate);
  }
}

/**
 * Shows the Shadow Heart Cathedral modal for monster selection.
 * @param {Array} validMonsters - List of valid monsters to choose from.
 * @param {number} maxAtk - Maximum ATK value for selection.
 * @param {number} counterCount - Number of counters on the card.
 * @param {Function} callback - Callback with selected monster or null.
 */
export function showShadowHeartCathedralModal(
  validMonsters,
  maxAtk,
  counterCount,
  callback
) {
  console.log(
    `[Cathedral Modal] Opening with ${validMonsters.length} valid monsters, Max ATK: ${maxAtk}, Counters: ${counterCount}`
  );

  if (this.ui && typeof this.ui.showShadowHeartCathedralModal === "function") {
    this.ui.showShadowHeartCathedralModal(
      validMonsters,
      maxAtk,
      counterCount,
      callback
    );
    return;
  }

  if (this.ui && typeof this.ui.showCardSelectionModal === "function") {
    this.ui.showCardSelectionModal(
      validMonsters,
      `Select 1 monster (Max ATK: ${maxAtk})`,
      1,
      callback,
    );
    return;
  }

  console.log("[Cathedral Modal] Renderer unavailable; using first valid monster.");
  callback(validMonsters[0] || null);
}
