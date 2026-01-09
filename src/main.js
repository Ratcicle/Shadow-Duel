import Game from "./core/Game.js";
import Bot from "./core/Bot.js";
import BotArena from "./core/BotArena.js";
import Renderer from "./ui/Renderer.js";
import ReplayCapture from "./core/ReplayCapture.js";
import { cardDatabase, cardDatabaseById } from "./data/cards.js";
import { validateCardDatabase } from "./core/CardDatabaseValidator.js";
import ShadowHeartStrategy from "./core/ai/ShadowHeartStrategy.js";
import LuminarchStrategy from "./core/ai/LuminarchStrategy.js";

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
const REPLAY_MODE_KEY = "shadow_duel_capture_mode";
const BOT_PRESET_KEY = "shadow_duel_bot_preset";
let testModeEnabled = loadTestModeFlag();
let devModeEnabled = loadDevModeFlag();
let replayModeEnabled = loadReplayModeFlag();
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
const btnBotArena = document.getElementById("btn-bot-arena");
const botArenaModal = document.getElementById("bot-arena-modal");
const arenaDeckSeat1Select = document.getElementById("arena-deck-seat1");
const arenaDeckSeat2Select = document.getElementById("arena-deck-seat2");
const arenaNumDuelsSelect = document.getElementById("arena-num-duels");
const arenaSpeedSelect = document.getElementById("arena-speed");
const arenaAutoPauseCheckbox = document.getElementById("arena-auto-pause");
const btnArenaStart = document.getElementById("btn-arena-start");
const btnArenaCancel = document.getElementById("btn-arena-cancel");
const closeArenaBtn = document.querySelector(".close-arena");
const arenaCompleted = document.getElementById("arena-completed");
const arenaWins1 = document.getElementById("arena-wins-1");
const arenaWins2 = document.getElementById("arena-wins-2");
const arenaDraws = document.getElementById("arena-draws");
const arenaAvgTurns = document.getElementById("arena-avg-turns");
const arenaStatus = document.getElementById("arena-status");
const arenaLog = document.getElementById("arena-log");
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
const btnToggleReplay = document.getElementById("btn-toggle-replay");
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

let currentDeck = loadDeck();
let currentExtraDeck = loadExtraDeck();
let poolFilterMode = "all"; // all | no_archetype | void | luminarch | shadow_heart
updateTestModeButton();
updateDevModeButton();
updateReplayModeButton();
runCardDatabaseValidation({ silent: true });

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

function loadReplayModeFlag() {
  try {
    return localStorage.getItem(REPLAY_MODE_KEY) === "true";
  } catch (e) {
    console.warn("Failed to load replay mode flag", e);
    return false;
  }
}

function saveReplayModeFlag(enabled) {
  try {
    localStorage.setItem(REPLAY_MODE_KEY, enabled ? "true" : "false");
  } catch (e) {
    console.warn("Failed to save replay mode flag", e);
  }
}

