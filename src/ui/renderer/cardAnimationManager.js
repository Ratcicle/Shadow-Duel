/**
 * Ghost card animations for Renderer.
 * These clones cover cards that do not have both old and new DOM elements.
 */

const DEFAULT_DURATION = 220;
const DEFAULT_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const MAX_GHOSTS_PER_FLUSH = 12;

const ZONE_IDS = {
  player: {
    hand: "player-hand",
    field: "player-field",
    spellTrap: "player-spelltrap",
    fieldSpell: "player-fieldspell",
    deck: "player-deck",
    graveyard: "player-graveyard",
    extraDeck: "player-extradeck",
  },
  bot: {
    hand: "bot-hand",
    field: "bot-field",
    spellTrap: "bot-spelltrap",
    fieldSpell: "bot-fieldspell",
    deck: "bot-deck",
    graveyard: "bot-graveyard",
    extraDeck: "bot-extradeck",
  },
};

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function normalizeZone(zone) {
  if (zone === "banish" || zone === "banished") return "banished";
  return zone || null;
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

function getDefaultCardSize() {
  const sample =
    document.querySelector("#game-container .card:not(.card-animation-ghost)") ||
    document.getElementById("player-deck") ||
    document.getElementById("bot-deck");
  const rect = sample?.getBoundingClientRect?.();
  return {
    width: rect?.width || 72,
    height: rect?.height || 104,
  };
}

function zoneRectToCardRect(zoneRect, cardRect = null) {
  if (!zoneRect) return null;
  const size = cardRect || getDefaultCardSize();
  const width = size.width || zoneRect.width;
  const height = size.height || zoneRect.height;
  return {
    left: zoneRect.left + (zoneRect.width - width) / 2,
    top: zoneRect.top + (zoneRect.height - height) / 2,
    width,
    height,
  };
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

function isElementVisible(element) {
  if (!element || typeof window === "undefined") return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function visualFromElement(element, card) {
  const style = window.getComputedStyle(element);
  const transform =
    style.transform && style.transform !== "none" ? style.transform : "none";
  return {
    visible:
      !element.classList.contains("hidden") &&
      !element.classList.contains("facedown"),
    facedown: element.classList.contains("facedown") || !!card?.isFacedown,
    defense: element.classList.contains("defense") || card?.position === "defense",
    transform,
    width: element.offsetWidth || element.getBoundingClientRect().width,
    height: element.offsetHeight || element.getBoundingClientRect().height,
  };
}

function fallbackVisual(card, context = {}) {
  const zone = normalizeZone(context.zone);
  const ownerId = context.ownerId || card?.owner || "player";
  const facedown =
    !!card?.isFacedown ||
    zone === "deck" ||
    zone === "extraDeck" ||
    (zone === "hand" && ownerId !== "player");
  return {
    visible: ownerId === "player" && !facedown,
    facedown,
    defense: card?.position === "defense",
    transform: card?.position === "defense" ? "rotate(-90deg)" : "none",
    width: null,
    height: null,
  };
}

function getVisualTransform(visual) {
  if (visual?.transform && visual.transform !== "none") return visual.transform;
  if (visual?.defense) return "rotate(-90deg)";
  return "";
}

function transformAt(rect, visual) {
  const size = {
    width: visual?.width || rect.width,
    height: visual?.height || rect.height,
  };
  const center = getRectCenter(rect);
  const translate = `translate(${center.x - size.width / 2}px, ${
    center.y - size.height / 2
  }px)`;
  const visualTransform = getVisualTransform(visual);
  return visualTransform ? `${translate} ${visualTransform}` : translate;
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

function applyFacedownVisual(element) {
  element.classList.add("facedown");
  element.innerHTML = '<div class="card-back"></div>';
  element.style.backgroundImage = "none";
  element.style.backgroundColor = "#333";
  element.style.border = "1px solid #555";
}

function createGhost(renderer, card, visual, rect) {
  const visible = !!visual?.visible && !visual?.facedown;
  const ghost = renderer.createCardElement(card, visible);
  ghost.removeAttribute("data-card-key");
  delete ghost.dataset.cardKey;
  ghost.dataset.animationGhost = "true";
  ghost.classList.add("card-animation-ghost");

  if (visual?.facedown || !visible) {
    applyFacedownVisual(ghost);
  }
  if (visual?.defense) {
    ghost.classList.add("defense");
  }

  const width = visual?.width || rect.width;
  const height = visual?.height || rect.height;
  ghost.style.position = "fixed";
  ghost.style.left = "0";
  ghost.style.top = "0";
  ghost.style.width = `${width}px`;
  ghost.style.height = `${height}px`;
  ghost.style.margin = "0";
  ghost.style.pointerEvents = "none";
  ghost.style.transformOrigin = "center center";
  ghost.style.willChange = "transform, opacity";
  return ghost;
}

function finishAnimation(animation, cleanup) {
  if (animation?.finished && typeof animation.finished.finally === "function") {
    animation.finished.finally(cleanup);
    return;
  }
  setTimeout(cleanup, DEFAULT_DURATION + 40);
}

function resolveFinalElement(intent) {
  return intent?.cardKey ? findBoardCardElement(intent.cardKey) : null;
}

function shouldLetFlipHandle(intent, finalElement) {
  return (
    intent?.kind === "zone-move" &&
    intent.fromHadCardElement === true &&
    !!finalElement
  );
}

/**
 * @this {import('../Renderer.js').default}
 */
export function getCardZoneAnchorRect(ownerId, zone, cardRect = null) {
  if (typeof document === "undefined") return null;
  const normalizedZone = normalizeZone(zone);
  const ownerKey = ownerId === "bot" ? "bot" : "player";
  const zoneKey = normalizedZone === "banished" ? "graveyard" : normalizedZone;
  const id = ZONE_IDS[ownerKey]?.[zoneKey];
  const element = id ? document.getElementById(id) : null;
  if (!element) return null;

  const anchor = zoneRectToCardRect(element.getBoundingClientRect(), cardRect);
  if (normalizedZone !== "banished" || !anchor) return anchor;

  const direction = ownerKey === "bot" ? -1 : 1;
  return {
    ...anchor,
    left: anchor.left + direction * Math.max(24, anchor.width * 0.45),
    top: anchor.top + direction * Math.max(14, anchor.height * 0.2),
  };
}

/**
 * @this {import('../Renderer.js').default}
 */
export function captureCardAnimationSource(card, context = {}) {
  if (prefersReducedMotion() || typeof document === "undefined" || !card) {
    return null;
  }

  const cardKey = card.instanceId != null ? String(card.instanceId) : null;
  const element = cardKey ? findBoardCardElement(cardKey) : null;
  if (element && isElementVisible(element)) {
    return {
      rect: copyRect(element.getBoundingClientRect()),
      hadCardElement: true,
      visual: visualFromElement(element, card),
    };
  }

  const anchor = this.getCardZoneAnchorRect(
    context.ownerId || card.owner,
    context.zone,
    null,
  );
  return {
    rect: anchor,
    hadCardElement: false,
    visual: fallbackVisual(card, context),
  };
}

/**
 * @this {import('../Renderer.js').default}
 */
export function playQueuedCardAnimations(intents, options = {}) {
  if (prefersReducedMotion() || typeof document === "undefined") return;
  if (!Array.isArray(intents) || intents.length === 0) return;
  if (typeof this.createCardElement !== "function") return;

  const layer = getLayer();
  if (!layer) return;

  const duration = Number.isFinite(options.ghostDuration)
    ? options.ghostDuration
    : DEFAULT_DURATION;
  const easing = options.ghostEasing || DEFAULT_EASING;
  const limited = intents.slice(0, MAX_GHOSTS_PER_FLUSH);

  for (const intent of limited) {
    if (!intent?.card || !intent.cardKey) continue;

    const finalElement = resolveFinalElement(intent);
    if (shouldLetFlipHandle(intent, finalElement)) continue;

    const finalRect = finalElement
      ? copyRect(finalElement.getBoundingClientRect())
      : null;
    const fromRect =
      intent.fromRect ||
      this.getCardZoneAnchorRect(
        intent.fromOwnerId || intent.toOwnerId || intent.card.owner,
        intent.fromZone,
        finalRect,
      );
    const toRect =
      finalRect ||
      this.getCardZoneAnchorRect(
        intent.toOwnerId || intent.fromOwnerId || intent.card.owner,
        intent.toZone,
        fromRect,
      );

    if (!fromRect || !toRect) continue;

    const finalVisual = finalElement
      ? visualFromElement(finalElement, intent.card)
      : null;
    const visual = finalVisual || intent.fromVisual || fallbackVisual(intent.card);
    if (finalVisual && (!intent.fromVisual?.width || !intent.fromVisual?.height)) {
      visual.width = finalVisual.width;
      visual.height = finalVisual.height;
    }

    const ghost = createGhost(this, intent.card, visual, fromRect);
    const startTransform = transformAt(fromRect, visual);
    const endTransform = transformAt(toRect, visual);
    ghost.style.transform = startTransform;
    layer.appendChild(ghost);

    const shouldHideFinal =
      !!finalElement && intent.fromHadCardElement !== true && intent.kind !== "banish";
    const previousVisibility = finalElement?.style.visibility || "";
    if (shouldHideFinal) {
      finalElement.style.visibility = "hidden";
    }

    const leavesBoard = !finalElement || intent.kind === "banish";
    const keyframes = leavesBoard
      ? [
          { transform: startTransform, opacity: 1 },
          { transform: endTransform, opacity: intent.kind === "banish" ? 0 : 0.12 },
        ]
      : [
          { transform: startTransform, opacity: 1 },
          { transform: endTransform, opacity: 1 },
        ];

    const animation =
      typeof ghost.animate === "function"
        ? ghost.animate(keyframes, { duration, easing })
        : null;

    finishAnimation(animation, () => {
      if (shouldHideFinal && finalElement) {
        finalElement.style.visibility = previousVisibility;
      }
      ghost.remove();
    });
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function playAttackLunge(intent, options = {}) {
  if (prefersReducedMotion() || typeof document === "undefined") return;
  if (!intent?.cardKey) return;

  const attackerElement = findBoardCardElement(intent.cardKey);
  if (!attackerElement || typeof attackerElement.animate !== "function") return;

  const attackerRect = attackerElement.getBoundingClientRect();
  const attackerCenter = getRectCenter(attackerRect);
  const targetElement =
    intent.targetCardKey && findBoardCardElement(String(intent.targetCardKey));
  const targetRect =
    targetElement?.getBoundingClientRect?.() ||
    this.getCardZoneAnchorRect(intent.targetOwnerId, "hand", attackerRect);
  if (!targetRect) return;

  const targetCenter = getRectCenter(targetRect);
  const deltaX = targetCenter.x - attackerCenter.x;
  const deltaY = targetCenter.y - attackerCenter.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance < 1) return;

  const lunge = Number.isFinite(options.lungeDistance)
    ? options.lungeDistance
    : 52;
  const travel = Math.min(lunge, distance * 0.45);
  const moveX = (deltaX / distance) * travel;
  const moveY = (deltaY / distance) * travel;
  const visual = visualFromElement(attackerElement, intent.card);
  const baseRect = copyRect(attackerRect);
  const peakRect = {
    ...baseRect,
    left: attackerRect.left + moveX,
    top: attackerRect.top + moveY,
  };
  const startTransform = transformAt(attackerRect, visual);
  const peakTransform = `${transformAt(peakRect, visual)} scale(1.04)`;
  const layer = getLayer();

  if (!layer || !intent.card) {
    attackerElement.animate(
      [
        { transform: window.getComputedStyle(attackerElement).transform || "none" },
        { transform: `translate(${moveX}px, ${moveY}px)` },
        { transform: window.getComputedStyle(attackerElement).transform || "none" },
      ],
      {
        duration: Number.isFinite(options.duration) ? options.duration : 260,
        easing: options.easing || DEFAULT_EASING,
      },
    );
    return;
  }

  const ghost = createGhost(this, intent.card, visual, attackerRect);
  ghost.classList.add("card-animation-attack-ghost");
  ghost.style.transform = startTransform;
  layer.appendChild(ghost);

  const animation = ghost.animate(
    [
      { transform: startTransform, opacity: 0.98 },
      { transform: peakTransform, opacity: 1 },
      { transform: startTransform, opacity: 0.98 },
    ],
    {
      duration: Number.isFinite(options.duration) ? options.duration : 260,
      easing: options.easing || DEFAULT_EASING,
    },
  );

  finishAnimation(animation, () => {
    ghost.remove();
  });
}
