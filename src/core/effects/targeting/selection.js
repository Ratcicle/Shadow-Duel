/**
 * Targeting Selection Module
 * Extracted from EffectEngine.js - candidate selection and key building
 *
 * All functions assume `this` = EffectEngine instance
 */

import { botLogger } from "../../BotLogger.js";

/**
 * Track duplicate selectCandidates calls per turn with auto-cleanup.
 * Prevents memory leak by clearing old turn data automatically.
 */
class CallTracker {
  constructor() {
    this.data = new Map();
    this.currentTurn = -1;
  }

  /**
   * Track a call and return the count for this turn.
   * Automatically clears data from previous turns.
   * @param {string} turnKey - Key identifying the turn (e.g., "turn_player")
   * @param {string} callKey - Key identifying the call type
   * @returns {number} Call count for this key in current turn
   */
  track(turnKey, callKey) {
    // Extract turn number from key
    const turnMatch = turnKey.match(/turn_(\d+)/);
    const turn = turnMatch ? parseInt(turnMatch[1], 10) : 0;

    // Clear data from previous turns to prevent memory leak
    if (turn !== this.currentTurn) {
      this.data.clear();
      this.currentTurn = turn;
    }

    const count = (this.data.get(callKey) || 0) + 1;
    this.data.set(callKey, count);
    return count;
  }

  /**
   * Get count for a specific call key.
   * @param {string} callKey - Key identifying the call type
   * @returns {number} Call count
   */
  getCount(callKey) {
    return this.data.get(callKey) || 0;
  }
}

// Singleton instance for duplicate tracking
const selectCandidatesCallTracker = new CallTracker();

/**
 * Build a unique cache key for targeting lookups.
 * @param {Object} def - Target definition
 * @param {Object} ctx - Context with player, opponent, source
 * @returns {string} Cache key
 */
function buildTargetingCacheKey(def, ctx) {
  const parts = [
    def.id || "unknown",
    def.zone || "field",
    def.owner || "self",
    def.cardKind || "any",
    def.archetype || "any",
    def.excludeCardName || "",
    def.requireThisCard ? "this" : "",
    ctx.source?.name || "",
    ctx.player?.id || "p",
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
  const logTargets = ctx?.activationContext?.logTargets !== false;
  const log = (...args) => {
    if (logTargets) {
      console.log(...args);
    }
  };
  const zoneName = def.zone || "field";
  const zoneList =
    Array.isArray(def.zones) && def.zones.length > 0 ? def.zones : [zoneName];

  // ✅ CACHE: Gerar chave única baseada na definição do target
  const cacheKey = buildTargetingCacheKey(def, ctx);

  // 🔍 Duplicate Detection - using CallTracker with auto-cleanup
  // Turn key includes turn counter for proper memory management
  const turnCounter =
    ctx?.activationContext?.turnCounter ??
    this?.game?.turnCounter ??
    0;
  const turnKey = `turn_${turnCounter}_${ctx?.player?.id || "unknown"}`;
  const callKey = `${def.id}_${zoneName}`;
  const callCount = selectCandidatesCallTracker.track(turnKey, callKey);

  if (callCount > 1 && botLogger) {
    botLogger.logDuplicate(
      "selectCandidates",
      `Target "${def.id}" in zone "${zoneName}"`,
      callCount,
      ctx.source?.name || "unknown"
    );
  }
  
  const cached = this._targetingCache?.get(cacheKey);
  
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
    `[selectCandidates] Starting search for target "${def.id}": owner="${def.owner}", zone="${zoneName}", archetype="${def.archetype}", excludeCardName="${def.excludeCardName}"`
  );

  const owners = [];
  if (def.owner === "opponent") {
    owners.push(ctx.opponent);
  } else if (def.owner === "any") {
    owners.push(ctx.player, ctx.opponent);
  } else {
    owners.push(ctx.player);
  }

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
        if (def.requireThisCard && ctx?.source && card !== ctx.source) {
          log(
            `[selectCandidates] Rejecting: requireThisCard and card is not source`
          );
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
        if (def.cardKind) {
          const requiredKinds = Array.isArray(def.cardKind)
            ? def.cardKind
            : [def.cardKind];
          if (!requiredKinds.includes(card.cardKind)) {
            log(
              `[selectCandidates] Rejecting: cardKind mismatch (${
                card.cardKind
              } !== ${requiredKinds.join(",")})`
            );
            continue;
          }
        }
        if (def.requireFaceup && card.isFacedown) {
          log(`[selectCandidates] Rejecting: card is facedown`);
          continue;
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
  if (this._targetingCache) {
    this._targetingCache.set(cacheKey, result);
  }

  return result;
}
