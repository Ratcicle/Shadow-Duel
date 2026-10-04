import { getEffectiveAtk } from "../cardStats.js";
import { getCardEffectImmunity, isNonTargetingEffectReference } from "../../../effects/targeting/filters.js";
import { getCounterValue, setCounterValue } from "../counters.js";
import { applyBuffStatsTemp } from "./stats.js";
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
  findCardZone,
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
  ActionOf,
  ActionProperties,
} from "../../../contracts/actions.js";
import type { SimulatedCardState, SimulatedPlayerState } from "../../../contracts/aiState.js";
import type { CardFilter } from "../../../contracts/effects.js";
import type { CanonicalSelectionMap } from "../../../contracts/selection.js";
import type {
  SimulatedActionHandlerContext,
  SimulatedActionOptions,
} from "./shared.js";

type CounterFieldSpec = Partial<
  Pick<
    ActionProperties,
    "owner" | "player" | "zone" | "zones" | "filters" | "requireFaceup"
  >
>;

type CounterAmountFieldSpec = CounterFieldSpec & {
  readonly baseAmount?: number;
  readonly base?: number;
  readonly multiplier?: number;
  readonly min?: number;
  readonly max?: number;
};

type MutableCardFilter = {
  -readonly [Key in keyof CardFilter]: CardFilter[Key];
};

function getScopedPlayersForCounterSpec(
  spec: CounterFieldSpec = {},
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
): SimulatedPlayerState[] {
  const owner = spec.owner || spec.player || "self";
  if (owner === "opponent") return [opponent].filter(Boolean);
  if (owner === "any" || owner === "both" || owner === "either") {
    return [self, opponent].filter(Boolean);
  }
  return [self].filter(Boolean);
}

function countSimulatedFieldCards(
  spec: CounterFieldSpec = {},
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
  options: SimulatedActionOptions = {},
): number {
  const zones = Array.isArray(spec.zones)
    ? spec.zones
    : [spec.zone || "field"];
  const filters = spec.filters || {};
  let count = 0;

  for (const player of getScopedPlayersForCounterSpec(spec, self, opponent)) {
    const ownerRole = player === self ? "self" : "opponent";
    for (const zone of zones) {
      for (const card of getZoneCards(player, zone)) {
        if (!matchesTargetFilters(card, filters, options.sourceCard, ownerRole)) {
          continue;
        }
        count += 1;
      }
    }
  }

  return count;
}

function resolveSimulatedAddCounterAmount(
  action: ActionOf<"add_counter">,
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
  options: SimulatedActionOptions,
): number {
  if (action.amountFromFieldCount) {
    const spec = action.amountFromFieldCount as CounterAmountFieldSpec;
    const count = countSimulatedFieldCards(spec, self, opponent, options);
    const multiplier = Number.isFinite(Number(spec.multiplier))
      ? Number(spec.multiplier)
      : 1;
    const baseAmount = Number.isFinite(Number(spec.baseAmount ?? spec.base))
      ? Number(spec.baseAmount ?? spec.base)
      : 0;
    let amount = baseAmount + count * multiplier;
    if (Number.isFinite(Number(spec.min))) {
      amount = Math.max(Number(spec.min), amount);
    }
    if (Number.isFinite(Number(spec.max))) {
      amount = Math.min(Number(spec.max), amount);
    }
    return Math.max(0, Math.floor(amount));
  }

  return Number.isFinite(action.amount) ? action.amount as number : 1;
}

function countSimulatedFieldCounters(
  action: Partial<ActionOf<"count_field_counters">> = {},
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
  options: SimulatedActionOptions = {},
): number {
  const counterType = action.counterType || "default";
  const zones = Array.isArray(action.zones)
    ? action.zones
    : [action.zone || "field"];
  const filters: MutableCardFilter = { ...(action.filters || {}) };
  if (action.requireFaceup === true && filters.requireFaceup == null) {
    filters.requireFaceup = true;
  }

  let total = 0;
  for (const player of getScopedPlayersForCounterSpec(action, self, opponent)) {
    const ownerRole = player === self ? "self" : "opponent";
    for (const zone of zones) {
      for (const card of getZoneCards(player, zone)) {
        if (!matchesTargetFilters(card, filters, options.sourceCard, ownerRole)) {
          continue;
        }
        total += Math.max(0, Number(getCounterValue(card, counterType) || 0));
      }
    }
  }

  return total;
}

