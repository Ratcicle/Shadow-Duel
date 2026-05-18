import { cardDatabase } from "../data/cards.js";

const LOCALE_STORAGE_KEY = "shadowduel_locale";
const DEFAULT_LOCALE = "en";
const SUPPORTED_LOCALES = ["en", "pt-br"];

const ATTRIBUTE_LABELS = {
  en: {
    Light: "Light",
    Dark: "Dark",
    Fire: "Fire",
    Water: "Water",
    Earth: "Earth",
    Wind: "Wind",
  },
  "pt-br": {
    Light: "Luz",
    Dark: "Trevas",
    Fire: "Fogo",
    Water: "Água",
    Earth: "Terra",
    Wind: "Vento",
  },
};

const MONSTER_TYPE_LABELS = {
  en: {},
  "pt-br": {
    Beast: "Besta",
    Dragon: "Dragão",
    Fairy: "Fada",
    Fiend: "Demônio",
    Insect: "Inseto",
    Reptile: "Réptil",
    "Sea Serpent": "Serpente Marinha",
    Spellcaster: "Mago",
    Spirit: "Espírito",
    Warrior: "Guerreiro",
    "Winged Beast": "Besta Alada",
  },
};

const CARD_KIND_LABELS = {
  en: {
    spell: "Spell",
    trap: "Trap",
  },
  "pt-br": {
    spell: "Magia",
    trap: "Armadilha",
  },
};

const SUBTYPE_LABELS = {
  en: {
    normal: "Normal",
    continuous: "Continuous",
    field: "Field",
    equip: "Equip",
    quick: "Quick-Play",
  },
  "pt-br": {
    normal: "Normal",
    continuous: "Contínua",
    field: "Campo",
    equip: "Equipamento",
    quick: "Rápida",
  },
};

const CARD_KIND_SUBTYPE_PHRASES = {
  en: {
    spell: {
      normal: "normal spell",
      continuous: "continuous spell",
      field: "field spell",
      equip: "equip spell",
      quick: "quick-play spell",
    },
    trap: {
      normal: "normal trap",
      continuous: "continuous trap",
    },
  },
  "pt-br": {
    spell: {
      normal: "magia normal",
      continuous: "magia contínua",
      field: "magia de campo",
      equip: "magia de equipamento",
      quick: "magia rápida",
    },
    trap: {
      normal: "armadilha normal",
      continuous: "armadilha contínua",
    },
  },
};

const LOCALE_SOURCES = {
  // English text is the canonical card data in cards.js.
  "pt-br": "../locales/pt-br.json",
};

async function loadLocalePayload(relativePath) {
  try {
    const url = new URL(relativePath, import.meta.url);
    // Browser/runtime with fetch over HTTP(S)
    if (typeof fetch === "function" && url.protocol !== "file:") {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`[i18n] Failed to load locale file ${relativePath}`);
        return {};
      }
      return await response.json();
    }
    // Node or file:// fallback
    const { readFile } = await import("fs/promises");
    const fileData = await readFile(url);
    return JSON.parse(fileData.toString());
  } catch (err) {
    console.error(`[i18n] Error loading locale file ${relativePath}:`, err);
    return {};
  }
}

async function loadAllLocales() {
  const entries = await Promise.all(
    Object.entries(LOCALE_SOURCES).map(async ([locale, path]) => {
      const payload = await loadLocalePayload(path);
      return [locale, payload];
    })
  );
  return Object.fromEntries(entries);
}

const rawLocales = await loadAllLocales();

const normalizedLocales = Object.fromEntries(
  Object.entries(rawLocales).map(([locale, payload]) => [
    locale,
    normalizeLocalePayload(payload),
  ])
);

let currentLocale = DEFAULT_LOCALE;
let lastCoverageLogLocale = null;

function normalizeLocalePayload(payload) {
  const cards = {};
  if (!isObject(payload)) {
    return { cards };
  }

  const sections = [];
  if (isObject(payload.cards)) {
    sections.push(payload.cards);
  }
  if (isObject(payload.cardTranslations)) {
    if (isObject(payload.cardTranslations.cards)) {
      sections.push(payload.cardTranslations.cards);
    } else {
      sections.push(payload.cardTranslations);
    }
  }
  if (isObject(payload.translations)) {
    if (isObject(payload.translations.cards)) {
      sections.push(payload.translations.cards);
    } else {
      sections.push(payload.translations);
    }
  }

  sections.forEach((section) => {
    Object.entries(section).forEach(([rawKey, rawValue]) => {
      const idKey = String(rawKey || "").trim();
      if (!idKey) return;
      cards[idKey] = cards[idKey] || {};
      if (typeof rawValue === "string") {
        cards[idKey].name = rawValue.trim();
      } else if (isObject(rawValue)) {
        if (typeof rawValue.name === "string") {
          cards[idKey].name = rawValue.name.trim();
        }
        if (typeof rawValue.description === "string") {
          cards[idKey].description = rawValue.description.trim();
        }
      }
    });
  });

  return { cards };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readStoredLocale() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch (err) {
    console.warn("Unable to read stored locale", err);
    return null;
  }
}

function persistLocale(locale) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch (err) {
    console.warn("Unable to persist locale", err);
  }
}

function ensureSupportedLocale(locale) {
  return SUPPORTED_LOCALES.includes(locale) ? locale : null;
}

