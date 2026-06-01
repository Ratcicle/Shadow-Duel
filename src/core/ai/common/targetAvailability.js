import { hasActionZoneCandidates } from "./actionValidation.js";
import { cardMatchesFilter, getPlayerZoneCards } from "./cardFilters.js";

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalize(value) {
  return value === undefined || value === null ? "" : String(value).toLowerCase();
}

function valuesMatchInsensitive(actualValues, expectedValues) {
  const actual = asArray(actualValues).map(normalize).filter(Boolean);
  const expected = asArray(expectedValues).map(normalize).filter(Boolean);
  if (expected.length === 0) return true;
  return expected.some((value) => actual.includes(value));
}

function getTargetZones(targetSpec = {}) {
  if (Array.isArray(targetSpec.zones) && targetSpec.zones.length > 0) {
    return targetSpec.zones.filter(Boolean);
  }
  const zone = targetSpec.zone || "field";
  return asArray(zone).filter(Boolean);
}

function getTargetOwners(ownerRule, context = {}) {
  if (ownerRule === "opponent") return [context.opponent].filter(Boolean);
  if (ownerRule === "any" || ownerRule === "either") {
    return [context.player, context.opponent].filter(Boolean);
  }
  return [context.player].filter(Boolean);
}

function getOwnerRole(owner, context = {}) {
  if (owner && owner === context.opponent) return "opponent";
  return "self";
}

function getTargetFilter(targetSpec = {}) {
  const { owner: _owner, zones: _zones, zone: _zone, anyOf: _anyOf, ...filter } =
    targetSpec;
  return filter;
}

function getTypeFilter(targetSpec = {}) {
  return targetSpec.type ?? targetSpec.filters?.type;
}

function removeManuallyHandledFilters(targetSpec = {}) {
  const filter = { ...targetSpec };
  delete filter.type;
  delete filter.level;
  delete filter.levelOp;
  if (filter.filters && typeof filter.filters === "object") {
    const nested = { ...filter.filters };
    delete nested.type;
    delete nested.level;
    delete nested.levelOp;
    filter.filters = nested;
  }
  return filter;
}

function matchesLevel(card, targetSpec = {}) {
  const expected = targetSpec.level ?? targetSpec.filters?.level;
  if (!Number.isFinite(expected)) return true;

  const level = Number(card?.level || 0);
  const op = targetSpec.levelOp || targetSpec.filters?.levelOp || "eq";
  if (op === "lte") return level <= expected;
  if (op === "gte") return level >= expected;
  if (op === "lt") return level < expected;
  if (op === "gt") return level > expected;
  return level === expected;
}

function matchesOwnerFilter(ownerRole, filter = {}) {
  const owner = filter?.owner ?? filter?.filters?.owner;
  if (!owner || owner === "any" || owner === "either") {
    return true;
  }
  return owner === ownerRole;
}

function matchesTargetFilter(card, targetSpec = {}, context = {}, ownerRole = "self") {
  if (!card) return false;

  if (!matchesOwnerFilter(ownerRole, targetSpec)) return false;
  if (targetSpec.excludeCannotBeSpecialSummoned && card.cannotBeSpecialSummoned) {
    return false;
  }

  const sameSource = context.source && card === context.source;
  if (targetSpec.excludeSelf && sameSource) return false;
  if (targetSpec.requireThisCard && !sameSource) return false;
  if (targetSpec.faceup === true && card.isFacedown) return false;

  const typeFilter = getTypeFilter(targetSpec);
  const filterWithoutManualChecks = removeManuallyHandledFilters(
    getTargetFilter(targetSpec),
  );
  if (!cardMatchesFilter(card, filterWithoutManualChecks)) return false;
  if (typeFilter) {
    const cardTypes = Array.isArray(card.types) ? card.types : [card.type];
    if (!valuesMatchInsensitive(cardTypes, typeFilter)) return false;
  }
  if (!matchesLevel(card, targetSpec)) return false;

  return true;
}

function matchesAnyOf(card, targetSpec = {}, context = {}, ownerRole = "self") {
  if (!Array.isArray(targetSpec.anyOf) || targetSpec.anyOf.length === 0) {
    return true;
  }
  return targetSpec.anyOf.some((entry) =>
    matchesTargetFilter(card, entry, context, ownerRole),
  );
}

/**
 * Return whether a target requirement has enough legal candidates in the
 * current AI perspective. This mirrors engine targeting availability for
 * simulation-time action generation without resolving actual targets.
 */
export function targetRequirementAvailable(targetSpec, context = {}) {
  if (!targetSpec) return true;

  const minCount = targetSpec.count?.min ?? 1;
  if (minCount <= 0) return true;

  const zones = getTargetZones(targetSpec);
  const owners = getTargetOwners(targetSpec.owner, context);
  let count = 0;

  for (const owner of owners) {
    const ownerRole = getOwnerRole(owner, context);
    for (const zone of zones) {
      for (const card of getPlayerZoneCards(owner, zone)) {
        if (
          matchesTargetFilter(card, targetSpec, context, ownerRole) &&
          matchesAnyOf(card, targetSpec, context, ownerRole)
        ) {
          count += 1;
          if (count >= minCount) return true;
        }
      }
    }
  }

  return false;
}

/**
 * Return whether an effect has enough simulated candidates for all of its
 * target requirements and action-level zone requirements.
 */
export function effectTargetsAvailable(effect, context = {}) {
  if (!effect) return true;

  const player = context.player;
  const source = context.source || null;
  for (const action of effect.actions || []) {
    if (!hasActionZoneCandidates(player, action, source)) {
      return false;
    }
  }

  return (effect.targets || []).every((target) =>
    targetRequirementAvailable(target, context),
  );
}
