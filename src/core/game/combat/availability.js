import { cardMatchesKind } from "../../Card.js";

/**
 * Combat availability checks - attack validation and usage tracking.
 * Extracted from Game.js as part of B.5 modularization.
 */

function getPlayerByCardOwner(game, card) {
  if (!game || !card) return null;
  return card.owner === "player" ? game.player : game.bot;
}

function getAttackPassiveSources(player) {
  if (!player) return [];
  const field = Array.isArray(player.field) ? player.field : [];
  const spellTrap = Array.isArray(player.spellTrap) ? player.spellTrap : [];
  const fieldSpell = player.fieldSpell ? [player.fieldSpell] : [];
  return [...field, ...spellTrap, ...fieldSpell].filter(Boolean);
}

export function isActiveAttackPriorityTarget(card) {
  return (
    card &&
    card.cardKind === "monster" &&
    card.mustBeAttacked === true &&
    card.isFacedown !== true
  );
}

function findAttackPassiveSourceZone(game, owner, card) {
  if (!game || !owner || !card) return null;
  if (typeof game.findCardZone === "function") {
    const zone = game.findCardZone(owner, card);
    if (zone) return zone;
  }
  if (owner.fieldSpell === card) return "fieldSpell";
  if (Array.isArray(owner.field) && owner.field.includes(card)) return "field";
  if (Array.isArray(owner.spellTrap) && owner.spellTrap.includes(card)) {
    return "spellTrap";
  }
  return null;
}

function getCounterValue(card, counterType) {
  if (!card || !counterType) return 0;
  if (typeof card.getCounter === "function") {
    return Math.max(0, Number(card.getCounter(counterType) || 0));
  }
  if (card.counters?.get) {
    return Math.max(0, Number(card.counters.get(counterType) || 0));
  }
  return 0;
}

function cardMatchesAttackPassiveFilters(game, card, filters = {}) {
  if (!card) return false;
  if (filters.requireFaceup === true && card.isFacedown) return false;
  if (filters.cardKind && !cardMatchesKind(card, filters.cardKind)) return false;
  if (filters.position && filters.position !== "any") {
    if (card.position !== filters.position) return false;
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
    typeof game?.effectEngine?.cardMatchesFilters === "function" &&
    !game.effectEngine.cardMatchesFilters(card, filters)
  ) {
    return false;
  }
  return true;
}

function normalizePassiveList(value, fallback = []) {
  if (value === undefined || value === null) return fallback;
  return Array.isArray(value) ? value : [value];
}

function samePlayer(left, right) {
  if (!left || !right) return false;
  return left === right || (left.id && right.id && left.id === right.id);
}

function getPlayerFromContext(game, value) {
  if (!game || !value) return null;
  if (samePlayer(value, game.player)) return game.player;
  if (samePlayer(value, game.bot)) return game.bot;
  if (value === "player") return game.player;
  if (value === "bot") return game.bot;
  if (value.owner === "player") return game.player;
  if (value.owner === "bot") return game.bot;
  if (value.id === "player") return game.player;
  if (value.id === "bot") return game.bot;
  return null;
}

function getOwnerTypeForAura(auraOwner, targetOwner) {
  if (!auraOwner || !targetOwner) return null;
  return samePlayer(auraOwner, targetOwner) ? "self" : "opponent";
}

function ownerRuleMatches(ruleList, ownerType) {
  if (!ownerType) return false;
  return ruleList.includes("any") || ruleList.includes(ownerType);
}

function isBattleDestructionPreventionAura(passive) {
  return (
    passive?.type === "negate_battle_destruction_prevention" ||
    passive?.type === "negate_opponent_battle_destruction_prevention"
  );
}

