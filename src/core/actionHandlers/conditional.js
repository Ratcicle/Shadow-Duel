import { cardMatchesKind } from "../Card.js";
import { getUI, resolveTargetCards } from "./shared.js";
import { isAI } from "../Player.js";

function sameCardRef(ref, card) {
  if (!ref || !card) return false;
  if (ref === card) return true;
  if (typeof ref === "object") {
    return ref.instanceId != null && ref.instanceId === card.instanceId;
  }
  return card.instanceId != null && String(ref) === String(card.instanceId);
}

function isActiveEquipForCard(equip, card, ctx) {
  if (!equip || !card) return false;
  if (equip.cardKind !== "spell" || equip.subtype !== "equip") return false;
  const isAttached =
    sameCardRef(equip.equippedTo, card) || sameCardRef(equip.equipTarget, card);
  if (!isAttached) return false;

  const owner =
    equip.owner === ctx?.player?.id
      ? ctx.player
      : equip.owner === ctx?.opponent?.id
        ? ctx.opponent
        : null;
  return Array.isArray(owner?.spellTrap) && owner.spellTrap.includes(equip);
}

function matchesCardFilters(card, filters, ctx) {
  if (!card || !filters) return false;

  const ownerFilter = filters.owner;
  if (ownerFilter === "self" && card.owner !== ctx?.player?.id) return false;
  if (ownerFilter === "opponent" && card.owner !== ctx?.opponent?.id)
    return false;

  if (filters.cardKind) {
    const kinds = Array.isArray(filters.cardKind)
      ? filters.cardKind
      : [filters.cardKind];
    if (!cardMatchesKind(card, kinds)) return false;
  }

  if (filters.subtype) {
    const subtypes = Array.isArray(filters.subtype)
      ? filters.subtype
      : [filters.subtype];
    if (!subtypes.includes(card.subtype)) return false;
  }

  const nameFilter = filters.cardName || filters.name;
  if (nameFilter) {
    const names = Array.isArray(nameFilter) ? nameFilter : [nameFilter];
    if (!names.includes(card.name)) return false;
  }
  const excludeNames = [
    filters.excludeName,
    filters.excludeCardName,
    ...(Array.isArray(filters.excludeNames) ? filters.excludeNames : []),
    ...(Array.isArray(filters.excludeCardNames)
      ? filters.excludeCardNames
      : []),
  ].filter(Boolean);
  if (excludeNames.includes(card.name)) return false;

  const excludeIds = [
    filters.excludeId,
    filters.excludeCardId,
    ...(Array.isArray(filters.excludeIds) ? filters.excludeIds : []),
    ...(Array.isArray(filters.excludeCardIds) ? filters.excludeCardIds : []),
  ].filter((value) => value !== undefined && value !== null);
  if (excludeIds.includes(card.id)) return false;

  if (filters.archetype) {
    const required = Array.isArray(filters.archetype)
      ? filters.archetype
      : [filters.archetype];
    const cardArchetypes = card.archetypes
      ? card.archetypes
      : card.archetype
      ? [card.archetype]
      : [];
    const hasMatch = required.some((arc) => cardArchetypes.includes(arc));
    if (!hasMatch) return false;
  }

  if (filters.requireFaceup && card.isFacedown) return false;
  if (filters.faceUp && card.isFacedown) return false;

  if (filters.position && filters.position !== "any") {
    if (card.position !== filters.position) return false;
  }

  if (filters.level !== undefined) {
    const cardLevel = card.level || 0;
    if (cardLevel !== filters.level) return false;
  }

  if (filters.minLevel !== undefined) {
    const cardLevel = card.level || 0;
    if (cardLevel < filters.minLevel) return false;
  }

  if (filters.maxLevel !== undefined) {
    const cardLevel = card.level || 0;
    if (cardLevel > filters.maxLevel) return false;
  }

  if (filters.minAtk !== undefined) {
    const cardAtk = card.atk || 0;
    if (cardAtk < filters.minAtk) return false;
  }

  if (filters.maxAtk !== undefined) {
    const cardAtk = card.atk || 0;
    if (cardAtk > filters.maxAtk) return false;
  }

  if (filters.minDef !== undefined) {
    const cardDef = card.def || 0;
    if (cardDef < filters.minDef) return false;
  }

  if (filters.maxDef !== undefined) {
    const cardDef = card.def || 0;
    if (cardDef > filters.maxDef) return false;
  }

  if (filters.equippedWithFilters) {
    const equipFilters = filters.equippedWithFilters || {};
    const requireEquipFaceup = equipFilters.requireFaceup !== false;
    const equips = Array.isArray(card.equips) ? card.equips : [];
    const hasMatchingEquip = equips.some((equip) => {
      if (!equip) return false;
      if (!isActiveEquipForCard(equip, card, ctx)) return false;
      if (requireEquipFaceup && equip.isFacedown) return false;
      return matchesCardFilters(equip, equipFilters, ctx);
    });
    if (!hasMatchingEquip) return false;
  }

  return true;
}

function resolveOptionalAutoSelection(game, selectionContract, ctx) {
  const player = ctx?.player || null;
  if (!isAI(player)) return null;

  const autoResult = game?.autoSelector?.select?.(selectionContract, {
    owner: player,
    player,
    source: ctx?.source || null,
    activationContext: ctx?.activationContext || {},
    selectionContract,
    game,
  });

  if (autoResult?.ok && autoResult.selections) {
    return autoResult.selections;
  }

  const fallback = {};
  for (const req of selectionContract?.requirements || []) {
    const min = Number(req?.min ?? 0);
    const max = Number(req?.max ?? min);
    const candidates = Array.isArray(req?.candidates)
      ? req.candidates
      : [];
    fallback[req.id] = candidates
      .slice(0, Math.min(Math.max(min, 0), max, candidates.length))
      .map((candidate) => candidate.key)
      .filter(Boolean);
  }
  return fallback;
}

