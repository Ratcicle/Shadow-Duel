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

    const safeResolve = (choice) => {
      if (!resolved) {
        resolved = true;
        resolve(choice);
      }
    };

    try {
      renderer.showSummonModal(
        cardIndex,
        (choice) => safeResolve(choice || "cancel"),
        options
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

    const safeResolve = (choice) => {
      if (!resolved) {
        resolved = true;
        resolve(choice);
      }
    };

    try {
      renderer.showSpellChoiceModal(
        cardIndex,
        (choice) => safeResolve(choice || "cancel"),
        options
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

    const safeResolve = (choice) => {
      if (!resolved) {
        resolved = true;
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
    } catch (error) {
      console.error(
        "[OnlinePromptAdapter] showPositionChoiceModal error",
        error
      );
      safeResolve("cancel");
    }
  });
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
    const selectedIds = new Set();

    const requirement = prompt.requirement || {};
    const candidates = requirement.candidates || [];
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

    // Create modal overlay
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

    // Title
    const titleEl = document.createElement("h2");
    titleEl.textContent = title;
    titleEl.style.cssText = `
      margin: 0 0 15px 0;
      font-size: 18px;
      color: #4a9eff;
    `;
    modal.appendChild(titleEl);

    // Selection info
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

    // Card list container
    const listContainer = document.createElement("div");
    listContainer.className = "card-select-list";
    listContainer.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 10px;
      margin-bottom: 15px;
    `;

    // Create card items
    candidates.forEach((cand) => {
      const cardItem = document.createElement("div");
      cardItem.className = "card-select-item";
      cardItem.dataset.id = cand.id;
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
      nameEl.textContent = cand.label || cand.name || "Unknown";
      nameEl.style.cssText = `
        font-weight: bold;
        font-size: 12px;
        margin-bottom: 5px;
        color: #fff;
      `;
      cardItem.appendChild(nameEl);

      // Card info (ATK/DEF or card kind)
      if (cand.atk !== null && cand.atk !== undefined) {
        const statsEl = document.createElement("div");
        statsEl.textContent = `ATK ${cand.atk} / DEF ${cand.def || 0}`;
        statsEl.style.cssText = `font-size: 10px; color: #888;`;
        cardItem.appendChild(statsEl);
      } else if (cand.cardKind) {
        const kindEl = document.createElement("div");
        kindEl.textContent = cand.cardKind.toUpperCase();
        kindEl.style.cssText = `font-size: 10px; color: #888;`;
        cardItem.appendChild(kindEl);
      }

      // Click handler
      cardItem.addEventListener("click", () => {
        if (selectedIds.has(cand.id)) {
          selectedIds.delete(cand.id);
          cardItem.style.borderColor = "#444";
          cardItem.style.background = "#2a2a4e";
        } else {
          if (max === 1) {
            // Single selection - clear others
            selectedIds.clear();
            listContainer
              .querySelectorAll(".card-select-item")
              .forEach((el) => {
                el.style.borderColor = "#444";
                el.style.background = "#2a2a4e";
              });
          }
          if (selectedIds.size < max) {
            selectedIds.add(cand.id);
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

    // Buttons container
    const buttonContainer = document.createElement("div");
    buttonContainer.style.cssText = `
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    `;

    // Confirm button
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
        console.log("[OnlinePromptAdapter] Card selection confirmed:", result);
        safeResolve(result);
      }
    });

    // Cancel button
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

    // ESC to cancel
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
 * Visual selection for effect targets (equip spells, destruction effects, etc.)
 * Mirrors offline behavior: highlight candidates, select by clicking, confirm to execute
 * @param {Renderer} renderer - Renderer instance
 * @param {Object} prompt - Server prompt with requirement containing candidates
 * @returns {Promise<Array>} Array of selected candidate IDs or null for cancel
 */
export function showSelectionContractAsync(renderer, prompt) {
  return new Promise((resolve) => {
    let resolved = false;
    const selectedIds = new Set();
    const cleanup = [];

    const requirement = prompt.requirement || {};
    const candidates = requirement.candidates || [];
    const min = requirement.min ?? 1;
    const max = requirement.max ?? 1;

    console.log("[OnlinePromptAdapter] showSelectionContractAsync", {
      prompt,
      requirement,
      candidates,
      min,
      max,
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
          allowEmpty: min === 0,
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
    // Graveyard selection might need a different approach
    console.log(
      "[OnlinePromptAdapter] Graveyard zone not supported for element finding"
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
        const selectedIds = await showSelectionContractAsync(renderer, prompt);

        if (selectedIds && selectedIds.length > 0) {
          // For single selection, send the ID directly; for multiple, send array
          const responseValue =
            selectedIds.length === 1 ? selectedIds[0] : selectedIds;
          console.log(
            "[OnlinePromptAdapter] Selection confirmed:",
            responseValue
          );
          sendResponse(prompt.promptId, responseValue);
        } else {
          console.log("[OnlinePromptAdapter] Selection cancelled");
          sendResponse(prompt.promptId, "cancel");
        }
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
