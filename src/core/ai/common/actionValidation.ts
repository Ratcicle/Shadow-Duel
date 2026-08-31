import {
  cardMatchesFilter,
  countStrategicallyViableCostCandidates,
  getPlayerZoneCards,
} from "./cardFilters.js";
import type {
  AiCardFilter,
  AiZonePlayer,
  CostActivationContext,
  FilterableCard,
} from "./cardFilters.js";
import {
  canUseAsSynchroMaterial,
  getSynchroMaterialCombos,
} from "../../game/summon/synchro.js";
import { checkSpecialSummonEligibility } from "../../game/summon/eligibility.js";
import type {
  ActionOf,
  CardAction,
} from "../../contracts/actions.js";
import type { ContextNumberSource } from "../../contracts/actions/shared.js";
import type { SelectionCount } from "../../contracts/actions/shared.js";
import type {
  EffectDefinition,
  EffectTarget,
} from "../../contracts/effects.js";
import type { GameCard } from "../../contracts/cards.js";
import type { GamePlayer, SpecialSummonRestriction } from "../../contracts/player.js";

interface AIActionPlayer extends AiZonePlayer {
  specialSummonRestrictions?: readonly SpecialSummonRestriction[];
}

interface ContextNumberReference {
  key?: string;
  contextKey?: string;
  path?: string;
  resultKey?: string;
  defaultValue?: unknown;
  default?: unknown;
  fallback?: unknown;
}

type ContextNumberInput = number | string | ContextNumberSource | ContextNumberReference;

type MutableAiCardFilter = {
  -readonly [Key in keyof AiCardFilter]: AiCardFilter[Key];
};

interface CandidateValidationResult {
  ok: boolean;
  reason?: string;
}

interface OncePerTurnGamePort {
  effectEngine?: {
    checkOncePerTurn?(
      card: FilterableCard,
      player: AIActionPlayer | null | undefined,
      effect: EffectDefinition,
    ): CandidateValidationResult | null | undefined;
  } | null;
}

interface HandIgnitionCandidateInput {
  card?: FilterableCard | null;
  effect?: EffectDefinition | null;
  player?: AIActionPlayer | null;
  game?: OncePerTurnGamePort | null;
  isSimulatedState?: boolean;
  activationContext?: CostActivationContext | null;
}

interface CostCandidateCountInput {
  player?: AIActionPlayer | null;
  effect?: EffectDefinition | null;
  action?: CardAction | null;
  activationContext?: CostActivationContext | null;
}

interface FieldIgnitionCandidateInput {
  card?: FilterableCard | null;
  effect?: EffectDefinition | null;
  player?: AIActionPlayer | null;
  source?: FilterableCard | null;
}

type SpecialSummonAvailabilityAction = ActionOf<"special_summon_from_zone"> & {
  readonly excludeCardName?: string;
  readonly excludeCardNames?: readonly string[];
  readonly excludeId?: number;
  readonly excludeIds?: readonly number[];
  readonly excludeCardId?: number;
  readonly excludeCardIds?: readonly number[];
  readonly facedown?: boolean;
  readonly excludeSelf?: boolean;
};

type TieredCostAvailabilityAction =
  ActionOf<"special_summon_from_hand_with_tiered_cost"> & {
    readonly count?: number | SelectionCount;
  };

type BounceAvailabilityAction = ActionOf<"bounce_and_summon"> & {
  readonly count?: number | SelectionCount;
};

function readReferenceProperty(
  reference: ContextNumberSource | ContextNumberReference,
  key: keyof ContextNumberReference,
): unknown {
  return Reflect.get(reference, key);
}

function getContextPathValue(ctx: unknown, path: unknown): unknown {
  if (!ctx || typeof path !== "string" || !path) return undefined;
  if (!path.includes(".")) {
    return typeof ctx === "object" || typeof ctx === "function"
      ? Reflect.get(ctx, path)
      : undefined;
  }
  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((value, key) => {
      if (value === null || value === undefined) return undefined;
      if (typeof value !== "object" && typeof value !== "function") {
        return undefined;
      }
      return Reflect.get(value, key);
    }, ctx);
}

