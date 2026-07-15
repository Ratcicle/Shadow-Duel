import { debugTriggerLog } from "./shared.js";

/**
 * Collects trigger entries for effect_activated event.
 * @param {Object} payload - Effect/card activation payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectEffectActivatedTriggers(payload) {
  const entries = [];
  const orderRule =
    "effect controller -> opponent; sources: field -> fieldSpell -> spellTrap";

  if (!payload || !payload.card || !payload.player) {
    return { entries, orderRule };
  }

  const activatedCard = payload.card;
  const activatedEffect = payload.effect || null;
  const activator = payload.player;
  const opponent = this.game?.getOpponent?.(activator);
  const participants = [];

  if (activator) {
    participants.push({ owner: activator, opponent });
  }
  if (opponent) {
    participants.push({ owner: opponent, opponent: activator });
  }

  const currentPhase = this.game?.phase;

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
        activatedCard,
        activatedEffect,
        activatedPlayer: activator,
        activationZone: payload.activationZone || null,
        effectType: payload.effectType || null,
        currentPhase,
      };

      for (const effect of sourceCard.effects) {
        if (!effect || effect.timing !== "on_event") continue;
        if (effect.event !== "effect_activated") continue;

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
        if (triggerPlayer === "self" && owner !== activator) continue;
        if (triggerPlayer === "opponent" && owner === activator) continue;

        const activatedFilters =
          effect.activatedCardFilters || effect.requireActivatedCardFilters;
        if (
          activatedFilters &&
          !this.cardMatchesFilters(activatedCard, activatedFilters)
        ) {
          continue;
        }

        const sameActivatedSource =
          sourceCard === activatedCard ||
          (sourceCard?.instanceId != null &&
            activatedCard?.instanceId != null &&
            sourceCard.instanceId === activatedCard.instanceId);
        if (effect.excludeActivatedSelf === true && sameActivatedSource) {
          continue;
        }

        const activatedEffectFilters =
          effect.activatedEffectFilters || effect.requireActivatedEffectFilters;
        if (
          activatedEffectFilters &&
          !this.effectMatchesFilters?.(activatedEffect, activatedEffectFilters, {
            activationZone: payload.activationZone || null,
            activationContext: payload.activationContext || null,
            effectType: payload.effectType || null,
            placementOnly: payload.placementOnly === true,
          })
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
          triggeredByEvent: "effect_activated",
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
