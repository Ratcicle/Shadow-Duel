/**
 * shared.js
 *
 * Shared helpers used by multiple action handlers.
 * All functions here are moved from ActionHandlers.js with identical names and signatures.
 */

import { isAI } from "../Player.js";

// Stub UI for fallback when game.ui is unavailable
export const NULL_UI = {
  log: () => {},
};

export function getUI(game) {
  return game?.ui || game?.renderer || NULL_UI;
}

// Map technical status names to user-friendly descriptions
export const STATUS_DISPLAY_NAMES = {
  tempBattleIndestructible: "battle indestructibility",
  battleDamageHealsControllerThisTurn: "battle damage healing",
  battleIndestructible: "permanent battle indestructibility",
  piercing: "piercing damage",
  canAttackDirectlyThisTurn: "direct attack ability",
  effectsNegated: "effect negation",
};

export function resolveTargetCards(action, ctx, targets, options = {}) {
  const hasExplicitRef = Object.prototype.hasOwnProperty.call(
    options,
    "targetRef"
  );

  let targetRef = hasExplicitRef ? options.targetRef : action?.targetRef;

  if (!targetRef) {
    targetRef = options.defaultRef;
  }

  let resolved = [];

  if (targetRef === "self") {
    if (ctx?.source) {
      resolved = [ctx.source];
    }
  } else if (targetRef === "last_drawn_card") {
    const arr = Array.isArray(ctx?.lastDrawnCards) ? ctx.lastDrawnCards : [];
    resolved = arr.length > 0 ? [arr[0]] : [];
  } else if (targetRef === "last_drawn") {
    resolved = Array.isArray(ctx?.lastDrawnCards) ? ctx.lastDrawnCards : [];
  } else if (targetRef === "attacker") {
    if (ctx?.attacker) {
      resolved = [ctx.attacker];
    }
  } else if (targetRef === "defender") {
    if (ctx?.defender) {
      resolved = [ctx.defender];
    }
  } else if (targetRef === "destroyed") {
    if (ctx?.destroyed) {
      resolved = [ctx.destroyed];
    }
  } else if (targetRef === "summonedCard") {
    if (ctx?.summonedCard) {
      resolved = [ctx.summonedCard];
    }
  } else if (Array.isArray(targetRef)) {
    resolved = targetRef;
  } else if (targetRef && targets && targetRef in targets) {
    resolved = targets[targetRef];
  } else if (options.fallbackList) {
    resolved = options.fallbackList;
  }

  if (options.requireArray && !Array.isArray(resolved)) {
    return [];
  }

  if (!Array.isArray(resolved)) {
    resolved = [resolved];
  }

  const filtered = resolved.filter(Boolean);

  return typeof options.filter === "function"
    ? filtered.filter(options.filter)
    : filtered;
}

export async function sendCardsToGraveyard(
  cards,
  player,
  engine,
  options = {}
) {
  const game = options.game || engine?.game;

  if (!game || !player || !Array.isArray(cards)) {
    return { movedCount: 0, movedCards: [] };
  }

  const resolveFromZone = options.resolveFromZone;
  const fallbackZone = options.fallbackZone || "field";
  const allowFallback = options.allowFallback !== false;
  const useResolvedZoneOnFallback = options.useResolvedZoneOnFallback !== false;
  const pushIfMissing = options.pushIfMissing === true;

  const movedCards = [];

  for (const card of cards) {
    if (!card) continue;

    const resolvedZone = resolveFromZone ? resolveFromZone(card) : null;
    const fromZone = resolvedZone || options.fromZone || fallbackZone;

    if (typeof game.moveCard === "function") {
      const moveResult = await game.moveCard(card, player, "graveyard", {
        fromZone,
      });

      const moveFailed = moveResult === false || moveResult?.success === false;

      if (!moveFailed) {
        movedCards.push(card);
        continue;
      }
    }

    if (!allowFallback) {
      continue;
    }

    const fallbackSource = useResolvedZoneOnFallback ? fromZone : fallbackZone;
    const zoneArr = player[fallbackSource] || player[fallbackZone] || [];
    const idx = zoneArr.indexOf(card);

    if (idx !== -1) {
      zoneArr.splice(idx, 1);
    } else if (!pushIfMissing) {
      continue;
    }

    player.graveyard = player.graveyard || [];
    player.graveyard.push(card);
    movedCards.push(card);
  }

  return { movedCount: movedCards.length, movedCards };
}

