import Game from "./core/Game.js";
import { cardDatabase, cardDatabaseById } from "./data/cards.js";

let game = null;
const cardKindOrder = { monster: 0, spell: 1, trap: 2 };
const TEST_MODE_KEY = "shadow_duel_test_mode";
let testModeEnabled = loadTestModeFlag();
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
let currentDeck = loadDeck();
let currentExtraDeck = loadExtraDeck();
let poolFilterMode = "all"; // all | no_archetype | void | luminarch | shadow_heart
updateTestModeButton();

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

function sanitizeExtraDeck(extraDeck) {
  const valid = new Set(
    cardDatabase.filter((c) => c.monsterType === "fusion").map((c) => c.id)
  );
  const result = [];
  for (const id of extraDeck || []) {
    if (!valid.has(id)) continue;
    if (result.length >= MAX_EXTRA_DECK_SIZE) break;
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
  previewEls.name.textContent = card.name;
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
  previewEls.desc.textContent = card.description || "Sem descricao.";
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
  btnPoolFilterNoArchetype.textContent = "Sem arquétipo";

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
    (c) => !c.monsterType || c.monsterType !== "fusion"
  );
  const baseFusionPool = cardDatabase.filter((c) => c.monsterType === "fusion");

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
  const fusionCards = baseFusionPool.filter(poolFilter);

  const extraCounts = {};
  currentExtraDeck.forEach((id) => {
    extraCounts[id] = extraCounts[id] || 0;
    extraCounts[id]++;
  });

  // Render fusion monsters first with different styling
  fusionCards.forEach((card) => {
    const cardEl = createCardThumb(card);
    const count = extraCounts[card.id] || 0;
    const badge = document.createElement("div");
    badge.className = "pool-count fusion-count";
    badge.textContent = `${count}/1`;
    badge.style.background = "linear-gradient(135deg, #8b00ff, #4b0082)";
    cardEl.appendChild(badge);

    cardEl.onmouseenter = () => setPreview(card);
    cardEl.onclick = () => {
      if (currentExtraDeck.length >= MAX_EXTRA_DECK_SIZE) {
        alert(`Extra Deck está cheio (max ${MAX_EXTRA_DECK_SIZE}).`);
        return;
      }
      if (count >= 1) {
        alert("Apenas 1 cópia de cada Fusion Monster no Extra Deck.");
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
  const firstAvailable = fusionCards[0] || sortedCards[0] || cardDatabase[0];
  if (firstAvailable) {
    setPreview(firstAvailable);
  }
}

function createCardThumb(card) {
  const el = document.createElement("div");
  el.className = "card-thumb";
  el.style.backgroundImage = `url('${card.image}')`;
  el.title = card.name;
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
  game = new Game();
  game.testModeEnabled = !!testModeEnabled;
  game.start([...currentDeck], [...currentExtraDeck]);
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
btnToggleTestMode?.addEventListener("click", () => {
  testModeEnabled = !testModeEnabled;
  saveTestModeFlag(testModeEnabled);
  updateTestModeButton();
});

document.addEventListener("DOMContentLoaded", () => {
  startScreen.classList.remove("hidden");
});
