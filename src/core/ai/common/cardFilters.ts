import type { GameCard } from "../../contracts/cards.js";
import type { SimulatedCardState } from "../../contracts/aiState.js";
import type {
  CardFilter,
  EffectZone,
  OneOrMany,
} from "../../contracts/effects.js";
import type { SummonMethod } from "../../contracts/summon.js";

type LiveFilterableCard = Partial<Omit<GameCard, "equips">> & {
  _instanceId?: number | string | null;
  uuid?: string | null;
  simInstanceId?: number | string | null;
  archetypes?: readonly string[];
  equips?: readonly FilterableCard[];
};
export type FilterableCard = LiveFilterableCard | SimulatedCardState;

export type AiCardFilter = Omit<CardFilter, "position"> & {
  readonly filters?: AiCardFilter;
  readonly currentTurn?: number | string;
  readonly turnCounter?: number | string;
  readonly gameTurn?: number | string;
  readonly sentAsMaterial?: SummonMethod | boolean;
  readonly lastSentToGraveAsMaterial?: SummonMethod | boolean;
  readonly sentToGraveAsMaterialTurn?: number | string;
  readonly sentAsMaterialTurn?: number | string;
  readonly sentAsMaterialThisTurn?: boolean;
  readonly id?: number | string;
  readonly cardIds?: readonly number[];
  readonly ids?: readonly number[];
  readonly excludeMonsterType?: string;
  readonly archetypes?: readonly string[];
  readonly nameOrDescriptionIncludes?: OneOrMany<string>;
  readonly textIncludesAny?: OneOrMany<string>;
  readonly lastSummonMethods?: readonly SummonMethod[];
  readonly summonMethods?: readonly SummonMethod[];
  readonly lastSummonMethod?: SummonMethod;
  readonly summonMethod?: SummonMethod;
  readonly lastSummonedFromZones?: readonly EffectZone[];
  readonly lastSummonedFromZone?: EffectZone;
  readonly position?: GameCard["position"] | "any";
  readonly excludeName?: string;
  readonly excludeNames?: readonly string[];
  readonly excludeId?: number;
  readonly excludeCardId?: number;
  readonly excludeIds?: readonly number[];
  readonly excludeCardIds?: readonly number[];
  readonly excludeInstanceId?: number | string;
  readonly excludeInstanceIds?: readonly (number | string)[];
  readonly excludeCardInstanceIds?: readonly (number | string)[];
  readonly excludeCards?: readonly FilterableCard[];
};

export interface AiZonePlayer {
  hand?: readonly FilterableCard[];
  field?: readonly FilterableCard[];
  graveyard?: readonly FilterableCard[];
  deck?: readonly FilterableCard[];
  extraDeck?: readonly FilterableCard[];
  banished?: readonly FilterableCard[];
  spellTrap?: readonly FilterableCard[];
  fieldSpell?: FilterableCard | null;
}

interface CostPreferences {
  preserveNames?: readonly string[];
  offensivePayoffNames?: readonly string[];
  availableOffensivePayoffs?: number;
  preserveLastOffensivePayoff?: boolean;
}

export interface CostActivationContext {
  actionContext?: { costPreferences?: CostPreferences | null } | null;
  costPreferences?: CostPreferences | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function cardHasArchetype(
  card: FilterableCard | null | undefined,
  archetype: string | null | undefined,
): boolean {
  if (!card || !archetype) return true;
  return (
    card.archetype === archetype ||
    (Array.isArray(card.archetypes) && card.archetypes.includes(archetype))
  );
}

function asArray<Value>(
  value: Value | readonly Value[] | null | undefined,
): readonly Value[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value as Value];
}

function matchesOne<Value>(
  value: Value | null | undefined,
  expected: Value | readonly Value[] | null | undefined,
): boolean {
  const values = asArray(expected);
  if (values.length === 0) return true;
  return values.some((candidate) => candidate === value);
}

function matchesOneText(
  value: unknown,
  expected: unknown | readonly unknown[],
): boolean {
  const values = asArray(expected).filter(
    (entry) => entry !== undefined && entry !== null,
  );
  if (values.length === 0) return true;
  const normalizedValue = String(value || "").toLowerCase();
  return values.some(
    (entry) => String(entry || "").toLowerCase() === normalizedValue,
  );
}

function getCardInstanceId(
  card: FilterableCard | null | undefined,
): number | string | null {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? card?.simInstanceId ?? null;
}

function getCurrentTurn(filter: AiCardFilter = {}): number | null {
  const turn = filter.currentTurn ?? filter.turnCounter ?? filter.gameTurn;
  const numeric = Number(turn);
  return Number.isFinite(numeric) ? numeric : null;
}

