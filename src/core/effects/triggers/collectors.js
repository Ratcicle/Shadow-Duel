/**
 * Trigger collectors - collectEventTriggers and all collect*Triggers methods.
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

/**
 * Main dispatcher for event trigger collection.
 * Routes to specific collector based on event name.
 * @param {string} eventName - The event type
 * @param {Object} payload - Event payload data
 * @returns {Promise<Object>} Collected entries and order rule
 */
function getPlayerById(game, playerId) {
  if (!game || !playerId) return null;
  if (game.player?.id === playerId) return game.player;
  if (game.bot?.id === playerId) return game.bot;
  return null;
}

function buildTemporarySourceCard(entry, owner) {
  return {
    id: entry.sourceCardId ?? entry.id,
    name: entry.sourceName || "Temporary Effect",
    cardKind: entry.sourceCardKind || "spell",
    subtype: entry.sourceCardSubtype || null,
    image: entry.sourceImage || null,
    owner: owner?.id || entry.ownerId || null,
    controller: owner?.id || entry.ownerId || null,
    instanceId: entry.sourceInstanceId ?? null,
    isFacedown: false,
    declaredValues:
      entry.declaredValues && typeof entry.declaredValues === "object"
        ? Object.fromEntries(
            Object.entries(entry.declaredValues).map(([key, value]) => [
              key,
              value && typeof value === "object" ? { ...value } : value,
            ]),
          )
        : {},
    __temporaryEventEffect: true,
  };
}

function findCardByInstanceId(game, instanceId) {
  if (!game || instanceId == null) return null;
  const zones = [
    "deck",
    "extraDeck",
    "hand",
    "field",
    "spellTrap",
    "graveyard",
    "banished",
  ];
  for (const player of [game.player, game.bot]) {
    if (!player) continue;
    if (
      player.fieldSpell &&
      String(player.fieldSpell.instanceId ?? player.fieldSpell._instanceId) ===
        String(instanceId)
    ) {
      return player.fieldSpell;
    }
    for (const zone of zones) {
      const card = (player[zone] || []).find(
        (candidate) =>
          String(candidate?.instanceId ?? candidate?._instanceId) ===
          String(instanceId),
      );
      if (card) return card;
    }
  }
  return null;
}

function findCardLocation(game, card) {
  if (!game || !card) return null;
  const zones = [
    "deck",
    "extraDeck",
    "hand",
    "field",
    "spellTrap",
    "graveyard",
    "banished",
  ];
  for (const player of [game.player, game.bot]) {
    if (!player) continue;
    if (player.fieldSpell === card) return { player, zone: "fieldSpell" };
    for (const zone of zones) {
      if (Array.isArray(player[zone]) && player[zone].includes(card)) {
        return { player, zone };
      }
    }
  }
  return null;
}

function cleanupTemporaryEventEffects(game) {
  if (!Array.isArray(game?.temporaryEventEffects)) return;
  const currentTurn = Number(game.turnCounter || 0);
  game.temporaryEventEffects = game.temporaryEventEffects.filter(
    (entry) =>
      entry &&
      (!Number.isFinite(entry.expiresOnTurn) ||
        currentTurn <= entry.expiresOnTurn) &&
      (!Number.isFinite(entry.usesRemaining) || entry.usesRemaining > 0),
  );
}

function collectTemporaryEventTriggers(engine, eventName, payload) {
  const game = engine?.game;
  if (!game || !Array.isArray(game.temporaryEventEffects)) return [];

  cleanupTemporaryEventEffects(game);
  const entries = [];
  for (const tempEntry of game.temporaryEventEffects) {
    if (!tempEntry || tempEntry.event !== eventName) continue;
    if (
      Number.isFinite(tempEntry.expiresOnTurn) &&
      Number(game.turnCounter || 0) > tempEntry.expiresOnTurn
    ) {
      continue;
    }
    if (
      Number.isFinite(tempEntry.usesRemaining) &&
      tempEntry.usesRemaining <= 0
    ) {
      continue;
    }

    const movedCard = payload?.movedCard || payload?.card || null;
    if (
      tempEntry.boundEventTargetInstanceId != null &&
      String(movedCard?.instanceId ?? movedCard?._instanceId) !==
        String(tempEntry.boundEventTargetInstanceId)
    ) {
      continue;
    }
    if (
      tempEntry.requireBoundTargetLeavesField === true &&
      (payload?.fromZone !== "field" || payload?.toZone === "field")
    ) {
      continue;
    }

    const owner = getPlayerById(game, tempEntry.ownerId);
    if (!owner) continue;
    const opponent = game.getOpponent?.(owner) || null;
    const sourceCard =
      findCardByInstanceId(game, tempEntry.sourceInstanceId) ||
      buildTemporarySourceCard(tempEntry, owner);
    const sourceLocation = findCardLocation(game, sourceCard);
    const effect = tempEntry.effect || {
      id: tempEntry.id,
      timing: "on_event",
      event: eventName,
      actions: tempEntry.actions || [],
    };
    const ctx = {
      ...(payload || {}),
      source: sourceCard,
      player: owner,
      opponent,
      eventCard:
        payload?.eventCard ||
        payload?.destroyed ||
        payload?.card ||
        payload?.movedCard ||
        null,
      movedCard: payload?.movedCard || payload?.card || null,
      actionContext: payload?.actionContext || null,
    };

    if (Array.isArray(effect.conditions) && effect.conditions.length > 0) {
      const conditionResult = engine.evaluateConditions(effect.conditions, ctx);
      if (!conditionResult?.ok) continue;
    }

    const consumeOnMatch =
      tempEntry.duration === "until_consumed" &&
      tempEntry.boundEventTargetInstanceId != null;
    if (consumeOnMatch && Number.isFinite(tempEntry.usesRemaining)) {
      tempEntry.usesRemaining = 0;
    }

    const triggerEntry = engine.buildTriggerEntry({
      sourceCard,
      owner,
      effect,
      ctx,
      activationContext: {
        activationZone: sourceLocation?.zone || "temporary",
        sourceZone: sourceLocation?.zone || "temporary",
        committed: false,
      },
      selectionKind: "triggered",
      selectionMessage: "Select target(s) for the temporary triggered effect.",
      summary: `${owner.id}:${sourceCard.name}:${effect.id || eventName}`,
      onSuccess: async () => {
        if (!consumeOnMatch && Number.isFinite(tempEntry.usesRemaining)) {
          tempEntry.usesRemaining -= 1;
        }
        cleanupTemporaryEventEffects(game);
      },
    });

    if (triggerEntry) entries.push(triggerEntry);
  }

  cleanupTemporaryEventEffects(game);

  return entries;
}

