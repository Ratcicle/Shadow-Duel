import Game from "./core/Game.js";
import Bot from "./core/Bot.js";
import Renderer from "./ui/Renderer.js";
import { cardDatabase, cardDatabaseById } from "./data/cards.js";
import { validateCardDatabase } from "./core/CardDatabaseValidator.js";
import OnlineSessionController from "./net/OnlineSessionController.js";
import { ACTION_TYPES } from "./server/MessageProtocol.js";
import { handlePromptWithVisualModal } from "./ui/OnlinePromptAdapter.js";

import {
  initializeLocale,
  setLocale,
  getLocale,
  getCardDisplayDescription,
  getCardDisplayName,
} from "./core/i18n.js";

initializeLocale();

let game = null;
const cardKindOrder = { monster: 0, spell: 1, trap: 2 };
const TEST_MODE_KEY = "shadow_duel_test_mode";
const DEV_MODE_KEY = "shadow_duel_dev_mode";
const BOT_PRESET_KEY = "shadow_duel_bot_preset";
let testModeEnabled = loadTestModeFlag();
let devModeEnabled = loadDevModeFlag();
let currentBotPreset = loadBotPreset();
let latestValidationResult = null;
// Use the imported indexed map instead of creating a new one
const cardById = cardDatabaseById;
const MIN_DECK_SIZE = 20;
const MAX_DECK_SIZE = 30;
const MAX_EXTRA_DECK_SIZE = 10;

const startScreen = document.getElementById("start-screen");
const deckBuilder = document.getElementById("deck-builder");
const deckGrid = document.getElementById("deck-grid");
const extraDeckGrid = document.getElementById("extradeck-grid");
const poolGrid = document.getElementById("pool-grid");
const deckCountEl = document.getElementById("deck-count");
const extraDeckCountEl = document.getElementById("extradeck-count");
const botPresetSelect = document.getElementById("bot-preset-select");
const botPresetStatus = document.getElementById("bot-preset-status");
populateBotPresetDropdown();
updateBotPresetStatus();

const localeButtons = Array.from(document.querySelectorAll(".lang-toggle-btn"));

function updateLocaleButtons() {
  if (!localeButtons.length) return;
  const currentLang = getLocale();
  localeButtons.forEach((btn) => {
    const lang = btn.dataset.lang;
    const isActive = lang && lang === currentLang;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function bindLocaleToggle() {
  if (!localeButtons.length) return;
  localeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetLang = btn.dataset.lang;
      if (!targetLang || getLocale() === targetLang) {
        return;
      }
      setLocale(targetLang);
      location.reload();
    });
  });
}

updateLocaleButtons();
bindLocaleToggle();

const previewEls = {
  image: document.getElementById("deck-preview-image"),
  name: document.getElementById("deck-preview-name"),
  atk: document.getElementById("deck-preview-atk"),
  def: document.getElementById("deck-preview-def"),
  level: document.getElementById("deck-preview-level"),
  desc: document.getElementById("deck-preview-desc"),
};

const btnStartDuel = document.getElementById("btn-start-duel");
const btnDeckBuilder = document.getElementById("btn-deck-builder");
const btnDeckSave = document.getElementById("deck-save");
const btnDeckCancel = document.getElementById("deck-cancel");
const btnPoolFilterNoArchetype = document.getElementById(
  "deck-filter-no-archetype"
);
const btnPoolFilterShadowHeart = document.getElementById(
  "deck-filter-shadow-heart"
);
const btnPoolFilterLuminarch = document.getElementById("deck-filter-luminarch");
const btnPoolFilterVoid = document.getElementById("deck-filter-void");
const btnToggleTestMode = document.getElementById("btn-toggle-test-mode");
const btnToggleDevMode = document.getElementById("btn-toggle-dev-mode");
const validationMessagesEl = document.getElementById("validation-messages");
const devPanel = document.getElementById("dev-panel");
const devDrawPlayerSelect = document.getElementById("dev-draw-player");
const devDrawCountInput = document.getElementById("dev-draw-count");
const devDrawBtn = document.getElementById("dev-draw-btn");
const devGiveNameInput = document.getElementById("dev-give-name");
const devGivePlayerSelect = document.getElementById("dev-give-player");
const devGiveZoneSelect = document.getElementById("dev-give-zone");
const devGiveBtn = document.getElementById("dev-give-btn");
const devForcePhaseSelect = document.getElementById("dev-force-phase");
const devForcePhaseBtn = document.getElementById("dev-force-phase-btn");
const devSetupInput = document.getElementById("dev-setup-json");
const devApplySetupBtn = document.getElementById("dev-apply-setup");
const devSanityABtn = document.getElementById("dev-sanity-a");
const devSanityBBtn = document.getElementById("dev-sanity-b");
const devSanityCBtn = document.getElementById("dev-sanity-c");
const devSanityDBtn = document.getElementById("dev-sanity-d");
const devSanityEBtn = document.getElementById("dev-sanity-e");
const devSanityFBtn = document.getElementById("dev-sanity-f");
const devSanityGBtn = document.getElementById("dev-sanity-g");
const devSanityHBtn = document.getElementById("dev-sanity-h");
const devSanityIBtn = document.getElementById("dev-sanity-i");
const devSanityJBtn = document.getElementById("dev-sanity-j");
const devSanityKBtn = document.getElementById("dev-sanity-k");
const devSanityLBtn = document.getElementById("dev-sanity-l");
const devSanityMBtn = document.getElementById("dev-sanity-m");
const devSanityNBtn = document.getElementById("dev-sanity-n");
const devSanityOBtn = document.getElementById("dev-sanity-o");
const devResetDuelBtn = document.getElementById("dev-reset-duel");
// Online mode UI
const btnOnlineMode = document.getElementById("btn-online-mode");
const onlinePanel = document.getElementById("online-panel");
const onlineConnectBtn = document.getElementById("online-connect");
const onlineReadyBtn = document.getElementById("online-ready");
const onlineDisconnectBtn = document.getElementById("online-disconnect");
const onlineServerInput = document.getElementById("online-server-url");
const onlineRoomInput = document.getElementById("online-room-id");
const onlineNameInput = document.getElementById("online-player-name");
const onlineStatusEl = document.getElementById("online-status");
const onlineErrorEl = document.getElementById("online-error");
const onlineInlineErrorEl = document.getElementById("online-inline-error");
const onlineModeToggle = document.getElementById("btn-back-to-start");
const onlineActionPanel = document.getElementById("online-action-panel");
const onlineActionStatus = document.getElementById("online-action-status");
const onlineBtnNextPhase = document.getElementById("online-btn-next-phase");
const onlineBtnEndTurn = document.getElementById("online-btn-end-turn");

let currentDeck = loadDeck();
let currentExtraDeck = loadExtraDeck();
let poolFilterMode = "all"; // all | no_archetype | void | luminarch | shadow_heart
updateTestModeButton();
updateDevModeButton();
runCardDatabaseValidation({ silent: true });

let onlineMode = false;
let onlineSession = null;
let onlineRenderer = null;
let onlineSeat = null;
let onlineSnapshot = null;
let onlineSelectionActive = false; // Flag to block intent clicks during visual selection
let lastRenderedStateVersion = -1; // INVARIANTE A2: só re-render se stateVersion mudou
const onlineSelections = {
  handIndex: null,
  fieldIndex: null,
  targetIndex: null,
};
let activeOnlinePrompt = null;

