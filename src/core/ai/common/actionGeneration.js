/**
 * Shared AI action generation primitives.
 *
 * These helpers are intentionally strategy-neutral: they do not import
 * strategies, do not know card names, and do not apply macro/safety policy
 * unless the caller explicitly provides it.
 */

function hasValue(value) {
  return value !== undefined && value !== null;
}

function finiteOr(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function applyIndex(action, key, value) {
  if (hasValue(value)) action[key] = value;
}

function resolveExtra(extra, context) {
  if (typeof extra === "function") return extra(context) || {};
  return extra || {};
}

function isActionAllowed(result) {
  return result !== false && result?.ok !== false;
}

function defaultIgnitionCardFilter(card, zone) {
  if (!card) return false;
  if (zone === "spellTrap") {
    return card.cardKind === "spell" && !card.isFacedown;
  }
  if (zone === "field") {
    return card.cardKind === "monster" && !card.isFacedown;
  }
  return true;
}

function resolveSafetyAdjustment(safetyPolicy, context) {
  if (!safetyPolicy) return 0;

  if (typeof safetyPolicy === "function") {
    const result = safetyPolicy(context);
    if (Number.isFinite(result)) return result;
    if (Number.isFinite(result?.adjustment)) return result.adjustment;
    if (Number.isFinite(result?.priority)) {
      return result.priority - context.priority;
    }
    return 0;
  }

  const recommendation = context.safety?.recommendation;
  if (hasValue(recommendation) && Number.isFinite(safetyPolicy[recommendation])) {
    return safetyPolicy[recommendation];
  }

  return finiteOr(safetyPolicy.default, 0);
}

/**
 * Build a prioritized action while preserving the existing action shape.
 * Optional fields are only included when provided; `extra` is applied last so
 * callers can opt into exact per-strategy fields or overrides.
 */
export function buildPrioritizedAction({
  type,
  index,
  fieldIndex,
  zoneIndex,
  graveyardIndex,
  materialIndex,
  card,
  priority = 0,
  reason = null,
  effect = null,
  activationContext = null,
  extra = {},
} = {}) {
  const action = {
    type,
    priority,
  };

  applyIndex(action, "index", index);
  applyIndex(action, "fieldIndex", fieldIndex);
  applyIndex(action, "zoneIndex", zoneIndex);
  applyIndex(action, "graveyardIndex", graveyardIndex);
  applyIndex(action, "materialIndex", materialIndex);

  if (hasValue(card?.id)) action.cardId = card.id;
  if (hasValue(card?.name)) action.cardName = card.name;
  if (hasValue(effect?.id)) action.effectId = effect.id;
  if (hasValue(reason)) action.reason = reason;
  if (hasValue(activationContext)) {
    action.activationContext = activationContext;
  }

  return {
    ...action,
    ...(extra || {}),
  };
}

/**
 * Build hand spell actions using caller-owned policy, context and preview.
 */
export function getGenericHandSpellActions({
  game,
  player,
  hand = player?.hand || [],
  analysis,
  shouldPlay,
  buildActivationContext,
  canActivate,
  type = "spell",
  extra = {},
} = {}) {
  const actions = [];
  for (const [index, card] of (hand || []).entries()) {
    if (!card || card.cardKind !== "spell") continue;

    const context = { game, player, analysis, index, card };
    const decision =
      typeof shouldPlay === "function"
        ? shouldPlay(card, analysis, context)
        : { yes: true };
    if (!decision?.yes) continue;

    const activationContext =
      typeof buildActivationContext === "function"
        ? buildActivationContext(card, analysis, { ...context, decision })
        : null;
    const canUse =
      typeof canActivate === "function"
        ? canActivate({ ...context, decision, activationContext })
        : true;
    if (!isActionAllowed(canUse)) continue;

    actions.push(
      buildPrioritizedAction({
        type,
        index,
        card,
        priority: decision.priority || 1,
        reason: decision.reason,
        activationContext,
        extra: resolveExtra(extra, {
          ...context,
          decision,
          activationContext,
        }),
      }),
    );
  }
  return actions;
}

/**
 * Build normal summon actions using caller-owned tribute and summon policy.
 */
export function getGenericNormalSummonActions({
  player,
  hand = player?.hand || [],
  analysis,
  getTributeRequirement,
  shouldSummon,
  type = "summon",
  extra = {},
} = {}) {
  const actions = [];
  if (!analysis?.canNormalSummon || analysis.fieldCapacity <= 0) {
    return actions;
  }

  for (const [index, card] of (hand || []).entries()) {
    if (!card || card.cardKind !== "monster") continue;
    if (card.cannotBeNormalSummonedOrSet) continue;

    const context = { player, analysis, index, card };
    const tributeInfo =
      typeof getTributeRequirement === "function"
        ? getTributeRequirement(card, player, context)
        : {};
    const decision =
      typeof shouldSummon === "function"
        ? shouldSummon(card, analysis, tributeInfo, {
            ...context,
            tributeInfo,
          })
        : { yes: true };
    if (!decision?.yes) continue;

    actions.push(
      buildPrioritizedAction({
        type,
        index,
        card,
        priority: decision.priority || 1,
        reason: decision.reason,
        extra: {
          position: decision.position || "attack",
          facedown: false,
          ...resolveExtra(extra, {
            ...context,
            tributeInfo,
            decision,
          }),
        },
      }),
    );
  }

  return actions;
}

/**
 * Build ignition-style effect actions with caller-owned discovery and preview.
 */
export function getGenericIgnitionEffectActions({
  game,
  player,
  cards = [],
  analysis,
  type,
  sourceZone,
  indexFields = ["index"],
  findEffect,
  shouldActivate,
  buildActivationContext,
  canActivate,
  cardFilter = defaultIgnitionCardFilter,
  includeEffectId = false,
  extra = {},
} = {}) {
  const actions = [];
  for (const [sourceIndex, card] of (cards || []).entries()) {
    if (!card || !cardFilter(card, sourceZone, { player, sourceIndex })) {
      continue;
    }

    const context = {
      game,
      player,
      analysis,
      sourceIndex,
      card,
      sourceZone,
    };
    const effect =
      typeof findEffect === "function"
        ? findEffect(card, sourceZone, context)
        : null;
    if (!effect) continue;

    const decision =
      typeof shouldActivate === "function"
        ? shouldActivate(card, analysis, { ...context, effect })
        : { yes: true };
    if (!decision?.yes) continue;

    const activationContext =
      typeof buildActivationContext === "function"
        ? buildActivationContext(card, analysis, {
            ...context,
            effect,
            decision,
          })
        : null;
    const canUse =
      typeof canActivate === "function"
        ? canActivate({
            ...context,
            effect,
            decision,
            activationContext,
          })
        : true;
    if (!isActionAllowed(canUse)) continue;

    const indexes = {};
    for (const field of indexFields || []) {
      indexes[field] = sourceIndex;
    }

    actions.push(
      buildPrioritizedAction({
        type,
        ...indexes,
        card,
        effect: includeEffectId ? effect : null,
        priority: decision.priority || 1,
        reason: decision.reason,
        activationContext,
        extra: resolveExtra(extra, {
          ...context,
          effect,
          decision,
          activationContext,
        }),
      }),
    );
  }

  return actions;
}

/**
 * Combine opt-in macro and safety adjustments for action priority.
 * The helper never computes safety itself; callers pass precomputed safety and
 * policy when they want those metadata reflected.
 */
export function applyMacroAndSafety({
  basePriority = 0,
  actionType,
  card,
  macroStrategy,
  safety = null,
  macroBonusFn = null,
  safetyPolicy = null,
} = {}) {
  const normalizedBasePriority = finiteOr(basePriority, 0);
  let priority = normalizedBasePriority;
  let macroBuff = 0;

  if (typeof macroBonusFn === "function") {
    macroBuff = finiteOr(macroBonusFn(actionType, card, macroStrategy), 0);
    priority += macroBuff;
  }

  const safetyScore = Number.isFinite(safety?.riskScore)
    ? safety.riskScore
    : null;
  const safetyAdjustment = resolveSafetyAdjustment(safetyPolicy, {
    priority,
    basePriority: normalizedBasePriority,
    actionType,
    card,
    macroStrategy,
    safety,
    macroBuff,
    safetyScore,
  });

  priority += safetyAdjustment;

  return {
    priority,
    macroBuff,
    safetyScore,
    safetyAdjustment,
  };
}

/**
 * Create a shallow shared context for action-generation helpers.
 * `extra` is applied last so future callers can add or override fields without
 * changing this helper's core contract.
 */
export function createActionGenerationContext({
  game,
  strategy,
  bot,
  opponent,
  analysis,
  actualGame,
  isSimulatedState,
  macroStrategy,
  activationContext,
  log,
  extra = {},
} = {}) {
  return {
    game,
    strategy,
    bot,
    opponent,
    analysis,
    actualGame,
    isSimulatedState,
    macroStrategy,
    activationContext,
    log,
    ...(extra || {}),
  };
}
