import { getCounterValue } from "./counters.js";
import { getPerspectivePlayers } from "./perspective.js";
import { getZoneCards } from "./zones.js";
import {
  asArray,
  getCardInstanceId,
  matchesTargetFilters,
} from "./targetSelection.js";

export function getStoredBlueprints(card) {
  const storage = card?.state?.blueprintStorage || card?.blueprintStorage;
  return (
    card?.storedBlueprints ||
    card?.blueprintStorageState?.storedBlueprints ||
    storage?.storedBlueprints ||
    card?.storedEffects ||
    []
  );
}

function conditionsArray(conditions) {
  if (!conditions) return [];
  return Array.isArray(conditions) ? conditions : [conditions];
}

function playerControlsMatching(player, condition = {}) {
  const zones = asArray(condition.zones || condition.zone || "field");
  const {
    type: _conditionType,
    owner: _owner,
    zone: _zone,
    zones: _zones,
    min: _min,
    reason: _reason,
    ...directFilters
  } = condition;
  const filters = condition.filters || directFilters;
  return zones.some((zone) =>
    getZoneCards(player, zone).some((card) =>
      matchesTargetFilters(card, filters, null)
    )
  );
}

function resolveConditionSource(ctx, options, sourceRef) {
  if (!sourceRef || sourceRef === "self" || sourceRef === "source") {
    return ctx.sourceCard || options.sourceCard || null;
  }
  const value = ctx[sourceRef] || options[sourceRef] || null;
  return Array.isArray(value) ? value[0] || null : value;
}

function markerMatchesSource(marker, sourceCard) {
  if (!sourceCard) return false;
  const sourceInstanceId = getCardInstanceId(sourceCard);
  if (marker?.sourceInstanceId || sourceInstanceId) {
    return marker?.sourceInstanceId === sourceInstanceId;
  }
  return (
    marker?.sourceCardId !== undefined && marker.sourceCardId === sourceCard.id
  );
}

function battleParticipantForOwner(ctx, options, ownerId) {
  const state = ctx.state || ctx.game || {};
  const player =
    ownerId === ctx.selfId || ownerId === "bot"
      ? getPerspectivePlayers(state, ctx.selfId || "bot").self
      : getPerspectivePlayers(state, ctx.selfId || "bot").opponent;
  const attacker =
    ctx.attacker || options.attacker || options.actionContext?.attacker || null;
  const defender =
    ctx.defender ||
    ctx.target ||
    options.defender ||
    options.target ||
    options.actionContext?.defender ||
    options.actionContext?.target ||
    null;
  const matchesOwner = (card) =>
    !!card &&
    ((Array.isArray(player?.field) && player.field.includes(card)) ||
      card.controller === ownerId ||
      card.owner === ownerId);
  if (matchesOwner(attacker)) return attacker;
  if (matchesOwner(defender)) return defender;
  return null;
}

function resolveEventCardByRef(condition, ctx, options) {
  const ref = condition.cardRef || condition.eventCardRef || null;
  const eventCard =
    (ref && (ctx[ref] || options[ref] || options.actionContext?.[ref])) ||
    ctx.destroyed ||
    options.destroyed ||
    options.actionContext?.destroyed ||
    ctx.eventCard ||
    options.eventCard ||
    options.actionContext?.eventCard ||
    ctx.movedCard ||
    options.movedCard ||
    options.actionContext?.movedCard ||
    ctx.card ||
    options.card ||
    options.actionContext?.card ||
    ctx.target ||
    options.target ||
    options.actionContext?.target ||
    null;
  return Array.isArray(eventCard) ? eventCard[0] || null : eventCard;
}

function readSimContextPath(ctx, options, key) {
  if (!key) return undefined;
  const state = ctx.state || ctx.game || {};
  const source = ctx.source || ctx.sourceCard || options.sourceCard || null;
  const roots = [
    { ...ctx, source, sourceCard: source, game: state, state, options },
    ctx,
    options,
    options.actionContext,
    options.activationContext,
  ].filter(Boolean);
  const parts = String(key).split(".").filter(Boolean);
  for (const root of roots) {
    let value = root;
    for (const part of parts) {
      if (value == null || typeof value !== "object") {
        value = undefined;
        break;
      }
      value = value[part];
    }
    if (value !== undefined) return value;
  }
  return undefined;
}

