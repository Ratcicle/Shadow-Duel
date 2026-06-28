/**
 * Selection modal methods for Renderer
 * Handles: showTargetSelection, showFieldTargetingControls, hideFieldTargetingControls,
 * showDestructionNegationPrompt, showFusionTargetModal, showFusionMaterialSelection,
 * showCardGridSelectionModal, showIgnitionActivateModal, showShadowHeartCathedralModal,
 * showSickleSelectionModal, showTieBreakerSelection, showMultiSelectModal
 */

import {
  getCardDisplayName,
  getLocale,
  getMonsterTypeDisplayName,
  getUIText,
} from "../../core/i18n.js";

const SELECTION_KIND_LABELS = {
  en: {
    monster: "Monster",
    spell: "Spell",
    trap: "Trap",
    fusion: "Fusion",
    synchro: "Synchro",
    ascension: "Ascension",
  },
  "pt-br": {
    monster: "Monstro",
    spell: "Magia",
    trap: "Armadilha",
    fusion: "Fusão",
    synchro: "Sincro",
    ascension: "Ascensão",
  },
};

const SELECTION_SUBTYPE_LABELS = {
  en: {
    normal: "Normal",
    continuous: "Continuous",
    field: "Field",
    equip: "Equip",
    quick: "Quick-Play",
  },
  "pt-br": {
    normal: "Normal",
    continuous: "Contínua",
    field: "Campo",
    equip: "Equipamento",
    quick: "Rápida",
  },
};

function getSelectionLabel(key) {
  const locale = getLocale();
  return (
    SELECTION_KIND_LABELS[locale]?.[key] ||
    SELECTION_SUBTYPE_LABELS[locale]?.[key] ||
    SELECTION_KIND_LABELS.en?.[key] ||
    SELECTION_SUBTYPE_LABELS.en?.[key] ||
    key
  );
}

export function getSelectionCardTypeClass(card) {
  if (card?.cardKind === "spell") return "selection-card--spell";
  if (card?.cardKind === "trap") return "selection-card--trap";
  const monsterType = String(card?.monsterType || "").toLowerCase();
  if (monsterType === "fusion") return "selection-card--fusion";
  if (monsterType === "synchro") return "selection-card--synchro";
  if (monsterType === "ascension") return "selection-card--ascension";
  return "selection-card--monster";
}

function getSelectionTypeLine(card) {
  if (card?.cardKind === "monster") {
    const monsterType = String(card?.monsterType || "").toLowerCase();
    const kind =
      monsterType === "fusion" ||
      monsterType === "synchro" ||
      monsterType === "ascension"
        ? getSelectionLabel(monsterType)
        : getSelectionLabel("monster");
    const race = getMonsterTypeDisplayName(card);
    return [kind, race].filter(Boolean).join(" | ");
  }

  const kind = getSelectionLabel(card?.cardKind || "card");
  const subtype = card?.subtype ? getSelectionLabel(card.subtype) : "";
  return [kind, subtype].filter(Boolean).join(" | ");
}

function getSelectionStat(card, candidate, stat) {
  const value = candidate?.[stat] ?? card?.[stat];
  return Number.isFinite(value) ? value : "-";
}

export function renderCompactSelectionCard(card, candidate = {}) {
  const displayName =
    getCardDisplayName(card) ||
    (card?.name && card.name) ||
    candidate.name ||
    getUIText("ui.selection.cardFallback");
  const wrapper = document.createDocumentFragment();

  const nameDiv = document.createElement("div");
  nameDiv.className = "selection-card-name";
  nameDiv.textContent = displayName;
  wrapper.appendChild(nameDiv);

  const body = document.createElement("div");
  body.className = "selection-card-body";

  const image = document.createElement("img");
  image.className = "selection-card-image";
  image.src = card?.image || candidate.cardRef?.image || "assets/card-back.png";
  image.alt = displayName;
  body.appendChild(image);

  const details = document.createElement("div");
  details.className = "selection-card-details";

  const typeLine = document.createElement("div");
  typeLine.className = "selection-card-type";
  typeLine.textContent = getSelectionTypeLine(card);
  details.appendChild(typeLine);

  if (card?.cardKind === "monster") {
    const level = document.createElement("div");
    level.className = "selection-card-stat";
    level.textContent = `⭐ ${getSelectionStat(card, candidate, "level")}`;
    details.appendChild(level);

    const atk = document.createElement("div");
    atk.className = "selection-card-stat";
    atk.textContent = `⚔️ ${getSelectionStat(card, candidate, "atk")}`;
    details.appendChild(atk);

    const def = document.createElement("div");
    def.className = "selection-card-stat";
    def.textContent = `🛡️ ${getSelectionStat(card, candidate, "def")}`;
    details.appendChild(def);
  }

  body.appendChild(details);
  wrapper.appendChild(body);
  return wrapper;
}

