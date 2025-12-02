import Game from "./core/Game.js";
import { cardDatabase } from "./data/cards.js";

let game = null;
let currentDeck = loadDeck();

const startScreen = document.getElementById("start-screen");
const deckBuilder = document.getElementById("deck-builder");
const deckGrid = document.getElementById("deck-grid");
const poolGrid = document.getElementById("pool-grid");
const deckCountEl = document.getElementById("deck-count");

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
  localStorage.setItem("shadow_duel_deck", JSON.stringify(deck));
}

function sanitizeDeck(deck) {
  const valid = new Set(cardDatabase.map((c) => c.id));
  const counts = {};
  const result = [];
  for (const id of deck || []) {
    if (!valid.has(id)) continue;
    counts[id] = counts[id] || 0;
    if (counts[id] >= 3) continue;
    if (result.length >= 30) break;
    counts[id]++;
    result.push(id);
  }
  return topUpDeck(result);
}

function topUpDeck(deck) {
  const counts = {};
  deck.forEach((id) => {
    counts[id] = counts[id] || 0;
    counts[id]++;
  });
  const filled = [...deck];
  while (filled.length < 30) {
    for (const card of cardDatabase) {
      counts[card.id] = counts[card.id] || 0;
      if (counts[card.id] < 3 && filled.length < 30) {
        filled.push(card.id);
        counts[card.id]++;
      }
    }
  }
  return filled;
}

function buildDefaultDeck() {
  return topUpDeck([]);
}

function setPreview(card) {
  if (!card) return;
  previewEls.image.style.backgroundImage = `url('${card.image}')`;
  previewEls.name.textContent = card.name;
  const isMonster = card.cardKind !== "spell" && card.cardKind !== "trap";
  previewEls.atk.textContent = isMonster ? `ATK: ${card.atk}` : card.cardKind.toUpperCase();
  previewEls.def.textContent = isMonster ? `DEF: ${card.def}` : (card.subtype ? card.subtype.toUpperCase() : "");
  previewEls.level.textContent = isMonster ? `Level: ${card.level}` : "";
  previewEls.desc.textContent = card.description || "Sem descricao.";
}

function renderDeckBuilder() {
  deckGrid.innerHTML = "";
  poolGrid.innerHTML = "";
  const counts = {};
  currentDeck.forEach((id) => {
    counts[id] = counts[id] || 0;
    counts[id]++;
  });
  deckCountEl.textContent = `${currentDeck.length} / 30`;

  // Deck slots 6x5 = 30
  for (let i = 0; i < 30; i++) {
    const slot = document.createElement("div");
    slot.className = "deck-slot";
    const cardId = currentDeck[i];
    if (cardId) {
      const cardData = cardDatabase.find((c) => c.id === cardId);
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

  // Pool of all cards with counts
  cardDatabase.forEach((card) => {
    const cardEl = createCardThumb(card);
    const count = counts[card.id] || 0;
    const badge = document.createElement("div");
    badge.className = "pool-count";
    badge.textContent = `${count}/3`;
    cardEl.appendChild(badge);

    cardEl.onmouseenter = () => setPreview(card);
    cardEl.onclick = () => {
      if (currentDeck.length >= 30) {
        alert("Limite de 30 cartas atingido.");
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
  if (cardDatabase.length > 0) {
    setPreview(cardDatabase[0]);
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
  if (currentDeck.length !== 30) {
    alert("O deck precisa ter exatamente 30 cartas.");
    return;
  }
  saveDeck(currentDeck);
  startScreen.classList.add("hidden");
  deckBuilder.classList.add("hidden");
  game = new Game();
  game.start([...currentDeck]);
}

btnDeckBuilder?.addEventListener("click", openDeckBuilder);
btnDeckCancel?.addEventListener("click", closeDeckBuilder);
btnDeckSave?.addEventListener("click", () => {
  saveDeck(currentDeck);
  closeDeckBuilder();
});
btnStartDuel?.addEventListener("click", startDuel);

document.addEventListener("DOMContentLoaded", () => {
  startScreen.classList.remove("hidden");
});