function compareSimContextNumbers(current, op, expected) {
  if (op === "eq" || op === "===") return current === expected;
  if (op === "neq" || op === "!=" || op === "!==") return current !== expected;
  if (op === "lt" || op === "<") return current < expected;
  if (op === "lte" || op === "<=") return current <= expected;
  if (op === "gte" || op === ">=") return current >= expected;
  return current > expected;
}

function cardPropertyValues(card, property) {
  const value = card?.[property];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value !== undefined && value !== null ? [value] : [];
}

function declarationIsActive(state, declaration) {
  if (!declaration || typeof declaration !== "object") return false;
  return (
    !Number.isFinite(declaration.expiresOnTurn) ||
    Number(state?.turnCounter || 0) <= declaration.expiresOnTurn
  );
}

function declarationMatchesCard(state, declaration, card, property) {
  if (!declarationIsActive(state, declaration)) return false;
  const declaredProperty = declaration.property || property;
  if (declaredProperty !== property) return false;
  return cardPropertyValues(card, property).includes(declaration.value);
}

function declaredValuesMatchCard(state, declaredValues, card, property, stateKey) {
  if (!declaredValues || typeof declaredValues !== "object") return false;
  const entries = stateKey
    ? [[stateKey, declaredValues[stateKey]]]
    : Object.entries(declaredValues);
  return entries.some(([, declaration]) =>
    declarationMatchesCard(state, declaration, card, property),
  );
}

function activeDeclarationSources(player) {
  if (!player) return [];
  const sources = [];
  for (const zone of ["field", "spellTrap"]) {
    for (const card of getZoneCards(player, zone)) {
      if (!card || card.isFacedown) continue;
      if (!card.declaredValues || typeof card.declaredValues !== "object") {
        continue;
      }
      sources.push(card);
    }
  }
  const fieldSpell = player.fieldSpell || null;
  if (
    fieldSpell &&
    !fieldSpell.isFacedown &&
    fieldSpell.declaredValues &&
    typeof fieldSpell.declaredValues === "object"
  ) {
    sources.push(fieldSpell);
  }
  return sources;
}

function buildSimTemporarySource(entry) {
  const archetypes = Array.isArray(entry?.sourceArchetypes)
    ? entry.sourceArchetypes
    : entry?.sourceArchetype
      ? [entry.sourceArchetype]
      : [];
  return {
    id: entry?.sourceCardId ?? null,
    name: entry?.sourceName || null,
    cardKind: entry?.sourceCardKind || null,
    subtype: entry?.sourceCardSubtype || null,
    archetype: entry?.sourceArchetype || archetypes[0] || null,
    archetypes,
  };
}

function simActionFilterFromConfig(config = {}) {
  const filters = { ...(config.filters || {}) };
  for (const key of [
    "cardKind",
    "cardName",
    "name",
    "cardId",
    "cardIds",
    "subtype",
    "monsterType",
    "type",
    "archetype",
    "level",
    "levelOp",
    "minAtk",
    "maxAtk",
    "minDef",
    "maxDef",
    "position",
    "requireFaceup",
    "isToken",
    "isTuner",
    "textIncludes",
    "nameOrDescriptionIncludes",
    "textIncludesAny",
  ]) {
    if (config[key] !== undefined && filters[key] === undefined) {
      filters[key] = config[key];
    }
  }
  return filters;
}

function simOwnersFromRule(rule, self, opponent) {
  if (rule === "opponent") return [opponent].filter(Boolean);
  if (rule === "any" || rule === "both" || rule === "either") {
    return [self, opponent].filter(Boolean);
  }
  return [self].filter(Boolean);
}

