import { cardMatchesKind } from "../../Card.js";

/**
 * Actions Core - applyActions dispatcher and preview requirements
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

export function actionResultSucceeded(result) {
  if (result === true) return true;
  return (
    result &&
    typeof result === "object" &&
    result.success !== false &&
    result.needsSelection !== true
  );
}

function isActionResultFailure(result) {
  return (
    result === false ||
    (result &&
      typeof result === "object" &&
      result.success === false &&
      result.needsSelection !== true)
  );
}

function isActionOptionalNoop(action) {
  if (!action) return false;
  if (action.optional === true) return true;
  const min = Number(action.count?.min);
  return Number.isFinite(min) && min <= 0;
}

function createActionResult({
  success,
  executed = false,
  failedAction = null,
  reason = null,
  error = null,
  action = null,
  skippedCount = 0,
} = {}) {
  const result = {
    success: success !== false,
    executed: executed === true,
    needsSelection: false,
  };
  if (failedAction) result.failedAction = failedAction;
  if (reason) result.reason = reason;
  if (error) result.error = error;
  if (action) result.action = action;
  if (skippedCount) result.skippedCount = skippedCount;
  return result;
}

function getTargetCards(targets) {
  const cards = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (typeof value === "object" && value.card) {
      visit(value.card);
      return;
    }
    if (typeof value === "object") {
      cards.push(value);
    }
  };

  for (const value of Object.values(targets || {})) {
    visit(value);
  }
  return cards;
}

function findOwnerForTarget(game, fallbackOwner, card) {
  if (!game || !card) return fallbackOwner || null;
  const owners = [game.player, game.bot].filter(Boolean);
  const zones = [
    "field",
    "spellTrap",
    "hand",
    "graveyard",
    "deck",
    "extraDeck",
    "banished",
  ];

  for (const owner of owners) {
    if (owner.fieldSpell === card) return owner;
    for (const zone of zones) {
      if (Array.isArray(owner[zone]) && owner[zone].includes(card)) {
        return owner;
      }
    }
  }

  const explicitOwner = owners.find(
    (owner) => owner.id === card.owner || owner.id === card.controller,
  );
  return explicitOwner || fallbackOwner || null;
}

async function emitEffectTargetedBeforeActions(engine, ctx, targets, logDev) {
  const game = engine?.game;
  const source = ctx?.source;
  const sourcePlayer = ctx?.player;
  if (!game || !source || !sourcePlayer || !targets) return null;
  if (ctx?.isPreview || ctx?.previewOnly) return null;
  let activationContext = ctx?.activationContext || null;
  if (!activationContext) {
    activationContext = {};
    ctx.activationContext = activationContext;
  }
  if (activationContext?.skipEffectTargetedEvent === true) return null;
  if (activationContext?._effectTargetedResolved === true) return null;

  const targetCards = getTargetCards(targets);
  if (targetCards.length === 0) return null;

  const emitted = new Set();
  activationContext._effectTargetedOpened = true;
  for (const target of targetCards) {
    if (!target) continue;
    const targetOwner = findOwnerForTarget(game, null, target);
    if (!targetOwner || targetOwner.id === sourcePlayer.id) continue;

    const key =
      target.instanceId ||
      `${targetOwner.id}:${target.id ?? target.name ?? "unknown"}`;
    if (emitted.has(key)) continue;
    emitted.add(key);

    logDev?.("EFFECT_TARGETED_BEFORE_ACTIONS", {
      source: source.name || null,
      target: target.name || null,
      targetOwner: targetOwner.id || null,
    });

    const result = await game.emit("effect_targeted", {
      source,
      sourceCard: source,
      sourcePlayer,
      player: sourcePlayer,
      target,
      targetOwner,
      targetId: target.id ?? null,
      effect: ctx?.effect || null,
      effectId: ctx?.effect?.id || activationContext?.effectId || null,
      actionContext:
        ctx?.actionContext || activationContext?.actionContext || null,
    });

    if (result?.needsSelection) {
      return {
        ...result,
        success: false,
        executed: false,
        selectionSource: "effect_targeted",
      };
    }
  }

  activationContext._effectTargetedResolved = true;
  return null;
}

/**
 * Main action dispatcher - applies all actions in sequence
 * @param {Array} actions - Array of action definitions
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {Promise<Object>} Normalized execution result or selection request
 */
