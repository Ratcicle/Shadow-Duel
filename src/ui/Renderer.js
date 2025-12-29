import { getCardDisplayDescription, getCardDisplayName } from "../core/i18n.js";

export default class Renderer {
  constructor() {
    this.elements = {
      playerHand: document.getElementById("player-hand"),
      playerField: document.getElementById("player-field"),
      playerSpellTrap: document.getElementById("player-spelltrap"),
      playerDeck: document.getElementById("player-deck"),
      playerGraveyard: document.getElementById("player-graveyard"),
      playerLP: document.getElementById("player-lp"),
      botHand: document.getElementById("bot-hand"),
      botField: document.getElementById("bot-field"),
      botSpellTrap: document.getElementById("bot-spelltrap"),
      botDeck: document.getElementById("bot-deck"),
      botGraveyard: document.getElementById("bot-graveyard"),
      botLP: document.getElementById("bot-lp"),
      playerFieldSpell: document.getElementById("player-fieldspell"),
      botFieldSpell: document.getElementById("bot-fieldspell"),
      turnIndicator: document.getElementById("turn-indicator"),
      phaseTrack: document.getElementById("phase-track"),
      actionLog: document.getElementById("action-log-list"),
    };
  }

  updateTurn(player) {
    if (!this.elements.turnIndicator) return;
    this.elements.turnIndicator.textContent = `Turn: ${player.name}`;
    
    // Indicador visual de turno: borda brilhante no campo do jogador ativo
    const playerAreaEl = document.getElementById("player-area");
    const botAreaEl = document.getElementById("bot-area");
    if (playerAreaEl && botAreaEl) {
      const isPlayerTurn = player.id === "player";
      playerAreaEl.classList.toggle("active-turn", isPlayerTurn);
      botAreaEl.classList.toggle("active-turn", !isPlayerTurn);
    }
  }

  updatePhaseTrack(currentPhase) {
    const phases = this.elements.phaseTrack?.querySelectorAll("li");
    if (!phases) return;
    let reachedCurrent = false;
    phases.forEach((li) => {
      li.classList.remove("active", "done");
      if (li.dataset.phase === currentPhase) {
        li.classList.add("active");
        reachedCurrent = true;
      } else if (!reachedCurrent) {
        li.classList.add("done");
      }
    });
  }

  updateLP(player) {
    const el =
      player.id === "player" ? this.elements.playerLP : this.elements.botLP;
    if (!el) return;
    el.textContent = player.lp;
  }

  showLpChange(player, amount, options = {}) {
    if (!player || !amount) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value === 0) return;

    const isHeal = value > 0;
    const container = document.getElementById(
      player.id === "player" ? "player-area" : "bot-area"
    );
    if (!container) return;

    const float = document.createElement("div");
    float.className = [
      "lp-float",
      isHeal ? "lp-float-heal" : "lp-float-damage",
      player.id === "player" ? "lp-float-player" : "lp-float-bot",
    ].join(" ");
    float.textContent = `${isHeal ? "+" : ""}${Math.abs(value)}`;
    container.appendChild(float);

    requestAnimationFrame(() => {
      float.classList.add("lp-float-animate");
    });

    const lpEl =
      player.id === "player" ? this.elements.playerLP : this.elements.botLP;
    const counter = lpEl ? lpEl.closest(".lp-counter") : null;
    if (counter) {
      const flashClass = isHeal ? "lp-flash-heal" : "lp-flash-damage";
      counter.classList.remove("lp-flash-heal", "lp-flash-damage");
      counter.classList.add(flashClass);
      setTimeout(() => {
        counter.classList.remove(flashClass);
      }, 420);
    }

