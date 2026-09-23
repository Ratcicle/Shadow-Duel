import type { UiCard } from "../renderer/types.js";
export interface DeckCard extends UiCard {
  id: number;
  name: string;
  archetypes?: readonly string[];
  archetype?: string | null;
}
export interface DeckPreset {
  name: string;
  deck: number[];
  extraDeck: number[];
}
import { cardDatabase, cardDatabaseById } from "../../data/cards.js";
import { DECK_TYPES, getCardCopyLimit } from "../../core/game/deck/banlist.js";

export const BOT_PRESET_KEY = "shadow_duel_bot_preset";
export const DECK_PRESETS_KEY = "shadow_duel_deck_presets";
export const ACTIVE_DECK_SLOT_KEY = "shadow_duel_active_deck_slot";
export const DECK_PRESET_COUNT = 8;
export const MIN_DECK_SIZE = 20;
export const MAX_DECK_SIZE = 30;
export const MAX_EXTRA_DECK_SIZE = 10;

// The only supported persisted format. Unmarked or different formats are ignored.
const DECK_PRESETS_FORMAT = 3;

const cardKindOrder: Record<string, number> = { monster: 0, spell: 1, trap: 2 };
const extraDeckTypeOrder: Record<string, number> = {
  fusion: 0,
  synchro: 1,
  ascension: 2,
};
const EXTRA_DECK_MONSTER_TYPES = new Set(["fusion", "synchro", "ascension"]);
const spellTrapSubtypeOrder: Record<string, number> = {
  normal: 0,
  quick: 1,
  equip: 2,
  continuous: 3,
  field: 4,
  counter: 5,
};

export function getCardById(cardId: number): DeckCard | undefined {
  return cardDatabaseById.get(cardId);
}

export function levelOf(card: UiCard | null | undefined) {
  return typeof card?.level === "number" && !Number.isNaN(card.level)
    ? card.level
    : 0;
}

export function isExtraDeckMonster(card: UiCard | null | undefined) {
  return EXTRA_DECK_MONSTER_TYPES.has(card?.monsterType!);
}

export function sortDeck(deckIds: readonly number[] = []) {
  return [...deckIds].sort((aId, bId) => {
    const cardA = getCardById(aId);
    const cardB = getCardById(bId);
    const kindA = (cardA?.cardKind || "").toLowerCase();
    const kindB = (cardB?.cardKind || "").toLowerCase();
    const orderA = Object.prototype.hasOwnProperty.call(cardKindOrder, kindA)
      ? cardKindOrder[kindA]!
      : 99;
    const orderB = Object.prototype.hasOwnProperty.call(cardKindOrder, kindB)
      ? cardKindOrder[kindB]!
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
        ? spellTrapSubtypeOrder[subtypeA]!
        : 99;
      const subtypeOrderB = Object.prototype.hasOwnProperty.call(
        spellTrapSubtypeOrder,
        subtypeB,
      )
        ? spellTrapSubtypeOrder[subtypeB]!
        : 99;
      if (subtypeOrderA !== subtypeOrderB) return subtypeOrderA - subtypeOrderB;
    }
    const nameA = cardA?.name || "";
    const nameB = cardB?.name || "";
    return nameA.localeCompare(nameB);
  });
}

export function sortExtraDeck(extraDeckIds: readonly number[] = []) {
  return [...extraDeckIds].sort((aId, bId) => {
    const cardA = getCardById(aId);
    const cardB = getCardById(bId);
    const typeA = (cardA?.monsterType || "").toLowerCase();
    const typeB = (cardB?.monsterType || "").toLowerCase();
    const orderA = Object.prototype.hasOwnProperty.call(
      extraDeckTypeOrder,
      typeA,
    )
      ? extraDeckTypeOrder[typeA]!
      : 99;
    const orderB = Object.prototype.hasOwnProperty.call(
      extraDeckTypeOrder,
      typeB,
    )
      ? extraDeckTypeOrder[typeB]!
      : 99;
    if (orderA !== orderB) return orderA - orderB;
    const levelA = levelOf(cardA);
    const levelB = levelOf(cardB);
    if (levelA !== levelB) return levelA - levelB;
    return (cardA?.name || "").localeCompare(cardB?.name || "");
  });
}

