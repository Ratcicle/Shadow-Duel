/**
 * shared.js
 *
 * Shared helpers used by multiple action handlers.
 * All functions here are moved from ActionHandlers.js with identical names and signatures.
 */

import { isAI } from "../Player.js";
import { cardMatchesKind } from "../Card.js";
import type { CardFilter } from "../contracts/effects.js";
import type {
  ContextNumberSource,
} from "../contracts/actions.js";
import type {
  ActionHandlerEnginePort,
  ActionRuntimeCard,
  ActionRuntimeGamePort,
  ActionRuntimePlayer,
  ActionRuntimeUiPort,
  EffectContext,
  MaybePromise,
  ResolvedTargetMap,
} from "../contracts/actionRuntime.js";
import type { BattlePositionInput } from "../contracts/cards.js";
import type {
  RawSelectionCandidate,
  RawSelectionContract,
  SelectionKind,
  SelectionZone,
} from "../contracts/selection.js";
import type { ZoneInput } from "../contracts/zones.js";

type RuntimeCardId = number | string | null;

interface ExclusionFilters {
  readonly excludeCards?: readonly ActionRuntimeCard[];
  readonly excludeInstanceId?: RuntimeCardId;
  readonly excludeInstanceIds?: readonly RuntimeCardId[];
  readonly excludeCardInstanceIds?: readonly RuntimeCardId[];
}

type LegacyCardFilter = Omit<CardFilter, "position" | "type"> &
  ExclusionFilters & {
    readonly type?: string | readonly string[];
    readonly position?: "attack" | "defense" | "any";
    readonly excludeName?: string;
    readonly excludeNames?: readonly string[];
    readonly excludeId?: number;
    readonly excludeCardId?: number;
    readonly excludeIds?: readonly number[];
    readonly excludeCardIds?: readonly number[];
    readonly cardIds?: readonly number[];
    readonly maxCounters?: number;
  };

interface TargetAction {
  readonly type?: string;
  readonly targetRef?: string | ActionRuntimeCard[];
}

interface ResolveTargetCardsOptions {
  readonly targetRef?: string | ActionRuntimeCard[];
  readonly defaultRef?: string;
  readonly game?: ActionRuntimeGamePort | null;
  readonly fallbackList?: readonly ActionRuntimeCard[];
  readonly requireArray?: boolean;
  readonly filter?: (card: ActionRuntimeCard) => boolean;
}

type RuntimeContextNumberSource = ContextNumberSource & {
  readonly defaultValue?: number;
  readonly divisor?: number;
  readonly amountPer?: number;
  readonly min?: number;
  readonly max?: number;
};

interface ResolveContextNumberOptions {
  readonly defaultValue?: number;
  readonly round?: "floor" | "ceil" | "round";
}

type FieldScopeConfig = Omit<
  LegacyCardFilter,
  "owner" | "position" | "zone" | "zones"
> & {
  readonly owner?: "self" | "opponent" | "any" | "both" | "either";
  readonly player?: "self" | "opponent" | "both";
  readonly zone?: ZoneInput;
  readonly zones?: readonly ZoneInput[];
  readonly filters?: LegacyCardFilter;
  readonly position?: "attack" | "defense" | "any";
  readonly excludeSelf?: boolean;
};

interface FieldScopeOptions {
  readonly engine?: ActionHandlerEnginePort | null;
}

interface SendCardsToGraveyardOptions {
  readonly game?: ActionRuntimeGamePort | null;
  readonly resolveFromZone?: (card: ActionRuntimeCard) => ZoneInput | null;
  readonly fromZone?: ZoneInput;
  readonly fallbackZone?: ZoneInput;
  readonly allowFallback?: boolean;
  readonly useResolvedZoneOnFallback?: boolean;
  readonly pushIfMissing?: boolean;
}

interface CollectZoneCandidatesOptions {
  readonly source?: ActionRuntimeCard | null;
  readonly engine?: ActionHandlerEnginePort | null;
  readonly defaultLevelOp?: "eq" | "lte" | "gte" | "lt" | "gt";
  readonly excludeSummonRestrict?: readonly string[];
  readonly extraFilter?: (card: ActionRuntimeCard) => boolean;
}

interface SelectionCandidate extends RawSelectionCandidate {
  idx: number;
  name: string;
  owner: string;
  controller: string;
  zone: SelectionZone;
  zoneIndex: number;
  position: string;
  atk?: number;
  def?: number;
  level?: number;
  cardKind?: ActionRuntimeCard["cardKind"];
  cardRef: ActionRuntimeCard;
  key?: string;
}

