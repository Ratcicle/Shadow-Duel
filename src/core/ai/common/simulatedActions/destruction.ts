import { appendSimulatedZoneCard } from "../zones.js";
import type { SimulatedMoveReceipt } from "../zones.js";
import { getOriginalOwner, setSimulatedController } from "./movement.js";
import { applySimulatedActions } from "./index.js";
import { resolveExactInstanceSelection } from "../../../AutoSelector.js";
import { getEffectiveAtk } from "../cardStats.js";
import { getCardEffectImmunity } from "../../../effects/targeting/filters.js";
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
  ActionTargetScope,
  DestroyDamageEntry,
} from "../../../contracts/actions.js";
import type {
  SimulatedCardState,
  SimulatedPlayerState,
} from "../../../contracts/aiState.js";
import type { CardFilter, EffectCondition, ReplacementEffectDefinition } from "../../../contracts/effects.js";
import type { ActionReplacementEffect } from "../../../contracts/actions/shared.js";
import type { SimulatedActionHandlerContext } from "./shared.js";
import type { SimulatedActionOptions, SimulatedRuntimeState } from "./shared.js";
import { hasSimulatedProtection } from "./lifecycle.js";
import { canUseSimulatedEffectUsage, markSimulatedEffectUsage } from "../simStateUtils.js";

/** The modeled replacement path supports only free or single-action costs. */
export function isSupportedSimulatedDestructionReplacement(replacement: ActionReplacementEffect): boolean {
  if (replacement.type !== "destruction" || (replacement.reason && !["any", "battle", "effect"].includes(replacement.reason)) ||
    replacement.costCount || replacement.costFilters || replacement.costZone || replacement.costOwner || replacement.costDestination) return false;
  if (!replacement.costActions?.length) return true;
  if (replacement.costActions.length !== 1) return false;
  const cost = replacement.costActions[0];
  return !!cost && ((cost.type === "move" && ((cost.targetRef === "self" && cost.to === "graveyard") ||
    (cost.targetRef === "destroyed" && cost.to === "extraDeck"))) ||
    (cost.type === "return_to_hand" && cost.targetRef === "destroyed") || cost.type === "pay_lp" ||
    (cost.type === "remove_counters_from_field" && !cost.targetRef));
}

/** Resolve supported equipment costs after battle damage has been calculated. */
export function replaceSimulatedBattleDestruction(
  state: SimulatedRuntimeState,
  target: SimulatedCardState,
  options: SimulatedActionOptions = {},
): SimulatedCardState | null {
  return replaceSimulatedDestruction(state, target, "battle", options);
}

