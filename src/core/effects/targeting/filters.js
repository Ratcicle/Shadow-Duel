/**
 * Targeting Filters Module
 * Extracted from EffectEngine.js - immunity and filtering utilities
 *
 * All functions assume `this` = EffectEngine instance
 */

/**
 * Check if a card is immune to effects from a source player
 * @param {Object} card - The card to check immunity for
 * @param {Object} sourcePlayer - The player whose effect is targeting the card
 * @param {Object} options - Optional settings for specific immunity checks
 * @param {string} options.effectType - Type of effect (e.g., "destruction", "banish", "target")
 * @returns {{immune: boolean, reason: string|null}} Immunity status and reason
 */
export function checkImmunity(card, sourcePlayer, options = {}) {
  if (!card || !sourcePlayer) {
    return { immune: false, reason: null };
  }

  // Check 1: Temporary immunity to opponent effects (turn-based)
  if (card.immuneToOpponentEffectsUntilTurn && card.owner) {
    const currentTurn = this.game?.turnCounter ?? 0;
    if (
      currentTurn <= card.immuneToOpponentEffectsUntilTurn &&
      card.owner !== sourcePlayer.id
    ) {
      return {
        immune: true,
        reason: "immune_to_opponent_effects_until_turn",
      };
    }
  }

  // Check 2: Permanent immunity to opponent effects (flag-based)
  if (card.immuneToOpponentEffects && card.owner !== sourcePlayer.id) {
    return { immune: true, reason: "immune_to_opponent_effects" };
  }

  // Check 3: Immunity to specific effect types (extensible)
  const effectType = options.effectType;
  if (effectType && card.immuneTo) {
    const immuneToList = Array.isArray(card.immuneTo)
      ? card.immuneTo
      : [card.immuneTo];
    if (immuneToList.includes(effectType)) {
      return { immune: true, reason: `immune_to_${effectType}` };
    }
  }

  // Check 4: Unaffected by opponent's card effects (Yu-Gi-Oh style)
  if (card.unaffectedByOpponentCardEffects && card.owner !== sourcePlayer.id) {
    return { immune: true, reason: "unaffected_by_opponent_card_effects" };
  }

  // Check 5: Cannot be targeted (only applies if effectType is "target")
  if (
    effectType === "target" &&
    card.cannotBeTargeted &&
    card.owner !== sourcePlayer.id
  ) {
    return { immune: true, reason: "cannot_be_targeted" };
  }

  // No immunity detected
  return { immune: false, reason: null };
}

/**
 * Simple boolean check for backward compatibility.
 * Use checkImmunity() for detailed immunity information.
 */
export function isImmuneToOpponentEffects(card, sourcePlayer) {
  return this.checkImmunity(card, sourcePlayer).immune;
}

/**
 * Filter a list of target cards by immunity, returning allowed and skipped targets.
 * This is the central helper for immunity checking.
 *
 * @param {Array} cardsList - Array of cards to filter
 * @param {Object} sourcePlayer - The player whose effect is being applied
 * @param {Object} options - Optional settings
 * @param {string} options.actionType - Type of action for logging
 * @param {string} options.effectType - Type of effect for specific immunity checks
 * @param {boolean} options.logSkipped - Whether to log skipped targets (default: true in dev mode)
 * @param {Function} options.customImmunityCheck - Optional custom immunity check function
 * @returns {{allowed: Array, skipped: Array, skippedReasons: Map}} Filtered results with reasons
 */
