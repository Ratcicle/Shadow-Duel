import type Renderer from "../Renderer.js";
import type { GameCard } from "../../core/contracts/cards.js";
import type { GamePlayer } from "../../core/contracts/player.js";
import type { PlayerId } from "../../core/contracts/primitives.js";

export interface HandRenderOptions {
  laboratoryMode?: boolean;
  revealBotHand?: boolean;
  activeTurn?: PlayerId;
}
export interface GraveyardRenderOptions {
  filterMessage?: string;
  selectable?: boolean;
  showActivatable?: boolean;
  isDisabled?: (card: GameCard, index: number) => boolean;
  isSelected?: (card: GameCard, index: number) => boolean;
  isActivatable?: (card: GameCard) => boolean;
  onSelect?: (
    card: GameCard,
    index: number,
    element: HTMLElement,
    event: MouseEvent,
  ) => void;
}
export interface ExtraDeckRenderOptions {
  isSummonable?: (card: GameCard, index: number) => boolean;
  getDisabledReason?: (card: GameCard, index: number) => string | null;
  onCardClick?: (card: GameCard, index: number, event: MouseEvent) => void;
}

/**
 * Board rendering methods for Renderer
 * Handles: renderHand, renderField, renderSpellTrap, renderFieldSpell,
 * updateGYPreview, updateExtraDeckPreview, renderGraveyardModal, renderExtraDeckModal
 */

import { getUIText } from "../../core/i18n.js";
import { PANEL_ICONS, createTablerIcon } from "../icons/tablerIcons.js";

