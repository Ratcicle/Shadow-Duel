/**
 * Barrel export for renderer modules
 * All functions are exported for attachment to Renderer.prototype
 */

// Board rendering
export {
  renderHand,
  renderField,
  renderSpellTrap,
  renderFieldSpell,
  updateGYPreview,
  updateExtraDeckPreview,
  renderGraveyardModal,
  renderExtraDeckModal,
} from "./board.js";

// Visual indicators
export {
  applyActivationIndicators,
  applyAttackReadyIndicators,
  clearAttackReadyIndicators,
  applyAttackResolutionIndicators,
  clearAttackResolutionIndicators,
  applyFlipAnimation,
  setPlayerFieldTributeable,
  setPlayerFieldSelected,
  clearPlayerFieldTributeable,
  applyTargetHighlights,
  clearTargetHighlights,
  setSelectionDimming,
  applyHandTargetableIndices,
  getSelectionCleanupState,
  applyZoneActivationIndicators,
  decorateActivatableCard,
  setActivationHint,
  clearActivationHint,
} from "./indicators.js";

// Preview and card creation
export {
  renderPreview,
  bindPreviewForElement,
  createCardElement,
} from "./preview.js";

// Log and status
export { log, updateTurn, updatePhaseTrack, updateLP } from "./log.js";

// Animations
export { showLpChange } from "./animations.js";

// Event bindings
export {
  bindPhaseClick,
  bindCardHover,
  bindZoneCardClick,
  bindZoneClick,
  bindPlayerHandClick,
  bindPlayerFieldClick,
  bindPlayerSpellTrapClick,
  bindPlayerFieldSpellClick,
  bindBotFieldClick,
  bindBotSpellTrapClick,
  bindBotHandClick,
  bindBotFieldSpellClick,
  bindPlayerGraveyardClick,
  bindBotGraveyardClick,
  bindPlayerExtraDeckClick,
  bindGraveyardModalClose,
  bindExtraDeckModalClose,
  bindModalOverlayClick,
  bindGlobalKeydown,
} from "./bindings.js";

// Base modals
export {
  toggleModal,
  toggleExtraDeckModal,
  showConfirmPrompt,
  showNumberPrompt,
  showAlert,
  getSearchModalElements,
  showSearchModal,
  showSearchModalVisual,
} from "./modals.js";

// Summon modals
export {
  showSummonModal,
  showConditionalSummonPrompt,
  showTierChoiceModal,
  showSpellChoiceModal,
  showPositionChoiceModal,
  showSpecialSummonPositionModal,
} from "./summonModals.js";

// Selection modals
export {
  showTargetSelection,
  showFieldTargetingControls,
  hideFieldTargetingControls,
  showDestructionNegationPrompt,
  showFusionTargetModal,
  showFusionMaterialSelection,
  showCardGridSelectionModal,
  showIgnitionActivateModal,
  showShadowHeartCathedralModal,
  showSickleSelectionModal,
  showTieBreakerSelection,
  showMultiSelectModal,
} from "./selectionModals.js";

// Trap modals
export {
  showUnifiedTrapModal,
  showTrapActivationModal,
  showChainResponseModal,
  _getContextDescription,
} from "./trapModals.js";
