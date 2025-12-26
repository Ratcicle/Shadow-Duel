/**
 * ActionHandlers.js
 *
 * Generic, reusable action handlers for card effects.
 * This module provides a registry system and generic handlers that replace
 * card-specific hardcoded methods in EffectEngine.
 *
 * Philosophy:
 * - Handlers are generic and configured via action properties
 * - Card-specific logic should be in card definitions, not in handlers
 * - New cards should work without modifying this file
 */

import { getCardDisplayName } from "./i18n.js";

const NULL_UI = {
  log: () => {},
};

function getUI(game) {
  return game?.ui || game?.renderer || NULL_UI;
}

// Map technical status names to user-friendly descriptions
const STATUS_DISPLAY_NAMES = {
  tempBattleIndestructible: "battle indestructibility",
  battleDamageHealsControllerThisTurn: "battle damage healing",
  battleIndestructible: "permanent battle indestructibility",
  piercing: "piercing damage",
  canAttackDirectlyThisTurn: "direct attack ability",
  effectsNegated: "effect negation",
};

function resolveTargetCards(action, ctx, targets, options = {}) {
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

function sendCardsToGraveyard(cards, player, engine, options = {}) {
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
      const moveResult = game.moveCard(card, player, "graveyard", { fromZone });
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

function collectZoneCandidates(zone, filters = {}, options = {}) {
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

function buildFieldSelectionCandidates(owner, game, cards, options = {}) {
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

async function selectCardsFromZone({
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

  if (player.id === "bot") {
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

async function payCostAndThen(
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

  sendCardsToGraveyard(selected, player, engine, sendOptions);

  if (typeof next === "function") {
    return await next(selected);
  }

  return true;
}

async function selectCards({
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

  if (player.id === "bot") {
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

async function summonFromHandCore({
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

  // Unified semantics: undefined → choice, use EffectEngine resolver
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

export class ActionHandlerRegistry {
  constructor() {
    this.handlers = new Map();
  }

  /**
   * Register a handler for an action type
   * @param {string} actionType - The action type identifier
   * @param {Function} handler - Handler function (action, ctx, targets, engine) => Promise<boolean>
   */
  register(actionType, handler) {
    this.handlers.set(actionType, handler);
  }

  /**
   * Get a handler for an action type
   * @param {string} actionType
   * @returns {Function|null}
   */
  get(actionType) {
    return this.handlers.get(actionType) || null;
  }

  /**
   * Check if a handler exists for an action type
   * @param {string} actionType
   * @returns {boolean}
   */
  has(actionType) {
    return this.handlers.has(actionType);
  }

  /**
   * List registered action type identifiers.
   * @returns {string[]}
   */
  listTypes() {
    return Array.from(this.handlers.keys());
  }
}

// Helper: create a simple wrapper that proxies to EffectEngine methods.
// Keeps the behavior identical to legacy switch/case while moving action types
// into the registry.
function proxyEngineMethod(methodName) {
  return async (action, ctx, targets, engine) => {
    if (!engine || typeof engine[methodName] !== "function") {
      return false;
    }
    // Many legacy methods are sync, but awaiting is safe and keeps a uniform signature.
    return await engine[methodName](action, ctx, targets);
  };
}

/**
 * Generic handler for special summoning from any zone with filters
 * UNIFIED HANDLER - Replaces both single and multi-card summon patterns
 *
 * Combines functionality of:
 * - handleSpecialSummonFromZone (single card, any zone)
 * - handleSpecialSummonFromGraveyard (multi-card, graveyard-specific)
 *
 * Action properties:
 * - zone: "deck" | "hand" | "graveyard" | "banished" (default: "deck")
 * - filters: { archetype, name, level, levelOp, cardKind, excludeSelf }
 * - count: { min, max } - for multi-card selection (default: { min: 1, max: 1 })
 * - position: "attack" | "defense" | "choice" (default: "choice")
 * - cannotAttackThisTurn: boolean
 * - negateEffects: boolean (default: false)
 * - promptPlayer: boolean (default: true for human player)
 * - requireSource: boolean (default: false) - if true, summon source card from zone
 * - banishCost: boolean (default: false) - if true, banish source as cost before summoning
 */
export async function handleSpecialSummonFromZone(
  action,
  ctx,
  targets,
  engine
) {
  const { player, source, destroyed } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const zoneSpec = action.zone || "deck";
  const zoneNames = Array.isArray(zoneSpec) ? zoneSpec : [zoneSpec];
  const zoneEntries = zoneNames
    .filter((name) => typeof name === "string")
    .map((name) => ({ name, list: player[name] }))
    .filter((entry) => Array.isArray(entry.list));

  const zoneHasCards = zoneEntries.some((entry) => entry.list.length > 0);
  if (!zoneHasCards) {
    getUI(game)?.log(
      `No cards in ${Array.isArray(zoneSpec) ? zoneSpec.join("/") : zoneSpec}.`
    );
    return false;
  }

  // Handle banish cost (before finding candidates)
  if (action.banishCost && source) {
    for (const entry of zoneEntries) {
      const idx = entry.list.indexOf(source);
      if (idx !== -1) {
        entry.list.splice(idx, 1);
        player.banished = player.banished || [];
        player.banished.push(source);
        getUI(game)?.log(`${source.name} was banished as cost.`);
        break;
      }
    }
  }

  // Determine candidates
  let candidates = [];

  if (action.requireSource) {
    // Summon the source/destroyed card itself
    const card = source || destroyed;
    const inAnyZone = zoneEntries.some((entry) => entry.list.includes(card));
    if (!card || !inAnyZone) {
      getUI(game)?.log("Card not in specified zone.");
      return false;
    }
    candidates = [card];
  } else {
    // Apply filters to find candidates
    const filters = action.filters || {};
    const excludeSummonRestrict = action.excludeSummonRestrict || [];

    // Map action-level properties to filters
    if (action.cardName) {
      filters.name = action.cardName;
    }
    if (action.archetype) {
      filters.archetype = action.archetype;
    }
    if (action.cardKind) {
      filters.cardKind = action.cardKind;
    }
    // Use monsterType for filtering by monster type (e.g., "Dragon")
    // to avoid conflict with action.type which is the handler type
    if (action.monsterType) {
      filters.type = action.monsterType;
    }
    if (Number.isFinite(action.minLevel)) {
      filters.minLevel = action.minLevel;
    }
    if (Number.isFinite(action.maxLevel)) {
      filters.maxLevel = action.maxLevel;
    }

    if (action.matchLevelRef) {
      const levelCard = ctx?.[action.matchLevelRef] || null;
      const levelValue = levelCard?.level;
      if (!levelValue) {
        getUI(game)?.log("Cannot match level: no level on reference card.");
        return false;
      }
      filters.level = levelValue;
      filters.levelOp = filters.levelOp || action.levelOp || "eq";
    }

    // Debug logging
    console.log("[handleSpecialSummonFromZone] Debug:", {
      playerId: player.id,
      zoneSpec,
      zoneEntriesLength: zoneEntries.length,
      zoneContents: zoneEntries.map((e) => ({
        name: e.name,
        cards: e.list.map((c) => c?.name),
      })),
      filters: JSON.stringify(filters),
      actionCardName: action.cardName,
    });

    candidates = zoneEntries.flatMap((entry) =>
      collectZoneCandidates(entry.list, filters, {
        source,
        excludeSummonRestrict,
      })
    );

    console.log(
      "[handleSpecialSummonFromZone] Candidates found:",
      candidates.map((c) => c?.name)
    );
  }

  // ✅ FASE 1: Filtrar cartas que não podem ser special summoned
  candidates = candidates.filter((card) => {
    if (card.cannotBeSpecialSummoned) {
      const ui = getUI(game);
      if (ui && ui.log) {
        ui.log(`${card.name} cannot be Special Summoned.`);
      }
      return false;
    }
    return true;
  });

  if (candidates.length === 0) {
    getUI(game)?.log(
      `No valid cards in ${
        Array.isArray(zoneSpec) ? zoneSpec.join("/") : zoneSpec
      } matching filters.`
    );
    return false;
  }

  // Determine how many cards to summon
  const count = action.count || { min: 1, max: 1 };
  const dynamicSource = count.maxFrom;
  let dynamicMax = null;
  if (dynamicSource === "opponentFieldCount") {
    const opponent = ctx?.opponent || engine.game?.getOpponent?.(player);
    dynamicMax = opponent?.field ? opponent.field.length : 0;
  }
  const dynamicCap = Number.isFinite(count.cap)
    ? count.cap
    : Number.isFinite(count.maxCap)
    ? count.maxCap
    : 5;
  const baseMax = Number.isFinite(count.max) ? count.max : 1;
  const resolvedMax =
    dynamicMax !== null ? Math.min(dynamicMax, dynamicCap, baseMax) : baseMax;
  const maxSelect = Math.min(
    resolvedMax,
    candidates.length,
    5 - player.field.length
  );

  if (maxSelect === 0) {
    getUI(game)?.log("Field is full, cannot Special Summon.");
    return false;
  }

  // Single card summon (original behavior)
  if (count.max === 1 || maxSelect === 1) {
    const selection = await selectCardsFromZone({
      game,
      player,
      candidates,
      maxSelect: 1,
      promptPlayer: action.promptPlayer !== false,
      botSelect: (cards) => [
        cards.reduce((top, card) => {
          const cardAtk = card.atk || 0;
          const topAtk = top.atk || 0;
          return cardAtk >= topAtk ? card : top;
        }, cards[0]),
      ],
      selectSingle: (cards) => {
        const renderer = getUI(game);
        const searchModal = renderer?.getSearchModalElements?.();
        const defaultCardName = cards[0]?.name || "";

        if (!searchModal) {
          return cards[0];
        }

        return new Promise((resolve) => {
          game.isResolvingEffect = true;
          renderer.showSearchModalVisual(
            searchModal,
            cards,
            defaultCardName,
            (selectedName) => {
              const chosen =
                cards.find((c) => c && c.name === selectedName) || cards[0];
              game.isResolvingEffect = false;
              resolve(chosen);
            }
          );
        });
      },
    });

    if (!selection.selected || selection.selected.length === 0) {
      return false;
    }

    return await summonCards(
      selection.selected,
      zoneEntries,
      player,
      action,
      engine
    );
  }

  // Multi-card summon (graveyard revival pattern)
  // Bot: auto-select best cards (highest ATK)
  const minRequired = Number(count.min ?? 0);
  const dynamicMaxSelect =
    dynamicMax !== null
      ? Math.min(dynamicMax, dynamicCap, 5 - player.field.length)
      : maxSelect;

  const selection = await selectCardsFromZone({
    game,
    player,
    candidates,
    maxSelect: dynamicMaxSelect,
    minSelect: minRequired,
    botSelect: (cards, max) =>
      cards
        .slice()
        .sort((a, b) => (b.atk || 0) - (a.atk || 0))
        .slice(0, max),
    selectMulti: (cards, range) => {
      if (!getUI(game)?.showMultiSelectModal) {
        return cards
          .slice()
          .sort((a, b) => (b.atk || 0) - (a.atk || 0))
          .slice(0, range.max);
      }
      return new Promise((resolve) => {
        getUI(game).showMultiSelectModal(
          cards,
          { min: range.min, max: range.max },
          (selected) => {
            resolve(selected || []);
          }
        );
      });
    },
  });

  const selected = selection.selected || [];
  if (selected.length === 0) {
    if (minRequired === 0) {
      getUI(game)?.log("No cards selected (optional).");
      if (typeof game.updateBoard === "function") {
        game.updateBoard();
      }
      return true;
    }
    getUI(game)?.log("No cards selected.");
    return false;
  }

  return await summonCards(selected, zoneEntries, player, action, engine);
}

/**
 * Helper function to summon one or more cards
 * Unified to handle both single and multi-card summons
 */
async function summonCards(cards, sourceZoneEntries, player, action, engine) {
  const game = engine.game;
  let summoned = 0;
  const setAtkToZero = action.setAtkToZeroAfterSummon === true;
  const setDefToZero = action.setDefToZeroAfterSummon === true;
  const canUseMoveCard = game && typeof game.moveCard === "function";
  const fromZoneSpec =
    action.fromZone || action.zone || action.summonZone || "deck";
  const fromZoneName = Array.isArray(fromZoneSpec)
    ? null
    : typeof fromZoneSpec === "string"
    ? fromZoneSpec
    : null;

  for (const card of cards) {
    if (!card || player.field.length >= 5) break;

    const resolvedFromZone =
      typeof action.fromZone === "string"
        ? action.fromZone
        : typeof engine.findCardZone === "function"
        ? engine.findCardZone(player, card)
        : fromZoneName;

    // Unified semantics: delegate to unified resolver
    const position = await engine.chooseSpecialSummonPosition(card, player, {
      position: action.position,
    });

    let usedMoveCard = false;
    if (canUseMoveCard) {
      const moveResult = game.moveCard(card, player, "field", {
        fromZone: resolvedFromZone || undefined,
        position,
        isFacedown: false,
        resetAttackFlags: true,
      });
      if (moveResult?.success === false) {
        continue;
      }
      usedMoveCard = true;
    } else {
      // Remove from source zone (fallback)
      const fallbackZoneName =
        resolvedFromZone ||
        (Array.isArray(sourceZoneEntries) && sourceZoneEntries.length > 0
          ? sourceZoneEntries[0].name
          : null);
      const fallbackArr =
        (fallbackZoneName && player[fallbackZoneName]) || player.deck || [];
      const cardIndex = fallbackArr.indexOf(card);
      if (cardIndex !== -1) {
        fallbackArr.splice(cardIndex, 1);
      }

      card.position = position;
      card.isFacedown = false;
      card.hasAttacked = false;
      card.attacksUsedThisTurn = 0;
      card.owner = player.id;
      card.controller = player.id;
      player.field.push(card);
    }

    card.cannotAttackThisTurn = action.cannotAttackThisTurn || false;

    if (action.negateEffects) {
      card.effectsNegated = true;
    }

    if (setAtkToZero) {
      if (card.originalAtk == null) {
        card.originalAtk = card.atk;
      }
      card.atk = 0;
    }

    if (setDefToZero) {
      if (card.originalDef == null) {
        card.originalDef = card.def;
      }
      card.def = 0;
    }

    if (!usedMoveCard) {
      await game.emit("after_summon", {
        card: card,
        player: player,
        method: "special",
        fromZone: resolvedFromZone || fromZoneName || "deck",
      });
    }

    summoned++;
  }

  if (summoned > 0) {
    // Log message
    const zoneName = Array.isArray(action.zone)
      ? action.zone.join("/")
      : action.zone || "deck";
    const cardText = summoned === 1 ? cards[0].name : `${summoned} cards`;
    const positionText =
      action.position === "defense"
        ? "Defense"
        : action.position === "attack"
        ? "Attack"
        : "";
    const restrictText = action.cannotAttackThisTurn
      ? " (cannot attack this turn)"
      : "";
    const negateText = action.negateEffects ? " (effects negated)" : "";

    getUI(game)?.log(
      `${
        player.name || player.id
      } Special Summoned ${cardText} from ${zoneName}${
        positionText ? ` in ${positionText} Position` : ""
      }${restrictText}${negateText}.`
    );

    game.updateBoard();
  }

  return summoned > 0;
}

/**
 * Send a monster you control to the Graveyard, then Special Summon
 * 1 monster from your Graveyard with the same Level.
 *
 * Action properties:
 * - targetRef / costTargetRef: reference to the cost selection
 * - summonZone: zone to summon from (default: "graveyard")
 * - summonFilters: additional summon filters (archetype, name, etc.)
 * - position: "attack" | "defense" | "choice" (default: "choice")
 * - cannotAttackThisTurn: boolean (default: false)
 * - negateEffects: boolean (default: false)
 * - promptPlayer: boolean (default: true for human player)
 */
export async function handleTransmutate(action, ctx, targets, engine) {
  const { player } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const costRef = action.costTargetRef || action.targetRef;
  const costCards = resolveTargetCards(action, ctx, targets, {
    targetRef: costRef ?? undefined,
  });

  if (costCards.length === 0) {
    getUI(game)?.log("No valid cost selected for Transmutate.");
    return false;
  }

  const costCard = costCards[0];
  const costLevel = costCard?.level ?? 0;
  if (!costLevel) {
    getUI(game)?.log("Transmutate requires a monster with a Level.");
    return false;
  }

  const fromZone =
    (typeof engine.findCardZone === "function" &&
      engine.findCardZone(player, costCard)) ||
    action.costFromZone ||
    "field";

  sendCardsToGraveyard([costCard], player, engine, {
    fromZone,
    fallbackZone: "field",
    pushIfMissing: true,
  });

  if (typeof game.updateBoard === "function") {
    game.updateBoard();
  }

  const summonFilters = {
    ...(action.summonFilters || action.filters || {}),
  };
  if (!summonFilters.cardKind) {
    summonFilters.cardKind = "monster";
  }
  summonFilters.level = costLevel;
  summonFilters.levelOp = action.levelOp || "eq";

  const summonAction = {
    zone: action.summonZone || action.zone || "graveyard",
    filters: summonFilters,
    count: action.count || { min: 1, max: 1 },
    position: action.position || "choice",
    cannotAttackThisTurn: action.cannotAttackThisTurn || false,
    negateEffects: action.negateEffects || false,
    promptPlayer: action.promptPlayer,
    excludeSummonRestrict: action.excludeSummonRestrict || [],
  };

  return await handleSpecialSummonFromZone(summonAction, ctx, targets, engine);
}

/**
 * Generic handler for special summon from hand with cost
 * Replaces: applyVoidHaunterSpecialSummon, applyVoidForgottenKnightSpecialSummon, etc.
 *
 * Action properties:
 * - costTargetRef: reference to target definition for cost
 * - position: "attack" | "defense" | "choice"
 * - cannotAttackThisTurn: boolean
 */
export async function handleSpecialSummonFromHandWithCost(
  action,
  ctx,
  targets,
  engine
) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !source || !game) {
    return false;
  }

  if (!player.hand?.includes(source)) {
    getUI(game)?.log("Card must be in hand to activate this effect.");
    return false;
  }

  if (player.field.length >= 5) {
    getUI(game)?.log("Field is full.");
    return false;
  }

  const performSummon = async () => {
    const summonResult = await summonFromHandCore({
      card: source,
      player,
      engine,
      game,
      position: action.position || "choice",
      cannotAttackThisTurn: action.cannotAttackThisTurn || false,
    });
    return summonResult.success;
  };

  const isTiered =
    action.type === "special_summon_from_hand_with_tiered_cost" ||
    action.useTieredCost === true ||
    Array.isArray(action.tierOptions);

  if (!isTiered) {
    // Validate cost was paid
    const costTargets = resolveTargetCards(action, ctx, targets, {
      targetRef: action.costTargetRef,
      requireArray: true,
    });

    if (!costTargets || costTargets.length === 0) {
      getUI(game)?.log("No cost paid for special summon.");
      return false;
    }

    // ✅ Process cost cards based on destination
    const costDestination = action.costDestination || "graveyard";

    if (costDestination === "banish") {
      // BANISH = REMOVE FROM GAME (not move to zone)
      for (const costCard of costTargets) {
        if (!costCard) continue;

        // Find the zone where the cost card is
        const fromZone =
          typeof engine.findCardZone === "function"
            ? engine.findCardZone(player, costCard)
            : null;

        if (fromZone && Array.isArray(player[fromZone])) {
          const idx = player[fromZone].indexOf(costCard);
          if (idx > -1) {
            player[fromZone].splice(idx, 1);
          }
        }

        // Track banished cards (read-only, not accessible by effects)
        if (!game.banishedCards) {
          game.banishedCards = [];
        }
        game.banishedCards.push(costCard);
      }

      getUI(game)?.log(
        `Banished ${costTargets.length} card(s) (removed from game).`
      );
    } else {
      // Default: Move cost cards to graveyard
      sendCardsToGraveyard(costTargets, player, engine, {
        resolveFromZone: (costCard) =>
          typeof engine.findCardZone === "function"
            ? engine.findCardZone(player, costCard) || "field"
            : "field",
        fallbackZone: "field",
        useResolvedZoneOnFallback: false,
      });
    }

    const success = await performSummon();
    if (!success) {
      return false;
    }

    getUI(game)?.log(
      `${player.name || player.id} Special Summoned ${source.name} from hand.`
    );

    game.updateBoard();
    return true;
  }

  const filters = action.costFilters || {
    name: "Void Hollow",
    cardKind: "monster",
  };
  const matchesFilters = (card) => {
    if (!card) return false;
    if (filters.cardKind && card.cardKind !== filters.cardKind) return false;
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

  const costCandidates = player.field.filter(matchesFilters);
  const minCost = action.minCost ?? 1;
  const maxCost = action.maxCost ?? 3;
  const allowedMax = Math.min(maxCost, costCandidates.length);
  if (allowedMax < minCost) {
    getUI(game)?.log("Not enough cost monsters to Special Summon.");
    return false;
  }

  const defaultTierOptions = [
    {
      count: 1,
      label: "Tier 1",
      description: "+300 ATK atÃ© o final do turno",
    },
    {
      count: 2,
      label: "Tier 2",
      description: "+300 ATK e nÃ£o pode ser destruÃ­da em batalha",
    },
    {
      count: 3,
      label: "Tier 3",
      description:
        "+300 ATK, indestrutÃ­vel em batalha e destrÃ³i 1 carta do oponente",
    },
  ];

  const tierOptions = (action.tierOptions || defaultTierOptions).filter(
    (opt) => opt.count >= minCost && opt.count <= allowedMax
  );

  let chosenCount = null;

  if (player.id === "bot") {
    chosenCount = allowedMax;
  } else if (getUI(game)?.showTierChoiceModal) {
    chosenCount = await getUI(game).showTierChoiceModal({
      title: action.tierTitle || source.name,
      options: tierOptions,
    });
  } else if (getUI(game)?.showNumberPrompt) {
    const parsed = getUI(game).showNumberPrompt(
      `Choose how many Void Hollow to send (1-${allowedMax}):`,
      String(allowedMax)
    );
    if (parsed !== null && parsed >= minCost && parsed <= allowedMax) {
      chosenCount = parsed;
    }
  }

  if (!chosenCount) {
    return false;
  }

  const costPaid = await payCostAndThen(
    {
      player,
      engine,
      sendOptions: { fromZone: "field", fallbackZone: "field" },
      selectCost: async () => {
        const selection = await selectCardsFromZone({
          game,
          player,
          candidates: costCandidates,
          maxSelect: chosenCount,
          minSelect: chosenCount,
          botSelect: (cards, max) =>
            cards
              .slice()
              .sort((a, b) => (a.atk || 0) - (b.atk || 0))
              .slice(0, max),
          selectionContractBuilder: (cards) => {
            const requirementId = "tier_cost";
            const decorated = buildFieldSelectionCandidates(
              player,
              game,
              cards,
              { ownerLabel: player.id }
            );
            return {
              kind: "cost",
              requirementId,
              decorated,
              selectionContract: {
                kind: "cost",
                message:
                  "Select the Void Hollow cards to send to the Graveyard.",
                requirements: [
                  {
                    id: requirementId,
                    min: chosenCount,
                    max: chosenCount,
                    zones: ["field"],
                    owner: "player",
                    filters: { cardKind: "monster", name: "Void Hollow" },
                    allowSelf: true,
                    distinct: true,
                    candidates: decorated,
                  },
                ],
                ui: { useFieldTargeting: true },
                metadata: { context: "tier_cost" },
              },
            };
          },
        });

        if (selection.cancelled || selection.selected.length !== chosenCount) {
          return null;
        }

        return selection.selected;
      },
    },
    async () => {
      const success = await performSummon();
      if (!success) {
        return false;
      }

      getUI(game)?.log(
        `${
          player.name || player.id
        } enviou ${chosenCount} custo(s) para invocar ${source.name}.`
      );

      const buffAmount = action.tier1AtkBoost ?? 300;
      if (chosenCount >= 1 && buffAmount !== 0) {
        engine.applyBuffAtkTemp(
          { targetRef: "tier_self", amount: buffAmount },
          { tier_self: [source] }
        );
      }

      if (chosenCount >= 2) {
        source.battleIndestructible = true;
      }

      if (chosenCount >= 3) {
        const opponent = game.getOpponent(player);
        const opponentCards = [
          ...(opponent.field || []),
          ...(opponent.spellTrap || []),
          opponent.fieldSpell,
        ].filter(Boolean);

        if (opponentCards.length > 0) {
          const requirementId = "tier_destroy";
          const decorated = buildFieldSelectionCandidates(
            opponent,
            game,
            opponentCards,
            { ownerLabel: opponent.id }
          );
          const selectionContract = {
            kind: "target",
            message: "Select a card to destroy.",
            requirements: [
              {
                id: requirementId,
                min: 1,
                max: 1,
                zones: ["field", "spellTrap", "fieldSpell"],
                owner: "opponent",
                filters: {},
                allowSelf: true,
                distinct: true,
                candidates: decorated,
              },
            ],
            ui: { useFieldTargeting: true },
            metadata: { context: "tier_destroy" },
          };

          const selectedKeys = await selectCards({
            game,
            player,
            selectionContract,
            requirementId,
            kind: "target",
            autoSelectKeys: () =>
              decorated
                .slice()
                .sort((a, b) => (b.atk || 0) - (a.atk || 0))
                .slice(0, 1)
                .map((cand) => cand.key),
          });

          const chosenKey = selectedKeys?.[0];
          const targetToDestroy =
            decorated.find((cand) => cand.key === chosenKey)?.cardRef || null;

          if (targetToDestroy) {
            // Check immunity before destroying
            if (engine.isImmuneToOpponentEffects(targetToDestroy, player)) {
              getUI(game)?.log(
                `${targetToDestroy.name} is immune to opponent's effects.`
              );
            } else {
              const result = await game.destroyCard(targetToDestroy, {
                cause: "effect",
                sourceCard: source,
                opponent: player,
              });
              if (result?.destroyed) {
                getUI(game)?.log(
                  `${source.name} destruiu ${targetToDestroy.name}.`
                );
              }
            }
          }
        }
      }

      game.updateBoard();
      return true;
    }
  );

  return costPaid;
}

/**
 * Generic handler for returning a card to hand and special summoning another
 * Replaces: applyVoidWalkerBounceAndSummon
 *
 * Action properties:
 * - bounceSource: boolean (if true, bounce the source card)
 * - filters: { archetype, name, level, levelOp, excludeSelf }
 * - position: "attack" | "defense" | "choice"
 */
export async function handleBounceAndSummon(action, ctx, targets, engine) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !source || !game) return false;

  // Find valid targets in hand based on filters
  const filters = action.filters || {};
  const validTargets = player.hand.filter((card) => {
    if (!card) return false;

    if (filters.cardKind && card.cardKind !== filters.cardKind) return false;

    if (filters.archetype) {
      const hasArchetype =
        card.archetype === filters.archetype ||
        (Array.isArray(card.archetypes) &&
          card.archetypes.includes(filters.archetype));
      if (!hasArchetype) return false;
    }

    if (filters.excludeSelf && card === source) return false;
    if (filters.name && card.name !== filters.name) return false;

    if (filters.level !== undefined) {
      const cardLevel = card.level || 0;
      const op = filters.levelOp || "lte";

      if (op === "eq" && cardLevel !== filters.level) return false;
      if (op === "lte" && cardLevel > filters.level) return false;
      if (op === "gte" && cardLevel < filters.level) return false;
    }

    return true;
  });

  if (validTargets.length === 0) {
    getUI(game)?.log("No valid monsters in hand to summon.");
    return false;
  }

  if (player.field.length >= 5) {
    getUI(game)?.log("Field is full.");
    return false;
  }

  // Bot auto-selection (highest ATK)
  if (player.id === "bot") {
    const best = validTargets.reduce((top, c) => {
      const cAtk = c.atk || 0;
      const topAtk = top.atk || 0;
      return cAtk >= topAtk ? c : top;
    }, validTargets[0]);

    return await bounceAndSummonCard(source, best, player, action, engine);
  }

  // Player selection
  const renderer = getUI(game);
  const searchModal = renderer?.getSearchModalElements?.();
  const defaultCardName = validTargets[0]?.name || "";

  if (searchModal) {
    return new Promise((resolve) => {
      game.isResolvingEffect = true;

      renderer.showSearchModalVisual(
        searchModal,
        validTargets,
        defaultCardName,
        async (selectedName) => {
          const target =
            validTargets.find((c) => c && c.name === selectedName) ||
            validTargets[0];
          const result = await bounceAndSummonCard(
            source,
            target,
            player,
            action,
            engine
          );
          game.isResolvingEffect = false;
          resolve(result);
        }
      );
    });
  }

  // Fallback
  const fallback = validTargets[0];
  return await bounceAndSummonCard(source, fallback, player, action, engine);
}

/**
 * Helper function to bounce source and summon target
 */
async function bounceAndSummonCard(source, target, player, action, engine) {
  const game = engine.game;

  if (!target || player.field.length >= 5) return false;

  // Bounce source to hand
  if (action.bounceSource !== false) {
    if (typeof game.moveCard === "function") {
      game.moveCard(source, player, "hand", { fromZone: "field" });
    } else {
      const fieldIndex = player.field.indexOf(source);
      if (fieldIndex !== -1) {
        player.field.splice(fieldIndex, 1);
        player.hand.push(source);
      }
    }
  }

  // Determine position
  let position = action.position || "choice";
  if (position === "choice") {
    position = await engine.chooseSpecialSummonPosition(target, player);
  }

  const moveResult =
    typeof game.moveCard === "function"
      ? game.moveCard(target, player, "field", {
          fromZone: "hand",
          position,
          isFacedown: false,
          resetAttackFlags: true,
        })
      : null;
  if (moveResult && moveResult.success === false) {
    return false;
  }
  if (moveResult == null) {
    const handIndex = player.hand.indexOf(target);
    if (handIndex !== -1) {
      player.hand.splice(handIndex, 1);
    }
    target.position = position;
    target.isFacedown = false;
    target.hasAttacked = false;
    target.owner = player.id;
    target.controller = player.id;
    player.field.push(target);
  }
  target.cannotAttackThisTurn = action.cannotAttackThisTurn || false;

  const bounceText =
    action.bounceSource !== false ? `Returned ${source.name} to hand and ` : "";
  const positionText = position === "defense" ? "Defense" : "Attack";

  getUI(game)?.log(
    `${bounceText}Special Summoned ${target.name} in ${positionText} Position.`
  );

  game.updateBoard();
  return true;
}

/**
 * Generic handler for banishing resolved targets
 * Allows cards to banish targets resolved by action definitions
 */
export async function handleBanish(action, ctx, targets, engine) {
  const { player } = ctx;
  const game = engine.game;

  if (!game) return false;

  const targetRef = action.targetRef;
  let resolved = targetRef ? targets?.[targetRef] : [];
  const useDestroyed =
    action.useDestroyed === true || action.type === "banish_destroyed_monster";

  if ((!Array.isArray(resolved) || resolved.length === 0) && useDestroyed) {
    resolved = ctx?.destroyed ? [ctx.destroyed] : [];
  }

  // Allow banishing the source card when targetRef is "self" and no targets were pre-resolved
  if (
    (!Array.isArray(resolved) || resolved.length === 0) &&
    targetRef === "self" &&
    ctx?.source
  ) {
    resolved = [ctx.source];
  }

  if (!Array.isArray(resolved) || resolved.length === 0) {
    getUI(game)?.log("Nenhum alvo vÃ¡lido para banish.");
    return false;
  }

  function removeCardFromOwnerZones(owner, card) {
    const zones = [
      "hand",
      "field",
      "graveyard",
      "deck",
      "spellTrap",
      "fieldSpell",
      "banished",
    ];
    for (const z of zones) {
      const zoneArr = owner?.[z];
      if (!Array.isArray(zoneArr)) continue;
      const idx = zoneArr.findIndex((c) => c === card);
      if (idx !== -1) {
        zoneArr.splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  let banishedCount = 0;
  const opponent =
    player && typeof engine.getOpponent === "function"
      ? engine.getOpponent(player)
      : null;

  for (const tgt of resolved) {
    if (!tgt) continue;

    const fallbackOwner =
      tgt.ownerPlayer ||
      (opponent &&
      (tgt.owner === opponent.id ||
        tgt.controller === opponent.id ||
        tgt.owner === "opponent" ||
        tgt.controller === "opponent")
        ? opponent
        : player);
    const ownerPlayer =
      typeof engine.getOwnerOfCard === "function"
        ? engine.getOwnerOfCard(tgt)
        : fallbackOwner;

    if (!ownerPlayer) {
      getUI(game)?.log(`NÃ£o foi possÃ­vel determinar o dono de ${tgt.name}.`);
      continue;
    }

    if (action.fromZone && !ownerPlayer[action.fromZone]?.includes(tgt)) {
      getUI(game)?.log(
        `${tgt.name} nÃ£o estÃ¡ mais em ${action.fromZone}; nÃ£o pode ser banida.`
      );
      continue;
    }

    removeCardFromOwnerZones(ownerPlayer, tgt);

    ownerPlayer.banished = ownerPlayer.banished || [];
    ownerPlayer.banished.push(tgt);

    tgt.location = "banished";

    if (ownerPlayer?.id) {
      tgt.owner = ownerPlayer.id;
      tgt.controller = ownerPlayer.id;
    }

    banishedCount += 1;
    getUI(game)?.log(`${tgt.name} foi banida.`);
  }

  if (banishedCount > 0) {
    game.updateBoard();
    return true;
  }

  return false;
}

/**
 * Handler for banishing a specific card from the graveyard as a cost.
 * This is used for destruction negation costs and similar effects.
 *
 * Action properties:
 * - cardName: name of the card to banish (required)
 * - count: number of cards to banish (default: 1)
 * - cardType: optional type filter (e.g., "Dragon")
 * - promptPlayer: whether to let player choose (default: true for multiple matches)
 */
export async function handleBanishCardFromGraveyard(
  action,
  ctx,
  targets,
  engine
) {
  const { player } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const cardName = action.cardName;
  const cardType = action.cardType || action.type;
  const count = action.count || 1;

  // Find matching cards in the graveyard
  const graveyard = player.graveyard || [];
  let candidates = graveyard.filter((card) => {
    if (!card) return false;
    if (cardName && card.name !== cardName) return false;
    if (cardType && card.type !== cardType) return false;
    return true;
  });

  if (candidates.length < count) {
    const filterDesc = cardName || cardType || "matching card";
    getUI(game)?.log(
      `Not enough ${filterDesc} in graveyard to banish (need ${count}, found ${candidates.length}).`
    );
    return false;
  }

  // Select cards to banish
  let toBanish = [];

  if (candidates.length === count) {
    // Exactly enough cards, no choice needed
    toBanish = candidates.slice(0, count);
  } else if (action.promptPlayer !== false && player === game.player) {
    // Player can choose which cards to banish
    const ui = getUI(game);
    if (ui?.showCardSelectionPrompt) {
      const selected = await ui.showCardSelectionPrompt({
        cards: candidates,
        min: count,
        max: count,
        message: `Select ${count} card(s) to banish from graveyard as cost`,
        zone: "graveyard",
      });
      toBanish = selected || [];
    } else {
      toBanish = candidates.slice(0, count);
    }
  } else {
    // Bot or auto-select: take first matching cards
    toBanish = candidates.slice(0, count);
  }

  if (toBanish.length < count) {
    getUI(game)?.log(`Cost not paid: not enough cards selected to banish.`);
    return false;
  }

  // Perform the banish
  let banishedCount = 0;
  for (const card of toBanish) {
    const idx = player.graveyard.indexOf(card);
    if (idx !== -1) {
      player.graveyard.splice(idx, 1);
      player.banished = player.banished || [];
      player.banished.push(card);
      card.location = "banished";
      banishedCount++;
      getUI(game)?.log(`${card.name} was banished from the graveyard.`);
    }
  }

  if (banishedCount > 0) {
    game.updateBoard();
    return true;
  }

  return false;
}

/**
 * Generic handler for setting stats to zero and negating effects
 * Implements the "Sealing the Void" effect pattern
 *
 * Action properties:
 * - targetRef: reference to the target monster(s)
 * - setAtkToZero: boolean (default: true)
 * - setDefToZero: boolean (default: true)
 * - negateEffects: boolean (default: true)
 */
export async function handleSetStatsToZeroAndNegate(
  action,
  ctx,
  targets,
  engine
) {
  const { player } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const targetCards = resolveTargetCards(action, ctx, targets, {
    targetRef: action.targetRef,
    requireArray: true,
  });

  if (targetCards.length === 0) {
    getUI(game)?.log("No valid targets for stat modification.");
    return false;
  }

  const setAtkToZero = action.setAtkToZero !== false;
  const setDefToZero = action.setDefToZero !== false;
  const negateEffects = action.negateEffects !== false;

  let modified = false;
  const affectedCards = [];

  for (const card of targetCards) {
    if (!card || card.cardKind !== "monster") continue;

    let cardModified = false;

    // Store original stats if setting to zero
    if (setAtkToZero && card.originalAtk == null) {
      card.originalAtk = card.atk;
      card.atk = 0;
      cardModified = true;
    }

    if (setDefToZero && card.originalDef == null) {
      card.originalDef = card.def;
      card.def = 0;
      cardModified = true;
    }

    // Negate effects
    if (negateEffects) {
      card.effectsNegated = true;
      cardModified = true;
    }

    if (cardModified) {
      modified = true;
      affectedCards.push(card.name);
    }
  }

  // Log a consolidated message for all affected cards
  if (modified && affectedCards.length > 0) {
    const effects = [];
    if (setAtkToZero && setDefToZero) {
      effects.push("ATK/DEF became 0");
    } else if (setAtkToZero) {
      effects.push("ATK became 0");
    } else if (setDefToZero) {
      effects.push("DEF became 0");
    }

    if (negateEffects) {
      effects.push("effects are negated");
    }

    if (effects.length > 0) {
      const cardList = affectedCards.join(", ");
      const message = `${cardList}'s ${effects.join(
        " and "
      )} until end of turn.`;
      getUI(game)?.log(message);
    }
  }

  if (modified) {
    game.updateBoard();
  }

  return modified;
}

/**
 * Generic handler for granting additional normal summons
 *
 * Action properties:
 * - count: number of additional normal summons to grant (default: 1)
 */
export async function handleGrantAdditionalNormalSummon(
  action,
  ctx,
  targets,
  engine
) {
  const { player } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const count = action.count || 1;
  player.additionalNormalSummons += count;

  const summonText = count === 1 ? "Normal Summon" : "Normal Summons";
  getUI(game)?.log(
    `You can conduct ${count} additional ${summonText} this turn.`
  );

  game.updateBoard();
  return true;
}

/**
 * Generic handler for selective field destruction based on highest ATK
 * Implements effects like "Void Lost Throne"
 *
 * Action properties:
 * - keepPerSide: number of highest ATK monsters to keep per side (default: 1)
 * - allowTieBreak: boolean - if true, player chooses which to keep on ties (default: true)
 * - modalTitle: string - custom modal title (default: "Choose Survivor")
 * - modalSubtitle: string - custom subtitle template (default: auto-generated)
 * - modalInfoText: string - custom info text (default: "All other monsters will be destroyed.")
 *
 * Effect: Destroys all monsters on field except keepPerSide highest ATK monsters per side.
 * If there's a tie for highest ATK, the card's controller chooses which to keep.
 */
async function destroySelectiveField(action, ctx, targets, engine) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const opponent = game.getOpponent(player);
  if (!opponent) return false;

  const keepPerSide = Number.isFinite(action.keepPerSide)
    ? action.keepPerSide
    : 1;
  const allowTieBreak = action.allowTieBreak !== false;

  // Get all monsters on both sides
  const playerMonsters = (player.field || []).filter(
    (card) => card && card.cardKind === "monster" && !card.isFacedown
  );
  const opponentMonsters = (opponent.field || []).filter(
    (card) => card && card.cardKind === "monster" && !card.isFacedown
  );

  if (playerMonsters.length === 0 && opponentMonsters.length === 0) {
    getUI(game)?.log("No monsters on the field to destroy.");
    return false;
  }

  // Helper function to find highest ATK monsters
  const findHighestAtkMonsters = (monsters) => {
    if (monsters.length === 0) return [];

    const maxAtk = Math.max(...monsters.map((m) => m.atk || 0));
    return monsters.filter((m) => (m.atk || 0) === maxAtk);
  };

  // Find highest ATK monsters on each side
  const playerHighest = findHighestAtkMonsters(playerMonsters);
  const opponentHighest = findHighestAtkMonsters(opponentMonsters);

  // Determine which monsters to keep
  let playerToKeep = [];
  let opponentToKeep = [];

  // Custom modal text from action properties
  const modalConfig = {
    title: action.modalTitle || "Choose Survivor",
    subtitle: action.modalSubtitle || null, // null means auto-generate
    infoText: action.modalInfoText || "All other monsters will be destroyed.",
  };

  if (keepPerSide > 0) {
    // Handle player's side
    if (playerHighest.length <= keepPerSide) {
      playerToKeep = playerHighest;
    } else if (allowTieBreak) {
      if (player.id === "bot") {
        playerToKeep = playerHighest.slice(0, keepPerSide);
      } else {
        playerToKeep = await promptTieBreaker(
          game,
          playerHighest,
          keepPerSide,
          "your",
          modalConfig
        );
      }
    } else {
      playerToKeep = playerHighest.slice(0, keepPerSide);
    }

    // Handle opponent's side
    if (opponentHighest.length <= keepPerSide) {
      opponentToKeep = opponentHighest;
    } else if (allowTieBreak) {
      if (player.id === "bot") {
        opponentToKeep = opponentHighest.slice(0, keepPerSide);
      } else {
        opponentToKeep = await promptTieBreaker(
          game,
          opponentHighest,
          keepPerSide,
          "opponent's",
          modalConfig
        );
      }
    } else {
      opponentToKeep = opponentHighest.slice(0, keepPerSide);
    }
  }

  // Determine which monsters to destroy
  const toDestroy = [];

  for (const monster of playerMonsters) {
    if (!playerToKeep.includes(monster)) {
      toDestroy.push({ card: monster, owner: player });
    }
  }

  for (const monster of opponentMonsters) {
    if (!opponentToKeep.includes(monster)) {
      toDestroy.push({ card: monster, owner: opponent });
    }
  }

  if (toDestroy.length === 0) {
    getUI(game)?.log("No monsters were destroyed.");
    return false;
  }

  // Filter out immune monsters before destroying
  // For each entry, check if the card is immune to the source player's effects
  const toDestroyFiltered = toDestroy.filter(({ card, owner }) => {
    // Only filter opponent's monsters - player's own monsters are not protected by opponent immunity
    if (owner.id === player.id) return true;

    // Check if opponent's monster is immune to player's effect
    const isImmune = engine.isImmuneToOpponentEffects(card, player);
    if (isImmune && getUI(game)?.log) {
      getUI(game)?.log(
        `${card.name} is immune to opponent's effects and was not destroyed.`
      );
    }
    return !isImmune;
  });

  if (toDestroyFiltered.length === 0) {
    getUI(game)?.log("No monsters were destroyed (all targets are immune).");
    return false;
  }

  // Destroy all marked monsters
  getUI(game)?.log(
    `Destroying ${toDestroyFiltered.length} monster(s) on the field...`
  );

  for (const { card, owner } of toDestroyFiltered) {
    await game.destroyCard(card, {
      cause: "effect",
      sourceCard: source,
      opponent: game.getOpponent(owner),
    });
  }

  // Log which monsters survived
  const survivorNames = [
    ...playerToKeep.map((m) => m.name),
    ...opponentToKeep.map((m) => m.name),
  ];

  if (survivorNames.length > 0) {
    getUI(game)?.log(`${survivorNames.join(", ")} survived with highest ATK.`);
  }

  game.updateBoard();
  return true;
}

/**
 * Generic handler for special summoning from hand with level matching
 * Used for cards like "Void Mirror Dimension" that summon a monster with same level as another card
 *
 * Action properties:
 * - matchLevel: reference to the card whose level to match (from ctx)
 * - negateEffects: boolean (default: true) - negate effects until end of turn
 * - position: "attack" | "defense" | "choice" (default: "choice")
 * - cannotAttackThisTurn: boolean (default: false)
 *
 * @param {Object} action - The action definition
 * @param {Object} ctx - Context with source, player, opponent, summonedCard
 * @param {Object} targets - Resolved targets
 * @param {Object} engine - The EffectEngine instance
 * @returns {Promise<boolean>} - Success status
 */
/**
 * Helper function to prompt player for tie-breaker selection
 * @param {Object} modalConfig - Configuration for modal text (title, subtitle, infoText)
 */
async function promptTieBreaker(
  game,
  candidates,
  keepCount,
  sideDescription,
  modalConfig = {}
) {
  if (!getUI(game)?.showCardGridSelectionModal) {
    // Fallback: auto-select first N
    return candidates.slice(0, keepCount);
  }

  return new Promise((resolve) => {
    const maxAtk = candidates[0]?.atk || 0;

    // Use custom subtitle or generate default one
    const subtitle =
      modalConfig.subtitle ||
      `Multiple monsters on ${sideDescription} side have ${maxAtk} ATK. Choose ${keepCount} to keep on the field.`;

    const baseOptions = {
      title: modalConfig.title || "Choose Survivor",
      subtitle,
      cards: candidates,
      keepCount,
      infoText: modalConfig.infoText || "All other monsters will be destroyed.",
      onConfirm: (selected) => {
        resolve(selected || candidates.slice(0, keepCount));
      },
      onCancel: () => {
        resolve(candidates.slice(0, keepCount));
      },
    };

    if (typeof getUI(game).showTieBreakerSelection === "function") {
      getUI(game).showTieBreakerSelection(baseOptions);
      return;
    }

    getUI(game).showCardGridSelectionModal({
      title: baseOptions.title,
      subtitle: baseOptions.subtitle,
      cards: baseOptions.cards,
      minSelect: keepCount,
      maxSelect: keepCount,
      confirmLabel: "Confirm",
      cancelLabel: "Cancel",
      overlayClass: "tie-breaker-overlay",
      modalClass: "tie-breaker-modal",
      gridClass: "tie-breaker-grid",
      cardClass: "tie-breaker-card",
      infoText: baseOptions.infoText,
      onConfirm: baseOptions.onConfirm,
      onCancel: baseOptions.onCancel,
    });
  });
}
/**
 * Generic handler for temporarily boosting ATK/DEF until end of turn
 *
 * Action properties:
 * - targetRef: reference to the target card(s)
 * - atkBoost: ATK boost amount (default: 0)
 * - defBoost: DEF boost amount (default: 0)
 * - untilEndOfTurn: boolean (default: true)
 * - permanent: boolean (default: false) - if true, boost is not tracked for cleanup
 */
export async function handleBuffStatsTemp(action, ctx, targets, engine) {
  const { player } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  let atkBoost = action.atkBoost || 0;
  const defBoost = action.defBoost || 0;
  let permanent = action.permanent || false;
  const grantSecondAttack =
    action.grantSecondAttack === true ||
    action.type === "grant_second_attack" ||
    action.type === "buff_stats_temp_with_second_attack";
  if (action.type === "reduce_self_atk" && atkBoost === 0) {
    const amount = Math.max(0, action.amount ?? 0);
    if (amount > 0) {
      atkBoost = -amount;
      permanent = true;
    }
  }
  const targetCards = resolveTargetCards(action, ctx, targets, {
    defaultRef: "self",
  });

  if (targetCards.length === 0) {
    const label =
      grantSecondAttack && atkBoost === 0 && defBoost === 0
        ? "second attack"
        : "stat buff";
    getUI(game)?.log(`No valid targets for ${label}.`);
    return false;
  }

  let anyBuffed = false;
  let anySecondAttack = false;
  const buffedCards = [];
  const secondAttackCards = [];

  for (const card of targetCards) {
    if (!card || card.cardKind !== "monster") continue;

    let cardBuffed = false;

    if (atkBoost !== 0) {
      if (!permanent) {
        card.tempAtkBoost = (card.tempAtkBoost || 0) + atkBoost;
      }
      card.atk = (card.atk || 0) + atkBoost;
      cardBuffed = true;
      anyBuffed = true;
    }

    if (defBoost !== 0) {
      if (!permanent) {
        card.tempDefBoost = (card.tempDefBoost || 0) + defBoost;
      }
      card.def = (card.def || 0) + defBoost;
      cardBuffed = true;
      anyBuffed = true;
    }

    if (cardBuffed) {
      buffedCards.push(card.name);
    }

    if (grantSecondAttack) {
      if (!player.field.includes(card) || card.isFacedown) continue;
      card.canMakeSecondAttackThisTurn = true;
      card.secondAttackUsedThisTurn = false;
      anySecondAttack = true;
      secondAttackCards.push(card.name);
    }
  }

  if (anyBuffed && buffedCards.length > 0) {
    const boosts = [];
    if (atkBoost !== 0)
      boosts.push(`${atkBoost > 0 ? "+" : ""}${atkBoost} ATK`);
    if (defBoost !== 0)
      boosts.push(`${defBoost > 0 ? "+" : ""}${defBoost} DEF`);

    const cardList = buffedCards.join(", ");
    const duration = permanent ? "" : " until end of turn";
    const combineSecondAttack =
      action.type === "buff_stats_temp_with_second_attack" && anySecondAttack;
    if (combineSecondAttack) {
      getUI(game)?.log(
        `${cardList} gained ${boosts.join(
          " and "
        )}${duration} and can make a second attack!`
      );
    } else {
      getUI(game)?.log(
        `${cardList} gained ${boosts.join(" and ")}${duration}.`
      );
    }
  }

  if (anySecondAttack && secondAttackCards.length > 0) {
    const cardList = secondAttackCards.join(", ");
    if (action.type !== "buff_stats_temp_with_second_attack") {
      getUI(game)?.log(`${cardList} can attack again this turn.`);
    }
  }

  if (anyBuffed || anySecondAttack) {
    game.updateBoard();
  }

  return anyBuffed || anySecondAttack;
}

/**
 * Generic handler for granting ability to attack all opponent monsters this turn
 *
 * Action properties:
 * - targetRef: reference to the monster(s) that will gain the ability
 * - attackCount: how many times each target can attack (default: "all" = number of opponent monsters)
 * - requireOpponentMonsters: if true, effect fails if opponent has no monsters (default: false)
 *
 * This sets a flag on the monster that allows it to attack each opponent monster once.
 * The attack limit is dynamically calculated based on opponent's field.
 *
 * Used by: Tech-Void Cosmic Dragon, future multi-attack effects
 */
export async function handleGrantAttackAllMonsters(
  action,
  ctx,
  targets,
  engine
) {
  const { player } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const targetCards = resolveTargetCards(action, ctx, targets, {
    defaultRef: "self",
  });

  if (targetCards.length === 0) {
    getUI(game)?.log("No valid targets for multi-attack effect.");
    return false;
  }

  const opponent = player.id === "player" ? game.bot : game.player;
  const opponentMonsterCount = (opponent?.field || []).filter(
    (m) => m && !m.isFacedown
  ).length;

  // Check if opponent has monsters when required
  if (action.requireOpponentMonsters && opponentMonsterCount === 0) {
    getUI(game)?.log("No opponent monsters to attack.");
    return false;
  }

  let anyGranted = false;
  const grantedCards = [];

  for (const card of targetCards) {
    if (!card || card.cardKind !== "monster") continue;
    if (!player.field?.includes(card)) continue;
    if (card.isFacedown) continue;

    // Set flag for attacking all opponent monsters
    card.canAttackAllOpponentMonstersThisTurn = true;

    // Track which monsters have been attacked this turn (cleared at end of turn)
    card.attackedMonstersThisTurn = card.attackedMonstersThisTurn || new Set();

    // Calculate max attacks based on opponent's current field
    // This is recalculated dynamically in getAttackAvailability
    const attackLimit =
      action.attackCount === "all"
        ? Math.max(1, opponentMonsterCount)
        : typeof action.attackCount === "number"
        ? action.attackCount
        : opponentMonsterCount;

    card.multiAttackLimit = attackLimit;

    anyGranted = true;
    grantedCards.push(card.name);
  }

  if (anyGranted && grantedCards.length > 0) {
    const cardList = grantedCards.join(", ");
    if (opponentMonsterCount > 0) {
      getUI(game)?.log(
        `${cardList} can attack all opponent monsters this turn!`
      );
    } else {
      getUI(game)?.log(
        `${cardList} gained multi-attack ability, but opponent has no monsters.`
      );
    }
    game.updateBoard();
  }

  return anyGranted;
}

/**
 * Generic handler for adding/removing status flags
 *
 * Action properties:
 * - targetRef: reference to the target card(s)
 * - status: status flag to add/remove (e.g., "battleIndestructible", "piercing")
 * - value: value to set (default: true)
 * - remove: if true, removes the status instead (default: false)
 * - untilEndOfTurn: if true, status is cleared at end of turn (handled by Game.cleanupTempBoosts)
 */
export async function handleAddStatus(action, ctx, targets, engine) {
  const { player } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const targetCards = resolveTargetCards(action, ctx, targets, {
    defaultRef: "self",
  });

  if (targetCards.length === 0) {
    getUI(game)?.log("No valid targets for status change.");
    return false;
  }

  const status = action.status;
  const value = action.value !== undefined ? action.value : true;
  const remove = action.remove || false;

  if (!status) {
    return false;
  }

  let modified = false;
  const affectedCards = [];

  for (const card of targetCards) {
    if (!card) continue;

    if (remove) {
      if (card[status] !== undefined) {
        delete card[status];
        modified = true;
        affectedCards.push(card.name);
      }
    } else {
      card[status] = value;
      modified = true;
      affectedCards.push(card.name);
    }
  }

  if (modified && affectedCards.length > 0) {
    const displayStatus = STATUS_DISPLAY_NAMES[status] || status;
    const cardList = affectedCards.join(", ");
    const statusText = remove
      ? `lost ${displayStatus}`
      : `gained ${displayStatus}`;
    getUI(game)?.log(`${cardList} ${statusText}.`);
    game.updateBoard();
  }

  return modified;
}

/**
 * Generic handler for paying Life Points as a cost
 *
 * Action properties:
 * - amount: LP to pay
 * - fraction: alternative, pay a fraction of current LP (0.5 = half)
 */
export async function handlePayLP(action, ctx, targets, engine) {
  const { player } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  let amount = action.amount || 0;

  if (action.fraction) {
    amount = Math.floor(player.lp * action.fraction);
  }

  if (amount <= 0) return false;

  if (player.lp < amount) {
    getUI(game)?.log("Not enough LP to pay cost.");
    return false;
  }

  player.lp -= amount;
  getUI(game)?.log(`${player.name || player.id} paid ${amount} LP.`);
  game.updateBoard();

  return true;
}

/**
 * Generic handler for adding cards from any zone to hand
 * Supports multi-select with filters
 *
 * Action properties:
 * - zone: source zone (default: "graveyard")
 * - filters: { archetype, name, level, cardKind, excludeSelf }
 * - count: { min, max } for selection count
 * - promptPlayer: boolean (default: true for human player)
 */
export async function handleAddFromZoneToHand(action, ctx, targets, engine) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const inferredSearch =
    action?.type === "search_any" || action?.mode === "search_any";
  const sourceZone = action.zone || (inferredSearch ? "deck" : "graveyard");
  const zone = player[sourceZone];

  if (!zone || zone.length === 0) {
    getUI(game)?.log(`No cards in ${sourceZone}.`);
    return false;
  }

  // Apply filters
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
  }

  const extraFilter = (card) => {
    if (!card) return false;
    if (Array.isArray(filters.cardKind)) {
      if (!filters.cardKind.includes(card.cardKind)) return false;
    }
    if (Array.isArray(filters.name)) {
      if (!filters.name.includes(card.name)) return false;
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
  };

  const candidates = collectZoneCandidates(zone, filters, {
    source,
    extraFilter,
  });

  if (candidates.length === 0) {
    getUI(game)?.log(`No valid cards in ${sourceZone} matching filters.`);
    return false;
  }

  const count = action.count || { min: 1, max: 1 };
  const maxSelect = Math.min(count.max, candidates.length);
  const minSelect = Math.max(count.min || 0, 0);

  if (maxSelect === 0) {
    getUI(game)?.log("No cards available to add.");
    return false;
  }

  const selection = await selectCardsFromZone({
    game,
    player,
    zone,
    source,
    filters,
    candidates,
    maxSelect,
    minSelect,
    promptPlayer: action.promptPlayer !== false,
    botSelect: (cards, max) =>
      cards[0]?.cardKind === "monster"
        ? cards
            .slice()
            .sort((a, b) => (b.atk || 0) - (a.atk || 0))
            .slice(0, max)
        : cards.slice(0, max),
    selectSingle: (cards) => {
      const renderer = getUI(game);
      const searchModal = renderer?.getSearchModalElements?.();
      const defaultCardName = cards[0]?.name || "";

      if (!searchModal) {
        return cards[0];
      }

      return new Promise((resolve) => {
        game.isResolvingEffect = true;
        renderer.showSearchModalVisual(
          searchModal,
          cards,
          defaultCardName,
          (selectedName) => {
            const chosen =
              cards.find((c) => c && c.name === selectedName) || cards[0];
            game.isResolvingEffect = false;
            resolve(chosen);
          }
        );
      });
    },
    selectMulti: (cards, range) => {
      if (!getUI(game)?.showMultiSelectModal) {
        return cards.slice(0, range.max);
      }
      return new Promise((resolve) => {
        getUI(game).showMultiSelectModal(
          cards,
          { min: range.min, max: range.max },
          (selected) => {
            resolve(selected || []);
          }
        );
      });
    },
  });

  const selected = selection.selected || [];
  if (selected.length === 0) {
    if (minSelect === 0) {
      getUI(game)?.log("No cards selected (optional).");
      game.updateBoard();
      return true;
    }
    getUI(game)?.log("No cards selected.");
    return false;
  }

  for (const card of selected) {
    if (typeof game.moveCard === "function") {
      game.moveCard(card, player, "hand", { fromZone: sourceZone });
    } else {
      const idx = zone.indexOf(card);
      if (idx !== -1) {
        zone.splice(idx, 1);
        player.hand.push(card);
      }
    }
  }

  const addedText =
    player.id === "bot"
      ? `${player.name || player.id} added ${
          selected.length
        } card(s) to hand from ${sourceZone}.`
      : selected.length === 1
      ? `Added ${selected[0].name} to hand from ${sourceZone}.`
      : `Added ${selected.length} card(s) to hand from ${sourceZone}.`;
  getUI(game)?.log(addedText);
  game.updateBoard();
  return true;
}

/**
 * Generic handler for healing based on destroyed monster's ATK
 *
 * Action properties:
 * - fraction: fraction of ATK to heal (default: 1.0)
 * - multiplier: alternative name for fraction
 */
export async function handleHealFromDestroyedAtk(action, ctx, targets, engine) {
  const { player, destroyed } = ctx;
  const game = engine.game;

  if (!player || !game || !destroyed) return false;

  const fraction = action.fraction || action.multiplier || 1.0;
  const healAmount = Math.floor((destroyed.atk || 0) * fraction);

  if (healAmount <= 0) return false;

  player.gainLP(healAmount);
  getUI(game)?.log(
    `${player.name || player.id} gained ${healAmount} LP from ${
      destroyed.name
    }'s ATK.`
  );
  game.updateBoard();

  return true;
}

/**
 * ✅ Handler para curar LP baseado no Level do monstro destruído em batalha
 *
 * Action properties:
 * - multiplier: quanto multiplicar o level (default: 100)
 * - player: quem ganha LP ("self" default)
 */
export async function handleHealFromDestroyedLevel(
  action,
  ctx,
  targets,
  engine
) {
  const { player, destroyed } = ctx;
  const game = engine.game;

  if (!player || !game || !destroyed) return false;

  const multiplier = action.multiplier || 100;
  const level = destroyed.level || 0;
  const healAmount = Math.floor(level * multiplier);

  if (healAmount <= 0) {
    getUI(game)?.log(`${destroyed.name} has Level 0, no LP gained.`);
    return true; // Still valid execution, just 0 heal
  }

  player.gainLP(healAmount);
  getUI(game)?.log(
    `${
      player.name || player.id
    } gained ${healAmount} LP from destroying a Level ${level} monster!`
  );
  game.updateBoard();

  return true;
}

/**
 * ✅ Handler para conceder proteção contra destruição por efeitos
 *
 * Action properties:
 * - targetRef: referência ao target que recebe proteção
 * - protectionType: tipo de proteção ("effect_destruction", "battle_destruction", etc.)
 * - duration: duração ("while_faceup", "end_of_turn", número de turno)
 */
export async function handleGrantProtection(action, ctx, targets, engine) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const targetCards = resolveTargetCards(action, ctx, targets, {
    targetRef: action.targetRef,
    requireArray: true,
  });

  if (!targetCards || targetCards.length === 0) {
    getUI(game)?.log("No valid targets for protection.");
    return false;
  }

  const protectionType = action.protectionType || "effect_destruction";
  const duration = action.duration || "while_faceup";
  const sourceName = source?.name || "Unknown";

  for (const target of targetCards) {
    if (!target) continue;

    // Initialize protectionEffects array if needed
    if (!Array.isArray(target.protectionEffects)) {
      target.protectionEffects = [];
    }

    // Add protection entry
    target.protectionEffects.push({
      type: protectionType,
      source: sourceName,
      duration,
      grantedOnTurn: game.turnCounter,
    });

    getUI(game)?.log(
      `${target.name} is now protected from destruction by card effects!`
    );
  }

  game.updateBoard();
  return true;
}

/**
 * ✅ Handler genérico para banir carta(s) de uma zona e aplicar buff baseado em propriedade
 *
 * Este handler é flexível e pode:
 * - Banir do cemitério, mão, ou qualquer zona
 * - Aplicar buff de ATK/DEF baseado em atk, def, level, ou valor fixo
 * - Buff temporário (até fim do turno) ou permanente
 * - Suportar seleção por filtros (type, level, archetype, etc.)
 *
 * Action properties:
 * - targetRef: referência ao(s) alvo(s) a serem banidos (obrigatório)
 * - buffTarget: quem recebe o buff ("self" = carta fonte, ou targetRef específico)
 * - buffSource: propriedade da carta banida a usar ("atk", "def", "level", ou número fixo)
 * - buffMultiplier: multiplicador do valor (default: 1)
 * - buffType: "atk", "def", ou "both" (default: "atk")
 * - duration: "end_of_turn" ou "permanent" (default: "end_of_turn")
 * - optional: se true, jogador pode cancelar a seleção (default: false)
 */
export async function handleBanishAndBuff(action, ctx, targets, engine) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  // Resolve targets to banish
  const banishTargets = resolveTargetCards(action, ctx, targets, {
    targetRef: action.targetRef,
    requireArray: true,
  });

  if (!banishTargets || banishTargets.length === 0) {
    getUI(game)?.log("No valid targets to banish.");
    return false;
  }

  // Calculate total buff value from all banished cards
  const buffSource = action.buffSource || "atk";
  const buffMultiplier = action.buffMultiplier ?? 1;
  let totalBuffValue = 0;

  for (const banishCard of banishTargets) {
    if (!banishCard) continue;

    // Calculate value based on buffSource
    let cardValue = 0;
    if (typeof buffSource === "number") {
      cardValue = buffSource;
    } else if (buffSource === "atk") {
      cardValue = banishCard.atk || 0;
    } else if (buffSource === "def") {
      cardValue = banishCard.def || 0;
    } else if (buffSource === "level") {
      cardValue = (banishCard.level || 0) * 100; // Convert level to points
    } else {
      cardValue = banishCard[buffSource] || 0;
    }

    totalBuffValue += Math.floor(cardValue * buffMultiplier);

    // Banish the card (remove from game)
    const fromZone =
      typeof engine.findCardZone === "function"
        ? engine.findCardZone(player, banishCard)
        : "graveyard";

    if (fromZone && Array.isArray(player[fromZone])) {
      const idx = player[fromZone].indexOf(banishCard);
      if (idx > -1) {
        player[fromZone].splice(idx, 1);
      }
    }

    // Track banished cards
    if (!game.banishedCards) {
      game.banishedCards = [];
    }
    game.banishedCards.push(banishCard);

    getUI(game)?.log(`${banishCard.name} was banished (removed from game).`);
  }

  if (totalBuffValue === 0) {
    getUI(game)?.log("Banished card(s) have 0 value, no buff applied.");
    game.updateBoard();
    return true;
  }

  // Determine who receives the buff
  const buffTargetRef = action.buffTarget || "self";
  let buffRecipients = [];

  if (buffTargetRef === "self") {
    if (source) buffRecipients = [source];
  } else {
    buffRecipients = resolveTargetCards(action, ctx, targets, {
      targetRef: buffTargetRef,
      requireArray: true,
    });
  }

  if (buffRecipients.length === 0) {
    getUI(game)?.log("No valid recipient for buff.");
    game.updateBoard();
    return true;
  }

  // Apply buff
  const buffType = action.buffType || "atk";
  const duration = action.duration || "end_of_turn";
  const isTemporary = duration === "end_of_turn";

  for (const recipient of buffRecipients) {
    if (!recipient || recipient.cardKind !== "monster") continue;

    if (buffType === "atk" || buffType === "both") {
      recipient.atk = (recipient.atk || 0) + totalBuffValue;
      if (isTemporary) {
        recipient.tempAtkBoost = (recipient.tempAtkBoost || 0) + totalBuffValue;
      }
    }

    if (buffType === "def" || buffType === "both") {
      recipient.def = (recipient.def || 0) + totalBuffValue;
      if (isTemporary) {
        recipient.tempDefBoost = (recipient.tempDefBoost || 0) + totalBuffValue;
      }
    }

    const durationText = isTemporary ? " until end of turn" : "";
    const statText = buffType === "both" ? "ATK/DEF" : buffType.toUpperCase();
    getUI(game)?.log(
      `${recipient.name} gains ${totalBuffValue} ${statText}${durationText}!`
    );
  }

  game.updateBoard();
  return true;
}

/**
 * Generic handler for switching monster position (attack <-> defense)
 *
 * Action properties:
 * - targetRef: reference to the target card(s)
 * - atkBoost: optional ATK boost after position change
 * - defBoost: optional DEF boost after position change
 * - markChanged: if true, sets hasChangedPosition (default: true)
 */
export async function handleSwitchPosition(action, ctx, targets, engine) {
  const { player } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const targetCards = resolveTargetCards(action, ctx, targets, {
    targetRef: action.targetRef,
    requireArray: true,
  });

  if (targetCards.length === 0) {
    getUI(game)?.log("No valid targets for position switch.");
    console.log("[handleSwitchPosition] DEBUG: No targets resolved", {
      actionTargetRef: action.targetRef,
      targetsObject: targets,
    });
    return false;
  }

  let switched = false;
  const affectedCards = [];

  for (const card of targetCards) {
    if (!card || card.cardKind !== "monster") continue;
    if (card.isFacedown) continue;

    // Switch position
    const newPosition = card.position === "attack" ? "defense" : "attack";
    card.position = newPosition;

    console.log("[handleSwitchPosition] DEBUG: Switched position", {
      cardName: card.name,
      oldPosition:
        card.position === newPosition
          ? newPosition
          : newPosition === "attack"
          ? "defense"
          : "attack",
      newPosition: newPosition,
    });

    if (action.markChanged !== false) {
      card.hasChangedPosition = true;
    }

    // Apply stat boosts if specified
    if (action.atkBoost) {
      card.tempAtkBoost = (card.tempAtkBoost || 0) + action.atkBoost;
      card.atk = (card.atk || 0) + action.atkBoost;
    }

    if (action.defBoost) {
      card.tempDefBoost = (card.tempDefBoost || 0) + action.defBoost;
      card.def = (card.def || 0) + action.defBoost;
    }

    switched = true;
    affectedCards.push({
      name: card.name,
      position: newPosition,
    });
  }

  if (switched && affectedCards.length > 0) {
    for (const info of affectedCards) {
      getUI(game)?.log(
        `${info.name} switched to ${info.position.toUpperCase()} Position.`
      );
    }
    game.updateBoard();
  }

  return switched;
}

export async function handleSwitchDefenderPositionOnAttack(
  action,
  ctx,
  targets,
  engine
) {
  const { player, defender } = ctx;
  const game = engine.game;

  if (!defender || defender.cardKind !== "monster") {
    getUI(game)?.log("No valid defender to switch position.");
    return false;
  }

  if (defender.isFacedown) {
    getUI(game)?.log("Cannot switch position of face-down card.");
    return false;
  }

  if (defender.position !== "defense") {
    getUI(game)?.log("Defender is not in defense position.");
    return false;
  }

  // Switch position to attack
  defender.position = "attack";
  defender.hasChangedPosition = true;

  console.log(
    "[handleSwitchDefenderPositionOnAttack] Switched defender position",
    {
      cardName: defender.name,
      newPosition: "attack",
    }
  );

  getUI(game)?.log(`${defender.name} switched to ATTACK Position.`);
  game.updateBoard();

  return true;
}

/**
 * Generic handler for permanent ATK/DEF buffs with named tracking
 * This allows stackable buffs that persist while the card is on the field
 *
 * Action properties:
 * - targetRef: reference to the target card (default: "self")
 * - atkBoost: ATK boost amount (default: 0)
 * - defBoost: DEF boost amount (default: 0)
 * - sourceName: identifier for this buff source (default: source card name)
 * - cumulative: if true, adds to existing buff; if false, sets total (default: true)
 * - applyToAllField: if true, applies to all monsters on player's field matching filters
 * - archetype: if specified, only buff monsters of this archetype
 * - summonedCard: special targetRef that refers to ctx.summonedCard
 */
export async function handlePermanentBuffNamed(action, ctx, targets, engine) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !game || !source) return false;

  const targetRef = action.targetRef || "self";
  let targetCards = [];

  // Special handling for summonedCard
  if (targetRef === "summonedCard") {
    const summonedCard = ctx.summonedCard;
    if (summonedCard) {
      targetCards = [summonedCard];
    }
  } else if (targetRef === "self" && action.applyToAllField) {
    // Apply to all monsters on field matching archetype
    targetCards = (player.field || []).filter((card) => {
      if (!card || card.cardKind !== "monster") return false;
      if (card.isFacedown) return false;

      // Check archetype filter
      if (action.archetype) {
        const cardArchetypes = Array.isArray(card.archetypes)
          ? card.archetypes
          : card.archetype
          ? [card.archetype]
          : [];
        if (!cardArchetypes.includes(action.archetype)) return false;
      }

      return true;
    });
  } else {
    targetCards = resolveTargetCards(action, ctx, targets, {
      targetRef,
      defaultRef: "self",
    });
  }

  if (targetCards.length === 0) {
    return false;
  }

  const atkBoost = action.atkBoost || 0;
  const defBoost = action.defBoost || 0;
  const sourceName = action.sourceName || source.name;
  const cumulative = action.cumulative !== false;

  let anyBuffed = false;

  for (const card of targetCards) {
    if (!card || card.cardKind !== "monster") continue;

    // Check archetype filter again for summoned card scenario
    if (action.archetype && targetRef === "summonedCard") {
      const cardArchetypes = Array.isArray(card.archetypes)
        ? card.archetypes
        : card.archetype
        ? [card.archetype]
        : [];
      if (!cardArchetypes.includes(action.archetype)) continue;
    }

    // Check if card owner matches
    if (card.owner && card.owner !== player.id) continue;

    // Initialize permanent buffs tracking
    if (!card.permanentBuffsBySource) {
      card.permanentBuffsBySource = {};
    }

    let cardBuffed = false;

    if (atkBoost !== 0) {
      const currentBuff = card.permanentBuffsBySource[sourceName]?.atk || 0;
      const newBuff = cumulative ? currentBuff + atkBoost : atkBoost;

      if (!card.permanentBuffsBySource[sourceName]) {
        card.permanentBuffsBySource[sourceName] = {};
      }
      card.permanentBuffsBySource[sourceName].atk = newBuff;

      // Apply to actual stat (calculate delta and apply, clamp to 0)
      const delta = newBuff - currentBuff;
      card.atk = Math.max(0, (card.atk || 0) + delta);
      cardBuffed = true;
    }

    if (defBoost !== 0) {
      const currentBuff = card.permanentBuffsBySource[sourceName]?.def || 0;
      const newBuff = cumulative ? currentBuff + defBoost : defBoost;

      if (!card.permanentBuffsBySource[sourceName]) {
        card.permanentBuffsBySource[sourceName] = {};
      }
      card.permanentBuffsBySource[sourceName].def = newBuff;

      // Apply to actual stat (calculate delta and apply, clamp to 0)
      const delta = newBuff - currentBuff;
      card.def = Math.max(0, (card.def || 0) + delta);
      cardBuffed = true;
    }

    if (cardBuffed) {
      anyBuffed = true;
    }
  }

  if (anyBuffed) {
    const boosts = [];
    if (atkBoost !== 0)
      boosts.push(`${atkBoost > 0 ? "+" : ""}${atkBoost} ATK`);
    if (defBoost !== 0)
      boosts.push(`${defBoost > 0 ? "+" : ""}${defBoost} DEF`);

    getUI(game)?.log(`${source.name} applied ${boosts.join(" and ")} buff.`);
    game.updateBoard();
  }

  return anyBuffed;
}

/**
 * Generic handler for removing permanent named buffs
 * Removes all buffs associated with a specific source name
 *
 * Action properties:
 * - targetRef: reference to the target card (default: "self")
 * - sourceName: identifier for the buff source to remove (default: source card name)
 * - removeFromAllField: if true, removes buff from all monsters on player's field
 * - archetype: if specified, only remove buffs from monsters of this archetype
 */
export async function handleRemovePermanentBuffNamed(
  action,
  ctx,
  targets,
  engine
) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!source || !game || !player) return false;

  const targetRef = action.targetRef || "self";
  let targetCards = [];

  if (targetRef === "self" && action.removeFromAllField) {
    // Remove from all monsters on field matching archetype
    targetCards = (player.field || []).filter((card) => {
      if (!card || card.cardKind !== "monster") return false;

      // Check archetype filter
      if (action.archetype) {
        const cardArchetypes = Array.isArray(card.archetypes)
          ? card.archetypes
          : card.archetype
          ? [card.archetype]
          : [];
        if (!cardArchetypes.includes(action.archetype)) return false;
      }

      return true;
    });
  } else {
    targetCards = resolveTargetCards(action, ctx, targets, {
      targetRef,
      defaultRef: "self",
    });
  }

  if (targetCards.length === 0) return false;

  const sourceName = action.sourceName || source.name;
  let anyRemoved = false;

  for (const card of targetCards) {
    if (!card || !card.permanentBuffsBySource) continue;

    const buffData = card.permanentBuffsBySource[sourceName];
    if (!buffData) continue;

    // Remove buffs from stats (clamp to 0)
    if (buffData.atk) {
      card.atk = Math.max(0, (card.atk || 0) - buffData.atk);
    }
    if (buffData.def) {
      card.def = Math.max(0, (card.def || 0) - buffData.def);
    }

    // Remove buff tracking
    delete card.permanentBuffsBySource[sourceName];
    anyRemoved = true;
  }

  if (anyRemoved) {
    getUI(game)?.log(`${sourceName} buffs removed.`);
    game.updateBoard();
  }

  return anyRemoved;
}

/**
 * ✅ FASE 3: Handler para efeito delayed summon de Abyssal Serpent Dragon
 * Envia self e target ao GY, agenda summon para próxima standby phase do oponente
 * Se target era Fusion/Ascension, aplica buff de +800 ATK com expiração
 *
 * Ação properties:
 * - targetRef: referência ao monstro alvo ("abyssal_target" padrão)
 * - buffValue: valor do buff se alvo era Fusion/Ascension (padrão: 800)
 */
export async function handleAbyssalSerpentDelayedSummon(
  action,
  ctx,
  targets,
  engine
) {
  const { player, source } = ctx;
  const game = engine?.game;
  const ui = getUI(game);

  if (!player || !source || !game) {
    return false;
  }

  // Extrair target do monstro oponente selecionado
  const targetRef = action.targetRef || "abyssal_target";
  const targetCards = targets?.[targetRef];
  if (!Array.isArray(targetCards) || targetCards.length === 0) {
    ui?.log?.("No target selected for Abyssal Serpent effect.");
    return false;
  }

  const target = targetCards[0]; // Efeito opera com 1 target
  const opponent = ctx?.opponent || game.getOpponent?.(player);
  if (!opponent) {
    ui?.log?.("Cannot determine opponent.");
    return false;
  }

  // Verificar se ambas cartas estão no campo
  if (!player.field.includes(source)) {
    ui?.log?.("Source card is not on field.");
    return false;
  }
  if (!opponent.field.includes(target)) {
    ui?.log?.("Target card is not on field.");
    return false;
  }

  // Detectar se target é Fusion ou Ascension
  const isFusionOrAscension =
    target.monsterType === "fusion" || target.monsterType === "ascension";

  // Enviar ambas cartas ao GY
  await game.moveCard(source, player, "graveyard");
  await game.moveCard(target, opponent, "graveyard");

  ui?.log?.(
    `${source.name} and ${target.name} are sent to the GY. They will be special summoned during the opponent's next Standby Phase.`
  );

  // Agendar delayed summon para próxima standby phase do oponente
  const summonPayload = {
    summons: [
      {
        card: source,
        owner: "player",
        fromZone: "graveyard",
        getsBuffIfTargetWasFusionOrAscension: isFusionOrAscension, // Flag para aplicar buff ao source
      },
      {
        card: target,
        owner: "bot",
        fromZone: "graveyard",
        getsBuffIfTargetWasFusionOrAscension: false, // Target nunca ganha buff
      },
    ],
  };

  // Determinar qual é a próxima standby phase do oponente
  const opponentPlayerId =
    opponent.id || (player.id === "player" ? "bot" : "player");

  game.scheduleDelayedAction(
    "delayed_summon",
    {
      phase: "standby",
      player: opponentPlayerId,
    },
    summonPayload,
    1 // Prioridade 1 para processar antes de outros efeitos
  );

  return true;
}

/**
 * Generic handler for granting a second attack this turn
 *
 * Action properties:
 * - targetRef: reference to the target card (default: "self")
 */
/**
 * Generic handler for drawing and conditionally summoning from hand
 * Draws N cards, checks if the drawn card matches a condition, and optionally summons it
 *
 * Action properties:
 * - player: "self" | "opponent" - player to draw for
 * - drawAmount: number - how many cards to draw
 * - condition: { type, typeName, maxLevel, cardKind } - condition for drawn card
 * - position: "attack" | "defense" | "choice" (default: "choice")
 * - optional: boolean - if true, prompts player; if false, auto-summons (default: true)
 */
export async function handleDrawAndSummon(action, ctx, targets, engine) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const drawAmount = action.drawAmount || 1;
  const condition = action.condition || {};
  const optional = action.optional !== false;

  // Draw the cards
  const drawn = game.drawCards(player, drawAmount);
  if (!drawn || !drawn.ok || !drawn.drawn || drawn.drawn.length === 0) {
    return false;
  }

  const drawnCard = drawn.drawn[0]; // Take first drawn card
  if (!drawnCard) return false;

  // Update board to show the drawn card visually
  game.updateBoard();

  // Add a small delay to let the user see the card being drawn
  await new Promise((resolve) => setTimeout(resolve, 400));

  // Check condition against drawn card
  let conditionMet = false;
  if (condition.type === "match_card_props") {
    const typeName = condition.typeName || null;
    const minLevel = Number.isFinite(condition.minLevel)
      ? condition.minLevel
      : null;
    const maxLevel = Number.isFinite(condition.maxLevel)
      ? condition.maxLevel
      : null;
    const requireKind = condition.cardKind || null;

    let ok = true;
    if (typeName) {
      const types = Array.isArray(drawnCard.types) ? drawnCard.types : null;
      const cardType = drawnCard.type || null;
      ok = types ? types.includes(typeName) : cardType === typeName;
    }
    if (ok && requireKind) {
      ok = drawnCard.cardKind === requireKind;
    }
    if (ok && minLevel !== null) {
      ok = (drawnCard.level || 0) >= minLevel;
    }
    if (ok && maxLevel !== null) {
      ok = (drawnCard.level || 0) <= maxLevel;
    }
    conditionMet = ok;
  } else {
    conditionMet = true;
  }

  if (!conditionMet) {
    return false;
  }

  // Check field space
  if (player.field.length >= 5) {
    getUI(game)?.log("Field is full, cannot Special Summon.");
    return false;
  }

  // Get the index of the card in hand
  const handIndex = player.hand.indexOf(drawnCard);
  if (handIndex === -1) {
    return false;
  }

  // For bot, auto-summon if not optional
  if (player.id === "bot") {
    if (!optional) {
      return await performSummon(drawnCard, handIndex, player, action, engine);
    }
    // Bot chooses to summon (always optimal)
    return await performSummon(drawnCard, handIndex, player, action, engine);
  }

  // For human player
  if (optional) {
    const wantsToSummon =
      getUI(game)?.showConfirmPrompt?.(
        `You drew "${drawnCard.name}". Do you want to Special Summon it from your hand?`,
        { kind: "draw_and_summon", cardName: drawnCard.name }
      ) ?? false;

    if (!wantsToSummon) {
      return false;
    }
  }

  return await performSummon(drawnCard, handIndex, player, action, engine);
}

/**
 * Generic handler for conditional summon from hand
 * Offers to summon a card if a condition is met (e.g., controlling a specific card)
 *
 * Action properties:
 * - targetRef: reference to the card to potentially summon (must be in hand)
 * - condition: { type, cardName, zone } - condition to check
 * - position: "attack" | "defense" | "choice" (default: "choice")
 * - optional: boolean - if true, prompts player; if false, auto-summons (default: true)
 */
export async function handleConditionalSummonFromHand(
  action,
  ctx,
  targets,
  engine
) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  // Get the card(s) to potentially summon
  const targetRef = action.targetRef;
  let targetCards = [];

  if (targetRef === "self" && source) {
    targetCards = [source];
  } else if (targetRef && targets?.[targetRef]) {
    targetCards = targets?.[targetRef];
  } else if (action.cardName) {
    const named = player.hand.find((c) => c && c.name === action.cardName);
    if (named) {
      targetCards = [named];
    }
  }

  if (!targetCards || targetCards.length === 0) return false;

  const card = Array.isArray(targetCards) ? targetCards[0] : targetCards;

  // Find card in hand (might be different reference if moved by previous action)
  // The targets object contains the original reference, but after a move action,
  // the card object may have been moved to hand with the same reference or a clone
  const handCard = player.hand.find((c) => c === card || c.name === card.name);

  if (!handCard) {
    return false;
  }

  // Check condition
  const condition = action.condition || {};
  let conditionMet = false;

  if (condition.type === "control_card") {
    const zoneName = condition.zone || "fieldSpell";
    const cardName = condition.cardName;

    if (zoneName === "fieldSpell") {
      conditionMet = player.fieldSpell?.name === cardName;
    } else {
      const zone = player[zoneName] || [];
      conditionMet = zone.some((c) => c && c.name === cardName);
    }
  } else if (condition.type === "control_card_type") {
    // Check if player controls a card of a specific type (e.g., Dragon)
    const zoneName = condition.zone || "field";
    const typeName = condition.typeName || condition.cardType;

    if (!typeName) {
      conditionMet = false;
    } else {
      const zone = player[zoneName] || [];
      conditionMet = zone.some((c) => {
        if (!c || c.isFacedown) return false;
        if (Array.isArray(c.types)) {
          return c.types.includes(typeName);
        }
        return c.type === typeName;
      });
    }
  } else {
    // Additional generic condition: match properties of the card itself
    if (condition.type === "match_card_props") {
      const typeName =
        condition.typeName || condition.typeFilter || condition.type || null;
      const minLevel = Number.isFinite(condition.minLevel)
        ? condition.minLevel
        : null;
      const maxLevel = Number.isFinite(condition.maxLevel)
        ? condition.maxLevel
        : null;
      const requireKind = condition.cardKind || null;

      let ok = true;
      if (typeName) {
        const types = Array.isArray(handCard.types) ? handCard.types : null;
        const cardType = handCard.type || null;
        ok = types ? types.includes(typeName) : cardType === typeName;
      }
      if (ok && requireKind) {
        ok = handCard.cardKind === requireKind;
      }
      if (ok && minLevel !== null) {
        ok = (handCard.level || 0) >= minLevel;
      }
      if (ok && maxLevel !== null) {
        ok = (handCard.level || 0) <= maxLevel;
      }
      conditionMet = ok;
    } else {
      // Default to true if no condition specified
      conditionMet = true;
    }
  }

  if (!conditionMet) {
    return false;
  }

  // Check field space
  if (player.field.length >= 5) {
    getUI(game)?.log("Field is full, cannot Special Summon.");
    return false;
  }

  // Get the index of the card in hand
  const handIndex = player.hand.indexOf(handCard);

  if (handIndex === -1) {
    return false;
  }

  const optional = action.optional !== false;

  // For bot, auto-summon if not optional
  if (player.id === "bot") {
    if (!optional) {
      return await performSummon(handCard, handIndex, player, action, engine);
    }
    // Bot chooses to summon (always optimal)
    return await performSummon(handCard, handIndex, player, action, engine);
  }

  // For human player
  if (optional) {
    const conditionText = condition.cardName
      ? `You control "${condition.cardName}".`
      : "Condition met.";

    const wantsToSummon =
      getUI(game)?.showConfirmPrompt?.(
        `${conditionText} Do you want to Special Summon "${handCard.name}" from your hand?`,
        { kind: "conditional_summon", cardName: handCard.name }
      ) ?? false;

    if (!wantsToSummon) {
      return false;
    }
  }

  return await performSummon(handCard, handIndex, player, action, engine);
}

/**
 * Helper function to perform the summon for conditional summon handler
 */
async function performSummon(card, handIndex, player, action, engine) {
  const game = engine.game;

  // Unified semantics: use EffectEngine resolver with action.position
  const position = await engine.chooseSpecialSummonPosition(card, player, {
    position: action.position,
  });

  const moveResult =
    typeof game.moveCard === "function"
      ? game.moveCard(card, player, "field", {
          fromZone: "hand",
          position,
          isFacedown: false,
          resetAttackFlags: true,
        })
      : null;
  if (moveResult && moveResult.success === false) {
    return false;
  }
  if (moveResult == null) {
    player.hand.splice(handIndex, 1);
    card.position = position;
    card.isFacedown = false;
    card.hasAttacked = false;
    card.owner = player.id;
    card.controller = player.id;
    player.field.push(card);
  }
  card.cannotAttackThisTurn =
    action.restrictAttackThisTurn || action.cannotAttackThisTurn || false;

  getUI(game)?.log(
    `${player.name || player.id} Special Summoned ${card.name} from hand.`
  );

  game.updateBoard();
  return true;
}

/**
 * Generic handler for destroying the attacking monster when your card is destroyed
 * Implements the "Darkness Valley battle punish" effect pattern
 *
 * Action properties:
 * - archetype: archetype to check on destroyed card (e.g., "Shadow-Heart")
 * - minLevel: minimum level of destroyed card to trigger (default: 1)
 */
export async function handleDestroyAttackerOnArchetypeDestruction(
  action,
  ctx,
  targets,
  engine
) {
  const { destroyed, attacker } = ctx;
  const game = engine.game;

  if (!destroyed || !attacker || !game) return false;

  const archetype = action.archetype || "Shadow-Heart";
  const minLevel = action.minLevel || 1;

  // Validate destroyed card archetype and level
  const destroyedArchetypes = Array.isArray(destroyed.archetypes)
    ? destroyed.archetypes
    : destroyed.archetype
    ? [destroyed.archetype]
    : [];

  if (!destroyedArchetypes.includes(archetype)) return false;

  const destroyedLevel = destroyed.level || 0;
  if (destroyedLevel < minLevel) return false;

  // Validate attacker is opponent's monster
  const attackerOwner = engine.getOwnerByCard(attacker);
  if (!attackerOwner || attackerOwner.id === ctx.player.id) return false;

  // Check if attacker is immune to opponent's effects
  if (engine.isImmuneToOpponentEffects(attacker, ctx.player)) {
    getUI(game)?.log(`${attacker.name} is immune to opponent's effects.`);
    return false;
  }

  const result = await game.destroyCard(attacker, {
    cause: "effect",
    sourceCard: ctx.source || destroyed,
    opponent: ctx.player,
  });
  if (!result?.destroyed) return false;

  getUI(game)?.log(`${attacker.name} was sent to the Graveyard as punishment!`);

  game.updateBoard();
  return true;
}

/**
 * Generic handler for upkeep cost: pay LP or send card to graveyard
 * Implements the "Shadow-Heart Shield" upkeep effect pattern
 *
 * Action properties:
 * - lpCost: amount of LP to pay (default: 800)
 * - failureZone: zone to send if LP insufficient or player chooses not to pay (default: "graveyard")
 */
export async function handleUpkeepPayOrSendToGrave(
  action,
  ctx,
  targets,
  engine
) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !source || !game) return false;

  const lpCost = action.lpCost || 800;
  const failureZone = action.failureZone || "graveyard";

  // Check if LP is available
  if (player.lp < lpCost) {
    // Send source to graveyard
    const sourceZone =
      typeof engine.findCardZone === "function"
        ? engine.findCardZone(player, source)
        : null;
    if (sourceZone) {
      if (failureZone === "graveyard" && typeof game.moveCard === "function") {
        game.moveCard(source, player, "graveyard", { fromZone: sourceZone });
      } else {
        const zoneArr = player[sourceZone] || [];
        const idx = zoneArr.indexOf(source);
        if (idx !== -1) {
          zoneArr.splice(idx, 1);
          if (failureZone === "graveyard") {
            player.graveyard = player.graveyard || [];
            player.graveyard.push(source);
          } else if (failureZone === "banished") {
            player.banished = player.banished || [];
            player.banished.push(source);
          }
          if (failureZone === "graveyard") {
            await game.emit("card_to_grave", {
              card: source,
              fromZone: sourceZone,
              player: player,
            });
          }
        }
      }

      getUI(game)?.log(
        `${player.name} cannot pay ${lpCost} LP upkeep for ${source.name}. Sent to ${failureZone}.`
      );
    }

    game.updateBoard();
    return true;
  }

  // Enough LP - ask player to pay
  let shouldPay = false;

  if (player.id === "bot") {
    // Bot always pays if possible
    shouldPay = true;
  } else {
    // Human player: show confirm dialog
    shouldPay =
      getUI(game)?.showConfirmPrompt?.(
        `Pay ${lpCost} LP to keep "${source.name}" on the field? If you decline, it will be sent to the ${failureZone}.`,
        { kind: "pay_lp", cardName: source.name, lpCost }
      ) ?? false;
  }

  if (shouldPay) {
    player.takeDamage(lpCost);
    getUI(game)?.log(
      `${player.name} paid ${lpCost} LP to keep ${source.name} on field.`
    );
    game.updateBoard();
    game.checkWinCondition?.();
    return true;
  }

  // Send to graveyard
  const sourceZone =
    typeof engine.findCardZone === "function"
      ? engine.findCardZone(player, source)
      : null;
  if (sourceZone) {
    if (failureZone === "graveyard" && typeof game.moveCard === "function") {
      game.moveCard(source, player, "graveyard", { fromZone: sourceZone });
    } else {
      const zoneArr = player[sourceZone] || [];
      const idx = zoneArr.indexOf(source);
      if (idx !== -1) {
        zoneArr.splice(idx, 1);
        if (failureZone === "graveyard") {
          player.graveyard = player.graveyard || [];
          player.graveyard.push(source);
        } else if (failureZone === "banished") {
          player.banished = player.banished || [];
          player.banished.push(source);
        }
        if (failureZone === "graveyard") {
          await game.emit("card_to_grave", {
            card: source,
            fromZone: sourceZone,
            player: player,
          });
        }
      }
    }

    getUI(game)?.log(
      `${player.name} chose not to pay upkeep. ${source.name} sent to ${failureZone}.`
    );
  }

  game.updateBoard();
  return true;
}