function resolveNumberFromContext(
  ref: ContextNumberInput | null | undefined,
  ctx: unknown,
): number | null {
  if (ref === undefined || ref === null) return null;
  if (Number.isFinite(Number(ref))) return Number(ref);
  const reference = typeof ref === "object" ? ref : null;
  const key = typeof ref === "string"
    ? ref
    : reference
      ? readReferenceProperty(reference, "key") ||
        readReferenceProperty(reference, "contextKey") ||
        readReferenceProperty(reference, "path") ||
        readReferenceProperty(reference, "resultKey") ||
        null
      : null;
  const fallback =
    reference
      ? readReferenceProperty(reference, "defaultValue") ??
        readReferenceProperty(reference, "default") ??
        readReferenceProperty(reference, "fallback")
      : undefined;
  const rawValue = getContextPathValue(ctx, key);
  const value = rawValue === undefined ? fallback : rawValue;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.floor(numeric) : null;
}

function applyContextMaxLevelFilter(
  filters: MutableAiCardFilter,
  action: { readonly maxLevelFromContext?: ContextNumberInput },
  activationContext: unknown,
): void {
  const maxLevel = resolveNumberFromContext(
    action?.maxLevelFromContext,
    activationContext,
  );
  if (typeof maxLevel !== "number" || !Number.isFinite(maxLevel)) return;
  const currentMaxLevel = filters.maxLevel;
  filters.maxLevel = typeof currentMaxLevel === "number" &&
      Number.isFinite(currentMaxLevel)
    ? Math.min(currentMaxLevel, maxLevel)
    : maxLevel;
}

export function validateHandIgnitionCandidate({
  card,
  effect,
  player,
  game,
  isSimulatedState,
  activationContext,
}: HandIgnitionCandidateInput): CandidateValidationResult {
  if (!card || !effect || effect.timing !== "ignition") {
    return { ok: false, reason: "not a hand ignition effect" };
  }
  if (!effect.activationZones?.includes("hand")) {
    return { ok: false, reason: "effect is not from hand" };
  }

  const actions = effect.actions || [];
  const summonsFromHand = actions.some((action) =>
    String(action?.type || "").startsWith("special_summon_from_hand"),
  );
  if (summonsFromHand && (player?.field || []).length >= 5) {
    return { ok: false, reason: "field is full" };
  }
  if (summonsFromHand && !cardPassesSpecialSummonRestrictions(card, player)) {
    return { ok: false, reason: "special summon restricted" };
  }

  if (!isSimulatedState) {
    const optCheck = game?.effectEngine?.checkOncePerTurn?.(
      card,
      player,
      effect,
    );
    if (optCheck?.ok === false) {
      return { ok: false, reason: optCheck.reason || "once per turn used" };
    }
  }

  for (const action of actions) {
    const costCheck = validateCostCandidateCount({
      player,
      effect,
      action,
      activationContext,
    });
    if (!costCheck.ok) return costCheck;
  }

  return { ok: true };
}

export function validateCostCandidateCount({
  player,
  effect,
  action,
  activationContext,
}: CostCandidateCountInput): CandidateValidationResult {
  if (!action) return { ok: true };

  if (action.type === "special_summon_from_hand_with_cost") {
    const targets = effect?.targets || [];
    const costTargetRef = action.costTargetRef || "bbd_cost";
    const target = targets.find((entry) => entry.id === costTargetRef);
    const min = target?.count?.min ?? 1;
    if (
      !target ||
      countStrategicallyViableCostCandidates(
        player,
        target,
        activationContext,
      ) < min
    ) {
      return { ok: false, reason: "not enough cost targets" };
    }
  }

  if (action.type === "special_summon_from_hand_with_tiered_cost") {
    const tieredAction: TieredCostAvailabilityAction = action;
    const filters = tieredAction.costFilters || {};
    const min = tieredAction.minCost ?? (
      typeof tieredAction.count === "number"
        ? tieredAction.count
        : tieredAction.count?.min
    ) ?? 1;
    const candidateCount = countStrategicallyViableCostCandidates(
      player,
      { ...filters, zone: "field" },
      activationContext,
    );
    if (candidateCount < min) {
      return { ok: false, reason: "not enough tiered cost targets" };
    }
  }

  return { ok: true };
}

