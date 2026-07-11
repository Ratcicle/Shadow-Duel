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

function readSimContextNumber(spec, options = {}) {
  if (typeof spec === "number") return spec;
  if (!spec) return 0;

  const config = typeof spec === "string" ? { key: spec } : spec;
  const key = config.key;
  const source = options.actionContext || {};
  const raw = key ? source[key] : config.defaultValue;
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

export function applyDraw(ctx) {
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
  const drawnCards = [];
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

export function applyHeal(ctx) {
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

export function applyHealPerArchetypeMonster(ctx) {
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

export function applyDamage(ctx) {
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

export function applyPayLp(ctx) {
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
    : Number.isFinite(action.amount)
      ? action.amount
      : Number.isFinite(action.lp)
        ? action.lp
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
    action.allowSelfKO !== true
  ) {
    return STOP_SIMULATION;
  }
  targetPlayer.lp = Math.max(0, (targetPlayer.lp || 0) - finalAmount);
  cost.appliedReducers.forEach((reducer) => {
    markSimulatedPassiveUsed(state, reducer.board, reducer.card, reducer.effect);
  });
  return;
}

function normalizeSimNameList(values = []) {
  const result = [];
  const seen = new Set();
  const entries = Array.isArray(values) ? values : [values];
  for (const entry of entries) {
    const name =
      typeof entry === "string" ? entry.trim() : entry?.name?.trim?.() || "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

function readSimNameSource(action, options) {
  const sourceKey = action.nameSource || action.namesSource || null;
  if (!sourceKey) return [];
  if (sourceKey === "lastDrawnCards") return options.lastDrawnCards || [];
  if (sourceKey === "lastDrawnCard") return options.lastDrawnCard || null;
  if (sourceKey === "lastAddedToHandCards") {
    return options.lastAddedToHandCards || [];
  }
  if (sourceKey === "lastAddedToHandCard") return options.lastAddedToHandCard || null;
  return options[sourceKey] || options.actionContext?.[sourceKey] || [];
}

function normalizeSimAttributeList(values = []) {
  const result = [];
  const seen = new Set();
  const entries = Array.isArray(values) ? values : [values];
  for (const entry of entries) {
    const attribute =
      typeof entry === "string" ? entry.trim() : entry?.attribute?.trim?.() || "";
    if (!attribute) continue;
    const key = attribute.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(attribute);
  }
  return result;
}

function flattenSimCards(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenSimCards);
  return [value];
}

function readSimAttributeSource(action, selections, options) {
  const sourceKey =
    action.attributeSourceRef ||
    action.attributeSource ||
    action.sourceRef ||
    action.targetRef ||
    null;
  if (!sourceKey) return [];
  return [
    selections?.[sourceKey],
    options?.[sourceKey],
    options?.actionResults?.[sourceKey],
    options?.actionContext?.[sourceKey],
    options?.activationContext?.actionResults?.[sourceKey],
  ].flatMap(flattenSimCards).filter(Boolean);
}

export function applyRestrictEffectActivationsByNames(ctx) {
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
    duration: action.duration || "until_end_turn",
    reason: action.reason || null,
    sourceName: options?.sourceCard?.name || null,
    sourceId: options?.sourceCard?.id || null,
  });
}

export function applyRestrictEffectActivationsByAttribute(ctx) {
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
    allowedAttributes,
    restrictedCardFilters: action.restrictedCardFilters || { cardKind: "monster" },
    duration: action.duration || "until_end_turn",
    reason: action.reason || null,
    sourceName: options?.sourceCard?.name || null,
    sourceId: options?.sourceCard?.id || null,
  });
}

export function applySearchAny(ctx) {
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

function resolveSimMarkerExpirationTurn(state, markerConfig = {}) {
  const currentTurn = Number(state?.turnCounter || 0);
  if (Number.isFinite(markerConfig.expiresOnTurn)) {
    return markerConfig.expiresOnTurn;
  }
  if (Number.isFinite(markerConfig.durationTurns)) {
    return currentTurn + Math.max(0, markerConfig.durationTurns);
  }
  if (markerConfig.duration === "end_of_next_turn") {
    return currentTurn + 1;
  }
  return currentTurn;
}

function markSimAddedCards(cards, action, state, targetPlayer, options = {}) {
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
      markerConfig.sourceEffectId || options.effect?.id || action.sourceEffectId || null,
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

export function applyAddFromZoneToHand(ctx) {
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
      Array.isArray(targets?.[ref])
        ? targets[ref]
        : targets?.[ref]
          ? [targets[ref]]
          : [],
    )
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

export function applyDiscardFromHand(ctx) {
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

export function applyDeclareCardProperty(ctx) {
  const { action, state, options, self, opponent } = ctx;
  const sourceCard = options.sourceCard || null;
  if (!sourceCard || !action?.property || !action?.stateKey) return;

  const visibleValues = [
    ...(self?.field || []),
    ...(opponent?.field || []),
  ]
    .map((card) => card?.[action.property])
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter(Boolean);
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
  ].filter(Boolean);
  const preferredValues = namedPreferences.flatMap((preference) => [
    ...(Array.isArray(preference.preferredNames) ? preference.preferredNames : []),
    ...(Array.isArray(preference.forceNames) ? preference.forceNames : []),
  ]);
  const preferredVisibleValue = visibleValues.find((visibleValue) =>
    preferredValues.includes(visibleValue),
  );
  const value =
    action.value ||
    preferredVisibleValue ||
    visibleValues[0] ||
    (Array.isArray(action.choices) ? action.choices[0] : null) ||
    "Pyro";

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
    expiresOnTurn,
    duration: action.duration || null,
  };
  return;
}

export function applyGrantAdditionalNormalSummon(ctx) {
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
  const filters = { ...(action.filters || {}) };
  if (action.archetype && !filters.archetype) filters.archetype = action.archetype;
  if (action.cardKind && !filters.cardKind) filters.cardKind = action.cardKind;

  if (Object.keys(filters).length > 0) {
    targetPlayer.additionalNormalSummonPermissions =
      targetPlayer.additionalNormalSummonPermissions || [];
    targetPlayer.additionalNormalSummonPermissions.push({
      count,
      filters,
      sourceCardName: ctx?.source?.name || null,
      effectId: ctx?.effect?.id || null,
    });
  } else {
    targetPlayer.additionalNormalSummons =
      (targetPlayer.additionalNormalSummons || 0) + count;
  }
  return;
}
