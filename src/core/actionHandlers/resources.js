/**
 * resources.js
 *
 * Handlers for resource management (LP, draw, search, upkeep).
 * Moved from ActionHandlers.js with identical behavior.
 */

import { isAI } from "../Player.js";
import { cardMatchesKind } from "../Card.js";
import {
  getUI,
  collectZoneCandidates,
  selectCardsFromZone,
  summonFromHandCore,
} from "./shared.js";

async function emitLpGainEvent(game, player, sourceCard, before) {
  const gained = Math.max(0, (player?.lp || 0) - before);
  if (gained <= 0) return false;

  const payload = {
    player,
    sourceCard,
    lpGained: gained,
    before,
    after: player.lp,
  };

  if (typeof game?.emit === "function") {
    await game.emit("lp_change", payload);
  } else {
    game?.notify?.("lp_change", payload);
  }

  return true;
}

function getScopedPlayers(ctx, owner = "self") {
  if (owner === "opponent") return [ctx?.opponent].filter(Boolean);
  if (owner === "any" || owner === "both" || owner === "either") {
    return [ctx?.player, ctx?.opponent].filter(Boolean);
  }
  return [ctx?.player].filter(Boolean);
}

function getFieldCounterZoneCards(player, zone) {
  if (!player || !zone) return [];
  if (zone === "fieldSpell") {
    return player.fieldSpell ? [player.fieldSpell] : [];
  }
  const cards = player[zone];
  return Array.isArray(cards) ? cards.filter(Boolean) : [];
}