function findPlayerCardZone(
  player: AIActionPlayer | null | undefined,
  card: FilterableCard | null | undefined,
): string | null {
  if (!player || !card) return null;
  if (player.fieldSpell === card) return "fieldSpell";
  for (const zone of [
    "hand",
    "field",
    "spellTrap",
    "graveyard",
    "banished",
    "deck",
    "extraDeck",
  ] as const) {
    if (Array.isArray(player[zone]) && player[zone].includes(card)) return zone;
  }
  return null;
}

function cardPassesSpecialSummonRestrictions(
  card: FilterableCard,
  player: AIActionPlayer | null | undefined,
): boolean {
  const eligibility = checkSpecialSummonEligibility(card, {
    summonProcedure: "special",
    fromZone: findPlayerCardZone(player, card),
  });
  if (eligibility.ok === false) {
    return false;
  }
  const restrictions = Array.isArray(player?.specialSummonRestrictions)
    ? player.specialSummonRestrictions
    : [];
  return restrictions.every((restriction) => {
    const filters = restriction?.allowedFilters;
    return !filters || cardMatchesFilter(card, filters);
  });
}

function cardPassesSynchroSummonRestrictions(
  card: FilterableCard,
  player: AIActionPlayer | null | undefined,
): boolean {
  const eligibility = checkSpecialSummonEligibility(card, {
    summonProcedure: "synchro",
    fromZone: "extraDeck",
  });
  if (eligibility.ok === false) {
    return false;
  }
  const restrictions = Array.isArray(player?.specialSummonRestrictions)
    ? player.specialSummonRestrictions
    : [];
  return restrictions.every((restriction) => {
    const filters = restriction?.allowedFilters;
    return !filters || cardMatchesFilter(card, filters);
  });
}

function hasSynchroSummonActionCandidate(
  player: AIActionPlayer | null | undefined,
  action: ActionOf<"synchro_summon_from_extra_deck"> | null | undefined,
): boolean {
  if (!player || !action) return false;
  const filters: AiCardFilter = {
    cardKind: "monster",
    monsterType: "synchro",
    ...(action.filters || action.candidateFilters || {}),
  };
  const extraDeckCandidates = (player.extraDeck || []).filter(
    (card) =>
      cardMatchesFilter(card, filters) &&
      cardPassesSynchroSummonRestrictions(card, player),
  );
  if (extraDeckCandidates.length === 0) return false;

  const pending = action.previewPendingSummon || null;
  const pendingCards = pending
    ? getPlayerZoneCards(player, pending.zone || "graveyard").filter(
        (card) =>
          cardMatchesFilter(card, pending.filters || {}) &&
          cardPassesSpecialSummonRestrictions(card, player),
      )
    : [null];
  if (pendingCards.length === 0) return false;

  const gameLike = {
    effectEngine: {
      isEffectNegated: (card: GameCard) => card?.effectsNegated === true,
    },
    canUseAsSynchroMaterial,
  };

  return pendingCards.some((pendingCard) => {
    const field = pendingCard
      ? [...(player.field || []), pendingCard]
      : [...(player.field || [])];
    const previewPlayer = { ...player, field };
    return extraDeckCandidates.some((synchroCard) => {
      const combos =
        getSynchroMaterialCombos.call(
          gameLike as ThisParameterType<typeof getSynchroMaterialCombos>,
          previewPlayer as GamePlayer,
          synchroCard as GameCard,
        ) ||
        [];
      return combos.some((combo) => field.length - combo.length + 1 <= 5);
    });
  });
}

