/**
 * Base modal methods for Renderer
 * Handles: toggleModal, toggleExtraDeckModal, showConfirmPrompt, showNumberPrompt, showAlert,
 * getSearchModalElements, showSearchModal, showSearchModalVisual
 */

import { getCardDisplayName, getLocale } from "../../core/i18n.js";
import {
  getSelectionCardTypeClass,
  renderCompactSelectionCard,
} from "./selectionModals.js";

let activeConfirmPrompt = null;
let activeDuelStartAnnouncement = null;

const GAME_OVER_COPY = {
  en: {
    victoryTitle: "Victory",
    defeatTitle: "Defeat",
    drawTitle: "Draw",
    victoryMessage: "You won the duel.",
    defeatMessage: "You lost the duel.",
    drawMessage: "The duel ended in a draw.",
    playerLabel: "You:",
    opponentLabel: "Opponent:",
    turnsLabel: "Turns:",
    rematch: "Rematch",
    menu: "Main Menu",
    exportReplay: "Export Replay",
    exported: "Exported",
    exportTitle: "Export this duel replay",
    reportReady: "Replay available",
    reportExported: "Replay exported",
  },
  "pt-br": {
    victoryTitle: "Vitória",
    defeatTitle: "Derrota",
    drawTitle: "Empate",
    victoryMessage: "Você venceu o duelo.",
    defeatMessage: "Você perdeu o duelo.",
    drawMessage: "O duelo terminou empatado.",
    playerLabel: "Você:",
    opponentLabel: "Oponente:",
    turnsLabel: "Turnos:",
    rematch: "Revanche",
    menu: "Menu Principal",
    exportReplay: "Exportar Replay",
    exported: "Exportado",
    exportTitle: "Exportar replay deste duelo",
    reportReady: "Replay disponível",
    reportExported: "Replay exportado",
  },
};

function getGameOverCopy() {
  return GAME_OVER_COPY[getLocale()] || GAME_OVER_COPY.en;
}

function getGameOverResult(options = {}) {
  const explicitResult = String(
    options.result || options.outcome || options.state || "",
  ).toLowerCase();
  if (["victory", "win", "player"].includes(explicitResult)) return "victory";
  if (["defeat", "loss", "bot"].includes(explicitResult)) return "defeat";
  if (["draw", "tie"].includes(explicitResult)) return "draw";

  const winner = String(options.winner || options.strategicReportInfo?.winner || "").toLowerCase();
  if (winner === "player") return "victory";
  if (winner === "bot") return "defeat";
  if (winner === "draw") return "draw";
  if (options.draw === true) return "draw";
  return options.victory ? "victory" : "defeat";
}

function formatLifePoints(value) {
  const amount = Number(value ?? 0);
  return `${Number.isFinite(amount) ? amount : 0} PV`;
}

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
  if (typeof document === "undefined" || !document.body) {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      return window.confirm(message);
    }
    return false;
  }

  if (activeConfirmPrompt) {
    const previousPrompt = activeConfirmPrompt;
    activeConfirmPrompt = null;
    if (typeof previousPrompt.resolve === "function") {
      previousPrompt.resolve(false);
    }
    if (typeof previousPrompt.cleanup === "function") {
      previousPrompt.cleanup();
    }
  }

  const confirmLabel = options.confirmLabel || "OK";
  const cancelLabel = options.cancelLabel || "Cancel";
  const title = options.title || "Confirm";
  const detailText = String(message);

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal confirm-modal";

    const content = document.createElement("div");
    content.className = "modal-content confirm-modal-content";

    const header = document.createElement("div");
    header.className = "confirm-modal-header";

    const titleEl = document.createElement("div");
    titleEl.className = "confirm-modal-title";
    titleEl.textContent = title;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "confirm-modal-close";
    closeBtn.textContent = "x";

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    const messageEl = document.createElement("div");
    messageEl.className = "confirm-modal-message";
    messageEl.textContent = detailText;

    const actions = document.createElement("div");
    actions.className = "confirm-modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "secondary";
    cancelBtn.textContent = cancelLabel;

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "primary";
    confirmBtn.textContent = confirmLabel;

    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);

    content.appendChild(header);
    content.appendChild(messageEl);
    content.appendChild(actions);
    overlay.appendChild(content);
    document.body.appendChild(overlay);

    let resolved = false;
    const cleanup = () => {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    };

    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      document.removeEventListener("keydown", onKeyDown);
      cleanup();
      if (activeConfirmPrompt && activeConfirmPrompt.overlay === overlay) {
        activeConfirmPrompt = null;
      }
      resolve(value);
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        finish(false);
      }
      if (event.key === "Enter") {
        finish(true);
      }
    };

    activeConfirmPrompt = {
      overlay,
      resolve: finish,
      cleanup,
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        finish(false);
      }
    });

    cancelBtn.addEventListener("click", () => finish(false));
    confirmBtn.addEventListener("click", () => finish(true));
    closeBtn.addEventListener("click", () => finish(false));
    document.addEventListener("keydown", onKeyDown);
    confirmBtn.focus();
  });
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
 * Shows a brief, non-interactive duel start announcement.
 * @this {import('../Renderer.js').default}
 */