export async function applyActions(actions, ctx, targets) {
  let executed = false;
  let skippedCount = 0;
  if (!Array.isArray(actions)) {
    return createActionResult({ success: true, executed });
  }

  const logDev =
    this.game?.devLog && ((tag, detail) => this.game.devLog(tag, detail || {}));

  // Propagate selection results (from network resume) into ctx so handlers can consume them.
  const selectionMap =
    ctx?.selections ||
    ctx?.activationContext?.selections ||
    ctx?.actionContext?.selections ||
    null;
  if (ctx && selectionMap && !ctx.selections) {
    ctx.selections = selectionMap;
  }
  const runtimeTargets =
    ctx && targets && typeof targets === "object" && !Array.isArray(targets)
      ? (ctx._actionTargets = ctx._actionTargets || targets)
      : targets || {};

  try {
    const targetedResult = await emitEffectTargetedBeforeActions(
      this,
      ctx,
      runtimeTargets,
      logDev,
    );
    if (targetedResult?.needsSelection) {
      return targetedResult;
    }

    for (const action of actions) {
      const actionInfo = {
        type: action?.type || "unknown",
        source: ctx?.source?.name || null,
        player: ctx?.player?.id || null,
      };

      // Filter targets by immunity before passing to handler
      // This implements the "skip_targets" default behavior (vs "skip_action")
      const immunityResult = this.filterTargetsByImmunity(
        action,
        ctx,
        runtimeTargets,
      );

      if (immunityResult.skipAction) {
        // immunityMode: "skip_action" was set and some targets were immune
        skippedCount += 1;
        logDev?.("ACTION_SKIPPED_IMMUNITY", {
          ...actionInfo,
          mode: "skip_action",
          skippedCount: immunityResult.skippedCount,
        });
        continue;
      }

      // Use filtered targets for the handler
      const filteredTargets = immunityResult.filteredTargets;

      // Log if any targets were skipped
      if (immunityResult.skippedCount > 0) {
        logDev?.("ACTION_TARGETS_FILTERED", {
          ...actionInfo,
          skippedCount: immunityResult.skippedCount,
          allowedCount: immunityResult.allowedCount,
        });
      }

      logDev?.("ACTION_START", actionInfo);

      const handler = this.actionHandlers.get(action.type);
      if (!handler) {
        logDev?.("ACTION_HANDLER_MISSING", actionInfo);
        const reason = `No handler for action type "${action.type}".`;
        console.warn(reason);
        return createActionResult({
          success: false,
          executed,
          failedAction: action.type,
          reason,
          action,
          skippedCount,
        });
      }

      try {
        // Pass filtered targets to handler instead of original targets
        const result = await handler(action, ctx, filteredTargets, this);

        // INVARIANTE B1: Se handler retornou needsSelection, propagar para cima
        if (result && typeof result === "object" && result.needsSelection) {
          logDev?.("ACTION_NEEDS_SELECTION", {
            ...actionInfo,
            selectionKind: result.selectionContract?.kind || "unknown",
          });
          // Retornar imediatamente com o selectionContract
          return {
            ...result,
            success: result.success === true,
            executed,
          };
        }

        if (isActionResultFailure(result)) {
          const isOptional = isActionOptionalNoop(action);
          logDev?.("ACTION_HANDLER_FAILED", {
            ...actionInfo,
            optional: isOptional,
            reason:
              result && typeof result === "object" ? result.reason : null,
          });

          if (isOptional) {
            skippedCount += 1;
            continue;
          }

          return createActionResult({
            success: false,
            executed,
            failedAction: action.type,
            reason:
              (result && typeof result === "object" && result.reason) ||
              `Action "${action.type}" failed.`,
            action,
            skippedCount,
          });
        }

        executed = actionResultSucceeded(result) || executed;
        logDev?.("ACTION_HANDLER_DONE", {
          ...actionInfo,
          handler: true,
          result: result === undefined ? "undefined" : !!result,
        });
      } catch (error) {
        logDev?.("ACTION_HANDLER_ERROR", {
          ...actionInfo,
          error: error.message,
        });
        console.error(
          `Error executing registered handler for action type "${action.type}":`,
          error
        );
        console.error(`Action config:`, action);
        console.error(`Context:`, {
          player: ctx?.player?.id,
          source: ctx?.source?.name,
        });
        return createActionResult({
          success: false,
          executed,
          failedAction: action.type,
          reason: error.message || `Action "${action.type}" threw.`,
          error,
          action,
          skippedCount,
        });
      }
    }
  } catch (err) {
    console.error("Error while applying actions:", err);
    return createActionResult({
      success: false,
      executed,
      reason: err.message || "Error while applying actions.",
      error: err,
      skippedCount,
    });
  }

  return createActionResult({ success: true, executed, skippedCount });
}

function buildPreviewFilters(action) {
  const filters = { ...(action?.filters || {}) };
  if (action?.archetype && !filters.archetype) {
    filters.archetype = action.archetype;
  }
  if (action?.cardKind && !filters.cardKind) {
    filters.cardKind = action.cardKind;
  }
  if (action?.cardName && !filters.name) {
    filters.name = action.cardName;
  }
  if (action?.monsterType && !filters.type) {
    filters.type = action.monsterType;
  }
  if (Number.isFinite(action?.level) && filters.level == null) {
    filters.level = action.level;
  }
  if (action?.levelOp && !filters.levelOp) {
    filters.levelOp = action.levelOp;
  }
  if (Number.isFinite(action?.minLevel) && filters.minLevel == null) {
    filters.minLevel = action.minLevel;
  }
  if (Number.isFinite(action?.maxLevel) && filters.maxLevel == null) {
    filters.maxLevel = action.maxLevel;
  }
  if (Number.isFinite(action?.minAtk) && filters.minAtk == null) {
    filters.minAtk = action.minAtk;
  }
  if (Number.isFinite(action?.maxAtk) && filters.maxAtk == null) {
    filters.maxAtk = action.maxAtk;
  }
  return filters;
}

