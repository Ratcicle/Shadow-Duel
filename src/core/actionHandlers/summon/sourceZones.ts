import type {
  ActionRuntimeCard,
  ActionRuntimePlayer,
  EffectContext,
} from "../../contracts/actionRuntime.js";
import type { ZoneInput } from "../../contracts/zones.js";

interface SourceZoneAction {
  readonly sourceOwner?: "self" | "opponent" | "both" | "any" | "either";
  readonly sourceScope?: "self" | "opponent" | "both" | "any" | "either";
  readonly scope?: "self" | "opponent" | "both" | "any" | "either";
}

export function getSourceScope(action: SourceZoneAction) {
  return action.sourceOwner || action.sourceScope || action.scope || "self";
}

export function getSourceOwners(
  action: SourceZoneAction,
  ctx: EffectContext,
  fallbackPlayer: ActionRuntimePlayer,
) {
  const player = ctx?.player || fallbackPlayer;
  const opponent = ctx?.opponent;
  const scope = getSourceScope(action);

  if (scope === "opponent") {
    return opponent ? [opponent] : [];
  }
  if (scope === "both" || scope === "any") {
    return [player, opponent].filter(
      (owner): owner is ActionRuntimePlayer => Boolean(owner),
    );
  }
  return player ? [player] : [];
}

export interface SourceZoneEntry {
  owner: ActionRuntimePlayer;
  name: ZoneInput;
  list: ActionRuntimeCard[];
}

export function buildSourceZoneEntries(
  zoneNames: readonly ZoneInput[],
  owners: readonly ActionRuntimePlayer[],
): SourceZoneEntry[] {
  return zoneNames
    .filter((name) => typeof name === "string")
    .flatMap((name) =>
      owners
        .filter(Boolean)
        .map((owner) => ({ owner, name, list: Reflect.get(owner, name) }))
        .filter((entry) => Array.isArray(entry.list)),
    );
}

export function findSourceEntryForCard(
  sourceZoneEntries: readonly SourceZoneEntry[],
  card: ActionRuntimeCard,
) {
  return sourceZoneEntries.find((entry) => entry.list?.includes(card)) || null;
}
