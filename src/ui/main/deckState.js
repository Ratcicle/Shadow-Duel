import { cardDatabase, cardDatabaseById } from "../../data/cards.js";
import {
  CARD_ID_MIGRATION_VERSION,
  migrateCardId,
} from "../../data/cards/idMigration.js";

export const BOT_PRESET_KEY = "shadow_duel_bot_preset";
export const LEGACY_DECK_KEY = "shadow_duel_deck";
export const LEGACY_EXTRA_DECK_KEY = "shadow_duel_extra_deck";
export const LEGACY_DECK_ID_SCHEMA_VERSION_KEY =
  "shadow_duel_deck_id_schema_version";
export const DECK_PRESETS_KEY = "shadow_duel_deck_presets";
export const ACTIVE_DECK_SLOT_KEY = "shadow_duel_active_deck_slot";
export const DECK_PRESET_COUNT = 8;
export const MIN_DECK_SIZE = 20;
export const MAX_DECK_SIZE = 30;
export const MAX_EXTRA_DECK_SIZE = 10;

const cardKindOrder = { monster: 0, spell: 1, trap: 2 };
const extraDeckTypeOrder = { fusion: 0, synchro: 1, ascension: 2 };
const EXTRA_DECK_MONSTER_TYPES = new Set(["fusion", "synchro", "ascension"]);
const spellTrapSubtypeOrder = {
  normal: 0,
  quick: 1,
  equip: 2,
  continuous: 3,
  field: 4,
  counter: 5,
};

export function getCardById(cardId) {
  return cardDatabaseById.get(cardId);
}

function normalizeStoredCardId(cardId, { migrateIds = false } = {}) {
  const normalized = migrateIds ? migrateCardId(cardId) : Number(cardId);
  return Number.isInteger(normalized) ? normalized : cardId;
}

export function levelOf(card) {
  return typeof card?.level === "number" && !Number.isNaN(card.level)
    ? card.level
    : 0;
}

export function isExtraDeckMonster(card) {
  return EXTRA_DECK_MONSTER_TYPES.has(card?.monsterType);
}

export function sortDeck(deckIds = []) {
  return [...deckIds].sort((aId, bId) => {
    const cardA = getCardById(aId);
    const cardB = getCardById(bId);
    const kindA = (cardA?.cardKind || "").toLowerCase();
    const kindB = (cardB?.cardKind || "").toLowerCase();
    const orderA = Object.prototype.hasOwnProperty.call(cardKindOrder, kindA)
      ? cardKindOrder[kindA]
      : 99;
    const orderB = Object.prototype.hasOwnProperty.call(cardKindOrder, kindB)
      ? cardKindOrder[kindB]
      : 99;
    if (orderA !== orderB) return orderA - orderB;
    if (kindA === "monster" && kindB === "monster") {
      const levelA = levelOf(cardA);
      const levelB = levelOf(cardB);
      if (levelA !== levelB) return levelA - levelB;
    } else if (
      (kindA === "spell" || kindA === "trap") &&
      (kindB === "spell" || kindB === "trap")
    ) {
      const subtypeA = (cardA?.subtype || "").toLowerCase();
      const subtypeB = (cardB?.subtype || "").toLowerCase();
      const subtypeOrderA = Object.prototype.hasOwnProperty.call(
        spellTrapSubtypeOrder,
        subtypeA,
      )
        ? spellTrapSubtypeOrder[subtypeA]
        : 99;
      const subtypeOrderB = Object.prototype.hasOwnProperty.call(
        spellTrapSubtypeOrder,
        subtypeB,
      )
        ? spellTrapSubtypeOrder[subtypeB]
        : 99;
      if (subtypeOrderA !== subtypeOrderB) return subtypeOrderA - subtypeOrderB;
    }
    const nameA = cardA?.name || "";
    const nameB = cardB?.name || "";
    return nameA.localeCompare(nameB);
  });
}

