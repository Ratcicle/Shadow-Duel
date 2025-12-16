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

// Map technical status names to user-friendly descriptions
const STATUS_DISPLAY_NAMES = {
  tempBattleIndestructible: "battle indestructibility",
  battleDamageHealsControllerThisTurn: "battle damage healing",
  battleIndestructible: "permanent battle indestructibility",
  piercing: "piercing damage",
  canAttackDirectlyThisTurn: "direct attack ability",
  effectsNegated: "effect negation",
};

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

  // Determine source zone (default: deck)
  const sourceZone = action.zone || "deck";
  const zone = player[sourceZone];

  if (!zone || zone.length === 0) {
    game.renderer?.log(`No cards in ${sourceZone}.`);
    return false;
  }

  // Handle banish cost (before finding candidates)
  if (action.banishCost && source) {
    const gyIndex = zone.indexOf(source);
    if (gyIndex !== -1) {
      zone.splice(gyIndex, 1);
      player.banished = player.banished || [];
      player.banished.push(source);
      game.renderer?.log(`${source.name} was banished as cost.`);
    }
  }

  // Determine candidates
  let candidates = [];

  if (action.requireSource) {
    // Summon the source/destroyed card itself
    const card = source || destroyed;
    if (!card || !zone.includes(card)) {
      game.renderer?.log("Card not in specified zone.");
      return false;
    }
    candidates = [card];
  } else {
    // Apply filters to find candidates
    const filters = action.filters || {};
    const excludeSummonRestrict = action.excludeSummonRestrict || [];

    candidates = zone.filter((card) => {
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
      if (filters.excludeSelf && source && card.id === source.id) return false;

      // Exclude cards with specific summon restrictions
      if (excludeSummonRestrict.length > 0 && card.summonRestrict) {
        if (excludeSummonRestrict.includes(card.summonRestrict)) return false;
      }

      return true;
    });
  }

  if (candidates.length === 0) {
    game.renderer?.log(`No valid cards in ${sourceZone} matching filters.`);
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
    game.renderer?.log("Field is full, cannot Special Summon.");
    return false;
  }

  // Single card summon (original behavior)
  if (count.max === 1 || maxSelect === 1) {
    // Bot auto-selection (highest ATK)
    if (player.id === "bot") {
      const best = candidates.reduce((top, card) => {
        const cardAtk = card.atk || 0;
        const topAtk = top.atk || 0;
        return cardAtk >= topAtk ? card : top;
      }, candidates[0]);

      return await summonCards([best], zone, player, action, engine);
    }

    // Player selection
    const promptPlayer = action.promptPlayer !== false;

    if (!promptPlayer || candidates.length === 1) {
      // Auto-select if only one candidate or prompt disabled
      return await summonCards([candidates[0]], zone, player, action, engine);
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
            const result = await summonCards(
              [chosen],
              zone,
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

    // Fallback: auto-select
    return await summonCards([candidates[0]], zone, player, action, engine);
  }

  // Multi-card summon (graveyard revival pattern)
  // Bot: auto-select best cards (highest ATK)
  if (player.id === "bot") {
    const toSummon = candidates
      .sort((a, b) => (b.atk || 0) - (a.atk || 0))
      .slice(0, maxSelect);
    return await summonCards(toSummon, zone, player, action, engine);
  }

  // Player: show selection modal
  if (!game.renderer?.showMultiSelectModal) {
    // Fallback: auto-select best cards if no modal available
    const toSummon = candidates
      .sort((a, b) => (b.atk || 0) - (a.atk || 0))
      .slice(0, maxSelect);
    return await summonCards(toSummon, zone, player, action, engine);
  }

  // Show multi-select modal for player
  return new Promise((resolve) => {
    const minRequired = Number(count.min ?? 0);
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
    const dynamicMaxSelect =
      dynamicMax !== null
        ? Math.min(dynamicMax, dynamicCap, 5 - player.field.length)
        : maxSelect;

    game.renderer.showMultiSelectModal(
      candidates,
      { min: minRequired, max: dynamicMaxSelect },
      async (selected) => {
        if (!selected || selected.length === 0) {
          if (minRequired === 0) {
            game.renderer?.log("No cards selected (optional).");
            if (typeof game.updateBoard === "function") {
              game.updateBoard();
            }
            resolve(true);
          } else {
            game.renderer?.log("No cards selected.");
            resolve(false);
          }
          return;
        }

        const result = await summonCards(
          selected,
          zone,
          player,
          action,
          engine
        );
        resolve(result);
      }
    );
  });
}

/**
 * Helper function to summon one or more cards
 * Unified to handle both single and multi-card summons
 */
async function summonCards(cards, sourceZone, player, action, engine) {
  const game = engine.game;
  let summoned = 0;

  for (const card of cards) {
    if (!card || player.field.length >= 5) break;

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
    if (action.negateEffects) {
      card.effectsNegated = true;
    }

    // Add to field
    player.field.push(card);

    // Emit after_summon event
    game.emit("after_summon", {
      card: card,
      player: player,
      method: "special",
      sourceZone: action.zone || "deck",
    });

    summoned++;
  }

  if (summoned > 0) {
    // Log message
    const zoneName = action.zone || "deck";
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

    game.renderer?.log(
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
    sourceZone: "hand",
  });

  game.updateBoard();
  return true;
}

/**
 * Special Summon from hand with a tiered cost/bonus choice (1-3 Void Hollow style)
 * Self-contained: prompts tier, selects cost cards, pays cost, summons, applies tier effects.
 *
 * Action props:
 * - costFilters: { name?, archetype?, cardKind? } (default: name === "Void Hollow", cardKind: "monster")
 * - minCost: default 1
 * - maxCost: default 3
 * - position: "attack" | "defense" | "choice" (default: "attack")
 * - tierOptions: [{ count, label, description }]
 * - tier1AtkBoost: number (default 300)
 */
export async function handleSpecialSummonFromHandWithTieredCost(
  action,
  ctx,
  targets,
  engine
) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !source || !game) return false;
  if (!player.hand?.includes(source)) {
    game.renderer?.log("Card must be in hand to activate this effect.");
    return false;
  }
  if (player.field.length >= 5) {
    game.renderer?.log("Field is full.");
    return false;
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
    game.renderer?.log("Not enough cost monsters to Special Summon.");
    return false;
  }

  const defaultTierOptions = [
    { count: 1, label: "Tier 1", description: "+300 ATK até o final do turno" },
    {
      count: 2,
      label: "Tier 2",
      description: "+300 ATK e não pode ser destruída em batalha",
    },
    {
      count: 3,
      label: "Tier 3",
      description:
        "+300 ATK, indestrutível em batalha e destrói 1 carta do oponente",
    },
  ];

  const tierOptions = (action.tierOptions || defaultTierOptions).filter(
    (opt) => opt.count >= minCost && opt.count <= allowedMax
  );

  let chosenCount = null;

  if (player.id === "bot") {
    chosenCount = allowedMax;
  } else if (game.renderer?.showTierChoiceModal) {
    chosenCount = await game.renderer.showTierChoiceModal({
      title: action.tierTitle || source.name,
      options: tierOptions,
    });
  } else {
    // Fallback simple prompt
    const ask = window.prompt(
      `Choose how many Void Hollow to send (1-${allowedMax}):`,
      String(allowedMax)
    );
    const parsed = Number.parseInt(ask, 10);
    if (!Number.isNaN(parsed) && parsed >= minCost && parsed <= allowedMax) {
      chosenCount = parsed;
    }
  }

  if (!chosenCount) {
    return false;
  }

  // Select exact cost cards
  let chosenCosts = [];
  if (player.id === "bot") {
    chosenCosts = costCandidates
      .slice()
      .sort((a, b) => (a.atk || 0) - (b.atk || 0))
      .slice(0, chosenCount);
  } else {
    const optionId = "tier_cost";
    const selection = await new Promise((resolve) => {
      const decorated = costCandidates.map((card, idx) => {
        const fieldIndex = player.field.indexOf(card);
        return {
          idx,
          name: card.name,
          owner: player.id,
          controller: player.id,
          zone: "field",
          zoneIndex: fieldIndex !== -1 ? fieldIndex : idx,
          position: card.position,
          atk: card.atk,
          def: card.def,
          cardRef: card,
        };
      });
      game.renderer?.showTargetSelection(
        [
          {
            id: optionId,
            min: chosenCount,
            max: chosenCount,
            candidates: decorated,
          },
        ],
        (map) => resolve(map?.[optionId] ?? null),
        () => resolve(null)
      );
    });

    if (!selection) {
      return false;
    }

    chosenCosts = selection
      .map((idx) => costCandidates[idx])
      .filter(Boolean)
      .slice(0, chosenCount);
  }

  if (chosenCosts.length !== chosenCount) {
    return false;
  }

  // Pay cost
  for (const costCard of chosenCosts) {
    game.moveCard(costCard, player, "graveyard", { fromZone: "field" });
  }

  // Summon from hand
  const handIndex = player.hand.indexOf(source);
  if (handIndex !== -1) {
    player.hand.splice(handIndex, 1);
  }

  let position = action.position || "attack";
  if (position === "choice") {
    position = await engine.chooseSpecialSummonPosition(source, player);
  }

  source.position = position;
  source.isFacedown = false;
  source.hasAttacked = false;
  source.cannotAttackThisTurn = !!action.cannotAttackThisTurn;
  source.owner = player.id;
  player.field.push(source);

  game.renderer?.log(
    `${player.name || player.id} enviou ${chosenCount} custo(s) para invocar ${
      source.name
    }.`
  );

  game.emit("after_summon", {
    card: source,
    player,
    method: "special",
    sourceZone: "hand",
  });

  // Tier effects
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
      ...opponent.field,
      ...opponent.spellTrap,
      opponent.fieldSpell,
    ].filter(Boolean);

    if (opponentCards.length > 0) {
      let targetToDestroy = null;
      if (player.id === "bot") {
        targetToDestroy = opponentCards
          .slice()
          .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
      } else {
        const optionId = "tier_destroy";
        const decorated = opponentCards.map((card, idx) => {
          const inField = opponent.field.indexOf(card);
          const inSpell = opponent.spellTrap.indexOf(card);
          const inFieldSpell = opponent.fieldSpell === card ? 0 : -1;
          const zoneIndex =
            inField !== -1 ? inField : inSpell !== -1 ? inSpell : inFieldSpell;
          const zone =
            inField !== -1
              ? "field"
              : inSpell !== -1
              ? "spellTrap"
              : "fieldSpell";
          return {
            idx,
            name: card.name,
            owner: opponent.id,
            controller: opponent.id,
            zone,
            zoneIndex,
            position: card.position,
            atk: card.atk,
            def: card.def,
            cardRef: card,
          };
        });

        const selection = await new Promise((resolve) => {
          game.renderer?.showTargetSelection(
            [
              {
                id: optionId,
                min: 1,
                max: 1,
                candidates: decorated,
              },
            ],
            (map) => resolve(map?.[optionId]?.[0] ?? null),
            () => resolve(null)
          );
        });

        if (selection !== null && selection !== undefined) {
          targetToDestroy = decorated[selection]?.cardRef || null;
        }
      }

      if (targetToDestroy) {
        const zoneName = opponent.field.includes(targetToDestroy)
          ? "field"
          : opponent.spellTrap.includes(targetToDestroy)
          ? "spellTrap"
          : "fieldSpell";
        game.moveCard(targetToDestroy, opponent, "graveyard", {
          fromZone: zoneName,
        });
        game.renderer?.log(`${source.name} destruiu ${targetToDestroy.name}.`);
      }
    }
  }

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
    sourceZone: action.bounceSource
      ? player.field.includes(action.bounceSource)
        ? "field"
        : "hand"
      : "hand",
  });

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
export async function handleSetStatsToZeroAndNegate(
  action,
  ctx,
  targets,
  engine
) {
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
      const message = `${cardList}'s ${effects.join(
        " and "
      )} until end of turn.`;
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
  game.renderer?.log(
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
export async function handleSelectiveFieldDestruction(
  action,
  ctx,
  targets,
  engine
) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const opponent = game.getOpponent(player);
  if (!opponent) return false;

  const keepPerSide = action.keepPerSide || 1;
  const allowTieBreak = action.allowTieBreak !== false;

  // Get all monsters on both sides
  const playerMonsters = (player.field || []).filter(
    (card) => card && card.cardKind === "monster" && !card.isFacedown
  );
  const opponentMonsters = (opponent.field || []).filter(
    (card) => card && card.cardKind === "monster" && !card.isFacedown
  );

  if (playerMonsters.length === 0 && opponentMonsters.length === 0) {
    game.renderer?.log("No monsters on the field to destroy.");
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

  // Handle player's side
  if (playerHighest.length <= keepPerSide) {
    // No tie or tie doesn't exceed keepPerSide
    playerToKeep = playerHighest;
  } else if (allowTieBreak) {
    // Tie exists and player needs to choose
    if (player.id === "bot") {
      // Bot auto-selects (first N in array)
      playerToKeep = playerHighest.slice(0, keepPerSide);
    } else {
      // Ask human player to choose
      playerToKeep = await promptTieBreaker(
        game,
        playerHighest,
        keepPerSide,
        "your",
        modalConfig
      );
    }
  } else {
    // No tie-break allowed, keep all tied
    playerToKeep = playerHighest;
  }

  // Handle opponent's side
  if (opponentHighest.length <= keepPerSide) {
    opponentToKeep = opponentHighest;
  } else if (allowTieBreak) {
    if (player.id === "bot") {
      // Bot chooses for opponent side (first N in array)
      opponentToKeep = opponentHighest.slice(0, keepPerSide);
    } else {
      // Human player chooses which opponent monster to keep
      opponentToKeep = await promptTieBreaker(
        game,
        opponentHighest,
        keepPerSide,
        "opponent's",
        modalConfig
      );
    }
  } else {
    opponentToKeep = opponentHighest;
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
    game.renderer?.log("No monsters were destroyed.");
    return false;
  }

  // Destroy all marked monsters
  game.renderer?.log(
    `Destroying ${toDestroy.length} monster(s) on the field...`
  );

  for (const { card, owner } of toDestroy) {
    // Use game's destruction system to handle replacement effects
    const { replaced } =
      (await game.resolveDestructionWithReplacement?.(card, {
        reason: "effect",
        sourceCard: source,
      })) || {};

    if (!replaced) {
      game.moveCard(card, owner, "graveyard", { fromZone: "field" });
    }
  }

  // Log which monsters survived
  const survivorNames = [
    ...playerToKeep.map((m) => m.name),
    ...opponentToKeep.map((m) => m.name),
  ];

  if (survivorNames.length > 0) {
    game.renderer?.log(
      `${survivorNames.join(", ")} survived with highest ATK.`
    );
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
export async function handleSpecialSummonMatchingLevel(
  action,
  ctx,
  targets,
  engine
) {
  const { player, summonedCard } = ctx;
  const game = engine.game;

  if (!player || !game || !summonedCard) return false;

  // Get the level to match from the summoned card
  const targetLevel = summonedCard.level;
  if (!targetLevel) {
    game.renderer?.log("Cannot match level: no level on summoned card.");
    return false;
  }

  // Check field space
  if (player.field.length >= 5) {
    game.renderer?.log("Field is full.");
    return false;
  }

  // Find candidates in hand with matching level
  const hand = player.hand || [];
  const candidates = hand.filter(
    (card) => card && card.cardKind === "monster" && card.level === targetLevel
  );

  if (candidates.length === 0) {
    game.renderer?.log(
      `No monsters in hand with Level ${targetLevel} to Special Summon.`
    );
    return false;
  }

  // Extract common configuration
  const negateEffects = action.negateEffects !== false;
  const cannotAttackThisTurn = action.cannotAttackThisTurn || false;

  /**
   * Helper function to finalize the special summon
   * @param {Object} card - The card to summon
   * @param {string} position - The position to summon in ("attack" or "defense")
   */
  const finalizeSummon = (card, position) => {
    // Remove from hand
    const handIndex = hand.indexOf(card);
    if (handIndex !== -1) {
      hand.splice(handIndex, 1);
    }

    // Special Summon
    card.position = position;
    card.isFacedown = false;
    card.hasAttacked = false;
    card.cannotAttackThisTurn = cannotAttackThisTurn;
    card.owner = player.id;

    // Negate effects if specified
    if (negateEffects) {
      card.effectsNegated = true;
    }

    player.field.push(card);

    game.renderer?.log(
      `${player.name || "Player"} Special Summoned ${
        card.name
      } (Level ${targetLevel}) from hand${
        negateEffects ? " (effects negated)" : ""
      }.`
    );

    // Emit after_summon event
    game.emit("after_summon", {
      card,
      player,
      method: "special",
      sourceZone: "hand",
    });

    game.updateBoard();
  };

  // For bot, auto-select first candidate
  if (player.id === "bot") {
    const card = candidates[0];
    const position = action.position === "defense" ? "defense" : "attack";
    finalizeSummon(card, position);
    return true;
  }

  // For human player, show selection modal
  return new Promise((resolve) => {
    // If only one candidate, auto-select it
    if (candidates.length === 1) {
      const card = candidates[0];

      // Ask for position
      engine
        .chooseSpecialSummonPosition(card, player)
        .then((position) => {
          finalizeSummon(card, position);
          resolve(true);
        })
        .catch((error) => {
          console.error("Error choosing summon position:", error);
          resolve(false);
        });
    } else {
      // Multiple candidates - show selection modal
      game.showCardSelectionModal(
        candidates,
        `Select 1 monster with Level ${targetLevel} to Special Summon`,
        1,
        async (selected) => {
          if (selected.length === 0) {
            resolve(false);
            return;
          }

          const card = selected[0];

          try {
            // Ask for position
            const position = await engine.chooseSpecialSummonPosition(
              card,
              player
            );

            finalizeSummon(card, position);
            resolve(true);
          } catch (error) {
            console.error("Error choosing summon position:", error);
            resolve(false);
          }
        }
      );
    }
  });
}

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
  if (!game.renderer?.showCardGridSelectionModal) {
    // Fallback: auto-select first N
    return candidates.slice(0, keepCount);
  }

  return new Promise((resolve) => {
    const maxAtk = candidates[0]?.atk || 0;

    // Use custom subtitle or generate default one
    const subtitle =
      modalConfig.subtitle ||
      `Multiple monsters on ${sideDescription} side have ${maxAtk} ATK. Choose ${keepCount} to keep on the field.`;

    game.renderer.showCardGridSelectionModal({
      title: modalConfig.title || "Choose Survivor",
      subtitle: subtitle,
      cards: candidates,
      minSelect: keepCount,
      maxSelect: keepCount,
      confirmLabel: "Confirm",
      cancelLabel: "Cancel",
      overlayClass: "tie-breaker-overlay",
      modalClass: "tie-breaker-modal",
      gridClass: "tie-breaker-grid",
      cardClass: "tie-breaker-card",
      infoText: modalConfig.infoText || "All other monsters will be destroyed.",
      onConfirm: (selected) => {
        resolve(selected || candidates.slice(0, keepCount));
      },
      onCancel: () => {
        // Auto-select on cancel
        resolve(candidates.slice(0, keepCount));
      },
      renderCard: (card) => {
        const cardEl = document.createElement("div");
        cardEl.classList.add("tie-breaker-card-item");

        const imageDiv = document.createElement("div");
        imageDiv.classList.add("tie-breaker-card-image");
        imageDiv.style.backgroundImage = `url('${card.image}')`;
        cardEl.appendChild(imageDiv);

        const infoDiv = document.createElement("div");
        infoDiv.classList.add("tie-breaker-card-info");

        const nameDiv = document.createElement("div");
        nameDiv.classList.add("tie-breaker-card-name");
        nameDiv.textContent = card.name;
        infoDiv.appendChild(nameDiv);

        const statsDiv = document.createElement("div");
        statsDiv.classList.add("tie-breaker-card-stats");
        statsDiv.innerHTML = `<span>ATK ${card.atk || 0}</span>`;
        infoDiv.appendChild(statsDiv);

        cardEl.appendChild(infoDiv);
        return cardEl;
      },
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

  const targetRef = action.targetRef || "self";
  let targetCards = [];

  if (targetRef === "self") {
    targetCards = [ctx.source];
  } else if (targets[targetRef]) {
    targetCards = Array.isArray(targets[targetRef])
      ? targets[targetRef]
      : [targets[targetRef]];
  }

  if (targetCards.length === 0) {
    game.renderer?.log("No valid targets for stat buff.");
    return false;
  }

  const atkBoost = action.atkBoost || 0;
  const defBoost = action.defBoost || 0;
  const permanent = action.permanent || false;

  let anyBuffed = false;
  const affectedCards = [];

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
      affectedCards.push(card.name);
    }
  }

  if (anyBuffed && affectedCards.length > 0) {
    const boosts = [];
    if (atkBoost !== 0)
      boosts.push(`${atkBoost > 0 ? "+" : ""}${atkBoost} ATK`);
    if (defBoost !== 0)
      boosts.push(`${defBoost > 0 ? "+" : ""}${defBoost} DEF`);

    const cardList = affectedCards.join(", ");
    const duration = permanent ? "" : " until end of turn";
    game.renderer?.log(
      `${cardList} gained ${boosts.join(" and ")}${duration}.`
    );
    game.updateBoard();
  }

  return anyBuffed;
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

  const targetRef = action.targetRef || "self";
  let targetCards = [];

  if (targetRef === "self") {
    targetCards = [ctx.source];
  } else if (targets[targetRef]) {
    targetCards = Array.isArray(targets[targetRef])
      ? targets[targetRef]
      : [targets[targetRef]];
  }

  if (targetCards.length === 0) {
    game.renderer?.log("No valid targets for status change.");
    return false;
  }

  const status = action.status;
  const value = action.value !== undefined ? action.value : true;
  const remove = action.remove || false;

  if (!status) {
    console.warn("No status specified in add_status action");
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
    game.renderer?.log(`${cardList} ${statusText}.`);
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
    game.renderer?.log("Not enough LP to pay cost.");
    return false;
  }

  player.lp -= amount;
  game.renderer?.log(`${player.name || player.id} paid ${amount} LP.`);
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

  const sourceZone = action.zone || "graveyard";
  const zone = player[sourceZone];

  if (!zone || zone.length === 0) {
    game.renderer?.log(`No cards in ${sourceZone}.`);
    return false;
  }

  // Apply filters
  const filters = action.filters || {};
  const candidates = zone.filter((card) => {
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

    if (filters.level !== undefined) {
      const cardLevel = card.level || 0;
      const op = filters.levelOp || "eq";

      if (op === "eq" && cardLevel !== filters.level) return false;
      if (op === "lte" && cardLevel > filters.level) return false;
      if (op === "gte" && cardLevel < filters.level) return false;
    }

    if (filters.excludeSelf && source && card.id === source.id) return false;

    return true;
  });

  if (candidates.length === 0) {
    game.renderer?.log(`No valid cards in ${sourceZone} matching filters.`);
    return false;
  }

  const count = action.count || { min: 1, max: 1 };
  const maxSelect = Math.min(count.max, candidates.length);
  const minSelect = Math.max(count.min || 0, 0);

  if (maxSelect === 0) {
    game.renderer?.log("No cards available to add.");
    return false;
  }

  // Bot auto-selection (highest ATK for monsters, first N for others)
  if (player.id === "bot") {
    const toAdd =
      candidates[0]?.cardKind === "monster"
        ? candidates
            .sort((a, b) => (b.atk || 0) - (a.atk || 0))
            .slice(0, maxSelect)
        : candidates.slice(0, maxSelect);

    for (const card of toAdd) {
      const idx = zone.indexOf(card);
      if (idx !== -1) {
        zone.splice(idx, 1);
        player.hand.push(card);
      }
    }

    game.renderer?.log(
      `${player.name || player.id} added ${
        toAdd.length
      } card(s) to hand from ${sourceZone}.`
    );
    game.updateBoard();
    return true;
  }

  // Single card selection
  if (maxSelect === 1) {
    const promptPlayer = action.promptPlayer !== false;

    if (!promptPlayer || candidates.length === 1) {
      const card = candidates[0];
      const idx = zone.indexOf(card);
      if (idx !== -1) {
        zone.splice(idx, 1);
        player.hand.push(card);
      }
      game.renderer?.log(`Added ${card.name} to hand from ${sourceZone}.`);
      game.updateBoard();
      return true;
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
          (selectedName) => {
            const chosen =
              candidates.find((c) => c && c.name === selectedName) ||
              candidates[0];

            const idx = zone.indexOf(chosen);
            if (idx !== -1) {
              zone.splice(idx, 1);
              player.hand.push(chosen);
            }

            game.renderer?.log(
              `Added ${chosen.name} to hand from ${sourceZone}.`
            );
            game.isResolvingEffect = false;
            game.updateBoard();
            resolve(true);
          }
        );
      });
    }

    // Fallback
    const card = candidates[0];
    const idx = zone.indexOf(card);
    if (idx !== -1) {
      zone.splice(idx, 1);
      player.hand.push(card);
    }
    game.renderer?.log(`Added ${card.name} to hand from ${sourceZone}.`);
    game.updateBoard();
    return true;
  }

  // Multi-card selection
  if (!game.renderer?.showMultiSelectModal) {
    // Fallback: auto-select
    const toAdd = candidates.slice(0, maxSelect);
    for (const card of toAdd) {
      const idx = zone.indexOf(card);
      if (idx !== -1) {
        zone.splice(idx, 1);
        player.hand.push(card);
      }
    }
    game.renderer?.log(
      `Added ${toAdd.length} card(s) to hand from ${sourceZone}.`
    );
    game.updateBoard();
    return true;
  }

  // Show multi-select modal
  return new Promise((resolve) => {
    game.renderer.showMultiSelectModal(
      candidates,
      { min: minSelect, max: maxSelect },
      (selected) => {
        if (!selected || selected.length === 0) {
          if (minSelect === 0) {
            game.renderer?.log("No cards selected (optional).");
            game.updateBoard();
            resolve(true);
          } else {
            game.renderer?.log("No cards selected.");
            resolve(false);
          }
          return;
        }

        for (const card of selected) {
          const idx = zone.indexOf(card);
          if (idx !== -1) {
            zone.splice(idx, 1);
            player.hand.push(card);
          }
        }

        game.renderer?.log(
          `Added ${selected.length} card(s) to hand from ${sourceZone}.`
        );
        game.updateBoard();
        resolve(true);
      }
    );
  });
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
  game.renderer?.log(
    `${player.name || player.id} gained ${healAmount} LP from ${
      destroyed.name
    }'s ATK.`
  );
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

  const targetRef = action.targetRef;
  const targetCards = targets?.[targetRef] || [];

  if (!Array.isArray(targetCards) || targetCards.length === 0) {
    game.renderer?.log("No valid targets for position switch.");
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
      game.renderer?.log(
        `${info.name} switched to ${info.position.toUpperCase()} Position.`
      );
    }
    game.updateBoard();
  }

  return switched;
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
  } else if (targetRef === "self") {
    targetCards = [source];
  } else if (targets[targetRef]) {
    targetCards = Array.isArray(targets[targetRef])
      ? targets[targetRef]
      : [targets[targetRef]];
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

      // Apply to actual stat (calculate delta and apply)
      const delta = newBuff - currentBuff;
      card.atk = (card.atk || 0) + delta;
      cardBuffed = true;
    }

    if (defBoost !== 0) {
      const currentBuff = card.permanentBuffsBySource[sourceName]?.def || 0;
      const newBuff = cumulative ? currentBuff + defBoost : defBoost;

      if (!card.permanentBuffsBySource[sourceName]) {
        card.permanentBuffsBySource[sourceName] = {};
      }
      card.permanentBuffsBySource[sourceName].def = newBuff;

      // Apply to actual stat (calculate delta and apply)
      const delta = newBuff - currentBuff;
      card.def = (card.def || 0) + delta;
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

    game.renderer?.log(`${source.name} applied ${boosts.join(" and ")} buff.`);
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
  } else if (targetRef === "self") {
    targetCards = [source];
  } else if (targets[targetRef]) {
    targetCards = Array.isArray(targets[targetRef])
      ? targets[targetRef]
      : [targets[targetRef]];
  }

  if (targetCards.length === 0) return false;

  const sourceName = action.sourceName || source.name;
  let anyRemoved = false;

  for (const card of targetCards) {
    if (!card || !card.permanentBuffsBySource) continue;

    const buffData = card.permanentBuffsBySource[sourceName];
    if (!buffData) continue;

    // Remove buffs from stats
    if (buffData.atk) {
      card.atk = (card.atk || 0) - buffData.atk;
    }
    if (buffData.def) {
      card.def = (card.def || 0) - buffData.def;
    }

    // Remove buff tracking
    delete card.permanentBuffsBySource[sourceName];
    anyRemoved = true;
  }

  if (anyRemoved) {
    game.renderer?.log(`${sourceName} buffs removed.`);
    game.updateBoard();
  }

  return anyRemoved;
}

