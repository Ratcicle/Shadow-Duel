export function getSourceScope(action = {}) {
  return action.sourceOwner || action.sourceScope || action.scope || "self";
}

export function getSourceOwners(action, ctx, fallbackPlayer) {
  const player = ctx?.player || fallbackPlayer;
  const opponent = ctx?.opponent;
  const scope = getSourceScope(action);

  if (scope === "opponent") {
    return opponent ? [opponent] : [];
  }
  if (scope === "both" || scope === "any") {
    return [player, opponent].filter(Boolean);
  }
  return player ? [player] : [];
}

export function buildSourceZoneEntries(zoneNames, owners) {
  return zoneNames
    .filter((name) => typeof name === "string")
    .flatMap((name) =>
      owners
        .filter(Boolean)
        .map((owner) => ({ owner, name, list: owner?.[name] }))
        .filter((entry) => Array.isArray(entry.list)),
    );
}

export function findSourceEntryForCard(sourceZoneEntries, card) {
  return sourceZoneEntries.find((entry) => entry.list?.includes(card)) || null;
}