function findBattleDestructionPreventionNegationAura(
  game,
  card,
  context = {},
) {
  if (!game || !card) return null;

  const protectedOwner =
    getPlayerFromContext(game, context.owner) || getPlayerByCardOwner(game, card);
  if (!protectedOwner) return null;

  const preventionSourceOwner =
    getPlayerFromContext(
      game,
      context.preventionSourceOwner ||
        context.effectOwner ||
        context.sourceOwner,
    ) || protectedOwner;

  const sourceOwners = [game.player, game.bot].filter(Boolean);

  for (const sourceOwner of sourceOwners) {
    for (const sourceCard of getAttackPassiveSources(sourceOwner)) {
      if (!sourceCard || sourceCard.isFacedown || sourceCard.effectsNegated) {
        continue;
      }

      for (const effect of sourceCard.effects || []) {
        if (effect?.timing !== "passive") continue;
        const passive = effect.passive || {};
        if (!isBattleDestructionPreventionAura(passive)) continue;

        const sourceZone = findAttackPassiveSourceZone(
          game,
          sourceOwner,
          sourceCard,
        );
        if (effect.requireZone && sourceZone !== effect.requireZone) continue;
        if (passive.requireZone && sourceZone !== passive.requireZone) continue;
        if (effect.requireFaceup === true && sourceCard.isFacedown) continue;

        const targetOwners = normalizePassiveList(
          passive.targetOwners || passive.owners,
          ["opponent"],
        );
        const targetOwnerType = getOwnerTypeForAura(
          sourceOwner,
          protectedOwner,
        );
        if (!ownerRuleMatches(targetOwners, targetOwnerType)) continue;

        const preventedEffectOwners = normalizePassiveList(
          passive.preventedEffectOwners || passive.effectOwners,
          ["opponent"],
        );
        const preventionOwnerType = getOwnerTypeForAura(
          sourceOwner,
          preventionSourceOwner,
        );
        if (!ownerRuleMatches(preventedEffectOwners, preventionOwnerType)) {
          continue;
        }

        const targetFilters = passive.targetFilters || { cardKind: "monster" };
        if (!cardMatchesAttackPassiveFilters(game, card, targetFilters)) {
          continue;
        }

        return { sourceCard, sourceOwner, effect, passive };
      }
    }
  }

  return null;
}

function getCounterAttackLockReason(game, attacker) {
  const attackerOwner = getPlayerByCardOwner(game, attacker);
  const opponentOfAttacker =
    attackerOwner && typeof game?.getOpponent === "function"
      ? game.getOpponent(attackerOwner)
      : attacker?.owner === "player"
        ? game?.bot
        : game?.player;
  if (!attackerOwner || !opponentOfAttacker) return null;

  const sourceOwners = Array.from(
    new Set([attackerOwner, opponentOfAttacker].filter(Boolean)),
  );

  for (const sourceOwner of sourceOwners) {
    for (const sourceCard of getAttackPassiveSources(sourceOwner)) {
      if (!sourceCard || sourceCard.isFacedown) continue;

      for (const effect of sourceCard.effects || []) {
        if (effect?.timing !== "passive") continue;
        const passive = effect.passive;
        if (!passive || passive.type !== "counter_attack_lock") continue;

        const sourceZone = findAttackPassiveSourceZone(
          game,
          sourceOwner,
          sourceCard,
        );
        if (effect.requireZone && sourceZone !== effect.requireZone) continue;
        if (passive.requireZone && sourceZone !== passive.requireZone) continue;
        if (effect.requireFaceup === true && sourceCard.isFacedown) continue;

        const targetOwnersRaw =
          passive.targetOwners || passive.owners || ["opponent"];
        const targetOwners = Array.isArray(targetOwnersRaw)
          ? targetOwnersRaw
          : [targetOwnersRaw];
        const ownerType = attackerOwner === sourceOwner ? "self" : "opponent";
        if (
          !targetOwners.includes("any") &&
          !targetOwners.includes(ownerType)
        ) {
          continue;
        }

        const targetFilters = passive.targetFilters || { cardKind: "monster" };
        if (!cardMatchesAttackPassiveFilters(game, attacker, targetFilters)) {
          continue;
        }

        const counterType = passive.counterType || "default";
        const minCounters = Math.max(1, Number(passive.minCounters ?? 1));
        if (getCounterValue(attacker, counterType) < minCounters) continue;

        return (
          passive.reason ||
          `${attacker.name} cannot attack while it has ${minCounters} or more ${counterType} counter(s).`
        );
      }
    }
  }

  return null;
}

/**
 * Check if a monster can attack and how many attacks it has available.
 * @param {Object} attacker - The monster attempting to attack
 * @returns {Object} Availability result with ok, reason, maxAttacks, etc.
 */