function cardMatchesFieldCounterFilters(card, filters = {}) {
  if (!card) return false;
  if (filters.requireFaceup === true && card.isFacedown) return false;
  if (filters.cardKind && !cardMatchesKind(card, filters.cardKind)) return false;
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  if (filters.type && card.type !== filters.type) return false;
  if (filters.attribute && card.attribute !== filters.attribute) return false;
  if (filters.name && card.name !== filters.name) return false;
  if (filters.subtype && card.subtype !== filters.subtype) return false;
  return true;
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

  if (!player || !game) {
    console.log("[handlePayLP] Missing player or game");
    return false;
  }

  let amount = action.amount || 0;

  if (action.fraction) {
    amount = Math.floor(player.lp * action.fraction);
  }

  if (amount <= 0) {
    console.log("[handlePayLP] Amount is zero or negative:", amount);
    return false;
  }

  const baseAmount = amount;
  if (engine && typeof engine.resolveLpCost === "function") {
    const costResult = engine.resolveLpCost(action, ctx, amount);
    if (costResult && typeof costResult.finalAmount === "number") {
      amount = costResult.finalAmount;
    }
    if (costResult?.reduction > 0) {
      console.log(
        `[handlePayLP] Cost reduced: ${baseAmount} -> ${amount} (reduced ${costResult.reduction})`
      );
    }
  }

  if (amount <= 0) {
    getUI(game)?.log("LP cost reduced to 0.");
    return true;
  }

  if (player.lp < amount) {
    console.log(`[handlePayLP] Not enough LP: ${player.lp} < ${amount}`);
    getUI(game)?.log("Not enough LP to pay cost.");
    return false;
  }

  const before = player.lp;
  player.lp -= amount;
  console.log(
    `[handlePayLP] SUCCESS: Paid ${amount} LP, remaining ${player.lp}`
  );
  game.notify?.("lp_change", {
    player,
    sourceCard: ctx.source,
    lpPaid: amount,
    before,
    after: player.lp,
  });

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
  // Online sempre deve pedir seleção para o seat humano, mesmo se o id legado for "bot".
  // Auto-seleção só deve ocorrer quando o controllerType é IA.
  const promptPlayer = action.promptPlayer !== false && !isAI(player);

  if (!player || !game) return false;

  const inferredSearch =
    action?.type === "search_any" || action?.mode === "search_any";
  const sourceZone = action.zone || (inferredSearch ? "deck" : "graveyard");
  const zone = player[sourceZone];
  const count = action.count || { min: 1, max: 1 };
  const minSelect = Math.max(count.min || 0, 0);

  if (!zone || zone.length === 0) {
    if (minSelect === 0) {
      getUI(game)?.log("No cards selected (optional).");
      game.updateBoard();
      return true;
    }
    getUI(game)?.log(`No cards in ${sourceZone}.`);
    return false;
  }

  // Apply filters
  const baseFilters = action.filters || {};
  const filters = { ...baseFilters };
  const addExcludedNames = (names) => {
    const list = Array.isArray(names) ? names : [names];
    const existing = Array.isArray(filters.excludeCardNames)
      ? filters.excludeCardNames
      : filters.excludeCardName
        ? [filters.excludeCardName]
        : [];
    const next = new Set(existing.filter(Boolean));
    for (const name of list) {
      if (typeof name === "string" && name) {
        next.add(name);
      }
    }
    if (next.size > 0) {
      filters.excludeCardNames = Array.from(next);
    }
  };

  addExcludedNames(action.excludeName);
  addExcludedNames(action.excludeCardName);
  addExcludedNames(action.excludeCardNames);
  if (action.excludeNameRef && targets?.[action.excludeNameRef]) {
    const refCards = Array.isArray(targets[action.excludeNameRef])
      ? targets[action.excludeNameRef]
      : [targets[action.excludeNameRef]];
    addExcludedNames(refCards.map((card) => card?.name).filter(Boolean));
  }

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
      if (!cardMatchesKind(card, filters.cardKind)) return false;
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
    if (minSelect === 0) {
      getUI(game)?.log("No cards selected (optional).");
      game.updateBoard();
      return true;
    }
    getUI(game)?.log(`No valid cards in ${sourceZone} matching filters.`);
    return false;
  }

  const maxSelect = Math.min(count.max, candidates.length);

  if (maxSelect === 0) {
    getUI(game)?.log("No cards available to add.");
    return false;
  }

  const finalizeSelection = async (selectedCards) => {
    const selected = Array.isArray(selectedCards) ? selectedCards : [];
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
        const moveResult = await game.moveCard(card, player, "hand", {
          fromZone: sourceZone,
          sourceCard: source,
          effectId: ctx.effect?.id || null,
          awaitEvents: true,
        });
        if (moveResult && moveResult.success === false) {
          return false;
        }
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

    // v3: Emit event for replay capture - track which cards were added to hand
    if (typeof game.emit === "function") {
      await game.emit("cards_added_to_hand", {
        player,
        cards: selected,
        fromZone: sourceZone,
        sourceCard: source,
        effectId: ctx.effect?.id || null,
      });
    }

    game.updateBoard();
    return true;
  };

  const selection = await selectCardsFromZone({
    game,
    player,
    zone,
    source,
    filters,
    candidates,
    maxSelect,
    minSelect,
    promptPlayer: promptPlayer !== false,
    botSelect: (cards, max) => {
      if (typeof player.strategy?.rankSearchCandidates === "function") {
        const ranked = player.strategy.rankSearchCandidates(cards, action, {
          player,
          source,
          game,
          ctx,
        });
        if (Array.isArray(ranked)) {
          return ranked.slice(0, max);
        }
      }

      // Apply botPrefer rules: if hand contains a trigger card, prefer a specific search target
      if (Array.isArray(action.botPrefer) && action.botPrefer.length > 0) {
        const hand = player.hand || [];
        for (const rule of action.botPrefer) {
          const triggerInHand =
            !rule.ifHandHas ||
            hand.some((c) => c.name === rule.ifHandHas);
          if (triggerInHand) {
            const preferred = cards.find((c) => c.name === rule.prefer);
            if (preferred) {
              const rest = cards.filter((c) => c !== preferred);
              return [preferred, ...rest].slice(0, max);
            }
          }
        }
      }
      return cards[0]?.cardKind === "monster"
        ? cards
            .slice()
            .sort((a, b) => (b.atk || 0) - (a.atk || 0))
            .slice(0, max)
        : cards.slice(0, max);
    },
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

  const result = await finalizeSelection(selection.selected || []);
  return result;
}

/**
 * Search a card, add it to hand, then optionally Special Summon that same card.
 *
 * Action properties:
 * - zone: source zone (default: "deck")
 * - filters: card filters for the search
 * - count: currently resolves the first selected card, default { min: 1, max: 1 }
 * - summonCondition: { type: "empty_field" } or omitted
 * - optional: whether the Special Summon can be declined (default: true)
 * - position: "attack" | "defense" | "choice"
 */
export async function handleSearchThenOptionalSpecialSummonFromHand(
  action,
  ctx,
  targets,
  engine,
) {
  const { player, source } = ctx;
  const game = engine.game;
  const promptPlayer = action.promptPlayer !== false && !isAI(player);

  if (!player || !game) return false;

  const sourceZone = action.zone || "deck";
  const zone = player[sourceZone];

  if (!Array.isArray(zone) || zone.length === 0) {
    getUI(game)?.log(`No cards in ${sourceZone}.`);
    return false;
  }

  const filters = buildSearchFilters(action);
  const candidates = collectZoneCandidates(zone, filters, {
    source,
    extraFilter: (card) => cardMatchesSearchAction(card, action),
  });

  if (candidates.length === 0) {
    getUI(game)?.log(`No valid cards in ${sourceZone} matching filters.`);
    return false;
  }

  const count = action.count || { min: 1, max: 1 };
  const requestedMax = Number.isFinite(count.max) ? count.max : 1;
  const maxSelect = Math.min(requestedMax, 1, candidates.length);
  const minSelect = Math.max(count.min ?? 1, 0);

  if (maxSelect <= 0 || minSelect > maxSelect) {
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
    promptPlayer,
    botSelect: (cards, max) => {
      if (typeof player.strategy?.rankSearchCandidates === "function") {
        const ranked = player.strategy.rankSearchCandidates(cards, action, {
          player,
          source,
          game,
          ctx,
        });
        if (Array.isArray(ranked)) {
          return ranked.slice(0, max);
        }
      }

      return cards
        .slice()
        .sort((a, b) => (b.atk || 0) - (a.atk || 0))
        .slice(0, max);
    },
    selectSingle: (cards) => selectSingleSearchCard(game, cards),
    selectMulti: (cards, range) => cards.slice(0, range.max),
  });

  const searchedCard = selection.selected?.[0] || null;
  if (!searchedCard) {
    getUI(game)?.log("No cards selected.");
    return false;
  }

  const moveResult =
    typeof game.moveCard === "function"
      ? await game.moveCard(searchedCard, player, "hand", {
          fromZone: sourceZone,
          sourceCard: source,
          effectId: ctx.effect?.id || null,
          awaitEvents: true,
        })
      : null;

  if (moveResult && moveResult.success === false) {
    return false;
  }

  if (moveResult == null) {
    const index = zone.indexOf(searchedCard);
    if (index !== -1) zone.splice(index, 1);
    player.hand = player.hand || [];
    player.hand.push(searchedCard);
  }

  getUI(game)?.log(
    `${player.name || player.id} added ${searchedCard.name} to hand from ${sourceZone}.`,
  );

  if (typeof game.emit === "function") {
    await game.emit("cards_added_to_hand", {
      player,
      cards: [searchedCard],
      fromZone: sourceZone,
      sourceCard: source,
      effectId: ctx.effect?.id || null,
    });
  }

  game.updateBoard();

  if (!canResolveFollowupSummon(action, player)) {
    return true;
  }

  if (!player.hand?.includes(searchedCard)) {
    getUI(game)?.log(`${searchedCard.name} is no longer in hand.`);
    return true;
  }

  if ((player.field || []).length >= 5) {
    getUI(game)?.log("No Monster Zone available for Special Summon.");
    return true;
  }

  const shouldSummon = await shouldPerformOptionalSummon(
    action,
    game,
    player,
    searchedCard,
  );

  if (!shouldSummon) {
    return true;
  }

  const summonResult = await summonFromHandCore({
    card: searchedCard,
    player,
    engine,
    game,
    position: action.position,
    cannotAttackThisTurn:
      action.restrictAttackThisTurn || action.cannotAttackThisTurn || false,
  });

  if (!summonResult.success) {
    return true;
  }

  getUI(game)?.log(
    `${player.name || player.id} Special Summoned ${searchedCard.name} from hand.`,
  );
  game.updateBoard();

  if (game.finishSelection && typeof game.finishSelection === "function") {
    game.finishSelection();
  }

  return true;
}