interface FieldSelectionOptions {
  readonly ownerLabel?: string;
}

interface SelectionRange {
  readonly min: number;
  readonly max: number;
}

interface SelectionContractData {
  readonly selectionContract: RawSelectionContract;
  readonly requirementId: string;
  readonly kind?: SelectionKind;
  readonly autoSelectorOptions?: object;
  readonly decorated?: readonly SelectionCandidate[];
}

interface SelectCardsFromZoneOptions {
  readonly game: ActionRuntimeGamePort;
  readonly player: ActionRuntimePlayer;
  readonly zone?: readonly ActionRuntimeCard[];
  readonly filters?: LegacyCardFilter;
  readonly source?: ActionRuntimeCard | null;
  readonly excludeSummonRestrict?: readonly string[];
  readonly defaultLevelOp?: "eq" | "lte" | "gte" | "lt" | "gt";
  readonly extraFilter?: (card: ActionRuntimeCard) => boolean;
  readonly candidates?: readonly ActionRuntimeCard[];
  readonly maxSelect?: number;
  readonly minSelect?: number;
  readonly promptPlayer?: boolean;
  readonly botSelect?: (
    cards: readonly ActionRuntimeCard[],
    max: number,
    min: number,
  ) => readonly ActionRuntimeCard[];
  readonly selectSingle?: (
    cards: readonly ActionRuntimeCard[],
  ) => MaybePromise<ActionRuntimeCard | null | undefined>;
  readonly selectMulti?: (
    cards: readonly ActionRuntimeCard[],
    range: SelectionRange,
  ) => MaybePromise<readonly ActionRuntimeCard[] | null | undefined>;
  readonly selectionContractBuilder?: (
    cards: readonly ActionRuntimeCard[],
    range: SelectionRange,
  ) => SelectionContractData | null;
  readonly engine?: ActionHandlerEnginePort | null;
}

interface PayCostAndThenOptions {
  readonly selectCost: () => MaybePromise<readonly ActionRuntimeCard[] | null>;
  readonly player: ActionRuntimePlayer;
  readonly engine: ActionHandlerEnginePort;
  readonly sendOptions?: SendCardsToGraveyardOptions;
}

interface SelectCardsOptions {
  readonly game: ActionRuntimeGamePort;
  readonly player: ActionRuntimePlayer;
  readonly selectionContract: RawSelectionContract;
  readonly requirementId: string;
  readonly kind?: SelectionKind;
  readonly autoSelectorOptions?: object;
  readonly autoSelectKeys?: () => readonly string[];
}

interface SummonFromHandCoreOptions {
  readonly card: ActionRuntimeCard;
  readonly player: ActionRuntimePlayer;
  readonly engine: ActionHandlerEnginePort;
  readonly game: ActionRuntimeGamePort;
  readonly position?: BattlePositionInput | "any";
  readonly cannotAttackThisTurn?: boolean;
}

function getCardInstanceId(card: ActionRuntimeCard | null | undefined) {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? card?.simInstanceId ?? null;
}

function isExcludedInstance(
  card: ActionRuntimeCard | null | undefined,
  filters: ExclusionFilters = {},
) {
  if (!card || !filters) return false;
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
  return cardInstanceId !== null && excludedInstanceIds.includes(cardInstanceId);
}

// Stub UI for fallback when game.ui is unavailable
export const NULL_UI = {
  log: () => {},
};

export type ActionHandlerUi = ActionRuntimeUiPort & {
  log(message: string): void;
};

export function getUI(
  game: ActionRuntimeGamePort | null | undefined,
): ActionHandlerUi {
  return (game?.ui || game?.renderer || NULL_UI) as ActionHandlerUi;
}

export function normalizeNegateEffectsDuration(action: {
  readonly negateEffectsDuration?: string;
  readonly duration?: string;
} = {}) {
  return action.negateEffectsDuration === "while_faceup" ||
    action.duration === "while_faceup"
    ? "while_faceup"
    : "until_end_turn";
}

// Map technical status names to user-friendly descriptions
export const STATUS_DISPLAY_NAMES = {
  tempBattleIndestructible: "battle indestructibility",
  battleDamageHealsControllerThisTurn: "battle damage healing",
  battleIndestructible: "permanent battle indestructibility",
  piercing: "piercing damage",
  canAttackDirectlyThisTurn: "direct attack ability",
  effectsNegated: "effect negation",
};