function getFieldCounterContextKey(
  action: ActionOf<"count_field_counters">,
  counterType: string,
): string {
  return (
    action.contextKey ||
    action.storeAs ||
    action.resultKey ||
    `field${counterType.charAt(0).toUpperCase()}${counterType.slice(1)}CounterCount`
  );
}

export function applyAddCounter(
  ctx: SimulatedActionHandlerContext<"add_counter">,
): boolean {
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
  let addedAmount = 0;
  let added = false;
  const amount = resolveSimulatedAddCounterAmount(action, self, opponent, options);
  const scope = action.targetScope;
  const targetCards = scope ? getScopedPlayersForCounterSpec(scope, self, opponent).flatMap(player =>
    (scope.zones || [scope.zone || "field"]).flatMap(zone => getZoneCards(player, zone)).filter(card =>
      (scope.excludeSelf !== true || card !== options.sourceCard) && (scope.requireFaceup !== true || !card.isFacedown) &&
      matchesTargetFilters(card, scope.filters || {}, options.sourceCard, player === self ? "self" : "opponent"))) : targets;
  targetCards.forEach((card) => {
    if (amount <= 0) return;
    if ((scope || isNonTargetingEffectReference(options.effect, action.targetRef)) && getCardEffectImmunity({ game: {
      player: state.player, bot: state.bot, turnCounter: state.turnCounter || 0,
    } }, card, self, { sourceCard: options.sourceCard || null }).immune) return;
    setCounterValue(
      card,
      action.counterType || "counter",
      getCounterValue(card, action.counterType || "counter") + amount,
    );
    addedAmount += Math.max(0, Math.floor(Number(amount || 0)));
    added = true;
  });
  const contextKey = action.contextKey || action.storeAs || action.resultKey;
  if (contextKey && options.actionContext) {
    (options.actionContext as CanonicalSelectionMap)[contextKey] = addedAmount;
    options.actionContext.lastAddedCounterCount = addedAmount;
    options.actionContext.addedCounterCounts =
      options.actionContext.addedCounterCounts || {};
    (options.actionContext.addedCounterCounts as CanonicalSelectionMap)[
      action.counterType || "counter"
    ] = addedAmount;
  }
  return amount > 0 && (added || !!scope);
}

export function applyCountFieldCounters(
  ctx: SimulatedActionHandlerContext<"count_field_counters">,
): void {
  const { action, options, self, opponent } = ctx;
  const counterType = action.counterType || "default";
  const total = countSimulatedFieldCounters(action, self, opponent, options);
  if (!options.actionContext || typeof options.actionContext !== "object") {
    options.actionContext = {};
  }
  const contextKey = getFieldCounterContextKey(action, counterType);
  if (contextKey) {
    (options.actionContext as CanonicalSelectionMap)[contextKey] = total;
  }
  options.actionContext.lastFieldCounterCount = total;
  options.actionContext.fieldCounterCounts =
    options.actionContext.fieldCounterCounts || {};
  (options.actionContext.fieldCounterCounts as CanonicalSelectionMap)[
    counterType
  ] = total;
}

export function applyRemoveCounter(
  ctx: SimulatedActionHandlerContext<"remove_counter">,
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
    const amount = Number.isFinite(action.amount) ? action.amount : 1;
    setCounterValue(
      card,
      action.counterType || "counter",
      getCounterValue(card, action.counterType || "counter") - amount,
    );
  });
  return;
}

/** Validate the prepared sources of a pooled cost without choosing substitutes. */
export function getSelectedFieldCounterSources(
  action: ActionOf<"remove_counters_from_field">,
  targets: readonly SimulatedCardState[],
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
  options: SimulatedActionOptions = {},
): SimulatedCardState[] | null {
  if (!targets.length || new Set(targets).size !== targets.length) return null;
  const filters: MutableCardFilter = { ...(action.filters || {}) };
  if (action.requireFaceup) filters.requireFaceup = true;
  const zones = action.zones || (typeof action.zone === "string" ? [action.zone] : action.zone || ["field"]);
  const players = getScopedPlayersForCounterSpec(action, self, opponent);
  const legal = targets.every(card => players.some(player => zones.some(zone =>
    getZoneCards(player, zone).includes(card) &&
    matchesTargetFilters(card, filters, options.sourceCard, player === self ? "self" : "opponent"))));
  return legal ? [...targets] : null;
}

type FieldRemovalAction = ActionOf<"remove_counters_from_field" | "remove_all_counters_from_field">;

