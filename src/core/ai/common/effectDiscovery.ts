import type { SimulatedCardState } from "../../contracts/aiState.js";
import type { ActionType } from "../../contracts/actions.js";
import type { EffectDefinition } from "../../contracts/effects.js";
import type { CanonicalZone } from "../../contracts/zones.js";

function getEffects(card: SimulatedCardState | null | undefined): readonly EffectDefinition[] {
  return Array.isArray(card?.effects) ? card.effects : [];
}

function asArray<Value>(value: Value | readonly Value[] | null | undefined): readonly Value[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  return [value as Value];
}

function ignitionEffectMatchesZone(
  effect: EffectDefinition | null | undefined,
  zone: CanonicalZone | null = null,
): boolean {
  if (!effect || effect.timing !== "ignition") return false;
  if (!zone) return true;
  return checkEffectZoneLegality(null, effect, zone).ok;
}

export function findIgnitionEffects(
  card: SimulatedCardState | null | undefined,
  zone: CanonicalZone | null = null,
): EffectDefinition[] {
  return getEffects(card).filter((effect) =>
    ignitionEffectMatchesZone(effect, zone)
  );
}

export function findIgnitionEffect(
  card: SimulatedCardState | null | undefined,
  zone: CanonicalZone | null = null,
): EffectDefinition | null {
  return findIgnitionEffects(card, zone)[0] || null;
}

export function findSpellActivationEffect(
  card: SimulatedCardState | null | undefined,
  _game: unknown = null,
  options: { timings?: readonly EffectDefinition["timing"][] } = {},
): EffectDefinition | null {
  const timings = options.timings || ["on_play", "on_activate"];
  return (
    getEffects(card).find((effect) =>
      effect && timings.includes(effect.timing)
    ) || null
  );
}

export function findFieldSpellEffect(
  card: SimulatedCardState | null | undefined,
): EffectDefinition | null {
  return (
    getEffects(card).find((effect) => effect?.timing === "on_field_activate") ||
    findIgnitionEffect(card, "fieldSpell")
  );
}

export function hasOncePerTurnEffect(
  card: SimulatedCardState | null | undefined,
): boolean {
  return getEffects(card).some(
    (effect) => effect?.oncePerTurn || effect?.oncePerTurnName,
  );
}

export function effectHasActionType(
  effect: EffectDefinition | null | undefined,
  actionType: ActionType | readonly ActionType[],
): boolean {
  const actionTypes = asArray(actionType);
  if (!effect || actionTypes.length === 0) return false;
  return (effect.actions || []).some((action) =>
    actionTypes.includes(action?.type)
  );
}

export function cardHasActionType(
  card: SimulatedCardState | null | undefined,
  actionType: ActionType | readonly ActionType[],
): boolean {
  return getEffects(card).some((effect) =>
    effectHasActionType(effect, actionType)
  );
}

import { checkEffectZoneLegality } from "../../chain/legality.js";