export function collectZoneCandidates(zone, filters = {}, options = {}) {
  if (!Array.isArray(zone)) return [];

  const source = options.source;
  const defaultLevelOp = options.defaultLevelOp || "eq";
  const excludeSummonRestrict = options.excludeSummonRestrict || [];
  const extraFilter = options.extraFilter;

  return zone.filter((card) => {
    if (!card) return false;

    if (filters.cardKind) {
      if (Array.isArray(filters.cardKind)) {
        if (!filters.cardKind.includes(card.cardKind)) return false;
      } else {
        if (card.cardKind !== filters.cardKind) return false;
      }
    }

    // Support filtering by monster type (e.g., "Dragon")
    if (filters.type) {
      const cardType = card.type || null;
      const cardTypes = Array.isArray(card.types) ? card.types : null;

      if (Array.isArray(filters.type)) {
        const ok = cardTypes
          ? filters.type.some((t) => cardTypes.includes(t))
          : filters.type.includes(cardType);
        if (!ok) return false;
      } else {
        const ok = cardTypes
          ? cardTypes.includes(filters.type)
          : cardType === filters.type;
        if (!ok) return false;
      }
    }

    if (filters.archetype) {
      const hasArchetype =
        card.archetype === filters.archetype ||
        (Array.isArray(card.archetypes) &&
          card.archetypes.includes(filters.archetype));
      if (!hasArchetype) return false;
    }

    if (filters.name && card.name !== filters.name) return false;

    if (filters.level !== undefined) {
      const cardLevel = card.level || 0;
      const op = filters.levelOp || defaultLevelOp;

      if (op === "eq" && cardLevel !== filters.level) return false;
      if (op === "lte" && cardLevel > filters.level) return false;
      if (op === "gte" && cardLevel < filters.level) return false;
      if (op === "lt" && cardLevel >= filters.level) return false;
      if (op === "gt" && cardLevel <= filters.level) return false;
    }

    // Support minLevel and maxLevel bounds
    if (filters.minLevel !== undefined) {
      const cardLevel = card.level || 0;
      if (cardLevel < filters.minLevel) return false;
    }

    if (filters.maxLevel !== undefined) {
      const cardLevel = card.level || 0;
      if (cardLevel > filters.maxLevel) return false;
    }

    if (filters.excludeSelf && source && card.id === source.id) return false;

    if (excludeSummonRestrict.length > 0 && card.summonRestrict) {
      if (excludeSummonRestrict.includes(card.summonRestrict)) return false;
    }

    if (typeof extraFilter === "function" && !extraFilter(card)) return false;

    return true;
  });
}

export function buildFieldSelectionCandidates(
  owner,
  game,
  cards,
  options = {}
) {
  if (!owner || !Array.isArray(cards)) return [];

  const ownerLabel =
    options.ownerLabel ?? (owner.id === "player" ? "player" : "opponent");

  return cards.map((card, index) => {
    const inField = owner.field?.indexOf(card) ?? -1;
    const inSpell = owner.spellTrap?.indexOf(card) ?? -1;
    const inFieldSpell = owner.fieldSpell === card ? 0 : -1;

    const zoneIndex =
      inField !== -1 ? inField : inSpell !== -1 ? inSpell : inFieldSpell;
    const zone =
      inField !== -1 ? "field" : inSpell !== -1 ? "spellTrap" : "fieldSpell";

    const candidate = {
      idx: index,
      name: card.name,
      owner: ownerLabel,
      controller: owner.id,
      zone,
      zoneIndex,
      position: card.position || "",
      atk: card.atk || 0,
      def: card.def || 0,
      cardKind: card.cardKind,
      cardRef: card,
    };

    candidate.key = game.buildSelectionCandidateKey(candidate, index);

    return candidate;
  });
}

