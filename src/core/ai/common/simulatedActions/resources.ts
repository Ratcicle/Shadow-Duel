import { appendSimulatedZoneCard, getZoneCards } from "../zones.js";
import { cardMatchesKind } from "../../../Card.js";
import { resolveExactInstanceSelection } from "../../../AutoSelector.js";
import { getEffectiveAtk } from "../cardStats.js";
import { emitSimulatedMove } from "./movement.js";
import type { SimulatedMoveReceipt } from "../zones.js";
import { getBaseLpCost } from "../../../effects/costs/lpCost.js";
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
  storeSimActionResult,
  getContextPathValue,
} from "./shared.js";
import type {
  ActionOf,
  ContextNumberSource,
} from "../../../contracts/actions.js";
import type { AddedCardMarker } from "../../../contracts/actions/shared.js";
import type {
  SimulatedCardState,
  SimulatedPlayerState,
} from "../../../contracts/aiState.js";
import type { CardDeclaredValue } from "../../../contracts/cards.js";
import type { CardFilter } from "../../../contracts/effects.js";
import type { EffectActivationRestriction } from "../../../contracts/player.js";
import type { CanonicalSelectionMap } from "../../../contracts/selection.js";
import type {
  SimulatedActionHandlerContext,
  SimulatedActionContextData,
  SimulatedActionOptions,
  SimulatedRuntimeState,
} from "./shared.js";

type SimulatedNumberSpec =
  | number
  | string
  | ContextNumberSource
  | LegacySimNumberConfig;

interface LegacySimNumberConfig {
  readonly key?: string;
  readonly defaultValue?: number;
  readonly divideBy?: number;
  readonly divisor?: number;
  readonly multiplier?: number;
  readonly amountPer?: number;
  readonly floor?: boolean;
  readonly min?: number;
  readonly max?: number;
}

type LegacyPayLpAction = ActionOf<"pay_lp"> & {
  readonly lp?: number;
};

type SimNameEntry = string | { readonly name?: string } | null | undefined;
type SimAttributeEntry =
  | string
  | { readonly attribute?: string }
  | null
  | undefined;
type DynamicSimulationOptions = SimulatedActionOptions & CanonicalSelectionMap;
type DynamicActionContext = SimulatedActionContextData & CanonicalSelectionMap;
type DynamicSimulatedCard = SimulatedCardState & CanonicalSelectionMap;
type LegacyNamesAction = ActionOf<"restrict_effect_activations_by_names"> & {
  readonly namesSource?: string;
};
type LegacyAddedCardMarker = AddedCardMarker & {
  readonly expiresOnTurn?: number;
  readonly durationTurns?: number;
};
type LegacyAddFromZoneAction = ActionOf<"add_from_zone_to_hand"> & {
  readonly sourceEffectId?: string;
};
type ReferencedTargets = SimulatedCardState[] & CanonicalSelectionMap;
type DeclaredPrimitive = Exclude<CardDeclaredValue, object>;
interface NamedPreference {
  readonly preferredNames?: readonly DeclaredPrimitive[];
  readonly forceNames?: readonly DeclaredPrimitive[];
}
type MutableCardFilter = {
  -readonly [Key in keyof CardFilter]: CardFilter[Key];
};
type LegacyGrantContext = SimulatedActionHandlerContext<
  "grant_additional_normal_summon"
> & { readonly effect?: { readonly id?: string } | null };

function readSimContextNumber(
  spec: SimulatedNumberSpec | null | undefined,
  options: SimulatedActionOptions = {},
): number {
  if (typeof spec === "number") return spec;
  if (!spec) return 0;

  const config: LegacySimNumberConfig =
    typeof spec === "string" ? { key: spec } : spec;
  const key = config.key;
  const source = options.actionContext || options.activationContext?.actionContext || options.activationContext || {};
  const raw = key
    ? getContextPathValue(source, key)
    : config.defaultValue;
  let value = Number(raw ?? config.defaultValue ?? 0);
  if (!Number.isFinite(value)) value = 0;

  const divideBy = Number(config.divideBy ?? config.divisor ?? 0);
  if (Number.isFinite(divideBy) && divideBy !== 0) value /= divideBy;

  const multiplier = Number(config.multiplier ?? config.amountPer ?? 1);
  if (Number.isFinite(multiplier)) value *= multiplier;

  if (config.floor !== false) value = Math.floor(value);
  if (Number.isFinite(Number(config.min))) value = Math.max(Number(config.min), value);
  if (Number.isFinite(Number(config.max))) value = Math.min(Number(config.max), value);
  return value;
}