function runOptionalTargetSelection(game, selectionContract, ctx, action) {
  const autoSelection = resolveOptionalAutoSelection(
    game,
    selectionContract,
    ctx,
  );
  if (autoSelection) return Promise.resolve(autoSelection);

  return new Promise((resolve) => {
    let resolved = false;
    const finalize = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    game.startTargetSelectionSession({
      kind: selectionContract?.kind || "target",
      selectionContract,
      card: ctx?.source || null,
      message: action?.selectionMessage || selectionContract?.message || null,
      allowCancel: action?.allowCancel !== false,
      resolve: finalize,
      execute: (selections) => {
        finalize(selections || {});
        return { success: true, needsSelection: false };
      },
      onCancel: () => finalize(null),
    });
  });
}

async function resolveOptionalTargets(action, ctx, engine) {
  const targetDefs = Array.isArray(action?.targets) ? action.targets : [];
  if (targetDefs.length === 0) {
    return { ok: true, targets: {} };
  }

  const game = engine?.game;
  if (!game) return { ok: false, reason: "Game not available." };

  const targetCtx = {
    ...ctx,
    activationContext: {
      ...(ctx?.activationContext || {}),
      logTargets: false,
    },
  };

  let targetResult = engine.resolveTargets(targetDefs, targetCtx, null);
  if (targetResult?.ok === false && !targetResult?.needsSelection) {
    return targetResult;
  }

  if (!targetResult?.needsSelection) {
    return targetResult;
  }

  const selectionContract = targetResult.selectionContract;
  if (!selectionContract) {
    return { ok: false, reason: "Selection contract not available." };
  }

  if (action?.selectionMessage) {
    selectionContract.message = action.selectionMessage;
  }

  const selections = await runOptionalTargetSelection(
    game,
    selectionContract,
    targetCtx,
    action,
  );

  if (!selections) {
    return { ok: false, cancelled: true };
  }

  targetResult = engine.resolveTargets(targetDefs, targetCtx, selections);
  return targetResult;
}

export async function handleConditionalTargetActions(
  action,
  ctx,
  targets,
  engine
) {
  const game = engine?.game;
  if (!game) return false;

  const cases = Array.isArray(action?.cases) ? action.cases : [];
  if (cases.length === 0) return false;

  const targetCards = resolveTargetCards(action, ctx, targets, {
    defaultRef: "self",
  });
  if (targetCards.length === 0) {
    getUI(game)?.log("No valid targets for conditional effect.");
    return false;
  }

  const matchMode = action.matchMode === "all" ? "all" : "any";
  const applyMode = action.applyMode === "all" ? "all" : "first";

  const matchesCase = (caseEntry) => {
    const conditions = Array.isArray(caseEntry?.conditions)
      ? caseEntry.conditions
      : [];
    if (conditions.length > 0) {
      const conditionResult = engine.evaluateConditions?.(conditions, ctx);
      if (!conditionResult?.ok) return false;
    }

    const filters = caseEntry?.filters || caseEntry?.filter;
    if (!filters || Object.keys(filters).length === 0) return true;
    if (matchMode === "all") {
      return targetCards.every((card) => matchesCardFilters(card, filters, ctx));
    }
    return targetCards.some((card) => matchesCardFilters(card, filters, ctx));
  };

  let executed = false;

  for (const caseEntry of cases) {
    if (!matchesCase(caseEntry)) continue;
    const actions = Array.isArray(caseEntry?.actions) ? caseEntry.actions : [];
    if (actions.length === 0) {
      if (applyMode === "first") return executed;
      continue;
    }

    const result = await engine.applyActions(actions, ctx, targets);
    if (result && typeof result === "object" && result.needsSelection) {
      return result;
    }
    executed = result || executed;
    if (applyMode === "first") return executed;
  }

  if (!executed && Array.isArray(action.defaultActions)) {
    const result = await engine.applyActions(
      action.defaultActions,
      ctx,
      targets
    );
    if (result && typeof result === "object" && result.needsSelection) {
      return result;
    }
    executed = result || executed;
  }

  if (!executed) {
    getUI(game)?.log("No valid conditional actions for this target.");
  }

  return executed;
}

export async function handleOptionalTargetActions(action, ctx, targets, engine) {
  const game = engine?.game;
  if (!game) return false;

  const conditions = Array.isArray(action?.conditions)
    ? action.conditions
    : [];
  if (conditions.length > 0) {
    const conditionResult = engine.evaluateConditions?.(conditions, ctx);
    if (!conditionResult?.ok) {
      if (action?.logIfSkipped === true && conditionResult?.reason) {
        getUI(game)?.log(conditionResult.reason);
      }
      return false;
    }
  }

  const targetResult = await resolveOptionalTargets(action, ctx, engine);
  if (targetResult?.needsSelection) {
    return targetResult;
  }
  if (targetResult?.ok === false) {
    if (
      action?.logIfSkipped === true &&
      !targetResult.cancelled &&
      targetResult.reason
    ) {
      getUI(game)?.log(targetResult.reason);
    }
    return false;
  }

  const resolvedTargets = {
    ...(targets || {}),
    ...(targetResult?.targets || {}),
  };
  const actions = Array.isArray(action?.actions) ? action.actions : [];
  if (actions.length === 0) return false;

  const result = await engine.applyActions(actions, ctx, resolvedTargets);
  if (result && typeof result === "object" && result.needsSelection) {
    return result;
  }
  return result;
}
