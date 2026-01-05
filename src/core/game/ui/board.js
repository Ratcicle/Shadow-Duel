// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/ui/board.js
// Board rendering and update methods for Game class — B.10 extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Updates the entire board display.
 * Refreshes all zones, LP, phase track, and indicators.
 */
export function updateBoard() {
  const renderNow = () => {
    // Defensive cleanup: drop undefined slots to avoid renderer crashes
    const cleanPlayerZones = (p) => {
      p.hand = (p.hand || []).filter(Boolean);
      p.field = (p.field || []).filter(Boolean);
      p.spellTrap = (p.spellTrap || []).filter(Boolean);
      p.graveyard = (p.graveyard || []).filter(Boolean);
      p.extraDeck = (p.extraDeck || []).filter(Boolean);
    };
    cleanPlayerZones(this.player);
    cleanPlayerZones(this.bot);

    // Update passive effects before rendering
    this.effectEngine?.updatePassiveBuffs();
    if (typeof this.player.updatePassiveEffects === "function") {
      this.player.updatePassiveEffects();
    }
    if (typeof this.bot.updatePassiveEffects === "function") {
      this.bot.updatePassiveEffects();
    }

    this.ui.renderHand(this.player);
    this.ui.renderField(this.player);
    this.ui.renderFieldSpell(this.player);

    if (typeof this.ui.renderSpellTrap === "function") {
      this.ui.renderSpellTrap(this.player);
      this.ui.renderSpellTrap(this.bot);
    } else {
      console.warn("Renderer missing renderSpellTrap implementation.");
    }

    this.ui.renderHand(this.bot);
    this.ui.renderField(this.bot);
    this.ui.renderFieldSpell(this.bot);
    this.ui.updateLP(this.player);
    this.ui.updateLP(this.bot);
    this.ui.updatePhaseTrack(this.phase);
    this.ui.updateTurn(this.turn === "player" ? this.player : this.bot);
    this.ui.updateGYPreview(this.player);
    this.ui.updateGYPreview(this.bot);

    if (typeof this.ui.updateExtraDeckPreview === "function") {
      this.ui.updateExtraDeckPreview(this.player);
      this.ui.updateExtraDeckPreview(this.bot);
    }

    if (this.targetSelection?.usingFieldTargeting) {
      this.highlightTargetCandidates();
    }

    // Highlight cards ready for special summon after rendering
    if (this.pendingSpecialSummon) {
      this.highlightReadySpecialSummon();
    }

    this.updateActivationIndicators();
    this.updateAttackIndicators();
  };

  renderNow();
}

/**
 * Highlights cards in hand ready for pending special summon.
 */
export function highlightReadySpecialSummon() {
  // Find and highlight the card ready for special summon in hand
  if (!this.pendingSpecialSummon) return;
  const indices = [];
  this.player.hand.forEach((card, index) => {
    if (card && card.name === this.pendingSpecialSummon.cardName) {
      indices.push(index);
    }
  });
  if (this.ui && typeof this.ui.applyHandTargetableIndices === "function") {
    this.ui.applyHandTargetableIndices("player", indices);
  }
}
