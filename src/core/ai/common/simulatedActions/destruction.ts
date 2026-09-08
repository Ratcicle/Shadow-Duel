import { getEffectiveAtk } from "../cardStats.js";
import { getCounterValue, setCounterValue } from "../counters.js";
import { estimateMonsterValue, hasArchetype } from "../cardValue.js";
import {
  evaluateSimulatedConditions,
  getStoredBlueprints,
} from "../simulatedConditions.js";
import {
  getCardInstanceId,
  getCostPreference,
  getTargetPreference,
  matchesTargetFilters,
  mergeCostPreference,
  normalizeCount,
  rankCandidates,
  selectSimulatedTargets,
} from "../targetSelection.js";
import {
  attachSimulatedEquip,
  findCardOwner,
  getZoneCards,
  moveCardToZone,
  removeCardFromZones,
} from "../zones.js";
import {
  applySummonState,
  chooseRankedCards,
  getActionCandidates,
  hasOpenMonsterZone,
  hasRequiredSelections,
  markSimulatedPassiveUsed,
  pickCountForAction,
  resolveActionPlayer,
  resolveSimulatedLpCost,
  resolveTargetsForAction,
  STOP_SIMULATION,
} from "./shared.js";
import type {
  ActionTargetScope,
  DestroyDamageEntry,
} from "../../../contracts/actions.js";
import type {
  SimulatedCardState,
  SimulatedPlayerState,
} from "../../../contracts/aiState.js";
import type { CardFilter, EffectCondition } from "../../../contracts/effects.js";
import type { SimulatedActionHandlerContext } from "./shared.js";

interface ScopedCard {
  card: SimulatedCardState;
  owner: SimulatedPlayerState;
}

type ScopeFilterKey =
  | "cardKind"
  | "cardName"
  | "name"
  | "cardId"
  | "subtype"
  | "monsterType"
  | "type"
  | "archetype"
  | "archetypes"
  | "requireFaceup"
  | "excludeCardName"
  | "excludeCardNames"
  | "minLevel"
  | "maxLevel"
  | "level"
  | "levelOp"
  | "minAtk"
  | "maxAtk"
  | "minDef"
  | "maxDef"
  | "position"
  | "isToken"
  | "isTuner";
type ScopeFilterValue = CardFilter[keyof CardFilter] | readonly string[];
type MutableScopeFilters = {
  -readonly [Key in ScopeFilterKey]?: ScopeFilterValue;
};
type LegacyActionTargetScope = ActionTargetScope & MutableScopeFilters;

export function applyDestroy(
  ctx: SimulatedActionHandlerContext<"destroy">,
): void;
export function applyDestroy(
  ctx: SimulatedActionHandlerContext<"destroy_targeted_cards">,
): void;
export function applyDestroy(
  ctx:
    | SimulatedActionHandlerContext<"destroy">
    | SimulatedActionHandlerContext<"destroy_targeted_cards">,
): void {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  targets.forEach((card) => {
    const owner = findCardOwner(state, card);
    if (!owner) return;
    moveCardToZone(owner, card, "graveyard");
  });
  return;
}

export function applyDestroyAndDamageByTargetAtk(
  ctx: SimulatedActionHandlerContext<"destroy_and_damage_by_target_atk">,
): void {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  const entries = (Array.isArray(action.entries) ? action.entries : []) as
    readonly DestroyDamageEntry[];
  const destroyed = entries.flatMap((entry) => {
    const entryTargets = resolveTargetsForAction(
      entry,
      selections,
      options,
      opponent,
    );
    return entryTargets.map((card) => ({
      card,
      owner: findCardOwner(state, card),
      damagePlayer: entry.damagePlayer || "owner",
      multiplier: Number.isFinite(entry.multiplier) ? entry.multiplier : 1,
      atk: getEffectiveAtk(card),
    }));
  });
  destroyed.forEach(({ card, owner }) => {
    if (owner) moveCardToZone(owner, card, "graveyard");
  });
  const skipDamage = (playerKey: "self" | "opponent"): boolean => {
    const conditions = action.skipDamageIf?.[playerKey];
    if (!conditions) return false;
    return evaluateSimulatedConditions(conditions as readonly EffectCondition[], {
      state,
      selfId,
      options,
    });
  };
  destroyed.forEach(({ owner, damagePlayer, multiplier, atk }) => {
    if (!owner) return;
    let recipient: SimulatedPlayerState | null = null;
    if (damagePlayer === "self") recipient = self;
    else if (damagePlayer === "opponent") recipient = opponent;
    else recipient = owner;
    if (!recipient) return;
    const isSelf = recipient === self;
    if (skipDamage(isSelf ? "self" : "opponent")) return;
    recipient.lp = Math.max(
      0,
      (recipient.lp || 0) -
        Math.floor(Math.max(0, atk) * (multiplier as number)),
    );
  });
  return;
}

