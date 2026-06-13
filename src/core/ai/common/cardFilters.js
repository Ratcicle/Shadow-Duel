export function cardHasArchetype(card, archetype) {
  if (!card || !archetype) return true;
  return (
    card.archetype === archetype ||
    (Array.isArray(card.archetypes) && card.archetypes.includes(archetype))
  );
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function matchesOne(value, expected) {
  const values = asArray(expected);
  if (values.length === 0) return true;
  return values.includes(value);
}

export function cardMatchesFilter(card, filter = {}) {
  if (!card) return false;

  const nested = filter.filters || {};
  const checks = [filter, nested];

  for (const current of checks) {
    if (!current) continue;
    if (current.cardKind && !matchesOne(card.cardKind, current.cardKind)) {
      return false;
    }
    if (current.cardId !== undefined && card.id !== current.cardId) return false;
    if (current.id !== undefined && card.id !== current.id) return false;
    const idList = current.cardIds || current.ids;
    if (
      Array.isArray(idList) &&
      idList.length > 0 &&
      !idList.includes(card.id)
    ) {
      return false;
    }
    if (current.subtype && !matchesOne(card.subtype, current.subtype)) {
      return false;
    }
    if (current.archetype && !cardHasArchetype(card, current.archetype)) {
      return false;
    }
    if (
      Array.isArray(current.archetypes) &&
      !current.archetypes.some((archetype) => cardHasArchetype(card, archetype))
    ) {
      return false;
    }
    if (current.cardName && !matchesOne(card.name, current.cardName)) {
      return false;
    }
    if (current.name && !matchesOne(card.name, current.name)) return false;
    if (current.type) {
      const cardTypes = Array.isArray(card.types) ? card.types : [card.type];
      if (!asArray(current.type).some((type) => cardTypes.includes(type))) {
        return false;
      }
    }
    if (current.requireFaceup && card.isFacedown) return false;
    if (current.facedown === true && card.isFacedown !== true) return false;
    if (
      current.position &&
      current.position !== "any" &&
      card.position !== current.position
    ) {
      return false;
    }
    if (
      current.isToken !== undefined &&
      (card.isToken === true) !== Boolean(current.isToken)
    ) {
      return false;
    }
    const excludedNames = [
      current.excludeName,
      current.excludeCardName,
      ...asArray(current.excludeNames),
      ...asArray(current.excludeCardNames),
    ].filter(Boolean);
    if (excludedNames.includes(card.name)) return false;
    const excludedIds = [
      current.excludeId,
      current.excludeCardId,
      ...asArray(current.excludeIds),
      ...asArray(current.excludeCardIds),
    ].filter((value) => value !== undefined && value !== null);
    if (excludedIds.includes(card.id)) return false;
    if (current.equippedWithFilters) {
      const equips = Array.isArray(card.equips) ? card.equips : [];
      if (
        !equips.some((equip) =>
          cardMatchesFilter(equip, current.equippedWithFilters)
        )
      ) {
        return false;
      }
    }
  }

  const level = Number(card.level || 0);
  const levelFilter = filter.level ?? nested.level;
  const levelOp = filter.levelOp || nested.levelOp || "lte";
  if (Number.isFinite(levelFilter)) {
    if (levelOp === "eq" && level !== levelFilter) return false;
    if (levelOp === "lte" && level > levelFilter) return false;
    if (levelOp === "gte" && level < levelFilter) return false;
    if (levelOp === "lt" && level >= levelFilter) return false;
    if (levelOp === "gt" && level <= levelFilter) return false;
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
