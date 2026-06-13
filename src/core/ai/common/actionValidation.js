import {
  cardMatchesFilter,
  countStrategicallyViableCostCandidates,
  getPlayerZoneCards,
} from "./cardFilters.js";

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

export function hasActionZoneCandidates(player, action, source = null) {
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
      ...(action.position ? { position: action.position } : {}),
      ...(action.facedown !== undefined ? { facedown: action.facedown } : {}),
      ...(action.excludeSelf !== undefined ? { excludeSelf: action.excludeSelf } : {}),
      ...(Number.isFinite(action.minAtk) ? { minAtk: action.minAtk } : {}),
      ...(Number.isFinite(action.maxAtk) ? { maxAtk: action.maxAtk } : {}),
      ...(Number.isFinite(action.minLevel) ? { minLevel: action.minLevel } : {}),
      ...(Number.isFinite(action.maxLevel) ? { maxLevel: action.maxLevel } : {}),
    };
    const min = action.count?.min ?? 1;
    const candidates = zoneCards.filter((card) =>
      cardMatchesFilter(card, filters) &&
      !(filters.excludeSelf && card === source),
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
          !(filters.excludeSelf && card === source),
      ).length >= min
    );
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