export function resolveTargetCards(
  action: TargetAction | null | undefined,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  options: ResolveTargetCardsOptions = {},
): ActionRuntimeCard[] {
  const hasExplicitRef = Object.prototype.hasOwnProperty.call(
    options,
    "targetRef"
  );

  let targetRef = hasExplicitRef ? options.targetRef : action?.targetRef;

  if (!targetRef) {
    targetRef = options.defaultRef;
  }

  let resolved: unknown = [];
  const getBattleParticipantByOwner = (ownerRule: "self" | "opponent") => {
    const player = ctx?.player || null;
    const opponent = ctx?.opponent || null;
    const expectedOwner = ownerRule === "opponent" ? opponent : player;
    if (!expectedOwner) return null;
    const controlsCard = (
      card: ActionRuntimeCard | null | undefined,
      explicitOwner: ActionRuntimePlayer | null | undefined,
    ) =>
      !!card &&
      (explicitOwner === expectedOwner ||
        explicitOwner?.id === expectedOwner.id ||
        expectedOwner.field?.includes?.(card) ||
        card.controller === expectedOwner.id ||
        card.owner === expectedOwner.id);
    if (
      ctx?.attacker &&
      controlsCard(ctx.attacker, ctx.attackerOwner)
    ) {
      return ctx.attacker;
    }
    const defender = ctx?.defender || ctx?.target || null;
    if (
      defender &&
      (controlsCard(defender, ctx?.defenderOwner) ||
        controlsCard(defender, ctx?.targetOwner))
    ) {
      return defender;
    }
    return null;
  };
  const resolveAscensionMaterials = () => {
    const player = ctx?.player || null;
    const source = ctx?.source || null;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    const materials = Array.isArray(source?.ascensionMaterials)
      ? source.ascensionMaterials
      : [];
    const materialInstanceIds = new Set<RuntimeCardId>(
      materials
        .map((entry) => entry?.instanceId)
        .filter((value) => value !== undefined && value !== null),
    );
    if (materialInstanceIds.size === 0) return [];
    return graveyard.filter((card) =>
      materialInstanceIds.has(getCardInstanceId(card)),
    );
  };

  if (targetRef === "self") {
    if (ctx?.source) {
      resolved = [ctx.source];
    }
  } else if (targetRef === "last_drawn_card") {
    const arr = Array.isArray(ctx?.lastDrawnCards) ? ctx.lastDrawnCards : [];
    resolved = arr.length > 0 ? [arr[0]] : [];
  } else if (targetRef === "last_drawn") {
    resolved = Array.isArray(ctx?.lastDrawnCards) ? ctx.lastDrawnCards : [];
  } else if (targetRef === "attacker") {
    if (ctx?.attacker) {
      resolved = [ctx.attacker];
    }
  } else if (targetRef === "defender") {
    if (ctx?.defender) {
      resolved = [ctx.defender];
    }
  } else if (targetRef === "battle_opponent") {
    let opponentCard = null;
    let opponentOwner = null;
    if (ctx?.source && ctx.source === ctx?.attacker) {
      opponentCard = ctx?.defender || ctx?.target || null;
      opponentOwner = ctx?.defenderOwner || ctx?.targetOwner || null;
    } else if (ctx?.source && ctx.source === (ctx?.defender || ctx?.target)) {
      opponentCard = ctx?.attacker || null;
      opponentOwner = ctx?.attackerOwner || null;
    }
    if (
      opponentCard &&
      opponentOwner &&
      Array.isArray(opponentOwner.field) &&
      opponentOwner.field.includes(opponentCard) &&
      opponentCard.cardKind === "monster"
    ) {
      resolved = [opponentCard];
    }
  } else if (targetRef === "battle_self_participant") {
    const participant = getBattleParticipantByOwner("self");
    if (participant) {
      resolved = [participant];
    }
  } else if (targetRef === "battle_opponent_participant") {
    const participant = getBattleParticipantByOwner("opponent");
    if (participant) {
      resolved = [participant];
    }
  } else if (targetRef === "destroyed") {
    if (ctx?.destroyed) {
      resolved = [ctx.destroyed];
    }
  } else if (targetRef === "summonedCard") {
    if (ctx?.summonedCard) {
      resolved = [ctx.summonedCard];
    }
  } else if (targetRef === "opponent_field") {
    const game = options?.game || ctx?.game;
    const player = ctx?.player;
    if (game && player) {
      const opponent = player.id === "player" ? game.bot : game.player;
      resolved = (opponent?.field || []).filter(
        (c) => c && c.cardKind === "monster" && !c.isFacedown
      );
    }
  } else if (targetRef === "ascension_material") {
    resolved = resolveAscensionMaterials();
  } else if (Array.isArray(targetRef)) {
    resolved = targetRef;
  } else if (
    targetRef &&
    ctx?._actionTargets &&
    targetRef in ctx._actionTargets
  ) {
    resolved = ctx._actionTargets[targetRef];
  } else if (targetRef && targets && targetRef in targets) {
    resolved = targets[targetRef];
  } else if (options.fallbackList) {
    resolved = options.fallbackList;
  }

  if (options.requireArray && !Array.isArray(resolved)) {
    return [];
  }

  const normalized = Array.isArray(resolved) ? resolved : [resolved];
  // ResolvedTargetMap is the intentional dynamic target boundary. Runtime
  // validation guarantees card values before direct handlers execute.
  const filtered = normalized.filter(Boolean) as ActionRuntimeCard[];

  return typeof options.filter === "function"
    ? filtered.filter(options.filter)
    : filtered;
}

