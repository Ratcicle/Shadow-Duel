/**
 * Animation methods for Renderer
 * Handles: card layout FLIP animations and LP presentation.
 */

const LP_DAMAGE_HOLD_MS = 1000;
const LP_DAMAGE_TRAVEL_MS = 560;
const LP_DAMAGE_FADE_MS = 24;
const LP_ODOMETER_MIN_MS = 600;
const LP_ODOMETER_MAX_MS = 1400;

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

function escapeCardKey(cardKey) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(cardKey);
  }
  return String(cardKey).replace(/["\\]/g, "\\$&");
}

function getCardKey(card) {
  const key = card?.instanceId ?? card?._instanceId ?? null;
  return key != null ? String(key) : null;
}

function findCardElementByKey(cardKey) {
  if (!cardKey || typeof document === "undefined") return null;
  const root = document.getElementById("game-container");
  if (!root) return null;
  return root.querySelector(
    `.card[data-card-key="${escapeCardKey(cardKey)}"]:not(.card-animation-ghost)`,
  );
}

function getVisibleCardRectByKey(cardKey) {
  const element = findCardElementByKey(cardKey);
  return isVisibleCardElement(element) ? getCardRectSnapshot(element) : null;
}

function getVisibleSourceCardRect(options = {}) {
  return (
    copyRect(options.sourceRect) ||
    getVisibleCardRectByKey(options.sourceCardKey) ||
    getVisibleCardRectByKey(getCardKey(options.sourceCard))
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function getPlayerKey(player) {
  return player?.id === "bot" ? "bot" : "player";
}

function readNumber(text) {
  const value = Number(String(text ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(value) ? value : null;
}

function getLpElement(renderer, player) {
  const key = getPlayerKey(player);
  return key === "player" ? renderer.elements.playerLP : renderer.elements.botLP;
}

function getLpCounter(renderer, player) {
  return getLpElement(renderer, player)?.closest(".lp-counter") || null;
}

function getAnimationLayer() {
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

function copyRect(rect) {
  if (!rect) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function getRectCenter(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function getPlayerAreaRect(playerId) {
  const element = document.getElementById(
    playerId === "bot" ? "bot-area" : "player-area",
  );
  return element ? copyRect(element.getBoundingClientRect()) : null;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomPointNearRect(rect) {
  const center = getRectCenter(rect);
  return {
    x: center.x + randomBetween(-40, 40),
    y: center.y + randomBetween(-28, 28),
  };
}

function randomPointInsideRect(rect, margin = 36) {
  const safeMargin = Math.min(margin, rect.width / 3, rect.height / 3);
  return {
    x: randomBetween(rect.left + safeMargin, rect.left + rect.width - safeMargin),
    y: randomBetween(rect.top + safeMargin, rect.top + rect.height - safeMargin),
  };
}

function getDamageOrigin(player, options = {}) {
  if (
    options.originPoint &&
    Number.isFinite(options.originPoint.x) &&
    Number.isFinite(options.originPoint.y)
  ) {
    return options.originPoint;
  }

  const cause = options.cause || "effect";
  const battleRect =
    copyRect(options.battleImpactRect) ||
    copyRect(options.targetRect) ||
    copyRect(options.contactRect) ||
    copyRect(options.sourceRect);
  if (cause === "battle" && battleRect) {
    return randomPointNearRect(battleRect);
  }

  if (cause === "effect") {
    const sourceRect = getVisibleSourceCardRect(options);
    if (sourceRect) {
      return randomPointNearRect(sourceRect);
    }
  }

  const areaRect = getPlayerAreaRect(getPlayerKey(player));
  if (!areaRect) {
    return battleRect ? randomPointNearRect(battleRect) : { x: 0, y: 0 };
  }
  if (cause === "battle") {
    return randomPointNearRect(areaRect);
  }
  return randomPointInsideRect(areaRect, 36);
}

function getDamageDestination(renderer, player) {
  const counter = getLpCounter(renderer, player);
  const rect = counter?.getBoundingClientRect?.();
  if (rect?.width > 0 && rect.height > 0) return getRectCenter(rect);

  const areaRect = getPlayerAreaRect(getPlayerKey(player));
  return areaRect ? getRectCenter(areaRect) : { x: 0, y: 0 };
}

function finishAnimation(animation, duration) {
  if (animation?.finished && typeof animation.finished.then === "function") {
    return animation.finished.catch(() => { });
  }
  return waitMs(duration);
}

function getOdometerDuration(amount) {
  const value = Math.max(0, Number(amount || 0));
  return clamp(560 + value * 0.24, LP_ODOMETER_MIN_MS, LP_ODOMETER_MAX_MS);
}

function playCounterFlash(counter, kind) {
  if (!counter) return;
  const flashClass = kind === "heal" ? "lp-flash-heal" : "lp-flash-damage";
  counter.classList.remove("lp-flash-heal", "lp-flash-damage");
  counter.classList.add(flashClass);
  setTimeout(() => {
    counter.classList.remove(flashClass);
  }, 420);
}

function playEffectDamageShake(renderer, amount, options = {}) {
  if (options.cause !== "effect" || options.screenShake === false) return;
  if (prefersReducedMotion()) return;
  const pixiVfx = renderer?.pixiVfx;
  if (!pixiVfx || typeof pixiVfx.playScreenShake !== "function") return;
  const value = Math.max(0, Number(amount || 0));
  try {
    pixiVfx.playScreenShake({
      duration: clamp(130 + value * 0.03, 130, 210),
      intensity: clamp(2 + value / 900, 2, 4.5),
    });
  } catch (error) {
    console.warn("[Renderer] LP damage screen shake failed.", error);
  }
}

async function playTravelingLpChangeNumber(renderer, player, amount, options = {}) {
  const onArrival =
    typeof options.onArrival === "function" ? options.onArrival : null;
  let arrived = false;
  let arrivalTimer = null;
  const markArrived = () => {
    if (arrived) return;
    arrived = true;
    if (arrivalTimer) {
      clearTimeout(arrivalTimer);
      arrivalTimer = null;
    }
    onArrival?.();
  };

  if (prefersReducedMotion()) {
    markArrived();
    return;
  }

  const layer = getAnimationLayer();
  if (!layer) {
    markArrived();
    return;
  }

  const origin = getDamageOrigin(player, options);
  const destination = getDamageDestination(renderer, player);
  const float = document.createElement("div");
  const cause = options.cause === "battle" ? "battle" : "effect";
  const kind = options.kind === "heal" ? "heal" : "damage";
  float.className = `lp-damage-float ${cause} ${kind}`;
  float.textContent = `${kind === "heal" ? "+" : "-"}${Math.abs(
    Math.round(amount),
  )}`;
  float.style.left = `${origin.x}px`;
  float.style.top = `${origin.y}px`;
  layer.appendChild(float);

  const dx = destination.x - origin.x;
  const dy = destination.y - origin.y;
  const holdMs = Number.isFinite(options.holdMs)
    ? options.holdMs
    : LP_DAMAGE_HOLD_MS;
  const travelMs = Number.isFinite(options.travelMs)
    ? options.travelMs
    : LP_DAMAGE_TRAVEL_MS;
  const fadeMs = Number.isFinite(options.fadeMs) ? options.fadeMs : LP_DAMAGE_FADE_MS;
  const duration = Math.max(1, holdMs + travelMs + fadeMs);
  const holdOffset = clamp(holdMs / duration, 0.05, 0.7);
  const arrivalOffset = clamp((holdMs + travelMs) / duration, holdOffset, 0.98);
  const arrivalMs = Math.max(0, holdMs + travelMs);

  const animation =
    typeof float.animate === "function"
      ? float.animate(
        [
          {
            opacity: 0,
            transform: "translate(0, 0) translate(-50%, -50%) scale(0.82)",
            offset: 0,
          },
          {
            opacity: 1,
            transform: "translate(0, 0) translate(-50%, -50%) scale(1.08)",
            offset: 0.16,
          },
          {
            opacity: 1,
            transform: "translate(0, 0) translate(-50%, -50%) scale(1)",
            offset: holdOffset,
            easing: "cubic-bezier(0.24, 0.68, 0.34, 1)",
          },
          {
            opacity: 0.92,
            transform: `translate(${dx}px, ${dy}px) translate(-50%, -50%) scale(0.72)`,
            offset: arrivalOffset,
            easing: "linear",
          },
          {
            opacity: 0,
            transform: `translate(${dx}px, ${dy}px) translate(-50%, -50%) scale(0.48)`,
            offset: 1,
          },
        ],
        {
          duration,
          easing: "linear",
        },
      )
      : null;

  arrivalTimer = setTimeout(markArrived, arrivalMs);

  try {
    await finishAnimation(animation, duration);
  } finally {
    markArrived();
    float.remove();
  }
}

function trackFloatingLpChangeNumber(renderer, player, state, entry) {
  if (prefersReducedMotion()) return null;
  if (!state) return null;

  if (!state.floatingPromises) {
    state.floatingPromises = new Set();
  }

  let resolveArrival;
  const arrivalPromise = new Promise((resolve) => {
    resolveArrival = resolve;
  });
  let arrivalSettled = false;
  const settleArrival = () => {
    if (arrivalSettled) return;
    arrivalSettled = true;
    resolveArrival(true);
  };
  entry.floatArrivalPromise = arrivalPromise;

  const promise = playTravelingLpChangeNumber(
    renderer,
    player,
    entry.amount,
    {
      ...entry,
      onArrival: settleArrival,
    },
  ).catch((error) => {
    console.warn("[Renderer] LP floating number failed.", error);
    settleArrival();
  });

  state.floatingPromises.add(promise);
  promise.finally(() => {
    state.floatingPromises?.delete(promise);
  });
  return promise;
}

async function runLpDamageQueue(renderer, player, state) {
  if (state.presentationPromise) return state.presentationPromise;

  state.presentationPromise = (async () => {
    state.animating = true;
    await Promise.resolve();

    try {
      while (state.queue.length > 0) {
        const entry = state.queue.shift();
        if (entry.holdFinalUntilReal === true) {
          state.holdFinalUntilReal = true;
        }
        const toLp = Math.max(0, Math.round(entry.toLp));
        const fromLp = Number.isFinite(entry.fromLp)
          ? Math.max(0, Math.round(entry.fromLp))
          : state.displayed;
        const kind = entry.kind === "heal" ? "heal" : "damage";

        renderer.setDisplayedLp(player, state.displayed ?? fromLp);
        if (kind === "damage") {
          playEffectDamageShake(renderer, entry.amount, entry);
        }

        if (prefersReducedMotion()) {
          renderer.setDisplayedLp(player, toLp);
          playCounterFlash(getLpCounter(renderer, player), kind);
          continue;
        }

        if (
          entry.floatArrivalPromise &&
          typeof entry.floatArrivalPromise.then === "function"
        ) {
          await entry.floatArrivalPromise.catch(() => { });
        }

        await renderer.animateLpOdometer(
          player,
          state.displayed ?? fromLp,
          toLp,
          {
            amount: entry.amount,
            kind,
          },
        );
      }
    } finally {
      state.animating = false;
      state.presentationPromise = null;
      const realLp = Number(player?.lp);
      if (
        !state.holdFinalUntilReal &&
        Number.isFinite(realLp) &&
        Math.round(realLp) !== state.displayed
      ) {
        renderer.setDisplayedLp(player, realLp);
      }
    }
  })();

  return state.presentationPromise;
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
export function ensureLpDisplayState(player) {
  if (!player) return null;
  if (!this.lpDisplayState) {
    this.lpDisplayState = {};
  }

  const key = getPlayerKey(player);
  if (!this.lpDisplayState[key]) {
    const lpEl = getLpElement(this, player);
    const textValue = readNumber(lpEl?.textContent);
    const initial = Number.isFinite(Number(player.lp))
      ? Number(player.lp)
      : textValue ?? 0;
    this.lpDisplayState[key] = {
      displayed: Math.max(0, Math.round(initial)),
      animating: false,
      queue: [],
      floatingPromises: new Set(),
      presentationPromise: null,
    };
  }
  if (!this.lpDisplayState[key].floatingPromises) {
    this.lpDisplayState[key].floatingPromises = new Set();
  }
  return this.lpDisplayState[key];
}

/**
 * @this {import('../Renderer.js').default}
 */
export function getDisplayedLp(player) {
  return this.ensureLpDisplayState?.(player)?.displayed ?? null;
}

/**
 * @this {import('../Renderer.js').default}
 */
export function setDisplayedLp(player, value) {
  const state = this.ensureLpDisplayState?.(player);
  if (!state) return false;

  const lp = Math.max(0, Math.round(Number(value || 0)));
  state.displayed = lp;

  const el = getLpElement(this, player);
  if (el) {
    el.textContent = String(lp);
  }
  return true;
}

/**
 * @this {import('../Renderer.js').default}
 */
export function hasActiveLpPresentation(player) {
  const state = this.ensureLpDisplayState?.(player);
  return (
    !!state &&
    (state.animating ||
      state.queue.length > 0 ||
      !!state.presentationPromise ||
      state.floatingPromises?.size > 0)
  );
}

/**
 * @this {import('../Renderer.js').default}
 */
export function waitForLpPresentation(player = null) {
  const states = [];
  if (player) {
    const state = this.ensureLpDisplayState?.(player);
    if (state) states.push(state);
  } else if (this.lpDisplayState && typeof this.lpDisplayState === "object") {
    states.push(...Object.values(this.lpDisplayState).filter(Boolean));
  }

  const pending = states
    .flatMap((state) => [
      state.presentationPromise,
      ...(state.floatingPromises ? Array.from(state.floatingPromises) : []),
    ])
    .filter((promise) => promise && typeof promise.then === "function");

  if (pending.length === 0) return Promise.resolve(false);
  return Promise.allSettled(pending).then(() => true);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showLpDamageSequence(player, amount, options = {}) {
  if (!player || !amount) return false;
  const value = Math.max(0, Math.round(Number(amount || 0)));
  if (!Number.isFinite(value) || value <= 0) return false;

  const state = this.ensureLpDisplayState?.(player);
  if (!state) return false;
  const wasIdle =
    !state.animating &&
    state.queue.length === 0 &&
    !state.presentationPromise;

  const fromLp = Number.isFinite(options.fromLp)
    ? Math.max(0, Math.round(options.fromLp))
    : state.displayed;
  const kind = options.kind === "heal" ? "heal" : "damage";
  const toLp = Number.isFinite(options.toLp)
    ? Math.max(0, Math.round(options.toLp))
    : kind === "heal"
      ? fromLp + value
      : Math.max(0, fromLp - value);

  if (wasIdle && Number.isFinite(options.fromLp)) {
    this.setDisplayedLp?.(player, fromLp);
  }

  const entry = {
    ...options,
    amount: value,
    fromLp,
    toLp,
    kind,
    cause: options.cause === "battle" ? "battle" : "effect",
  };

  if (!prefersReducedMotion()) {
    trackFloatingLpChangeNumber(this, player, state, entry);
  }

  state.queue.push(entry);

  runLpDamageQueue(this, player, state);
  return true;
}

/**
 * @this {import('../Renderer.js').default}
 */
export function animateLpOdometer(player, fromLp, toLp, options = {}) {
  const state = this.ensureLpDisplayState?.(player);
  if (!state) return Promise.resolve(false);

  const from = Math.max(0, Math.round(Number(fromLp || 0)));
  const to = Math.max(0, Math.round(Number(toLp || 0)));
  const amount = Math.abs(from - to);
  const counter = getLpCounter(this, player);
  const kind = options.kind === "heal" || to > from ? "heal" : "damage";

  if (prefersReducedMotion() || amount <= 0) {
    this.setDisplayedLp(player, to);
    playCounterFlash(counter, kind);
    return Promise.resolve(true);
  }

  const duration = Number.isFinite(options.duration)
    ? options.duration
    : getOdometerDuration(options.amount ?? amount);
  const startedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  counter?.classList.add("lp-odometer-active", `lp-odometer-${kind}`);

  return new Promise((resolve) => {
    const step = (nowTime) => {
      const now = Number.isFinite(nowTime) ? nowTime : Date.now();
      const progress = clamp((now - startedAt) / duration, 0, 1);
      const eased = easeOutCubic(progress);
      let value = Math.round(from + (to - from) * eased);

      if (progress < 0.94 && amount > 40) {
        const stepSize = Math.max(1, Math.floor(amount / 85));
        value =
          to < from
            ? Math.max(to, value - (value % stepSize))
            : Math.min(to, value + (stepSize - (value % stepSize)));
      }

      this.setDisplayedLp(player, value);

      if (progress < 1) {
        requestAnimationFrame(step);
        return;
      }

      this.setDisplayedLp(player, to);
      counter?.classList.remove("lp-odometer-active", `lp-odometer-${kind}`);
      playCounterFlash(counter, kind);
      resolve(true);
    };

    requestAnimationFrame(step);
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
  if (!isHeal) {
    return this.showLpDamageSequence?.(player, Math.abs(value), {
      ...options,
      cause: options.cause || "effect",
      fromLp: options.fromLp,
      toLp: Number.isFinite(options.toLp) ? options.toLp : player.lp,
    });
  }

  const sequencePlayed =
    this.showLpDamageSequence?.(player, Math.abs(value), {
      ...options,
      kind: "heal",
      cause: options.cause || "effect",
      fromLp: options.fromLp,
      toLp: Number.isFinite(options.toLp) ? options.toLp : player.lp,
    }) === true;

  if (sequencePlayed) return true;

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
