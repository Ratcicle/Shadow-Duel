/**
 * Targeting Selection Module
 * Extracted from EffectEngine.js - candidate selection and key building
 *
 * All functions assume `this` = EffectEngine instance
 */

import { botLogger } from "../../BotLogger.js";
import { cardMatchesKind } from "../../Card.js";

// Track duplicate selectCandidates calls per turn
const selectCandidatesCallTracker = {};

function cardCacheIdentity(card, fallbackIndex = 0) {
  if (!card) return `empty:${fallbackIndex}`;
  const instanceId =
    card.instanceId || card._instanceId || card.uuid || card.simInstanceId || null;
  return [
    instanceId || card.id || card.name || fallbackIndex,
    card.name || "",
    card.owner || "",
    card.position || "",
    card.isFacedown ? "down" : "up",
  ].join(":");
}

function getCardInstanceId(card) {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? card?.simInstanceId ?? null;
}

function isExcludedInstance(card, filter = {}) {
  if (!card || !filter) return false;
  const excludedCards = Array.isArray(filter.excludeCards)
    ? filter.excludeCards
    : [];
  if (excludedCards.some((excluded) => isSameCardReference(excluded, card))) {
    return true;
  }
  const cardInstanceId = getCardInstanceId(card);
  const excludedInstanceIds = [
    filter.excludeInstanceId,
    ...(Array.isArray(filter.excludeInstanceIds)
      ? filter.excludeInstanceIds
      : []),
    ...(Array.isArray(filter.excludeCardInstanceIds)
      ? filter.excludeCardInstanceIds
      : []),
  ].filter((value) => value !== undefined && value !== null);
  return cardInstanceId !== null && excludedInstanceIds.includes(cardInstanceId);
}

function getZoneSnapshot(player, zoneKey) {
  if (!player) return [];
  if (zoneKey === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  const zone = player[zoneKey];
  return Array.isArray(zone) ? zone : [];
}

function normalizeContextCardKeys(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null) return [];
  return [value];
}

function getContextCards(ctx, key) {
  if (!ctx || !key) return [];
  const value = ctx[key];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function isSameCardReference(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftInstance = left.instanceId ?? left._instanceId ?? null;
  const rightInstance = right.instanceId ?? right._instanceId ?? null;
  return leftInstance != null && leftInstance === rightInstance;
}

function isExcludedContextCard(def, ctx, card) {
  const keys = [
    ...normalizeContextCardKeys(def.excludeContextCard),
    ...normalizeContextCardKeys(def.excludeContextCards),
  ];
  if (keys.length === 0) return false;
  return keys.some((key) =>
    getContextCards(ctx, key).some((contextCard) =>
      isSameCardReference(contextCard, card),
    ),
  );
}

function getSpecialSummonProcedureForTarget(def = {}) {
  return def.summonProcedure || def.specialSummonProcedure || "special";
}

function getSpecialSummonDestinationPlayer(def = {}, ctx = {}) {
  if (def.summonToOwner === "opponent" || def.destinationOwner === "opponent") {
    return ctx.opponent || null;
  }
  return ctx.player || null;
}

function canTargetBeSpecialSummoned(engine, card, def = {}, ctx = {}, zoneKey = null) {
  if (!card) return false;
  if (card.cannotBeSpecialSummoned) return false;

  const summonProcedure = getSpecialSummonProcedureForTarget(def);
  if (
    Array.isArray(card.specialSummonOnlyBy) &&
    !card.specialSummonOnlyBy.includes(summonProcedure)
  ) {
    return false;
  }

  const destinationPlayer = getSpecialSummonDestinationPlayer(def, ctx);
  const restrictionCheck =
    engine?.game?.canSpecialSummonUnderRestrictions?.(
      card,
      destinationPlayer,
      {
        summonMethod: def.summonMethod || "special",
        summonProcedure,
        fromZone: zoneKey || def.zone || null,
        silent: true,
      },
    );
  return restrictionCheck?.ok !== false;
}

function normalizeList(value, fallback = []) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null) return fallback;
  return [value];
}

function getPairedTargetSpec(def = {}) {
  return def.pairedTarget || def.requiresPairedTarget || null;
}

function getPairedTargetOwners(pairSpec = {}, ctx = {}) {
  const ownerRule = pairSpec.owner || pairSpec.player || "self";
  if (ownerRule === "opponent") return [ctx.opponent].filter(Boolean);
  if (ownerRule === "any" || ownerRule === "both" || ownerRule === "either") {
    return [ctx.player, ctx.opponent].filter(Boolean);
  }
  return [ctx.player].filter(Boolean);
}

