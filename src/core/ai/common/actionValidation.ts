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

function getContextPathValue(ctx: unknown, path: unknown): unknown {
  if (!ctx || typeof path !== "string" || !path) return undefined;
  if (!path.includes(".")) return (ctx as { [Key in typeof path]?: unknown })[path];
  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((value, key) => value == null ? undefined : (value as { [Key in typeof key]?: unknown })[key], ctx);
}

function resolveNumberFromContext(
  ref: ContextNumberInput | null | undefined,
  ctx: unknown,
): number | null {
  if (ref === undefined || ref === null) return null;
  if (Number.isFinite(Number(ref))) return Number(ref);
  const key = typeof ref === "string"
    ? ref
    : (ref as ContextNumberReference).key ||
      (ref as ContextNumberReference).contextKey ||
      (ref as ContextNumberReference).path ||
      (ref as ContextNumberReference).resultKey ||
      null;
  const fallback = typeof ref === "object" && ref !== null
    ? (ref as ContextNumberReference).defaultValue ??
      (ref as ContextNumberReference).default ??
      (ref as ContextNumberReference).fallback
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
  if (!Number.isFinite(maxLevel)) return;
  filters.maxLevel = Number.isFinite(filters.maxLevel)
    ? Math.min(filters.maxLevel!, maxLevel!)
    : maxLevel!;
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
    const filters = action.costFilters || {};
    const min = action.minCost ??
      ((action as TieredCostAvailabilityAction).count as SelectionCount | undefined)
        ?.min ??
      1;
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
      const combos = getSynchroMaterialCombos.call(gameLike as ThisParameterType<typeof getSynchroMaterialCombos>, previewPlayer as GamePlayer, synchroCard as GameCard) || [];
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
    const zoneSpec = action.zone || action.sourceZone || "deck";
    const zoneNames = Array.isArray(zoneSpec) ? zoneSpec : [zoneSpec];
    const zoneCards = zoneNames.flatMap((zone) => getPlayerZoneCards(player, zone));

    if (action.requireSource) {
      return !!source && zoneCards.includes(source);
    }

    const filters: MutableAiCardFilter = {
      ...(action.filters || {}),
      ...(action.cardName ? { name: action.cardName } : {}),
      ...(action.archetype ? { archetype: action.archetype } : {}),
      ...(action.cardKind ? { cardKind: action.cardKind } : {}),
      ...((action as SpecialSummonAvailabilityAction).excludeCardName
        ? { excludeCardName: (action as SpecialSummonAvailabilityAction).excludeCardName }
        : {}),
      ...((action as SpecialSummonAvailabilityAction).excludeCardNames
        ? { excludeCardNames: (action as SpecialSummonAvailabilityAction).excludeCardNames }
        : {}),
      ...((action as SpecialSummonAvailabilityAction).excludeId !== undefined
        ? { excludeId: (action as SpecialSummonAvailabilityAction).excludeId }
        : {}),
      ...((action as SpecialSummonAvailabilityAction).excludeIds
        ? { excludeIds: (action as SpecialSummonAvailabilityAction).excludeIds }
        : {}),
      ...((action as SpecialSummonAvailabilityAction).excludeCardId !== undefined
        ? { excludeCardId: (action as SpecialSummonAvailabilityAction).excludeCardId }
        : {}),
      ...((action as SpecialSummonAvailabilityAction).excludeCardIds
        ? { excludeCardIds: (action as SpecialSummonAvailabilityAction).excludeCardIds }
        : {}),
      ...((action as SpecialSummonAvailabilityAction).facedown !== undefined
        ? { facedown: (action as SpecialSummonAvailabilityAction).facedown }
        : {}),
      ...((action as SpecialSummonAvailabilityAction).excludeSelf !== undefined
        ? { excludeSelf: (action as SpecialSummonAvailabilityAction).excludeSelf }
        : {}),
      ...(Number.isFinite(action.minAtk)
        ? { minAtk: action.minAtk }
        : {}),
      ...(Number.isFinite(action.maxAtk)
        ? { maxAtk: action.maxAtk }
        : {}),
      ...(Number.isFinite(action.minLevel)
        ? { minLevel: action.minLevel }
        : {}),
      ...(Number.isFinite(action.maxLevel)
        ? { maxLevel: action.maxLevel }
        : {}),
    };
    applyContextMaxLevelFilter(filters, action, activationContext);
    const min = ((action as SpecialSummonAvailabilityAction).count as SelectionCount | undefined)
      ?.min ?? 1;
    const candidates = zoneCards.filter((card) =>
      cardMatchesFilter(card, filters) &&
      !(filters.excludeSelf && card === source) &&
      cardPassesSpecialSummonRestrictions(card, player),
    );
    if (action.distinctNames === true) {
      const names = new Set(
        candidates.map((card) => card?.name || `id:${card?.id ?? "unknown"}`),
      );
      return names.size >= min;
    }
    return candidates.length >= min;
  }

  if (action.type === "bounce_and_summon") {
    const filters = action.filters || {};
    const min = ((action as BounceAvailabilityAction).count as SelectionCount | undefined)
      ?.min ?? 1;
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
