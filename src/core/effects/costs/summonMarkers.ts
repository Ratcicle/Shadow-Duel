import { walkActionList } from "../../actionHandlers/actionWalker.js";
import type { ActionOf } from "../../contracts/actions.js";
import type { CardEffectMarkerMap } from "../../contracts/cards.js";
import type { PaidCostMarkerEvidence } from "../../contracts/chainRuntime.js";
import type { CardFilter, EffectDefinition } from "../../contracts/effects.js";

type MarkerAction = Pick<ActionOf<"special_summon_from_zone">, "costTargetRef" | "conditionalMarkersOnSummon">;
interface MarkerCarrier {
  fieldPresenceId?: string | number | null | undefined;
  effectMarkers?: CardEffectMarkerMap;
}

/** Only canonical, typed effect actions enter this traversal. */
export function captureCostMarkerEvidence(
  effect: EffectDefinition | null | undefined,
  costTargetRef: string,
  matches: (filters: CardFilter) => boolean,
): PaidCostMarkerEvidence[] {
  const evidence: PaidCostMarkerEvidence[] = [];
  for (const { action } of walkActionList(effect?.actions).visits) {
    if (!action || typeof action !== "object" || Reflect.get(action, "type") !== "special_summon_from_zone") continue;
    // The caller's EffectDefinition guarantees the action schema.
    const summon = action as ActionOf<"special_summon_from_zone">;
    if (summon.costTargetRef !== costTargetRef) continue;
    for (const marker of summon.conditionalMarkersOnSummon || []) {
      if (matches(marker.costFilters || {})) evidence.push({ costTargetRef, key: marker.key, matchingCostCount: 1, sourceEffectId: effect?.id || null });
    }
  }
  return evidence;
}

export function applyPaidCostSummonMarkers(
  action: MarkerAction,
  card: MarkerCarrier,
  evidence: readonly PaidCostMarkerEvidence[],
  effectId: string | null,
  turn: number,
): void {
  for (const config of action.conditionalMarkersOnSummon || []) {
    const count = evidence.filter(entry => entry.costTargetRef === action.costTargetRef && entry.key === config.key)
      .reduce((sum, entry) => sum + entry.matchingCostCount, 0);
    applyCostSummonMarker(card, config, count,
      evidence.find(entry => entry.costTargetRef === action.costTargetRef && entry.key === config.key)?.sourceEffectId || effectId, turn);
  }
}

/** Shared by combined summon actions and declarative activation costs. */
export function applyCostSummonMarker(
  card: MarkerCarrier,
  config: { readonly key?: string; readonly min?: number; readonly bindToFieldPresence?: boolean },
  matchingCostCount: number,
  sourceEffectId: string | null,
  createdOnTurn: number,
): void {
  if (!config.key || matchingCostCount < (config.min ?? 1)) return;
  if (config.bindToFieldPresence && card.fieldPresenceId == null) return;
  card.effectMarkers ??= {};
  card.effectMarkers[config.key] = {
    key: config.key, sourceEffectId, createdOnTurn, matchingCostCount,
    ...(config.bindToFieldPresence ? { fieldPresenceId: card.fieldPresenceId! } : {}),
  };
}
