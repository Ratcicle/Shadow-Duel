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
}

/**
 * Generic handler for special summoning from any zone with filters
 * Replaces: applyVoidConjurerSummonFromDeck, applyVoidHollowSummonFromDeck, etc.
 *
 * NOTE: Despite the registered name "special_summon_from_deck", this handler
 * works with ANY zone (deck, hand, graveyard) by specifying the zone property.
 *
 * Action properties:
 * - zone: "deck" | "hand" | "graveyard" | "banished" (default: "deck")
 * - filters: { archetype, name, level, levelOp, cardKind }
 * - position: "attack" | "defense" | "choice" (default: "choice")
 * - cannotAttackThisTurn: boolean
 * - negateEffects: boolean (default: false) - whether to negate the summoned monster's effects
 * - promptPlayer: boolean (default: true for human player)
 */
export async function handleSpecialSummonFromZone(
  action,
  ctx,
  targets,
  engine
) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  // Determine source zone (default: deck)
  const sourceZone = action.zone || "deck";
  const zone = player[sourceZone];

  if (!zone || zone.length === 0) {
    game.renderer?.log(`No cards in ${sourceZone}.`);
    return false;
  }

  // Check field space
  if (player.field.length >= 5) {
    game.renderer?.log("Field is full.");
    return false;
  }

  // Apply filters to find candidates
  const filters = action.filters || {};
  const candidates = zone.filter((card) => {
    if (!card) return false;

    // Card kind filter
    if (filters.cardKind && card.cardKind !== filters.cardKind) return false;

    // Archetype filter
    if (filters.archetype) {
      const hasArchetype =
        card.archetype === filters.archetype ||
        (Array.isArray(card.archetypes) &&
          card.archetypes.includes(filters.archetype));
      if (!hasArchetype) return false;
    }

    // Name filter
    if (filters.name && card.name !== filters.name) return false;

    // Level filter
    if (filters.level !== undefined) {
      const cardLevel = card.level || 0;
      const op = filters.levelOp || "eq";

      if (op === "eq" && cardLevel !== filters.level) return false;
      if (op === "lte" && cardLevel > filters.level) return false;
      if (op === "gte" && cardLevel < filters.level) return false;
      if (op === "lt" && cardLevel >= filters.level) return false;
      if (op === "gt" && cardLevel <= filters.level) return false;
    }

    // Exclude source card if specified in filters
    // Use ID comparison for reliability across card instances
    if (filters.excludeSelf && source && card.id === source.id) return false;

    return true;
  });

  if (candidates.length === 0) {
    game.renderer?.log(`No valid cards in ${sourceZone} matching filters.`);
    return false;
  }

  // Bot auto-selection (highest ATK)
  if (player.id === "bot") {
    const best = candidates.reduce((top, card) => {
      const cardAtk = card.atk || 0;
      const topAtk = top.atk || 0;
      return cardAtk >= topAtk ? card : top;
    }, candidates[0]);

    return await summonCard(best, zone, player, action, engine);
  }

  // Player selection
  const promptPlayer = action.promptPlayer !== false;

  if (!promptPlayer || candidates.length === 1) {
    // Auto-select if only one candidate or prompt disabled
    return await summonCard(candidates[0], zone, player, action, engine);
  }

  // Show visual selection modal
  const searchModal = engine.getSearchModalElements();
  const defaultCardName = candidates[0]?.name || "";

  if (searchModal) {
    return new Promise((resolve) => {
      game.isResolvingEffect = true;

      engine.showSearchModalVisual(
        searchModal,
        candidates,
        defaultCardName,
        async (selectedName) => {
          const chosen =
            candidates.find((c) => c && c.name === selectedName) ||
            candidates[0];
          const result = await summonCard(chosen, zone, player, action, engine);
          game.isResolvingEffect = false;
          resolve(result);
        }
      );
    });
  }

  // Fallback: auto-select
  return await summonCard(candidates[0], zone, player, action, engine);
}

/**
 * Helper function to summon a card
 */
