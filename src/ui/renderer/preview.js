/**
 * Preview methods for Renderer
 * Handles: renderPreview, bindPreviewForElement, createCardElement
 */

import {
  getCardDisplayDescription,
  getCardDisplayName,
} from "../../core/i18n.js";

/**
 * @this {import('../Renderer.js').default}
 */
export function renderPreview(card) {
  const previewImage = document.getElementById("preview-image");
  const previewName = document.getElementById("preview-name");
  const previewAtk = document.getElementById("preview-atk");
  const previewDef = document.getElementById("preview-def");
  const previewLevel = document.getElementById("preview-level");
  const previewDesc = document.getElementById("preview-desc");

  if (
    !previewImage ||
    !previewName ||
    !previewAtk ||
    !previewDef ||
    !previewLevel ||
    !previewDesc
  ) {
    return;
  }

  if (!card) {
    previewImage.style.backgroundImage = "";
    previewName.textContent = "Hover a card";
    previewAtk.textContent = "ATK: -";
    previewDef.textContent = "DEF: -";
    previewLevel.textContent = "Level: -";
    previewDesc.textContent = "Description will appear here.";
    return;
  }

  previewImage.style.backgroundImage = `url('${card.image}')`;
  previewName.textContent =
    getCardDisplayName(card) || (card?.name && card.name) || "Hover a card";
  const isMonster = card.cardKind !== "spell" && card.cardKind !== "trap";

  if (isMonster) {
    previewAtk.textContent = `ATK: ${card.atk}`;
    previewDef.textContent = `DEF: ${card.def}`;
    previewLevel.textContent = `Level: ${card.level} ${"*".repeat(
      card.level || 0
    )}`;
  } else {
    previewAtk.textContent = `${(card.cardKind || "").toUpperCase()}${
      card.subtype ? " / " + card.subtype.toUpperCase() : ""
    }`;
    previewDef.textContent = "";
    previewLevel.textContent = "";
  }
  previewDesc.textContent =
    getCardDisplayDescription(card) ||
    card.description ||
    "No description available.";
}

/**
 * Binds preview behavior to an element.
 *
 * For board cards (those with dataset.location set after creation), preview is
 * handled centrally by Game.js via bindCardHover to properly enforce facedown
 * visibility rules. This method only binds preview for "isolated" elements
 * (modals, GY preview, Extra Deck preview) that don't go through Game.js flow.
 *
 * @this {import('../Renderer.js').default}
 */
export function bindPreviewForElement(element, card, visible = true) {
  if (!element) return;
  element.dataset.previewable = visible ? "true" : "false";
  element.__cardData = visible ? card : null;

  // Defer listener attachment to allow board.js to set dataset.location first.
  // If element ends up being a board card (has location), skip local preview
  // binding - Game.js handles it via bindCardHover with proper facedown checks.
  requestAnimationFrame(() => {
    if (element.dataset.location) {
      // Board card - Game.js is the source of truth for preview
      return;
    }
    // Isolated element (modal, GY preview, etc.) - safe to bind local preview
    element.addEventListener("mouseenter", () => {
      this.renderPreview(visible ? card : null);
    });
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function createCardElement(card, visible) {
  const el = document.createElement("div");
  el.className = "card";
  this.bindPreviewForElement(el, card, visible);

  if (visible) {
    const isMonster = card.cardKind !== "spell" && card.cardKind !== "trap";
    const displayName =
      getCardDisplayName(card) || (card?.name && card.name.trim()) || "";
    const stars = "*".repeat(card.level || 0);
    const typeLabel = isMonster
      ? stars
      : `${(card.cardKind || "").toUpperCase()}${
          card.subtype ? " / " + card.subtype.toUpperCase() : ""
        }`;

    const displayDescription =
      getCardDisplayDescription(card) ||
      (card?.description && card.description.trim()) ||
      "Effect card.";

    const bgStyle = card.image
      ? `background-image: url('${card.image}'); background-size: cover; background-position: center;`
      : "background: #1f2937;";

    el.innerHTML = `
      <div class="card-header">
        <div class="card-name">${displayName}</div>
        <div class="card-level">${typeLabel}</div>
      </div>
      <div class="card-image" style="${bgStyle}"></div>
      ${
        isMonster
          ? `<div class="card-stats">
               <span class="stat-atk">ATK ${card.atk}</span>
               <span class="stat-def">DEF ${card.def}</span>
             </div>`
          : `<div class="card-text">${displayDescription}</div>`
      }
    `;
  }
  return el;
}
