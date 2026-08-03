import type { CollectedTriggerEventMap } from "../../../contracts/events.js";
import type {
  TriggerCollectorHost,
  TriggerEffect,
  TriggerEntry,
  TriggerGamePort,
  TriggerPackage,
  TriggerRuntimeCard,
  TriggerRuntimePlayer,
  TriggerUsageCheck,
  TriggerZone,
} from "../runtime.js";
import {
  cardMatchesEventFilters,
  debugTriggerLog,
  matchesZoneFilter,
} from "./shared.js";

function resolvePlayerForCard(
  game: TriggerGamePort | null | undefined,
  card: TriggerRuntimeCard | null | undefined,
  fallback: TriggerRuntimePlayer | null = null,
): TriggerRuntimePlayer | null {
  if (!game || !card) return fallback;
  if (card.owner === "player") return game.player || fallback;
  if (card.owner === "bot") return game.bot || fallback;
  return fallback;
}

function isBoardZone(zone: string | null | undefined): boolean {
  return zone === "field" || zone === "spellTrap" || zone === "fieldSpell";
}

function collectBoardSources(
  owner: TriggerRuntimePlayer | null | undefined,
): TriggerRuntimeCard[] {
  if (!owner) return [];
  const sources: TriggerRuntimeCard[] = [];
  if (Array.isArray(owner.field)) sources.push(...owner.field);
  if (Array.isArray(owner.spellTrap)) sources.push(...owner.spellTrap);
  if (owner.fieldSpell) sources.push(owner.fieldSpell);
  return sources.filter(Boolean);
}

function hasHandCardMovedTrigger(
  card: TriggerRuntimeCard | null | undefined,
): boolean {
  return (card?.effects || []).some(
    (effect) =>
      effect &&
      effect.timing === "on_event" &&
      effect.event === "card_moved" &&
      effect.requireZone &&
      matchesZoneFilter("hand", effect.requireZone),
  );
}

function collectHandCardMovedSources(
  owner: TriggerRuntimePlayer | null | undefined,
): TriggerRuntimeCard[] {
  if (!owner || !Array.isArray(owner.hand)) return [];
  return owner.hand.filter(hasHandCardMovedTrigger);
}

interface CardMovedSource {
  readonly card: TriggerRuntimeCard;
  readonly owner: TriggerRuntimePlayer;
  readonly other: TriggerRuntimePlayer | null;
  readonly zone: TriggerZone;
}

function sourceAlreadyListed(
  sources: readonly CardMovedSource[],
  card: TriggerRuntimeCard,
): boolean {
  return sources.some((entry) => entry.card === card);
}

function getCardKey(
  card: TriggerRuntimeCard | null | undefined,
): string | number {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uid ??
    card?.uuid ??
    card?.id ??
    card?.name ??
    "card"
  );
}

function getTriggerReservationKey(
  owner: TriggerRuntimePlayer,
  sourceCard: TriggerRuntimeCard,
  effect: TriggerEffect,
  optCheck: TriggerUsageCheck,
): string | null {
  if (!effect?.oncePerTurn || !optCheck?.lockKey) return null;
  const ownerKey = owner?.id || "player";
  const scope =
    effect.oncePerTurnScope === "card" || effect.oncePerTurnPerCard === true
      ? `card:${getCardKey(sourceCard)}`
      : "player";
  return `${ownerKey}:${scope}:${optCheck.lockKey}`;
}

/**
 * Collects trigger entries for generic card movement events.
 * Supports effects that trigger from the moved card itself (including hand/GY)
 * plus face-up board observers and explicit hand observers.
 */
