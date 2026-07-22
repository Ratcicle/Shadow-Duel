/**
 * Trap modal methods for Renderer
 * Handles: showUnifiedTrapModal, showTrapActivationModal, showChainResponseModal,
 * _getContextDescription
 */

import {
  getCardDisplayName,
  getCardDisplayDescription,
  getUIText,
} from "../../core/i18n.js";
import { publicAssetUrl } from "../../core/publicUrl.js";

export function getEffectDisplayLabel(effect) {
  if (!effect) return "";
  if (effect.activationLabelKey) {
    return getUIText(
      effect.activationLabelKey,
      {},
      effect.activationLabel ||
        effect.promptMessage ||
        getUIText("ui.selection.effectLabel"),
    );
  }
  return (
    effect.activationLabel ||
    effect.promptMessage ||
    getUIText("ui.selection.effectLabel")
  );
}

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
  const {
    cards = [],
    context = null,
    mode = "single",
    signal = null,
  } = options;

  return new Promise((resolve) => {
    let resolved = false;
    let overlay = null;
    const handleAbort = () => finalize(null);
    const finalize = (result) => {
      if (resolved) return;
      resolved = true;
      document.removeEventListener("keydown", handleKeydown);
      signal?.removeEventListener?.("abort", handleAbort);
      overlay?.remove?.();
      if (this.activeTrapModalCancel === handleAbort) {
        this.activeTrapModalCancel = null;
      }
      resolve(result);
    };

    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        finalize(null);
      }
    };

    if (signal?.aborted) {
      finalize(null);
      return;
    }
    signal?.addEventListener?.("abort", handleAbort, { once: true });
    this.activeTrapModalCancel = handleAbort;

    overlay = document.createElement("div");
    overlay.className = "trap-activation-overlay";
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        finalize(null);
      }
    });

    const modal = document.createElement("div");
    modal.className = "trap-activation-modal";

    // Header - same style, different text based on mode
    const header = document.createElement("div");
    header.className = "trap-modal-header";

    const title = document.createElement("h3");
    if (mode === "chain" && context) {
      title.textContent = this._getContextDescription(context);
    } else {
      title.textContent = getUIText("ui.trap.activateTitle");
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
      img.src = publicAssetUrl(card.image || "assets/card-back.png");
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
      const descText =
        getCardDisplayDescription(card) || card.description || "";
      cardDesc.innerHTML = descText.replace(/\n/g, "<br>");
      cardInfo.appendChild(cardName);
      const effectLabel = getEffectDisplayLabel(item.effect);
      if (effectLabel) {
        const effectName = document.createElement("div");
        effectName.className = "trap-effect-name";
        effectName.textContent = effectLabel;
        cardInfo.appendChild(effectName);
      }
      cardInfo.appendChild(cardDesc);
      modal.appendChild(cardInfo);

      // Actions for single card
      const actions = document.createElement("div");
      actions.className = "trap-modal-actions";

      const cancelBtn = document.createElement("button");
      cancelBtn.textContent =
        mode === "chain"
          ? getUIText("ui.trap.pass")
          : getUIText("ui.trap.doNotActivate");
      cancelBtn.className = "trap-btn-cancel";
      cancelBtn.onclick = () => {
        finalize(null);
      };

      const confirmBtn = document.createElement("button");
      confirmBtn.textContent = getUIText("ui.trap.activate");
      confirmBtn.className = "trap-btn-confirm";
      confirmBtn.onclick = () => {
        finalize({ card, effect: item.effect || null, activate: true });
      };

      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      modal.appendChild(actions);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      document.addEventListener("keydown", handleKeydown);
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
        img.src = publicAssetUrl(card.image || "assets/card-back.png");
        img.className = "trap-card-image-mini";
        preview.appendChild(img);

        // Card info
        const info = document.createElement("div");
        info.className = "trap-card-info-inline";
        const name = document.createElement("div");
        name.className = "trap-card-name";
        name.textContent = getCardDisplayName(card) || card.name || "";
        info.appendChild(name);
        const effectLabel = getEffectDisplayLabel(effect);
        if (effectLabel) {
          const effectName = document.createElement("div");
          effectName.className = "trap-effect-name";
          effectName.textContent = effectLabel;
          info.appendChild(effectName);
        }

        // Activate button per card
        const activateBtn = document.createElement("button");
        activateBtn.textContent = getUIText("ui.trap.activateShort");
        activateBtn.className = "trap-btn-confirm";
        activateBtn.onclick = () => {
          finalize({ card, effect, activate: true });
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
      passBtn.textContent = getUIText("ui.trap.passNoResponse");
      passBtn.className = "trap-btn-cancel";
      passBtn.style.width = "100%";
      passBtn.onclick = () => {
        finalize(null);
      };
      actions.appendChild(passBtn);
      modal.appendChild(actions);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      document.addEventListener("keydown", handleKeydown);
      passBtn.focus();
    } else {
      // No cards - just resolve null
      finalize(null);
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
export function showChainResponseModal(
  activatable,
  context,
  chainStack = [],
  options = {},
) {
  return this.showUnifiedTrapModal({
    cards: activatable,
    context,
    mode: "chain",
    signal: options.signal || null,
  }).then((result) => {
    if (result?.activate) {
      return (
        activatable.find(
          (candidate) =>
            candidate?.card === result.card &&
            candidate?.effect === result.effect,
        ) || null
      );
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
  if (!context) return getUIText("ui.trap.responseDefault");

  switch (context.type) {
    case "attack_declaration": {
      const attacker =
        getCardDisplayName(context.attacker) ||
        context.attacker?.name ||
        getUIText("ui.trap.monsterFallback");
      const target =
        getCardDisplayName(context.target) ||
        context.target?.name ||
        getUIText("ui.trap.directAttack");
      return getUIText("ui.trap.attackDeclaration", { attacker, target });
    }

    case "summon": {
      const summoned =
        getCardDisplayName(context.card) ||
        context.card?.name ||
        getUIText("ui.trap.monsterFallback");
      return getUIText("ui.trap.summon", { card: summoned });
    }

    case "card_activation": {
      const activated =
        getCardDisplayName(context.card) ||
        context.card?.name ||
        getUIText("ui.trap.cardFallback");
      return getUIText("ui.trap.cardActivation", { card: activated });
    }

    case "phase_change":
      return getUIText("ui.trap.phaseChange");

    case "effect_activation":
      return getUIText("ui.trap.effectActivation");

    default:
      return getUIText("ui.trap.responseEvent", {
        event: context.event || context.type || getUIText("ui.selection.effectLabel"),
      });
  }
}