export function applyDraw(
  ctx: SimulatedActionHandlerContext<"draw">,
): void | typeof STOP_SIMULATION {
  const { action, state, options, self, opponent } = ctx;
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  const amount = Math.max(0, Number(action.amount ?? 1) || 0);
  const drawnCards: SimulatedCardState[] = [];
  for (let i = 0; i < amount && targetPlayer.deck.length > 0; i += 1) {
    // Runtime draws from the end. Identity stays hidden until the real action
    // resolves, so this branch receives only an unknown hand resource.
    targetPlayer.deck.pop();
    state._simGeneratedInstanceCounter = (state._simGeneratedInstanceCounter || 0) + 1;
    const unknownDraw = {
      instanceId: `sim:draw:${state._simGeneratedInstanceCounter}`,
      owner: targetPlayer.id,
      _simUnknownDraw: true,
    } as SimulatedCardState;
    targetPlayer.hand.push(unknownDraw);
    drawnCards.push(unknownDraw);
  }
  options.lastDrawnCards = drawnCards;
  options.lastDrawnCard = drawnCards[0] || null;
  for (const context of new Set([options.actionContext, options.activationContext?.actionContext])) {
    if (!context) continue;
    context.lastDrawnCards = drawnCards;
    context.lastDrawnCard = drawnCards[0] || null;
  }
  if (drawnCards.length > 0) {
    state._simRequiresReplan = true;
    state._simUnknownDrawCount = (state._simUnknownDrawCount || 0) + drawnCards.length;
  } else if (amount > 0 && !("optional" in action && action.optional === true)) {
    // Runtime treats an empty mandatory draw as a failed action, not a duel
    // loss. Stop this action sequence while retaining separate queued effects.
    return STOP_SIMULATION;
  }
}

export function applyDrawAndSummon(
  ctx: SimulatedActionHandlerContext<"draw_and_summon">,
): void | typeof STOP_SIMULATION {
  const drawResult = applyDraw({ ...ctx, action: { type: "draw", amount: ctx.action.drawAmount || 1 } });
  if (drawResult === STOP_SIMULATION && ctx.action.optional !== true) return STOP_SIMULATION;
  // The condition and summon choice depend on the revealed card. Preserve the
  // draw and resume planning only after the real result is available.
  if (ctx.options.lastDrawnCards?.length) return STOP_SIMULATION;
}

export function applyHeal(
  ctx: SimulatedActionHandlerContext<"heal">,
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
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  const amount =
    (Number.isFinite(Number(action.amount)) ? Number(action.amount) : 0) +
    readSimContextNumber(action.amountFromContext, options);
  const multiplier = (targetPlayer.field || []).reduce((highest, card) => {
    if (card.isFacedown || card.cardKind !== "monster") return highest;
    return (card.effects || []).reduce((value, effect) =>
      effect.timing === "passive" && "passive" in effect && effect.passive?.type === "lp_gain_multiplier"
        ? Math.max(value, Number(effect.passive.multiplier) || 1)
        : value, highest);
  }, 1);
  const before = targetPlayer.lp;
  targetPlayer.lp += Math.floor(amount * multiplier);
  if (targetPlayer.lp > before) {
    targetPlayer.lpGainedThisTurn = (targetPlayer.lpGainedThisTurn || 0) + (targetPlayer.lp - before);
    options.onLpGain?.({ state, player: targetPlayer, sourceCard: options.sourceCard || null, before, after: targetPlayer.lp });
    options.emitSimulatedEvent?.("lp_change", {
      player: targetPlayer, sourceCard: options.sourceCard || null,
      before, after: targetPlayer.lp, lpGained: targetPlayer.lp - before,
      lpLost: 0, lpPaid: 0, damageAmount: 0,
    });
  }
  return;
}