function renderZoneCounter(
  counter: Element,
  iconUrl: string,
  label: string,
  accessibleLabel: string,
  count: number,
) {
  counter.replaceChildren();
  counter.setAttribute("aria-label", `${accessibleLabel}: ${count}`);
  counter.append(
    createTablerIcon(iconUrl, "zone-label-icon", { decorative: true }),
    Object.assign(document.createElement("span"), {
      className: "zone-counter-label",
      textContent: label,
    }),
  );

  if (count > 0) {
    counter.append(
      Object.assign(document.createElement("span"), {
        className: "zone-counter-value",
        textContent: String(count),
      }),
    );
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function renderHand(
  this: Renderer,
  player: GamePlayer,
  options: HandRenderOptions = {},
): void {
  const container =
    player.id === "player" ? this.elements.playerHand : this.elements.botHand;
  if (!container) return;

  this.clearFloatingCounterTooltip?.();

  // Batch DOM updates with DocumentFragment to minimize reflows
  const fragment = document.createDocumentFragment();
  container.classList.toggle("hand-overlap", player.hand.length > 5);

  player.hand.forEach((card, index) => {
    if (!card) return; // Defensive: skip empty slots
    const isLaboratory = options.laboratoryMode === true;
    const isBotRevealed = options.revealBotHand === true && player.id === "bot";
    const isVisible = isLaboratory
      ? player.id === options.activeTurn || isBotRevealed
      : player.controllerType !== "ai" && player.id === "player";
    const cardEl = this.createCardElement(card, isVisible);
    cardEl.dataset.index = String(index);
    cardEl.dataset.location = "hand";

    if (!isVisible) {
      cardEl.classList.add("hidden");
      cardEl.innerHTML = '<div class="card-back"></div>';
      cardEl.style.background = "#333";
      cardEl.style.border = "1px solid #555";
    }

    fragment.appendChild(cardEl);
  });

  container.innerHTML = "";
  container.appendChild(fragment);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function renderField(
  this: Renderer,
  player: GamePlayer,
  options: { turnCounter?: number } = {},
): void {
  const container =
    player.id === "player" ? this.elements.playerField : this.elements.botField;
  if (!container) return;

  this.clearFloatingCounterTooltip?.();

  // Batch DOM updates with DocumentFragment to minimize reflows
  const fragment = document.createDocumentFragment();

  player.field.forEach((card, index) => {
    if (!card) return; // Defensive: skip empty slots
    const slotEl = document.createElement("div");
    slotEl.className = "field-card-slot";

    const cardEl = this.createCardElement(card, true, {
      showStatusIcons: true,
      turnCounter: options.turnCounter,
    });
    cardEl.dataset.index = String(index);
    cardEl.dataset.location = "field";

    if (card.position === "defense") {
      cardEl.classList.add("defense");
    }

    if (card.isFacedown) {
      cardEl.classList.add("facedown");
      cardEl.innerHTML = '<div class="card-back"></div>';
      cardEl.style.backgroundImage = "none";
      cardEl.style.backgroundColor = "#333";
      cardEl.style.border = "1px solid #555";
    }

    slotEl.appendChild(cardEl);
    fragment.appendChild(slotEl);
  });

  container.innerHTML = "";
  container.appendChild(fragment);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function renderSpellTrap(this: Renderer, player: GamePlayer): void {
  const container =
    player.id === "player"
      ? this.elements.playerSpellTrap
      : this.elements.botSpellTrap;
  if (!container) return;

  this.clearFloatingCounterTooltip?.();

  // Batch DOM updates with DocumentFragment to minimize reflows
  const fragment = document.createDocumentFragment();

  player.spellTrap.forEach((card, index) => {
    if (!card) return; // Defensive: skip empty slots
    const isVisible = player.controllerType !== "ai" || !card.isFacedown;
    const cardEl = this.createCardElement(card, isVisible);
    cardEl.dataset.index = String(index);
    cardEl.dataset.location = "spellTrap";

    if (card.isFacedown) {
      cardEl.classList.add("facedown");
      cardEl.innerHTML = '<div class="card-back"></div>';
      cardEl.style.backgroundImage = "none";
      cardEl.style.backgroundColor = "#333";
      cardEl.style.border = "1px solid #555";
    }

    fragment.appendChild(cardEl);
  });

  container.innerHTML = "";
  container.appendChild(fragment);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function renderFieldSpell(this: Renderer, player: GamePlayer): void {
  const container =
    player.id === "player"
      ? this.elements.playerFieldSpell
      : this.elements.botFieldSpell;
  if (!container) return;

  this.clearFloatingCounterTooltip?.();

  container.innerHTML = "";

  const card = player.fieldSpell;
  if (!card) return;

  const isVisible = player.controllerType !== "ai" || !card.isFacedown;
  const cardEl = this.createCardElement(card, isVisible);
  cardEl.dataset.location = "fieldSpell";
  cardEl.dataset.index = "0";

  if (card.isFacedown) {
    cardEl.classList.add("facedown");
    cardEl.innerHTML = '<div class="card-back"></div>';
    cardEl.style.backgroundImage = "none";
    cardEl.style.backgroundColor = "#333";
    cardEl.style.border = "1px solid #555";
  }

  container.appendChild(cardEl);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function updateGYPreview(
  this: Renderer,
  player: GamePlayer & { graveyardCount?: number },
): void {
  const gyZone = document.getElementById(
    player.id === "player" ? "player-graveyard" : "bot-graveyard",
  );

  if (!gyZone) {
    console.warn("Graveyard zone not found for", player.id);
    return;
  }

  if (!gyZone.dataset.gyInitialized) {
    gyZone.textContent = "";
    gyZone.dataset.gyInitialized = "true";
  }

  const count =
    (Array.isArray(player.graveyard) && player.graveyard.length) ||
    player.graveyardCount ||
    0;

  let counter = gyZone.querySelector(".zone-counter");
  if (!counter) {
    counter = document.createElement("div");
    counter.className = "zone-counter";
    gyZone.appendChild(counter);
  }
  renderZoneCounter(
    counter,
    PANEL_ICONS.graveyard,
    getUIText("ui.zones.graveyard"),
    getUIText("ui.icons.graveyard"),
    count,
  );

  const existing = gyZone.querySelector(".gy-preview");
  if (existing) existing.remove();

  if (Array.isArray(player.graveyard) && player.graveyard.length > 0) {
    const lastCard = player.graveyard[player.graveyard.length - 1];
    const preview = this.createCardElement(lastCard, true);
    preview.classList.add("gy-preview");
    if (lastCard.graveyardEffectActivating === true) {
      preview.classList.add("graveyard-effect-activating");
    }
    preview.dataset.index = String(player.graveyard.length - 1);
    preview.dataset.location = "graveyard";
    gyZone.appendChild(preview);
    gyZone.onmouseenter = () => this.renderPreview(lastCard);
  } else {
    gyZone.onmouseenter = null;
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function updateExtraDeckPreview(
  this: Renderer,
  player: GamePlayer,
): void {
  const extraZone = document.getElementById(
    player.id === "player" ? "player-extradeck" : "bot-extradeck",
  );

  if (!extraZone) return;

  // Clear existing content
  extraZone.innerHTML = "";

  // Create counter
  const count = player.extraDeck ? player.extraDeck.length : 0;
  const counter = document.createElement("div");
  counter.className = "zone-counter";
  renderZoneCounter(
    counter,
    PANEL_ICONS.extraDeck,
    getUIText("ui.zones.extraDeck"),
    getUIText("ui.icons.extraDeck"),
    count,
  );
  extraZone.appendChild(counter);

  // Extra deck preview intentionally hidden for cleaner UI.
}

/**
 * @this {import('../Renderer.js').default}
 */
export function renderGraveyardModal(
  this: Renderer,
  cards: readonly GameCard[] | null | undefined,
  options: GraveyardRenderOptions = {},
): void {
  const grid = document.getElementById("gy-grid");
  const hintEl = document.getElementById("gy-hint");

  if (!grid) {
    console.warn("#gy-grid not found");
    return;
  }

  if (hintEl) {
    const msg = options.filterMessage || "";
    hintEl.textContent = msg;
    hintEl.style.display = msg ? "block" : "none";
  }

  grid.innerHTML = "";

  if (!cards || cards.length === 0) {
    grid.innerHTML = "<p>Graveyard is empty.</p>";
    return;
  }

  // Use DocumentFragment to minimize reflows
  const fragment = document.createDocumentFragment();

  cards.forEach((card, index) => {
    const cardEl = this.createCardElement(card, true);
    if (options.selectable) {
      cardEl.classList.add("gy-selectable");
      const disabled = options.isDisabled
        ? options.isDisabled(card, index)
        : false;
      if (disabled) {
        cardEl.classList.add("disabled");
      } else {
        if (typeof options.isSelected === "function") {
          if (options.isSelected(card, index)) {
            cardEl.classList.add("selected");
          }
        }
        if (typeof options.onSelect === "function") {
          cardEl.addEventListener("click", (e) =>
            options.onSelect!(card, index, cardEl, e),
          );
        }
      }
    }
    // Adiciona indicador visual de efeito ativável
    if (
      options.showActivatable &&
      typeof options.isActivatable === "function"
    ) {
      if (options.isActivatable(card)) {
        cardEl.classList.add("gy-activatable");
      }
    }
    fragment.appendChild(cardEl);
  });

  grid.appendChild(fragment);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function renderExtraDeckModal(
  this: Renderer,
  cards: readonly GameCard[] | null | undefined,
  options: ExtraDeckRenderOptions = {},
): void {
  const grid = document.getElementById("extradeck-modal-grid");

  if (!grid) {
    console.warn("#extradeck-modal-grid not found");
    return;
  }

  grid.innerHTML = "";

  if (!cards || cards.length === 0) {
    grid.innerHTML = "<p>Extra Deck is empty.</p>";
    return;
  }

  // Use DocumentFragment to minimize reflows
  const fragment = document.createDocumentFragment();

  cards.forEach((card, index) => {
    const cardEl = this.createCardElement(card, true);
    const summonable =
      typeof options.isSummonable === "function"
        ? options.isSummonable(card, index)
        : false;
    const disabledReason =
      typeof options.getDisabledReason === "function"
        ? options.getDisabledReason(card, index)
        : null;
    if (summonable) {
      cardEl.classList.add("extra-deck-summonable");
      cardEl.addEventListener("click", (event) => {
        event.stopPropagation();
        options.onCardClick?.(card, index, event);
      });
    } else if (disabledReason) {
      cardEl.classList.add("disabled");
      cardEl.title = disabledReason;
    }
    fragment.appendChild(cardEl);
  });

  grid.appendChild(fragment);
}
