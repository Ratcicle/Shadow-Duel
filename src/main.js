import Game from "./core/Game.js";
import Bot from "./core/Bot.js";
import BotArena from "./core/BotArena.js";
import Renderer from "./ui/Renderer.js";
import ReplayCapture from "./core/ReplayCapture.js";
import { ReplayDashboard } from "./ui/replay/ReplayDashboard.js";
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
const REPLAY_MODE_KEY = "shadow_duel_capture_mode";
const BOT_PRESET_KEY = "shadow_duel_bot_preset";
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
const btnReplayDashboard = document.getElementById("btn-replay-dashboard");
const replayDashboardModal = document.getElementById("replay-dashboard-modal");
const replayDashboardContainer = document.getElementById(
  "replay-dashboard-container",
);
const closeReplayDashboardBtn = document.querySelector(
  ".close-replay-dashboard",
);
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
  "deck-filter-no-archetype",
);
const btnPoolFilterShadowHeart = document.getElementById(
  "deck-filter-shadow-heart",
);
const btnPoolFilterArcanist = document.getElementById("deck-filter-arcanist");
const btnPoolFilterLuminarch = document.getElementById("deck-filter-luminarch");
const btnPoolFilterVoid = document.getElementById("deck-filter-void");
const btnOpenLaboratory = document.getElementById("btn-open-laboratory");
const btnToggleReplay = document.getElementById("btn-toggle-replay");
const validationMessagesEl = document.getElementById("validation-messages");
const laboratoryModal = document.getElementById("laboratory-modal");
const laboratoryBody = document.getElementById("laboratory-body");
const laboratoryCloseBtn = document.getElementById("laboratory-close");
const laboratoryArchetypeSelect = document.getElementById(
  "laboratory-archetype",
);
const laboratoryRandomAllBtn = document.getElementById(
  "laboratory-random-all",
);
const laboratoryExportBtn = document.getElementById("laboratory-export");
const laboratoryImportBtn = document.getElementById("laboratory-import");
const laboratoryImportFileInput = document.getElementById(
  "laboratory-import-file",
);
const laboratoryClearBtn = document.getElementById("laboratory-clear");
const laboratoryAddOwnerSelect = document.getElementById(
  "laboratory-add-owner",
);
const laboratoryAddZoneSelect = document.getElementById("laboratory-add-zone");
const laboratoryCardSearchInput = document.getElementById(
  "laboratory-card-search",
);
const laboratoryCardOptions = document.getElementById(
  "laboratory-card-options",
);
const laboratoryPositionSelect = document.getElementById(
  "laboratory-position",
);
const laboratoryFacedownInput = document.getElementById(
  "laboratory-facedown",
);
const laboratoryAddCardBtn = document.getElementById("laboratory-add-card-btn");
const laboratoryStartBtn = document.getElementById("laboratory-start");
const laboratoryUseBotInput = document.getElementById("laboratory-use-bot");
const laboratoryBotArchetypeSelect = document.getElementById("laboratory-bot-archetype");
const laboratoryRevealBotHandInput = document.getElementById("laboratory-reveal-bot-hand");
const laboratoryModeButtons = document.querySelectorAll("[data-laboratory-mode]");

let currentDeck = loadDeck();
let currentExtraDeck = loadExtraDeck();
let poolFilterMode = "all"; // all | no_archetype | void | luminarch | shadow_heart | arcanist
const LAB_ZONE_CONFIG = [
  { id: "deck", label: "Deck", max: null, defaultCount: 20 },
  { id: "extraDeck", label: "Extra Deck", max: MAX_EXTRA_DECK_SIZE, defaultCount: 5 },
  { id: "hand", label: "Mão", max: null, defaultCount: 4 },
  { id: "field", label: "Campo", max: 5, defaultCount: 2 },
  { id: "spellTrap", label: "Magias/Armadilhas", max: 5, defaultCount: 1 },
  { id: "fieldSpell", label: "Campo Mágico", max: 1, defaultCount: 1 },
  { id: "graveyard", label: "Cemitério", max: null, defaultCount: 2 },
];
const LAB_ZONE_LABELS = Object.fromEntries(
  LAB_ZONE_CONFIG.map((zone) => [zone.id, zone.label]),
);
const LAB_OWNER_LABELS = {
  player: "Jogador 1",
  bot: "Jogador 2",
};
let laboratorySetup = createEmptyLaboratorySetup();
let laboratorySelection = { owner: "player", zone: "hand" };
let laboratoryMode = "test";
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
    JSON.stringify(currentExtraDeck),
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
    ? `Gravando (${duelCount})`
    : `Gravando: desligado`;
  btnToggleReplay.textContent = label;
  btnToggleReplay.classList.toggle("active", replayModeEnabled);
}

