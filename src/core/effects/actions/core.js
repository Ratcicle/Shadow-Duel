import { cardMatchesKind } from "../../Card.js";

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

        if (
          !result &&
          (action.haltOnFailure === true || action.stopOnFailure === true)
        ) {
          logDev?.("ACTION_SEQUENCE_HALTED", actionInfo);
          return false;
        }
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

function buildPreviewFilters(action) {
  const filters = { ...(action?.filters || {}) };
  if (action?.archetype && !filters.archetype) {
    filters.archetype = action.archetype;
  }
  if (action?.cardKind && !filters.cardKind) {
    filters.cardKind = action.cardKind;
  }
  if (action?.cardName && !filters.name) {
    filters.name = action.cardName;
  }
  if (action?.monsterType && !filters.type) {
    filters.type = action.monsterType;
  }
  if (Number.isFinite(action?.minLevel) && filters.minLevel == null) {
    filters.minLevel = action.minLevel;
  }
  if (Number.isFinite(action?.maxLevel) && filters.maxLevel == null) {
    filters.maxLevel = action.maxLevel;
  }
  if (Number.isFinite(action?.minAtk) && filters.minAtk == null) {
    filters.minAtk = action.minAtk;
  }
  if (Number.isFinite(action?.maxAtk) && filters.maxAtk == null) {
    filters.maxAtk = action.maxAtk;
  }
  return filters;
}

function matchesPreviewFilters(engine, card, filters) {
  if (!card) return false;
  if (typeof engine?.cardMatchesFilters === "function") {
    if (!engine.cardMatchesFilters(card, filters)) return false;
  }
  if (
    typeof filters.minLevel === "number" &&
    (card.level || 0) < filters.minLevel
  ) {
    return false;
  }
  if (
    typeof filters.maxLevel === "number" &&
    (card.level || 0) > filters.maxLevel
  ) {
    return false;
  }
  return true;
}

function getSourceOwnersForPreview(action, ctx, player) {
  const scope = action?.sourceOwner || action?.sourceScope || action?.scope || "self";
  const opponent = ctx?.opponent;
  if (scope === "opponent") {
    return opponent ? [opponent] : [];
  }
  if (scope === "both" || scope === "any") {
    return [player, opponent].filter(Boolean);
  }
  return player ? [player] : [];
}

function hasSpecialSummonCandidate(engine, action, ctx) {
  const player = ctx?.player;
  if (!player) return false;

  const zoneSpec = action.zone || action.sourceZone || "deck";
  const zoneNames = Array.isArray(zoneSpec) ? zoneSpec : [zoneSpec];
  const sourceOwners = getSourceOwnersForPreview(action, ctx, player);
  const zones = sourceOwners
    .flatMap((owner) => zoneNames.map((zoneName) => owner?.[zoneName]))
    .filter((zone) => Array.isArray(zone));
  if (zones.length === 0) return false;

  if (action.requireSource) {
    return zones.some((zone) => zone.includes(ctx?.source));
  }
  if (action.targetRef) return true;

  const filters = buildPreviewFilters(action);
  return zones.some((zone) =>
    zone.some((card) => {
      if (card?.cannotBeSpecialSummoned) return false;
      return matchesPreviewFilters(engine, card, filters);
    }),
  );
}

function getGraveyardOwnersForActionScope(action, ctx) {
  const player = ctx?.player;
  const opponent = ctx?.opponent;
  const scope = action?.scope || "self";
  if (scope === "both") {
    return [player, opponent].filter(Boolean);
  }
  if (scope === "opponent") {
    return opponent ? [opponent] : [];
  }
  return player ? [player] : [];
}

