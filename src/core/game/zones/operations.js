/**
 * Zone operations - transactional wrapper and zone access.
 * Extracted from Game.js as part of B.4 modularization.
 */

/**
 * Get zone array by name.
 * @param {Object} player - Player object
 * @param {string} zone - Zone name
 * @returns {Array} Zone array
 */
export function getZone(player, zone) {
  switch (zone) {
    case "hand":
      return player.hand;
    case "deck":
      return player.deck;
    case "extraDeck":
      return player.extraDeck;
    case "spellTrap":
      return player.spellTrap;
    case "graveyard":
      return player.graveyard;
    case "fieldSpell":
      return player.fieldSpell ? [player.fieldSpell] : [];
    case "field":
    default:
      return player.field;
  }
}

/**
 * Transactional wrapper for zone operations with rollback support.
 * @param {string} opLabel - Operation label for logging
 * @param {Function} fn - Function to execute
 * @param {Object} options - Options (contextLabel, card, fromZone, toZone)
 * @returns {Object|Promise} Result of the operation
 */
export function runZoneOp(opLabel, fn, options = {}) {
  const contextLabel = options.contextLabel || opLabel;
  const root = this.zoneOpDepth === 0;
  if (root) {
    this.zoneOpSnapshot = this.captureZoneSnapshot(contextLabel);
  }
  this.zoneOpDepth += 1;
  this.devLog("ZONE_OP_START", {
    summary: opLabel,
    opLabel,
    contextLabel,
    card: options.card?.name,
    fromZone: options.fromZone,
    toZone: options.toZone,
    depth: this.zoneOpDepth,
  });

  const rollback = (error) => {
    if (root && this.zoneOpSnapshot) {
      this.restoreZoneSnapshot(this.zoneOpSnapshot);
    }
    if (root) {
      this.forceClearTargetSelection("zone_op_rollback");
      this.updateBoard();
      this.assertStateInvariants(`${contextLabel}_rollback`, {
        failFast: false,
      });
    }
    this.devLog("ZONE_OP_ROLLBACK", {
      summary: opLabel,
      opLabel,
      contextLabel,
      card: options.card?.name,
      fromZone: options.fromZone,
      toZone: options.toZone,
      reason: error?.message || "unknown",
    });
  };

  const finalizeFailure = (error) => {
    this.zoneOpDepth = Math.max(0, this.zoneOpDepth - 1);
    rollback(error);
    if (root && this.zoneOpSnapshot) {
      this.zoneOpSnapshot = null;
    }
    if (!root) {
      throw error;
    }
    return {
      success: false,
      reason: error?.message || "zone_op_error",
      rolledBack: true,
    };
  };

  const finalizeSuccess = (result) => {
    try {
      this.normalizeZoneCardOwnership(contextLabel, {
        enforceZoneOwner: true,
      });
      const invariantResult = this.assertStateInvariants(contextLabel, {
        failFast: false,
      });
      if (invariantResult?.hasCritical) {
        throw new Error("STATE_INVARIANTS_FAILED");
      }
    } catch (err) {
      return finalizeFailure(err);
    }
    this.zoneOpDepth = Math.max(0, this.zoneOpDepth - 1);
    if (root) {
      this.devLog("ZONE_OP_COMMIT", {
        summary: opLabel,
        opLabel,
        contextLabel,
        card: options.card?.name,
        fromZone: options.fromZone,
        toZone: options.toZone,
      });
      this.zoneOpSnapshot = null;
    }
    return result;
  };

  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.then(finalizeSuccess).catch(finalizeFailure);
    }
    return finalizeSuccess(result);
  } catch (error) {
    return finalizeFailure(error);
  }
}