/**
 * Generic handler for granting a second attack this turn
 *
 * Action properties:
 * - targetRef: reference to the target card (default: "self")
 */
export async function handleGrantSecondAttack(action, ctx, targets, engine) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const targetRef = action.targetRef || "self";
  let targetCards = [];

  if (targetRef === "self") {
    targetCards = [source];
  } else if (targets[targetRef]) {
    targetCards = Array.isArray(targets[targetRef])
      ? targets[targetRef]
      : [targets[targetRef]];
  }

  if (targetCards.length === 0) return false;

  let anyGranted = false;

  for (const card of targetCards) {
    if (!card || card.cardKind !== "monster") continue;
    if (!player.field.includes(card) || card.isFacedown) continue;

    card.canMakeSecondAttackThisTurn = true;
    card.secondAttackUsedThisTurn = false;
    anyGranted = true;
  }

  if (anyGranted) {
    const cardList = targetCards.map((c) => c.name).join(", ");
    game.renderer?.log(`${cardList} can attack again this turn.`);
    game.updateBoard();
  }

  return anyGranted;
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
  const { player } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  // Get the card(s) to potentially summon
  const targetRef = action.targetRef;
  const targetCards = targets?.[targetRef];

  if (!targetCards || targetCards.length === 0) return false;

  const card = Array.isArray(targetCards) ? targetCards[0] : targetCards;

  // Find card in hand (might be different reference if moved by previous action)
  // The targets object contains the original reference, but after a move action,
  // the card object may have been moved to hand with the same reference or a clone
  const handCard = player.hand.find((c) => c === card || c.name === card.name);

  if (!handCard) {
    console.log(
      `Card "${card.name}" not found in hand for conditional summon.`
    );
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
  } else {
    // Default to true if no condition specified
    conditionMet = true;
  }

  if (!conditionMet) {
    const conditionDesc =
      condition.type === "control_card"
        ? `controlling "${condition.cardName}"`
        : "unknown condition";
    console.log(`Condition not met for conditional summon: ${conditionDesc}`);
    return false;
  }

  // Check field space
  if (player.field.length >= 5) {
    game.renderer?.log("Field is full, cannot Special Summon.");
    return false;
  }

  // Get the index of the card in hand
  const handIndex = player.hand.indexOf(handCard);

  if (handIndex === -1) {
    console.warn(
      `Card "${handCard.name}" not found in hand during conditional summon execution.`
    );
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

    const wantsToSummon = window.confirm(
      `${conditionText} Do you want to Special Summon "${handCard.name}" from your hand?`
    );

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

  // Determine position
  let position = action.position || "choice";
  if (position === "choice") {
    position = await game.chooseSpecialSummonPosition(card, player);
  }

  // Remove from hand and add to field
  player.hand.splice(handIndex, 1);

  card.position = position;
  card.isFacedown = false;
  card.hasAttacked = false;
  card.cannotAttackThisTurn = action.cannotAttackThisTurn || false;
  card.owner = player.id;

  player.field.push(card);

  game.renderer?.log(
    `${player.name || player.id} Special Summoned ${card.name} from hand.`
  );

  // Emit after_summon event
  game.emit("after_summon", {
    card: card,
    player: player,
    method: "special",
    sourceZone: "hand",
  });

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

  // Move attacker to graveyard
  const attackerZone = engine.findCardZone(attackerOwner, attacker);
  if (!attackerZone) return false;

  const idx = attackerZone.indexOf(attacker);
  if (idx === -1) return false;

  attackerZone.splice(idx, 1);

  if (!attackerOwner.graveyard) {
    attackerOwner.graveyard = [];
  }
  attackerOwner.graveyard.push(attacker);

  game.renderer?.log(
    `${attacker.name} was sent to the Graveyard as punishment!`
  );

  game.emit("card_to_grave", {
    card: attacker,
    fromZone: attackerZone,
    player: attackerOwner,
  });

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
    const sourceZone = engine.findCardZone(player, source);
    if (sourceZone) {
      const idx = sourceZone.indexOf(source);
      if (idx !== -1) {
        sourceZone.splice(idx, 1);
        if (failureZone === "graveyard") {
          player.graveyard = player.graveyard || [];
          player.graveyard.push(source);
        } else if (failureZone === "banished") {
          player.banished = player.banished || [];
          player.banished.push(source);
        }

        game.renderer?.log(
          `${player.name} cannot pay ${lpCost} LP upkeep for ${source.name}. Sent to ${failureZone}.`
        );

        game.emit("card_to_grave", {
          card: source,
          fromZone: sourceZone,
          player: player,
        });
      }
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
    const wantsToPay = window.confirm(
      `Pay ${lpCost} LP to keep "${source.name}" on the field? If you decline, it will be sent to the ${failureZone}.`
    );
    shouldPay = wantsToPay;
  }

  if (shouldPay) {
    player.takeDamage(lpCost);
    game.renderer?.log(
      `${player.name} paid ${lpCost} LP to keep ${source.name} on field.`
    );
    game.updateBoard();
    game.checkWinCondition?.();
    return true;
  }

  // Send to graveyard
  const sourceZone = engine.findCardZone(player, source);
  if (sourceZone) {
    const idx = sourceZone.indexOf(source);
    if (idx !== -1) {
      sourceZone.splice(idx, 1);
      if (failureZone === "graveyard") {
        player.graveyard = player.graveyard || [];
        player.graveyard.push(source);
      } else if (failureZone === "banished") {
        player.banished = player.banished || [];
        player.banished.push(source);
      }

      game.renderer?.log(
        `${player.name} chose not to pay upkeep. ${source.name} sent to ${failureZone}.`
      );

      game.emit("card_to_grave", {
        card: source,
        fromZone: sourceZone,
        player: player,
      });
    }
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
  const position = action.position || "attack";

  // Calculate max ATK based on counters
  const counterCount = source[counterType] || 0;
  const maxAtk = counterCount * counterMultiplier;

  if (maxAtk === 0) {
    game.renderer?.log(
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
    game.renderer?.log(`No monsters in deck with ATK <= ${maxAtk} to summon.`);
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
      subtitle: `Monsters with ATK ≤ ${maxAtk}`,
      infoText: `You have ${counterCount} ${counterType} counters. After summoning, this card will be sent to the Graveyard.`,
    };

    game.renderer?.showCardSelectionModal(
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

  // Remove from deck
  const idx = deck.indexOf(card);
  if (idx !== -1) {
    deck.splice(idx, 1);
  }

  // Check field space
  if (player.field.length >= 5) {
    // Return to deck
    deck.push(card);
    game.renderer?.log("Field is full. Cannot summon.");
    return false;
  }

  // Determine position
  let summonPosition = action.position || "attack";
  if (summonPosition === "choice") {
    summonPosition = await engine.chooseSpecialSummonPosition(card, player);
  }

  // Summon card
  card.position = summonPosition;
  card.isFacedown = false;
  card.hasAttacked = false;
  card.attacksUsedThisTurn = 0;
  card.cannotAttackThisTurn = action.cannotAttackThisTurn || false;
  card.owner = player.id;

  player.field.push(card);

  game.renderer?.log(
    `${player.name} Special Summoned ${card.name} from deck in ${
      summonPosition === "defense" ? "Defense" : "Attack"
    } Position.`
  );

  game.emit("after_summon", {
    card: card,
    player: player,
    method: "special",
    sourceZone: "deck",
  });

  // Send source to graveyard if specified
  if (action.sendSourceToGraveAfter && source) {
    const sourceZone = engine.findCardZone(player, source);
    if (sourceZone) {
      const sourceIdx = sourceZone.indexOf(source);
      if (sourceIdx !== -1) {
        sourceZone.splice(sourceIdx, 1);
        player.graveyard = player.graveyard || [];
        player.graveyard.push(source);

        game.emit("card_to_grave", {
          card: source,
          fromZone: sourceZone,
          player: player,
        });

        game.renderer?.log(`${source.name} was sent to the Graveyard.`);
      }
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

  if (!opponent || !source) return false;

  // Get opponent's cards on field/spellTrap/fieldSpell
  const opponentCards = [
    ...(opponent.field || []),
    ...(opponent.spellTrap || []),
  ];

  if (opponent.fieldSpell) {
    opponentCards.push(opponent.fieldSpell);
  }

  if (opponentCards.length === 0) {
    game.renderer?.log("Opponent has no cards to destroy.");
    return false;
  }

  // action.maxTargets: how many cards to target (default 1)
  const maxTargets = Math.min(action.maxTargets || 1, opponentCards.length);

  game.renderer?.log(
    `${source.name}: Select up to ${maxTargets} opponent cards to destroy.`
  );

  // Build candidates list for showTargetSelection
  const candidates = opponentCards.map((card, index) => ({
    idx: index,
    name: card.name,
    owner: opponent.id === "player" ? "Player" : "Opponent",
    position: card.position || "",
    atk: card.atk || 0,
    def: card.def || 0,
    cardRef: card,
  }));

  return new Promise((resolve) => {
    game.renderer?.showTargetSelection(
      [
        {
          id: "destroy_targets",
          zone: "opponent_field",
          min: maxTargets,
          max: maxTargets,
          candidates: candidates,
        },
      ],
      (selections) => {
        const selectedIndices = selections["destroy_targets"] || [];
        const targetCards = selectedIndices.map((idx) => opponentCards[idx]);

        if (targetCards.length === 0) {
          game.renderer?.log("No cards selected.");
          resolve(false);
          return;
        }

        // Destroy each target
        targetCards.forEach((card) => {
          game.renderer?.log(`${source.name} destroyed ${card.name}!`);
          game.moveCard(card, opponent, "graveyard");
        });

        game.updateBoard();
        resolve(true);
      },
      () => {
        game.renderer?.log("Target selection cancelled.");
        resolve(false);
      }
    );
  });
}

/**
 * Temporarily buff a card's stats and grant it a second attack this Battle Phase
 * Used by: Shadow-Heart Rage
 * Properties:
 * - targetRef: "self" or other reference (default: "self")
 * - atkBoost: ATK increase
 * - defBoost: DEF increase
 */
export async function handleBuffStatsTempWithSecondAttack(
  action,
  ctx,
  targets,
  engine
) {
  const { source } = ctx;
  const game = engine.game;

  if (!source) return false;

  // Get target card
  let targetCard = source;
  if (action.targetRef === "self" || action.targetRef === "summonedCard") {
    targetCard = source;
  }

  if (!targetCard) return false;

  const atkBoost = action.atkBoost || 0;
  const defBoost = action.defBoost || 0;

  // Apply temporary stat boosts
  if (atkBoost > 0) {
    targetCard.atk += atkBoost;
    targetCard.tempAtkBoost = (targetCard.tempAtkBoost || 0) + atkBoost;
  }

  if (defBoost > 0) {
    targetCard.def += defBoost;
    targetCard.tempDefBoost = (targetCard.tempDefBoost || 0) + defBoost;
  }

  // Grant second attack this Battle Phase
  targetCard.canMakeSecondAttack = true;

  game.renderer?.log(
    `${targetCard.name} gains ${atkBoost} ATK / ${defBoost} DEF and can make a second attack!`
  );

  game.updateBoard();
  return true;
}

/**
 * Special Summon a specific card from hand based on a condition
 * Used by: Shadow-Heart Death Wyrm (special summon from hand when Shadow-Heart destroyed)
 * Properties:
 * - cardName: The exact name of the card to summon from hand
 * - position: "attack" or "defense" (default "attack")
 * - cannotAttackThisTurn: Whether summoned card cannot attack (default false)
 */
export async function handleConditionalSpecialSummonFromHand(
  action,
  ctx,
  targets,
  engine
) {
  const { player } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const cardName = action.cardName;
  const position = action.position || "attack";
  const cannotAttackThisTurn = action.cannotAttackThisTurn || false;

  // Find the card in hand
  const hand = player.hand || [];
  const cardToSummon = hand.find((c) => c && c.name === cardName);

  if (!cardToSummon) {
    game.renderer?.log(`No "${cardName}" in hand to Special Summon.`);
    return false;
  }

  // Check field space
  if ((player.field || []).length >= 5) {
    game.renderer?.log("Your field is full!");
    return false;
  }

  // Remove from hand
  const handIndex = hand.indexOf(cardToSummon);
  if (handIndex !== -1) {
    hand.splice(handIndex, 1);
  }

  // Special Summon to field
  cardToSummon.position = position;
  cardToSummon.isFacedown = position === "defense" ? true : false;
  cardToSummon.hasAttacked = false;
  cardToSummon.cannotAttackThisTurn = cannotAttackThisTurn;
  cardToSummon.cannotAttackNextTurn = false;
  cardToSummon.owner = player.id;

  player.field = player.field || [];
  player.field.push(cardToSummon);

  game.renderer?.log(`${cardToSummon.name} was Special Summoned from hand!`);

  game.emit("after_summon", {
    card: cardToSummon,
    player: player,
    method: "special",
    fromZone: "hand",
  });

  game.updateBoard();
  return true;
}

/**
 * Initialize default handlers
 * @param {ActionHandlerRegistry} registry
 */
export function registerDefaultHandlers(registry) {
  // Generic special summon handlers
  // NOTE: Both "special_summon_from_deck" and "special_summon_from_graveyard"
  // now use the unified handler that supports all zones and patterns
  registry.register("special_summon_from_zone", handleSpecialSummonFromZone);
  registry.register("special_summon_from_deck", handleSpecialSummonFromZone);
  registry.register(
    "special_summon_from_graveyard",
    handleSpecialSummonFromZone
  );

  registry.register(
    "special_summon_from_hand_with_cost",
    handleSpecialSummonFromHandWithCost
  );
  registry.register(
    "special_summon_from_hand_with_tiered_cost",
    handleSpecialSummonFromHandWithTieredCost
  );
  registry.register("bounce_and_summon", handleBounceAndSummon);
  registry.register(
    "special_summon_matching_level",
    handleSpecialSummonMatchingLevel
  );
  registry.register("banish", handleBanish);
  registry.register("banish_destroyed_monster", handleBanishDestroyedMonster);

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
  registry.register(
    "selective_field_destruction",
    handleSelectiveFieldDestruction
  );

  // Luminarch refactoring: new generic handlers
  registry.register("buff_stats_temp", handleBuffStatsTemp);
  registry.register("add_status", handleAddStatus);
  registry.register("remove_status", handleAddStatus); // Same handler, uses action.remove flag
  registry.register("pay_lp", handlePayLP);
  registry.register("add_from_zone_to_hand", handleAddFromZoneToHand);
  registry.register("heal_from_destroyed_atk", handleHealFromDestroyedAtk);
  registry.register("switch_position", handleSwitchPosition);
  registry.register("permanent_buff_named", handlePermanentBuffNamed);
  registry.register(
    "remove_permanent_buff_named",
    handleRemovePermanentBuffNamed
  );
  registry.register("grant_second_attack", handleGrantSecondAttack);
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
  registry.register(
    "buff_stats_temp_with_second_attack",
    handleBuffStatsTempWithSecondAttack
  );

  // FASE 4: New handlers for remaining Shadow-Heart refactoring
  registry.register(
    "conditional_special_summon_from_hand",
    handleConditionalSpecialSummonFromHand
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
  registry.register("search_any", proxyEngineMethod("applySearchAny"));
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
}
