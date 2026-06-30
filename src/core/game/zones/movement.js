import { restoreTrapMonsterOriginalState } from "../../Card.js";

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

  // If this token was revived by a bound continuous trap, clear that reference
  // and destroy the trap.
  const boundTrap = token.boundTrapSource || token.callOfTheHauntedTrap;
  if (boundTrap) {
    const trap = boundTrap;
    if (trap.boundMonsterTarget === token) {
      trap.boundMonsterTarget = null;
    }
    if (trap.callOfTheHauntedTarget === token) {
      trap.callOfTheHauntedTarget = null;
    }
    token.boundTrapSource = null;
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

function applyStatusesOnSummon(card, statuses) {
  if (!card || !statuses) return;
  const statusEntries = Array.isArray(statuses) ? statuses : [statuses];
  for (const entry of statusEntries) {
    if (!entry) continue;
    const status =
      typeof entry === "string"
        ? entry
        : typeof entry.status === "string"
          ? entry.status
          : null;
    if (!status) continue;
    const value =
      typeof entry === "object" && Object.prototype.hasOwnProperty.call(entry, "value")
        ? entry.value
        : true;
    card[status] = value;
  }
}

const OWNER_RETURN_ZONES = new Set([
  "graveyard",
  "hand",
  "deck",
  "extraDeck",
  "banished",
]);

function getPlayerById(game, playerId) {
  if (!game || !playerId) return null;
  if (game.player?.id === playerId) return game.player;
  if (game.bot?.id === playerId) return game.bot;
  return null;
}

function ensureOriginalOwner(card, fallbackOwnerId) {
  if (!card) return null;
  if (!card.originalOwner && fallbackOwnerId) {
    card.originalOwner = fallbackOwnerId;
  }
  return card.originalOwner || fallbackOwnerId || card.owner || null;
}

function resolveOriginalOwnerDestination(game, card, fromZone, toZone, fromOwner) {
  if (
    !card ||
    fromZone !== "field" ||
    toZone === "field" ||
    !OWNER_RETURN_ZONES.has(toZone)
  ) {
    return null;
  }

  const originalOwnerId = ensureOriginalOwner(card, fromOwner?.id || card.owner);
  return getPlayerById(game, originalOwnerId);
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

async function emitCardMovedEvent(game, card, fromOwner, destPlayer, fromZone, toZone, options = {}) {
  if (!game || !card || !fromZone || !toZone || fromZone === toZone) {
    return null;
  }

  game.updateBoard?.();

  const currentOwner = card.owner === "player" ? game.player : game.bot;
  const eventPlayer = currentOwner || destPlayer || fromOwner || null;
  const eventOpponent = eventPlayer
    ? game.getOpponent?.(eventPlayer) || null
    : null;
  const movementSourceCard = options.sourceCard || options.source || null;
  const movedByEffect =
    typeof options.movedByEffect === "boolean"
      ? options.movedByEffect
      : Boolean(movementSourceCard || options.effectId);

  const eventResult = game.emit?.("card_moved", {
    card,
    fromZone,
    toZone,
    player: eventPlayer,
    opponent: eventOpponent,
    fromPlayer: fromOwner,
    toPlayer: destPlayer,
    sourceCard: movementSourceCard,
    source: movementSourceCard,
    effectId: options.effectId || null,
    contextLabel: options.contextLabel || null,
    movedByEffect,
    wasFaceupBeforeMove:
      typeof options.wasFaceupBeforeMove === "boolean"
        ? options.wasFaceupBeforeMove
        : card.isFacedown !== true,
    actionContext: options.actionContext || null,
  });

  if (
    eventResult &&
    typeof eventResult.then === "function" &&
    (options.awaitEvents === true || options.awaitCardMovedEvent === true)
  ) {
    return await eventResult;
  }

  if (eventResult && typeof eventResult.then === "function") {
    void eventResult;
  }
  return eventResult || null;
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

async function presentSummonBeforeAfterSummon(game, options = {}) {
  if (options.presentBeforeAfterSummon === false) return;

  const boardPresentation = game?.updateBoard?.();

  if (typeof game?.waitForBoardPresentation === "function") {
    await game.waitForBoardPresentation();
  } else if (boardPresentation && typeof boardPresentation.then === "function") {
    await boardPresentation.catch(() => {});
  } else if (typeof game?.waitForPresentationDelay === "function") {
    await game.waitForPresentationDelay(250);
  }

  if (
    Number.isFinite(options.summonPresentationDelayMs) &&
    typeof game?.waitForPresentationDelay === "function"
  ) {
    const delayMs = options.summonPresentationDelayMs;
    await game.waitForPresentationDelay(delayMs);
  }
}

function getFollowupPlayer(game, entry, fallbackPlayer) {
  if (!game || !entry?.ownerId) return fallbackPlayer || null;
  if (game.player?.id === entry.ownerId) return game.player;
  if (game.bot?.id === entry.ownerId) return game.bot;
  return fallbackPlayer || null;
}

async function applySynchroMaterialFollowupsBeforeAfterSummon(
  game,
  summonedCard,
  ownerPlayer,
  otherPlayer,
  followups = [],
  options = {},
) {
  if (
    !game?.effectEngine ||
    !summonedCard ||
    !Array.isArray(followups) ||
    followups.length === 0
  ) {
    return null;
  }

  for (const entry of followups) {
    const actions = Array.isArray(entry?.actions) ? entry.actions : [];
    if (actions.length === 0) continue;

    const followupPlayer = getFollowupPlayer(game, entry, ownerPlayer);
    const followupOpponent =
      followupPlayer && typeof game.getOpponent === "function"
        ? game.getOpponent(followupPlayer)
        : otherPlayer;
    const actionContext = {
      ...(options.actionContext || {}),
      synchroMaterialFollowup: true,
      synchroSummonContextId: entry.synchroSummonContextId || null,
    };
    const ctx = {
      source: entry.source || null,
      player: followupPlayer || ownerPlayer,
      opponent: followupOpponent || otherPlayer,
      summonedCard,
      synchroSummonedCard: summonedCard,
      summonMethod: options.summonMethod || "synchro",
      summonProcedure: options.summonProcedure || "synchro",
      actionContext,
      activationContext: {
        source: entry.source || null,
        player: followupPlayer || ownerPlayer,
        sourceZone: "graveyard",
        activationZone: "graveyard",
        actionContext,
      },
    };
    const targets = {
      synchro_summoned_card: [summonedCard],
      summonedCard: [summonedCard],
    };
    const result = await game.effectEngine.applyActions(actions, ctx, targets);
    if (result?.needsSelection) {
      return result;
    }
    if (result?.success === false) {
      game.devLog?.("SYNCHRO_MATERIAL_FOLLOWUP_FAILED", {
        source: entry.sourceName || entry.source?.name || null,
        reason: result.reason || null,
      });
    }
  }

  return null;
}

export async function applyPendingSynchroMaterialFollowups(
  summonedCard,
  ownerPlayer = null,
  followups = [],
  options = {},
) {
  const resolvedOwner =
    ownerPlayer ||
    (summonedCard?.owner === "player" ? this.player : this.bot);
  const otherPlayer =
    resolvedOwner && typeof this.getOpponent === "function"
      ? this.getOpponent(resolvedOwner)
      : resolvedOwner === this.player
        ? this.bot
        : this.player;

  return await applySynchroMaterialFollowupsBeforeAfterSummon(
    this,
    summonedCard,
    resolvedOwner,
    otherPlayer,
    followups,
    options,
  );
}

function hasMatchingDestroyedGraveyardTrigger(card, fromZone, options = {}) {
  if (!card || card.cardKind !== "monster") return false;
  if (fromZone !== "field" || options.wasDestroyed !== true) return false;

  const destroyCause = options.destroyCause || null;
  if (destroyCause !== "battle" && destroyCause !== "effect") return false;

  return (card.effects || []).some((effect) => {
    if (!effect || effect.timing !== "on_event") return false;
    if (effect.event !== "card_to_grave") return false;
    if (effect.requireSelfAsDestroyed !== true) return false;
    if (
      effect.fromZone &&
      effect.fromZone !== "any" &&
      effect.fromZone !== fromZone
    ) {
      return false;
    }

    const conditionType = effect.condition?.type || null;
    if (conditionType === "destroyed_by_battle") {
      return destroyCause === "battle";
    }
    if (conditionType === "destroyed_by_effect") {
      return destroyCause === "effect";
    }
    if (conditionType === "destroyed_by_battle_or_effect") {
      return true;
    }
    return false;
  });
}

async function presentDestroyedGraveyardTrigger(game, card, options = {}) {
  if (options.presentBeforeCardToGrave === false) return false;

  card.graveyardEffectActivating = true;
  game?.updateBoard?.();

  if (typeof game?.waitForPresentationDelay === "function") {
    const delayMs = Number.isFinite(options.graveyardActivationDelayMs)
      ? options.graveyardActivationDelayMs
      : 350;
    await game.waitForPresentationDelay(delayMs);
  }

  return true;
}

const FIELD_SOURCE_ZONES = new Set(["field", "spellTrap", "fieldSpell"]);
const MOVE_CARD_SEARCH_ZONES = [
  "field",
  "hand",
  "deck",
  "graveyard",
  "spellTrap",
  "fieldSpell",
  "extraDeck",
  "banished",
];

function findCardLocation(game, card, preferredZone = null) {
  if (!game || !card) return null;
  const players = [game.player, game.bot].filter(Boolean);
  const zones = preferredZone
    ? [
        preferredZone,
        ...MOVE_CARD_SEARCH_ZONES.filter((zone) => zone !== preferredZone),
      ]
    : MOVE_CARD_SEARCH_ZONES;

  for (const owner of players) {
    for (const zoneName of zones) {
      if (zoneName === "fieldSpell") {
        if (owner.fieldSpell === card) return { owner, zone: zoneName };
        continue;
      }
      const zone = game.getZone?.(owner, zoneName) || owner[zoneName] || [];
      if (Array.isArray(zone) && zone.includes(card)) {
        return { owner, zone: zoneName };
      }
    }
  }
  return null;
}

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

function asArray(value, fallback = []) {
  if (value === undefined || value === null) return fallback;
  return Array.isArray(value) ? value : [value];
}

function buildBanishProtectionFilters(passive = {}) {
  const scope = passive.targetScope || {};
  const filters = { ...(scope.filters || passive.filters || {}) };
  for (const key of [
    "cardKind",
    "cardName",
    "name",
    "cardId",
    "cardIds",
    "subtype",
    "monsterType",
    "type",
    "archetype",
    "level",
    "levelOp",
    "minLevel",
    "maxLevel",
    "requireFaceup",
    "isToken",
    "isTuner",
  ]) {
    const value = scope[key] ?? passive[key];
    if (value !== undefined && filters[key] === undefined) {
      filters[key] = value;
    }
  }
  return filters;
}

function banishProtectionAppliesToCard(game, card, cardOwner, cardZone) {
  if (!game || !card || !cardOwner) return null;

  const sourceOwners = [game.player, game.bot].filter(Boolean);
  for (const sourceOwner of sourceOwners) {
    const sources = [
      ...(sourceOwner.field || []),
      ...(sourceOwner.spellTrap || []),
      sourceOwner.fieldSpell,
    ].filter(Boolean);

    for (const sourceCard of sources) {
      if (!sourceCard || sourceCard.isFacedown) continue;
      if (game.effectEngine?.isEffectNegated?.(sourceCard)) continue;

      const sourceZone =
        game.findCardZone?.(sourceOwner, sourceCard) ||
        findCardLocation(game, sourceCard)?.zone ||
        null;
      const effects = Array.isArray(sourceCard.effects)
        ? sourceCard.effects
        : [];
      for (const effect of effects) {
        if (!effect || effect.timing !== "passive") continue;
        const passive = effect.passive || {};
        if (passive.type !== "banish_protection") continue;
        if (effect.requireZone && effect.requireZone !== sourceZone) continue;
        if (
          (effect.requireFaceup === true || passive.requireFaceup === true) &&
          sourceCard.isFacedown
        ) {
          continue;
        }

        const scope = passive.targetScope || {};
        const ownerRule = scope.owner || passive.targetOwner || "self";
        if (ownerRule !== "any" && ownerRule !== "both") {
          const expectedOwner =
            ownerRule === "opponent"
              ? game.getOpponent?.(sourceOwner)
              : sourceOwner;
          if (expectedOwner !== cardOwner) continue;
        }

        const zones = asArray(scope.zones ?? scope.zone ?? passive.zones ?? passive.zone, [
          "field",
        ]);
        if (!zones.includes(cardZone)) continue;
        if ((scope.excludeSelf || passive.excludeSelf) && card === sourceCard) {
          continue;
        }

        const filters = buildBanishProtectionFilters(passive);
        if (
          Object.keys(filters).length > 0 &&
          !game.effectEngine?.cardMatchesFilters?.(card, filters)
        ) {
          continue;
        }

        return { sourceCard, effect, passive };
      }
    }
  }

  return null;
}

function getSendToGraveReplacementSources(game) {
  const players = [game?.player, game?.bot].filter(Boolean);
  const entries = [];
  for (const owner of players) {
    for (const zoneName of ["field", "spellTrap", "fieldSpell"]) {
      const zoneCards =
        zoneName === "fieldSpell"
          ? owner.fieldSpell
            ? [owner.fieldSpell]
            : []
          : Array.isArray(owner[zoneName])
            ? owner[zoneName]
            : [];
      for (const card of zoneCards) {
        if (!card) continue;
        entries.push({ sourceCard: card, sourceOwner: owner, sourceZone: zoneName });
      }
    }
  }
  return entries;
}

function relationMatches(game, sourceOwner, targetOwner, rule = "self") {
  if (rule === "any") return true;
  if (!sourceOwner || !targetOwner) return false;
  if (rule === "self") return sourceOwner === targetOwner;
  if (rule === "opponent") {
    return game?.getOpponent?.(sourceOwner) === targetOwner;
  }
  return false;
}

function matchesSendToGraveReplacement(game, replacement, sourceCard, ctx) {
  const { card, fromOwner, fromZone, sourceOwner } = ctx;
  if (!replacement || replacement.type !== "send_to_grave") return false;
  if (!card || !fromOwner || !fromZone || !sourceCard || !sourceOwner) return false;

  if (
    (replacement.targetMustNotBeSource === true ||
      replacement.excludeSource === true) &&
    card === sourceCard
  ) {
    return false;
  }

  const targetOwnerRule =
    replacement.targetOwner || replacement.appliesTo || "self";
  if (!relationMatches(game, sourceOwner, fromOwner, targetOwnerRule)) {
    return false;
  }

  const targetZones = replacement.targetZones
    ? replacement.targetZones
    : replacement.targetZone
      ? [replacement.targetZone]
      : ["field"];
  if (targetZones.length > 0 && !targetZones.includes(fromZone)) {
    return false;
  }

  const targetRequireFaceup =
    replacement.targetRequireFaceup !== false &&
    replacement.allowFacedown !== true;
  if (targetRequireFaceup && card.isFacedown) return false;

  const filters = replacement.targetFilters || {};
  if (
    Object.keys(filters).length > 0 &&
    !game.effectEngine?.cardMatchesFilters?.(card, filters)
  ) {
    return false;
  }

  return true;
}

async function trySendToGraveActionReplacement(game, card, destPlayer, options = {}) {
  if (!game || !card || card.isToken) return { replaced: false };
  if (options?.skipSendToGraveReplacement === true) return { replaced: false };
  if (options?.skipSendToGraveActionReplacement === true) {
    return { replaced: false };
  }

  const location = findCardLocation(game, card, options.fromZone || null);
  if (!location || location.zone !== "field") return { replaced: false };

  for (const { sourceCard, sourceOwner, sourceZone } of getSendToGraveReplacementSources(game)) {
    if (!sourceCard || sourceCard.isFacedown) continue;
    if (game.effectEngine?.isEffectNegated?.(sourceCard)) continue;

    for (const effect of sourceCard.effects || []) {
      const replacement = effect?.replacementEffect;
      if (!replacement || replacement.type !== "send_to_grave") continue;
      if (effect.requireZone && effect.requireZone !== sourceZone) continue;
      if (effect.requireFaceup === true && sourceCard.isFacedown) continue;
      if (
        !matchesSendToGraveReplacement(game, replacement, sourceCard, {
          card,
          fromOwner: location.owner,
          fromZone: location.zone,
          sourceOwner,
        })
      ) {
        continue;
      }

      const optCheck = game.canUseOncePerTurn?.(sourceCard, sourceOwner, effect);
      if (optCheck && optCheck.ok === false) continue;

      const opponent = game.getOpponent?.(sourceOwner) || null;
      const replacementCtx = {
        player: sourceOwner,
        opponent,
        source: sourceCard,
        movedCard: card,
        eventCard: card,
        fromZone: location.zone,
        toZone: "graveyard",
        activationContext: {
          source: sourceCard,
          player: sourceOwner,
          sourceZone,
          activationZone: sourceZone,
        },
      };
      const actions = Array.isArray(effect.actions) ? effect.actions : [];
      if (actions.length === 0) continue;

      const preview =
        typeof game.effectEngine?.checkActionPreviewRequirements === "function"
          ? game.effectEngine.checkActionPreviewRequirements(
              actions,
              {
                ...replacementCtx,
                preview: true,
                isPreview: true,
                activationContext: {
                  ...replacementCtx.activationContext,
                  preview: true,
                  isPreview: true,
                },
              },
            )
          : { ok: true };
      if (preview?.ok === false) continue;

      if (sourceOwner.controllerType === "human" && replacement.auto !== true) {
        const prompt =
          replacement.prompt ||
          `Use ${sourceCard.name} to replace sending ${card.name} to the Graveyard?`;
        const wantsToReplace =
          (await game.ui?.showConfirmPrompt?.(prompt, {
            kind: "send_to_grave_replacement",
            cardName: card.name,
          })) ?? false;
        if (!wantsToReplace) continue;
      }

      const result = await game.effectEngine.applyActions(
        actions,
        replacementCtx,
        {},
      );
      const success =
        result === true ||
        (result &&
          typeof result === "object" &&
          result.success !== false &&
          result.needsSelection !== true);
      if (!success) continue;

      game.markOncePerTurnUsed?.(sourceCard, sourceOwner, effect);
      if (replacement.logMessage) {
        game.ui?.log?.(
          replacement.logMessage
            .replace("{target}", card.name)
            .replace("{source}", sourceCard.name),
        );
      }
      const finalLocation = findCardLocation(game, card, null);
      return {
        replaced: true,
        fromZone: location.zone,
        toZone: finalLocation?.zone || "deck",
      };
    }
  }

  return { replaced: false };
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

  if (filters.isTuner !== undefined) {
    if ((card.isTuner === true) !== Boolean(filters.isTuner)) return false;
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

const SPECIAL_SUMMON_METHODS = new Set(["special", "fusion", "ascension", "synchro"]);

function isRestrictedSpecialSummonMethod(method) {
  return SPECIAL_SUMMON_METHODS.has(method);
}

function getSummonMethodFromOptions(options = {}) {
  return (
    options.summonMethod ||
    options.summonMethodOverride ||
    options.method ||
    null
  );
}

function cardMatchesRestrictionFilters(game, card, filters = {}) {
  if (!filters || typeof filters !== "object") return true;
  if (typeof game?.effectEngine?.cardMatchesFilters === "function") {
    return game.effectEngine.cardMatchesFilters(card, filters);
  }
  return cardMatchesFieldLimitFilters(card, filters);
}

function normalizeSpecialSummonRestriction(game, restriction = {}) {
  const duration = restriction.duration || "until_end_turn";
  const expiresOnTurn =
    duration === "until_end_turn"
      ? game?.turnCounter || 0
      : Number.isFinite(restriction.expiresOnTurn)
        ? restriction.expiresOnTurn
        : null;
  return {
    allowedFilters: { ...(restriction.allowedFilters || {}) },
    duration,
    expiresOnTurn,
    reason: restriction.reason || null,
    sourceName: restriction.sourceName || restriction.sourceCard?.name || null,
    sourceId: restriction.sourceId || restriction.sourceCard?.id || null,
    effectId: restriction.effectId || null,
  };
}

export function registerSpecialSummonRestriction(player, restriction = {}) {
  if (!player || !restriction?.allowedFilters) return false;
  if (!player.specialSummonRestrictions) {
    player.specialSummonRestrictions = [];
  }
  player.specialSummonRestrictions.push(
    normalizeSpecialSummonRestriction(this, restriction),
  );
  this.effectEngine?.clearTargetingCache?.();
  this.updateBoard?.();
  return true;
}

export function cleanupExpiredSpecialSummonRestrictions(player = null) {
  const players = player ? [player] : [this?.player, this?.bot].filter(Boolean);
  const currentTurn = Number(this?.turnCounter || 0);
  for (const entryPlayer of players) {
    const restrictions = Array.isArray(entryPlayer?.specialSummonRestrictions)
      ? entryPlayer.specialSummonRestrictions
      : [];
    entryPlayer.specialSummonRestrictions = restrictions.filter((restriction) => {
      if (!restriction || restriction.duration !== "until_end_turn") return true;
      if (!Number.isFinite(restriction.expiresOnTurn)) return true;
      return restriction.expiresOnTurn >= currentTurn;
    });
  }
}

export function canSpecialSummonUnderRestrictions(card, player, options = {}) {
  if (!card || !player) {
    return { ok: false, reason: "Invalid Special Summon restriction check." };
  }
  const method = getSummonMethodFromOptions(options) || "special";
  if (!isRestrictedSpecialSummonMethod(method)) {
    return { ok: true };
  }

  this.cleanupExpiredSpecialSummonRestrictions?.(player);
  const restrictions = Array.isArray(player.specialSummonRestrictions)
    ? player.specialSummonRestrictions
    : [];
  for (const restriction of restrictions) {
    if (!restriction?.allowedFilters) continue;
    if (cardMatchesRestrictionFilters(this, card, restriction.allowedFilters)) {
      continue;
    }
    const reason =
      restriction.reason ||
      `${player.name || "Player"} cannot Special Summon ${card.name || "that card"} under the current restriction.`;
    if (options.silent !== true) this?.ui?.log?.(reason);
    return {
      ok: false,
      reason,
      code: "special_summon_restricted",
      restriction,
    };
  }
  return { ok: true };
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

  const summonMethod = getSummonMethodFromOptions(options);
  if (isRestrictedSpecialSummonMethod(summonMethod)) {
    const restrictionCheck = this.canSpecialSummonUnderRestrictions?.(
      card,
      destPlayer,
      {
        ...options,
        summonMethod,
      },
    );
    if (restrictionCheck?.ok === false) return restrictionCheck;
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

function cleanupLinkedPermanentBuffsWhenSourceLeavesField(game, card, fromZone, toZone) {
  if (!FIELD_SOURCE_ZONES.has(fromZone) || fromZone === toZone) return;
  const sourceNames = Array.isArray(card?.linkedPermanentBuffSourceNames)
    ? card.linkedPermanentBuffSourceNames
    : [];
  if (sourceNames.length === 0) return;

  const allMonsters = [
    ...(game?.player?.field || []),
    ...(game?.bot?.field || []),
  ].filter(Boolean);
  let anyRemoved = false;

  for (const sourceName of sourceNames) {
    for (const target of allMonsters) {
      anyRemoved = removeNamedBuffFromCard(target, sourceName) || anyRemoved;
    }
  }

  delete card.linkedPermanentBuffSourceNames;

  if (anyRemoved) {
    game?.effectEngine?.clearTargetingCache?.();
  }
}

function cleanupDeclaredValuesWhenSourceLeavesActiveZone(card, fromZone, toZone) {
  if (!FIELD_SOURCE_ZONES.has(fromZone) || fromZone === toZone) return;
  if (card?.declaredValues && typeof card.declaredValues === "object") {
    delete card.declaredValues;
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
    const summonMethod = options.summonMethodOverride || "special";
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
      summonMethod,
      summonProcedure,
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

  if (
    toZone === "graveyard" &&
    options?.skipSendToGraveReplacement !== true &&
    options?.skipSendToGraveActionReplacement !== true
  ) {
    const replacementResult = await trySendToGraveActionReplacement(
      this,
      card,
      destPlayer,
      options,
    );
    if (replacementResult?.replaced) {
      return {
        success: true,
        replaced: true,
        fromZone: replacementResult.fromZone || options.fromZone || null,
        toZone: replacementResult.toZone || "deck",
      };
    }
  }

  const initialLocation = findCardLocation(this, card, options.fromZone || null);
  if (initialLocation) {
    let projectedToZone = toZone;
    if (
      projectedToZone === "graveyard" &&
      !card.isToken &&
      options?.skipSendToGraveReplacement !== true
    ) {
      const redirectTarget = findSendToGraveReplacementTarget(
        this,
        card,
        initialLocation.owner,
      );
      if (redirectTarget) {
        projectedToZone = redirectTarget;
      }
    }
    if (
      initialLocation.zone === "field" &&
      projectedToZone !== "field" &&
      card.banishWhenLeavesField === true &&
      !card.isToken
    ) {
      projectedToZone = "banished";
    }
    if (projectedToZone === "banished") {
      const protection = banishProtectionAppliesToCard(
        this,
        card,
        initialLocation.owner,
        initialLocation.zone,
      );
      if (protection) {
        this.ui?.log?.(
          `${card.name} cannot be banished while ${protection.sourceCard.name} is face-up.`,
        );
        return { success: false, reason: "banish_protected" };
      }
    }
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
  ensureOriginalOwner(card, fromOwner.id);

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

  if (
    fromZone === "field" &&
    toZone !== "field" &&
    card.banishWhenLeavesField === true &&
    !card.isToken
  ) {
    delete card.banishWhenLeavesField;
    if (toZone !== "banished") {
      destPlayer = fromOwner;
      toZone = "banished";
      destArrRedirected = this.getZone(destPlayer, toZone);
      if (!Array.isArray(destArrRedirected)) {
        destArrRedirected = null;
      } else {
        this.ui?.log?.(`${card.name} is banished as it leaves the field.`);
      }
    }
  }

  const originalOwnerDestination = resolveOriginalOwnerDestination(
    this,
    card,
    fromZone,
    toZone,
    fromOwner,
  );
  if (originalOwnerDestination && originalOwnerDestination !== destPlayer) {
    destPlayer = originalOwnerDestination;
    destArrRedirected = this.getZone(destPlayer, toZone);
    if (!Array.isArray(destArrRedirected)) {
      return { success: false, reason: "invalid_original_owner_zone" };
    }
  }

  const isExtraDeckMonster =
    card.monsterType === "fusion" ||
    card.monsterType === "ascension" ||
    card.monsterType === "synchro";
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
  const wasFaceupBeforeMove = card.isFacedown !== true;
  let pendingAttachedEquipCleanup = [];
  const flushPendingAttachedEquipCleanup = async () => {
    if (pendingAttachedEquipCleanup.length === 0) return;
    const pending = pendingAttachedEquipCleanup;
    pendingAttachedEquipCleanup = [];

    for (const { equip, equipOwner } of pending) {
      try {
        const equipZone = this.getZone(equipOwner, "spellTrap") || [];
        if (equipZone.includes(equip)) {
          await this.moveCard(equip, equipOwner, "graveyard", {
            fromZone: "spellTrap",
            contextLabel: "equipped_host_left_field",
          });
        }
      } finally {
        if (equip.lastEquippedCardLeftField === card) {
          delete equip.lastEquippedCardLeftField;
        }
        if (equip.lastEquippedCardLeftFieldCause !== undefined) {
          delete equip.lastEquippedCardLeftFieldCause;
        }
      }
    }
  };

  // TOKEN RULE: Tokens cannot exist outside the field.
  // If a token is leaving the field to any other zone, remove it from the game entirely.
  // This handles: destruction, bounce to hand, banish, shuffle to deck, tribute, etc.
  if (card.isToken === true && fromZone === "field" && toZone !== "field") {
    queueZoneMoveAnimation(this, cardAnimationIntent, toZone);

    // Clean up any references that might point to this token
    this.cleanupTokenReferences(card, fromOwner);

    // Log the removal
    this.ui.log(`${card.name} (Token) was removed from the game.`);

    await emitCardMovedEvent(
      this,
      card,
      fromOwner,
      null,
      fromZone,
      "removed",
      {
        ...options,
        wasFaceupBeforeMove,
        contextLabel: options.contextLabel || "token_removed",
      },
    );

    // Update board to reflect removal
    this.updateBoard();

    // Return success with tokenRemoved flag - token is NOT added to any zone
    return { success: true, tokenRemoved: true, fromZone, toZone: null };
  }

  if (card.owner !== fromOwner.id) {
    card.owner = fromOwner.id;
  }

  const effectsNegatedAtFieldExit =
    fromZone === "field" &&
    card.cardKind === "monster" &&
    card.effectsNegated === true;

  cleanupNamedBuffsWhenSourceLeavesField(
    this,
    card,
    fromOwner,
    fromZone,
    toZone,
  );
  cleanupLinkedPermanentBuffsWhenSourceLeavesField(this, card, fromZone, toZone);
  cleanupDeclaredValuesWhenSourceLeavesActiveZone(card, fromZone, toZone);

  const activeZones = ["field", "spellTrap", "fieldSpell"];
  if (
    activeZones.includes(fromZone) &&
    !activeZones.includes(toZone) &&
    (card.cardKind === "spell" || card.cardKind === "trap")
  ) {
    card.effectsNegated = false;
    card.effectsNegatedDuration = null;
  }

  if (fromZone === "field" && card.cardKind === "monster") {
    card.summonedTurn = null;
    card.setTurn = null;
    card.positionChangedThisTurn = false;
    card.cannotAttackThisTurn = false;
    card.cannotAttackUntilTurn = null;
    card.immuneToOpponentEffectsUntilTurn = null;
    delete card.attackLimitThisTurn;
    delete card.attackLimitDuration;

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
    if (toZone !== "field" && card.originalLevel != null) {
      card.level = card.originalLevel;
      card.originalLevel = null;
    }
    if (Array.isArray(card.turnBasedBuffs) && card.turnBasedBuffs.length > 0) {
      for (const buff of card.turnBasedBuffs) {
        if (buff?.stat === "atk") {
          card.atk = Math.max(0, (card.atk || 0) - (buff.value || 0));
        } else if (buff?.stat === "def") {
          card.def = Math.max(0, (card.def || 0) - (buff.value || 0));
        }
      }
      card.turnBasedBuffs = [];
    }
    if (toZone !== "field") {
      card.effectsNegated = false;
      card.effectsNegatedDuration = null;
    }

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
    if (toZone !== "field" && card.originalStatsOverride) {
      const original = card.originalStatsOverride;
      if (Number.isFinite(Number(original.baseAtk))) {
        card.baseAtk = Number(original.baseAtk);
        card.atk = card.baseAtk;
      }
      if (Number.isFinite(Number(original.baseDef))) {
        card.baseDef = Number(original.baseDef);
        card.def = card.baseDef;
      }
      delete card.originalStatsOverride;
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
          (p) => p.removeOnLeave === false && p.duration !== "while_faceup"
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
    await emitCardMovedEvent(
      this,
      card,
      fromOwner,
      destPlayer,
      fromZone,
      "fieldSpell",
      {
        ...options,
        wasFaceupBeforeMove,
      },
    );
    return { success: true, fromZone, toZone };
  }

  // STATE-BASED CLEANUP: If a monster leaves the field to ANY other zone,
  // send attached equip spells to the graveyard (state-based rule).
  if (
    fromZone === "field" &&
    toZone !== "field" &&
    card.cardKind === "monster"
  ) {
    const attachedEquips = [this.player, this.bot]
      .filter(Boolean)
      .flatMap((equipOwner) => {
        const equipZone = this.getZone(equipOwner, "spellTrap") || [];
        return equipZone
          .filter(
            (eq) =>
              eq &&
              eq.cardKind === "spell" &&
              eq.subtype === "equip" &&
              (eq.equippedTo === card || eq.equipTarget === card),
          )
          .map((equip) => ({ equip, equipOwner }));
      });

    for (const { equip, equipOwner } of attachedEquips) {
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

      equip.lastEquippedCardLeftField = card;
      equip.lastEquippedCardLeftFieldCause =
        options.destroyCause || options.reason || null;

      // Clear active equip references AFTER removing bonuses. The transient
      // reference above remains available to card_to_grave triggers.
      if (equip.equippedTo === card) {
        equip.equippedTo = null;
      }
      if (equip.equipTarget === card) {
        equip.equipTarget = null;
      }

      pendingAttachedEquipCleanup.push({ equip, equipOwner });
    }

    // Se o monstro foi revivido por Call of the Haunted, destruir a trap também
    const boundTrap = card.boundTrapSource || card.callOfTheHauntedTrap;
    if (boundTrap) {
      const callTrap = boundTrap;
      if (callTrap.boundMonsterTarget === card) {
        callTrap.boundMonsterTarget = null;
      }
      if (callTrap.callOfTheHauntedTarget === card) {
        callTrap.callOfTheHauntedTarget = null;
      }
      card.boundTrapSource = null;
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
    if (revivedMonster.boundTrapSource === card) {
      revivedMonster.boundTrapSource = null;
    }
    if (revivedMonster.callOfTheHauntedTrap === card) {
      revivedMonster.callOfTheHauntedTrap = null;
    }

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

  // Legacy save/replay compatibility: older states used callOfTheHauntedTarget.
  if (
    fromZone === "spellTrap" &&
    toZone !== "spellTrap" &&
    card.cardKind === "trap" &&
    card.subtype === "continuous" &&
    card.callOfTheHauntedTarget
  ) {
    const revivedMonster = card.callOfTheHauntedTarget;
    card.callOfTheHauntedTarget = null;
    if (revivedMonster.boundTrapSource === card) {
      revivedMonster.boundTrapSource = null;
    }
    if (revivedMonster.callOfTheHauntedTrap === card) {
      revivedMonster.callOfTheHauntedTrap = null;
    }

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

  if (fromZone === "field" && toZone !== "field" && card.isTrapMonster) {
    restoreTrapMonsterOriginalState(card);
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

  if (toZone === "graveyard" || toZone === "banished") {
    card.isFacedown = false;
    card.setTurn = null;
    card.turnSetOn = null;
  }

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
      await flushPendingAttachedEquipCleanup();
      await emitCardMovedEvent(
        this,
        card,
        fromOwner,
        destPlayer,
        fromZone,
        "extraDeck",
        {
          ...options,
          wasFaceupBeforeMove,
        },
      );
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

  let afterSummonResult = null;
  let cardToGraveResult = null;

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

    applyStatusesOnSummon(card, options.statusesOnSummon);

    const ownerPlayer = card.owner === "player" ? this.player : this.bot;
    const otherPlayer = ownerPlayer === this.player ? this.bot : this.player;
    const summonMethod = options.summonMethodOverride || "special";
    const followupResult =
      await applySynchroMaterialFollowupsBeforeAfterSummon(
        this,
        card,
        ownerPlayer,
        otherPlayer,
        options.synchroMaterialFollowups,
        {
          actionContext: options.actionContext || null,
          summonMethod,
          summonProcedure: options.summonProcedure || null,
        },
      );
    if (followupResult?.needsSelection) {
      afterSummonResult = followupResult;
    } else {
      await presentSummonBeforeAfterSummon(this, options);
      afterSummonResult = await this.emit("after_summon", {
        card,
        player: ownerPlayer,
        opponent: otherPlayer,
        method: summonMethod,
        fromZone,
        summonProcedure: options.summonProcedure || null,
        position: options.position || card.position || null,
        sourceCard: options.sourceCard || options.source || null,
        source: options.source || options.sourceCard || null,
        effectId: options.effectId || null,
      });
    }
  }

  if (toZone === "graveyard") {
    // Don't emit card_to_grave if the card is already in graveyard (moving within same zone)
    // This prevents infinite loops where effects like Specter trigger repeatedly
    if (fromZone === "graveyard") {
      return { success: true, fromZone, toZone };
    }

    const ownerPlayer = card.owner === "player" ? this.player : this.bot;
    const otherPlayer = ownerPlayer === this.player ? this.bot : this.player;
    const deferCardToGraveTriggers =
      options.deferCardToGraveTriggerResolution === true;

    const shouldPresentDestroyedGraveyardTrigger =
      hasMatchingDestroyedGraveyardTrigger(card, fromZone, options);
    const presentedDestroyedGraveyardTrigger =
      shouldPresentDestroyedGraveyardTrigger
        ? await presentDestroyedGraveyardTrigger(this, card, options)
        : false;

    try {
      this.updateBoard?.();
      if (
        options.presentBeforeCardToGraveEvent !== false &&
        (options.awaitEvents === true ||
          options.awaitCardToGraveEvent === true ||
          deferCardToGraveTriggers) &&
        typeof this.waitForPresentationDelay === "function"
      ) {
        const delayMs = Number.isFinite(options.graveyardPresentationDelayMs)
          ? options.graveyardPresentationDelayMs
          : 160;
        await this.waitForPresentationDelay(delayMs);
      }
      console.log(
        `[moveCard] Emitting card_to_grave event for ${card.name} (fromZone: ${fromZone})`
      );
      const cardToGravePayload = {
        card,
        fromZone: fromZone || options.fromZone || null,
        toZone: "graveyard",
        player: ownerPlayer,
        opponent: otherPlayer,
        wasDestroyed: options.wasDestroyed || false,
        destroyCause: options.destroyCause || null,
        destroySource:
          options.destroySource || options.sourceCard || options.source || null,
        contextLabel: options.contextLabel || null,
        actionContext: options.actionContext || null,
        deferTargetPrecheck: deferCardToGraveTriggers,
        effectsNegatedAtFieldExit,
      };
      const cardToGraveEvent = this.emit(
        "card_to_grave",
        cardToGravePayload,
        deferCardToGraveTriggers ? { collectTriggersOnly: true } : undefined,
      );
      if (
        deferCardToGraveTriggers ||
        options.awaitEvents === true ||
        options.awaitCardToGraveEvent === true
      ) {
        cardToGraveResult = await cardToGraveEvent;
      } else {
        void cardToGraveEvent;
      }
    } finally {
      if (presentedDestroyedGraveyardTrigger) {
        delete card.graveyardEffectActivating;
        this.updateBoard?.();
      }
    }
  }

  // Limpar cache de targeting após mover cartas (estado do jogo mudou)
  await flushPendingAttachedEquipCleanup();

  if (this.effectEngine?.clearTargetingCache) {
    this.effectEngine.clearTargetingCache();
  }

  await emitCardMovedEvent(
    this,
    card,
    fromOwner,
    destPlayer,
    fromZone,
    toZone,
    {
      ...options,
      wasFaceupBeforeMove,
    },
  );

  if (this.effectEngine?.clearTargetingCache) {
    this.effectEngine.clearTargetingCache();
  }

  const result = { success: true, fromZone, toZone };
  if (afterSummonResult?.needsSelection && afterSummonResult.selectionContract) {
    result.needsSelection = true;
    result.selectionContract = afterSummonResult.selectionContract;
  }
  if (cardToGraveResult?.needsSelection && cardToGraveResult.selectionContract) {
    result.needsSelection = true;
    result.selectionContract = cardToGraveResult.selectionContract;
  }
  if (cardToGraveResult?.collectedOnly) {
    result.deferredCardToGraveTriggerPackage = cardToGraveResult;
    result.deferredCardToGraveEntries = Array.isArray(cardToGraveResult.entries)
      ? cardToGraveResult.entries
      : [];
  }
  return result;
}