// Export setter for OnlinePromptAdapter to control selection state
window.setOnlineSelectionActive = (active) => {
  onlineSelectionActive = active;
  console.log("[Online] Selection active:", active);
};

function getCardById(cardId) {
  return cardById.get(cardId);
}

function levelOf(card) {
  return typeof card?.level === "number" && !Number.isNaN(card.level)
    ? card.level
    : 0;
}

function sortDeck(deckIds = []) {
  return [...deckIds].sort((aId, bId) => {
    const cardA = getCardById(aId);
    const cardB = getCardById(bId);
    const kindA = (cardA?.cardKind || "").toLowerCase();
    const kindB = (cardB?.cardKind || "").toLowerCase();
    const orderA = cardKindOrder.hasOwnProperty(kindA)
      ? cardKindOrder[kindA]
      : 99;
    const orderB = cardKindOrder.hasOwnProperty(kindB)
      ? cardKindOrder[kindB]
      : 99;
    if (orderA !== orderB) return orderA - orderB;
    if (kindA === "monster" && kindB === "monster") {
      const levelA = levelOf(cardA);
      const levelB = levelOf(cardB);
      if (levelA !== levelB) return levelB - levelA;
    }
    const nameA = cardA?.name || "";
    const nameB = cardB?.name || "";
    return nameA.localeCompare(nameB);
  });
}

function loadDeck() {
  try {
    const stored = localStorage.getItem("shadow_duel_deck");
    if (stored) return sanitizeDeck(JSON.parse(stored));
  } catch (e) {
    console.warn("Failed to load deck", e);
  }
  return buildDefaultDeck();
}

function saveDeck(deck) {
  currentDeck = sortDeck(deck);
  localStorage.setItem("shadow_duel_deck", JSON.stringify(currentDeck));
}

function loadExtraDeck() {
  try {
    const stored = localStorage.getItem("shadow_duel_extra_deck");
    if (stored) return sanitizeExtraDeck(JSON.parse(stored));
  } catch (e) {
    console.warn("Failed to load extra deck", e);
  }
  return [];
}

function saveExtraDeck(extraDeck) {
  currentExtraDeck = [...extraDeck];
  localStorage.setItem(
    "shadow_duel_extra_deck",
    JSON.stringify(currentExtraDeck)
  );
}

function loadBotPreset() {
  try {
    const stored = localStorage.getItem(BOT_PRESET_KEY);
    if (stored) return stored;
  } catch (e) {
    console.warn("Failed to load bot preset", e);
  }
  return Bot.getAvailablePresets()[0]?.id || "shadowheart";
}

function saveBotPreset(preset) {
  try {
    localStorage.setItem(BOT_PRESET_KEY, preset);
  } catch (e) {
    console.warn("Failed to save bot preset", e);
  }
}

function getBotPresetLabel(presetId) {
  const preset =
    Bot.getAvailablePresets().find((p) => p.id === presetId) || null;
  return preset ? preset.label : "Shadow-Heart";
}

function updateBotPresetStatus() {
  if (botPresetSelect && botPresetSelect.value !== currentBotPreset) {
    botPresetSelect.value = currentBotPreset;
  }
  if (botPresetStatus) {
    botPresetStatus.textContent = `Bot: ${getBotPresetLabel(currentBotPreset)}`;
  }
}

function populateBotPresetDropdown() {
  if (!botPresetSelect) return;
  botPresetSelect.innerHTML = "";
  Bot.getAvailablePresets().forEach((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    botPresetSelect.appendChild(option);
  });
}

function loadTestModeFlag() {
  try {
    return localStorage.getItem(TEST_MODE_KEY) === "true";
  } catch (e) {
    console.warn("Failed to load test mode flag", e);
    return false;
  }
}

function saveTestModeFlag(enabled) {
  try {
    localStorage.setItem(TEST_MODE_KEY, enabled ? "true" : "false");
  } catch (e) {
    console.warn("Failed to save test mode flag", e);
  }
}

function updateTestModeButton() {
  if (!btnToggleTestMode) return;
  btnToggleTestMode.textContent = `Modo teste: ${
    testModeEnabled ? "ligado" : "desligado"
  }`;
  btnToggleTestMode.classList.toggle("active", testModeEnabled);
}

function loadDevModeFlag() {
  try {
    return localStorage.getItem(DEV_MODE_KEY) === "true";
  } catch (e) {
    console.warn("Failed to load dev mode flag", e);
    return false;
  }
}

function saveDevModeFlag(enabled) {
  try {
    localStorage.setItem(DEV_MODE_KEY, enabled ? "true" : "false");
  } catch (e) {
    console.warn("Failed to save dev mode flag", e);
  }
}

function updateDevModeButton() {
  if (!btnToggleDevMode) return;
  btnToggleDevMode.textContent = `Dev Mode: ${
    devModeEnabled ? "ligado" : "desligado"
  }`;
  btnToggleDevMode.classList.toggle("active", devModeEnabled);
  updateDevPanelVisibility();
}

function updateDevPanelVisibility() {
  if (!devPanel) return;
  devPanel.classList.toggle("hidden", !devModeEnabled);
}

function runCardDatabaseValidation(options = {}) {
  const { silent = false } = options;
  latestValidationResult = validateCardDatabase();
  showValidationMessages(latestValidationResult);
  if (latestValidationResult.errors.length) {
    console.error(
      "Card database validation errors:",
      latestValidationResult.errors
    );
    if (!silent) {
      alert(
        "N�o � poss�vel iniciar o duelo: h� erros no banco de cartas. Verifique os detalhes acima."
      );
    }
    return false;
  }
  if (latestValidationResult.warnings.length) {
    console.warn(
      "Card database validation warnings:",
      latestValidationResult.warnings
    );
  }
  return true;
}

function showValidationMessages(result) {
  if (!validationMessagesEl || !result) return;
  const shouldShowErrors = Array.isArray(result.errors)
    ? result.errors.length > 0
    : false;
  const shouldShowWarnings =
    devModeEnabled && Array.isArray(result.warnings)
      ? result.warnings.length > 0
      : false;

  if (!shouldShowErrors && !shouldShowWarnings) {
    validationMessagesEl.classList.add("hidden");
    validationMessagesEl.innerHTML = "";
    return;
  }

  const messages = [];
  if (shouldShowErrors) {
    messages.push(
      `<strong>${result.errors.length} erro(s) na base de cartas.</strong>`
    );
    messages.push(renderIssueList(result.errors, "error"));
  }
  if (shouldShowWarnings) {
    messages.push(
      `<strong>${result.warnings.length} aviso(s) encontrados.</strong>`
    );
    messages.push(renderIssueList(result.warnings, "warning"));
  }

  validationMessagesEl.innerHTML = messages.join("");
  validationMessagesEl.classList.remove("hidden");
}

function renderIssueList(issues, cssClass) {
  const MAX_ITEMS = 5;
  const listItems = issues
    .slice(0, MAX_ITEMS)
    .map(
      (issue) =>
        `<li class="${
          cssClass === "warning" ? "warning" : ""
        }">${formatIssueForDisplay(issue)}</li>`
    );
  if (issues.length > MAX_ITEMS) {
    listItems.push(
      `<li class="${cssClass === "warning" ? "warning" : ""}">+ ${
        issues.length - MAX_ITEMS
      } mais...</li>`
    );
  }
  return `<ul>${listItems.join("")}</ul>`;
}

