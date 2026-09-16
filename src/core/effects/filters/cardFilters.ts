import type { ActionRuntimeCard } from "../../contracts/actionRuntime.js";
import type {
  CardKind,
  SentToGraveMaterialMarker,
} from "../../contracts/cards.js";
import type { CardFilter } from "../../contracts/effects.js";

export interface FilterCard
  extends Omit<
    ActionRuntimeCard,
    "id" | "name" | "cardKind" | "equips" | "archetypes"
  > {
  id?: (number | null) | undefined;
  name?: string | null;
  cardKind?: CardKind | null;
  lastSummonMethod?: string | null;
  lastSummonedFromZone?: string | null;
  lastSentToGraveAsMaterial?: SentToGraveMaterialMarker | null;
  equips?: FilterCard[];
  archetypes?: readonly string[];
}

/** Runtime-only aliases preserve the existing filter boundary; authoring stays closed. */
export interface RuntimeCardFilter
  extends Omit<
    CardFilter,
    | "attribute"
    | "monsterType"
    | "subtype"
    | "type"
    | "position"
    | "sentToGraveAsMaterial"
    | "equippedWithFilters"
  > {
  id?: number;
  ids?: readonly number[];
  cardIds?: readonly number[];
  faceUp?: boolean;
  excludeName?: string;
  excludeNames?: readonly string[];
  excludeId?: number;
  excludeIds?: readonly number[];
  excludeCardId?: number;
  excludeCardIds?: readonly number[];
  excludeCards?: readonly FilterCard[];
  excludeInstanceId?: string | number;
  excludeInstanceIds?: readonly (string | number)[];
  excludeCardInstanceIds?: readonly (string | number)[];
  currentTurn?: number;
  turnCounter?: number;
  gameTurn?: number;
  nameOrDescriptionIncludes?: string | readonly string[];
  textIncludesAny?: readonly string[];
  attribute?: string | readonly string[];
  monsterType?: string | readonly string[];
  subtype?: string | readonly string[];
  type?: string | readonly string[];
  position?: string;
  excludeMonsterType?: string;
  lastSummonMethod?: string;
  lastSummonMethods?: readonly string[];
  summonMethod?: string;
  summonMethods?: readonly string[];
  lastSummonedFromZone?: string;
  lastSummonedFromZones?: readonly string[];
  sentToGraveAsMaterial?: boolean | string | readonly string[];
  sentAsMaterial?: boolean | string | readonly string[];
  lastSentToGraveAsMaterial?: boolean | string | readonly string[];
  sentToGraveAsMaterialTurn?: number | "current";
  sentAsMaterialTurn?: number | "current";
  sentAsMaterialThisTurn?: boolean;
  hasCounter?: boolean | string;
  maxCounters?: number;
  equippedWithFilters?: RuntimeCardFilter;
}

interface CardFilterHost {
  game?: { turnCounter: number };
  isActiveEquipForCard(equip: FilterCard, card: FilterCard): boolean;
  cardMatchesFilters(card: FilterCard, filters: RuntimeCardFilter): boolean;
}

import { cardMatchesKind } from "../../Card.js";

function asArray(value: unknown): readonly unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function matchesTextValue(value: unknown, expected: unknown) {
  const expectedValues = asArray(expected).filter(
    (entry) => entry !== undefined && entry !== null,
  );
  if (expectedValues.length === 0) return true;
  const normalizedValue = String(value || "").toLowerCase();
  return expectedValues.some(
    (entry) => String(entry || "").toLowerCase() === normalizedValue,
  );
}

function getCardInstanceId(card: FilterCard | null | undefined) {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uuid ??
    card?.simInstanceId ??
    null
  );
}

function isExcludedInstance(card: FilterCard, filters: RuntimeCardFilter = {}) {
  const excludedCards = Array.isArray(filters.excludeCards)
    ? filters.excludeCards
    : [];
  if (excludedCards.includes(card)) return true;
  const cardInstanceId = getCardInstanceId(card);
  const excludedInstanceIds = [
    filters.excludeInstanceId,
    ...(Array.isArray(filters.excludeInstanceIds)
      ? filters.excludeInstanceIds
      : []),
    ...(Array.isArray(filters.excludeCardInstanceIds)
      ? filters.excludeCardInstanceIds
      : []),
  ].filter((value) => value !== undefined && value !== null);
  return (
    cardInstanceId !== null && excludedInstanceIds.includes(cardInstanceId)
  );
}

function getCurrentTurn(
  filters: RuntimeCardFilter = {},
  game: { turnCounter: number } | null = null,
) {
  const turn =
    filters.currentTurn ??
    filters.turnCounter ??
    filters.gameTurn ??
    game?.turnCounter;
  const numeric = Number(turn);
  return Number.isFinite(numeric) ? numeric : null;
}