function simCardInAllowedZones(card, zones, owners) {
  const allowedZones = asArray(zones).filter(Boolean);
  if (allowedZones.length === 0) return true;
  for (const owner of owners.filter(Boolean)) {
    for (const zone of allowedZones) {
      if (getZoneCards(owner, zone).includes(card)) return true;
    }
  }
  return false;
}

function simSameCard(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftId = getCardInstanceId(left);
  const rightId = getCardInstanceId(right);
  return leftId !== null && rightId !== null && leftId === rightId;
}

function simAppendUnique(cards, card) {
  if (!card) return;
  if (cards.some((entry) => simSameCard(entry, card))) return;
  cards.push(card);
}

function simCollectScopeCards(scope = {}, self, opponent) {
  const zones = asArray(scope.zones || scope.zone || "field");
  const filters = simActionFilterFromConfig(scope);
  const cards = [];
  for (const owner of simOwnersFromRule(
    scope.owner || scope.player || "self",
    self,
    opponent,
  )) {
    for (const zone of zones) {
      for (const card of getZoneCards(owner, zone)) {
        if (!matchesTargetFilters(card, filters, null)) continue;
        cards.push(card);
      }
    }
  }
  return cards;
}

function simSelectedCards(targetRef, activationContext = {}) {
  const selections =
    activationContext.selections ||
    activationContext.respondingToChainLink?.selections ||
    {};
  return asArray(selections?.[targetRef]).filter(Boolean);
}

function simNestedActions(action = {}) {
  const nested = [];
  for (const key of [
    "actions",
    "thenActions",
    "ifActions",
    "elseActions",
    "optionalActions",
  ]) {
    nested.push(...asArray(action[key]));
  }
  for (const entry of asArray(action.cases)) {
    nested.push(...asArray(entry?.actions));
  }
  for (const entry of asArray(action.entries)) {
    nested.push(...asArray(entry?.actions));
  }
  return nested;
}

function simCollectDestroyCandidates(
  actions,
  activationPlayer,
  activationOpponent,
  activationContext = {},
) {
  const cards = [];
  for (const action of asArray(actions)) {
    if (!action) continue;
    if (action.type === "destroy") {
      if (action.targetScope) {
        cards.push(
          ...simCollectScopeCards(
            action.targetScope,
            activationPlayer,
            activationOpponent,
          ),
        );
      }
      cards.push(
        ...simSelectedCards(action.targetRef || "target", activationContext),
      );
    } else if (action.type === "destroy_targeted_cards") {
      const { type: _actionType, ...targetAction } = action;
      cards.push(
        ...simCollectScopeCards(
          {
            owner: "opponent",
            zones: targetAction.zones || ["field", "spellTrap", "fieldSpell"],
            ...targetAction,
            filters: simActionFilterFromConfig(targetAction),
          },
          activationPlayer,
          activationOpponent,
        ),
      );
    } else if (action.type === "destroy_cards_by_scope") {
      cards.push(
        ...simCollectScopeCards(
          action.targetScope || {},
          activationPlayer,
          activationOpponent,
        ),
      );
    } else if (action.type === "mirror_force_destroy_all") {
      cards.push(
        ...getZoneCards(activationOpponent, "field").filter(
          (card) =>
            card?.cardKind === "monster" &&
            card.position === "attack" &&
            !card.isFacedown,
        ),
      );
    }
    cards.push(
      ...simCollectDestroyCandidates(
        simNestedActions(action),
        activationPlayer,
        activationOpponent,
        activationContext,
      ),
    );
  }
  return cards;
}

function simMoveLeavesField(action) {
  const toZone = action?.to || action?.toZone || action?.destination || null;
  return [
    "graveyard",
    "hand",
    "deck",
    "extraDeck",
    "banished",
    "banish",
  ].includes(toZone);
}

