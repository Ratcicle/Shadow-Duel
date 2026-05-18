/**
 * Zone movement - card movement between zones with side effects.
 * Extracted from Game.js as part of B.4 modularization.
 */

/**
 * Clean up token references when a token leaves the field.
 * Tokens cannot exist outside the field.
 * @param {Object} token - The token card
 * @param {Object} tokenOwner - The token's owner player
 */
export function cleanupTokenReferences(token, tokenOwner) {
  if (!token) return;

  // Find and process equip spells attached to this token (same logic as monster cleanup)
  const equipZone = this.getZone(tokenOwner, "spellTrap") || [];
  const attachedEquips = equipZone.filter(
    (eq) =>
      eq &&
      eq.cardKind === "spell" &&
      eq.subtype === "equip" &&
      (eq.equippedTo === token || eq.equipTarget === token)
  );

  // Process equips: clear refs and send to GY
  for (const equip of attachedEquips) {
    // Clear equip references
    if (equip.equippedTo === token) {
      equip.equippedTo = null;
    }
    if (equip.equipTarget === token) {
      equip.equipTarget = null;
    }
    // Reset equip bonuses (they were applied to the token which is being removed)
    equip.equipAtkBonus = 0;
    equip.equipDefBonus = 0;
    equip.equipExtraAttacks = 0;
    equip.grantsBattleIndestructible = false;
    equip.grantsCrescentShieldGuard = false;

    // Move equip to graveyard - refs already cleared, so equip's cleanup block will be skipped
    this.moveCard(equip, tokenOwner, "graveyard", {
      fromZone: "spellTrap",
    });
  }

  // Clear the token's equips array
  if (Array.isArray(token.equips)) {
    token.equips = [];
  }

  // If this token was revived by Call of the Haunted, clear that reference
  // and destroy the trap
  if (token.callOfTheHauntedTrap) {
    const trap = token.callOfTheHauntedTrap;
    if (trap.callOfTheHauntedTarget === token) {
      trap.callOfTheHauntedTarget = null;
    }
    token.callOfTheHauntedTrap = null;

    // Destroy the Call of the Haunted trap (fire-and-forget, ref already cleared)
    this.destroyCard(trap, {
      cause: "effect",
      sourceCard: token,
      opponent: this.getOpponent(tokenOwner),
    }).then((result) => {
      if (result?.destroyed) {
        this.ui.log(
          `${trap.name} was destroyed as ${token.name} (Token) was removed from the game.`
        );
        this.updateBoard();
      }
    });
  }

  // If this token is equipped to something (unlikely but possible), clean up
  if (token.equippedTo) {
    const host = token.equippedTo;
    if (Array.isArray(host.equips)) {
      const idx = host.equips.indexOf(token);
      if (idx > -1) host.equips.splice(idx, 1);
    }
    token.equippedTo = null;
  }
  if (token.equipTarget) {
    token.equipTarget = null;
  }

  // Clear any passive buff tracking
  this.effectEngine?.clearPassiveBuffsForCard(token);

  // Clear temporary stat modifiers
  token.tempAtkBoost = 0;
  token.tempDefBoost = 0;
  delete token.permanentBuffsBySource;
}

/**
 * Move a card between zones (public API, wrapped in runZoneOp).
 * @param {Object} card - The card to move
 * @param {Object} destPlayer - Destination player
 * @param {string} toZone - Destination zone name
 * @param {Object} options - Options (fromZone, position, etc.)
 * @returns {Object|Promise} Result of the move operation
 */
export function moveCard(card, destPlayer, toZone, options = {}) {
  const result = this.runZoneOp(
    "MOVE_CARD",
    () => this.moveCardInternal(card, destPlayer, toZone, options),
    {
      contextLabel: options.contextLabel || "moveCard",
      card,
      fromZone: options.fromZone,
      toZone,
    }
  );
  if (result && typeof result.then === "function") {
    return result.then((moveResult) => {
      this._arenaTracker?.recordZoneMove?.(
        card,
        destPlayer,
        toZone,
        options,
        moveResult,
      );
      return moveResult;
    });
  }
  this._arenaTracker?.recordZoneMove?.(card, destPlayer, toZone, options, result);
  return result;
}

function buildZoneMoveAnimationIntent(game, card, fromOwner, fromZone, destPlayer, toZone, options) {
  if (!game?.cardAnimationsReady) return null;
  if (!card || card.instanceId == null || !fromOwner || !destPlayer) return null;
  if (options?.animateCards === false || options?.skipAnimation === true) return null;
  if (fromZone === toZone) return null;

  const source = game.ui?.captureCardAnimationSource?.(card, {
    ownerId: fromOwner.id,
    zone: fromZone,
  });

  return {
    kind: "zone-move",
    card,
    fromOwnerId: fromOwner.id,
    toOwnerId: destPlayer.id,
    fromZone,
    toZone,
    fromRect: source?.rect || null,
    fromHadCardElement: source?.hadCardElement === true,
    fromVisual: source?.visual || null,
  };
}

