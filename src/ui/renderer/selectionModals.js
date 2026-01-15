/**
 * Selection modal methods for Renderer
 * Handles: showTargetSelection, showFieldTargetingControls, hideFieldTargetingControls,
 * showDestructionNegationPrompt, showFusionTargetModal, showFusionMaterialSelection,
 * showCardGridSelectionModal, showIgnitionActivateModal, showShadowHeartCathedralModal,
 * showSickleSelectionModal, showTieBreakerSelection, showMultiSelectModal
 */

import {
  getCardDisplayName,
  getCardDisplayDescription,
} from "../../core/i18n.js";

/**
 * @this {import('../Renderer.js').default}
 */
export function showTargetSelection(
  selectionContract,
  onConfirm,
  onCancel,
  config = {}
) {
  const contract =
    selectionContract && typeof selectionContract === "object"
      ? selectionContract
      : {};
  const requirements = Array.isArray(contract.requirements)
    ? contract.requirements
    : [];
  if (requirements.length === 0) {
    console.warn("[Renderer] Target selection missing requirements.");
    return { close: () => {} };
  }

  const overlay = document.createElement("div");
  overlay.className = "modal target-modal";

  const allowCancel =
    contract.ui?.allowCancel !== false && config.allowCancel !== false;
  const allowEmpty =
    contract.ui?.allowEmpty === true || config.allowEmpty === true;

  const content = document.createElement("div");
  content.className = "modal-content target-content";
  content.innerHTML = `<span class="close-target">${
    allowCancel ? "&times;" : ""
  }</span><h2>Select target(s)</h2>`;

  const selectionState = {};
  const counterById = new Map();

  const updateConfirmState = () => {
    let ready = true;
    requirements.forEach((req) => {
      const selected = selectionState[req.id] || [];
      const min = Number(req.min ?? 0);
      const max = Number(req.max ?? min);
      const requiredMin = allowEmpty ? 0 : min;
      const counter = counterById.get(req.id);
      if (counter) {
        counter.textContent = `${selected.length} / ${max}`;
      }
      if (selected.length < requiredMin || selected.length > max) {
        ready = false;
      }
    });
    confirmBtn.disabled = !ready;
  };

  requirements.forEach((req) => {
    const block = document.createElement("div");
    block.className = "target-block";
    const min = Number(req.min ?? 0);
    const max = Number(req.max ?? min);
    block.innerHTML = `<p>Choose ${
      min === max ? min : `${min}-${max}`
    } target(s) for ${req.id}</p>`;

    const counter = document.createElement("div");
    counter.className = "target-counter";
    counter.textContent = `0 / ${max}`;
    counterById.set(req.id, counter);

    const list = document.createElement("div");
    list.className = "target-list";

    req.candidates.forEach((cand, candIndex) => {
      const btn = document.createElement("button");
      btn.className = "target-btn";
      btn.dataset.targetId = req.id;
      const selectionKey = cand.key || `${req.id}_${candIndex}`;
      btn.dataset.key = selectionKey;

      // Create card visual
      const targetCard = cand.cardRef || cand;
      const displayName =
        getCardDisplayName(targetCard) ||
        (targetCard?.name && targetCard.name) ||
        cand.name ||
        "Card";
      const cardImage = document.createElement("img");
      cardImage.src =
        targetCard.image || cand.cardRef?.image || "assets/card-back.png";
      cardImage.alt = displayName;
      cardImage.style.width = "100px";
      cardImage.style.height = "auto";
      cardImage.style.borderRadius = "4px";
      cardImage.style.marginBottom = "8px";
      cardImage.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.5)";

      const nameDiv = document.createElement("div");
      nameDiv.className = "target-name";
      nameDiv.textContent = displayName;

      const metaDiv = document.createElement("div");
      metaDiv.className = "target-meta";
      metaDiv.textContent = `${cand.owner} ${cand.position || ""}`.trim();

      const statsDiv = document.createElement("div");
      statsDiv.className = "target-stats";
      statsDiv.textContent = `ATK ${cand.atk ?? "-"} / DEF ${cand.def ?? "-"}`;

      btn.appendChild(cardImage);
      btn.appendChild(nameDiv);
      btn.appendChild(metaDiv);
      btn.appendChild(statsDiv);

      btn.addEventListener("click", () => {
        const arr = selectionState[req.id] || [];
        const already = arr.indexOf(selectionKey);
        if (already > -1) {
          arr.splice(already, 1);
          btn.classList.remove("selected");
        } else {
          if (arr.length < max) {
            arr.push(selectionKey);
            btn.classList.add("selected");
          }
        }
        selectionState[req.id] = arr;
        updateConfirmState();
      });

      list.appendChild(btn);
    });

    block.appendChild(list);
    block.appendChild(counter);
    content.appendChild(block);
  });

  const actions = document.createElement("div");
  actions.className = "target-actions";
  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Confirm";
  if (allowCancel) {
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    actions.appendChild(cancelBtn);
    cancelBtn.addEventListener("click", () => {
      closeModal();
      onCancel && onCancel();
    });
  }
  actions.appendChild(confirmBtn);
  content.appendChild(actions);

  overlay.appendChild(content);
  document.body.appendChild(overlay);

  updateConfirmState();

  const closeModal = () => {
    if (overlay.parentNode) {
      document.body.removeChild(overlay);
    }
  };

  const closeBtn = overlay.querySelector(".close-target");
  if (allowCancel) {
    closeBtn.addEventListener("click", () => {
      closeModal();
      onCancel && onCancel();
    });
  } else {
    closeBtn.style.display = "none";
  }

  confirmBtn.addEventListener("click", () => {
    // validate
    for (const req of requirements) {
      const selected = selectionState[req.id] || [];
      const minSel = Number(req.min ?? 0);
      const maxSel = Number(req.max ?? minSel);
      const requiredMin = allowEmpty ? 0 : minSel;
      if (selected.length < requiredMin) {
        alert(
          `Select ${
            minSel === maxSel ? minSel : `${minSel}-${maxSel}`
          } target(s) for ${req.id}`
        );
        return;
      }
      if (selected.length > maxSel) {
        alert(
          `Select ${
            minSel === maxSel ? minSel : `${minSel}-${maxSel}`
          } target(s) for ${req.id}`
        );
        return;
      }
    }
    closeModal();
    onConfirm && onConfirm(selectionState);
  });

  return { close: closeModal };
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showFieldTargetingControls(onConfirm, onCancel, config = {}) {
  this.hideFieldTargetingControls();

  const allowCancel = config.allowCancel !== false;

  const bar = document.createElement("div");
  bar.className = "field-targeting-controls";
  bar.style.position = "fixed";
  bar.style.left = "50%";
  bar.style.bottom = "24px";
  bar.style.transform = "translateX(-50%)";
  bar.style.display = "flex";
  bar.style.gap = "12px";
  bar.style.padding = "12px 16px";
  bar.style.background = "rgba(16, 18, 28, 0.92)";
  bar.style.borderRadius = "12px";
  bar.style.boxShadow = "0 8px 24px rgba(0,0,0,0.35)";
  bar.style.zIndex = "3000";
  bar.style.alignItems = "center";

  const counter = document.createElement("div");
  counter.className = "field-targeting-counter";
  counter.textContent = "0 / 0";

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Confirm";
  confirmBtn.className = "primary";
  confirmBtn.style.minWidth = "110px";
  confirmBtn.onclick = () => {
    if (typeof onConfirm === "function") onConfirm();
  };

  if (allowCancel) {
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.className = "secondary";
    cancelBtn.style.minWidth = "96px";
    cancelBtn.onclick = () => {
      if (typeof onCancel === "function") onCancel();
      this.hideFieldTargetingControls();
    };
    bar.appendChild(cancelBtn);
  }

  bar.appendChild(counter);
  bar.appendChild(confirmBtn);
  document.body.appendChild(bar);

  const updateState = ({ selected = 0, min = 0, max = 0, allowEmpty }) => {
    const requiredMin = allowEmpty ? 0 : min;
    counter.textContent = `${selected} / ${max || "-"}`;
    confirmBtn.disabled = selected < requiredMin || (max > 0 && selected > max);
  };

  updateState({ selected: 0, min: 0, max: 0, allowEmpty: true });

  return {
    updateState,
    close: () => this.hideFieldTargetingControls(),
  };
}

