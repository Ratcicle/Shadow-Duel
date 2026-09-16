/**
 * activation/getters.ts
 * Effect getter methods for activation system
 * Functions assume `this` = EffectEngine instance
 */

import { getCanonicalEffectActivationZones } from "../../chain/legality.js";
import type { EffectDefinition } from "../../contracts/effects.js";
import type { ActivationZone } from "../../contracts/activation.js";
import type {
  ActivatableMonsterEffectEntry,
  ActivationCard,
  ActivationEngineHost,
  ActivationGetterHost,
  ActivationPlayer,
  ActivationPreviewOptions,
  MonsterEffectLookupOptions,
  SpellTrapActivationOptions,
} from "./runtime.js";

/**
 * Get the on_play activation effect for a card played from hand.
 * For field spells, only check on_play timing - on_field_activate effects
 * are handled separately after the card is placed on the field.
 */
export function getHandActivationEffect(
  card: ActivationCard | null | undefined,
): EffectDefinition | null {
  if (!card || !Array.isArray(card.effects)) {
    return null;
  }
  // For field spells, only return on_play effects when playing from hand.
  // on_field_activate effects are activated after placement, not during hand play.
  return card.effects.find((e) => e && e.timing === "on_play") || null;
}

function isTrapActivationFromSet(
  card: ActivationCard,
  options: SpellTrapActivationOptions = {},
): boolean {
  return (
    card?.cardKind === "trap" &&
    (options.trapActivationFromSet === true ||
      options.fromSet === true ||
      card.isFacedown === true)
  );
}

function ignitionMatchesActivationZone(
  effect: EffectDefinition | null | undefined,
  activationZone: ActivationZone = "spellTrap",
): boolean {
  if (!effect || effect.timing !== "ignition") return false;
  const allowedZones = getCanonicalEffectActivationZones(null, effect);
  return (
    allowedZones.some((zone) => zone === activationZone) ||
    (allowedZones.includes("field") && activationZone === "spellTrap")
  );
}

/**
 * Get the activation effect for a Spell/Trap card.
 * For traps: on_activate or ignition timing
 * For spells: ignition timing (or on_play if fromHand)
 */
export function getSpellTrapActivationEffect(
  this: Pick<ActivationEngineHost, "getHandActivationEffect">,
  card: ActivationCard | null | undefined,
  options: SpellTrapActivationOptions = {},
): EffectDefinition | null {
  if (!card || !Array.isArray(card.effects)) {
    return null;
  }
  const activationZone =
    options.activationZone ||
    (options.fromHand === true ? "hand" : "spellTrap");
  if (card.cardKind === "trap") {
    if (isTrapActivationFromSet(card, options)) {
      return card.effects.find((e) => e && e.timing === "on_activate") || null;
    }
    return (
      card.effects.find((e) =>
        ignitionMatchesActivationZone(e, activationZone),
      ) || null
    );
  }
  if (card.cardKind === "spell") {
    const fromHand = options.fromHand === true;
    if (fromHand) {
      return this.getHandActivationEffect(card);
    }
    const ignition = card.effects.find((e) =>
      ignitionMatchesActivationZone(e, activationZone),
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
function monsterIgnitionMatchesActivationZone(
  effect: EffectDefinition | null | undefined,
  activationZone: ActivationZone = "field",
): boolean {
  if (!effect || effect.timing !== "ignition") return false;
  return getCanonicalEffectActivationZones(null, effect).some(
    (zone) => zone === activationZone,
  );
}

export function getMonsterIgnitionEffects(
  card: ActivationCard | null | undefined,
  activationZone: ActivationZone = "field",
): EffectDefinition[] {
  if (!card || !Array.isArray(card.effects)) {
    return [];
  }
  return card.effects.filter((effect) =>
    monsterIgnitionMatchesActivationZone(effect, activationZone),
  );
}

export function getMonsterIgnitionEffect(
  this: ActivationGetterHost | null | undefined,
  card: ActivationCard | null | undefined,
  activationZone: ActivationZone = "field",
  options: MonsterEffectLookupOptions | string = {},
): EffectDefinition | null {
  const engine: ActivationGetterHost = this || {};
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
  this: ActivationGetterHost | null | undefined,
  card: ActivationCard,
  player: ActivationPlayer,
  activationZone: ActivationZone = "field",
  options: ActivationPreviewOptions = {},
): ActivatableMonsterEffectEntry[] {
  const engine: ActivationGetterHost = this || {};
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
  this: ActivationGetterHost | null | undefined,
  card: ActivationCard,
  player: ActivationPlayer,
  activationZone: ActivationZone = "field",
  options: ActivationPreviewOptions = {},
): ActivatableMonsterEffectEntry | null {
  const engine: ActivationGetterHost = this || {};
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
export function getFieldSpellActivationEffect(
  card: ActivationCard | null | undefined,
): EffectDefinition | null {
  if (!card || !Array.isArray(card.effects)) {
    return null;
  }
  return (
    card.effects.find(
      (e) =>
        e &&
        (e.timing === "on_field_activate" ||
          (e.timing === "ignition" &&
            getCanonicalEffectActivationZones(card, e).includes("fieldSpell"))),
    ) || null
  );
}