function queueZoneMoveAnimation(game, intent, toZoneOverride = null) {
  if (!intent || typeof game?.queueCardAnimation !== "function") return;
  game.queueCardAnimation({
    ...intent,
    toZone: toZoneOverride || intent.toZone,
  });
}

const FIELD_SOURCE_ZONES = new Set(["field", "spellTrap", "fieldSpell"]);

/**
 * Look for any face-up card on the field whose passive `send_to_grave_replacement`
 * effect matches a card being sent to the graveyard owned by `fromOwner`.
 * Returns the redirect zone name (typically "banished") or null.
 *
 * This implements Macro Cosmos-style replacements (e.g. Galaxy Extreme Dragon's
 * "any card sent to opponent's Graveyard is banished instead").
 *
 * @param {import('../../Game.js').default} game
 * @param {Object} card - card being moved to the graveyard
 * @param {Object} fromOwner - owner of the card before the move
 * @returns {string|null}
 */
function findSendToGraveReplacementTarget(game, card, fromOwner) {
  if (!game || !card || !fromOwner) return null;

  const players = [game.player, game.bot].filter(Boolean);
  for (const sourceOwner of players) {
    const fieldCards = sourceOwner.field || [];
    for (const sourceCard of fieldCards) {
      if (!sourceCard || sourceCard.isFacedown) continue;
      const effects = Array.isArray(sourceCard.effects) ? sourceCard.effects : [];
      for (const effect of effects) {
        if (!effect || effect.timing !== "passive") continue;
        const passive = effect.passive;
        if (!passive || passive.type !== "send_to_grave_replacement") continue;

        // Determine which card-owner this replacement applies to.
        // "self"     → cards owned by the source's controller
        // "opponent" → cards owned by the source's opponent (most common)
        // "any"      → any card
        const targetOwnerKey = passive.targetOwner || "opponent";
        if (targetOwnerKey !== "any") {
          const expectedOwner =
            targetOwnerKey === "self" ? sourceOwner : game.getOpponent(sourceOwner);
          if (expectedOwner !== fromOwner) continue;
        }

        // Galaxy Extreme Dragon must not redirect cards going to its own
        // controller's Graveyard. The check above already handles that, but
        // also skip the source card itself (it should never end up redirected
        // by its own passive).
        if (sourceCard === card) continue;

        const redirectTo = passive.redirectTo || "banished";
        return redirectTo;
      }
    }
  }

  return null;
}

function asList(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function matchesAny(value, required) {
  const requiredValues = asList(required);
  if (requiredValues.length === 0) return true;
  const values = Array.isArray(value) ? value : [value];
  return requiredValues.some((req) => values.includes(req));
}

function cardMatchesFieldLimitFilters(card, filters = {}) {
  if (!card) return false;

  const idFilter = filters.cardId ?? filters.id;
  if (idFilter !== undefined && idFilter !== null && card.id !== idFilter) {
    return false;
  }

  const idsFilter = filters.cardIds ?? filters.ids;
  if (
    Array.isArray(idsFilter) &&
    idsFilter.length > 0 &&
    !idsFilter.includes(card.id)
  ) {
    return false;
  }

  const nameFilter = filters.cardName ?? filters.name;
  if (nameFilter && !matchesAny(card.name, nameFilter)) return false;

  if (filters.cardKind && !matchesAny(card.cardKind, filters.cardKind)) {
    return false;
  }

  if (filters.subtype && !matchesAny(card.subtype, filters.subtype)) {
    return false;
  }

  if (
    filters.monsterType &&
    !matchesAny(card.monsterType, filters.monsterType)
  ) {
    return false;
  }

  if (filters.type) {
    const cardTypes = Array.isArray(card.types) ? card.types : [card.type];
    if (!matchesAny(cardTypes, filters.type)) return false;
  }

  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!matchesAny(archetypes, filters.archetype)) return false;
  }

  if (filters.level !== undefined) {
    const level = card.level || 0;
    const op = filters.levelOp || "eq";
    if (op === "eq" && level !== filters.level) return false;
    if (op === "lte" && level > filters.level) return false;
    if (op === "gte" && level < filters.level) return false;
    if (op === "lt" && level >= filters.level) return false;
    if (op === "gt" && level <= filters.level) return false;
  }

  if (filters.minAtk !== undefined && (card.atk || 0) < filters.minAtk) {
    return false;
  }
  if (filters.maxAtk !== undefined && (card.atk || 0) > filters.maxAtk) {
    return false;
  }
  if (filters.minDef !== undefined && (card.def || 0) < filters.minDef) {
    return false;
  }
  if (filters.maxDef !== undefined && (card.def || 0) > filters.maxDef) {
    return false;
  }

  return true;
}

/**
 * Generic field-limit check for declarative card rules.
 * @this {import('../../Game.js').default}
 */