export function getAttackAvailability(attacker) {
  if (!attacker) {
    return { ok: false, reason: "No attacker selected." };
  }
  if (this.isFirstTurnOfDuel?.() || this.turnCounter === 1) {
    return {
      ok: false,
      reason: "Cannot attack on the first turn of the duel.",
    };
  }
  if (attacker.cannotAttackThisTurn) {
    return {
      ok: false,
      reason: `${attacker.name} cannot attack this turn.`,
    };
  }

  const counterAttackLockReason = getCounterAttackLockReason(this, attacker);
  if (counterAttackLockReason) {
    return {
      ok: false,
      reason: counterAttackLockReason,
    };
  }

  // Check passive "restrict_opponent_summon_turn_attack" from opponent's field cards
  if (attacker.summonedTurn === this.turnCounter) {
    const opponentOfAttacker = attacker.owner === "player" ? this.bot : this.player;
    for (const fieldCard of getAttackPassiveSources(opponentOfAttacker)) {
      if (!fieldCard || fieldCard.isFacedown) continue;
      for (const effect of (fieldCard.effects || [])) {
        if (
          effect?.timing === "passive" &&
          effect?.passive?.type === "restrict_opponent_summon_turn_attack"
        ) {
          return {
            ok: false,
            reason: `${attacker.name} cannot attack on the turn it was summoned.`,
          };
        }
      }
    }
  }
  if (attacker.position === "defense") {
    return {
      ok: false,
      reason: "Defense position monsters cannot attack!",
    };
  }

  let extraAttacks = attacker.extraAttacks || 0;
  if (attacker.dynamicExtraAttacks?.source === "graveyard_count") {
    const dea = attacker.dynamicExtraAttacks;
    const owner = attacker.owner === "player" ? this.player : this.bot;
    const dynamicAttackLimit = (owner?.graveyard || []).filter(
      (c) => c && c.name === dea.name,
    ).length;
    extraAttacks = dynamicAttackLimit - 1;
  }
  const maxAttacks = 1 + extraAttacks;
  const attacksUsed = attacker.attacksUsedThisTurn || 0;
  const canUseSecondAttack =
    attacker.canMakeSecondAttackThisTurn && !attacker.secondAttackUsedThisTurn;
  const extraAttackTargetRestriction =
    attacker.extraAttackTargetRestriction ||
    attacker.passiveExtraAttackTargetRestriction ||
    null;

  if (attacksUsed > 0 && extraAttackTargetRestriction === "monster") {
    const opponent = attacker.owner === "player" ? this.bot : this.player;
    const hasOpponentMonster = (opponent?.field || []).some(
      (m) => m && m.cardKind === "monster",
    );
    if (!hasOpponentMonster) {
      return {
        ok: false,
        reason: `${attacker.name}'s extra attack can only target monsters.`,
      };
    }
  }

  // Check for multi-attack ability (attack all opponent monsters)
  if (attacker.canAttackAllOpponentMonstersThisTurn) {
    const opponent = attacker.owner === "player" ? this.bot : this.player;
    const opponentMonsters = (opponent?.field || []).filter(
      (m) => m && !m.isFacedown
    );
    const opponentMonsterCount = opponentMonsters.length;

    // Filter out already attacked monsters
    const attackedMonsters = attacker.attackedMonstersThisTurn || new Set();
    const unattackedMonsters = opponentMonsters.filter((m) => {
      const cardId = m.instanceId || m.id || m.name;
      return !attackedMonsters.has(cardId);
    });

    // Can still attack if there are unattacked monsters
    if (unattackedMonsters.length > 0) {
      return {
        ok: true,
        maxAttacks: opponentMonsterCount,
        attacksUsed,
        isMultiAttack: true,
        remainingTargets: unattackedMonsters.length,
      };
    }

    // All monsters attacked - no more attacks in multi-attack mode
    return {
      ok: false,
      reason: `${attacker.name} has attacked all opponent monsters this turn.`,
    };
  }

  if (attacksUsed >= maxAttacks && !canUseSecondAttack) {
    return {
      ok: false,
      reason: `${attacker.name} has already attacked the maximum number of times this turn.`,
    };
  }

  return { ok: true, maxAttacks, attacksUsed };
}