export function sanitizeExtraDeck(
  extraDeck: readonly unknown[] | null | undefined,
) {
  const valid = new Set(
    cardDatabase
      .filter((card) => isExtraDeckMonster(card))
      .map((card) => card.id),
  );
  const seen = new Set();
  const result = [];
  for (const id of extraDeck || []) {
    if (typeof id !== "number" || !valid.has(id)) continue;
    if (seen.has(id)) continue;
    if (result.length >= MAX_EXTRA_DECK_SIZE) break;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function sanitizeDeck(
  deck: readonly unknown[] | null | undefined,
) {
  const valid = new Set(
    cardDatabase
      .filter((card) => !isExtraDeckMonster(card))
      .map((card) => card.id),
  );
  const counts: Record<number, number> = {};
  const result = [];
  for (const id of deck || []) {
    if (typeof id !== "number" || !valid.has(id)) continue;
    counts[id] = counts[id] || 0;
    if (counts[id] >= 3) continue;
    if (result.length >= MAX_DECK_SIZE) break;
    counts[id]++;
    result.push(id);
  }
  return result;
}

export function topUpDeck(deck: readonly number[]) {
  const counts: Record<number, number> = {};
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
    const sizeBeforePass = filled.length;
    for (const card of cardDatabase) {
      counts[card.id] = counts[card.id] || 0;
      if (isExtraDeckMonster(card)) {
        continue;
      }
      const copyLimit = getCardCopyLimit(card.id, {
        deckType: DECK_TYPES.MAIN,
      });
      if (counts[card.id]! < copyLimit && filled.length < targetSize) {
        filled.push(card.id);
        counts[card.id]!++;
      }
    }
    if (filled.length === sizeBeforePass) {
      throw new Error(
        "Unable to build a legal Main Deck with the current banlist.",
      );
    }
  }
  return filled;
}

export function buildDefaultDeck() {
  return sortDeck(topUpDeck([]));
}

export function getDefaultDeckPreset(index: number): DeckPreset {
  return {
    name: `Deck ${index + 1}`,
    deck: buildDefaultDeck(),
    extraDeck: [],
  };
}

function normalizeDeckPreset(
  preset: DeckPreset,
  index: number,
): DeckPreset {
  return {
    name: preset.name.trim() || `Deck ${index + 1}`,
    deck: sanitizeDeck(preset.deck),
    extraDeck: sanitizeExtraDeck(preset.extraDeck),
  };
}

function isStoredDeckPreset(value: unknown): value is DeckPreset {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "deck" in value &&
    Array.isArray(value.deck) &&
    value.deck.every(
      (id: unknown) => typeof id === "number" && Number.isInteger(id) && id > 0,
    ) &&
    "extraDeck" in value &&
    Array.isArray(value.extraDeck) &&
    value.extraDeck.every(
      (id: unknown) => typeof id === "number" && Number.isInteger(id) && id > 0,
    )
  );
}

function readStoredDeckPresets(): DeckPreset[] | null {
  try {
    const stored = localStorage.getItem(DECK_PRESETS_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("idSchemaVersion" in parsed) ||
      parsed.idSchemaVersion !== DECK_PRESETS_FORMAT ||
      !("presets" in parsed) ||
      !Array.isArray(parsed.presets)
    ) {
      return null;
    }

    const storedPresets: readonly unknown[] = parsed.presets;
    return Array.from({ length: DECK_PRESET_COUNT }, (_, index) => {
      const preset = storedPresets[index];
      return isStoredDeckPreset(preset)
        ? normalizeDeckPreset(preset, index)
        : getDefaultDeckPreset(index);
    });
  } catch (e) {
    console.warn("Failed to load deck presets", e);
    return null;
  }
}

function loadDeckPresets() {
  return (
    readStoredDeckPresets() ??
    Array.from({ length: DECK_PRESET_COUNT }, (_, index) =>
      getDefaultDeckPreset(index),
    )
  );
}

export function loadStoredActiveDeckPreset(): DeckPreset | null {
  return readStoredDeckPresets()?.[loadActiveDeckSlot()] ?? null;
}