/**
 * Generic handler for special summon from deck with counter-based ATK limit
 * Implements the "Shadow-Heart Cathedral" summoning with judgment marker counters
 *
 * Action properties:
 * - counterType: type of counter to use (default: "judgment_marker")
 * - counterMultiplier: ATK value per counter (default: 500)
 * - filters: filters to apply to deck cards (archetype, cardKind, etc)
 * - position: "attack" | "defense" | "choice" (default: "attack")
 * - sendSourceToGraveAfter: if true, send source card to graveyard after summon (default: false)
 */
export async function handleSpecialSummonFromDeckWithCounterLimit(
  action,
  ctx,
  targets,
  engine
) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !source || !game) return false;

  const counterType = action.counterType || "judgment_marker";
  const counterMultiplier = action.counterMultiplier || 500;
  const filters = action.filters || {};
  const position = action.position || "choice";

  // Calculate max ATK based on counters
  const counterCount = source[counterType] || 0;
  const maxAtk = counterCount * counterMultiplier;

  if (maxAtk === 0) {
    getUI(game)?.log(
      `No ${counterType} counters on ${source.name}. Cannot summon.`
    );
    return false;
  }

  // Filter deck by ATK limit
  const deck = player.deck || [];
  const candidates = deck.filter((card) => {
    if (!card || card.cardKind !== "monster") return false;
    if (card.atk > maxAtk) return false;

    // Apply archetype filter
    if (filters.archetype) {
      const hasArchetype =
        card.archetype === filters.archetype ||
        (Array.isArray(card.archetypes) &&
          card.archetypes.includes(filters.archetype));
      if (!hasArchetype) return false;
    }

    return true;
  });

  if (candidates.length === 0) {
    getUI(game)?.log(`No monsters in deck with ATK <= ${maxAtk} to summon.`);
    return false;
  }

  // Bot: auto-select best card (highest ATK)
  if (player.id === "bot") {
    const chosen = candidates.reduce((best, card) =>
      card.atk > best.atk ? card : best
    );

    return await performSummonFromDeck(
      chosen,
      deck,
      player,
      action,
      engine,
      source
    );
  }

  // Human player: show selection modal with counter info
  return new Promise((resolve) => {
    const modalConfig = {
      title: `Select 1 monster (Max ATK: ${maxAtk}, ${counterCount}x ${counterType})`,
      subtitle: `Monsters with ATK â‰¤ ${maxAtk}`,
      infoText: `You have ${counterCount} ${counterType} counters. After summoning, this card will be sent to the Graveyard.`,
    };

    getUI(game)?.showCardSelectionModal(
      candidates,
      modalConfig.title,
      1,
      async (selected) => {
        if (!selected || selected.length === 0) {
          resolve(false);
          return;
        }

        const chosen = selected[0];
        const result = await performSummonFromDeck(
          chosen,
          deck,
          player,
          action,
          engine,
          source
        );
        resolve(result);
      }
    );
  });
}