function formatIssueForDisplay(issue) {
  const parts = [];
  if (typeof issue.cardId === "number") {
    parts.push(`ID ${issue.cardId}`);
  }
  if (issue.cardName) {
    parts.push(issue.cardName);
  }
  if (issue.effectIndex !== undefined && issue.effectIndex !== null) {
    parts.push(`Efeito ${issue.effectIndex}`);
  }
  if (issue.actionIndex !== undefined && issue.actionIndex !== null) {
    parts.push(`A��o ${issue.actionIndex}`);
  }
  const prefix = parts.length ? `[${parts.join(" | ")}] ` : "";
  return `${prefix}${issue.message || ""}`;
}

function sanitizeExtraDeck(extraDeck) {
  // Allow Fusion and Ascension monsters only; max 1 copy per id
  const valid = new Set(
    cardDatabase
      .filter(
        (c) => c.monsterType === "fusion" || c.monsterType === "ascension"
      )
      .map((c) => c.id)
  );
  const seen = new Set();
  const result = [];
  for (const id of extraDeck || []) {
    if (!valid.has(id)) continue;
    if (seen.has(id)) continue;
    if (result.length >= MAX_EXTRA_DECK_SIZE) break;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function sanitizeDeck(deck) {
  const valid = new Set(cardDatabase.map((c) => c.id));
  const counts = {};
  const result = [];
  for (const id of deck || []) {
    if (!valid.has(id)) continue;
    counts[id] = counts[id] || 0;
    if (counts[id] >= 3) continue;
    if (result.length >= MAX_DECK_SIZE) break;
    counts[id]++;
    result.push(id);
  }
  return sortDeck(topUpDeck(result));
}

function topUpDeck(deck) {
  const counts = {};
  deck.forEach((id) => {
    counts[id] = counts[id] || 0;
    counts[id]++;
  });
  const filled = [...deck];
  const targetSize = Math.max(
    MIN_DECK_SIZE,
    Math.min(MAX_DECK_SIZE, filled.length)
  );
  while (filled.length < targetSize) {
    for (const card of cardDatabase) {
      counts[card.id] = counts[card.id] || 0;
      // Do not auto-fill with Extra Deck monsters
      if (card.monsterType === "fusion" || card.monsterType === "ascension") {
        continue;
      }
      if (counts[card.id] < 3 && filled.length < targetSize) {
        filled.push(card.id);
        counts[card.id]++;
      }
    }
  }
  return filled;
}

function buildDefaultDeck() {
  return sortDeck(topUpDeck([]));
}

function setPreview(card) {
  if (!card) return;
  previewEls.image.style.backgroundImage = `url('${card.image}')`;
  previewEls.name.textContent = getCardDisplayName(card) || card.name;
  const isMonster = card.cardKind !== "spell" && card.cardKind !== "trap";
  previewEls.atk.textContent = isMonster
    ? `ATK: ${card.atk}`
    : card.cardKind.toUpperCase();
  previewEls.def.textContent = isMonster
    ? `DEF: ${card.def}`
    : card.subtype
    ? card.subtype.toUpperCase()
    : "";
  previewEls.level.textContent = isMonster ? `Level: ${card.level}` : "";
  previewEls.desc.textContent =
    getCardDisplayDescription(card) || card.description || "Sem descricao.";
}

function cardHasArchetype(card) {
  if (!card) return false;
  const archetypes = Array.isArray(card.archetypes)
    ? card.archetypes
    : card.archetype
    ? [card.archetype]
    : [];
  return archetypes.length > 0;
}

function cardHasArchetypeName(card, archetypeName) {
  if (!card || !archetypeName) return false;
  const archetypes = Array.isArray(card.archetypes)
    ? card.archetypes
    : card.archetype
    ? [card.archetype]
    : [];
  return archetypes.includes(archetypeName);
}

function updatePoolFilterButtons() {
  if (!btnPoolFilterNoArchetype) return;

  const isNoArchetype = poolFilterMode === "no_archetype";
  const isVoid = poolFilterMode === "void";
  const isShadowHeart = poolFilterMode === "shadow_heart";
  const isLuminarch = poolFilterMode === "luminarch";

  btnPoolFilterNoArchetype.classList.toggle("active", isNoArchetype);
  btnPoolFilterNoArchetype.textContent = "Sem arqu�tipo";

  if (btnPoolFilterVoid) {
    btnPoolFilterVoid.classList.toggle("active", isVoid);
    btnPoolFilterVoid.textContent = "Void";
  }

  if (btnPoolFilterLuminarch) {
    btnPoolFilterLuminarch.classList.toggle("active", isLuminarch);
    btnPoolFilterLuminarch.textContent = "Luminarch";
  }

  if (btnPoolFilterShadowHeart) {
    btnPoolFilterShadowHeart.classList.toggle("active", isShadowHeart);
    btnPoolFilterShadowHeart.textContent = "Shadow-Heart";
  }
}

function getSortedCardPool(cards) {
  const spellSubtypeOrder = { normal: 0, equip: 1, field: 2 };
  const nameOf = (card) => card.name || "";
  const levelOf = (card) =>
    typeof card.level === "number" && !Number.isNaN(card.level)
      ? card.level
      : 0;
  const kindOf = (card) => (card.cardKind || "").toLowerCase();
  const subtypeOf = (card) => (card.subtype || "").toLowerCase();

  const monsters = [];
  const spells = [];
  const traps = [];
  const others = [];

  cards.forEach((card) => {
    const kind = kindOf(card);
    if (kind === "monster") monsters.push(card);
    else if (kind === "spell") spells.push(card);
    else if (kind === "trap") traps.push(card);
    else others.push(card);
  });

  const sortedMonsters = monsters.sort((a, b) => {
    const levelA = levelOf(a);
    const levelB = levelOf(b);
    if (levelA !== levelB) return levelB - levelA;
    return nameOf(a).localeCompare(nameOf(b));
  });

  const sortedSpells = spells.sort((a, b) => {
    const subA = spellSubtypeOrder.hasOwnProperty(subtypeOf(a))
      ? spellSubtypeOrder[subtypeOf(a)]
      : 3;
    const subB = spellSubtypeOrder.hasOwnProperty(subtypeOf(b))
      ? spellSubtypeOrder[subtypeOf(b)]
      : 3;
    if (subA !== subB) return subA - subB;
    return nameOf(a).localeCompare(nameOf(b));
  });

  const sortedTraps = traps.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const sortedOthers = others.sort((a, b) =>
    nameOf(a).localeCompare(nameOf(b))
  );

  return [...sortedMonsters, ...sortedSpells, ...sortedTraps, ...sortedOthers];
}

function renderDeckBuilder() {
  updatePoolFilterButtons();
  currentDeck = sortDeck(currentDeck);
  deckGrid.innerHTML = "";
  poolGrid.innerHTML = "";
  const counts = {};
  currentDeck.forEach((id) => {
    counts[id] = counts[id] || 0;
    counts[id]++;
  });
  deckCountEl.textContent = `${currentDeck.length} / ${MAX_DECK_SIZE} (min ${MIN_DECK_SIZE})`;

  // Deck slots up to MAX_DECK_SIZE (6x5 grid default)
  for (let i = 0; i < MAX_DECK_SIZE; i++) {
    const slot = document.createElement("div");
    slot.className = "deck-slot";
    const cardId = currentDeck[i];
    if (cardId) {
      const cardData = cardDatabaseById.get(cardId);
      if (cardData) {
        const cardEl = createCardThumb(cardData);
        cardEl.onmouseenter = () => setPreview(cardData);
        cardEl.onclick = () => {
          currentDeck.splice(i, 1);
          renderDeckBuilder();
          setPreview(cardData);
        };
        slot.appendChild(cardEl);
      }
    }
    deckGrid.appendChild(slot);
  }

  // Extra Deck rendering
  currentExtraDeck = currentExtraDeck || [];
  extraDeckGrid.innerHTML = "";
  extraDeckCountEl.textContent = `${currentExtraDeck.length} / ${MAX_EXTRA_DECK_SIZE}`;

  for (let i = 0; i < MAX_EXTRA_DECK_SIZE; i++) {
    const slot = document.createElement("div");
    slot.className = "deck-slot";
    const cardId = currentExtraDeck[i];
    if (cardId) {
      const cardData = cardDatabaseById.get(cardId);
      if (cardData) {
        const cardEl = createCardThumb(cardData);
        cardEl.onmouseenter = () => setPreview(cardData);
        cardEl.onclick = () => {
          currentExtraDeck.splice(i, 1);
          renderDeckBuilder();
          setPreview(cardData);
        };
        slot.appendChild(cardEl);
      }
    }
    extraDeckGrid.appendChild(slot);
  }

  // Pool of all cards with counts
  const baseMainPool = cardDatabase.filter(
    (c) =>
      !c.monsterType ||
      (c.monsterType !== "fusion" && c.monsterType !== "ascension")
  );
  const baseExtraPool = cardDatabase.filter(
    (c) => c.monsterType === "fusion" || c.monsterType === "ascension"
  );

  const poolFilter = (card) => {
    if (poolFilterMode === "no_archetype") {
      return !cardHasArchetype(card);
    }
    if (poolFilterMode === "void") {
      return cardHasArchetypeName(card, "Void");
    }
    if (poolFilterMode === "luminarch") {
      return cardHasArchetypeName(card, "Luminarch");
    }
    if (poolFilterMode === "shadow_heart") {
      return cardHasArchetypeName(card, "Shadow-Heart");
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

  // Render Extra Deck monsters (Fusion + Ascension) first with different styling
  extraCards.forEach((card) => {
    const cardEl = createCardThumb(card);
    const count = extraCounts[card.id] || 0;
    const badge = document.createElement("div");
    // Reuse fusion styling for ascension as well
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
        alert(`Extra Deck est� cheio (max ${MAX_EXTRA_DECK_SIZE}).`);
        return;
      }
      if (count >= 1) {
        alert("Apenas 1 c f3pia de cada monstro do Extra Deck por id.");
        return;
      }
      currentExtraDeck.push(card.id);
      renderDeckBuilder();
      setPreview(card);
    };

    poolGrid.appendChild(cardEl);
  });

  // Render normal cards
  sortedCards.forEach((card) => {
    const cardEl = createCardThumb(card);
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
      renderDeckBuilder();
      setPreview(card);
    };

    poolGrid.appendChild(cardEl);
  });

  // Preview first card if none
  const firstAvailable = extraCards[0] || sortedCards[0] || cardDatabase[0];
  if (firstAvailable) {
    setPreview(firstAvailable);
  }
}

function createCardThumb(card) {
  const el = document.createElement("div");
  el.className = "card-thumb";
  el.style.backgroundImage = `url('${card.image}')`;
  el.title = getCardDisplayName(card) || card.name;
  return el;
}

function openDeckBuilder() {
  startScreen.classList.add("hidden");
  deckBuilder.classList.remove("hidden");
  renderDeckBuilder();
}

function closeDeckBuilder() {
  deckBuilder.classList.add("hidden");
  startScreen.classList.remove("hidden");
}

function startDuel() {
  if (!runCardDatabaseValidation()) {
    return;
  }
  if (
    currentDeck.length < MIN_DECK_SIZE ||
    currentDeck.length > MAX_DECK_SIZE
  ) {
    alert(
      `O deck precisa ter entre ${MIN_DECK_SIZE} e ${MAX_DECK_SIZE} cartas.`
    );
    return;
  }
  saveDeck(currentDeck);
  saveExtraDeck(currentExtraDeck);
  startScreen.classList.add("hidden");
  deckBuilder.classList.add("hidden");
  bootGame();
}

function bootGame() {
  const renderer = new Renderer();
  game = new Game({
    botPreset: currentBotPreset,
    devMode: devModeEnabled,
    renderer,
  });
  game.testModeEnabled = !!testModeEnabled;
  game.start([...currentDeck], [...currentExtraDeck]);
}

function restartCurrentDuelFromDev() {
  if (!runCardDatabaseValidation({ silent: true })) {
    alert("Corrija os erros do Card DB antes de reiniciar o duelo.");
    return;
  }
  startScreen.classList.add("hidden");
  deckBuilder.classList.add("hidden");
  bootGame();
}

// Online mode helpers

// Flag to track if online phase bindings are set up
let onlinePhaseBindingActive = false;

function bindOnlinePhaseTrack() {
  if (onlinePhaseBindingActive) return;

  const phaseTrack = document.getElementById("phase-track");
  if (!phaseTrack) return;

  phaseTrack.addEventListener("click", (e) => {
    if (!onlineMode) return;

    const li = e.target.closest("li[data-phase]");
    if (!li) return;

    const targetPhase = li.dataset.phase;
    if (!targetPhase) return;

    // Only allow phase changes during player's turn
    if (!onlineSnapshot) return;
    const isYourTurn = onlineSnapshot.currentPlayer === onlineSeat;
    if (!isYourTurn) {
      console.log("[Online] Phase click ignored - not your turn");
      return;
    }

    const currentPhase = onlineSnapshot.phase;
    const inActionablePhase =
      currentPhase === "main1" ||
      currentPhase === "battle" ||
      currentPhase === "main2";
    if (!inActionablePhase) {
      console.log("[Online] Phase click ignored - not in actionable phase");
      return;
    }

    // Map phase click to appropriate action
    if (targetPhase === "battle" && currentPhase === "main1") {
      console.log("[Online] Phase track: advancing to battle");
      onlineSession?.sendAction(ACTION_TYPES.NEXT_PHASE, {});
    } else if (targetPhase === "main2" && currentPhase === "battle") {
      console.log("[Online] Phase track: advancing to main2");
      onlineSession?.sendAction(ACTION_TYPES.NEXT_PHASE, {});
    } else if (targetPhase === "end") {
      console.log("[Online] Phase track: ending turn");
      onlineSession?.sendAction(ACTION_TYPES.END_TURN, {});
    }
  });

  onlinePhaseBindingActive = true;
}

function enterOnlineMode() {
  onlineMode = true;
  startScreen.classList.add("hidden");
  deckBuilder.classList.add("hidden");
  onlinePanel?.classList.remove("hidden");
  if (!onlineSession) {
    onlineSession = new OnlineSessionController();
  }
  onlineRenderer = onlineRenderer || new Renderer();

  // Reset state version tracking for new session
  lastRenderedStateVersion = -1;

  // Set up phase track binding for online mode
  bindOnlinePhaseTrack();

  updateOnlineStatus({
    connected: false,
    seat: null,
    roomId: onlineRoomInput?.value || "default",
  });
  clearOnlineSelections();
  refreshOnlineActionAvailability();
}

function exitOnlineMode() {
  onlineMode = false;
  onlineSession?.disconnect();
  onlineSnapshot = null;
  onlineSeat = null;
  lastRenderedStateVersion = -1; // Reset for next session
  clearOnlineSelections();
  onlinePanel?.classList.add("hidden");
  startScreen.classList.remove("hidden");
  closeOnlinePrompt();
  refreshOnlineActionAvailability();
}

function clearOnlineSelections() {
  onlineSelections.handIndex = null;
  onlineSelections.fieldIndex = null;
  onlineSelections.targetIndex = null;
}

function updateOnlineSelectionsText() {
  // Selections text removed in online alpha (modal-driven)
}

function updateOnlineStatus(status = {}) {
  if (onlineStatusEl) {
    const parts = [];
    parts.push(status.connected ? "Connected" : "Disconnected");
    if (status.seat) parts.push(`Seat: ${status.seat}`);
    if (status.roomId) parts.push(`Room: ${status.roomId}`);
    onlineStatusEl.textContent = parts.join(" • ");
  }
  if (status.message && onlineErrorEl) {
    onlineErrorEl.textContent = status.message;
  }
}

function renderOnlineSnapshot(snapshot, seat) {
  if (!snapshot || !seat) return;

  // INVARIANTE A2: Só re-renderizar se stateVersion mudou
  const incomingVersion = snapshot.stateVersion ?? 0;
  if (incomingVersion > 0 && incomingVersion <= lastRenderedStateVersion) {
    console.log("[Online] Skipping render, stateVersion not newer", {
      incoming: incomingVersion,
      last: lastRenderedStateVersion,
    });
    return;
  }
  lastRenderedStateVersion = incomingVersion;
  console.log("[Online] Rendering state", {
    version: incomingVersion,
    phase: snapshot.phase,
    turn: snapshot.turn,
  });

  if (onlineInlineErrorEl) {
    onlineInlineErrorEl.textContent = "";
  }
  onlineSnapshot = snapshot;
  onlineSeat = seat;
  const selfView = snapshot.players?.self || {};
  const oppView = snapshot.players?.opponent || {};

  // Clamp selections if indices no longer exist
  // No selection clamping needed in modal-driven flow

  const mapCardVisible = (cardView, isSelf, isSpellTrap = false) => {
    if (!cardView) return null;
    // Determine visibility first - own cards are always visible, opponent's only if not facedown
    const visible = isSelf || !cardView.faceDown;
    // Get card data from database for visible cards (own or opponent's face-up)
    const baseData =
      visible && cardView.cardId
        ? cardDatabaseById.get(cardView.cardId) || {}
        : {};
    const baseImage =
      baseData && typeof baseData.image === "string" ? baseData.image : null;
    const isFaceDown = !!cardView.faceDown;
    const card = {
      id: cardView.cardId ?? baseData.id ?? 0,
      name:
        visible && cardView.name
          ? cardView.name
          : isFaceDown
          ? "Face-down"
          : baseData.name || cardView.name || "Unknown",
      cardKind: cardView.cardKind || baseData.cardKind || "monster",
      subtype: cardView.subtype || baseData.subtype || null,
      position: cardView.position || "attack",
      atk: visible ? cardView.atk ?? baseData.atk ?? 0 : null,
      def: visible ? cardView.def ?? baseData.def ?? 0 : null,
      level: visible ? cardView.level ?? baseData.level ?? 0 : null,
      isFacedown: isFaceDown,
      faceDown: isFaceDown,
      image: visible ? baseImage : null,
    };
    if (isSpellTrap && card.cardKind === "monster") {
      card.cardKind = "spell";
    }
    return card;
  };

  const buildHand = (view, isSelf) => {
    if (Array.isArray(view.hand)) {
      return view.hand.map((h) => mapCardVisible(h, isSelf));
    }
    const count = view.handCount || (view.hand && view.hand.count) || 0;
    return Array.from({ length: count }, () => ({
      id: 0,
      name: "Unknown",
      cardKind: "unknown",
      isFacedown: true,
      faceDown: true,
    }));
  };

  const buildField = (view, isSelf) =>
    (view.field || []).map((slot) => mapCardVisible(slot, isSelf));

  const buildSpellTrap = (view, isSelf) =>
    Array.isArray(view.spellTrap)
      ? view.spellTrap.map((slot) => mapCardVisible(slot, isSelf, true))
      : [];

  const selfPlayer = {
    id: "player",
    name: selfView.name || "You",
    lp: selfView.lp ?? 8000,
    hand: buildHand(selfView, true),
    field: buildField(selfView, true),
    spellTrap: buildSpellTrap(selfView, true),
    fieldSpell: selfView.fieldSpell
      ? mapCardVisible(selfView.fieldSpell, true, true)
      : null,
  };

  const oppPlayer = {
    id: "bot",
    name: oppView.name || "Opponent",
    lp: oppView.lp ?? 8000,
    hand: buildHand(oppView, false),
    field: buildField(oppView, false),
    spellTrap: buildSpellTrap(oppView, false),
    fieldSpell: oppView.fieldSpell
      ? mapCardVisible(oppView.fieldSpell, false, true)
      : null,
  };

  // Render using existing renderer pipeline
  onlineRenderer.renderHand(selfPlayer);
  onlineRenderer.renderField(selfPlayer);
  onlineRenderer.renderSpellTrap(selfPlayer);
  onlineRenderer.renderFieldSpell(selfPlayer);

  onlineRenderer.renderHand(oppPlayer);
  onlineRenderer.renderField(oppPlayer);
  onlineRenderer.renderSpellTrap(oppPlayer);
  onlineRenderer.renderFieldSpell(oppPlayer);

  onlineRenderer.updateLP(selfPlayer);
  onlineRenderer.updateLP(oppPlayer);

  const activeIsSelf = snapshot.currentPlayer === seat;
  const currentTurnPlayer = activeIsSelf ? selfPlayer : oppPlayer;
  onlineRenderer.updateTurn(currentTurnPlayer);
  onlineRenderer.updatePhaseTrack(snapshot.phase || "draw");

  // Indicador visual de turno: borda brilhante no campo do jogador ativo
  const playerAreaEl = document.getElementById("player-area");
  const botAreaEl = document.getElementById("bot-area");
  if (playerAreaEl && botAreaEl) {
    if (activeIsSelf) {
      playerAreaEl.classList.add("active-turn");
      botAreaEl.classList.remove("active-turn");
    } else {
      playerAreaEl.classList.remove("active-turn");
      botAreaEl.classList.add("active-turn");
    }
  }

  refreshOnlineActionAvailability();
  updateOnlineSelectionsText();
  updateDebugHUD(snapshot);
}

/**
 * E3: Debug HUD overlay para desenvolvimento
 * Mostra stateVersion, phase, isResolvingEffect, pendingPromptType
 * Ativado por Ctrl+Shift+D ou toggleDebugHUD()
 */
let debugHUDVisible = false;

function updateDebugHUD(snapshot) {
  // Mostrar se devMode está ativo OU se HUD foi explicitamente ativado
  if (!devModeEnabled && !debugHUDVisible) return;

  let debugHUD = document.getElementById("online-debug-hud");
  if (!debugHUD) {
    debugHUD = document.createElement("div");
    debugHUD.id = "online-debug-hud";
    debugHUD.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.85);
      color: #0f0;
      font-family: monospace;
      font-size: 11px;
      padding: 8px 12px;
      border-radius: 4px;
      z-index: 9999;
      min-width: 200px;
      border: 1px solid #0f0;
    `;
    document.body.appendChild(debugHUD);
  }

  debugHUD.style.display = "block";

  const version = snapshot?.stateVersion ?? "N/A";
  const phase = snapshot?.phase ?? "N/A";
  const turn = snapshot?.turn ?? "N/A";
  const isResolving = snapshot?.isResolvingEffect ?? false;
  const pendingPrompt =
    snapshot?.pendingPromptType ?? activeOnlinePrompt?.type ?? "none";
  const turnCounter = snapshot?.turnCounter ?? 0;
  const isYourTurn = snapshot?.currentPlayer === onlineSeat;

  debugHUD.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 4px; color: #ff0;">🔧 DEBUG HUD</div>
    <div>stateVersion: <span style="color: #0ff;">${version}</span></div>
    <div>phase: <span style="color: #0ff;">${phase}</span></div>
    <div>turn: <span style="color: #0ff;">${turn}</span></div>
    <div>turnCounter: <span style="color: #0ff;">${turnCounter}</span></div>
    <div>yourTurn: <span style="color: ${isYourTurn ? "#0f0" : "#f00"};">${
    isYourTurn ? "✓" : "✗"
  }</span></div>
    <div>isResolving: <span style="color: ${
      isResolving ? "#f00" : "#0f0"
    };">${isResolving}</span></div>
    <div>pendingPrompt: <span style="color: ${
      pendingPrompt !== "none" ? "#ff0" : "#0f0"
    };">${pendingPrompt}</span></div>
    <div>selectionActive: <span style="color: ${
      onlineSelectionActive ? "#f00" : "#0f0"
    };">${onlineSelectionActive}</span></div>
    <div>lastRenderVer: <span style="color: #0ff;">${lastRenderedStateVersion}</span></div>
    <div style="font-size: 9px; color: #888; margin-top: 4px;">Ctrl+Shift+D para toggle</div>
  `;
}

function toggleDebugHUD() {
  debugHUDVisible = !debugHUDVisible;
  const debugHUD = document.getElementById("online-debug-hud");

  if (!debugHUDVisible && debugHUD) {
    debugHUD.style.display = "none";
  } else if (debugHUDVisible && onlineSnapshot) {
    updateDebugHUD(onlineSnapshot);
  }

  console.log("[Debug] HUD", debugHUDVisible ? "ENABLED" : "DISABLED");
}

// Expor globalmente para uso no console
window.toggleDebugHUD = toggleDebugHUD;

// Atalho de teclado: Ctrl+Shift+D
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
    e.preventDefault();
    toggleDebugHUD();
  }
});