function buildSearchFilters(action) {
  const filters = { ...(action.filters || {}) };
  if (action.archetype && !filters.archetype) filters.archetype = action.archetype;
  if (action.cardKind && !filters.cardKind) filters.cardKind = action.cardKind;
  if (action.cardName && !filters.name) filters.name = action.cardName;
  if (Number.isFinite(action.minAtk) && filters.minAtk == null) {
    filters.minAtk = action.minAtk;
  }
  if (Number.isFinite(action.maxAtk) && filters.maxAtk == null) {
    filters.maxAtk = action.maxAtk;
  }
  if (Number.isFinite(action.minLevel) && filters.minLevel == null) {
    filters.minLevel = action.minLevel;
  }
  if (Number.isFinite(action.maxLevel) && filters.maxLevel == null) {
    filters.maxLevel = action.maxLevel;
  }
  return filters;
}

function cardMatchesSearchAction(card, action) {
  if (!card) return false;
  if (action.cardName) {
    const match = action.cardName.toLowerCase();
    if ((card.name || "").toLowerCase() !== match) return false;
  }
  if (typeof action.cardId === "number" && card.id !== action.cardId) {
    return false;
  }
  return true;
}

function selectSingleSearchCard(game, cards) {
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
          cards.find((card) => card && card.name === selectedName) || cards[0];
        game.isResolvingEffect = false;
        resolve(chosen);
      },
    );
  });
}