/**
 * Helper function to perform the summon for handleSpecialSummonFromDeckWithCounterLimit
 */
async function performSummonFromDeck(
  card,
  deck,
  player,
  action,
  engine,
  source
) {
  const game = engine.game;

  if (!card || !deck.includes(card)) return false;

  // Check field space
  if (player.field.length >= 5) {
    getUI(game)?.log("Field is full. Cannot summon.");
    return false;
  }

  // Unified semantics: use EffectEngine resolver with action.position
  const summonPosition = await engine.chooseSpecialSummonPosition(
    card,
    player,
    { position: action.position }
  );

  let usedMoveCard = false;
  if (typeof game.moveCard === "function") {
    const moveResult = game.moveCard(card, player, "field", {
      fromZone: "deck",
      position: summonPosition,
      isFacedown: false,
      resetAttackFlags: true,
    });
    if (moveResult?.success === false) {
      return false;
    }
    usedMoveCard = true;
  } else {
    // Remove from deck (fallback)
    const idx = deck.indexOf(card);
    if (idx !== -1) {
      deck.splice(idx, 1);
    }
    card.position = summonPosition;
    card.isFacedown = false;
    card.hasAttacked = false;
    card.attacksUsedThisTurn = 0;
    card.owner = player.id;
    card.controller = player.id;
    player.field.push(card);
  }
  card.cannotAttackThisTurn = action.cannotAttackThisTurn || false;

  getUI(game)?.log(
    `${player.name} Special Summoned ${card.name} from deck in ${
      summonPosition === "defense" ? "Defense" : "Attack"
    } Position.`
  );

  if (!usedMoveCard) {
    await game.emit("after_summon", {
      card: card,
      player: player,
      method: "special",
      fromZone: "deck",
    });
  }

  // Send source to graveyard if specified
  if (action.sendSourceToGraveAfter && source) {
    const sourceZone =
      typeof engine.findCardZone === "function"
        ? engine.findCardZone(player, source)
        : null;
    if (sourceZone) {
      if (typeof game.moveCard === "function") {
        game.moveCard(source, player, "graveyard", { fromZone: sourceZone });
      } else {
        const sourceIdx = sourceZone.indexOf(source);
        if (sourceIdx !== -1) {
          sourceZone.splice(sourceIdx, 1);
          player.graveyard = player.graveyard || [];
          player.graveyard.push(source);

          await game.emit("card_to_grave", {
            card: source,
            fromZone: sourceZone,
            player: player,
          });
        }
      }
      getUI(game)?.log(`${source.name} was sent to the Graveyard.`);
    }
  }

  game.updateBoard();
  return true;
}

