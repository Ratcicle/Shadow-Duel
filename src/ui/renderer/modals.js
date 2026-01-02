/**
 * Base modal methods for Renderer
 * Handles: toggleModal, toggleExtraDeckModal, showConfirmPrompt, showNumberPrompt, showAlert,
 * getSearchModalElements, showSearchModal, showSearchModalVisual
 */

import { getCardDisplayName } from "../../core/i18n.js";

/**
 * @this {import('../Renderer.js').default}
 */
export function toggleModal(show) {
  const modal = document.getElementById("gy-modal");
  if (!modal) return;
  if (show) modal.classList.remove("hidden");
  else modal.classList.add("hidden");
}

/**
 * @this {import('../Renderer.js').default}
 */
export function toggleExtraDeckModal(show) {
  const modal = document.getElementById("extradeck-modal");
  if (modal) {
    if (show) {
      modal.classList.remove("hidden");
    } else {
      modal.classList.add("hidden");
    }
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showConfirmPrompt(message, options = {}) {
  if (!message) return false;
  const { confirmLabel, cancelLabel } = options;
  if (confirmLabel || cancelLabel) {
    // TODO: replace with styled modal if we need custom labels.
  }
  return window.confirm(message);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showNumberPrompt(message, defaultValue) {
  const raw = window.prompt(message, defaultValue ?? "");
  if (raw === null || raw === undefined) return null;
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showAlert(message) {
  if (!message) return;
  window.alert(message);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function getSearchModalElements() {
  const modal = document.getElementById("search-modal");
  const input = document.getElementById("search-input");
  const select = document.getElementById("search-dropdown");
  const confirmBtn = document.getElementById("search-confirm");
  const cancelBtn = document.getElementById("search-cancel");
  const closeBtn = document.getElementById("search-close");

  if (modal && input && select && confirmBtn && cancelBtn && closeBtn) {
    return { modal, input, select, confirmBtn, cancelBtn, closeBtn };
  }

  return null;
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showSearchModal(
  elements,
  candidates,
  defaultCard,
  onConfirm,
  allCards
) {
  const { modal, input, select, confirmBtn, cancelBtn, closeBtn } = elements;

  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Escolha uma carta";
  select.appendChild(placeholder);

  // Only show candidates, not all cards from the database
  const sortedCandidates = [...candidates].sort((a, b) => {
    const nameA = (a?.name || "").toLocaleLowerCase();
    const nameB = (b?.name || "").toLocaleLowerCase();
    return nameA.localeCompare(nameB);
  });

  sortedCandidates.forEach((card) => {
    if (!card || !card.name) return;
    const opt = document.createElement("option");
    opt.value = card.name;
    opt.textContent = getCardDisplayName(card) || card.name;
    select.appendChild(opt);
  });

  input.value = defaultCard || "";

  const cleanup = () => {
    modal.classList.add("hidden");
    confirmBtn.removeEventListener("click", confirmHandler);
    cancelBtn.removeEventListener("click", cancelHandler);
    closeBtn.removeEventListener("click", cancelHandler);
    select.removeEventListener("change", selectHandler);
    input.removeEventListener("keydown", keyHandler);
  };

  const confirmHandler = () => {
    const choice = (input.value || select.value || "").trim();
    cleanup();
    onConfirm(choice);
  };

  const cancelHandler = () => {
    const choice = (input.value || select.value || defaultCard || "").trim();
    cleanup();
    onConfirm(choice);
  };

  const selectHandler = () => {
    if (select.value) {
      input.value = select.value;
    }
  };

  const keyHandler = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmHandler();
    } else if (e.key === "Escape") {
      cancelHandler();
    }
  };

  confirmBtn.addEventListener("click", confirmHandler);
  cancelBtn.addEventListener("click", cancelHandler);
  closeBtn.addEventListener("click", cancelHandler);
  select.addEventListener("change", selectHandler);
  input.addEventListener("keydown", keyHandler);

  modal.classList.remove("hidden");
  input.focus();
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showSearchModalVisual(
  elements,
  candidates,
  defaultCard,
  onConfirm
) {
  const overlay = document.createElement("div");
  overlay.className = "search-modal-visual";

  const modalContent = document.createElement("div");
  modalContent.className = "modal-content";

  const title = document.createElement("h2");
  title.textContent = "Select a card from candidates";
  modalContent.appendChild(title);

  const hint = document.createElement("p");
  hint.className = "search-hint";
  hint.textContent = "Click on a card to select it";
  modalContent.appendChild(hint);

  const grid = document.createElement("div");
  grid.className = "cards-grid";

  let selectedCard = defaultCard
    ? candidates.find((c) => c.name === defaultCard) || candidates[0]
    : candidates[0];

  candidates.forEach((card) => {
    if (!card || !card.name) return;
    const displayName =
      getCardDisplayName(card) || (card?.name && card.name) || "Card";

    const cardBtn = document.createElement("button");
    cardBtn.className = "search-card-btn";
    if (selectedCard && card.name === selectedCard.name) {
      cardBtn.classList.add("selected");
    }

    const img = document.createElement("img");
    img.src = card.image || "assets/card-back.png";
    img.alt = displayName;
    img.className = "search-card-image";
    cardBtn.appendChild(img);

    const nameDiv = document.createElement("div");
    nameDiv.className = "search-card-name";
    nameDiv.textContent = displayName;
    cardBtn.appendChild(nameDiv);

    const typeDiv = document.createElement("div");
    typeDiv.className = "search-card-type";
    const typeText = card.type ? `${card.type}` : "Unknown";
    const levelText = card.level ? ` / L${card.level}` : "";
    typeDiv.textContent = typeText + levelText;
    cardBtn.appendChild(typeDiv);

    if (card.cardKind === "monster") {
      const statsDiv = document.createElement("div");
      statsDiv.className = "search-card-stats";
      const atk = card.atk !== undefined ? card.atk : "?";
      const def = card.def !== undefined ? card.def : "?";
      statsDiv.textContent = `ATK ${atk} / DEF ${def}`;
      cardBtn.appendChild(statsDiv);
    }

    cardBtn.onclick = () => {
      grid.querySelectorAll(".search-card-btn").forEach((btn) => {
        btn.classList.remove("selected");
      });
      cardBtn.classList.add("selected");
      selectedCard = card;
    };

    grid.appendChild(cardBtn);
  });

  modalContent.appendChild(grid);

  const actions = document.createElement("div");
  actions.className = "search-actions";

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Confirm";
  confirmBtn.className = "confirm";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.className = "cancel";

  const cleanup = () => {
    overlay.remove();
  };

  const findCandidateByName = (name) =>
    candidates.find((c) => c && c.name === name) || null;

  confirmBtn.onclick = () => {
    cleanup();
    if (selectedCard) {
      onConfirm(selectedCard.name, selectedCard);
    }
  };

  cancelBtn.onclick = () => {
    cleanup();
    if (defaultCard) {
      onConfirm(defaultCard, findCandidateByName(defaultCard));
    } else if (selectedCard) {
      onConfirm(selectedCard.name, selectedCard);
    }
  };

  overlay.onclick = (e) => {
    if (e.target === overlay) {
      cleanup();
      const choiceName = defaultCard || (selectedCard && selectedCard.name);
      if (choiceName) {
        const choiceCard =
          findCandidateByName(choiceName) || selectedCard || null;
        onConfirm(choiceName, choiceCard);
      }
    }
  };

  actions.appendChild(confirmBtn);
  actions.appendChild(cancelBtn);
  modalContent.appendChild(actions);

  overlay.appendChild(modalContent);
  document.body.appendChild(overlay);
}
