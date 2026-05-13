export function cardHasArchetype(card, archetype) {
  if (!card || !archetype) return true;
  return (
    card.archetype === archetype ||
    (Array.isArray(card.archetypes) && card.archetypes.includes(archetype))
  );
}

export function cardMatchesFilter(card, filter = {}) {
  if (!card) return false;

  const nested = filter.filters || {};
  const checks = [filter, nested];

  for (const current of checks) {
    if (!current) continue;
    if (current.cardKind && card.cardKind !== current.cardKind) return false;
    if (current.archetype && !cardHasArchetype(card, current.archetype)) {
      return false;
    }
    if (
      Array.isArray(current.archetypes) &&
      !current.archetypes.some((archetype) => cardHasArchetype(card, archetype))
    ) {
      return false;
    }
    if (current.cardName && card.name !== current.cardName) return false;
    if (current.name && card.name !== current.name) return false;
    if (current.type && card.type !== current.type) return false;
    if (current.requireFaceup && card.isFacedown) return false;
    if (current.excludeCardName && card.name === current.excludeCardName) {
      return false;
    }
    if (
      Array.isArray(current.excludeCardNames) &&
      current.excludeCardNames.includes(card.name)
    ) {
      return false;
    }
  }

  const level = Number(card.level || 0);
  const levelFilter = filter.level ?? nested.level;
  const levelOp = filter.levelOp || nested.levelOp || "lte";
  if (Number.isFinite(levelFilter)) {
    if (levelOp === "eq" && level !== levelFilter) return false;
    if (levelOp === "lte" && level > levelFilter) return false;
    if (levelOp === "gte" && level < levelFilter) return false;
  }

  const minLevel = filter.minLevel ?? nested.minLevel;
  const maxLevel = filter.maxLevel ?? nested.maxLevel;
  if (Number.isFinite(minLevel) && level < minLevel) return false;
  if (Number.isFinite(maxLevel) && level > maxLevel) return false;

  const atk = Number(card.atk || 0);
  const minAtk = filter.minAtk ?? nested.minAtk;
  const maxAtk = filter.maxAtk ?? nested.maxAtk;
  if (Number.isFinite(minAtk) && atk < minAtk) return false;
  if (Number.isFinite(maxAtk) && atk > maxAtk) return false;

  const def = Number(card.def || 0);
  const minDef = filter.minDef ?? nested.minDef;
  const maxDef = filter.maxDef ?? nested.maxDef;
  if (Number.isFinite(minDef) && def < minDef) return false;
  if (Number.isFinite(maxDef) && def > maxDef) return false;

  return true;
}

export function getPlayerZoneCards(player, zone) {
  if (!player || !zone) return [];
  if (zone === "fieldSpell") {
    return player.fieldSpell ? [player.fieldSpell] : [];
  }
  const cards = player[zone];
  return Array.isArray(cards) ? cards : [];
}

export function countZoneCandidates(player, targetSpec = {}) {
  const zones = Array.isArray(targetSpec.zones)
    ? targetSpec.zones
    : [targetSpec.zone || "field"];
  return zones.reduce((count, zone) => {
    const candidates = getPlayerZoneCards(player, zone).filter((card) =>
      cardMatchesFilter(card, targetSpec),
    );
    return count + candidates.length;
  }, 0);
}

export function countValidCostCandidates(player, targetSpec = {}) {
  return countZoneCandidates(player, targetSpec);
}

export function countStrategicallyViableCostCandidates(
  player,
  targetSpec = {},
  activationContext = null,
) {
  const zones = Array.isArray(targetSpec.zones)
    ? targetSpec.zones
    : [targetSpec.zone || "field"];
  const candidates = zones.flatMap((zone) =>
    getPlayerZoneCards(player, zone).filter((card) =>
      cardMatchesFilter(card, targetSpec),
    ),
  );
  if (candidates.length === 0) return 0;

  const costPreferences =
    activationContext?.actionContext?.costPreferences ||
    activationContext?.costPreferences ||
    null;
  if (!costPreferences) return candidates.length;

  const preserveNames = new Set(costPreferences.preserveNames || []);
  const payoffNames = new Set(costPreferences.offensivePayoffNames || []);
  const availablePayoffs = Number.isFinite(
    costPreferences.availableOffensivePayoffs,
  )
    ? costPreferences.availableOffensivePayoffs
    : 0;

  return candidates.filter((card) => {
    if (preserveNames.has(card?.name)) return false;
    if (
      costPreferences.preserveLastOffensivePayoff &&
      payoffNames.has(card?.name) &&
      availablePayoffs <= 1
    ) {
      return false;
    }
    return true;
  }).length;
}