function runCardDatabaseValidation(options = {}) {
  const { silent = false } = options;
  latestValidationResult = validateCardDatabase();
  showValidationMessages(latestValidationResult);
  if (latestValidationResult.errors.length) {
    console.error(
      "Card database validation errors:",
      latestValidationResult.errors,
    );
    if (!silent) {
      alert(
        "N�o � poss�vel iniciar o duelo: h� erros no banco de cartas. Verifique os detalhes acima.",
      );
    }
    return false;
  }
  if (latestValidationResult.warnings.length) {
    console.warn(
      "Card database validation warnings:",
      latestValidationResult.warnings,
    );
  }
  return true;
}

function showValidationMessages(result) {
  if (!validationMessagesEl || !result) return;
  const shouldShowErrors = Array.isArray(result.errors)
    ? result.errors.length > 0
    : false;
  const shouldShowWarnings = false;

  if (!shouldShowErrors && !shouldShowWarnings) {
    validationMessagesEl.classList.add("hidden");
    validationMessagesEl.innerHTML = "";
    return;
  }

  const messages = [];
  if (shouldShowErrors) {
    messages.push(
      `<strong>${result.errors.length} erro(s) na base de cartas.</strong>`,
    );
    messages.push(renderIssueList(result.errors, "error"));
  }
  if (shouldShowWarnings) {
    messages.push(
      `<strong>${result.warnings.length} aviso(s) encontrados.</strong>`,
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
        }">${formatIssueForDisplay(issue)}</li>`,
    );
  if (issues.length > MAX_ITEMS) {
    listItems.push(
      `<li class="${cssClass === "warning" ? "warning" : ""}">+ ${
        issues.length - MAX_ITEMS
      } mais...</li>`,
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
        (c) => c.monsterType === "fusion" || c.monsterType === "ascension",
      )
      .map((c) => c.id),
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
    Math.min(MAX_DECK_SIZE, filled.length),
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
  const isArcanist = poolFilterMode === "arcanist";

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

  if (btnPoolFilterArcanist) {
    btnPoolFilterArcanist.classList.toggle("active", isArcanist);
    btnPoolFilterArcanist.textContent = "Arcanist";
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
    nameOf(a).localeCompare(nameOf(b)),
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
      (c.monsterType !== "fusion" && c.monsterType !== "ascension"),
  );
  const baseExtraPool = cardDatabase.filter(
    (c) => c.monsterType === "fusion" || c.monsterType === "ascension",
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
        alert("Apenas 1 copia de cada monstro do Extra Deck por id.");
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

function createEmptyLaboratorySide() {
  return {
    lp: 8000,
    deck: [],
    extraDeck: [],
    hand: [],
    field: [],
    spellTrap: [],
    fieldSpell: [],
    graveyard: [],
  };
}

function createEmptyLaboratorySetup() {
  return {
    player: createEmptyLaboratorySide(),
    bot: createEmptyLaboratorySide(),
  };
}

function cloneLabEntry(entry) {
  return entry && typeof entry === "object" ? { ...entry } : null;
}

function getLabZone(owner, zone) {
  const side = laboratorySetup?.[owner];
  const value = side?.[zone];
  return Array.isArray(value) ? value : [];
}

function getLabZoneConfig(zone) {
  return LAB_ZONE_CONFIG.find((item) => item.id === zone) || LAB_ZONE_CONFIG[0];
}

function getLabCard(entry) {
  const id = typeof entry === "number" ? entry : entry?.id;
  return cardDatabaseById.get(id) || null;
}

function resolveLabCardData(entry) {
  if (typeof entry === "number") return cardDatabaseById.get(entry) || null;
  if (typeof entry === "string") {
    const lower = entry.trim().toLowerCase();
    return (
      cardDatabase.find(
        (card) =>
          card.name.toLowerCase() === lower ||
          (getCardDisplayName(card) || "").toLowerCase() === lower,
      ) || null
    );
  }
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.id === "number") {
    return cardDatabaseById.get(entry.id) || null;
  }
  if (entry.name) return resolveLabCardData(entry.name);
  return null;
}

function cardMatchesLabArchetype(card, archetype) {
  if (!archetype || archetype === "all") return true;
  return cardHasArchetypeName(card, archetype);
}

function getLabCandidates(zone, archetype = "all") {
  return cardDatabase.filter((card) => {
    if (!cardMatchesLabArchetype(card, archetype)) return false;
    if (zone === "extraDeck") {
      return card.monsterType === "fusion" || card.monsterType === "ascension";
    }
    if (zone === "field") return card.cardKind === "monster";
    if (zone === "spellTrap") {
      return (
        (card.cardKind === "spell" || card.cardKind === "trap") &&
        card.subtype !== "field"
      );
    }
    if (zone === "fieldSpell") {
      return card.cardKind === "spell" && card.subtype === "field";
    }
    if (zone === "deck" || zone === "hand") {
      return card.monsterType !== "fusion" && card.monsterType !== "ascension";
    }
    return true;
  });
}

function getLabEntryForCard(card, zone) {
  const entry = { id: card.id };
  if (zone === "field") {
    entry.position = laboratoryPositionSelect?.value || "attack";
    entry.facedown = !!laboratoryFacedownInput?.checked;
  } else if (zone === "spellTrap") {
    entry.facedown = !!laboratoryFacedownInput?.checked;
  }
  return entry;
}

function applyLabZoneSelection(owner, zone) {
  laboratorySelection = { owner, zone };
  if (laboratoryAddOwnerSelect) laboratoryAddOwnerSelect.value = owner;
  if (laboratoryAddZoneSelect) laboratoryAddZoneSelect.value = zone;
  updateLaboratoryAddControls();
  renderLaboratory();
}

function updateLaboratoryAddControls() {
  const zone = laboratoryAddZoneSelect?.value || laboratorySelection.zone;
  const needsPosition = zone === "field";
  const canFacedown = zone === "field" || zone === "spellTrap";
  if (laboratoryPositionSelect) {
    laboratoryPositionSelect.disabled = !needsPosition;
  }
  if (laboratoryFacedownInput) {
    laboratoryFacedownInput.disabled = !canFacedown;
    if (!canFacedown) laboratoryFacedownInput.checked = false;
    if (zone === "spellTrap" && !laboratoryFacedownInput.dataset.touched) {
      laboratoryFacedownInput.checked = true;
    }
  }
}

function populateLaboratoryControls() {
  if (laboratoryAddZoneSelect) {
    laboratoryAddZoneSelect.innerHTML = "";
    LAB_ZONE_CONFIG.forEach((zone) => {
      const option = document.createElement("option");
      option.value = zone.id;
      option.textContent = zone.label;
      laboratoryAddZoneSelect.appendChild(option);
    });
  }

  if (laboratoryArchetypeSelect) {
    const archetypes = new Set(["all"]);
    cardDatabase.forEach((card) => {
      const list = Array.isArray(card.archetypes)
        ? card.archetypes
        : card.archetype
          ? [card.archetype]
          : [];
      list.forEach((name) => archetypes.add(name));
    });
    laboratoryArchetypeSelect.innerHTML = "";
    [...archetypes].forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name === "all" ? "Todos" : name;
      laboratoryArchetypeSelect.appendChild(option);
    });
  }

  if (laboratoryCardOptions) {
    laboratoryCardOptions.innerHTML = "";
    getSortedCardPool(cardDatabase).forEach((card) => {
      const option = document.createElement("option");
      option.value = getCardDisplayName(card) || card.name;
      option.dataset.cardId = String(card.id);
      laboratoryCardOptions.appendChild(option);
    });
  }
}