export function showDuelStartAnnouncement(message, options = {}) {
  if (!message) return Promise.resolve(false);
  if (typeof document === "undefined" || !document.body) {
    return Promise.resolve(false);
  }

  if (activeDuelStartAnnouncement?.cleanup) {
    activeDuelStartAnnouncement.cleanup();
  }

  const durationMs = Number.isFinite(options.durationMs)
    ? Math.max(0, options.durationMs)
    : 1200;

  return new Promise((resolve) => {
    const requestFrame =
      typeof globalThis.requestAnimationFrame === "function"
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : (callback) => globalThis.setTimeout(callback, 0);
    const overlay = document.createElement("div");
    overlay.className = "duel-start-announcement";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");

    const panel = document.createElement("div");
    panel.className = "duel-start-announcement-panel";
    panel.textContent = String(message);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    let resolved = false;
    let hideTimer = null;
    let cleanupTimer = null;

    const cleanup = () => {
      globalThis.clearTimeout(hideTimer);
      globalThis.clearTimeout(cleanupTimer);
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      if (activeDuelStartAnnouncement?.overlay === overlay) {
        activeDuelStartAnnouncement = null;
      }
      if (!resolved) {
        resolved = true;
        resolve(true);
      }
    };

    activeDuelStartAnnouncement = { overlay, cleanup };

    requestFrame(() => {
      overlay.classList.add("visible");
    });

    hideTimer = globalThis.setTimeout(() => {
      overlay.classList.remove("visible");
      cleanupTimer = globalThis.setTimeout(cleanup, 180);
    }, durationMs);
  });
}

/**
 * Shows the game over modal with stats and options.
 * @this {import('../Renderer.js').default}
 * @param {Object} options - Game over options
 * @param {boolean} options.victory - Whether player won
 * @param {number} options.playerLP - Player's final LP
 * @param {number} options.botLP - Bot's final LP
 * @param {number} options.turns - Number of turns
 * @param {boolean} options.strategicReportAvailable - Whether Strategic JSON can be exported
 * @param {Object} options.strategicReportInfo - Compact report info
 * @param {Function} options.onMenu - Callback for menu button
 * @param {Function} options.onRematch - Callback for rematch button
 * @param {Function} options.onExportStrategicReport - Callback for Strategic JSON export
 */