function buildTargetPreviewFilters(target = {}) {
  const filters = { ...(target.filters || {}) };
  const copyIfPresent = (sourceKey, filterKey = sourceKey) => {
    if (target[sourceKey] !== undefined && filters[filterKey] === undefined) {
      filters[filterKey] = target[sourceKey];
    }
  };

  copyIfPresent("cardKind");
  copyIfPresent("type");
  copyIfPresent("archetype");
  copyIfPresent("name");
  copyIfPresent("cardName", "name");
  copyIfPresent("cardId");
  copyIfPresent("cardIds");
  copyIfPresent("subtype");
  copyIfPresent("monsterType");
  copyIfPresent("level");
  copyIfPresent("levelOp");
  copyIfPresent("minLevel");
  copyIfPresent("maxLevel");
  copyIfPresent("minAtk");
  copyIfPresent("maxAtk");
  copyIfPresent("minDef");
  copyIfPresent("maxDef");
  copyIfPresent("requireFaceup");
  copyIfPresent("isToken");
  copyIfPresent("excludeCardName");
  copyIfPresent("excludeCardNames");
  copyIfPresent("excludeName");
  copyIfPresent("excludeNames");
  copyIfPresent("excludeId");
  copyIfPresent("excludeIds");
  copyIfPresent("excludeCardId");
  copyIfPresent("excludeCardIds");
  copyIfPresent("position");
  copyIfPresent("facedown");
  copyIfPresent("excludeSelf");

  return filters;
}

function matchesPreviewFilters(engine, card, filters, ctx = {}) {
  if (!card) return false;
  if (typeof engine?.cardMatchesFilters === "function") {
    if (!engine.cardMatchesFilters(card, filters)) return false;
  }
  if (filters.excludeSelf && ctx?.source && card === ctx.source) {
    return false;
  }
  if (filters.cardKind && !cardMatchesKind(card, filters.cardKind)) {
    return false;
  }
  if (filters.cardId !== undefined && card.id !== filters.cardId) {
    return false;
  }
  if (
    Array.isArray(filters.cardIds) &&
    filters.cardIds.length > 0 &&
    !filters.cardIds.includes(card.id)
  ) {
    return false;
  }
  if (filters.type) {
    const types = Array.isArray(card.types) ? card.types : [card.type];
    const required = Array.isArray(filters.type) ? filters.type : [filters.type];
    if (!required.some((type) => types.includes(type))) return false;
  }
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  if ((filters.name || filters.cardName) && card.name !== (filters.name || filters.cardName)) {
    return false;
  }
  if (filters.requireFaceup === true && card.isFacedown) {
    return false;
  }
  if (filters.facedown === true && card.isFacedown !== true) {
    return false;
  }
  if (
    filters.position &&
    filters.position !== "any" &&
    card.position !== filters.position
  ) {
    return false;
  }
  if (Number.isFinite(filters.level)) {
    const cardLevel = Number(card.level || 0);
    const levelOp = filters.levelOp || "eq";
    if (levelOp === "eq" && cardLevel !== filters.level) return false;
    if (levelOp === "lte" && cardLevel > filters.level) return false;
    if (levelOp === "gte" && cardLevel < filters.level) return false;
    if (levelOp === "lt" && cardLevel >= filters.level) return false;
    if (levelOp === "gt" && cardLevel <= filters.level) return false;
  }
  if (
    typeof filters.minLevel === "number" &&
    (card.level || 0) < filters.minLevel
  ) {
    return false;
  }
  if (
    typeof filters.maxLevel === "number" &&
    (card.level || 0) > filters.maxLevel
  ) {
    return false;
  }
  return true;
}

function getPreviewTargetOwners(target, ctx, player) {
  const ownerRule = target?.owner || target?.player || "self";
  const opponent = ctx?.opponent;
  if (ownerRule === "opponent") return opponent ? [opponent] : [];
  if (ownerRule === "both" || ownerRule === "any") {
    return [player, opponent].filter(Boolean);
  }
  return player ? [player] : [];
}

function getPreviewCounterOwners(action, ctx, player) {
  const ownerRule = action?.owner || action?.player || "self";
  const opponent = ctx?.opponent;
  if (ownerRule === "opponent") {
    return opponent ? [opponent] : [];
  }
  if (ownerRule === "any" || ownerRule === "both" || ownerRule === "either") {
    return [player, opponent].filter(Boolean);
  }
  return player ? [player] : [];
}

function getPreviewZoneCards(owner, zone) {
  if (!owner || !zone) return [];
  if (zone === "fieldSpell") {
    return owner.fieldSpell ? [owner.fieldSpell] : [];
  }
  const cards = owner[zone];
  return Array.isArray(cards) ? cards.filter(Boolean) : [];
}

function getPreviewTargetZones(target, fallbackZone = "field") {
  const zoneSpec = target?.zones ?? target?.zone ?? fallbackZone;
  return (Array.isArray(zoneSpec) ? zoneSpec : [zoneSpec]).filter(Boolean);
}

function getPreviewTargetMinCount(target, fallback = 1) {
  const raw = target?.count?.min ?? target?.min ?? fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, value) : Math.max(0, fallback);
}

