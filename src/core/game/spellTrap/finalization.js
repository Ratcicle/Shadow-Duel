// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/spellTrap/finalization.js
// Spell/Trap finalization methods for Game class — B.9 extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finalizes spell/trap activation (post-chain resolution).
 * Moves non-continuous spells/traps to graveyard after activation.
 * @param {Card} card - The card being finalized.
 * @param {Player} owner - The card owner.
 * @param {string} activationZone - Zone where activation occurred.
 */
export function finalizeSpellTrapActivation(
  card,
  owner,
  activationZone = null
) {
  if (!card || !owner) return;
  const subtype = card.subtype || "";
  const kind = card.cardKind || "";
  const shouldSendToGY =
    (kind === "spell" && (subtype === "normal" || subtype === "quick-play")) ||
    (kind === "trap" && subtype === "normal");

  if (shouldSendToGY) {
    this.moveCard(card, owner, "graveyard", { fromZone: activationZone });
  }
}
/**
 * Move a Spell/Trap from hand to the appropriate zone before resolving
 * activation. Returns the committed card reference and activation zone.
 * @param {Player} player - The player performing activation.
 * @param {number} handIndex - Index of the card in hand.
 * @returns {Object|null} Commit info with cardRef, activationZone, etc.
 */
export function commitCardActivationFromHand(player, handIndex) {
  if (!player || handIndex == null) return null;
  const card = player.hand?.[handIndex];
  if (!card) return null;
  if (card.cardKind !== "spell" && card.cardKind !== "trap") return null;

  const isFieldSpell = card.subtype === "field";
  const activationZone = isFieldSpell ? "fieldSpell" : "spellTrap";
  const replacedFieldSpell = isFieldSpell ? player.fieldSpell : null;

  // Check zone capacity
  if (!isFieldSpell && player.spellTrap.length >= 5) {
    this.ui.log("Spell/Trap zone is full (max 5 cards).");
    return null;
  }

  // Ensure face-up when placed
  card.isFacedown = false;

  // Move to destination
  if (typeof this.moveCard === "function") {
    this.moveCard(card, player, activationZone, { fromZone: "hand" });
  } else {
    // Fallback (should not happen)
    player.hand.splice(handIndex, 1);
    if (isFieldSpell) {
      player.fieldSpell = card;
    } else {
      player.spellTrap.push(card);
    }
  }

  // Determine zone index if in S/T array
  const zoneIndex =
    activationZone === "spellTrap" ? player.spellTrap.indexOf(card) : null;

  this.updateBoard();

  return {
    cardRef: card,
    activationZone,
    zoneIndex,
    fromIndex: handIndex,
    replacedFieldSpell,
  };
}

/**
 * Rollback a spell activation if it fails mid-process.
 * @param {Player} player - The player whose activation is being rolled back.
 * @param {Object} commitInfo - Info from commitCardActivationFromHand.
 */
export function rollbackSpellActivation(player, commitInfo) {
  if (!player || !commitInfo || !commitInfo.cardRef) return;
  const { cardRef, activationZone, fromIndex, replacedFieldSpell } = commitInfo;
  const sourceZone = activationZone || "spellTrap";
  this.moveCard(cardRef, player, "hand", { fromZone: sourceZone });

  if (
    typeof fromIndex === "number" &&
    fromIndex >= 0 &&
    fromIndex < player.hand.length
  ) {
    const currentIndex = player.hand.indexOf(cardRef);
    if (currentIndex > -1 && currentIndex !== fromIndex) {
      player.hand.splice(currentIndex, 1);
      player.hand.splice(fromIndex, 0, cardRef);
    }
  }

  if (
    activationZone === "fieldSpell" &&
    replacedFieldSpell &&
    player.graveyard?.includes(replacedFieldSpell)
  ) {
    this.moveCard(replacedFieldSpell, player, "fieldSpell", {
      fromZone: "graveyard",
    });
  }

  this.updateBoard();
  this.assertStateInvariants("rollbackSpellActivation", { failFast: false });
}
