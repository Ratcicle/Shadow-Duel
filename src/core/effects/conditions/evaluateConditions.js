function getCardInstanceId(card) {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? null;
}

function isSameCardReference(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftInstanceId = getCardInstanceId(left);
  const rightInstanceId = getCardInstanceId(right);
  return (
    leftInstanceId !== null &&
    rightInstanceId !== null &&
    leftInstanceId === rightInstanceId
  );
}

function resolveSourceRef(ctx, sourceRef) {
  if (!sourceRef || sourceRef === "self" || sourceRef === "source") {
    return ctx?.source || null;
  }
  const value = ctx?.[sourceRef];
  return Array.isArray(value) ? value[0] || null : value || null;
}

function markerMatchesSource(marker, source) {
  if (!source) return false;
  const sourceInstanceId = getCardInstanceId(source);
  if (marker?.sourceInstanceId || sourceInstanceId) {
    return marker?.sourceInstanceId === sourceInstanceId;
  }
  return marker?.sourceCardId !== undefined && marker.sourceCardId === source.id;
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function readContextPath(ctx, key) {
  if (!ctx || !key) return undefined;
  const parts = String(key).split(".").filter(Boolean);
  const readPath = (root) => {
    let value = root;
    for (const part of parts) {
      if (value == null || typeof value !== "object") return undefined;
      value = value[part];
    }
    return value;
  };
  return (
    readPath(ctx) ??
    readPath(ctx.actionContext) ??
    readPath(ctx.activationContext) ??
    readPath(ctx.activationContext?.actionContext)
  );
}

function compareContextNumbers(current, op, expected) {
  if (op === "eq" || op === "===") return current === expected;
  if (op === "neq" || op === "!=" || op === "!==") return current !== expected;
  if (op === "lt" || op === "<") return current < expected;
  if (op === "lte" || op === "<=") return current <= expected;
  if (op === "gte" || op === ">=") return current >= expected;
  return current > expected;
}

function getBattleParticipantForOwner(ctx, owner) {
  if (!ctx || !owner) return null;
  const attacker = ctx.attacker || null;
  const defender = ctx.defender || ctx.target || null;
  const controlsCard = (card, explicitOwner) =>
    !!card &&
    (explicitOwner === owner ||
      explicitOwner?.id === owner.id ||
      owner.field?.includes?.(card) ||
      card.controller === owner.id ||
      card.owner === owner.id);
  if (
    attacker &&
    controlsCard(attacker, ctx.attackerOwner)
  ) {
    return attacker;
  }
  if (
    defender &&
    (controlsCard(defender, ctx.defenderOwner) ||
      controlsCard(defender, ctx.targetOwner))
  ) {
    return defender;
  }
  return null;
}

function getConditionOwners(ownerRule, player, opponent) {
  if (ownerRule === "opponent") return [opponent].filter(Boolean);
  if (ownerRule === "any" || ownerRule === "both") {
    return [player, opponent].filter(Boolean);
  }
  return [player].filter(Boolean);
}

function getConditionZoneCards(owner, zoneKey) {
  if (!owner || !zoneKey) return [];
  if (zoneKey === "fieldSpell") {
    return owner.fieldSpell ? [owner.fieldSpell] : [];
  }
  const zone = owner[zoneKey] || [];
  return Array.isArray(zone) ? zone.filter(Boolean) : [];
}

function getEventCardByRef(cond, ctx) {
  const ref = cond.cardRef || cond.eventCardRef || null;
  const eventCard =
    (ref && ctx?.[ref]) ||
    ctx?.destroyed ||
    ctx?.eventCard ||
    ctx?.movedCard ||
    ctx?.card ||
    ctx?.target ||
    null;
  return Array.isArray(eventCard) ? eventCard[0] || null : eventCard;
}

function getCardPropertyValues(card, property) {
  const value = card?.[property];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value !== undefined && value !== null ? [value] : [];
}

function declarationIsActive(game, declaration) {
  if (!declaration || typeof declaration !== "object") return false;
  return (
    !Number.isFinite(declaration.expiresOnTurn) ||
    !game ||
    Number(game.turnCounter || 0) <= declaration.expiresOnTurn
  );
}

function sourceMatchesDeclaredFilters(engine, source, filters = {}) {
  if (!filters || Object.keys(filters).length === 0) return true;
  return engine.cardMatchesFilters(source, filters);
}

function declarationMatchesCard(game, declaration, card, property) {
  if (!declarationIsActive(game, declaration)) return false;
  const declaredProperty = declaration.property || property;
  if (declaredProperty !== property) return false;
  return getCardPropertyValues(card, property).includes(declaration.value);
}

function activeDeclarationSourcesForOwner(owner) {
  if (!owner) return [];
  const sources = [];
  for (const zoneName of ["field", "spellTrap"]) {
    for (const card of getConditionZoneCards(owner, zoneName)) {
      if (!card || card.isFacedown) continue;
      if (!card.declaredValues || typeof card.declaredValues !== "object") {
        continue;
      }
      sources.push(card);
    }
  }
  const fieldSpell = owner.fieldSpell || null;
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

function findConditionCardOwner(game, card) {
  if (!game || !card) return null;
  if (typeof game.getOwnerByCard === "function") {
    const owner = game.getOwnerByCard(card);
    if (owner) return owner;
  }
  if (typeof game.effectEngine?.getOwnerByCard === "function") {
    const owner = game.effectEngine.getOwnerByCard(card);
    if (owner) return owner;
  }
  for (const owner of [game.player, game.bot]) {
    if (!owner) continue;
    if (owner.fieldSpell === card) return owner;
    for (const zone of [
      "field",
      "spellTrap",
      "hand",
      "graveyard",
      "deck",
      "extraDeck",
      "banished",
    ]) {
      if (Array.isArray(owner[zone]) && owner[zone].includes(card)) {
        return owner;
      }
    }
  }
  return null;
}

function cardVisibleToConditionViewer(engine, card, viewer) {
  if (!card?.isFacedown) return true;
  const owner = findConditionCardOwner(engine?.game, card);
  return !!viewer && owner?.id === viewer.id;
}

function cardIsInAllowedConditionZones(engine, card, zones) {
  const allowedZones = asArray(zones).filter(Boolean);
  if (allowedZones.length === 0) return true;
  const game = engine?.game || engine;
  const owner = findConditionCardOwner(game, card);
  if (!owner) return false;
  for (const zone of allowedZones) {
    if (zone === "fieldSpell") {
      if (owner.fieldSpell === card) return true;
      continue;
    }
    const zoneCards = owner[zone] || [];
    if (Array.isArray(zoneCards) && zoneCards.includes(card)) return true;
  }
  return false;
}

function appendUniqueCard(cards, card) {
  if (!card) return;
  const key = getCardInstanceId(card) || card;
  if (
    cards.some((entry) => (getCardInstanceId(entry) || entry) === key)
  ) {
    return;
  }
  cards.push(card);
}

function actionFilterFromConfig(config = {}) {
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

function getConditionOwnersFromRule(rule, ctx) {
  if (rule === "opponent") return [ctx.opponent].filter(Boolean);
  if (rule === "any" || rule === "both" || rule === "either") {
    return [ctx.player, ctx.opponent].filter(Boolean);
  }
  return [ctx.player].filter(Boolean);
}

function collectCardsFromScope(engine, scope = {}, ctx = {}) {
  const zones = asArray(scope.zones || scope.zone || "field");
  const filters = actionFilterFromConfig(scope);
  const cards = [];
  for (const owner of getConditionOwnersFromRule(
    scope.owner || scope.player || "self",
    ctx,
  )) {
    for (const zone of zones) {
      for (const card of getConditionZoneCards(owner, zone)) {
        if (!card) continue;
        if (scope.excludeSelf === true && ctx.source && card === ctx.source) {
          continue;
        }
        if (!engine.cardMatchesFilters(card, filters)) continue;
        appendUniqueCard(cards, card);
      }
    }
  }
  return cards;
}

function collectContextTargetCards(targetRef, ctx = {}) {
  if (!targetRef) return [];
  const refs = {
    self: ctx.source,
    source: ctx.source,
    target: ctx.target,
    targetedCard: ctx.targetedCard,
    attacker: ctx.attacker,
    defender: ctx.defender,
    destroyed: ctx.destroyed,
    summonedCard: ctx.summonedCard,
  };
  if (targetRef === "battle_opponent") {
    if (ctx.source && ctx.source === ctx.attacker) {
      return [ctx.defender || ctx.target].filter(Boolean);
    }
    if (ctx.source && ctx.source === (ctx.defender || ctx.target)) {
      return [ctx.attacker].filter(Boolean);
    }
  }
  return asArray(refs[targetRef]).filter(Boolean);
}

function cardsFromSelectionValue(value) {
  const cards = [];
  const visit = (entry) => {
    if (!entry) return;
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (entry.cardRef) {
      visit(entry.cardRef);
      return;
    }
    if (entry.card) {
      visit(entry.card);
      return;
    }
    if (typeof entry === "object" && (entry.name || entry.cardKind)) {
      appendUniqueCard(cards, entry);
    }
  };
  visit(value);
  return cards;
}

function collectSelectedTargetCards(targetRef, activationContext = {}) {
  const selectionSources = [
    activationContext.selections,
    activationContext.context?.selections,
    activationContext.respondingToChainLink?.selections,
  ].filter(Boolean);
  const cards = [];
  for (const selections of selectionSources) {
    if (!selections || typeof selections !== "object") continue;
    for (const card of cardsFromSelectionValue(selections[targetRef])) {
      appendUniqueCard(cards, card);
    }
  }
  return cards;
}

function collectTargetRefCandidateCards(engine, targetRef, effect, ctx, activationContext) {
  const cards = [];
  for (const card of collectSelectedTargetCards(targetRef, activationContext)) {
    appendUniqueCard(cards, card);
  }
  for (const card of collectContextTargetCards(targetRef, ctx)) {
    appendUniqueCard(cards, card);
  }
  if (!targetRef || !Array.isArray(effect?.targets) || effect.targets.length === 0) {
    return cards;
  }

  const targetCtx = {
    ...ctx,
    activationContext: {
      ...(ctx.activationContext || {}),
      preview: true,
      autoSelectSingleTarget: false,
      autoSelectTargets: false,
    },
  };
  const targetResult = engine.resolveTargets(effect.targets, targetCtx, null);
  const resolved = targetResult?.targets?.[targetRef];
  for (const card of asArray(resolved)) appendUniqueCard(cards, card);
  for (const requirement of targetResult?.selectionContract?.requirements || []) {
    if (requirement?.id !== targetRef) continue;
    for (const candidate of requirement.candidates || []) {
      appendUniqueCard(cards, candidate.cardRef || candidate.card);
    }
  }
  return cards;
}

function collectActionDestroyCandidates(engine, action, ctx, effect, activationContext) {
  if (!action || typeof action !== "object") return [];
  const cards = [];
  const addNested = (actions) => {
    for (const card of collectActionsDestroyCandidates(
      engine,
      actions,
      ctx,
      effect,
      activationContext,
    )) {
      appendUniqueCard(cards, card);
    }
  };

  if (action.type === "destroy") {
    if (action.targetScope) {
      addNested([
        {
          type: "destroy_cards_by_scope",
          targetScope: action.targetScope,
        },
      ]);
    }
    for (const card of collectTargetRefCandidateCards(
      engine,
      action.targetRef || "target",
      effect,
      ctx,
      activationContext,
    )) {
      appendUniqueCard(cards, card);
    }
  } else if (action.type === "destroy_targeted_cards") {
    const { type: _actionType, ...targetAction } = action;
    const scope = {
      owner: "opponent",
      zones: targetAction.zones || ["field", "spellTrap", "fieldSpell"],
      ...targetAction,
      filters: actionFilterFromConfig(targetAction),
    };
    for (const card of collectCardsFromScope(engine, scope, ctx)) {
      appendUniqueCard(cards, card);
    }
  } else if (action.type === "destroy_cards_by_scope") {
    for (const card of collectCardsFromScope(engine, action.targetScope || {}, ctx)) {
      appendUniqueCard(cards, card);
    }
  } else if (action.type === "mirror_force_destroy_all") {
    const defender = ctx.opponent;
    for (const card of defender?.field || []) {
      if (
        card &&
        card.cardKind === "monster" &&
        card.position === "attack" &&
        !card.isFacedown
      ) {
        appendUniqueCard(cards, card);
      }
    }
  } else if (action.type === "destroy_and_damage_by_target_atk") {
    const entries =
      Array.isArray(action.entries) && action.entries.length > 0
        ? action.entries
        : action.targetRef
          ? [{ targetRef: action.targetRef }]
          : [];
    for (const entry of entries) {
      for (const card of collectTargetRefCandidateCards(
        engine,
        entry.targetRef,
        effect,
        ctx,
        activationContext,
      )) {
        appendUniqueCard(cards, card);
      }
    }
  }

  if (action.destroyIfAtkZeroedByThisEffect && action.targetRef) {
    for (const card of collectTargetRefCandidateCards(
      engine,
      action.targetRef,
      effect,
      ctx,
      activationContext,
    )) {
      const nextAtk = Number(card?.atk || 0) + Number(action.atkChange || 0);
      if (nextAtk <= 0) appendUniqueCard(cards, card);
    }
  }

  addNested(action.actions);
  addNested(action.thenActions);
  addNested(action.ifActions);
  addNested(action.elseActions);
  addNested(action.optionalActions);
  if (Array.isArray(action.cases)) {
    for (const entry of action.cases) addNested(entry?.actions);
  }
  if (Array.isArray(action.entries)) {
    for (const entry of action.entries) addNested(entry?.actions);
  }

  return cards;
}

function collectActionsDestroyCandidates(engine, actions, ctx, effect, activationContext) {
  const cards = [];
  for (const action of asArray(actions)) {
    for (const card of collectActionDestroyCandidates(
      engine,
      action,
      ctx,
      effect,
      activationContext,
    )) {
      appendUniqueCard(cards, card);
    }
  }
  return cards;
}

function activationWouldDestroyCardsMatchingFilters(engine, cond, ctx) {
  const activationContext =
    ctx?.activationContext?.context || ctx?.actionContext || {};
  const activationAttempt =
    activationContext.activationAttempt || ctx?.activationContext?.activationAttempt || null;
  const activatedCard =
    activationAttempt?.card ||
    activationContext.card ||
    ctx?.activatedCard ||
    null;
  const activationPlayer =
    activationAttempt?.player ||
    activationContext.player ||
    activationContext.triggerPlayer ||
    null;
  const responsePlayer = ctx?.player || null;
  const responseOpponent = ctx?.opponent || engine.game?.getOpponent?.(responsePlayer);

  if (!activatedCard || !activationPlayer) {
    return { ok: false, reason: cond.reason || "No activation to inspect." };
  }
  if (cond.activationPlayer === "opponent" && activationPlayer.id !== responseOpponent?.id) {
    return { ok: false, reason: cond.reason || "Activation was not controlled by the opponent." };
  }
  if (cond.activationPlayer === "self" && activationPlayer.id !== responsePlayer?.id) {
    return { ok: false, reason: cond.reason || "Activation was not yours." };
  }

  const effect = activationAttempt?.effect || activationContext.effect || null;
  const actionCtx = {
    ...ctx,
    source: activatedCard,
    sourceCard: activatedCard,
    effect,
    player: activationPlayer,
    opponent: engine.game?.getOpponent?.(activationPlayer) || responsePlayer,
    activationContext: {
      ...(ctx?.activationContext || {}),
      context: activationContext,
      selections:
        activationContext.selections ||
        activationContext.respondingToChainLink?.selections ||
        ctx?.activationContext?.selections ||
        null,
    },
    actionContext: activationContext,
  };
  const candidates = collectActionsDestroyCandidates(
    engine,
    effect?.actions || [],
    actionCtx,
    effect,
    activationContext,
  );
  const filters = cond.destroyedCardFilters || cond.filters || {};
  const minCount = Math.max(1, Number(cond.minCount ?? cond.count ?? 1));
  const matching = candidates.filter((card) => {
    if (!cardVisibleToConditionViewer(engine, card, responsePlayer)) {
      return false;
    }
    if (
      !cardIsInAllowedConditionZones(
        engine,
        card,
        cond.destroyedCardZones || cond.zones,
      )
    ) {
      return false;
    }
    return engine.cardMatchesFilters(card, filters);
  });

  if (matching.length < minCount) {
    return {
      ok: false,
      reason: cond.reason || "Activation would not destroy matching cards.",
    };
  }
  return { ok: true, matches: matching };
}

const ACTIVE_FIELD_ZONES = ["field", "spellTrap", "fieldSpell"];
const NON_FIELD_DESTINATION_ZONES = [
  "graveyard",
  "hand",
  "deck",
  "extraDeck",
  "banished",
  "banish",
];

function normalizeDestinationZone(zone) {
  return zone === "banish" ? "banished" : zone;
}

function actionMovesToNonField(action) {
  const toZone = normalizeDestinationZone(
    action?.to || action?.toZone || action?.destination || null,
  );
  if (!toZone) return false;
  return NON_FIELD_DESTINATION_ZONES.includes(toZone);
}

function collectActionLeaveFieldCandidates(
  engine,
  action,
  ctx,
  effect,
  activationContext,
) {
  if (!action || typeof action !== "object") return [];
  const cards = [];
  const addNested = (actions) => {
    for (const card of collectActionsLeaveFieldCandidates(
      engine,
      actions,
      ctx,
      effect,
      activationContext,
    )) {
      appendUniqueCard(cards, card);
    }
  };
  const addTargetRefCards = (targetRef) => {
    for (const card of collectTargetRefCandidateCards(
      engine,
      targetRef,
      effect,
      ctx,
      activationContext,
    )) {
      appendUniqueCard(cards, card);
    }
  };

  for (const card of collectActionDestroyCandidates(
    engine,
    action,
    ctx,
    effect,
    activationContext,
  )) {
    appendUniqueCard(cards, card);
  }

  if (action.type === "banish" || action.type === "banish_destroyed_monster") {
    if (action.targetScope) {
      for (const card of collectCardsFromScope(engine, action.targetScope, ctx)) {
        appendUniqueCard(cards, card);
      }
    }
    addTargetRefCards(action.targetRef || "target");
  } else if (action.type === "return_to_hand") {
    addTargetRefCards(action.targetRef || "target");
  } else if (action.type === "move" && actionMovesToNonField(action)) {
    if (action.targetScope) {
      for (const card of collectCardsFromScope(engine, action.targetScope, ctx)) {
        appendUniqueCard(cards, card);
      }
    }
    addTargetRefCards(action.targetRef || "target");
  } else if (action.type === "shuffle_opponent_field_to_deck") {
    for (const card of ctx.opponent?.field || []) appendUniqueCard(cards, card);
  }

  addNested(action.actions);
  addNested(action.thenActions);
  addNested(action.ifActions);
  addNested(action.elseActions);
  addNested(action.optionalActions);
  if (Array.isArray(action.cases)) {
    for (const entry of action.cases) addNested(entry?.actions);
  }
  if (Array.isArray(action.entries)) {
    for (const entry of action.entries) addNested(entry?.actions);
  }

  return cards;
}

function collectActionsLeaveFieldCandidates(
  engine,
  actions,
  ctx,
  effect,
  activationContext,
) {
  const cards = [];
  for (const action of asArray(actions)) {
    for (const card of collectActionLeaveFieldCandidates(
      engine,
      action,
      ctx,
      effect,
      activationContext,
    )) {
      appendUniqueCard(cards, card);
    }
  }
  return cards;
}

function activationWouldMakeCardLeaveField(engine, cond, ctx) {
  const activationContext =
    ctx?.activationContext?.context || ctx?.actionContext || {};
  const activationAttempt =
    activationContext.activationAttempt ||
    ctx?.activationContext?.activationAttempt ||
    null;
  const activatedCard =
    activationAttempt?.card ||
    activationContext.card ||
    ctx?.activatedCard ||
    null;
  const activationPlayer =
    activationAttempt?.player ||
    activationContext.player ||
    activationContext.triggerPlayer ||
    null;
  const responsePlayer = ctx?.player || null;
  const responseOpponent =
    ctx?.opponent || engine.game?.getOpponent?.(responsePlayer);

  if (!activatedCard || !activationPlayer) {
    return { ok: false, reason: cond.reason || "No activation to inspect." };
  }
  if (
    cond.activationPlayer === "opponent" &&
    activationPlayer.id !== responseOpponent?.id
  ) {
    return {
      ok: false,
      reason: cond.reason || "Activation was not controlled by the opponent.",
    };
  }
  if (
    cond.activationPlayer === "self" &&
    activationPlayer.id !== responsePlayer?.id
  ) {
    return { ok: false, reason: cond.reason || "Activation was not yours." };
  }

  const watchedCards = collectContextTargetCards(
    cond.cardRef || cond.targetRef || "self",
    ctx,
  ).filter((card) =>
    cardIsInAllowedConditionZones(
      engine,
      card,
      cond.fromZones || cond.zones || ACTIVE_FIELD_ZONES,
    ),
  );
  if (watchedCards.length === 0) {
    return {
      ok: false,
      reason: cond.reason || "No watched card on the field.",
    };
  }

  const effect = activationAttempt?.effect || activationContext.effect || null;
  const actionCtx = {
    ...ctx,
    source: activatedCard,
    sourceCard: activatedCard,
    effect,
    player: activationPlayer,
    opponent: engine.game?.getOpponent?.(activationPlayer) || responsePlayer,
    activationContext: {
      ...(ctx?.activationContext || {}),
      context: activationContext,
      selections:
        activationContext.selections ||
        activationContext.respondingToChainLink?.selections ||
        ctx?.activationContext?.selections ||
        null,
    },
    actionContext: activationContext,
  };
  const candidates = collectActionsLeaveFieldCandidates(
    engine,
    effect?.actions || [],
    actionCtx,
    effect,
    activationContext,
  );
  const filters = cond.filters || {};
  const matching = candidates.filter((candidate) => {
    if (!cardVisibleToConditionViewer(engine, candidate, responsePlayer)) {
      return false;
    }
    if (
      !cardIsInAllowedConditionZones(
        engine,
        candidate,
        cond.fromZones || cond.zones || ACTIVE_FIELD_ZONES,
      )
    ) {
      return false;
    }
    if (!engine.cardMatchesFilters(candidate, filters)) return false;
    return watchedCards.some((card) => isSameCardReference(card, candidate));
  });

  if (matching.length === 0) {
    return {
      ok: false,
      reason: cond.reason || "Activation would not make that card leave the field.",
    };
  }
  return { ok: true, matches: matching };
}

function buildTemporaryEffectSource(game, entry) {
  const data =
    game?.resolveCardData?.(entry?.sourceCardId) ||
    game?.resolveCardData?.(entry?.sourceName) ||
    {};
  const archetypes = Array.isArray(entry?.sourceArchetypes)
    ? entry.sourceArchetypes
    : entry?.sourceArchetype
      ? [entry.sourceArchetype]
      : Array.isArray(data?.archetypes)
        ? data.archetypes
        : data?.archetype
          ? [data.archetype]
          : [];
  return {
    ...data,
    id: entry?.sourceCardId ?? data?.id ?? null,
    name: entry?.sourceName || data?.name || null,
    cardKind: entry?.sourceCardKind || data?.cardKind || null,
    subtype: entry?.sourceCardSubtype || data?.subtype || null,
    archetype: entry?.sourceArchetype || data?.archetype || archetypes[0] || null,
    archetypes,
  };
}

export function evaluateConditions(conditions, ctx) {
    if (!Array.isArray(conditions) || conditions.length === 0) {
      return { ok: true };
    }

    const player = ctx?.player;
    const opponent = ctx?.opponent || this.game?.getOpponent?.(player);

    for (const cond of conditions) {
      if (!cond || !cond.type) continue;
      switch (cond.type) {
        case "context_number_compare": {
          const contextRoot = { ...ctx, game: this.game };
          const rawCurrent = readContextPath(contextRoot, cond.key || cond.path);
          const current = Number(rawCurrent ?? cond.defaultValue ?? 0);
          const valueFromContext =
            typeof cond.valueFromContext === "string"
              ? cond.valueFromContext
              : cond.valueFromContext?.key || cond.valueFromContext?.path;
          const rawExpected = valueFromContext
            ? readContextPath(contextRoot, valueFromContext)
            : undefined;
          const expected = Number(
            rawExpected ?? cond.value ?? cond.amount ?? cond.defaultExpectedValue ?? 0,
          );
          if (
            !Number.isFinite(current) ||
            !Number.isFinite(expected) ||
            !compareContextNumbers(current, cond.op || cond.operator || "gt", expected)
          ) {
            return {
              ok: false,
              reason: cond.reason || "Required context value was not met.",
            };
          }
          break;
        }
        case "playerFieldEmpty":
          if ((player?.field?.length || 0) !== 0) {
            return { ok: false, reason: "You must control no monsters." };
          }
          break;
        case "playerFieldCount": {
          const monstersOnly = cond.monstersOnly !== false;
          const zone = player?.field || [];
          const count = monstersOnly
            ? zone.filter((c) => c && c.cardKind === "monster").length
            : zone.filter(Boolean).length;
          if (cond.count !== undefined && count !== cond.count) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `You must control exactly ${cond.count} monster(s).`,
            };
          }
          if (cond.min !== undefined && count < cond.min) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `You must control at least ${cond.min} monster(s).`,
            };
          }
          if (cond.max !== undefined && count > cond.max) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `You must control at most ${cond.max} monster(s).`,
            };
          }
          break;
        }
        case "control_card": {
          const ownerKey = cond.owner === "opponent" ? "opponent" : "player";
          const owner = ownerKey === "opponent" ? opponent : player;
          const zoneName = cond.zone || "field";
          const requireFaceup = cond.requireFaceup !== false;
          const source = ctx?.source || null;
          const normalizedFilters = { ...(cond.filters || {}) };
          if (
            cond.cardName &&
            !normalizedFilters.cardName &&
            !normalizedFilters.name
          ) {
            normalizedFilters.cardName = cond.cardName;
          }
          if (
            cond.cardId !== undefined &&
            cond.cardId !== null &&
            normalizedFilters.cardId === undefined &&
            normalizedFilters.id === undefined
          ) {
            normalizedFilters.cardId = cond.cardId;
          }
          if (
            Array.isArray(cond.cardIds) &&
            cond.cardIds.length > 0 &&
            !Array.isArray(normalizedFilters.cardIds) &&
            !Array.isArray(normalizedFilters.ids)
          ) {
            normalizedFilters.cardIds = cond.cardIds;
          }
          if (cond.name && !normalizedFilters.name && !normalizedFilters.cardName) {
            normalizedFilters.name = cond.name;
          }
          const hasFilters = Object.keys(normalizedFilters).length > 0;
          if (!hasFilters) {
            return {
              ok: false,
              reason: "Invalid condition configuration.",
            };
          }
          const zone = owner?.[zoneName] || [];
          const found = zone.some((card) => {
            if (!card) return false;
            if (requireFaceup && card.isFacedown) return false;
            if (cond.excludeSource === true && source && card === source) {
              return false;
            }
            return this.cardMatchesFilters(card, normalizedFilters);
          });
          if (!found) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `You must control "${normalizedFilters.cardName || "this card"}".`,
            };
          }
          break;
        }
        case "destroyed_card_matches_declared_value": {
          const source = ctx?.source || null;
          const stateKey = cond.stateKey || cond.key || null;
          const property = cond.property || "type";
          const declaration = stateKey
            ? source?.declaredValues?.[stateKey]
            : null;

          if (!declaration) {
            return {
              ok: false,
              reason: cond.reason || "No declared value.",
            };
          }

          if (
            Number.isFinite(declaration.expiresOnTurn) &&
            this.game &&
            this.game.turnCounter > declaration.expiresOnTurn
          ) {
            delete source.declaredValues[stateKey];
            return {
              ok: false,
              reason: cond.reason || "Declared value expired.",
            };
          }

          const destroyedCard =
            ctx?.destroyed || ctx?.eventCard || ctx?.target || null;
          const actualValues = Array.isArray(destroyedCard?.[property])
            ? destroyedCard[property]
            : destroyedCard?.[property] !== undefined
              ? [destroyedCard[property]]
              : [];
          if (!actualValues.includes(declaration.value)) {
            return {
              ok: false,
              reason: cond.reason || "Destroyed card does not match declaration.",
            };
          }
          break;
        }
        case "battle_destroyer_matches_filters": {
          const filters = cond.filters || {};
          const ownerKey = cond.owner || "self";
          const expectedOwner =
            ownerKey === "opponent"
              ? opponent
              : ownerKey === "any"
                ? null
                : player;
          const battleDestroyers = Array.isArray(ctx?.battleDestroyers)
            ? ctx.battleDestroyers
            : [ctx?.battleDestroyer, ctx?.attacker].filter(Boolean);

          const getController = (card) => {
            if (!card) return null;
            if (player?.field?.includes?.(card)) return player;
            if (opponent?.field?.includes?.(card)) return opponent;
            if (card.controller === player?.id || card.owner === player?.id) {
              return player;
            }
            if (
              card.controller === opponent?.id ||
              card.owner === opponent?.id
            ) {
              return opponent;
            }
            return null;
          };

          const found = battleDestroyers.some((card) => {
            if (!card) return false;
            if (expectedOwner && getController(card) !== expectedOwner) {
              return false;
            }
            return this.cardMatchesFilters(card, filters);
          });

          if (!found) {
            return {
              ok: false,
              reason:
                cond.reason || "No battle destroyer matched the condition.",
            };
          }
          break;
        }
        case "event_card_matches_filters": {
          const card = getEventCardByRef(cond, ctx);
          if (cond.excludeSource === true && isSameCardReference(card, ctx?.source)) {
            return {
              ok: false,
              reason: cond.reason || "Event card matched the effect source.",
            };
          }
          const ownerKey = cond.owner || "any";
          if (ownerKey !== "any") {
            const expectedOwner = ownerKey === "opponent" ? opponent : player;
            const eventOwner =
              (ctx?.destroyed === card && ctx?.destroyedOwner) ||
              (ctx?.eventCard === card && ctx?.eventPlayer) ||
              (ctx?.movedCard === card && ctx?.eventPlayer) ||
              null;
            const eventOwnerId =
              eventOwner?.id || eventOwner || card?.controller || card?.owner;
            if (!expectedOwner || eventOwnerId !== expectedOwner.id) {
              return {
                ok: false,
                reason: cond.reason || "Event card owner did not match.",
              };
            }
          }
          if (!card || !this.cardMatchesFilters(card, cond.filters || {})) {
            return {
              ok: false,
              reason: cond.reason || "Event card did not match filters.",
            };
          }
          break;
        }
        case "event_card_matches_declared_value_from_effect_sources": {
          const card = getEventCardByRef(cond, ctx);
          const property = cond.property || "type";
          const sourceFilters = cond.sourceFilters || {};
          const stateKey = cond.stateKey || cond.key || null;
          if (!card) {
            return {
              ok: false,
              reason: cond.reason || "Event card was not available.",
            };
          }

          const declarationMatches = (declaredValues) => {
            if (!declaredValues || typeof declaredValues !== "object") {
              return false;
            }
            const entries = stateKey
              ? [[stateKey, declaredValues[stateKey]]]
              : Object.entries(declaredValues);
            return entries.some(([, declaration]) =>
              declarationMatchesCard(this.game, declaration, card, property),
            );
          };

          const owners = getConditionOwners(cond.owner || "self", player, opponent);
          const activeMatch = owners.some((owner) =>
            activeDeclarationSourcesForOwner(owner).some((source) => {
              if (!sourceMatchesDeclaredFilters(this, source, sourceFilters)) {
                return false;
              }
              return declarationMatches(source.declaredValues);
            }),
          );
          if (activeMatch) break;

          const temporaryEffects = Array.isArray(this.game?.temporaryEventEffects)
            ? this.game.temporaryEventEffects
            : [];
          const temporaryMatch = owners.some((owner) =>
            temporaryEffects.some((entry) => {
              if (!entry || entry.ownerId !== owner?.id) return false;
              if (
                Number.isFinite(entry.expiresOnTurn) &&
                this.game &&
                Number(this.game.turnCounter || 0) > entry.expiresOnTurn
              ) {
                return false;
              }
              const source = buildTemporaryEffectSource(this.game, entry);
              if (!sourceMatchesDeclaredFilters(this, source, sourceFilters)) {
                return false;
              }
              return declarationMatches(entry.declaredValues);
            }),
          );
          if (!temporaryMatch) {
            return {
              ok: false,
              reason:
                cond.reason ||
                "Event card did not match any declared value from matching effects.",
            };
          }
          break;
        }
        case "battle_participant_matches_filters": {
          const ownerKey = cond.owner || "self";
          const expectedOwner =
            ownerKey === "opponent"
              ? opponent
              : ownerKey === "any"
                ? null
                : player;
          const participants = expectedOwner
            ? [getBattleParticipantForOwner(ctx, expectedOwner)]
            : [ctx?.attacker, ctx?.defender || ctx?.target].filter(Boolean);
          const found = participants.some((card) => {
            if (!card) return false;
            return this.cardMatchesFilters(card, cond.filters || {});
          });
          if (!found) {
            return {
              ok: false,
              reason:
                cond.reason || "No battle participant matched the condition.",
            };
          }
          break;
        }
        case "battle_opponent_matches_declared_value": {
          const source = ctx?.source || null;
          const stateKey = cond.stateKey || cond.key || null;
          const property = cond.property || "type";
          const declaration = stateKey
            ? source?.declaredValues?.[stateKey]
            : null;
          if (!declaration) {
            return {
              ok: false,
              reason: cond.reason || "No declared value.",
            };
          }
          if (
            Number.isFinite(declaration.expiresOnTurn) &&
            this.game &&
            this.game.turnCounter > declaration.expiresOnTurn
          ) {
            delete source.declaredValues[stateKey];
            return {
              ok: false,
              reason: cond.reason || "Declared value expired.",
            };
          }
          const battleOpponent = getBattleParticipantForOwner(ctx, opponent);
          const actualValues = asArray(battleOpponent?.[property]);
          if (!actualValues.includes(declaration.value)) {
            return {
              ok: false,
              reason:
                cond.reason || "Battle opponent does not match declaration.",
            };
          }
          break;
        }
        case "summoned_card_has_marker": {
          const key = cond.key || cond.stateKey || null;
          const summonedCard = ctx?.summonedCard || ctx?.card || null;
          const marker = key ? summonedCard?.effectMarkers?.[key] : null;

          if (!marker) {
            return {
              ok: false,
              reason: cond.reason || "Summoned card does not have marker.",
            };
          }

          if (
            Number.isFinite(marker.expiresOnTurn) &&
            this.game &&
            this.game.turnCounter > marker.expiresOnTurn
          ) {
            delete summonedCard.effectMarkers[key];
            return {
              ok: false,
              reason: cond.reason || "Summoned card marker expired.",
            };
          }

          if (
            cond.sourceEffectId &&
            marker.sourceEffectId !== cond.sourceEffectId
          ) {
            return {
              ok: false,
              reason: cond.reason || "Marker source effect does not match.",
            };
          }

          if (cond.sourceRef) {
            const refSource = resolveSourceRef(ctx, cond.sourceRef);
            if (!markerMatchesSource(marker, refSource)) {
              return {
                ok: false,
                reason: cond.reason || "Marker source does not match.",
              };
            }
          }

          if (cond.controllerId && marker.controllerId !== cond.controllerId) {
            return {
              ok: false,
              reason: cond.reason || "Marker controller does not match.",
            };
          }
          break;
        }
        case "field_card_count": {
          const zones =
            Array.isArray(cond.zones) && cond.zones.length > 0
              ? cond.zones
              : [cond.zone || "field"];
          const filters = cond.filters || {};
          const requireFaceup = cond.requireFaceup === true;
          let count = 0;
          for (const owner of getConditionOwners(cond.owner || "self", player, opponent)) {
            for (const zoneKey of zones) {
              for (const card of getConditionZoneCards(owner, zoneKey)) {
                if (!card) continue;
                if (requireFaceup && card.isFacedown) continue;
                if (
                  cond.excludeSource === true &&
                  isSameCardReference(card, ctx?.source)
                ) {
                  continue;
                }
                if (!this.cardMatchesFilters(card, filters)) continue;
                count += 1;
              }
            }
          }
          if (cond.count !== undefined && count !== cond.count) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `Expected exactly ${cond.count} matching card(s).`,
            };
          }
          if (cond.min !== undefined && count < cond.min) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `Expected at least ${cond.min} matching card(s).`,
            };
          }
          if (cond.max !== undefined && count > cond.max) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `Expected at most ${cond.max} matching card(s).`,
            };
          }
          break;
        }
        case "activation_would_destroy_cards_matching_filters": {
          const result = activationWouldDestroyCardsMatchingFilters(
            this,
            cond,
            ctx,
          );
          if (!result.ok) return result;
          break;
        }
        case "activation_would_make_card_leave_field": {
          const result = activationWouldMakeCardLeaveField(this, cond, ctx);
          if (!result.ok) return result;
          break;
        }
        case "control_card_max": {
          const ownerKey = cond.owner === "opponent" ? "opponent" : "player";
          const owner = ownerKey === "opponent" ? opponent : player;
          const zoneName = cond.zone || "field";
          const includeFacedown = cond.includeFacedown !== false;
          const max = cond.max ?? 0;
          const source = ctx?.source || null;
          const normalizedFilters = { ...(cond.filters || {}) };
          if (
            cond.cardName &&
            !normalizedFilters.cardName &&
            !normalizedFilters.name
          ) {
            normalizedFilters.cardName = cond.cardName;
          }
          if (
            cond.cardId !== undefined &&
            cond.cardId !== null &&
            normalizedFilters.cardId === undefined &&
            normalizedFilters.id === undefined
          ) {
            normalizedFilters.cardId = cond.cardId;
          }
          if (
            Array.isArray(cond.cardIds) &&
            cond.cardIds.length > 0 &&
            !Array.isArray(normalizedFilters.cardIds) &&
            !Array.isArray(normalizedFilters.ids)
          ) {
            normalizedFilters.cardIds = cond.cardIds;
          }
          if (cond.name && !normalizedFilters.name && !normalizedFilters.cardName) {
            normalizedFilters.name = cond.name;
          }
          const hasFilters = Object.keys(normalizedFilters).length > 0;
          if (!hasFilters) {
            return {
              ok: false,
              reason: "Invalid condition configuration.",
            };
          }
          const zone =
            zoneName === "fieldSpell"
              ? owner?.fieldSpell
                ? [owner.fieldSpell]
                : []
              : owner?.[zoneName] || [];
          const count = zone.filter((card) => {
            if (!card) return false;
            if (!includeFacedown && card.isFacedown) return false;
            if (cond.excludeSource === true && source && card === source) {
              return false;
            }
            return this.cardMatchesFilters(card, normalizedFilters);
          }).length;
          if (count > max) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `You can only control up to ${max} "${
                  normalizedFilters.cardName || "this card"
                }".`,
            };
          }
          break;
        }
        case "any_of": {
          const options = Array.isArray(cond.conditions)
            ? cond.conditions
            : Array.isArray(cond.anyOf)
              ? cond.anyOf
              : [];
          if (options.length === 0) {
            break;
          }
          let anyOk = false;
          let lastReason = null;
          for (const option of options) {
            const result = this.evaluateConditions([option], ctx);
            if (result.ok) {
              anyOk = true;
              break;
            }
            if (result.reason) {
              lastReason = result.reason;
            }
          }
          if (!anyOk) {
            return {
              ok: false,
              reason: cond.reason || lastReason || "No valid options.",
            };
          }
          break;
        }
        case "control_card_filters": {
          const ownerKey = cond.owner === "opponent" ? "opponent" : "player";
          const owner = ownerKey === "opponent" ? opponent : player;
          const zoneList =
            Array.isArray(cond.zones) && cond.zones.length > 0
              ? cond.zones
              : [cond.zone || "field"];
          const filters = cond.filters || {};
          const cardKind = filters.cardKind ?? cond.cardKind;
          const subtype = filters.subtype ?? cond.subtype;
          const archetype = filters.archetype ?? cond.archetype;
          const equippedWithFilters =
            filters.equippedWithFilters ?? cond.equippedWithFilters;
          const cardName =
            filters.cardName ?? filters.name ?? cond.cardName ?? cond.name;
          const includeFacedown = cond.includeFacedown === true;
          const requireFaceup =
            cond.requireFaceup !== false && !includeFacedown;
          const min = filters.min ?? cond.min;
          const max = filters.max ?? cond.max;
          const requiredMin =
            min !== undefined ? min : max !== undefined ? 0 : 1;
          const source = ctx?.source || null;

          const matchesFilters = (card) => {
            if (!card) return false;
            if (cond.excludeSource === true && source && card === source) {
              return false;
            }
            if (requireFaceup && card.isFacedown) return false;
            if (cardKind) {
              const requiredKinds = Array.isArray(cardKind)
                ? cardKind
                : [cardKind];
              if (!requiredKinds.includes(card.cardKind)) return false;
            }
            if (subtype) {
              const requiredSubtypes = Array.isArray(subtype)
                ? subtype
                : [subtype];
              if (!requiredSubtypes.includes(card.subtype)) return false;
            }
            if (archetype) {
              const requiredArchetypes = Array.isArray(archetype)
                ? archetype
                : [archetype];
              const cardArchetypes = card.archetypes
                ? card.archetypes
                : card.archetype
                  ? [card.archetype]
                  : [];
              const hasMatch = requiredArchetypes.some((arc) =>
                cardArchetypes.includes(arc),
              );
              if (!hasMatch) return false;
            }
            if (cardName) {
              const requiredNames = Array.isArray(cardName)
                ? cardName
                : [cardName];
              if (!requiredNames.includes(card.name)) return false;
            }
            if (equippedWithFilters) {
              const equipFilters = equippedWithFilters || {};
              const requireEquipFaceup = equipFilters.requireFaceup !== false;
              const equips = Array.isArray(card.equips) ? card.equips : [];
              const hasMatchingEquip = equips.some((equip) => {
                if (!equip) return false;
                if (!this.isActiveEquipForCard(equip, card)) return false;
                if (requireEquipFaceup && equip.isFacedown) return false;
                return this.cardMatchesFilters(equip, equipFilters);
              });
              if (!hasMatchingEquip) return false;
            }
            return true;
          };

          let count = 0;
          for (const zoneKey of zoneList) {
            const zone =
              zoneKey === "fieldSpell"
                ? owner?.fieldSpell
                  ? [owner.fieldSpell]
                  : []
                : owner?.[zoneKey] || [];
            count += zone.filter(matchesFilters).length;
          }

          if (Number.isFinite(requiredMin) && count < requiredMin) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `You must control at least ${requiredMin} matching card(s).`,
            };
          }
          if (max !== undefined && count > max) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `You can only control up to ${max} matching card(s).`,
            };
          }
          break;
        }
        case "equipped_with_filters": {
          const source = ctx?.source;
          const filters = cond.filters || {};
          const requireFaceup = cond.requireFaceup !== false;
          const min =
            cond.min !== undefined ? cond.min : cond.max !== undefined ? 0 : 1;
          const max = cond.max;
          const equips = Array.isArray(source?.equips) ? source.equips : [];
          let count = 0;

          for (const equip of equips) {
            if (!equip) continue;
            if (!this.isActiveEquipForCard(equip, source)) continue;
            if (requireFaceup && equip.isFacedown) continue;
            if (!this.cardMatchesFilters(equip, filters)) continue;
            count += 1;
          }

          if (Number.isFinite(min) && count < min) {
            return {
              ok: false,
              reason:
                cond.reason ||
                "This card is not equipped with a matching card.",
            };
          }
          if (max !== undefined && count > max) {
            return {
              ok: false,
              reason:
                cond.reason || "This card has too many matching equip cards.",
            };
          }
          break;
        }
        case "turn_player": {
          const expected = cond.player || cond.turn || cond.owner;
          const expectedId =
            expected === "self"
              ? player?.id
              : expected === "opponent"
                ? opponent?.id
                : expected;
          if (!expectedId) {
            return { ok: false, reason: "Invalid condition configuration." };
          }
          if (this.game?.turn !== expectedId) {
            return {
              ok: false,
              reason: cond.reason || "Not the correct turn.",
            };
          }
          break;
        }
        case "has_stored_blueprint": {
          const sourceCard = ctx?.source || null;
          const min = Number(cond.min ?? 1);
          const storageState = this.getBlueprintStorageState?.(
            sourceCard,
            false,
          );
          const storedCount = storageState?.storedBlueprints?.length || 0;
          if (storedCount < min) {
            return {
              ok: false,
              reason: cond.reason || "No stored effect available.",
            };
          }
          break;
        }
        case "control_card_type": {
          const ownerKey = cond.owner === "opponent" ? "opponent" : "player";
          const owner = ownerKey === "opponent" ? opponent : player;
          const zoneName = cond.zone || "field";
          const requireFaceup = cond.requireFaceup !== false;
          const typeName = cond.typeName || cond.cardType;
          if (!typeName) {
            return { ok: false, reason: "Invalid condition configuration." };
          }
          const zone = owner?.[zoneName] || [];
          const found = zone.some((card) => {
            if (!card || card.cardKind !== "monster") return false;
            if (requireFaceup && card.isFacedown) return false;
            if (Array.isArray(card.types)) {
              return card.types.includes(typeName);
            }
            return card.type === typeName;
          });
          if (!found) {
            return {
              ok: false,
              reason: cond.reason || `You must control a ${typeName} monster.`,
            };
          }
          break;
        }
        case "opponentMonstersMin":
          if ((opponent?.field?.length || 0) < (cond.min ?? 1)) {
            return {
              ok: false,
              reason: `Opponent must control at least ${
                cond.min ?? 1
              } monster(s).`,
            };
          }
          break;
        case "playerLpMin":
          if ((player?.lp ?? 0) < (cond.min ?? cond.amount ?? 0)) {
            return {
              ok: false,
              reason: `Need at least ${cond.min ?? cond.amount ?? 0} LP.`,
            };
          }
          break;
        case "graveyardHasMatch": {
          const ownerKey = cond.owner === "opponent" ? "opponent" : "player";
          const owner = ownerKey === "opponent" ? opponent : player;
          const zoneName = cond.zone || "graveyard";
          const zone = owner?.[zoneName] || [];
          const found = zone.some((card) =>
            this.cardMatchesFilters(card, cond.filters || {}),
          );
          if (!found) {
            return {
              ok: false,
              reason: cond.reason || "No valid cards in graveyard.",
            };
          }
          break;
        }
        case "control_type_min_level": {
          const zoneName = cond.zone || "field";
          const requireFaceup = cond.requireFaceup !== false; // default true
          const typeName = cond.typeName || cond.cardType;
          const minLevel = cond.minLevel ?? cond.level ?? 1;
          if (!typeName) {
            return { ok: false, reason: "Invalid condition configuration." };
          }
          const zone = player?.[zoneName] || [];
          const hasMatch = zone.some((c) => {
            if (!c) return false;
            if (c.cardKind !== "monster") return false;
            if (requireFaceup && c.isFacedown) return false;
            const lvl = c.level || 0;
            const type = c.type || null;
            const types = Array.isArray(c.types) ? c.types : null;
            const typeOk = types ? types.includes(typeName) : type === typeName;
            return typeOk && lvl >= minLevel;
          });
          if (!hasMatch) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `You must control a ${typeName} with Level ≥ ${minLevel}.`,
            };
          }
          break;
        }
        case "attacker_matches": {
          const attacker = ctx?.attacker;
          if (!attacker) {
            return { ok: false, reason: "No attacker in context." };
          }
          const ownerRule = cond.owner || "any"; // self | opponent | any
          const attackerOwner = this.getOwnerByCard(attacker);
          if (ownerRule === "self" && attackerOwner?.id !== player?.id) {
            return { ok: false, reason: "Attacker is not yours." };
          }
          if (ownerRule === "opponent" && attackerOwner?.id === player?.id) {
            return { ok: false, reason: "Attacker is not opponent's." };
          }
          // Match filters: monster race/type, cardKind, level bounds.
          // `cond.type` is the condition discriminator ("attacker_matches").
          if (cond.cardKind && attacker.cardKind !== cond.cardKind) {
            return { ok: false, reason: "Attacker kind mismatch." };
          }
          const requiredType =
            cond.attackerType || cond.monsterType || cond.cardType || cond.race;
          if (requiredType) {
            const aType = attacker.type || null;
            const aTypes = Array.isArray(attacker.types)
              ? attacker.types
              : null;
            const ok = Array.isArray(requiredType)
              ? aTypes
                ? requiredType.some((t) => aTypes.includes(t))
                : requiredType.includes(aType)
              : aTypes
                ? aTypes.includes(requiredType)
                : aType === requiredType;
            if (!ok) {
              return { ok: false, reason: "Attacker type mismatch." };
            }
          }
          if (cond.archetype) {
            const requiredArchetypes = Array.isArray(cond.archetype)
              ? cond.archetype
              : [cond.archetype];
            const cardArchetypes = attacker.archetypes
              ? attacker.archetypes
              : attacker.archetype
                ? [attacker.archetype]
                : [];
            const hasMatch = requiredArchetypes.some((arc) =>
              cardArchetypes.includes(arc),
            );
            if (!hasMatch) {
              return { ok: false, reason: "Attacker archetype mismatch." };
            }
          }
          const lvl = attacker.level || 0;
          if (cond.minLevel !== undefined && lvl < cond.minLevel) {
            return { ok: false, reason: "Attacker level too low." };
          }
          if (cond.maxLevel !== undefined && lvl > cond.maxLevel) {
            return { ok: false, reason: "Attacker level too high." };
          }
          break;
        }
        case "source_counters_at_least": {
          const counterType = cond.counterType || "default";
          const min = Number(cond.min ?? 1);
          const source = ctx?.source;
          const count =
            typeof source?.getCounter === "function"
              ? source.getCounter(counterType)
              : 0;
          if (count < min) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `Need at least ${min} ${counterType} counter(s).`,
            };
          }
          break;
        }
        case "field_counters_at_least": {
          const counterType = cond.counterType || "default";
          const min = Number(cond.min ?? cond.amount ?? 1);
          const ownerRule = cond.owner || "self";
          const owners =
            ownerRule === "opponent"
              ? [opponent]
              : ownerRule === "any"
                ? [player, opponent]
                : [player];
          const zones =
            Array.isArray(cond.zones) && cond.zones.length > 0
              ? cond.zones
              : [cond.zone || "field"];
          const filters = cond.filters || {};
          const requireFaceup = cond.requireFaceup === true;
          let count = 0;

          for (const owner of owners.filter(Boolean)) {
            for (const zoneKey of zones) {
              const zone =
                zoneKey === "fieldSpell"
                  ? owner.fieldSpell
                    ? [owner.fieldSpell]
                    : []
                  : owner[zoneKey] || [];
              for (const card of zone) {
                if (!card) continue;
                if (requireFaceup && card.isFacedown) continue;
                if (
                  Object.keys(filters).length > 0 &&
                  !this.cardMatchesFilters(card, filters)
                ) {
                  continue;
                }
                count +=
                  typeof card.getCounter === "function"
                    ? card.getCounter(counterType)
                    : 0;
              }
            }
          }

          if (count < min) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `Need at least ${min} ${counterType} counter(s) on the field.`,
            };
          }
          break;
        }
        default:
          break;
      }
    }

    return { ok: true };
  }
