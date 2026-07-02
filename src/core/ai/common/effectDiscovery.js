function getEffects(card) {
  return Array.isArray(card?.effects) ? card.effects : [];
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function ignitionEffectMatchesZone(effect, zone = null) {
  if (!effect || effect.timing !== "ignition") return false;
  if (!zone) return true;
  if (zone === "field" || zone === "spellTrap") {
    return !effect.requireZone || effect.requireZone === zone;
  }
  return effect.requireZone === zone;
}

export function findIgnitionEffects(card, zone = null) {
  return getEffects(card).filter((effect) =>
    ignitionEffectMatchesZone(effect, zone)
  );
}

export function findIgnitionEffect(card, zone = null) {
  return findIgnitionEffects(card, zone)[0] || null;
}

export function findSpellActivationEffect(card, _game = null, options = {}) {
  const timings = options.timings || ["on_play", "on_activate"];
  return (
    getEffects(card).find((effect) =>
      effect && timings.includes(effect.timing)
    ) || null
  );
}

export function findFieldSpellEffect(card) {
  return (
    getEffects(card).find((effect) => effect?.timing === "on_field_activate") ||
    findIgnitionEffect(card, "fieldSpell")
  );
}

export function hasOncePerTurnEffect(card) {
  return getEffects(card).some(
    (effect) => effect?.oncePerTurn || effect?.oncePerTurnName,
  );
}

export function effectHasActionType(effect, actionType) {
  const actionTypes = asArray(actionType);
  if (!effect || actionTypes.length === 0) return false;
  return (effect.actions || []).some((action) =>
    actionTypes.includes(action?.type)
  );
}

export function cardHasActionType(card, actionType) {
  return getEffects(card).some((effect) =>
    effectHasActionType(effect, actionType)
  );
}