export function applyHealPerOpponentCardsAndHand(
  ctx: SimulatedActionHandlerContext<"heal_per_opponent_cards_and_hand">,
): void {
  const { action, opponent } = ctx;
  if (action.amountPerCard <= 0) return;
  const counted = [
    ...opponent.field, ...opponent.spellTrap, ...opponent.hand,
    ...(opponent.fieldSpell ? [opponent.fieldSpell] : []),
  ].filter(Boolean).length;
  if (counted === 0) return;
  applyHeal({ ...ctx, action: { type: "heal", amount: counted * action.amountPerCard, player: action.player || "self" } });
}

export function applyHealPerArchetypeMonster(
  ctx: SimulatedActionHandlerContext<"heal_per_archetype_monster">,
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
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  const archetype = action.archetype;
  const count = (targetPlayer.field || []).filter((card) =>
    hasArchetype(card, archetype)
  ).length;
  applyHeal({ ...ctx, action: { type: "heal", amount: (action.amountPerMonster || 0) * count,
    player: action.player || "self" } });
  return;
}

export function applyHealPerFieldCount(
  ctx: SimulatedActionHandlerContext<"heal_per_field_count">,
): void | false {
  const { action, self, opponent } = ctx;
  if (action.amountPerCard <= 0) return false;
  const filters = action.filters || {};
  const countedPlayer = filters.owner === "opponent" ? opponent : self;
  const zone = filters.zone || "field";
  // The runtime action counts an array zone and heals its activating player.
  // Preserve its scalar filters and legacy recipient behavior exactly.
  if (!Array.isArray(Reflect.get(countedPlayer, zone))) return false;
  const count = getZoneCards(countedPlayer, zone).filter(card =>
    (!filters.cardKind || cardMatchesKind(card, filters.cardKind)) &&
    (!filters.archetype || card.archetype === filters.archetype) &&
    (!filters.type || card.type === filters.type) &&
    (!filters.name || card.name === filters.name) &&
    (!filters.requireFaceup || !card.isFacedown)).length;
  if (count === 0) return;
  applyHeal({ ...ctx, action: { type: "heal", amount: count * action.amountPerCard, player: "self" } });
}

export function applyHealFromDestroyedAtk(
  ctx: SimulatedActionHandlerContext<"heal_from_destroyed_atk">,
): void | false {
  const { action, options } = ctx;
  const destroyed = (options.actionContext || options.activationContext?.actionContext)?.destroyed;
  if (!destroyed || Array.isArray(destroyed)) return false;
  const value = action.useBaseAtk === true && Number.isFinite(Number(destroyed.baseAtk))
    ? Number(destroyed.baseAtk)
    : Number.isFinite(Number(destroyed.atk)) ? Number(destroyed.atk) : 0;
  const amount = Math.floor(value * (action.fraction ?? action.multiplier ?? 1));
  if (amount <= 0) return false;
  applyHeal({ ...ctx, action: { type: "heal", amount, player: "self" } });
}

export function applyHealFromDestroyedLevel(
  ctx: SimulatedActionHandlerContext<"heal_from_destroyed_level">,
): void | false {
  const { action, options } = ctx;
  const destroyed = (options.actionContext || options.activationContext?.actionContext)?.destroyed;
  if (!destroyed || Array.isArray(destroyed)) return false;
  const amount = Math.floor((destroyed.level || 0) * (action.multiplier || 100));
  if (amount <= 0) return;
  // Runtime heals the resolving player, including the legacy player field.
  applyHeal({ ...ctx, action: { type: "heal", amount, player: "self" } });
}

export function applyDamage(
  ctx: SimulatedActionHandlerContext<"damage">,
): boolean {
  const { action, self, opponent, options } = ctx;
  const targetPlayer = action.player === "self" ? self : opponent;
  return applySimulatedEffectDamage(targetPlayer, action.amount ?? 0, options);
}

/** Effect damage shares runtime LP clamping, history and sequential LP facts. */
export function applySimulatedEffectDamage(
  targetPlayer: SimulatedPlayerState,
  amount: number,
  options: SimulatedActionOptions,
): boolean {
  if (!amount || amount <= 0) return false;
  const before = targetPlayer.lp;
  targetPlayer.lp = Math.max(0, targetPlayer.lp - amount);
  const actual = Math.max(0, before - targetPlayer.lp);
  if (actual > 0) {
    targetPlayer.damageReceivedThisTurn = Math.max(0, Number(targetPlayer.damageReceivedThisTurn || 0)) + actual;
    options.emitSimulatedEvent?.("lp_change", {
      player: targetPlayer, sourceCard: options.sourceCard || null,
      before, after: targetPlayer.lp, lpGained: 0, lpLost: actual,
      lpPaid: 0, damageAmount: actual, damagedPlayer: targetPlayer,
    });
  }
  return targetPlayer.lp < before;
}

