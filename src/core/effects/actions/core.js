/**
 * Actions Core - applyActions dispatcher and preview requirements
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

/**
 * Main action dispatcher - applies all actions in sequence
 * @param {Array} actions - Array of action definitions
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {Promise<boolean|Object>} Execution result or selection request
 */
export async function applyActions(actions, ctx, targets) {
  let executed = false;
  if (!Array.isArray(actions)) {
    return executed;
  }

  const logDev =
    this.game?.devLog && ((tag, detail) => this.game.devLog(tag, detail || {}));

  // Propagate selection results (from network resume) into ctx so handlers can consume them.
  const selectionMap =
    ctx?.selections ||
    ctx?.activationContext?.selections ||
    ctx?.actionContext?.selections ||
    null;
  if (ctx && selectionMap && !ctx.selections) {
    ctx.selections = selectionMap;
  }

  try {
    for (const action of actions) {
      const actionInfo = {
        type: action?.type || "unknown",
        source: ctx?.source?.name || null,
        player: ctx?.player?.id || null,
      };

      // Filter targets by immunity before passing to handler
      // This implements the "skip_targets" default behavior (vs "skip_action")
      const immunityResult = this.filterTargetsByImmunity(action, ctx, targets);

      if (immunityResult.skipAction) {
        // immunityMode: "skip_action" was set and some targets were immune
        logDev?.("ACTION_SKIPPED_IMMUNITY", {
          ...actionInfo,
          mode: "skip_action",
          skippedCount: immunityResult.skippedCount,
        });
        continue;
      }

      // Use filtered targets for the handler
      const filteredTargets = immunityResult.filteredTargets;

      // Log if any targets were skipped
      if (immunityResult.skippedCount > 0) {
        logDev?.("ACTION_TARGETS_FILTERED", {
          ...actionInfo,
          skippedCount: immunityResult.skippedCount,
          allowedCount: immunityResult.allowedCount,
        });
      }

      logDev?.("ACTION_START", actionInfo);

      const handler = this.actionHandlers.get(action.type);
      if (!handler) {
        logDev?.("ACTION_HANDLER_MISSING", actionInfo);
        console.warn(
          `No handler for action type "${action.type}". Action skipped.`
        );
        continue;
      }

      try {
        // Pass filtered targets to handler instead of original targets
        const result = await handler(action, ctx, filteredTargets, this);

        // INVARIANTE B1: Se handler retornou needsSelection, propagar para cima
        if (result && typeof result === "object" && result.needsSelection) {
          logDev?.("ACTION_NEEDS_SELECTION", {
            ...actionInfo,
            selectionKind: result.selectionContract?.kind || "unknown",
          });
          // Retornar imediatamente com o selectionContract
          return result;
        }

        executed = result || executed;
        logDev?.("ACTION_HANDLER_DONE", {
          ...actionInfo,
          handler: true,
          result: !!result,
        });
      } catch (error) {
        logDev?.("ACTION_HANDLER_ERROR", {
          ...actionInfo,
          error: error.message,
        });
        console.error(
          `Error executing registered handler for action type "${action.type}":`,
          error
        );
        console.error(`Action config:`, action);
        console.error(`Context:`, {
          player: ctx.player?.id,
          source: ctx.source?.name,
        });
      }
    }
  } catch (err) {
    console.error("Error while applying actions:", err);
  }

  return executed;
}

/**
 * Check action preview requirements without executing
 * @param {Array} actions - Array of action definitions
 * @param {Object} ctx - Context object
 * @returns {Object} Result with ok status and optional reason
 */
export function checkActionPreviewRequirements(actions, ctx) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return { ok: true };
  }

  const player = ctx?.player;
  if (!player) {
    return { ok: false, reason: "Missing player." };
  }

  for (const action of actions) {
    if (!action || !action.type) continue;
    if (action.type === "special_summon_from_hand_with_tiered_cost") {
      if ((player.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }

      const filters = action.costFilters || {
        name: "Void Hollow",
        cardKind: "monster",
      };
      const matchesFilters = (card) => {
        if (!card) return false;
        if (filters.cardKind && card.cardKind !== filters.cardKind) {
          return false;
        }
        if (filters.name && card.name !== filters.name) return false;
        if (filters.archetype) {
          const hasArc =
            card.archetype === filters.archetype ||
            (Array.isArray(card.archetypes) &&
              card.archetypes.includes(filters.archetype));
          if (!hasArc) return false;
        }
        return true;
      };
      const costCandidates = (player.field || []).filter(matchesFilters);
      const minCost = action.minCost ?? 1;
      if (costCandidates.length < minCost) {
        return {
          ok: false,
          reason: "Not enough cost monsters to Special Summon.",
        };
      }
    }

    if (action.type === "conditional_summon_from_hand") {
      // Check field space
      if ((player.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }

      // Check condition
      const condition = action.condition || {};
      if (condition.type === "control_card") {
        const zoneName = condition.zone || "fieldSpell";
        const cardName = condition.cardName;
        let conditionMet = false;

        if (zoneName === "fieldSpell") {
          conditionMet = player.fieldSpell?.name === cardName;
        } else {
          const zone = player[zoneName] || [];
          conditionMet = zone.some((c) => c && c.name === cardName);
        }

        if (!conditionMet) {
          return {
            ok: false,
            reason: `You must control "${cardName}" to activate this effect.`,
          };
        }
      } else if (condition.type === "control_card_type") {
        const zoneName = condition.zone || "field";
        const typeName = condition.typeName || condition.cardType;

        if (!typeName) {
          return { ok: false, reason: "Invalid condition configuration." };
        }

        const zone = player[zoneName] || [];
        const conditionMet = zone.some((c) => {
          if (!c || c.isFacedown) return false;
          if (Array.isArray(c.types)) {
            return c.types.includes(typeName);
          }
          return c.type === typeName;
        });

        if (!conditionMet) {
          return {
            ok: false,
            reason: `You must control a ${typeName} monster to activate this effect.`,
          };
        }
      }
    }

    if (action.type === "special_summon_from_hand_with_cost") {
      if ((player.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }

      // Get cost target filter from effect.targets
      const costTargetRef = action.costTargetRef || "bbd_cost";
      const costEffect = ctx?.effect;
      if (!costEffect || !costEffect.targets) {
        return {
          ok: false,
          reason: "Cost targets not defined in effect.",
        };
      }

      const costTarget = costEffect.targets.find(
        (t) => t && t.id === costTargetRef
      );
      if (!costTarget) {
        return {
          ok: false,
          reason: "Cost target definition not found.",
        };
      }

      const requiredCount = costTarget.count?.min || 0;
      const zone = costTarget.zone ? player[costTarget.zone] : player.hand;
      if (!zone) {
        return { ok: false, reason: "Cost zone not found." };
      }

      const filters = costTarget.filters || {};
      const matchesFilters = (card) => {
        if (!card) return false;
        if (filters.type) {
          if (Array.isArray(card.types)) {
            if (!card.types.includes(filters.type)) return false;
          } else if (card.type !== filters.type) {
            return false;
          }
        }
        if (filters.cardKind && card.cardKind !== filters.cardKind) {
          return false;
        }
        return true;
      };

      const validCosts = zone.filter(matchesFilters);
      if (validCosts.length < requiredCount) {
        return {
          ok: false,
          reason: `Need ${requiredCount} ${filters.type || "monster"}(s) in ${
            costTarget.zone || "hand"
          } to activate.`,
        };
      }
    }
  }

  return { ok: true };
}
