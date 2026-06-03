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
export async function collectEventTriggers(eventName, payload) {
  if (eventName === "after_summon") {
    return await this.collectAfterSummonTriggers(payload);
  }
  if (eventName === "spell_activated") {
    return await this.collectSpellActivatedTriggers(payload);
  }
  if (eventName === "effect_activated") {
    return await this.collectEffectActivatedTriggers(payload);
  }
  if (eventName === "battle_destroy") {
    return await this.collectBattleDestroyTriggers(payload);
  }
  if (eventName === "card_to_grave") {
    return await this.collectCardToGraveTriggers(payload);
  }
  if (eventName === "card_moved") {
    return await this.collectCardMovedTriggers(payload);
  }
  if (eventName === "counter_removed") {
    return await this.collectCounterRemovedTriggers(payload);
  }
  if (eventName === "attack_declared") {
    return await this.collectAttackDeclaredTriggers(payload);
  }
  if (eventName === "battle_damage") {
    return await this.collectBattleDamageTriggers(payload);
  }
  if (eventName === "lp_change") {
    return await this.collectLpChangeTriggers(payload);
  }
  if (eventName === "effect_targeted") {
    return await this.collectEffectTargetedTriggers(payload);
  }
  if (eventName === "position_change") {
    return await this.collectPositionChangeTriggers(payload);
  }
  if (eventName === "card_equipped") {
    return await this.collectCardEquippedTriggers(payload);
  }
  if (eventName === "standby_phase") {
    return await this.collectStandbyPhaseTriggers(payload);
  }
  return { entries: [], orderRule: "no_triggers" };
}

export {
  collectAfterSummonTriggers,
  collectAttackDeclaredTriggers,
  collectBattleDamageTriggers,
  collectBattleDestroyTriggers,
  collectCardEquippedTriggers,
  collectCardMovedTriggers,
  collectCardToGraveTriggers,
  collectCounterRemovedTriggers,
  collectEffectActivatedTriggers,
  collectEffectTargetedTriggers,
  collectLpChangeTriggers,
  collectPositionChangeTriggers,
  collectSpellActivatedTriggers,
  collectStandbyPhaseTriggers,
} from "./collectors/index.js";