export function applyPayLp(
  ctx: SimulatedActionHandlerContext<"pay_lp">,
): void | typeof STOP_SIMULATION {
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
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  const amount = getBaseLpCost({
    ...action,
    amount: Number.isFinite(action.amount)
      ? action.amount ?? 0
      : (action as LegacyPayLpAction).lp ?? 0,
  }, targetPlayer.lp || 0);
  if (amount <= 0) return STOP_SIMULATION;
  const cost = resolveSimulatedLpCost({
    action,
    targetPlayer,
    self,
    opponent,
    state,
    options,
    baseAmount: amount,
  });
  const finalAmount = cost.finalAmount;
  if (
    finalAmount > 0 &&
    (targetPlayer.lp || 0) < finalAmount
  ) {
    return STOP_SIMULATION;
  }
  const before = targetPlayer.lp || 0;
  targetPlayer.lp = Math.max(0, before - finalAmount);
  cost.appliedReducers.forEach((reducer) => {
    markSimulatedPassiveUsed(state, reducer.board, reducer.card, reducer.effect);
  });
  if (targetPlayer.lp < before) {
    options.onLpPayment?.({ state, player: targetPlayer, sourceCard: options.sourceCard || null,
      effect: options.effect || null, before, after: targetPlayer.lp, amount: before - targetPlayer.lp,
      payingActivationCosts: options.payingActivationCosts === true });
    options.emitSimulatedEvent?.("lp_change", {
      player: targetPlayer, sourceCard: options.sourceCard || null,
      before, after: targetPlayer.lp, lpGained: 0, lpLost: before - targetPlayer.lp,
      lpPaid: before - targetPlayer.lp, damageAmount: 0,
    });
  }
  return;
}

function normalizeSimNameList(values: unknown = []): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const entries = Array.isArray(values) ? values : [values];
  for (const entry of entries as readonly SimNameEntry[]) {
    const name = typeof entry === "string"
      ? entry.trim()
      : entry?.name?.trim?.() || "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

function readSimNameSource(
  action: ActionOf<"restrict_effect_activations_by_names">,
  options: SimulatedActionOptions,
): unknown {
  const sourceKey =
    action.nameSource ||
    (action as LegacyNamesAction).namesSource ||
    null;
  if (!sourceKey) return [];
  if (sourceKey === "lastDrawnCards") return options.lastDrawnCards || [];
  if (sourceKey === "lastDrawnCard") return options.lastDrawnCard || null;
  if (sourceKey === "lastAddedToHandCards") {
    return options.lastAddedToHandCards || [];
  }
  if (sourceKey === "lastAddedToHandCard") return options.lastAddedToHandCard || null;
  return (
    (options as DynamicSimulationOptions)[sourceKey] ||
    (options.actionContext as DynamicActionContext | undefined)?.[sourceKey] ||
    []
  );
}

function normalizeSimAttributeList(values: unknown = []): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const entries = Array.isArray(values) ? values : [values];
  for (const entry of entries as readonly SimAttributeEntry[]) {
    const attribute = typeof entry === "string"
      ? entry.trim()
      : entry?.attribute?.trim?.() || "";
    if (!attribute) continue;
    const key = attribute.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(attribute);
  }
  return result;
}

function flattenSimCards(value: unknown): unknown[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenSimCards);
  return [value];
}

function readSimAttributeSource(
  action: ActionOf<"restrict_effect_activations_by_attribute">,
  selections: CanonicalSelectionMap | undefined,
  options: SimulatedActionOptions,
): unknown[] {
  const sourceKey =
    action.attributeSourceRef ||
    action.attributeSource ||
    action.sourceRef ||
    action.targetRef ||
    null;
  if (!sourceKey) return [];
  return [
    selections?.[sourceKey],
    (options as DynamicSimulationOptions)?.[sourceKey],
    options?.actionResults?.[sourceKey],
    (options?.actionContext as DynamicActionContext | undefined)?.[sourceKey],
    options?.activationContext?.actionResults?.[sourceKey],
  ].flatMap(flattenSimCards).filter(Boolean);
}