/**
 * Destroy up to N target cards (opponent's field/spellTrap/fieldSpell)
 * Used by: Demon Dragon, and other destruction-based effects
 */
export async function handleDestroyTargetedCards(action, ctx, targets, engine) {
  const { player, opponent, source } = ctx;
  const game = engine.game;

  if (!player || !opponent || !source) return false;

  const useSelectiveField =
    action?.type === "selective_field_destruction" ||
    action?.mode === "selective_field" ||
    Number.isFinite(action?.keepPerSide);

  if (useSelectiveField) {
    return await destroySelectiveField(action, ctx, targets, engine);
  }

  // Build candidate list based on optional zone and kind filters
  const zones = Array.isArray(action.zones)
    ? action.zones
    : ["field", "spellTrap", "fieldSpell"];

  let opponentCards = [];
  for (const z of zones) {
    if (z === "field") {
      opponentCards.push(...(opponent.field || []));
    } else if (z === "spellTrap") {
      opponentCards.push(...(opponent.spellTrap || []));
    } else if (z === "fieldSpell") {
      if (opponent.fieldSpell) opponentCards.push(opponent.fieldSpell);
    }
  }

  // Filter by cardKind when provided (supports array)
  if (action.cardKind) {
    const allowedKinds = Array.isArray(action.cardKind)
      ? action.cardKind
      : [action.cardKind];
    opponentCards = opponentCards.filter(
      (c) => c && allowedKinds.includes(c.cardKind)
    );
  }

  // Optional subtype filter (e.g., field, equip)
  if (action.subtype) {
    const allowedSubtypes = Array.isArray(action.subtype)
      ? action.subtype
      : [action.subtype];
    opponentCards = opponentCards.filter(
      (c) => c && c.subtype && allowedSubtypes.includes(c.subtype)
    );
  }

  if (opponentCards.length === 0) {
    getUI(game)?.log("Opponent has no cards to destroy.");
    return false;
  }

  // action.maxTargets: how many cards to target (default 1)
  const maxTargets = Math.min(action.maxTargets || 1, opponentCards.length);

  getUI(game)?.log(
    `${source.name}: Select up to ${maxTargets} opponent cards to destroy.`
  );

  // Build candidates list for selection contract
  const candidates = buildFieldSelectionCandidates(
    opponent,
    game,
    opponentCards
  );

  const selectionContract = {
    kind: "target",
    message: `Select ${maxTargets} opponent card(s) to destroy.`,
    requirements: [
      {
        id: "destroy_targets",
        min: maxTargets,
        max: maxTargets,
        zones: [...new Set(zones)],
        owner: "opponent",
        filters: {},
        allowSelf: true,
        distinct: true,
        candidates,
      },
    ],
    ui: { useFieldTargeting: true },
    metadata: { context: "destroy_targets" },
  };

  const selectedKeys = await selectCards({
    game,
    player,
    selectionContract,
    requirementId: "destroy_targets",
    kind: "target",
    autoSelectorOptions: {
      owner: player,
      activationContext: ctx.activationContext,
      selectionKind: "target",
    },
    autoSelectKeys: () =>
      candidates.slice(0, maxTargets).map((cand) => cand.key),
  });

  if (selectedKeys === null) {
    getUI(game)?.log("Target selection cancelled.");
    return false;
  }

  const targetCards = selectedKeys
    .map((key) => candidates.find((cand) => cand.key === key)?.cardRef)
    .filter(Boolean);

  if (targetCards.length === 0) {
    getUI(game)?.log("No cards selected.");
    return false;
  }

  // Filter out immune cards before destroying
  const { allowed: nonImmuneTargets } = engine.filterCardsListByImmunity(
    targetCards,
    player,
    { actionType: "destroy_targeted_cards" }
  );

  if (nonImmuneTargets.length === 0) {
    getUI(game)?.log("All selected targets are immune to effects.");
    return false;
  }

  for (const card of nonImmuneTargets) {
    const result = await game.destroyCard(card, {
      cause: "effect",
      sourceCard: source,
      opponent: player,
    });
    if (result?.destroyed) {
      getUI(game)?.log(`${source.name} destroyed ${card.name}!`);
    }
  }

  game.updateBoard();
  return true;
}