export async function collectCardMovedTriggers(
  this: TriggerCollectorHost,
  payload: CollectedTriggerEventMap["card_moved"],
): Promise<TriggerPackage> {
  const entries: TriggerEntry[] = [];
  const reservedOncePerTurnLocks = new Set<string>();
  const orderRule =
    "moved card -> moved card owner board observers -> opponent board observers -> hand observers";

  const { card, fromZone, toZone } = payload || {};
  if (!card || !fromZone || !toZone || fromZone === toZone) {
    return { entries, orderRule };
  }

  const movedOwner =
    payload.player ||
    payload.toPlayer ||
    resolvePlayerForCard(this.game, card, payload.fromPlayer || null);
  if (!movedOwner) return { entries, orderRule };

  const movedOpponent =
    payload.opponent || this.game?.getOpponent?.(movedOwner) || null;
  const actionContext = payload?.actionContext || null;

  const sourceEntries: CardMovedSource[] = [
    {
      card,
      owner: movedOwner,
      other: movedOpponent,
      zone: toZone,
    },
  ];

  const observerSides = [
    { owner: movedOwner, other: movedOpponent },
    { owner: movedOpponent, other: movedOwner },
  ].filter(
    (side): side is {
      owner: TriggerRuntimePlayer;
      other: TriggerRuntimePlayer | null;
    } => side.owner != null,
  );

  for (const { owner, other } of observerSides) {
    for (const sourceCard of collectBoardSources(owner)) {
      if (!sourceCard || sourceCard === card) continue;
      if (sourceAlreadyListed(sourceEntries, sourceCard)) continue;
      sourceEntries.push({
        card: sourceCard,
        owner,
        other,
        zone: this.findCardZone?.(owner, sourceCard) || "field",
      });
    }
    for (const sourceCard of collectHandCardMovedSources(owner)) {
      if (!sourceCard) continue;
      if (sourceAlreadyListed(sourceEntries, sourceCard)) continue;
      sourceEntries.push({
        card: sourceCard,
        owner,
        other,
        zone: "hand",
      });
    }
  }

  const collectFromSource = (
    sourceCard: TriggerRuntimeCard,
    owner: TriggerRuntimePlayer,
    other: TriggerRuntimePlayer | null,
    sourceZone: TriggerZone,
    effect: TriggerEffect,
  ): void => {
    if (!effect || effect.timing !== "on_event") return;
    if (effect.event !== "card_moved") return;

    if (isBoardZone(sourceZone) && sourceCard.isFacedown === true) return;

    if (effect.requireFaceup === true && sourceCard.isFacedown === true) {
      return;
    }

    if (effect.requireZone && !matchesZoneFilter(sourceZone, effect.requireZone)) {
      return;
    }

    if (effect.requireSelfAsMoved === true && sourceCard !== card) {
      return;
    }

    if (
      effect.fromZone &&
      effect.fromZone !== "any" &&
      !matchesZoneFilter(fromZone, effect.fromZone)
    ) {
      return;
    }

    if (
      effect.toZone &&
      effect.toZone !== "any" &&
      !matchesZoneFilter(toZone, effect.toZone)
    ) {
      return;
    }

    if (
      effect.requireMovedCardWasFaceup === true &&
      payload.wasFaceupBeforeMove !== true
    ) {
      return;
    }

    if (
      effect.requireFaceupAtFieldExit === true &&
      (fromZone !== "field" || payload.wasFaceupBeforeMove !== true)
    ) {
      return;
    }

    const requiresEffectMove =
      effect.movedByEffect === true || effect.requireMovedByEffect === true;
    if (requiresEffectMove && payload.movedByEffect !== true) {
      return;
    }

    if (effect.condition) {
      const condType = Reflect.get(effect.condition, "type");
      const destroyCause = payload?.destroyCause;
      const wasDestroyed = payload?.wasDestroyed === true;

      if (condType === "destroyed_by_battle") {
        if (!wasDestroyed || destroyCause !== "battle") return;
      } else if (condType === "destroyed_by_effect") {
        if (!wasDestroyed || destroyCause !== "effect") return;
      } else if (condType === "destroyed_by_battle_or_effect") {
        if (
          !wasDestroyed ||
          (destroyCause !== "battle" && destroyCause !== "effect")
        ) {
          return;
        }
      }
    }

    if (
      effect.eventCardFilters &&
      !cardMatchesEventFilters(this, card, effect.eventCardFilters, {
        sourceOwner: owner,
        eventOwner: movedOwner,
        fromZone,
        toZone,
      })
    ) {
      return;
    }

    const ctx = {
      source: sourceCard,
      player: owner,
      opponent: other,
      eventCard: card,
      movedCard: card,
      eventPlayer: movedOwner,
      eventOpponent: movedOpponent,
      fromZone,
      toZone,
      movedByEffect: payload.movedByEffect === true,
      wasDestroyed: payload.wasDestroyed === true,
      destroyCause: payload.destroyCause || null,
      wasFaceupBeforeMove: payload.wasFaceupBeforeMove === true,
      movementSourceCard: payload.sourceCard || payload.source || null,
      effectId: payload.effectId || null,
      actionContext,
    };

    const optCheck = this.checkOncePerTurn(sourceCard, owner, effect);
    if (!optCheck.ok) return;
    const reservationKey = getTriggerReservationKey(
      owner,
      sourceCard,
      effect,
      optCheck,
    );
    if (reservationKey && reservedOncePerTurnLocks.has(reservationKey)) {
      return;
    }

    const duelCheck = this.checkOncePerDuel(sourceCard, owner, effect);
    if (!duelCheck.ok) return;

    if (Array.isArray(effect.targets) && effect.targets.length > 0) {
      const precheckCtx = {
        ...ctx,
        activationContext: { logTargets: false },
      };
      for (const targetDef of effect.targets) {
        if (!targetDef) continue;
        const min = Number(targetDef.count?.min ?? 1);
        if (min <= 0) continue;
        const { candidates } = this.selectCandidates(targetDef, precheckCtx);
        if (!candidates || candidates.length < min) {
          return;
        }
      }
    }

    const activationContext = this.buildTriggerActivationContext(
      sourceCard,
      owner,
      sourceZone || this.findCardZone(owner, sourceCard) || toZone,
    );

    const entry = this.buildTriggerEntry({
      sourceCard,
      owner,
      effect,
      ctx,
      activationContext,
      selectionKind: "triggered",
      selectionMessage: "Select target(s) for the triggered effect.",
    });

    if (entry) {
      if (reservationKey) reservedOncePerTurnLocks.add(reservationKey);
      entries.push(entry);
    }
  };

  for (const sourceEntry of sourceEntries) {
    const sourceCard = sourceEntry.card;
    if (!Array.isArray(sourceCard?.effects)) continue;
    for (const effect of sourceCard.effects) {
      collectFromSource(
        sourceCard,
        sourceEntry.owner,
        sourceEntry.other,
        sourceEntry.zone,
        effect,
      );
    }
  }

  return { entries, orderRule };
}
