/**
 * Summon modal methods for Renderer
 * Handles: showSummonModal, showConditionalSummonPrompt, showTierChoiceModal,
 * showSpellChoiceModal, showPositionChoiceModal, showSpecialSummonPositionModal
 */

import { getCardDisplayName, getUIText } from "../../core/i18n.js";

function resolveHandCardElement(cardIndex, options = {}) {
  if (options.anchorElement) {
    return options.anchorElement;
  }
  const ownerId = options.ownerId === "bot" ? "bot" : "player";
  return document.querySelector(
    `#${ownerId}-hand .card[data-index="${cardIndex}"]`
  );
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showSummonModal(cardIndex, callback, options = {}) {
  const existingModal = document.querySelector(".summon-choice-modal");
  if (existingModal) {
    existingModal.remove();
  }

  const cardElement = resolveHandCardElement(cardIndex, options);
  const rect = cardElement ? cardElement.getBoundingClientRect() : null;

  const modal = document.createElement("div");
  modal.className = "summon-choice-modal";
  const content = document.createElement("div");
  content.className = "summon-choice-content";

  const canNormalSummon =
    options.canNormalSummon === undefined ? true : !!options.canNormalSummon;
  const canSet = options.canSet === undefined ? true : !!options.canSet;
  const addChoiceButton = (label, choice) => {
    const button = document.createElement("button");
    button.textContent = label;
    button.onclick = (e) => {
      e.stopPropagation();
      callback(choice);
      cleanup();
    };
    content.appendChild(button);
    return button;
  };

  if (canNormalSummon) {
    addChoiceButton(getUIText("ui.summon.normal"), "attack");
  }

  if (options.specialSummonFromHand) {
    addChoiceButton(
      options.specialSummonFromHandLabel || getUIText("ui.summon.special"),
      "special_from_void_forgotten",
    );
  }

  if (options.specialSummonFromHandEffect) {
    addChoiceButton(
      options.specialSummonFromHandEffectLabel || getUIText("ui.summon.special"),
      "special_from_hand_effect",
    );
  }

  if (canSet) {
    addChoiceButton(getUIText("ui.summon.set"), "defense");
  }

  if (content.children.length === 0) {
    return;
  }

  modal.appendChild(content);

  // posicionamento inteligente: tenta abaixo da carta,
  // e se não couber, abre acima; também evita sair pelas laterais
  modal.style.position = "fixed";
  modal.style.zIndex = "200";

  document.body.appendChild(modal);

  if (rect) {
    const contentRect = content.getBoundingClientRect();

    let left = rect.left;
    let top = rect.bottom + 10;

    // se estourar a parte de baixo da tela, coloca acima da carta
    if (top + contentRect.height > window.innerHeight - 10) {
      top = rect.top - contentRect.height - 10;
    }

    // clamp horizontal para não sair pelas laterais
    if (left + contentRect.width > window.innerWidth - 10) {
      left = window.innerWidth - contentRect.width - 10;
    }
    if (left < 10) left = 10;

    modal.style.left = `${left}px`;
    modal.style.top = `${top}px`;
  }

  const cleanup = () => {
    if (modal.parentNode) {
      modal.parentNode.removeChild(modal);
    }
    document.removeEventListener("mousedown", handleOutsideClick);
  };

  const handleOutsideClick = (event) => {
    if (!modal.contains(event.target)) {
      cleanup();
    }
  };

  // registra o listener após o frame para não disparar com o próprio clique de abertura
  setTimeout(() => {
    document.addEventListener("mousedown", handleOutsideClick);
  }, 0);

}

/**
 * @this {import('../Renderer.js').default}
 */
export function showConditionalSummonPrompt(cardName, message) {
  if (typeof document === "undefined") {
    return Promise.resolve(false);
  }

  const existing = document.querySelector(".conditional-summon-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.className = "conditional-summon-modal";
  modal.innerHTML = `
    <div class="conditional-summon-backdrop"></div>
    <div class="conditional-summon-content">
      <header class="conditional-summon-header">
        <h3 class="conditional-summon-title">${cardName}</h3>
      </header>
      <p class="conditional-summon-text">
        ${message}
      </p>
      <div class="conditional-summon-actions">
        <button class="primary" data-choice="yes">${getUIText(
          "ui.summon.conditionalConfirm",
        )}</button>
        <button class="secondary" data-choice="no">${getUIText(
          "ui.summon.conditionalDecline",
        )}</button>
      </div>
    </div>
  `;

  const promise = new Promise((resolve) => {
    const cleanup = (result) => {
      modal.remove();
      resolve(result);
    };

    modal.addEventListener("click", (e) => {
      if (e.target.classList.contains("conditional-summon-backdrop")) {
        cleanup(false);
      }
    });

    modal.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const choice = btn.dataset.choice;
        cleanup(choice === "yes");
      });
    });
  });

  document.body.appendChild(modal);
  return promise;
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showTierChoiceModal({
  title = getUIText("ui.summon.chooseTier"),
  options = [],
} = {}) {
  if (typeof document === "undefined") {
    const best = options
      .slice()
      .sort((a, b) => (b.count || 0) - (a.count || 0))[0];
    return Promise.resolve(best ? best.count : null);
  }

  const validOptions = options.filter(
    (opt) => typeof opt.count === "number" && opt.count > 0
  );

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal tier-choice-overlay";

    const modal = document.createElement("div");
    modal.className = "modal-content tier-choice-modal";

    const header = document.createElement("div");
    header.className = "tier-choice-header";

    const titleEl = document.createElement("h3");
    titleEl.textContent = title;
    header.appendChild(titleEl);

    modal.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "tier-choice-grid";

    let selected = null;

    validOptions.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className = "tier-choice-card";
      btn.dataset.count = String(opt.count);

      const label = document.createElement("div");
      label.className = "tier-choice-label";
      label.textContent =
        opt.label ||
        getUIText("ui.summon.tierFallback", { count: opt.count });

      const desc = document.createElement("div");
      desc.className = "tier-choice-desc";
      desc.innerHTML = (opt.description || "").replace(/\n/g, '<br>');

      btn.appendChild(label);
      btn.appendChild(desc);

      btn.addEventListener("click", () => {
        modal
          .querySelectorAll(".tier-choice-card")
          .forEach((el) => el.classList.remove("selected"));
        btn.classList.add("selected");
        selected = opt.count;
        confirmBtn.disabled = false;
      });

      grid.appendChild(btn);
    });

    modal.appendChild(grid);

    const actions = document.createElement("div");
    actions.className = "tier-choice-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = getUIText("ui.common.cancel");
    cancelBtn.className = "secondary";
    cancelBtn.onclick = () => {
      overlay.remove();
      resolve(null);
    };

    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = getUIText("ui.common.confirm");
    confirmBtn.className = "primary";
    confirmBtn.disabled = true;
    confirmBtn.onclick = () => {
      overlay.remove();
      resolve(selected);
    };

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    modal.appendChild(actions);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showSpellChoiceModal(cardIndex, callback, options = {}) {
  const existingModal = document.querySelector(".spell-choice-modal");
  if (existingModal) {
    existingModal.remove();
  }

  const canActivate =
    options.canActivate === undefined ? true : !!options.canActivate;
  const canSet = options.canSet === undefined ? true : !!options.canSet;

  const cardElement = resolveHandCardElement(cardIndex, options);
  const rect = cardElement ? cardElement.getBoundingClientRect() : null;

  const modal = document.createElement("div");
  modal.className = "spell-choice-modal";
  const content = document.createElement("div");
  content.className = "spell-choice-content";

  const setBtn = document.createElement("button");
  setBtn.dataset.choice = "set";
  setBtn.textContent = getUIText("ui.spell.set");

  if (canActivate) {
    const activateBtn = document.createElement("button");
    activateBtn.dataset.choice = "activate";
    activateBtn.textContent = getUIText("ui.spell.activate");
    content.appendChild(activateBtn);
  }
  if (canSet) {
    content.appendChild(setBtn);
  }
  modal.appendChild(content);

  // posicionamento semelhante ao modal de invocacao
  modal.style.position = "fixed";
  modal.style.zIndex = "200";

  document.body.appendChild(modal);

  if (rect) {
    const contentEl = modal.querySelector(".spell-choice-content") || modal;
    const contentRect = contentEl.getBoundingClientRect();

    let left = rect.left;
    let top = rect.bottom + 10;

    if (top + contentRect.height > window.innerHeight - 10) {
      top = rect.top - contentRect.height - 10;
    }
    if (left + contentRect.width > window.innerWidth - 10) {
      left = window.innerWidth - contentRect.width - 10;
    }
    if (left < 10) left = 10;

    modal.style.left = `${left}px`;
    modal.style.top = `${top}px`;
  }

  const cleanup = () => {
    if (modal.parentNode) {
      modal.parentNode.removeChild(modal);
    }
    document.removeEventListener("mousedown", handleOutsideClick);
  };

  const handleOutsideClick = (event) => {
    if (!modal.contains(event.target)) {
      cleanup();
    }
  };

  setTimeout(() => {
    document.addEventListener("mousedown", handleOutsideClick);
  }, 0);

  modal.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const choice = btn.dataset.choice;
      cleanup();
      if (choice && typeof callback === "function") {
        callback(choice);
      }
    });
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showPositionChoiceModal(cardEl, card, callback, options = {}) {
  const existing = document.querySelector(".position-choice-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.className = "position-choice-modal";
  const content = document.createElement("div");
  content.className = "position-choice-content";

  // Botão de ativar efeito ignition (se disponível)
  if (
    options.hasIgnitionEffect &&
    typeof options.onActivateEffect === "function"
  ) {
    const activateBtn = document.createElement("button");
    activateBtn.dataset.choice = "activate_effect";
    activateBtn.textContent = getUIText("ui.summon.activateEffect");
    content.appendChild(activateBtn);
  }

  if (
    options.hasAscensionSummon &&
    typeof options.onAscensionSummon === "function"
  ) {
    const ascendBtn = document.createElement("button");
    ascendBtn.dataset.choice = "ascension_summon";
    ascendBtn.textContent = getUIText("ui.summon.ascend");
    content.appendChild(ascendBtn);
  }

  if (options.canFlip) {
    const flipBtn = document.createElement("button");
    flipBtn.dataset.choice = "flip";
    flipBtn.textContent = getUIText("ui.summon.flip");
    content.appendChild(flipBtn);
  }

  if (options.canChangePosition && card?.position !== "attack") {
    const attackBtn = document.createElement("button");
    attackBtn.dataset.choice = "to_attack";
    attackBtn.textContent = getUIText("ui.summon.toAttack");
    content.appendChild(attackBtn);
  }

  if (options.canChangePosition && card?.position !== "defense") {
    const defenseBtn = document.createElement("button");
    defenseBtn.dataset.choice = "to_defense";
    defenseBtn.textContent = getUIText("ui.summon.toDefense");
    content.appendChild(defenseBtn);
  }
  modal.appendChild(content);

  modal.style.position = "fixed";
  modal.style.zIndex = "200";

  document.body.appendChild(modal);

  const rect = cardEl?.getBoundingClientRect();
  if (rect) {
    const contentEl = modal.querySelector(".position-choice-content") || modal;
    const contentRect = contentEl.getBoundingClientRect();

    let left = rect.left;
    let top = rect.bottom + 8;

    if (top + contentRect.height > window.innerHeight - 8) {
      top = rect.top - contentRect.height - 8;
    }
    if (left + contentRect.width > window.innerWidth - 8) {
      left = window.innerWidth - contentRect.width - 8;
    }
    if (left < 8) left = 8;

    modal.style.left = `${left}px`;
    modal.style.top = `${top}px`;
  }

  const cleanup = () => {
    if (modal.parentNode) {
      modal.parentNode.removeChild(modal);
    }
    document.removeEventListener("mousedown", outsideHandler);
  };

  const outsideHandler = (e) => {
    if (!modal.contains(e.target)) {
      cleanup();
    }
  };

  setTimeout(() => document.addEventListener("mousedown", outsideHandler), 0);

  modal.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const choice = btn.dataset.choice;
      cleanup();
      if (
        choice === "activate_effect" &&
        typeof options.onActivateEffect === "function"
      ) {
        options.onActivateEffect();
      } else if (
        choice === "ascension_summon" &&
        typeof options.onAscensionSummon === "function"
      ) {
        options.onAscensionSummon();
      } else if (choice) {
        callback(choice);
      }
    });
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showSpecialSummonPositionModal(card, onChoose) {
  const existing = document.querySelector(".special-summon-position-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.className = "special-summon-position-modal";

  const imageUrl = card?.image || "";
  const safeName =
    (card && getCardDisplayName(card)) ||
    (card?.name && card.name.trim()) ||
    getUIText("ui.fusion.monsterFallback");
  const previewStyle = imageUrl ? `background-image: url('${imageUrl}')` : "";

  modal.innerHTML = `
    <div class="special-position-backdrop"></div>
    <div class="special-position-content">
      <h3>${getUIText("ui.summon.special")}</h3>
      <p class="special-position-subtitle"></p>
      <div class="special-position-options">
        <button class="position-option attack" data-choice="attack">
          <div class="position-card attack" style="${previewStyle}"></div>
          <span>${getUIText("ui.summon.attack")}</span>
        </button>
        <button class="position-option defense" data-choice="defense">
          <div class="position-card defense" style="${previewStyle}"></div>
          <span>${getUIText("ui.summon.defense")}</span>
        </button>
      </div>
    </div>
  `;

  const subtitle = modal.querySelector(".special-position-subtitle");
  if (subtitle) {
    subtitle.textContent = getUIText("ui.summon.choosePosition", {
      cardName: safeName,
    });
  }

  const cleanup = () => {
    document.removeEventListener("keydown", keyHandler);
    if (modal.parentNode) {
      modal.parentNode.removeChild(modal);
    }
  };

  const keyHandler = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cleanup();
      if (typeof onChoose === "function") {
        onChoose("defense");
      }
    }
  };

  modal
    .querySelector(".special-position-backdrop")
    ?.addEventListener("click", () => {
      cleanup();
      if (typeof onChoose === "function") {
        onChoose("attack");
      }
    });

  modal.querySelectorAll(".position-option").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const choice = btn.dataset.choice;
      cleanup();
      if (typeof onChoose === "function") {
        onChoose(choice);
      }
    });
  });

  document.addEventListener("keydown", keyHandler);
  document.body.appendChild(modal);
}