export function hasActionZoneCandidates(
  player: AIActionPlayer | null | undefined,
  action: CardAction | null | undefined,
  source: FilterableCard | null = null,
  activationContext: unknown = null,
): boolean {
  if (!player || !action) return true;

  if (action.type === "special_summon_from_zone") {
    const summonAction: SpecialSummonAvailabilityAction = action;
    const zoneSpec = summonAction.zone || summonAction.sourceZone || "deck";
    const zoneNames = Array.isArray(zoneSpec) ? zoneSpec : [zoneSpec];
    const zoneCards = zoneNames.flatMap((zone) => getPlayerZoneCards(player, zone));

    if (summonAction.requireSource) {
      return !!source && zoneCards.includes(source);
    }

    const filters: MutableAiCardFilter = {
      ...(summonAction.filters || {}),
      ...(summonAction.cardName ? { name: summonAction.cardName } : {}),
      ...(summonAction.archetype ? { archetype: summonAction.archetype } : {}),
      ...(summonAction.cardKind ? { cardKind: summonAction.cardKind } : {}),
      ...(summonAction.excludeCardName
        ? { excludeCardName: summonAction.excludeCardName }
        : {}),
      ...(summonAction.excludeCardNames
        ? { excludeCardNames: summonAction.excludeCardNames }
        : {}),
      ...(summonAction.excludeId !== undefined
        ? { excludeId: summonAction.excludeId }
        : {}),
      ...(summonAction.excludeIds ? { excludeIds: summonAction.excludeIds } : {}),
      ...(summonAction.excludeCardId !== undefined
        ? { excludeCardId: summonAction.excludeCardId }
        : {}),
      ...(summonAction.excludeCardIds
        ? { excludeCardIds: summonAction.excludeCardIds }
        : {}),
      ...(summonAction.facedown !== undefined
        ? { facedown: summonAction.facedown }
        : {}),
      ...(summonAction.excludeSelf !== undefined
        ? { excludeSelf: summonAction.excludeSelf }
        : {}),
      ...(Number.isFinite(summonAction.minAtk)
        ? { minAtk: summonAction.minAtk }
        : {}),
      ...(Number.isFinite(summonAction.maxAtk)
        ? { maxAtk: summonAction.maxAtk }
        : {}),
      ...(Number.isFinite(summonAction.minLevel)
        ? { minLevel: summonAction.minLevel }
        : {}),
      ...(Number.isFinite(summonAction.maxLevel)
        ? { maxLevel: summonAction.maxLevel }
        : {}),
    };
    applyContextMaxLevelFilter(filters, summonAction, activationContext);
    const min = typeof summonAction.count === "number"
      ? summonAction.count
      : summonAction.count?.min ?? 1;
    const candidates = zoneCards.filter((card) =>
      cardMatchesFilter(card, filters) &&
      !(filters.excludeSelf && card === source) &&
      cardPassesSpecialSummonRestrictions(card, player),
    );
    if (summonAction.distinctNames === true) {
      const names = new Set(
        candidates.map((card) => card?.name || `id:${card?.id ?? "unknown"}`),
      );
      return names.size >= min;
    }
    return candidates.length >= min;
  }

  if (action.type === "bounce_and_summon") {
    const bounceAction: BounceAvailabilityAction = action;
    const filters = bounceAction.filters || {};
    const min = typeof bounceAction.count === "number"
      ? bounceAction.count
      : bounceAction.count?.min ?? 1;
    return (
      (player.hand || []).filter(
        (card) =>
          cardMatchesFilter(card, filters) &&
          !(filters.excludeSelf && card === source) &&
          cardPassesSpecialSummonRestrictions(card, player),
      ).length >= min
    );
  }

  if (action.type === "synchro_summon_from_extra_deck") {
    return hasSynchroSummonActionCandidate(player, action);
  }

  return true;
}

export function validateFieldIgnitionCandidate({
  card,
  effect,
  player,
  source = card,
}: FieldIgnitionCandidateInput): CandidateValidationResult {
  if (!card || !effect || !player) return { ok: false };

  for (const action of effect.actions || []) {
    if (!hasActionZoneCandidates(player, action, source)) {
      return {
        ok: false,
        reason: `No valid candidates for ${action?.type || "action"}`,
      };
    }
  }

  return { ok: true };
}