function normalizeList<Value>(
  value: Value | readonly Value[] | null | undefined,
  fallback: readonly Value[] = [],
): readonly Value[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return fallback;
  return [value as Value];
}

function getContextNumberSource(ctx: EffectContext, key: string) {
  if (!ctx || !key) return undefined;
  const parts = String(key).split(".").filter(Boolean);
  const readPath = (root: unknown) => {
    let value: unknown = root;
    for (const part of parts) {
      if (value == null || typeof value !== "object") return undefined;
      value = Reflect.get(value, part);
    }
    return value;
  };

  return (
    readPath(ctx) ??
    readPath(ctx.actionContext) ??
    readPath(ctx.activationContext) ??
    readPath(ctx.activationContext?.actionContext)
  );
}

export function resolveContextNumber(
  spec: number | string | RuntimeContextNumberSource | null | undefined,
  ctx: EffectContext,
  options: ResolveContextNumberOptions = {},
) {
  if (typeof spec === "number") return spec;
  if (!spec) return Number(options.defaultValue || 0);

  const config = typeof spec === "string" ? { key: spec } : spec;
  const raw = getContextNumberSource(ctx, config.key);
  let value = Number(raw ?? config.defaultValue ?? options.defaultValue ?? 0);
  if (!Number.isFinite(value)) value = Number(options.defaultValue || 0);

  const divideBy = Number(config.divideBy ?? config.divisor ?? 0);
  if (Number.isFinite(divideBy) && divideBy !== 0) {
    value /= divideBy;
  }

  const multiplier = Number(config.multiplier ?? config.amountPer ?? 1);
  if (Number.isFinite(multiplier)) {
    value *= multiplier;
  }

  const roundMode = config.round || options.round || null;
  if (roundMode === "floor") value = Math.floor(value);
  else if (roundMode === "ceil") value = Math.ceil(value);
  else if (roundMode === "round") value = Math.round(value);

  if (Number.isFinite(Number(config.min))) {
    value = Math.max(Number(config.min), value);
  }
  if (Number.isFinite(Number(config.max))) {
    value = Math.min(Number(config.max), value);
  }

  return value;
}

function getScopeOwners(
  game: ActionRuntimeGamePort | null,
  ctx: EffectContext,
  ownerRule: "self" | "opponent" | "any" | "both" | "either" = "self",
): ActionRuntimePlayer[] {
  const player = ctx?.player || null;
  const opponent =
    ctx?.opponent || (player ? game?.getOpponent?.(player) : null) || null;
  if (ownerRule === "opponent") return opponent ? [opponent] : [];
  if (ownerRule === "any" || ownerRule === "both" || ownerRule === "either") {
    return [player, opponent].filter(
      (owner): owner is ActionRuntimePlayer => owner !== null,
    );
  }
  return player ? [player] : [];
}