function persistDeckPresets(presets: readonly DeckPreset[]) {
  try {
    localStorage.setItem(
      DECK_PRESETS_KEY,
      JSON.stringify({
        idSchemaVersion: DECK_PRESETS_FORMAT,
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

function persistActiveDeckSlot(activeDeckSlot: number) {
  try {
    localStorage.setItem(ACTIVE_DECK_SLOT_KEY, String(activeDeckSlot));
  } catch (e) {
    console.warn("Failed to save active deck slot", e);
  }
}

export function loadBotPreset(
  availablePresets: readonly { id: string }[] = [],
) {
  try {
    const stored = localStorage.getItem(BOT_PRESET_KEY);
    if (stored) return stored;
  } catch (e) {
    console.warn("Failed to load bot preset", e);
  }
  return availablePresets[0]?.id || "shadowheart";
}

export function saveBotPreset(preset: string) {
  try {
    localStorage.setItem(BOT_PRESET_KEY, preset);
  } catch (e) {
    console.warn("Failed to save bot preset", e);
  }
}

export function cardHasArchetype(card: DeckCard | null | undefined) {
  if (!card) return false;
  const archetypes = Array.isArray(card.archetypes)
    ? card.archetypes
    : card.archetype
      ? [card.archetype]
      : [];
  return archetypes.length > 0;
}

export function cardHasArchetypeName(
  card: DeckCard | null | undefined,
  archetypeName: string,
) {
  if (!card || !archetypeName) return false;
  const archetypes = Array.isArray(card.archetypes)
    ? card.archetypes
    : card.archetype
      ? [card.archetype]
      : [];
  return archetypes.includes(archetypeName);
}

export function normalizeArchetypeId(archetypeName: string | null | undefined) {
  const raw = String(archetypeName || "")
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (raw === "shadow-heart" || raw === "shadow_heart") return "shadowheart";
  return raw.replace(/[^a-z0-9]+/g, "");
}

export function inferDeckArchetype(deckIds: readonly number[] = []) {
  const counts = new Map<string, number>();
  let archetypedCards = 0;

  deckIds.forEach((cardId) => {
    const card = getCardById(cardId);
    const archetypes = Array.isArray(card?.archetypes)
      ? card.archetypes
      : card?.archetype
        ? [card.archetype]
        : [];
    const normalized = [
      ...new Set<string | null>(archetypes.map(normalizeArchetypeId)),
    ].filter((name): name is string => Boolean(name));
    if (!normalized.length) return;
    archetypedCards += 1;
    normalized.forEach((name) => counts.set(name, (counts.get(name) || 0) + 1));
  });

  if (!archetypedCards || counts.size === 0) return "custom";

  // A nonempty Map produces a nonempty dense entries array.
  const [bestName, bestCount] = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0]!;
  return bestCount / archetypedCards >= 0.5 ? bestName : "custom";
}

export function getSortedCardPool<T extends DeckCard>(cards: readonly T[]) {
  const spellSubtypeOrder: Record<string, number> = {
    normal: 0,
    equip: 1,
    field: 2,
  };
  const nameOf = (card: T) => card.name || "";
  const levelOfCard = (card: T) =>
    typeof card.level === "number" && !Number.isNaN(card.level)
      ? card.level
      : 0;
  const kindOf = (card: T) => (card.cardKind || "").toLowerCase();
  const subtypeOf = (card: T) => (card.subtype || "").toLowerCase();

  const monsters: T[] = [];
  const spells: T[] = [];
  const traps: T[] = [];
  const others: T[] = [];

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
      ? spellSubtypeOrder[subtypeOf(a)]!
      : 3;
    const subB = Object.prototype.hasOwnProperty.call(
      spellSubtypeOrder,
      subtypeOf(b),
    )
      ? spellSubtypeOrder[subtypeOf(b)]!
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
  const deckPresets = loadDeckPresets();
  let activeDeckSlot = loadActiveDeckSlot();
  let currentDeck = [
    ...(deckPresets[activeDeckSlot]?.deck || buildDefaultDeck()),
  ];
  let currentExtraDeck = [...(deckPresets[activeDeckSlot]?.extraDeck || [])];

  function saveActiveDeckPreset(nameOverride?: string) {
    const currentName =
      typeof nameOverride === "string"
        ? nameOverride
        : deckPresets[activeDeckSlot]?.name ?? "";
    const activePreset = normalizeDeckPreset(
      {
        name: currentName,
        deck: currentDeck,
        extraDeck: currentExtraDeck,
      },
      activeDeckSlot,
    );
    deckPresets[activeDeckSlot] = activePreset;
    currentDeck = [...activePreset.deck];
    currentExtraDeck = [...activePreset.extraDeck];
    persistDeckPresets(deckPresets);
    persistActiveDeckSlot(activeDeckSlot);
  }

  return {
    getDeckPresets: () => deckPresets,
    getActiveDeckSlot: () => activeDeckSlot,
    getCurrentDeck: () => currentDeck,
    getCurrentExtraDeck: () => currentExtraDeck,
    setCurrentDeck: (deck: readonly number[]) => {
      currentDeck = sanitizeDeck(deck);
    },
    setCurrentExtraDeck: (extraDeck: readonly number[]) => {
      currentExtraDeck = sanitizeExtraDeck(extraDeck);
    },
    saveDeck: (deck: readonly number[]) => {
      currentDeck = sanitizeDeck(deck);
      saveActiveDeckPreset();
    },
    saveExtraDeck: (extraDeck: readonly number[]) => {
      currentExtraDeck = sanitizeExtraDeck(extraDeck);
      saveActiveDeckPreset();
    },
    saveActiveDeckPreset,
    renameActiveDeckSlot: (name: string) => {
      const fallbackName = `Deck ${activeDeckSlot + 1}`;
      // Presets are normalized to DECK_PRESET_COUNT and the active slot is bounded.
      deckPresets[activeDeckSlot]!.name =
        String(name || "").trim() || fallbackName;
    },
    switchDeckSlot: (slotIndex: number, currentName?: string) => {
      if (slotIndex === activeDeckSlot) return false;
      if (slotIndex < 0 || slotIndex >= DECK_PRESET_COUNT) return false;
      saveActiveDeckPreset(currentName);
      activeDeckSlot = slotIndex;
      currentDeck = [
        ...(deckPresets[activeDeckSlot]?.deck || buildDefaultDeck()),
      ];
      currentExtraDeck = [...(deckPresets[activeDeckSlot]?.extraDeck || [])];
      persistActiveDeckSlot(activeDeckSlot);
      return true;
    },
  };
}

export type DeckState = ReturnType<typeof createDeckState>;