function getFieldTargetingSourceName(config = {}) {
  const sourceCard = getFieldTargetingSourceCard(config);
  if (sourceCard) {
    return getCardDisplayName(sourceCard) || sourceCard.name || null;
  }
  const contract = config.selectionContract || {};
  const metadata =
    contract.metadata && typeof contract.metadata === "object"
      ? contract.metadata
      : {};
  const sourceCardName =
    config.sourceCardName ||
    metadata.sourceCardName ||
    (typeof config.sourceCard === "string" ? config.sourceCard : null);
  return sourceCardName || null;
}

function getFieldTargetingSourceCard(config = {}) {
  const contract = config.selectionContract || {};
  const metadata =
    contract.metadata && typeof contract.metadata === "object"
      ? contract.metadata
      : {};
  const sourceCard =
    config.sourceCard ||
    metadata.sourceCard ||
    config.card ||
    null;
  if (sourceCard && typeof sourceCard === "object") {
    return sourceCard;
  }
  return null;
}

function getFieldTargetingTotals(contract = {}) {
  const requirements = Array.isArray(contract.requirements)
    ? contract.requirements
    : [];
  return requirements.reduce(
    (totals, req) => {
      const min = Number(req?.min ?? 0);
      const max = Number(req?.max ?? min);
      totals.min += Number.isFinite(min) ? min : 0;
      totals.max += Number.isFinite(max) ? max : 0;
      return totals;
    },
    { min: 0, max: 0 }
  );
}

function isGenericFieldTargetingMessage(message) {
  return Boolean(getGenericFieldTargetingEffectLabel(message));
}

function getGenericFieldTargetingEffectLabel(message) {
  const normalized = String(message || "").trim().toLowerCase();
  const labels = {
    "select target(s) for the monster effect.": {
      en: "monster effect",
      ptBr: "efeito de monstro",
    },
    "select target(s) for the spell effect.": {
      en: "spell effect",
      ptBr: "efeito de Magia",
    },
    "select target(s) for the continuous spell effect.": {
      en: "continuous spell effect",
      ptBr: "efeito de Magia Contínua",
    },
    "select target(s) for the field spell effect.": {
      en: "field spell effect",
      ptBr: "efeito de Magia de Campo",
    },
    "select target(s) for the spell/trap effect.": {
      en: "Spell/Trap effect",
      ptBr: "efeito de Magia/Armadilha",
    },
    "select target(s) for the graveyard effect.": {
      en: "graveyard effect",
      ptBr: "efeito no Cemitério",
    },
    "select target(s) for the graveyard spell effect.": {
      en: "graveyard spell effect",
      ptBr: "efeito de Magia no Cemitério",
    },
    "select target(s) for the triggered effect.": {
      en: "triggered effect",
      ptBr: "efeito disparado",
    },
  };
  return labels[normalized] || null;
}

function shouldPreserveGenericEffectContext(message) {
  const normalized = String(message || "").trim().toLowerCase();
  return normalized.includes("graveyard") || normalized.includes("triggered");
}

function getSourceSpecificEffectLabel(
  config = {},
  fallbackLabel = null,
  message = null
) {
  if (shouldPreserveGenericEffectContext(message)) return fallbackLabel;

  const sourceCard = getFieldTargetingSourceCard(config);
  if (!sourceCard) return fallbackLabel;

  const locale = getLocale();
  const isPtBr = locale === "pt-br";
  if (sourceCard.cardKind === "monster") {
    return isPtBr ? "efeito de monstro" : "monster effect";
  }
  if (sourceCard.cardKind === "spell") {
    if (sourceCard.subtype === "continuous") {
      return isPtBr
        ? `efeito de Magia ${getSelectionLabel("continuous")}`
        : "continuous spell effect";
    }
    if (sourceCard.subtype === "field") {
      return isPtBr ? "efeito de Magia de Campo" : "field spell effect";
    }
    return isPtBr ? "efeito de Magia" : "spell effect";
  }
  if (sourceCard.cardKind === "trap") {
    return isPtBr ? "efeito de Armadilha" : "trap effect";
  }
  return fallbackLabel;
}

