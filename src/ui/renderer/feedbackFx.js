/**
 * Generic non-blocking feedback FX for board events.
 * The game layer queues visual intents; this module owns playback only.
 */

const DEFAULT_DURATION = 340;
const DEFAULT_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const MAX_FEEDBACK_PER_FLUSH = 16;

const TONES = {
  gold: "255, 214, 102",
  red: "255, 96, 96",
  green: "122, 255, 157",
  blue: "100, 215, 255",
  violet: "187, 134, 252",
};

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function normalizeTone(tone, fallback = "gold") {
  return TONES[tone] ? tone : fallback;
}

function toneRgb(tone) {
  return TONES[normalizeTone(tone)];
}

function copyRect(rect) {
  if (!rect) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function isElementVisible(element) {
  if (!element || typeof window === "undefined") return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function escapeCardKey(cardKey) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(cardKey);
  }
  return String(cardKey).replace(/["\\]/g, "\\$&");
}

function findBoardCardElement(cardKey) {
  if (!cardKey || typeof document === "undefined") return null;
  const root = document.getElementById("game-container");
  if (!root) return null;
  return root.querySelector(
    `.card[data-card-key="${escapeCardKey(cardKey)}"]:not(.card-animation-ghost)`,
  );
}

function getLayer() {
  const root = document.getElementById("game-container");
  if (!root) return null;

  let layer = root.querySelector(":scope > .card-animation-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "card-animation-layer";
    root.appendChild(layer);
  }
  return layer;
}

function finishAnimation(animation, cleanup, duration) {
  if (animation?.finished && typeof animation.finished.then === "function") {
    animation.finished.then(cleanup, cleanup);
    return;
  }
  setTimeout(cleanup, duration + 80);
}

function getPlayerAreaRect(ownerId) {
  const id = ownerId === "bot" ? "bot-area" : "player-area";
  const element = document.getElementById(id);
  return element ? copyRect(element.getBoundingClientRect()) : null;
}

function getPlayerImpactRect(ownerId) {
  const area = getPlayerAreaRect(ownerId);
  if (!area) return null;
  const size = Math.min(
    110,
    Math.max(64, Math.min(area.width, area.height) * 0.36),
  );
  return {
    left: area.left + area.width / 2 - size / 2,
    top: area.top + area.height / 2 - size / 2,
    width: size,
    height: size,
  };
}

function setTone(node, tone) {
  node.style.setProperty("--fx-color", toneRgb(tone));
}

function createAnchoredNode(layer, className, rect, tone) {
  if (!rect) return null;
  const node = document.createElement("div");
  node.className = className;
  setTone(node, tone);
  node.style.left = `${rect.left + rect.width / 2}px`;
  node.style.top = `${rect.top + rect.height / 2}px`;
  node.style.width = `${Math.max(24, rect.width)}px`;
  node.style.height = `${Math.max(24, rect.height)}px`;
  layer.appendChild(node);
  return node;
}

function createAreaNode(layer, className, rect, tone) {
  if (!rect) return null;
  const node = document.createElement("div");
  node.className = className;
  setTone(node, tone);
  node.style.left = `${rect.left}px`;
  node.style.top = `${rect.top}px`;
  node.style.width = `${rect.width}px`;
  node.style.height = `${rect.height}px`;
  layer.appendChild(node);
  return node;
}

function resolveCardElement(intent, preferSource = false) {
  const keys = preferSource
    ? [intent.sourceCardKey, intent.targetCardKey]
    : [intent.targetCardKey, intent.sourceCardKey];
  for (const key of keys) {
    const element = key ? findBoardCardElement(key) : null;
    if (isElementVisible(element)) return element;
  }
  return null;
}

function resolveOwnerId(intent) {
  return (
    intent.targetOwnerId ||
    intent.ownerId ||
    intent.targetCard?.owner ||
    intent.sourceCard?.owner ||
    null
  );
}

function resolveAnchorRect(renderer, intent, preferSource = false) {
  const element = resolveCardElement(intent, preferSource);
  if (element) return copyRect(element.getBoundingClientRect());

  const directRect = preferSource
    ? intent.sourceRect || intent.targetRect || intent.fromRect || null
    : intent.targetRect || intent.sourceRect || intent.fromRect || null;
  if (directRect) return copyRect(directRect);

  const zone = intent.targetZone || intent.fromZone || null;
  const ownerId = resolveOwnerId(intent);
  if (zone && ownerId && typeof renderer.getCardZoneAnchorRect === "function") {
    const zoneRect = renderer.getCardZoneAnchorRect(ownerId, zone, null);
    if (zoneRect) return copyRect(zoneRect);
  }

  return ownerId ? getPlayerImpactRect(ownerId) : null;
}

function playPulse(element, tone, options) {
  if (!element || typeof element.animate !== "function") return;
  const rgb = toneRgb(tone);
  element.animate(
    [
      { filter: "brightness(1)", boxShadow: "none" },
      {
        filter: "brightness(1.18) saturate(1.12)",
        boxShadow: `0 0 0 2px rgba(${rgb}, 0.78), 0 0 22px rgba(${rgb}, 0.62)`,
      },
      { filter: "brightness(1)", boxShadow: "none" },
    ],
    {
      duration: options.duration,
      easing: options.easing,
    },
  );
}

function playRing(layer, rect, tone, options) {
  const ring = createAnchoredNode(layer, "fx-ring", rect, tone);
  if (!ring) return;
  const animation =
    typeof ring.animate === "function"
      ? ring.animate(
          [
            { opacity: 0, transform: "translate(-50%, -50%) scale(0.82)" },
            { opacity: 0.95, transform: "translate(-50%, -50%) scale(1)" },
            { opacity: 0, transform: "translate(-50%, -50%) scale(1.28)" },
          ],
          {
            duration: options.duration,
            easing: options.easing,
          },
        )
      : null;
  finishAnimation(animation, () => ring.remove(), options.duration);
}

function playBurst(layer, rect, tone, options) {
  const burst = createAnchoredNode(layer, "fx-burst", rect, tone);
  if (!burst) return;
  const animation =
    typeof burst.animate === "function"
      ? burst.animate(
          [
            { opacity: 0, transform: "translate(-50%, -50%) scale(0.42)" },
            { opacity: 1, transform: "translate(-50%, -50%) scale(0.9)" },
            { opacity: 0, transform: "translate(-50%, -50%) scale(1.55)" },
          ],
          {
            duration: Math.max(220, options.duration - 30),
            easing: options.easing,
          },
        )
      : null;
  finishAnimation(animation, () => burst.remove(), options.duration);
}

function playPlayerFlash(layer, rect, tone, options) {
  const flash = createAreaNode(layer, "fx-player-flash", rect, tone);
  if (!flash) return;
  const animation =
    typeof flash.animate === "function"
      ? flash.animate(
          [
            { opacity: 0, transform: "scale(0.985)" },
            { opacity: 0.38, transform: "scale(1)" },
            { opacity: 0, transform: "scale(1.015)" },
          ],
          {
            duration: options.duration + 80,
            easing: options.easing,
          },
        )
      : null;
  finishAnimation(animation, () => flash.remove(), options.duration + 80);
}

function playCardFeedback(renderer, layer, intent, options, preferSource = false) {
  const element = resolveCardElement(intent, preferSource);
  const rect =
    (element ? copyRect(element.getBoundingClientRect()) : null) ||
    resolveAnchorRect(renderer, intent, preferSource);
  if (!rect) return;

  if (element) {
    playPulse(element, intent.tone, options);
  }
  playRing(layer, rect, intent.tone, options);
}

function playPlayerFeedback(layer, intent, options) {
  const rect = getPlayerAreaRect(resolveOwnerId(intent));
  if (!rect) return;
  playPlayerFlash(layer, rect, intent.tone, options);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function playVisualFeedback(intents, options = {}) {
  if (prefersReducedMotion() || typeof document === "undefined") return;
  if (!Array.isArray(intents) || intents.length === 0) return;

  const layer = getLayer();
  if (!layer) return;

  const playbackOptions = {
    duration: Number.isFinite(options.feedbackDuration)
      ? options.feedbackDuration
      : DEFAULT_DURATION,
    easing: options.feedbackEasing || DEFAULT_EASING,
  };

  for (const rawIntent of intents.slice(0, MAX_FEEDBACK_PER_FLUSH)) {
    if (!rawIntent?.kind) continue;
    const intent = {
      ...rawIntent,
      tone: normalizeTone(
        rawIntent.tone,
        rawIntent.kind === "damage" || rawIntent.kind === "destroy"
          ? "red"
          : rawIntent.kind === "heal"
            ? "green"
            : "gold",
      ),
    };

    if (intent.kind === "damage" || intent.kind === "heal") {
      playPlayerFeedback(layer, intent, playbackOptions);
      continue;
    }

    if (intent.kind === "effect-activation") {
      playCardFeedback(this, layer, intent, playbackOptions, true);
      continue;
    }

    if (intent.kind === "impact" || intent.kind === "destroy") {
      const rect = resolveAnchorRect(this, intent, false);
      if (rect) playBurst(layer, rect, intent.tone, playbackOptions);
      continue;
    }

    if (
      intent.kind === "buff" ||
      intent.kind === "debuff" ||
      intent.kind === "negate" ||
      intent.kind === "protect"
    ) {
      playCardFeedback(this, layer, intent, playbackOptions, false);
    }
  }
}
