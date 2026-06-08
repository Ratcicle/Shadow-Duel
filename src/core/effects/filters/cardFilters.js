import { cardMatchesKind } from "../../Card.js";

export function cardMatchesFilters(card, filters = {}) {
  if (!card) return false;
  const idFilter = filters.cardId ?? filters.id;
  if (idFilter !== undefined && idFilter !== null && card.id !== idFilter) {
    return false;
  }
  const idsFilter = filters.cardIds ?? filters.ids;
  if (
    Array.isArray(idsFilter) &&
    idsFilter.length > 0 &&
    !idsFilter.includes(card.id)
  ) {
    return false;
  }
  const nameFilter = filters.name || filters.cardName;
  if (nameFilter && card.name !== nameFilter) return false;
  if ((filters.requireFaceup === true || filters.faceUp === true) && card.isFacedown) {
    return false;
  }
  if (filters.facedown === true && card.isFacedown !== true) {
    return false;
  }
  const excludeNameFilters = [
    filters.excludeName,
    filters.excludeCardName,
    ...(Array.isArray(filters.excludeNames) ? filters.excludeNames : []),
    ...(Array.isArray(filters.excludeCardNames)
      ? filters.excludeCardNames
      : []),
  ].filter(Boolean);
  if (excludeNameFilters.includes(card.name)) return false;
  const excludeIdFilters = [
    filters.excludeId,
    filters.excludeCardId,
    ...(Array.isArray(filters.excludeIds) ? filters.excludeIds : []),
    ...(Array.isArray(filters.excludeCardIds) ? filters.excludeCardIds : []),
  ].filter((value) => value !== undefined && value !== null);
  if (excludeIdFilters.includes(card.id)) return false;
  if (filters.cardKind) {
    if (!cardMatchesKind(card, filters.cardKind)) return false;
  }
  if (filters.isToken !== undefined) {
    if ((card.isToken === true) !== Boolean(filters.isToken)) return false;
  }
  if (filters.subtype) {
    const requiredSubtypes = Array.isArray(filters.subtype)
      ? filters.subtype
      : [filters.subtype];
    if (!requiredSubtypes.includes(card.subtype)) return false;
  }
  if (filters.monsterType) {
    const requiredMonsterTypes = Array.isArray(filters.monsterType)
      ? filters.monsterType
      : [filters.monsterType];
    if (!requiredMonsterTypes.includes(card.monsterType)) return false;
  }
  if (filters.type) {
    const cardType = card.type || null;
    const cardTypes = Array.isArray(card.types) ? card.types : null;
    if (Array.isArray(filters.type)) {
      const ok = cardTypes
        ? filters.type.some((t) => cardTypes.includes(t))
        : filters.type.includes(cardType);
      if (!ok) return false;
    } else {
      const ok = cardTypes
        ? cardTypes.includes(filters.type)
        : cardType === filters.type;
      if (!ok) return false;
    }
  }
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  if (filters.level !== undefined) {
    const lvl = card.level || 0;
    const op = filters.levelOp || "eq";
    if (op === "eq" && lvl !== filters.level) return false;
    if (op === "lte" && lvl > filters.level) return false;
    if (op === "gte" && lvl < filters.level) return false;
    if (op === "lt" && lvl >= filters.level) return false;
    if (op === "gt" && lvl <= filters.level) return false;
  }
  if (filters.minLevel !== undefined && (card.level || 0) < filters.minLevel) {
    return false;
  }
  if (filters.maxLevel !== undefined && (card.level || 0) > filters.maxLevel) {
    return false;
  }
  if (filters.minAtk !== undefined && (card.atk || 0) < filters.minAtk) {
    return false;
  }
  if (filters.maxAtk !== undefined && (card.atk || 0) > filters.maxAtk) {
    return false;
  }
  if (filters.minDef !== undefined && (card.def || 0) < filters.minDef) {
    return false;
  }
  if (filters.maxDef !== undefined && (card.def || 0) > filters.maxDef) {
    return false;
  }
  const counterType =
    filters.counterType ||
    (typeof filters.hasCounter === "string" ? filters.hasCounter : null);
  const hasCounterFilter =
    counterType ||
    filters.minCounters !== undefined ||
    filters.maxCounters !== undefined;
  if (hasCounterFilter) {
    const type = counterType || "default";
    const counterCount =
      typeof card.getCounter === "function" ? card.getCounter(type) : 0;
    const minCounters =
      filters.minCounters !== undefined
        ? filters.minCounters
        : filters.hasCounter
          ? 1
          : 0;
    if (counterCount < minCounters) return false;
    if (
      filters.maxCounters !== undefined &&
      counterCount > filters.maxCounters
    ) {
      return false;
    }
  }
  if (filters.equippedWithFilters) {
    const equipFilters = filters.equippedWithFilters || {};
    const requireEquipFaceup = equipFilters.requireFaceup !== false;
    const equips = Array.isArray(card.equips) ? card.equips : [];
    const hasMatchingEquip = equips.some((equip) => {
      if (!equip) return false;
      if (!this.isActiveEquipForCard(equip, card)) return false;
      if (requireEquipFaceup && equip.isFacedown) return false;
      return this.cardMatchesFilters(equip, equipFilters);
    });
    if (!hasMatchingEquip) return false;
  }
  return true;
}
