function normalizeNameList(names = []) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(names) ? names : [names]) {
    const name =
      typeof value === "string" ? value.trim() : value?.name?.trim?.() || "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

function normalizeAttributeList(attributes = []) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(attributes) ? attributes : [attributes]) {
    const attribute =
      typeof value === "string"
        ? value.trim()
        : value?.attribute?.trim?.() || "";
    if (!attribute) continue;
    const key = attribute.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(attribute);
  }
  return result;
}

function cloneRestrictionFilters(filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    return {};
  }
  return { ...filters };
}

function matchesOne(value, expected) {
  const values = Array.isArray(expected) ? expected : [expected];
  if (values.length === 0) return true;
  return values.includes(value);
}

function matchesTextValue(value, expected) {
  const values = Array.isArray(expected) ? expected : [expected];
  const filtered = values.filter((entry) => entry !== undefined && entry !== null);
  if (filtered.length === 0) return true;
  const actual = String(value || "").toLowerCase();
  return filtered.some((entry) => String(entry || "").toLowerCase() === actual);
}

function cardMatchesRestrictionFilters(card, filters = {}) {
  if (!card) return false;
  if (!filters || Object.keys(filters).length === 0) return true;
  if (filters.cardKind && !matchesOne(card.cardKind, filters.cardKind)) {
    return false;
  }
  if (filters.monsterType && !matchesOne(card.monsterType, filters.monsterType)) {
    return false;
  }
  if (filters.type && !matchesOne(card.type, filters.type)) return false;
  if (filters.attribute && !matchesTextValue(card.attribute, filters.attribute)) {
    return false;
  }
  if (filters.name && !matchesOne(card.name, filters.name)) return false;
  if (filters.cardName && !matchesOne(card.name, filters.cardName)) return false;
  if (filters.cardId !== undefined && card.id !== filters.cardId) return false;
  if (
    Array.isArray(filters.cardIds) &&
    filters.cardIds.length > 0 &&
    !filters.cardIds.includes(card.id)
  ) {
    return false;
  }
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  return true;
}

function normalizeEffectActivationRestriction(game, restriction = {}) {
  const duration = restriction.duration || "until_end_turn";
  const expiresOnTurn =
    duration === "until_end_turn"
      ? Number(game?.turnCounter || 0)
      : Number.isFinite(restriction.expiresOnTurn)
        ? restriction.expiresOnTurn
        : null;
  const blockedNames = normalizeNameList(
    restriction.blockedNames || restriction.names || restriction.cardNames || [],
  );
  const allowedAttributes = normalizeAttributeList(
    restriction.allowedAttributes || restriction.attributes || [],
  );
  const restrictedCardFilters = cloneRestrictionFilters(
    restriction.restrictedCardFilters || restriction.cardFilters || {},
  );

  return {
    blockedNames,
    allowedAttributes,
    restrictedCardFilters,
    duration,
    expiresOnTurn,
    reason: restriction.reason || null,
    sourceName: restriction.sourceName || restriction.sourceCard?.name || null,
    sourceId: restriction.sourceId || restriction.sourceCard?.id || null,
    effectId: restriction.effectId || null,
  };
}

function effectCanBeBlocked(effect) {
  if (!effect || effect.placementOnly === true) return false;
  if (effect.timing === "passive") return false;
  return true;
}

export function registerEffectActivationRestriction(player, restriction = {}) {
  if (!player) return false;
  const normalized = normalizeEffectActivationRestriction(this, restriction);
  if (
    normalized.blockedNames.length === 0 &&
    normalized.allowedAttributes.length === 0
  ) {
    return false;
  }
  if (!Array.isArray(player.effectActivationRestrictions)) {
    player.effectActivationRestrictions = [];
  }
  player.effectActivationRestrictions.push(normalized);
  this.effectEngine?.clearTargetingCache?.();
  this.updateBoard?.();
  return true;
}

export function cleanupExpiredEffectActivationRestrictions(player = null) {
  const players = player ? [player] : [this?.player, this?.bot].filter(Boolean);
  const currentTurn = Number(this?.turnCounter || 0);
  for (const entryPlayer of players) {
    const restrictions = Array.isArray(entryPlayer?.effectActivationRestrictions)
      ? entryPlayer.effectActivationRestrictions
      : [];
    entryPlayer.effectActivationRestrictions = restrictions.filter((restriction) => {
      if (!restriction || restriction.duration !== "until_end_turn") return true;
      if (!Number.isFinite(restriction.expiresOnTurn)) return true;
      return restriction.expiresOnTurn >= currentTurn;
    });
  }
}

export function canActivateCardEffectUnderRestrictions(
  card,
  player,
  effect,
  options = {},
) {
  if (!card || !player || !effectCanBeBlocked(effect)) return { ok: true };

  this.cleanupExpiredEffectActivationRestrictions?.(player);
  const restrictions = Array.isArray(player.effectActivationRestrictions)
    ? player.effectActivationRestrictions
    : [];
  const cardName = card.name || "";

  for (const restriction of restrictions) {
    const blockedNames = normalizeNameList(
      restriction?.blockedNames || restriction?.names || [],
    );
    if (cardName && blockedNames.includes(cardName)) {
      const reason =
        restriction.reason ||
        `${player.name || "Player"} cannot activate effects of ${cardName} this turn.`;
      if (options.silent !== true) this?.ui?.log?.(reason);
      return {
        ok: false,
        reason,
        code: "effect_activation_restricted",
        restriction,
      };
    }

    const allowedAttributes = normalizeAttributeList(
      restriction?.allowedAttributes || restriction?.attributes || [],
    );
    if (allowedAttributes.length === 0) continue;
    const restrictedCardFilters =
      restriction?.restrictedCardFilters &&
      Object.keys(restriction.restrictedCardFilters).length > 0
        ? restriction.restrictedCardFilters
        : { cardKind: "monster" };
    if (!cardMatchesRestrictionFilters(card, restrictedCardFilters)) continue;
    if (matchesTextValue(card.attribute, allowedAttributes)) continue;

    const reason =
      restriction.reason ||
      `${player.name || "Player"} cannot activate effects of monsters except ${allowedAttributes.join(
        "/",
      )} monsters this turn.`;
    if (options.silent !== true) this?.ui?.log?.(reason);
    return {
      ok: false,
      reason,
      code: "effect_activation_attribute_restricted",
      restriction,
    };
  }

  return { ok: true };
}
