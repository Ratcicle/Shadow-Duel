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
import type { CanonicalSelectionMap } from "../../../contracts/selection.js";
import type {
  SimulatedActionHandlerContext,
  SimulatedActionOptions,
  SimulatedRuntimeState,
} from "./shared.js";

type SimulatedNumberSpec =
  | number
  | string
  | ContextNumberSource
  | object;

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function readSimContextNumber(
  spec: SimulatedNumberSpec | null | undefined,
  options: SimulatedActionOptions,
): number {
  if (typeof spec === "number") return spec;
  if (!spec) return 0;

  const config: object = typeof spec === "string" ? { key: spec } : spec;
  const rawKey = Reflect.get(config, "key");
  const key = typeof rawKey === "string" ? rawKey : null;
  const source = options.actionContext || {};
  const defaultValue = Reflect.get(config, "defaultValue");
  const raw = key ? Reflect.get(source, key) : defaultValue;
  let value = Number(raw ?? defaultValue ?? 0);
  if (!Number.isFinite(value)) value = 0;

  const divideBy = Number(
    Reflect.get(config, "divideBy") ?? Reflect.get(config, "divisor") ?? 0,
  );
  if (Number.isFinite(divideBy) && divideBy !== 0) value /= divideBy;

  const multiplier = Number(
    Reflect.get(config, "multiplier") ?? Reflect.get(config, "amountPer") ?? 1,
  );
  if (Number.isFinite(multiplier)) value *= multiplier;

  if (Reflect.get(config, "floor") !== false) value = Math.floor(value);
  const minimum = Reflect.get(config, "min");
  const maximum = Reflect.get(config, "max");
  if (Number.isFinite(Number(minimum))) value = Math.max(Number(minimum), value);
  if (Number.isFinite(Number(maximum))) value = Math.min(Number(maximum), value);
  return value;
}

export function applyDraw(
  ctx: SimulatedActionHandlerContext<"draw">,
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
  const amount = action.amount || 1;
  const drawnCards: SimulatedCardState[] = [];
  for (let i = 0; i < amount; i += 1) {
    const drawn = targetPlayer.deck?.shift?.();
    if (drawn) {
      targetPlayer.hand.push(drawn);
      drawnCards.push(drawn);
    }
  }
  options.lastDrawnCards = drawnCards;
  return;
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
  targetPlayer.lp += Math.floor(amount);
  return;
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
  targetPlayer.lp += (action.amountPerMonster || 0) * count;
  return;
}

export function applyDamage(
  ctx: SimulatedActionHandlerContext<"damage">,
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
  targetPlayer.lp -= action.amount || 0;
  return;
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
  const amount = Number.isFinite(Number(action.fraction))
    ? Math.floor((targetPlayer.lp || 0) * Number(action.fraction))
    : typeof action.amount === "number" && Number.isFinite(action.amount)
      ? action.amount
      : Number.isFinite(Reflect.get(action, "lp"))
        ? Number(Reflect.get(action, "lp"))
        : 0;
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
    (targetPlayer.lp || 0) <= finalAmount &&
    Reflect.get(action, "allowSelfKO") !== true
  ) {
    return STOP_SIMULATION;
  }
  targetPlayer.lp = Math.max(0, (targetPlayer.lp || 0) - finalAmount);
  cost.appliedReducers.forEach((reducer) => {
    markSimulatedPassiveUsed(state, reducer.board, reducer.card, reducer.effect);
  });
  return;
}

