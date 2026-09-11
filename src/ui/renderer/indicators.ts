import type Renderer from "../Renderer.js";
import type { UiCard } from "./types.js";
import type { PlayerId } from "../../core/contracts/primitives.js";
import type { RawSelectionCandidate } from "../../core/contracts/selection.js";
import type { DisplaySelectionContract } from "./selectionModals.js";
interface TargetingElement extends HTMLElement {
  __shadowDuelTargetingFxHandlers?: { enter: () => void; leave: () => void };
}
export interface ActivationHint {
  canActivate?: boolean;
  label?: string | null;
}
export type ZoneActivationIndicators = Record<number, ActivationHint>;
export interface ZoneFrameIndicators {
  graveyard?: boolean;
  extraDeck?: boolean;
}
export interface ActivationIndicators {
  hand?: ZoneActivationIndicators;
  field?: ZoneActivationIndicators;
  spellTrap?: ZoneActivationIndicators;
  graveyard?: ZoneActivationIndicators;
  fieldSpell?: ActivationHint | null;
  zones?: ZoneFrameIndicators;
}
export interface AttackResolutionIndicators {
  attackerOwner?: PlayerId;
  attackerIndex?: number;
  targetOwner?: PlayerId;
  targetIndex?: number;
  directAttack?: boolean;
}
export interface FlipAnimationOptions {
  revealFromDefense?: boolean;
  mode?: string;
  deferFrames?: number;
}
export interface TargetHighlights {
  targets?: readonly (RawSelectionCandidate & {
    isSelected?: boolean;
    isAttackTarget?: boolean;
  })[];
  attackerHighlight?: { owner: string; index: number } | null;
  sourceCard?: UiCard | null;
  selectionContract?: DisplaySelectionContract | null;
}

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
const FLIP_ANIMATION_CLASSES = [
  "flipping",
  "flip-summon-reveal",
  "spell-trap-flip-reveal",
];

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function escapeCardKey(cardKey: string | number) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(String(cardKey));
  }
  return String(cardKey).replace(/["\\]/g, "\\$&");
}

function getSourceCardKey(sourceCard: UiCard | string | null | undefined) {
  const key =
    (sourceCard as UiCard | null)?.instanceId ??
    (sourceCard as UiCard | null)?._instanceId ??
    null;
  return key == null ? null : String(key);
}

function findCardByKey(cardKey: string | null) {
  if (!cardKey || typeof document === "undefined") return null;
  const root = document.getElementById("game-container");
  if (!root) return null;
  return root.querySelector<HTMLElement>(
    `.card[data-card-key="${escapeCardKey(cardKey)}"]:not(.card-animation-ghost)`,
  );
}

function resolveTargetingSourceElement({
  sourceCard = null,
  selectionContract = null,
}: TargetHighlights = {}) {
  const contractSource = selectionContract?.metadata?.sourceCard || null;
  const cardKey =
    getSourceCardKey(sourceCard) || getSourceCardKey(contractSource);
  if (cardKey) {
    const sourceEl = findCardByKey(cardKey);
    if (sourceEl) return sourceEl;
  }
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(
    "#game-container .card.attack-attacker:not(.card-animation-ghost)",
  );
}

function detachTargetingFxHandlers(element: TargetingElement | null) {
  if (!element?.[TARGETING_FX_HANDLERS]) return;
  const { enter, leave } = element[TARGETING_FX_HANDLERS];
  element.removeEventListener("mouseenter", enter);
  element.removeEventListener("mouseleave", leave);
  delete element[TARGETING_FX_HANDLERS];
}

function attachTargetingFxHandlers(
  renderer: Renderer,
  targetEl: TargetingElement | null,
  sourceEl: HTMLElement | null,
) {
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
export function applyActivationIndicators(
  this: Renderer,
  owner: PlayerId,
  indicators: ActivationIndicators = {},
): void {
  const prefix = owner === "player" ? "player" : "bot";
  this.applyZoneActivationIndicators(
    this.elements[`${prefix}Hand`],
    indicators.hand || {},
  );
  this.applyZoneActivationIndicators(
    this.elements[`${prefix}Field`],
    indicators.field || {},
  );
  this.applyZoneActivationIndicators(
    this.elements[`${prefix}SpellTrap`],
    indicators.spellTrap || {},
  );
  this.applyZoneActivationIndicators(
    this.elements[`${prefix}Graveyard`],
    indicators.graveyard || {},
  );

  const fieldSpellContainer = this.elements[`${prefix}FieldSpell`];
  if (fieldSpellContainer) {
    const cardEl = fieldSpellContainer.querySelector<HTMLElement>(".card");
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
export function applyZoneFrameActivationIndicators(
  this: Renderer,
  owner: PlayerId,
  zones: ZoneFrameIndicators = {},
): void {
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
    extraDeckEl?.getAttribute("title") === "invocacao disponivel no Extra Deck"
  ) {
    extraDeckEl.removeAttribute("title");
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function applyAttackReadyIndicators(
  this: Renderer,
  owner: PlayerId,
  indices: readonly number[] = [],
): void {
  this.clearAttackReadyIndicators();
  if (!Array.isArray(indices) || indices.length === 0) return;
  const container =
    owner === "player" ? this.elements.playerField : this.elements.botField;
  if (!container) return;
  indices.forEach((index) => {
    const cardEl = container.querySelector<HTMLElement>(
      `.card[data-index=\"${index}\"]`,
    );
    if (cardEl) {
      cardEl.classList.add("attack-ready");
    }
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function clearAttackReadyIndicators(this: Renderer): void {
  const containers = [this.elements.playerField, this.elements.botField];
  containers.forEach((container) => {
    if (!container) return;
    container
      .querySelectorAll<HTMLElement>(".card.attack-ready")
      .forEach((el) => el.classList.remove("attack-ready"));
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function applyAttackResolutionIndicators(
  this: Renderer,
  {
    attackerOwner = "player",
    attackerIndex = -1,
    targetOwner = "bot",
    targetIndex = -1,
    directAttack = false,
  }: AttackResolutionIndicators = {},
): void {
  this.clearAttackResolutionIndicators();

  const attackerContainer =
    attackerOwner === "player"
      ? this.elements.playerField
      : this.elements.botField;
  if (attackerContainer && attackerIndex >= 0) {
    const attackerEl = attackerContainer.querySelector<HTMLElement>(
      `.card[data-index=\"${attackerIndex}\"]`,
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
    const targetEl = targetContainer.querySelector<HTMLElement>(
      `.card[data-index=\"${targetIndex}\"]`,
    );
    if (targetEl) {
      targetEl.classList.add("attack-target");
    }
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function clearAttackResolutionIndicators(this: Renderer): void {
  const containers = [this.elements.playerField, this.elements.botField];
  containers.forEach((container) => {
    if (!container) return;
    container
      .querySelectorAll<HTMLElement>(".card.attack-attacker")
      .forEach((el) => el.classList.remove("attack-attacker"));
    container
      .querySelectorAll<HTMLElement>(".card.attack-target")
      .forEach((el) => el.classList.remove("attack-target"));
  });
  if (this.elements.botHand) {
    this.elements.botHand.classList.remove("direct-attack-active");
  }
}

function getFlipAnimationClass(options: FlipAnimationOptions = {}) {
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

  let layer = root.querySelector<HTMLElement>(":scope > .card-animation-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "card-animation-layer";
    root.appendChild(layer);
  }
  return layer;
}

function cleanupFlipRevealGhost(
  cardEl: HTMLElement | null,
  ghost: HTMLElement | null,
) {
  if (ghost?.parentNode) {
    ghost.remove();
  }
  if (cardEl?.dataset.flipRevealHidden === "true") {
    cardEl.style.visibility = cardEl.dataset.flipRevealVisibility || "";
    delete cardEl.dataset.flipRevealHidden;
    delete cardEl.dataset.flipRevealVisibility;
  }
}

function playFlipRevealGhost(cardEl: HTMLElement | null) {
  const layer = getAnimationLayer();
  if (!cardEl || !layer) return null;

  const rect = cardEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const slotRect =
    cardEl.closest(".field-card-slot")?.getBoundingClientRect?.() || rect;
  const centerX = slotRect.left + slotRect.width / 2;
  const centerY = slotRect.top + slotRect.height / 2;

  const ghost = cardEl.cloneNode(true) as HTMLElement;
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
  return new Promise<boolean>((resolve) => {
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

function playSpellTrapFlipGhost(cardEl: HTMLElement | null) {
  const layer = getAnimationLayer();
  if (!cardEl || !layer) return null;

  const rect = cardEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const slotRect =
    cardEl
      .closest(".spell-trap-zone, .field-card-slot")
      ?.getBoundingClientRect?.() || rect;
  const centerX = slotRect.left + slotRect.width / 2;
  const centerY = slotRect.top + slotRect.height / 2;

  const ghost = cardEl.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-card-key");
  delete ghost.dataset.cardKey;
  ghost.dataset.animationGhost = "true";
  ghost.classList.remove(...FLIP_ANIMATION_CLASSES, "facedown");
  ghost.classList.add("card-animation-ghost", "spell-trap-flip-ghost");
  ghost.style.position = "fixed";
  ghost.style.left = `${centerX - rect.width / 2}px`;
  ghost.style.top = `${centerY - rect.height / 2}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.margin = "0";
  ghost.style.pointerEvents = "none";
  ghost.style.transformOrigin = "center center";

  cardEl.dataset.flipRevealHidden = "true";
  cardEl.dataset.flipRevealVisibility = cardEl.style.visibility || "";
  cardEl.style.visibility = "hidden";

  layer.appendChild(ghost);

  const cleanup = () => cleanupFlipRevealGhost(cardEl, ghost);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      ghost.removeEventListener("animationend", finish);
      cleanup();
      resolve(true);
    };
    ghost.addEventListener("animationend", finish, { once: true });
    globalThis.setTimeout(finish, 620);
  });
}

function applyFlipAnimationClass(
  cardEl: HTMLElement | null,
  animationClass: string,
) {
  if (!cardEl || prefersReducedMotion()) return Promise.resolve(false);
  if (animationClass === "spell-trap-flip-reveal") {
    const ghostPresentation = playSpellTrapFlipGhost(cardEl);
    if (ghostPresentation) return ghostPresentation;
  }
  if (animationClass === "flip-summon-reveal") {
    const ghostPresentation = playFlipRevealGhost(cardEl);
    if (ghostPresentation) return ghostPresentation;
  }

  cardEl.classList.remove(...FLIP_ANIMATION_CLASSES);
  void cardEl.offsetWidth;
  cardEl.classList.add(animationClass);

  const duration = animationClass === "flip-summon-reveal" ? 650 : 720;
  return new Promise<boolean>((resolve) => {
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
export function applyFlipAnimation(
  this: Renderer,
  owner: PlayerId,
  index: number,
  options: FlipAnimationOptions = {},
): Promise<boolean> {
  if (index < 0) return Promise.resolve(false);

  const animationClass = getFlipAnimationClass(options);
  const deferFrames = Number.isFinite(options.deferFrames)
    ? Math.max(0, Math.round(options.deferFrames!))
    : 1;

  const apply = () => {
    const container =
      owner === "player" ? this.elements.playerField : this.elements.botField;
    if (!container) return Promise.resolve(false);

    const cardEl = container.querySelector<HTMLElement>(
      `.card[data-index="${index}"]`,
    );
    if (cardEl) {
      return applyFlipAnimationClass(cardEl, animationClass);
    }
    return Promise.resolve(false);
  };

  if (deferFrames === 0) {
    return apply();
  }

  return new Promise<boolean>((resolve) => {
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
 * Applies a face-down Spell/Trap reveal animation in the Spell/Trap zone.
 *
 * @this {import('../Renderer.js').default}
 */
export function applySpellTrapFlipAnimation(
  this: Renderer,
  owner: PlayerId,
  index: number,
  options: FlipAnimationOptions = {},
): Promise<boolean> {
  if (index < 0) return Promise.resolve(false);

  const deferFrames = Number.isFinite(options.deferFrames)
    ? Math.max(0, Math.round(options.deferFrames!))
    : 1;

  const apply = () => {
    const container =
      owner === "player"
        ? this.elements.playerSpellTrap
        : this.elements.botSpellTrap;
    if (!container) return Promise.resolve(false);

    const cardEl = container.querySelector<HTMLElement>(
      `.card[data-index="${index}"]`,
    );
    if (cardEl) {
      return applyFlipAnimationClass(cardEl, "spell-trap-flip-reveal");
    }
    return Promise.resolve(false);
  };

  if (deferFrames === 0) {
    return apply();
  }

  return new Promise<boolean>((resolve) => {
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
export function setPlayerFieldTributeable(
  this: Renderer,
  indices: readonly number[] = [],
): void {
  if (!this.elements.playerField) return;
  indices.forEach((index) => {
    const cardEl = this.elements.playerField!.querySelector<HTMLElement>(
      `.card[data-index="${index}"]`,
    );
    if (cardEl) {
      cardEl.classList.add("tributeable");
    }
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function setPlayerFieldSelected(
  this: Renderer,
  index: number,
  selected: boolean,
): void {
  if (!this.elements.playerField || index < 0) return;
  const cardEl = this.elements.playerField!.querySelector<HTMLElement>(
    `.card[data-index="${index}"]`,
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
export function clearPlayerFieldTributeable(this: Renderer): void {
  if (!this.elements.playerField) return;
  this.elements.playerField
    .querySelectorAll<HTMLElement>(".tributeable, .selected")
    .forEach((el) => el.classList.remove("tributeable", "selected"));
}

/**
 * @this {import('../Renderer.js').default}
 */
export function applyTargetHighlights(
  this: Renderer,
  {
    targets = [],
    attackerHighlight = null,
    sourceCard = null,
    selectionContract = null,
  }: TargetHighlights = {},
): void {
  this.clearTargetHighlights();

  if (attackerHighlight) {
    const { owner, index } = attackerHighlight;
    const container =
      owner === "player" ? this.elements.playerField : this.elements.botField;
    if (container && index >= 0) {
      const attackerEl = container.querySelector<HTMLElement>(
        `.card[data-index=\"${index}\"]`,
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
  let selectedTargetEl: HTMLElement | null = null;

  targets.forEach((cand) => {
    let targetEl: HTMLElement | null = null;
    if (cand.isDirectAttack) {
      targetEl = this.elements.botHand;
    } else if (cand.zone === "field") {
      const container =
        cand.controller === "player"
          ? this.elements.playerField
          : this.elements.botField;
      if (container) {
        targetEl = container.querySelector<HTMLElement>(
          `.card[data-index=\"${cand.zoneIndex}\"]`,
        );
      }
    } else if (cand.zone === "spellTrap") {
      const container =
        cand.controller === "player"
          ? this.elements.playerSpellTrap
          : this.elements.botSpellTrap;
      if (container) {
        targetEl = container.querySelector<HTMLElement>(
          `.card[data-index=\"${cand.zoneIndex}\"]`,
        );
      }
    } else if (cand.zone === "fieldSpell") {
      const container =
        cand.controller === "player"
          ? this.elements.playerFieldSpell
          : this.elements.botFieldSpell;
      if (container) {
        targetEl = container.querySelector<HTMLElement>(".card");
      }
    } else if (cand.zone === "hand") {
      const container =
        cand.controller === "player"
          ? this.elements.playerHand
          : this.elements.botHand;
      if (container) {
        targetEl = container.querySelector<HTMLElement>(
          `.card[data-index=\"${cand.zoneIndex}\"]`,
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
      targetRect: (selectedTargetEl as HTMLElement).getBoundingClientRect(),
      mode: "selected",
    });
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function clearTargetHighlights(this: Renderer): void {
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
      "direct-attack-target",
    );
    container
      .querySelectorAll<HTMLElement>(
        ".card.targetable, .card.selected-target, .card.attack-attacker, .card.attack-target, .direct-attack-target",
      )
      .forEach((el) => {
        detachTargetingFxHandlers(el);
        el.classList.remove(
          "targetable",
          "selected-target",
          "attack-attacker",
          "attack-target",
          "direct-attack-target",
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
export function setSelectionDimming(this: Renderer, active: boolean): void {
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
export function applyHandTargetableIndices(
  this: Renderer,
  owner: PlayerId,
  indices: readonly number[] = [],
): void {
  const container =
    owner === "player" ? this.elements.playerHand : this.elements.botHand;
  if (!container) return;
  const indexSet = new Set(indices);
  const cards = container.querySelectorAll<HTMLElement>(".card");
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
export function getSelectionCleanupState(this: Renderer) {
  const controlsVisible = !!document.querySelector<HTMLElement>(
    ".field-targeting-controls",
  );
  const highlightCount = document.querySelectorAll<HTMLElement>(
    ".card.targetable, .card.selected-target",
  ).length;
  return { controlsVisible, highlightCount };
}

/**
 * @this {import('../Renderer.js').default}
 */
export function applyZoneActivationIndicators(
  this: Renderer,
  container: HTMLElement | null,
  zoneIndicators: ZoneActivationIndicators,
): void {
  if (!container || !zoneIndicators) return;
  const cardEls = container.querySelectorAll<HTMLElement>(".card");
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
export function decorateActivatableCard(
  this: Renderer,
  cardEl: HTMLElement,
): void {
  cardEl.classList.add("card-activatable");
}

/**
 * @this {import('../Renderer.js').default}
 */
export function setActivationHint(
  this: Renderer,
  cardEl: HTMLElement,
  label: string,
): void {
  if (!label) return;
  cardEl.title = cardEl.dataset.baseTooltip
    ? `${label}\n${cardEl.dataset.baseTooltip}`
    : label;
  cardEl.dataset.activationHint = "true";
}

/**
 * @this {import('../Renderer.js').default}
 */
export function clearActivationHint(this: Renderer, cardEl: HTMLElement): void {
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