function logCoverageIfNeeded(locale) {
  if (locale !== "pt-br") return;
  if (lastCoverageLogLocale === locale) return;
  lastCoverageLogLocale = locale;
  const ptCards = normalizedLocales["pt-br"].cards || {};
  const totalCount = cardDatabase.length;
  let translatedCount = 0;
  let extraCount = 0;

  const dbIds = new Set(cardDatabase.map((card) => String(card?.id)));

  for (const cardId of Object.keys(ptCards)) {
    if (!dbIds.has(cardId)) extraCount += 1;
  }

  for (const card of cardDatabase) {
    const idKey = String(card?.id);
    const entry = ptCards[idKey];
    if (!entry) continue;
    if (typeof entry.name === "string" || typeof entry.description === "string")
      translatedCount += 1;
  }

  console.info(
    `[i18n] pt-br translations: ${translatedCount}/${totalCount} cards (${
      totalCount - translatedCount
    } missing, ${extraCount} extra).`
  );
}

export function initializeLocale() {
  const stored = ensureSupportedLocale(readStoredLocale());
  currentLocale = stored || DEFAULT_LOCALE;
  logCoverageIfNeeded(currentLocale);
  return currentLocale;
}

export function getLocale() {
  return currentLocale;
}

export function setLocale(locale) {
  const normalized = ensureSupportedLocale(locale);
  if (!normalized) return currentLocale;
  currentLocale = normalized;
  persistLocale(normalized);
  logCoverageIfNeeded(normalized);
  return currentLocale;
}

export function getCardDisplayName(card) {
  return getCardDisplayProperty(card, "name");
}

export function getCardDisplayDescription(card) {
  return getCardDisplayProperty(card, "description");
}

export function getMonsterAttributeDisplayName(attribute) {
  const rawAttribute = String(attribute || "").trim();
  if (!rawAttribute) return "";
  return ATTRIBUTE_LABELS[currentLocale]?.[rawAttribute] || rawAttribute;
}

export function getMonsterTypeDisplayName(card) {
  const rawTypes = Array.isArray(card?.types)
    ? card.types
    : card?.type
      ? [card.type]
      : [];
  if (rawTypes.length === 0) {
    return currentLocale === "pt-br" ? "Monstro" : "Monster";
  }

  return rawTypes
    .map((type) => {
      const rawType = String(type || "").trim();
      return MONSTER_TYPE_LABELS[currentLocale]?.[rawType] || rawType;
    })
    .filter(Boolean)
    .join(" / ");
}

export function getMonsterDetailParts(card) {
  const level = Number.isFinite(card?.level) ? card.level : "-";
  const type = getMonsterTypeDisplayName(card);
  const attribute = getMonsterAttributeDisplayName(card?.attribute);
  return { level, type, attribute };
}

export function formatMonsterDetailLine(card) {
  const { level, type, attribute } = getMonsterDetailParts(card);
  const parts = [`⭐${level}`, type];
  if (attribute) parts.push(attribute);
  return parts.filter(Boolean).join(" | ");
}

export function formatMonsterDetailHtml(card) {
  const { level, type, attribute } = getMonsterDetailParts(card);
  const rest = [type, attribute].filter(Boolean).map(escapeHtml).join(" | ");
  return `⭐<span class="monster-level-number">${escapeHtml(level)}</span>${
    rest ? ` | ${rest}` : ""
  }`;
}

export function formatMonsterStatsLine(card) {
  const atk = Number.isFinite(card?.atk) ? card.atk : "-";
  const def = Number.isFinite(card?.def) ? card.def : "-";
  return {
    atk: `ATK: ${atk}`,
    def: `DEF: ${def}`,
  };
}

export function formatCardKindSubtypeLine(card) {
  const rawKind = String(card?.cardKind || "card").trim();
  const rawSubtype = String(card?.subtype || "").trim();
  const phrase =
    CARD_KIND_SUBTYPE_PHRASES[currentLocale]?.[rawKind]?.[rawSubtype] ||
    CARD_KIND_SUBTYPE_PHRASES.en?.[rawKind]?.[rawSubtype];
  if (phrase) return phrase;

  const kindLabel = CARD_KIND_LABELS[currentLocale]?.[rawKind] || rawKind.toUpperCase();
  const subtypeLabel = rawSubtype
    ? SUBTYPE_LABELS[currentLocale]?.[rawSubtype] || rawSubtype.toUpperCase()
    : "";
  if (!subtypeLabel) return kindLabel;
  return currentLocale === "pt-br"
    ? `${kindLabel.toLowerCase()} ${subtypeLabel.toLowerCase()}`
    : `${subtypeLabel.toLowerCase()} ${kindLabel.toLowerCase()}`;
}

function getCardDisplayProperty(card, property) {
  const fallbackText = String(
    property === "name" ? card?.name || "" : card?.description || ""
  ).trim();
  const idKey = card && (card.id !== undefined ? String(card.id) : null);
  if (idKey) {
    const localeEntry = normalizedLocales[currentLocale]?.cards?.[idKey];
    if (localeEntry && typeof localeEntry[property] === "string") {
      return localeEntry[property];
    }
    const enEntry = normalizedLocales["en"]?.cards?.[idKey];
    if (enEntry && typeof enEntry[property] === "string") {
      return enEntry[property];
    }
  }
  return fallbackText;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function getSupportedLocales() {
  return [...SUPPORTED_LOCALES];
}