function replaceSimulatedDestruction(
  state: SimulatedRuntimeState,
  target: SimulatedCardState,
  reason: "battle" | "effect",
  options: SimulatedActionOptions = {},
): SimulatedCardState | null {
  const targetOwner = findCardOwner(state, target);
  if (!targetOwner) return null;
  const zone = findCardZone(targetOwner, target);
  const matches = (replacement: ActionReplacementEffect, owner: SimulatedPlayerState, source?: SimulatedCardState | null) =>
    replacement.type === "destruction" && (!replacement.reason || replacement.reason === "any" || replacement.reason === reason) &&
    (!replacement.targetRequireFaceup || !target.isFacedown) &&
    (!replacement.targetZones || (zone !== null && replacement.targetZones.includes(zone))) &&
    (replacement.targetOwner !== "self" || owner === targetOwner) &&
    (replacement.targetOwner !== "opponent" || owner !== targetOwner) &&
    (!replacement.targetMustBeSource || target === source) &&
    (!replacement.targetMustNotBeSource || target !== source) &&
    (!replacement.targetMustBeEquippedToSource || (source?.equippedTo || source?.equipTarget) === target) &&
    (!replacement.targetFilters || matchesTargetFilters(target, replacement.targetFilters));
  const entries: Array<{ owner: SimulatedPlayerState; source: SimulatedCardState;
    effect: ReplacementEffectDefinition; firstOpportunityConsumed: boolean }> = [];
  for (const owner of [state.bot, state.player]) {
    for (const source of [...owner.field, ...owner.spellTrap, ...(owner.fieldSpell ? [owner.fieldSpell] : [])]) {
      for (const effect of source.effects || []) {
        if (effect.timing !== "passive" || !("replacementEffect" in effect)) continue;
        entries.push({ owner, source, effect, firstOpportunityConsumed: false });
      }
    }
  }
  const isEligible = (entry: (typeof entries)[number], skipUsage = false) => {
    const { owner, source, effect } = entry;
    const sourceZone = findCardZone(owner, source);
    return !source.isFacedown && !source.effectsNegated && sourceZone !== null &&
      (!effect.requireZone || effect.requireZone === sourceZone) &&
      matches(effect.replacementEffect, owner, source) &&
      evaluateSimulatedConditions(effect.conditions || [], {
        state, selfId: owner === state.bot ? "bot" : "player", sourceCard: source,
      }) && (skipUsage || canUseSimulatedEffectUsage(state, effect, source, owner.id, true));
  };
  // First-opportunity usage is consumed before selecting any replacement.
  const firstOpportunityEntries = entries.filter(entry =>
    entry.effect.replacementEffect.consumeOnFirstOpportunity && isEligible(entry));
  for (const entry of firstOpportunityEntries) {
    if (canUseSimulatedEffectUsage(state, entry.effect, entry.source, entry.owner.id, true)) {
      markSimulatedEffectUsage(state, entry.effect, entry.source, entry.owner.id, true);
    }
    entry.firstOpportunityConsumed = true;
  }
  for (const entry of state._simReplacementEffects || []) {
    const owner = [state.bot, state.player].find(player => player.id === entry.sourcePlayerId);
    if (!owner || !entry.replacementEffect || entry.usesRemaining === 0 ||
        (typeof entry.expiresOnTurn === "number" && (state.turnCounter || 0) > entry.expiresOnTurn)) continue;
    if (entry.targetPresences?.length && !entry.targetPresences.some(presence =>
      presence.instanceId === getCardInstanceId(target) && presence.locationVersion === (target.locationVersion || 0) &&
      (presence.fieldPresenceId == null || presence.fieldPresenceId === target.fieldPresenceId))) continue;
    if (!matches(entry.replacementEffect, owner, entry.sourceCard)) continue;
    if (entry.replacementEffect.costActions?.length || entry.replacementEffect.costCount) continue;
    if (entry.usesRemaining != null) entry.usesRemaining -= 1;
    return entry.sourceCard || target;
  }
  for (const entry of entries) {
    const { owner, source, effect, firstOpportunityConsumed } = entry;
    const replacement = effect.replacementEffect;
    if (!isSupportedSimulatedDestructionReplacement(replacement)) continue;
    if (!isEligible(entry, firstOpportunityConsumed)) continue;
    const markUsage = () => {
      if (!firstOpportunityConsumed) markSimulatedEffectUsage(state, effect, source, owner.id, true);
    };
    const costs = replacement.costActions;
    if (!costs?.length && !replacement.costCount) {
      markUsage();
      return source;
    }
    // Leave unsupported cost sequences to the full runtime.
    if (costs?.length !== 1) continue;
    const costAction = costs[0];
    if (!costAction) continue;
    if ((costAction.type === "return_to_hand" && costAction.targetRef === "destroyed") ||
        (costAction.type === "move" && costAction.targetRef === "destroyed" && costAction.to === "extraDeck")) {
      const locationVersion = target.locationVersion || 0;
      const moved = applySimulatedActions({ state, selfId: owner === state.bot ? "bot" : "player",
        actions: [costAction], selections: { destroyed: [target] },
        options: { ...options, sourceCard: source, effect } });
      if (!moved || (target.locationVersion || 0) === locationVersion) continue;
    } else if (costAction.type === "move" && costAction.targetRef === "self" && costAction.to === "graveyard") {
      if (!moveCardToZone(owner, source, "graveyard", owner, { state })) continue;
      if (!owner.graveyard.includes(source)) continue;
    } else if (costAction.type === "pay_lp") {
      const opponent = owner === state.bot ? state.player : state.bot;
      const cost = resolveSimulatedLpCost({ action: costAction, targetPlayer: owner, self: owner,
        opponent, state, options: { sourceCard: source }, baseAmount: costAction.amount || 0 });
      if (owner.lp <= cost.finalAmount) continue;
      owner.lp -= cost.finalAmount;
      for (const reducer of cost.appliedReducers) markSimulatedPassiveUsed(state, reducer.board, reducer.card, reducer.effect);
    } else if (costAction.type === "remove_counters_from_field") {
      const paid = applySimulatedActions({ state, selfId: owner === state.bot ? "bot" : "player", actions: [costAction],
        selections: { self: [source], destroyed: [target] }, options: { ...options, sourceCard: source, effect } });
      if (!paid) continue;
    } else continue;
    markUsage();
    return source;
  }
  return null;
}