function collectFieldCounterSources(
  action: FieldRemovalAction,
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
  options: SimulatedActionOptions,
): SimulatedCardState[] {
  const zones = action.zones?.length ? action.zones : typeof action.zone === "string" ? [action.zone] : action.zone || ["field"];
  const filters: MutableCardFilter = { ...(action.filters || {}) };
  if (action.requireFaceup) filters.requireFaceup = true;
  return getScopedPlayersForCounterSpec(action, self, opponent).flatMap(player =>
    zones.flatMap(zone => getZoneCards(player, zone)).filter(card =>
      getCounterValue(card, action.counterType || "default") > 0 &&
      matchesTargetFilters(card, filters, options.sourceCard, player === self ? "self" : "opponent")));
}

/** Legacy AI payment uses the runtime's actor-first greedy sources and maximum range. */
export function prepareSimulatedFieldCounterPayment(
  action: ActionOf<"remove_counters_from_field">,
  targets: readonly SimulatedCardState[],
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
  options: SimulatedActionOptions = {},
  availableCounter: (card: SimulatedCardState, counterType: string) => number = getCounterValue,
): { cards: SimulatedCardState[]; amount: number } | null {
  const candidates = action.targetRef ? getSelectedFieldCounterSources(action, targets, self, opponent, options)
    : collectFieldCounterSources(action, self, opponent, options);
  if (!candidates) return null;
  const total = candidates.reduce((sum, card) => sum + availableCounter(card, action.counterType || "default"), 0);
  const minimum = action.targetRef ? 1 : Math.max(1, Number(action.minAmount ?? 1));
  const hasRange = action.maxAmount !== undefined || action.minAmount !== undefined || action.variableAmount === true;
  const amount = !action.targetRef && hasRange
    ? Math.min(Math.max(minimum, Number(action.maxAmount ?? action.amount ?? action.count ?? minimum)), total)
    : Math.max(1, Number(action.amount ?? action.count ?? 1));
  if (!Number.isFinite(amount) || amount < minimum || total < amount) return null;
  if (action.targetRef) return { cards: candidates, amount };
  const cards: SimulatedCardState[] = [];
  let remaining = amount;
  for (const card of candidates) {
    if (remaining <= 0) break;
    if (availableCounter(card, action.counterType || "default") <= 0) continue;
    cards.push(card);
    remaining -= availableCounter(card, action.counterType || "default");
  }
  return remaining <= 0 && new Set(cards).size === cards.length ? { cards, amount } : null;
}

function writeRemovedCounterContext(
  action: FieldRemovalAction, options: SimulatedActionOptions, removed: number, defaultKey = false,
): void {
  const type = action.counterType || "default";
  const key = action.contextKey || action.storeAs || action.resultKey || (defaultKey
    ? `removed${type.split(/[^a-zA-Z0-9]+/).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join("") || "Default"}CounterCount`
    : null);
  if (!key) return;
  const context = options.actionContext ??= {};
  (context as CanonicalSelectionMap)[key] = removed;
  context.lastRemovedCounterCount = removed;
  (context.removedCounterCounts ??= {})[type] = removed;
}

function emitRemovedCounters(
  ctx: SimulatedActionHandlerContext<"remove_counters_from_field" | "remove_all_counters_from_field">,
  removed: number, cards: SimulatedCardState[], zones: string[],
): void {
  if (!removed) return;
  const { action, options, self, opponent } = ctx;
  options.emitSimulatedEvent?.("counter_removed", {
    sourceCard: options.sourceCard || null, source: options.sourceCard || null, player: self, opponent,
    effectId: options.effect?.id || null, counterType: action.counterType || "default", amount: removed,
    cards, card: cards[0] || null, zones, uniqueZones: [...new Set(zones)], fromField: true,
    actionContext: options.actionContext || null,
  });
}

