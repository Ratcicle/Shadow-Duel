import {
  cardMatchesEventFilters,
  debugTriggerLog,
  matchesZoneFilter,
} from "./shared.js";

function resolvePlayerForCard(game, card, fallback = null) {
  if (!game || !card) return fallback;
  if (card.owner === "player") return game.player || fallback;
  if (card.owner === "bot") return game.bot || fallback;
  return fallback;
}

function isBoardZone(zone) {
  return zone === "field" || zone === "spellTrap" || zone === "fieldSpell";
}

function collectBoardSources(owner) {
  if (!owner) return [];
  const sources = [];
  if (Array.isArray(owner.field)) sources.push(...owner.field);
  if (Array.isArray(owner.spellTrap)) sources.push(...owner.spellTrap);
  if (owner.fieldSpell) sources.push(owner.fieldSpell);
  return sources.filter(Boolean);
}

function hasHandCardMovedTrigger(card) {
  return (card?.effects || []).some(
    (effect) =>
      effect &&
      effect.timing === "on_event" &&
      effect.event === "card_moved" &&
      effect.requireZone &&
      matchesZoneFilter("hand", effect.requireZone),
  );
}

function collectHandCardMovedSources(owner) {
  if (!owner || !Array.isArray(owner.hand)) return [];
  return owner.hand.filter(hasHandCardMovedTrigger);
}

function sourceAlreadyListed(sources, card) {
  return sources.some((entry) => entry.card === card);
}

function getCardKey(card) {
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

function getTriggerReservationKey(owner, sourceCard, effect, optCheck) {
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
export async function collectCardMovedTriggers(payload) {
  const entries = [];
  const reservedOncePerTurnLocks = new Set();
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

  const sourceEntries = [
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
  ].filter((side) => side.owner);

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

  const collectFromSource = (sourceCard, owner, other, sourceZone, effect) => {
    if (!effect || effect.timing !== "on_event") return;
    if (effect.event !== "card_moved") return;

    if (this.isEffectNegated(sourceCard)) {
      debugTriggerLog(
        this,
        `[card_moved] ${sourceCard.name} effects are negated, skipping effect.`,
      );
      return;
    }

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
