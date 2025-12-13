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

      return true;
    });
  }

  if (candidates.length === 0) {
    game.renderer?.log(`No valid cards in ${sourceZone} matching filters.`);
    return false;
  }

  // Determine how many cards to summon
  const count = action.count || { min: 1, max: 1 };
  const maxSelect = Math.min(
    count.max,
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
    game.renderer.showMultiSelectModal(
      candidates,
      { min: minRequired, max: maxSelect },
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

  let buffed = false;
  const affectedCards = [];

  for (const card of targetCards) {
    if (!card || card.cardKind !== "monster") continue;

    if (atkBoost !== 0) {
      card.tempAtkBoost = (card.tempAtkBoost || 0) + atkBoost;
      card.atk = (card.atk || 0) + atkBoost;
      buffed = true;
    }

    if (defBoost !== 0) {
      card.tempDefBoost = (card.tempDefBoost || 0) + defBoost;
      card.def = (card.def || 0) + defBoost;
      buffed = true;
    }

    if (buffed) {
      affectedCards.push(card.name);
    }
  }

  if (buffed && affectedCards.length > 0) {
    const boosts = [];
    if (atkBoost !== 0) boosts.push(`${atkBoost > 0 ? "+" : ""}${atkBoost} ATK`);
    if (defBoost !== 0) boosts.push(`${defBoost > 0 ? "+" : ""}${defBoost} DEF`);

    const cardList = affectedCards.join(", ");
    game.renderer?.log(`${cardList} gained ${boosts.join(" and ")} until end of turn.`);
    game.updateBoard();
  }

  return buffed;
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
    const cardList = affectedCards.join(", ");
    const statusText = remove ? `lost ${status}` : `gained ${status}`;
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
        ? candidates.sort((a, b) => (b.atk || 0) - (a.atk || 0)).slice(0, maxSelect)
        : candidates.slice(0, maxSelect);

    for (const card of toAdd) {
      const idx = zone.indexOf(card);
      if (idx !== -1) {
        zone.splice(idx, 1);
        player.hand.push(card);
      }
    }

    game.renderer?.log(
      `${player.name || player.id} added ${toAdd.length} card(s) to hand from ${sourceZone}.`
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

            game.renderer?.log(`Added ${chosen.name} to hand from ${sourceZone}.`);
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
    `${player.name || player.id} gained ${healAmount} LP from ${destroyed.name}'s ATK.`
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
 * Initialize default handlers
 * @param {ActionHandlerRegistry} registry
 */
export function registerDefaultHandlers(registry) {
  // Generic special summon handlers
  // NOTE: Both "special_summon_from_deck" and "special_summon_from_graveyard"
  // now use the unified handler that supports all zones and patterns
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
}