export function showGameOverModal(options = {}) {
  const modal = document.getElementById("game-over-modal");
  const panel = modal?.querySelector(".game-over-panel");
  const title = document.getElementById("game-over-title");
  const message = document.getElementById("game-over-message");
  const playerLabel = document.getElementById("game-over-player-label");
  const botLabel = document.getElementById("game-over-bot-label");
  const turnsLabel = document.getElementById("game-over-turns-label");
  const playerLP = document.getElementById("game-over-player-lp");
  const botLP = document.getElementById("game-over-bot-lp");
  const turns = document.getElementById("game-over-turns");
  const menuBtn = document.getElementById("btn-game-over-menu");
  const rematchBtn = document.getElementById("btn-game-over-rematch");
  const exportBtn = document.getElementById("btn-game-over-export");
  const replayStatus = document.getElementById("game-over-replay-status");

  if (!modal) return;

  if (options.victory) {
    title.textContent = "Victory";
    title.className = "victory";
    message.textContent = "Você venceu o duelo!";
  } else {
    title.textContent = "Defeat";
    title.className = "defeat";
    message.textContent = "Você perdeu o duelo.";
  }

  playerLP.textContent = options.playerLP ?? 0;
  botLP.textContent = options.botLP ?? 0;
  turns.textContent = options.turns ?? 0;

  const result = getGameOverResult(options);
  const copy = getGameOverCopy();
  const titleKey = `${result}Title`;
  const messageKey = `${result}Message`;

  panel?.classList.remove("result-victory", "result-defeat", "result-draw");
  panel?.classList.add(`result-${result}`);
  title.textContent = copy[titleKey] || copy.defeatTitle;
  title.className = result;
  message.textContent = copy[messageKey] || copy.defeatMessage;

  if (playerLabel) playerLabel.textContent = copy.playerLabel;
  if (botLabel) botLabel.textContent = copy.opponentLabel;
  if (turnsLabel) turnsLabel.textContent = copy.turnsLabel;
  playerLP.textContent = formatLifePoints(options.playerLP);
  botLP.textContent = formatLifePoints(options.botLP);
  menuBtn.textContent = copy.menu;
  rematchBtn.textContent = copy.rematch;
  exportBtn.title = copy.exportTitle;

  const discardBtn = document.getElementById("btn-game-over-discard");
  if (discardBtn) {
    discardBtn.classList.add("hidden");
    discardBtn.onclick = null;
  }

  const hasStrategicReport =
    options.strategicReportAvailable === true &&
    typeof options.onExportStrategicReport === "function";

  if (hasStrategicReport) {
    exportBtn.textContent = copy.exportReplay;
    exportBtn.disabled = false;
    exportBtn.classList.remove("exported", "hidden");
    replayStatus.textContent = copy.reportReady;
    replayStatus.classList.remove("hidden");
  } else {
    exportBtn.disabled = true;
    exportBtn.classList.remove("exported");
    exportBtn.classList.add("hidden");
    replayStatus.classList.add("hidden");
    if (options.strategicReportAvailable !== undefined) {
      console.warn(
        "[StrategicReport] Game over export button hidden: no exportable report.",
      );
    }
  }

  const cleanup = () => {
    modal.classList.add("hidden");
    menuBtn.onclick = null;
    rematchBtn.onclick = null;
    exportBtn.onclick = null;
    if (discardBtn) discardBtn.onclick = null;
  };

  menuBtn.onclick = () => {
    cleanup();
    if (typeof options.onMenu === "function") options.onMenu();
  };

  rematchBtn.onclick = () => {
    cleanup();
    if (typeof options.onRematch === "function") options.onRematch();
  };

  exportBtn.onclick = () => {
    if (!hasStrategicReport) return;
    const result = options.onExportStrategicReport();
    if (result) {
      exportBtn.textContent = copy.exported;
      exportBtn.classList.add("exported");
      replayStatus.textContent = copy.reportExported;
    }
  };

  modal.classList.remove("hidden");
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

    const cardBtn = document.createElement("button");
    cardBtn.className = [
      "search-card-btn",
      "selection-card-candidate",
      getSelectionCardTypeClass(card),
    ].join(" ");
    if (selectedCard && card.name === selectedCard.name) {
      cardBtn.classList.add("selected");
    }
    cardBtn.appendChild(renderCompactSelectionCard(card));

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