function canResolveFollowupSummon(action, player) {
  const condition = action.summonCondition || action.condition || {};
  if (!condition.type) return true;

  if (condition.type === "empty_field") {
    return (player.field || []).length === 0;
  }

  return false;
}

async function shouldPerformOptionalSummon(action, game, player, card) {
  if (action.optional === false || isAI(player)) {
    return true;
  }

  const ui = getUI(game);
  if (ui && typeof ui.showConfirmPrompt === "function") {
    const result = ui.showConfirmPrompt(
      action.promptMessage || `Special Summon ${card.name} from your hand?`,
      {
        kind: "optional_special_summon",
        cardName: card.name,
        playerId: player.id,
        confirmLabel: action.confirmLabel || "Special Summon",
        cancelLabel: action.cancelLabel || "Keep in hand",
        title: action.promptTitle || "Optional Special Summon",
      },
    );
    return result && typeof result.then === "function"
      ? !!(await result)
      : !!result;
  }

  return true;
}

/**
 * Generic handler for healing based on destroyed monster's ATK
 *
 * Action properties:
 * - fraction: fraction of ATK to heal (default: 1.0)
 * - multiplier: alternative name for fraction
 * - useBaseAtk: when true, use printed ATK with fallback to current ATK
 */
export async function handleHealFromDestroyedAtk(action, ctx, targets, engine) {
  const { player, destroyed } = ctx;

  const game = engine.game;

  if (!player || !game || !destroyed) return false;

  const fraction = action.fraction ?? action.multiplier ?? 1.0;
  const baseValue =
    action.useBaseAtk === true && Number.isFinite(Number(destroyed.baseAtk))
      ? Number(destroyed.baseAtk)
      : Number.isFinite(Number(destroyed.atk))
        ? Number(destroyed.atk)
        : 0;

  const healAmount = Math.floor(baseValue * fraction);

  if (healAmount <= 0) return false;

  const before = player.lp || 0;
  player.gainLP(healAmount);
  await emitLpGainEvent(game, player, ctx.source, before);

  getUI(game)?.log(
    `${player.name || player.id} gained ${healAmount} LP from ${
      destroyed.name
    }'s ATK.`
  );

  game.updateBoard();

  return true;
}

