import {
  BANLIST_STATUS,
  CURRENT_BANLIST,
} from "../../../data/banlist.js";

export const DECK_TYPES = Object.freeze({
  MAIN: "main",
  EXTRA: "extra",
});

export const NORMAL_COPY_LIMITS = Object.freeze({
  [DECK_TYPES.MAIN]: 3,
  [DECK_TYPES.EXTRA]: 1,
});

const BANLIST_COPY_LIMITS = Object.freeze({
  [BANLIST_STATUS.FORBIDDEN]: 0,
  [BANLIST_STATUS.LIMITED]: 1,
  [BANLIST_STATUS.SEMI_LIMITED]: 2,
  [BANLIST_STATUS.UNLIMITED]: Number.POSITIVE_INFINITY,
});

const VALID_STATUSES = new Set(Object.values(BANLIST_STATUS));

function normalizeCardId(cardId) {
  const normalized = Number(cardId);
  return Number.isInteger(normalized) ? normalized : cardId;
}

function normalizeDeckType(deckType) {
  return deckType === DECK_TYPES.EXTRA ? DECK_TYPES.EXTRA : DECK_TYPES.MAIN;
}

export function getBanlistStatus(cardId, banlist = CURRENT_BANLIST) {
  const normalizedId = normalizeCardId(cardId);
  return banlist?.[normalizedId] || BANLIST_STATUS.UNLIMITED;
}

export function isBanlistRestricted(cardId, banlist = CURRENT_BANLIST) {
  return getBanlistStatus(cardId, banlist) !== BANLIST_STATUS.UNLIMITED;
}

export function getCardCopyLimit(
  cardId,
  { deckType = DECK_TYPES.MAIN, banlist = CURRENT_BANLIST } = {},
) {
  const normalizedDeckType = normalizeDeckType(deckType);
  const normalLimit = NORMAL_COPY_LIMITS[normalizedDeckType];
  const status = getBanlistStatus(cardId, banlist);
  const banlistLimit = BANLIST_COPY_LIMITS[status];
  return Math.min(normalLimit, banlistLimit ?? normalLimit);
}

export function getDeckCopyLimitState(
  cardId,
  count = 0,
  { deckType = DECK_TYPES.MAIN, banlist = CURRENT_BANLIST } = {},
) {
  const normalizedCount = Math.max(0, Number(count) || 0);
  const status = getBanlistStatus(cardId, banlist);
  const limit = getCardCopyLimit(cardId, { deckType, banlist });
  return {
    cardId: normalizeCardId(cardId),
    status,
    count: normalizedCount,
    limit,
    restricted: status !== BANLIST_STATUS.UNLIMITED,
    atLimit: normalizedCount >= limit,
    label: `${normalizedCount}/${limit}`,
  };
}

function collectDeckViolations(deck, deckType, banlist) {
  const counts = new Map();
  for (const rawId of deck || []) {
    const cardId = normalizeCardId(rawId);
    counts.set(cardId, (counts.get(cardId) || 0) + 1);
  }

  const violations = [];
  for (const [cardId, count] of counts.entries()) {
    const status = getBanlistStatus(cardId, banlist);
    const limit = getCardCopyLimit(cardId, { deckType, banlist });
    if (count <= limit) continue;
    violations.push({
      cardId,
      status,
      count,
      limit,
      deckType: normalizeDeckType(deckType),
    });
  }
  return violations;
}

export function validateDeckAgainstBanlist(
  { deck = [], extraDeck = [] } = {},
  { banlist = CURRENT_BANLIST } = {},
) {
  const violations = [
    ...collectDeckViolations(deck, DECK_TYPES.MAIN, banlist),
    ...collectDeckViolations(extraDeck, DECK_TYPES.EXTRA, banlist),
  ];
  violations.sort(
    (a, b) =>
      a.deckType.localeCompare(b.deckType) ||
      Number(a.cardId) - Number(b.cardId),
  );
  return {
    ok: violations.length === 0,
    violations,
  };
}

export function assertDeckBanlistLegal(decks, options = {}) {
  const result = validateDeckAgainstBanlist(decks, options);
  if (result.ok) return result;
  const details = result.violations
    .map(
      ({ cardId, count, limit, deckType }) =>
        `${deckType} card ${cardId}: ${count}/${limit}`,
    )
    .join(", ");
  throw new Error(`Deck violates copy limits: ${details}.`);
}

export function validateBanlistDefinition(
  cardDatabase = [],
  banlist = CURRENT_BANLIST,
) {
  const errors = [];
  const knownIds = new Set(
    (cardDatabase || [])
      .map((card) => Number(card?.id))
      .filter(Number.isInteger),
  );

  if (!banlist || typeof banlist !== "object" || Array.isArray(banlist)) {
    return {
      ok: false,
      errors: [
        {
          cardId: null,
          status: null,
          message: "Banlist must be an object keyed by card id.",
        },
      ],
    };
  }

  for (const [rawId, status] of Object.entries(banlist)) {
    const cardId = Number(rawId);
    if (!Number.isInteger(cardId) || cardId <= 0) {
      errors.push({
        cardId: rawId,
        status,
        message: `Banlist card id "${rawId}" must be a positive integer.`,
      });
      continue;
    }
    if (!knownIds.has(cardId)) {
      errors.push({
        cardId,
        status,
        message: `Banlist references unknown card id ${cardId}.`,
      });
    }
    if (!VALID_STATUSES.has(status)) {
      errors.push({
        cardId,
        status,
        message: `Banlist status "${status}" is invalid for card id ${cardId}.`,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}