function renderLaboratory() {
  if (!laboratoryBody) return;
  laboratoryBody.innerHTML = "";
  ["player", "bot"].forEach((owner) => {
    const side = laboratorySetup[owner];
    const panel = document.createElement("section");
    panel.className = "laboratory-side";
    panel.dataset.owner = owner;

    const header = document.createElement("div");
    header.className = "laboratory-side-header";
    header.innerHTML = `
      <h3>${LAB_OWNER_LABELS[owner]}</h3>
      <label class="laboratory-lp">LP
        <input type="number" min="0" max="99999" value="${side.lp}" data-lab-lp="${owner}" />
      </label>
      <button type="button" data-lab-random-side="${owner}">Aleatorizar lado</button>
    `;
    panel.appendChild(header);

    const zones = document.createElement("div");
    zones.className = "laboratory-zones";
    LAB_ZONE_CONFIG.forEach((zoneConfig) => {
      const zone = document.createElement("div");
      const isSelected =
        laboratorySelection.owner === owner &&
        laboratorySelection.zone === zoneConfig.id;
      zone.className = `laboratory-zone${isSelected ? " selected" : ""}`;
      zone.dataset.owner = owner;
      zone.dataset.zone = zoneConfig.id;

      const entries = getLabZone(owner, zoneConfig.id);
      const maxText = zoneConfig.max ? ` / ${zoneConfig.max}` : "";
      const headerEl = document.createElement("div");
      headerEl.className = "laboratory-zone-header";
      headerEl.innerHTML = `
        <span>${zoneConfig.label} (${entries.length}${maxText})</span>
        <button type="button" data-lab-random-zone="${owner}:${zoneConfig.id}">Sortear</button>
      `;
      zone.appendChild(headerEl);

      const list = document.createElement("div");
      list.className = "laboratory-card-list";
      if (entries.length === 0) {
        const empty = document.createElement("span");
        empty.className = "laboratory-empty";
        empty.textContent = "Vazio";
        list.appendChild(empty);
      } else {
        entries.forEach((entry, index) => {
          const card = getLabCard(entry);
          const chip = document.createElement("div");
          chip.className = "laboratory-card-chip";
          const meta = [];
          if (entry.position) meta.push(entry.position === "defense" ? "DEF" : "ATK");
          if (entry.facedown) meta.push("baixada");
          chip.innerHTML = `
            <span title="${card?.name || "Carta desconhecida"}">${card?.name || "Carta desconhecida"}${
              meta.length ? ` (${meta.join(", ")})` : ""
            }</span>
            <button type="button" data-lab-remove="${owner}:${zoneConfig.id}:${index}">&times;</button>
          `;
          list.appendChild(chip);
        });
      }
      zone.appendChild(list);
      zones.appendChild(zone);
    });
    panel.appendChild(zones);
    laboratoryBody.appendChild(panel);
  });
}

