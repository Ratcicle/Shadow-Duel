/**
 * draw.js
 *
 * Draw-related methods extracted from Game.js.
 * Handles card draw operations.
 *
 * Methods: drawCards, forceOpeningHand
 */

import { cardDatabaseByName } from "../../../data/cards.js";
import Card from "../../Card.js";

/**
 * Draws multiple cards for a player.
 * @param {Object} player - The player drawing cards
 * @param {number} count - Number of cards to draw (default: 1)
 * @param {Object} options - Options { silent, message }
 * @returns {{ ok: boolean, success: boolean, reason?: string, nonFatal?: boolean, drawn: Card[] }}
 */
export function drawCards(player, count = 1, options = {}) {
  if (!player) {
    return {
      ok: false,
      success: false,
      reason: "invalid_player",
      nonFatal: true,
      drawn: [],
    };
  }

  const drawCount = Math.max(0, Number(count) || 0);
  if (drawCount === 0) {
    return { ok: true, success: true, drawn: [] };
  }

  const drawn = [];
  for (let i = 0; i < drawCount; i += 1) {
    const card = player.draw();
    if (!card) {
      if (!options.silent && this.ui?.log) {
        this.ui.log(options.message || "Deck is empty.");
      }
      this.devLog("DRAW_FAIL", {
        summary: `${player.id} deck empty`,
        player: player.id,
        requested: drawCount,
        drawn: drawn.length,
      });
      return {
        ok: false,
        success: false,
        reason: "deck_empty",
        nonFatal: true,
        drawn,
      };
    }
    drawn.push(card);
    if (
      this.cardAnimationsReady &&
      options.animateCards !== false &&
      typeof this.queueCardAnimation === "function"
    ) {
      const source = this.ui?.captureCardAnimationSource?.(card, {
        ownerId: player.id,
        zone: "deck",
      });
      this.queueCardAnimation({
        kind: "draw",
        card,
        fromOwnerId: player.id,
        toOwnerId: player.id,
        fromZone: "deck",
        toZone: "hand",
        fromRect: source?.rect || null,
        fromHadCardElement: false,
        fromVisual: source?.visual || null,
      });
    }
  }

  return { ok: true, success: true, drawn };
}

/**
 * Forces specific cards into the opening hand (for testing).
 * @param {string} cardName - Name of the card to force
 * @param {number} count - Number of copies to ensure
 */
export function forceOpeningHand(cardName, count) {
  if (!cardName || count <= 0) return;
  const data = cardDatabaseByName.get(cardName);
  if (!data || !this.player || !Array.isArray(this.player.deck)) return;

  const ensured = [];
  for (let i = 0; i < count; i++) {
    const idx = this.player.deck.findIndex((card) => card?.name === cardName);
    if (idx !== -1) {
      ensured.push(this.player.deck.splice(idx, 1)[0]);
    } else {
      const card = new Card(data, this.player.id);
      this.ensureDuelCardId?.(card);
      ensured.push(card);
    }
  }

  ensured.forEach((card) => this.player.deck.push(card));
}