export function sortExtraDeck(extraDeckIds = []) {
  return [...extraDeckIds].sort((aId, bId) => {
    const cardA = getCardById(aId);
    const cardB = getCardById(bId);
    const typeA = (cardA?.monsterType || "").toLowerCase();
    const typeB = (cardB?.monsterType || "").toLowerCase();
    const orderA = Object.prototype.hasOwnProperty.call(extraDeckTypeOrder, typeA)
      ? extraDeckTypeOrder[typeA]
      : 99;
    const orderB = Object.prototype.hasOwnProperty.call(extraDeckTypeOrder, typeB)
      ? extraDeckTypeOrder[typeB]
      : 99;
    if (orderA !== orderB) return orderA - orderB;
    const levelA = levelOf(cardA);
    const levelB = levelOf(cardB);
    if (levelA !== levelB) return levelA - levelB;
    return (cardA?.name || "").localeCompare(cardB?.name || "");
  });
}

export function sanitizeExtraDeck(extraDeck, options = {}) {
  const valid = new Set(
    cardDatabase
      .filter((card) => isExtraDeckMonster(card))
      .map((card) => card.id),
  );
  const seen = new Set();
  const result = [];
  for (const rawId of extraDeck || []) {
    const id = normalizeStoredCardId(rawId, options);
    if (!valid.has(id)) continue;
    if (seen.has(id)) continue;
    if (result.length >= MAX_EXTRA_DECK_SIZE) break;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function sanitizeDeck(deck, options = {}) {
  const valid = new Set(
    cardDatabase
      .filter((card) => !isExtraDeckMonster(card))
      .map((card) => card.id),
  );
  const counts = {};
  const result = [];
  for (const rawId of deck || []) {
    const id = normalizeStoredCardId(rawId, options);
    if (!valid.has(id)) continue;
    counts[id] = counts[id] || 0;
    if (counts[id] >= 3) continue;
    if (result.length >= MAX_DECK_SIZE) break;
    counts[id]++;
    result.push(id);
  }
  return result;
}

export function topUpDeck(deck) {
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
      if (isExtraDeckMonster(card)) {
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

export function buildDefaultDeck() {
  return sortDeck(topUpDeck([]));
}

export function getDefaultDeckPreset(index) {
  return {
    name: `Deck ${index + 1}`,
    deck: buildDefaultDeck(),
    extraDeck: [],
  };
}

export function normalizeDeckPreset(rawPreset, index, options = {}) {
  const fallback = getDefaultDeckPreset(index);
  const rawName =
    typeof rawPreset?.name === "string" ? rawPreset.name.trim() : "";
  return {
    name: rawName || fallback.name,
    deck: Array.isArray(rawPreset?.deck)
      ? sanitizeDeck(rawPreset.deck, options)
      : fallback.deck,
    extraDeck: Array.isArray(rawPreset?.extraDeck)
      ? sanitizeExtraDeck(rawPreset.extraDeck, options)
      : fallback.extraDeck,
  };
}

function readLegacyDeckPreset() {
  const preset = {};
  let migrateIds = true;
  try {
    migrateIds =
      localStorage.getItem(LEGACY_DECK_ID_SCHEMA_VERSION_KEY) !==
      String(CARD_ID_MIGRATION_VERSION);
  } catch (e) {
    console.warn("Failed to load legacy deck ID schema version", e);
  }
  try {
    const storedDeck = localStorage.getItem(LEGACY_DECK_KEY);
    if (storedDeck) {
      preset.deck = JSON.parse(storedDeck);
    }
  } catch (e) {
    console.warn("Failed to load legacy deck", e);
  }
  try {
    const storedExtraDeck = localStorage.getItem(LEGACY_EXTRA_DECK_KEY);
    if (storedExtraDeck) {
      preset.extraDeck = JSON.parse(storedExtraDeck);
    }
  } catch (e) {
    console.warn("Failed to load legacy extra deck", e);
  }
  return preset.deck || preset.extraDeck ? { preset, migrateIds } : null;
}

function getStoredDeckPresetPayload(parsed) {
  if (Array.isArray(parsed)) {
    return { presets: parsed, migrateIds: true, shouldPersist: true };
  }

  if (parsed && typeof parsed === "object" && Array.isArray(parsed.presets)) {
    const isCurrentVersion =
      parsed.idSchemaVersion === CARD_ID_MIGRATION_VERSION;
    return {
      presets: parsed.presets,
      migrateIds: !isCurrentVersion,
      shouldPersist: !isCurrentVersion,
    };
  }

  return null;
}

function loadDeckPresets() {
  try {
    const stored = localStorage.getItem(DECK_PRESETS_KEY);
    const parsed = stored ? JSON.parse(stored) : null;
    const payload = getStoredDeckPresetPayload(parsed);
    if (payload) {
      const presets = Array.from({ length: DECK_PRESET_COUNT }, (_, index) =>
        normalizeDeckPreset(payload.presets[index], index, {
          migrateIds: payload.migrateIds,
        }),
      );
      if (payload.shouldPersist) persistDeckPresets(presets);
      return presets;
    }
  } catch (e) {
    console.warn("Failed to load deck presets", e);
  }

  const presets = Array.from({ length: DECK_PRESET_COUNT }, (_, index) =>
    getDefaultDeckPreset(index),
  );
  const legacyPreset = readLegacyDeckPreset();
  if (legacyPreset) {
    presets[0] = normalizeDeckPreset(
      { name: "Deck 1", ...legacyPreset.preset },
      0,
      { migrateIds: legacyPreset.migrateIds },
    );
    persistDeckPresets(presets);
    saveLegacyDeckFallback(presets[0].deck, presets[0].extraDeck);
  }
  return presets;
}

function persistDeckPresets(presets) {
  try {
    localStorage.setItem(
      DECK_PRESETS_KEY,
      JSON.stringify({
        idSchemaVersion: CARD_ID_MIGRATION_VERSION,
        presets,
      }),
    );
  } catch (e) {
    console.warn("Failed to save deck presets", e);
  }
}

function loadActiveDeckSlot() {
  try {
    const stored = Number(localStorage.getItem(ACTIVE_DECK_SLOT_KEY));
    if (Number.isInteger(stored) && stored >= 0 && stored < DECK_PRESET_COUNT) {
      return stored;
    }
  } catch (e) {
    console.warn("Failed to load active deck slot", e);
  }
  return 0;
}

function persistActiveDeckSlot(activeDeckSlot) {
  try {
    localStorage.setItem(ACTIVE_DECK_SLOT_KEY, String(activeDeckSlot));
  } catch (e) {
    console.warn("Failed to save active deck slot", e);
  }
}

function saveLegacyDeckFallback(currentDeck, currentExtraDeck) {
  try {
    localStorage.setItem(LEGACY_DECK_KEY, JSON.stringify(currentDeck));
    localStorage.setItem(
      LEGACY_EXTRA_DECK_KEY,
      JSON.stringify(currentExtraDeck),
    );
    localStorage.setItem(
      LEGACY_DECK_ID_SCHEMA_VERSION_KEY,
      String(CARD_ID_MIGRATION_VERSION),
    );
  } catch (e) {
    console.warn("Failed to save legacy deck fallback", e);
  }
}

export function loadBotPreset(availablePresets = []) {
  try {
    const stored = localStorage.getItem(BOT_PRESET_KEY);
    if (stored) return stored;
  } catch (e) {
    console.warn("Failed to load bot preset", e);
  }
  return availablePresets[0]?.id || "shadowheart";
}

export function saveBotPreset(preset) {
  try {
    localStorage.setItem(BOT_PRESET_KEY, preset);
  } catch (e) {
    console.warn("Failed to save bot preset", e);
  }
}

export function cardHasArchetype(card) {
  if (!card) return false;
  const archetypes = Array.isArray(card.archetypes)
    ? card.archetypes
    : card.archetype
      ? [card.archetype]
      : [];
  return archetypes.length > 0;
}

export function cardHasArchetypeName(card, archetypeName) {
  if (!card || !archetypeName) return false;
  const archetypes = Array.isArray(card.archetypes)
    ? card.archetypes
    : card.archetype
      ? [card.archetype]
      : [];
  return archetypes.includes(archetypeName);
}

export function normalizeArchetypeId(archetypeName) {
  const raw = String(archetypeName || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "shadow-heart" || raw === "shadow_heart") return "shadowheart";
  return raw.replace(/[^a-z0-9]+/g, "");
}

export function inferDeckArchetype(deckIds = []) {
  const counts = new Map();
  let archetypedCards = 0;

  deckIds.forEach((cardId) => {
    const card = getCardById(cardId);
    const archetypes = Array.isArray(card?.archetypes)
      ? card.archetypes
      : card?.archetype
        ? [card.archetype]
        : [];
    const normalized = [...new Set(archetypes.map(normalizeArchetypeId))]
      .filter(Boolean);
    if (!normalized.length) return;
    archetypedCards += 1;
    normalized.forEach((name) => counts.set(name, (counts.get(name) || 0) + 1));
  });

  if (!archetypedCards || counts.size === 0) return "custom";

  const [bestName, bestCount] = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0];
  return bestCount / archetypedCards >= 0.5 ? bestName : "custom";
}

export function getSortedCardPool(cards) {
  const spellSubtypeOrder = { normal: 0, equip: 1, field: 2 };
  const nameOf = (card) => card.name || "";
  const levelOfCard = (card) =>
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
    const levelA = levelOfCard(a);
    const levelB = levelOfCard(b);
    if (levelA !== levelB) return levelB - levelA;
    return nameOf(a).localeCompare(nameOf(b));
  });

  const sortedSpells = spells.sort((a, b) => {
    const subA = Object.prototype.hasOwnProperty.call(
      spellSubtypeOrder,
      subtypeOf(a),
    )
      ? spellSubtypeOrder[subtypeOf(a)]
      : 3;
    const subB = Object.prototype.hasOwnProperty.call(
      spellSubtypeOrder,
      subtypeOf(b),
    )
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

export function createDeckState() {
  let deckPresets = loadDeckPresets();
  let activeDeckSlot = loadActiveDeckSlot();
  let currentDeck = [...(deckPresets[activeDeckSlot]?.deck || buildDefaultDeck())];
  let currentExtraDeck = [...(deckPresets[activeDeckSlot]?.extraDeck || [])];

  function saveActiveDeckPreset(nameOverride) {
    const currentName =
      typeof nameOverride === "string"
        ? nameOverride
        : deckPresets[activeDeckSlot]?.name;
    deckPresets[activeDeckSlot] = normalizeDeckPreset(
      {
        name: currentName,
        deck: currentDeck,
        extraDeck: currentExtraDeck,
      },
      activeDeckSlot,
    );
    currentDeck = [...deckPresets[activeDeckSlot].deck];
    currentExtraDeck = [...deckPresets[activeDeckSlot].extraDeck];
    persistDeckPresets(deckPresets);
    persistActiveDeckSlot(activeDeckSlot);
    saveLegacyDeckFallback(currentDeck, currentExtraDeck);
  }

  return {
    getDeckPresets: () => deckPresets,
    getActiveDeckSlot: () => activeDeckSlot,
    getCurrentDeck: () => currentDeck,
    getCurrentExtraDeck: () => currentExtraDeck,
    setCurrentDeck: (deck) => {
      currentDeck = sanitizeDeck(deck);
    },
    setCurrentExtraDeck: (extraDeck) => {
      currentExtraDeck = sanitizeExtraDeck(extraDeck);
    },
    saveDeck: (deck) => {
      currentDeck = sanitizeDeck(deck);
      saveActiveDeckPreset();
    },
    saveExtraDeck: (extraDeck) => {
      currentExtraDeck = sanitizeExtraDeck(extraDeck);
      saveActiveDeckPreset();
    },
    saveActiveDeckPreset,
    renameActiveDeckSlot: (name) => {
      const fallbackName = `Deck ${activeDeckSlot + 1}`;
      deckPresets[activeDeckSlot].name = String(name || "").trim() || fallbackName;
    },
    switchDeckSlot: (slotIndex, currentName) => {
      if (slotIndex === activeDeckSlot) return false;
      if (slotIndex < 0 || slotIndex >= DECK_PRESET_COUNT) return false;
      saveActiveDeckPreset(currentName);
      activeDeckSlot = slotIndex;
      currentDeck = [...(deckPresets[activeDeckSlot]?.deck || buildDefaultDeck())];
      currentExtraDeck = [...(deckPresets[activeDeckSlot]?.extraDeck || [])];
      persistActiveDeckSlot(activeDeckSlot);
      return true;
    },
  };
}
