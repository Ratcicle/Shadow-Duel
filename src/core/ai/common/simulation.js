import {
  applySimulatedActions,
  evaluateSimulatedConditions,
  moveCardToZone,
  selectSimulatedTargets,
} from "../StrategyUtils.js";
import {
  findCardOwner,
  findCardZone,
  getZoneCards,
} from "./zones.js";
import {
  getCardInstanceId,
  matchesTargetFilters,
} from "./targetSelection.js";
import { updateSimulatedSentToGraveMaterialMarker } from "./simulatedActions/shared.js";
import {
  fieldHasTributeValue,
  getTributeCardsFromIndices,
  getTributeValueTotal,
} from "../../game/summon/tributeValue.js";
import {
  canUseNormalSummonForCard,
  recordNormalSummonForTurn,
} from "../../Player.js";

function canSimulatedSpecialSummon(card, player) {
  if (!card || !player) return false;
  const restrictions = Array.isArray(player.specialSummonRestrictions)
    ? player.specialSummonRestrictions
    : [];
  return restrictions.every((restriction) => {
    const filters = restriction?.allowedFilters;
    return !filters || matchesTargetFilters(card, filters, null, "self");
  });
}

export function resolveSimulatedHandIndex(player, action, expectedKind = null) {
  const hand = player?.hand || [];
  const matches = (card) => {
    if (!card) return false;
    if (expectedKind) {
      const kinds = Array.isArray(expectedKind) ? expectedKind : [expectedKind];
      if (!kinds.includes(card.cardKind)) return false;
    }
    if (typeof action.cardId === "number" && card.id === action.cardId) {
      return true;
    }
    if (action.cardName && card.name === action.cardName) return true;
    return false;
  };

  if (Number.isInteger(action.index) && matches(hand[action.index])) {
    return action.index;
  }
  return hand.findIndex(matches);
}

export function resolveSimulatedFieldIndex(player, action, predicate = null) {
  const field = player?.field || [];
  const matches = (card) => {
    if (!card) return false;
    if (typeof predicate === "function" && !predicate(card)) return false;
    if (typeof action.cardId === "number" && card.id === action.cardId) {
      return true;
    }
    if (action.cardName && card.name === action.cardName) return true;
    return !action.cardId && !action.cardName;
  };

  if (Number.isInteger(action.fieldIndex) && matches(field[action.fieldIndex])) {
    return action.fieldIndex;
  }
  if (
    Number.isInteger(action.materialIndex) &&
    matches(field[action.materialIndex])
  ) {
    return action.materialIndex;
  }
  return field.findIndex(matches);
}

function findSimulatedExtraDeckCard(player, action) {
  const extraDeck = player?.extraDeck || [];
  if (Number.isInteger(action.extraDeckIndex)) {
    const direct = extraDeck[action.extraDeckIndex];
    if (
      direct &&
      (direct.id === action.cardId ||
        direct.name === action.cardName ||
        direct.name === action.extraDeckCard?.name)
    ) {
      return { card: direct, index: action.extraDeckIndex };
    }
  }
  const index = extraDeck.findIndex(
    (card) =>
      card &&
      (card.id === action.cardId ||
        card.name === action.cardName ||
        card.name === action.extraDeckCard?.name),
  );
  return {
    card: index >= 0 ? extraDeck[index] : action.extraDeckCard || null,
    index,
  };
}

function findSimulatedMaterialByHint(field = [], hint = {}) {
  const ids = Array.isArray(hint.instanceIds) ? hint.instanceIds : [];
  if (ids.length > 0) {
    const byInstance = field.find((card) => {
      const cardIds = [
        getCardInstanceId(card),
        card?.fieldPresenceId,
      ].filter((id) => id !== null && id !== undefined);
      return cardIds.some((id) => ids.includes(id));
    });
    if (byInstance) return byInstance;
  }
  if (Number.isInteger(hint.index)) {
    const direct = field[hint.index];
    if (
      direct &&
      (hint.id === undefined || direct.id === hint.id) &&
      (!hint.name || direct.name === hint.name)
    ) {
      return direct;
    }
  }
  return field.find(
    (card) =>
      card &&
      (hint.id === undefined || card.id === hint.id) &&
      (!hint.name || card.name === hint.name),
  );
}

function resolveSimulatedExtraDeckMaterials(player, action) {
  const field = player?.field || [];
  const hints = Array.isArray(action.materials)
    ? action.materials
    : (action.materialIndices || []).map((index, offset) => ({
        index,
        id: action.materialIds?.[offset],
        name: action.materialNames?.[offset],
        instanceIds: action.materialInstanceIds?.[offset],
      }));
  const materials = [];
  for (const hint of hints) {
    const material = findSimulatedMaterialByHint(field, hint);
    if (!material || materials.includes(material)) return [];
    materials.push(material);
  }
  return materials;
}

function buildSelectionOptions(options = {}) {
  const actionContext =
    options.actionContext ||
    options.activationContext?.actionContext ||
    {};
  return {
    ...options,
    archetype: options.archetype,
    preferDefense: options.preferDefense,
    actionContext,
    activationContext: options.activationContext,
    targetPreferences:
      options.targetPreferences || actionContext.targetPreferences || {},
    specialSummonPositions:
      options.specialSummonPositions || actionContext.specialSummonPositions || {},
  };
}

