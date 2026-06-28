/**
 * ActionHandlers.js
 *
 * FACADE - This file re-exports from the modularized actionHandlers package.
 * All implementation has been moved to src/core/actionHandlers/*.js
 *
 * This facade exists for backward compatibility with existing imports.
 * New code should import directly from "./actionHandlers/index.js".
 */

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
  handleRestrictSpecialSummons,
  handleDeSynchro,
  handleSynchroSummonFromExtraDeck,

  // Destruction handlers
  handleBanish,
  handleBanishCardFromGraveyard,
  handleDestroyTargetedCards,
  handleDestroyAndDamageByTargetAtk,
  handleDestroyAttackerOnArchetypeDestruction,
  handleRegisterReplacementEffect,

  // Stats handlers
  handleSetStatsToZeroAndNegate,
  handleBuffStatsTemp,
  handleGrantAttackAllMonsters,
  handleAddStatus,
  handleGrantProtection,
  handleBanishAndBuff,
  handleBuffAtkByLpGainedThisTurn,
  handleSwitchPosition,
  handleSwitchDefenderPositionOnAttack,
  handlePermanentBuffNamed,
  handleRemovePermanentBuffNamed,
  handleNegateActivation,
  handleNegateSummonOrActivationAndDestroy,
  handleRegisterSynchroMaterialFollowup,

  // Resources handlers
  handlePayLP,
  handleAddFromZoneToHand,
  handleDamageFromDestroyedAtk,
  handleHealFromDestroyedAtk,
  handleHealFromDestroyedLevel,
  handleHealPerFieldCount,
  handleHealPerOpponentCardsAndHand,
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