function addCardToLaboratoryZone(owner, zone, entry) {
  const zoneConfig = getLabZoneConfig(zone);
  const entries = getLabZone(owner, zone);
  if (zoneConfig.max && entries.length >= zoneConfig.max) {
    alert(`${zoneConfig.label} atingiu o limite de ${zoneConfig.max}.`);
    return false;
  }
  const card = getLabCard(entry);
  if (!card || getLabCandidates(zone, "all").every((candidate) => candidate.id !== card.id)) {
    alert("Esta carta não é válida para a zona selecionada.");
    return false;
  }
  entries.push(cloneLabEntry(entry));
  return true;
}

function addSelectedLaboratoryCard() {
  const owner = laboratoryAddOwnerSelect?.value || laboratorySelection.owner;
  const zone = laboratoryAddZoneSelect?.value || laboratorySelection.zone;
  const rawName = laboratoryCardSearchInput?.value?.trim();
  if (!rawName) {
    alert("Escolha uma carta para adicionar.");
    return;
  }
  const lower = rawName.toLowerCase();
  const card = cardDatabase.find(
    (item) =>
      item.name.toLowerCase() === lower ||
      (getCardDisplayName(item) || "").toLowerCase() === lower,
  );
  if (!card) {
    alert("Carta não encontrada.");
    return;
  }
  if (addCardToLaboratoryZone(owner, zone, getLabEntryForCard(card, zone))) {
    if (laboratoryCardSearchInput) laboratoryCardSearchInput.value = "";
    laboratorySelection = { owner, zone };
    renderLaboratory();
  }
}

