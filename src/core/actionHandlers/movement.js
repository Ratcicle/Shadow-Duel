/**
 * movement.js
 *
 * Handlers for card movement effects (bounce, etc.)
 * Moved from ActionHandlers.js with identical behavior.
 */

import { isAI } from "../Player.js";
import { getUI, resolveTargetCards } from "./shared.js";

/**
 * Generic handler for returning cards to hand (bounce effect)
 * UNIFIED HANDLER - Works for any card returning to owner's hand
 *
 * Action properties:
 * - targetRef: reference to target cards (can be array or single card)
 * - fromZone: zone to return from (optional, auto-detected if not specified)
 * - player: "self" | "opponent" (default: "self")
 */
export async function handleReturnToHand(action, ctx, targets, engine) {
  const game = engine?.game;
  if (!game) return false;

  const cards = resolveTargetCards(action, ctx, targets);

  if (!cards || cards.length === 0) {
    return false;
  }

  const targetPlayer =
    action.player === "opponent" ? ctx?.opponent : ctx?.player;

  if (!targetPlayer) return false;

  let returnedCount = 0;

  for (const card of cards) {
    if (!card) continue;

    // Find the owner of the card
    const cardOwner = card.owner === "player" ? game.player : game.bot;
    if (!cardOwner) continue;

    // Detect current zone if not specified
    const fromZone =
      action.fromZone ||
      (typeof engine.findCardZone === "function"
        ? engine.findCardZone(cardOwner, card)
        : null) ||
      "field";

    // Use game.moveCard for proper event handling
    const moveResult = await game.moveCard(card, cardOwner, "hand", {
      fromZone,
      contextLabel: action.contextLabel || "return_to_hand",
      sourceCard: ctx?.source || null,
      effectId: ctx?.effect?.id || null,
      movedByEffect: true,
      awaitCardMovedEvent: true,
    });

    if (moveResult && moveResult.success !== false) {
      returnedCount++;
      getUI(game)?.log(`${card.name} returned to hand.`);

      // If this bounce removes the current attack target, negate the attack
      if (
        ctx?.attacker &&
        (ctx.defender === card || ctx.target === card) &&
        typeof game.registerAttackNegated === "function"
      ) {
        game.registerAttackNegated(ctx.attacker);
      }
    } else {
      // Fallback for older moveCard implementations
      const sourceZone = cardOwner[fromZone];
      if (Array.isArray(sourceZone)) {
        const idx = sourceZone.indexOf(card);
        if (idx !== -1) {
          sourceZone.splice(idx, 1);
          cardOwner.hand = cardOwner.hand || [];
          cardOwner.hand.push(card);
          returnedCount++;
          getUI(game)?.log(`${card.name} returned to hand.`);
        }
      }
    }
  }

  if (returnedCount > 0 && typeof game.updateBoard === "function") {
    game.updateBoard();
  }

  return returnedCount > 0;
}

/**
 * Helper function to bounce source and summon target
 */
