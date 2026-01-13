/**
 * Trap modal methods for Renderer
 * Handles: showUnifiedTrapModal, showTrapActivationModal, showChainResponseModal,
 * _getContextDescription
 */

import {
  getCardDisplayName,
  getCardDisplayDescription,
} from "../../core/i18n.js";

/**
 * Unified trap activation modal - handles both manual activation and chain response
 * @this {import('../Renderer.js').default}
 * @param {Object} options
 * @param {Array} options.cards - Array of {card, effect, zone} objects
 * @param {Object} options.context - Chain context (for response mode)
 * @param {string} options.mode - 'single' for manual, 'chain' for chain response
 * @returns {Promise<{card, effect, activate: boolean}|null>}
 */
export function showUnifiedTrapModal(options = {}) {
  const { cards = [], context = null, mode = "single" } = options;

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "trap-activation-overlay";

    const modal = document.createElement("div");
    modal.className = "trap-activation-modal";

    // Header - same style, different text based on mode
    const header = document.createElement("div");
    header.className = "trap-modal-header";

    const title = document.createElement("h3");
    if (mode === "chain" && context) {
      title.textContent = this._getContextDescription(context);
    } else {
      title.textContent = "Ativar Armadilha?";
    }
    header.appendChild(title);
    modal.appendChild(header);

    // For single card: show full card preview (original style)
    // For multiple cards: show scrollable list with same card styling
    if (cards.length === 1) {
      const item = cards[0];
      const card = item.card || item;

      // Card image preview
      const cardPreview = document.createElement("div");
      cardPreview.className = "trap-card-preview";
      const img = document.createElement("img");
      img.src = card.image || "assets/card-back.png";
      img.alt = getCardDisplayName(card) || card.name || "Trap Card";
      img.className = "trap-card-image";
      cardPreview.appendChild(img);
      modal.appendChild(cardPreview);

      // Card info
      const cardInfo = document.createElement("div");
      cardInfo.className = "trap-card-info";
      const cardName = document.createElement("div");
      cardName.className = "trap-card-name";
      cardName.textContent = getCardDisplayName(card) || card.name || "";
      const cardDesc = document.createElement("div");
      cardDesc.className = "trap-card-description";
      const descText = getCardDisplayDescription(card) || card.description || "";
      cardDesc.innerHTML = descText.replace(/\n/g, '<br>');
      cardInfo.appendChild(cardName);
      cardInfo.appendChild(cardDesc);
      modal.appendChild(cardInfo);

      // Actions for single card
      const actions = document.createElement("div");
      actions.className = "trap-modal-actions";

      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = mode === "chain" ? "Passar" : "Não Ativar";
      cancelBtn.className = "trap-btn-cancel";
      cancelBtn.onclick = () => {
        overlay.remove();
        resolve(null);
      };

      const confirmBtn = document.createElement("button");
      confirmBtn.textContent = "Ativar Armadilha";
      confirmBtn.className = "trap-btn-confirm";
      confirmBtn.onclick = () => {
        overlay.remove();
        resolve({ card, effect: item.effect || null, activate: true });
      };

      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      modal.appendChild(actions);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      confirmBtn.focus();
    } else if (cards.length > 1) {
      // Multiple cards - show list with same styling
      const cardList = document.createElement("div");
      cardList.className = "trap-card-list";

      cards.forEach((item) => {
        const card = item.card || item;
        const effect = item.effect || null;

        const cardOption = document.createElement("div");
        cardOption.className = "trap-card-option";

        // Mini card preview
        const preview = document.createElement("div");
        preview.className = "trap-card-preview-mini";
        const img = document.createElement("img");
        img.src = card.image || "assets/card-back.png";
        img.className = "trap-card-image-mini";
        preview.appendChild(img);

        // Card info
        const info = document.createElement("div");
        info.className = "trap-card-info-inline";
        const name = document.createElement("div");
        name.className = "trap-card-name";
        name.textContent = getCardDisplayName(card) || card.name || "";
        info.appendChild(name);

        // Activate button per card
        const activateBtn = document.createElement("button");
        activateBtn.textContent = "Ativar";
        activateBtn.className = "trap-btn-confirm";
        activateBtn.onclick = () => {
          overlay.remove();
          resolve({ card, effect, activate: true });
        };

        cardOption.appendChild(preview);
        cardOption.appendChild(info);
        cardOption.appendChild(activateBtn);
        cardList.appendChild(cardOption);
      });

      modal.appendChild(cardList);

      // Pass button for chain mode
      const actions = document.createElement("div");
      actions.className = "trap-modal-actions";
      const passBtn = document.createElement("button");
      passBtn.textContent = "Passar (Não Responder)";
      passBtn.className = "trap-btn-cancel";
      passBtn.style.width = "100%";
      passBtn.onclick = () => {
        overlay.remove();
        resolve(null);
      };
      actions.appendChild(passBtn);
      modal.appendChild(actions);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      passBtn.focus();
    } else {
      // No cards - just resolve null
      resolve(null);
    }
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showTrapActivationModal(trapCard, event, eventData = {}) {
  return this.showUnifiedTrapModal({
    cards: [{ card: trapCard }],
    mode: "single",
  }).then((result) => result?.activate === true);
}

/**
 * Show a modal for chain response selection
 * @this {import('../Renderer.js').default}
 * @param {Array} activatable - Array of {card, effect, zone} objects
 * @param {Object} context - Chain context (type, event, etc.)
 * @param {Array} chainStack - Current chain stack for display
 * @returns {Promise<{card, effect, selections}|null>}
 */
export function showChainResponseModal(activatable, context, chainStack = []) {
  return this.showUnifiedTrapModal({
    cards: activatable,
    context,
    mode: "chain",
  }).then((result) => {
    if (result?.activate) {
      return { card: result.card, effect: result.effect, selections: null };
    }
    return null;
  });
}

/**
 * Get human-readable description of chain context
 * @this {import('../Renderer.js').default}
 * @param {Object} context
 * @returns {string}
 */
export function _getContextDescription(context) {
  if (!context) return "Responda à ação.";

  switch (context.type) {
    case "attack_declaration":
      const attacker = context.attacker?.name || "Monstro";
      const target = context.target?.name || "ataque direto";
      return `${attacker} declarou ataque em ${target}.`;

    case "summon":
      const summoned = context.card?.name || "Monstro";
      return `${summoned} foi invocado.`;

    case "card_activation":
      const activated = context.card?.name || "Carta";
      return `${activated} foi ativado.`;

    case "phase_change":
      return `Mudança de fase.`;

    case "effect_activation":
      return `Efeito ativado.`;

    default:
      return `Responda à ${context.event || context.type || "ação"}.`;
  }
}
