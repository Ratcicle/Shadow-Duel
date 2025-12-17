import { cardDatabase } from "../data/cards.js";
import enLocaleRaw from "../locales/en.json" assert { type: "json" };
import ptBrLocaleRaw from "../locales/pt-br.json" assert { type: "json" };

const LOCALE_STORAGE_KEY = "shadowduel_locale";
const DEFAULT_LOCALE = "en";
const SUPPORTED_LOCALES = ["en", "pt-br"];

const rawLocales = {
  en: enLocaleRaw,
  "pt-br": ptBrLocaleRaw,
};

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
  const translatedCount = Object.keys(
    normalizedLocales["pt-br"].cards || {}
  ).length;
  const totalCount = cardDatabase.length;
  console.info(
    `[i18n] pt-br translations: ${translatedCount}/${totalCount} cards (${
      totalCount - translatedCount
    } missing).`
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

export function getSupportedLocales() {
  return [...SUPPORTED_LOCALES];
}
