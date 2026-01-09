/**
 * Targeting Resolution Module
 * Extracted from EffectEngine.js - main target resolution logic
 *
 * All functions assume `this` = EffectEngine instance
 */

import { isAI } from "../../Player.js";

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
  const autoSelectSingleTarget =
    activationContext.autoSelectSingleTarget === true;
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
        // Wrap single target as array
        targetMap[def.id] = Array.isArray(contextTarget)
          ? contextTarget
          : [contextTarget];
        if (shouldLogTargets) {
          console.log(
            `[resolveTargets] Using targetFromContext "${contextKey}" for target "${
              def.id
            }": ${contextTarget.name || contextTarget}`
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

    // Support for excludeNameRef: get name to exclude from a previously resolved target
    let effectiveDef = def;
    if (def.excludeNameRef && targetMap[def.excludeNameRef]) {
      const refTargets = targetMap[def.excludeNameRef];
      const namesToExclude = refTargets.map((c) => c.name).filter(Boolean);
      if (namesToExclude.length > 0) {
        effectiveDef = {
          ...def,
          excludeCardNames: namesToExclude,
        };
        if (shouldLogTargets) {
          console.log(
            `[resolveTargets] Excluding card names from ref "${
              def.excludeNameRef
            }": ${namesToExclude.join(", ")}`
          );
        }
      }
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
      (autoSelectExplicit ||
        (autoSelectSingleTarget && min === 1 && max === 1));
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
    if (def.level !== undefined) {
      filters.level = def.level;
    }
    if (def.levelOp) {
      filters.levelOp = def.levelOp;
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
    requirements.push({
      id: def.id,
      min,
      max,
      zones,
      owner,
      filters,
      allowSelf: def.allowSelf !== false || def.requireThisCard === true,
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

  // ✅ DRAGON SPIRIT SANCTUARY: Emit effect_targeted event for opponent's cards
  // This allows traps like Dragon Spirit Sanctuary to respond before effect resolves
  if (!isPreview && this.game && ctx?.source && ctx?.player) {
    for (const [targetId, targetCards] of Object.entries(targetMap)) {
      if (!Array.isArray(targetCards)) continue;

      for (const targetCard of targetCards) {
        if (!targetCard) continue;

        // Check if target belongs to opponent
        const targetOwner =
          targetCard.owner === "player" ? this.game.player : this.game.bot;
        if (targetOwner && targetOwner.id !== ctx.player.id) {
          // Emit event for opponent's targeted card
          if (shouldLogTargets) {
            console.log(
              `[resolveTargets] Emitting effect_targeted: ${ctx.source.name} targets ${targetCard.name}`
            );
          }

          // Emit event asynchronously (don't wait for it to avoid blocking)
          void this.game.emit("effect_targeted", {
            source: ctx.source,
            sourcePlayer: ctx.player,
            target: targetCard,
            targetOwner: targetOwner,
            targetId: targetId,
          });
        }
      }
    }
  }

  return { ok: true, targets: targetMap };
}