function refreshOnlineActionAvailability() {
  const hasSnapshot = !!onlineSnapshot;
  const isYourTurn =
    hasSnapshot && onlineSnapshot.currentPlayer === (onlineSeat || "player");
  const disableAll = !onlineMode || !hasSnapshot;

  const setDisabled = (el, disabled) => {
    if (!el) return;
    el.disabled = !!disabled;
  };

  setDisabled(onlineBtnNextPhase, disableAll || !isYourTurn);
  setDisabled(onlineBtnEndTurn, disableAll || !isYourTurn);

  if (onlineActionStatus) {
    const turnPart = hasSnapshot
      ? `Turn: ${onlineSnapshot.turn}`
      : "Awaiting state...";
    const phasePart = hasSnapshot ? `Phase: ${onlineSnapshot.phase}` : "";
    onlineActionStatus.textContent = [turnPart, phasePart]
      .filter(Boolean)
      .join(" | ");
  }
}

function handleOnlineError(err) {
  const message =
    err?.message || err?.reason || (typeof err === "string" ? err : null);
  const hint = err?.hint;
  const code = err?.code;
  const finalMsg = message
    ? hint
      ? `${message} (${hint})`
      : message
    : "Unknown error from server";

  // Se o oponente desconectou, mostrar modal especial
  if (code === "opponent_left") {
    showDisconnectModal(finalMsg);
    return;
  }

  if (onlineErrorEl) {
    onlineErrorEl.textContent = finalMsg;
  }
  if (onlineInlineErrorEl) {
    onlineInlineErrorEl.textContent = finalMsg;
  }
  console.warn("[Online] error", err);
}