/**
 * Temporarily buff a card's stats and grant it a second attack this Battle Phase
 * Used by: Shadow-Heart Rage
 * Properties:
 * - targetRef: "self" or other reference (default: "self")
 * - atkBoost: ATK increase
 * - defBoost: DEF increase
 */
/**
 * Initialize default handlers
 * @param {ActionHandlerRegistry} registry
 */
export function registerDefaultHandlers(registry) {
  // Generic special summon handler
  registry.register("special_summon_from_zone", handleSpecialSummonFromZone);

  registry.register(
    "special_summon_from_hand_with_cost",
    handleSpecialSummonFromHandWithCost
  );
  registry.register(
    "special_summon_from_hand_with_tiered_cost",
    handleSpecialSummonFromHandWithCost
  );
  registry.register("bounce_and_summon", handleBounceAndSummon);
  registry.register(
    "special_summon_matching_level",
    handleSpecialSummonFromZone
  );
  registry.register("transmutate", handleTransmutate);
  registry.register("banish", handleBanish);
  registry.register("banish_destroyed_monster", handleBanish);
  registry.register(
    "banish_card_from_graveyard",
    handleBanishCardFromGraveyard
  );

  // Stat modification and effect negation handlers
  registry.register(
    "set_stats_to_zero_and_negate",
    handleSetStatsToZeroAndNegate
  );
  registry.register(
    "grant_additional_normal_summon",
    handleGrantAdditionalNormalSummon
  );

  // Field control handlers
  registry.register("selective_field_destruction", handleDestroyTargetedCards);

  // Luminarch refactoring: new generic handlers
  registry.register("buff_stats_temp", handleBuffStatsTemp);
  registry.register("reduce_self_atk", handleBuffStatsTemp);
  registry.register("add_status", handleAddStatus);
  registry.register("pay_lp", handlePayLP);
  registry.register("add_from_zone_to_hand", handleAddFromZoneToHand);
  registry.register("heal_from_destroyed_atk", handleHealFromDestroyedAtk);
  registry.register("heal_from_destroyed_level", handleHealFromDestroyedLevel);
  registry.register("grant_protection", handleGrantProtection);
  registry.register("banish_and_buff", handleBanishAndBuff);
  registry.register("switch_position", handleSwitchPosition);
  registry.register(
    "switch_defender_position_on_attack",
    handleSwitchDefenderPositionOnAttack
  );
  registry.register("permanent_buff_named", handlePermanentBuffNamed);
  registry.register(
    "remove_permanent_buff_named",
    handleRemovePermanentBuffNamed
  );
  registry.register("grant_second_attack", handleBuffStatsTemp);
  registry.register("grant_attack_all_monsters", handleGrantAttackAllMonsters);
  registry.register(
    "conditional_summon_from_hand",
    handleConditionalSummonFromHand
  );

  // FASE 2: New handlers for Shadow-Heart refactoring
  registry.register(
    "destroy_attacker_on_archetype_destruction",
    handleDestroyAttackerOnArchetypeDestruction
  );
  registry.register(
    "upkeep_pay_or_send_to_grave",
    handleUpkeepPayOrSendToGrave
  );
  registry.register(
    "special_summon_from_deck_with_counter_limit",
    handleSpecialSummonFromDeckWithCounterLimit
  );

  // FASE 3: New handlers for complex Shadow-Heart methods
  registry.register("destroy_targeted_cards", handleDestroyTargetedCards);
  registry.register("buff_stats_temp_with_second_attack", handleBuffStatsTemp);
  registry.register("draw_and_summon", handleDrawAndSummon);

  // ✅ FASE 3: Handler para Abyssal Serpent Dragon delayed summon
  registry.register(
    "abyssal_serpent_delayed_summon",
    handleAbyssalSerpentDelayedSummon
  );

  // Legacy/common actions migrated into the registry (proxy to EffectEngine methods)
  registry.register("draw", proxyEngineMethod("applyDraw"));
  registry.register("heal", proxyEngineMethod("applyHeal"));
  registry.register(
    "heal_per_archetype_monster",
    proxyEngineMethod("applyHealPerArchetypeMonster")
  );
  registry.register("damage", proxyEngineMethod("applyDamage"));
  registry.register("destroy", proxyEngineMethod("applyDestroy"));
  registry.register("move", proxyEngineMethod("applyMove"));
  registry.register("equip", proxyEngineMethod("applyEquip"));
  registry.register("negate_attack", proxyEngineMethod("applyNegateAttack"));
  registry.register("search_any", handleAddFromZoneToHand);
  registry.register("buff_atk_temp", proxyEngineMethod("applyBuffAtkTemp"));
  registry.register(
    "modify_stats_temp",
    proxyEngineMethod("applyModifyStatsTemp")
  );
  registry.register("add_counter", proxyEngineMethod("applyAddCounter"));
  registry.register(
    "forbid_attack_this_turn",
    proxyEngineMethod("applyForbidAttackThisTurn")
  );
  registry.register(
    "forbid_attack_next_turn",
    proxyEngineMethod("applyForbidAttackNextTurn")
  );
  registry.register(
    "allow_direct_attack_this_turn",
    proxyEngineMethod("applyAllowDirectAttackThisTurn")
  );
  registry.register(
    "special_summon_token",
    proxyEngineMethod("applySpecialSummonToken")
  );
  registry.register(
    "grant_void_fusion_immunity",
    proxyEngineMethod("applyGrantVoidFusionImmunity")
  );
  registry.register(
    "destroy_self_monsters_and_draw",
    proxyEngineMethod("applyDestroyAllOthersAndDraw")
  );
  registry.register(
    "polymerization_fusion_summon",
    proxyEngineMethod("applyPolymerizationFusion")
  );
  registry.register(
    "call_of_haunted_summon_and_bind",
    proxyEngineMethod("applyCallOfTheHauntedSummon")
  );
  registry.register(
    "mirror_force_destroy_all",
    proxyEngineMethod("applyMirrorForceDestroy")
  );
  registry.register(
    "destroy_other_dragons_and_buff",
    proxyEngineMethod("applyDestroyOtherDragonsAndBuff")
  );
}