function matchesSentToGraveMaterial(
  card: FilterableCard | null | undefined,
  filter: AiCardFilter = {},
): boolean {
  const materialTypeFilter =
    filter.sentToGraveAsMaterial ??
    filter.sentAsMaterial ??
    filter.lastSentToGraveAsMaterial;
  const turnFilter =
    filter.sentToGraveAsMaterialTurn ?? filter.sentAsMaterialTurn ?? null;
  const requireThisTurn =
    filter.sentToGraveAsMaterialThisTurn === true ||
    filter.sentAsMaterialThisTurn === true ||
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
    const currentTurn = getCurrentTurn(filter);
    if (currentTurn !== null) return Number(marker.turn) === currentTurn;
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

export function cardMatchesFilter(
  card: FilterableCard | null | undefined,
  filter: AiCardFilter = {},
): boolean {
  if (!card) return false;

  const nested = filter.filters || {};
  const checks = [filter, nested];

  for (const current of checks) {
    if (!current) continue;
    if (current.cardKind && !matchesOne(card.cardKind, current.cardKind)) {
      return false;
    }
    if (current.cardId !== undefined && card.id !== current.cardId) return false;
    if (current.id !== undefined && card.id !== current.id) return false;
    const idList = current.cardIds || current.ids;
    if (
      Array.isArray(idList) &&
      idList.length > 0 &&
      !idList.includes(card.id)
    ) {
      return false;
    }
    if (current.subtype && !matchesOne(card.subtype, current.subtype)) {
      return false;
    }
    if (
      current.monsterType &&
      !matchesOne(card.monsterType, current.monsterType)
    ) {
      return false;
    }
    const excludedMonsterTypes = [
      current.excludeMonsterType,
      ...asArray(current.excludeMonsterTypes),
    ].filter((value): value is string => typeof value === "string" && !!value);
    if (
      typeof card.monsterType === "string" &&
      excludedMonsterTypes.includes(card.monsterType)
    ) return false;
    if (current.archetype && !cardHasArchetype(card, current.archetype)) {
      return false;
    }
    if (
      Array.isArray(current.archetypes) &&
      !current.archetypes.some((archetype) => cardHasArchetype(card, archetype))
    ) {
      return false;
    }
    if (current.cardName && !matchesOne(card.name, current.cardName)) {
      return false;
    }
    if (current.name && !matchesOne(card.name, current.name)) return false;
    const textIncludes =
      current.textIncludes ||
      current.nameOrDescriptionIncludes ||
      current.textIncludesAny;
    if (textIncludes) {
      const requiredText = asArray(textIncludes).filter(Boolean);
      const haystack = `${card.name || ""}\n${card.description || ""}`;
      if (!requiredText.some((value) => haystack.includes(String(value)))) {
        return false;
      }
    }
    if (current.type) {
      const cardTypes = Array.isArray(card.types) ? card.types : [card.type];
      if (!asArray(current.type).some((type) => cardTypes.includes(type))) {
        return false;
      }
    }
    if (
      current.attribute &&
      !matchesOneText(card.attribute, current.attribute)
    ) {
      return false;
    }
    const summonMethodFilter =
      current.lastSummonMethods ||
      current.summonMethods ||
      current.lastSummonMethod ||
      current.summonMethod;
    if (
      summonMethodFilter &&
      !asArray<SummonMethod | null>(summonMethodFilter).includes(
        card.lastSummonMethod || null,
      )
    ) {
      return false;
    }
    const summonedFromZoneFilter =
      current.lastSummonedFromZones || current.lastSummonedFromZone;
    if (
      summonedFromZoneFilter &&
      !asArray<EffectZone | null>(summonedFromZoneFilter).includes(
        card.lastSummonedFromZone || null,
      )
    ) {
      return false;
    }
    if (current.requireFaceup && card.isFacedown) return false;
    if (current.facedown === true && card.isFacedown !== true) return false;
    if (
      current.position &&
      current.position !== "any" &&
      card.position !== current.position
    ) {
      return false;
    }
    if (
      current.isToken !== undefined &&
      (card.isToken === true) !== Boolean(current.isToken)
    ) {
      return false;
    }
    if (
      current.isTuner !== undefined &&
      (card.isTuner === true) !== Boolean(current.isTuner)
    ) {
      return false;
    }
    const excludedNames = [
      current.excludeName,
      current.excludeCardName,
      ...asArray(current.excludeNames),
      ...asArray(current.excludeCardNames),
    ].filter((value): value is string => typeof value === "string" && !!value);
    if (typeof card.name === "string" && excludedNames.includes(card.name)) {
      return false;
    }
    const excludedIds = [
      current.excludeId,
      current.excludeCardId,
      ...asArray(current.excludeIds),
      ...asArray(current.excludeCardIds),
    ].filter((value) => value !== undefined && value !== null);
    if (card.id !== undefined && excludedIds.includes(card.id)) return false;
    const cardInstanceId = getCardInstanceId(card);
    const excludedInstanceIds = [
      current.excludeInstanceId,
      ...asArray(current.excludeInstanceIds),
      ...asArray(current.excludeCardInstanceIds),
    ].filter((value) => value !== undefined && value !== null);
    if (
      cardInstanceId !== null &&
      excludedInstanceIds.includes(cardInstanceId)
    ) {
      return false;
    }
    if (asArray(current.excludeCards).includes(card)) return false;
    if (!matchesSentToGraveMaterial(card, current)) return false;
    if (current.equippedWithFilters) {
      const equips = Array.isArray(card.equips) ? card.equips : [];
      if (
        !equips.some((equip) =>
          cardMatchesFilter(equip, current.equippedWithFilters)
        )
      ) {
        return false;
      }
    }
  }

  const level = Number(card.level || 0);
  const levelFilter = filter.level ?? nested.level;
  const levelOp = filter.levelOp || nested.levelOp || "lte";
  if (isFiniteNumber(levelFilter)) {
    if (levelOp === "eq" && level !== levelFilter) return false;
    if (levelOp === "lte" && level > levelFilter) return false;
    if (levelOp === "gte" && level < levelFilter) return false;
    if (levelOp === "lt" && level >= levelFilter) return false;
    if (levelOp === "gt" && level <= levelFilter) return false;
  }

  const minLevel = filter.minLevel ?? nested.minLevel;
  const maxLevel = filter.maxLevel ?? nested.maxLevel;
  if (isFiniteNumber(minLevel) && level < minLevel) return false;
  if (isFiniteNumber(maxLevel) && level > maxLevel) return false;

  const atk = Number(card.atk || 0);
  const minAtk = filter.minAtk ?? nested.minAtk;
  const maxAtk = filter.maxAtk ?? nested.maxAtk;
  if (isFiniteNumber(minAtk) && atk < minAtk) return false;
  if (isFiniteNumber(maxAtk) && atk > maxAtk) return false;

  const def = Number(card.def || 0);
  const minDef = filter.minDef ?? nested.minDef;
  const maxDef = filter.maxDef ?? nested.maxDef;
  if (isFiniteNumber(minDef) && def < minDef) return false;
  if (isFiniteNumber(maxDef) && def > maxDef) return false;

  return true;
}

export function getPlayerZoneCards(
  player: AiZonePlayer | null | undefined,
  zone: string | null | undefined,
): FilterableCard[] {
  if (!player || !zone) return [];
  if (zone === "fieldSpell") {
    return player.fieldSpell ? [player.fieldSpell] : [];
  }
  const cards = Reflect.get(player, zone);
  return Array.isArray(cards) ? cards as FilterableCard[] : [];
}

export function countZoneCandidates(
  player: AiZonePlayer | null | undefined,
  targetSpec: AiCardFilter = {},
): number {
  const zones = Array.isArray(targetSpec.zones)
    ? targetSpec.zones
    : [targetSpec.zone || "field"];
  return zones.reduce((count, zone) => {
    const candidates = getPlayerZoneCards(player, zone).filter((card) =>
      cardMatchesFilter(card, targetSpec),
    );
    return count + candidates.length;
  }, 0);
}

export function countValidCostCandidates(
  player: AiZonePlayer | null | undefined,
  targetSpec: AiCardFilter = {},
): number {
  return countZoneCandidates(player, targetSpec);
}

export function countStrategicallyViableCostCandidates(
  player: AiZonePlayer | null | undefined,
  targetSpec: AiCardFilter = {},
  activationContext: CostActivationContext | null = null,
): number {
  const zones = Array.isArray(targetSpec.zones)
    ? targetSpec.zones
    : [targetSpec.zone || "field"];
  const candidates = zones.flatMap((zone) =>
    getPlayerZoneCards(player, zone).filter((card) =>
      cardMatchesFilter(card, targetSpec),
    ),
  );
  if (candidates.length === 0) return 0;

  const costPreferences =
    activationContext?.actionContext?.costPreferences ||
    activationContext?.costPreferences ||
    null;
  if (!costPreferences) return candidates.length;

  const preserveNames = new Set(costPreferences.preserveNames || []);
  const payoffNames = new Set(costPreferences.offensivePayoffNames || []);
  const availablePayoffs = isFiniteNumber(
    costPreferences.availableOffensivePayoffs,
  )
    ? costPreferences.availableOffensivePayoffs
    : 0;

  return candidates.filter((card) => {
    if (typeof card.name === "string" && preserveNames.has(card.name)) return false;
    if (
      costPreferences.preserveLastOffensivePayoff &&
      typeof card.name === "string" &&
      payoffNames.has(card.name) &&
      availablePayoffs <= 1
    ) {
      return false;
    }
    return true;
  }).length;
}