function updateReplayModeButton() {
  if (!btnToggleReplay) return;
  const stats = ReplayCapture.getStats();
  const duelCount = stats.totalDuels || 0;
  const label = replayModeEnabled
    ? `🔴 Gravando (${duelCount})`
    : `🎬 Replay: desligado`;
  btnToggleReplay.textContent = label;
  btnToggleReplay.classList.toggle("active", replayModeEnabled);
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

// Listener para rematch via evento do game over modal
window.addEventListener("shadow-duel-rematch", () => {
  if (!runCardDatabaseValidation({ silent: true })) {
    alert("Corrija os erros do Card DB antes de reiniciar o duelo.");
    return;
  }
  startScreen.classList.add("hidden");
  deckBuilder.classList.add("hidden");
  bootGame();
  updateReplayModeButton(); // Atualizar contador de replays
});

// ============ Bot Arena ============

let botArenaInstance = null;

function openBotArenaModal() {
  startScreen.classList.add("hidden");
  botArenaModal.classList.remove("hidden");
  populateBotArenaDecks();
  resetBotArenaStats();
}

function closeBotArenaModal() {
  botArenaModal.classList.add("hidden");
  startScreen.classList.remove("hidden");
  if (botArenaInstance?.isRunning) {
    botArenaInstance.stop();
  }
}

function populateBotArenaDecks() {
  const options = [
    { id: "default", label: "Deck Padrão" },
    ...Bot.getAvailablePresets().map((preset) => ({
      id: preset.id,
      label: preset.label,
    })),
  ];

  arenaDeckSeat1Select.innerHTML = "";
  arenaDeckSeat2Select.innerHTML = "";

  options.forEach((opt) => {
    const opt1 = document.createElement("option");
    opt1.value = opt.id;
    opt1.textContent = opt.label;
    arenaDeckSeat1Select.appendChild(opt1);

    const opt2 = document.createElement("option");
    opt2.value = opt.id;
    opt2.textContent = opt.label;
    arenaDeckSeat2Select.appendChild(opt2);
  });

  arenaDeckSeat1Select.value = "shadowheart";
  arenaDeckSeat2Select.value = "luminarch";
}

function resetBotArenaStats() {
  arenaCompleted.textContent = "0";
  arenaWins1.textContent = "0";
  arenaWins2.textContent = "0";
  arenaDraws.textContent = "0";
  arenaAvgTurns.textContent = "-";
  arenaStatus.textContent = "Pronto";
  arenaLog.innerHTML = '<p class="log-entry">Aguardando início...</p>';
}

async function startBotArena() {
  if (!runCardDatabaseValidation()) {
    return;
  }

  const preset1 = arenaDeckSeat1Select.value;
  const preset2 = arenaDeckSeat2Select.value;
  const numDuels = parseInt(arenaNumDuelsSelect.value) || 10;
  const speed = arenaSpeedSelect.value || "1x";
  const autoPause = arenaAutoPauseCheckbox?.checked || false;

  // Desabilitar botões
  btnArenaStart.disabled = true;
  btnArenaCancel.disabled = true;
  arenaStatus.textContent = "Executando...";
  resetBotArenaStats();

  // Fechar o modal para exibir o tabuleiro em modo espectador
  botArenaModal.classList.add("hidden");
  startScreen.classList.add("hidden");

  botArenaInstance = new BotArena(
    Game,
    Bot,
    ShadowHeartStrategy,
    LuminarchStrategy
  );

  try {
    await botArenaInstance.startArena(
      preset1,
      preset2,
      numDuels,
      speed,
      autoPause,
      (progress) => updateArenaProgress(progress),
      (result) => finishBotArena(result)
    );
  } catch (err) {
    console.error("Bot Arena error:", err);
    alert(`Erro na arena: ${err.message}`);
    arenaStatus.textContent = "Erro";
    btnArenaStart.disabled = false;
    btnArenaCancel.disabled = false;
  }
}

function updateArenaProgress(progress) {
  arenaCompleted.textContent = progress.completed.toString();
  arenaWins1.textContent = progress.wins1.toString();
  arenaWins2.textContent = progress.wins2.toString();
  arenaDraws.textContent = progress.draws.toString();
  arenaAvgTurns.textContent = progress.avgTurns;

  const result = progress.lastResult;
  if (result) {
    if (result.type === "error") {
      addArenaLogEntry(`❌ ${result.message}`, "error");
    } else {
      let symbol, className, winnerText;

      if (result.winner === "player") {
        symbol = "✅";
        className = "win-1";
        winnerText = "Bot 1 venceu";
      } else if (result.winner === "bot") {
        symbol = "❌";
        className = "win-2";
        winnerText = "Bot 2 venceu";
      } else {
        symbol = "🔄";
        className = "draw";
        winnerText = "Empate";
      }

      addArenaLogEntry(
        `Duel ${result.duelNumber}: ${symbol} ${winnerText} (${result.turns} turnos)`,
        className
      );
    }
  }
}

function addArenaLogEntry(text, className = "") {
  if (!arenaLog) return;

  // Se a única entrada é "Aguardando início...", remover
  if (
    arenaLog.children.length === 1 &&
    arenaLog.children[0].textContent === "Aguardando início..."
  ) {
    arenaLog.innerHTML = "";
  }

  const entry = document.createElement("p");
  entry.className = `log-entry ${className}`;
  entry.textContent = text;
  arenaLog.appendChild(entry);
  arenaLog.scrollTop = arenaLog.scrollHeight;
}

function finishBotArena(result) {
  btnArenaStart.disabled = false;
  btnArenaCancel.disabled = false;
  arenaStatus.textContent = "Concluído";
  addArenaLogEntry(`✔️ Arena concluída! ${result.completed} duelos.`);
  botArenaModal.classList.remove("hidden");
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
btnBotArena?.addEventListener("click", openBotArenaModal);
btnArenaStart?.addEventListener("click", startBotArena);
btnArenaCancel?.addEventListener("click", closeBotArenaModal);
closeArenaBtn?.addEventListener("click", closeBotArenaModal);
botPresetSelect?.addEventListener("change", (e) => {
  const value = e.target.value;
  currentBotPreset = value;
  saveBotPreset(value);
  updateBotPresetStatus();
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

btnToggleReplay?.addEventListener("click", () => {
  replayModeEnabled = !replayModeEnabled;
  saveReplayModeFlag(replayModeEnabled);
  updateReplayModeButton();

  if (replayModeEnabled) {
    console.log(
      "[ReplayCapture] Modo de captura ATIVADO - suas decisões serão gravadas nos próximos duelos"
    );
  } else {
    // Mostrar resumo ao desativar
    const stats = ReplayCapture.getStats();
    if (stats.totalDuels > 0) {
      console.log(
        `[ReplayCapture] Modo de captura DESATIVADO - ${stats.totalDuels} duelos gravados`
      );
      ReplayCapture.showSummary();
    }
  }
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