/**
 * Generic handler for damage based on the destroyed monster's ATK.
 *
 * Action properties:
 * - fraction: fraction of ATK to deal (default: 1.0)
 * - multiplier: alternative name for fraction
 * - player: "self" or "opponent" from the resolving effect's perspective
 * - useBaseAtk: when true, use printed ATK with fallback to current ATK
 */
export async function handleDamageFromDestroyedAtk(
  action,
  ctx,
  targets,
  engine,
) {
  const { player, opponent, destroyed } = ctx;
  const game = engine.game;

  if (!player || !game || !destroyed) return false;

  const targetPlayer = action.player === "self" ? player : opponent;
  if (!targetPlayer) return false;

  const fraction = action.fraction ?? action.multiplier ?? 1.0;
  const baseValue =
    action.useBaseAtk === true && Number.isFinite(Number(destroyed.baseAtk))
      ? Number(destroyed.baseAtk)
      : Number.isFinite(Number(destroyed.atk))
        ? Number(destroyed.atk)
        : 0;
  const damageAmount = Math.floor(baseValue * fraction);

  if (damageAmount <= 0) return false;

  targetPlayer.takeDamage(damageAmount);

  getUI(game)?.log(
    `${targetPlayer.name || targetPlayer.id} took ${damageAmount} damage from ${
      destroyed.name
    }'s ATK.`,
  );

  game.updateBoard();
  game.checkWinCondition?.();

  return true;
}

/**
 * Handler for healing LP based on the Level of the monster destroyed in battle
 *
 * Action properties:
 * - multiplier: how much to multiply the level (default: 100)
 * - player: who gains LP ("self" default)
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

  const before = player.lp || 0;
  player.gainLP(healAmount);
  await emitLpGainEvent(game, player, ctx.source, before);

  getUI(game)?.log(
    `${
      player.name || player.id
    } gained ${healAmount} LP from destroying a Level ${level} monster!`
  );

  game.updateBoard();

  return true;
}

/**
 * Handler for healing LP based on count of matching cards on field
 *
 * Action properties:
 * - amountPerCard: LP to heal per matching card (required)
 * - filters: { owner, zone, cardKind, archetype, type, etc. }
 * - player: who gains LP ("self" default)
 */
export async function handleHealPerFieldCount(action, ctx, targets, engine) {
  const { player, opponent } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const amountPerCard = action.amountPerCard || 0;
  if (amountPerCard <= 0) return false;

  const filters = action.filters || {};
  const ownerFilter = filters.owner || "self";
  const zoneFilter = filters.zone || "field";

  // Determine which player's zone to check
  const targetPlayer = ownerFilter === "opponent" ? opponent : player;
  if (!targetPlayer) return false;

  const zone = targetPlayer[zoneFilter];
  if (!Array.isArray(zone)) return false;

  // Count matching cards
  let count = 0;
  for (const card of zone) {
    if (!card) continue;
    if (filters.cardKind && !cardMatchesKind(card, filters.cardKind)) continue;
    if (filters.archetype && card.archetype !== filters.archetype) continue;
    if (filters.type && card.type !== filters.type) continue;
    if (filters.name && card.name !== filters.name) continue;
    if (filters.requireFaceup && card.isFacedown) continue;
    count++;
  }

  if (count === 0) {
    getUI(game)?.log("No matching cards found on field.");
    return true; // Valid execution, just 0 heal
  }

  const healAmount = count * amountPerCard;
  const before = player.lp || 0;
  player.gainLP(healAmount);
  await emitLpGainEvent(game, player, ctx.source, before);

  getUI(game)?.log(
    `${
      player.name || player.id
    } gained ${healAmount} LP (${count} card(s) x ${amountPerCard} LP).`
  );

  game.updateBoard();
  return true;
}

