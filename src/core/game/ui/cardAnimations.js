import { isAI } from "../../Player.js";

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

export function queueVisualFeedback(intent = {}) {
  if (!this.cardAnimationsReady) return false;
  if (!intent || !intent.kind) return false;

  if (!Array.isArray(this.pendingVisualFeedback)) {
    this.pendingVisualFeedback = [];
  }

  const sourceCardKey =
    intent.sourceCardKey ||
    (intent.sourceCard?.instanceId != null
      ? String(intent.sourceCard.instanceId)
      : null);
  const targetCardKey =
    intent.targetCardKey ||
    (intent.targetCard?.instanceId != null
      ? String(intent.targetCard.instanceId)
      : null);

  this.pendingVisualFeedback.push({
    ...intent,
    sourceCardKey,
    targetCardKey,
  });
  return true;
}

export function waitForAiPresentationStep(player, options = {}) {
  if (!isAI(player)) return Promise.resolve();
  if (this.gameOver) return Promise.resolve();

  const delayMs = Number.isFinite(options.delayMs)
    ? options.delayMs
    : this.aiPresentationStepDelayMs;
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