export function applyDestroyTargetedCards(
  ctx: SimulatedActionHandlerContext<"destroy_targeted_cards">,
): void {
  return applyDestroy(ctx);
}

function resolveScopeOwners(
  scope: ActionTargetScope,
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
): SimulatedPlayerState[] {
  const ownerRule = scope.owner || scope.player || "self";
  if (ownerRule === "opponent") return opponent ? [opponent] : [];
  if (ownerRule === "any" || ownerRule === "both" || ownerRule === "either") {
    return [self, opponent].filter(Boolean);
  }
  return self ? [self] : [];
}

function buildScopeFilters(scope: LegacyActionTargetScope = {}): CardFilter {
  const filters: MutableScopeFilters = { ...(scope.filters || {}) };
  ([
    "cardKind",
    "cardName",
    "name",
    "cardId",
    "subtype",
    "monsterType",
    "type",
    "archetype",
    "archetypes",
    "requireFaceup",
    "excludeCardName",
    "excludeCardNames",
    "minLevel",
    "maxLevel",
    "level",
    "levelOp",
    "minAtk",
    "maxAtk",
    "minDef",
    "maxDef",
    "position",
    "isToken",
    "isTuner",
  ] as readonly ScopeFilterKey[]).forEach((key) => {
    if (scope[key] !== undefined && filters[key] === undefined) {
      filters[key] = scope[key];
    }
  });
  if (filters.monsterType && filters.type === undefined) {
    filters.type = filters.monsterType;
  }
  return filters as CardFilter;
}

function resolveScopedCards(
  scope: ActionTargetScope,
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
): ScopedCard[] {
  const zones = Array.isArray(scope.zones)
    ? scope.zones
    : scope.zone
      ? [scope.zone]
      : ["field"];
  const filters = buildScopeFilters(scope);
  const cards: ScopedCard[] = [];
  const seen = new Set<string | number | SimulatedCardState>();

  resolveScopeOwners(scope, self, opponent).forEach((owner) => {
    zones.forEach((zone) => {
      getZoneCards(owner, zone).forEach((card) => {
        const key = getCardInstanceId(card) ?? card;
        if (!card || seen.has(key)) return;
        if (!matchesTargetFilters(card, filters)) return;
        seen.add(key);
        cards.push({ card, owner });
      });
    });
  });

  return cards;
}

export function applyDestroyCardsByScope(
  ctx: SimulatedActionHandlerContext<"destroy_cards_by_scope">,
): void {
  const { action, self, opponent } = ctx;
  const scope = (action.targetScope || {}) as LegacyActionTargetScope;
  const entries = resolveScopedCards(scope, self, opponent);
  let destroyedCount = 0;

  entries.forEach(({ card, owner }) => {
    const actualOwner = owner || findCardOwner(ctx.state, card);
    if (!actualOwner) return;
    if (moveCardToZone(actualOwner, card, "graveyard")) {
      destroyedCount += 1;
    }
  });

  const drawPerDestroyed = Math.max(0, Number(action.drawPerDestroyed || 0));
  const drawAmount = Math.floor(destroyedCount * drawPerDestroyed);
  if (drawAmount <= 0) return;

  const drawPlayer = action.drawPlayer === "opponent" ? opponent : self;
  if (!drawPlayer) return;
  if (!Array.isArray(drawPlayer.hand)) drawPlayer.hand = [];
  for (let i = 0; i < drawAmount; i += 1) {
    const drawn = drawPlayer.deck?.shift?.();
    if (drawn) drawPlayer.hand.push(drawn);
  }
  return;
}