/**
 * @this {import('../Renderer.js').default}
 */
export function hideFieldTargetingControls() {
  const existing = document.querySelector(".field-targeting-controls");
  if (existing) {
    existing.remove();
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showDestructionNegationPrompt(
  cardName,
  costDescription,
  onDecision
) {
  const existing = document.querySelector(".destruction-negation-modal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "modal destruction-negation-modal";

  const content = document.createElement("div");
  content.className = "modal-content target-content";

  const title = document.createElement("h3");
  title.textContent = `Deseja ativar o efeito de "${cardName}"?`;

  const desc = document.createElement("p");
  desc.innerHTML = costDescription ? `Custo: ${costDescription}`.replace(/\n/g, '<br>') : "";

  const actions = document.createElement("div");
  actions.className = "target-actions";

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Sim";
  confirmBtn.className = "primary";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Não";
  cancelBtn.className = "secondary";

  confirmBtn.onclick = () => {
    overlay.remove();
    if (typeof onDecision === "function") onDecision(true);
  };
  cancelBtn.onclick = () => {
    overlay.remove();
    if (typeof onDecision === "function") onDecision(false);
  };

  actions.appendChild(confirmBtn);
  actions.appendChild(cancelBtn);

  content.appendChild(title);
  if (desc.textContent) {
    content.appendChild(desc);
  }
  content.appendChild(actions);

  overlay.appendChild(content);
  document.body.appendChild(overlay);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showFusionTargetModal(availableFusions, onSelect, onCancel) {
  const overlay = document.createElement("div");
  overlay.className = "modal fusion-modal";

  const content = document.createElement("div");
  content.className = "modal-content fusion-content";

  const title = document.createElement("h2");
  title.textContent = "Select Fusion Monster";
  title.style.color = "#8b00ff";

  const hint = document.createElement("p");
  hint.textContent = "Choose a Fusion Monster to summon:";
  hint.className = "fusion-hint";

  const grid = document.createElement("div");
  grid.className = "fusion-grid";

  availableFusions.forEach(({ fusion, index }) => {
    const cardEl = this.createCardElement(fusion, true);
    cardEl.classList.add("fusion-selectable");
    cardEl.addEventListener("click", () => {
      document.body.removeChild(overlay);
      onSelect(index);
    });
    grid.appendChild(cardEl);
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.className = "secondary";
  cancelBtn.onclick = () => {
    document.body.removeChild(overlay);
    if (typeof onCancel === "function") {
      onCancel();
    }
  };

  content.appendChild(title);
  content.appendChild(hint);
  content.appendChild(grid);
  content.appendChild(cancelBtn);
  overlay.appendChild(content);
  document.body.appendChild(overlay);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showFusionMaterialSelection(
  availableMaterials,
  requirements,
  onConfirm,
  onCancel
) {
  const overlay = document.createElement("div");
  overlay.className = "modal fusion-material-modal";

  const content = document.createElement("div");
  content.className = "modal-content fusion-material-content";

  const title = document.createElement("h2");
  title.textContent = "Select Fusion Materials";
  title.style.color = "#8b00ff";

  const hint = document.createElement("p");
  hint.className = "fusion-hint";
  hint.innerHTML = "Select materials:<br>";
  requirements.forEach((req) => {
    const count = req.count || 1;
    const desc =
      req.name || req.archetype || req.type || req.attribute || "monster";
    const zones = Array.isArray(req.allowedZones)
      ? req.allowedZones
      : typeof req.zone === "string"
      ? [req.zone]
      : null;
    const zoneSuffix =
      zones && zones.length > 0 ? ` (${zones.join(" or ")})` : "";
    hint.innerHTML += `${count}x ${desc}${zoneSuffix}<br>`;
  });

  const selectedMaterials = [];
  const grid = document.createElement("div");
  grid.className = "fusion-material-grid";

  const updateButtons = () => {
    confirmBtn.disabled = selectedMaterials.length === 0;
  };

  availableMaterials.forEach((material) => {
    const cardEl = this.createCardElement(material, true);
    cardEl.classList.add("fusion-material-selectable");

    cardEl.addEventListener("click", () => {
      if (selectedMaterials.includes(material)) {
        // Deselect
        const idx = selectedMaterials.indexOf(material);
        selectedMaterials.splice(idx, 1);
        cardEl.classList.remove("selected");
      } else {
        // Select
        selectedMaterials.push(material);
        cardEl.classList.add("selected");
      }
      updateButtons();
    });

    grid.appendChild(cardEl);
  });

  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.className = "secondary";
  cancelBtn.onclick = () => {
    document.body.removeChild(overlay);
    onCancel && onCancel();
  };

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Confirm";
  confirmBtn.disabled = true;
  confirmBtn.onclick = () => {
    document.body.removeChild(overlay);
    onConfirm([...selectedMaterials]);
  };

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);

  content.appendChild(title);
  content.appendChild(hint);
  content.appendChild(grid);
  content.appendChild(actions);
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  updateButtons();
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showCardGridSelectionModal(options) {
  const {
    title = "Select Cards",
    subtitle = "",
    cards = [],
    minSelect = 0,
    maxSelect = cards.length || 1,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    overlayClass = "card-grid-overlay",
    modalClass = "card-grid-modal",
    gridClass = "card-grid",
    cardClass = "card-grid-item",
    infoText = "",
    onConfirm,
    onCancel,
    renderCard,
  } = options || {};

  const overlay = document.createElement("div");
  overlay.className = overlayClass;

  const modal = document.createElement("div");
  modal.className = modalClass;

  const header = document.createElement("div");
  header.className = "card-grid-header";

  const titleEl = document.createElement("h3");
  titleEl.textContent = title;
  header.appendChild(titleEl);

  if (subtitle) {
    const subEl = document.createElement("p");
    subEl.className = "card-grid-subtitle";
    subEl.innerHTML = subtitle;
    header.appendChild(subEl);
  }

  modal.appendChild(header);

  const grid = document.createElement("div");
  grid.className = gridClass;
  const selected = new Set();

  const renderDefaultCard = (card) => {
    const cardEl = document.createElement("div");
    cardEl.className = cardClass;

    const img = document.createElement("img");
    img.src = card.image || "assets/card-back.png";
    const displayName =
      getCardDisplayName(card) || (card?.name && card.name) || "";
    img.alt = displayName || "Card";
    img.className = "card-grid-image";

    const info = document.createElement("div");
    info.className = "card-grid-info";

    const name = document.createElement("div");
    name.className = "card-grid-name";
    name.textContent = displayName;
    info.appendChild(name);

    if (card.cardKind === "monster") {
      const stats = document.createElement("div");
      stats.className = "card-grid-stats";
      stats.textContent = `ATK ${card.atk || 0} / DEF ${card.def || 0} / L${
        card.level || 0
      }`;
      info.appendChild(stats);
    }

    cardEl.appendChild(img);
    cardEl.appendChild(info);

    return cardEl;
  };

  cards.forEach((card, idx) => {
    const cardEl = renderCard ? renderCard(card, idx) : renderDefaultCard(card);
    if (!cardEl) return;

    cardEl.classList.add(cardClass);
    cardEl.dataset.index = String(idx);
    this.bindPreviewForElement(cardEl, card, true);

    const toggle = () => {
      const already = selected.has(idx);
      if (already) {
        selected.delete(idx);
        cardEl.classList.remove("selected");
        return;
      }
      if (selected.size >= maxSelect) return;
      selected.add(idx);
      cardEl.classList.add("selected");
    };

    cardEl.addEventListener("click", () => {
      toggle();
    });

    const imgEl = cardEl.querySelector("img");
    if (imgEl) {
      imgEl.addEventListener("click", (e) => {
        e.stopPropagation();
        toggle();
      });
    }

    grid.appendChild(cardEl);
  });

  modal.appendChild(grid);

  grid.addEventListener("mouseover", (e) => {
    const item = e.target.closest(`.${cardClass}`);
    if (!item) return;
    const idx = Number(item.dataset.index);
    const card = cards[idx];
    if (card) {
      this.renderPreview(card);
    }
  });

  if (infoText) {
    const info = document.createElement("div");
    info.className = "card-grid-info-text";
    info.textContent = infoText;
    modal.appendChild(info);
  }

  const actions = document.createElement("div");
  actions.className = "card-grid-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = cancelLabel;
  cancelBtn.className = "secondary";
  cancelBtn.onclick = () => {
    overlay.remove();
    if (typeof onCancel === "function") onCancel();
  };

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = confirmLabel;
  confirmBtn.className = "primary";
  confirmBtn.onclick = () => {
    if (selected.size < minSelect) return;
    const chosen = Array.from(selected)
      .map((i) => cards[i])
      .filter(Boolean);
    overlay.remove();
    if (typeof onConfirm === "function") onConfirm(chosen);
  };

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  modal.appendChild(actions);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showIgnitionActivateModal(card, onActivate) {
  const overlay = document.createElement("div");
  overlay.classList.add("modal", "ignition-overlay");

  const modal = document.createElement("div");
  modal.classList.add("modal-content", "ignition-modal");

  const title = document.createElement("h3");
  const titleText =
    (card && getCardDisplayName(card)) ||
    (card?.name && card.name) ||
    "Activate effect?";
  title.textContent = titleText;
  title.classList.add("modal-title");

  const desc = document.createElement("p");
  desc.textContent = "Activate this monster's effect?";
  desc.classList.add("modal-text");

  const actions = document.createElement("div");
  actions.classList.add("modal-actions");

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.classList.add("secondary");
  const activateBtn = document.createElement("button");
  activateBtn.textContent = "Activate";

  const cleanup = () => {
    overlay.remove();
  };

  cancelBtn.onclick = () => cleanup();
  activateBtn.onclick = () => {
    cleanup();
    if (typeof onActivate === "function") onActivate();
  };

  actions.appendChild(cancelBtn);
  actions.appendChild(activateBtn);
  modal.appendChild(title);
  modal.appendChild(desc);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showShadowHeartCathedralModal(
  validMonsters,
  maxAtk,
  counterCount,
  callback
) {
  this.showCardGridSelectionModal({
    title: "Shadow-Heart Cathedral",
    subtitle: `Select 1 Shadow-Heart monster with ATK <= ${maxAtk} (${counterCount} counters)`,
    cards: validMonsters,
    minSelect: 1,
    maxSelect: 1,
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
    overlayClass: "cathedral-overlay",
    modalClass: "cathedral-modal",
    gridClass: "cathedral-grid",
    cardClass: "cathedral-card",
    infoText: "Only Shadow-Heart monsters in your Deck are valid.",
    onConfirm: (chosen) => {
      const card = Array.isArray(chosen) ? chosen[0] : null;
      if (callback) callback(card || null);
    },
    onCancel: () => {
      if (callback) callback(null);
    },
    renderCard: (monster) => {
      try {
        const cardItem = document.createElement("div");
        cardItem.classList.add("cathedral-card-item");

        const cardImg = document.createElement("img");
        cardImg.src = monster.image || "assets/card-back.png";
        cardImg.alt = monster.name;
        cardImg.classList.add("cathedral-card-img");

        const cardInfo = document.createElement("div");
        cardInfo.classList.add("cathedral-card-info");

        const cardName = document.createElement("div");
        cardName.textContent = monster.name;
        cardName.classList.add("cathedral-card-name");
        cardName.style.fontSize = "15px";
        cardName.style.fontWeight = "bold";
        cardName.style.lineHeight = "1.3";

        const cardStats = document.createElement("div");
        cardStats.textContent = `ATK ${monster.atk || 0} / DEF ${
          monster.def || 0
        } / Level ${monster.level || 0}`;
        cardStats.classList.add("cathedral-card-stats");
        cardStats.style.fontSize = "14px";
        cardStats.style.color = "#aaa";
        cardStats.style.fontWeight = "500";

        cardInfo.appendChild(cardName);
        cardInfo.appendChild(cardStats);
        cardItem.appendChild(cardImg);
        cardItem.appendChild(cardInfo);
        return cardItem;
      } catch (e) {
        console.error("[Cathedral Modal] Error in renderCard:", e);
        return null;
      }
    },
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showSickleSelectionModal(
  candidates,
  maxSelect,
  onConfirm,
  onCancel
) {
  this.showCardGridSelectionModal({
    title: 'Select up to 2 "Luminarch" monsters to add to hand',
    subtitle: `Select up to ${maxSelect}.`,
    cards: candidates,
    minSelect: 0,
    maxSelect,
    confirmLabel: "Add to Hand",
    cancelLabel: "Cancel",
    overlayClass: "modal sickle-overlay",
    modalClass: "modal-content sickle-modal",
    gridClass: "sickle-list",
    cardClass: "sickle-row",
    onConfirm,
    onCancel,
    renderCard: (card) => {
      const row = document.createElement("label");
      row.classList.add("sickle-row");
      const name = document.createElement("span");
      const stats = `ATK ${card.atk || 0} / DEF ${card.def || 0} / L${
        card.level || 0
      }`;
      name.textContent = `${card.name} (${stats})`;
      row.appendChild(name);
      return row;
    },
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showTieBreakerSelection(options = {}) {
  const {
    title = "Choose Survivor",
    subtitle = "",
    infoText = "",
    cards = [],
    keepCount = 1,
    onConfirm,
    onCancel,
  } = options;

  const renderCard = (card) => {
    const cardEl = document.createElement("div");
    cardEl.classList.add("tie-breaker-card-item");

    const imageDiv = document.createElement("div");
    imageDiv.classList.add("tie-breaker-card-image");
    imageDiv.style.backgroundImage = `url('${card.image}')`;
    cardEl.appendChild(imageDiv);

    const infoDiv = document.createElement("div");
    infoDiv.classList.add("tie-breaker-card-info");

    const nameDiv = document.createElement("div");
    nameDiv.classList.add("tie-breaker-card-name");
    const displayName =
      getCardDisplayName(card) || (card?.name && card.name) || "Card";
    nameDiv.textContent = displayName;
    infoDiv.appendChild(nameDiv);

    const statsDiv = document.createElement("div");
    statsDiv.classList.add("tie-breaker-card-stats");
    statsDiv.innerHTML = `<span>ATK ${card.atk || 0}</span>`;
    infoDiv.appendChild(statsDiv);

    cardEl.appendChild(infoDiv);
    return cardEl;
  };

  this.showCardGridSelectionModal({
    title,
    subtitle,
    cards,
    minSelect: keepCount,
    maxSelect: keepCount,
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
    overlayClass: "tie-breaker-overlay",
    modalClass: "tie-breaker-modal",
    gridClass: "tie-breaker-grid",
    cardClass: "tie-breaker-card",
    infoText,
    onConfirm,
    onCancel,
    renderCard,
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function showMultiSelectModal(
  cards = [],
  selectionRange = {},
  onConfirm
) {
  const {
    min = 0,
    max = cards.length,
    title = "Select Cards",
    subtitle = "",
    infoText = "",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    renderCard,
  } = selectionRange || {};

  this.showCardGridSelectionModal({
    title,
    subtitle,
    cards,
    minSelect: min,
    maxSelect: max,
    infoText,
    confirmLabel,
    cancelLabel,
    renderCard,
    onConfirm: onConfirm || (() => {}),
  });
}