function simCollectLeaveFieldCandidates(
  actions,
  activationPlayer,
  activationOpponent,
  activationContext = {},
) {
  const cards = [];
  for (const action of asArray(actions)) {
    if (!action) continue;
    for (const card of simCollectDestroyCandidates(
      [action],
      activationPlayer,
      activationOpponent,
      activationContext,
    )) {
      simAppendUnique(cards, card);
    }
    if (
      action.type === "banish" ||
      action.type === "banish_destroyed_monster" ||
      action.type === "return_to_hand" ||
      (action.type === "move" && simMoveLeavesField(action))
    ) {
      if (action.targetScope) {
        for (const card of simCollectScopeCards(
          action.targetScope,
          activationPlayer,
          activationOpponent,
        )) {
          simAppendUnique(cards, card);
        }
      }
      for (const card of simSelectedCards(
        action.targetRef || "target",
        activationContext,
      )) {
        simAppendUnique(cards, card);
      }
    } else if (action.type === "shuffle_opponent_field_to_deck") {
      for (const card of getZoneCards(activationOpponent, "field")) {
        simAppendUnique(cards, card);
      }
    }
    for (const card of simCollectLeaveFieldCandidates(
      simNestedActions(action),
      activationPlayer,
      activationOpponent,
      activationContext,
    )) {
      simAppendUnique(cards, card);
    }
  }
  return cards;
}

function simActivationWouldDestroyMatchingCards(condition, ctx, options, self, opponent) {
  const activationContext =
    options.actionContext ||
    ctx.actionContext ||
    options.activationContext?.context ||
    {};
  const activationAttempt = activationContext.activationAttempt || null;
  const activatedCard =
    activationAttempt?.card || activationContext.card || options.card || null;
  const effect =
    activationAttempt?.effect || activationContext.effect || options.effect || null;
  const activationPlayer =
    activationAttempt?.player || activationContext.player || null;
  const activationPlayerId =
    activationPlayer?.id || activatedCard?.controller || activatedCard?.owner || null;
  const activationOwner =
    activationPlayerId === self?.id ? self : activationPlayerId === opponent?.id ? opponent : null;
  if (!activationOwner || !effect) return false;
  if (condition.activationPlayer === "opponent" && activationOwner !== opponent) {
    return false;
  }
  if (condition.activationPlayer === "self" && activationOwner !== self) {
    return false;
  }
  const activationOpponent = activationOwner === self ? opponent : self;
  const filters = condition.destroyedCardFilters || condition.filters || {};
  const minCount = Math.max(1, Number(condition.minCount ?? condition.count ?? 1));
  const matching = simCollectDestroyCandidates(
    effect.actions || [],
    activationOwner,
    activationOpponent,
    activationContext,
  ).filter(
    (card) =>
      simCardInAllowedZones(card, condition.destroyedCardZones || condition.zones, [
        self,
        opponent,
      ]) && matchesTargetFilters(card, filters, null),
  );
  return matching.length >= minCount;
}

function simActivationWouldMakeCardLeaveField(condition, ctx, options, self, opponent) {
  const activationContext =
    options.actionContext ||
    ctx.actionContext ||
    options.activationContext?.context ||
    {};
  const activationAttempt = activationContext.activationAttempt || null;
  const activatedCard =
    activationAttempt?.card || activationContext.card || options.card || null;
  const effect =
    activationAttempt?.effect || activationContext.effect || options.effect || null;
  const activationPlayer =
    activationAttempt?.player || activationContext.player || null;
  const activationPlayerId =
    activationPlayer?.id || activatedCard?.controller || activatedCard?.owner || null;
  const activationOwner =
    activationPlayerId === self?.id ? self : activationPlayerId === opponent?.id ? opponent : null;
  if (!activationOwner || !effect) return false;
  if (condition.activationPlayer === "opponent" && activationOwner !== opponent) {
    return false;
  }
  if (condition.activationPlayer === "self" && activationOwner !== self) {
    return false;
  }
  const watched = resolveConditionSource(
    ctx,
    options,
    condition.cardRef || condition.targetRef || "self",
  );
  if (!watched) return false;
  const activationOpponent = activationOwner === self ? opponent : self;
  const activeZones = condition.fromZones || condition.zones || [
    "field",
    "spellTrap",
    "fieldSpell",
  ];
  if (!simCardInAllowedZones(watched, activeZones, [self, opponent])) {
    return false;
  }
  const candidates = simCollectLeaveFieldCandidates(
    effect.actions || [],
    activationOwner,
    activationOpponent,
    activationContext,
  ).filter(
    (card) =>
      simSameCard(card, watched) &&
      simCardInAllowedZones(card, activeZones, [self, opponent]) &&
      matchesTargetFilters(card, condition.filters || {}, null),
  );
  return candidates.length > 0;
}

