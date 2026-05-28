import { getCounterValue } from "./counters.js";
import { getPerspectivePlayers } from "./perspective.js";
import { getZoneCards } from "./zones.js";
import { asArray, matchesTargetFilters } from "./targetSelection.js";

export function getStoredBlueprints(card) {
  const storage = card?.state?.blueprintStorage || card?.blueprintStorage;
  return (
    card?.storedBlueprints ||
    card?.blueprintStorageState?.storedBlueprints ||
    storage?.storedBlueprints ||
    card?.storedEffects ||
    []
  );
}

function conditionsArray(conditions) {
  if (!conditions) return [];
  return Array.isArray(conditions) ? conditions : [conditions];
}

function playerControlsMatching(player, condition = {}) {
  const zones = asArray(condition.zones || condition.zone || "field");
  const {
    type: _conditionType,
    owner: _owner,
    zone: _zone,
    zones: _zones,
    min: _min,
    reason: _reason,
    ...directFilters
  } = condition;
  const filters = condition.filters || directFilters;
  return zones.some((zone) =>
    getZoneCards(player, zone).some((card) =>
      matchesTargetFilters(card, filters, null)
    )
  );
}

export function evaluateSimulatedConditions(conditions, ctx = {}) {
  const list = conditionsArray(conditions);
  if (list.length === 0) return true;
  const state = ctx.state || ctx.game || {};
  const { self, opponent } = getPerspectivePlayers(state, ctx.selfId || "bot");
  const options = ctx.options || {};
  const custom =
    options.evaluateSimulatedConditions ||
    options.strategy?.evaluateSimulatedConditions?.bind(options.strategy);
  if (typeof custom === "function") {
    const result = custom(conditions, ctx);
    if (typeof result === "boolean") return result;
  }

  return list.every((condition) => {
    if (!condition) return true;
    if (condition.type === "any_of" || Array.isArray(condition.any_of)) {
      const optionsList = condition.conditions || condition.any_of || [];
      return optionsList.some((entry) =>
        evaluateSimulatedConditions(entry, ctx)
      );
    }
    const owner = condition.owner === "opponent" ? opponent : self;
    if (condition.type === "source_counters_at_least") {
      const sourceCard = ctx.sourceCard || options.sourceCard;
      return (
        getCounterValue(sourceCard, condition.counterType || "counter") >=
        (condition.min || 0)
      );
    }
    if (condition.type === "has_stored_blueprint") {
      const sourceCard = ctx.sourceCard || options.sourceCard;
      return getStoredBlueprints(sourceCard).length > 0;
    }
    if (condition.type === "empty_field" || condition.empty_field) {
      return (owner?.field || []).filter((card) => card?.cardKind === "monster")
        .length === 0;
    }
    if (condition.type === "control_card" || condition.control_card) {
      return playerControlsMatching(owner, condition);
    }
    if (
      condition.type === "control_card_filters" ||
      condition.control_card_filters
    ) {
      const {
        type: _conditionType,
        owner: _owner,
        zone: _zone,
        zones: _zones,
        min: _min,
        max: _max,
        reason: _reason,
        ...directFilters
      } = condition;
      const filters = {
        ...directFilters,
        ...(condition.control_card_filters || condition.filters || {}),
      };
      const zones = asArray(condition.zones || condition.zone || "field");
      const min = Number.isFinite(condition.min)
        ? condition.min
        : Number.isFinite(condition.max)
          ? 0
          : 1;
      const max = Number.isFinite(condition.max) ? condition.max : null;
      const count = zones.reduce(
        (sum, zone) =>
          sum +
          getZoneCards(owner, zone).filter((card) =>
            matchesTargetFilters(card, filters, null)
          ).length,
        0,
      );
      return count >= min && (max === null || count <= max);
    }
    if (condition.type === "control_card_max") {
      const zones = asArray(condition.zones || condition.zone || "field");
      const max = Number.isFinite(condition.max) ? condition.max : 0;
      const filters = condition.filters || {};
      const count = zones.reduce(
        (sum, zone) =>
          sum +
          getZoneCards(owner, zone).filter((card) =>
            matchesTargetFilters(card, filters, null)
          ).length,
        0,
      );
      return count <= max;
    }
    return true;
  });
}

