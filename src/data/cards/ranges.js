export const CARD_ID_RANGE_POLICY = Object.freeze({
  enforceAssignedRanges: true,
  mode: "renumbered",
});

export const CARD_ID_RANGES = Object.freeze([
  Object.freeze({
    key: "generic",
    label: "Genericas/Core",
    start: 1,
    end: 100,
  }),
  Object.freeze({
    key: "shadowHeart",
    label: "Shadow-Heart",
    start: 101,
    end: 150,
  }),
  Object.freeze({
    key: "luminarch",
    label: "Luminarch",
    start: 151,
    end: 200,
  }),
  Object.freeze({
    key: "void",
    label: "Void",
    start: 201,
    end: 250,
  }),
  Object.freeze({
    key: "dragon",
    label: "Dragon / Extreme Dragons",
    start: 251,
    end: 300,
  }),
  Object.freeze({
    key: "arcanist",
    label: "Arcanist",
    start: 301,
    end: 350,
  }),
  Object.freeze({
    key: "miragebound",
    label: "Miragebound",
    start: 351,
    end: 400,
  }),
  Object.freeze({
    key: "bloomrot",
    label: "Bloomrot",
    start: 401,
    end: 450,
  }),
  Object.freeze({
    key: "burningWest",
    label: "Burning West",
    start: 451,
    end: 500,
  }),
  Object.freeze({
    key: "techZero",
    label: "Tech-Zero",
    start: 501,
    end: 550,
  }),
]);

export const CARD_ID_RANGE_BY_KEY = new Map(
  CARD_ID_RANGES.map((range) => [range.key, range]),
);

export function getCardIdRangeByKey(key) {
  return CARD_ID_RANGE_BY_KEY.get(key) || null;
}

export function getCardIdRangeSize(range) {
  if (!range) return 0;
  return range.end - range.start + 1;
}

export function isCardIdInRange(cardId, range) {
  return (
    Number.isInteger(cardId) &&
    Boolean(range) &&
    cardId >= range.start &&
    cardId <= range.end
  );
}

export function getCardIdRangeForId(cardId) {
  return (
    CARD_ID_RANGES.find((range) => isCardIdInRange(cardId, range)) || null
  );
}

export function validateCardIdRangeRegistry() {
  const errors = [];
  const seenKeys = new Set();
  const claimedIds = new Map();

  for (const range of CARD_ID_RANGES) {
    if (!range || typeof range !== "object") {
      errors.push("Card ID range entries must be objects.");
      continue;
    }

    if (!range.key || typeof range.key !== "string") {
      errors.push("Card ID range entries must define a non-empty key.");
    } else if (seenKeys.has(range.key)) {
      errors.push(`Card ID range key "${range.key}" is duplicated.`);
    } else {
      seenKeys.add(range.key);
    }

    if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
      errors.push(`Card ID range "${range.key}" must use integer bounds.`);
      continue;
    }

    if (range.start <= 0) {
      errors.push(`Card ID range "${range.key}" must start above zero.`);
    }
    if (range.end < range.start) {
      errors.push(`Card ID range "${range.key}" end must be >= start.`);
      continue;
    }

    for (let id = range.start; id <= range.end; id += 1) {
      if (claimedIds.has(id)) {
        errors.push(
          `Card ID range "${range.key}" overlaps ${id} with "${claimedIds.get(id)}".`,
        );
        break;
      }
      claimedIds.set(id, range.key);
    }
  }

  return errors;
}