export function canPlaceCardOnField(card, destPlayer, options = {}) {
  if (!card || !destPlayer) {
    return { ok: false, reason: "Invalid field placement." };
  }
  if (card.cardKind !== "monster") {
    return { ok: true };
  }

  const excludedCards = new Set(options.excludeCards || []);
  excludedCards.add(card);
  const willBeFacedown =
    typeof options.isFacedown === "boolean"
      ? options.isFacedown
      : card.isFacedown === true;

  const hasOnlyMonsterRestriction = (fieldCard) =>
    fieldCard?.fieldPresenceRestriction?.type ===
      "only_monster_you_control_while_faceup" && !fieldCard.isFacedown;

  const existingExclusive = (destPlayer.field || []).find(
    (fieldCard) =>
      fieldCard &&
      !excludedCards.has(fieldCard) &&
      hasOnlyMonsterRestriction(fieldCard),
  );
  if (existingExclusive) {
    const reason = `You cannot control other monsters while ${existingExclusive.name} is face-up.`;
    if (options.silent !== true) this?.ui?.log?.(reason);
    return {
      ok: false,
      reason,
      code: "field_presence_restriction",
      restrictedBy: existingExclusive,
    };
  }

  if (
    card.fieldPresenceRestriction?.type ===
      "only_monster_you_control_while_faceup" &&
    !willBeFacedown
  ) {
    const otherMonsters = (destPlayer.field || []).filter(
      (fieldCard) => fieldCard && !excludedCards.has(fieldCard),
    );
    if (otherMonsters.length > 0) {
      const reason = `${card.name} must be the only monster you control.`;
      if (options.silent !== true) this?.ui?.log?.(reason);
      return {
        ok: false,
        reason,
        code: "field_presence_restriction",
        restrictedBy: card,
      };
    }
  }

  const limit = card.fieldLimit;
  if (!limit || typeof limit !== "object") {
    return { ok: true };
  }

  const requireFaceup = limit.requireFaceup === true;

  if (requireFaceup && willBeFacedown) {
    return { ok: true };
  }

  const filters = limit.filters || {};
  if (!cardMatchesFieldLimitFilters(card, filters)) {
    return { ok: true };
  }

  const scope = limit.scope === "global" ? "global" : "controller";
  const players =
    scope === "global"
      ? [this?.player, this?.bot].filter(Boolean)
      : [destPlayer];
  const max = Number.isFinite(Number(limit.max)) ? Number(limit.max) : 1;
  let currentCount = 0;

  for (const player of players) {
    for (const fieldCard of player?.field || []) {
      if (!fieldCard || excludedCards.has(fieldCard)) continue;
      if (requireFaceup && fieldCard.isFacedown) continue;
      if (!cardMatchesFieldLimitFilters(fieldCard, filters)) continue;
      currentCount += 1;
    }
  }

  if (currentCount + 1 <= max) {
    return { ok: true };
  }

  const label = limit.label || limit.key || card.name || "matching monster";
  const faceupText = requireFaceup ? "face-up " : "";
  const scopeText = scope === "global" ? "on the field" : "you control";
  const reason =
    max === 1
      ? `Only 1 ${faceupText}${label} can exist ${scopeText}.`
      : `Only ${max} ${faceupText}${label} cards can exist ${scopeText}.`;

  if (options.silent !== true) {
    this?.ui?.log?.(reason);
  }

  return {
    ok: false,
    reason,
    code: "field_limit",
    fieldLimit: limit,
  };
}

function cardMatchesArchetype(card, archetype) {
  if (!archetype) return true;
  const archetypes = Array.isArray(card?.archetypes)
    ? card.archetypes
    : card?.archetype
      ? [card.archetype]
      : [];
  return archetypes.includes(archetype);
}

function removeNamedBuffFromCard(card, sourceName) {
  if (!card?.permanentBuffsBySource || !sourceName) return false;

  const buffData = card.permanentBuffsBySource[sourceName];
  if (!buffData) return false;

  if (buffData.atk) {
    card.atk = Math.max(0, (card.atk || 0) - buffData.atk);
  }
  if (buffData.def) {
    card.def = Math.max(0, (card.def || 0) - buffData.def);
  }

  delete card.permanentBuffsBySource[sourceName];
  return true;
}

function getLeaveFieldBuffCleanupActions(card, fromZone) {
  const effects = Array.isArray(card?.effects) ? card.effects : [];
  const cleanupActions = [];

  for (const effect of effects) {
    // Existing cards model "source left field" cleanup through card_to_grave.
    // Zone movement also runs those named-buff removals for bounce/banish paths.
    if (!effect || effect.timing !== "on_event") continue;
    if (effect.event !== "card_to_grave") continue;
    if (
      effect.fromZone &&
      effect.fromZone !== "any" &&
      effect.fromZone !== fromZone
    ) {
      continue;
    }

    const actions = Array.isArray(effect.actions) ? effect.actions : [];
    for (const action of actions) {
      if (action?.type === "remove_permanent_buff_named") {
        cleanupActions.push(action);
      }
    }
  }

  return cleanupActions;
}

