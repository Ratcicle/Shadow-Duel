/**
 * Event binding methods for Renderer
 * Handles all bind* methods - passive listeners that call this.* methods
 * No imports from other renderer modules to avoid cycles
 */

const BINDING_STORE = "__shadowDuelManagedBindings";

function bindManagedEvent(target, key, type, handler) {
  if (!target || typeof target.addEventListener !== "function") return;
  if (!target[BINDING_STORE]) {
    Object.defineProperty(target, BINDING_STORE, {
      value: new Map(),
      configurable: true,
    });
  }
  const store = target[BINDING_STORE];
  const bindingKey = `${type}:${key}`;
  const previous = store.get(bindingKey);
  if (previous && typeof target.removeEventListener === "function") {
    target.removeEventListener(type, previous);
  }
  target.addEventListener(type, handler);
  store.set(bindingKey, handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindPhaseClick(handler) {
  if (!this.elements.phaseTrack) return;
  bindManagedEvent(this.elements.phaseTrack, "phase-click", "click", (e) => {
    const li = e.target.closest("li[data-phase]");
    if (!li) return;
    handler(li.dataset.phase);
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindCardHover(handler) {
  const gameContainer = document.getElementById("game-container");
  if (!gameContainer) return;

  bindManagedEvent(gameContainer, "card-hover", "mouseover", (e) => {
    const cardEl = e.target.closest(".card");
    if (cardEl && !cardEl.classList.contains("hidden")) {
      const index = parseInt(cardEl.dataset.index);
      const location = cardEl.dataset.location;
      const owner = cardEl.closest("#player-area") ? "player" : "bot";
      handler(owner, location, index);
    }
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindZoneCardClick(zoneId, handler) {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  bindManagedEvent(zone, `zone-card-click:${zoneId}`, "click", (e) => {
    const cardEl = e.target.closest(".card");
    if (!cardEl) return;
    const index = Number.parseInt(cardEl.dataset.index, 10);
    if (Number.isNaN(index)) return;
    handler(e, cardEl, index);
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindZoneClick(zoneId, handler) {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  bindManagedEvent(zone, `zone-click:${zoneId}`, "click", (e) => handler(e));
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindPlayerHandClick(handler) {
  this.bindZoneCardClick("player-hand", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindPlayerFieldClick(handler) {
  this.bindZoneCardClick("player-field", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindPlayerSpellTrapClick(handler) {
  this.bindZoneCardClick("player-spelltrap", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindPlayerFieldSpellClick(handler) {
  this.bindZoneCardClick("player-fieldspell", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindBotFieldClick(handler) {
  this.bindZoneCardClick("bot-field", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindBotSpellTrapClick(handler) {
  this.bindZoneCardClick("bot-spelltrap", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindBotHandClick(handler) {
  const zone = document.getElementById("bot-hand");
  if (!zone) return;
  bindManagedEvent(zone, "bot-hand-click", "click", (e) => {
    const cardEl = e.target.closest(".card");
    if (!cardEl) {
      handler(e, null, -1);
      return;
    }
    const index = Number.parseInt(cardEl.dataset.index, 10);
    if (Number.isNaN(index)) return;
    handler(e, cardEl, index);
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindBotFieldSpellClick(handler) {
  this.bindZoneCardClick("bot-fieldspell", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindPlayerGraveyardClick(handler) {
  this.bindZoneClick("player-graveyard", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindBotGraveyardClick(handler) {
  this.bindZoneClick("bot-graveyard", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindPlayerExtraDeckClick(handler) {
  this.bindZoneClick("player-extradeck", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindBotExtraDeckClick(handler) {
  this.bindZoneClick("bot-extradeck", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindGraveyardModalClose(handler) {
  const closeBtn = document.querySelector(".close-modal");
  if (!closeBtn) return;
  bindManagedEvent(closeBtn, "graveyard-modal-close", "click", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindExtraDeckModalClose(handler) {
  const closeBtn = document.querySelector(".close-extradeck");
  if (!closeBtn) return;
  bindManagedEvent(closeBtn, "extra-deck-modal-close", "click", handler);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function bindModalOverlayClick(handler) {
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
export function bindGlobalKeydown(handler) {
  bindManagedEvent(window, "global-keydown", "keydown", handler);
}
