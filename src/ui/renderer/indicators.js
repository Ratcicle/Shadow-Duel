/**
 * Indicator methods for Renderer
 * Handles: applyActivationIndicators, applyAttackReadyIndicators, clearAttackReadyIndicators,
 * applyAttackResolutionIndicators, clearAttackResolutionIndicators, applyFlipAnimation,
 * setPlayerFieldTributeable, setPlayerFieldSelected, clearPlayerFieldTributeable,
 * applyTargetHighlights, clearTargetHighlights, setSelectionDimming, applyHandTargetableIndices,
 * getSelectionCleanupState, applyZoneActivationIndicators, decorateActivatableCard,
 * setActivationHint, clearActivationHint
 */

const TARGETING_FX_HANDLERS = "__shadowDuelTargetingFxHandlers";
const FLIP_ANIMATION_CLASSES = ["flipping", "flip-summon-reveal"];

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function escapeCardKey(cardKey) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(String(cardKey));
  }
  return String(cardKey).replace(/["\\]/g, "\\$&");
}

function getSourceCardKey(sourceCard) {
  const key = sourceCard?.instanceId ?? sourceCard?._instanceId ?? null;
  return key == null ? null : String(key);
}

function findCardByKey(cardKey) {
  if (!cardKey || typeof document === "undefined") return null;
  const root = document.getElementById("game-container");
  if (!root) return null;
  return root.querySelector(
    `.card[data-card-key="${escapeCardKey(cardKey)}"]:not(.card-animation-ghost)`
  );
}

function resolveTargetingSourceElement({
  sourceCard = null,
  selectionContract = null,
} = {}) {
  const contractSource = selectionContract?.metadata?.sourceCard || null;
  const cardKey = getSourceCardKey(sourceCard) || getSourceCardKey(contractSource);
  if (cardKey) {
    const sourceEl = findCardByKey(cardKey);
    if (sourceEl) return sourceEl;
  }
  if (typeof document === "undefined") return null;
  return document.querySelector(
    "#game-container .card.attack-attacker:not(.card-animation-ghost)"
  );
}

function detachTargetingFxHandlers(element) {
  if (!element?.[TARGETING_FX_HANDLERS]) return;
  const { enter, leave } = element[TARGETING_FX_HANDLERS];
  element.removeEventListener("mouseenter", enter);
  element.removeEventListener("mouseleave", leave);
  delete element[TARGETING_FX_HANDLERS];
}

function attachTargetingFxHandlers(renderer, targetEl, sourceEl) {
  if (!targetEl || !sourceEl) return;
  detachTargetingFxHandlers(targetEl);

  const enter = () => {
    renderer.pixiVfx?.playTargetingLink?.({
      sourceRect: sourceEl.getBoundingClientRect(),
      targetRect: targetEl.getBoundingClientRect(),
      mode: "hover",
    });
  };
  const leave = () => {
    renderer.pixiVfx?.clearTargetingFx?.("hover");
  };

  targetEl.addEventListener("mouseenter", enter);
  targetEl.addEventListener("mouseleave", leave);
  targetEl[TARGETING_FX_HANDLERS] = { enter, leave };
}

/**
 * @this {import('../Renderer.js').default}
 */
export function applyActivationIndicators(owner, indicators = {}) {
  const prefix = owner === "player" ? "player" : "bot";
  this.applyZoneActivationIndicators(
    this.elements[`${prefix}Hand`],
    indicators.hand || {}
  );
  this.applyZoneActivationIndicators(
    this.elements[`${prefix}Field`],
    indicators.field || {}
  );
  this.applyZoneActivationIndicators(
    this.elements[`${prefix}SpellTrap`],
    indicators.spellTrap || {}
  );
  this.applyZoneActivationIndicators(
    this.elements[`${prefix}Graveyard`],
    indicators.graveyard || {}
  );

  const fieldSpellContainer = this.elements[`${prefix}FieldSpell`];
  if (fieldSpellContainer) {
    const cardEl = fieldSpellContainer.querySelector(".card");
    if (cardEl) {
      this.clearActivationHint(cardEl);
      const hint = indicators.fieldSpell;
      if (hint && hint.label) {
        this.setActivationHint(cardEl, hint.label);
      }
      if (hint?.canActivate) {
        this.decorateActivatableCard(cardEl);
      }
    }
  }

  this.applyZoneFrameActivationIndicators?.(owner, indicators.zones || {});
}

/**
 * @this {import('../Renderer.js').default}
 */
export function applyZoneFrameActivationIndicators(owner, zones = {}) {
  const isPlayer = owner === "player";
  const graveyardEl = this.elements[`${owner}Graveyard`];
  const extraDeckEl = document.getElementById(
    isPlayer ? "player-extradeck" : "bot-extradeck",
  );

  graveyardEl?.classList.toggle("zone-activatable", !!zones.graveyard);
  extraDeckEl?.classList.toggle("zone-activatable", !!zones.extraDeck);

  if (zones.graveyard) {
    graveyardEl?.setAttribute("title", "efeito disponivel no cemiterio");
  } else if (
    graveyardEl?.getAttribute("title") === "efeito disponivel no cemiterio"
  ) {
    graveyardEl.removeAttribute("title");
  }

  if (zones.extraDeck) {
    extraDeckEl?.setAttribute("title", "invocacao disponivel no Extra Deck");
  } else if (
    extraDeckEl?.getAttribute("title") ===
    "invocacao disponivel no Extra Deck"
  ) {
    extraDeckEl.removeAttribute("title");
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function applyAttackReadyIndicators(owner, indices = []) {
  this.clearAttackReadyIndicators();
  if (!Array.isArray(indices) || indices.length === 0) return;
  const container =
    owner === "player" ? this.elements.playerField : this.elements.botField;
  if (!container) return;
  indices.forEach((index) => {
    const cardEl = container.querySelector(`.card[data-index=\"${index}\"]`);
    if (cardEl) {
      cardEl.classList.add("attack-ready");
    }
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function clearAttackReadyIndicators() {
  const containers = [this.elements.playerField, this.elements.botField];
  containers.forEach((container) => {
    if (!container) return;
    container
      .querySelectorAll(".card.attack-ready")
      .forEach((el) => el.classList.remove("attack-ready"));
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function applyAttackResolutionIndicators({
  attackerOwner = "player",
  attackerIndex = -1,
  targetOwner = "bot",
  targetIndex = -1,
  directAttack = false,
} = {}) {
  this.clearAttackResolutionIndicators();

  const attackerContainer =
    attackerOwner === "player"
      ? this.elements.playerField
      : this.elements.botField;
  if (attackerContainer && attackerIndex >= 0) {
    const attackerEl = attackerContainer.querySelector(
      `.card[data-index=\"${attackerIndex}\"]`
    );
    if (attackerEl) {
      attackerEl.classList.add("attack-attacker");
    }
  }

  if (directAttack) {
    if (this.elements.botHand) {
      this.elements.botHand.classList.add("direct-attack-active");
    }
    return;
  }

  const targetContainer =
    targetOwner === "player"
      ? this.elements.playerField
      : this.elements.botField;
  if (targetContainer && targetIndex >= 0) {
    const targetEl = targetContainer.querySelector(
      `.card[data-index=\"${targetIndex}\"]`
    );
    if (targetEl) {
      targetEl.classList.add("attack-target");
    }
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function clearAttackResolutionIndicators() {
  const containers = [this.elements.playerField, this.elements.botField];
  containers.forEach((container) => {
    if (!container) return;
    container
      .querySelectorAll(".card.attack-attacker")
      .forEach((el) => el.classList.remove("attack-attacker"));
    container
      .querySelectorAll(".card.attack-target")
      .forEach((el) => el.classList.remove("attack-target"));
  });
  if (this.elements.botHand) {
    this.elements.botHand.classList.remove("direct-attack-active");
  }
}

function getFlipAnimationClass(options = {}) {
  return options.revealFromDefense === true ||
    options.mode === "flip-summon" ||
    options.mode === "reveal-to-attack"
    ? "flip-summon-reveal"
    : "flipping";
}

function getAnimationLayer() {
  if (typeof document === "undefined") return null;
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

function cleanupFlipRevealGhost(cardEl, ghost) {
  if (ghost?.parentNode) {
    ghost.remove();
  }
  if (cardEl?.dataset.flipRevealHidden === "true") {
    cardEl.style.visibility = cardEl.dataset.flipRevealVisibility || "";
    delete cardEl.dataset.flipRevealHidden;
    delete cardEl.dataset.flipRevealVisibility;
  }
}

function playFlipRevealGhost(cardEl) {
  const layer = getAnimationLayer();
  if (!cardEl || !layer) return null;

  const rect = cardEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const slotRect =
    cardEl.closest(".field-card-slot")?.getBoundingClientRect?.() || rect;
  const centerX = slotRect.left + slotRect.width / 2;
  const centerY = slotRect.top + slotRect.height / 2;

  const ghost = cardEl.cloneNode(true);
  ghost.removeAttribute("data-card-key");
  delete ghost.dataset.cardKey;
  ghost.dataset.animationGhost = "true";
  ghost.classList.remove(...FLIP_ANIMATION_CLASSES, "defense", "facedown");
  ghost.classList.add("card-animation-ghost", "flip-summon-ghost");
  ghost.style.position = "fixed";
  ghost.style.left = `${centerX - rect.width / 2}px`;
  ghost.style.top = `${centerY - rect.height / 2}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.margin = "0";
  ghost.style.pointerEvents = "none";
  ghost.style.transformOrigin = "center center";
  ghost.style.transform = "rotate(-90deg)";

  cardEl.dataset.flipRevealHidden = "true";
  cardEl.dataset.flipRevealVisibility = cardEl.style.visibility || "";
  cardEl.style.visibility = "hidden";

  layer.appendChild(ghost);

  const cleanup = () => cleanupFlipRevealGhost(cardEl, ghost);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      ghost.removeEventListener("animationend", finish);
      cleanup();
      resolve(true);
    };
    ghost.addEventListener("animationend", finish, { once: true });
    globalThis.setTimeout(finish, 650);
  });
}

function applyFlipAnimationClass(cardEl, animationClass) {
  if (!cardEl || prefersReducedMotion()) return Promise.resolve(false);
  if (animationClass === "flip-summon-reveal") {
    const ghostPresentation = playFlipRevealGhost(cardEl);
    if (ghostPresentation) return ghostPresentation;
  }

  cardEl.classList.remove(...FLIP_ANIMATION_CLASSES);
  void cardEl.offsetWidth;
  cardEl.classList.add(animationClass);

  const duration = animationClass === "flip-summon-reveal" ? 650 : 720;
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      cardEl.classList.remove(animationClass);
      cardEl.removeEventListener("animationend", cleanup);
      resolve(true);
    };

    cardEl.addEventListener("animationend", cleanup, { once: true });
    globalThis.setTimeout(cleanup, duration);
  });
}

/**
 * Applies flip animation to a card on the field.
 *
 * Uses deferred application (requestAnimationFrame) to ensure the animation
 * class is applied to the final DOM element after updateBoard() recreates it.
 * This solves the race condition where updateBoard() would remove the class
 * immediately after it was applied.
 *
 * @this {import('../Renderer.js').default}
 */
export function applyFlipAnimation(owner, index, options = {}) {
  if (index < 0) return Promise.resolve(false);

  const animationClass = getFlipAnimationClass(options);
  const deferFrames = Number.isFinite(options.deferFrames)
    ? Math.max(0, Math.round(options.deferFrames))
    : 1;

  const apply = () => {
    const container =
      owner === "player" ? this.elements.playerField : this.elements.botField;
    if (!container) return Promise.resolve(false);

    const cardEl = container.querySelector(`.card[data-index="${index}"]`);
    if (cardEl) {
      return applyFlipAnimationClass(cardEl, animationClass);
    }
    return Promise.resolve(false);
  };

  if (deferFrames === 0) {
    return apply();
  }

  return new Promise((resolve) => {
    let framesLeft = deferFrames;
    const tick = () => {
      if (framesLeft > 0) {
        framesLeft -= 1;
        requestAnimationFrame(tick);
        return;
      }
      Promise.resolve(apply()).then(resolve);
    };

    requestAnimationFrame(tick);
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function setPlayerFieldTributeable(indices = []) {
  if (!this.elements.playerField) return;
  indices.forEach((index) => {
    const cardEl = this.elements.playerField.querySelector(
      `.card[data-index="${index}"]`
    );
    if (cardEl) {
      cardEl.classList.add("tributeable");
    }
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function setPlayerFieldSelected(index, selected) {
  if (!this.elements.playerField || index < 0) return;
  const cardEl = this.elements.playerField.querySelector(
    `.card[data-index="${index}"]`
  );
  if (!cardEl) return;
  if (selected) {
    cardEl.classList.add("selected");
  } else {
    cardEl.classList.remove("selected");
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function clearPlayerFieldTributeable() {
  if (!this.elements.playerField) return;
  this.elements.playerField
    .querySelectorAll(".tributeable, .selected")
    .forEach((el) => el.classList.remove("tributeable", "selected"));
}

/**
 * @this {import('../Renderer.js').default}
 */
export function applyTargetHighlights({
  targets = [],
  attackerHighlight = null,
  sourceCard = null,
  selectionContract = null,
} = {}) {
  this.clearTargetHighlights();

  if (attackerHighlight) {
    const { owner, index } = attackerHighlight;
    const container =
      owner === "player" ? this.elements.playerField : this.elements.botField;
    if (container && index >= 0) {
      const attackerEl = container.querySelector(
        `.card[data-index=\"${index}\"]`
      );
      if (attackerEl) {
        attackerEl.classList.add("attack-attacker");
      }
    }
  }

  const sourceEl = resolveTargetingSourceElement({
    sourceCard,
    selectionContract,
  });
  let selectedTargetEl = null;

  targets.forEach((cand) => {
    let targetEl = null;
    if (cand.isDirectAttack) {
      targetEl = this.elements.botHand;
    } else if (cand.zone === "field") {
      const container =
        cand.controller === "player"
          ? this.elements.playerField
          : this.elements.botField;
      if (container) {
        targetEl = container.querySelector(
          `.card[data-index=\"${cand.zoneIndex}\"]`
        );
      }
    } else if (cand.zone === "spellTrap") {
      const container =
        cand.controller === "player"
          ? this.elements.playerSpellTrap
          : this.elements.botSpellTrap;
      if (container) {
        targetEl = container.querySelector(
          `.card[data-index=\"${cand.zoneIndex}\"]`
        );
      }
    } else if (cand.zone === "fieldSpell") {
      const container =
        cand.controller === "player"
          ? this.elements.playerFieldSpell
          : this.elements.botFieldSpell;
      if (container) {
        targetEl = container.querySelector(".card");
      }
    } else if (cand.zone === "hand") {
      const container =
        cand.controller === "player"
          ? this.elements.playerHand
          : this.elements.botHand;
      if (container) {
        targetEl = container.querySelector(
          `.card[data-index=\"${cand.zoneIndex}\"]`
        );
      }
    }

    if (!targetEl) {
      return;
    }

    targetEl.classList.add("targetable");
    if (cand.isDirectAttack) {
      targetEl.style.pointerEvents = "auto";
      targetEl.classList.add("direct-attack-target");
    }
    if (cand.isSelected) {
      targetEl.classList.add("selected-target");
    }
    if (cand.isAttackTarget) {
      targetEl.classList.add("attack-target");
    }
    attachTargetingFxHandlers(this, targetEl, sourceEl);
    if (cand.isSelected && !selectedTargetEl) {
      selectedTargetEl = targetEl;
    }
  });

  if (sourceEl && selectedTargetEl) {
    this.pixiVfx?.playTargetingLink?.({
      sourceRect: sourceEl.getBoundingClientRect(),
      targetRect: selectedTargetEl.getBoundingClientRect(),
      mode: "selected",
    });
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function clearTargetHighlights() {
  const containers = [
    this.elements.playerHand,
    this.elements.botHand,
    this.elements.playerField,
    this.elements.botField,
    this.elements.playerSpellTrap,
    this.elements.botSpellTrap,
    this.elements.playerFieldSpell,
    this.elements.botFieldSpell,
  ];

  containers.forEach((container) => {
    if (!container) return;
    detachTargetingFxHandlers(container);
    container.classList.remove(
      "targetable",
      "selected-target",
      "attack-attacker",
      "attack-target",
      "direct-attack-target"
    );
    container
      .querySelectorAll(
        ".card.targetable, .card.selected-target, .card.attack-attacker, .card.attack-target, .direct-attack-target"
      )
      .forEach((el) => {
        detachTargetingFxHandlers(el);
        el.classList.remove(
          "targetable",
          "selected-target",
          "attack-attacker",
          "attack-target",
          "direct-attack-target"
        );
      });
  });

  if (this.elements.botHand) {
    this.elements.botHand.style.pointerEvents = "";
  }
  this.pixiVfx?.clearTargetingFx?.();
}

/**
 * @this {import('../Renderer.js').default}
 */
export function setSelectionDimming(active) {
  const container = document.getElementById("game-container");
  if (!container) return;
  container.classList.toggle("selection-dim", !!active);
  if (!active) {
    this.pixiVfx?.clearTargetingFx?.();
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function applyHandTargetableIndices(owner, indices = []) {
  const container =
    owner === "player" ? this.elements.playerHand : this.elements.botHand;
  if (!container) return;
  const indexSet = new Set(indices);
  const cards = container.querySelectorAll(".card");
  cards.forEach((cardEl, index) => {
    if (indexSet.has(index)) {
      cardEl.classList.add("targetable");
    } else {
      cardEl.classList.remove("targetable");
    }
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function getSelectionCleanupState() {
  const controlsVisible = !!document.querySelector(".field-targeting-controls");
  const highlightCount = document.querySelectorAll(
    ".card.targetable, .card.selected-target"
  ).length;
  return { controlsVisible, highlightCount };
}

/**
 * @this {import('../Renderer.js').default}
 */
export function applyZoneActivationIndicators(container, zoneIndicators) {
  if (!container || !zoneIndicators) return;
  const cardEls = container.querySelectorAll(".card");
  cardEls.forEach((cardEl) => {
    const index = Number(cardEl.dataset.index);
    if (Number.isNaN(index)) return;
    this.clearActivationHint(cardEl);
    const hint = zoneIndicators[index];
    if (!hint) return;
    if (hint.label) {
      this.setActivationHint(cardEl, hint.label);
    }
    if (hint.canActivate) {
      this.decorateActivatableCard(cardEl);
    }
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function decorateActivatableCard(cardEl) {
  cardEl.classList.add("card-activatable");
}

/**
 * @this {import('../Renderer.js').default}
 */
export function setActivationHint(cardEl, label) {
  if (!label) return;
  cardEl.title = cardEl.dataset.baseTooltip
    ? `${label}\n${cardEl.dataset.baseTooltip}`
    : label;
  cardEl.dataset.activationHint = "true";
}

/**
 * @this {import('../Renderer.js').default}
 */
export function clearActivationHint(cardEl) {
  cardEl.classList.remove("card-activatable");
  if (cardEl.dataset.activationHint) {
    delete cardEl.dataset.activationHint;
    if (cardEl.dataset.baseTooltip) {
      cardEl.title = cardEl.dataset.baseTooltip;
    } else {
      cardEl.removeAttribute("title");
    }
  }
}
