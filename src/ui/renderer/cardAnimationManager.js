/**
 * Ghost card animations for Renderer.
 * These clones cover cards that do not have both old and new DOM elements.
 */

const DEFAULT_DURATION = 220;
const DEFAULT_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const MAX_GHOSTS_PER_FLUSH = 12;
const ATTACK_CONTACT_CUE_OFFSET = 0.72;

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

function rectsOverlap(a, b, padding = 0) {
  if (!a || !b) return false;
  const aRight = a.left + a.width;
  const aBottom = a.top + a.height;
  const bRight = b.left + b.width;
  const bBottom = b.top + b.height;
  return (
    a.left <= bRight + padding &&
    aRight + padding >= b.left &&
    a.top <= bBottom + padding &&
    aBottom + padding >= b.top
  );
}

function getLeadingContactRect(rect, unitX, unitY) {
  if (!rect) return null;
  const center = getRectCenter(rect);
  const size = Math.max(28, Math.min(rect.width, rect.height) * 0.58);
  const reach = Math.min(rect.width, rect.height) * 0.34;
  const x = center.x + unitX * reach;
  const y = center.y + unitY * reach;
  return {
    left: x - size / 2,
    top: y - size / 2,
    width: size,
    height: size,
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

function findBoardCardElements(cardKey) {
  if (!cardKey || typeof document === "undefined") return [];
  const root = document.getElementById("game-container");
  if (!root) return [];
  return Array.from(
    root.querySelectorAll(
      `.card[data-card-key="${escapeCardKey(cardKey)}"]:not(.card-animation-ghost)`,
    ),
  );
}

function hideAttackSourceElement(element) {
  if (!element || element.dataset.attackLungeHidden === "true") return;
  element.dataset.attackLungeHidden = "true";
  element.dataset.attackLungeVisibility = element.style.visibility || "";
  element.style.visibility = "hidden";
}

function hideActiveAttackSourceElements(cardKey) {
  findBoardCardElements(cardKey).forEach(hideAttackSourceElement);
}

function revealAttackSourceElements(cardKey) {
  findBoardCardElements(cardKey).forEach((element) => {
    if (element.dataset.attackLungeHidden !== "true") return;
    element.style.visibility = element.dataset.attackLungeVisibility || "";
    delete element.dataset.attackLungeHidden;
    delete element.dataset.attackLungeVisibility;
  });
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

function getFacingAngleDegrees(deltaX, deltaY) {
  return (Math.atan2(deltaY, deltaX) * 180) / Math.PI + 90;
}

function getNaturalFacingAngleDegrees(visual) {
  return visual?.defense ? -90 : 0;
}

function transformAtFacing(rect, visual, facingAngle) {
  const size = {
    width: visual?.width || rect.width,
    height: visual?.height || rect.height,
  };
  const center = getRectCenter(rect);
  const translate = `translate(${center.x - size.width / 2}px, ${
    center.y - size.height / 2
  }px)`;
  return `${translate} rotate(${facingAngle}deg)`;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function cssNumber(value, fractionDigits = 2) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(fractionDigits));
}

function transformAtAttackPose(
  rect,
  visual,
  {
    rotateZ = 0,
    rotateX = 0,
    rotateY = 0,
    scale = 1,
    translateZ = 0,
  } = {},
) {
  const size = {
    width: visual?.width || rect.width,
    height: visual?.height || rect.height,
  };
  const center = getRectCenter(rect);
  const x = center.x - size.width / 2;
  const y = center.y - size.height / 2;
  return [
    "perspective(900px)",
    `translate3d(${cssNumber(x)}px, ${cssNumber(y)}px, ${cssNumber(translateZ)}px)`,
    `rotateZ(${cssNumber(rotateZ)}deg)`,
    `rotateX(${cssNumber(rotateX)}deg)`,
    `rotateY(${cssNumber(rotateY)}deg)`,
    `scale(${cssNumber(scale, 3)})`,
  ].join(" ");
}

function relativeAttackPose({
  x = 0,
  y = 0,
  rotateZ = 0,
  rotateX = 0,
  rotateY = 0,
  scale = 1,
  translateZ = 0,
} = {}) {
  return [
    "perspective(900px)",
    `translate3d(${cssNumber(x)}px, ${cssNumber(y)}px, ${cssNumber(translateZ)}px)`,
    `rotateZ(${cssNumber(rotateZ)}deg)`,
    `rotateX(${cssNumber(rotateX)}deg)`,
    `rotateY(${cssNumber(rotateY)}deg)`,
    `scale(${cssNumber(scale, 3)})`,
  ].join(" ");
}

function getPlayerAttackTargetRect(ownerId, cardRect = null) {
  if (typeof document === "undefined") return null;
  const id = ownerId === "bot" ? "bot-area" : "player-area";
  const element = document.getElementById(id);
  if (!element) return null;
  return zoneRectToCardRect(element.getBoundingClientRect(), cardRect);
}

function getDirectAttackTargetRect(renderer, ownerId, cardRect = null) {
  const handRect =
    typeof renderer?.getCardZoneAnchorRect === "function"
      ? renderer.getCardZoneAnchorRect(ownerId, "hand", cardRect)
      : null;
  return handRect || getPlayerAttackTargetRect(ownerId, cardRect);
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
  ghost.style.transformStyle = "preserve-3d";
  ghost.style.willChange = "transform, opacity";
  return ghost;
}

function finishAnimation(animation, cleanup, duration = DEFAULT_DURATION) {
  if (animation?.finished && typeof animation.finished.then === "function") {
    return animation.finished.then(
      () => {
        cleanup();
      },
      () => {
        cleanup();
      },
    );
  }
  return new Promise((resolve) => {
    setTimeout(() => {
      cleanup();
      resolve();
    }, duration + 40);
  });
}

function createNoopAttackPresentation() {
  const resolved = Promise.resolve(false);
  return {
    contact: resolved,
    finished: resolved,
    cancel: () => resolved,
    then: (...args) => resolved.then(...args),
    catch: (...args) => resolved.catch(...args),
    finally: (...args) => resolved.finally(...args),
  };
}

function createAttackPresentationController({
  duration,
  contactOffset,
  onContact,
} = {}) {
  let resolveContact;
  let resolveFinished;
  let contactSettled = false;
  let finishedSettled = false;
  let canceled = false;
  let contactTimer = null;
  let contactRaf = null;
  let cancelHandler = null;

  const contact = new Promise((resolve) => {
    resolveContact = resolve;
  });
  const finished = new Promise((resolve) => {
    resolveFinished = resolve;
  });

  const clearContactCue = () => {
    if (contactTimer) {
      clearTimeout(contactTimer);
      contactTimer = null;
    }
    if (contactRaf && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(contactRaf);
      contactRaf = null;
    }
  };

  const settleContact = (value, shouldRunCallback, details = null) => {
    if (contactSettled) return;
    contactSettled = true;
    clearContactCue();

    if (shouldRunCallback && typeof onContact === "function") {
      try {
        onContact(details || {});
      } catch (error) {
        console.warn("[Renderer] Attack contact callback failed.", error);
      }
    }

    resolveContact(value);
  };

  const settleFinished = (value) => {
    if (finishedSettled) return;
    finishedSettled = true;
    if (!contactSettled) settleContact(false, false);
    clearContactCue();
    resolveFinished(value);
  };

  const fireContact = (details = null) => {
    if (canceled || finishedSettled) return;
    settleContact(true, true, details);
  };

  const startContactCue = (animation = null, shouldFireContact = null) => {
    if (contactSettled || finishedSettled || canceled) return;

    const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
    const safeOffset = Number.isFinite(contactOffset)
      ? Math.min(1, Math.max(0, contactOffset))
      : ATTACK_CONTACT_CUE_OFFSET;
    const contactMs = safeDuration * safeOffset;

    if (contactMs <= 0) {
      fireContact();
      return;
    }

    if (typeof requestAnimationFrame === "function") {
      let contactDetector =
        typeof shouldFireContact === "function" ? shouldFireContact : null;
      const now = () =>
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      const startedAt = now();
      const tick = () => {
        if (contactSettled || finishedSettled || canceled) return;

        if (contactDetector) {
          try {
            const contactDetails = contactDetector();
            if (contactDetails) {
              fireContact(contactDetails === true ? null : contactDetails);
              return;
            }
          } catch (error) {
            contactDetector = null;
          }
        }

        const currentTime = Number(animation?.currentTime);
        const elapsed = now() - startedAt;
        if (
          (Number.isFinite(currentTime) && currentTime >= contactMs) ||
          elapsed >= contactMs + 48
        ) {
          fireContact();
          return;
        }

        contactRaf = requestAnimationFrame(tick);
      };
      contactRaf = requestAnimationFrame(tick);
      return;
    }

    contactTimer = setTimeout(fireContact, contactMs);
  };

  const cancel = (cancelOptions = {}) => {
    if (finishedSettled) return finished;
    canceled = true;
    clearContactCue();
    if (typeof cancelHandler === "function") {
      try {
        cancelHandler(cancelOptions);
      } catch (error) {
        console.warn("[Renderer] Attack presentation cancel failed.", error);
      }
    }
    settleFinished(false);
    return finished;
  };

  const presentation = {
    contact,
    finished,
    cancel,
    then: (...args) => finished.then(...args),
    catch: (...args) => finished.catch(...args),
    finally: (...args) => finished.finally(...args),
  };

  return {
    presentation,
    startContactCue,
    settleFinished,
    setCancelHandler(handler) {
      cancelHandler = handler;
    },
  };
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
  if (prefersReducedMotion() || typeof document === "undefined") {
    return Promise.resolve(false);
  }
  if (!Array.isArray(intents) || intents.length === 0) {
    return Promise.resolve(false);
  }
  if (typeof this.createCardElement !== "function") {
    return Promise.resolve(false);
  }

  const layer = getLayer();
  if (!layer) return Promise.resolve(false);

  const duration = Number.isFinite(options.ghostDuration)
    ? options.ghostDuration
    : DEFAULT_DURATION;
  const easing = options.ghostEasing || DEFAULT_EASING;
  const limited = intents.slice(0, MAX_GHOSTS_PER_FLUSH);
  const animationPromises = [];

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

    const animationPromise = finishAnimation(animation, () => {
      if (shouldHideFinal && finalElement) {
        finalElement.style.visibility = previousVisibility;
      }
      ghost.remove();
    }, duration);
    animationPromises.push(animationPromise);
  }

  if (animationPromises.length === 0) {
    return Promise.resolve(false);
  }
  return Promise.allSettled(animationPromises).then(() => true);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function playAttackLunge(intent, options = {}) {
  if (prefersReducedMotion() || typeof document === "undefined") {
    return createNoopAttackPresentation();
  }
  if (!intent?.cardKey) return createNoopAttackPresentation();

  const attackerElement = findBoardCardElement(intent.cardKey);
  if (!attackerElement || typeof attackerElement.animate !== "function") {
    return createNoopAttackPresentation();
  }

  const attackerRect = attackerElement.getBoundingClientRect();
  const attackerCenter = getRectCenter(attackerRect);
  const isDirectAttack = intent.directAttack === true || !intent.targetCardKey;
  const targetElement =
    intent.targetCardKey && findBoardCardElement(String(intent.targetCardKey));
  const directTargetRect = isDirectAttack
    ? getDirectAttackTargetRect(this, intent.targetOwnerId, attackerRect)
    : null;
  const targetRect =
    targetElement?.getBoundingClientRect?.() ||
    directTargetRect ||
    this.getCardZoneAnchorRect(intent.targetOwnerId, "field", attackerRect) ||
    this.getCardZoneAnchorRect(intent.targetOwnerId, "hand", attackerRect);
  if (!targetRect) return createNoopAttackPresentation();

  const targetCenter = getRectCenter(targetRect);
  const deltaX = targetCenter.x - attackerCenter.x;
  const deltaY = targetCenter.y - attackerCenter.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance < 1) return createNoopAttackPresentation();

  const lungeDistance = Number.isFinite(options.lungeDistance)
    ? options.lungeDistance
    : isDirectAttack
      ? distance
      : 150;
  const windupDistance = Number.isFinite(options.windupDistance)
    ? options.windupDistance
    : clamp(distance * 0.16, 32, 48);
  const arcLift = Number.isFinite(options.arcLift)
    ? options.arcLift
    : clamp(distance * 0.09, 18, 32);
  const duration = Number.isFinite(options.duration) ? options.duration : 1320;
  const contactOffset = Number.isFinite(options.contactOffset)
    ? options.contactOffset
    : Number.isFinite(intent.contactOffset)
      ? intent.contactOffset
      : isDirectAttack
        ? 0.74
        : ATTACK_CONTACT_CUE_OFFSET;
  const visualContactPadding = Number.isFinite(options.visualContactPadding)
    ? options.visualContactPadding
    : -2;
  const controller = createAttackPresentationController({
    duration,
    contactOffset,
    onContact: options.onContact || intent.onContact,
  });
  const getCurrentTargetRect = () =>
    targetElement?.getBoundingClientRect?.() || targetRect;

  const contactGap = Math.max(
    10,
    Math.min(attackerRect.width, attackerRect.height, targetRect.width, targetRect.height) *
      0.32,
  );
  const maxSafeTravel = Math.max(0, distance - contactGap);
  const contactTravelRatio = isDirectAttack ? 0.96 : 0.78;
  const fallbackTravelRatio = isDirectAttack ? 0.9 : 0.72;
  const travel = Math.min(
    lungeDistance,
    Math.max(
      24,
      Math.min(
        distance * contactTravelRatio,
        maxSafeTravel || distance * fallbackTravelRatio,
      ),
    ),
  );
  const unitX = deltaX / distance;
  const unitY = deltaY / distance;
  const perpX = -unitY;
  const perpY = unitX;
  const arcSide = Number.isFinite(options.arcSide)
    ? Math.sign(options.arcSide) || 1
    : intent.card?.owner === "bot"
      ? -1
      : 1;
  const visual = visualFromElement(attackerElement, intent.card);
  const facingAngle = getFacingAngleDegrees(deltaX, deltaY);
  const naturalFacingAngle = getNaturalFacingAngleDegrees(visual);
  const tiltMagnitude = clamp(6 + distance * 0.015, 6, 12);
  const tiltX = clamp(-unitY * tiltMagnitude, -12, 12);
  const tiltY = clamp(unitX * tiltMagnitude, -12, 12);
  const windupX =
    -unitX * Math.min(windupDistance, travel * 0.42) +
    perpX * arcLift * arcSide * 0.72;
  const windupY =
    -unitY * Math.min(windupDistance, travel * 0.42) +
    perpY * arcLift * arcSide * 0.72 -
    arcLift * 0.35;
  const windupEarlyX = windupX * 0.42;
  const windupEarlyY = windupY * 0.42;
  const contactCurve = arcLift * arcSide * 0.2;
  const contactX = unitX * travel + perpX * contactCurve;
  const contactY = unitY * travel + perpY * contactCurve - arcLift * 0.08;
  const recoilDistance = clamp(travel * 0.08, 4, 10);
  const recoilX = -unitX * recoilDistance + perpX * arcLift * arcSide * 0.12;
  const recoilY = -unitY * recoilDistance + perpY * arcLift * arcSide * 0.12;
  const baseRect = copyRect(attackerRect);
  const movedRect = (x, y) => ({
    ...baseRect,
    left: attackerRect.left + x,
    top: attackerRect.top + y,
  });
  const windupRect = {
    ...baseRect,
    left: attackerRect.left + windupX,
    top: attackerRect.top + windupY,
  };
  const peakRect = movedRect(contactX, contactY);
  const recoilRect = movedRect(recoilX, recoilY);
  const startTransform = transformAtAttackPose(attackerRect, visual, {
    rotateZ: naturalFacingAngle,
  });
  const aimedStartTransform = transformAtAttackPose(attackerRect, visual, {
    rotateZ: facingAngle,
    rotateX: tiltX * 0.18,
    rotateY: tiltY * 0.18,
    scale: 1.012,
  });
  const windupEarlyTransform = transformAtAttackPose(
    movedRect(windupEarlyX, windupEarlyY),
    visual,
    {
      rotateZ: facingAngle,
      rotateX: clamp(tiltX * 0.42 + 3, -12, 12),
      rotateY: clamp(-tiltY * 0.42, -12, 12),
      scale: 1.035,
      translateZ: 6,
    },
  );
  const windupTransform = transformAtAttackPose(windupRect, visual, {
    rotateZ: facingAngle,
    rotateX: clamp(tiltX * 0.62 + 5, -12, 12),
    rotateY: clamp(-tiltY * 0.62, -12, 12),
    scale: 1.06,
    translateZ: 10,
  });
  const peakTransform = transformAtAttackPose(peakRect, visual, {
    rotateZ: facingAngle,
    rotateX: clamp(-tiltX * 0.5, -10, 10),
    rotateY: clamp(tiltY, -12, 12),
    scale: 1.12,
    translateZ: 18,
  });
  const recoilTransform = transformAtAttackPose(recoilRect, visual, {
    rotateZ: facingAngle,
    rotateX: clamp(tiltX * 0.18, -8, 8),
    rotateY: clamp(tiltY * 0.18, -8, 8),
    scale: 0.995,
    translateZ: 4,
  });
  const layer = getLayer();
  const makeContactDetector = (element) => {
    if (isDirectAttack) {
      const directProgressThreshold = Number.isFinite(
        options.directContactProgress,
      )
        ? options.directContactProgress
        : 0.92;
      return () => {
        const rect = element.getBoundingClientRect();
        const center = getRectCenter(rect);
        const progress =
          ((center.x - attackerCenter.x) * unitX +
            (center.y - attackerCenter.y) * unitY) /
          Math.max(1, travel);
        if (progress < directProgressThreshold) return false;
        const contactRect = getLeadingContactRect(rect, unitX, unitY);
        return {
          contactRect,
          targetRect: contactRect,
          directAttack: true,
        };
      };
    }

    return () => {
      const rect = element.getBoundingClientRect();
      const currentTargetRect = getCurrentTargetRect();
      if (!rectsOverlap(rect, currentTargetRect, visualContactPadding)) {
        return false;
      }
      return {
        contactRect: rect,
        targetRect: currentTargetRect,
        directAttack: false,
      };
    };
  };

  if (!layer || !intent.card) {
    const computedTransform = window.getComputedStyle(attackerElement).transform;
    const baseTransform =
      computedTransform && computedTransform !== "none" ? computedTransform : "";
    const composeTransform = (movement) =>
      baseTransform ? `${baseTransform} ${movement}` : movement;
    const animation = attackerElement.animate(
      [
        {
          transform: composeTransform(
            relativeAttackPose({ rotateZ: naturalFacingAngle }),
          ),
          filter: "brightness(1)",
          offset: 0,
        },
        {
          transform: composeTransform(
            relativeAttackPose({
              rotateZ: facingAngle,
              rotateX: tiltX * 0.18,
              rotateY: tiltY * 0.18,
              scale: 1.012,
            }),
          ),
          filter: "brightness(1.08) saturate(1.06)",
          offset: 0.2,
          easing: "cubic-bezier(0.22, 0.68, 0.24, 1)",
        },
        {
          transform: composeTransform(
            relativeAttackPose({
              x: windupEarlyX,
              y: windupEarlyY,
              rotateZ: facingAngle,
              rotateX: clamp(tiltX * 0.42 + 3, -12, 12),
              rotateY: clamp(-tiltY * 0.42, -12, 12),
              scale: 1.035,
              translateZ: 6,
            }),
          ),
          filter: "brightness(1.12) saturate(1.08)",
          offset: 0.45,
          easing: "cubic-bezier(0.34, 0, 0.2, 1)",
        },
        {
          transform: composeTransform(
            relativeAttackPose({
              x: windupX,
              y: windupY,
              rotateZ: facingAngle,
              rotateX: clamp(tiltX * 0.62 + 5, -12, 12),
              rotateY: clamp(-tiltY * 0.62, -12, 12),
              scale: 1.06,
              translateZ: 10,
            }),
          ),
          filter: "brightness(1.2) saturate(1.12)",
          offset: 0.62,
          easing: "cubic-bezier(0.12, 0.86, 0.18, 1)",
        },
        {
          transform: composeTransform(
            relativeAttackPose({
              x: contactX,
              y: contactY,
              rotateZ: facingAngle,
              rotateX: clamp(-tiltX * 0.5, -10, 10),
              rotateY: clamp(tiltY, -12, 12),
              scale: 1.12,
              translateZ: 18,
            }),
          ),
          filter: "brightness(1.3) saturate(1.16)",
          offset: 0.72,
          easing: "linear",
        },
        {
          transform: composeTransform(
            relativeAttackPose({
              x: contactX,
              y: contactY,
              rotateZ: facingAngle,
              rotateX: clamp(-tiltX * 0.5, -10, 10),
              rotateY: clamp(tiltY, -12, 12),
              scale: 1.12,
              translateZ: 18,
            }),
          ),
          filter: "brightness(1.24) saturate(1.14)",
          offset: 0.76,
          easing: "cubic-bezier(0.18, 0.72, 0.22, 1)",
        },
        {
          transform: composeTransform(
            relativeAttackPose({
              x: recoilX,
              y: recoilY,
              rotateZ: facingAngle,
              rotateX: clamp(tiltX * 0.18, -8, 8),
              rotateY: clamp(tiltY * 0.18, -8, 8),
              scale: 0.995,
              translateZ: 4,
            }),
          ),
          filter: "brightness(1.06)",
          offset: 0.88,
        },
        { transform: baseTransform || "none", filter: "brightness(1)", offset: 1 },
      ],
      {
        duration,
        easing: options.easing || DEFAULT_EASING,
      },
    );
    controller.setCancelHandler(() => {
      animation?.cancel?.();
    });
    controller.startContactCue(animation, makeContactDetector(attackerElement));
    finishAnimation(animation, () => {}, duration).then(() => {
      controller.settleFinished(true);
    });
    return controller.presentation;
  }

  const ghost = createGhost(this, intent.card, visual, attackerRect);
  ghost.classList.add("card-animation-attack-ghost");
  ghost.style.transform = startTransform;
  layer.appendChild(ghost);
  if (!this.activeAttackAnimationKeys) {
    this.activeAttackAnimationKeys = new Set();
  }
  this.activeAttackAnimationKeys.add(String(intent.cardKey));
  hideActiveAttackSourceElements(intent.cardKey);

  const cleanup = (() => {
    let cleaned = false;
    return () => {
      if (cleaned) return;
      cleaned = true;
      this.activeAttackAnimationKeys?.delete(String(intent.cardKey));
      revealAttackSourceElements(intent.cardKey);
      ghost.remove();
    };
  })();

  const animation = ghost.animate(
    [
      {
        transform: startTransform,
        opacity: 0.96,
        filter: "brightness(1) saturate(1)",
        offset: 0,
      },
      {
        transform: aimedStartTransform,
        opacity: 1,
        filter: "brightness(1.08) saturate(1.06)",
        offset: 0.2,
        easing: "cubic-bezier(0.22, 0.68, 0.24, 1)",
      },
      {
        transform: windupEarlyTransform,
        opacity: 1,
        filter: "brightness(1.12) saturate(1.08)",
        offset: 0.45,
        easing: "cubic-bezier(0.34, 0, 0.2, 1)",
      },
      {
        transform: windupTransform,
        opacity: 1,
        filter: "brightness(1.2) saturate(1.12)",
        offset: 0.62,
        easing: "cubic-bezier(0.12, 0.86, 0.18, 1)",
      },
      {
        transform: peakTransform,
        opacity: 1,
        filter: "brightness(1.3) saturate(1.16)",
        offset: 0.72,
        easing: "linear",
      },
      {
        transform: peakTransform,
        opacity: 1,
        filter: "brightness(1.24) saturate(1.14)",
        offset: 0.76,
        easing: "cubic-bezier(0.18, 0.72, 0.22, 1)",
      },
      {
        transform: recoilTransform,
        opacity: 0.99,
        filter: "brightness(1.08) saturate(1.04)",
        offset: 0.88,
      },
      {
        transform: startTransform,
        opacity: 0.96,
        filter: "brightness(1) saturate(1)",
        offset: 1,
      },
    ],
    {
      duration,
      easing: options.easing || DEFAULT_EASING,
    },
  );

  controller.setCancelHandler(() => {
    animation?.cancel?.();
    cleanup();
  });
  controller.startContactCue(animation, makeContactDetector(ghost));
  finishAnimation(animation, cleanup, duration).then(() => {
    controller.settleFinished(true);
  });
  return controller.presentation;
}
