import { hasActionZoneCandidates } from "./actionValidation.js";
import {
  cardMatchesFilter,
  getPlayerZoneCards,
} from "./cardFilters.js";
import type {
  AiCardFilter,
  AiZonePlayer,
  FilterableCard,
} from "./cardFilters.js";
import type {
  EffectDefinition,
  EffectOwner,
  EffectTarget,
} from "../../contracts/effects.js";

type AvailabilityOwnerRole = "self" | "opponent";
type AvailabilityTargetSpec = Omit<
  EffectTarget,
  "anyOf" | "id" | "owner" | "zone" | "zones"
> & Omit<AiCardFilter, "id" | "owner" | "zone" | "zones"> & {
  readonly id?: string;
  readonly anyOf?: readonly AvailabilityTargetSpec[];
  readonly owner?: EffectOwner | "either";
  readonly zone?: AiCardFilter["zone"];
  readonly zones?: AiCardFilter["zones"];
};

interface TargetAvailabilityContext {
  player?: AiZonePlayer | null;
  opponent?: AiZonePlayer | null;
  source?: FilterableCard | null;
  activationContext?: unknown;
  actionContext?: unknown;
}

type MutableAiCardFilter = {
  -readonly [Key in keyof AiCardFilter]: AiCardFilter[Key];
};

function asArray<Value>(
  value: Value | readonly Value[] | null | undefined,
): readonly Value[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value as Value];
}

function normalize(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).toLowerCase();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function valuesMatchInsensitive(
  actualValues: unknown | readonly unknown[],
  expectedValues: unknown | readonly unknown[],
): boolean {
  const actual = asArray(actualValues).map(normalize).filter(Boolean);
  const expected = asArray(expectedValues).map(normalize).filter(Boolean);
  if (expected.length === 0) return true;
  return expected.some((value) => actual.includes(value));
}

function getTargetZones(
  targetSpec: AvailabilityTargetSpec = { id: "" },
): readonly string[] {
  if (Array.isArray(targetSpec.zones) && targetSpec.zones.length > 0) {
    return targetSpec.zones.filter(Boolean);
  }
  const zone = targetSpec.zone || "field";
  return asArray(zone).filter(Boolean);
}

function getTargetOwners(
  ownerRule: EffectOwner | "either" | undefined,
  context: TargetAvailabilityContext = {},
): AiZonePlayer[] {
  if (ownerRule === "opponent") {
    return context.opponent ? [context.opponent] : [];
  }
  if (ownerRule === "any" || ownerRule === "either") {
    return [context.player, context.opponent].filter(
      (owner): owner is AiZonePlayer => !!owner,
    );
  }
  return context.player ? [context.player] : [];
}

function getOwnerRole(
  owner: AiZonePlayer | null | undefined,
  context: TargetAvailabilityContext = {},
): AvailabilityOwnerRole {
  if (owner && owner === context.opponent) return "opponent";
  return "self";
}

function getTargetFilter(
  targetSpec: AvailabilityTargetSpec = { id: "" },
): AiCardFilter {
  const { id: _id, owner: _owner, zones: _zones, zone: _zone, anyOf: _anyOf, ...filter } =
    targetSpec;
  return filter;
}

function getTypeFilter(
  targetSpec: AvailabilityTargetSpec = { id: "" },
): AvailabilityTargetSpec["type"] {
  return targetSpec.type ?? targetSpec.filters?.type;
}

function removeManuallyHandledFilters(
  targetSpec: AiCardFilter = {},
): AiCardFilter {
  const filter: MutableAiCardFilter = { ...targetSpec };
  delete filter.type;
  delete filter.level;
  delete filter.levelOp;
  if (filter.filters && typeof filter.filters === "object") {
    const nested: MutableAiCardFilter = { ...filter.filters };
    delete nested.type;
    delete nested.level;
    delete nested.levelOp;
    filter.filters = nested;
  }
  return filter;
}

function matchesLevel(
  card: FilterableCard | null | undefined,
  targetSpec: AvailabilityTargetSpec = { id: "" },
): boolean {
  const expected = targetSpec.level ?? targetSpec.filters?.level;
  if (!isFiniteNumber(expected)) return true;

  const level = Number(card?.level || 0);
  const op = targetSpec.levelOp || targetSpec.filters?.levelOp || "eq";
  if (op === "lte") return level <= expected;
  if (op === "gte") return level >= expected;
  if (op === "lt") return level < expected;
  if (op === "gt") return level > expected;
  return level === expected;
}

function matchesOwnerFilter(
  ownerRole: AvailabilityOwnerRole,
  filter: AvailabilityTargetSpec = { id: "" },
): boolean {
  const owner = filter?.owner ?? filter?.filters?.owner;
  if (!owner || owner === "any" || owner === "either") {
    return true;
  }
  return owner === ownerRole;
}

function matchesTargetFilter(
  card: FilterableCard | null | undefined,
  targetSpec: AvailabilityTargetSpec = { id: "" },
  context: TargetAvailabilityContext = {},
  ownerRole: AvailabilityOwnerRole = "self",
): boolean {
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

function matchesAnyOf(
  card: FilterableCard | null | undefined,
  targetSpec: AvailabilityTargetSpec = { id: "" },
  context: TargetAvailabilityContext = {},
  ownerRole: AvailabilityOwnerRole = "self",
): boolean {
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
export function targetRequirementAvailable(
  targetSpec: AvailabilityTargetSpec | null | undefined,
  context: TargetAvailabilityContext = {},
): boolean {
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
export function effectTargetsAvailable(
  effect: EffectDefinition | null | undefined,
  context: TargetAvailabilityContext = {},
): boolean {
  if (!effect) return true;

  const player = context.player;
  const source = context.source || null;
  const activationContext =
    context.activationContext || context.actionContext || context;
  for (const action of effect.actions || []) {
    if (!hasActionZoneCandidates(player, action, source, activationContext)) {
      return false;
    }
  }

  return (effect.targets || []).every((target) =>
    targetRequirementAvailable(target, context),
  );
}
