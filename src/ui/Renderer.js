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

  showSummonModal(cardIndex, callback) {
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
    modal.innerHTML = `
      <div class="summon-choice-content">
          <button id="btn-normal-summon">Normal Summon</button>
          <button id="btn-set">Set</button>
      </div>
    `;

    // posicionamento inteligente: tenta abaixo da carta,
    // e se não couber, abre acima; também evita sair pelas laterais
    modal.style.position = "fixed";
    modal.style.zIndex = "200";

    document.body.appendChild(modal);

    if (rect) {
      const content = modal.querySelector(".summon-choice-content") || modal;
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

    document.getElementById("btn-normal-summon").onclick = (e) => {
      e.stopPropagation();
      callback("attack");
      cleanup();
    };
    document.getElementById("btn-set").onclick = (e) => {
      e.stopPropagation();
      callback("defense");
      cleanup();
    };
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
    modal.innerHTML = `
      <div class="spell-choice-content">
        <button data-choice="activate">Activate</button>
        <button data-choice="set">Set</button>
      </div>
    `;

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
    modal.innerHTML = `
      <div class="position-choice-content">
        ${
          options.canFlip
            ? `<button data-choice="flip">Flip Summon</button>`
            : ""
        }
        ${
          options.canChangePosition && card?.position !== "attack"
            ? `<button data-choice="to_attack">To Attack</button>`
            : ""
        }
        ${
          options.canChangePosition && card?.position !== "defense"
            ? `<button data-choice="to_defense">To Defense</button>`
            : ""
        }
      </div>
    `;

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
        btn.innerHTML = `
          <div class="target-name">${cand.name}</div>
          <div class="target-meta">${cand.owner} ${cand.position || ""}</div>
          <div class="target-stats">ATK ${cand.atk ?? "-"} / DEF ${
          cand.def ?? "-"
        }</div>
        `;

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
}