function getSimOncePerTurnKey(effect, sourceCard) {
  if (!effect) return null;
  return (
    effect.oncePerTurnName ||
    (sourceCard?.name && effect.id ? `${sourceCard.name}:${effect.id}` : null) ||
    effect.id ||
    null
  );
}

function getSimOptBucket(state, selfId = "bot") {
  if (!state) return null;
  if (!state._simOncePerTurn) state._simOncePerTurn = {};
  const key = selfId || "bot";
  if (state._simOncePerTurn[key] instanceof Set) {
    const migrated = new Map();
    for (const entryKey of state._simOncePerTurn[key]) {
      migrated.set(entryKey, 1);
    }
    state._simOncePerTurn[key] = migrated;
  }
  if (Array.isArray(state._simOncePerTurn[key])) {
    state._simOncePerTurn[key] = new Map(
      state._simOncePerTurn[key].map((entry) =>
        Array.isArray(entry) ? [entry[0], Number(entry[1] || 1)] : [entry, 1],
      ),
    );
  }
  if (
    state._simOncePerTurn[key] &&
    typeof state._simOncePerTurn[key] === "object" &&
    !(state._simOncePerTurn[key] instanceof Map)
  ) {
    state._simOncePerTurn[key] = new Map(Object.entries(state._simOncePerTurn[key]));
  }
  if (!state._simOncePerTurn[key]) state._simOncePerTurn[key] = new Map();
  return state._simOncePerTurn[key];
}

function getSimPlayerById(state, playerId = "bot") {
  if (!state) return null;
  if (playerId === "player") return state.player;
  if (playerId === "bot") return state.bot;
  if (state.player?.id === playerId) return state.player;
  if (state.bot?.id === playerId) return state.bot;
  return state[playerId] || null;
}

function simEffectCanBeBlocked(effect) {
  if (!effect || effect.placementOnly === true) return false;
  if (effect.timing === "passive") return false;
  return true;
}

function normalizeSimRestrictionNames(names = []) {
  const values = Array.isArray(names) ? names : [names];
  return values
    .map((entry) =>
      typeof entry === "string" ? entry.trim() : entry?.name?.trim?.() || "",
    )
    .filter(Boolean);
}

