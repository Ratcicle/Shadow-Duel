import { debugTriggerLog } from "./shared.js";

/**
 * Collects trigger entries for lp_change events.
 * @param {Object} payload - LP change payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectLpChangeTriggers(payload) {
  const entries = [];
  const orderRule =
    "LP gainer -> opponent; sources: fieldSpell -> field -> spellTrap";

  if (!payload || !payload.player || (payload.lpGained || 0) <= 0) {
    return { entries, orderRule };
  }

  const lpPlayer = payload.player;
  const opponent = this.game?.getOpponent?.(lpPlayer);
  const participants = [];

  participants.push({ owner: lpPlayer, opponent });
  if (opponent) {
    participants.push({ owner: opponent, opponent: lpPlayer });
  }

  const currentPhase = this.game?.phase;
  const lpGained = payload.lpGained || 0;
  const before = payload.before ?? null;
  const after = payload.after ?? null;
  const lpChangeSourceCard = payload.sourceCard || null;

  for (const side of participants) {
    const owner = side.owner;
    const other = side.opponent;
    if (!owner) continue;

    const sources = [];
    if (owner.fieldSpell) {
      sources.push(owner.fieldSpell);
    }
    if (Array.isArray(owner.field)) {
      sources.push(...owner.field);
    }
    if (Array.isArray(owner.spellTrap)) {
      sources.push(...owner.spellTrap);
    }

    for (const sourceCard of sources) {
      if (!sourceCard?.effects || !Array.isArray(sourceCard.effects)) continue;

      const sourceZone = this.findCardZone(owner, sourceCard);
      const isFaceDownOnBoard =
        sourceCard?.isFacedown === true &&
        ["field", "spellTrap", "fieldSpell"].includes(sourceZone);

      const ctx = {
        source: sourceCard,
        player: owner,
        opponent: other,
        lpChangePlayer: lpPlayer,
        lpGained,
        before,
        after,
        sourceCard: lpChangeSourceCard,
        lpChangeSourceCard,
        currentPhase,
      };

      for (const effect of sourceCard.effects) {
        if (!effect || effect.timing !== "on_event") continue;
        if (effect.event !== "lp_change") continue;

        if (isFaceDownOnBoard) {
          continue;
        }

        if (effect.requireFaceup === true && sourceCard.isFacedown === true) {
          continue;
        }

        if (effect.requireZone && sourceZone !== effect.requireZone) {
          continue;
        }

        const triggerPlayer = effect.triggerPlayer || "any";
        if (triggerPlayer === "self" && owner !== lpPlayer) continue;
        if (triggerPlayer === "opponent" && owner === lpPlayer) continue;

        if (
          effect.minLpGained !== undefined &&
          lpGained < Number(effect.minLpGained)
        ) {
          continue;
        }

        const sourceFilters =
          effect.lpChangeSourceFilters || effect.sourceCardFilters || null;
        if (
          sourceFilters &&
          !this.cardMatchesFilters(lpChangeSourceCard, sourceFilters)
        ) {
          continue;
        }

        const optCheck = this.checkOncePerTurn(sourceCard, owner, effect);
        if (!optCheck.ok) {
          debugTriggerLog(this, optCheck.reason);
          continue;
        }

        const duelCheck = this.checkOncePerDuel(sourceCard, owner, effect);
        if (!duelCheck.ok) {
          debugTriggerLog(this, duelCheck.reason);
          continue;
        }

        if (effect.requirePhase) {
          const allowedPhases = Array.isArray(effect.requirePhase)
            ? effect.requirePhase
            : [effect.requirePhase];
          if (!allowedPhases.includes(currentPhase)) {
            continue;
          }
        }

        const activationContext = {
          ...this.buildTriggerActivationContext(sourceCard, owner, sourceZone),
          triggeredByEvent: "lp_change",
        };

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
          entries.push(entry);
        }
      }
    }
  }

  return { entries, orderRule, onComplete: () => this.updatePassiveBuffs() };
}