function showDisconnectModal(message) {
  closeOnlinePrompt();

  const overlay = document.createElement("div");
  overlay.className = "online-prompt-overlay disconnect-overlay";

  const modal = document.createElement("div");
  modal.className = "online-prompt-modal disconnect-modal";

  const icon = document.createElement("div");
  icon.textContent = "⚠️";
  icon.className = "disconnect-icon";
  modal.appendChild(icon);

  const title = document.createElement("h2");
  title.textContent = "Opponent Disconnected";
  title.className = "disconnect-title";
  modal.appendChild(title);

  const desc = document.createElement("p");
  desc.textContent = message || "Your opponent has left the match.";
  desc.className = "disconnect-message";
  modal.appendChild(desc);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Return to Menu";
  closeBtn.onclick = () => {
    overlay.remove();
    exitOnlineMode();
  };
  modal.appendChild(closeBtn);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  console.log("[Online] Opponent disconnected");
}

function closeOnlinePrompt() {
  if (activeOnlinePrompt?.overlay) {
    activeOnlinePrompt.overlay.remove();
  }
  activeOnlinePrompt = null;
}

function showGameOverModal(msg) {
  closeOnlinePrompt();

  const isVictory = msg.result === "victory";
  const reasonText =
    msg.reason === "lp_zero"
      ? "LP reduced to 0"
      : msg.reason === "deck_out"
      ? "Deck out"
      : msg.reason || "Game ended";

  const overlay = document.createElement("div");
  overlay.className = "online-prompt-overlay game-over-overlay";
  overlay.id = "game-over-overlay";

  const modal = document.createElement("div");
  modal.className = "online-prompt-modal game-over-modal";

  const title = document.createElement("h2");
  title.textContent = isVictory ? "🏆 Victory!" : "💀 Defeat";
  title.className = isVictory ? "game-over-victory" : "game-over-defeat";
  modal.appendChild(title);

  const reason = document.createElement("p");
  reason.textContent = reasonText;
  reason.className = "game-over-reason";
  modal.appendChild(reason);

  const buttonsDiv = document.createElement("div");
  buttonsDiv.className = "game-over-buttons";

  const rematchBtn = document.createElement("button");
  rematchBtn.textContent = "🔄 Rematch";
  rematchBtn.id = "rematch-btn";
  rematchBtn.onclick = () => {
    rematchBtn.disabled = true;
    rematchBtn.textContent = "⏳ Waiting for opponent...";
    onlineSession?.sendRematchRequest();
  };
  buttonsDiv.appendChild(rematchBtn);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Exit";
  closeBtn.onclick = () => {
    overlay.remove();
    exitOnlineMode();
  };
  buttonsDiv.appendChild(closeBtn);

  modal.appendChild(buttonsDiv);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  console.log("[Online] Game Over:", msg);
}

