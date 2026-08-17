/**
 * Zone operations - transactional wrapper and zone access.
 * Extracted from Game.js as part of B.4 modularization.
 */

import type { GameCard } from "../../contracts/cards.js";
import type {
  GameZonesHost,
  ZoneOpFailure,
  ZoneOpOptions,
} from "../../contracts/gameRuntime.js";
import type { GamePlayer } from "../../contracts/player.js";
import type { CanonicalZone } from "../../contracts/zones.js";

interface ZoneOperationHost extends GameZonesHost {
  devLog(code: string, detail?: unknown): void;
  normalizeZoneCardOwnership(
    contextLabel?: string,
    options?: { enforceZoneOwner?: boolean },
  ): void;
  forceClearTargetSelection(reason: string): void;
  assertStateInvariants(
    contextLabel?: string,
    options?: { failFast?: boolean; normalize?: boolean },
  ): { hasCritical?: boolean };
  updateBoard(): unknown;
}

function errorMessage(error: unknown): string | null {
  if (
    (typeof error === "object" && error !== null) ||
    typeof error === "function"
  ) {
    const message = Reflect.get(error, "message");
    if (message) return message as string;
  }
  return null;
}

function isPromiseLike<Result>(
  value: Result | Promise<Result>,
): value is Promise<Result> {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return false;
  }
  return typeof Reflect.get(value, "then") === "function";
}

/**
 * Get zone array by name.
 * @param player - Player object
 * @param {string} zone - Zone name
 * @returns {Array} Zone array
 */
export function getZone(player: GamePlayer, zone: CanonicalZone): GameCard[] {
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
    case "banished":
      player.banished = player.banished || [];
      return player.banished;
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
 * @param options - Options (contextLabel, card, fromZone, toZone)
 * @returns Result of the operation
 */
export function runZoneOp<Result>(
  this: ZoneOperationHost,
  opLabel: string,
  fn: () => Result | Promise<Result>,
  options: ZoneOpOptions = {},
): Result | ZoneOpFailure | Promise<Result | ZoneOpFailure> {
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

  const rollback = (error: unknown) => {
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
      reason: errorMessage(error) || "unknown",
    });
  };

  const finalizeFailure = (error: unknown): ZoneOpFailure => {
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
      reason: errorMessage(error) || "zone_op_error",
      rolledBack: true,
    };
  };

  const finalizeSuccess = (result: Result): Result | ZoneOpFailure => {
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
    if (isPromiseLike(result)) {
      return result.then(finalizeSuccess).catch(finalizeFailure);
    }
    return finalizeSuccess(result);
  } catch (error) {
    return finalizeFailure(error);
  }
}