export function applyRestrictEffectActivationsByNames(
  ctx: SimulatedActionHandlerContext<"restrict_effect_activations_by_names">,
): void {
  const { action, options, self, opponent, state } = ctx;
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  if (!targetPlayer) return;

  const explicitNames =
    action.names || action.cardNames || action.blockedNames || [];
  const blockedNames = normalizeSimNameList([
    ...normalizeSimNameList(explicitNames),
    ...normalizeSimNameList(readSimNameSource(action, options)),
  ]);
  if (blockedNames.length === 0) return;

  targetPlayer.effectActivationRestrictions =
    targetPlayer.effectActivationRestrictions || [];
  targetPlayer.effectActivationRestrictions.push({
    blockedNames,
    duration: action.duration || "until_end_turn",
    expiresOnTurn: state.turnCounter,
    reason: action.reason || null,
    sourceName: options?.sourceCard?.name || null,
    sourceId: options?.sourceCard?.id || null,
  } as EffectActivationRestriction);
}

export function applyRestrictEffectActivationsByAttribute(
  ctx: SimulatedActionHandlerContext<"restrict_effect_activations_by_attribute">,
): void {
  const { action, selections, options, self, opponent, state } = ctx;
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  if (!targetPlayer) return;

  const allowedAttributes = normalizeSimAttributeList([
    ...normalizeSimAttributeList(action.allowedAttributes || action.attributes || []),
    ...normalizeSimAttributeList(
      readSimAttributeSource(action, selections, options),
    ),
  ]);
  if (allowedAttributes.length === 0) return;

  targetPlayer.effectActivationRestrictions =
    targetPlayer.effectActivationRestrictions || [];
  targetPlayer.effectActivationRestrictions.push({
    allowedAttributes,
    restrictedCardFilters: action.restrictedCardFilters || { cardKind: "monster" },
    duration: action.duration || "until_end_turn",
    expiresOnTurn: state.turnCounter,
    reason: action.reason || null,
    sourceName: options?.sourceCard?.name || null,
    sourceId: options?.sourceCard?.id || null,
  } as EffectActivationRestriction);
}

export function applySearchAny(
  ctx: SimulatedActionHandlerContext<"search_any">,
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
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  const candidates = getActionCandidates(targetPlayer, action, "deck");
  options.lastAddedToHandCards = [];
  options.lastAddedToHandCard = null;
  for (const context of new Set([options.actionContext, options.activationContext?.actionContext])) {
    if (!context) continue;
    context.lastAddedToHandCards = [];
    context.lastAddedToHandCard = null;
  }
  const chosen = chooseRankedCards(
    candidates,
    "benefit",
    action,
    state,
    targetPlayer,
    options,
  )[0];
  if (!chosen) return;
  removeCardFromZones(targetPlayer, chosen);
  appendSimulatedZoneCard(targetPlayer.hand, chosen);
  options.lastAddedToHandCards = [chosen];
  options.lastAddedToHandCard = chosen;
  for (const context of new Set([options.actionContext, options.activationContext?.actionContext])) {
    if (!context) continue;
    context.lastAddedToHandCards = [chosen];
    context.lastAddedToHandCard = chosen;
  }
  return;
}

function resolveSimMarkerExpirationTurn(
  state: SimulatedRuntimeState,
  markerConfig: Partial<LegacyAddedCardMarker> = {},
): number | null {
  const currentTurn = Number(state?.turnCounter || 0);
  if (Number.isFinite(markerConfig.expiresOnTurn)) {
    return markerConfig.expiresOnTurn as number;
  }
  if (Number.isFinite(markerConfig.durationTurns)) {
    return currentTurn + Math.max(0, markerConfig.durationTurns as number);
  }
  if (markerConfig.duration === "end_of_next_turn") {
    return currentTurn + 1;
  }
  if (markerConfig.duration === "end_of_turn") return currentTurn;
  return null;
}

