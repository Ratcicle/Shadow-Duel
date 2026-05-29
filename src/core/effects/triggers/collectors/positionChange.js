import {
  cardMatchesEventFilters,
  debugTriggerLog,
  matchesOwnerFilter,
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

function matchesPositionFilter(actual, filterValue) {
  if (!filterValue || filterValue === "any") return true;
  const allowed = Array.isArray(filterValue) ? filterValue : [filterValue];
  return allowed.includes(actual);
}

/**
 * Collects trigger entries for battle position changes.
 */
export async function collectPositionChangeTriggers(payload) {
  const entries = [];
  const orderRule = "changed card owner board observers -> opponent board observers";

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

    if (sourceCard.isFacedown === true) return;

    if (effect.requireFaceup === true && sourceCard.isFacedown === true) {
      return;
    }

    if (effect.requireZone && effect.requireZone !== sourceZone) {
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
      positionChangeSourceCard: payload.sourceCard || payload.source || null,
      actionContext,
    };

    const optCheck = this.checkOncePerTurn(sourceCard, owner, effect);
    if (!optCheck.ok) return;

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
      sourceZone,
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

    if (entry) entries.push(entry);
  };

  for (const { owner, other } of observerSides) {
    for (const sourceCard of collectBoardSources(owner)) {
      if (!Array.isArray(sourceCard?.effects)) continue;
      const sourceZone = this.findCardZone?.(owner, sourceCard) || "field";
      for (const effect of sourceCard.effects) {
        collectFromSource(sourceCard, owner, other, sourceZone, effect);
      }
    }
  }

  return { entries, orderRule };
}
