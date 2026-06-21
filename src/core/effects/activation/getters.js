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

function isTrapActivationFromSet(card, options = {}) {
  return (
    card?.cardKind === "trap" &&
    (options.trapActivationFromSet === true ||
      options.fromSet === true ||
      card.isFacedown === true)
  );
}

function ignitionMatchesActivationZone(effect, activationZone = "spellTrap") {
  if (!effect || effect.timing !== "ignition") return false;
  const requiredZone = effect.requireZone || null;
  if (requiredZone) {
    return (
      requiredZone === activationZone ||
      (requiredZone === "field" && activationZone === "spellTrap")
    );
  }
  return activationZone === "spellTrap" || activationZone === "field";
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
  const activationZone =
    options.activationZone || (options.fromHand === true ? "hand" : "spellTrap");
  if (card.cardKind === "trap") {
    if (isTrapActivationFromSet(card, options)) {
      return card.effects.find((e) => e && e.timing === "on_activate") || null;
    }
    return (
      card.effects.find((e) => ignitionMatchesActivationZone(e, activationZone)) ||
      null
    );
  }
  if (card.cardKind === "spell") {
    const fromHand = options.fromHand === true;
    if (fromHand) {
      return this.getHandActivationEffect(card);
    }
    const ignition = card.effects.find((e) =>
      ignitionMatchesActivationZone(e, activationZone)
    );
    if (ignition) return ignition;
    if (card.subtype === "continuous" || card.subtype === "field") {
      return null;
    }
    if (activationZone !== "spellTrap") {
      return null;
    }
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