function markSimAddedCards(
  cards: readonly SimulatedCardState[],
  action: ActionOf<"add_from_zone_to_hand">,
  state: SimulatedRuntimeState,
  targetPlayer: SimulatedPlayerState,
  options: SimulatedActionOptions = {},
): void {
  const markerConfig = action?.markAddedCards as
    | LegacyAddedCardMarker
    | undefined;
  if (!markerConfig || typeof markerConfig !== "object" || !markerConfig.key) {
    return;
  }

  const sourceCard = options.sourceCard || null;
  const marker = {
    key: markerConfig.key,
    sourceInstanceId:
      markerConfig.bindToSource === false
        ? null
        : getCardInstanceId(sourceCard),
    sourceCardId:
      markerConfig.bindToSource === false ? null : sourceCard?.id ?? null,
    sourceEffectId:
      markerConfig.sourceEffectId ||
      options.effect?.id ||
      (action as LegacyAddFromZoneAction).sourceEffectId ||
      null,
    controllerId: targetPlayer?.id || null,
    markedOnTurn: Number(state?.turnCounter || 0),
    expiresOnTurn: resolveSimMarkerExpirationTurn(state, markerConfig),
  };

  for (const card of cards || []) {
    if (!card) continue;
    if (!card.effectMarkers || typeof card.effectMarkers !== "object") {
      card.effectMarkers = {};
    }
    card.effectMarkers[markerConfig.key] = { ...marker };
  }
}

export function applyAddFromZoneToHand(
  ctx: SimulatedActionHandlerContext<"add_from_zone_to_hand">,
): void | typeof STOP_SIMULATION {
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
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  const excludeTargetRefs = [
    action.excludeTargetRef,
    ...(Array.isArray(action.excludeTargetRefs)
      ? action.excludeTargetRefs
      : []),
  ].filter(Boolean);
  const excludedInstanceIds = (excludeTargetRefs
    .flatMap((ref) =>
      Array.isArray((targets as ReferencedTargets)?.[ref])
        ? (targets as ReferencedTargets)[ref]
        : (targets as ReferencedTargets)?.[ref]
          ? [(targets as ReferencedTargets)[ref]]
          : [],
    ) as SimulatedCardState[])
    .map(getCardInstanceId)
    .filter((value) => value !== undefined && value !== null);
  const candidates = getActionCandidates(targetPlayer, action, "graveyard").filter(
    (card) => {
      const instanceId = getCardInstanceId(card);
      return instanceId === null || !excludedInstanceIds.includes(instanceId);
    },
  );
  const pickCount = pickCountForAction(action, 1);
  const decisionKey = action.selectionId || `${options.effect?.id || action.type}_selection`;
  const exactIds = options.activationContext?.decisions?.selections?.[decisionKey];
  const chosen = exactIds !== undefined ? resolveExactInstanceSelection(candidates, exactIds, normalizeCount(action.count, 1)) : chooseRankedCards(
    candidates,
    "benefit",
    action,
    state,
    targetPlayer,
    options,
  ).slice(0, Math.min(pickCount, candidates.length));
  if (chosen === null) {
    (state._simUnsupportedActions ??= []).push(`exact_selection:${decisionKey}`);
    return STOP_SIMULATION;
  }
  if (chosen.length === 0) return;
  chosen.forEach((card) => {
    removeCardFromZones(targetPlayer, card);
    appendSimulatedZoneCard(targetPlayer.hand, card);
  });
  options.lastAddedToHandCards = chosen;
  options.lastAddedToHandCard = chosen[0] || null;
  if (options.actionContext && typeof options.actionContext === "object") {
    options.actionContext.lastAddedToHandCards = chosen;
    options.actionContext.lastAddedToHandCard = chosen[0] || null;
  }
  storeSimActionResult(action, selections, options, chosen);
  markSimAddedCards(chosen, action, state, targetPlayer, options);
  return;
}

export function applyDiscardFromHand(
  ctx: SimulatedActionHandlerContext<"discard_from_hand">,
): void | typeof STOP_SIMULATION {
  const { action, state, options, self, opponent } = ctx;
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  const candidates = getActionCandidates(targetPlayer, action, "hand", options).filter(card => !action.filters?.excludeSelf || card !== options.sourceCard);
  const count = normalizeCount(action.count, 1);
  if (candidates.length < count.min) return STOP_SIMULATION;

  const chosen = chooseRankedCards(
    candidates,
    "cost",
    action,
    state,
    targetPlayer,
    options,
  ).slice(0, Math.min(count.max, candidates.length));
  if (chosen.length < count.min) return STOP_SIMULATION;

  for (const card of chosen) {
    const wasFaceupBeforeMove = card.isFacedown !== true;
    const receipt: { value: SimulatedMoveReceipt | null } = { value: null };
    if (!moveCardToZone(targetPlayer, card, "graveyard", targetPlayer, {
      state, movedByEffect: true, sourceCard: options.sourceCard || null, sourcePlayer: self,
      ...(options.emitSimulatedEvent ? { emitSimulatedEvent: options.emitSimulatedEvent } : {}),
      onMoveCommitted: result => { receipt.value = result; },
    })) return STOP_SIMULATION;
    emitSimulatedMove(card, state, targetPlayer, targetPlayer, "hand", wasFaceupBeforeMove,
      false, options, action.contextLabel || "discard", true, receipt.value);
  }
  return;
}

