/**
 * Runtime card animation queue helpers for Game.
 * The renderer owns playback; Game only records visual intents.
 */

export function queueCardAnimation(intent = {}) {
  if (!this.cardAnimationsReady) return false;
  if (!intent || !intent.card || intent.card.instanceId == null) return false;

  if (!Array.isArray(this.pendingCardAnimations)) {
    this.pendingCardAnimations = [];
  }

  const cardKey = String(intent.card.instanceId);
  this.pendingCardAnimations.push({
    ...intent,
    cardKey,
  });
  return true;
}

