import {
  cardMatchesEventFilters,
  debugTriggerLog,
  matchesOwnerFilter,
  matchesZoneFilter,
} from "./shared.js";

function resolvePlayerForCard(game, card, fallback = null) {
  if (!game || !card) return fallback;
  if (card.owner === "player") return game.player || fallback;
  if (card.owner === "bot") return game.bot || fallback;
  return fallback;
}

function collectBoardSources(owner) {
  if (!owner) return [];
  const sources = [];
  if (Array.isArray(owner.field)) sources.push(...owner.field);
  if (Array.isArray(owner.spellTrap)) sources.push(...owner.spellTrap);
  if (owner.fieldSpell) sources.push(owner.fieldSpell);
  return sources.filter(Boolean);
}

function hasHandPositionChangeTrigger(card) {
  return (card?.effects || []).some(
    (effect) =>
      effect &&
      effect.timing === "on_event" &&
      effect.event === "position_change" &&
      effect.requireZone &&
      matchesZoneFilter("hand", effect.requireZone),
  );
}

function collectHandPositionChangeSources(owner) {
  if (!owner || !Array.isArray(owner.hand)) return [];
  return owner.hand.filter(hasHandPositionChangeTrigger);
}

function sourceAlreadyListed(sources, card) {
  return sources.some((entry) => entry.card === card);
}

function matchesPositionFilter(actual, filterValue) {
  if (!filterValue || filterValue === "any") return true;
  const allowed = Array.isArray(filterValue) ? filterValue : [filterValue];
  return allowed.includes(actual);
}

function matchesCardFilters(engine, card, filters) {
  if (!filters || Object.keys(filters).length === 0) return true;
  if (!card) return false;
  if (typeof engine.cardMatchesFilters === "function") {
    return engine.cardMatchesFilters(card, filters);
  }
  if (filters.cardKind && card.cardKind !== filters.cardKind) return false;
  if (filters.name && card.name !== filters.name) return false;
  if (filters.cardName && card.name !== filters.cardName) return false;
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  return true;
}

function getCardLockIdentity(card) {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uuid ??
    card?.simInstanceId ??
    card?.id ??
    card?.name ??
    "unknown"
  );
}

function buildPerEventCardEffect(effect, eventCard) {
  if (!effect?.oncePerTurnPerEventCard) return effect;
  const baseName = effect.oncePerTurnName || effect.id || "position_change";
  const eventCardKey = getCardLockIdentity(eventCard);
  return {
    ...effect,
    oncePerTurn: true,
    oncePerTurnName: `${baseName}:event_card:${eventCardKey}`,
  };
}

/**
 * Collects trigger entries for battle position changes.
 */