/**
 * Mark an attack as used, updating attack counters and flags.
 * @param {Object} attacker - The attacking monster
 * @param {Object|null} target - The target monster (null for direct attack)
 */
export function markAttackUsed(attacker, target = null) {
  if (!attacker) return;
  let extraAttacks = attacker.extraAttacks || 0;
  if (attacker.dynamicExtraAttacks?.source === "graveyard_count") {
    const dea = attacker.dynamicExtraAttacks;
    const owner = attacker.owner === "player" ? this.player : this.bot;
    const dynamicAttackLimit = (owner?.graveyard || []).filter(
      (c) => c && c.name === dea.name,
    ).length;
    extraAttacks = dynamicAttackLimit - 1;
  }
  const maxAttacks = 1 + extraAttacks;
  attacker.attacksUsedThisTurn = (attacker.attacksUsedThisTurn || 0) + 1;

  // Track attacked monsters for multi-attack effects
  if (attacker.canAttackAllOpponentMonstersThisTurn && target) {
    attacker.attackedMonstersThisTurn =
      attacker.attackedMonstersThisTurn || new Set();
    // Use unique identifier for the target (id or reference)
    const targetId = target.instanceId || target.id || target.name;
    attacker.attackedMonstersThisTurn.add(targetId);
  }

  if (
    attacker.attacksUsedThisTurn > maxAttacks &&
    attacker.canMakeSecondAttackThisTurn &&
    !attacker.secondAttackUsedThisTurn
  ) {
    attacker.secondAttackUsedThisTurn = true;
  }

  // For multi-attack mode, don't set hasAttacked until all opponent monsters are attacked
  if (attacker.canAttackAllOpponentMonstersThisTurn) {
    // In multi-attack mode, check if there are still unattacked monsters
    const opponent = attacker.owner === "player" ? this.bot : this.player;
    const opponentMonsters = (opponent?.field || []).filter(
      (m) => m && !m.isFacedown
    );
    const attackedMonsters = attacker.attackedMonstersThisTurn || new Set();
    const unattackedCount = opponentMonsters.filter((m) => {
      const cardId = m.instanceId || m.id || m.name;
      return !attackedMonsters.has(cardId);
    }).length;

    // Only mark as hasAttacked when all monsters have been attacked
    attacker.hasAttacked = unattackedCount === 0;
  } else if (attacker.attacksUsedThisTurn >= maxAttacks) {
    attacker.hasAttacked = true;
  } else {
    attacker.hasAttacked = false;
  }
}

/**
 * Register that an attack was negated (e.g., by a trap).
 * @param {Object} attacker - The monster whose attack was negated
 */
export function registerAttackNegated(attacker) {
  this.lastAttackNegated = true;
  if (attacker?.name) {
    this.ui.log(`The attack of ${attacker.name} was negated!`);
  } else {
    this.ui.log("The attack was negated!");
  }
}

/**
 * Check if an active aura negates effects preventing this card from being
 * destroyed by battle.
 * @param {Object} card - The card protected by a battle-destruction effect
 * @param {Object} context - Optional owner/source context for the prevention
 * @returns {boolean} True if the prevention effect is negated
 */
export function isBattleDestructionPreventionNegated(card, context = {}) {
  return !!findBattleDestructionPreventionNegationAura(this, card, context);
}

/**
 * Check if a card can be destroyed by battle.
 * @param {Object} card - The card to check
 * @param {Object} context - Optional owner/source context for the prevention
 * @returns {boolean} True if the card can be destroyed by battle
 */
export function canDestroyByBattle(card, context = {}) {
  if (!card) return false;
  if (isBattleDestructionPreventionNegated.call(this, card, context)) {
    return true;
  }
  if (card.battleIndestructible) return false;
  if (card.tempBattleIndestructible) return false;
  if (card.battleIndestructibleOncePerTurn) {
    const turnCounter = Number.isFinite(Number(this?.turnCounter))
      ? Number(this.turnCounter)
      : 0;
    if (card.battleIndestructibleOncePerTurnLastUsedTurn !== turnCounter) {
      card.battleIndestructibleOncePerTurnLastUsedTurn = turnCounter;
      card.battleIndestructibleOncePerTurnUsed = true;
      return false;
    }
    card.battleIndestructibleOncePerTurnUsed = true;
    return true;
  }
  return true;
}
