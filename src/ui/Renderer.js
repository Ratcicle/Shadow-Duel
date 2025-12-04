export default class Renderer {
  constructor() {
    this.elements = {
      playerHand: document.getElementById("player-hand"),
      playerField: document.getElementById("player-field"),
      playerDeck: document.getElementById("player-deck"),
      playerGraveyard: document.getElementById("player-graveyard"),
      playerLP: document.getElementById("player-lp"),
      playerSpellTrap: document.getElementById("player-spelltrap"),
      botHand: document.getElementById("bot-hand"),
      botField: document.getElementById("bot-field"),
      botDeck: document.getElementById("bot-deck"),
      botGraveyard: document.getElementById("bot-graveyard"),
      botLP: document.getElementById("bot-lp"),
      botSpellTrap: document.getElementById("bot-spelltrap"),
      turnIndicator: document.getElementById("turn-indicator"),
      phaseTrack: document.getElementById("phase-track"),
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

    player.spellTrapZone.forEach((card, index) => {
      const cardEl = this.createCardElement(card, true);
      cardEl.dataset.index = index;
      cardEl.dataset.location = "spellTrap";

      if (card.isFacedown) {
        cardEl.classList.add("facedown");
        cardEl.innerHTML = '<div class="card-back"></div>';
      }

      container.appendChild(cardEl);
    });
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
            <h3>Summon Monster</h3>
            <button id="btn-attack">Attack Position</button>
            <button id="btn-defense">Set (Defense)</button>
            <button id="btn-cancel">Cancel</button>
        </div>
      `;

    if (rect) {
      modal.style.position = "fixed";
      modal.style.left = `${rect.left}px`;
      modal.style.top = `${rect.bottom + 10}px`;
      modal.style.zIndex = "200";
    }

    document.body.appendChild(modal);

    document.getElementById("btn-attack").onclick = () => {
      callback("attack");
      document.body.removeChild(modal);
    };
    document.getElementById("btn-defense").onclick = () => {
      callback("defense");
      document.body.removeChild(modal);
    };
    document.getElementById("btn-cancel").onclick = () => {
      document.body.removeChild(modal);
    };
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
        <div class="card-image" style="background-image: url('${card.image}'); background-size: cover; background-position: center;"></div>
        ${
          isMonster
            ? `<div class="card-stats">
                 <span class="stat-atk">ATK ${card.atk}</span>
                 <span class="stat-def">DEF ${card.def}</span>
               </div>`
            : `<div class="card-text">${card.description || "Effect card."}</div>`
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
    if (!card) return;

    const previewImage = document.getElementById("preview-image");
    const previewName = document.getElementById("preview-name");
    const previewAtk = document.getElementById("preview-atk");
    const previewDef = document.getElementById("preview-def");
    const previewLevel = document.getElementById("preview-level");
    const previewDesc = document.getElementById("preview-desc");

    if (!previewImage || !previewName || !previewAtk || !previewDef || !previewLevel || !previewDesc) {
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
