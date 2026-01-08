/**
 * activation/getters.js
 * Effect getter methods for activation system
 * Functions assume `this` = EffectEngine instance
 */

/**
 * Get the on_play activation effect for a card played from hand.
 * For field spells, only check on_play timing - on_field_activate effects
 * are handled separately after the card is placed on the field.
 */
export function getHandActivationEffect(card) {
  if (!card || !Array.isArray(card.effects)) {
    return null;
  }
  // For field spells, only return on_play effects when playing from hand.
  // on_field_activate effects are activated after placement, not during hand play.
  return card.effects.find((e) => e && e.timing === "on_play") || null;
}

/**
 * Get the activation effect for a Spell/Trap card.
 * For traps: on_activate or ignition timing
 * For spells: ignition timing (or on_play if fromHand)
 */
export function getSpellTrapActivationEffect(card, options = {}) {
  if (!card || !Array.isArray(card.effects)) {
    return null;
  }
  if (card.cardKind === "trap") {
    return (
      card.effects.find(
        (e) => e && (e.timing === "on_activate" || e.timing === "ignition")
      ) || null
    );
  }
  if (card.cardKind === "spell") {
    const fromHand = options.fromHand === true;
    if (fromHand) {
      return this.getHandActivationEffect(card);
    }
    const ignition = card.effects.find((e) => e && e.timing === "ignition");
    if (ignition) return ignition;
    return card.effects.find((e) => e && e.timing === "on_play") || null;
  }
  return null;
}

/**
 * Get the ignition effect for a monster based on activation zone.
 */
export function getMonsterIgnitionEffect(card, activationZone = "field") {
  if (!card || !Array.isArray(card.effects)) {
    return null;
  }
  if (activationZone === "graveyard") {
    return (
      card.effects.find(
        (e) => e && e.timing === "ignition" && e.requireZone === "graveyard"
      ) || null
    );
  }
  if (activationZone === "hand") {
    return (
      card.effects.find(
        (e) => e && e.timing === "ignition" && e.requireZone === "hand"
      ) || null
    );
  }
  return (
    card.effects.find(
      (e) =>
        e &&
        e.timing === "ignition" &&
        (!e.requireZone || e.requireZone === "field")
    ) || null
  );
}

/**
 * Get the activation effect for a Field Spell.
 * Looks for on_field_activate OR ignition with requireZone: "fieldSpell"
 */
export function getFieldSpellActivationEffect(card) {
  if (!card || !Array.isArray(card.effects)) {
    return null;
  }
  // Look for on_field_activate OR ignition with requireZone: "fieldSpell"
  return (
    card.effects.find(
      (e) =>
        e &&
        (e.timing === "on_field_activate" ||
          (e.timing === "ignition" && e.requireZone === "fieldSpell"))
    ) || null
  );
}