export function evaluateSimulatedConditions(conditions, ctx = {}) {
  const list = conditionsArray(conditions);
  if (list.length === 0) return true;
  const state = ctx.state || ctx.game || {};
  const { self, opponent } = getPerspectivePlayers(state, ctx.selfId || "bot");
  const options = ctx.options || {};
  const custom =
    options.evaluateSimulatedConditions ||
    options.strategy?.evaluateSimulatedConditions?.bind(options.strategy);
  if (typeof custom === "function") {
    const result = custom(conditions, ctx);
    if (typeof result === "boolean") return result;
  }

  return list.every((condition) => {
    if (!condition) return true;
    if (condition.type === "any_of" || Array.isArray(condition.any_of)) {
      const optionsList = condition.conditions || condition.any_of || [];
      return optionsList.some((entry) =>
        evaluateSimulatedConditions(entry, ctx)
      );
    }
    const owner = condition.owner === "opponent" ? opponent : self;
    if (condition.type === "context_number_compare") {
      const rawCurrent = readSimContextPath(
        ctx,
        options,
        condition.key || condition.path,
      );
      const current = Number(rawCurrent ?? condition.defaultValue ?? 0);
      const valueFromContext =
        typeof condition.valueFromContext === "string"
          ? condition.valueFromContext
          : condition.valueFromContext?.key || condition.valueFromContext?.path;
      const rawExpected = valueFromContext
        ? readSimContextPath(ctx, options, valueFromContext)
        : undefined;
      const expected = Number(
        rawExpected ??
          condition.value ??
          condition.amount ??
          condition.defaultExpectedValue ??
          0,
      );
      return (
        Number.isFinite(current) &&
        Number.isFinite(expected) &&
        compareSimContextNumbers(
          current,
          condition.op || condition.operator || "gt",
          expected,
        )
      );
    }
    if (condition.type === "source_counters_at_least") {
      const sourceCard = ctx.sourceCard || options.sourceCard;
      return (
        getCounterValue(sourceCard, condition.counterType || "counter") >=
        (condition.min || 0)
      );
    }
    if (condition.type === "has_stored_blueprint") {
      const sourceCard = ctx.sourceCard || options.sourceCard;
      return getStoredBlueprints(sourceCard).length > 0;
    }
    if (condition.type === "empty_field" || condition.empty_field) {
      return (owner?.field || []).filter((card) => card?.cardKind === "monster")
        .length === 0;
    }
    if (condition.type === "control_card" || condition.control_card) {
      return playerControlsMatching(owner, condition);
    }
    if (
      condition.type === "control_card_filters" ||
      condition.control_card_filters
    ) {
      const {
        type: _conditionType,
        owner: _owner,
        zone: _zone,
        zones: _zones,
        min: _min,
        max: _max,
        reason: _reason,
        ...directFilters
      } = condition;
      const filters = {
        ...directFilters,
        ...(condition.control_card_filters || condition.filters || {}),
      };
      const zones = asArray(condition.zones || condition.zone || "field");
      const min = Number.isFinite(condition.min)
        ? condition.min
        : Number.isFinite(condition.max)
          ? 0
          : 1;
      const max = Number.isFinite(condition.max) ? condition.max : null;
      const count = zones.reduce(
        (sum, zone) =>
          sum +
          getZoneCards(owner, zone).filter((card) =>
            matchesTargetFilters(card, filters, null)
          ).length,
        0,
      );
      return count >= min && (max === null || count <= max);
    }
    if (condition.type === "control_card_max") {
      const zones = asArray(condition.zones || condition.zone || "field");
      const max = Number.isFinite(condition.max) ? condition.max : 0;
      const filters = condition.filters || {};
      const count = zones.reduce(
        (sum, zone) =>
          sum +
          getZoneCards(owner, zone).filter((card) =>
            matchesTargetFilters(card, filters, null)
          ).length,
        0,
      );
      return count <= max;
    }
    if (condition.type === "destroyed_card_matches_declared_value") {
      const sourceCard = ctx.sourceCard || options.sourceCard;
      const declaration =
        sourceCard?.declaredValues?.[condition.stateKey || condition.key];
      const destroyedCard =
        ctx.destroyed || options.destroyed || options.actionContext?.destroyed;
      const property = condition.property || "type";
      if (!declaration || !destroyedCard) return false;
      const values = Array.isArray(destroyedCard[property])
        ? destroyedCard[property]
        : [destroyedCard[property]];
      return values.includes(declaration.value);
    }
    if (condition.type === "battle_destroyer_matches_filters") {
      const battleDestroyers = asArray(
        ctx.battleDestroyers ||
          options.battleDestroyers ||
          options.actionContext?.battleDestroyers ||
          ctx.battleDestroyer ||
          options.battleDestroyer ||
          options.attacker ||
          options.actionContext?.attacker,
      ).filter(Boolean);
      const expectedOwner =
        condition.owner === "opponent"
          ? opponent
          : condition.owner === "any"
            ? null
            : self;
      return battleDestroyers.some((card) => {
        if (!card) return false;
        if (expectedOwner) {
          const owner = getZoneCards(expectedOwner, "field").includes(card)
            ? expectedOwner
            : card.controller === expectedOwner.id ||
                card.owner === expectedOwner.id
              ? expectedOwner
              : null;
          if (owner !== expectedOwner) return false;
        }
        return matchesTargetFilters(card, condition.filters || {}, null);
      });
    }
    if (condition.type === "battle_participant_matches_filters") {
      const ownerId =
        condition.owner === "opponent"
          ? opponent?.id
          : condition.owner === "any"
            ? null
            : self?.id;
      const participants = ownerId
        ? [battleParticipantForOwner(ctx, options, ownerId)]
        : [
            ctx.attacker || options.attacker || options.actionContext?.attacker,
            ctx.defender ||
              ctx.target ||
              options.defender ||
              options.target ||
              options.actionContext?.defender ||
              options.actionContext?.target,
          ].filter(Boolean);
      return participants.some((card) =>
        matchesTargetFilters(card, condition.filters || {}, null)
      );
    }
    if (condition.type === "battle_opponent_matches_declared_value") {
      const sourceCard = ctx.sourceCard || options.sourceCard;
      const declaration =
        sourceCard?.declaredValues?.[condition.stateKey || condition.key];
      const battleOpponent = battleParticipantForOwner(
        ctx,
        options,
        opponent?.id,
      );
      const property = condition.property || "type";
      if (!declaration || !battleOpponent) return false;
      const values = asArray(battleOpponent[property]);
      return values.includes(declaration.value);
    }
    if (condition.type === "field_card_count") {
      const ownerList =
        condition.owner === "opponent"
          ? [opponent]
          : condition.owner === "any" || condition.owner === "both"
            ? [self, opponent]
            : [self];
      const zones = asArray(condition.zones || condition.zone || "field");
      const filters = condition.filters || {};
      const count = ownerList.filter(Boolean).reduce(
        (sum, player) =>
          sum +
          zones.reduce(
            (zoneSum, zone) =>
              zoneSum +
              getZoneCards(player, zone).filter((card) => {
                if (condition.requireFaceup === true && card?.isFacedown) {
                  return false;
                }
                if (
                  condition.excludeSource === true &&
                  simSameCard(card, resolveConditionSource(ctx, options, "self"))
                ) {
                  return false;
                }
                return matchesTargetFilters(card, filters, null);
              }).length,
            0,
          ),
        0,
      );
      if (condition.count !== undefined) return count === condition.count;
      if (condition.min !== undefined && count < condition.min) return false;
      if (condition.max !== undefined && count > condition.max) return false;
      return true;
    }
    if (condition.type === "activation_would_destroy_cards_matching_filters") {
      return simActivationWouldDestroyMatchingCards(
        condition,
        ctx,
        options,
        self,
        opponent,
      );
    }
    if (condition.type === "activation_would_make_card_leave_field") {
      return simActivationWouldMakeCardLeaveField(
        condition,
        ctx,
        options,
        self,
        opponent,
      );
    }
    if (condition.type === "event_card_matches_filters") {
      const card = resolveEventCardByRef(condition, ctx, options);
      const ownerKey = condition.owner || "any";
      if (ownerKey !== "any") {
        const expectedOwner = ownerKey === "opponent" ? opponent : self;
        const eventOwnerId =
          options.actionContext?.destroyedOwner?.id ||
          options.actionContext?.destroyedOwner ||
          card?.controller ||
          card?.owner;
        if (!expectedOwner || eventOwnerId !== expectedOwner.id) return false;
      }
      return matchesTargetFilters(card, condition.filters || {}, null);
    }
    if (
      condition.type === "event_card_matches_declared_value_from_effect_sources"
    ) {
      const card = resolveEventCardByRef(condition, ctx, options);
      if (!card) return false;
      const property = condition.property || "type";
      const sourceFilters = condition.sourceFilters || {};
      const stateKey = condition.stateKey || condition.key || null;
      const owners =
        condition.owner === "opponent"
          ? [opponent]
          : condition.owner === "any" || condition.owner === "both"
            ? [self, opponent]
            : [self];

      const activeMatch = owners.filter(Boolean).some((player) =>
        activeDeclarationSources(player).some(
          (source) =>
            matchesTargetFilters(source, sourceFilters, null) &&
            declaredValuesMatchCard(
              state,
              source.declaredValues,
              card,
              property,
              stateKey,
            ),
        ),
      );
      if (activeMatch) return true;

      const temporaryEffects = Array.isArray(state.temporaryEventEffects)
        ? state.temporaryEventEffects
        : [];
      return owners.filter(Boolean).some((player) =>
        temporaryEffects.some((entry) => {
          if (!entry || entry.ownerId !== player.id) return false;
          if (
            Number.isFinite(entry.expiresOnTurn) &&
            Number(state.turnCounter || 0) > entry.expiresOnTurn
          ) {
            return false;
          }
          const source = buildSimTemporarySource(entry);
          return (
            matchesTargetFilters(source, sourceFilters, null) &&
            declaredValuesMatchCard(
              state,
              entry.declaredValues,
              card,
              property,
              stateKey,
            )
          );
        }),
      );
    }
    if (condition.type === "attacker_matches") {
      const attacker =
        ctx.attacker || options.attacker || options.actionContext?.attacker;
      if (!attacker) return false;
      const {
        type: _conditionType,
        owner: _owner,
        reason: _reason,
        ...filters
      } = condition;
      return matchesTargetFilters(attacker, filters, null);
    }
    if (condition.type === "summoned_card_has_marker") {
      const summonedCard =
        ctx.summonedCard ||
        options.summonedCard ||
        options.actionContext?.summonedCard;
      const key = condition.key || condition.stateKey;
      const marker = key ? summonedCard?.effectMarkers?.[key] : null;
      if (!marker) return false;
      if (
        Number.isFinite(marker.expiresOnTurn) &&
        Number(state.turnCounter || 0) > marker.expiresOnTurn
      ) {
        return false;
      }
      if (
        condition.sourceEffectId &&
        marker.sourceEffectId !== condition.sourceEffectId
      ) {
        return false;
      }
      if (condition.sourceRef) {
        const sourceCard = resolveConditionSource(
          ctx,
          options,
          condition.sourceRef,
        );
        if (!markerMatchesSource(marker, sourceCard)) return false;
      }
      return true;
    }
    return true;
  });
}