function handleRematchStatus(msg) {
  const rematchBtn = document.getElementById("rematch-btn");

  if (msg.ready) {
    // Rematch aceito por ambos - fechar modal, jogo vai reiniciar
    const overlay = document.getElementById("game-over-overlay");
    if (overlay) overlay.remove();
    console.log("[Online] Rematch starting!");
    return;
  }

  // Atualizar texto do botão baseado no status
  if (rematchBtn) {
    const iWantRematch =
      (onlineSeat === "player" && msg.playerWants) ||
      (onlineSeat === "bot" && msg.botWants);
    const opponentWants =
      (onlineSeat === "player" && msg.botWants) ||
      (onlineSeat === "bot" && msg.playerWants);

    if (iWantRematch && !opponentWants) {
      rematchBtn.textContent = "⏳ Waiting for opponent...";
      rematchBtn.disabled = true;
    } else if (!iWantRematch && opponentWants) {
      rematchBtn.textContent = "🔄 Opponent wants rematch!";
      rematchBtn.disabled = false;
    }
  }
}

function showOnlinePrompt(prompt) {
  closeOnlinePrompt();
  if (!prompt) return;
  console.log("[Online] prompt_request", prompt);

  // Use visual modals via adapter (mirrors offline experience)
  handlePromptWithVisualModal(
    prompt,
    onlineRenderer,
    onlineSnapshot,
    (promptId, choice) => {
      onlineSession?.sendPromptResponse(promptId, choice);
    }
  );
}

