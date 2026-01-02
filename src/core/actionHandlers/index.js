/**
 * actionHandlers/index.js
 *
 * Barrel export for the actionHandlers package.
 * All consumers should import from this file.
 */

// Registry
export { ActionHandlerRegistry, proxyEngineMethod } from "./registry.js";

// Wiring function
export { registerDefaultHandlers } from "./wiring.js";

// Re-export all handlers for direct access if needed
// Movement
export { handleReturnToHand, handleBounceAndSummon } from "./movement.js";

// Summon
export {
  handleSpecialSummonFromZone,
  handleTransmutate,
  handleSpecialSummonFromHandWithCost,
  handleConditionalSummonFromHand,
  handleDrawAndSummon,
  handleAbyssalSerpentDelayedSummon,
  handleSpecialSummonFromDeckWithCounterLimit,
} from "./summon.js";

// Destruction
export {
  handleBanish,
  handleBanishCardFromGraveyard,
  handleDestroyTargetedCards,
  handleDestroyAttackerOnArchetypeDestruction,
} from "./destruction.js";

// Stats
export {
  handleSetStatsToZeroAndNegate,
  handleBuffStatsTemp,
  handleGrantAttackAllMonsters,
  handleAddStatus,
  handleGrantProtection,
  handleBanishAndBuff,
  handleSwitchPosition,
  handleSwitchDefenderPositionOnAttack,
  handlePermanentBuffNamed,
  handleRemovePermanentBuffNamed,
} from "./stats.js";

// Resources
export {
  handlePayLP,
  handleAddFromZoneToHand,
  handleHealFromDestroyedAtk,
  handleHealFromDestroyedLevel,
  handleGrantAdditionalNormalSummon,
  handleUpkeepPayOrSendToGrave,
} from "./resources.js";

// Shared helpers (for advanced use cases)
export {
  getUI,
  resolveTargetCards,
  sendCardsToGraveyard,
  collectZoneCandidates,
  buildFieldSelectionCandidates,
  selectCardsFromZone,
  payCostAndThen,
  selectCards,
  summonFromHandCore,
  STATUS_DISPLAY_NAMES,
} from "./shared.js";