async function bounceAndSummonCard(source, target, player, action, engine, ctx = {}) {
  const game = engine.game;

  if (!target) return false;

  if (target.cardKind !== "monster") {
    console.error(
      `[bounceAndSummonCard] BLOCKED: Attempted to summon non-monster "${target?.name}" (kind: ${target?.cardKind})`
    );
    return false;
  }

  const sourceWillFreeSlot =
    action.bounceSource !== false &&
    Array.isArray(player.field) &&
    player.field.includes(source);

  if (player.field.length >= 5 && !sourceWillFreeSlot) {
    getUI(game)?.log("Field is full.");
    return false;
  }

  // Bounce source to hand
  if (action.bounceSource !== false) {
    if (typeof game.moveCard === "function") {
      const moveResult = await game.moveCard(source, player, "hand", {
        fromZone: "field",
        contextLabel: action.contextLabel || "bounce_and_summon",
        sourceCard: ctx?.source || source,
        effectId: ctx?.effect?.id || null,
        movedByEffect: true,
        awaitCardMovedEvent: true,
      });
      if (moveResult === false || moveResult?.success === false) {
        return false;
      }
    } else {
      const fieldIndex = player.field.indexOf(source);
      if (fieldIndex !== -1) {
        player.field.splice(fieldIndex, 1);
        player.hand.push(source);
      } else {
        return false;
      }
    }
  }

  // 🚨 CRITICAL VALIDATION: Only monsters can be summoned to field
  if (!target || target.cardKind !== "monster") {
    console.error(
      `[bounceAndSummonCard] ❌ BLOCKED: Attempted to summon non-monster "${target?.name}" (kind: ${target?.cardKind})`
    );
    return false;
  }

  if (player.field.length >= 5) {
    getUI(game)?.log("Field is full.");
    return false;
  }

  // Determine position
  let position = action.position || "choice";
  const positionPreferences =
    ctx?.actionContext?.specialSummonPositions ||
    ctx?.activationContext?.actionContext?.specialSummonPositions ||
    null;
  const byName =
    target?.name && positionPreferences?.byName
      ? positionPreferences.byName[target.name]
      : null;
  if (byName === "attack" || byName === "defense") {
    position = byName;
  }
  if (position === "choice") {
    position = await engine.chooseSpecialSummonPosition(target, player);
  }

  const moveResult =
    typeof game.moveCard === "function"
      ? await game.moveCard(target, player, "field", {
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

function findControlledCardZone(owner, card) {
  if (!owner || !card) return null;
  if (owner.fieldSpell === card) return "fieldSpell";
  if (Array.isArray(owner.field) && owner.field.includes(card)) return "field";
  if (Array.isArray(owner.spellTrap) && owner.spellTrap.includes(card)) {
    return "spellTrap";
  }
  return null;
}

/**
 * Shuffles all cards the opponent controls (field monsters + spell/trap zone + field spell) into their Deck.
 * Used by battle_destroy effects that punish the opponent for destroying this card.
 */
export async function handleShuffleOpponentFieldToDeck(
  action,
  ctx,
  targets,
  engine,
) {
  const game = engine?.game;
  if (!game) return false;

  const opponent =
    typeof game.getOpponent === "function"
      ? game.getOpponent(ctx.player)
      : ctx.player?.id === "player"
      ? game.bot
      : game.player;

  if (!opponent) return false;

  const controlledCards = [
    ...(opponent.field || []),
    ...(opponent.spellTrap || []),
    ...(opponent.fieldSpell ? [opponent.fieldSpell] : []),
  ].filter(Boolean);
  const toMove = engine?.filterCardsListByImmunity
    ? engine.filterCardsListByImmunity(controlledCards, ctx.player, {
        actionType: "shuffle_opponent_field_to_deck",
        sourceCard: ctx.source || null,
      }).allowed
    : controlledCards;

  if (toMove.length === 0) {
    getUI(game)?.log("Opponent controls no cards to shuffle into the Deck.");
    return false;
  }

  let movedCount = 0;
  for (const card of toMove) {
    const fromZone = findControlledCardZone(opponent, card);
    if (!fromZone) continue;

    const moveResult = await game.moveCard(card, opponent, "deck", {
      fromZone,
      contextLabel: action.contextLabel || "shuffle_opponent_field_to_deck",
      sourceCard: ctx.source || null,
      effectId: ctx.effect?.id || null,
      movedByEffect: true,
      awaitCardMovedEvent: true,
    });

    if (moveResult === false || moveResult?.success === false) {
      getUI(game)?.log(`${card.name} could not be shuffled into the Deck.`);
      continue;
    }

    movedCount += 1;
  }

  if (movedCount === 0) {
    getUI(game)?.log("No opponent cards could be shuffled into the Deck.");
    return false;
  }

  // Shuffle the opponent's deck
  if (Array.isArray(opponent.deck)) {
    for (let i = opponent.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [opponent.deck[i], opponent.deck[j]] = [opponent.deck[j], opponent.deck[i]];
    }
  }

  getUI(game)?.log(
    `${movedCount} card(s) ${opponent.id} controlled were shuffled into the Deck.`
  );

  if (typeof game.updateBoard === "function") game.updateBoard();
  return true;
}

/**
 * Generic handler for bouncing source and summoning from hand
 * Replaces: applyVoidWalkerBounceAndSummon
 *
 * Action properties:
 * - bounceSource: boolean (if true, bounce the source card)
 * - filters: { archetype, name, excludeCardName, excludeCardNames, level, levelOp, excludeSelf }
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
    if (filters.excludeCardName && card.name === filters.excludeCardName) {
      return false;
    }
    if (
      Array.isArray(filters.excludeCardNames) &&
      filters.excludeCardNames.includes(card.name)
    ) {
      return false;
    }

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

  const sourceWillFreeSlot =
    action.bounceSource !== false &&
    Array.isArray(player.field) &&
    player.field.includes(source);
  if (player.field.length >= 5 && !sourceWillFreeSlot) {
    getUI(game)?.log("Field is full.");
    return false;
  }

  // Bot auto-selection (highest ATK)
  if (isAI(player)) {
    const evaluation = player.strategy?.evaluateRecruitCandidate?.(
      validTargets,
      {
        game,
        player,
        source,
        action,
      },
    );
    const strategicChoice =
      evaluation?.best && validTargets.includes(evaluation.best)
        ? evaluation.best
        : null;
    if (evaluation?.blockedAll) {
      getUI(game)?.log("No strategically valid monster to summon.");
      return false;
    }
    const best =
      strategicChoice ||
      validTargets.reduce((top, c) => {
        const cAtk = c.atk || 0;
        const topAtk = top.atk || 0;
        return cAtk >= topAtk ? c : top;
      }, validTargets[0]);

    return await bounceAndSummonCard(source, best, player, action, engine, ctx);
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
            engine,
            ctx,
          );

          game.isResolvingEffect = false;

          resolve(result);
        }
      );
    });
  }

  // Fallback
  const fallback = validTargets[0];

  return await bounceAndSummonCard(source, fallback, player, action, engine, ctx);
}