function buildPairedTargetFilters(pairSpec = {}) {
  const filters = { ...(pairSpec.filters || {}) };
  const copyIfPresent = (sourceKey, filterKey = sourceKey) => {
    if (pairSpec[sourceKey] !== undefined && filters[filterKey] === undefined) {
      filters[filterKey] = pairSpec[sourceKey];
    }
  };

  copyIfPresent("cardKind");
  copyIfPresent("type");
  copyIfPresent("attribute");
  copyIfPresent("archetype");
  copyIfPresent("name");
  copyIfPresent("cardName", "name");
  copyIfPresent("cardId");
  copyIfPresent("cardIds");
  copyIfPresent("subtype");
  copyIfPresent("monsterType");
  copyIfPresent("level");
  copyIfPresent("levelOp");
  copyIfPresent("minLevel");
  copyIfPresent("maxLevel");
  copyIfPresent("minAtk");
  copyIfPresent("maxAtk");
  copyIfPresent("minDef");
  copyIfPresent("maxDef");
  copyIfPresent("requireFaceup");
  copyIfPresent("isToken");
  copyIfPresent("isTuner");
  copyIfPresent("excludeCannotBeSpecialSummoned");
  return filters;
}

function buildTargetCardFilters(def = {}) {
  const filters = { ...(def.filters || {}) };
  const copyIfPresent = (sourceKey, filterKey = sourceKey) => {
    if (def[sourceKey] !== undefined && filters[filterKey] === undefined) {
      filters[filterKey] = def[sourceKey];
    }
  };

  copyIfPresent("cardKind");
  copyIfPresent("cardId");
  copyIfPresent("cardIds");
  copyIfPresent("cardName", "name");
  copyIfPresent("name");
  copyIfPresent("subtype");
  copyIfPresent("monsterType");
  copyIfPresent("type");
  copyIfPresent("attribute");
  copyIfPresent("archetype");
  copyIfPresent("level");
  copyIfPresent("levelOp");
  copyIfPresent("minLevel");
  copyIfPresent("maxLevel");
  copyIfPresent("minAtk");
  copyIfPresent("maxAtk");
  copyIfPresent("minDef");
  copyIfPresent("maxDef");
  copyIfPresent("position");
  copyIfPresent("isToken");
  copyIfPresent("isTuner");
  copyIfPresent("requireFaceup");
  copyIfPresent("faceUp");
  copyIfPresent("lastSummonMethods");
  copyIfPresent("summonMethods");
  copyIfPresent("lastSummonMethod");
  copyIfPresent("summonMethod");
  copyIfPresent("counterType");
  copyIfPresent("hasCounter");
  copyIfPresent("minCounters");
  copyIfPresent("maxCounters");
  copyIfPresent("sentToGraveAsMaterial");
  copyIfPresent("sentAsMaterial");
  copyIfPresent("lastSentToGraveAsMaterial");
  copyIfPresent("sentToGraveAsMaterialThisTurn");
  copyIfPresent("sentAsMaterialThisTurn");
  copyIfPresent("sentToGraveAsMaterialTurn");
  copyIfPresent("sentAsMaterialTurn");
  return filters;
}

function targetCardMatchesFilters(engine, card, def = {}) {
  const filters = buildTargetCardFilters(def);
  if (Object.keys(filters).length === 0) return true;
  if (typeof engine?.cardMatchesFilters !== "function") return true;
  return engine.cardMatchesFilters(card, filters);
}

function comparePairedValues(left, op = "eq", right) {
  if (op === "eq" || op === "==" || op === "===") return left === right;
  if (op === "neq" || op === "!=" || op === "!==") return left !== right;

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
    return false;
  }
  if (op === "lte" || op === "<=") return leftNumber <= rightNumber;
  if (op === "lt" || op === "<") return leftNumber < rightNumber;
  if (op === "gte" || op === ">=") return leftNumber >= rightNumber;
  if (op === "gt" || op === ">") return leftNumber > rightNumber;
  return false;
}

function pairedTargetComparisonsPass(sourceCard, pairedCard, pairSpec = {}) {
  const comparisons = [
    ...normalizeList(pairSpec.compareAttribute),
    ...normalizeList(pairSpec.compareAttributes),
  ];
  if (comparisons.length === 0) return true;

  return comparisons.every((comparison) => {
    const attr = comparison.attr || comparison.attribute;
    const pairedAttr = comparison.pairedAttr || comparison.targetAttr || attr;
    const sourceAttr = comparison.sourceAttr || comparison.refAttr || attr;
    if (!pairedAttr || !sourceAttr) return false;
    return comparePairedValues(
      pairedCard?.[pairedAttr],
      comparison.op || "eq",
      sourceCard?.[sourceAttr],
    );
  });
}