/**
 * Handler for healing LP based on the number of counters on field cards.
 *
 * Action properties:
 * - counterType: counter key to count (default: "default")
 * - amountPerCounter: LP to heal per counted counter (required)
 * - owner: whose field cards are counted ("self", "opponent", "any")
 * - zones: field zones to count from (default: ["field"])
 * - filters: optional card filters
 * - player: who gains LP ("self" default)
 */
export async function handleHealPerFieldCounter(action, ctx, targets, engine) {
  const game = engine.game;
  if (!game) return false;

  const targetPlayer = action.player === "opponent" ? ctx.opponent : ctx.player;
  if (!targetPlayer) return false;

  const counterType = action.counterType || "default";
  const amountPerCounter = Number(action.amountPerCounter || 0);
  if (amountPerCounter <= 0) return false;

  const zones = Array.isArray(action.zones)
    ? action.zones
    : [action.zone || "field"];
  const filters = action.filters || {};
  let counterCount = 0;

  for (const scopedPlayer of getScopedPlayers(ctx, action.owner || "self")) {
    for (const zone of zones) {
      for (const card of getFieldCounterZoneCards(scopedPlayer, zone)) {
        if (!cardMatchesFieldCounterFilters(card, filters)) continue;
        const count =
          typeof card.getCounter === "function"
            ? Number(card.getCounter(counterType) || 0)
            : 0;
        counterCount += Math.max(0, count);
      }
    }
  }

  if (counterCount <= 0) {
    getUI(game)?.log(`No ${counterType} counters found on the field.`);
    return true;
  }

  const healAmount = counterCount * amountPerCounter;
  const before = targetPlayer.lp || 0;
  targetPlayer.gainLP(healAmount);
  await emitLpGainEvent(game, targetPlayer, ctx.source, before);

  getUI(game)?.log(
    `${targetPlayer.name || targetPlayer.id} gained ${healAmount} LP (${counterCount} ${counterType} counter(s) x ${amountPerCounter} LP).`,
  );

  game.updateBoard();
  return true;
}

/**
 * Handler for healing LP based on opponent-controlled cards plus opponent hand.
 *
 * Action properties:
 * - amountPerCard: LP to heal per counted card (required)
 * - player: who gains LP ("self" default)
 */
