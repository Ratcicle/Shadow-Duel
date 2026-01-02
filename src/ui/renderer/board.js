/**
 * Board rendering methods for Renderer
 * Handles: renderHand, renderField, renderSpellTrap, renderFieldSpell,
 * updateGYPreview, updateExtraDeckPreview, renderGraveyardModal, renderExtraDeckModal
 */

/**
 * @this {import('../Renderer.js').default}
 */
export function renderHand(player) {
  const container =
    player.id === "player" ? this.elements.playerHand : this.elements.botHand;
  if (!container) return;

  // Batch DOM updates with DocumentFragment to minimize reflows
  const fragment = document.createDocumentFragment();

  player.hand.forEach((card, index) => {
    const cardEl = this.createCardElement(card, player.id === "player");
    cardEl.dataset.index = index;
    cardEl.dataset.location = "hand";

    if (player.id === "bot") {
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
export function renderField(player) {
  const container =
    player.id === "player" ? this.elements.playerField : this.elements.botField;
  if (!container) return;

  // Batch DOM updates with DocumentFragment to minimize reflows
  const fragment = document.createDocumentFragment();

  player.field.forEach((card, index) => {
    const cardEl = this.createCardElement(card, true);
    cardEl.dataset.index = index;
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

    fragment.appendChild(cardEl);
  });

  container.innerHTML = "";
  container.appendChild(fragment);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function renderSpellTrap(player) {
  const container =
    player.id === "player"
      ? this.elements.playerSpellTrap
      : this.elements.botSpellTrap;
  if (!container) return;

  // Batch DOM updates with DocumentFragment to minimize reflows
  const fragment = document.createDocumentFragment();

  player.spellTrap.forEach((card, index) => {
    const isVisible = player.id === "player" || !card.isFacedown;
    const cardEl = this.createCardElement(card, isVisible);
    cardEl.dataset.index = index;
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
export function renderFieldSpell(player) {
  const container =
    player.id === "player"
      ? this.elements.playerFieldSpell
      : this.elements.botFieldSpell;
  if (!container) return;

  container.innerHTML = "";

  const card = player.fieldSpell;
  if (!card) return;

  const isVisible = player.id === "player" || !card.isFacedown;
  const cardEl = this.createCardElement(card, isVisible);
  cardEl.dataset.location = "fieldSpell";
  cardEl.dataset.index = 0;

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
export function updateGYPreview(player) {
  const gyZone = document.getElementById(
    player.id === "player" ? "player-graveyard" : "bot-graveyard"
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
  counter.textContent = count > 0 ? `GY\n${count}` : "GY";

  const existing = gyZone.querySelector(".gy-preview");
  if (existing) existing.remove();

  if (Array.isArray(player.graveyard) && player.graveyard.length > 0) {
    const lastCard = player.graveyard[player.graveyard.length - 1];
    const preview = this.createCardElement(lastCard, true);
    preview.className = "card gy-preview";
    gyZone.appendChild(preview);
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function updateExtraDeckPreview(player) {
  const extraZone = document.getElementById(
    player.id === "player" ? "player-extradeck" : "bot-extradeck"
  );

  if (!extraZone) return;

  // Clear existing content
  extraZone.innerHTML = "";

  // Create counter
  const count = player.extraDeck ? player.extraDeck.length : 0;
  const counter = document.createElement("div");
  counter.className = "zone-counter";
  counter.textContent = count > 0 ? `Extra\n${count}` : "Extra";
  extraZone.appendChild(counter);

  // Show preview of top card (only for player)
  if (player.id === "player" && count > 0) {
    const topCard = player.extraDeck[0];
    const preview = this.createCardElement(topCard, true);
    preview.className = "card extra-preview";
    preview.style.width = "60px";
    preview.style.height = "87px";
    preview.style.position = "absolute";
    preview.style.bottom = "5px";
    preview.style.right = "5px";
    preview.style.opacity = "0.3";
    extraZone.appendChild(preview);
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function renderGraveyardModal(cards, options = {}) {
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
            options.onSelect(card, index, cardEl, e)
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
        const indicator = document.createElement("div");
        indicator.className = "gy-activate-indicator";
        indicator.textContent = "⚡";
        cardEl.appendChild(indicator);
      }
    }
    fragment.appendChild(cardEl);
  });

  grid.appendChild(fragment);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function renderExtraDeckModal(cards) {
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

  cards.forEach((card) => {
    const cardEl = this.createCardElement(card, true);
    fragment.appendChild(cardEl);
  });

  grid.appendChild(fragment);
}