function getScopeZoneCards(
  owner: ActionRuntimePlayer | null | undefined,
  zone: ZoneInput,
): ActionRuntimeCard[] {
  if (!owner || !zone) return [];
  if (zone === "fieldSpell") {
    return owner.fieldSpell ? [owner.fieldSpell] : [];
  }
  const value: unknown = Reflect.get(owner, zone);
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cardMatchesScopeFilters(
  card: ActionRuntimeCard,
  filters: LegacyCardFilter,
  engine: ActionHandlerEnginePort | null | undefined,
) {
  if (!card) return false;
  if (filters.requireFaceup === true && card.isFacedown) return false;
  if (filters.cardKind && !cardMatchesKind(card, filters.cardKind)) {
    return false;
  }
  if (filters.cardId !== undefined && card.id !== filters.cardId) {
    return false;
  }
  if (
    Array.isArray(filters.cardIds) &&
    filters.cardIds.length > 0 &&
    !filters.cardIds.includes(card.id)
  ) {
    return false;
  }
  const nameFilter = filters.cardName || filters.name;
  if (nameFilter) {
    const requiredNames = Array.isArray(nameFilter) ? nameFilter : [nameFilter];
    if (!requiredNames.includes(card.name)) return false;
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
  if (engine && typeof engine.cardMatchesFilters === "function") {
    return engine.cardMatchesFilters(card, filters);
  }
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  if (filters.counterType || filters.minCounters !== undefined) {
    const counterType = filters.counterType || "default";
    const minCounters = Number(filters.minCounters ?? 1);
    const counterCount =
      typeof card.getCounter === "function" ? card.getCounter(counterType) : 0;
    if (counterCount < minCounters) return false;
  }
  return true;
}

export function resolveFieldScopeCards(
  scope: FieldScopeConfig = {},
  ctx: EffectContext = {},
  game: ActionRuntimeGamePort | null = null,
  options: FieldScopeOptions = {},
) {
  const config = scope || {};
  const zones = normalizeList(
    config.zones,
    normalizeList(config.zone, ["field"]),
  );
  const filters: LegacyCardFilter = {
    ...(config.filters || {}),
  };
  for (const key of [
    "cardKind",
    "cardName",
    "name",
    "cardId",
    "cardIds",
    "subtype",
    "monsterType",
    "type",
    "archetype",
    "level",
    "levelOp",
    "minAtk",
    "maxAtk",
    "minDef",
    "maxDef",
    "position",
    "counterType",
    "minCounters",
    "maxCounters",
    "requireFaceup",
    "isToken",
    "isTuner",
  ]) {
    const configValue: unknown = Reflect.get(config, key);
    if (configValue !== undefined && Reflect.get(filters, key) === undefined) {
      Reflect.set(filters, key, configValue);
    }
  }

  const cards: ActionRuntimeCard[] = [];
  const seen = new Set<ActionRuntimeCard | RuntimeCardId>();
  for (const owner of getScopeOwners(game, ctx, config.owner || config.player || "self")) {
    for (const zone of zones) {
      for (const card of getScopeZoneCards(owner, zone)) {
        const key = card?.instanceId ?? card;
        if (!card || seen.has(key)) continue;
        if (config.excludeSelf === true && ctx?.source && card === ctx.source) {
          continue;
        }
        if (!cardMatchesScopeFilters(card, filters, options.engine)) continue;
        seen.add(key);
        cards.push(card);
      }
    }
  }
  return cards;
}

export async function sendCardsToGraveyard(
  cards: readonly ActionRuntimeCard[],
  player: ActionRuntimePlayer,
  engine: ActionHandlerEnginePort,
  options: SendCardsToGraveyardOptions = {},
) {
  const game = options.game || engine?.game;

  if (!game || !player || !Array.isArray(cards)) {
    return { movedCount: 0, movedCards: [] };
  }

  const resolveFromZone = options.resolveFromZone;
  const fallbackZone = options.fallbackZone || "field";
  const allowFallback = options.allowFallback !== false;
  const useResolvedZoneOnFallback = options.useResolvedZoneOnFallback !== false;
  const pushIfMissing = options.pushIfMissing === true;

  const movedCards: ActionRuntimeCard[] = [];

  for (const card of cards) {
    if (!card) continue;

    const resolvedZone = resolveFromZone ? resolveFromZone(card) : null;
    const fromZone = resolvedZone || options.fromZone || fallbackZone;

    if (typeof game.moveCard === "function") {
      const moveResult = await game.moveCard(card, player, "graveyard", {
        fromZone,
      });

      const moveFailed =
        moveResult === false ||
        (typeof moveResult === "object" && moveResult?.success === false);

      if (!moveFailed) {
        movedCards.push(card);
        continue;
      }
    }

    if (!allowFallback) {
      continue;
    }

    const fallbackSource = useResolvedZoneOnFallback ? fromZone : fallbackZone;
    const fallbackValue: unknown = Reflect.get(player, fallbackSource);
    const defaultFallbackValue: unknown = Reflect.get(player, fallbackZone);
    const zoneArr = Array.isArray(fallbackValue)
      ? fallbackValue
      : Array.isArray(defaultFallbackValue)
        ? defaultFallbackValue
        : [];
    const idx = zoneArr.indexOf(card);

    if (idx !== -1) {
      zoneArr.splice(idx, 1);
    } else if (!pushIfMissing) {
      continue;
    }

    player.graveyard = player.graveyard || [];
    player.graveyard.push(card);
    movedCards.push(card);
  }

  return { movedCount: movedCards.length, movedCards };
}

export function collectZoneCandidates(
  zone: readonly ActionRuntimeCard[] | null | undefined,
  filters: LegacyCardFilter = {},
  options: CollectZoneCandidatesOptions = {},
) {
  if (!Array.isArray(zone)) return [];

  const source = options.source;
  const engine = options.engine;
  const defaultLevelOp = options.defaultLevelOp || "eq";
  const excludeSummonRestrict = options.excludeSummonRestrict || [];
  const extraFilter = options.extraFilter;

  return zone.filter((card) => {
    if (!card) return false;
    if (
      engine &&
      typeof engine.cardMatchesFilters === "function" &&
      filters &&
      Object.keys(filters).length > 0 &&
      !engine.cardMatchesFilters(card, filters)
    ) {
      return false;
    }

    if (filters.cardKind && !cardMatchesKind(card, filters.cardKind)) {
      return false;
    }
    if (filters.isToken !== undefined) {
      if ((card.isToken === true) !== Boolean(filters.isToken)) return false;
    }
    if (filters.isTuner !== undefined) {
      if ((card.isTuner === true) !== Boolean(filters.isTuner)) return false;
    }

    if (filters.subtype) {
      if (Array.isArray(filters.subtype)) {
        if (!filters.subtype.includes(card.subtype)) return false;
      } else {
        if (card.subtype !== filters.subtype) return false;
      }
    }

    // Support filtering by monster type (e.g., "Dragon")
    if (filters.type) {
      const cardType = card.type || null;
      const cardTypes = Array.isArray(card.types) ? card.types : null;

      if (Array.isArray(filters.type)) {
        const ok = cardTypes
          ? filters.type.some((t) => cardTypes.includes(t))
          : filters.type.includes(cardType);
        if (!ok) return false;
      } else {
        const ok = cardTypes
          ? cardTypes.includes(filters.type)
          : cardType === filters.type;
        if (!ok) return false;
      }
    }

    if (filters.archetype) {
      const hasArchetype =
        card.archetype === filters.archetype ||
        (Array.isArray(card.archetypes) &&
          card.archetypes.includes(filters.archetype));
      if (!hasArchetype) return false;
    }

    if (filters.name && card.name !== filters.name) return false;

    const excludeNames = [
      filters.excludeName,
      filters.excludeCardName,
      ...(Array.isArray(filters.excludeNames) ? filters.excludeNames : []),
      ...(Array.isArray(filters.excludeCardNames)
        ? filters.excludeCardNames
        : []),
    ].filter(Boolean);
    if (excludeNames.includes(card.name)) return false;

    const excludeIds = [
      filters.excludeId,
      filters.excludeCardId,
      ...(Array.isArray(filters.excludeIds) ? filters.excludeIds : []),
      ...(Array.isArray(filters.excludeCardIds) ? filters.excludeCardIds : []),
    ].filter((value) => value !== undefined && value !== null);
    if (excludeIds.includes(card.id)) return false;
    if (isExcludedInstance(card, filters)) return false;

    if (filters.minAtk !== undefined) {
      const cardAtk = card.atk || 0;
      if (cardAtk < filters.minAtk) return false;
    }

    if (filters.maxAtk !== undefined) {
      const cardAtk = card.atk || 0;
      if (cardAtk > filters.maxAtk) return false;
    }

    if (filters.minDef !== undefined) {
      const cardDef = card.def || 0;
      if (cardDef < filters.minDef) return false;
    }

    if (filters.maxDef !== undefined) {
      const cardDef = card.def || 0;
      if (cardDef > filters.maxDef) return false;
    }

    if (filters.level !== undefined) {
      const cardLevel = card.level || 0;
      const op = filters.levelOp || defaultLevelOp;

      if (op === "eq" && cardLevel !== filters.level) return false;
      if (op === "lte" && cardLevel > filters.level) return false;
      if (op === "gte" && cardLevel < filters.level) return false;
      if (op === "lt" && cardLevel >= filters.level) return false;
      if (op === "gt" && cardLevel <= filters.level) return false;
    }

    // Support minLevel and maxLevel bounds
    if (filters.minLevel !== undefined) {
      const cardLevel = card.level || 0;
      if (cardLevel < filters.minLevel) return false;
    }

    if (filters.maxLevel !== undefined) {
      const cardLevel = card.level || 0;
      if (cardLevel > filters.maxLevel) return false;
    }

    if (filters.excludeSelf && source) {
      const cardInstanceId = getCardInstanceId(card);
      const sourceInstanceId = getCardInstanceId(source);
      const sameInstance =
        card === source ||
        (cardInstanceId !== null &&
          sourceInstanceId !== null &&
          cardInstanceId === sourceInstanceId);
      if (sameInstance) return false;
    }

    if (excludeSummonRestrict.length > 0 && card.summonRestrict) {
      if (excludeSummonRestrict.includes(card.summonRestrict)) return false;
    }

    if (typeof extraFilter === "function" && !extraFilter(card)) return false;

    return true;
  });
}

export function buildFieldSelectionCandidates(
  owner: ActionRuntimePlayer,
  game: ActionRuntimeGamePort,
  cards: readonly ActionRuntimeCard[],
  options: FieldSelectionOptions = {},
) {
  if (!owner || !Array.isArray(cards)) return [];

  const ownerLabel =
    options.ownerLabel ?? (owner.id === "player" ? "player" : "opponent");

  return cards.map((card, index) => {
    const inField = owner.field?.indexOf(card) ?? -1;
    const inSpell = owner.spellTrap?.indexOf(card) ?? -1;
    const inFieldSpell = owner.fieldSpell === card ? 0 : -1;

    const zoneIndex =
      inField !== -1 ? inField : inSpell !== -1 ? inSpell : inFieldSpell;
    const zone =
      inField !== -1 ? "field" : inSpell !== -1 ? "spellTrap" : "fieldSpell";

    const candidate: SelectionCandidate = {
      idx: index,
      name: card.name,
      owner: ownerLabel,
      controller: owner.id,
      zone,
      zoneIndex,
      position: card.position || "",
      atk: card.atk || 0,
      def: card.def || 0,
      cardKind: card.cardKind,
      cardRef: card,
    };

    candidate.key = game.buildSelectionCandidateKey!(candidate, index);

    return candidate;
  });
}

export async function selectCardsFromZone({
  game,
  player,
  zone,
  filters,
  source,
  excludeSummonRestrict,
  defaultLevelOp,
  extraFilter,
  candidates,
  maxSelect,
  minSelect,
  promptPlayer,
  botSelect,
  selectSingle,
  selectMulti,
  selectionContractBuilder,
  engine,
}: SelectCardsFromZoneOptions) {
  if (!game || !player) {
    return { candidates: [], selected: [], cancelled: false };
  }

  const resolvedCandidates =
    candidates ||
    collectZoneCandidates(zone, filters, {
      source,
      excludeSummonRestrict,
      defaultLevelOp,
      extraFilter,
      engine: engine || game?.effectEngine,
    });

  if (resolvedCandidates.length === 0) {
    return { candidates: resolvedCandidates, selected: [], cancelled: false };
  }

  const resolvedMax = Math.min(
    typeof maxSelect === "number" && Number.isFinite(maxSelect)
      ? maxSelect
      : resolvedCandidates.length,
    resolvedCandidates.length
  );

  const resolvedMin = Math.max(Number(minSelect ?? 0), 0);

  const isAIPlayer = isAI(player);
  if (isAIPlayer) {
    const selected =
      typeof botSelect === "function"
        ? botSelect(resolvedCandidates, resolvedMax, resolvedMin)
        : resolvedCandidates.slice(0, resolvedMax);

    return {
      candidates: resolvedCandidates,
      selected,
      cancelled: false,
    };
  }

  if (typeof selectionContractBuilder === "function") {
    const selectionData = selectionContractBuilder(resolvedCandidates, {
      min: resolvedMin,
      max: resolvedMax,
    });

    if (!selectionData) {
      return { candidates: resolvedCandidates, selected: [], cancelled: false };
    }

    const selectedKeys = await selectCards({
      game,
      player,
      selectionContract: selectionData.selectionContract,
      requirementId: selectionData.requirementId,
      kind: selectionData.kind || selectionData.selectionContract.kind,
      autoSelectorOptions: selectionData.autoSelectorOptions,
    });

    if (selectedKeys === null) {
      return { candidates: resolvedCandidates, selected: [], cancelled: true };
    }

    const decorated = selectionData.decorated || [];
    const selected = selectedKeys
      .map((key) => decorated.find((cand) => cand.key === key)?.cardRef)
      .filter(Boolean);

    return { candidates: resolvedCandidates, selected, cancelled: false };
  }

  if (resolvedMax === 1) {
    if (promptPlayer === false) {
      return {
        candidates: resolvedCandidates,
        selected: [resolvedCandidates[0]],
        cancelled: false,
      };
    }

    const preferOptionalMulti =
      resolvedMin === 0 && typeof selectMulti === "function";

    if (!preferOptionalMulti && typeof selectSingle === "function") {
      const chosen = await selectSingle(resolvedCandidates);
      if (!chosen) {
        return {
          candidates: resolvedCandidates,
          selected: [],
          cancelled: true,
        };
      }

      return {
        candidates: resolvedCandidates,
        selected: [chosen],
        cancelled: false,
      };
    }
  }

  if (typeof selectMulti === "function") {
    const chosen = await selectMulti(resolvedCandidates, {
      min: resolvedMin,
      max: resolvedMax,
    });

    if (chosen === null) {
      return { candidates: resolvedCandidates, selected: [], cancelled: true };
    }

    return { candidates: resolvedCandidates, selected: chosen || [] };
  }

  return {
    candidates: resolvedCandidates,
    selected: resolvedCandidates.slice(0, resolvedMax),
    cancelled: false,
  };
}

export async function payCostAndThen<Result>(
  { selectCost, player, engine, sendOptions }: PayCostAndThenOptions,
  next: ((cards: readonly ActionRuntimeCard[]) => MaybePromise<Result>) | null,
): Promise<false | true | Result> {
  if (!player || !engine || typeof selectCost !== "function") {
    return false;
  }

  const selected = await selectCost();

  if (!Array.isArray(selected) || selected.length === 0) {
    return false;
  }

  await sendCardsToGraveyard(selected, player, engine, sendOptions);

  if (typeof next === "function") {
    return await next(selected);
  }

  return true;
}

export async function selectCards({
  game,
  player,
  selectionContract,
  requirementId,
  kind,
  autoSelectorOptions,
  autoSelectKeys,
}: SelectCardsOptions): Promise<readonly string[] | null> {
  if (!game || !player || !selectionContract || !requirementId) {
    return null;
  }

  const isAIPlayer = isAI(player);

  if (isAIPlayer) {
    const autoResult =
      typeof game.autoSelector?.select === "function"
        ? game.autoSelector.select(selectionContract, autoSelectorOptions)
        : null;

    if (autoResult?.ok) {
      return autoResult.selections[requirementId] || [];
    }

    if (typeof autoSelectKeys === "function") {
      return autoSelectKeys();
    }

    return [];
  }

  // Use client-side target selection
  return new Promise((resolve) => {
    game.startTargetSelectionSession!({
      kind,
      selectionContract,
      onCancel: () => resolve(null),
      execute: (selections) => {
        const selected = selections[requirementId];
        resolve(Array.isArray(selected) ? selected : []);
        return { success: true, needsSelection: false };
      },
    });
  });
}

export async function summonFromHandCore({
  card,
  player,
  engine,
  game,
  position,
  cannotAttackThisTurn,
}: SummonFromHandCoreOptions) {
  if (!card || !player || !engine || !game) {
    return { success: false, position };
  }

  // 🚨 CRITICAL VALIDATION: Only monsters can be summoned to field
  if (card.cardKind !== "monster") {
    console.error(
      `[summonFromHandCore] ❌ BLOCKED: Attempted to summon non-monster "${card.name}" (kind: ${card.cardKind})`
    );
    return { success: false, position };
  }

  const restrictionCheck = game?.canSpecialSummonUnderRestrictions?.(card, player, {
    summonMethod: "special",
    fromZone: "hand",
    silent: false,
  });
  if (restrictionCheck?.ok === false) {
    return { success: false, position };
  }

  // Unified semantics: undefined ? choice, use EffectEngine resolver
  const resolvedPosition = await Reflect.apply(
    engine.chooseSpecialSummonPosition!,
    engine,
    [card, player, { position }],
  );

  const moveResult =
    typeof game.moveCard === "function"
      ? await game.moveCard(card, player, "field", {
          fromZone: "hand",
          position: resolvedPosition,
          isFacedown: false,
          resetAttackFlags: true,
          summonOrigin: "effect_resolution",
          summonMethodOverride: "special",
          summonProcedure: "card_effect",
        })
      : null;

  if (
    moveResult &&
    typeof moveResult === "object" &&
    moveResult.success === false
  ) {
    return { success: false, position: resolvedPosition };
  }

  if (moveResult && typeof moveResult === "object" && moveResult.negated) {
    return { success: false, position: resolvedPosition };
  }

  if (moveResult == null) {
    const handIndex = player.hand.indexOf(card);
    if (handIndex !== -1) {
      player.hand.splice(handIndex, 1);
    }

    card.position = resolvedPosition;
    card.isFacedown = false;
    card.hasAttacked = false;
    card.owner = player.id;
    card.controller = player.id;

    player.field.push(card);
  }

  card.cannotAttackThisTurn = cannotAttackThisTurn || false;

  return { success: true, position: resolvedPosition };
}