export async function handleHealPerOpponentCardsAndHand(
  action,
  ctx,
  targets,
  engine,
) {
  const { player, opponent } = ctx;
  const game = engine.game;

  if (!player || !opponent || !game) return false;

  const amountPerCard = action.amountPerCard || 0;
  if (amountPerCard <= 0) return false;

  const targetPlayer = action.player === "opponent" ? opponent : player;
  const countedCards = [
    ...(opponent.field || []),
    ...(opponent.spellTrap || []),
    ...(opponent.hand || []),
  ];
  if (opponent.fieldSpell) {
    countedCards.push(opponent.fieldSpell);
  }

  const count = countedCards.filter(Boolean).length;
  if (count === 0) {
    getUI(game)?.log("Opponent has no cards to count for LP gain.");
    return true;
  }

  const healAmount = count * amountPerCard;
  const before = targetPlayer.lp || 0;
  targetPlayer.gainLP(healAmount);
  await emitLpGainEvent(game, targetPlayer, ctx.source, before);

  getUI(game)?.log(
    `${targetPlayer.name || targetPlayer.id} gained ${healAmount} LP (${count} opponent card(s) x ${amountPerCard} LP).`,
  );

  game.updateBoard();
  return true;
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

function findSourceZone(engine, player, source) {
  if (!player || !source) return null;
  if (engine && typeof engine.findCardZone === "function") {
    const zone = engine.findCardZone(player, source);
    if (zone) return zone;
  }

  for (const zone of ["spellTrap", "fieldSpell", "field", "hand"]) {
    if (Array.isArray(player[zone]) && player[zone].includes(source)) {
      return zone;
    }
    if (player[zone] === source) {
      return zone;
    }
  }

  return null;
}

function moveUpkeepSourceToFailureZone(game, player, source, failureZone, sourceZone) {
  if (!game || !player || !source || !sourceZone) return false;

  if (typeof game.moveCard === "function") {
    game.moveCard(source, player, failureZone, { fromZone: sourceZone });
    return true;
  }

  const zoneArr = Array.isArray(player[sourceZone]) ? player[sourceZone] : null;
  if (!zoneArr) return false;

  const idx = zoneArr.indexOf(source);
  if (idx === -1) return false;

  zoneArr.splice(idx, 1);
  player[failureZone] = player[failureZone] || [];
  player[failureZone].push(source);
  return true;
}

function shouldAiPayUpkeep(action, player, source, lpCost) {
  if (action.aiPay === false) return false;
  if (typeof action.aiMinLpAfterPay === "number") {
    return player.lp - lpCost >= action.aiMinLpAfterPay;
  }
  if (typeof action.aiMaxLpFraction === "number" && player.lp > 0) {
    return lpCost / player.lp <= action.aiMaxLpFraction;
  }
  if (source?.upkeepValue === "low" && player.lp - lpCost < 2000) {
    return false;
  }
  return true;
}

async function confirmHumanUpkeepPayment(action, game, player, source, lpCost) {
  if (action.promptPlayer === false) return true;

  const ui = getUI(game);
  if (ui && typeof ui.showConfirmPrompt === "function") {
    const message =
      action.promptMessage ||
      `Pay ${lpCost} LP to maintain ${source.name || "this card"}?`;
    const result = ui.showConfirmPrompt(message, {
      kind: "upkeep_cost",
      cardName: source.name,
      lpCost,
      playerId: player.id,
      confirmLabel: action.confirmLabel || `Pay ${lpCost} LP`,
      cancelLabel: action.cancelLabel || "Send to GY",
      title: action.promptTitle || "Maintenance Cost",
    });
    return result && typeof result.then === "function"
      ? !!(await result)
      : !!result;
  }

  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    return window.confirm(
      action.promptMessage ||
        `Pay ${lpCost} LP to maintain ${source.name || "this card"}?`
    );
  }

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

  const sourceZone = findSourceZone(engine, player, source);
  const sendToFailureZone = (reason) => {
    const moved = moveUpkeepSourceToFailureZone(
      game,
      player,
      source,
      failureZone,
      sourceZone
    );
    getUI(game)?.log(
      `${source.name} sent to ${failureZone} (${reason}).`
    );
    game.updateBoard();
    return moved;
  };

  if (!sourceZone) {
    getUI(game)?.log(`${source.name} is no longer on the field for upkeep.`);
    return true; // Effect resolved, just couldn't pay
  }

  if (player.lp < lpCost) {
    sendToFailureZone("insufficient LP for upkeep");
    return true;
  }

  const shouldPay = isAI(player)
    ? shouldAiPayUpkeep(action, player, source, lpCost)
    : await confirmHumanUpkeepPayment(action, game, player, source, lpCost);

  if (!shouldPay) {
    sendToFailureZone("upkeep not paid");
    return true;
  }

  player.lp -= lpCost;

  getUI(game)?.log(`Paid ${lpCost} LP to maintain ${source.name}.`);

  game.updateBoard();

  return true;
}
