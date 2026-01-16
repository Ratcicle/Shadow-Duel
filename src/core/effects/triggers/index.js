/**
 * Triggers module barrel file.
 * Re-exports all trigger-related functionality from sub-modules.
 */

// Registration functions
export {
  registerOncePerDuelUsage,
  registerOncePerTurnUsage,
} from "./registration.js";

// Counter handlers
export {
  handleSpecialSummonTypeCounters,
  handleFieldPresenceTypeSummonCounters,
  assignFieldPresenceId,
  clearFieldPresenceId,
} from "./counters.js";

// Core trigger handling
export {
  handleTriggeredEffect,
  buildTriggerActivationContext,
  buildTriggerEntry,
} from "./core.js";

// Trigger collectors
export {
  collectEventTriggers,
  collectAfterSummonTriggers,
  collectBattleDestroyTriggers,
  collectAttackDeclaredTriggers,
  collectEffectTargetedTriggers,
  collectCardEquippedTriggers,
  collectCardToGraveTriggers,
  collectStandbyPhaseTriggers,
} from "./collectors.js";