function cleanupNamedBuffsWhenSourceLeavesField(
  game,
  card,
  owner,
  fromZone,
  toZone,
) {
  if (!FIELD_SOURCE_ZONES.has(fromZone) || fromZone === toZone) return;
  const cleanupActions = getLeaveFieldBuffCleanupActions(card, fromZone);
  if (cleanupActions.length === 0) return;

  let anyRemoved = false;

  for (const action of cleanupActions) {
    const sourceName = action.sourceName || card.name;
    const targetRef = action.targetRef || "self";
    let targetCards = [];

    if (targetRef === "self" && action.removeFromAllField) {
      targetCards = (owner.field || []).filter(
        (target) =>
          target?.cardKind === "monster" &&
          cardMatchesArchetype(target, action.archetype),
      );
    } else if (targetRef === "self") {
      targetCards = [card];
    }

    for (const target of targetCards) {
      anyRemoved = removeNamedBuffFromCard(target, sourceName) || anyRemoved;
    }
  }

  if (anyRemoved) {
    game?.effectEngine?.clearTargetingCache?.();
  }
}

/**
 * Internal implementation of card movement with all side effects.
 * @param {Object} card - The card to move
 * @param {Object} destPlayer - Destination player
 * @param {string} toZone - Destination zone name
 * @param {Object} options - Options (fromZone, position, isFacedown, etc.)
 * @returns {Promise<Object>} Result of the move
 */