export function filterCardsListByImmunity(
  cardsList,
  sourcePlayer,
  options = {}
) {
  const allowed = [];
  const skipped = [];
  const skippedReasons = new Map();

  if (!Array.isArray(cardsList) || cardsList.length === 0) {
    return { allowed, skipped, skippedReasons };
  }

  for (const card of cardsList) {
    if (!card) continue;

    // Use custom immunity check if provided, otherwise use standard check
    let immunityResult;
    if (typeof options.customImmunityCheck === "function") {
      immunityResult = options.customImmunityCheck(card, sourcePlayer, options);
    } else {
      immunityResult = this.checkImmunity(card, sourcePlayer, {
        effectType: options.effectType,
      });
    }

    if (immunityResult.immune) {
      skipped.push(card);
      skippedReasons.set(card, immunityResult.reason);

      // Log in dev mode or if explicitly requested
      const shouldLog = options.logSkipped ?? this.game?.devModeEnabled;
      if (shouldLog && this.ui?.log) {
        const actionDesc = options.actionType ? ` (${options.actionType})` : "";
        this.ui.log(
          `${card.name} is immune to opponent's effects${actionDesc} and was skipped.`
        );
      }
    } else {
      allowed.push(card);
    }
  }

  return { allowed, skipped, skippedReasons };
}

/**
 * Filter targets object by immunity for a specific action.
 * Returns a new targets object with immune cards removed from the targetRef.
 *
 * @param {Object} action - The action being applied
 * @param {Object} ctx - Effect context (player, opponent, source)
 * @param {Object} targets - The targets object with targetRef keys
 * @returns {{filteredTargets: Object, skippedCount: number, allowedCount: number, skipAction: boolean, skippedReasons: Map}}
 */
export function filterTargetsByImmunity(action, ctx, targets) {
  const result = {
    filteredTargets: { ...targets },
    skippedCount: 0,
    allowedCount: 0,
    skipAction: false,
    skippedReasons: new Map(),
  };

  if (!action?.targetRef || !ctx?.player || !targets) {
    return result;
  }

  const targetCards = targets[action.targetRef];
  if (!Array.isArray(targetCards) || targetCards.length === 0) {
    return result;
  }

  // Determine effect type from action for more specific immunity checks
  const effectType = action.effectType || this.inferEffectType(action.type);

  const { allowed, skipped, skippedReasons } = this.filterCardsListByImmunity(
    targetCards,
    ctx.player,
    {
      actionType: action.type,
      effectType,
      customImmunityCheck: action.customImmunityCheck,
    }
  );

  result.skippedCount = skipped.length;
  result.allowedCount = allowed.length;
  result.skippedReasons = skippedReasons;

  // Create new targets object with filtered array
  result.filteredTargets = {
    ...targets,
    [action.targetRef]: allowed,
  };

  // Check immunityMode to determine if action should be skipped entirely
  const immunityMode = action.immunityMode || "skip_targets";

  if (immunityMode === "skip_action" && skipped.length > 0) {
    // If any target is immune and mode is skip_action, skip the entire action
    result.skipAction = true;
    if (this.ui?.log) {
      this.ui.log(
        `Action ${action.type} was cancelled because some targets are immune.`
      );
    }
  } else if (
    immunityMode === "skip_targets" &&
    allowed.length === 0 &&
    skipped.length > 0
  ) {
    // All targets were immune - action has no valid targets
    // Don't set skipAction=true, let handler deal with empty array gracefully
  }

  return result;
}

/**
 * Infer the effect type from an action type for immunity checking.
 * Extend this method when adding new action types.
 *
 * @param {string} actionType - The action type string
 * @returns {string|null} The inferred effect type
 */
export function inferEffectType(actionType) {
  if (!actionType) return null;

  const typeMap = {
    destroy_targeted_cards: "destruction",
    destroy: "destruction",
    banish: "banish",
    banish_destroyed_monster: "banish",
    switch_position: "target",
    set_stats_to_zero_and_negate: "target",
    buff_atk_temp: "target",
    modify_stats_temp: "target",
    bounce_to_hand: "target",
    bounce_to_deck: "target",
    send_to_graveyard: "target",
    negate_effects: "negate",
  };

  return typeMap[actionType] || "target";
}

/**
 * @deprecated Use filterTargetsByImmunity instead for per-target filtering.
 * This method is kept for backward compatibility but now only returns true
 * when immunityMode is "skip_action" and any target is immune.
 */
export function shouldSkipActionDueToImmunity(action, targets, ctx) {
  if (!action || !action.targetRef || !ctx?.player) return false;

  // Use new filtering system
  const { skipAction } = this.filterTargetsByImmunity(action, ctx, targets);
  return skipAction;
}
