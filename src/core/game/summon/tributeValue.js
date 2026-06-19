function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function matchesAny(value, expected) {
  const expectedValues = asArray(expected).map((entry) =>
    String(entry).toLowerCase(),
  );
  if (expectedValues.length === 0) return true;
  const values = asArray(value).map((entry) => String(entry).toLowerCase());
  return expectedValues.some((entry) => values.includes(entry));
}

export function cardMatchesTributeFilters(card, filters = {}) {
  if (!filters || typeof filters !== "object") return true;
  if (!card) return false;

  if (filters.requireFaceup === true && card.isFacedown === true) {
    return false;
  }
  if (filters.cardKind && !matchesAny(card.cardKind, filters.cardKind)) {
    return false;
  }
  if (filters.id !== undefined && card.id !== filters.id) return false;
  const expectedName = filters.name || filters.cardName;
  if (expectedName && card.name !== expectedName) return false;
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!matchesAny(archetypes, filters.archetype)) return false;
  }
  if (filters.type) {
    const types = Array.isArray(card.types) ? card.types : [card.type];
    if (!matchesAny(types, filters.type)) return false;
  }
  if (filters.attribute && card.attribute !== filters.attribute) return false;

  const level = Number(card.level || 0);
  if (filters.level !== undefined && level !== Number(filters.level)) return false;
  if (filters.minLevel !== undefined && level < Number(filters.minLevel)) {
    return false;
  }
  if (filters.maxLevel !== undefined && level > Number(filters.maxLevel)) {
    return false;
  }

  const atk = Number(card.atk || 0);
  const def = Number(card.def || 0);
  if (filters.minAtk !== undefined && atk < Number(filters.minAtk)) return false;
  if (filters.maxAtk !== undefined && atk > Number(filters.maxAtk)) return false;
  if (filters.minDef !== undefined && def < Number(filters.minDef)) return false;
  if (filters.maxDef !== undefined && def > Number(filters.maxDef)) return false;

  return true;
}

export function getTributeValueForSummon(
  tributeCard,
  summonedCard,
  options = {},
) {
  if (!tributeCard || tributeCard.cardKind !== "monster") return 0;

  const summonMethod = options.summonMethod || "tribute";
  let value = 1;
  const entries = asArray(tributeCard.tributeValue);

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.summonMethods && !matchesAny(summonMethod, entry.summonMethods)) {
      continue;
    }
    if (entry.requireFaceup === true && tributeCard.isFacedown === true) {
      continue;
    }
    if (
      entry.tributeCardFilters &&
      !cardMatchesTributeFilters(tributeCard, entry.tributeCardFilters)
    ) {
      continue;
    }
    if (
      entry.summonedCardFilters &&
      !cardMatchesTributeFilters(summonedCard, entry.summonedCardFilters)
    ) {
      continue;
    }

    const entryValue = Number(entry.countAs ?? entry.value ?? entry.count);
    if (Number.isFinite(entryValue) && entryValue > value) {
      value = Math.floor(entryValue);
    }
  }

  return Math.max(1, value);
}

export function getTributeValueTotal(tributeCards, summonedCard, options = {}) {
  return (tributeCards || []).reduce(
    (total, card) => total + getTributeValueForSummon(card, summonedCard, options),
    0,
  );
}

export function normalizeTributeIndices(field = [], tributeIndices = []) {
  if (!Array.isArray(field) || !Array.isArray(tributeIndices)) return [];
  const seen = new Set();
  const normalized = [];
  for (const index of tributeIndices) {
    if (!Number.isInteger(index)) continue;
    if (index < 0 || index >= field.length) continue;
    if (!field[index] || seen.has(index)) continue;
    seen.add(index);
    normalized.push(index);
  }
  return normalized;
}

export function getTributeCardsFromIndices(field = [], tributeIndices = []) {
  return normalizeTributeIndices(field, tributeIndices)
    .map((index) => field[index])
    .filter(Boolean);
}

export function selectedTributesMeetRequirement(
  field,
  tributeIndices,
  tributesNeeded,
  summonedCard,
  options = {},
) {
  if (tributesNeeded <= 0) return true;
  const tributeCards = getTributeCardsFromIndices(field, tributeIndices);
  return getTributeValueTotal(tributeCards, summonedCard, options) >= tributesNeeded;
}

export function fieldHasTributeValue(
  field,
  tributesNeeded,
  summonedCard,
  options = {},
) {
  if (tributesNeeded <= 0) return true;
  return getTributeValueTotal(field || [], summonedCard, options) >= tributesNeeded;
}

export function selectTributeIndicesByValue(
  field = [],
  tributesNeeded = 0,
  summonedCard = null,
  options = {},
) {
  if (tributesNeeded <= 0) return [];
  const entries = (field || [])
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => card && card.cardKind === "monster");
  if (entries.length === 0) return [];

  const scoreCard =
    typeof options.scoreCard === "function" ? options.scoreCard : () => 0;
  const summonMethod = options.summonMethod || "tribute";
  let best = null;
  const subsetCount = 1 << entries.length;

  for (let mask = 1; mask < subsetCount; mask += 1) {
    const selected = [];
    let value = 0;
    let score = 0;
    for (let bit = 0; bit < entries.length; bit += 1) {
      if ((mask & (1 << bit)) === 0) continue;
      const entry = entries[bit];
      selected.push(entry);
      value += getTributeValueForSummon(entry.card, summonedCard, {
        ...options,
        summonMethod,
      });
      score += Number(scoreCard(entry.card, entry.index, options)) || 0;
    }

    if (value < tributesNeeded) continue;

    const excessValue = value - tributesNeeded;
    const candidate = {
      indices: selected.map((entry) => entry.index),
      score,
      count: selected.length,
      excessValue,
    };

    if (
      !best ||
      candidate.score < best.score ||
      (candidate.score === best.score && candidate.count < best.count) ||
      (candidate.score === best.score &&
        candidate.count === best.count &&
        candidate.excessValue < best.excessValue)
    ) {
      best = candidate;
    }
  }

  return best?.indices || [];
}