function randomizeLaboratoryZone(owner, zone) {
  const side = laboratorySetup[owner];
  const zoneConfig = getLabZoneConfig(zone);
  const current = getLabZone(owner, zone);
  const max = zoneConfig.max || Number.POSITIVE_INFINITY;
  const count = Math.min(
    current.length > 0 ? current.length : zoneConfig.defaultCount,
    max,
  );
  const archetype = laboratoryArchetypeSelect?.value || "all";
  const candidates = getLabCandidates(zone, archetype);
  if (candidates.length === 0) {
    side[zone] = [];
    return;
  }
  side[zone] = Array.from({ length: count }, () => {
    const card = candidates[Math.floor(Math.random() * candidates.length)];
    if (zone === "field") {
      return {
        id: card.id,
        position: Math.random() > 0.5 ? "attack" : "defense",
        facedown: false,
      };
    }
    if (zone === "spellTrap") {
      return { id: card.id, facedown: Math.random() > 0.5 };
    }
    return { id: card.id };
  });
}

function randomizeLaboratorySide(owner) {
  LAB_ZONE_CONFIG.forEach((zone) => randomizeLaboratoryZone(owner, zone.id));
  renderLaboratory();
}

function randomizeLaboratoryAll() {
  randomizeLaboratorySide("player");
  randomizeLaboratorySide("bot");
}

function buildLaboratorySetupForGame() {
  const cloneSide = (side) => ({
    lp: Math.max(0, Math.floor(Number(side.lp) || 0)),
    deck: side.deck.map(cloneLabEntry).filter(Boolean),
    extraDeck: side.extraDeck.map(cloneLabEntry).filter(Boolean),
    hand: side.hand.map(cloneLabEntry).filter(Boolean),
    field: side.field.map(cloneLabEntry).filter(Boolean),
    spellTrap: side.spellTrap.map(cloneLabEntry).filter(Boolean),
    fieldSpell: side.fieldSpell.map(cloneLabEntry).filter(Boolean)[0] || null,
    graveyard: side.graveyard.map(cloneLabEntry).filter(Boolean),
  });
  return {
    player: cloneSide(laboratorySetup.player),
    bot: cloneSide(laboratorySetup.bot),
  };
}

function getLaboratoryDeckIds(owner, zone) {
  return getLabZone(owner, zone)
    .map((entry) => getLabCard(entry)?.id)
    .filter((id) => typeof id === "number");
}

function buildLaboratoryDuelDecks() {
  return {
    playerDeck: getLaboratoryDeckIds("player", "deck"),
    playerExtraDeck: getLaboratoryDeckIds("player", "extraDeck"),
    botDeck: getLaboratoryDeckIds("bot", "deck"),
    botExtraDeck: getLaboratoryDeckIds("bot", "extraDeck"),
  };
}

function setLaboratoryMode(mode) {
  laboratoryMode = mode === "duel" ? "duel" : "test";
  laboratoryModeButtons.forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.laboratoryMode === laboratoryMode,
    );
  });
}

function normalizeLabEntryForExport(entry, zone) {
  const card = getLabCard(entry);
  if (!card) return null;
  const out = { id: card.id };
  if (zone === "field") {
    out.position = entry.position === "defense" ? "defense" : "attack";
    out.facedown = entry.facedown === true;
  } else if (zone === "spellTrap" || zone === "fieldSpell") {
    out.facedown = entry.facedown === true;
  }
  return out;
}

function buildLaboratoryExportPayload() {
  const exportSide = (side) => {
    const result = {
      lp: Math.max(0, Math.floor(Number(side.lp) || 0)),
    };
    LAB_ZONE_CONFIG.forEach((zoneConfig) => {
      const zone = zoneConfig.id;
      const entries = Array.isArray(side[zone]) ? side[zone] : [];
      const exported = entries
        .map((entry) => normalizeLabEntryForExport(entry, zone))
        .filter(Boolean);
      result[zone] =
        zone === "fieldSpell" ? exported[0] || null : exported;
    });
    return result;
  };

  const options = {
    laboratoryMode,
    useBot: laboratoryUseBotInput?.checked === true,
    revealBotHand: laboratoryRevealBotHandInput?.checked === true,
    botPreset: laboratoryBotArchetypeSelect?.value || "shadowheart",
  };

  return {
    version: 1,
    type: "shadow-duel-laboratory-state",
    exportedAt: new Date().toISOString(),
    laboratoryMode: options.laboratoryMode,
    useBot: options.useBot,
    revealBotHand: options.revealBotHand,
    botPreset: options.botPreset,
    options,
    setup: {
      player: exportSide(laboratorySetup.player),
      bot: exportSide(laboratorySetup.bot),
    },
  };
}