function requireOnlineState(options = {}) {
  const { needMain = false, needBattle = false } = options;
  if (!onlineSnapshot) {
    handleOnlineError({ message: "Sem estado do servidor ainda." });
    return false;
  }
  const isYourTurn = onlineSnapshot.currentPlayer === (onlineSeat || "player");
  if (!isYourTurn) {
    handleOnlineError({ message: "Nao e seu turno." });
    return false;
  }
  const phase = onlineSnapshot.phase || "";
  const inMain = phase === "main1" || phase === "main2";
  if (needMain && !inMain) {
    handleOnlineError({ message: "So e permitido na Main Phase." });
    return false;
  }
  if (needBattle && phase !== "battle") {
    handleOnlineError({ message: "So e permitido na Battle Phase." });
    return false;
  }
  return true;
}

function bindOnlineCardClicks() {
  console.log("[Online] Binding card click handlers");
  // Global click tap to ensure listeners are active
  document.addEventListener(
    "click",
    (e) => {
      const targetInfo = e.target?.className || e.target?.id || e.target;
      console.log("[Online] document click", targetInfo);
    },
    { capture: true, passive: true }
  );

  const addHandler = (zoneId, handler) => {
    const zone = document.getElementById(zoneId);
    if (!zone) {
      console.warn("[Online] zone not found", zoneId);
      return;
    }
    console.log("[Online] binding clicks for", zoneId, zone);
    zone.addEventListener("click", (e) => {
      const cardEl = e.target.closest(".card");
      if (!cardEl) {
        console.log("[Online] click ignored (no .card)", zoneId, e.target);
        return;
      }
      const idx = Number.parseInt(cardEl.dataset.index, 10);
      if (Number.isNaN(idx)) {
        console.log("[Online] click ignored (no index)", zoneId, cardEl);
        return;
      }
      if (!onlineMode) {
        console.log("[Online] click ignored (online mode off)", zoneId);
        if (onlineInlineErrorEl) {
          onlineInlineErrorEl.textContent = "Entre no modo online para jogar.";
        }
        return;
      }
      if (!onlineSnapshot) {
        console.log("[Online] click ignored (no snapshot yet)", zoneId);
        if (onlineInlineErrorEl) {
          onlineInlineErrorEl.textContent = "Aguardando estado do servidor.";
        }
        return;
      }
      console.log("[Online] zone click", zoneId, "idx", idx);
      // If visual selection is active, don't send intent to server
      if (onlineSelectionActive) {
        console.log("[Online] click ignored (selection active)", zoneId);
        return;
      }
      handler(idx, cardEl);
    });
  };

  addHandler("player-hand", (idx) => {
    console.log("[Online] hand click -> intent", idx);
    onlineSession?.sendIntentCardClick("hand", idx);
  });

  addHandler("player-field", (idx) => {
    console.log("[Online] field click -> intent", idx);
    onlineSession?.sendIntentCardClick("field", idx);
  });

  addHandler("bot-field", (idx) => {
    console.log("[Online] opponent field click -> intent", idx);
    onlineSession?.sendIntentCardClick("opponentField", idx);
  });
}

btnDeckBuilder?.addEventListener("click", openDeckBuilder);
btnDeckCancel?.addEventListener("click", closeDeckBuilder);
btnDeckSave?.addEventListener("click", () => {
  saveDeck(currentDeck);
  saveExtraDeck(currentExtraDeck);
  closeDeckBuilder();
});
btnPoolFilterNoArchetype?.addEventListener("click", () => {
  poolFilterMode = poolFilterMode === "no_archetype" ? "all" : "no_archetype";
  renderDeckBuilder();
});
btnPoolFilterVoid?.addEventListener("click", () => {
  poolFilterMode = poolFilterMode === "void" ? "all" : "void";
  renderDeckBuilder();
});
btnPoolFilterLuminarch?.addEventListener("click", () => {
  poolFilterMode = poolFilterMode === "luminarch" ? "all" : "luminarch";
  renderDeckBuilder();
});
btnPoolFilterShadowHeart?.addEventListener("click", () => {
  poolFilterMode = poolFilterMode === "shadow_heart" ? "all" : "shadow_heart";
  renderDeckBuilder();
});
btnStartDuel?.addEventListener("click", startDuel);
btnOnlineMode?.addEventListener("click", enterOnlineMode);
onlineModeToggle?.addEventListener("click", exitOnlineMode);
botPresetSelect?.addEventListener("change", (e) => {
  const value = e.target.value;
  currentBotPreset = value;
  saveBotPreset(value);
  updateBotPresetStatus();
});
onlineConnectBtn?.addEventListener("click", () => {
  if (!onlineSession) {
    onlineSession = new OnlineSessionController();
  }
  onlineSession.setHandlers({
    start: (msg) => {
      updateOnlineStatus({
        connected: true,
        seat: msg.youAre,
        roomId: msg.roomId,
      });
    },
    state: (state, seat) => {
      onlineErrorEl.textContent = "";
      if (onlineInlineErrorEl) onlineInlineErrorEl.textContent = "";
      closeOnlinePrompt();
      renderOnlineSnapshot(state, seat);
    },
    error: (err) => {
      handleOnlineError(err);
    },
    prompt: (prompt) => {
      if (onlineInlineErrorEl) onlineInlineErrorEl.textContent = "";
      showOnlinePrompt(prompt);
    },
    gameOver: (msg) => {
      showGameOverModal(msg);
    },
    rematchStatus: (msg) => {
      handleRematchStatus(msg);
    },
    status: updateOnlineStatus,
  });

  const url = onlineServerInput?.value || "ws://localhost:8080";
  const roomId = onlineRoomInput?.value || "default";
  const name = onlineNameInput?.value || null;
  onlineSession.connect(url, roomId, name);
});
onlineReadyBtn?.addEventListener("click", () => {
  onlineSession?.ready();
  onlinePanel?.classList.add("hidden");
});
onlineDisconnectBtn?.addEventListener("click", () => {
  exitOnlineMode();
});
onlineBtnNextPhase?.addEventListener("click", () => {
  if (!requireOnlineState()) return;
  onlineSession?.sendAction(ACTION_TYPES.NEXT_PHASE, {});
});
onlineBtnEndTurn?.addEventListener("click", () => {
  if (!requireOnlineState()) return;
  onlineSession?.sendAction(ACTION_TYPES.END_TURN, {});
});
btnToggleTestMode?.addEventListener("click", () => {
  testModeEnabled = !testModeEnabled;
  saveTestModeFlag(testModeEnabled);
  updateTestModeButton();
});
btnToggleDevMode?.addEventListener("click", () => {
  devModeEnabled = !devModeEnabled;
  saveDevModeFlag(devModeEnabled);
  updateDevModeButton();
  if (game && typeof game.setDevMode === "function") {
    game.setDevMode(devModeEnabled);
  }
  showValidationMessages(latestValidationResult);
});