function normalizeSimNameList(values: unknown = []): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const entries = Array.isArray(values) ? values : [values];
  for (const entry of entries) {
    const rawName = isObject(entry) ? Reflect.get(entry, "name") : undefined;
    const name = typeof entry === "string"
      ? entry.trim()
      : typeof rawName === "string"
        ? rawName.trim()
        : "";
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
  const legacyNamesSource = Reflect.get(action, "namesSource");
  const sourceKey =
    action.nameSource ||
    (typeof legacyNamesSource === "string" ? legacyNamesSource : null);
  if (!sourceKey) return [];
  if (sourceKey === "lastDrawnCards") return options.lastDrawnCards || [];
  if (sourceKey === "lastDrawnCard") return options.lastDrawnCard || null;
  if (sourceKey === "lastAddedToHandCards") {
    return options.lastAddedToHandCards || [];
  }
  if (sourceKey === "lastAddedToHandCard") return options.lastAddedToHandCard || null;
  return (
    Reflect.get(options, sourceKey) ||
    (options.actionContext
      ? Reflect.get(options.actionContext, sourceKey)
      : undefined) ||
    []
  );
}

function normalizeSimAttributeList(values: unknown = []): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const entries = Array.isArray(values) ? values : [values];
  for (const entry of entries) {
    const rawAttribute = isObject(entry)
      ? Reflect.get(entry, "attribute")
      : undefined;
    const attribute = typeof entry === "string"
      ? entry.trim()
      : typeof rawAttribute === "string"
        ? rawAttribute.trim()
        : "";
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
  selections: CanonicalSelectionMap,
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
    Reflect.get(options, sourceKey),
    options.actionResults?.[sourceKey],
    options.actionContext
      ? Reflect.get(options.actionContext, sourceKey)
      : undefined,
    options.activationContext?.actionResults?.[sourceKey],
  ].flatMap(flattenSimCards).filter(Boolean);
}

export function applyRestrictEffectActivationsByNames(
  ctx: SimulatedActionHandlerContext<"restrict_effect_activations_by_names">,
): void {
  const { action, options, self, opponent } = ctx;
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
    allowedAttributes: [],
    restrictedCardFilters: {},
    duration: action.duration || "until_end_turn",
    expiresOnTurn: null,
    reason: action.reason || null,
    sourceName: options?.sourceCard?.name || null,
    sourceId: options?.sourceCard?.id || null,
    effectId: options.effect?.id || null,
  });
}

export function applyRestrictEffectActivationsByAttribute(
  ctx: SimulatedActionHandlerContext<"restrict_effect_activations_by_attribute">,
): void {
  const { action, selections, options, self, opponent } = ctx;
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
    blockedNames: [],
    allowedAttributes,
    restrictedCardFilters: action.restrictedCardFilters || { cardKind: "monster" },
    duration: action.duration || "until_end_turn",
    expiresOnTurn: null,
    reason: action.reason || null,
    sourceName: options?.sourceCard?.name || null,
    sourceId: options?.sourceCard?.id || null,
    effectId: options.effect?.id || null,
  });
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
  targetPlayer.hand.push(chosen);
  return;
}

function resolveSimMarkerExpirationTurn(
  state: SimulatedRuntimeState,
  markerConfig: AddedCardMarker,
): number {
  const currentTurn = Number(state?.turnCounter || 0);
  const expiresOnTurn = Reflect.get(markerConfig, "expiresOnTurn");
  if (typeof expiresOnTurn === "number" && Number.isFinite(expiresOnTurn)) {
    return expiresOnTurn;
  }
  const durationTurns = Reflect.get(markerConfig, "durationTurns");
  if (typeof durationTurns === "number" && Number.isFinite(durationTurns)) {
    return currentTurn + Math.max(0, durationTurns);
  }
  if (markerConfig.duration === "end_of_next_turn") {
    return currentTurn + 1;
  }
  return currentTurn;
}

