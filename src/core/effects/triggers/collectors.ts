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
import {
  COLLECTED_TRIGGER_EVENT_NAMES,
  type CollectedTriggerEventName,
  type DuelEventMap,
  type ResolvableEventName,
  type TriggerCollector,
} from "../../contracts/events.js";
import {
  collectAfterSummonTriggers,
  collectAttackDeclaredTriggers,
  collectBattleCompletedTriggers,
  collectBattleDamageInflictedTriggers,
  collectBattleDamageTriggers,
  collectBattleDestroyTriggers,
  collectCardEquippedTriggers,
  collectCardFlippedTriggers,
  collectCardMovedTriggers,
  collectCardToGraveTriggers,
  collectCounterRemovedTriggers,
  collectDamageStepTriggers,
  collectEffectActivatedTriggers,
  collectEffectTargetedTriggers,
  collectEndPhaseTriggers,
  collectLpChangeTriggers,
  collectPositionChangeTriggers,
  collectSpellActivatedTriggers,
  collectStandbyPhaseTriggers,
} from "./collectors/index.js";
import type {
  TemporaryEventEffect,
  TriggerCollectorHost,
  TriggerContext,
  TriggerEntry,
  TriggerGamePort,
  TriggerPackage,
  TriggerRuntimeCard,
  TriggerRuntimePlayer,
  TriggerZone,
} from "./runtime.js";

function getPlayerById(
  game: TriggerGamePort | null | undefined,
  playerId: string | null | undefined,
): TriggerRuntimePlayer | null {
  if (!game || !playerId) return null;
  if (game.player?.id === playerId) return game.player;
  if (game.bot?.id === playerId) return game.bot;
  return null;
}

