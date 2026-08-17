import type { TributeValueDefinition } from "../../contracts/cards.js";
import type { CardFilter } from "../../contracts/effects.js";
import type { SummonMethod } from "../../contracts/summon.js";

export interface TributeCardFilters extends CardFilter {
  /** Legacy raw-id alias retained by the runtime matcher. */
  readonly id?: number;
}

export interface TributeValueEntry
  extends Omit<TributeValueDefinition, "countAs" | "summonMethods"> {
  countAs?: number;
  value?: number;
  count?: number;
  requireFaceup?: boolean;
  summonMethods?: SummonMethod | readonly SummonMethod[];
  tributeCardFilters?: TributeCardFilters;
  summonedCardFilters?: TributeCardFilters;
}

export interface TributeCardView {
  id?: number;
  name?: string | null;
  cardKind?: string | null;
  isFacedown?: boolean;
  archetype?: string | null;
  archetypes?: readonly string[];
  type?: string | null;
  types?: readonly string[];
  attribute?: string | null;
  level?: number;
  atk?: number;
  def?: number;
  effectsNegated?: boolean;
  tributeValue?: TributeValueEntry | readonly TributeValueEntry[] | null;
}

export interface TributeSelectionOptions<
  Card extends TributeCardView = TributeCardView,
> {
  summonMethod?: string;
  scoreCard?: (
    card: Card,
    index: number,
    options: TributeSelectionOptions<Card>,
  ) => number;
}

function asArray<Value>(
  value: Value | readonly Value[] | null | undefined,
): readonly Value[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  return [value as Value];
}

function matchesAny(value: unknown, expected: unknown): boolean {
  const expectedValues = asArray(expected).map((entry) =>
    String(entry).toLowerCase(),
  );
  if (expectedValues.length === 0) return true;
  const values = asArray(value).map((entry) => String(entry).toLowerCase());
  return expectedValues.some((entry) => values.includes(entry));
}

export function cardMatchesTributeFilters(
  card: TributeCardView | null | undefined,
  filters: TributeCardFilters = {},
): boolean {
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
  tributeCard: TributeCardView | null | undefined,
  summonedCard: TributeCardView | null | undefined,
  options: TributeSelectionOptions = {},
): number {
  if (!tributeCard || tributeCard.cardKind !== "monster") return 0;

  const summonMethod = options.summonMethod || "tribute";
  let value = 1;
  // Negation disables the card's special Tribute modifier, but the monster
  // remains a valid physical Tribute with its base value.
  if (tributeCard.effectsNegated === true) return value;

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

export function getTributeValueTotal(
  tributeCards: readonly (TributeCardView | null | undefined)[],
  summonedCard: TributeCardView | null | undefined,
  options: TributeSelectionOptions = {},
): number {
  return (tributeCards || []).reduce(
    (total, card) => total + getTributeValueForSummon(card, summonedCard, options),
    0,
  );
}

export function normalizeTributeIndices(
  field: readonly (TributeCardView | null | undefined)[] = [],
  tributeIndices: readonly number[] = [],
): number[] {
  if (!Array.isArray(field) || !Array.isArray(tributeIndices)) return [];
  const seen = new Set<number>();
  const normalized: number[] = [];
  for (const index of tributeIndices) {
    if (!Number.isInteger(index)) continue;
    if (index < 0 || index >= field.length) continue;
    if (!field[index] || seen.has(index)) continue;
    seen.add(index);
    normalized.push(index);
  }
  return normalized;
}

export function getTributeCardsFromIndices<Card extends TributeCardView>(
  field: readonly (Card | null | undefined)[] = [],
  tributeIndices: readonly number[] = [],
): Card[] {
  return normalizeTributeIndices(field, tributeIndices)
    .map((index) => field[index])
    .filter((card): card is Card => card != null);
}

export function selectedTributesMeetRequirement(
  field: readonly (TributeCardView | null | undefined)[],
  tributeIndices: readonly number[],
  tributesNeeded: number,
  summonedCard: TributeCardView | null | undefined,
  options: TributeSelectionOptions = {},
): boolean {
  if (tributesNeeded <= 0) return true;
  const tributeCards = getTributeCardsFromIndices(field, tributeIndices);
  return getTributeValueTotal(tributeCards, summonedCard, options) >= tributesNeeded;
}

export function fieldHasTributeValue(
  field: readonly (TributeCardView | null | undefined)[],
  tributesNeeded: number,
  summonedCard: TributeCardView | null | undefined,
  options: TributeSelectionOptions = {},
): boolean {
  if (tributesNeeded <= 0) return true;
  return getTributeValueTotal(field || [], summonedCard, options) >= tributesNeeded;
}

export function selectTributeIndicesByValue<Card extends TributeCardView>(
  field: readonly (Card | null | undefined)[] = [],
  tributesNeeded = 0,
  summonedCard: Card | null = null,
  options: TributeSelectionOptions<Card> = {},
): number[] {
  if (tributesNeeded <= 0) return [];
  const entries = (field || [])
    .map((card, index) => ({ card, index }))
    .filter(
      (entry): entry is { card: Card; index: number } =>
        entry.card != null && entry.card.cardKind === "monster",
    );
  if (entries.length === 0) return [];

  const scoreCard: NonNullable<TributeSelectionOptions<Card>["scoreCard"]> =
    typeof options.scoreCard === "function" ? options.scoreCard : () => 0;
  const summonMethod = options.summonMethod || "tribute";
  let best: {
    indices: number[];
    score: number;
    count: number;
    excessValue: number;
  } | null = null;
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
