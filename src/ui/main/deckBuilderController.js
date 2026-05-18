import { cardDatabase, cardDatabaseById } from "../../data/cards.js";
import {
  formatCardKindSubtypeLine,
  formatMonsterDetailHtml,
  formatMonsterStatsLine,
} from "../../core/i18n.js";
import {
  MAX_DECK_SIZE,
  MAX_EXTRA_DECK_SIZE,
  MIN_DECK_SIZE,
  cardHasArchetype,
  cardHasArchetypeName,
  getSortedCardPool,
  inferDeckArchetype,
  loadBotPreset,
  saveBotPreset,
  sortDeck,
} from "./deckState.js";

export function createDeckBuilderController({
  dom,
  deckState,
  Bot,
  getCardDisplayDescription,
  getCardDisplayName,
}) {
  let poolFilterMode = "all";
  let currentBotPreset = loadBotPreset(Bot.getAvailablePresets());

  function getBotPresetLabel(presetId) {
    const preset =
      Bot.getAvailablePresets().find((item) => item.id === presetId) || null;
    return preset ? preset.label : "Shadow-Heart";
  }

  function updateBotPresetStatus() {
    if (dom.botPresetSelect && dom.botPresetSelect.value !== currentBotPreset) {
      dom.botPresetSelect.value = currentBotPreset;
    }
    if (dom.botPresetStatus) {
      dom.botPresetStatus.textContent = `Bot: ${getBotPresetLabel(
        currentBotPreset,
      )}`;
    }
  }

  function populateBotPresetDropdown() {
    if (!dom.botPresetSelect) return;
    dom.botPresetSelect.innerHTML = "";
    Bot.getAvailablePresets().forEach((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.label;
      dom.botPresetSelect.appendChild(option);
    });
    updateBotPresetStatus();
  }

  function setPreview(card) {
    if (!card) return;
    if (dom.preview.image) {
      dom.preview.image.style.backgroundImage = `url('${card.image}')`;
    }
    if (dom.preview.name) {
      dom.preview.name.textContent = getCardDisplayName(card) || card.name;
    }
    const isMonster = card.cardKind !== "spell" && card.cardKind !== "trap";
    const monsterStats = isMonster ? formatMonsterStatsLine(card) : null;
    if (dom.preview.atk) {
      dom.preview.atk.textContent = isMonster
        ? monsterStats.atk
        : "";
    }
    if (dom.preview.def) {
      dom.preview.def.textContent = isMonster
        ? monsterStats.def
        : "";
    }
    if (dom.preview.level) {
      if (isMonster) {
        dom.preview.level.innerHTML = formatMonsterDetailHtml(card);
      } else {
        dom.preview.level.textContent = formatCardKindSubtypeLine(card);
      }
    }
    if (dom.preview.desc) {
      dom.preview.desc.textContent =
        getCardDisplayDescription(card) || card.description || "Sem descrição.";
    }
  }

  function updatePoolFilterButtons() {
    if (!dom.filters.noArchetype) return;

    const isNoArchetype = poolFilterMode === "no_archetype";
    const isVoid = poolFilterMode === "void";
    const isShadowHeart = poolFilterMode === "shadow_heart";
    const isLuminarch = poolFilterMode === "luminarch";
    const isArcanist = poolFilterMode === "arcanist";

    dom.filters.noArchetype.classList.toggle("active", isNoArchetype);
    dom.filters.noArchetype.textContent = "Sem arquétipo";

    if (dom.filters.void) {
      dom.filters.void.classList.toggle("active", isVoid);
      dom.filters.void.textContent = "Void";
    }

    if (dom.filters.luminarch) {
      dom.filters.luminarch.classList.toggle("active", isLuminarch);
      dom.filters.luminarch.textContent = "Luminarch";
    }

    if (dom.filters.shadowHeart) {
      dom.filters.shadowHeart.classList.toggle("active", isShadowHeart);
      dom.filters.shadowHeart.textContent = "Shadow-Heart";
    }

    if (dom.filters.arcanist) {
      dom.filters.arcanist.classList.toggle("active", isArcanist);
      dom.filters.arcanist.textContent = "Arcanist";
    }
  }

  function renderDeckSlotControls() {
    const deckPresets = deckState.getDeckPresets();
    const activeDeckSlot = deckState.getActiveDeckSlot();

    if (dom.slotTabs) {
      dom.slotTabs.innerHTML = "";
      deckPresets.forEach((preset, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "deck-slot-tab";
        button.classList.toggle("active", index === activeDeckSlot);
        button.textContent = preset?.name || `Deck ${index + 1}`;
        button.title = button.textContent;
        button.addEventListener("click", () => {
          const currentName = dom.slotNameInput?.value;
          if (deckState.switchDeckSlot(index, currentName)) {
            render();
          }
        });
        dom.slotTabs.appendChild(button);
      });
    }

    if (dom.slotNameInput) {
      dom.slotNameInput.value =
        deckPresets[activeDeckSlot]?.name || `Deck ${activeDeckSlot + 1}`;
    }
  }

  function render() {
    updatePoolFilterButtons();
    renderDeckSlotControls();

    deckState.setCurrentDeck(deckState.getCurrentDeck());
    const currentDeck = deckState.getCurrentDeck();
    const currentExtraDeck = deckState.getCurrentExtraDeck();

    dom.deckGrid.innerHTML = "";
    dom.poolGrid.innerHTML = "";
    const counts = {};
    currentDeck.forEach((id) => {
      counts[id] = counts[id] || 0;
      counts[id]++;
    });
    dom.deckCount.textContent = `${currentDeck.length} / ${MAX_DECK_SIZE} (min ${MIN_DECK_SIZE})`;

    for (let i = 0; i < MAX_DECK_SIZE; i++) {
      const slot = document.createElement("div");
      slot.className = "deck-slot";
      const cardId = currentDeck[i];
      if (cardId) {
        const cardData = cardDatabaseById.get(cardId);
        if (cardData) {
          const cardEl = createCardThumb(cardData, getCardDisplayName);
          cardEl.onmouseenter = () => setPreview(cardData);
          cardEl.onclick = () => {
            currentDeck.splice(i, 1);
            render();
            setPreview(cardData);
          };
          slot.appendChild(cardEl);
        }
      }
      dom.deckGrid.appendChild(slot);
    }

    dom.extraDeckGrid.innerHTML = "";
    dom.extraDeckCount.textContent = `${currentExtraDeck.length} / ${MAX_EXTRA_DECK_SIZE}`;

    for (let i = 0; i < MAX_EXTRA_DECK_SIZE; i++) {
      const slot = document.createElement("div");
      slot.className = "deck-slot";
      const cardId = currentExtraDeck[i];
      if (cardId) {
        const cardData = cardDatabaseById.get(cardId);
        if (cardData) {
          const cardEl = createCardThumb(cardData, getCardDisplayName);
          cardEl.onmouseenter = () => setPreview(cardData);
          cardEl.onclick = () => {
            currentExtraDeck.splice(i, 1);
            render();
            setPreview(cardData);
          };
          slot.appendChild(cardEl);
        }
      }
      dom.extraDeckGrid.appendChild(slot);
    }

    const baseMainPool = cardDatabase.filter(
      (card) =>
        !card.monsterType ||
        (card.monsterType !== "fusion" && card.monsterType !== "ascension"),
    );
    const baseExtraPool = cardDatabase.filter(
      (card) =>
        card.monsterType === "fusion" || card.monsterType === "ascension",
    );

    const poolFilter = (card) => {
      if (poolFilterMode === "no_archetype") return !cardHasArchetype(card);
      if (poolFilterMode === "void") return cardHasArchetypeName(card, "Void");
      if (poolFilterMode === "luminarch") {
        return cardHasArchetypeName(card, "Luminarch");
      }
      if (poolFilterMode === "shadow_heart") {
        return cardHasArchetypeName(card, "Shadow-Heart");
      }
      if (poolFilterMode === "arcanist") {
        return cardHasArchetypeName(card, "Arcanist");
      }
      return true;
    };

    const sortedCards = getSortedCardPool(baseMainPool.filter(poolFilter));
    const extraCards = baseExtraPool.filter(poolFilter);

    const extraCounts = {};
    currentExtraDeck.forEach((id) => {
      extraCounts[id] = extraCounts[id] || 0;
      extraCounts[id]++;
    });

    extraCards.forEach((card) => {
      const cardEl = createCardThumb(card, getCardDisplayName);
      const count = extraCounts[card.id] || 0;
      const badge = document.createElement("div");
      badge.className = "pool-count fusion-count";
      badge.textContent = `${count}/1`;
      badge.style.background =
        card.monsterType === "ascension"
          ? "linear-gradient(135deg, #0066ff, #003399)"
          : "linear-gradient(135deg, #8b00ff, #4b0082)";
      cardEl.appendChild(badge);

      cardEl.onmouseenter = () => setPreview(card);
      cardEl.onclick = () => {
        if (currentExtraDeck.length >= MAX_EXTRA_DECK_SIZE) {
          alert(`Extra Deck está cheio (max ${MAX_EXTRA_DECK_SIZE}).`);
          return;
        }
        if (count >= 1) {
          alert("Apenas 1 cópia de cada monstro do Extra Deck por id.");
          return;
        }
        currentExtraDeck.push(card.id);
        render();
        setPreview(card);
      };

      dom.poolGrid.appendChild(cardEl);
    });

    sortedCards.forEach((card) => {
      const cardEl = createCardThumb(card, getCardDisplayName);
      const count = counts[card.id] || 0;
      const badge = document.createElement("div");
      badge.className = "pool-count";
      badge.textContent = `${count}/3`;
      cardEl.appendChild(badge);

      cardEl.onmouseenter = () => setPreview(card);
      cardEl.onclick = () => {
        if (currentDeck.length >= MAX_DECK_SIZE) {
          alert(`Limite de ${MAX_DECK_SIZE} cartas atingido.`);
          return;
        }
        const current = counts[card.id] || 0;
        if (current >= 3) return;
        currentDeck.push(card.id);
        render();
        setPreview(card);
      };

      dom.poolGrid.appendChild(cardEl);
    });

    const firstAvailable = extraCards[0] || sortedCards[0] || cardDatabase[0];
    if (firstAvailable) {
      setPreview(firstAvailable);
    }
  }

  function open(startScreenRoot) {
    startScreenRoot?.classList.add("hidden");
    dom.root?.classList.remove("hidden");
    render();
  }

  function close(startScreenRoot) {
    deckState.saveActiveDeckPreset(dom.slotNameInput?.value);
    dom.root?.classList.add("hidden");
    startScreenRoot?.classList.remove("hidden");
  }

  function saveAndClose(startScreenRoot) {
    deckState.saveDeck(deckState.getCurrentDeck());
    deckState.saveExtraDeck(deckState.getCurrentExtraDeck());
    close(startScreenRoot);
  }

  function prepareForDuel() {
    const currentDeck = deckState.getCurrentDeck();
    const currentExtraDeck = deckState.getCurrentExtraDeck();
    if (currentDeck.length < MIN_DECK_SIZE || currentDeck.length > MAX_DECK_SIZE) {
      alert(
        `O deck precisa ter entre ${MIN_DECK_SIZE} e ${MAX_DECK_SIZE} cartas.`,
      );
      return null;
    }
    deckState.saveDeck(currentDeck);
    deckState.saveExtraDeck(currentExtraDeck);
    return {
      deck: [...deckState.getCurrentDeck()],
      extraDeck: [...deckState.getCurrentExtraDeck()],
      botPreset: currentBotPreset,
      playerArchetype: inferDeckArchetype(deckState.getCurrentDeck()),
    };
  }

  function bind(startScreenRoot) {
    populateBotPresetDropdown();
    dom.cancelButton?.addEventListener("click", () => close(startScreenRoot));
    dom.saveButton?.addEventListener("click", () => saveAndClose(startScreenRoot));
    dom.slotNameInput?.addEventListener("input", () => {
      deckState.renameActiveDeckSlot(dom.slotNameInput.value);
      const activeDeckSlot = deckState.getActiveDeckSlot();
      const activeTab = dom.slotTabs?.children?.[activeDeckSlot];
      const name =
        deckState.getDeckPresets()[activeDeckSlot]?.name ||
        `Deck ${activeDeckSlot + 1}`;
      if (activeTab) {
        activeTab.textContent = name;
        activeTab.title = name;
      }
    });
    dom.slotNameInput?.addEventListener("change", () => {
      deckState.saveActiveDeckPreset(dom.slotNameInput.value);
    });
    bindFilter(dom.filters.noArchetype, "no_archetype");
    bindFilter(dom.filters.void, "void");
    bindFilter(dom.filters.luminarch, "luminarch");
    bindFilter(dom.filters.shadowHeart, "shadow_heart");
    bindFilter(dom.filters.arcanist, "arcanist");
    dom.botPresetSelect?.addEventListener("change", (event) => {
      const value = event.target.value;
      currentBotPreset = value;
      saveBotPreset(value);
      updateBotPresetStatus();
    });
  }

  function bindFilter(button, mode) {
    button?.addEventListener("click", () => {
      poolFilterMode = poolFilterMode === mode ? "all" : mode;
      render();
    });
  }

  return {
    bind,
    close,
    getCurrentBotPreset: () => currentBotPreset,
    open,
    prepareForDuel,
    render,
  };
}

export function createCardThumb(card, getCardDisplayName) {
  const el = document.createElement("div");
  el.className = "card-thumb";
  el.style.backgroundImage = `url('${card.image}')`;
  el.title = getCardDisplayName(card) || card.name;
  return el;
}