function markSimAddedCards(
  cards: readonly SimulatedCardState[],
  action: ActionOf<"add_from_zone_to_hand">,
  state: SimulatedRuntimeState,
  targetPlayer: SimulatedPlayerState,
  options: SimulatedActionOptions,
): void {
  const markerConfig = action?.markAddedCards;
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
      (typeof Reflect.get(action, "sourceEffectId") === "string"
        ? Reflect.get(action, "sourceEffectId")
        : null),
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
  const excludeTargetRefs = [
    action.excludeTargetRef,
    ...(Array.isArray(action.excludeTargetRefs)
      ? action.excludeTargetRefs
      : []),
  ].filter(Boolean);
  const excludedInstanceIds = excludeTargetRefs
    .flatMap((ref) =>
      Array.isArray(selections[ref])
        ? selections[ref]
        : selections[ref]
          ? [selections[ref]]
          : [],
    )
    .filter(isObject)
    .map(getCardInstanceId)
    .filter((value) => value !== undefined && value !== null);
  const candidates = getActionCandidates(targetPlayer, action, "graveyard").filter(
    (card) => {
      const instanceId = getCardInstanceId(card);
      return instanceId === null || !excludedInstanceIds.includes(instanceId);
    },
  );
  const pickCount = pickCountForAction(action, 1);
  const chosen = chooseRankedCards(
    candidates,
    "benefit",
    action,
    state,
    targetPlayer,
    options,
  ).slice(0, Math.min(pickCount, candidates.length));
  if (chosen.length === 0) return;
  chosen.forEach((card) => {
    removeCardFromZones(targetPlayer, card);
    targetPlayer.hand.push(card);
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
  const candidates = getActionCandidates(targetPlayer, action, "hand");
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

  chosen.forEach((card) => {
    removeCardFromZones(targetPlayer, card);
    targetPlayer.graveyard.push(card);
  });
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
    .map((card) => Reflect.get(card, action.property))
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter(
      (value): value is string | number | boolean =>
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean",
    );
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
  const nestedPreferences = Reflect.ownKeys(targetPreferences).flatMap((key) => {
    const preference = Reflect.get(targetPreferences, key);
    return isObject(preference) ? [preference] : [];
  });
  const namedPreferences = [directPreference, ...nestedPreferences].filter(
    isObject,
  );
  const preferredValues = namedPreferences.flatMap((preference) => {
    const preferredNames = Reflect.get(preference, "preferredNames");
    const forceNames = Reflect.get(preference, "forceNames");
    return [
      ...(Array.isArray(preferredNames) ? preferredNames : []),
      ...(Array.isArray(forceNames) ? forceNames : []),
    ].filter(
      (value): value is string | number | boolean =>
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean",
    );
  });
  const preferredVisibleValue = visibleValues.find((visibleValue) =>
    preferredValues.includes(visibleValue),
  );
  const declaredValue =
    action.value ||
    preferredVisibleValue ||
    visibleValues[0] ||
    (Array.isArray(action.choices) ? action.choices[0] : null) ||
    "Pyro";
  const value: Exclude<CardDeclaredValue, object> =
    typeof declaredValue === "string" ||
    typeof declaredValue === "number" ||
    typeof declaredValue === "boolean"
      ? declaredValue
      : "Pyro";

  if (!sourceCard.declaredValues) sourceCard.declaredValues = {};
  const currentTurn = Number(state?.turnCounter || 0);
  const expiresOnTurn =
    action.duration === "while_faceup" || action.duration === "permanent"
      ? null
      : action.duration === "end_of_next_turn"
        ? currentTurn + 1
        : currentTurn;
  sourceCard.declaredValues[action.stateKey] = {
    property: action.property,
    value,
    declaredOnTurn: currentTurn,
    ...(expiresOnTurn === null ? {} : { expiresOnTurn }),
    ...(action.duration ? { duration: action.duration } : {}),
  };
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
  const filters: CardFilter = {
    ...(action.filters || {}),
    archetype: action.filters?.archetype || action.archetype,
    cardKind: action.filters?.cardKind || action.cardKind,
  };

  if (Object.keys(filters).length > 0) {
    targetPlayer.additionalNormalSummonPermissions =
      targetPlayer.additionalNormalSummonPermissions || [];
    targetPlayer.additionalNormalSummonPermissions.push({
      count,
      filters,
      sourceCardName: ctx.source?.name || options.sourceCard?.name || null,
      effectId: options.effect?.id || null,
    });
  } else {
    targetPlayer.additionalNormalSummons =
      (targetPlayer.additionalNormalSummons || 0) + count;
  }
  return;
}