async function summonCard(card, sourceZone, player, action, engine) {
  const game = engine.game;

  if (!card || player.field.length >= 5) return false;

  // Remove from source zone
  const cardIndex = sourceZone.indexOf(card);
  if (cardIndex !== -1) {
    sourceZone.splice(cardIndex, 1);
  }

  // Determine position
  let position = action.position || "choice";
  if (position === "choice") {
    position = await engine.chooseSpecialSummonPosition(card, player);
  }

  // Set card properties
  card.position = position;
  card.isFacedown = false;
  card.hasAttacked = false;
  card.cannotAttackThisTurn = action.cannotAttackThisTurn || false;
  card.owner = player.id;

  // Negate effects if specified
  if (action.negateEffects === true) {
    card.effectsNegated = true;
  }

  // Add to field
  player.field.push(card);

  // Log
  const zoneName = action.zone || "deck";
  const positionText = position === "defense" ? "Defense" : "Attack";
  const restrictText = card.cannotAttackThisTurn
    ? " (cannot attack this turn)"
    : "";
  const negateText = action.negateEffects === true 
    ? " (effects negated)" 
    : "";

  game.renderer?.log(
    `${player.name || player.id} Special Summoned ${
      card.name
    } from ${zoneName} in ${positionText} Position${restrictText}${negateText}.`
  );

  // Emit after_summon event
  game.emit("after_summon", {
    card: card,
    player: player,
    method: "special",
  });

  game.updateBoard();
  return true;
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

  console.log("[handleSpecialSummonFromHandWithCost] Called with:", {
    source: source?.name,
    costTargetRef: action.costTargetRef,
    targetsKeys: Object.keys(targets),
    targets: targets,
  });

  if (!player || !source || !game) {
    console.error(
      "[handleSpecialSummonFromHandWithCost] Missing required context:",
      {
        hasPlayer: !!player,
        hasSource: !!source,
        hasGame: !!game,
      }
    );
    return false;
  }

  // Validate cost was paid
  const costTargets = targets[action.costTargetRef];
  console.log("[handleSpecialSummonFromHandWithCost] Cost targets:", {
    costTargetRef: action.costTargetRef,
    found: !!costTargets,
    length: costTargets?.length,
    cards: costTargets?.map((c) => c.name),
  });

  if (!costTargets || costTargets.length === 0) {
    game.renderer?.log("No cost paid for special summon.");
    console.error(
      "[handleSpecialSummonFromHandWithCost] No cost targets found!"
    );
    return false;
  }

  // Move cost cards to graveyard
  console.log(
    "[handleSpecialSummonFromHandWithCost] Moving cards to graveyard..."
  );
  for (const costCard of costTargets) {
    const fieldIndex = player.field.indexOf(costCard);
    console.log(
      `[handleSpecialSummonFromHandWithCost] ${costCard.name}: fieldIndex=${fieldIndex}`
    );
    if (fieldIndex !== -1) {
      player.field.splice(fieldIndex, 1);
      player.graveyard.push(costCard);
      console.log(
        `[handleSpecialSummonFromHandWithCost] Moved ${costCard.name} to graveyard`
      );
    }
  }

  // Check if source is in hand
  if (!player.hand.includes(source)) {
    console.warn(
      "[handleSpecialSummonFromHandWithCost] Card not found in hand:",
      source.name
    );
    game.renderer?.log("Card not in hand.");
    return false;
  }

  // Check field space
  if (player.field.length >= 5) {
    game.renderer?.log("Field is full.");
    return false;
  }

  // Remove from hand
  const handIndex = player.hand.indexOf(source);
  if (handIndex !== -1) {
    player.hand.splice(handIndex, 1);
  }

  // Determine position
  let position = action.position || "attack";
  if (position === "choice") {
    position = await engine.chooseSpecialSummonPosition(source, player);
  }

  // Set card properties
  source.position = position;
  source.isFacedown = false;
  source.hasAttacked = false;
  source.cannotAttackThisTurn = action.cannotAttackThisTurn || false;
  source.owner = player.id;

  // Add to field
  player.field.push(source);

  game.renderer?.log(
    `${player.name || player.id} Special Summoned ${source.name} from hand.`
  );

  // Emit after_summon event
  game.emit("after_summon", {
    card: source,
    player: player,
    method: "special",
  });

  game.updateBoard();
  return true;
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
    game.renderer?.log("No valid monsters in hand to summon.");
    return false;
  }

  if (player.field.length >= 5) {
    game.renderer?.log("Field is full.");
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
  const searchModal = engine.getSearchModalElements();
  const defaultCardName = validTargets[0]?.name || "";

  if (searchModal) {
    return new Promise((resolve) => {
      game.isResolvingEffect = true;

      engine.showSearchModalVisual(
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
    const fieldIndex = player.field.indexOf(source);
    if (fieldIndex !== -1) {
      player.field.splice(fieldIndex, 1);
      player.hand.push(source);
    }
  }

  // Determine position
  let position = action.position || "choice";
  if (position === "choice") {
    position = await engine.chooseSpecialSummonPosition(target, player);
  }

  // Remove target from hand
  const handIndex = player.hand.indexOf(target);
  if (handIndex !== -1) {
    player.hand.splice(handIndex, 1);
  }

  // Set target properties
  target.position = position;
  target.isFacedown = false;
  target.hasAttacked = false;
  target.cannotAttackThisTurn = action.cannotAttackThisTurn || false;
  target.owner = player.id;

  // Add to field
  player.field.push(target);

  const bounceText =
    action.bounceSource !== false ? `Returned ${source.name} to hand and ` : "";
  const positionText = position === "defense" ? "Defense" : "Attack";

  game.renderer?.log(
    `${bounceText}Special Summoned ${target.name} in ${positionText} Position.`
  );

  // Emit after_summon event
  game.emit("after_summon", {
    card: target,
    player: player,
    method: "special",
  });

  game.updateBoard();
  return true;
}

/**
 * Generic handler for special summoning from graveyard
 * Replaces: applyVoidConjurerSelfRevive, applyVoidHollowKingRevive, etc.
 *
 * Action properties:
 * - requireSource: boolean (if true, uses ctx.source as the card to revive)
 * - filters: { archetype, name, cardKind }
 * - count: { min, max } (how many cards to summon)
 * - position: "attack" | "defense" | "choice"
 * - cannotAttackThisTurn: boolean
 * - banishCost: boolean (if true, banish source as cost)
 */
export async function handleSpecialSummonFromGraveyard(
  action,
  ctx,
  targets,
  engine
) {
  const { player, source, destroyed } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  // Determine which card(s) to revive
  const requireSource = action.requireSource || false;
  let candidateCards = [];

  if (requireSource) {
    // Revive the source card itself
    const card = source || destroyed;
    if (!card || !player.graveyard.includes(card)) {
      game.renderer?.log("Card not in graveyard.");
      return false;
    }
    candidateCards = [card];
  } else {
    // Find candidates based on filters
    const filters = action.filters || {};
    candidateCards = player.graveyard.filter((card) => {
      if (!card) return false;

      if (filters.cardKind && card.cardKind !== filters.cardKind) return false;

      if (filters.archetype) {
        const hasArchetype =
          card.archetype === filters.archetype ||
          (Array.isArray(card.archetypes) &&
            card.archetypes.includes(filters.archetype));
        if (!hasArchetype) return false;
      }

      if (filters.name && card.name !== filters.name) return false;

      return true;
    });
  }

  if (candidateCards.length === 0) {
    game.renderer?.log("No valid cards in graveyard to revive.");
    return false;
  }

  // Handle banish cost
  if (action.banishCost && source) {
    const gyIndex = player.graveyard.indexOf(source);
    if (gyIndex !== -1) {
      player.graveyard.splice(gyIndex, 1);
      // Card is banished (removed from game)
    }
  }

  // Determine how many to summon
  const count = action.count || { min: 1, max: 1 };
  const maxSelect = Math.min(
    count.max,
    candidateCards.length,
    5 - player.field.length
  );

  if (maxSelect === 0) {
    game.renderer?.log("Field is full, cannot Special Summon.");
    return false;
  }

  // For single card, no selection needed
  if (maxSelect === 1 || candidateCards.length === 1) {
    return await reviveCards([candidateCards[0]], player, action, engine);
  }

  // Bot: auto-select best cards (highest ATK)
  if (player.id === "bot") {
    const toSummon = candidateCards
      .sort((a, b) => (b.atk || 0) - (a.atk || 0))
      .slice(0, maxSelect);
    return await reviveCards(toSummon, player, action, engine);
  }

  // Player: show selection modal
  if (!game.renderer?.showMultiSelectModal) {
    // Fallback: auto-select best cards if no modal available
    const toSummon = candidateCards
      .sort((a, b) => (b.atk || 0) - (a.atk || 0))
      .slice(0, maxSelect);
    return await reviveCards(toSummon, player, action, engine);
  }

  // At this point, we know showMultiSelectModal exists
  return new Promise((resolve) => {
    game.renderer.showMultiSelectModal(
      candidateCards,
      { min: count.min || 0, max: maxSelect },
      async (selected) => {
        if (!selected || selected.length === 0) {
          game.renderer?.log("No cards selected.");
          resolve(false);
          return;
        }

        const result = await reviveCards(selected, player, action, engine);
        resolve(result);
      }
    );
  });
}

/**
 * Helper function to revive cards from graveyard
 */
async function reviveCards(cards, player, action, engine) {
  const game = engine.game;
  let summoned = 0;

  for (const card of cards) {
    if (player.field.length >= 5) break;

    // Remove from graveyard
    const idx = player.graveyard.indexOf(card);
    if (idx !== -1) {
      player.graveyard.splice(idx, 1);
    }

    // Determine position
    let position = action.position || "choice";
    if (position === "choice") {
      position = await engine.chooseSpecialSummonPosition(card, player);
    }

    // Set card properties
    card.position = position;
    card.isFacedown = false;
    card.hasAttacked = false;
    card.cannotAttackThisTurn = action.cannotAttackThisTurn || false;
    card.owner = player.id;

    // Add to field
    player.field.push(card);

    // Emit after_summon event
    game.emit("after_summon", {
      card: card,
      player: player,
      method: "special",
    });

    summoned++;
  }

  if (summoned > 0) {
    const cardText = summoned === 1 ? cards[0].name : `${summoned} cards`;
    game.renderer?.log(
      `${player.name || player.id} Special Summoned ${cardText} from Graveyard.`
    );
    game.updateBoard();
  }

  return summoned > 0;
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
  const resolved = targetRef ? targets?.[targetRef] : [];

  if (!Array.isArray(resolved) || resolved.length === 0) {
    game.renderer?.log("Nenhum alvo válido para banish.");
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
      tgt.ownerPlayer || (tgt.controller === "opponent" ? opponent : player);
    const ownerPlayer =
      typeof engine.getOwnerOfCard === "function"
        ? engine.getOwnerOfCard(tgt)
        : fallbackOwner;

    if (!ownerPlayer) {
      game.renderer?.log(`Não foi possível determinar o dono de ${tgt.name}.`);
      continue;
    }

    if (action.fromZone && !ownerPlayer[action.fromZone]?.includes(tgt)) {
      game.renderer?.log(
        `${tgt.name} não está mais em ${action.fromZone}; não pode ser banida.`
      );
      continue;
    }

    removeCardFromOwnerZones(ownerPlayer, tgt);

    ownerPlayer.banished = ownerPlayer.banished || [];
    ownerPlayer.banished.push(tgt);

    tgt.location = "banished";

    if (player) {
      tgt.controller = ownerPlayer === player ? "self" : "opponent";
    }

    banishedCount += 1;
    game.renderer?.log(`${tgt.name} foi banida.`);
  }

  if (banishedCount > 0) {
    game.updateBoard();
    return true;
  }

  return false;
}

/**
 * Generic handler for banishing the monster destroyed in battle
 * Useful for effects that need to remove whatever was just destroyed.
 */
export async function handleBanishDestroyedMonster(
  action,
  ctx,
  targets,
  engine
) {
  const { destroyed } = ctx || {};
  const game = engine.game;

  if (!destroyed) {
    game?.renderer?.log("Nenhum monstro destruído disponível para banir.");
    return false;
  }

  const targetRef = action.targetRef || "__destroyed_monster_to_banish";
  const mergedTargets = {
    ...(targets || {}),
    [targetRef]: [destroyed],
  };

  const tempAction = { ...action, targetRef };
  return await handleBanish(tempAction, ctx, mergedTargets, engine);
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
export async function handleSetStatsToZeroAndNegate(action, ctx, targets, engine) {
  const { player } = ctx;
  const game = engine.game;
  
  if (!player || !game) return false;
  
  const targetRef = action.targetRef;
  const targetCards = targets?.[targetRef] || [];
  
  if (!Array.isArray(targetCards) || targetCards.length === 0) {
    game.renderer?.log("No valid targets for stat modification.");
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
      const message = `${cardList}'s ${effects.join(" and ")} until end of turn.`;
      game.renderer?.log(message);
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
export async function handleGrantAdditionalNormalSummon(action, ctx, targets, engine) {
  const { player } = ctx;
  const game = engine.game;
  
  if (!player || !game) return false;
  
  const count = action.count || 1;
  player.additionalNormalSummons += count;
  
  const summonText = count === 1 ? "Normal Summon" : "Normal Summons";
  game.renderer?.log(
    `You can conduct ${count} additional ${summonText} this turn.`
  );
  
  game.updateBoard();
  return true;
}

/**
 * Initialize default handlers
 * @param {ActionHandlerRegistry} registry
 */
export function registerDefaultHandlers(registry) {
  // Generic special summon handlers
  registry.register("special_summon_from_deck", handleSpecialSummonFromZone);
  registry.register(
    "special_summon_from_hand_with_cost",
    handleSpecialSummonFromHandWithCost
  );
  registry.register("bounce_and_summon", handleBounceAndSummon);
  registry.register(
    "special_summon_from_graveyard",
    handleSpecialSummonFromGraveyard
  );
  registry.register("banish", handleBanish);
  registry.register("banish_destroyed_monster", handleBanishDestroyedMonster);
  
  // Stat modification and effect negation handlers
  registry.register("set_stats_to_zero_and_negate", handleSetStatsToZeroAndNegate);
  registry.register("grant_additional_normal_summon", handleGrantAdditionalNormalSummon);
}