devDrawBtn?.addEventListener("click", () => {
  if (!requireActiveGameForDev()) return;
  const playerId = devDrawPlayerSelect?.value || "player";
  const count = Math.max(1, parseInt(devDrawCountInput?.value, 10) || 1);
  const result = game.devDraw(playerId, count);
  if (!result.success) {
    alert(result.reason || "N�o foi poss�vel comprar cartas.");
  }
});

devGiveBtn?.addEventListener("click", () => {
  if (!requireActiveGameForDev()) return;
  const cardName = devGiveNameInput?.value?.trim();
  if (!cardName) {
    alert("Informe o nome da carta.");
    return;
  }
  const options = {
    playerId: devGivePlayerSelect?.value || "player",
    cardName,
    zone: devGiveZoneSelect?.value || "hand",
  };
  const result = game.devGiveCard(options);
  if (!result.success) {
    alert(result.reason || "N�o foi poss�vel adicionar a carta.");
  }
});

devForcePhaseBtn?.addEventListener("click", () => {
  if (!requireActiveGameForDev()) return;
  const phase = devForcePhaseSelect?.value || "main1";
  const result = game.devForcePhase(phase);
  if (!result.success) {
    alert(result.reason || "N�o foi poss�vel for�ar a fase.");
  }
});

devApplySetupBtn?.addEventListener("click", () => {
  if (!requireActiveGameForDev()) return;
  const raw = devSetupInput?.value?.trim();
  if (!raw) {
    alert("Cole um JSON descrevendo o setup do board.");
    return;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    alert("JSON inv�lido para setup do board.");
    return;
  }
  const result = game.applyManualSetup(parsed);
  if (!result.success) {
    alert(result.reason || "N�o foi poss�vel aplicar o setup.");
  } else if (result.warnings?.length) {
    alert(result.warnings.join("\n"));
  }
});

devSanityABtn?.addEventListener("click", async () => {
  if (!requireActiveGameForDev()) return;
  const result = await game.devRunSanityA();
  if (!result?.success) {
    alert(result?.reason || "Sanity A failed.");
  }
});

devSanityBBtn?.addEventListener("click", async () => {
  if (!requireActiveGameForDev()) return;
  const result = await game.devRunSanityB();
  if (!result?.success) {
    alert(result?.reason || "Sanity B failed.");
  }
});

devSanityCBtn?.addEventListener("click", async () => {
  if (!requireActiveGameForDev()) return;
  const result = await game.devRunSanityC();
  if (!result?.success) {
    alert(result?.reason || "Sanity C failed.");
  }
});

devSanityDBtn?.addEventListener("click", async () => {
  if (!requireActiveGameForDev()) return;
  const result = await game.devRunSanityD();
  if (!result?.success) {
    alert(result?.reason || "Sanity D failed.");
  }
});

devSanityEBtn?.addEventListener("click", async () => {
  if (!requireActiveGameForDev()) return;
  const result = await game.devRunSanityE();
  if (!result?.success) {
    alert(result?.reason || "Sanity E failed.");
  }
});

devSanityFBtn?.addEventListener("click", async () => {
  if (!requireActiveGameForDev()) return;
  const result = await game.devRunSanityF();
  if (!result?.success) {
    alert(result?.reason || "Sanity F failed.");
  }
});

devSanityGBtn?.addEventListener("click", async () => {
  if (!requireActiveGameForDev()) return;
  const result = await game.devRunSanityG();
  if (!result?.success) {
    alert(result?.reason || "Sanity G failed.");
  }
});

devSanityHBtn?.addEventListener("click", async () => {
  if (!requireActiveGameForDev()) return;
  const result = await game.devRunSanityH();
  if (!result?.success) {
    alert(result?.reason || "Sanity H failed.");
  }
});

devSanityIBtn?.addEventListener("click", async () => {
  if (!requireActiveGameForDev()) return;
  const result = await game.devRunSanityI();
  if (!result?.success) {
    alert(result?.reason || "Sanity I failed.");
  }
});

devSanityJBtn?.addEventListener("click", async () => {
  if (!requireActiveGameForDev()) return;
  const result = await game.devRunSanityJ();
  if (!result?.success) {
    alert(result?.reason || "Sanity J failed.");
  }
});

devSanityKBtn?.addEventListener("click", async () => {
  if (!requireActiveGameForDev()) return;
  const result = await game.devRunSanityK();
  if (!result?.success) {
    alert(result?.reason || "Sanity K failed.");
  }
});

devSanityLBtn?.addEventListener("click", async () => {
  if (!requireActiveGameForDev()) return;
  const result = await game.devRunSanityL();
  if (!result?.success) {
    alert(result?.reason || "Sanity L failed.");
  }
});

devSanityMBtn?.addEventListener("click", async () => {
  if (!requireActiveGameForDev()) return;
  const result = await game.devRunSanityM();
  if (!result?.success) {
    alert(result?.reason || "Sanity M failed.");
  }
});
devSanityNBtn?.addEventListener("click", async () => {
  if (!requireActiveGameForDev()) return;
  const result = await game.devRunSanityN();
  if (!result?.success) {
    alert(result?.reason || "Sanity N failed.");
  }
});
devSanityOBtn?.addEventListener("click", async () => {
  if (!requireActiveGameForDev()) return;
  const result = await game.devRunSanityO();
  if (!result?.success) {
    alert(result?.reason || "Sanity O failed.");
  }
});
devResetDuelBtn?.addEventListener("click", () => {
  if (!devModeEnabled) {
    alert("Ative o Dev Mode antes de reiniciar por aqui.");
    return;
  }
  restartCurrentDuelFromDev();
});

function ensureDomReady(fn) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    fn();
  }
}

ensureDomReady(() => {
  startScreen.classList.remove("hidden");
  updateDevPanelVisibility();
  bindOnlineCardClicks();
});

function requireActiveGameForDev() {
  if (!devModeEnabled) {
    alert("Ative o Dev Mode para usar o Dev Harness.");
    return false;
  }
  if (!game) {
    alert("Inicie um duelo primeiro.");
    return false;
  }
  return true;
}
