/**
 * Targeting Resolution Module
 * Extracted from EffectEngine.js - main target resolution logic
 *
 * All functions assume `this` = EffectEngine instance
 */

import { isAI } from "../../Player.js";

function buildContextTargetFilters(def = {}) {
  return {
    ...(def.filters || {}),
    ...(def.cardKind ? { cardKind: def.cardKind } : {}),
    ...(def.cardId !== undefined ? { cardId: def.cardId } : {}),
    ...(def.cardIds !== undefined ? { cardIds: def.cardIds } : {}),
    ...(def.cardName ? { name: def.cardName } : {}),
    ...(def.subtype ? { subtype: def.subtype } : {}),
    ...(def.archetype ? { archetype: def.archetype } : {}),
    ...(def.level !== undefined ? { level: def.level } : {}),
    ...(def.levelOp ? { levelOp: def.levelOp } : {}),
    ...(def.minAtk !== undefined ? { minAtk: def.minAtk } : {}),
    ...(def.maxAtk !== undefined ? { maxAtk: def.maxAtk } : {}),
    ...(def.minDef !== undefined ? { minDef: def.minDef } : {}),
    ...(def.maxDef !== undefined ? { maxDef: def.maxDef } : {}),
    ...(def.lastSummonMethods !== undefined
      ? { lastSummonMethods: def.lastSummonMethods }
      : {}),
    ...(def.summonMethods !== undefined
      ? { summonMethods: def.summonMethods }
      : {}),
  };
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

function contextTargetMatchesDef(engine, card, def = {}, ctx = {}) {
  if (!card) return false;
  const filters = buildContextTargetFilters(def);
  if (
    Object.keys(filters).length > 0 &&
    typeof engine?.cardMatchesFilters === "function" &&
    !engine.cardMatchesFilters(card, filters)
  ) {
    return false;
  }
  if (def.excludeSelf && ctx?.source && card === ctx.source) return false;
  if (isExcludedContextCard(def, ctx, card)) return false;
  if (def.requireFaceup && card.isFacedown) return false;
  const requiredTypes = def.type
    ? Array.isArray(def.type)
      ? def.type
      : [def.type]
    : [];
  if (requiredTypes.length > 0) {
    const cardTypes = Array.isArray(card.types) ? card.types : [card.type];
    const normalizedTypes = cardTypes
      .filter(Boolean)
      .map((type) => String(type).toLowerCase());
    const typeMatches = requiredTypes.some((type) =>
      normalizedTypes.includes(String(type).toLowerCase()),
    );
    if (!typeMatches) return false;
  }
  if (def.position && def.position !== "any" && card.position !== def.position) {
    return false;
  }
  if (def.owner === "self" && card.owner !== ctx?.player?.id) return false;
  if (def.owner === "opponent" && card.owner !== ctx?.opponent?.id) {
    return false;
  }
  return true;
}

/**
 * Resolve targets for an effect based on target definitions
 * @param {Array} targetDefs - Array of target definition objects
 * @param {Object} ctx - Effect context (player, opponent, source, etc.)
 * @param {Object} selections - Pre-selected targets (optional)
 * @returns {Object} Result with ok/targets or needsSelection/selectionContract
 */
export function resolveTargets(targetDefs, ctx, selections) {
  const targetMap = {};
  const requirements = [];
  let needsSelection = false;
  const activationContext = ctx?.activationContext || {};
  const isAIPlayer = isAI(ctx?.player);
  const isPreview =
    activationContext.preview === true || activationContext.isPreview === true;
  const allowAutoSelectTargets =
    !isPreview && activationContext.autoSelectTargets === true;
  const shouldLogTargets =
    activationContext.logTargets === true ||
    this.game?.devModeEnabled === true ||
    ctx?.player?.debug === true;
  const resolvedTargets = activationContext.resolvedTargets || null;

  // ✅ DRAGON SPIRIT SANCTUARY: Inject targetMap into context for compareAttribute support
  const enhancedCtx = {
    ...ctx,
    _selectCandidatesTargetMap: targetMap,
  };

  for (const def of targetDefs) {
    // Support for targetFromContext: get target directly from event context
    if (def.targetFromContext) {
      const contextKey = def.targetFromContext;
      const contextTarget = ctx?.[contextKey];
      if (contextTarget) {
        const contextTargets = Array.isArray(contextTarget)
          ? contextTarget
          : [contextTarget];
        const validTargets = contextTargets.filter((card) =>
          contextTargetMatchesDef(this, card, def, ctx),
        );
        const min = Number(def.count?.min ?? 1);
        if (validTargets.length < min) {
          return {
            ok: false,
            reason: `Context target "${contextKey}" does not match target requirements.`,
          };
        }
        targetMap[def.id] = validTargets;
        if (shouldLogTargets) {
          console.log(
            `[resolveTargets] Using targetFromContext "${contextKey}" for target "${
              def.id
            }": ${validTargets.map((card) => card.name || card).join(", ")}`
          );
        }
        continue;
      } else {
        // Context target not available - fail or continue based on optional flag
        if (def.optional) {
          if (shouldLogTargets) {
            console.log(
              `[resolveTargets] Context target "${contextKey}" not found but optional, skipping target "${def.id}"`
            );
          }
          targetMap[def.id] = [];
          continue;
        }
        return {
          ok: false,
          reason: `Context target "${contextKey}" not available.`,
        };
      }
    }

    // Support reference-based exclusions from previously resolved targets.
    let effectiveDef = def;
    const effectiveUpdates = {};
    if (def.excludeNameRef && targetMap[def.excludeNameRef]) {
      const refTargets = targetMap[def.excludeNameRef];
      const namesToExclude = refTargets.map((c) => c.name).filter(Boolean);
      if (namesToExclude.length > 0) {
        effectiveUpdates.excludeCardNames = namesToExclude;
        if (shouldLogTargets) {
          console.log(
            `[resolveTargets] Excluding card names from ref "${
              def.excludeNameRef
            }": ${namesToExclude.join(", ")}`
          );
        }
      }
    }
    const excludeTargetRefs = [
      def.excludeTargetRef,
      ...(Array.isArray(def.excludeTargetRefs) ? def.excludeTargetRefs : []),
    ].filter(Boolean);
    const excludedCards = excludeTargetRefs.flatMap((ref) =>
      Array.isArray(targetMap[ref])
        ? targetMap[ref]
        : targetMap[ref]
          ? [targetMap[ref]]
          : [],
    );
    if (excludedCards.length > 0) {
      const excludedInstanceIds = excludedCards
        .map((card) => card?.instanceId ?? card?._instanceId ?? card?.uuid ?? null)
        .filter((value) => value !== undefined && value !== null);
      effectiveUpdates.excludeCards = excludedCards;
      if (excludedInstanceIds.length > 0) {
        effectiveUpdates.excludeInstanceIds = excludedInstanceIds;
      }
      if (shouldLogTargets) {
        console.log(
          `[resolveTargets] Excluding target instances from refs "${excludeTargetRefs.join(", ")}".`
        );
      }
    }
    if (Object.keys(effectiveUpdates).length > 0) {
      effectiveDef = {
        ...def,
        ...effectiveUpdates,
        excludeCardNames: [
          ...(Array.isArray(def.excludeCardNames) ? def.excludeCardNames : []),
          ...(effectiveUpdates.excludeCardNames || []),
        ],
        excludeInstanceIds: [
          ...(Array.isArray(def.excludeInstanceIds)
            ? def.excludeInstanceIds
            : def.excludeInstanceId !== undefined &&
                def.excludeInstanceId !== null
              ? [def.excludeInstanceId]
              : []),
          ...(effectiveUpdates.excludeInstanceIds || []),
        ],
      };
    }

    const hasResolved =
      resolvedTargets &&
      Object.prototype.hasOwnProperty.call(resolvedTargets, def.id);
    if (hasResolved) {
      const resolved = resolvedTargets[def.id];
      targetMap[def.id] = Array.isArray(resolved)
        ? resolved
        : resolved
        ? [resolved]
        : [];
      continue;
    }

    const { zoneName, candidates } = this.selectCandidates(
      effectiveDef,
      enhancedCtx
    );
    const min = Number(def.count?.min ?? 1);
    const max = Number(def.count?.max ?? min);

    if (candidates.length < min) {
      return { ok: false, reason: "No valid targets for this effect." };
    }

    const decoratedCandidates = candidates.map((card, idx) => {
      const controller = card.owner;
      const ownerLabel = controller === ctx.player.id ? "player" : "opponent";
      const ownerPlayer =
        controller === "player" ? this.game.player : this.game.bot;
      let zoneForDisplay = zoneName;
      let zoneArr = this.getZone(ownerPlayer, zoneForDisplay) || [];
      let zoneIndex = zoneArr.indexOf(card);
      if (zoneIndex === -1) {
        const detectedZone = this.findCardZone(ownerPlayer, card);
        if (detectedZone) {
          zoneForDisplay = detectedZone;
          zoneArr = this.getZone(ownerPlayer, detectedZone) || [];
          zoneIndex = zoneArr.indexOf(card);
        }
      }
      const candidate = {
        idx,
        name: card.name,
        owner: ownerLabel,
        controller,
        zone: zoneForDisplay,
        zoneIndex,
        position: card.position,
        atk: card.atk,
        def: card.def,
        cardKind: card.cardKind,
        cardRef: card,
      };
      candidate.key = this.buildSelectionCandidateKey(candidate, idx);
      return candidate;
    });

    const hasSelections =
      selections &&
      typeof selections === "object" &&
      !Array.isArray(selections);
    const hasSelectionForDef =
      hasSelections && Object.prototype.hasOwnProperty.call(selections, def.id);
    const provided = hasSelectionForDef ? selections[def.id] : null;
    if (hasSelectionForDef) {
      const providedList = Array.isArray(provided)
        ? provided
        : provided != null
        ? [provided]
        : [];
      const chosen = [];
      const seen = new Set();
      for (const entry of providedList) {
        let candidate = null;
        if (typeof entry === "number") {
          candidate = decoratedCandidates[entry];
        } else if (typeof entry === "string") {
          candidate = decoratedCandidates.find((cand) => cand.key === entry);
        } else if (entry && typeof entry === "object") {
          if (typeof entry.key === "string") {
            candidate = decoratedCandidates.find(
              (cand) => cand.key === entry.key
            );
          } else if (
            typeof entry.zone === "string" &&
            typeof entry.index === "number"
          ) {
            candidate = decoratedCandidates.find(
              (cand) =>
                cand.zone === entry.zone &&
                cand.zoneIndex === entry.index &&
                (!entry.owner ||
                  cand.controller === entry.owner ||
                  cand.owner === entry.owner)
            );
          }
        }
        if (candidate && !seen.has(candidate.key)) {
          seen.add(candidate.key);
          if (candidate.cardRef) {
            chosen.push(candidate.cardRef);
          }
        }
      }
      if (chosen.length >= min && chosen.length <= max) {
        targetMap[def.id] = chosen;
        if (activationContext) {
          const nextResolved =
            activationContext.resolvedTargets &&
            typeof activationContext.resolvedTargets === "object"
              ? activationContext.resolvedTargets
              : {};
          nextResolved[def.id] = chosen;
          activationContext.resolvedTargets = nextResolved;
        }
        continue;
      }
      return {
        ok: false,
        reason: "Selected targets are no longer valid.",
      };
    }

    const autoSelectExplicit = def.autoSelect === true;
    const allowAutoSelectForPlayer =
      !isPreview && !isAIPlayer && autoSelectExplicit;
    const allowAutoSelectForBot =
      allowAutoSelectTargets &&
      autoSelectExplicit;
    const shouldAutoSelect = allowAutoSelectForPlayer || allowAutoSelectForBot;
    if (shouldAutoSelect) {
      const desiredCount = autoSelectExplicit ? max : 1;
      const takeCount = Math.min(desiredCount, candidates.length);
      targetMap[def.id] = candidates.slice(0, takeCount);
      continue;
    }

    needsSelection = true;
    const zones =
      Array.isArray(def.zones) && def.zones.length > 0
        ? def.zones
        : [def.zone || zoneName];
    const owner =
      def.owner === "opponent"
        ? "opponent"
        : def.owner === "any"
        ? "either"
        : "player";
    const filters = {};
    if (def.cardKind) filters.cardKind = def.cardKind;
    if (def.archetype) filters.archetype = def.archetype;
    if (def.cardName) filters.name = def.cardName;
    if (def.subtype) filters.subtype = def.subtype;
    if (def.requireFaceup) filters.faceUp = true;
    if (def.position && def.position !== "any") {
      filters.position = def.position;
    }
    if (def.excludeCardName) {
      filters.excludeCardName = def.excludeCardName;
    }
    if (def.excludeEventCardName === true && ctx?.eventCard?.name) {
      filters.excludeCardName = ctx.eventCard.name;
    }
    if (def.level !== undefined) {
      filters.level = def.level;
    }
    if (def.levelOp) {
      filters.levelOp = def.levelOp;
    }
    if (def.minAtk !== undefined) {
      filters.minAtk = def.minAtk;
    }
    if (def.maxAtk !== undefined) {
      filters.maxAtk = def.maxAtk;
    }
    if (def.minDef !== undefined) {
      filters.minDef = def.minDef;
    }
    if (def.maxDef !== undefined) {
      filters.maxDef = def.maxDef;
    }
    if (def.strategy) {
      filters.strategy = def.strategy;
    }
    if (def.requireThisCard) {
      filters.requireThisCard = true;
    }
    if (def.tags) {
      filters.tags = def.tags;
    }
    if (def.type) {
      filters.type = def.type;
    }
    if (def.excludeSelf) {
      filters.excludeSelf = true;
    }
    if (def.battleParticipant) {
      filters.battleParticipant = true;
    }
    requirements.push({
      id: def.id,
      min,
      max,
      zones,
      owner,
      filters,
      intent: def.intent || null,
      allowSelf:
        def.excludeSelf === true
          ? false
          : def.allowSelf !== false || def.requireThisCard === true,
      distinct: def.distinct !== false,
      candidates: decoratedCandidates,
    });
  }

  if (needsSelection) {
    const selectionContract = {
      kind: "target",
      message: null,
      requirements,
      ui: {},
      metadata: {
        sourceCardId: ctx?.source?.id,
        sourceCardName: ctx?.source?.name || null,
      },
    };

    if (
      allowAutoSelectTargets &&
      this.game?.autoSelector &&
      typeof this.game.autoSelector.select === "function" &&
      activationContext._autoSelectAttempted !== true
    ) {
      activationContext._autoSelectAttempted = true;
      try {
        const autoResult = this.game.autoSelector.select(selectionContract, {
          owner: ctx?.player,
          activationContext,
          selectionKind: "target",
        });

        if (autoResult?.ok && autoResult.selections) {
          const resolved = this.resolveTargets(
            targetDefs,
            ctx,
            autoResult.selections
          );
          if (resolved?.ok) {
            return resolved;
          }
        }

        const fallbackSelections = {};
        for (const req of selectionContract.requirements || []) {
          const min = Number(req.min ?? 0);
          const max = Number(req.max ?? min);
          const candidates = Array.isArray(req.candidates)
            ? req.candidates
            : [];
          const pickCount = min > 0 ? Math.min(min, candidates.length) : 0;
          fallbackSelections[req.id] = candidates
            .slice(0, Math.min(pickCount, max, candidates.length))
            .map((cand) => cand.key)
            .filter(Boolean);
        }

        if (Object.keys(fallbackSelections).length > 0) {
          const resolvedFallback = this.resolveTargets(
            targetDefs,
            ctx,
            fallbackSelections
          );
          if (resolvedFallback?.ok) {
            return resolvedFallback;
          }
        }
      } finally {
        delete activationContext._autoSelectAttempted;
      }
    }

    return {
      needsSelection: true,
      selectionContract,
      // Preserve already resolved targets (e.g., targetFromContext) so they
      // survive downstream selection flows like ChainSystem.addToChain.
      targets: targetMap,
    };
  }

  // Notify observers about selected targets. Resolvable target-response windows
  // are opened by applyActions after all targets are fixed, before handlers run.
  if (!isPreview && this.game && ctx?.source && ctx?.player) {
    const selectedTargets = [];
    for (const [targetId, targetCards] of Object.entries(targetMap)) {
      if (!Array.isArray(targetCards)) continue;
      for (const targetCard of targetCards) {
        if (!targetCard) continue;
        selectedTargets.push({
          id: targetCard.id,
          name: targetCard.name,
          owner: targetCard.owner || null,
          zone: targetId,
          position: targetCard.position || null,
        });
      }
    }
    if (selectedTargets.length > 0) {
      this.game.notify?.("target_selected", {
        player: ctx.player,
        sourceCard: ctx.source,
        effectId: ctx.effect?.id || ctx.activationContext?.effectId || null,
        selectedTargets,
        selectedCount: selectedTargets.length,
      });
    }

  }

  return { ok: true, targets: targetMap };
}
