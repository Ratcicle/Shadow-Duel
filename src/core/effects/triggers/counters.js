/**
 * Trigger Counters Module
 * Extracted from EffectEngine.js - field presence and summon type counters
 *
 * All functions assume `this` = EffectEngine instance
 */

/**
 * Handle special summon type counters for passive effects
 * Tracks how many monsters of each type have been special summoned
 * @param {Object} payload - The after_summon event payload
 */
export function handleSpecialSummonTypeCounters(payload) {
  const { card: summonedCard, player, method } = payload || {};
  if (!summonedCard || method !== "special" || !player) return;

  const typeName = summonedCard.type || null;
  if (!typeName) return;

  const controllerId = player.id || player;
  const fieldCards = player.field || [];

  for (const fieldCard of fieldCards) {
    if (!fieldCard || fieldCard.isFacedown) continue;
    if (fieldCard.cardKind !== "monster") continue;

    const effects = fieldCard.effects || [];
    for (const effect of effects) {
      if (!effect || effect.timing !== "passive") continue;
      const passive = effect.passive;
      if (!passive) continue;
      if (passive.type !== "type_special_summoned_count_buff") continue;
      if (passive.scope !== "card_state") continue; // only per-instance counters

      const passiveType = passive.typeName || passive.monsterType || null;
      if (!passiveType || passiveType !== typeName) continue;

      // Ensure state map and increment
      const state = fieldCard.state || (fieldCard.state = {});
      const map =
        state.specialSummonTypeCount || (state.specialSummonTypeCount = {});
      map[typeName] = (map[typeName] || 0) + 1;
    }
  }

  // Update passives after increment to reflect new buff values
  this.updatePassiveBuffs();
}

/**
 * Assign a unique field presence ID to a card when it enters the field.
 * This ID is used to track counters that should reset when the card leaves and returns.
 * @param {Object} card - The card entering the field
 */
export function assignFieldPresenceId(card) {
  if (!card) return;

  // Generate unique ID: card.id + timestamp + random component
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000000);
  card.fieldPresenceId = `fp_${card.id}_${timestamp}_${random}`;

  // Initialize presence-specific state for tracking counters
  if (!card.fieldPresenceState) {
    card.fieldPresenceState = {};
  }
}

/**
 * Clear field presence ID and associated state when a card leaves the field.
 * This ensures counters reset when the card returns to the field later.
 * @param {Object} card - The card leaving the field
 */
export function clearFieldPresenceId(card) {
  if (!card) return;

  // Clear presence-specific counters
  if (card.fieldPresenceState) {
    card.fieldPresenceState = null;
  }

  // Clear the presence ID
  delete card.fieldPresenceId;
}

/**
 * Handle field-presence-based type summon counters.
 * This tracks how many monsters of a specific type have been Special Summoned
 * WHILE a specific card is face-up on the field.
 * @param {Object} payload - Event payload from after_summon
 */
export function handleFieldPresenceTypeSummonCounters(payload) {
  const { card: summonedCard, player, method } = payload || {};

  // Validate payload
  if (!summonedCard || !player) return;

  const typeName = summonedCard.type || null;
  if (!typeName) return;

  const controllerId = player.id || player;
  const fieldCards = player.field || [];

  // Find all cards with field_presence_type_summon_count_buff passives
  for (const fieldCard of fieldCards) {
    if (!fieldCard || fieldCard.isFacedown) continue;
    if (fieldCard.cardKind !== "monster") continue;
    if (!fieldCard.fieldPresenceId) continue; // Must have a presence ID

    // Don't count the card that was just summoned for itself
    if (fieldCard === summonedCard) continue;

    const effects = fieldCard.effects || [];
    for (const effect of effects) {
      if (!effect || effect.timing !== "passive") continue;
      const passive = effect.passive;
      if (!passive) continue;
      if (passive.type !== "field_presence_type_summon_count_buff") continue;

      // Check if this passive tracks the summoned card's type
      const passiveType = passive.typeName || null;
      if (!passiveType || passiveType !== typeName) continue;

      // Check summon method filter
      const summonMethods = passive.summonMethods || ["special"];
      const isSpecialSummon =
        method === "special" || method === "ascension" || method === "fusion";
      if (summonMethods.includes("special") && !isSpecialSummon) continue;
      if (!summonMethods.includes("special") && !summonMethods.includes(method))
        continue;

      // Check owner filter
      const countOwner = passive.countOwner || "self";
      const summonedOwner = summonedCard.owner || null;
      if (countOwner === "self" && summonedOwner !== controllerId) continue;
      if (countOwner === "opponent" && summonedOwner === controllerId) continue;

      // Initialize field presence state if needed
      if (!fieldCard.fieldPresenceState) {
        fieldCard.fieldPresenceState = {};
      }

      // Initialize counter for this type
      const counterKey = `summon_count_${typeName}`;
      if (!fieldCard.fieldPresenceState[counterKey]) {
        fieldCard.fieldPresenceState[counterKey] = 0;
      }

      // Increment counter
      fieldCard.fieldPresenceState[counterKey]++;
    }
  }

  // Update passive buffs to reflect new counts
  this.updatePassiveBuffs();
}
