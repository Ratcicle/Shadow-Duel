const IMPACT_DURATION_MS = 330;
const TARGETING_LINE_COLORS = {
  hover: 0x64d7ff,
  selected: 0xbb86fc,
};
const TARGETING_PULSE_COLOR = 0xf8fbff;

const TONE_COLORS = {
  gold: 0xffd666,
  red: 0xff6060,
  green: 0x7aff9d,
  blue: 0x64d7ff,
  violet: 0xbb86fc,
};

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function normalizeTone(tone) {
  return Object.prototype.hasOwnProperty.call(TONE_COLORS, tone)
    ? tone
    : "gold";
}

function clampIntensity(intensity) {
  if (!Number.isFinite(intensity)) return 1;
  return Math.min(1.6, Math.max(0.6, intensity));
}

function clampScreenShakeIntensity(intensity) {
  const value = Number(intensity);
  if (!Number.isFinite(value)) return 3;
  return Math.min(5, Math.max(2, value));
}

function clampScreenShakeDuration(duration) {
  const value = Number(duration);
  if (!Number.isFinite(value)) return 150;
  return Math.min(180, Math.max(120, value));
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInQuad(t) {
  return t * t;
}

function drawCircle(graphics, x, y, radius, color, alpha) {
  graphics.clear();
  graphics.circle(x, y, radius);
  graphics.fill({ color, alpha });
}

function drawRing(graphics, x, y, radius, color, alpha, width) {
  graphics.clear();
  graphics.circle(x, y, radius);
  graphics.stroke({ color, alpha, width });
}

function isUsableRect(rect) {
  return (
    rect &&
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function getRectCenter(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function getRectEdgePoint(rect, towardPoint) {
  const center = getRectCenter(rect);
  const dx = towardPoint.x - center.x;
  const dy = towardPoint.y - center.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return center;
  }

  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  const tx = Math.abs(dx) > 0.001 ? halfW / Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 0.001 ? halfH / Math.abs(dy) : Infinity;
  const scale = Math.min(tx, ty);
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  };
}

function getQuadraticPoint(start, control, end, t) {
  const inv = 1 - t;
  return {
    x: inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
    y: inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y,
  };
}

function getTargetingCurve(sourceRect, targetRect, mode) {
  const sourceCenter = getRectCenter(sourceRect);
  const targetCenter = getRectCenter(targetRect);
  const start = getRectEdgePoint(sourceRect, targetCenter);
  const end = getRectEdgePoint(targetRect, sourceCenter);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / distance;
  const ny = dx / distance;
  const bow = Math.min(26, distance * 0.07) * (mode === "selected" ? 1 : 0.72);
  return {
    start,
    end,
    control: {
      x: (start.x + end.x) / 2 + nx * bow,
      y: (start.y + end.y) / 2 + ny * bow,
    },
  };
}

function drawTargetingLink(graphics, curve, sourceRect, targetRect, mode) {
  const color = TARGETING_LINE_COLORS[mode] || TARGETING_LINE_COLORS.hover;
  const isSelected = mode === "selected";
  const lineWidth = isSelected ? 3 : 1.8;
  const outerWidth = isSelected ? 9 : 6;
  const sourceRadius = isSelected ? 3.8 : 2.8;
  const targetPad = isSelected ? 5 : 4;
  const targetRadius = Math.min(8, Math.max(4, targetRect.width * 0.08));

  graphics.clear();
  graphics.moveTo(curve.start.x, curve.start.y);
  graphics.quadraticCurveTo(curve.control.x, curve.control.y, curve.end.x, curve.end.y);
  graphics.stroke({ color, alpha: isSelected ? 0.18 : 0.08, width: outerWidth });
  graphics.moveTo(curve.start.x, curve.start.y);
  graphics.quadraticCurveTo(curve.control.x, curve.control.y, curve.end.x, curve.end.y);
  graphics.stroke({ color, alpha: isSelected ? 0.72 : 0.34, width: lineWidth });

  graphics.roundRect(
    targetRect.left - targetPad,
    targetRect.top - targetPad,
    targetRect.width + targetPad * 2,
    targetRect.height + targetPad * 2,
    targetRadius,
  );
  graphics.fill({ color, alpha: isSelected ? 0.055 : 0.028 });
  graphics.roundRect(
    targetRect.left - targetPad,
    targetRect.top - targetPad,
    targetRect.width + targetPad * 2,
    targetRect.height + targetPad * 2,
    targetRadius,
  );
  graphics.stroke({
    color,
    alpha: isSelected ? 0.62 : 0.28,
    width: isSelected ? 2.1 : 1.4,
  });
  graphics.roundRect(
    targetRect.left - targetPad - 4,
    targetRect.top - targetPad - 4,
    targetRect.width + targetPad * 2 + 8,
    targetRect.height + targetPad * 2 + 8,
    targetRadius + 3,
  );
  graphics.stroke({
    color,
    alpha: isSelected ? 0.2 : 0.1,
    width: isSelected ? 1.4 : 1,
  });

  graphics.circle(curve.start.x, curve.start.y, sourceRadius);
  graphics.fill({ color, alpha: isSelected ? 0.54 : 0.32 });
  graphics.circle(curve.start.x, curve.start.y, sourceRadius + 4);
  graphics.stroke({
    color,
    alpha: isSelected ? 0.3 : 0.16,
    width: 1.2,
  });
}

function drawTargetingPulse(graphics, curve, mode, progress) {
  const isSelected = mode === "selected";
  const alpha = (isSelected ? 0.82 : 0.48) * Math.sin(Math.PI * progress);
  const headRadius = isSelected ? 3.2 : 2.4;

  graphics.clear();
  if (alpha <= 0.01) return;

  const drawCometPoint = (t, radius, pointAlpha) => {
    const point = getQuadraticPoint(curve.start, curve.control, curve.end, t);
    graphics.circle(point.x, point.y, radius);
    graphics.fill({ color: TARGETING_PULSE_COLOR, alpha: pointAlpha });
  };

  drawCometPoint(progress, headRadius + 4, alpha * 0.18);
  drawCometPoint(progress, headRadius, alpha);

  const trailA = Math.max(0, progress - 0.045);
  const trailB = Math.max(0, progress - 0.09);
  drawCometPoint(trailA, headRadius * 0.72, alpha * 0.46);
  drawCometPoint(trailB, headRadius * 0.48, alpha * 0.22);
}

export default class PixiVfxLayer {
  constructor() {
    this.PIXI = null;
    this.app = null;
    this.rootElement = null;
    this.canvas = null;
    this.ready = false;
    this.reducedMotion = false;
    this.targetingFx = {
      hover: null,
      selected: null,
    };
    this.screenShakeTimer = null;
  }

  async init(rootElement) {
    if (this.ready) return true;
    if (!rootElement || typeof window === "undefined") return false;

    this.reducedMotion = prefersReducedMotion();
    if (this.reducedMotion) return false;

    this.rootElement = rootElement;
    // Native ESM + serve resolves this bare import through index.html's import map.
    const PIXI = await import("pixi.js");
    this.PIXI = PIXI;

    const app = new PIXI.Application();
    await app.init({
      antialias: true,
      autoDensity: true,
      backgroundAlpha: 0,
      clearBeforeRender: true,
      resolution: window.devicePixelRatio || 1,
      resizeTo: window,
    });

    this.app = app;
    this.canvas = app.canvas;
    this.canvas.classList.add("pixi-vfx-layer");
    this.canvas.setAttribute("aria-hidden", "true");
    this.rootElement.appendChild(this.canvas);
    this.ready = true;
    return true;
  }

  destroy() {
    this.clearTargetingFx();
    this.clearScreenShake();
    this.ready = false;
    this.canvas?.remove();
    this.canvas = null;
    this.rootElement = null;
    this.app?.destroy(true, { children: true });
    this.app = null;
    this.PIXI = null;
  }

  isReady() {
    return this.ready && !!this.app && !this.reducedMotion;
  }

  playFeedback(intent) {
    if (!this.isReady() || intent?.kind !== "impact") return false;
    return this.playImpact({
      x: intent.x,
      y: intent.y,
      tone: intent.tone,
      intensity: intent.intensity,
    });
  }

  clearScreenShake() {
    if (this.screenShakeTimer) {
      clearTimeout(this.screenShakeTimer);
      this.screenShakeTimer = null;
    }
    const root =
      this.rootElement ||
      (typeof document !== "undefined"
        ? document.getElementById("game-container")
        : null);
    root?.classList?.remove("game-screen-shake");
  }

  playScreenShake({ duration = 150, intensity = 3 } = {}) {
    if (this.reducedMotion || prefersReducedMotion() || typeof document === "undefined") {
      return false;
    }

    const root = this.rootElement || document.getElementById("game-container");
    if (!root) return false;

    const safeDuration = clampScreenShakeDuration(duration);
    const safeIntensity = clampScreenShakeIntensity(intensity);

    this.clearScreenShake();
    root.style.setProperty("--screen-shake-duration", `${safeDuration}ms`);
    root.style.setProperty("--screen-shake-distance", `${safeIntensity}px`);
    void root.offsetWidth;
    root.classList.add("game-screen-shake");
    this.screenShakeTimer = setTimeout(() => {
      root.classList.remove("game-screen-shake");
      this.screenShakeTimer = null;
    }, safeDuration + 40);
    return true;
  }

  clearTargetingFx(mode = "all") {
    const clearOne = (key) => {
      const entry = this.targetingFx[key];
      if (!entry) return;
      if (entry.tick && this.app?.ticker) {
        this.app.ticker.remove(entry.tick);
      }
      entry.container?.destroy({ children: true });
      this.targetingFx[key] = null;
    };

    if (mode === "hover" || mode === "selected") {
      clearOne(mode);
      return;
    }

    clearOne("hover");
    clearOne("selected");
  }

  playTargetingLink({ sourceRect, targetRect, mode = "hover" } = {}) {
    const safeMode = mode === "selected" ? "selected" : "hover";
    if (
      !this.isReady() ||
      !isUsableRect(sourceRect) ||
      !isUsableRect(targetRect)
    ) {
      return false;
    }

    const PIXI = this.PIXI;
    const app = this.app;
    const curve = getTargetingCurve(sourceRect, targetRect, safeMode);
    const container = new PIXI.Container();
    const line = new PIXI.Graphics();
    const pulse = new PIXI.Graphics();
    const periodMs = safeMode === "selected" ? 840 : 1180;
    const startTime = performance.now();

    container.eventMode = "none";
    container.blendMode = "add";
    line.eventMode = "none";
    pulse.eventMode = "none";
    drawTargetingLink(line, curve, sourceRect, targetRect, safeMode);
    container.addChild(line, pulse);

    this.clearTargetingFx(safeMode);
    const tick = () => {
      const elapsed = performance.now() - startTime;
      const progress = (elapsed % periodMs) / periodMs;
      drawTargetingPulse(pulse, curve, safeMode, progress);
    };

    this.targetingFx[safeMode] = { container, tick };
    app.stage.addChild(container);
    app.ticker.add(tick);
    tick();
    return true;
  }

  playImpact({ x, y, tone = "gold", intensity = 1 } = {}) {
    if (!this.isReady() || !Number.isFinite(x) || !Number.isFinite(y)) {
      return false;
    }

    const PIXI = this.PIXI;
    const app = this.app;
    const color = TONE_COLORS[normalizeTone(tone)];
    const safeIntensity = clampIntensity(intensity);
    const container = new PIXI.Container();
    const flash = new PIXI.Graphics();
    const ring = new PIXI.Graphics();
    const particles = [];
    const particleCount = Math.round(5 + safeIntensity * 3);
    const baseRadius = 16 * safeIntensity;
    const maxRadius = 48 * safeIntensity;

    container.x = x;
    container.y = y;
    container.blendMode = "add";
    container.eventMode = "none";
    container.alpha = 1;
    container.addChild(flash, ring);

    for (let i = 0; i < particleCount; i += 1) {
      const particle = new PIXI.Graphics();
      const angle = (Math.PI * 2 * i) / particleCount + Math.PI / particleCount;
      const distance = 22 + 18 * safeIntensity;
      particle.__startX = Math.cos(angle) * 6;
      particle.__startY = Math.sin(angle) * 6;
      particle.__endX = Math.cos(angle) * distance;
      particle.__endY = Math.sin(angle) * distance;
      particle.__radius = 2.2 + (i % 3) * 0.6;
      particle.x = particle.__startX;
      particle.y = particle.__startY;
      drawCircle(particle, 0, 0, particle.__radius, color, 0.9);
      particles.push(particle);
      container.addChild(particle);
    }

    app.stage.addChild(container);

    const startTime = performance.now();
    const tick = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1, elapsed / IMPACT_DURATION_MS);
      const out = easeOutCubic(progress);
      const fade = 1 - easeInQuad(progress);

      drawCircle(flash, 0, 0, baseRadius * (1.1 + out * 0.55), color, 0.42 * fade);
      drawRing(
        ring,
        0,
        0,
        baseRadius + (maxRadius - baseRadius) * out,
        color,
        0.82 * fade,
        Math.max(2, 5 * (1 - progress) * safeIntensity),
      );

      for (const particle of particles) {
        particle.x = particle.__startX + (particle.__endX - particle.__startX) * out;
        particle.y = particle.__startY + (particle.__endY - particle.__startY) * out;
        drawCircle(particle, 0, 0, particle.__radius * (1 - progress * 0.35), color, 0.86 * fade);
      }

      if (progress >= 1) {
        app.ticker.remove(tick);
        container.destroy({ children: true });
      }
    };

    app.ticker.add(tick);
    tick();
    return true;
  }
}