function pairedTargetMatchesSource(engine, sourceCard, pairedCard, pairSpec, ctx) {
  if (!sourceCard || !pairedCard || !pairSpec) return false;
  if (pairSpec.excludeSameCard !== false && isSameCardReference(sourceCard, pairedCard)) {
    return false;
  }
  if (pairSpec.excludeSameName === true && sourceCard.name === pairedCard.name) {
    return false;
  }
  const filters = buildPairedTargetFilters(pairSpec);
  if (
    filters.excludeCannotBeSpecialSummoned === true &&
    pairedCard.cannotBeSpecialSummoned
  ) {
    return false;
  }
  if (
    Object.keys(filters).length > 0 &&
    typeof engine?.cardMatchesFilters === "function" &&
    !engine.cardMatchesFilters(pairedCard, filters)
  ) {
    return false;
  }
  if (filters.requireFaceup === true && pairedCard.isFacedown) return false;
  if (!pairedTargetComparisonsPass(sourceCard, pairedCard, pairSpec)) {
    return false;
  }
  if (pairSpec.excludeContextCard || pairSpec.excludeContextCards) {
    if (isExcludedContextCard(pairSpec, ctx, pairedCard)) return false;
  }
  return true;
}

function hasPairedTargetCandidate(engine, sourceCard, pairSpec, ctx) {
  if (!pairSpec) return true;
  const zones = normalizeList(pairSpec.zones ?? pairSpec.zone, ["field"]);
  for (const owner of getPairedTargetOwners(pairSpec, ctx)) {
    for (const zoneKey of zones) {
      for (const pairedCard of getZoneSnapshot(owner, zoneKey)) {
        if (pairedTargetMatchesSource(engine, sourceCard, pairedCard, pairSpec, ctx)) {
          return true;
        }
      }
    }
  }
  return false;
}

function buildZoneSignature(def, ctx) {
  const zoneName = def.zone || "field";
  const zoneList =
    Array.isArray(def.zones) && def.zones.length > 0 ? def.zones : [zoneName];
  const owners =
    def.owner === "opponent"
      ? [ctx?.opponent]
      : def.owner === "any"
        ? [ctx?.player, ctx?.opponent]
        : [ctx?.player];

  return owners
    .filter(Boolean)
    .map((owner) => {
      const ownerId = owner.id || "unknown";
      const zones = zoneList.map((zoneKey) => {
        const cards = getZoneSnapshot(owner, zoneKey);
        const signature = cards.map(cardCacheIdentity).join(",");
        return `${zoneKey}[${cards.length}]=${signature}`;
      });
      return `${ownerId}:${zones.join(";")}`;
    })
    .join("|");
}

/**
 * Build a unique cache key for targeting lookups.
 * @param {Object} def - Target definition
 * @param {Object} ctx - Context with player, opponent, source
 * @returns {string} Cache key
 */
function buildTargetingCacheKey(def, ctx) {
  const anyOfKey = Array.isArray(def.anyOf) ? JSON.stringify(def.anyOf) : "";
  const pairedTarget = getPairedTargetSpec(def);
  const parts = [
    def.id || "unknown",
    def.zone || "field",
    def.owner || "self",
    JSON.stringify(def.count || null),
    def.cardKind || "any",
    def.cardId ?? "",
    Array.isArray(def.cardIds) ? def.cardIds.join(",") : "",
    JSON.stringify(buildTargetCardFilters(def)),
    def.subtype || "any",
    def.archetype || "any",
    def.minAtk ?? "",
    def.maxAtk ?? "",
    def.minDef ?? "",
    def.maxDef ?? "",
    def.minLevel ?? "",
    def.maxLevel ?? "",
    def.isTuner ?? "",
    Array.isArray(def.lastSummonMethods)
      ? def.lastSummonMethods.join(",")
      : def.lastSummonMethods || "",
    Array.isArray(def.summonMethods)
      ? def.summonMethods.join(",")
      : def.summonMethods || "",
    def.lastSummonMethod || "",
    def.summonMethod || "",
    anyOfKey,
    def.excludeCardName || "",
    Array.isArray(def.excludeCardNames) ? def.excludeCardNames.join(",") : "",
    def.excludeInstanceId ?? "",
    Array.isArray(def.excludeInstanceIds) ? def.excludeInstanceIds.join(",") : "",
    Array.isArray(def.excludeCardInstanceIds)
      ? def.excludeCardInstanceIds.join(",")
      : "",
    Array.isArray(def.excludeCards)
      ? def.excludeCards
          .map((card, idx) => cardCacheIdentity(card, `excludeCard${idx}`))
          .join(",")
      : "",
    def.excludeEventCardName ? "excludeEventCardName" : "",
    def.excludeEventCardName && ctx?.eventCard
      ? cardCacheIdentity(ctx.eventCard, "eventCard")
      : "",
    normalizeContextCardKeys(def.excludeContextCard)
      .concat(normalizeContextCardKeys(def.excludeContextCards))
      .join(","),
    normalizeContextCardKeys(def.excludeContextCard)
      .concat(normalizeContextCardKeys(def.excludeContextCards))
      .flatMap((key) => getContextCards(ctx, key))
      .map((card, idx) => cardCacheIdentity(card, `excludeContext${idx}`))
      .join(","),
    def.battleParticipant ? "battleParticipant" : "",
    def.battleParticipant
      ? [ctx?.attacker, ctx?.defender || ctx?.target]
          .filter(Boolean)
          .map((card, idx) => cardCacheIdentity(card, `battle${idx}`))
          .join(",")
      : "",
    def.requireThisCard ? "this" : "",
    cardCacheIdentity(ctx.source, "source"),
    ctx.source?.name || "",
    ctx.player?.id || "p",
    buildZoneSignature(def, ctx),
    pairedTarget ? JSON.stringify(pairedTarget) : "",
    pairedTarget ? buildZoneSignature(pairedTarget, ctx) : "",
  ];
  return parts.join("|");
}

