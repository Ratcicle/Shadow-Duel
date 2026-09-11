import type Renderer from "../Renderer.js";
import type { GamePhase } from "../../core/contracts/game.js";
import type { PlayerId } from "../../core/contracts/primitives.js";

export type CardClickHandler = (
  event: MouseEvent,
  element: HTMLElement,
  index: number,
) => void;
export type BotHandClickHandler = (
  event: MouseEvent,
  element: HTMLElement | null,
  index: number,
) => void;
export type ZoneClickHandler = (event: MouseEvent) => void;
type ManagedEventTarget = EventTarget & {
  __shadowDuelManagedBindings?: Map<string, EventListener>;
};

/**
 * Event binding methods for Renderer
 * Handles all bind* methods - passive listeners that call this.* methods
 * No imports from other renderer modules to avoid cycles
 */

const BINDING_STORE = "__shadowDuelManagedBindings";

function bindManagedEvent<K extends keyof HTMLElementEventMap>(
  target: ManagedEventTarget | null,
  key: string,
  type: K,
  handler: (event: HTMLElementEventMap[K]) => void,
) {
  if (!target || typeof target.addEventListener !== "function") return;
  if (!target[BINDING_STORE]) {
    Object.defineProperty(target, BINDING_STORE, {
      value: new Map(),
      configurable: true,
    });
  }
  const store = target[BINDING_STORE]!;
  const bindingKey = `${type}:${key}`;
  const previous = store.get(bindingKey);
  if (previous && typeof target.removeEventListener === "function") {
    target.removeEventListener(type, previous);
  }
  target.addEventListener(type, handler as EventListener);
  store.set(bindingKey, handler as EventListener);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindPhaseClick(
  this: Renderer,
  handler: (phase: GamePhase) => void,
): void {
  if (!this.elements.phaseTrack) return;
  bindManagedEvent(this.elements.phaseTrack, "phase-click", "click", (e) => {
    const li = (e.target as Element).closest<HTMLElement>("li[data-phase]");
    if (!li) return;
    handler(li.dataset.phase as GamePhase);
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindCardHover(
  this: Renderer,
  handler: (
    owner: PlayerId,
    location: string | undefined,
    index: number,
  ) => void,
): void {
  const gameContainer = document.getElementById("game-container");
  if (!gameContainer) return;

  bindManagedEvent(gameContainer, "card-hover", "mouseover", (e) => {
    const cardEl = (e.target as Element).closest<HTMLElement>(".card");
    if (cardEl && !cardEl.classList.contains("hidden")) {
      const index = parseInt(cardEl.dataset.index!);
      const location = cardEl.dataset.location;
      const owner = cardEl.closest("#player-area") ? "player" : "bot";
      handler(owner, location, index);
    }
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindZoneCardClick(
  this: Renderer,
  zoneId: string,
  handler: CardClickHandler,
): void {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  bindManagedEvent(zone, `zone-card-click:${zoneId}`, "click", (e) => {
    const cardEl = (e.target as Element).closest<HTMLElement>(".card");
    if (!cardEl) return;
    const index = Number.parseInt(cardEl.dataset.index!, 10);
    if (Number.isNaN(index)) return;
    handler(e, cardEl, index);
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindZoneClick(
  this: Renderer,
  zoneId: string,
  handler: ZoneClickHandler,
): void {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  bindManagedEvent(zone, `zone-click:${zoneId}`, "click", (e) => handler(e));
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindPlayerHandClick(
  this: Renderer,
  handler: CardClickHandler,
): void {
  this.bindZoneCardClick("player-hand", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindPlayerFieldClick(
  this: Renderer,
  handler: CardClickHandler,
): void {
  this.bindZoneCardClick("player-field", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindPlayerSpellTrapClick(
  this: Renderer,
  handler: CardClickHandler,
): void {
  this.bindZoneCardClick("player-spelltrap", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindPlayerFieldSpellClick(
  this: Renderer,
  handler: CardClickHandler,
): void {
  this.bindZoneCardClick("player-fieldspell", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindBotFieldClick(
  this: Renderer,
  handler: CardClickHandler,
): void {
  this.bindZoneCardClick("bot-field", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindBotSpellTrapClick(
  this: Renderer,
  handler: CardClickHandler,
): void {
  this.bindZoneCardClick("bot-spelltrap", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindBotHandClick(
  this: Renderer,
  handler: BotHandClickHandler,
): void {
  const zone = document.getElementById("bot-hand");
  if (!zone) return;
  bindManagedEvent(zone, "bot-hand-click", "click", (e) => {
    const cardEl = (e.target as Element).closest<HTMLElement>(".card");
    if (!cardEl) {
      handler(e, null, -1);
      return;
    }
    const index = Number.parseInt(cardEl.dataset.index!, 10);
    if (Number.isNaN(index)) return;
    handler(e, cardEl, index);
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindBotFieldSpellClick(
  this: Renderer,
  handler: CardClickHandler,
): void {
  this.bindZoneCardClick("bot-fieldspell", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindPlayerGraveyardClick(
  this: Renderer,
  handler: ZoneClickHandler,
): void {
  this.bindZoneClick("player-graveyard", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindBotGraveyardClick(
  this: Renderer,
  handler: ZoneClickHandler,
): void {
  this.bindZoneClick("bot-graveyard", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindPlayerExtraDeckClick(
  this: Renderer,
  handler: ZoneClickHandler,
): void {
  this.bindZoneClick("player-extradeck", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindBotExtraDeckClick(
  this: Renderer,
  handler: ZoneClickHandler,
): void {
  this.bindZoneClick("bot-extradeck", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindGraveyardModalClose(
  this: Renderer,
  handler: ZoneClickHandler,
): void {
  const closeBtn = document.querySelector(".close-modal");
  if (!closeBtn) return;
  bindManagedEvent(closeBtn, "graveyard-modal-close", "click", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindExtraDeckModalClose(
  this: Renderer,
  handler: ZoneClickHandler,
): void {
  const closeBtn = document.querySelector(".close-extradeck");
  if (!closeBtn) return;
  bindManagedEvent(closeBtn, "extra-deck-modal-close", "click", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindModalOverlayClick(
  this: Renderer,
  handler: (zone: "graveyard" | "extradeck", event: MouseEvent) => void,
): void {
  bindManagedEvent(window, "modal-overlay-click", "click", (e) => {
    const modal = document.getElementById("gy-modal");
    const extraModal = document.getElementById("extradeck-modal");
    if (e.target === modal) {
      handler("graveyard", e);
    }
    if (e.target === extraModal) {
      handler("extradeck", e);
    }
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindGlobalKeydown(
  this: Renderer,
  handler: (event: KeyboardEvent) => void,
): void {
  bindManagedEvent(window, "global-keydown", "keydown", handler);
}
