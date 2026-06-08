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
  collectSpellActivatedTriggers,
  collectEffectActivatedTriggers,
  collectBattleDestroyTriggers,
  collectBattleCompletedTriggers,
  collectAttackDeclaredTriggers,
  collectBattleDamageTriggers,
  collectLpChangeTriggers,
  collectEffectTargetedTriggers,
  collectCardEquippedTriggers,
  collectCardMovedTriggers,
  collectCardToGraveTriggers,
  collectCounterRemovedTriggers,
  collectPositionChangeTriggers,
  collectStandbyPhaseTriggers,
} from "./collectors.js";