function getPreviewTargetMaxCount(target, fallback = null) {
  const raw = target?.count?.max ?? target?.max ?? fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function getEffectTargetDefinition(ctx, targetRef) {
  if (!targetRef) return null;
  const targetDefs = Array.isArray(ctx?.effect?.targets)
    ? ctx.effect.targets
    : [];
  return targetDefs.find((target) => target?.id === targetRef) || null;
}

function shouldExcludePreviewTargetCard(card, target, ctx, zone) {
  if (!card || card !== ctx?.source) return false;
  if (target?.includeSelf === true || target?.allowSelf === true) return false;
  if (target?.excludeSelf === true) return true;

  const sourceKind = ctx?.source?.cardKind;
  return (
    zone === "hand" &&
    ctx?.activationZone === "hand" &&
    (sourceKind === "spell" || sourceKind === "trap")
  );
}

function collectPreviewTargetEntries(engine, target, ctx, player) {
  const owners = getPreviewTargetOwners(target, ctx, player);
  const zones = getPreviewTargetZones(target);
  const filters = buildTargetPreviewFilters(target);
  const entries = [];
  const seen = new Set();

  for (const owner of owners) {
    for (const zone of zones) {
      for (const card of getPreviewZoneCards(owner, zone)) {
        if (!card || seen.has(card)) continue;
        if (shouldExcludePreviewTargetCard(card, target, ctx, zone)) continue;
        if (!matchesPreviewFilters(engine, card, filters, ctx)) continue;
        seen.add(card);
        entries.push({ owner, zone, card });
      }
    }
  }

  return entries;
}

function getPreviewMoveDestinationOwner(action, ctx, sourceOwner, player) {
  if (action?.player === "self") return player || ctx?.player || sourceOwner;
  if (action?.player === "opponent") return ctx?.opponent || sourceOwner;
  return sourceOwner || player || ctx?.player || null;
}

function recordPreviewMoveCandidates(engine, action, ctx, player, previewMoves) {
  if (action?.type !== "move" || !Array.isArray(previewMoves)) return;
  const toZone = action.to || action.toZone;
  if (!toZone || !action.targetRef) return;

  const targetDef = getEffectTargetDefinition(ctx, action.targetRef);
  if (!targetDef) return;

  const sourceEntries = collectPreviewTargetEntries(
    engine,
    targetDef,
    ctx,
    player,
  );
  if (sourceEntries.length === 0) return;

  const maxCount = getPreviewTargetMaxCount(targetDef, sourceEntries.length);
  if (maxCount !== null && maxCount <= 0) return;

  for (const entry of sourceEntries) {
    const owner = getPreviewMoveDestinationOwner(
      action,
      ctx,
      entry.owner,
      player,
    );
    if (!owner) continue;
    let group = previewMoves.find(
      (candidate) => candidate.owner === owner && candidate.zone === toZone,
    );
    if (!group) {
      group = {
        owner,
        zone: toZone,
        cards: [],
        maxCount,
      };
      previewMoves.push(group);
    }
    group.cards.push(entry.card);
  }
}

function countPreviewTargetCandidates(
  engine,
  target,
  ctx,
  player,
  previewMoves = [],
) {
  const owners = getPreviewTargetOwners(target, ctx, player);
  const zones = getPreviewTargetZones(target);
  const filters = buildTargetPreviewFilters(target);
  const seen = new Set();
  let count = 0;

  for (const owner of owners) {
    for (const zone of zones) {
      for (const card of getPreviewZoneCards(owner, zone)) {
        if (!card || seen.has(card)) continue;
        if (shouldExcludePreviewTargetCard(card, target, ctx, zone)) continue;
        if (!matchesPreviewFilters(engine, card, filters, ctx)) continue;
        seen.add(card);
        count += 1;
      }

      for (const group of previewMoves) {
        if (group.owner !== owner || group.zone !== zone) continue;
        const matchingMovedCards = [];
        for (const card of group.cards || []) {
          if (!card || seen.has(card)) continue;
          if (!matchesPreviewFilters(engine, card, filters, ctx)) continue;
          matchingMovedCards.push(card);
        }
        const allowedCount =
          group.maxCount === null
            ? matchingMovedCards.length
            : Math.min(group.maxCount, matchingMovedCards.length);
        for (let i = 0; i < allowedCount; i += 1) {
          seen.add(matchingMovedCards[i]);
          count += 1;
        }
      }
    }
  }

  return count;
}

function checkPreviewMoveTargetAvailability(
  engine,
  action,
  ctx,
  player,
  previewMoves,
) {
  if (action?.type !== "move") return { ok: true };
  const toZone = action.to || action.toZone;
  if (toZone === "field") {
    const destinationPlayer =
      action.player === "opponent" ? ctx?.opponent : ctx?.player || player;
    if ((destinationPlayer?.field || []).length >= 5) {
      return { ok: false, reason: "Field is full." };
    }
  }
  if (!action.targetRef) return { ok: true };
  const targetDef = getEffectTargetDefinition(ctx, action.targetRef);
  if (!targetDef) return { ok: true };

  const min = getPreviewTargetMinCount(targetDef, 1);
  if (min <= 0) return { ok: true };

  const available = countPreviewTargetCandidates(
    engine,
    targetDef,
    ctx,
    player,
    previewMoves,
  );
  if (available >= min) return { ok: true };

  const zones = getPreviewTargetZones(targetDef).join("/") || "zone";
  return {
    ok: false,
    reason: `Need ${min} valid target(s) in ${zones} for this move action.`,
  };
}

function checkRequiredOptionalTargetsPreview(
  engine,
  action,
  ctx,
  player,
  previewMoves,
) {
  if (action?.optional === true) return { ok: true };
  const mustResolve =
    action?.allowCancel === false || action?.required === true;
  if (!mustResolve) return { ok: true };

  const targetDefs = Array.isArray(action?.targets) ? action.targets : [];
  for (const target of targetDefs) {
    const min = getPreviewTargetMinCount(target, 1);
    if (min <= 0) continue;

    const available = countPreviewTargetCandidates(
      engine,
      target,
      ctx,
      player,
      previewMoves,
    );
    if (available < min) {
      const zones = getPreviewTargetZones(target).join("/") || "zone";
      return {
        ok: false,
        reason: `Need ${min} valid target(s) in ${zones} for the required follow-up effect.`,
      };
    }
  }

  return { ok: true };
}

function matchesCounterPreviewFilters(engine, card, filters = {}) {
  if (!card) return false;
  if (filters.requireFaceup === true && card.isFacedown) return false;
  if (filters.cardKind && !cardMatchesKind(card, filters.cardKind)) {
    return false;
  }
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  if (filters.type) {
    const types = Array.isArray(card.types) ? card.types : [card.type];
    if (!types.includes(filters.type)) return false;
  }
  if (filters.attribute && card.attribute !== filters.attribute) return false;
  if (filters.name && card.name !== filters.name) return false;
  if (filters.cardName && card.name !== filters.cardName) return false;
  if (filters.subtype) {
    const allowed = Array.isArray(filters.subtype)
      ? filters.subtype
      : [filters.subtype];
    if (!allowed.includes(card.subtype)) return false;
  }
  if (
    Object.keys(filters).length > 0 &&
    typeof engine?.cardMatchesFilters === "function" &&
    !engine.cardMatchesFilters(card, filters)
  ) {
    return false;
  }
  return true;
}

function countPreviewFieldCounters(engine, action, ctx, player) {
  const counterType = action?.counterType || "default";
  const zones = Array.isArray(action?.zones)
    ? action.zones
    : [action?.zone || "field"];
  const filters = { ...(action?.filters || {}) };
  if (action?.requireFaceup === true && filters.requireFaceup == null) {
    filters.requireFaceup = true;
  }

  let total = 0;
  for (const owner of getPreviewCounterOwners(action, ctx, player)) {
    for (const zone of zones) {
      for (const card of getPreviewZoneCards(owner, zone)) {
        if (!matchesCounterPreviewFilters(engine, card, filters)) continue;
        total +=
          typeof card.getCounter === "function"
            ? Math.max(0, Number(card.getCounter(counterType) || 0))
            : 0;
      }
    }
  }
  return total;
}

function countPreviewFieldCardsForSpec(engine, spec = {}, ctx, player) {
  const zones = Array.isArray(spec?.zones)
    ? spec.zones
    : [spec?.zone || "field"];
  const filters = { ...(spec?.filters || {}) };
  const actionLike = {
    owner: spec?.owner,
    player: spec?.player,
  };

  let count = 0;
  for (const owner of getPreviewCounterOwners(actionLike, ctx, player)) {
    for (const zone of zones) {
      for (const card of getPreviewZoneCards(owner, zone)) {
        if (!matchesPreviewFilters(engine, card, filters, ctx)) continue;
        count += 1;
      }
    }
  }
  return count;
}

function resolvePreviewAddCounterAmount(engine, action, ctx, player) {
  if (action?.amountFromFieldCount) {
    const spec = action.amountFromFieldCount;
    const count = countPreviewFieldCardsForSpec(engine, spec, ctx, player);
    const multiplier = Number.isFinite(Number(spec.multiplier))
      ? Number(spec.multiplier)
      : 1;
    let amount = count * multiplier;
    if (Number.isFinite(Number(spec.min))) {
      amount = Math.max(Number(spec.min), amount);
    }
    if (Number.isFinite(Number(spec.max))) {
      amount = Math.min(Number(spec.max), amount);
    }
    return Math.max(0, Math.floor(amount));
  }

  if (action?.damagePerCounter && ctx?.damageAmount !== undefined) {
    return ctx.damageAmount >= action.damagePerCounter ? 1 : 0;
  }

  return Math.max(0, Math.floor(Number(action?.amount || 1)));
}

function countPreviewOpponentDestroyTargets(engine, action, ctx) {
  if (action?.targetCountFromContext) return null;

  const opponent = ctx?.opponent;
  if (!opponent) return 0;

  const zones = Array.isArray(action.zones)
    ? action.zones
    : ["field", "spellTrap", "fieldSpell"];
  const filters = { ...(action.filters || {}) };
  if (action.requireFaceup === true && filters.requireFaceup == null) {
    filters.requireFaceup = true;
  }
  const allowedKinds = action.cardKind
    ? Array.isArray(action.cardKind)
      ? action.cardKind
      : [action.cardKind]
    : null;
  const allowedSubtypes = action.subtype
    ? Array.isArray(action.subtype)
      ? action.subtype
      : [action.subtype]
    : null;
  let count = 0;

  for (const zone of zones) {
    for (const card of getPreviewZoneCards(opponent, zone)) {
      if (!card) continue;
      if (allowedKinds && !allowedKinds.includes(card.cardKind)) continue;
      if (allowedSubtypes && !allowedSubtypes.includes(card.subtype)) continue;
      if (action.position && action.position !== "any" && card.position !== action.position) {
        continue;
      }
      if (!matchesPreviewFilters(engine, card, filters)) continue;
      count += 1;
    }
  }

  return count;
}

function getSourceOwnersForPreview(action, ctx, player) {
  const scope = action?.sourceOwner || action?.sourceScope || action?.scope || "self";
  const opponent = ctx?.opponent;
  if (scope === "opponent") {
    return opponent ? [opponent] : [];
  }
  if (scope === "both" || scope === "any") {
    return [player, opponent].filter(Boolean);
  }
  return player ? [player] : [];
}

function countDistinctPreviewNames(cards = []) {
  const names = new Set();
  for (const card of cards) {
    names.add(card?.name || `id:${card?.id ?? "unknown"}`);
  }
  return names.size;
}

function hasSpecialSummonCandidate(engine, action, ctx) {
  const player = ctx?.player;
  if (!player) return false;

  const zoneSpec = action.zone || action.sourceZone || "deck";
  const zoneNames = Array.isArray(zoneSpec) ? zoneSpec : [zoneSpec];
  const sourceOwners = getSourceOwnersForPreview(action, ctx, player);
  const zoneCards = sourceOwners.flatMap((owner) =>
    zoneNames.flatMap((zoneName) => getPreviewZoneCards(owner, zoneName)),
  );
  if (zoneCards.length === 0) return false;

  if (action.requireSource) {
    return zoneCards.includes(ctx?.source);
  }
  if (action.targetRef) return true;

  const filters = buildPreviewFilters(action);
  if (action.matchLevelRef) {
    const levelCard = ctx?.[action.matchLevelRef] || null;
    const levelValue = Number(levelCard?.level);
    if (!Number.isFinite(levelValue) || levelValue <= 0) return false;
    filters.level = levelValue;
    filters.levelOp = filters.levelOp || action.levelOp || "eq";
  }

  const candidates = zoneCards.filter((card) => {
    if (!card || card.cardKind !== "monster") return false;
    if (card.cannotBeSpecialSummoned) return false;
    return matchesPreviewFilters(engine, card, filters);
  });
  const min = Number(action.count?.min ?? 1);
  const requiredCount = Number.isFinite(min) && min > 0 ? min : 1;
  const availableCount =
    action.distinctNames === true
      ? countDistinctPreviewNames(candidates)
      : candidates.length;

  return availableCount >= requiredCount;
}

function getGraveyardOwnersForActionScope(action, ctx) {
  const player = ctx?.player;
  const opponent = ctx?.opponent;
  const scope = action?.scope || "self";
  if (scope === "both") {
    return [player, opponent].filter(Boolean);
  }
  if (scope === "opponent") {
    return opponent ? [opponent] : [];
  }
  return player ? [player] : [];
}

function isChoiceCaseAllowedInPreview(engine, caseEntry, ctx) {
  const conditions = Array.isArray(caseEntry?.conditions)
    ? caseEntry.conditions
    : [];
  if (conditions.length > 0) {
    const conditionResult = engine?.evaluateConditions?.(conditions, ctx);
    if (!conditionResult?.ok) return false;
  }

  const targets = Array.isArray(caseEntry?.targets) ? caseEntry.targets : [];
  if (targets.length > 0) {
    const targetResult = engine?.resolveTargets?.(targets, ctx, null);
    if (targetResult?.ok === false) return false;
  }

  const caseActions = Array.isArray(caseEntry?.actions)
    ? caseEntry.actions
    : [];
  if (caseActions.length === 0) return false;

  const actionResult =
    typeof engine?.checkActionPreviewRequirements === "function"
      ? engine.checkActionPreviewRequirements(caseActions, ctx)
      : checkActionPreviewRequirements.call(engine, caseActions, ctx);
  return actionResult?.ok !== false;
}

/**
 * Check action preview requirements without executing
 * @param {Array} actions - Array of action definitions
 * @param {Object} ctx - Context object
 * @returns {Object} Result with ok status and optional reason
 */
export function checkActionPreviewRequirements(actions, ctx) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return { ok: true };
  }

  const player = ctx?.player;
  if (!player) {
    return { ok: false, reason: "Missing player." };
  }

  const hasOtherActions = (action) =>
    actions.some((candidate) => candidate && candidate !== action);
  const previewMoves = [];

  for (const action of actions) {
    if (!action || !action.type) continue;
    if (action.type === "choose_action_case") {
      const cases = Array.isArray(action.cases) ? action.cases : [];
      const hasAllowedCase = cases.some((caseEntry) =>
        isChoiceCaseAllowedInPreview(this, caseEntry, ctx),
      );
      if (!hasAllowedCase) {
        return { ok: false, reason: "No valid options to activate this effect." };
      }
      continue;
    }

    if (action.type === "optional_target_actions") {
      const optionalTargetCheck = checkRequiredOptionalTargetsPreview(
        this,
        action,
        ctx,
        player,
        previewMoves,
      );
      if (!optionalTargetCheck.ok) {
        return optionalTargetCheck;
      }
    }

    if (action.type === "move") {
      const moveTargetCheck = checkPreviewMoveTargetAvailability(
        this,
        action,
        ctx,
        player,
        previewMoves,
      );
      if (!moveTargetCheck.ok) {
        return moveTargetCheck;
      }
    }

    if (action.type === "pay_lp") {
      let amount = Number(action.amount || 0);
      if (action.fraction) {
        amount = Math.floor((player.lp || 0) * action.fraction);
      }
      if (amount > 0 && typeof this?.resolveLpCost === "function") {
        const costResult = this.resolveLpCost(action, ctx, amount, {
          consume: false,
        });
        if (costResult && typeof costResult.finalAmount === "number") {
          amount = costResult.finalAmount;
        }
      }
      if (amount > 0 && (player.lp || 0) < amount) {
        return { ok: false, reason: "Not enough LP to pay cost." };
      }
    }

    if (action.type === "banish_all_graveyard_and_burn") {
      const owners = getGraveyardOwnersForActionScope(action, ctx);
      const hasCards = owners.some(
        (owner) => Array.isArray(owner?.graveyard) && owner.graveyard.length > 0,
      );
      if (!hasCards) {
        return {
          ok: false,
          reason: "No cards in the selected Graveyard scope to banish.",
        };
      }
    }

    if (action.type === "remove_counters_from_field") {
      const hasRange =
        action.maxAmount !== undefined ||
        action.minAmount !== undefined ||
        action.variableAmount === true;
      const requestedAmount = hasRange
        ? Number(action.minAmount ?? 1)
        : Number(action.amount ?? action.count ?? 1);
      const amount = Number.isFinite(requestedAmount)
        ? Math.max(1, requestedAmount)
        : 1;
      const availableCounters = countPreviewFieldCounters(
        this,
        action,
        ctx,
        player,
      );
      if (availableCounters < amount) {
        return {
          ok: false,
          reason: `Need at least ${amount} ${action.counterType || "default"} counter(s) on the field.`,
        };
      }
    }

    if (action.type === "add_counter") {
      const amount = resolvePreviewAddCounterAmount(this, action, ctx, player);
      if (amount <= 0 && !isActionOptionalNoop(action)) {
        return {
          ok: false,
          reason: `Need at least 1 ${action.counterType || "default"} counter to add.`,
        };
      }
    }

    if (action.type === "destroy_targeted_cards") {
      const availableTargets = countPreviewOpponentDestroyTargets(
        this,
        action,
        ctx,
      );
      if (availableTargets !== null) {
        const requestedMaxTargets = Number(action.maxTargets || 1);
        const requestedMinTargets = Number.isFinite(action.minTargets)
          ? action.minTargets
          : requestedMaxTargets;
        const minTargets = Math.max(1, requestedMinTargets);
        if (availableTargets < minTargets) {
          return {
            ok: false,
            reason: `Need ${minTargets} valid target(s) to destroy.`,
          };
        }
      }
    }

    if (
      action.type === "search_any" ||
      action.type === "add_from_zone_to_hand" ||
      action.type === "search_then_optional_special_summon_from_hand"
    ) {
      const inferredSearch =
        action.type === "search_any" ||
        action.type === "search_then_optional_special_summon_from_hand" ||
        action.mode === "search_any";
      const sourceZone = action.zone || (inferredSearch ? "deck" : "graveyard");
      const zone = player[sourceZone] || [];
      const baseFilters = action.filters || {};
      const filters = { ...baseFilters };
      if (inferredSearch) {
        if (action.archetype && !filters.archetype) {
          filters.archetype = action.archetype;
        }
        if (action.cardKind && !filters.cardKind) {
          filters.cardKind = action.cardKind;
        }
        if (action.cardName && !filters.name) {
          filters.name = action.cardName;
        }
        if (Number.isFinite(action.minAtk) && filters.minAtk == null) {
          filters.minAtk = action.minAtk;
        }
        if (Number.isFinite(action.maxAtk) && filters.maxAtk == null) {
          filters.maxAtk = action.maxAtk;
        }
      }
      const count = action.count || { min: 1, max: 1 };
      const min = Math.max(count.min || 0, 0);
      if (min > 0) {
        const hasCandidate = zone.some((card) => {
          if (!card) return false;
          if (typeof this?.cardMatchesFilters === "function") {
            if (!this.cardMatchesFilters(card, filters)) return false;
          }
          if (action.cardName) {
            const match = action.cardName.toLowerCase();
            if ((card.name || "").toLowerCase() !== match) return false;
          }
          if (typeof action.cardId === "number" && card.id !== action.cardId) {
            return false;
          }
          if (
            typeof action.minLevel === "number" &&
            (card.level || 0) < action.minLevel
          ) {
            return false;
          }
          if (
            typeof action.maxLevel === "number" &&
            (card.level || 0) > action.maxLevel
          ) {
            return false;
          }
          return true;
        });
        if (!hasCandidate) {
          return {
            ok: false,
            reason: `No valid cards in ${sourceZone} matching filters.`,
          };
        }
      }
    }

    if (action.type === "discard_from_hand") {
      const targetPlayer = action.player === "opponent" ? ctx?.opponent : player;
      const count = action.count || { min: 1, max: 1 };
      const min = Math.max(Number(count.min ?? 1), 0);
      if (min > 0) {
        const hand = targetPlayer?.hand || [];
        const filters = action.filters || {};
        const hasEnough =
          hand.filter((card) => matchesPreviewFilters(this, card, filters, ctx))
            .length >= min;
        if (!hasEnough) {
          return {
            ok: false,
            reason: "Not enough cards in hand to discard.",
          };
        }
      }
    }

    if (action.type === "declare_card_property") {
      if (!action.property || !action.stateKey) {
        return {
          ok: false,
          reason: "Invalid declaration action.",
        };
      }
    }

    if (
      action.type === "special_summon_from_zone" ||
      action.type === "special_summon_matching_level" ||
      action.type === "call_of_haunted_summon_and_bind"
    ) {
      if ((player.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }
      if (
        (action.type === "special_summon_from_zone" ||
          action.type === "special_summon_matching_level") &&
        !hasSpecialSummonCandidate(this, action, ctx)
      ) {
        return {
          ok: false,
          reason: "No valid cards available to Special Summon.",
        };
      }
    }

    if (action.type === "special_summon_from_deck_with_counter_limit") {
      if ((player.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }

      const source = ctx?.source;
      const counterType = action.counterType || "judgment_marker";
      const counterMultiplier = action.counterMultiplier || 500;
      const counterCount =
        typeof source?.getCounter === "function"
          ? source.getCounter(counterType)
          : source?.counters?.get
            ? source.counters.get(counterType)
            : 0;
      const maxAtk = counterCount * counterMultiplier;
      if (maxAtk <= 0) {
        return {
          ok: false,
          reason: `No ${counterType} counters on ${source?.name || "source"}.`,
        };
      }

      const filters = { ...(action.filters || {}) };
      if (action.archetype && !filters.archetype) {
        filters.archetype = action.archetype;
      }
      const hasCandidate = (player.deck || []).some((card) => {
        if (!card || card.cardKind !== "monster") return false;
        if ((card.atk || 0) > maxAtk) return false;
        if (filters.archetype) {
          const archetypes = Array.isArray(card.archetypes)
            ? card.archetypes
            : card.archetype
              ? [card.archetype]
              : [];
          if (!archetypes.includes(filters.archetype)) return false;
        }
        return true;
      });

      if (!hasCandidate) {
        return {
          ok: false,
          reason: `No valid monsters in deck with ATK <= ${maxAtk}.`,
        };
      }
    }

    if (action.type === "special_summon_token") {
      const targetPlayer = action.player === "opponent" ? ctx?.opponent : player;
      if ((targetPlayer?.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }
    }

    if (action.type === "special_summon_self_as_trap_monster") {
      if ((player.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }
      const source = ctx?.source;
      if (!source || !cardMatchesKind(source, ["spell", "trap"])) {
        return { ok: false, reason: "Source is not a Spell/Trap card." };
      }
      const sourceZone =
        typeof this?.findCardZone === "function"
          ? this.findCardZone(player, source)
          : null;
      if (sourceZone && sourceZone !== "spellTrap") {
        return { ok: false, reason: "Source must be in the Spell/Trap zone." };
      }
    }

    if (action.type === "special_summon_from_hand_with_tiered_cost") {
      if ((player.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }

      const filters = action.costFilters || {
        name: "Void Hollow",
        cardKind: "monster",
      };
      const matchesFilters = (card) => {
        if (!card) return false;
        if (filters.cardKind && !cardMatchesKind(card, filters.cardKind)) {
          return false;
        }
        if (filters.name && card.name !== filters.name) return false;
        if (filters.archetype) {
          const hasArc =
            card.archetype === filters.archetype ||
            (Array.isArray(card.archetypes) &&
              card.archetypes.includes(filters.archetype));
          if (!hasArc) return false;
        }
        return true;
      };
      const costCandidates = (player.field || []).filter(matchesFilters);
      const minCost = action.minCost ?? 1;
      if (costCandidates.length < minCost) {
        return {
          ok: false,
          reason: "Not enough cost monsters to Special Summon.",
        };
      }
    }

    if (action.type === "conditional_summon_from_hand") {
      if (action.optional !== false && hasOtherActions(action)) {
        continue;
      }

      // Check field space
      if ((player.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }

      // Check condition
      const condition = action.condition || {};
      if (condition.type === "control_card") {
        const zoneName = condition.zone || "fieldSpell";
        const cardName = condition.cardName;
        let conditionMet = false;

        if (zoneName === "fieldSpell") {
          conditionMet = player.fieldSpell?.name === cardName;
        } else {
          const zone = player[zoneName] || [];
          conditionMet = zone.some((c) => c && c.name === cardName);
        }

        if (!conditionMet) {
          return {
            ok: false,
            reason: `You must control "${cardName}" to activate this effect.`,
          };
        }
      } else if (condition.type === "control_card_type") {
        const zoneName = condition.zone || "field";
        const typeName = condition.typeName || condition.cardType;

        if (!typeName) {
          return { ok: false, reason: "Invalid condition configuration." };
        }

        const zone = player[zoneName] || [];
        const conditionMet = zone.some((c) => {
          if (!c || c.isFacedown) return false;
          if (Array.isArray(c.types)) {
            return c.types.includes(typeName);
          }
          return c.type === typeName;
        });

        if (!conditionMet) {
          return {
            ok: false,
            reason: `You must control a ${typeName} monster to activate this effect.`,
          };
        }
      }
    }

    if (action.type === "special_summon_from_hand_with_cost") {
      if ((player.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }

      // Get cost target filter from effect.targets
      const costTargetRef = action.costTargetRef || "bbd_cost";
      const costEffect = ctx?.effect;
      if (!costEffect || !costEffect.targets) {
        return {
          ok: false,
          reason: "Cost targets not defined in effect.",
        };
      }

      const costTarget = costEffect.targets.find(
        (t) => t && t.id === costTargetRef
      );
      if (!costTarget) {
        return {
          ok: false,
          reason: "Cost target definition not found.",
        };
      }

      const requiredCount = Math.max(0, Number(costTarget.count?.min ?? 0));
      const zones = Array.isArray(costTarget.zones)
        ? costTarget.zones
        : [costTarget.zone || "hand"];
      const owners = getPreviewTargetOwners(costTarget, ctx, player);
      if (owners.length === 0 || zones.length === 0) {
        return { ok: false, reason: "Cost zone not found." };
      }
      const zoneCards = owners.flatMap((owner) =>
        zones.flatMap((zoneName) => getPreviewZoneCards(owner, zoneName)),
      );

      const filters = buildTargetPreviewFilters(costTarget);
      const validCosts = zoneCards.filter((card) =>
        matchesPreviewFilters(this, card, filters, ctx),
      );
      if (validCosts.length < requiredCount) {
        const zoneLabel = zones.join("/");
        const filterLabel =
          filters.type || filters.archetype || filters.cardKind || "card";
        return {
          ok: false,
          reason: `Need ${requiredCount} ${filterLabel}(s) in ${zoneLabel} to activate.`,
        };
      }
    }

    recordPreviewMoveCandidates(this, action, ctx, player, previewMoves);
  }

  return { ok: true };
}
