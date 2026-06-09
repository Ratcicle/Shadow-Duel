/**
 * spellSpeed.js
 *
 * Spell Speed validation extracted from ChainSystem.js.
 * Pure validation logic — depends only on `this.chainStack` and the
 * `CHAIN_CONTEXTS` lookup re-exported from ChainSystem.
 *
 * Methods (bound via prototype on ChainSystem):
 *  - getEffectSpellSpeed
 *  - getRequiredSpellSpeed
 *  - canActivateInChain
 */

import { CHAIN_CONTEXTS } from "./contexts.js";
import {
  canActivateDuringDamageStep,
  isQuickSpell,
} from "../game/spellTrap/quickSpellRules.js";

/**
 * Get the spell speed of an effect.
 * @param {Object} effect
 * @param {Object} card
 * @returns {number} 1, 2, or 3
 */
export function getEffectSpellSpeed(effect, card) {
  if (effect?.speed !== undefined) {
    return effect.speed;
  }

  if (card?.cardKind === "trap") {
    if (card.subtype === "counter") {
      return 3;
    }
    return 2;
  }

  if (card?.cardKind === "spell") {
    if (isQuickSpell(card)) {
      return 2;
    }
    return 1;
  }

  if (card?.cardKind === "monster") {
    if (effect?.isQuickEffect) {
      return 2;
    }
    return 1;
  }

  return 1;
}

/**
 * Get the minimum required spell speed to respond in the current chain.
 * @param {Object} context
 * @returns {number}
 */
export function getRequiredSpellSpeed(context) {
  if (this.chainStack.length === 0) {
    if (context?.type === "main_phase_action") {
      return 1;
    }
    return 2;
  }

  const lastLink = this.chainStack[this.chainStack.length - 1];
  const lastSpeed = this.getEffectSpellSpeed(lastLink.effect, lastLink.card);

  return Math.max(2, lastSpeed);
}

/**
 * Check if an effect can be activated in the current chain context.
 * @param {Object} effect
 * @param {Object} card
 * @param {Object} context
 * @returns {{ok: boolean, reason?: string}}
 */
export function canActivateInChain(effect, card, context) {
  if (!effect || !card) {
    return { ok: false, reason: "Missing effect or card." };
  }

  const effectSpeed = this.getEffectSpellSpeed(effect, card);
  const requiredSpeed = this.getRequiredSpellSpeed(context);

  if (effectSpeed < requiredSpeed) {
    return {
      ok: false,
      reason: `Spell Speed ${effectSpeed} cannot respond to Spell Speed ${requiredSpeed}.`,
    };
  }

  const contextDef = CHAIN_CONTEXTS[context?.type];
  if (contextDef && !contextDef.allowedSpeeds.includes(effectSpeed)) {
    return {
      ok: false,
      reason: `Spell Speed ${effectSpeed} not allowed in ${context?.type} context.`,
    };
  }

  if (effect.canRespondTo && Array.isArray(effect.canRespondTo)) {
    if (!effect.canRespondTo.includes(context?.type)) {
      return {
        ok: false,
        reason: `Effect can only respond to: ${effect.canRespondTo.join(
          ", ",
        )}`,
      };
    }
  }

  const damageStepCheck = canActivateDuringDamageStep(effect, card, context);
  if (!damageStepCheck.ok) {
    return {
      ok: false,
      code: damageStepCheck.code,
      reason: damageStepCheck.reason,
    };
  }

  return { ok: true };
}