/**
 * Build a unique key for a selection candidate
 * @param {Object} candidate - The candidate object
 * @param {number} fallbackIndex - Fallback index if no other identifier available
 * @returns {string} Unique key string
 */
export function buildSelectionCandidateKey(candidate = {}, fallbackIndex = 0) {
  const zone = candidate.zone || "field";
  const zoneIndex =
    typeof candidate.zoneIndex === "number" ? candidate.zoneIndex : -1;
  const controller = candidate.controller || candidate.owner || "unknown";
  const baseId =
    candidate.cardRef?.id ||
    candidate.cardRef?.name ||
    candidate.name ||
    String(fallbackIndex);
  return `${controller}:${zone}:${zoneIndex}:${baseId}`;
}

/**
 * Select candidate cards matching a target definition
 * @param {Object} def - Target definition with zone, owner, filters, etc.
 * @param {Object} ctx - Context with player, opponent, source, etc.
 * @returns {{zoneName: string, candidates: Array}} Zone name and matching candidates
 */
export function selectCandidates(def, ctx) {
  const devMode =
    ctx?.game?.devModeEnabled === true ||
    ctx?.player?.game?.devModeEnabled === true;
  const logTargets =
    ctx?.activationContext?.logTargets === true ||
    (ctx?.activationContext?.logTargets !== false && devMode);
  const log = (...args) => {
    if (logTargets) {
      console.log(...args);
    }
  };
  const zoneName = def.zone || "field";
  const zoneList =
    Array.isArray(def.zones) && def.zones.length > 0 ? def.zones : [zoneName];
  const excludedDamageStepTargets = Array.isArray(
    ctx?.activationContext?.excludedDamageStepTargets,
  )
    ? ctx.activationContext.excludedDamageStepTargets
    : [];
  const bypassCache = excludedDamageStepTargets.length > 0;

  // ✅ CACHE: Gerar chave única baseada na definição do target
  const cacheKey = buildTargetingCacheKey(def, ctx);
  
  // 🔍 Duplicate Detection
  const turnKey = `turn_${(ctx?.player?.id || 'unknown')}`;
  if (!selectCandidatesCallTracker[turnKey]) {
    selectCandidatesCallTracker[turnKey] = {};
  }
  const callKey = `${def.id}_${zoneName}`;
  selectCandidatesCallTracker[turnKey][callKey] = (selectCandidatesCallTracker[turnKey][callKey] || 0) + 1;
  
  if (selectCandidatesCallTracker[turnKey][callKey] > 1 && botLogger) {
    botLogger.logDuplicate(
      'selectCandidates',
      `Target "${def.id}" in zone "${zoneName}"`,
      selectCandidatesCallTracker[turnKey][callKey],
      ctx.source?.name || 'unknown'
    );
  }
  
  const cached = bypassCache ? null : this._targetingCache?.get(cacheKey);
  
  if (cached) {
    if (this._targetingCacheHits !== undefined) {
      this._targetingCacheHits++;
    }
    return { zoneName: cached.zoneName, candidates: cached.candidates };
  }
  
  if (this._targetingCacheMisses !== undefined) {
    this._targetingCacheMisses++;
  }

  log(
    `[selectCandidates] Starting search for target "${def.id}": owner="${def.owner}", zone="${zoneName}", archetype="${def.archetype}", subtype="${def.subtype}", excludeCardName="${def.excludeCardName}"`
  );

  const owners = [];
  if (def.owner === "opponent") {
    owners.push(ctx.opponent);
  } else if (def.owner === "any") {
    owners.push(ctx.player, ctx.opponent);
  } else {
    owners.push(ctx.player);
  }

  const anyOf = Array.isArray(def.anyOf) ? def.anyOf : null;
  const matchesFilter = (card, filter) => {
    if (!card || !filter) return false;
    if (
      filter.excludeCannotBeSpecialSummoned &&
      !canTargetBeSpecialSummoned(this, card, filter, ctx, filter.zone)
    ) {
      return false;
    }
    if (filter.owner === "self" && card.owner !== ctx?.player?.id) return false;
    if (filter.owner === "opponent" && card.owner !== ctx?.opponent?.id)
      return false;
    if (filter.cardKind && !cardMatchesKind(card, filter.cardKind)) {
      return false;
    }
    if (filter.monsterType) {
      const requiredMonsterTypes = Array.isArray(filter.monsterType)
        ? filter.monsterType
        : [filter.monsterType];
      if (!requiredMonsterTypes.includes(card.monsterType)) return false;
    }
    if (filter.cardId !== undefined && card.id !== filter.cardId) {
      return false;
    }
    if (
      Array.isArray(filter.cardIds) &&
      filter.cardIds.length > 0 &&
      !filter.cardIds.includes(card.id)
    ) {
      return false;
    }
    if (filter.requireFaceup && card.isFacedown) return false;
    if (filter.isTuner !== undefined) {
      if ((card.isTuner === true) !== Boolean(filter.isTuner)) return false;
    }
    if (filter.position && filter.position !== "any") {
      if (card.position !== filter.position) return false;
    }
    if (filter.level !== undefined && (card.level || 0) !== filter.level)
      return false;
    if (filter.minLevel !== undefined && (card.level || 0) < filter.minLevel)
      return false;
    if (filter.maxLevel !== undefined && (card.level || 0) > filter.maxLevel)
      return false;
    if (filter.minAtk !== undefined && (card.atk || 0) < filter.minAtk)
      return false;
    if (filter.maxAtk !== undefined && (card.atk || 0) > filter.maxAtk)
      return false;
    if (filter.minDef !== undefined && (card.def || 0) < filter.minDef)
      return false;
    if (filter.maxDef !== undefined && (card.def || 0) > filter.maxDef)
      return false;
    if (filter.archetype) {
      const requiredArchetypes = Array.isArray(filter.archetype)
        ? filter.archetype
        : [filter.archetype];
      const cardArchetypes = card.archetypes
        ? card.archetypes
        : card.archetype
        ? [card.archetype]
        : [];
      const hasMatch = requiredArchetypes.some((arc) =>
        cardArchetypes.includes(arc)
      );
      if (!hasMatch) return false;
    }
    const nameFilter = filter.cardName || filter.name;
    if (nameFilter) {
      const requiredNames = Array.isArray(nameFilter)
        ? nameFilter
        : [nameFilter];
      if (!requiredNames.includes(card.name)) return false;
    }
    if (filter.type) {
      const requiredTypes = Array.isArray(filter.type) ? filter.type : [filter.type];
      const cardTypeRaw = card.type || null;
      const cardTypesRaw = Array.isArray(card.types) ? card.types : null;
      const norm = (v) => (v ? String(v).toLowerCase() : v);
      const requiredTypesNorm = requiredTypes.map(norm);
      const hasType = cardTypesRaw
        ? requiredTypesNorm.some((t) =>
            cardTypesRaw.some((ct) => norm(ct) === t)
          )
        : requiredTypesNorm.includes(norm(cardTypeRaw));
      if (!hasType) return false;
    }
    if (filter.subtype) {
      const requiredSubtypes = Array.isArray(filter.subtype)
        ? filter.subtype
        : [filter.subtype];
      if (!requiredSubtypes.includes(card.subtype)) return false;
    }
    if (
      filter.excludeEventCardName === true &&
      ctx?.eventCard?.name &&
      card.name === ctx.eventCard.name
    ) {
      return false;
    }
    if (isExcludedInstance(card, filter)) return false;
    if (isExcludedContextCard(filter, ctx, card)) return false;
    if (!targetCardMatchesFilters(this, card, filter)) return false;
    return true;
  };
  const matchesAnyOf =
    !anyOf || anyOf.length === 0
      ? () => true
      : (card) => anyOf.some((filter) => matchesFilter(card, filter));

  let candidates = [];
  log(
    `[selectCandidates] Using ${owners.length} owners: ${owners
      .map((o) => o.id)
      .join(", ")}`
  );
  for (const owner of owners) {
    for (const zoneKey of zoneList) {
      const zone = this.getZone(owner, zoneKey) || [];
      log(
        `[selectCandidates] Checking zone "${zoneKey}" for owner ${owner.id}: ${
          zone.length
        } cards ${
          zone.length > 0 ? `(${zone.map((c) => c.name).join(", ")})` : ""
        }`
      );
      for (const card of zone) {
        log(
          `[selectCandidates] Evaluating card: ${card.name} (archetype: ${card.archetype}, owner: ${owner.id})`
        );
        if (excludedDamageStepTargets.includes(card)) {
          log(
            "[selectCandidates] Rejecting: card was determined for battle destruction",
          );
          continue;
        }
        if (def.battleParticipant === true) {
          const battleParticipants = [
            ctx?.attacker,
            ctx?.defender || ctx?.target,
          ].filter(Boolean);
          if (!battleParticipants.includes(card)) {
            log("[selectCandidates] Rejecting: card is not a battle participant");
            continue;
          }
        }
        if (def.requireThisCard && ctx?.source && card !== ctx.source) {
          log(
            `[selectCandidates] Rejecting: requireThisCard and card is not source`
          );
          continue;
        }
        if (def.excludeSelf && ctx?.source && card === ctx.source) {
          log("[selectCandidates] Rejecting: excludeSelf and card is source");
          continue;
        }
        if (isExcludedInstance(card, def)) {
          log("[selectCandidates] Rejecting: card matches excluded instance");
          continue;
        }
        if (isExcludedContextCard(def, ctx, card)) {
          log("[selectCandidates] Rejecting: card matches excluded context card");
          continue;
        }
        if (
          zoneKey === "hand" &&
          ctx.activationZone === "hand" &&
          card === ctx.source &&
          !def.requireThisCard
        ) {
          log(`[selectCandidates] Rejecting: card is source in hand zone`);
          continue;
        }
        if (
          def.excludeCannotBeSpecialSummoned &&
          !canTargetBeSpecialSummoned(this, card, def, ctx, zoneKey)
        ) {
          log(
            `[selectCandidates] Rejecting: ${card.name} cannot be Special Summoned`
          );
          continue;
        }
        if (def.cardKind && !cardMatchesKind(card, def.cardKind)) {
          const requiredKinds = Array.isArray(def.cardKind)
            ? def.cardKind
            : [def.cardKind];
          log(
            `[selectCandidates] Rejecting: cardKind mismatch (${
              card.cardKind
            } not in ${requiredKinds.join(",")})`
          );
          continue;
        }
        if (def.monsterType) {
          const requiredMonsterTypes = Array.isArray(def.monsterType)
            ? def.monsterType
            : [def.monsterType];
          if (!requiredMonsterTypes.includes(card.monsterType)) {
            log(
              `[selectCandidates] Rejecting: monsterType mismatch (${card.monsterType} not in ${requiredMonsterTypes.join(",")})`
            );
            continue;
          }
        }
        if (def.cardId !== undefined && card.id !== def.cardId) {
          log(
            `[selectCandidates] Rejecting: cardId mismatch (${card.id} !== ${def.cardId})`
          );
          continue;
        }
        if (
          Array.isArray(def.cardIds) &&
          def.cardIds.length > 0 &&
          !def.cardIds.includes(card.id)
        ) {
          log(
            `[selectCandidates] Rejecting: cardId ${card.id} not in [${def.cardIds.join(",")}]`
          );
          continue;
        }
        if (def.subtype) {
          const requiredSubtypes = Array.isArray(def.subtype)
            ? def.subtype
            : [def.subtype];
          if (!requiredSubtypes.includes(card.subtype)) {
            log(
              `[selectCandidates] Rejecting: subtype mismatch (${
                card.subtype
              } !== ${requiredSubtypes.join(",")})`
            );
            continue;
          }
        }
        const summonMethodFilter =
          def.lastSummonMethods ||
          def.summonMethods ||
          def.lastSummonMethod ||
          def.summonMethod;
        if (summonMethodFilter) {
          const requiredSummonMethods = Array.isArray(summonMethodFilter)
            ? summonMethodFilter
            : [summonMethodFilter];
          if (!requiredSummonMethods.includes(card.lastSummonMethod || null)) {
            log(
              `[selectCandidates] Rejecting: summon method mismatch (${card.lastSummonMethod} not in ${requiredSummonMethods.join(",")})`
            );
            continue;
          }
        }
        if (def.requireFaceup && card.isFacedown) {
          log(`[selectCandidates] Rejecting: card is facedown`);
          continue;
        }
        if (def.isTuner !== undefined) {
          if ((card.isTuner === true) !== Boolean(def.isTuner)) {
            log("[selectCandidates] Rejecting: isTuner mismatch");
            continue;
          }
        }
        if (
          def.position &&
          def.position !== "any" &&
          card.position !== def.position
        ) {
          log(
            `[selectCandidates] Rejecting: position mismatch (${card.position} !== ${def.position})`
          );
          continue;
        }
        const cardLevel = card.level || 0;
        if (def.level !== undefined && cardLevel !== def.level) {
          log(
            `[selectCandidates] Rejecting: level mismatch (${cardLevel} !== ${def.level})`
          );
          continue;
        }
        if (def.minLevel !== undefined && cardLevel < def.minLevel) {
          log(
            `[selectCandidates] Rejecting: level too low (${cardLevel} < ${def.minLevel})`
          );
          continue;
        }
        if (def.maxLevel !== undefined && cardLevel > def.maxLevel) {
          log(
            `[selectCandidates] Rejecting: level too high (${cardLevel} > ${def.maxLevel})`
          );
          continue;
        }
        const cardAtk = card.atk || 0;
        if (def.minAtk !== undefined && cardAtk < def.minAtk) {
          log(
            `[selectCandidates] Rejecting: ATK too low (${cardAtk} < ${def.minAtk})`
          );
          continue;
        }
        if (def.maxAtk !== undefined && cardAtk > def.maxAtk) {
          log(
            `[selectCandidates] Rejecting: ATK too high (${cardAtk} > ${def.maxAtk})`
          );
          continue;
        }
        const cardDef = card.def || 0;
        if (def.minDef !== undefined && cardDef < def.minDef) {
          log(
            `[selectCandidates] Rejecting: DEF too low (${cardDef} < ${def.minDef})`
          );
          continue;
        }
        if (def.maxDef !== undefined && cardDef > def.maxDef) {
          log(
            `[selectCandidates] Rejecting: DEF too high (${cardDef} > ${def.maxDef})`
          );
          continue;
        }

        const targetCounterType =
          def.counterType ||
          (typeof def.hasCounter === "string" ? def.hasCounter : null);
        const hasCounterFilter =
          targetCounterType ||
          def.minCounters !== undefined ||
          def.maxCounters !== undefined;
        if (hasCounterFilter) {
          const counterType = targetCounterType || "default";
          const counterCount =
            typeof card.getCounter === "function"
              ? card.getCounter(counterType)
              : 0;
          const minCounters =
            def.minCounters !== undefined
              ? def.minCounters
              : def.hasCounter
                ? 1
                : 0;
          if (counterCount < minCounters) {
            log(
              `[selectCandidates] Rejecting: not enough ${counterType} counters (${counterCount} < ${minCounters})`
            );
            continue;
          }
          if (
            def.maxCounters !== undefined &&
            counterCount > def.maxCounters
          ) {
            log(
              `[selectCandidates] Rejecting: too many ${counterType} counters (${counterCount} > ${def.maxCounters})`
            );
            continue;
          }
        }

        // Counter-based ATK filter
        if (def.maxAtkByCounters && ctx.source) {
          const counterType = def.counterType || "judgment_marker";
          const multiplier = def.counterMultiplier || 500;
          const counterCount = ctx.source.getCounter
            ? ctx.source.getCounter(counterType)
            : 0;
          const maxAllowedAtk = counterCount * multiplier;
          if (cardAtk > maxAllowedAtk) {
            log(`[selectCandidates] Rejecting: counter-based ATK too high`);
            continue;
          }
        }

        if (def.archetype) {
          const cardArchetypes = card.archetypes
            ? card.archetypes
            : card.archetype
            ? [card.archetype]
            : [];
          if (!cardArchetypes.includes(def.archetype)) {
            log(
              `[selectCandidates] Rejecting: archetype mismatch (${card.archetype} doesn't include ${def.archetype})`
            );
            continue;
          }
        }

        const requiredName = def.cardName || def.name;
        if (requiredName && card.name !== requiredName) {
          log(
            `[selectCandidates] Rejecting: name mismatch (${card.name} !== ${requiredName})`
          );
          continue;
        }

        // Exclude by card name
        if (def.excludeCardName && card.name === def.excludeCardName) {
          log(
            `[selectCandidates] Excluding ${card.name} (matches excludeCardName)`
          );
          continue;
        }

        // Exclude by multiple card names (used with excludeNameRef)
        if (def.excludeCardNames && Array.isArray(def.excludeCardNames)) {
          if (def.excludeCardNames.includes(card.name)) {
            log(
              `[selectCandidates] Excluding ${
                card.name
              } (matches excludeCardNames: ${def.excludeCardNames.join(", ")})`
            );
            continue;
          }
        }

        if (
          def.excludeEventCardName === true &&
          ctx?.eventCard?.name &&
          card.name === ctx.eventCard.name
        ) {
          log(
            `[selectCandidates] Excluding ${card.name} (matches event card name ${ctx.eventCard.name})`
          );
          continue;
        }

        if (!matchesAnyOf(card)) {
          log(`[selectCandidates] Rejecting: anyOf filter mismatch`);
          continue;
        }

        // Filter by monster type (Dragon, Warrior, etc.) with case-insensitive match
        if (def.type) {
          const cardTypeRaw = card.type || null;
          const cardTypesRaw = Array.isArray(card.types) ? card.types : null;
          const requiredTypes = Array.isArray(def.type) ? def.type : [def.type];
          const norm = (v) => (v ? String(v).toLowerCase() : v);
          const requiredTypesNorm = requiredTypes.map(norm);
          const hasType = cardTypesRaw
            ? requiredTypesNorm.some((t) =>
                cardTypesRaw.some((ct) => norm(ct) === t)
              )
            : requiredTypesNorm.includes(norm(cardTypeRaw));
          if (!hasType) {
            log(
              `[selectCandidates] Rejecting: type mismatch (${cardTypeRaw} not in ${requiredTypes.join(
                ", "
              )})`
            );
            continue;
          }
        }

        if (!targetCardMatchesFilters(this, card, def)) {
          log(`[selectCandidates] Rejecting: card filter mismatch`);
          continue;
        }

        const pairedTarget = getPairedTargetSpec(def);
        if (
          pairedTarget &&
          !hasPairedTargetCandidate(this, card, pairedTarget, ctx)
        ) {
          log("[selectCandidates] Rejecting: no paired target candidate");
          continue;
        }

        log(`[selectCandidates] ACCEPTED: ${card.name}`);
        candidates.push(card);
      }
    }
  }

  // ✅ DRAGON SPIRIT SANCTUARY: Compare attributes between targets (e.g., level <= returning monster's level)
  if (def.compareAttribute && ctx) {
    const { attr, ref, op } = def.compareAttribute;
    const targetMap = ctx._selectCandidatesTargetMap || {};
    const refCards = targetMap[ref];

    if (refCards && refCards.length > 0) {
      const refValue = refCards[0]?.[attr];

      if (refValue !== undefined) {
        log(
          `[selectCandidates] Applying compareAttribute filter: ${attr} ${op} ${refValue} (from ref "${ref}")`
        );

        candidates = candidates.filter((card) => {
          const cardValue = card[attr];
          if (cardValue === undefined) {
            log(
              `[selectCandidates] Rejecting ${card.name}: no ${attr} attribute`
            );
            return false;
          }

          let passes = false;
          if (op === "lte" || op === "<=") passes = cardValue <= refValue;
          else if (op === "gte" || op === ">=") passes = cardValue >= refValue;
          else if (op === "lt" || op === "<") passes = cardValue < refValue;
          else if (op === "gt" || op === ">") passes = cardValue > refValue;
          else if (op === "eq" || op === "==") passes = cardValue === refValue;
          else passes = true;

          if (!passes) {
            log(
              `[selectCandidates] Rejecting ${card.name}: ${attr} ${cardValue} does not satisfy ${op} ${refValue}`
            );
          }
          return passes;
        });

        log(
          `[selectCandidates] After compareAttribute filter: ${candidates.length} candidates remain`
        );
      } else {
        log(
          `[selectCandidates] Warning: compareAttribute ref "${ref}" has no ${attr} attribute`
        );
      }
    } else {
      log(
        `[selectCandidates] Warning: compareAttribute ref "${ref}" not found in context`
      );
    }
  }

  log(
    `[selectCandidates] Found ${candidates.length} candidates for target "${def.id}" (archetype: ${def.archetype}, zone: ${zoneName}, exclude: ${def.excludeCardName})`
  );

  if (def.strategy === "highest_atk") {
    candidates = [...candidates].sort((a, b) => (b.atk || 0) - (a.atk || 0));
  } else if (def.strategy === "lowest_atk") {
    candidates = [...candidates].sort((a, b) => (a.atk || 0) - (b.atk || 0));
  }

  // ✅ CACHE: Salvar resultado no cache
  const result = { zoneName, candidates };
  if (this._targetingCache && !bypassCache) {
    this._targetingCache.set(cacheKey, result);
  }

  return result;
}