function getFieldTargetingPrompt(config = {}) {
  const contract = config.selectionContract || {};
  const explicitMessage =
    config.message || contract.ui?.message || contract.message || null;
  if (explicitMessage && !isGenericFieldTargetingMessage(explicitMessage)) {
    return explicitMessage;
  }

  const sourceName = getFieldTargetingSourceName(config);
  const { min, max } = getFieldTargetingTotals(contract);
  const locale = getLocale();
  const isPtBr = locale === "pt-br";
  const genericEffectLabel = getGenericFieldTargetingEffectLabel(explicitMessage);
  const genericLabel = isPtBr
    ? genericEffectLabel?.ptBr || "efeito"
    : genericEffectLabel?.en || "effect";
  const effectLabel = getSourceSpecificEffectLabel(
    config,
    genericLabel,
    explicitMessage
  );
  const sourceClause = sourceName
    ? isPtBr
      ? ` para o ${effectLabel} de ${sourceName}`
      : ` for ${sourceName}'s ${effectLabel}`
    : isPtBr
    ? ` para o ${effectLabel}`
    : ` for the ${effectLabel}`;

  if (isPtBr) {
    if (max > 0 && min === 0) {
      return `Selecione até ${max} ${max === 1 ? "alvo" : "alvos"}${sourceClause}.`;
    }
    if (min > 0 && min === max) {
      return `Selecione ${min} ${min === 1 ? "alvo" : "alvos"}${sourceClause}.`;
    }
    if (max > 0) {
      return `Selecione entre ${min} e ${max} alvos${sourceClause}.`;
    }
    return `Selecione os alvos${sourceClause}.`;
  }

  if (max > 0 && min === 0) {
    return `Select up to ${max} ${max === 1 ? "target" : "targets"}${sourceClause}.`;
  }
  if (min > 0 && min === max) {
    return `Select ${min} ${min === 1 ? "target" : "targets"}${sourceClause}.`;
  }
  if (max > 0) {
    return `Select ${min}-${max} targets${sourceClause}.`;
  }
  return `Select targets${sourceClause}.`;
}

function getFieldTargetingActionLabels() {
  return {
    cancel: getUIText("ui.common.cancel"),
    confirm: getUIText("ui.common.confirm"),
  };
}

function getRequirementInstruction(req, isChoiceBlock) {
  const min = Number(req?.min ?? 0);
  const max = Number(req?.max ?? min);
  const label = req?.label || req?.id || getUIText("ui.selection.effectLabel");

  if (isChoiceBlock) {
    if (min === 1 && max === 1) {
      return getUIText("ui.selection.chooseOneOption");
    }
    if (min === max) {
      return getUIText("ui.selection.chooseOptionCount", { count: min });
    }
    return getUIText("ui.selection.chooseOptionRange", { min, max });
  }

  if (min === max) {
    return getUIText("ui.selection.chooseTargetCount", { count: min, label });
  }
  return getUIText("ui.selection.chooseTargetRange", { min, max, label });
}

function getSelectionValidationText(req) {
  const min = Number(req?.min ?? 0);
  const max = Number(req?.max ?? min);
  const label = req?.label || req?.id || getUIText("ui.selection.effectLabel");
  if (min === max) {
    return getUIText("ui.selection.selectTargetCount", {
      count: min,
      label,
    });
  }
  return getUIText("ui.selection.selectTargetRange", { min, max, label });
}

function getFieldTargetingHost() {
  return document.getElementById("game-container") || document.body;
}

