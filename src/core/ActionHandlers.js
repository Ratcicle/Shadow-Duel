/**
 * ActionHandlers.js
 *
 * FACADE - This file re-exports from the modularized actionHandlers package.
 * All implementation has been moved to src/core/actionHandlers/*.js
 *
 * This facade exists for backward compatibility with existing imports.
 * New code should import directly from "./actionHandlers/index.js".
 */

// Preserve i18n import for future localization of handler messages
// eslint-disable-next-line no-unused-vars
import { getCardDisplayName } from "./i18n.js";

// Re-export everything from the actionHandlers package
export {
  // Registry
  ActionHandlerRegistry,
  proxyEngineMethod,

  // Wiring function
  registerDefaultHandlers,

  // Movement handlers
  handleReturnToHand,
  handleBounceAndSummon,

  // Summon handlers
  handleSpecialSummonFromZone,
  handleTransmutate,
  handleSpecialSummonFromHandWithCost,
  handleConditionalSummonFromHand,
  handleDrawAndSummon,
  handleAbyssalSerpentDelayedSummon,
  handleSpecialSummonFromDeckWithCounterLimit,

  // Destruction handlers
  handleBanish,
  handleBanishCardFromGraveyard,
  handleDestroyTargetedCards,
  handleDestroyAndDamageByTargetAtk,
  handleDestroyAttackerOnArchetypeDestruction,

  // Stats handlers
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

  // Resources handlers
  handlePayLP,
  handleAddFromZoneToHand,
  handleHealFromDestroyedAtk,
  handleHealFromDestroyedLevel,
  handleGrantAdditionalNormalSummon,
  handleUpkeepPayOrSendToGrave,

  // Blueprint handlers
  handleActivateStoredBlueprint,

  // Shared helpers
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
} from "./actionHandlers/index.js";