export function applyDeclareCardProperty(
  ctx: SimulatedActionHandlerContext<"declare_card_property">,
): void {
  const { action, state, options, self, opponent } = ctx;
  const sourceCard = options.sourceCard || null;
  if (!sourceCard || !action?.property || !action?.stateKey) return;

  const visibleValues = [
    ...(self?.field || []),
    ...(opponent?.field || []),
  ]
    .map((card) => (card as DynamicSimulatedCard)?.[action.property])
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter(Boolean) as DeclaredPrimitive[];
  const actionContext =
    options.actionContext ||
    options.activationContext?.actionContext ||
    {};
  const targetPreferences =
    options.targetPreferences ||
    actionContext.targetPreferences ||
    options.activationContext?.targetPreferences ||
    {};
  const directPreference =
    options.targetPreference ||
    actionContext.targetPreference ||
    options.activationContext?.targetPreference ||
    null;
  const namedPreferences = [
    directPreference,
    ...Object.values(targetPreferences || {}),
  ].filter(Boolean) as NamedPreference[];
  const preferredValues = namedPreferences.flatMap((preference) => [
    ...(Array.isArray(preference.preferredNames) ? preference.preferredNames : []),
    ...(Array.isArray(preference.forceNames) ? preference.forceNames : []),
  ]);
  const preferredVisibleValue = visibleValues.find((visibleValue) =>
    preferredValues.includes(visibleValue),
  );
  const value = (
    action.value ||
    preferredVisibleValue ||
    visibleValues[0] ||
    (Array.isArray(action.choices) ? action.choices[0] : null) ||
    "Pyro"
  ) as DeclaredPrimitive;

  if (!sourceCard.declaredValues) sourceCard.declaredValues = {};
  const currentTurn = Number(state?.turnCounter || 0);
  const expiresOnTurn =
    typeof action.expiresOnTurn === "number" && Number.isFinite(action.expiresOnTurn)
      ? action.expiresOnTurn
      : typeof action.durationTurns === "number" && Number.isFinite(action.durationTurns)
        ? currentTurn + Math.max(0, action.durationTurns)
        : !action.duration || action.duration === "while_faceup" || action.duration === "permanent"
          ? null
          : action.duration === "end_of_next_turn"
            ? currentTurn + 1
            : currentTurn;
  sourceCard.declaredValues[action.stateKey] = {
    property: action.property,
    value,
    declaredOnTurn: currentTurn,
    expiresOnTurn,
    duration: action.duration || "while_faceup",
  } satisfies CardDeclaredValue;
  return;
}

export function applyGrantAdditionalNormalSummon(
  ctx: SimulatedActionHandlerContext<"grant_additional_normal_summon">,
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
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  const rawCount = Number(action.count ?? 1);
  const count = Number.isFinite(rawCount) ? Math.max(1, rawCount) : 1;
  const filters: MutableCardFilter = { ...(action.filters || {}) };
  if (action.archetype && !filters.archetype) filters.archetype = action.archetype;
  if (action.cardKind && !filters.cardKind) filters.cardKind = action.cardKind;

  if (Object.keys(filters).length > 0) {
    targetPlayer.additionalNormalSummonPermissions =
      targetPlayer.additionalNormalSummonPermissions || [];
    targetPlayer.additionalNormalSummonPermissions.push({
      count,
      filters: filters as CardFilter,
      sourceCardName: ctx?.source?.name || null,
      effectId: (ctx as LegacyGrantContext)?.effect?.id || null,
    });
  } else {
    targetPlayer.additionalNormalSummons =
      (targetPlayer.additionalNormalSummons || 0) + count;
  }
  return;
}
