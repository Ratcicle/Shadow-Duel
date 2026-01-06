/**
 * stats.js
 *
 * Handlers for stat modifications, status effects, and buffs.
 * Moved from ActionHandlers.js with identical behavior.
 */

import { isAI } from "../Player.js";
import { getUI, resolveTargetCards, STATUS_DISPLAY_NAMES } from "./shared.js";

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

  // Status properties that should be additive (sum values) instead of replacing
  const ADDITIVE_STATUS = ["extraAttacks"];

  for (const card of targetCards) {
    if (!card) continue;

    if (remove) {
      if (card[status] !== undefined) {
        // For additive status, subtract instead of delete
        if (
          ADDITIVE_STATUS.includes(status) &&
          typeof card[status] === "number"
        ) {
          card[status] = Math.max(
            0,
            card[status] - (typeof value === "number" ? value : 1)
          );
        } else {
          delete card[status];
        }

        modified = true;

        affectedCards.push(card.name);
      }
    } else {
      // For additive status, sum values instead of replacing
      if (ADDITIVE_STATUS.includes(status) && typeof value === "number") {
        card[status] = (card[status] || 0) + value;
      } else {
        card[status] = value;
      }

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
 * Handler for granting protection against destruction by effects
 *
 * Action properties:
 * - targetRef: reference to the target that receives protection
 * - protectionType: type of protection ("effect_destruction", "battle_destruction", etc.)
 * - duration: duration ("while_faceup", "end_of_turn", turn number)
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
 * Generic handler for banishing cards from a zone and applying buff based on property
 *
 * This handler is flexible and can:
 * - Banish from graveyard, hand, or any zone
 * - Apply ATK/DEF buff based on atk, def, level, or fixed value
 * - Temporary buff (until end of turn) or permanent
 * - Support selection by filters (type, level, archetype, etc.)
 *
 * Action properties:
 * - targetRef: reference to the target(s) to be banished (required)
 * - buffTarget: who receives the buff ("self" = source card, or specific targetRef)
 * - buffSource: property of banished card to use ("atk", "def", "level", or fixed number)
 * - buffMultiplier: value multiplier (default: 1)
 * - buffType: "atk", "def", or "both" (default: "atk")
 * - duration: "end_of_turn" or "permanent" (default: "end_of_turn")
 * - optional: if true, player can cancel selection (default: false)
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
      getUI(game)?.log(
        `${info.name} switched to ${info.position.toUpperCase()} Position.`
      );
    }

    game.updateBoard();
  }

  return switched;
}

/**
 * Handler for switching defender position on attack
 * If defender is face-down, flip it first, then switch to attack position.
 */
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

  // If face-down, flip it first
  if (defender.isFacedown) {
    const defenderOwner = defender.owner === "player" ? "player" : "bot";
    const defenderField =
      defender.owner === "player" ? game.player.field : game.bot.field;
    const defenderIndex = defenderField.indexOf(defender);

    if (game.ui && typeof game.ui.applyFlipAnimation === "function") {
      game.ui.applyFlipAnimation(defenderOwner, defenderIndex);
    }

    defender.isFacedown = false;
    defender.revealedTurn = game.turnCounter;
    getUI(game)?.log(`${defender.name} was flipped!`);
    game.updateBoard();

    // Small delay for animation
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  if (defender.position !== "defense") {
    getUI(game)?.log(`${defender.name} is already in attack position.`);

    return true; // Not an error, just already in attack
  }

  // Switch position to attack

  defender.position = "attack";

  defender.hasChangedPosition = true;

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

    // If cumulative is false and card already has this buff, skip it
    if (!cumulative && card.permanentBuffsBySource[sourceName]) {
      const existingAtk = card.permanentBuffsBySource[sourceName]?.atk || 0;
      const existingDef = card.permanentBuffsBySource[sourceName]?.def || 0;

      // Already has the exact buff, skip
      if (existingAtk === atkBoost && existingDef === defBoost) {
        continue;
      }
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