function cardMatchesSentToGraveMaterialFilter(
  card: FilterCard,
  filters: RuntimeCardFilter = {},
  game: { turnCounter: number } | null = null,
) {
  const materialTypeFilter =
    filters.sentToGraveAsMaterial ??
    filters.sentAsMaterial ??
    filters.lastSentToGraveAsMaterial;
  const turnFilter =
    filters.sentToGraveAsMaterialTurn ?? filters.sentAsMaterialTurn ?? null;
  const requireThisTurn =
    filters.sentToGraveAsMaterialThisTurn === true ||
    filters.sentAsMaterialThisTurn === true ||
    turnFilter === "current";

  if (
    materialTypeFilter === undefined &&
    !requireThisTurn &&
    turnFilter === null
  ) {
    return true;
  }

  const marker = card?.lastSentToGraveAsMaterial || null;
  if (materialTypeFilter === false) return !marker;
  if (!marker) return false;

  if (materialTypeFilter !== undefined && materialTypeFilter !== true) {
    const requiredTypes = asArray(materialTypeFilter).filter(Boolean);
    if (requiredTypes.length > 0 && !requiredTypes.includes(marker.type)) {
      return false;
    }
  }

  if (requireThisTurn) {
    const currentTurn = getCurrentTurn(filters, game);
    if (currentTurn !== null) {
      return Number(marker.turn) === currentTurn;
    }
    return marker.thisTurn === true;
  }

  if (turnFilter !== null && turnFilter !== undefined) {
    const exactTurn = Number(turnFilter);
    if (Number.isFinite(exactTurn) && Number(marker.turn) !== exactTurn) {
      return false;
    }
  }

  return true;
}