export async function collectPositionChangeTriggers(payload) {
  const entries = [];
  const orderRule =
    "changed card owner board observers -> opponent board observers -> hand observers";

  const { card, fromPosition, toPosition } = payload || {};
  if (!card || !fromPosition || !toPosition || fromPosition === toPosition) {
    return { entries, orderRule };
  }

  const changedOwner =
    payload.player || resolvePlayerForCard(this.game, card, null);
  if (!changedOwner) return { entries, orderRule };

  const changedOpponent =
    payload.opponent || this.game?.getOpponent?.(changedOwner) || null;
  const actionContext = payload?.actionContext || null;
  const positionChangeSourceCard = payload.sourceCard || payload.source || null;

  const observerSides = [
    { owner: changedOwner, other: changedOpponent },
    { owner: changedOpponent, other: changedOwner },
  ].filter((side) => side.owner);

  const collectFromSource = (sourceCard, owner, other, sourceZone, effect) => {
    if (!effect || effect.timing !== "on_event") return;
    if (effect.event !== "position_change") return;

    if (this.isEffectNegated(sourceCard)) {
      debugTriggerLog(
        this,
        `[position_change] ${sourceCard.name} effects are negated, skipping effect.`,
      );
      return;
    }

    const isBoardSource =
      sourceZone === "field" ||
      sourceZone === "spellTrap" ||
      sourceZone === "fieldSpell";

    if (isBoardSource && sourceCard.isFacedown === true) return;

    if (effect.requireFaceup === true && sourceCard.isFacedown === true) {
      return;
    }

    if (effect.requireZone && !matchesZoneFilter(sourceZone, effect.requireZone)) {
      return;
    }

    if (effect.requireSelfAsChanged === true && sourceCard !== card) {
      return;
    }

    const positionFrom = effect.fromPosition || effect.positionFrom;
    const positionTo = effect.toPosition || effect.positionTo;
    if (!matchesPositionFilter(fromPosition, positionFrom)) return;
    if (!matchesPositionFilter(toPosition, positionTo)) return;

    const changedCardOwner =
      effect.changedCardOwner || effect.eventCardOwner || null;
    if (
      changedCardOwner &&
      !matchesOwnerFilter(changedCardOwner, owner, changedOwner)
    ) {
      return;
    }

    if (effect.changedCardRequireFaceup === true && card.isFacedown === true) {
      return;
    }

    if (
      effect.changedCardRequireFaceupBeforeChange === true &&
      payload.wasFlipped === true
    ) {
      return;
    }

    if (
      effect.eventCardFilters &&
      !cardMatchesEventFilters(this, card, effect.eventCardFilters, {
        sourceOwner: owner,
        eventOwner: changedOwner,
        fromZone: "field",
        toZone: "field",
      })
    ) {
      return;
    }

    const sourceFilters =
      effect.positionChangeSourceFilters ||
      effect.positionChangeSourceCardFilters ||
      null;
    const requiresEffectPositionChange =
      effect.positionChangedByEffect === true ||
      effect.requirePositionChangedByEffect === true;
    if (requiresEffectPositionChange && !positionChangeSourceCard) {
      return;
    }
    if (
      sourceFilters &&
      !matchesCardFilters(this, positionChangeSourceCard, sourceFilters)
    ) {
      return;
    }

    const ctx = {
      source: sourceCard,
      player: owner,
      opponent: other,
      eventCard: card,
      changedCard: card,
      eventPlayer: changedOwner,
      eventOpponent: changedOpponent,
      fromPosition,
      toPosition,
      wasFlipped: payload.wasFlipped === true,
      positionChangeSourceCard,
      positionChangedByEffect: !!positionChangeSourceCard,
      effectId: payload.effectId || null,
      actionContext,
    };

    const effectiveEffect = buildPerEventCardEffect(effect, card);

    const optCheck = this.checkOncePerTurn(sourceCard, owner, effectiveEffect);
    if (!optCheck.ok) return;

    const duelCheck = this.checkOncePerDuel(sourceCard, owner, effectiveEffect);
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
      sourceZone,
    );

    const entry = this.buildTriggerEntry({
      sourceCard,
      owner,
      effect: effectiveEffect,
      ctx,
      activationContext,
      selectionKind: "triggered",
      selectionMessage: "Select target(s) for the triggered effect.",
    });

    if (entry) entries.push(entry);
  };

  for (const { owner, other } of observerSides) {
    const sourceEntries = [];
    for (const sourceCard of collectBoardSources(owner)) {
      if (!sourceCard) continue;
      sourceEntries.push({
        card: sourceCard,
        zone: this.findCardZone?.(owner, sourceCard) || "field",
      });
    }
    for (const sourceCard of collectHandPositionChangeSources(owner)) {
      if (!sourceCard || sourceAlreadyListed(sourceEntries, sourceCard)) {
        continue;
      }
      sourceEntries.push({ card: sourceCard, zone: "hand" });
    }
    for (const { card: sourceCard, zone: sourceZone } of sourceEntries) {
      if (!Array.isArray(sourceCard?.effects)) continue;
      for (const effect of sourceCard.effects) {
        collectFromSource(sourceCard, owner, other, sourceZone, effect);
      }
    }
  }

  return { entries, orderRule };
}
