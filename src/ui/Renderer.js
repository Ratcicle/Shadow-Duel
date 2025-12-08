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

  renderHand(player) {
    const container =
      player.id === "player" ? this.elements.playerHand : this.elements.botHand;
    if (!container) return;

    container.innerHTML = "";

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

      container.appendChild(cardEl);
    });
  }

  renderField(player) {
    const container =
      player.id === "player"
        ? this.elements.playerField
        : this.elements.botField;
    if (!container) return;

    container.innerHTML = "";

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

      container.appendChild(cardEl);
    });
  }

  renderSpellTrap(player) {
    const container =
      player.id === "player"
        ? this.elements.playerSpellTrap
        : this.elements.botSpellTrap;
    if (!container) return;

    container.innerHTML = "";

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

      container.appendChild(cardEl);
    });
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

  showProtectorPrompt() {
    if (typeof document === "undefined") {
      return Promise.resolve(true);
    }

    const existing = document.querySelector(".protector-modal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.className = "protector-modal";
    modal.innerHTML = `
      <div class="protector-backdrop"></div>
      <div class="protector-content">
        <div class="protector-glow"></div>
        <header class="protector-header">
          <div class="protector-title">
            <span class="protector-label">Resposta do Sanctum</span>
            <strong>Luminarch Sanctum Protector</strong>
          </div>
          <span class="protector-pill">Quick Effect</span>
        </header>
        <p class="protector-text">
          Negar o ataque declarado e manter o campo Luminarch seguro?
        </p>
        <p class="protector-subtext">
          Se você recusar, o ataque continuará normalmente.
        </p>
        <div class="protector-actions">
          <button class="primary" data-choice="yes">Negar ataque</button>
          <button class="secondary" data-choice="no">Permitir ataque</button>
        </div>
      </div>
    `;

    const promise = new Promise((resolve) => {
      const cleanup = (result) => {
        modal.remove();
        resolve(result);
      };

      modal.addEventListener("click", (e) => {
        if (e.target.classList.contains("protector-backdrop")) {
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

  showSpellChoiceModal(cardIndex, callback) {
    const existingModal = document.querySelector(".spell-choice-modal");
    if (existingModal) {
      existingModal.remove();
    }

    const cardElement = document.querySelector(
      `#player-hand .card[data-index="${cardIndex}"]`
    );
    const rect = cardElement ? cardElement.getBoundingClientRect() : null;

    const modal = document.createElement("div");
    modal.className = "spell-choice-modal";
    const content = document.createElement("div");
    content.className = "spell-choice-content";

    const activateBtn = document.createElement("button");
    activateBtn.dataset.choice = "activate";
    activateBtn.textContent = "Activate";

    const setBtn = document.createElement("button");
    setBtn.dataset.choice = "set";
    setBtn.textContent = "Set";

    content.appendChild(activateBtn);
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

  showSpellActivateModal(cardEl, onActivate) {
    if (!cardEl) return;

    const existing = document.querySelector(".spell-activate-modal");
    if (existing) existing.remove();

    const rect = cardEl.getBoundingClientRect();

    const modal = document.createElement("div");
    modal.className = "spell-activate-modal";
    modal.innerHTML = `
      <div class="spell-choice-content single">
        <button data-choice="activate">Activate</button>
      </div>
    `;

    modal.style.position = "fixed";
    modal.style.zIndex = "200";
    document.body.appendChild(modal);

    if (rect) {
      const content = modal.querySelector(".spell-choice-content") || modal;
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
        if (choice === "activate" && typeof onActivate === "function") {
          onActivate();
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
        if (choice) {
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
    const safeName = (card?.name && card.name.trim()) || "este monstro";
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

  createCardElement(card, visible) {
    const el = document.createElement("div");
    el.className = "card";

    if (visible) {
      const isMonster = card.cardKind !== "spell" && card.cardKind !== "trap";
      const stars = "*".repeat(card.level || 0);
      const typeLabel = isMonster
        ? stars
        : `${(card.cardKind || "").toUpperCase()}${
            card.subtype ? " / " + card.subtype.toUpperCase() : ""
          }`;

      el.innerHTML = `
        <div class="card-header">
          <div class="card-name">${card.name}</div>
          <div class="card-level">${typeLabel}</div>
        </div>
        <div class="card-image" style="background-image: url('${
          card.image
        }'); background-size: cover; background-position: center;"></div>
        ${
          isMonster
            ? `<div class="card-stats">
                 <span class="stat-atk">ATK ${card.atk}</span>
                 <span class="stat-def">DEF ${card.def}</span>
               </div>`
            : `<div class="card-text">${
                card.description || "Effect card."
              }</div>`
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
    previewName.textContent = card.name;
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
    previewDesc.textContent = card.description || "No description available.";
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
      grid.appendChild(cardEl);
    });
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

    cards.forEach((card) => {
      const cardEl = this.createCardElement(card, true);
      grid.appendChild(cardEl);
    });
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

  showTargetSelection(options, onConfirm, onCancel) {
    const overlay = document.createElement("div");
    overlay.className = "modal target-modal";

    const content = document.createElement("div");
    content.className = "modal-content target-content";
    content.innerHTML = `<span class="close-target">&times;</span><h2>Select target(s)</h2>`;

    const selectionState = {};

    options.forEach((opt) => {
      const block = document.createElement("div");
      block.className = "target-block";
      block.innerHTML = `<p>Choose ${
        opt.min === opt.max ? opt.min : `${opt.min}-${opt.max}`
      } target(s) for ${opt.id}</p>`;

      const list = document.createElement("div");
      list.className = "target-list";

      opt.candidates.forEach((cand) => {
        const btn = document.createElement("button");
        btn.className = "target-btn";
        btn.dataset.targetId = opt.id;
        btn.dataset.idx = cand.idx;

        // Create card visual
        const cardImage = document.createElement("img");
        cardImage.src = cand.cardRef?.image || "assets/card-back.png";
        cardImage.alt = cand.name;
        cardImage.style.width = "100px";
        cardImage.style.height = "auto";
        cardImage.style.borderRadius = "4px";
        cardImage.style.marginBottom = "8px";
        cardImage.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.5)";

        const nameDiv = document.createElement("div");
        nameDiv.className = "target-name";
        nameDiv.textContent = cand.name;

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
          const arr = selectionState[opt.id] || [];
          const intIdx = parseInt(cand.idx);
          const already = arr.indexOf(intIdx);
          if (already > -1) {
            arr.splice(already, 1);
            btn.classList.remove("selected");
          } else {
            if (arr.length < opt.max) {
              arr.push(intIdx);
              btn.classList.add("selected");
            }
          }
          selectionState[opt.id] = arr;
        });

        list.appendChild(btn);
      });

      block.appendChild(list);
      content.appendChild(block);
    });

    const actions = document.createElement("div");
    actions.className = "target-actions";
    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = "Confirm";
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);
    content.appendChild(actions);

    overlay.appendChild(content);
    document.body.appendChild(overlay);

    const closeModal = () => {
      document.body.removeChild(overlay);
    };

    overlay.querySelector(".close-target").addEventListener("click", () => {
      closeModal();
      onCancel && onCancel();
    });

    cancelBtn.addEventListener("click", () => {
      closeModal();
      onCancel && onCancel();
    });

    confirmBtn.addEventListener("click", () => {
      // validate
      for (const opt of options) {
        const selected = selectionState[opt.id] || [];
        if (selected.length < opt.min || selected.length > opt.max) {
          alert(
            `Select ${
              opt.min === opt.max ? opt.min : `${opt.min}-${opt.max}`
            } target(s) for ${opt.id}`
          );
          return;
        }
      }
      closeModal();
      onConfirm && onConfirm(selectionState);
    });
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
      hint.innerHTML += `${count}x ${desc}<br>`;
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
      img.alt = card.name;
      img.className = "card-grid-image";

      const info = document.createElement("div");
      info.className = "card-grid-info";

      const name = document.createElement("div");
      name.className = "card-grid-name";
      name.textContent = card.name;
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

      grid.appendChild(cardEl);
    });

    modal.appendChild(grid);

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

  showTrapActivationModal(trapCard, event, eventData = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "trap-activation-overlay";

      const modal = document.createElement("div");
      modal.className = "trap-activation-modal";

      // Cabeçalho
      const header = document.createElement("div");
      header.className = "trap-modal-header";

      const title = document.createElement("h3");
      title.textContent = "Ativar Armadilha?";
      header.appendChild(title);

      // Imagem da carta
      const cardPreview = document.createElement("div");
      cardPreview.className = "trap-card-preview";

      const img = document.createElement("img");
      img.src = trapCard.image || "assets/card-back.png";
      img.alt = trapCard.name;
      img.className = "trap-card-image";
      cardPreview.appendChild(img);

      // Informações da carta
      const cardInfo = document.createElement("div");
      cardInfo.className = "trap-card-info";

      const cardName = document.createElement("div");
      cardName.className = "trap-card-name";
      cardName.textContent = trapCard.name;

      const cardDesc = document.createElement("div");
      cardDesc.className = "trap-card-description";
      cardDesc.textContent = trapCard.description;

      cardInfo.appendChild(cardName);
      cardInfo.appendChild(cardDesc);

      // Botões de ação
      const actions = document.createElement("div");
      actions.className = "trap-modal-actions";

      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Não Ativar";
      cancelBtn.className = "trap-btn-cancel";
      cancelBtn.onclick = () => {
        overlay.remove();
        resolve(false);
      };

      const confirmBtn = document.createElement("button");
      confirmBtn.textContent = "Ativar Armadilha";
      confirmBtn.className = "trap-btn-confirm";
      confirmBtn.onclick = () => {
        overlay.remove();
        resolve(true);
      };

      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);

      // Montar modal
      modal.appendChild(header);
      modal.appendChild(cardPreview);
      modal.appendChild(cardInfo);
      modal.appendChild(actions);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      // Foco no botão de confirmar
      confirmBtn.focus();
    });
  }

  getTrapEventDescription(event, eventData) {
    const descriptions = {
      attack_declared: "🗡️ Um ataque foi declarado!",
      after_summon: "✨ Um monstro foi invocado!",
      battle_destroy: "💥 Um monstro foi destruído em combate!",
      card_to_grave: "⚰️ Uma carta foi para o cemitério!",
      phase_end: "⏰ Final da fase - você pode ativar esta armadilha.",
    };

    let desc = descriptions[event] || "⚡ Um evento ocorreu!";

    if (eventData.isOpponentAttack) {
      desc += "<br><small>Ataque do oponente</small>";
    }
    if (eventData.isOpponentSummon) {
      desc += "<br><small>Invocação do oponente</small>";
    }

    return desc;
  }
}
