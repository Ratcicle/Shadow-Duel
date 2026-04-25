/**
 * Animation methods for Renderer
 * Handles: card layout FLIP animations and showLpChange
 */

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function isVisibleCardElement(element) {
  if (!element || typeof window === "undefined") return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function getCardRectSnapshot(element) {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * @this {import('../Renderer.js').default}
 */
export function captureCardRects() {
  if (prefersReducedMotion() || typeof document === "undefined") {
    return new Map();
  }

  const root = document.getElementById("game-container");
  if (!root) return new Map();

  const rects = new Map();
  root.querySelectorAll(".card[data-card-key]").forEach((element) => {
    if (!isVisibleCardElement(element)) return;
    const key = element.dataset.cardKey;
    if (!key) return;
    rects.set(key, getCardRectSnapshot(element));
  });
  return rects;
}

/**
 * @this {import('../Renderer.js').default}
 */
export function animateCardLayout(previousRects, options = {}) {
  if (
    prefersReducedMotion() ||
    typeof document === "undefined" ||
    !previousRects ||
    previousRects.size === 0
  ) {
    return;
  }

  const root = document.getElementById("game-container");
  if (!root) return;

  const duration = Number.isFinite(options.duration) ? options.duration : 180;
  const easing = options.easing || "cubic-bezier(0.2, 0.8, 0.2, 1)";
  const minDistance = Number.isFinite(options.minDistance)
    ? options.minDistance
    : 2;

  root.querySelectorAll(".card[data-card-key]").forEach((element) => {
    if (!isVisibleCardElement(element)) return;
    if (typeof element.animate !== "function") return;

    const key = element.dataset.cardKey;
    const previous = previousRects.get(key);
    if (!previous) return;

    const current = getCardRectSnapshot(element);
    const deltaX = previous.left - current.left;
    const deltaY = previous.top - current.top;
    if (Math.hypot(deltaX, deltaY) < minDistance) return;

    const computedTransform = window.getComputedStyle(element).transform;
    const finalTransform =
      computedTransform && computedTransform !== "none"
        ? computedTransform
        : "none";
    const startTransform =
      finalTransform === "none"
        ? `translate(${deltaX}px, ${deltaY}px)`
        : `translate(${deltaX}px, ${deltaY}px) ${finalTransform}`;

    element.animate(
      [
        { transform: startTransform },
        { transform: finalTransform },
      ],
      {
        duration,
        easing,
      }
    );
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showLpChange(player, amount, options = {}) {
  if (!player || !amount) return;
  const value = Number(amount);
  if (!Number.isFinite(value) || value === 0) return;

  const isHeal = value > 0;
  const container = document.getElementById(
    player.id === "player" ? "player-area" : "bot-area"
  );
  if (!container) return;

  const float = document.createElement("div");
  float.className = [
    "lp-float",
    isHeal ? "lp-float-heal" : "lp-float-damage",
    player.id === "player" ? "lp-float-player" : "lp-float-bot",
  ].join(" ");
  float.textContent = `${isHeal ? "+" : ""}${Math.abs(value)}`;
  container.appendChild(float);

  requestAnimationFrame(() => {
    float.classList.add("lp-float-animate");
  });

  const lpEl =
    player.id === "player" ? this.elements.playerLP : this.elements.botLP;
  const counter = lpEl ? lpEl.closest(".lp-counter") : null;
  if (counter) {
    const flashClass = isHeal ? "lp-flash-heal" : "lp-flash-damage";
    counter.classList.remove("lp-flash-heal", "lp-flash-damage");
    counter.classList.add(flashClass);
    setTimeout(() => {
      counter.classList.remove(flashClass);
    }, 420);
  }

  setTimeout(() => {
    float.remove();
  }, 1100);
}