interface ScopedCard {
  card: SimulatedCardState;
  owner: SimulatedPlayerState;
}

export function destroySimulatedCard(
  card: SimulatedCardState,
  owner: SimulatedPlayerState,
  sourcePlayer: SimulatedPlayerState,
  state: SimulatedRuntimeState,
  options: SimulatedActionOptions,
): boolean {
  const fromZone = findCardZone(owner, card);
  if (!fromZone) return false;
  if (options.sourceCard && getCardEffectImmunity({ game: {
    player: state.player,
    bot: state.bot,
    turnCounter: state.turnCounter,
  } }, card, sourcePlayer, { sourceCard: options.sourceCard, effectType: "destruction" }).immune) return false;
  const inActiveZone = fromZone === "field" || fromZone === "spellTrap" || fromZone === "fieldSpell";
  const protectedFromSource = hasSimulatedProtection(card, "effect_destruction", state.turnCounter || 0,
    { ownerId: owner.id, sourceOwnerId: sourcePlayer.id });
  if (inActiveZone && protectedFromSource) return false;
  if (inActiveZone && !card.isFacedown && !card.effectsNegated && card.effects?.some(effect =>
    effect.timing === "passive" && "passive" in effect && effect.passive?.type === "conditional_protection" &&
    effect.passive.protectionType === "effect_destruction" &&
    (!effect.requireZone || effect.requireZone === fromZone) &&
    (!effect.passive.requireSummonProcedure || card.lastSummonProcedure === effect.passive.requireSummonProcedure) &&
    (effect.passive.sourceOwner !== "self" || sourcePlayer.id === owner.id) &&
    (effect.passive.sourceOwner !== "opponent" || sourcePlayer.id !== owner.id) &&
    evaluateSimulatedConditions(effect.conditions || [], { state, selfId: owner === state.bot ? "bot" : "player", sourceCard: card }))) return false;
  if (replaceSimulatedDestruction(state, card, "effect", options)) return false;
  const wasFaceupBeforeMove = card.isFacedown !== true;
  const effectsNegatedAtFieldExit = card.effectsNegated === true;
  const destination = inActiveZone ? getOriginalOwner(state, card, owner) : owner;
  const receipt: { value: SimulatedMoveReceipt | null } = { value: null };
  if (!moveCardToZone(destination, card, "graveyard", owner, {
    state, movedByEffect: true, sourceCard: options.sourceCard || null, sourcePlayer,
    ...(options.emitSimulatedEvent ? { emitSimulatedEvent: options.emitSimulatedEvent } : {}),
    onMoveCommitted: result => { receipt.value = result; },
  })) return false;
  const toZone = receipt.value?.destinationPresence.zone ?? findCardZone(destination, card) ?? "removed";
  const toPlayer = toZone === "removed" ? null : receipt.value
    ? [state.player, state.bot].find(player => player.id === receipt.value?.destinationPresence.controllerId) ?? null
    : destination;
  const payload = { card, player: toPlayer,
    fromPlayer: owner, toPlayer,
    fromZone, toZone, wasFaceupBeforeMove,
    locationVersion: receipt.value?.destinationPresence.locationVersion ?? card.locationVersion ?? 0,
    ...(receipt.value?.equipBindingsAtFieldExit.length ? { equipBindingsAtFieldExit: receipt.value.equipBindingsAtFieldExit } : {}),
    effectsNegatedAtFieldExit, wasDestroyed: true, destroyCause: "effect",
    destroySource: options.sourceCard || null, sourceCard: options.sourceCard || null,
    movedByEffect: true, actionContext: options.actionContext };
  if (toZone === "graveyard") options.emitSimulatedEvent?.("card_to_grave", payload);
  options.emitSimulatedEvent?.("card_moved", payload);
  return true;
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
    destroySimulatedCard(card, owner, self, state, options);
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
  const successful: Array<{ owner: SimulatedPlayerState; damagePlayer: string; multiplier: number; atk: number }> = [];
  for (const entry of entries) {
    const entryTargets = resolveTargetsForAction(
      entry,
      selections,
      options,
      opponent,
    );
    for (const card of entryTargets) {
      const owner = findCardOwner(state, card);
      if (!owner) continue;
      const atk = getEffectiveAtk(card);
      if (destroySimulatedCard(card, owner, self, state, options)) successful.push({ owner,
        damagePlayer: entry.damagePlayer || "owner", multiplier: entry.multiplier ?? 1, atk });
    }
  }
  const skipDamage = (playerKey: "self" | "opponent"): boolean => {
    const conditions = action.skipDamageIf?.[playerKey];
    if (!conditions) return false;
    return evaluateSimulatedConditions(conditions as readonly EffectCondition[], {
      state,
      selfId,
      options,
    });
  };
  successful.forEach(({ owner, damagePlayer, multiplier, atk }) => {
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
): boolean | void | typeof STOP_SIMULATION {
  const { action, opponent, self, state, options } = ctx;
  if (action.targetRef || (action.minTargets !== 0 && !action.targetCountFromContext)) return applyDestroy(ctx);
  const zones = (action.zones || ["field", "spellTrap", "fieldSpell"])
    .filter(zone => zone === "field" || zone === "spellTrap" || zone === "fieldSpell");
  const candidates = getActionCandidates(opponent, {
    ...action, zones,
  }, "field", options);
  let count = action.maxTargets ?? 1;
  if (action.targetCountFromContext) {
    const spec = action.targetCountFromContext;
    let value = Number(options.actionContext && Reflect.get(options.actionContext, spec.key) || 0);
    if (!Number.isFinite(value)) value = 0;
    const divisor = Number(spec.divideBy ?? 0), multiplier = Number(spec.multiplier ?? 1);
    if (Number.isFinite(divisor) && divisor !== 0) value /= divisor;
    if (Number.isFinite(multiplier)) value *= multiplier;
    count = spec.round === "ceil" ? Math.ceil(value) : spec.round === "round" ? Math.round(value) : Math.floor(value);
  }
  const optional = action.minTargets === 0;
  const requestedMax = Math.max(0, Math.floor(count));
  const max = Math.min(requestedMax, candidates.length);
  const min = Math.min(max, Math.max(0, optional ? 0 : action.targetCountFromContext ? requestedMax : action.minTargets ?? max));
  const exact = optional ? options.activationContext?.decisions?.selections?.destroy_targets : undefined;
  const selected = exact !== undefined
    ? resolveExactInstanceSelection(candidates, exact, { min, max: requestedMax })
    : rankCandidates(candidates, "harm", {
        ...options, targetPreference: getTargetPreference(options, "destroy_targets"),
      }).slice(0, max);
  if (selected === null) {
    (state._simUnsupportedActions ??= []).push("exact_selection:destroy_targets");
    return STOP_SIMULATION;
  }
  if (!optional && (requestedMax <= 0 || candidates.length === 0)) return STOP_SIMULATION;
  const presences = selected.map(card => ({ card, owner: findCardOwner(state, card),
    zone: findCardZone(opponent, card), version: card.locationVersion || 0, controller: card.controller ?? opponent.id }));
  let nonImmune = 0;
  for (const entry of presences) {
    if (optional && (findCardOwner(state, entry.card) !== entry.owner || findCardZone(opponent, entry.card) !== entry.zone ||
      (entry.card.locationVersion || 0) !== entry.version || (entry.card.controller ?? opponent.id) !== entry.controller)) continue;
    if (getCardEffectImmunity({ game: { player: state.player, bot: state.bot, turnCounter: state.turnCounter } },
      entry.card, self, { sourceCard: options.sourceCard || null }).immune) continue;
    nonImmune++;
    destroySimulatedCard(entry.card, opponent, self, state, options);
  }
  return optional || nonImmune > 0;
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
    if (destroySimulatedCard(card, actualOwner, self, ctx.state, ctx.options)) {
      destroyedCount += 1;
    }
  });

  const drawPerDestroyed = Math.max(0, Number(action.drawPerDestroyed || 0));
  const drawAmount = Math.floor(destroyedCount * drawPerDestroyed);
  if (drawAmount <= 0) return;

  ctx.applySimulatedActions({ state: ctx.state, selfId: ctx.selfId, options: ctx.options,
    actions: [{ type: "draw", amount: drawAmount, player: action.drawPlayer || "self" }] });
  return;
}