function downloadLaboratoryState() {
  const payload = buildLaboratoryExportPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  link.href = url;
  link.download = `shadow-duel-laboratory-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function normalizeImportedLabEntry(entry, zone, warnings) {
  const card = resolveLabCardData(entry);
  if (!card) {
    warnings.push(`Carta invalida ignorada em ${LAB_ZONE_LABELS[zone]}.`);
    return null;
  }
  const validForZone = getLabCandidates(zone, "all").some(
    (candidate) => candidate.id === card.id,
  );
  if (!validForZone) {
    warnings.push(`${card.name} nao e valido para ${LAB_ZONE_LABELS[zone]}.`);
    return null;
  }
  const normalized = { id: card.id };
  if (zone === "field") {
    normalized.position =
      entry?.position === "defense" ? "defense" : "attack";
    normalized.facedown = entry?.facedown === true;
  } else if (zone === "spellTrap" || zone === "fieldSpell") {
    normalized.facedown = entry?.facedown === true;
  }
  return normalized;
}

function normalizeImportedLaboratoryState(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Arquivo de Laboratorio deve conter um objeto JSON.");
  }

  let setupPayload = null;
  let optionsPayload = {};
  if (payload.type === "shadow-duel-laboratory-state") {
    setupPayload = payload.setup;
    optionsPayload = { ...payload, ...(payload.options || {}) };
  } else if (payload.player || payload.bot) {
    setupPayload = payload;
    optionsPayload = payload;
  } else {
    throw new Error("Formato de Laboratorio invalido.");
  }
  if (!setupPayload || typeof setupPayload !== "object") {
    throw new Error("Setup de Laboratorio ausente ou invalido.");
  }

  const warnings = [];
  const normalizedSetup = createEmptyLaboratorySetup();
  const normalizeSide = (owner) => {
    const source = setupPayload[owner] || {};
    const target = normalizedSetup[owner];
    if (typeof source.lp === "number" && Number.isFinite(source.lp)) {
      target.lp = Math.max(0, Math.floor(source.lp));
    }

    LAB_ZONE_CONFIG.forEach((zoneConfig) => {
      const zone = zoneConfig.id;
      const raw =
        zone === "fieldSpell" && !Array.isArray(source[zone])
          ? source[zone]
            ? [source[zone]]
            : []
          : Array.isArray(source[zone])
            ? source[zone]
            : [];
      const limit = zoneConfig.max || Number.POSITIVE_INFINITY;
      const entries = [];
      for (const rawEntry of raw) {
        if (entries.length >= limit) {
          warnings.push(`${LAB_ZONE_LABELS[zone]} excedeu o limite e foi cortado.`);
          break;
        }
        const normalizedEntry = normalizeImportedLabEntry(
          rawEntry,
          zone,
          warnings,
        );
        if (normalizedEntry) entries.push(normalizedEntry);
      }
      target[zone] = entries;
    });
  };

  normalizeSide("player");
  normalizeSide("bot");

  return {
    setup: normalizedSetup,
    options: {
      useBot:
        typeof optionsPayload.useBot === "boolean"
          ? optionsPayload.useBot
          : laboratoryUseBotInput?.checked === true,
      laboratoryMode:
        optionsPayload.laboratoryMode === "duel" ? "duel" : "test",
      revealBotHand:
        typeof optionsPayload.revealBotHand === "boolean"
          ? optionsPayload.revealBotHand
          : laboratoryRevealBotHandInput?.checked === true,
      botPreset:
        typeof optionsPayload.botPreset === "string"
          ? optionsPayload.botPreset
          : laboratoryBotArchetypeSelect?.value || null,
    },
    warnings,
  };
}

async function importLaboratoryStateFromFile(file) {
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (err) {
    alert(`Erro ao ler JSON do Laboratorio: ${err.message}`);
    return;
  }

  try {
    const result = normalizeImportedLaboratoryState(parsed);
    laboratorySetup = result.setup;
    if (laboratoryUseBotInput) {
      laboratoryUseBotInput.checked = result.options.useBot;
    }
    if (laboratoryRevealBotHandInput) {
      laboratoryRevealBotHandInput.checked = result.options.revealBotHand;
    }
    if (laboratoryBotArchetypeSelect && result.options.botPreset) {
      laboratoryBotArchetypeSelect.value = result.options.botPreset;
    }
    setLaboratoryMode(result.options.laboratoryMode);
    const wrap = document.getElementById("laboratory-bot-archetype-wrap");
    wrap?.classList.toggle("hidden", !laboratoryUseBotInput?.checked);
    updateLaboratoryAddControls();
    renderLaboratory();
    const warningText = result.warnings.length
      ? `\n\nAvisos:\n- ${result.warnings.join("\n- ")}`
      : "";
    alert(`Estado do Laboratorio importado com sucesso.${warningText}`);
  } catch (err) {
    alert(`Erro ao importar estado do Laboratorio: ${err.message}`);
  }
}

function openLaboratory() {
  startScreen.classList.add("hidden");
  laboratoryModal?.classList.remove("hidden");
  populateLaboratoryControls();
  updateLaboratoryAddControls();
  renderLaboratory();
}

function closeLaboratory() {
  laboratoryModal?.classList.add("hidden");
  startScreen.classList.remove("hidden");
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
      `O deck precisa ter entre ${MIN_DECK_SIZE} e ${MAX_DECK_SIZE} cartas.`,
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
    devMode: false,
    renderer,
  });
  game.start([...currentDeck], [...currentExtraDeck]);
}

async function startLaboratoryDuel() {
  if (!runCardDatabaseValidation()) {
    return;
  }
  const useBot = laboratoryUseBotInput?.checked || false;
  const botPreset = laboratoryBotArchetypeSelect?.value || "shadowheart";
  const revealBotHand = laboratoryRevealBotHandInput?.checked || false;
  const renderer = new Renderer();
  game = new Game({
    laboratoryMode: true,
    laboratoryUseBot: useBot,
    laboratoryRevealBotHand: revealBotHand,
    devMode: false,
    playerName: "Jogador 1",
    opponentName: "Jogador 2",
    botPreset,
    renderer,
  });
  laboratoryModal?.classList.add("hidden");
  startScreen.classList.add("hidden");
  deckBuilder.classList.add("hidden");
  if (laboratoryMode === "duel") {
    await game.startWithDecks({
      ...buildLaboratoryDuelDecks(),
      useBot,
      revealBotHand,
      laboratoryMode: true,
      exactDecks: true,
      startAtDrawPhase: true,
    });
    return;
  }
  await game.startLaboratory(buildLaboratorySetupForGame(), { useBot, revealBotHand });
}

// Listener para rematch via evento do game over modal
window.addEventListener("shadow-duel-rematch", async () => {
  if (!runCardDatabaseValidation({ silent: true })) {
    alert("Corrija os erros do Card DB antes de reiniciar o duelo.");
    return;
  }
  const wasLaboratoryDuel = game?.laboratoryModeEnabled === true;
  startScreen.classList.add("hidden");
  deckBuilder.classList.add("hidden");
  if (wasLaboratoryDuel) {
    await startLaboratoryDuel();
    return;
  }
  bootGame();
  updateReplayModeButton(); // Atualizar contador de replays
});

// ============ Replay Dashboard ============

let replayDashboardInstance = null;

async function openReplayDashboard() {
  startScreen.classList.add("hidden");
  replayDashboardModal.classList.remove("hidden");

  // Inicializar dashboard se ainda não foi criado
  if (!replayDashboardInstance) {
    replayDashboardInstance = new ReplayDashboard();
  }

  // Montar no container
  await replayDashboardInstance.mount(replayDashboardContainer);
}

function closeReplayDashboard() {
  replayDashboardModal.classList.add("hidden");
  startScreen.classList.remove("hidden");

  // Não desmontar completamente para manter estado
}

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
    LuminarchStrategy,
  );

  try {
    await botArenaInstance.startArena(
      preset1,
      preset2,
      numDuels,
      speed,
      autoPause,
      (progress) => updateArenaProgress(progress),
      (result) => finishBotArena(result),
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
        className,
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
btnPoolFilterArcanist?.addEventListener("click", () => {
  poolFilterMode = poolFilterMode === "arcanist" ? "all" : "arcanist";
  renderDeckBuilder();
});
btnStartDuel?.addEventListener("click", startDuel);
btnBotArena?.addEventListener("click", openBotArenaModal);
btnReplayDashboard?.addEventListener("click", openReplayDashboard);
btnOpenLaboratory?.addEventListener("click", openLaboratory);
closeReplayDashboardBtn?.addEventListener("click", closeReplayDashboard);
btnArenaStart?.addEventListener("click", startBotArena);
btnArenaCancel?.addEventListener("click", closeBotArenaModal);
closeArenaBtn?.addEventListener("click", closeBotArenaModal);
botPresetSelect?.addEventListener("change", (e) => {
  const value = e.target.value;
  currentBotPreset = value;
  saveBotPreset(value);
  updateBotPresetStatus();
});
laboratoryCloseBtn?.addEventListener("click", closeLaboratory);
laboratoryClearBtn?.addEventListener("click", () => {
  laboratorySetup = createEmptyLaboratorySetup();
  renderLaboratory();
});
laboratoryRandomAllBtn?.addEventListener("click", randomizeLaboratoryAll);
laboratoryExportBtn?.addEventListener("click", downloadLaboratoryState);
laboratoryImportBtn?.addEventListener("click", () => {
  laboratoryImportFileInput?.click();
});
laboratoryImportFileInput?.addEventListener("change", async () => {
  const file = laboratoryImportFileInput.files?.[0] || null;
  await importLaboratoryStateFromFile(file);
  laboratoryImportFileInput.value = "";
});
laboratoryStartBtn?.addEventListener("click", startLaboratoryDuel);
laboratoryUseBotInput?.addEventListener("change", () => {
  const wrap = document.getElementById("laboratory-bot-archetype-wrap");
  wrap?.classList.toggle("hidden", !laboratoryUseBotInput.checked);
});
laboratoryModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setLaboratoryMode(button.dataset.laboratoryMode);
  });
});
laboratoryAddCardBtn?.addEventListener("click", addSelectedLaboratoryCard);
laboratoryFacedownInput?.addEventListener("change", () => {
  laboratoryFacedownInput.dataset.touched = "true";
});
laboratoryAddOwnerSelect?.addEventListener("change", () => {
  laboratorySelection.owner = laboratoryAddOwnerSelect.value;
  renderLaboratory();
});
laboratoryAddZoneSelect?.addEventListener("change", () => {
  laboratorySelection.zone = laboratoryAddZoneSelect.value;
  updateLaboratoryAddControls();
  renderLaboratory();
});
laboratoryBody?.addEventListener("input", (event) => {
  const owner = event.target?.dataset?.labLp;
  if (!owner || !laboratorySetup[owner]) return;
  laboratorySetup[owner].lp = Math.max(
    0,
    Math.floor(Number(event.target.value) || 0),
  );
});
laboratoryBody?.addEventListener("click", (event) => {
  const removeSpec = event.target?.dataset?.labRemove;
  if (removeSpec) {
    const [owner, zone, indexRaw] = removeSpec.split(":");
    const index = Number.parseInt(indexRaw, 10);
    const entries = getLabZone(owner, zone);
    if (!Number.isNaN(index)) {
      entries.splice(index, 1);
      renderLaboratory();
    }
    return;
  }

  const randomSpec = event.target?.dataset?.labRandomZone;
  if (randomSpec) {
    const [owner, zone] = randomSpec.split(":");
    randomizeLaboratoryZone(owner, zone);
    renderLaboratory();
    return;
  }

  const randomSide = event.target?.dataset?.labRandomSide;
  if (randomSide) {
    randomizeLaboratorySide(randomSide);
    return;
  }

  const zoneEl = event.target?.closest?.(".laboratory-zone");
  if (zoneEl?.dataset?.owner && zoneEl?.dataset?.zone) {
    applyLabZoneSelection(zoneEl.dataset.owner, zoneEl.dataset.zone);
  }
});

btnToggleReplay?.addEventListener("click", () => {
  replayModeEnabled = !replayModeEnabled;
  saveReplayModeFlag(replayModeEnabled);
  updateReplayModeButton();

  if (replayModeEnabled) {
    console.log(
      "[ReplayCapture] Modo de captura ATIVADO - suas decisões serão gravadas nos próximos duelos",
    );
  } else {
    // Mostrar resumo ao desativar
    const stats = ReplayCapture.getStats();
    if (stats.totalDuels > 0) {
      console.log(
        `[ReplayCapture] Modo de captura DESATIVADO - ${stats.totalDuels} duelos gravados`,
      );
      ReplayCapture.showSummary();
    }
  }
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
});
