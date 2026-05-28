import { debugTriggerLog } from "./shared.js";

/**
 * Collects trigger entries for standby_phase event.
 * @param {Object} payload - Standby phase event payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectStandbyPhaseTriggers(payload) {
  const entries = [];
  const orderRule =
    "active player only; sources: field -> spellTrap -> fieldSpell";

  if (!payload || !payload.player) return { entries, orderRule };

  const actionContext = payload?.actionContext || null;
  const owner = payload.player;
  const opponent = payload.opponent || this.game?.getOpponent?.(owner);

  const cards = [
    ...(owner.field || []),
    ...(owner.spellTrap || []),
    owner.fieldSpell,
  ].filter(Boolean);

  for (const card of cards) {
    if (!card.effects || !Array.isArray(card.effects)) continue;

    const ctx = {
      source: card,
      player: owner,
      opponent,
      host: card.equippedTo || null,
      actionContext,
    };

    for (const effect of card.effects) {
      if (!effect || effect.timing !== "on_event") continue;
      if (effect.event !== "standby_phase") continue;

      if (this.isEffectNegated(card)) {
        debugTriggerLog(this, `${card.name} effects are negated, skipping effect.`);
        continue;
      }

      // Check requireFaceup condition
      if (effect.requireFaceup === true && card.isFacedown === true) {
        debugTriggerLog(this,
          `[standby_phase] Skipping effect on ${card.name}: requireFaceup=true but card is facedown`,
        );
        continue;
      }

      const optCheck = this.checkOncePerTurn(card, owner, effect);
      if (!optCheck.ok) {
        debugTriggerLog(this, optCheck.reason);
        continue;
      }

      const duelCheck = this.checkOncePerDuel(card, owner, effect);
      if (!duelCheck.ok) {
        debugTriggerLog(this, duelCheck.reason);
        continue;
      }

      const activationContext = this.buildTriggerActivationContext(card, owner);

      const entry = this.buildTriggerEntry({
        sourceCard: card,
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

  return { entries, orderRule };
}