    setTimeout(() => {
      float.remove();
    }, 1100);
  }

  renderHand(player) {
    const container =
      player.id === "player" ? this.elements.playerHand : this.elements.botHand;
    if (!container) return;

    // Batch DOM updates with DocumentFragment to minimize reflows
    const fragment = document.createDocumentFragment();

    player.hand.forEach((card, index) => {
      const cardEl = this.createCardElement(card, player.id === "player");
      cardEl.dataset.index = index;
      cardEl.dataset.location = "hand";

      if (player.id === "bot") {
        cardEl.classList.add("hidden");
        cardEl.innerHTML = '<div class="card-back"></div>';
        cardEl.style.background = "#333";
        cardEl.style.border = "1px solid #555";
      }

      fragment.appendChild(cardEl);
    });

    container.innerHTML = "";
    container.appendChild(fragment);
  }

  renderField(player) {
    const container =
      player.id === "player"
        ? this.elements.playerField
        : this.elements.botField;
    if (!container) return;

    // Batch DOM updates with DocumentFragment to minimize reflows
    const fragment = document.createDocumentFragment();

    player.field.forEach((card, index) => {
      const cardEl = this.createCardElement(card, true);
      cardEl.dataset.index = index;
      cardEl.dataset.location = "field";

      if (card.position === "defense") {
        cardEl.classList.add("defense");
      }

      if (card.isFacedown) {
        cardEl.classList.add("facedown");
        cardEl.innerHTML = '<div class="card-back"></div>';
        cardEl.style.backgroundImage = "none";
        cardEl.style.backgroundColor = "#333";
        cardEl.style.border = "1px solid #555";
      }

      fragment.appendChild(cardEl);
    });

    container.innerHTML = "";
    container.appendChild(fragment);
  }

  renderSpellTrap(player) {
    const container =
      player.id === "player"
        ? this.elements.playerSpellTrap
        : this.elements.botSpellTrap;
    if (!container) return;

    // Batch DOM updates with DocumentFragment to minimize reflows
    const fragment = document.createDocumentFragment();

    player.spellTrap.forEach((card, index) => {
      const isVisible = player.id === "player" || !card.isFacedown;
      const cardEl = this.createCardElement(card, isVisible);
      cardEl.dataset.index = index;
      cardEl.dataset.location = "spellTrap";

      if (card.isFacedown) {
        cardEl.classList.add("facedown");
        cardEl.innerHTML = '<div class="card-back"></div>';
        cardEl.style.backgroundImage = "none";
        cardEl.style.backgroundColor = "#333";
        cardEl.style.border = "1px solid #555";
      }

      fragment.appendChild(cardEl);
    });

    container.innerHTML = "";
    container.appendChild(fragment);
  }

  renderFieldSpell(player) {
    const container =
      player.id === "player"
        ? this.elements.playerFieldSpell
        : this.elements.botFieldSpell;
    if (!container) return;

    container.innerHTML = "";

    const card = player.fieldSpell;
    if (!card) return;

    const isVisible = player.id === "player" || !card.isFacedown;
    const cardEl = this.createCardElement(card, isVisible);
    cardEl.dataset.location = "fieldSpell";
    cardEl.dataset.index = 0;

    if (card.isFacedown) {
      cardEl.classList.add("facedown");
      cardEl.innerHTML = '<div class="card-back"></div>';
      cardEl.style.backgroundImage = "none";
      cardEl.style.backgroundColor = "#333";
      cardEl.style.border = "1px solid #555";
    }

    container.appendChild(cardEl);
  }

  applyActivationIndicators(owner, indicators = {}) {
    const prefix = owner === "player" ? "player" : "bot";
    this.applyZoneActivationIndicators(
      this.elements[`${prefix}Hand`],
      indicators.hand || {}
    );
    this.applyZoneActivationIndicators(
      this.elements[`${prefix}Field`],
      indicators.field || {}
    );
    this.applyZoneActivationIndicators(
      this.elements[`${prefix}SpellTrap`],
      indicators.spellTrap || {}
    );

    const fieldSpellContainer = this.elements[`${prefix}FieldSpell`];
    if (fieldSpellContainer) {
      const cardEl = fieldSpellContainer.querySelector(".card");
      if (cardEl) {
        this.clearActivationHint(cardEl);
        const hint = indicators.fieldSpell;
        if (hint && hint.label) {
          this.setActivationHint(cardEl, hint.label);
        }
        if (hint?.canActivate) {
          this.decorateActivatableCard(cardEl);
        }
      }
    }
  }

  applyAttackReadyIndicators(owner, indices = []) {
    this.clearAttackReadyIndicators();
    if (!Array.isArray(indices) || indices.length === 0) return;
    const container =
      owner === "player" ? this.elements.playerField : this.elements.botField;
    if (!container) return;
    indices.forEach((index) => {
      const cardEl = container.querySelector(`.card[data-index=\"${index}\"]`);
      if (cardEl) {
        cardEl.classList.add("attack-ready");
      }
    });
  }

  clearAttackReadyIndicators() {
    const containers = [this.elements.playerField, this.elements.botField];
    containers.forEach((container) => {
      if (!container) return;
      container
        .querySelectorAll(".card.attack-ready")
        .forEach((el) => el.classList.remove("attack-ready"));
    });
  }

  applyAttackResolutionIndicators({
    attackerOwner = "player",
    attackerIndex = -1,
    targetOwner = "bot",
    targetIndex = -1,
    directAttack = false,
  } = {}) {
    this.clearAttackResolutionIndicators();

    const attackerContainer =
      attackerOwner === "player"
        ? this.elements.playerField
        : this.elements.botField;
    if (attackerContainer && attackerIndex >= 0) {
      const attackerEl = attackerContainer.querySelector(
        `.card[data-index=\"${attackerIndex}\"]`
      );
      if (attackerEl) {
        attackerEl.classList.add("attack-attacker");
      }
    }

    if (directAttack) {
      if (this.elements.botHand) {
        this.elements.botHand.classList.add("direct-attack-active");
      }
      return;
    }

    const targetContainer =
      targetOwner === "player"
        ? this.elements.playerField
        : this.elements.botField;
    if (targetContainer && targetIndex >= 0) {
      const targetEl = targetContainer.querySelector(
        `.card[data-index=\"${targetIndex}\"]`
      );
      if (targetEl) {
        targetEl.classList.add("attack-target");
      }
    }
  }

  clearAttackResolutionIndicators() {
    const containers = [this.elements.playerField, this.elements.botField];
    containers.forEach((container) => {
      if (!container) return;
      container
        .querySelectorAll(".card.attack-attacker")
        .forEach((el) => el.classList.remove("attack-attacker"));
      container
        .querySelectorAll(".card.attack-target")
        .forEach((el) => el.classList.remove("attack-target"));
    });
    if (this.elements.botHand) {
      this.elements.botHand.classList.remove("direct-attack-active");
    }
  }

  applyFlipAnimation(owner, index) {
    const container =
      owner === "player" ? this.elements.playerField : this.elements.botField;
    if (!container || index < 0) return;
    const cardEl = container.querySelector(`.card[data-index="${index}"]`);
    if (cardEl) {
      cardEl.classList.add("flipping");
    }
  }

  setPlayerFieldTributeable(indices = []) {
    if (!this.elements.playerField) return;
    indices.forEach((index) => {
      const cardEl = this.elements.playerField.querySelector(
        `.card[data-index="${index}"]`
      );
      if (cardEl) {
        cardEl.classList.add("tributeable");
      }
    });
  }

  setPlayerFieldSelected(index, selected) {
    if (!this.elements.playerField || index < 0) return;
    const cardEl = this.elements.playerField.querySelector(
      `.card[data-index="${index}"]`
    );
    if (!cardEl) return;
    if (selected) {
      cardEl.classList.add("selected");
    } else {
      cardEl.classList.remove("selected");
    }
  }

  clearPlayerFieldTributeable() {
    if (!this.elements.playerField) return;
    this.elements.playerField
      .querySelectorAll(".tributeable, .selected")
      .forEach((el) => el.classList.remove("tributeable", "selected"));
  }

  applyTargetHighlights({ targets = [], attackerHighlight = null } = {}) {
    this.clearTargetHighlights();

    if (attackerHighlight) {
      const { owner, index } = attackerHighlight;
      const container =
        owner === "player" ? this.elements.playerField : this.elements.botField;
      if (container && index >= 0) {
        const attackerEl = container.querySelector(
          `.card[data-index=\"${index}\"]`
        );
        if (attackerEl) {
          attackerEl.classList.add("attack-attacker");
        }
      }
    }

    targets.forEach((cand) => {
      let targetEl = null;
      if (cand.isDirectAttack) {
        targetEl = this.elements.botHand;
      } else if (cand.zone === "field") {
        const container =
          cand.controller === "player"
            ? this.elements.playerField
            : this.elements.botField;
        if (container) {
          targetEl = container.querySelector(
            `.card[data-index=\"${cand.zoneIndex}\"]`
          );
        }
      } else if (cand.zone === "spellTrap") {
        const container =
          cand.controller === "player"
            ? this.elements.playerSpellTrap
            : this.elements.botSpellTrap;
        if (container) {
          targetEl = container.querySelector(
            `.card[data-index=\"${cand.zoneIndex}\"]`
          );
        }
      } else if (cand.zone === "fieldSpell") {
        const container =
          cand.controller === "player"
            ? this.elements.playerFieldSpell
            : this.elements.botFieldSpell;
        if (container) {
          targetEl = container.querySelector(".card");
        }
      }

      if (!targetEl) {
        return;
      }

      targetEl.classList.add("targetable");
      if (cand.isDirectAttack) {
        targetEl.style.pointerEvents = "auto";
        targetEl.classList.add("direct-attack-target");
      }
      if (cand.isSelected) {
        targetEl.classList.add("selected-target");
      }
      if (cand.isAttackTarget) {
        targetEl.classList.add("attack-target");
      }
    });
  }

  clearTargetHighlights() {
    const containers = [
      this.elements.playerHand,
      this.elements.botHand,
      this.elements.playerField,
      this.elements.botField,
      this.elements.playerSpellTrap,
      this.elements.botSpellTrap,
      this.elements.playerFieldSpell,
      this.elements.botFieldSpell,
    ];

    containers.forEach((container) => {
      if (!container) return;
      container
        .querySelectorAll(
          ".card.targetable, .card.selected-target, .card.attack-attacker, .card.attack-target, .direct-attack-target"
        )
        .forEach((el) => {
          el.classList.remove(
            "targetable",
            "selected-target",
            "attack-attacker",
            "attack-target",
            "direct-attack-target"
          );
        });
    });

    if (this.elements.botHand) {
      this.elements.botHand.style.pointerEvents = "";
    }
  }

  setSelectionDimming(active) {
    const container = document.getElementById("game-container");
    if (!container) return;
    container.classList.toggle("selection-dim", !!active);
  }

  applyHandTargetableIndices(owner, indices = []) {
    const container =
      owner === "player" ? this.elements.playerHand : this.elements.botHand;
    if (!container) return;
    const indexSet = new Set(indices);
    const cards = container.querySelectorAll(".card");
    cards.forEach((cardEl, index) => {
      if (indexSet.has(index)) {
        cardEl.classList.add("targetable");
      } else {
        cardEl.classList.remove("targetable");
      }
    });
  }

  getSelectionCleanupState() {
    const controlsVisible = !!document.querySelector(
      ".field-targeting-controls"
    );
    const highlightCount = document.querySelectorAll(
      ".card.targetable, .card.selected-target"
    ).length;
    return { controlsVisible, highlightCount };
  }

  applyZoneActivationIndicators(container, zoneIndicators) {
    if (!container || !zoneIndicators) return;
    const cardEls = container.querySelectorAll(".card");
    cardEls.forEach((cardEl) => {
      const index = Number(cardEl.dataset.index);
      if (Number.isNaN(index)) return;
      this.clearActivationHint(cardEl);
      const hint = zoneIndicators[index];
      if (!hint) return;
      if (hint.label) {
        this.setActivationHint(cardEl, hint.label);
      }
      if (hint.canActivate) {
        this.decorateActivatableCard(cardEl);
      }
    });
  }

  decorateActivatableCard(cardEl) {
    cardEl.classList.add("card-activatable");
  }

  setActivationHint(cardEl, label) {
    if (!label) return;
    cardEl.title = label;
    cardEl.dataset.activationHint = "true";
  }

  clearActivationHint(cardEl) {
    cardEl.classList.remove("card-activatable");
    if (cardEl.dataset.activationHint) {
      delete cardEl.dataset.activationHint;
      cardEl.removeAttribute("title");
    }
  }

  showSummonModal(cardIndex, callback, options = {}) {
    const existingModal = document.querySelector(".summon-choice-modal");
    if (existingModal) {
      existingModal.remove();
    }

    const cardElement = document.querySelector(
      `#player-hand .card[data-index="${cardIndex}"]`
    );
    const rect = cardElement ? cardElement.getBoundingClientRect() : null;

    const modal = document.createElement("div");
    modal.className = "summon-choice-modal";
    const content = document.createElement("div");
    content.className = "summon-choice-content";

    const normalBtn = document.createElement("button");
    normalBtn.textContent = "Normal Summon";

    const setBtn = document.createElement("button");
    setBtn.textContent = "Set";

    content.appendChild(normalBtn);
    content.appendChild(setBtn);

    if (options.canSanctumSpecialFromAegis) {
      const specialBtn = document.createElement("button");
      specialBtn.textContent = "Special Summon";
      content.appendChild(specialBtn);

      specialBtn.onclick = (e) => {
        e.stopPropagation();
        callback("special_from_aegisbearer");
        cleanup();
      };
    }

    if (options.specialSummonFromHand) {
      const specialHandBtn = document.createElement("button");
      specialHandBtn.textContent =
        options.specialSummonFromHandLabel || "Special Summon";
      content.appendChild(specialHandBtn);

      specialHandBtn.onclick = (e) => {
        e.stopPropagation();
        callback("special_from_void_forgotten");
        cleanup();
      };
    }

    if (options.specialSummonFromHandEffect) {
      const specialHandEffectBtn = document.createElement("button");
      specialHandEffectBtn.textContent =
        options.specialSummonFromHandEffectLabel || "Special Summon";
      content.appendChild(specialHandEffectBtn);

      specialHandEffectBtn.onclick = (e) => {
        e.stopPropagation();
        callback("special_from_hand_effect");
        cleanup();
      };
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

    normalBtn.onclick = (e) => {
      e.stopPropagation();
      callback("attack");
      cleanup();
    };
    setBtn.onclick = (e) => {
      e.stopPropagation();
      callback("defense");
      cleanup();
    };
  }
  showConditionalSummonPrompt(cardName, message) {
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
          <button class="primary" data-choice="yes">Invocar</button>
          <button class="secondary" data-choice="no">Recusar</button>
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

  showTierChoiceModal({ title = "Choose Tier", options = [] } = {}) {
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
        label.textContent = opt.label || `Tier ${opt.count}`;

        const desc = document.createElement("div");
        desc.className = "tier-choice-desc";
        desc.textContent = opt.description || "";

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
      cancelBtn.textContent = "Cancel";
      cancelBtn.className = "secondary";
      cancelBtn.onclick = () => {
        overlay.remove();
        resolve(null);
      };

      const confirmBtn = document.createElement("button");
      confirmBtn.textContent = "Confirm";
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

  showSpellChoiceModal(cardIndex, callback, options = {}) {
    const existingModal = document.querySelector(".spell-choice-modal");
    if (existingModal) {
      existingModal.remove();
    }

    const canActivate =
      options.canActivate === undefined ? true : !!options.canActivate;

    const cardElement = document.querySelector(
      `#player-hand .card[data-index="${cardIndex}"]`
    );
    const rect = cardElement ? cardElement.getBoundingClientRect() : null;

    const modal = document.createElement("div");
    modal.className = "spell-choice-modal";
    const content = document.createElement("div");
    content.className = "spell-choice-content";

    const setBtn = document.createElement("button");
    setBtn.dataset.choice = "set";
    setBtn.textContent = "Set";

    if (canActivate) {
      const activateBtn = document.createElement("button");
      activateBtn.dataset.choice = "activate";
      activateBtn.textContent = "Activate";
      content.appendChild(activateBtn);
    }
    content.appendChild(setBtn);
    modal.appendChild(content);

    // posicionamento semelhante ao modal de invocacao
    modal.style.position = "fixed";
    modal.style.zIndex = "200";

    document.body.appendChild(modal);

    if (rect) {
      const content = modal.querySelector(".spell-choice-content") || modal;
      const contentRect = content.getBoundingClientRect();

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
  showPositionChoiceModal(cardEl, card, callback, options = {}) {
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
      activateBtn.textContent = "Activate";
      content.appendChild(activateBtn);
    }

    if (
      options.hasAscensionSummon &&
      typeof options.onAscensionSummon === "function"
    ) {
      const ascendBtn = document.createElement("button");
      ascendBtn.dataset.choice = "ascension_summon";
      ascendBtn.textContent = "Ascend";
      content.appendChild(ascendBtn);
    }

    if (options.canFlip) {
      const flipBtn = document.createElement("button");
      flipBtn.dataset.choice = "flip";
      flipBtn.textContent = "Flip Summon";
      content.appendChild(flipBtn);
    }

    if (options.canChangePosition && card?.position !== "attack") {
      const attackBtn = document.createElement("button");
      attackBtn.dataset.choice = "to_attack";
      attackBtn.textContent = "To Attack";
      content.appendChild(attackBtn);
    }

    if (options.canChangePosition && card?.position !== "defense") {
      const defenseBtn = document.createElement("button");
      defenseBtn.dataset.choice = "to_defense";
      defenseBtn.textContent = "To Defense";
      content.appendChild(defenseBtn);
    }
    modal.appendChild(content);

    modal.style.position = "fixed";
    modal.style.zIndex = "200";

    document.body.appendChild(modal);

    const rect = cardEl?.getBoundingClientRect();
    if (rect) {
      const content = modal.querySelector(".position-choice-content") || modal;
      const contentRect = content.getBoundingClientRect();

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

  showSpecialSummonPositionModal(card, onChoose) {
    const existing = document.querySelector(".special-summon-position-modal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.className = "special-summon-position-modal";

    const imageUrl = card?.image || "";
    const safeName =
      (card && getCardDisplayName(card)) ||
      (card?.name && card.name.trim()) ||
      "este monstro";
    const previewStyle = imageUrl ? `background-image: url('${imageUrl}')` : "";

    modal.innerHTML = `
      <div class="special-position-backdrop"></div>
      <div class="special-position-content">
        <h3>Special Summon</h3>
        <p class="special-position-subtitle"></p>
        <div class="special-position-options">
          <button class="position-option attack" data-choice="attack">
            <div class="position-card attack" style="${previewStyle}"></div>
            <span>Ataque</span>
          </button>
          <button class="position-option defense" data-choice="defense">
            <div class="position-card defense" style="${previewStyle}"></div>
            <span>Defesa</span>
          </button>
        </div>
      </div>
    `;

    const subtitle = modal.querySelector(".special-position-subtitle");
    if (subtitle) {
      subtitle.textContent = `Escolha a posição para "${safeName}".`;
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

  bindPreviewForElement(element, card, visible = true) {
    if (!element) return;
    element.dataset.previewable = visible ? "true" : "false";
    element.__cardData = visible ? card : null;

    element.addEventListener("mouseenter", () => {
      this.renderPreview(visible ? card : null);
    });
  }

  createCardElement(card, visible) {
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

  bindPhaseClick(handler) {
    if (!this.elements.phaseTrack) return;
    this.elements.phaseTrack.addEventListener("click", (e) => {
      const li = e.target.closest("li[data-phase]");
      if (!li) return;
      handler(li.dataset.phase);
    });
  }

  bindCardHover(handler) {
    const gameContainer = document.getElementById("game-container");
    if (!gameContainer) return;

    gameContainer.addEventListener("mouseover", (e) => {
      const cardEl = e.target.closest(".card");
      if (cardEl && !cardEl.classList.contains("hidden")) {
        const index = parseInt(cardEl.dataset.index);
        const location = cardEl.dataset.location;
        const owner = cardEl.closest("#player-area") ? "player" : "bot";
        handler(owner, location, index);
      }
    });
  }

  bindZoneCardClick(zoneId, handler) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    zone.addEventListener("click", (e) => {
      const cardEl = e.target.closest(".card");
      if (!cardEl) return;
      const index = Number.parseInt(cardEl.dataset.index, 10);
      if (Number.isNaN(index)) return;
      handler(e, cardEl, index);
    });
  }

  bindZoneClick(zoneId, handler) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    zone.addEventListener("click", (e) => handler(e));
  }

  bindPlayerHandClick(handler) {
    this.bindZoneCardClick("player-hand", handler);
  }

  bindPlayerFieldClick(handler) {
    this.bindZoneCardClick("player-field", handler);
  }

  bindPlayerSpellTrapClick(handler) {
    this.bindZoneCardClick("player-spelltrap", handler);
  }

  bindPlayerFieldSpellClick(handler) {
    this.bindZoneCardClick("player-fieldspell", handler);
  }

  bindBotFieldClick(handler) {
    this.bindZoneCardClick("bot-field", handler);
  }

  bindBotSpellTrapClick(handler) {
    this.bindZoneCardClick("bot-spelltrap", handler);
  }

  bindBotHandClick(handler) {
    this.bindZoneCardClick("bot-hand", handler);
  }

  bindBotFieldSpellClick(handler) {
    this.bindZoneCardClick("bot-fieldspell", handler);
  }

  bindPlayerGraveyardClick(handler) {
    this.bindZoneClick("player-graveyard", handler);
  }

  bindBotGraveyardClick(handler) {
    this.bindZoneClick("bot-graveyard", handler);
  }

  bindPlayerExtraDeckClick(handler) {
    this.bindZoneClick("player-extradeck", handler);
  }

  bindGraveyardModalClose(handler) {
    const closeBtn = document.querySelector(".close-modal");
    if (!closeBtn) return;
    closeBtn.addEventListener("click", handler);
  }

  bindExtraDeckModalClose(handler) {
    const closeBtn = document.querySelector(".close-extradeck");
    if (!closeBtn) return;
    closeBtn.addEventListener("click", handler);
  }

  bindModalOverlayClick(handler) {
    window.addEventListener("click", (e) => {
      const modal = document.getElementById("gy-modal");
      const extraModal = document.getElementById("extradeck-modal");
      if (e.target === modal) {
        handler("graveyard", e);
      }
      if (e.target === extraModal) {
        handler("extradeck", e);
      }
    });
  }

  bindGlobalKeydown(handler) {
    window.addEventListener("keydown", handler);
  }

  renderPreview(card) {
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

  log(message) {
    console.log(message);
    const logList = this.elements.actionLog;
    if (!logList) return;

    const entry = document.createElement("div");
    entry.className = "log-entry";

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");

    entry.innerHTML = `<span class="log-time">${hh}:${mm}:${ss}</span><span class="log-text">${message}</span>`;
    logList.appendChild(entry);

    const maxEntries = 80;
    while (logList.children.length > maxEntries) {
      logList.removeChild(logList.firstChild);
    }

    logList.scrollTop = logList.scrollHeight;
  }

  toggleModal(show) {
    const modal = document.getElementById("gy-modal");
    if (!modal) return;
    if (show) modal.classList.remove("hidden");
    else modal.classList.add("hidden");
  }

  renderGraveyardModal(cards, options = {}) {
    const grid = document.getElementById("gy-grid");
    const hintEl = document.getElementById("gy-hint");

    if (!grid) {
      console.warn("#gy-grid not found");
      return;
    }

    if (hintEl) {
      const msg = options.filterMessage || "";
      hintEl.textContent = msg;
      hintEl.style.display = msg ? "block" : "none";
    }

    grid.innerHTML = "";

    if (!cards || cards.length === 0) {
      grid.innerHTML = "<p>Graveyard is empty.</p>";
      return;
    }

    // Use DocumentFragment to minimize reflows
    const fragment = document.createDocumentFragment();

    cards.forEach((card, index) => {
      const cardEl = this.createCardElement(card, true);
      if (options.selectable) {
        cardEl.classList.add("gy-selectable");
        const disabled = options.isDisabled ? options.isDisabled(card) : false;
        if (disabled) {
          cardEl.classList.add("disabled");
        } else if (typeof options.onSelect === "function") {
          cardEl.addEventListener("click", () => options.onSelect(card, index));
        }
      }
      // Adiciona indicador visual de efeito ativável
      if (
        options.showActivatable &&
        typeof options.isActivatable === "function"
      ) {
        if (options.isActivatable(card)) {
          cardEl.classList.add("gy-activatable");
          const indicator = document.createElement("div");
          indicator.className = "gy-activate-indicator";
          indicator.textContent = "⚡";
          cardEl.appendChild(indicator);
        }
      }
      fragment.appendChild(cardEl);
    });

    grid.appendChild(fragment);
  }

  updateGYPreview(player) {
    const gyZone = document.getElementById(
      player.id === "player" ? "player-graveyard" : "bot-graveyard"
    );

    if (!gyZone) {
      console.warn("Graveyard zone not found for", player.id);
      return;
    }

    const existing = gyZone.querySelector(".gy-preview");
    if (existing) existing.remove();

    if (player.graveyard.length > 0) {
      const lastCard = player.graveyard[player.graveyard.length - 1];
      const preview = this.createCardElement(lastCard, true);
      preview.className = "card gy-preview";
      gyZone.appendChild(preview);
    }
  }

  updateExtraDeckPreview(player) {
    const extraZone = document.getElementById(
      player.id === "player" ? "player-extradeck" : "bot-extradeck"
    );

    if (!extraZone) return;

    // Clear existing content
    extraZone.innerHTML = "";

    // Create counter
    const count = player.extraDeck ? player.extraDeck.length : 0;
    const counter = document.createElement("div");
    counter.className = "zone-counter";
    counter.textContent = count > 0 ? `Extra\n${count}` : "Extra";
    extraZone.appendChild(counter);

    // Show preview of top card (only for player)
    if (player.id === "player" && count > 0) {
      const topCard = player.extraDeck[0];
      const preview = this.createCardElement(topCard, true);
      preview.className = "card extra-preview";
      preview.style.width = "60px";
      preview.style.height = "87px";
      preview.style.position = "absolute";
      preview.style.bottom = "5px";
      preview.style.right = "5px";
      preview.style.opacity = "0.3";
      extraZone.appendChild(preview);
    }
  }

  renderExtraDeckModal(cards) {
    const grid = document.getElementById("extradeck-modal-grid");

    if (!grid) {
      console.warn("#extradeck-modal-grid not found");
      return;
    }

    grid.innerHTML = "";

    if (!cards || cards.length === 0) {
      grid.innerHTML = "<p>Extra Deck is empty.</p>";
      return;
    }

    // Use DocumentFragment to minimize reflows
    const fragment = document.createDocumentFragment();

    cards.forEach((card) => {
      const cardEl = this.createCardElement(card, true);
      fragment.appendChild(cardEl);
    });

    grid.appendChild(fragment);
  }

  toggleExtraDeckModal(show) {
    const modal = document.getElementById("extradeck-modal");
    if (modal) {
      if (show) {
        modal.classList.remove("hidden");
      } else {
        modal.classList.add("hidden");
      }
    }
  }

  showTargetSelection(selectionContract, onConfirm, onCancel, config = {}) {
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
        statsDiv.textContent = `ATK ${cand.atk ?? "-"} / DEF ${
          cand.def ?? "-"
        }`;

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

  showFieldTargetingControls(onConfirm, onCancel, config = {}) {
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
      confirmBtn.disabled =
        selected < requiredMin || (max > 0 && selected > max);
    };

    updateState({ selected: 0, min: 0, max: 0, allowEmpty: true });

    return {
      updateState,
      close: () => this.hideFieldTargetingControls(),
    };
  }

  hideFieldTargetingControls() {
    const existing = document.querySelector(".field-targeting-controls");
    if (existing) {
      existing.remove();
    }
  }

  showDestructionNegationPrompt(cardName, costDescription, onDecision) {
    const existing = document.querySelector(".destruction-negation-modal");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.className = "modal destruction-negation-modal";

    const content = document.createElement("div");
    content.className = "modal-content target-content";

    const title = document.createElement("h3");
    title.textContent = `Deseja ativar o efeito de "${cardName}"?`;

    const desc = document.createElement("p");
    desc.textContent = costDescription ? `Custo: ${costDescription}` : "";

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

  showFusionTargetModal(availableFusions, onSelect, onCancel) {
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
      cardEl.className = "card fusion-selectable";
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

  showFusionMaterialSelection(
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
      cardEl.className = "card fusion-material-selectable";

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

  showCardGridSelectionModal(options) {
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
      const cardEl = renderCard
        ? renderCard(card, idx)
        : renderDefaultCard(card);
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

  showIgnitionActivateModal(card, onActivate) {
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

  showShadowHeartCathedralModal(validMonsters, maxAtk, counterCount, callback) {
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
      infoText: "Only Shadow-Heart monsters in your GY are valid.",
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

  showSickleSelectionModal(candidates, maxSelect, onConfirm, onCancel) {
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

  showConfirmPrompt(message, options = {}) {
    if (!message) return false;
    const { confirmLabel, cancelLabel } = options;
    if (confirmLabel || cancelLabel) {
      // TODO: replace with styled modal if we need custom labels.
    }
    return window.confirm(message);
  }

  showNumberPrompt(message, defaultValue) {
    const raw = window.prompt(message, defaultValue ?? "");
    if (raw === null || raw === undefined) return null;
    const parsed = Number.parseInt(String(raw), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  showAlert(message) {
    if (!message) return;
    window.alert(message);
  }

  getSearchModalElements() {
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

  showSearchModal(elements, candidates, defaultCard, onConfirm, allCards) {
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

  showSearchModalVisual(elements, candidates, defaultCard, onConfirm) {
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

    confirmBtn.onclick = () => {
      cleanup();
      if (selectedCard) {
        onConfirm(selectedCard.name);
      }
    };

    cancelBtn.onclick = () => {
      cleanup();
      if (defaultCard) {
        onConfirm(defaultCard);
      } else if (selectedCard) {
        onConfirm(selectedCard.name);
      }
    };

    overlay.onclick = (e) => {
      if (e.target === overlay) {
        cleanup();
        if (defaultCard) {
          onConfirm(defaultCard);
        } else if (selectedCard) {
          onConfirm(selectedCard.name);
        }
      }
    };

    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);
    modalContent.appendChild(actions);

    overlay.appendChild(modalContent);
    document.body.appendChild(overlay);
  }

  showTieBreakerSelection(options = {}) {
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

  showMultiSelectModal(cards = [], selectionRange = {}, onConfirm) {
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

  /**
   * Unified trap activation modal - handles both manual activation and chain response
   * @param {Object} options
   * @param {Array} options.cards - Array of {card, effect, zone} objects
   * @param {Object} options.context - Chain context (for response mode)
   * @param {string} options.mode - 'single' for manual, 'chain' for chain response
   * @returns {Promise<{card, effect, activate: boolean}|null>}
   */
  showUnifiedTrapModal(options = {}) {
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
        cardDesc.textContent =
          getCardDisplayDescription(card) || card.description || "";
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

  showTrapActivationModal(trapCard, event, eventData = {}) {
    return this.showUnifiedTrapModal({
      cards: [{ card: trapCard }],
      mode: "single",
    }).then((result) => result?.activate === true);
  }

  /**
   * Show a modal for chain response selection
   * @param {Array} activatable - Array of {card, effect, zone} objects
   * @param {Object} context - Chain context (type, event, etc.)
   * @param {Array} chainStack - Current chain stack for display
   * @returns {Promise<{card, effect, selections}|null>}
   */
  showChainResponseModal(activatable, context, chainStack = []) {
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
   * @param {Object} context
   * @returns {string}
   */
  _getContextDescription(context) {
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
}