function buildTemporarySourceCard(
  entry: TemporaryEventEffect,
  owner: TriggerRuntimePlayer,
): TriggerRuntimeCard {
  const sourceCard: TriggerRuntimeCard = {
    id: undefined,
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
  // Temporary legacy registrations may use a string id. Keep the runtime
  // shape while containing that legacy value outside canonical EventCard ids.
  Reflect.set(sourceCard, "id", entry.sourceCardId ?? entry.id);
  return sourceCard;
}

function findCardByInstanceId(
  game: TriggerGamePort | null | undefined,
  instanceId: number | string | null | undefined,
): TriggerRuntimeCard | null {
  if (!game || instanceId == null) return null;
  const zones = [
    "deck",
    "extraDeck",
    "hand",
    "field",
    "spellTrap",
    "graveyard",
    "banished",
  ] as const;
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

function findCardLocation(
  game: TriggerGamePort | null | undefined,
  card: TriggerRuntimeCard | null | undefined,
): { player: TriggerRuntimePlayer; zone: TriggerZone } | null {
  if (!game || !card) return null;
  const zones = [
    "deck",
    "extraDeck",
    "hand",
    "field",
    "spellTrap",
    "graveyard",
    "banished",
  ] as const;
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

function cleanupTemporaryEventEffects(
  game: TriggerGamePort | null | undefined,
): void {
  if (!Array.isArray(game?.temporaryEventEffects)) return;
  const currentTurn = Number(game.turnCounter || 0);
  game.temporaryEventEffects = game.temporaryEventEffects.filter(
    (entry) =>
      entry &&
      (typeof entry.expiresOnTurn !== "number" ||
        !Number.isFinite(entry.expiresOnTurn) ||
        currentTurn <= entry.expiresOnTurn) &&
      (typeof entry.usesRemaining !== "number" ||
        !Number.isFinite(entry.usesRemaining) ||
        entry.usesRemaining > 0),
  );
}

function collectTemporaryEventTriggers(
  engine: TriggerCollectorHost | null | undefined,
  eventName: ResolvableEventName,
  payload: DuelEventMap[ResolvableEventName],
): TriggerEntry[] {
  const game = engine?.game;
  if (!game || !Array.isArray(game.temporaryEventEffects)) return [];

  cleanupTemporaryEventEffects(game);
  const entries: TriggerEntry[] = [];
  for (const tempEntry of game.temporaryEventEffects) {
    if (!tempEntry || tempEntry.event !== eventName) continue;
    if (
      typeof tempEntry.expiresOnTurn === "number" &&
      Number.isFinite(tempEntry.expiresOnTurn) &&
      Number(game.turnCounter || 0) > tempEntry.expiresOnTurn
    ) {
      continue;
    }
    if (
      typeof tempEntry.usesRemaining === "number" &&
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
    } as TriggerContext;

    if (Array.isArray(effect.conditions) && effect.conditions.length > 0) {
      const conditionResult = engine.evaluateConditions(effect.conditions, ctx);
      if (!conditionResult?.ok) continue;
    }

    const consumeOnMatch =
      tempEntry.duration === "until_consumed" &&
      tempEntry.boundEventTargetInstanceId != null;
    if (
      consumeOnMatch &&
      typeof tempEntry.usesRemaining === "number" &&
      Number.isFinite(tempEntry.usesRemaining)
    ) {
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
        if (
          !consumeOnMatch &&
          typeof tempEntry.usesRemaining === "number" &&
          Number.isFinite(tempEntry.usesRemaining)
        ) {
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

function appendTemporaryEventTriggers(
  engine: TriggerCollectorHost,
  eventName: ResolvableEventName,
  triggerPackage: TriggerPackage,
  payload: DuelEventMap[ResolvableEventName],
): TriggerPackage {
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

type TriggerCollectorDescriptor<Name extends CollectedTriggerEventName> = {
  readonly method: keyof TriggerCollectorHost;
  readonly collector: TriggerCollector<Name, TriggerCollectorHost>;
};

type TriggerCollectorManifest = {
  readonly [Name in CollectedTriggerEventName]: TriggerCollectorDescriptor<Name>;
};

export const TRIGGER_COLLECTOR_MANIFEST = Object.freeze({
  after_summon: {
    method: "collectAfterSummonTriggers",
    collector: collectAfterSummonTriggers,
  },
  spell_activated: {
    method: "collectSpellActivatedTriggers",
    collector: collectSpellActivatedTriggers,
  },
  effect_activated: {
    method: "collectEffectActivatedTriggers",
    collector: collectEffectActivatedTriggers,
  },
  battle_destroy: {
    method: "collectBattleDestroyTriggers",
    collector: collectBattleDestroyTriggers,
  },
  battle_completed: {
    method: "collectBattleCompletedTriggers",
    collector: collectBattleCompletedTriggers,
  },
  card_to_grave: {
    method: "collectCardToGraveTriggers",
    collector: collectCardToGraveTriggers,
  },
  card_moved: {
    method: "collectCardMovedTriggers",
    collector: collectCardMovedTriggers,
  },
  counter_removed: {
    method: "collectCounterRemovedTriggers",
    collector: collectCounterRemovedTriggers,
  },
  attack_declared: {
    method: "collectAttackDeclaredTriggers",
    collector: collectAttackDeclaredTriggers,
  },
  battle_damage: {
    method: "collectBattleDamageTriggers",
    collector: collectBattleDamageTriggers,
  },
  battle_damage_inflicted: {
    method: "collectBattleDamageInflictedTriggers",
    collector: collectBattleDamageInflictedTriggers,
  },
  card_flipped: {
    method: "collectCardFlippedTriggers",
    collector: collectCardFlippedTriggers,
  },
  damage_step: {
    method: "collectDamageStepTriggers",
    collector: collectDamageStepTriggers,
  },
  lp_change: {
    method: "collectLpChangeTriggers",
    collector: collectLpChangeTriggers,
  },
  effect_targeted: {
    method: "collectEffectTargetedTriggers",
    collector: collectEffectTargetedTriggers,
  },
  position_change: {
    method: "collectPositionChangeTriggers",
    collector: collectPositionChangeTriggers,
  },
  card_equipped: {
    method: "collectCardEquippedTriggers",
    collector: collectCardEquippedTriggers,
  },
  standby_phase: {
    method: "collectStandbyPhaseTriggers",
    collector: collectStandbyPhaseTriggers,
  },
  end_phase: {
    method: "collectEndPhaseTriggers",
    collector: collectEndPhaseTriggers,
  },
} satisfies TriggerCollectorManifest);

function isCollectedTriggerEvent(
  eventName: ResolvableEventName,
): eventName is CollectedTriggerEventName {
  return COLLECTED_TRIGGER_EVENT_NAMES.some(
    (collectedName) => collectedName === eventName,
  );
}

async function dispatchCollectedTrigger(
  engine: TriggerCollectorHost,
  eventName: CollectedTriggerEventName,
  payload: DuelEventMap[ResolvableEventName],
): Promise<TriggerPackage> {
  const descriptor = TRIGGER_COLLECTOR_MANIFEST[eventName];
  // Resolve through the host to preserve instance monkeypatching semantics.
  const collector = Reflect.get(engine, descriptor.method);
  return await Reflect.apply(collector, engine, [payload]);
}

export async function collectEventTriggers<Name extends ResolvableEventName>(
  this: TriggerCollectorHost,
  eventName: Name,
  payload: DuelEventMap[Name],
): Promise<TriggerPackage> {
  const triggerPackage: TriggerPackage = isCollectedTriggerEvent(eventName)
    ? await dispatchCollectedTrigger(this, eventName, payload)
    : { entries: [], orderRule: "no_triggers" };
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