function isChoiceCaseAllowedInPreview(engine, caseEntry, ctx) {
  const conditions = Array.isArray(caseEntry?.conditions)
    ? caseEntry.conditions
    : [];
  if (conditions.length > 0) {
    const conditionResult = engine?.evaluateConditions?.(conditions, ctx);
    if (!conditionResult?.ok) return false;
  }

  const targets = Array.isArray(caseEntry?.targets) ? caseEntry.targets : [];
  if (targets.length > 0) {
    const targetResult = engine?.resolveTargets?.(targets, ctx, null);
    if (targetResult?.ok === false) return false;
  }

  const caseActions = Array.isArray(caseEntry?.actions)
    ? caseEntry.actions
    : [];
  if (caseActions.length === 0) return false;

  const actionResult =
    typeof engine?.checkActionPreviewRequirements === "function"
      ? engine.checkActionPreviewRequirements(caseActions, ctx)
      : checkActionPreviewRequirements.call(engine, caseActions, ctx);
  return actionResult?.ok !== false;
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

  const hasOtherActions = (action) =>
    actions.some((candidate) => candidate && candidate !== action);

  for (const action of actions) {
    if (!action || !action.type) continue;
    if (action.type === "choose_action_case") {
      const cases = Array.isArray(action.cases) ? action.cases : [];
      const hasAllowedCase = cases.some((caseEntry) =>
        isChoiceCaseAllowedInPreview(this, caseEntry, ctx),
      );
      if (!hasAllowedCase) {
        return { ok: false, reason: "No valid options to activate this effect." };
      }
      continue;
    }

    if (action.type === "pay_lp") {
      let amount = Number(action.amount || 0);
      if (action.fraction) {
        amount = Math.floor((player.lp || 0) * action.fraction);
      }
      if (amount > 0 && typeof this?.resolveLpCost === "function") {
        const costResult = this.resolveLpCost(action, ctx, amount, {
          consume: false,
        });
        if (costResult && typeof costResult.finalAmount === "number") {
          amount = costResult.finalAmount;
        }
      }
      if (amount > 0 && (player.lp || 0) < amount) {
        return { ok: false, reason: "Not enough LP to pay cost." };
      }
    }

    if (action.type === "banish_all_graveyard_and_burn") {
      const owners = getGraveyardOwnersForActionScope(action, ctx);
      const hasCards = owners.some(
        (owner) => Array.isArray(owner?.graveyard) && owner.graveyard.length > 0,
      );
      if (!hasCards) {
        return {
          ok: false,
          reason: "No cards in the selected Graveyard scope to banish.",
        };
      }
    }

    if (
      action.type === "search_any" ||
      action.type === "add_from_zone_to_hand" ||
      action.type === "search_then_optional_special_summon_from_hand"
    ) {
      const inferredSearch =
        action.type === "search_any" ||
        action.type === "search_then_optional_special_summon_from_hand" ||
        action.mode === "search_any";
      const sourceZone = action.zone || (inferredSearch ? "deck" : "graveyard");
      const zone = player[sourceZone] || [];
      const baseFilters = action.filters || {};
      const filters = { ...baseFilters };
      if (inferredSearch) {
        if (action.archetype && !filters.archetype) {
          filters.archetype = action.archetype;
        }
        if (action.cardKind && !filters.cardKind) {
          filters.cardKind = action.cardKind;
        }
        if (action.cardName && !filters.name) {
          filters.name = action.cardName;
        }
        if (Number.isFinite(action.minAtk) && filters.minAtk == null) {
          filters.minAtk = action.minAtk;
        }
        if (Number.isFinite(action.maxAtk) && filters.maxAtk == null) {
          filters.maxAtk = action.maxAtk;
        }
      }
      const count = action.count || { min: 1, max: 1 };
      const min = Math.max(count.min || 0, 0);
      if (min > 0) {
        const hasCandidate = zone.some((card) => {
          if (!card) return false;
          if (typeof this?.cardMatchesFilters === "function") {
            if (!this.cardMatchesFilters(card, filters)) return false;
          }
          if (action.cardName) {
            const match = action.cardName.toLowerCase();
            if ((card.name || "").toLowerCase() !== match) return false;
          }
          if (typeof action.cardId === "number" && card.id !== action.cardId) {
            return false;
          }
          if (
            typeof action.minLevel === "number" &&
            (card.level || 0) < action.minLevel
          ) {
            return false;
          }
          if (
            typeof action.maxLevel === "number" &&
            (card.level || 0) > action.maxLevel
          ) {
            return false;
          }
          return true;
        });
        if (!hasCandidate) {
          return {
            ok: false,
            reason: `No valid cards in ${sourceZone} matching filters.`,
          };
        }
      }
    }

    if (
      action.type === "special_summon_from_zone" ||
      action.type === "call_of_haunted_summon_and_bind"
    ) {
      if ((player.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }
      if (
        action.type === "special_summon_from_zone" &&
        !hasSpecialSummonCandidate(this, action, ctx)
      ) {
        return {
          ok: false,
          reason: "No valid cards available to Special Summon.",
        };
      }
    }

    if (action.type === "special_summon_from_deck_with_counter_limit") {
      if ((player.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }

      const source = ctx?.source;
      const counterType = action.counterType || "judgment_marker";
      const counterMultiplier = action.counterMultiplier || 500;
      const counterCount =
        typeof source?.getCounter === "function"
          ? source.getCounter(counterType)
          : source?.counters?.get
            ? source.counters.get(counterType)
            : 0;
      const maxAtk = counterCount * counterMultiplier;
      if (maxAtk <= 0) {
        return {
          ok: false,
          reason: `No ${counterType} counters on ${source?.name || "source"}.`,
        };
      }

      const filters = { ...(action.filters || {}) };
      if (action.archetype && !filters.archetype) {
        filters.archetype = action.archetype;
      }
      const hasCandidate = (player.deck || []).some((card) => {
        if (!card || card.cardKind !== "monster") return false;
        if ((card.atk || 0) > maxAtk) return false;
        if (filters.archetype) {
          const archetypes = Array.isArray(card.archetypes)
            ? card.archetypes
            : card.archetype
              ? [card.archetype]
              : [];
          if (!archetypes.includes(filters.archetype)) return false;
        }
        return true;
      });

      if (!hasCandidate) {
        return {
          ok: false,
          reason: `No valid monsters in deck with ATK <= ${maxAtk}.`,
        };
      }
    }

    if (action.type === "special_summon_token") {
      const targetPlayer = action.player === "opponent" ? ctx?.opponent : player;
      if ((targetPlayer?.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }
    }

    if (action.type === "special_summon_self_as_trap_monster") {
      if ((player.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }
      const source = ctx?.source;
      if (!source || !cardMatchesKind(source, ["spell", "trap"])) {
        return { ok: false, reason: "Source is not a Spell/Trap card." };
      }
      const sourceZone =
        typeof this?.findCardZone === "function"
          ? this.findCardZone(player, source)
          : null;
      if (sourceZone && sourceZone !== "spellTrap") {
        return { ok: false, reason: "Source must be in the Spell/Trap zone." };
      }
    }

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
        if (filters.cardKind && !cardMatchesKind(card, filters.cardKind)) {
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
      if (action.optional !== false && hasOtherActions(action)) {
        continue;
      }

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
        if (filters.cardKind && !cardMatchesKind(card, filters.cardKind)) {
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
