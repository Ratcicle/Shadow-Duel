/**
 * activation/getters.js
 * Effect getter methods for activation system
 * Functions assume `this` = EffectEngine instance
 */

import { getCanonicalEffectActivationZones } from "../../chain/legality.js";

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
  const allowedZones = getCanonicalEffectActivationZones(null, effect);
  return (
    allowedZones.includes(activationZone) ||
    (allowedZones.includes("field") && activationZone === "spellTrap")
  );
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
function monsterIgnitionMatchesActivationZone(effect, activationZone = "field") {
  if (!effect || effect.timing !== "ignition") return false;
  return getCanonicalEffectActivationZones(null, effect).includes(
    activationZone,
  );
}

export function getMonsterIgnitionEffects(card, activationZone = "field") {
  if (!card || !Array.isArray(card.effects)) {
    return [];
  }
  return card.effects.filter((effect) =>
    monsterIgnitionMatchesActivationZone(effect, activationZone)
  );
}

export function getMonsterIgnitionEffect(
  card,
  activationZone = "field",
  options = {},
) {
  const engine = this || {};
  const effects = engine.getMonsterIgnitionEffects
    ? engine.getMonsterIgnitionEffects(card, activationZone)
    : getMonsterIgnitionEffects(card, activationZone);
  const effectId =
    typeof options === "string"
      ? options
      : options?.effectId || options?.activationContext?.effectId || null;
  if (effectId) {
    return effects.find((effect) => effect?.id === effectId) || null;
  }
  return effects[0] || null;
}

export function getActivatableMonsterIgnitionEffects(
  card,
  player,
  activationZone = "field",
  options = {},
) {
  const engine = this || {};
  const effects = engine.getMonsterIgnitionEffects
    ? engine.getMonsterIgnitionEffects(card, activationZone)
    : getMonsterIgnitionEffects(card, activationZone);
  return effects
    .map((effect) => {
      const activationContext = {
        ...(options.activationContext || {}),
        effectId: effect.id,
      };
      const preview =
        typeof engine.canActivateMonsterEffectPreview === "function"
          ? engine.canActivateMonsterEffectPreview(
              card,
              player,
              activationZone,
              null,
              { ...options, effectId: effect.id, activationContext },
            )
          : { ok: false, reason: "Preview unavailable." };
      return { effect, preview };
    })
    .filter((entry) => entry.preview?.ok !== false);
}

export function getFirstActivatableMonsterIgnitionEffect(
  card,
  player,
  activationZone = "field",
  options = {},
) {
  const engine = this || {};
  const entries =
    typeof engine.getActivatableMonsterIgnitionEffects === "function"
      ? engine.getActivatableMonsterIgnitionEffects(
          card,
          player,
          activationZone,
          options,
        )
      : getActivatableMonsterIgnitionEffects.call(
          engine,
          card,
          player,
          activationZone,
          options,
        );
  return entries?.[0] || null;
}

/**
 * Get the activation effect for a Field Spell.
 * Looks for on_field_activate or an ignition effect declared for Field Zone.
 */
export function getFieldSpellActivationEffect(card) {
  if (!card || !Array.isArray(card.effects)) {
    return null;
  }
  return (
    card.effects.find(
      (e) =>
        e &&
        (e.timing === "on_field_activate" ||
          (e.timing === "ignition" &&
            getCanonicalEffectActivationZones(card, e).includes("fieldSpell")))
    ) || null
  );
}
