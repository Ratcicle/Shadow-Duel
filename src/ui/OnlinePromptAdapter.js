/**
 * OnlinePromptAdapter.js
 *
 * Adapts server prompts to use the same visual modals as offline mode.
 * Wraps callback-based Renderer modals with Promise-based API for linear async flow.
 *
 * Philosophy:
 * - Online experience should mirror offline experience
 * - No generic index-based prompts; use visual modals
 * - Fallback to generic prompt for unsupported types (with cancel option to prevent soft-locks)
 * - Generic, flexible design for future additions (chains, traps, etc.)
 */

import { getCardDisplayName } from "../core/i18n.js";
import { cardDatabaseById } from "../data/cards.js";

// ============================================================================
// Constants & Mappings
// ============================================================================

/**
 * Maps Renderer modal choices back to server option IDs
 * Extensible: add new mappings as new modal types are supported
 */
const MODAL_CHOICE_TO_OPTION = {
  // Monster summon modal choices
  attack: "normal_summon",
  defense: "set_monster",

  // Spell/trap modal choices
  set: "set_spelltrap",
  activate: "activate_spell",

  // Field monster modal choices
  activate_effect: "activate_effect",
  switch: "switch",
  to_attack: "switch",
  to_defense: "switch",
  flip: "flip",
  ascension_summon: "ascension_summon",

  // Special summon choices
  special_from_aegisbearer: "special_from_aegisbearer",
  special_from_void_forgotten: "special_from_void_forgotten",
  special_from_hand_effect: "special_from_hand_effect",

  // Common
  cancel: "cancel",
};

/**
 * Prompt types that have visual modal support
 */
const SUPPORTED_PROMPT_TYPES = new Set([
  "card_action_menu",
  "target_select",
  "selection_contract",
  "card_select", // B2: Search do deck/gy
  // Future: "chain_window"
]);

// ============================================================================
// Promise Wrappers for Renderer Modals
// ============================================================================

/**
 * Promise wrapper for Renderer.showSummonModal
 * @param {Renderer} renderer
 * @param {number} cardIndex
 * @param {Object} options
 * @returns {Promise<string>} Modal choice
 */
export function showSummonModalAsync(renderer, cardIndex, options = {}) {
  return new Promise((resolve) => {
    let resolved = false;
    let observer = null;

    const safeResolve = (choice) => {
      if (!resolved) {
        resolved = true;
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        resolve(choice);
      }
    };

    try {
      renderer.showSummonModal(
        cardIndex,
        (choice) => safeResolve(choice || "cancel"),
        options
      );
      observer = observeModalRemoval(
        ".summon-choice-modal",
        () => safeResolve("cancel")
      );
    } catch (error) {
      console.error("[OnlinePromptAdapter] showSummonModal error", error);
      safeResolve("cancel");
    }
  });
}

/**
 * Promise wrapper for Renderer.showSpellChoiceModal
 * @param {Renderer} renderer
 * @param {number} cardIndex
 * @param {Object} options
 * @returns {Promise<string>} Modal choice
 */
export function showSpellChoiceModalAsync(renderer, cardIndex, options = {}) {
  return new Promise((resolve) => {
    let resolved = false;
    let observer = null;

    const safeResolve = (choice) => {
      if (!resolved) {
        resolved = true;
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        resolve(choice);
      }
    };

    try {
      renderer.showSpellChoiceModal(
        cardIndex,
        (choice) => safeResolve(choice || "cancel"),
        options
      );
      observer = observeModalRemoval(
        ".spell-choice-modal",
        () => safeResolve("cancel")
      );
    } catch (error) {
      console.error("[OnlinePromptAdapter] showSpellChoiceModal error", error);
      safeResolve("cancel");
    }
  });
}

/**
 * Promise wrapper for Renderer.showPositionChoiceModal
 * @param {Renderer} renderer
 * @param {HTMLElement} cardEl
 * @param {Object} card
 * @param {Object} options
 * @returns {Promise<string>} Modal choice
 */
export function showPositionChoiceModalAsync(
  renderer,
  cardEl,
  card,
  options = {}
) {
  return new Promise((resolve) => {
    let resolved = false;
    let observer = null;

    const safeResolve = (choice) => {
      if (!resolved) {
        resolved = true;
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        resolve(choice);
      }
    };

    // Wrap effect/ascension callbacks to resolve promise
    const wrappedOptions = { ...options };

    if (options.hasIgnitionEffect) {
      wrappedOptions.onActivateEffect = () => safeResolve("activate_effect");
    }

    if (options.hasAscensionSummon) {
      wrappedOptions.onAscensionSummon = () => safeResolve("ascension_summon");
    }

    try {
      renderer.showPositionChoiceModal(
        cardEl,
        card,
        (choice) => safeResolve(choice || "cancel"),
        wrappedOptions
      );
      observer = observeModalRemoval(
        ".position-choice-modal",
        () => safeResolve("cancel")
      );
    } catch (error) {
      console.error(
        "[OnlinePromptAdapter] showPositionChoiceModal error",
        error
      );
      safeResolve("cancel");
    }
  });
}