export async function selectCardsFromZone({
  game,
  player,
  zone,
  filters,
  source,
  excludeSummonRestrict,
  defaultLevelOp,
  extraFilter,
  candidates,
  maxSelect,
  minSelect,
  promptPlayer,
  botSelect,
  selectSingle,
  selectMulti,
  selectionContractBuilder,
}) {
  if (!game || !player) {
    return { candidates: [], selected: [], cancelled: false };
  }

  const resolvedCandidates =
    candidates ||
    collectZoneCandidates(zone, filters, {
      source,
      excludeSummonRestrict,
      defaultLevelOp,
      extraFilter,
    });

  if (resolvedCandidates.length === 0) {
    return { candidates: resolvedCandidates, selected: [], cancelled: false };
  }

  const resolvedMax = Math.min(
    Number.isFinite(maxSelect) ? maxSelect : resolvedCandidates.length,
    resolvedCandidates.length
  );

  const resolvedMin = Math.max(Number(minSelect ?? 0), 0);

  const isAIPlayer = isAI(player);
  if (isAIPlayer) {
    const selected =
      typeof botSelect === "function"
        ? botSelect(resolvedCandidates, resolvedMax, resolvedMin)
        : resolvedCandidates.slice(0, resolvedMax);

    return {
      candidates: resolvedCandidates,
      selected,
      cancelled: false,
    };
  }

  if (typeof selectionContractBuilder === "function") {
    const selectionData = selectionContractBuilder(resolvedCandidates, {
      min: resolvedMin,
      max: resolvedMax,
    });

    if (!selectionData) {
      return { candidates: resolvedCandidates, selected: [], cancelled: false };
    }

    const selectedKeys = await selectCards({
      game,
      player,
      selectionContract: selectionData.selectionContract,
      requirementId: selectionData.requirementId,
      kind: selectionData.kind || selectionData.selectionContract?.kind,
      autoSelectorOptions: selectionData.autoSelectorOptions,
    });

    if (selectedKeys === null) {
      return { candidates: resolvedCandidates, selected: [], cancelled: true };
    }

    const decorated = selectionData.decorated || [];
    const selected = selectedKeys
      .map((key) => decorated.find((cand) => cand.key === key)?.cardRef)
      .filter(Boolean);

    return { candidates: resolvedCandidates, selected, cancelled: false };
  }

  if (resolvedMax === 1) {
    if (promptPlayer === false || resolvedCandidates.length === 1) {
      return {
        candidates: resolvedCandidates,
        selected: [resolvedCandidates[0]],
        cancelled: false,
      };
    }

    if (typeof selectSingle === "function") {
      const chosen = await selectSingle(resolvedCandidates);
      if (!chosen) {
        return {
          candidates: resolvedCandidates,
          selected: [],
          cancelled: true,
        };
      }

      return {
        candidates: resolvedCandidates,
        selected: [chosen],
        cancelled: false,
      };
    }
  }

  if (typeof selectMulti === "function") {
    const chosen = await selectMulti(resolvedCandidates, {
      min: resolvedMin,
      max: resolvedMax,
    });

    if (chosen === null) {
      return { candidates: resolvedCandidates, selected: [], cancelled: true };
    }

    return { candidates: resolvedCandidates, selected: chosen || [] };
  }

  return {
    candidates: resolvedCandidates,
    selected: resolvedCandidates.slice(0, resolvedMax),
    cancelled: false,
  };
}

export async function payCostAndThen(
  { selectCost, player, engine, sendOptions },
  next
) {
  if (!player || !engine || typeof selectCost !== "function") {
    return false;
  }

  const selected = await selectCost();

  if (!Array.isArray(selected) || selected.length === 0) {
    return false;
  }

  await sendCardsToGraveyard(selected, player, engine, sendOptions);

  if (typeof next === "function") {
    return await next(selected);
  }

  return true;
}

export async function selectCards({
  game,
  player,
  selectionContract,
  requirementId,
  kind,
  autoSelectorOptions,
  autoSelectKeys,
}) {
  if (!game || !player || !selectionContract || !requirementId) {
    return null;
  }

  const isAIPlayer = isAI(player);

  if (isAIPlayer) {
    const autoResult =
      typeof game.autoSelector?.select === "function"
        ? game.autoSelector.select(selectionContract, autoSelectorOptions)
        : null;

    if (autoResult?.ok) {
      return autoResult.selections?.[requirementId] || [];
    }

    if (typeof autoSelectKeys === "function") {
      return autoSelectKeys();
    }

    return [];
  }

  // Use client-side target selection
  return new Promise((resolve) => {
    game.startTargetSelectionSession({
      kind,
      selectionContract,
      onCancel: () => resolve(null),
      execute: (selections) => {
        resolve(selections?.[requirementId] || []);
        return { success: true, needsSelection: false };
      },
    });
  });
}

export async function summonFromHandCore({
  card,
  player,
  engine,
  game,
  position,
  cannotAttackThisTurn,
}) {
  if (!card || !player || !engine || !game) {
    return { success: false, position };
  }

  // 🚨 CRITICAL VALIDATION: Only monsters can be summoned to field
  if (card.cardKind !== "monster") {
    console.error(
      `[summonFromHandCore] ❌ BLOCKED: Attempted to summon non-monster "${card.name}" (kind: ${card.cardKind})`
    );
    return { success: false, position };
  }

  // Unified semantics: undefined ? choice, use EffectEngine resolver
  const resolvedPosition = await engine.chooseSpecialSummonPosition(
    card,
    player,
    { position }
  );

  const moveResult =
    typeof game.moveCard === "function"
      ? game.moveCard(card, player, "field", {
          fromZone: "hand",
          position: resolvedPosition,
          isFacedown: false,
          resetAttackFlags: true,
        })
      : null;

  if (moveResult && moveResult.success === false) {
    return { success: false, position: resolvedPosition };
  }

  if (moveResult == null) {
    const handIndex = player.hand.indexOf(card);
    if (handIndex !== -1) {
      player.hand.splice(handIndex, 1);
    }

    card.position = resolvedPosition;
    card.isFacedown = false;
    card.hasAttacked = false;
    card.owner = player.id;
    card.controller = player.id;

    player.field.push(card);
  }

  card.cannotAttackThisTurn = cannotAttackThisTurn || false;

  return { success: true, position: resolvedPosition };
}