function getHostRect(host) {
  if (host === document.body) {
    return {
      top: 0,
      left: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }
  return host.getBoundingClientRect();
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getHandTargetElements(selectionContract = {}) {
  const requirements = Array.isArray(selectionContract.requirements)
    ? selectionContract.requirements
    : [];
  const elements = [];
  requirements.forEach((req) => {
    (req.candidates || []).forEach((cand) => {
      if (cand?.zone !== "hand") return;
      const owner = cand.controller === "bot" ? "bot" : "player";
      const container = document.getElementById(`${owner}-hand`);
      if (!container || typeof cand.zoneIndex !== "number") return;
      const cardEl = container.querySelector(
        `.card[data-index="${cand.zoneIndex}"]`
      );
      if (cardEl) elements.push(cardEl);
    });
  });
  return elements;
}

function getTopMostRect(elements = []) {
  let top = Infinity;
  elements.forEach((el) => {
    const rect = el?.getBoundingClientRect?.();
    if (!rect) return;
    top = Math.min(top, rect.top);
  });
  return Number.isFinite(top) ? top : null;
}

function positionFieldTargetingControls(bar, host, config = {}) {
  if (!bar || !host) return;
  const hostRect = getHostRect(host);
  bar.style.bottom = "auto";
  const spellTrap = document.getElementById("player-spelltrap");
  const hand = document.getElementById("player-hand");
  const anchor = spellTrap || document.querySelector("#player-area .board-core");

  const anchorRect = anchor?.getBoundingClientRect();
  const anchorCenterX = anchorRect
    ? anchorRect.left + anchorRect.width / 2 - hostRect.left
    : hostRect.width / 2;
  const halfWidth = bar.offsetWidth / 2;
  const minLeft = Math.min(hostRect.width / 2, halfWidth + 8);
  const maxLeft = Math.max(minLeft, hostRect.width - halfWidth - 8);
  bar.style.left = `${Math.round(
    clampNumber(anchorCenterX, minLeft, maxLeft)
  )}px`;

  let top = hostRect.height - bar.offsetHeight - 24;
  if (spellTrap && hand) {
    const spellTrapRect = spellTrap.getBoundingClientRect();
    const handRect = hand.getBoundingClientRect();
    const midpoint = (spellTrapRect.bottom + handRect.top) / 2;
    top = midpoint - hostRect.top - bar.offsetHeight / 2;
  }

  const handTargetTop = getTopMostRect(
    getHandTargetElements(config.selectionContract)
  );
  if (handTargetTop !== null) {
    const gap = 10;
    const maxTopAboveHand = handTargetTop - hostRect.top - bar.offsetHeight - gap;
    top = Math.min(top, maxTopAboveHand);
  }

  const maxTop = Math.max(12, hostRect.height - bar.offsetHeight - 12);
  bar.style.top = `${Math.round(clampNumber(top, 12, maxTop))}px`;
}

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

  // Check if this is a choice modal
  const isChoiceModal =
    contract.kind === "choice" ||
    requirements.some((req) =>
      req.candidates?.some((c) => c.zone === "choice")
    );

  const content = document.createElement("div");
  content.className = isChoiceModal
    ? "modal-content target-content target-content-choice"
    : "modal-content target-content";
  const titleText = contract.message
    ? getFieldTargetingPrompt({ ...config, selectionContract: contract })
    : isChoiceModal
      ? getUIText("ui.selection.chooseOneOption")
      : getUIText("ui.selection.selectTargets");

  const closeMarker = document.createElement("span");
  closeMarker.className = "close-target";
  closeMarker.textContent = allowCancel ? "×" : "";
  content.appendChild(closeMarker);

  const title = document.createElement("h2");
  title.textContent = titleText;
  content.appendChild(title);

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

    // Check if this is a choice-based selection
    const isChoiceBlock = req.candidates?.some((c) => c.zone === "choice");
    if (isChoiceBlock) {
      block.classList.add("target-block-choice");
    }

    const hideRequirementLine =
      isChoiceBlock && requirements.length === 1 && min === 1 && max === 1;
    if (!hideRequirementLine) {
      const instruction = document.createElement("p");
      instruction.textContent = getRequirementInstruction(req, isChoiceBlock);
      block.appendChild(instruction);
    }

    const counter = document.createElement("div");
    counter.className = "target-counter";
    counter.textContent = `0 / ${max}`;
    counterById.set(req.id, counter);

    const list = document.createElement("div");
    list.className = isChoiceBlock
      ? "target-list target-list-choice"
      : "target-list";

    req.candidates.forEach((cand, candIndex) => {
      const btn = document.createElement("button");
      btn.className = "target-btn";
      btn.dataset.targetId = req.id;
      const selectionKey = cand.key || `${req.id}_${candIndex}`;
      btn.dataset.key = selectionKey;
      const isChoiceCandidate = cand.zone === "choice";
      if (isChoiceCandidate) {
        btn.classList.add("target-btn-choice");
      }

      // Create card visual
      const targetCard = cand.cardRef || cand;
      const displayName =
        getCardDisplayName(targetCard) ||
        (targetCard?.name && targetCard.name) ||
        cand.name ||
        getUIText("ui.selection.cardFallback");

      if (isChoiceCandidate) {
        // Compact choice layout (no card image)
        const choiceHeader = document.createElement("div");
        choiceHeader.className = "choice-header";
        choiceHeader.textContent = targetCard.label || displayName;

        btn.appendChild(choiceHeader);

        if (targetCard?.description) {
          const descDiv = document.createElement("div");
          descDiv.className = "choice-desc";
          descDiv.textContent = targetCard.description;
          btn.appendChild(descDiv);
        }
      } else {
        btn.classList.add(
          "selection-card-candidate",
          getSelectionCardTypeClass(targetCard),
        );
        btn.appendChild(renderCompactSelectionCard(targetCard, cand));
      }

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
  confirmBtn.textContent = getUIText("ui.common.confirm");
  if (allowCancel) {
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = getUIText("ui.common.cancel");
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
        alert(getSelectionValidationText(req));
        return;
      }
      if (selected.length > maxSel) {
        alert(getSelectionValidationText(req));
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
  const promptText = getFieldTargetingPrompt(config);
  const labels = getFieldTargetingActionLabels();
  const host = getFieldTargetingHost();
  const usesBodyHost = host === document.body;

  const bar = document.createElement("div");
  bar.className = "field-targeting-controls";
  bar.style.position = usesBodyHost ? "fixed" : "absolute";
  bar.style.left = "50%";
  bar.style.top = "auto";
  bar.style.bottom = usesBodyHost ? "24px" : "auto";
  bar.style.transform = "translateX(-50%)";
  bar.style.display = "flex";
  bar.style.flexDirection = "column";
  bar.style.gap = "8px";
  bar.style.padding = "12px 16px";
  bar.style.background = "rgba(16, 18, 28, 0.92)";
  bar.style.borderRadius = "12px";
  bar.style.boxShadow = "0 8px 24px rgba(0,0,0,0.35)";
  bar.style.zIndex = "3000";
  bar.style.alignItems = "stretch";
  bar.style.width = usesBodyHost
    ? "min(520px, calc(100vw - 32px))"
    : "min(520px, calc(100% - 32px))";
  bar.style.visibility = "hidden";

  const prompt = document.createElement("div");
  prompt.className = "field-targeting-prompt";
  prompt.textContent = promptText;
  bar.appendChild(prompt);

  const actions = document.createElement("div");
  actions.className = "field-targeting-actions";

  const counter = document.createElement("div");
  counter.className = "field-targeting-counter";
  counter.textContent = "0 / 0";

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = labels.confirm;
  confirmBtn.className = "primary";
  confirmBtn.onclick = () => {
    if (typeof onConfirm === "function") onConfirm();
  };

  if (allowCancel) {
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = labels.cancel;
    cancelBtn.className = "secondary";
    cancelBtn.onclick = () => {
      if (typeof onCancel === "function") onCancel();
      this.hideFieldTargetingControls();
    };
    actions.appendChild(cancelBtn);
  }

  actions.appendChild(counter);
  actions.appendChild(confirmBtn);
  bar.appendChild(actions);
  host.appendChild(bar);

  const reposition = () => positionFieldTargetingControls(bar, host, config);
  const scheduleReposition = () => {
    const raf =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : (callback) => window.setTimeout(callback, 0);
    raf(reposition);
    window.setTimeout(reposition, 220);
  };
  window.addEventListener("resize", reposition);
  document.addEventListener("pointerover", scheduleReposition, true);
  document.addEventListener("pointerout", scheduleReposition, true);
  bar.__fieldTargetingCleanup = () => {
    window.removeEventListener("resize", reposition);
    document.removeEventListener("pointerover", scheduleReposition, true);
    document.removeEventListener("pointerout", scheduleReposition, true);
  };

  const updateState = ({ selected = 0, min = 0, max = 0, allowEmpty }) => {
    const requiredMin = allowEmpty ? 0 : min;
    counter.textContent = `${selected} / ${max || "-"}`;
    confirmBtn.disabled = selected < requiredMin || (max > 0 && selected > max);
  };

  updateState({ selected: 0, min: 0, max: 0, allowEmpty: true });
  reposition();
  bar.style.visibility = "";

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
    if (typeof existing.__fieldTargetingCleanup === "function") {
      existing.__fieldTargetingCleanup();
    }
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
  title.textContent = getUIText("ui.prompts.destructionNegationTitle", {
    cardName,
  });

  const desc = document.createElement("p");
  desc.innerHTML = costDescription
    ? getUIText("ui.prompts.costLine", { costDescription }).replace(
        /\n/g,
        "<br>",
      )
    : "";

  const actions = document.createElement("div");
  actions.className = "target-actions";

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = getUIText("ui.common.yes");
  confirmBtn.className = "primary";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = getUIText("ui.common.no");
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
  title.textContent = getUIText("ui.fusion.selectMonsterTitle");
  title.style.color = "#8b00ff";

  const hint = document.createElement("p");
  hint.textContent = getUIText("ui.fusion.selectMonsterHint");
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
  cancelBtn.textContent = getUIText("ui.common.cancel");
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
  title.textContent = getUIText("ui.fusion.selectMaterialsTitle");
  title.style.color = "#8b00ff";

  const hint = document.createElement("p");
  hint.className = "fusion-hint";
  hint.innerHTML = `${getUIText("ui.fusion.selectMaterialsHint")}<br>`;
  requirements.forEach((req) => {
    const count = req.count || 1;
    const desc =
      req.name ||
      req.archetype ||
      req.type ||
      req.attribute ||
      getUIText("ui.fusion.monsterFallback");
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
  cancelBtn.textContent = getUIText("ui.common.cancel");
  cancelBtn.className = "secondary";
  cancelBtn.onclick = () => {
    document.body.removeChild(overlay);
    onCancel && onCancel();
  };

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = getUIText("ui.common.confirm");
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
    title = getUIText("ui.cardGrid.selectCards"),
    subtitle = "",
    cards = [],
    minSelect = 0,
    maxSelect = cards.length || 1,
    confirmLabel = getUIText("ui.common.confirm"),
    cancelLabel = getUIText("ui.common.cancel"),
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
    cardEl.className = [
      cardClass,
      "selection-card-candidate",
      getSelectionCardTypeClass(card),
    ].join(" ");
    cardEl.appendChild(renderCompactSelectionCard(card));

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
    getUIText("ui.ignition.titleFallback");
  title.textContent = titleText;
  title.classList.add("modal-title");

  const desc = document.createElement("p");
  desc.textContent = getUIText("ui.ignition.prompt");
  desc.classList.add("modal-text");

  const actions = document.createElement("div");
  actions.classList.add("modal-actions");

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = getUIText("ui.common.cancel");
  cancelBtn.classList.add("secondary");
  const activateBtn = document.createElement("button");
  activateBtn.textContent = getUIText("ui.common.activate");

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
    title: getUIText("ui.shadowHeartCathedral.title"),
    subtitle: getUIText("ui.shadowHeartCathedral.subtitle", {
      maxAtk,
      counterCount,
    }),
    cards: validMonsters,
    minSelect: 1,
    maxSelect: 1,
    confirmLabel: getUIText("ui.common.confirm"),
    cancelLabel: getUIText("ui.common.cancel"),
    overlayClass: "cathedral-overlay",
    modalClass: "cathedral-modal",
    gridClass: "cathedral-grid",
    cardClass: "cathedral-card",
    infoText: getUIText("ui.shadowHeartCathedral.info"),
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
        cardName.textContent = getCardDisplayName(monster) || monster.name;
        cardName.classList.add("cathedral-card-name");
        cardName.style.fontSize = "15px";
        cardName.style.fontWeight = "bold";
        cardName.style.lineHeight = "1.3";

        const cardStats = document.createElement("div");
        cardStats.textContent = `ATK ${monster.atk || 0} / DEF ${
          monster.def || 0
        } / ${getUIText("ui.shadowHeartCathedral.level")} ${
          monster.level || 0
        }`;
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
    title: getUIText("ui.luminarchSickle.title"),
    subtitle: getUIText("ui.luminarchSickle.subtitle", { maxSelect }),
    cards: candidates,
    minSelect: 0,
    maxSelect,
    confirmLabel: getUIText("ui.common.addToHand"),
    cancelLabel: getUIText("ui.common.cancel"),
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
      name.textContent = `${getCardDisplayName(card) || card.name} (${stats})`;
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
    title = getUIText("ui.cardGrid.chooseSurvivor"),
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
      getCardDisplayName(card) ||
      (card?.name && card.name) ||
      getUIText("ui.selection.cardFallback");
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
    confirmLabel: getUIText("ui.common.confirm"),
    cancelLabel: getUIText("ui.common.cancel"),
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
    title = getUIText("ui.cardGrid.selectCards"),
    subtitle = "",
    infoText = "",
    confirmLabel = getUIText("ui.common.confirm"),
    cancelLabel = getUIText("ui.common.cancel"),
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