function observeModalRemoval(selector, onClose) {
  if (typeof document === "undefined") {
    return null;
  }
  const modal = document.querySelector(selector);
  if (!modal || !document.body) {
    return null;
  }
  const observer = new MutationObserver(() => {
    if (!document.body.contains(modal)) {
      observer.disconnect();
      onClose();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}

/**
 * Visual target selection for attacks and effects
 * Mirrors offline behavior: highlight targets, select by clicking, confirm to execute
 * @param {Renderer} renderer - Renderer instance
 * @param {Object} prompt - Server prompt with targets array
 * @returns {Promise<Object>} Selected target option or null for cancel
 */
export function showTargetSelectionAsync(renderer, prompt) {
  return new Promise((resolve) => {
    let resolved = false;
    let selectedTarget = null;
    const cleanup = [];

    // Block intent clicks while selection is active
    if (typeof window.setOnlineSelectionActive === "function") {
      window.setOnlineSelectionActive(true);
    }

    const safeResolve = (result) => {
      if (!resolved) {
        resolved = true;
        // Unblock intent clicks
        if (typeof window.setOnlineSelectionActive === "function") {
          window.setOnlineSelectionActive(false);
        }
        // Cleanup all event listeners and highlights
        cleanup.forEach((fn) => fn());
        renderer.clearTargetHighlights();
        resolve(result);
      }
    };

    const updateHighlights = () => {
      // Re-apply highlights with selected state
      const targets = prompt.targets || [];
      const nonCancelTargets = targets.filter((t) => t.id !== "cancel");

      const highlightTargets = nonCancelTargets.map((target) => {
        const isSelected = selectedTarget?.id === target.id;
        if (target.id === "direct") {
          return {
            isDirectAttack: true,
            isAttackTarget: true,
            isSelected,
          };
        }
        return {
          zone: "field",
          controller: "bot",
          zoneIndex: target.id,
          isAttackTarget: true,
          isSelected,
        };
      });

      renderer.applyTargetHighlights({ targets: highlightTargets });
    };

    const updateControls = (controls) => {
      if (controls?.updateState) {
        controls.updateState({
          selected: selectedTarget ? 1 : 0,
          min: 1,
          max: 1,
          allowEmpty: false,
        });
      }
    };

    try {
      const targets = prompt.targets || [];
      const nonCancelTargets = targets.filter((t) => t.id !== "cancel");

      // If no targets, resolve with cancel immediately
      if (nonCancelTargets.length === 0) {
        safeResolve(null);
        return;
      }

      // Initial highlights
      updateHighlights();

      // Show targeting controls (Cancel / counter / Confirm) like offline mode
      const controls = renderer.showFieldTargetingControls(
        // onConfirm
        () => {
          if (selectedTarget) {
            console.log(
              "[OnlinePromptAdapter] Target confirmed:",
              selectedTarget
            );
            safeResolve(selectedTarget);
          }
        },
        // onCancel
        () => {
          console.log(
            "[OnlinePromptAdapter] Target selection cancelled via Cancel"
          );
          safeResolve(null);
        },
        { allowCancel: true }
      );
      cleanup.push(() => controls?.close?.());

      // Initial state - nothing selected
      updateControls(controls);

      // Create click handlers for each target
      nonCancelTargets.forEach((target) => {
        let targetEl = null;

        if (target.id === "direct") {
          targetEl = document.getElementById("bot-hand");
        } else {
          const botField = document.getElementById("bot-field");
          if (botField) {
            targetEl = botField.querySelector(
              `.card[data-index="${target.id}"]`
            );
          }
        }

        if (targetEl) {
          const clickHandler = (e) => {
            e.stopPropagation();
            // Toggle selection
            if (selectedTarget?.id === target.id) {
              selectedTarget = null; // Deselect
            } else {
              selectedTarget = target; // Select
            }
            console.log(
              "[OnlinePromptAdapter] Target clicked:",
              target,
              "Selected:",
              selectedTarget
            );
            updateHighlights();
            updateControls(controls);
          };

          targetEl.addEventListener("click", clickHandler);
          cleanup.push(() =>
            targetEl.removeEventListener("click", clickHandler)
          );
        }
      });

      // Add escape key handler for cancel
      const escHandler = (e) => {
        if (e.key === "Escape") {
          console.log(
            "[OnlinePromptAdapter] Target selection cancelled via ESC"
          );
          safeResolve(null);
        }
      };
      document.addEventListener("keydown", escHandler);
      cleanup.push(() => document.removeEventListener("keydown", escHandler));
    } catch (error) {
      console.error(
        "[OnlinePromptAdapter] showTargetSelectionAsync error",
        error
      );
      safeResolve(null);
    }
  });
}

/**
 * B2: Card selection for search (deck/gy/banish)
 * Shows a list modal with card options and allows selection
 * @param {Renderer} renderer - Renderer instance
 * @param {Object} prompt - Server prompt with card_select type
 * @returns {Promise<string|Array|null>} Selected card ID(s) or null for cancel
 */
export function showCardSelectAsync(renderer, prompt) {
  return new Promise((resolve) => {
    let resolved = false;

    const requirement = prompt.requirement || {};
    const candidates = Array.isArray(requirement.candidates)
      ? requirement.candidates
      : [];
    const min = requirement.min ?? 1;
    const max = requirement.max ?? 1;
    const title = prompt.title || "Select card(s)";

    console.log("[OnlinePromptAdapter] showCardSelectAsync", {
      title,
      candidateCount: candidates.length,
      min,
      max,
    });

    const safeResolve = (result) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    if (candidates.length === 0) {
      console.warn("[OnlinePromptAdapter] No candidates for card selection");
      safeResolve(null);
      return;
    }

    const searchModal = renderer?.getSearchModalElements?.();
    const canUseVisualModal =
      max === 1 &&
      searchModal &&
      typeof renderer?.showSearchModalVisual === "function";

    if (canUseVisualModal) {
      const visualCandidates = candidates.map((cand, idx) => {
        const dbCard =
          cand.cardId !== undefined && cand.cardId !== null
            ? cardDatabaseById.get(cand.cardId)
            : null;
        const candidateId = cand.id ?? cand.key ?? String(idx);
        const displayName =
          getCardDisplayName(dbCard || cand) ||
          cand.label ||
          cand.name ||
          `Card ${idx + 1}`;

        return {
          id: dbCard?.id ?? cand.cardId ?? candidateId,
          name: displayName,
          cardKind: cand.cardKind ?? dbCard?.cardKind ?? null,
          type: dbCard?.type ?? cand.type ?? dbCard?.subtype ?? null,
          atk: cand.atk ?? dbCard?.atk ?? null,
          def: cand.def ?? dbCard?.def ?? null,
          level: cand.level ?? dbCard?.level ?? null,
          description: dbCard?.description ?? cand.description ?? "",
          image:
            typeof dbCard?.image === "string"
              ? dbCard.image
              : cand.image || null,
          _candidateId: candidateId,
        };
      });

      const defaultCardName = visualCandidates[0]?.name || "";

      renderer.showSearchModalVisual(
        searchModal,
        visualCandidates,
        defaultCardName,
        (selectedName, selectedCard) => {
          const chosen =
            selectedCard ||
            visualCandidates.find((card) => card && card.name === selectedName);

          if (!chosen) {
            console.warn(
              "[OnlinePromptAdapter] No matching candidate for selected card",
              { selectedName, selectedCard }
            );
            safeResolve(null);
            return;
          }

          const choiceId = chosen._candidateId;
          if (!choiceId) {
            console.warn(
              "[OnlinePromptAdapter] Missing candidate id for selection",
              { chosen }
            );
            safeResolve(null);
            return;
          }

          console.log("[OnlinePromptAdapter] Visual modal selection confirmed:", {
            choiceId,
            chosenName: chosen.name,
            chosenCardId: chosen.id,
          });

          safeResolve([choiceId]);
        }
      );

      return;
    }

    // Fallback: lightweight overlay (multi-select or missing offline modal)
    const overlay = document.createElement("div");
    overlay.className = "online-prompt-overlay card-select-overlay";
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
    `;

    const modal = document.createElement("div");
    modal.className = "online-prompt-modal card-select-modal";
    modal.style.cssText = `
      background: #1a1a2e;
      border: 2px solid #4a9eff;
      border-radius: 8px;
      padding: 20px;
      max-width: 600px;
      max-height: 80vh;
      overflow-y: auto;
      color: white;
    `;

    const selectedIds = new Set();

    const titleEl = document.createElement("h2");
    titleEl.textContent = title;
    titleEl.style.cssText = `
      margin: 0 0 15px 0;
      font-size: 18px;
      color: #4a9eff;
    `;
    modal.appendChild(titleEl);

    const infoEl = document.createElement("div");
    infoEl.className = "card-select-info";
    infoEl.style.cssText = `
      margin-bottom: 15px;
      font-size: 14px;
      color: #aaa;
    `;
    const updateInfo = () => {
      infoEl.textContent = `Selected: ${selectedIds.size} / ${max} (min: ${min})`;
    };
    updateInfo();
    modal.appendChild(infoEl);

    const listContainer = document.createElement("div");
    listContainer.className = "card-select-list";
    listContainer.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 10px;
      margin-bottom: 15px;
    `;

    candidates.forEach((cand, idx) => {
      const dbCard =
        cand.cardId !== undefined && cand.cardId !== null
          ? cardDatabaseById.get(cand.cardId)
          : null;
      const candidateId = cand.id ?? cand.key ?? String(idx);
      
      // D: Log candidate mapping
      if (idx === 0) {
        console.log("[OnlinePromptAdapter] showCardSelectAsync candidate mapping", {
          hasCandId: !!cand.id,
          hasCandKey: !!cand.key,
          candidateId,
          sampleCandidate: {
            id: cand.id,
            key: cand.key,
            cardId: cand.cardId,
            name: cand.name,
          },
        });
      }
      
      const displayName =
        getCardDisplayName(dbCard || cand) ||
        cand.label ||
        cand.name ||
        `Card ${idx + 1}`;
      const atk = cand.atk ?? dbCard?.atk;
      const def = cand.def ?? dbCard?.def;
      const cardKind = cand.cardKind ?? dbCard?.cardKind;

      const cardItem = document.createElement("div");
      cardItem.className = "card-select-item";
      cardItem.dataset.id = candidateId;
      cardItem.style.cssText = `
        background: #2a2a4e;
        border: 2px solid #444;
        border-radius: 6px;
        padding: 10px;
        cursor: pointer;
        transition: border-color 0.2s, background 0.2s;
        text-align: center;
      `;

      const nameEl = document.createElement("div");
      nameEl.textContent = displayName;
      nameEl.style.cssText = `
        font-weight: bold;
        font-size: 12px;
        margin-bottom: 5px;
        color: #fff;
      `;
      cardItem.appendChild(nameEl);

      if (atk !== null && atk !== undefined) {
        const statsEl = document.createElement("div");
        statsEl.textContent = `ATK ${atk} / DEF ${def || 0}`;
        statsEl.style.cssText = `font-size: 10px; color: #888;`;
        cardItem.appendChild(statsEl);
      } else if (cardKind) {
        const kindEl = document.createElement("div");
        kindEl.textContent = String(cardKind).toUpperCase();
        kindEl.style.cssText = `font-size: 10px; color: #888;`;
        cardItem.appendChild(kindEl);
      }

      cardItem.addEventListener("click", () => {
        if (selectedIds.has(candidateId)) {
          selectedIds.delete(candidateId);
          cardItem.style.borderColor = "#444";
          cardItem.style.background = "#2a2a4e";
        } else {
          if (max === 1) {
            selectedIds.clear();
            listContainer
              .querySelectorAll(".card-select-item")
              .forEach((el) => {
                el.style.borderColor = "#444";
                el.style.background = "#2a2a4e";
              });
          }
          if (selectedIds.size < max) {
            selectedIds.add(candidateId);
            cardItem.style.borderColor = "#4a9eff";
            cardItem.style.background = "#3a3a6e";
          }
        }
        updateInfo();
        confirmBtn.disabled = selectedIds.size < min || selectedIds.size > max;
      });

      listContainer.appendChild(cardItem);
    });
    modal.appendChild(listContainer);

    const buttonContainer = document.createElement("div");
    buttonContainer.style.cssText = `
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    `;

    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = "Confirm";
    confirmBtn.disabled = min > 0;
    confirmBtn.style.cssText = `
      padding: 10px 20px;
      background: #4a9eff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    `;
    confirmBtn.addEventListener("click", () => {
      if (selectedIds.size >= min && selectedIds.size <= max) {
        overlay.remove();
        const result = Array.from(selectedIds);
        console.log("[OnlinePromptAdapter] Card selection confirmed:", {
          result,
          count: result.length,
          min,
          max,
        });
        safeResolve(result);
      }
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.className = "secondary";
    cancelBtn.style.cssText = `
      padding: 10px 20px;
      background: #666;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    `;
    cancelBtn.addEventListener("click", () => {
      overlay.remove();
      console.log("[OnlinePromptAdapter] Card selection cancelled");
      safeResolve(null);
    });

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(confirmBtn);
    modal.appendChild(buttonContainer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const escHandler = (e) => {
      if (e.key === "Escape") {
        overlay.remove();
        document.removeEventListener("keydown", escHandler);
        safeResolve(null);
      }
    };
    document.addEventListener("keydown", escHandler);
  });
}

/**
 * Graveyard selection using the existing graveyard modal.
 * Works with serialized candidates (no object references) and returns candidate keys.
 * @param {Renderer} renderer - Renderer instance
 * @param {Object} prompt - Server prompt with requirement containing candidates
 * @param {Object} snapshot - Current online snapshot (for card data resolution)
 * @returns {Promise<Array|null>} Array of selected candidate IDs or null for cancel
 */
function showGraveyardSelectionAsync(renderer, prompt, snapshot) {
  return new Promise((resolve) => {
    let resolved = false;
    const selectedIds = new Set();
    const cleanup = [];

    const requirement = prompt?.requirement || {};
    const min = requirement.min ?? 1;
    const max = requirement.max ?? 1;
    const entries = buildGraveyardCandidateEntries(requirement, snapshot).filter(
      (entry) => entry.card
    );

    const safeResolve = (result) => {
      if (resolved) return;
      resolved = true;
      if (typeof window.setOnlineSelectionActive === "function") {
        window.setOnlineSelectionActive(false);
      }
      renderer.hideFieldTargetingControls?.();
      renderer.setSelectionDimming?.(false);
      renderer.toggleModal(false);
      cleanup.forEach((fn) => fn());
      resolve(result);
    };

    if (entries.length === 0) {
      console.warn(
        "[OnlinePromptAdapter] No graveyard candidates for selection"
      );
      safeResolve(null);
      return;
    }

    if (typeof window.setOnlineSelectionActive === "function") {
      window.setOnlineSelectionActive(true);
    }
    renderer.setSelectionDimming?.(true);

    const cards = entries.slice().sort((a, b) => {
      const aIdx =
        typeof a.zoneIndex === "number" ? a.zoneIndex : Number.MAX_SAFE_INTEGER;
      const bIdx =
        typeof b.zoneIndex === "number" ? b.zoneIndex : Number.MAX_SAFE_INTEGER;
      return aIdx - bIdx;
    });

    const owners = new Set(cards.map((entry) => entry.owner));
    const ownerLabel =
      owners.size === 1
        ? owners.has("player")
          ? "Cemiterio do jogador"
          : "Cemiterio do oponente"
        : "Cemiterio";
    const filterMessage =
      prompt.title || requirement.message || `${ownerLabel}: selecione as cartas`;

    const controls = renderer.showFieldTargetingControls(
      () => {
        if (selectedIds.size >= min && selectedIds.size <= max) {
          safeResolve(Array.from(selectedIds));
        }
      },
      () => safeResolve(null),
      { allowCancel: true }
    );
    cleanup.push(() => controls?.close?.());

    const updateControls = () => {
      controls?.updateState?.({
        selected: selectedIds.size,
        min,
        max,
        allowEmpty: min === 0,
      });
    };

    const markSelection = (cardEl, isSelected) => {
      if (!cardEl) return;
      if (isSelected) {
        cardEl.classList.add("selected");
      } else {
        cardEl.classList.remove("selected");
      }
    };

    renderer.renderGraveyardModal(
      cards.map((entry) => entry.card),
      {
        selectable: true,
        filterMessage,
        onSelect: (_card, index, cardEl) => {
          const entry = cards[index];
          if (!entry || !entry.candidateId) return;

          if (selectedIds.has(entry.candidateId)) {
            selectedIds.delete(entry.candidateId);
            markSelection(cardEl, false);
          } else {
            if (max === 1) {
              selectedIds.clear();
              document
                .querySelectorAll("#gy-grid .gy-selectable.selected")
                .forEach((el) => el.classList.remove("selected"));
            }
            if (selectedIds.size < max) {
              selectedIds.add(entry.candidateId);
              markSelection(cardEl, true);
            }
          }
          updateControls();
        },
        isSelected: (_card, index) => {
          const entry = cards[index];
          return entry ? selectedIds.has(entry.candidateId) : false;
        },
      }
    );
    renderer.toggleModal(true);
    updateControls();

    const escHandler = (e) => {
      if (e.key === "Escape") {
        safeResolve(null);
      }
    };
    document.addEventListener("keydown", escHandler);
    cleanup.push(() => document.removeEventListener("keydown", escHandler));

    const closeBtn = document.querySelector(".close-modal");
    if (closeBtn) {
      const closeHandler = () => safeResolve(null);
      closeBtn.addEventListener("click", closeHandler);
      cleanup.push(() =>
        closeBtn.removeEventListener("click", closeHandler)
      );
    }

    const modal = document.getElementById("gy-modal");
    if (modal) {
      const overlayHandler = (e) => {
        if (e.target === modal) {
          safeResolve(null);
        }
      };
      modal.addEventListener("click", overlayHandler);
      cleanup.push(() => modal.removeEventListener("click", overlayHandler));
    }
  });
}

function shouldUseFieldTargetingForSelection(prompt, requirement, candidates) {
  const ui = prompt?.ui || {};
  if (typeof ui.useFieldTargeting === "boolean") {
    return ui.useFieldTargeting;
  }

  const allowedZones = new Set(["field", "spellTrap", "fieldSpell"]);
  const zones = candidates
    .map((cand) => cand.zone || requirement.zone || null)
    .filter(Boolean);
  if (zones.length === 0) return false;
  return zones.every((zone) => allowedZones.has(zone));
}

function resolveCandidateCardView(cand, snapshot, requirement) {
  const zone = cand.zone || requirement.zone || "field";
  const owner = resolveControllerOwner(cand.controller || cand.owner, snapshot);
  const view =
    owner === "player" ? snapshot?.players?.self : snapshot?.players?.opponent;
  const zoneIndex = typeof cand.zoneIndex === "number" ? cand.zoneIndex : 0;

  let viewCard = null;
  if (view) {
    if (zone === "hand" && Array.isArray(view.hand)) {
      viewCard = view.hand[zoneIndex] || null;
    } else if (zone === "field") {
      viewCard = view.field?.[zoneIndex] || null;
    } else if (zone === "spellTrap") {
      viewCard = view.spellTrap?.[zoneIndex] || null;
    } else if (zone === "fieldSpell") {
      viewCard = view.fieldSpell || null;
    }
  }

  const isOpponentHiddenHand =
    owner === "opponent" && zone === "hand" && !Array.isArray(view?.hand);
  const isOpponentHiddenCard =
    owner === "opponent" && viewCard && viewCard.name == null;

  const safeName =
    cand.label || cand.name || (isOpponentHiddenCard ? "Face-down card" : null);

  if (isOpponentHiddenHand || isOpponentHiddenCard) {
    return {
      cardId: null,
      name: safeName || "Unknown card",
      cardKind: null,
      atk: null,
      def: null,
      level: null,
      description: "",
      image: null,
    };
  }

  const cardId = viewCard?.cardId ?? cand.cardId ?? null;
  const baseData = cardId ? cardDatabaseById.get(cardId) : null;
  return {
    cardId: cardId ?? baseData?.id ?? null,
    name:
      viewCard?.name ??
      safeName ??
      baseData?.name ??
      "Unknown card",
    cardKind:
      viewCard?.cardKind ??
      cand.cardKind ??
      baseData?.cardKind ??
      null,
    atk: viewCard?.atk ?? cand.atk ?? baseData?.atk ?? null,
    def: viewCard?.def ?? cand.def ?? baseData?.def ?? null,
    level: viewCard?.level ?? cand.level ?? baseData?.level ?? null,
    description:
      viewCard?.description ?? cand.description ?? baseData?.description ?? "",
    image:
      typeof baseData?.image === "string"
        ? baseData.image
        : cand.image || null,
  };
}

function buildSelectionModalContract(prompt, snapshot, allowEmpty) {
  const requirement = prompt.requirement || {};
  const candidates = Array.isArray(requirement.candidates)
    ? requirement.candidates
    : [];
  const min = requirement.min ?? 1;
  const max = requirement.max ?? 1;
  const requirementId = requirement.id || "selection";

  const modalCandidates = candidates.map((cand, idx) => {
    const cardView = resolveCandidateCardView(cand, snapshot, requirement);
    return {
      key: cand.id ?? cand.key ?? String(idx),
      name: cardView.name || cand.label || cand.name || `Target ${idx + 1}`,
      owner: resolveControllerOwner(cand.controller || cand.owner, snapshot),
      controller: cand.controller || cand.owner || "player",
      zone: cand.zone || requirement.zone || "field",
      zoneIndex: cand.zoneIndex ?? idx,
      position: cand.position || "",
      atk: cardView.atk ?? cand.atk ?? null,
      def: cardView.def ?? cand.def ?? null,
      cardKind: cardView.cardKind ?? cand.cardKind ?? null,
      cardRef: cardView,
    };
  });

  return {
    kind: prompt.kind || "selection",
    message: prompt.title || "Select target(s)",
    requirements: [
      {
        id: requirementId,
        min,
        max,
        candidates: modalCandidates,
      },
    ],
    ui: { allowCancel: true, allowEmpty },
  };
}

function showSelectionContractModalAsync(renderer, prompt, snapshot) {
  return new Promise((resolve) => {
    let resolved = false;
    const requirement = prompt.requirement || {};
    const min = requirement.min ?? 1;
    const allowEmpty = prompt?.ui?.allowEmpty === true || min === 0;

    const safeResolve = (result) => {
      if (!resolved) {
        resolved = true;
        if (typeof window.setOnlineSelectionActive === "function") {
          window.setOnlineSelectionActive(false);
        }
        resolve(result);
      }
    };

    if (typeof window.setOnlineSelectionActive === "function") {
      window.setOnlineSelectionActive(true);
    }

    if (!renderer?.showTargetSelection) {
      safeResolve(null);
      return;
    }

    try {
      const contract = buildSelectionModalContract(prompt, snapshot, allowEmpty);
      const requirementId = contract.requirements?.[0]?.id || "selection";

      renderer.showTargetSelection(
        contract,
        (selections) => {
          const selected = selections?.[requirementId] || [];
          safeResolve(selected);
        },
        () => safeResolve(null),
        { allowCancel: true, allowEmpty }
      );
    } catch (error) {
      console.error(
        "[OnlinePromptAdapter] showSelectionContractModalAsync error",
        error
      );
      safeResolve(null);
    }
  });
}

/**
 * Visual selection for effect targets (field/hand/spell zones).
 * Uses field targeting highlights; graveyard selections are handled separately.
 * @param {Renderer} renderer - Renderer instance
 * @param {Object} prompt - Server prompt with requirement containing candidates
 * @param {Object} snapshot - Current online snapshot (for resolving card data)
 * @returns {Promise<Array|null>} Selected candidate IDs or null for cancel
 */
export function showSelectionContractAsync(renderer, prompt, snapshot) {
  const requirement = prompt.requirement || {};
  const candidates = requirement.candidates || [];
  const min = requirement.min ?? 1;
  const max = requirement.max ?? 1;
  const allowEmpty = prompt?.ui?.allowEmpty === true || min === 0;

  const candidateZones = new Set(
    candidates
      .map((cand) => cand.zone || requirement.zone || null)
      .filter(Boolean)
  );
  if (candidateZones.size === 1 && candidateZones.has("graveyard")) {
    return showGraveyardSelectionAsync(renderer, prompt, snapshot).catch(
      (error) => {
        console.error("[OnlinePromptAdapter] Graveyard selection error", error);
        return null;
      }
    );
  }

  const useFieldTargeting = shouldUseFieldTargetingForSelection(
    prompt,
    requirement,
    candidates
  );
  if (!useFieldTargeting) {
    return showSelectionContractModalAsync(renderer, prompt, snapshot);
  }

  return new Promise((resolve) => {
    let resolved = false;
    const selectedIds = new Set();
    const cleanup = [];

    console.log("[OnlinePromptAdapter] showSelectionContractAsync", {
      prompt,
      requirement,
      candidates,
      min,
      max,
      useFieldTargeting,
    });

    // Block intent clicks while selection is active
    if (typeof window.setOnlineSelectionActive === "function") {
      window.setOnlineSelectionActive(true);
    }

    const safeResolve = (result) => {
      if (!resolved) {
        resolved = true;
        // Unblock intent clicks
        if (typeof window.setOnlineSelectionActive === "function") {
          window.setOnlineSelectionActive(false);
        }
        cleanup.forEach((fn) => fn());
        renderer.clearTargetHighlights();
        renderer.setSelectionDimming?.(false);
        resolve(result);
      }
    };

    const updateHighlights = () => {
      const highlightTargets = candidates.map((cand) => {
        const isSelected = selectedIds.has(cand.id);
        return {
          zone: cand.zone || "field",
          controller: cand.controller || "player",
          zoneIndex: cand.zoneIndex ?? 0,
          isSelected,
        };
      });
      renderer.applyTargetHighlights({ targets: highlightTargets });
    };

    const updateControls = (controls) => {
      if (controls?.updateState) {
        controls.updateState({
          selected: selectedIds.size,
          min,
          max,
          allowEmpty,
        });
      }
    };

    try {
      if (candidates.length === 0) {
        console.warn("[OnlinePromptAdapter] No candidates for selection");
        safeResolve(null);
        return;
      }

      // Enable dimming for focus
      renderer.setSelectionDimming?.(true);

      // Initial highlights
      updateHighlights();

      // Show targeting controls
      const controls = renderer.showFieldTargetingControls(
        // onConfirm
        () => {
          if (selectedIds.size >= min && selectedIds.size <= max) {
            const result = Array.from(selectedIds);
            console.log("[OnlinePromptAdapter] Selection confirmed:", result);
            safeResolve(result);
          }
        },
        // onCancel
        () => {
          console.log("[OnlinePromptAdapter] Selection cancelled");
          safeResolve(null);
        },
        { allowCancel: true }
      );
      cleanup.push(() => controls?.close?.());

      updateControls(controls);

      // Create click handlers for each candidate
      candidates.forEach((cand) => {
        const targetEl = findCandidateElement(cand);

        if (targetEl) {
          const clickHandler = (e) => {
            e.stopPropagation();

            if (selectedIds.has(cand.id)) {
              selectedIds.delete(cand.id);
            } else {
              if (max === 1) {
                selectedIds.clear();
              }
              if (selectedIds.size < max) {
                selectedIds.add(cand.id);
              }
            }

            console.log(
              "[OnlinePromptAdapter] Candidate clicked:",
              cand.id,
              "Selected:",
              Array.from(selectedIds)
            );
            updateHighlights();
            updateControls(controls);
          };

          targetEl.addEventListener("click", clickHandler);
          cleanup.push(() =>
            targetEl.removeEventListener("click", clickHandler)
          );
        }
      });

      // ESC to cancel
      const escHandler = (e) => {
        if (e.key === "Escape") {
          safeResolve(null);
        }
      };
      document.addEventListener("keydown", escHandler);
      cleanup.push(() => document.removeEventListener("keydown", escHandler));
    } catch (error) {
      console.error(
        "[OnlinePromptAdapter] showSelectionContractAsync error",
        error
      );
      safeResolve(null);
    }
  });
}

/**
 * Finds the DOM element for a selection candidate
 * @param {Object} cand - Candidate object with zone, controller, zoneIndex
 * @returns {HTMLElement|null}
 */
function findCandidateElement(cand) {
  const zone = cand.zone || "field";
  const controller = cand.controller || "player";
  const zoneIndex = cand.zoneIndex ?? 0;

  console.log("[OnlinePromptAdapter] findCandidateElement", {
    cand,
    zone,
    controller,
    zoneIndex,
  });

  let containerId = null;

  if (zone === "field") {
    containerId = controller === "player" ? "player-field" : "bot-field";
  } else if (zone === "spellTrap") {
    containerId =
      controller === "player" ? "player-spelltrap" : "bot-spelltrap";
  } else if (zone === "hand") {
    containerId = controller === "player" ? "player-hand" : "bot-hand";
  } else if (zone === "graveyard") {
    console.log(
      "[OnlinePromptAdapter] Graveyard selection handled via modal; no DOM element."
    );
    return null;
  }

  if (!containerId) {
    console.log("[OnlinePromptAdapter] No containerId found for zone:", zone);
    return null;
  }

  const container = document.getElementById(containerId);
  if (!container) {
    console.log("[OnlinePromptAdapter] Container not found:", containerId);
    return null;
  }

  const selector = `.card[data-index="${zoneIndex}"]`;
  const element = container.querySelector(selector);
  console.log(
    "[OnlinePromptAdapter] Looking for",
    selector,
    "in",
    containerId,
    "found:",
    element
  );

  return element;
}

function resolveControllerOwner(controller, snapshot) {
  const normalized = controller || "player";
  const selfId = snapshot?.players?.self?.id;
  const oppId = snapshot?.players?.opponent?.id;

  if (normalized === "player" || normalized === selfId) return "player";
  if (normalized === "opponent" || normalized === "bot" || normalized === oppId)
    return "opponent";
  return "player";
}

function mapGraveyardCardView(cardView) {
  if (!cardView) return null;
  const baseData =
    cardView.cardId && cardDatabaseById.get(cardView.cardId)
      ? cardDatabaseById.get(cardView.cardId)
      : {};
  const kind = cardView.cardKind ?? baseData.cardKind ?? "monster";
  return {
    id: cardView.cardId ?? baseData.id ?? 0,
    cardId: cardView.cardId ?? baseData.id ?? 0,
    name: cardView.name ?? baseData.name ?? "Unknown",
    cardKind: kind,
    subtype: cardView.subtype ?? baseData.subtype ?? null,
    atk: kind === "monster" ? cardView.atk ?? baseData.atk ?? null : null,
    def: kind === "monster" ? cardView.def ?? baseData.def ?? null : null,
    level: kind === "monster" ? cardView.level ?? baseData.level ?? null : null,
    description: cardView.description ?? baseData.description ?? "",
    image:
      typeof baseData.image === "string"
        ? baseData.image
        : cardView.image || null,
  };
}

function buildGraveyardCandidateEntries(requirement, snapshot) {
  const candidates = Array.isArray(requirement?.candidates)
    ? requirement.candidates
    : [];

  return candidates.map((cand, idx) => {
    const owner = resolveControllerOwner(
      cand.controller || cand.owner,
      snapshot
    );
    const view =
      owner === "player"
        ? snapshot?.players?.self
        : snapshot?.players?.opponent;
    const zoneIndex =
      typeof cand.zoneIndex === "number" ? cand.zoneIndex : idx;
    const viewCard =
      view && Array.isArray(view?.graveyard)
        ? view.graveyard[zoneIndex]
        : null;

    const fallbackCard =
      cand.cardId || cand.cardKind
        ? {
            cardId: cand.cardId,
            cardKind: cand.cardKind,
            name: cand.name || cand.label,
            atk: cand.atk,
            def: cand.def,
            level: cand.level,
            description: cand.description,
          }
        : null;

    const card = mapGraveyardCardView(
      viewCard || cand.cardData || fallbackCard
    );

    return {
      candidateId: cand.id ?? cand.key ?? String(idx),
      card,
      owner,
      zoneIndex,
    };
  });
}

// ============================================================================
// Modal Type Detection & Option Building
// ============================================================================

/**
 * Determines which modal type to use for a prompt
 * @param {Object} prompt - Server prompt
 * @param {Object} cardData - Card data (from prompt.cardData or extracted from snapshot)
 * @returns {string} Modal type: 'summon', 'spell', 'position', 'target', 'selection', 'generic'
 */
export function determineModalType(prompt, cardData = {}) {
  if (!prompt) return "generic";

  const { type, zone, options } = prompt;

  if (type === "card_action_menu") {
    if (zone === "hand") {
      const cardKind = cardData?.cardKind;
      if (cardKind === "monster") return "summon";
      if (cardKind === "spell" || cardKind === "trap") return "spell";
      // Fallback: check options to infer card type
      const hasNormalSummon = options?.some((o) => o.id === "normal_summon");
      const hasSetMonster = options?.some((o) => o.id === "set_monster");
      if (hasNormalSummon || hasSetMonster) return "summon";
      const hasActivateSpell = options?.some((o) => o.id === "activate_spell");
      const hasSetSpell = options?.some((o) => o.id === "set_spelltrap");
      if (hasActivateSpell || hasSetSpell) return "spell";
    }
    if (zone === "field") {
      return "position";
    }
  }

  if (type === "target_select") {
    return "target";
  }

  if (type === "selection_contract") {
    return "selection";
  }

  // B2: Card selection for search (deck/gy)
  if (type === "card_select") {
    return "card_select";
  }

  return "generic";
}

/**
 * Extracts card data from prompt or snapshot
 * Prefers prompt.cardData if available (enriched by server)
 * @param {Object} prompt - Server prompt
 * @param {Object} snapshot - Current game snapshot
 * @returns {Object|null} Card data
 */
export function extractCardData(prompt, snapshot) {
  // Prefer enriched data from server
  if (prompt?.cardData) {
    return prompt.cardData;
  }

  // Fallback: extract from snapshot
  if (!snapshot) return null;

  const { zone, index } = prompt || {};
  const selfView = snapshot.players?.self;

  if (!selfView) return null;

  if (zone === "hand") {
    return selfView.hand?.[index] || null;
  }

  if (zone === "field") {
    return selfView.field?.[index] || null;
  }

  if (zone === "graveyard") {
    const ownerHint = prompt.owner || prompt.controller || "player";
    const targetView =
      ownerHint === "opponent" ? snapshot.players?.opponent : selfView;
    return targetView?.graveyard?.[index] || null;
  }

  return null;
}

/**
 * Builds modal options from server prompt options
 * @param {Array} serverOptions - Server prompt options
 * @returns {Object} Options object for Renderer modals
 */
export function buildModalOptions(serverOptions = []) {
  const result = {};

  for (const opt of serverOptions) {
    switch (opt.id) {
      case "activate_spell":
        result.canActivate = true;
        break;
      case "activate_effect":
        result.hasIgnitionEffect = true;
        break;
      case "switch":
        result.canChangePosition = true;
        break;
      case "attack":
        result.canAttack = true;
        break;
      case "flip":
        result.canFlip = true;
        break;
      case "ascension_summon":
        result.hasAscensionSummon = true;
        break;
      // Future: add more option types as needed
    }
  }

  return result;
}

/**
 * Maps a modal choice to the corresponding server option ID
 * @param {string} modalChoice - Choice from Renderer modal
 * @param {Array} serverOptions - Server prompt options
 * @returns {string|null} Server option ID or null
 */
export function mapModalChoiceToOption(modalChoice, serverOptions = []) {
  if (!modalChoice || modalChoice === "cancel") return "cancel";

  // Direct mapping via lookup table
  const mappedId = MODAL_CHOICE_TO_OPTION[modalChoice];
  if (mappedId) {
    const found = serverOptions.find((opt) => opt.id === mappedId);
    if (found) return found.id;
  }

  // Handle "attack" choice which can mean normal_summon OR attack action
  if (modalChoice === "attack") {
    const normalSummon = serverOptions.find(
      (opt) => opt.id === "normal_summon"
    );
    if (normalSummon) return normalSummon.id;
    const attack = serverOptions.find((opt) => opt.id === "attack");
    if (attack) return attack.id;
  }

  // Fallback: try to find option by ID directly (for future extensions)
  const direct = serverOptions.find((opt) => opt.id === modalChoice);
  if (direct) return direct.id;

  return null;
}

// ============================================================================
// Generic Fallback Prompt
// ============================================================================

/**
 * Shows a generic fallback prompt for unsupported prompt types.
 * Always provides a cancel option to prevent soft-locks.
 * @param {Object} prompt - Server prompt
 * @param {Function} onResponse - Callback with (optionId)
 * @returns {Object} Handle with close() method
 */
export function showGenericFallbackPrompt(prompt, onResponse) {
  const overlay = document.createElement("div");
  overlay.className = "online-prompt-overlay generic-fallback-overlay";

  const modal = document.createElement("div");
  modal.className = "online-prompt-modal generic-fallback-modal";

  const title = document.createElement("h3");
  title.textContent = prompt?.title || "Action Required";
  modal.appendChild(title);

  // Warning for unsupported prompt types
  const isUnsupported =
    prompt?.type && !SUPPORTED_PROMPT_TYPES.has(prompt.type);
  if (isUnsupported) {
    const warning = document.createElement("p");
    warning.className = "fallback-warning";
    warning.textContent =
      "⚠️ This action type is not fully supported in Online Alpha yet.";
    modal.appendChild(warning);
  }

  const optionsList = document.createElement("div");
  optionsList.className = "online-prompt-options";

  const options = prompt?.options || [];
  const nonCancelOptions = options.filter((opt) => opt.id !== "cancel");

  if (nonCancelOptions.length === 0) {
    const noOpts = document.createElement("p");
    noOpts.textContent = "No actions available.";
    modal.appendChild(noOpts);
  } else {
    nonCancelOptions.forEach((opt) => {
      const btn = document.createElement("button");
      btn.textContent = opt.label || opt.id || "Option";
      btn.onclick = () => {
        overlay.remove();
        onResponse(opt.id);
      };
      optionsList.appendChild(btn);
    });
    modal.appendChild(optionsList);
  }

  // Always add cancel button to prevent soft-locks
  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.className = "online-prompt-cancel";
  cancelBtn.onclick = () => {
    overlay.remove();
    onResponse("cancel");
  };
  modal.appendChild(cancelBtn);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  return {
    close: () => {
      if (overlay.parentNode) {
        overlay.remove();
      }
    },
  };
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main adapter function: handles a server prompt using visual modals
 * @param {Object} prompt - Server prompt
 * @param {Renderer} renderer - Renderer instance
 * @param {Object} snapshot - Current game snapshot
 * @param {Function} sendResponse - Function to send response: (promptId, choice) => void
 * @returns {Promise<void>}
 */
export async function handlePromptWithVisualModal(
  prompt,
  renderer,
  snapshot,
  sendResponse
) {
  if (!prompt) {
    console.warn("[OnlinePromptAdapter] No prompt provided");
    return;
  }

  const cardData = extractCardData(prompt, snapshot);
  const modalType = determineModalType(prompt, cardData);

  console.log("[OnlinePromptAdapter] Handling prompt", {
    type: prompt.type,
    modalType,
    zone: prompt.zone,
    index: prompt.index,
    cardKind: cardData?.cardKind,
    optionsCount: prompt.options?.length,
  });

  try {
    let choice = null;

    switch (modalType) {
      case "summon": {
        const modalOptions = buildModalOptions(prompt.options);
        choice = await showSummonModalAsync(
          renderer,
          prompt.index,
          modalOptions
        );
        break;
      }

      case "spell": {
        const hasActivate = prompt.options?.some(
          (opt) => opt.id === "activate_spell"
        );
        choice = await showSpellChoiceModalAsync(renderer, prompt.index, {
          canActivate: hasActivate,
        });
        break;
      }

      case "position": {
        // Check if this is a Battle Phase attack scenario
        // In offline mode, clicking a monster during battle phase goes directly to target selection
        // No modal is shown - the attack is implicit
        const nonCancelOptions = (prompt.options || []).filter(
          (opt) => opt.id !== "cancel"
        );
        const hasOnlyAttack =
          nonCancelOptions.length === 1 && nonCancelOptions[0].id === "attack";

        if (hasOnlyAttack) {
          // Battle Phase: go directly to attack (server will send target_select prompt next)
          console.log(
            "[OnlinePromptAdapter] Battle Phase attack - sending attack action"
          );
          sendResponse(prompt.promptId, "attack");
          return;
        }

        // Normal position modal for Main Phase actions
        const cardEl = document.querySelector(
          `#player-field .card[data-index="${prompt.index}"]`
        );
        const modalOptions = buildModalOptions(prompt.options);
        choice = await showPositionChoiceModalAsync(
          renderer,
          cardEl,
          cardData,
          modalOptions
        );
        break;
      }

      case "target": {
        // Visual target selection for attacks
        const selectedTarget = await showTargetSelectionAsync(renderer, prompt);

        if (selectedTarget) {
          // Send the selected target's ID to server
          console.log("[OnlinePromptAdapter] Target selected:", selectedTarget);
          sendResponse(prompt.promptId, selectedTarget.id);
        } else {
          // Cancel - send cancel to server
          console.log("[OnlinePromptAdapter] Target selection cancelled");
          sendResponse(prompt.promptId, "cancel");
        }
        return; // Early return - already sent response
      }

      case "selection": {
        // Visual selection for effect targets (equip spells, destruction effects, etc.)
        const selectedIds = await showSelectionContractAsync(
          renderer,
          prompt,
          snapshot
        );

        if (selectedIds === null) {
          console.log("[OnlinePromptAdapter] Selection cancelled");
          sendResponse(prompt.promptId, "cancel");
          return;
        }

        const responseValue =
          Array.isArray(selectedIds) && selectedIds.length === 1
            ? selectedIds[0]
            : selectedIds;
        console.log(
          "[OnlinePromptAdapter] Selection confirmed:",
          responseValue
        );
        sendResponse(prompt.promptId, responseValue);
        return; // Early return - already sent response
      }

      case "card_select": {
        // B2: Card search from deck/graveyard (Shadow-Heart Covenant, etc.)
        const selectedCardId = await showCardSelectAsync(renderer, prompt);

        if (selectedCardId) {
          console.log("[OnlinePromptAdapter] Card selected:", selectedCardId);
          sendResponse(prompt.promptId, selectedCardId);
        } else {
          console.log("[OnlinePromptAdapter] Card selection cancelled");
          sendResponse(prompt.promptId, "cancel");
        }
        return; // Early return - already sent response
      }

      default:
        // Generic fallback for unsupported types
        showGenericFallbackPrompt(prompt, (optionId) => {
          sendResponse(prompt.promptId, optionId);
        });
        return;
    }

    // Map modal choice to server option
    const optionId = mapModalChoiceToOption(choice, prompt.options);

    console.log("[OnlinePromptAdapter] Modal choice mapped", {
      modalChoice: choice,
      optionId,
    });

    // Send response to server
    if (optionId) {
      sendResponse(prompt.promptId, optionId);
    } else {
      // No valid mapping - send cancel to prevent soft-lock
      console.warn(
        "[OnlinePromptAdapter] No valid option mapping, sending cancel"
      );
      sendResponse(prompt.promptId, "cancel");
    }
  } catch (error) {
    console.error("[OnlinePromptAdapter] Error handling prompt", error);
    // Always send cancel on error to prevent soft-lock
    sendResponse(prompt.promptId, "cancel");
  }
}