function appendTemporaryEventTriggers(engine, eventName, triggerPackage, payload) {
  const temporaryEntries = collectTemporaryEventTriggers(
    engine,
    eventName,
    payload,
  );
  if (temporaryEntries.length === 0) return triggerPackage;

  const baseEntries = Array.isArray(triggerPackage?.entries)
    ? triggerPackage.entries
    : [];
  return {
    ...(triggerPackage || {}),
    entries: [...baseEntries, ...temporaryEntries],
    orderRule: triggerPackage?.orderRule
      ? `${triggerPackage.orderRule} -> temporary event effects`
      : "temporary event effects",
  };
}

export async function collectEventTriggers(eventName, payload) {
  let triggerPackage = null;
  if (eventName === "after_summon") {
    triggerPackage = await this.collectAfterSummonTriggers(payload);
  } else if (eventName === "spell_activated") {
    triggerPackage = await this.collectSpellActivatedTriggers(payload);
  } else if (eventName === "effect_activated") {
    triggerPackage = await this.collectEffectActivatedTriggers(payload);
  } else if (eventName === "battle_destroy") {
    triggerPackage = await this.collectBattleDestroyTriggers(payload);
  } else if (eventName === "battle_completed") {
    triggerPackage = await this.collectBattleCompletedTriggers(payload);
  } else if (eventName === "card_to_grave") {
    triggerPackage = await this.collectCardToGraveTriggers(payload);
  } else if (eventName === "card_moved") {
    triggerPackage = await this.collectCardMovedTriggers(payload);
  } else if (eventName === "counter_removed") {
    triggerPackage = await this.collectCounterRemovedTriggers(payload);
  } else if (eventName === "attack_declared") {
    triggerPackage = await this.collectAttackDeclaredTriggers(payload);
  } else if (eventName === "battle_damage") {
    triggerPackage = await this.collectBattleDamageTriggers(payload);
  } else if (eventName === "battle_damage_inflicted") {
    triggerPackage = await this.collectBattleDamageInflictedTriggers(payload);
  } else if (eventName === "card_flipped") {
    triggerPackage = await this.collectCardFlippedTriggers(payload);
  } else if (eventName === "damage_step") {
    triggerPackage = await this.collectDamageStepTriggers(payload);
  } else if (eventName === "lp_change") {
    triggerPackage = await this.collectLpChangeTriggers(payload);
  } else if (eventName === "effect_targeted") {
    triggerPackage = await this.collectEffectTargetedTriggers(payload);
  } else if (eventName === "position_change") {
    triggerPackage = await this.collectPositionChangeTriggers(payload);
  } else if (eventName === "card_equipped") {
    triggerPackage = await this.collectCardEquippedTriggers(payload);
  } else if (eventName === "standby_phase") {
    triggerPackage = await this.collectStandbyPhaseTriggers(payload);
  } else if (eventName === "end_phase") {
    triggerPackage = await this.collectEndPhaseTriggers(payload);
  } else {
    triggerPackage = { entries: [], orderRule: "no_triggers" };
  }
  return appendTemporaryEventTriggers(this, eventName, triggerPackage, payload);
}

export {
  collectAfterSummonTriggers,
  collectAttackDeclaredTriggers,
  collectBattleDamageTriggers,
  collectBattleDamageInflictedTriggers,
  collectCardFlippedTriggers,
  collectDamageStepTriggers,
  collectBattleCompletedTriggers,
  collectBattleDestroyTriggers,
  collectCardEquippedTriggers,
  collectCardMovedTriggers,
  collectCardToGraveTriggers,
  collectCounterRemovedTriggers,
  collectEffectActivatedTriggers,
  collectEffectTargetedTriggers,
  collectEndPhaseTriggers,
  collectLpChangeTriggers,
  collectPositionChangeTriggers,
  collectSpellActivatedTriggers,
  collectStandbyPhaseTriggers,
} from "./collectors/index.js";