export async function moveCardInternal(card, destPlayer, toZone, options = {}) {
  if (!card || !destPlayer || !toZone) {
    return { success: false, reason: "invalid_args" };
  }

  // 🔍 DEBUG: Log EVERY moveCard attempt to catch spells going to field
  if (card.cardKind !== "monster" && toZone === "field") {
    console.error(
      `[moveCardInternal] 🚨 ATTEMPT: ${card.cardKind} "${card.name}" → field zone`,
      { fromZone: options.fromZone, toZone, cardKind: card.cardKind }
    );
  }

  const destArr = this.getZone(destPlayer, toZone);
  if (!destArr) {
    console.warn("moveCard: destination zone not found", toZone);
    return { success: false, reason: "invalid_zone" };
  }

  // 🚨 CRITICAL VALIDATION: Monster field zone only accepts monsters
  if (toZone === "field" && card.cardKind !== "monster") {
    console.error(
      `[moveCardInternal] ❌ BLOCKED: Attempted to move non-monster "${card.name}" (kind: ${card.cardKind}) to monster field zone`
    );
    this.ui?.log?.(`ERROR: Cannot place ${card.cardKind} in monster zone.`);
    return { success: false, reason: "invalid_card_kind_for_zone" };
  }

  if (toZone === "field" && destArr.length >= 5) {
    this.ui.log("Field is full (max 5 cards).");
    return { success: false, reason: "field_full" };
  }
  if (toZone === "field") {
    const summonProcedure = options.summonProcedure || null;
    if (
      Array.isArray(card.specialSummonOnlyBy) &&
      !card.specialSummonOnlyBy.includes(summonProcedure)
    ) {
      const reason = `${card.name} cannot be Special Summoned this way.`;
      this.ui?.log?.(reason);
      return {
        success: false,
        reason,
        code: "special_summon_restriction",
      };
    }

    const limitCheck = this.canPlaceCardOnField?.(card, destPlayer, {
      isFacedown: options.isFacedown,
      excludeCards: options.excludeCards || [],
    });
    if (limitCheck && limitCheck.ok === false) {
      return {
        success: false,
        reason: limitCheck.reason || "field_limit",
        code: limitCheck.code || "field_limit",
      };
    }
  }
  if (toZone === "spellTrap" && destArr.length >= 5) {
    this.ui.log("Spell/Trap zone is full (max 5 cards).");
    return { success: false, reason: "spell_trap_full" };
  }

  const zones = [
    "field",
    "hand",
    "deck",
    "graveyard",
    "spellTrap",
    "fieldSpell",
    "extraDeck",
    "banished",
  ];
  let fromOwner = null;
  let fromZone = null;

  const removeFromZone = (owner, zoneName) => {
    if (!owner) return false;
    if (zoneName === "fieldSpell") {
      if (owner.fieldSpell === card) {
        owner.fieldSpell = null;
        return true;
      }
      return false;
    }
    const arr = this.getZone(owner, zoneName) || [];
    let removed = false;
    for (let i = arr.length - 1; i >= 0; i -= 1) {
      if (arr[i] === card) {
        arr.splice(i, 1);
        removed = true;
        break; // Remove only the first occurrence found (iterating backwards)
      }
    }
    return removed;
  };

  const locateAndRemove = (preferredZone = null) => {
    const players = [this.player, this.bot];
    const markFrom = (owner, zoneName) => {
      if (!fromOwner && !fromZone) {
        fromOwner = owner;
        fromZone = zoneName;
      }
    };
    let removedAny = false;
    if (preferredZone) {
      for (const player of players) {
        if (removeFromZone(player, preferredZone)) {
          removedAny = true;
          markFrom(player, preferredZone);
        }
      }
    }

    for (const player of players) {
      for (const zoneName of zones) {
        if (zoneName === preferredZone) continue;
        if (removeFromZone(player, zoneName)) {
          removedAny = true;
          markFrom(player, zoneName);
        }
      }
    }
    return removedAny;
  };

  locateAndRemove(options.fromZone || null);

  if (!fromZone || !fromOwner) {
    return { success: false, reason: "card_not_found" };
  }

  // Send-to-graveyard replacement (e.g. Galaxy Extreme Dragon): if any face-up
  // card on the field has a `passive: { type: "send_to_grave_replacement" }`
  // matching this transfer, redirect the card to its owner's banished zone.
  // Tokens never get redirected — they leave play entirely (handled below).
  let destArrRedirected = null;
  if (
    toZone === "graveyard" &&
    !card.isToken &&
    options?.skipSendToGraveReplacement !== true
  ) {
    const redirectTarget = findSendToGraveReplacementTarget(
      this,
      card,
      fromOwner,
    );
    if (redirectTarget && redirectTarget !== "graveyard") {
      destPlayer = fromOwner;
      toZone = redirectTarget;
      destArrRedirected = this.getZone(destPlayer, toZone);
      if (!Array.isArray(destArrRedirected)) {
        destArrRedirected = null;
      } else {
        this.ui?.log?.(
          `${card.name} is banished instead of being sent to the Graveyard.`,
        );
      }
    }
  }

  const isExtraDeckMonster =
    card.monsterType === "fusion" || card.monsterType === "ascension";
  const allowExtraDeckMonsterToHand =
    options.allowExtraDeckMonsterToHand === true;
  const shouldRedirectExtraDeckMonsterToExtraDeck =
    isExtraDeckMonster &&
    (toZone === "deck" ||
      (toZone === "hand" && !allowExtraDeckMonsterToHand));
  const animationToZone = shouldRedirectExtraDeckMonsterToExtraDeck
    ? "extraDeck"
    : toZone;
  const cardAnimationIntent = buildZoneMoveAnimationIntent(
    this,
    card,
    fromOwner,
    fromZone,
    destPlayer,
    animationToZone,
    options,
  );

  // TOKEN RULE: Tokens cannot exist outside the field.
  // If a token is leaving the field to any other zone, remove it from the game entirely.
  // This handles: destruction, bounce to hand, banish, shuffle to deck, tribute, etc.
  if (card.isToken === true && fromZone === "field" && toZone !== "field") {
    queueZoneMoveAnimation(this, cardAnimationIntent, toZone);

    // Clean up any references that might point to this token
    this.cleanupTokenReferences(card, fromOwner);

    // Log the removal
    this.ui.log(`${card.name} (Token) was removed from the game.`);

    // Update board to reflect removal
    this.updateBoard();

    // Return success with tokenRemoved flag - token is NOT added to any zone
    return { success: true, tokenRemoved: true, fromZone, toZone: null };
  }

  if (card.owner !== fromOwner.id) {
    card.owner = fromOwner.id;
  }

  cleanupNamedBuffsWhenSourceLeavesField(
    this,
    card,
    fromOwner,
    fromZone,
    toZone,
  );

  if (fromZone === "field" && card.cardKind === "monster") {
    card.summonedTurn = null;
    card.setTurn = null;
    card.positionChangedThisTurn = false;
    card.cannotAttackThisTurn = false;
    card.cannotAttackUntilTurn = null;
    card.immuneToOpponentEffectsUntilTurn = null;

    // Clean up temporary stat modifiers from effects (e.g., Shadow-Heart Coward debuff)
    if (card.tempAtkBoost) {
      card.atk -= card.tempAtkBoost;
      if (card.atk < 0) card.atk = 0;
      card.tempAtkBoost = 0;
    }
    if (card.tempDefBoost) {
      card.def -= card.tempDefBoost;
      if (card.def < 0) card.def = 0;
      card.tempDefBoost = 0;
    }
    if (card.originalAtk != null) {
      card.atk = card.originalAtk;
      card.originalAtk = null;
    }
    if (card.originalDef != null) {
      card.def = card.originalDef;
      card.originalDef = null;
    }
    card.effectsNegated = false;

    // Remove permanent named buffs when the monster leaves the field
    if (toZone !== "field" && card.permanentBuffsBySource) {
      let totalAtkBuff = 0;
      let totalDefBuff = 0;
      Object.values(card.permanentBuffsBySource).forEach((buff) => {
        if (buff?.atk) totalAtkBuff += buff.atk;
        if (buff?.def) totalDefBuff += buff.def;
      });
      if (totalAtkBuff) {
        card.atk -= totalAtkBuff;
        if (card.atk < 0) card.atk = 0;
      }
      if (totalDefBuff) {
        card.def -= totalDefBuff;
        if (card.def < 0) card.def = 0;
      }
      delete card.permanentBuffsBySource;
    }
    this.effectEngine?.clearPassiveBuffsForCard(card);

    // Clear field presence ID for field_presence_type_summon_count_buff tracking
    // This resets the counter when the card leaves the field
    if (toZone !== "field") {
      if (
        this.effectEngine &&
        typeof this.effectEngine.clearFieldPresenceId === "function"
      ) {
        this.effectEngine.clearFieldPresenceId(card);
      }

      // ✅ Clear protection effects when card leaves field (duration "while_faceup")
      if (Array.isArray(card.protectionEffects)) {
        card.protectionEffects = card.protectionEffects.filter(
          (p) => p.duration !== "while_faceup"
        );
      }
    }
  }

  // Se um equip spell está saindo da spell/trap zone, limpar seus efeitos no monstro
  // NOTE: This block only runs if equippedTo is still set (not already cleaned by host's cleanup)
  if (
    fromZone === "spellTrap" &&
    card.cardKind === "spell" &&
    card.subtype === "equip" &&
    card.equippedTo
  ) {
    const host = card.equippedTo;

    // Clear equip reference immediately to prevent stale pointers
    card.equippedTo = null;

    // Also clear equipTarget if it points to the same host
    if (card.equipTarget === host) {
      card.equipTarget = null;
    }

    // Remove from host's equips array
    if (host && Array.isArray(host.equips)) {
      const idxEquip = host.equips.indexOf(card);
      if (idxEquip > -1) {
        host.equips.splice(idxEquip, 1);
      }
    }

    // Remove stat bonuses (clamp to 0 to prevent negative stats)
    if (host) {
      if (typeof card.equipAtkBonus === "number" && card.equipAtkBonus !== 0) {
        host.atk = Math.max(0, (host.atk || 0) - card.equipAtkBonus);
        card.equipAtkBonus = 0;
      }

      if (typeof card.equipDefBonus === "number" && card.equipDefBonus !== 0) {
        host.def = Math.max(0, (host.def || 0) - card.equipDefBonus);
        card.equipDefBonus = 0;
      }

      if (
        typeof card.equipExtraAttacks === "number" &&
        card.equipExtraAttacks !== 0
      ) {
        const currentExtra = host.extraAttacks || 0;
        const nextExtra = currentExtra - card.equipExtraAttacks;
        host.extraAttacks = Math.max(0, nextExtra);
        card.equipExtraAttacks = 0;
      }

      const maxAttacksAfterEquipChange = 1 + (host.extraAttacks || 0);
      host.hasAttacked =
        (host.attacksUsedThisTurn || 0) >= maxAttacksAfterEquipChange;

      if (card.grantsBattleIndestructible) {
        host.battleIndestructible = false;
        card.grantsBattleIndestructible = false;
      }

      if (card.grantsCrescentShieldGuard) {
        card.grantsCrescentShieldGuard = false;
      }
    }

    // Generalized equip cleanup: if an equip card has destroyEquippedOnLeave, destroy the equipped monster
    // Check for passive effect with id pattern or explicit flag on card
    const hasDestroyOnLeaveEffect = (card.effects || []).some(
      (e) => e && e.timing === "passive" && e.id && e.id.includes("destroy_on_leave")
    );
    if ((card.destroyEquippedOnLeave || hasDestroyOnLeaveEffect) && host) {
      const hostOwner = host.owner === "player" ? this.player : this.bot;
      this.destroyCard(host, {
        cause: "effect",
        sourceCard: card,
        opponent: this.getOpponent(hostOwner),
      }).then((result) => {
        if (result?.destroyed) {
          this.ui.log(
            `${host.name} is destroyed as ${card.name} left the field.`
          );
          this.updateBoard();
        }
      });
    }
  }

  if (
    fromZone === "spellTrap" &&
    toZone !== "spellTrap" &&
    (card?.state?.blueprintStorage || card?.blueprintStorage)
  ) {
    this.effectEngine?.clearBlueprintStorage?.(card);
  }

  if (toZone === "fieldSpell") {
    if (destPlayer.fieldSpell) {
      this.moveCard(destPlayer.fieldSpell, destPlayer, "graveyard", {
        fromZone: "fieldSpell",
      });
    }

    if (options.position) {
      card.position = options.position;
    }
    if (typeof options.isFacedown === "boolean") {
      card.isFacedown = options.isFacedown;
    }

    card.owner = destPlayer.id;
    card.controller = destPlayer.id;
    destPlayer.fieldSpell = card;
    if (this.devModeEnabled && this.devFailAfterZoneMutation) {
      this.devFailAfterZoneMutation = false;
      throw new Error("DEV_ZONE_MUTATION_FAIL");
    }
    queueZoneMoveAnimation(this, cardAnimationIntent, "fieldSpell");
    return { success: true, fromZone, toZone };
  }

  // STATE-BASED CLEANUP: If a monster leaves the field to ANY other zone,
  // send attached equip spells to the graveyard (state-based rule).
  if (
    fromZone === "field" &&
    toZone !== "field" &&
    card.cardKind === "monster"
  ) {
    const equipZone = this.getZone(fromOwner, "spellTrap") || [];
    const attachedEquips = equipZone.filter(
      (eq) =>
        eq &&
        eq.cardKind === "spell" &&
        eq.subtype === "equip" &&
        (eq.equippedTo === card || eq.equipTarget === card)
    );

    // Process equips synchronously to ensure deterministic state
    // IMPORTANT: Remove bonuses and clear refs BEFORE moving equips to GY
    // This prevents the equip's own moveCard path from trying to cleanup again
    for (const equip of attachedEquips) {
      // Remove bonuses from host (with clamp) - do this BEFORE clearing refs
      if (
        typeof equip.equipAtkBonus === "number" &&
        equip.equipAtkBonus !== 0
      ) {
        card.atk = Math.max(0, (card.atk || 0) - equip.equipAtkBonus);
        equip.equipAtkBonus = 0;
      }
      if (
        typeof equip.equipDefBonus === "number" &&
        equip.equipDefBonus !== 0
      ) {
        card.def = Math.max(0, (card.def || 0) - equip.equipDefBonus);
        equip.equipDefBonus = 0;
      }
      if (
        typeof equip.equipExtraAttacks === "number" &&
        equip.equipExtraAttacks !== 0
      ) {
        const currentExtra = card.extraAttacks || 0;
        card.extraAttacks = Math.max(0, currentExtra - equip.equipExtraAttacks);
        equip.equipExtraAttacks = 0;
      }
      if (equip.grantsBattleIndestructible) {
        card.battleIndestructible = false;
        equip.grantsBattleIndestructible = false;
      }
      if (equip.grantsCrescentShieldGuard) {
        equip.grantsCrescentShieldGuard = false;
      }

      // Remove from host's equips array
      if (Array.isArray(card.equips)) {
        const idx = card.equips.indexOf(equip);
        if (idx > -1) card.equips.splice(idx, 1);
      }

      // Clear equip references AFTER removing bonuses
      if (equip.equippedTo === card) {
        equip.equippedTo = null;
      }
      if (equip.equipTarget === card) {
        equip.equipTarget = null;
      }

      // Move equip to graveyard - refs already cleared, so equip's cleanup block will be skipped
      this.moveCard(equip, fromOwner, "graveyard", {
        fromZone: "spellTrap",
      });
    }

    // Se o monstro foi revivido por Call of the Haunted, destruir a trap também
    if (card.callOfTheHauntedTrap) {
      const callTrap = card.callOfTheHauntedTrap;
      card.callOfTheHauntedTrap = null; // Clear reference before destroy

      // Destroy trap - refs already cleared, state is consistent regardless of result
      this.destroyCard(callTrap, {
        cause: "effect",
        sourceCard: card,
        opponent: this.getOpponent(fromOwner),
      }).then((result) => {
        if (result?.destroyed) {
          this.ui.log(
            `${callTrap.name} was destroyed as ${card.name} left the field.`
          );
          this.updateBoard();
        }
      });
    }
  }

  // If a continuous trap with a bound target leaves spellTrap zone, destroy the bound target
  // This implements the generic "destroy bound monster when trap leaves field" pattern
  // Used by: Call of the Haunted, and any future traps with similar mechanics
  if (
    fromZone === "spellTrap" &&
    toZone !== "spellTrap" &&
    card.cardKind === "trap" &&
    card.subtype === "continuous" &&
    card.boundMonsterTarget
  ) {
    const revivedMonster = card.boundMonsterTarget;
    card.boundMonsterTarget = null; // Clear reference BEFORE destroy - state is consistent

    const monsterOwner =
      revivedMonster.owner === "player" ? this.player : this.bot;
    // Destroy is fire-and-forget but safe - ref already cleared, state is consistent
    this.destroyCard(revivedMonster, {
      cause: "effect",
      sourceCard: card,
      opponent: this.getOpponent(monsterOwner),
    }).then((result) => {
      if (result?.destroyed) {
        this.ui.log(
          `${revivedMonster.name} was destroyed as ${card.name} left the field.`
        );
        this.updateBoard();
      }
    });
  }

  // LEGACY SUPPORT: Also check callOfTheHauntedTarget for backwards compatibility
  // TODO: Migrate cards using callOfTheHauntedTarget to use boundMonsterTarget instead
  if (
    fromZone === "spellTrap" &&
    toZone !== "spellTrap" &&
    card.cardKind === "trap" &&
    card.subtype === "continuous" &&
    card.callOfTheHauntedTarget
  ) {
    const revivedMonster = card.callOfTheHauntedTarget;
    card.callOfTheHauntedTarget = null;

    const monsterOwner =
      revivedMonster.owner === "player" ? this.player : this.bot;
    this.destroyCard(revivedMonster, {
      cause: "effect",
      sourceCard: card,
      opponent: this.getOpponent(monsterOwner),
    }).then((result) => {
      if (result?.destroyed) {
        this.ui.log(
          `${revivedMonster.name} was destroyed as ${card.name} left the field.`
        );
        this.updateBoard();
      }
    });
  }

  if (options.position) {
    card.position = options.position;
  }
  if (typeof options.isFacedown === "boolean") {
    card.isFacedown = options.isFacedown;
  }
  if (options.resetAttackFlags) {
    card.hasAttacked = false;
    card.cannotAttackThisTurn = false;
    card.attacksUsedThisTurn = 0;
    card.canMakeSecondAttackThisTurn = false;
    card.secondAttackUsedThisTurn = false;
  }

  card.owner = destPlayer.id;
  card.controller = destPlayer.id;

  // Special case: Extra Deck monsters returning to hand/deck go back to Extra Deck instead
  if (shouldRedirectExtraDeckMonsterToExtraDeck) {
    const extraDeck = this.getZone(destPlayer, "extraDeck");
    if (extraDeck) {
      extraDeck.push(card);
      this.ui.log(`${card.name} returned to Extra Deck.`);
      if (this.devModeEnabled && this.devFailAfterZoneMutation) {
        this.devFailAfterZoneMutation = false;
        throw new Error("DEV_ZONE_MUTATION_FAIL");
      }
      queueZoneMoveAnimation(this, cardAnimationIntent, "extraDeck");
      return { success: true, fromZone, toZone: "extraDeck" };
    }
  }

  // 🔍 FINAL VALIDATION: Double-check before push (defensive programming)
  if (toZone === "field" && card.cardKind !== "monster") {
    console.error(
      `[moveCardInternal] 🚨 CRITICAL: About to push non-monster to field!`,
      { card: card.name, cardKind: card.cardKind, toZone, stack: new Error().stack }
    );
    // Block it here too as last resort
    this.ui?.log?.(`CRITICAL ERROR: ${card.cardKind} cannot go to monster zone`);
    return { success: false, reason: "invalid_card_kind_final_check" };
  }

  if (
    toZone === "field" &&
    card.cardKind === "monster" &&
    fromZone !== "field" &&
    options.skipSummonAttempt !== true &&
    typeof this.offerSummonAttempt === "function"
  ) {
    const summonMethod = options.summonMethodOverride || "special";
    const attempt = await this.offerSummonAttempt(card, destPlayer, {
      method: summonMethod,
      fromZone,
      summonProcedure: options.summonProcedure || null,
    });
    if (attempt?.negated) {
      destPlayer.graveyard = destPlayer.graveyard || [];
      if (!destPlayer.graveyard.includes(card)) {
        destPlayer.graveyard.push(card);
      }
      card.owner = destPlayer.id;
      card.controller = destPlayer.id;
      card.location = "graveyard";
      this.updateBoard?.();
      return { success: false, negated: true, reason: "summon_negated" };
    }
  }

  const finalDestArr = destArrRedirected || destArr;
  finalDestArr.push(card);
  if (toZone === "banished") {
    card.location = "banished";
  }

  if (this.devModeEnabled && this.devFailAfterZoneMutation) {
    this.devFailAfterZoneMutation = false;
    throw new Error("DEV_ZONE_MUTATION_FAIL");
  }

  queueZoneMoveAnimation(this, cardAnimationIntent, toZone);

  if (
    toZone === "field" &&
    card.cardKind === "monster" &&
    fromZone !== "field"
  ) {
    card.enteredFieldTurn = this.turnCounter;
    card.summonedTurn = this.turnCounter;
    card.positionChangedThisTurn = false;
    if (card.isFacedown) {
      card.setTurn = this.turnCounter;
      // Facedown monsters don't have revealedTurn yet - will be set when flipped
      card.revealedTurn = null;
    } else {
      card.setTurn = null;
      // Face-up summons don't need revealedTurn - summonedTurn is used for Ascension timing
      card.revealedTurn = null;
    }

    // Assign field presence ID for field_presence_type_summon_count_buff tracking
    if (
      this.effectEngine &&
      typeof this.effectEngine.assignFieldPresenceId === "function"
    ) {
      this.effectEngine.assignFieldPresenceId(card);
    }

    const ownerPlayer = card.owner === "player" ? this.player : this.bot;
    const otherPlayer = ownerPlayer === this.player ? this.bot : this.player;
    const summonMethod = options.summonMethodOverride || "special";
    await this.emit("after_summon", {
      card,
      player: ownerPlayer,
      opponent: otherPlayer,
      method: summonMethod,
      fromZone,
      position: options.position || card.position || null,
      sourceCard: options.sourceCard || options.source || null,
      source: options.source || options.sourceCard || null,
      effectId: options.effectId || null,
    });
  }

  if (toZone === "graveyard") {
    // Don't emit card_to_grave if the card is already in graveyard (moving within same zone)
    // This prevents infinite loops where effects like Specter trigger repeatedly
    if (fromZone === "graveyard") {
      return { success: true, fromZone, toZone };
    }

    const ownerPlayer = card.owner === "player" ? this.player : this.bot;
    const otherPlayer = ownerPlayer === this.player ? this.bot : this.player;

    console.log(
      `[moveCard] Emitting card_to_grave event for ${card.name} (fromZone: ${fromZone})`
    );
    const cardToGraveEvent = this.emit("card_to_grave", {
      card,
      fromZone: fromZone || options.fromZone || null,
      toZone: "graveyard",
      player: ownerPlayer,
      opponent: otherPlayer,
      wasDestroyed: options.wasDestroyed || false,
      destroyCause: options.destroyCause || null,
      destroySource:
        options.destroySource || options.sourceCard || options.source || null,
    });
    if (options.awaitEvents === true || options.awaitCardToGraveEvent === true) {
      await cardToGraveEvent;
    } else {
      void cardToGraveEvent;
    }
  }

  // Limpar cache de targeting após mover cartas (estado do jogo mudou)
  if (this.effectEngine?.clearTargetingCache) {
    this.effectEngine.clearTargetingCache();
  }

  return { success: true, fromZone, toZone };
}
