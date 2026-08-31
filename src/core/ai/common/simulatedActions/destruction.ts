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

function destroyTargets(
  state: SimulatedActionHandlerContext<"destroy">["state"],
  targets: readonly SimulatedCardState[],
): void {
  targets.forEach((card) => {
    const owner = findCardOwner(state, card);
    if (!owner) return;
    moveCardToZone(owner, card, "graveyard");
  });
}

function isDestroyDamageEntry(
  entry: DestroyDamageEntry | object,
): entry is DestroyDamageEntry {
  return "targetRef" in entry && typeof entry.targetRef === "string";
}

export function applyDestroy(
  ctx: SimulatedActionHandlerContext<"destroy">,
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
  destroyTargets(state, targets);
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
  const entries = Array.isArray(action.entries)
    ? action.entries.filter(isDestroyDamageEntry)
    : [];
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
      multiplier:
        typeof entry.multiplier === "number" && Number.isFinite(entry.multiplier)
          ? entry.multiplier
          : 1,
      atk: getEffectiveAtk(card),
    }));
  });
  destroyed.forEach(({ card, owner }) => {
    if (owner) moveCardToZone(owner, card, "graveyard");
  });
  const skipDamage = (playerKey: "self" | "opponent"): boolean => {
    const conditions = action.skipDamageIf?.[playerKey];
    if (!conditions) return false;
    if (typeof conditions === "boolean") return conditions;
    return evaluateSimulatedConditions(conditions, {
      state,
      selfId,
      options,
    });
  };
  destroyed.forEach(({ owner, damagePlayer, multiplier, atk }) => {
    if (!owner) return;
    let recipient: SimulatedPlayerState;
    if (damagePlayer === "self") recipient = self;
    else if (damagePlayer === "opponent") recipient = opponent;
    else recipient = owner;
    const isSelf = recipient === self;
    if (skipDamage(isSelf ? "self" : "opponent")) return;
    recipient.lp = Math.max(
      0,
      (recipient.lp || 0) - Math.floor(Math.max(0, atk) * multiplier),
    );
  });
  return;
}

export function applyDestroyTargetedCards(
  ctx: SimulatedActionHandlerContext<"destroy_targeted_cards">,
): void {
  destroyTargets(ctx.state, ctx.targets);
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

function buildScopeFilters(scope: ActionTargetScope): CardFilter {
  const filters: CardFilter = { ...(scope.filters || {}) };
  [
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
  ].forEach((key) => {
    const scopeValue = Reflect.get(scope, key);
    if (scopeValue !== undefined && Reflect.get(filters, key) === undefined) {
      Reflect.set(filters, key, scopeValue);
    }
  });
  if (filters.monsterType && filters.type === undefined) {
    Reflect.set(filters, "type", filters.monsterType);
  }
  return filters;
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
  const scope = action.targetScope || {};
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
  for (let i = 0; i < drawAmount; i += 1) {
    const drawn = drawPlayer.deck?.shift?.();
    if (drawn) drawPlayer.hand.push(drawn);
  }
  return;
}