export function applyRemoveCountersFromField(
  ctx: SimulatedActionHandlerContext<"remove_counters_from_field">,
): typeof STOP_SIMULATION | boolean | void {
  const { action, targets, selections, state, self, opponent, options } = ctx;
  writeRemovedCounterContext(action, options, 0);
  if (!action.targetRef && options.activationContext?.decisions?.selections?.counter_payment !== undefined) {
    (state._simUnsupportedActions ??= []).push("exact_selection:counter_payment");
    return STOP_SIMULATION;
  }
  const payment = prepareSimulatedFieldCounterPayment(action, targets, self, opponent, options);
  const cards = payment?.cards;
  const selected = action.targetRef ? selections?.[action.targetRef] : undefined;
  const counterType = action.counterType || "default";
  const amount = payment?.amount || 0;
  if (!cards || (action.targetRef && (!Array.isArray(selected) || selected.length !== cards.length))) {
    return action.targetRef ? STOP_SIMULATION : false;
  }
  const presences = cards.map(card => {
    const owner = findCardOwner(state, card);
    return { card, owner, zone: owner ? findCardZone(owner, card) : null, version: card.locationVersion || 0 };
  });
  let removed = 0;
  let interrupted = false;
  const paid = new Set<SimulatedCardState>();
  while (removed < amount) {
    let progressed = false;
    for (const presence of presences) {
      if (removed >= amount) break;
      if (presences.some(entry => !entry.owner || !entry.zone ||
          findCardOwner(state, entry.card) !== entry.owner ||
          findCardZone(entry.owner, entry.card) !== entry.zone ||
          (entry.card.locationVersion || 0) !== entry.version) ||
          (action.targetRef && (!getSelectedFieldCounterSources(action, cards, self, opponent, options) ||
          cards.reduce((sum, card) => sum + getCounterValue(card, counterType), 0) < amount - removed))) {
        interrupted = true;
        break;
      }
      const available = getCounterValue(presence.card, counterType);
      if (available <= 0) continue;
      setCounterValue(presence.card, counterType, available - 1);
      removed++;
      paid.add(presence.card);
      progressed = true;
    }
    if (interrupted || !progressed) break;
  }
  const paidCards = [...paid];
  const zones = paidCards.flatMap(card => { const zone = presences.find(entry => entry.card === card)?.zone; return zone ? [zone] : []; });
  writeRemovedCounterContext(action, options, removed);
  emitRemovedCounters(ctx, removed, paidCards, zones);
  if (removed !== amount) return action.targetRef ? STOP_SIMULATION : false;
}

export function applyRemoveAllCountersFromField(
  ctx: SimulatedActionHandlerContext<"remove_all_counters_from_field">,
): boolean {
  const { action, self, opponent, options, state } = ctx;
  writeRemovedCounterContext(action, options, 0, true);
  const entries = collectFieldCounterSources(action, self, opponent, options).map(card => ({
    card, zone: findCardZone(findCardOwner(state, card), card),
  }));
  let removed = 0;
  const cards: SimulatedCardState[] = [], zones: string[] = [];
  for (const entry of entries) {
    while (getCounterValue(entry.card, action.counterType || "default") > 0) {
      setCounterValue(entry.card, action.counterType || "default", getCounterValue(entry.card, action.counterType || "default") - 1);
      removed++;
      if (!cards.includes(entry.card)) {
        cards.push(entry.card);
        if (entry.zone) zones.push(entry.zone);
      }
    }
  }
  writeRemovedCounterContext(action, options, removed, true);
  emitRemovedCounters(ctx, removed, cards, zones);
  return removed > 0;
}

export function applyBuffStatsByCounter(
  ctx: SimulatedActionHandlerContext<"buff_stats_by_counter">,
): boolean {
  const { action, targets, selections, options, opponent } = ctx;
  const atkPerCounter = action.atkPerCounter ?? action.atkBoostPerCounter ?? 0;
  const defPerCounter = action.defPerCounter ?? action.defBoostPerCounter ?? 0;
  let applied = false;
  for (const card of targets) {
    if (card.cardKind !== "monster") continue;
    const sources = action.counterSourceRef ? resolveTargetsForAction({ targetRef: action.counterSourceRef }, selections, options, opponent) : [card];
    const count = sources.reduce((sum, source) => sum + Math.max(0, getCounterValue(source, action.counterType)), 0);
    if (count < (action.minCounters ?? 0) || (!atkPerCounter && !defPerCounter) || count === 0) continue;
    if (getCardEffectImmunity({ game: { player: ctx.state.player, bot: ctx.state.bot, turnCounter: ctx.state.turnCounter } },
      card, ctx.self, { sourceCard: options.sourceCard || null }).immune) continue;
    applyBuffStatsTemp({ ...ctx, targets: [card], action: { ...action, type: "buff_stats_temp",
      atkBoost: atkPerCounter * count, defBoost: defPerCounter * count,
      sourceName: action.sourceName || options.sourceCard?.name || action.type } });
    // Runtime accepts a valid buff even if the stat floor absorbs its change.
    applied = true;
  }
  return applied;
}
