import { isAI } from "../../Player.js";
import type {
  FullGameHost,
  GameCard,
  GamePlayer,
  VisualFeedback,
} from "../../contracts/gameRuntime.js";
import type { PlayerId } from "../../contracts/primitives.js";
import type { CanonicalZone } from "../../contracts/zones.js";

export interface CardAnimationIntent {
  kind: string;
  card: GameCard;
  fromOwnerId?: PlayerId | string | null;
  toOwnerId?: PlayerId | string | null;
  fromZone?: CanonicalZone | "token" | null;
  toZone?: CanonicalZone | null;
  fromRect?: unknown;
  fromHadCardElement?: boolean;
  fromVisual?: unknown;
  cardKey?: string;
}

export interface QueuedCardAnimation extends CardAnimationIntent {
  cardKey: string;
}

export interface VisualFeedbackIntent extends VisualFeedback {
  sourceCard?: GameCard | null;
  targetCard?: GameCard | null;
  sourceCardKey?: string | null;
  targetCardKey?: string | null;
  targetZone?: CanonicalZone;
}

export interface QueuedVisualFeedback extends VisualFeedbackIntent {
  sourceCardKey: string | null;
  targetCardKey: string | null;
}

type CardAnimationHost = Pick<
  FullGameHost,
  | "cardAnimationsReady"
  | "gameOver"
  | "pendingBoardPresentationPromise"
  | "_botArenaMode"
  | "disablePresentationDelays"
> & {
  pendingCardAnimations: QueuedCardAnimation[];
  pendingVisualFeedback: QueuedVisualFeedback[];
  aiPresentationStepDelayMs: number;
};

/**
 * Runtime card animation queue helpers for Game.
 * The renderer owns playback; Game only records visual intents.
 */

export function queueCardAnimation(
  this: CardAnimationHost,
  intent: CardAnimationIntent = {} as CardAnimationIntent,
) {
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

export function queueVisualFeedback(
  this: CardAnimationHost,
  intent: VisualFeedbackIntent = {} as VisualFeedbackIntent,
) {
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

export function waitForAiPresentationStep(
  this: CardAnimationHost,
  player: GamePlayer,
  options: { delayMs?: number } = {},
): Promise<void> {
  if (!isAI(player)) return Promise.resolve();
  if (this.gameOver) return Promise.resolve();

  const delayMs = typeof options.delayMs === "number" && Number.isFinite(options.delayMs)
    ? options.delayMs
    : this.aiPresentationStepDelayMs;
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function waitForPresentationDelay(
  this: CardAnimationHost,
  defaultDelayMs = 0,
  options: { delayMs?: number } = {},
): Promise<void> {
  if (this.gameOver) return Promise.resolve();
  if (this.disablePresentationDelays === true) return Promise.resolve();

  const defaultDelay = Number.isFinite(defaultDelayMs) ? defaultDelayMs : 0;
  const arenaDelay =
    this._botArenaMode === true && Number.isFinite(this.aiPresentationStepDelayMs)
      ? this.aiPresentationStepDelayMs
      : null;
  const requestedDelay = typeof options.delayMs === "number" && Number.isFinite(options.delayMs)
    ? options.delayMs
    : arenaDelay != null
      ? Math.min(defaultDelay, arenaDelay)
      : defaultDelay;

  if (!Number.isFinite(requestedDelay) || requestedDelay <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, requestedDelay));
}

export async function waitForBoardPresentation(this: CardAnimationHost) {
  if (this.gameOver) return;
  const presentation = this.pendingBoardPresentationPromise;
  if (!presentation || typeof presentation.then !== "function") return;
  await presentation.catch(() => {});
}