function normalizeSimRestrictionAttributes(attributes = []) {
  const values = Array.isArray(attributes) ? attributes : [attributes];
  const result = [];
  const seen = new Set();
  for (const entry of values) {
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

function simAttributeMatches(value, allowedAttributes = []) {
  const actual = String(value || "").toLowerCase();
  return allowedAttributes.some(
    (attribute) => String(attribute || "").toLowerCase() === actual,
  );
}

function isSimulatedEffectActivationRestricted(
  state,
  effect,
  sourceCard,
  selfId = "bot",
) {
  if (!sourceCard || !simEffectCanBeBlocked(effect)) return false;
  const player = getSimPlayerById(state, selfId);
  const restrictions = Array.isArray(player?.effectActivationRestrictions)
    ? player.effectActivationRestrictions
    : [];
  return restrictions.some((restriction) => {
    const blockedNames = normalizeSimRestrictionNames(
      restriction?.blockedNames || restriction?.names || [],
    );
    if (sourceCard.name && blockedNames.includes(sourceCard.name)) return true;

    const allowedAttributes = normalizeSimRestrictionAttributes(
      restriction?.allowedAttributes || restriction?.attributes || [],
    );
    if (allowedAttributes.length === 0) return false;
    const restrictedCardFilters =
      restriction?.restrictedCardFilters &&
      typeof restriction.restrictedCardFilters === "object"
        ? restriction.restrictedCardFilters
        : { cardKind: "monster" };
    if (!matchesTargetFilters(sourceCard, restrictedCardFilters, null, "self")) {
      return false;
    }
    return !simAttributeMatches(sourceCard.attribute, allowedAttributes);
  });
}

function canUseSimulatedEffect(state, effect, sourceCard, selfId = "bot") {
  if (isSimulatedEffectActivationRestricted(state, effect, sourceCard, selfId)) {
    return false;
  }
  if (!effect?.oncePerTurn && !effect?.oncePerTurnName) return true;
  const key = getSimOncePerTurnKey(effect, sourceCard);
  if (!key) return true;
  const bucket = getSimOptBucket(state, selfId);
  const limit = Math.max(
    1,
    Math.floor(
      Number(
        effect.oncePerTurnLimit ??
          effect.usesPerTurn ??
          effect.maxUsesPerTurn ??
          1,
      ),
    ) || 1,
  );
  if (bucket instanceof Map) {
    return Number(bucket.get(key) || 0) < limit;
  }
  return !bucket?.has(key);
}

function markSimulatedEffectUsed(state, effect, sourceCard, selfId = "bot") {
  if (!effect?.oncePerTurn && !effect?.oncePerTurnName) return;
  const key = getSimOncePerTurnKey(effect, sourceCard);
  if (!key) return;
  const bucket = getSimOptBucket(state, selfId);
  const limit = Math.max(
    1,
    Math.floor(
      Number(
        effect.oncePerTurnLimit ??
          effect.usesPerTurn ??
          effect.maxUsesPerTurn ??
          1,
      ),
    ) || 1,
  );
  if (bucket instanceof Map) {
    bucket.set(key, Math.min(limit, Number(bucket.get(key) || 0) + 1));
  } else {
    bucket?.add(key);
  }
}

function effectConditionsPass(state, effect, sourceCard, options = {}) {
  if (!effect?.conditions) return true;
  return evaluateSimulatedConditions(effect.conditions, {
    state,
    selfId: options.selfId || "bot",
    options,
    sourceCard,
  });
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function matchesZoneFilter(zone, filter) {
  if (!filter || filter === "any") return true;
  return asArray(filter).includes(zone);
}

function getOtherSimPlayer(state, player) {
  if (!state || !player) return null;
  if (player === state.bot) return state.player || null;
  if (player === state.player) return state.bot || null;
  if (player.id === state.bot?.id) return state.player || null;
  if (player.id === state.player?.id) return state.bot || null;
  return null;
}

function sourceKey(card) {
  return getCardInstanceId(card) ?? card?.fieldPresenceId ?? card;
}

function addSimEventSource(entries, seen, player, card, zone) {
  if (!player || !card) return;
  const key = sourceKey(card);
  if (seen.has(key)) return;
  seen.add(key);
  entries.push({
    player,
    opponent: getOtherSimPlayer({ bot: entries._bot, player: entries._player }, player),
    card,
    zone: zone || findCardZone(player, card) || "field",
  });
}

function addPlayerZoneSources(entries, seen, state, player, zones = []) {
  if (!player) return;
  for (const zone of zones) {
    for (const card of getZoneCards(player, zone)) {
      addSimEventSource(entries, seen, player, card, zone);
    }
  }
}

function collectSimulatedEventSources(state, eventName, payload = {}) {
  const entries = [];
  entries._bot = state?.bot || null;
  entries._player = state?.player || null;
  const seen = new Set();
  const players = [state?.bot, state?.player].filter(Boolean);
  const eventCard = payload.card || payload.eventCard || null;
  const eventOwner =
    payload.player ||
    payload.toPlayer ||
    findCardOwner(state, eventCard) ||
    null;

  if (eventName === "card_moved") {
    if (eventCard && eventOwner) {
      addSimEventSource(
        entries,
        seen,
        eventOwner,
        eventCard,
        payload.toZone || findCardZone(eventOwner, eventCard) || "hand",
      );
    }
    for (const player of players) {
      addPlayerZoneSources(entries, seen, state, player, [
        "field",
        "fieldSpell",
        "spellTrap",
        "hand",
      ]);
    }
  } else if (eventName === "after_summon") {
    if (eventCard && eventOwner) {
      addSimEventSource(
        entries,
        seen,
        eventOwner,
        eventCard,
        findCardZone(eventOwner, eventCard) || "field",
      );
    }
    for (const player of players) {
      addPlayerZoneSources(entries, seen, state, player, [
        "field",
        "fieldSpell",
        "spellTrap",
        "hand",
      ]);
    }
  } else if (eventName === "position_change") {
    for (const player of players) {
      addPlayerZoneSources(entries, seen, state, player, [
        "field",
        "fieldSpell",
        "spellTrap",
      ]);
    }
  }

  delete entries._bot;
  delete entries._player;
  entries.forEach((entry) => {
    entry.opponent = getOtherSimPlayer(state, entry.player);
  });
  return entries;
}

function ownerRoleFor(sourcePlayer, eventPlayer) {
  if (!sourcePlayer || !eventPlayer) return null;
  return sourcePlayer === eventPlayer || sourcePlayer.id === eventPlayer.id
    ? "self"
    : "opponent";
}

function simEffectForEventCard(effect, payload = {}) {
  if (!effect?.oncePerTurnPerEventCard) return effect;
  const eventCard = payload.card || payload.eventCard || payload.changedCard || null;
  const eventCardKey =
    getCardInstanceId(eventCard) ||
    eventCard?.fieldPresenceId ||
    eventCard?.id ||
    eventCard?.name ||
    "event_card";
  const baseName = effect.oncePerTurnName || effect.id || "sim_event";
  return {
    ...effect,
    oncePerTurn: true,
    oncePerTurnName: `${baseName}:event_card:${eventCardKey}`,
  };
}

function matchesSimulatedEventEffect(
  state,
  eventName,
  payload = {},
  sourceEntry,
  effect,
  options = {},
) {
  const sourceCard = sourceEntry.card;
  const sourceZone = sourceEntry.zone;
  const eventCard = payload.card || payload.eventCard || payload.changedCard || null;
  const eventPlayer = payload.player || payload.toPlayer || findCardOwner(state, eventCard);
  const eventRole = ownerRoleFor(sourceEntry.player, eventPlayer);

  if (!effect || effect.timing !== "on_event" || effect.event !== eventName) {
    return false;
  }
  if (
    ["field", "fieldSpell", "spellTrap"].includes(sourceZone) &&
    sourceCard.isFacedown === true
  ) {
    return false;
  }
  if (effect.requireFaceup === true && sourceCard.isFacedown === true) {
    return false;
  }
  if (effect.requireZone && !matchesZoneFilter(sourceZone, effect.requireZone)) {
    return false;
  }
  if (effect.requirePhase) {
    const phases = asArray(effect.requirePhase);
    if (!phases.includes(state?.phase || "main1")) return false;
  }

  if (eventName === "card_moved") {
    if (effect.requireSelfAsMoved === true && sourceCard !== eventCard) return false;
    if (effect.fromZone && !matchesZoneFilter(payload.fromZone, effect.fromZone)) {
      return false;
    }
    if (effect.toZone && !matchesZoneFilter(payload.toZone, effect.toZone)) {
      return false;
    }
    const requiresEffectMove =
      effect.movedByEffect === true || effect.requireMovedByEffect === true;
    if (requiresEffectMove && payload.movedByEffect !== true) return false;
    if (
      effect.requireMovedCardWasFaceup === true &&
      payload.wasFaceupBeforeMove !== true
    ) {
      return false;
    }
    if (
      effect.requireFaceupAtFieldExit === true &&
      (payload.fromZone !== "field" || payload.wasFaceupBeforeMove !== true)
    ) {
      return false;
    }
  }

  if (eventName === "after_summon") {
    if (effect.requireSelfAsSummoned === true && sourceCard !== eventCard) {
      return false;
    }
    if (effect.requireOpponentSummon === true && eventRole !== "opponent") {
      return false;
    }
    const summonMethods = effect.summonMethods ?? effect.summonMethod;
    if (summonMethods && !asArray(summonMethods).includes(payload.method)) {
      return false;
    }
    const summonFrom = effect.summonFrom ?? effect.requireSummonedFrom;
    if (summonFrom && payload.fromZone && !matchesZoneFilter(payload.fromZone, summonFrom)) {
      return false;
    }
  }

  if (eventName === "position_change") {
    const changedOwner = payload.player || findCardOwner(state, eventCard);
    const changedRole = ownerRoleFor(sourceEntry.player, changedOwner);
    const changedCardOwner = effect.changedCardOwner || effect.eventCardOwner || null;
    if (changedCardOwner && changedRole !== changedCardOwner) return false;
    if (effect.changedCardRequireFaceup === true && eventCard?.isFacedown === true) {
      return false;
    }
    if (
      effect.changedCardRequireFaceupBeforeChange === true &&
      payload.wasFaceupBeforeChange !== true
    ) {
      return false;
    }
    if (
      effect.positionChangeSourceFilters &&
      !matchesTargetFilters(
        payload.sourceCard || options.sourceCard,
        effect.positionChangeSourceFilters,
        sourceCard,
      )
    ) {
      return false;
    }
  }

  if (
    effect.eventCardFilters &&
    !matchesTargetFilters(eventCard, effect.eventCardFilters, sourceCard, eventRole)
  ) {
    return false;
  }

  return effectConditionsPass(state, effect, sourceCard, {
    ...options,
    eventCard,
    movedCard: eventName === "card_moved" ? eventCard : null,
    changedCard: eventName === "position_change" ? eventCard : null,
    summonedCard: eventName === "after_summon" ? eventCard : null,
  });
}

function hasRequiredSimSelections(targets = [], selections = {}) {
  return (targets || []).every((target) => {
    if (!target?.id) return true;
    const min = Number(target.count?.min ?? target.count ?? 1);
    if (min <= 0) return true;
    return (selections[target.id] || []).length >= min;
  });
}

function buildSimEventActionContext(eventName, payload = {}, base = {}) {
  const eventCard = payload.card || payload.eventCard || payload.changedCard || null;
  return {
    ...(base || {}),
    simEventName: eventName,
    eventCard,
    movedCard: eventName === "card_moved" ? eventCard : null,
    changedCard: eventName === "position_change" ? eventCard : null,
    summonedCard: eventName === "after_summon" ? eventCard : null,
    eventPlayer: payload.player || payload.toPlayer || null,
    fromZone: payload.fromZone || null,
    toZone: payload.toZone || null,
    summonMethod: payload.method || null,
    summonFromZone: eventName === "after_summon" ? payload.fromZone || null : null,
    wasFaceupBeforeMove: payload.wasFaceupBeforeMove === true,
    wasFaceupBeforeChange: payload.wasFaceupBeforeChange === true,
    movementSourceCard: payload.sourceCard || null,
    positionChangeSourceCard: payload.sourceCard || null,
  };
}

function attachSimulatedEventEmitter(state, options = {}) {
  if (options.enableSimulatedEvents !== true) return options;
  if (
    typeof options.emitSimulatedEvent === "function" &&
    options._managedSimulatedEventEmitter !== true
  ) {
    return options;
  }
  options._managedSimulatedEventEmitter = true;
  options.emitSimulatedEvent = (eventName, payload = {}, extra = {}) =>
    dispatchSimulatedEvent(state, eventName, payload, {
      ...options,
      ...extra,
      _simEventDepth: Number(options._simEventDepth || 0),
    });
  return options;
}

function dispatchSimulatedEvent(state, eventName, payload = {}, options = {}) {
  if (options.enableSimulatedEvents !== true) return;
  const depth = Number(options._simEventDepth || 0);
  const maxDepth = Number.isFinite(options.maxSimulatedEventDepth)
    ? options.maxSimulatedEventDepth
    : 8;
  if (depth >= maxDepth) return;

  const sourceEntries = collectSimulatedEventSources(state, eventName, payload);
  for (const sourceEntry of sourceEntries) {
    const sourceCard = sourceEntry.card;
    for (const rawEffect of sourceCard?.effects || []) {
      const effect = simEffectForEventCard(rawEffect, payload);
      if (
        !matchesSimulatedEventEffect(
          state,
          eventName,
          payload,
          sourceEntry,
          effect,
          options,
        )
      ) {
        continue;
      }
      if (!canUseSimulatedEffect(state, effect, sourceCard, sourceEntry.player?.id || "bot")) {
        continue;
      }

      const strategyContext =
        typeof options.strategy?.buildActivationContextForEffect === "function"
          ? options.strategy.buildActivationContextForEffect({
              sourceCard,
              effect,
              player: sourceEntry.player,
              game: state,
              activationZone: sourceEntry.zone,
            }) || {}
          : {};
      const actionContext = buildSimEventActionContext(eventName, payload, {
        ...(options.actionContext || {}),
        ...(strategyContext.actionContext || {}),
      });
      const activationContext = {
        ...(strategyContext || {}),
        ...(options.activationContext || {}),
        actionContext,
      };
      const triggerOptions = attachSimulatedEventEmitter(state, {
        ...options,
        sourceCard,
        effect,
        activationContext,
        actionContext,
        _simEventDepth: depth + 1,
      });
      const selections = selectSimulatedTargets({
        targets: effect.targets || [],
        actions: effect.actions || [],
        state,
        sourceCard,
        selfId: options.selfId || "bot",
        options: triggerOptions,
      });
      if (!hasRequiredSimSelections(effect.targets || [], selections)) {
        continue;
      }
      markSimulatedEffectUsed(state, effect, sourceCard, sourceEntry.player?.id || "bot");
      applySimulatedActions({
        actions: effect.actions || [],
        selections,
        state,
        selfId: options.selfId || "bot",
        options: triggerOptions,
      });
      options.onEffectActivated?.({
        state,
        action: null,
        player: sourceEntry.player,
        card: sourceCard,
        effect,
        zone: sourceEntry.zone,
        options: triggerOptions,
      });
    }
  }
}

function resolveEffectForAction(card, action, allowedTimings = []) {
  const effects = Array.isArray(card?.effects) ? card.effects : [];
  const effectId = action?.effectId || action?.effect?.id || null;
  if (effectId) {
    const exact = effects.find((entry) => entry?.id === effectId);
    if (exact) return exact;
  }
  return effects.find(
    (entry) =>
      entry &&
      (allowedTimings.length === 0 || allowedTimings.includes(entry.timing)),
  );
}

export function simulateGenericSpellEffect(state, card, options = {}) {
  if (!card || !Array.isArray(card.effects)) return;
  const effect = card.effects.find(
    (entry) => entry && entry.timing === "on_play",
  );
  if (!effect) return;
  if (!effectConditionsPass(state, effect, card, options)) return;
  if (!canUseSimulatedEffect(state, effect, card, options.selfId || "bot")) {
    return;
  }

  const selectionOptions = buildSelectionOptions(options);
  attachSimulatedEventEmitter(state, selectionOptions);
  const selections = selectSimulatedTargets({
    targets: effect.targets || [],
    actions: effect.actions || [],
    state,
    sourceCard: card,
    selfId: options.selfId || "bot",
    options: selectionOptions,
  });
  applySimulatedActions({
    actions: effect.actions || [],
    selections,
    state,
    selfId: options.selfId || "bot",
    options: { ...selectionOptions, sourceCard: card },
  });
  markSimulatedEffectUsed(state, effect, card, options.selfId || "bot");
}

function resolvesToGraveyardAfterActivation(card) {
  if (!card || card.cardKind !== "spell") return false;
  return (
    card.subtype === "normal" ||
    card.subtype === "quick" ||
    card.subtype === "quick-play" ||
    card.subtype === "quickplay"
  );
}

function setSimulatedSpellTrapAfterResolution(player, card, state) {
  if (!player || !card) return false;
  player.spellTrap = player.spellTrap || [];
  if (player.spellTrap.length >= 5 && !player.spellTrap.includes(card)) {
    return false;
  }
  card.isFacedown = true;
  if (typeof state.turnCounter === "number") {
    card.turnSetOn = state.turnCounter;
    card.setTurn = state.turnCounter;
  }
  delete card.__simSetAfterResolution;
  if (!player.spellTrap.includes(card)) {
    player.spellTrap.push(card);
  }
  return true;
}

function runActionOverride(state, action, options) {
  const override = options.actionOverrides?.[action.type];
  if (typeof override !== "function") return false;
  const result = override({
    state,
    action,
    options,
    resolveSimulatedHandIndex,
    resolveSimulatedFieldIndex,
  });
  return result === true || result?.handled === true;
}

export function applyGenericSimulatedMainPhaseAction(
  state,
  action,
  options = {},
) {
  if (!action) return state;

  if (!state._isPerspectiveState && state.player && state.bot) {
    console.error(
      `[${options.guardLabel || "Simulation"}] CRITICAL: Simulating on REAL game state!`,
      {
        action: action.type,
        card: action.cardName || state.bot?.hand?.[action.index]?.name,
      },
    );
  }

  if (runActionOverride(state, action, options)) {
    return state;
  }

  const selectionOptions = buildSelectionOptions({
    ...options,
    activationContext: action.activationContext || options.activationContext,
    sourceAction: action,
  });
  attachSimulatedEventEmitter(state, selectionOptions);

  switch (action.type) {
    case "summon": {
      const player = state.bot;
      const handIndex = resolveSimulatedHandIndex(player, action, "monster");
      const card = player.hand[handIndex];
      if (!card) break;
      if (card.cardKind !== "monster") break;
      if (card.cannotBeNormalSummonedOrSet) break;
      if (card.summonRestrict === "shadow_heart_invocation_only") break;
      if (!canUseNormalSummonForCard(player, card)) break;
      const tributeInfo = options.getTributeRequirementFor?.(card, player) || {
        tributesNeeded: 0,
      };
      const tributesNeeded = Math.max(0, Number(tributeInfo.tributesNeeded) || 0);
      if (!fieldHasTributeValue(player.field || [], tributesNeeded, card)) break;

      const tributeIndices =
        options.selectBestTributes?.(player.field, tributesNeeded, card, {
          botState: player,
          oppField: state.player?.field || [],
          game: state,
        }) || [];
      const validTributeIndices = [...new Set(tributeIndices)].filter(
        (idx) =>
          Number.isInteger(idx) &&
          idx >= 0 &&
          idx < (player.field || []).length,
      );
      const tributeCards = getTributeCardsFromIndices(
        player.field || [],
        validTributeIndices,
      );
      if (getTributeValueTotal(tributeCards, card) < tributesNeeded) break;
      if ((player.field || []).length - validTributeIndices.length + 1 > 5) break;

      validTributeIndices.sort((a, b) => b - a);
      validTributeIndices.forEach((idx) => {
        const tribute = player.field[idx];
        if (tribute) {
          moveCardToZone(player, tribute, "graveyard");
        }
      });

      player.hand.splice(handIndex, 1);
      const newCard = { ...card };
      const summonPosition = action.position === "defense" ? "defense" : "attack";
      newCard.position = summonPosition;
      newCard.isFacedown = action.facedown === true || summonPosition === "defense";
      newCard.hasAttacked = false;
      newCard.attacksUsedThisTurn = 0;
      newCard.lastSummonMethod = tributesNeeded > 0 ? "tribute" : "normal";
      newCard.lastSummonedFromZone = "hand";
      if (newCard.cardKind !== "monster") {
        console.error(
          `[${options.guardLabel || "Simulation"}] BLOCKED sim: ${newCard.cardKind} "${newCard.name}" tried to enter field!`,
        );
        player.graveyard.push(newCard);
      } else {
        player.field.push(newCard);
        options.onAfterSummon?.({ state, action, player, card, newCard, options });
        selectionOptions.emitSimulatedEvent?.("after_summon", {
          card: newCard,
          player,
          method: newCard.lastSummonMethod,
          fromZone: "hand",
          sourceCard: newCard,
          actionContext: selectionOptions.actionContext,
        });
      }
      player.summonCount = (player.summonCount || 0) + 1;
      recordNormalSummonForTurn(player, newCard);
      break;
    }

    case "position_change": {
      const player = state.bot;
      const target = (player.field || []).find(
        (card) =>
          card &&
          (card.id === action.cardId ||
            (!action.cardId && card.name === action.cardName)),
      );
      if (!target) break;
      if (target.positionChangedThisTurn) break;
      if (target.hasAttacked) break;
      if (target.isFacedown) {
        target.isFacedown = false;
        target.position = "attack";
        target.positionChangedThisTurn = true;
        target.cannotAttackThisTurn = false;
        break;
      }
      const newPosition =
        action.toPosition === "defense" ? "defense" : "attack";
      if (target.position === newPosition) break;
      target.position = newPosition;
      target.positionChangedThisTurn = true;
      target.cannotAttackThisTurn = newPosition === "defense";
      break;
    }

    case "monsterEffect": {
      const player = state.bot;
      const fieldIndex = Number.isInteger(action.fieldIndex)
        ? action.fieldIndex
        : player.field.findIndex(
            (card) =>
              card &&
              (card.id === action.cardId ||
                (!action.cardId && card.name === action.cardName)),
          );
      const card = player.field?.[fieldIndex];
      if (!card || card.cardKind !== "monster" || card.isFacedown) break;
      const effect = (card.effects || []).find(
        (entry) =>
          entry &&
          entry.timing === "ignition" &&
          (!entry.requireZone || entry.requireZone === "field"),
      );
      if (!effect) break;
      if (!effectConditionsPass(state, effect, card, selectionOptions)) break;
      if (!canUseSimulatedEffect(state, effect, card, options.selfId || "bot")) {
        break;
      }

      const handled = options.onMonsterEffect?.({
        state,
        action,
        player,
        card,
        fieldIndex,
        effect,
        options,
      });
      if (handled) break;

      const selections = selectSimulatedTargets({
        targets: effect.targets || [],
        actions: effect.actions || [],
        state,
        sourceCard: card,
        selfId: options.selfId || "bot",
        options: selectionOptions,
      });
      applySimulatedActions({
        actions: effect.actions || [],
        selections,
        state,
        selfId: options.selfId || "bot",
        options: { ...selectionOptions, sourceCard: card },
      });
      markSimulatedEffectUsed(state, effect, card, options.selfId || "bot");
      options.onEffectActivated?.({
        state,
        action,
        player,
        card,
        effect,
        zone: "field",
        options,
      });
      break;
    }

    case "handIgnition": {
      const player = state.bot;
      const handIndex = resolveSimulatedHandIndex(player, action, "monster");
      const card = player.hand?.[handIndex];
      if (!card || card.cardKind !== "monster") break;
      const effect = resolveEffectForAction(card, action, ["ignition"]);
      if (!effect || effect.requireZone !== "hand") break;
      if (!effectConditionsPass(state, effect, card, selectionOptions)) break;
      if (!canUseSimulatedEffect(state, effect, card, options.selfId || "bot")) {
        break;
      }
      const selections = selectSimulatedTargets({
        targets: effect.targets || [],
        actions: effect.actions || [],
        state,
        sourceCard: card,
        selfId: options.selfId || "bot",
        options: selectionOptions,
      });
      applySimulatedActions({
        actions: effect.actions || [],
        selections,
        state,
        selfId: options.selfId || "bot",
        options: { ...selectionOptions, sourceCard: card },
      });
      markSimulatedEffectUsed(state, effect, card, options.selfId || "bot");
      options.onEffectActivated?.({
        state,
        action,
        player,
        card,
        effect,
        zone: "hand",
        options,
      });
      break;
    }

    case "spell": {
      const player = state.bot;
      const handIndex = resolveSimulatedHandIndex(player, action, "spell");
      const card = player.hand[handIndex];
      if (!card) break;
      const onPlayEffect = resolveEffectForAction(card, action, ["on_play"]);
      if (
        onPlayEffect &&
        (!effectConditionsPass(state, onPlayEffect, card, selectionOptions) ||
          !canUseSimulatedEffect(
            state,
            onPlayEffect,
            card,
            options.selfId || "bot",
          ))
      ) {
        break;
      }
      player.hand.splice(handIndex, 1);
      const placedCard = { ...card };
      simulateGenericSpellEffect(state, placedCard, selectionOptions);
      if (placedCard.__simSetAfterResolution) {
        if (!setSimulatedSpellTrapAfterResolution(player, placedCard, state)) {
          delete placedCard.__simSetAfterResolution;
          player.graveyard.push(placedCard);
        }
        break;
      }
      if (resolvesToGraveyardAfterActivation(placedCard)) {
        player.graveyard.push(placedCard);
        break;
      }
      const placement = options.placeSpellCard?.(state, placedCard) || {
        placed: false,
      };
      if (!placement.placed) {
        player.graveyard.push(placedCard);
      }
      break;
    }

    case "set_spell_trap": {
      const player = state.bot;
      const handIndex = resolveSimulatedHandIndex(player, action, [
        "spell",
        "trap",
      ]);
      const card = player.hand[handIndex];
      if (!card) break;
      if (card.cardKind === "spell" && card.subtype === "field") break;
      player.hand.splice(handIndex, 1);
      const setCard = { ...card, isFacedown: true };
      if (typeof state.turnCounter === "number") {
        setCard.turnSetOn = state.turnCounter;
      }
      player.spellTrap = player.spellTrap || [];
      if (player.spellTrap.length < 5) {
        player.spellTrap.push(setCard);
      } else {
        player.graveyard.push(setCard);
      }
      break;
    }

    case "spellTrapEffect": {
      const player = state.bot;
      const zoneIndex = Number.isInteger(action.zoneIndex)
        ? action.zoneIndex
        : action.index;
      const card = player.spellTrap?.[zoneIndex];
      if (!card) break;
      card.isFacedown = false;

      const effect = resolveEffectForAction(card, action, [
        "ignition",
        "on_play",
      ]);
      if (effect) {
        if (!effectConditionsPass(state, effect, card, selectionOptions)) break;
        if (!canUseSimulatedEffect(state, effect, card, options.selfId || "bot")) {
          break;
        }
        const selections = selectSimulatedTargets({
          targets: effect.targets || [],
          actions: effect.actions || [],
          state,
          sourceCard: card,
          selfId: options.selfId || "bot",
          options: selectionOptions,
        });
        applySimulatedActions({
          actions: effect.actions || [],
          selections,
          state,
          selfId: options.selfId || "bot",
          options: { ...selectionOptions, sourceCard: card },
        });
        markSimulatedEffectUsed(state, effect, card, options.selfId || "bot");
        options.onEffectActivated?.({
          state,
          action,
          player,
          card,
          effect,
          zone: "spellTrap",
          options,
        });
      }

      if (resolvesToGraveyardAfterActivation(card)) {
        if (card.__simSetAfterResolution) {
          setSimulatedSpellTrapAfterResolution(player, card, state);
          break;
        }
        player.graveyard.push(card);
        if (Array.isArray(player.spellTrap)) {
          player.spellTrap.splice(zoneIndex, 1);
        }
      }
      break;
    }

    case "fieldEffect": {
      const player = state.bot;
      const fieldSpell = player.fieldSpell;
      if (!fieldSpell) break;
      const effect =
        resolveEffectForAction(fieldSpell, action, ["on_field_activate"]) ||
        (fieldSpell.effects || []).find(
          (entry) =>
            entry &&
            entry.timing === "ignition" &&
            entry.requireZone === "fieldSpell",
        );
      if (!effect) break;
      if (!effectConditionsPass(state, effect, fieldSpell, selectionOptions)) {
        break;
      }
      if (!canUseSimulatedEffect(state, effect, fieldSpell, options.selfId || "bot")) {
        break;
      }
      const targetPreference =
        options.getFieldEffectTargetPreference?.({
          state,
          action,
          player,
          fieldSpell,
          effect,
          options,
        }) || null;
      const selections = selectSimulatedTargets({
        targets: effect.targets || [],
        actions: effect.actions || [],
        state,
        sourceCard: fieldSpell,
        selfId: options.selfId || "bot",
        options: {
          ...selectionOptions,
          preferDefense: !targetPreference,
          targetPreference,
          opponentField: state.player?.field || [],
          opponentLp: state.player?.lp || 0,
        },
      });
      applySimulatedActions({
        actions: effect.actions || [],
        selections,
        state,
        selfId: options.selfId || "bot",
        options: {
          ...selectionOptions,
          sourceCard: fieldSpell,
          targetPreference,
        },
      });
      markSimulatedEffectUsed(state, effect, fieldSpell, options.selfId || "bot");
      options.onEffectActivated?.({
        state,
        action,
        player,
        card: fieldSpell,
        effect,
        zone: "fieldSpell",
        options,
      });
      break;
    }

    case "graveyardMonsterEffect": {
      const player = state.bot;
      const graveyardIndex = Number.isInteger(action.graveyardIndex)
        ? action.graveyardIndex
        : player.graveyard?.findIndex(
            (card) =>
              card &&
              card.cardKind === "monster" &&
              (card.id === action.cardId ||
                (!action.cardId && card.name === action.cardName)),
          );
      const card = player.graveyard?.[graveyardIndex];
      if (!card || card.cardKind !== "monster") break;
      const effect = resolveEffectForAction(card, action, ["ignition"]);
      if (!effect || effect.requireZone !== "graveyard") break;
      if (!effectConditionsPass(state, effect, card, selectionOptions)) break;
      if (!canUseSimulatedEffect(state, effect, card, options.selfId || "bot")) {
        break;
      }
      const selections = selectSimulatedTargets({
        targets: effect.targets || [],
        actions: effect.actions || [],
        state,
        sourceCard: card,
        selfId: options.selfId || "bot",
        options: selectionOptions,
      });
      applySimulatedActions({
        actions: effect.actions || [],
        selections,
        state,
        selfId: options.selfId || "bot",
        options: { ...selectionOptions, sourceCard: card },
      });
      markSimulatedEffectUsed(state, effect, card, options.selfId || "bot");
      options.onEffectActivated?.({
        state,
        action,
        player,
        card,
        effect,
        zone: "graveyard",
        options,
      });
      break;
    }

    case "ascension": {
      const player = state.bot;
      const materialIndex = resolveSimulatedFieldIndex(
        player,
        { materialIndex: action.materialIndex },
        (card) => card.cardKind === "monster" && !card.isFacedown,
      );
      const material = player.field?.[materialIndex];
      if (!material) break;
      const extraIndex = (player.extraDeck || []).findIndex(
        (card) =>
          card &&
          (card.id === action.ascensionCard?.id ||
            card.name === action.cardName ||
            card.name === action.ascensionCard?.name),
      );
      const ascensionCard =
        extraIndex >= 0 ? player.extraDeck[extraIndex] : action.ascensionCard;
      if (!ascensionCard) break;
      if (!canSimulatedSpecialSummon(ascensionCard, player)) break;
      player.field.splice(materialIndex, 1);
      player.graveyard.push(material);
      if (extraIndex >= 0) player.extraDeck.splice(extraIndex, 1);
      const summoned = {
        ...ascensionCard,
        position:
          action.position || ascensionCard.ascension?.position || "attack",
        isFacedown: false,
        hasAttacked: false,
        attacksUsedThisTurn: 0,
      };
      player.field.push(summoned);
      selectionOptions.emitSimulatedEvent?.("after_summon", {
        card: summoned,
        player,
        method: "ascension",
        fromZone: "extraDeck",
        sourceCard: summoned,
        actionContext: selectionOptions.actionContext,
      });
      break;
    }

    case "extraDeckProcedure": {
      const player = state.bot;
      const { card: extraDeckCard, index: extraIndex } =
        findSimulatedExtraDeckCard(player, action);
      if (!extraDeckCard || extraDeckCard.cardKind !== "monster") break;
      if (!canSimulatedSpecialSummon(extraDeckCard, player)) break;
      const materials = resolveSimulatedExtraDeckMaterials(player, action);
      const requiredCount = Number(
        action.requiredMaterialCount ||
          extraDeckCard.fusionMaterials?.length ||
          materials.length,
      );
      if (materials.length !== requiredCount) break;
      if ((player.field || []).length - materials.length + 1 > 5) break;

      for (const material of materials) {
        const fromZone = findCardZone(player, material) || "field";
        const wasFaceupBeforeMove = material.isFacedown !== true;
        if (moveCardToZone(player, material, "graveyard")) {
          updateSimulatedSentToGraveMaterialMarker({
            card: material,
            state,
            player,
            fromZone,
            contextLabel: "fusion_material",
          });
          selectionOptions.emitSimulatedEvent?.("card_moved", {
            card: material,
            player,
            fromZone,
            toZone: "graveyard",
            movedByEffect: false,
            wasFaceupBeforeMove,
            sourceCard: extraDeckCard,
            actionContext: selectionOptions.actionContext,
          });
        }
      }

      if (extraIndex >= 0) {
        player.extraDeck.splice(extraIndex, 1);
      }
      const summoned = {
        ...extraDeckCard,
        position: action.position || extraDeckCard.fusionPosition || "attack",
        isFacedown: false,
        hasAttacked: false,
        attacksUsedThisTurn: 0,
        summonMethod:
          extraDeckCard.extraDeckSummonProcedure?.summonMethod || "fusion",
        summonProcedure: extraDeckCard.extraDeckSummonProcedure?.type || null,
      };
      player.field.push(summoned);
      selectionOptions.emitSimulatedEvent?.("after_summon", {
        card: summoned,
        player,
        method: summoned.summonMethod || "fusion",
        fromZone: "extraDeck",
        sourceCard: summoned,
        actionContext: selectionOptions.actionContext,
      });
      break;
    }

    default:
      break;
  }

  return state;
}
