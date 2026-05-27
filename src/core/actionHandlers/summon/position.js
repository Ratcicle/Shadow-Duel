export function resolveContextualSummonPosition(action, ctx, card) {
  const preferences =
    ctx?.actionContext?.specialSummonPositions ||
    ctx?.activationContext?.actionContext?.specialSummonPositions ||
    null;
  const targetRef = action?.targetRef || null;
  const byTarget =
    targetRef && preferences?.byTargetRef
      ? preferences.byTargetRef[targetRef]
      : null;
  const byName =
    card?.name && preferences?.byName ? preferences.byName[card.name] : null;
  const preferred = byTarget || byName || preferences?.default || null;
  return preferred === "attack" || preferred === "defense"
    ? preferred
    : action.position;
}

