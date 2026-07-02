import {
  cardMatchesFilter,
  countStrategicallyViableCostCandidates,
  getPlayerZoneCards,
} from "./cardFilters.js";
import {
  canUseAsSynchroMaterial,
  getSynchroMaterialCombos,
} from "../../game/summon/synchro.js";

function getContextPathValue(ctx, path) {
  if (!ctx || typeof path !== "string" || !path) return undefined;
  if (!path.includes(".")) return ctx[path];
  return path
    .split(".")
    .filter(Boolean)
    .reduce((value, key) => (value == null ? undefined : value[key]), ctx);
}

function resolveNumberFromContext(ref, ctx) {
  if (ref === undefined || ref === null) return null;
  if (Number.isFinite(Number(ref))) return Number(ref);
  const key =
    typeof ref === "string"
      ? ref
      : ref.key || ref.contextKey || ref.path || ref.resultKey || null;
  const fallback =
    typeof ref === "object" && ref !== null
      ? ref.defaultValue ?? ref.default ?? ref.fallback
      : undefined;
  const rawValue = getContextPathValue(ctx, key);
  const value = rawValue === undefined ? fallback : rawValue;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.floor(numeric) : null;
}

function applyContextMaxLevelFilter(filters, action, activationContext) {
  const maxLevel = resolveNumberFromContext(
    action?.maxLevelFromContext,
    activationContext,
  );
  if (!Number.isFinite(maxLevel)) return;
  filters.maxLevel = Number.isFinite(filters.maxLevel)
    ? Math.min(filters.maxLevel, maxLevel)
    : maxLevel;
}

export function validateHandIgnitionCandidate({
  card,
  effect,
  player,
  game,
  isSimulatedState,
  activationContext,
}) {
  if (!card || !effect || effect.timing !== "ignition") {
    return { ok: false, reason: "not a hand ignition effect" };
  }
  if (effect.requireZone !== "hand") {
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
}) {
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
    const min = action.minCost ?? action.count?.min ?? 1;
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

function cardPassesSpecialSummonRestrictions(card, player) {
  if (
    Array.isArray(card?.specialSummonOnlyBy) &&
    !card.specialSummonOnlyBy.includes("special")
  ) {
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

function cardPassesSynchroSummonRestrictions(card, player) {
  if (
    Array.isArray(card?.specialSummonOnlyBy) &&
    !card.specialSummonOnlyBy.includes("synchro")
  ) {
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

function hasSynchroSummonActionCandidate(player, action) {
  if (!player || !action) return false;
  const filters = {
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
      isEffectNegated: (card) => card?.effectsNegated === true,
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
        getSynchroMaterialCombos.call(gameLike, previewPlayer, synchroCard) ||
        [];
      return combos.some((combo) => field.length - combo.length + 1 <= 5);
    });
  });
}

export function hasActionZoneCandidates(
  player,
  action,
  source = null,
  activationContext = null,
) {
  if (!player || !action) return true;

  if (action.type === "special_summon_from_zone") {
    const zoneSpec = action.zone || action.sourceZone || "deck";
    const zoneNames = Array.isArray(zoneSpec) ? zoneSpec : [zoneSpec];
    const zoneCards = zoneNames.flatMap((zone) => getPlayerZoneCards(player, zone));

    if (action.requireSource) {
      return !!source && zoneCards.includes(source);
    }

    const filters = {
      ...(action.filters || {}),
      ...(action.cardName ? { name: action.cardName } : {}),
      ...(action.archetype ? { archetype: action.archetype } : {}),
      ...(action.cardKind ? { cardKind: action.cardKind } : {}),
      ...(action.excludeCardName
        ? { excludeCardName: action.excludeCardName }
        : {}),
      ...(action.excludeCardNames
        ? { excludeCardNames: action.excludeCardNames }
        : {}),
      ...(action.excludeId !== undefined ? { excludeId: action.excludeId } : {}),
      ...(action.excludeIds ? { excludeIds: action.excludeIds } : {}),
      ...(action.excludeCardId !== undefined
        ? { excludeCardId: action.excludeCardId }
        : {}),
      ...(action.excludeCardIds
        ? { excludeCardIds: action.excludeCardIds }
        : {}),
      ...(action.facedown !== undefined ? { facedown: action.facedown } : {}),
      ...(action.excludeSelf !== undefined ? { excludeSelf: action.excludeSelf } : {}),
      ...(Number.isFinite(action.minAtk) ? { minAtk: action.minAtk } : {}),
      ...(Number.isFinite(action.maxAtk) ? { maxAtk: action.maxAtk } : {}),
      ...(Number.isFinite(action.minLevel) ? { minLevel: action.minLevel } : {}),
      ...(Number.isFinite(action.maxLevel) ? { maxLevel: action.maxLevel } : {}),
    };
    applyContextMaxLevelFilter(filters, action, activationContext);
    const min = action.count?.min ?? 1;
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
    const min = action.count?.min ?? 1;
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
}) {
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