export function cardMatchesFilters(
  this: void,
  card: FilterCard | null | undefined,
  filters?: Omit<RuntimeCardFilter, "equippedWithFilters"> & {
    equippedWithFilters?: never;
  },
): boolean;
export function cardMatchesFilters(
  this: CardFilterHost,
  card: FilterCard | null | undefined,
  filters?: RuntimeCardFilter,
): boolean;
export function cardMatchesFilters(
  this: CardFilterHost | void,
  card: FilterCard | null | undefined,
  filters: RuntimeCardFilter = {},
): boolean {
  if (!card) return false;
  const idFilter = filters.cardId ?? filters.id;
  if (idFilter !== undefined && idFilter !== null && card.id !== idFilter) {
    return false;
  }
  const idsFilter: readonly unknown[] | undefined =
    filters.cardIds ?? filters.ids;
  if (
    Array.isArray(idsFilter) &&
    idsFilter.length > 0 &&
    !idsFilter.includes(card.id)
  ) {
    return false;
  }
  const nameFilter = filters.name || filters.cardName;
  if (nameFilter && card.name !== nameFilter) return false;
  if (
    (filters.requireFaceup === true || filters.faceUp === true) &&
    card.isFacedown
  ) {
    return false;
  }
  if (filters.facedown === true && card.isFacedown !== true) {
    return false;
  }
  const excludeNameFilters: readonly unknown[] = [
    filters.excludeName,
    filters.excludeCardName,
    ...(Array.isArray(filters.excludeNames) ? filters.excludeNames : []),
    ...(Array.isArray(filters.excludeCardNames)
      ? filters.excludeCardNames
      : []),
  ].filter(Boolean);
  if (excludeNameFilters.includes(card.name)) return false;
  const excludeIdFilters: readonly unknown[] = [
    filters.excludeId,
    filters.excludeCardId,
    ...(Array.isArray(filters.excludeIds) ? filters.excludeIds : []),
    ...(Array.isArray(filters.excludeCardIds) ? filters.excludeCardIds : []),
  ].filter((value) => value !== undefined && value !== null);
  if (excludeIdFilters.includes(card.id)) return false;
  if (isExcludedInstance(card, filters)) return false;
  if (filters.cardKind) {
    if (!cardMatchesKind(card, filters.cardKind)) return false;
  }
  const textIncludes =
    filters.textIncludes ||
    filters.nameOrDescriptionIncludes ||
    filters.textIncludesAny;
  if (textIncludes) {
    const requiredText = Array.isArray(textIncludes)
      ? textIncludes
      : [textIncludes];
    const haystack = `${card.name || ""}\n${card.description || ""}`;
    if (
      !requiredText
        .filter(Boolean)
        .some((value) => haystack.includes(String(value)))
    ) {
      return false;
    }
  }
  if (filters.position && filters.position !== "any") {
    if (card.position !== filters.position) return false;
  }
  if (filters.isToken !== undefined) {
    if ((card.isToken === true) !== Boolean(filters.isToken)) return false;
  }
  if (filters.isTuner !== undefined) {
    if ((card.isTuner === true) !== Boolean(filters.isTuner)) return false;
  }
  if (filters.subtype) {
    const requiredSubtypes: readonly unknown[] = Array.isArray(filters.subtype)
      ? filters.subtype
      : [filters.subtype];
    if (!requiredSubtypes.includes(card.subtype)) return false;
  }
  if (filters.monsterType) {
    const requiredMonsterTypes: readonly unknown[] = Array.isArray(
      filters.monsterType,
    )
      ? filters.monsterType
      : [filters.monsterType];
    if (!requiredMonsterTypes.includes(card.monsterType)) return false;
  }
  const excludedMonsterTypes = [
    filters.excludeMonsterType,
    ...asArray(filters.excludeMonsterTypes),
  ].filter(Boolean);
  if (excludedMonsterTypes.includes(card.monsterType)) return false;
  const summonMethodFilter =
    filters.lastSummonMethods ||
    filters.summonMethods ||
    filters.lastSummonMethod ||
    filters.summonMethod;
  if (summonMethodFilter) {
    const requiredSummonMethods: readonly unknown[] = Array.isArray(
      summonMethodFilter,
    )
      ? summonMethodFilter
      : [summonMethodFilter];
    if (!requiredSummonMethods.includes(card.lastSummonMethod || null)) {
      return false;
    }
  }
  if (filters.type) {
    const cardType = card.type || null;
    const cardTypes: readonly unknown[] | null = Array.isArray(card.types)
      ? card.types
      : null;
    if (Array.isArray(filters.type)) {
      const ok = cardTypes
        ? filters.type.some((t) => cardTypes.includes(t))
        : (filters.type as readonly unknown[]).includes(cardType);
      if (!ok) return false;
    } else {
      const ok = cardTypes
        ? cardTypes.includes(filters.type)
        : cardType === filters.type;
      if (!ok) return false;
    }
  }
  const summonedFromZoneFilter =
    filters.lastSummonedFromZones || filters.lastSummonedFromZone;
  if (summonedFromZoneFilter) {
    const requiredZones = asArray(summonedFromZoneFilter);
    if (!requiredZones.includes(card.lastSummonedFromZone || null)) {
      return false;
    }
  }
  if (
    filters.attribute &&
    !matchesTextValue(card.attribute, filters.attribute)
  ) {
    return false;
  }
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  if (filters.level !== undefined) {
    const lvl = card.level || 0;
    const op = filters.levelOp || "eq";
    if (op === "eq" && lvl !== filters.level) return false;
    if (op === "lte" && lvl > filters.level) return false;
    if (op === "gte" && lvl < filters.level) return false;
    if (op === "lt" && lvl >= filters.level) return false;
    if (op === "gt" && lvl <= filters.level) return false;
  }
  if (filters.minLevel !== undefined && (card.level || 0) < filters.minLevel) {
    return false;
  }
  if (filters.maxLevel !== undefined && (card.level || 0) > filters.maxLevel) {
    return false;
  }
  if (filters.minAtk !== undefined && (card.atk || 0) < filters.minAtk) {
    return false;
  }
  if (filters.maxAtk !== undefined && (card.atk || 0) > filters.maxAtk) {
    return false;
  }
  if (filters.minDef !== undefined && (card.def || 0) < filters.minDef) {
    return false;
  }
  if (filters.maxDef !== undefined && (card.def || 0) > filters.maxDef) {
    return false;
  }
  if (!cardMatchesSentToGraveMaterialFilter(card, filters, this?.game)) {
    return false;
  }
  const counterType =
    filters.counterType ||
    (typeof filters.hasCounter === "string" ? filters.hasCounter : null);
  const hasCounterFilter =
    counterType ||
    filters.minCounters !== undefined ||
    filters.maxCounters !== undefined;
  if (hasCounterFilter) {
    const type = counterType || "default";
    const counterCount =
      typeof card.getCounter === "function" ? card.getCounter(type) : 0;
    const minCounters =
      filters.minCounters !== undefined
        ? filters.minCounters
        : filters.hasCounter
          ? 1
          : 0;
    if (counterCount < minCounters) return false;
    if (
      filters.maxCounters !== undefined &&
      counterCount > filters.maxCounters
    ) {
      return false;
    }
  }
  if (filters.equippedWithFilters) {
    const equipFilters = filters.equippedWithFilters || {};
    const requireEquipFaceup = equipFilters.requireFaceup !== false;
    const equips = Array.isArray(card.equips) ? card.equips : [];
    // The overload accepting equippedWithFilters requires the EffectEngine receiver.
    const hasMatchingEquip = equips.some((equip) => {
      if (!equip) return false;
      if (!this!.isActiveEquipForCard(equip, card)) return false;
      if (requireEquipFaceup && equip.isFacedown) return false;
      return this!.cardMatchesFilters(equip, equipFilters);
    });
    if (!hasMatchingEquip) return false;
  }
  return true;
}
