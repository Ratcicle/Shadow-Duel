/**
 * Renderer - Main UI rendering class for Shadow Duel
 *
 * This is the facade that maintains backward compatibility.
 * The class owns the constructor; methods are attached from modules.
 */

// Import all module functions
import * as board from "./renderer/board.js";
import * as indicators from "./renderer/indicators.js";
import * as preview from "./renderer/preview.js";
import * as log from "./renderer/log.js";
import * as animations from "./renderer/animations.js";
import * as bindings from "./renderer/bindings.js";
import * as modals from "./renderer/modals.js";
import * as summonModals from "./renderer/summonModals.js";
import * as selectionModals from "./renderer/selectionModals.js";
import * as trapModals from "./renderer/trapModals.js";

export default class Renderer {
  constructor() {
    this.elements = {
      playerHand: document.getElementById("player-hand"),
      playerField: document.getElementById("player-field"),
      playerSpellTrap: document.getElementById("player-spelltrap"),
      playerDeck: document.getElementById("player-deck"),
      playerGraveyard: document.getElementById("player-graveyard"),
      playerLP: document.getElementById("player-lp"),
      botHand: document.getElementById("bot-hand"),
      botField: document.getElementById("bot-field"),
      botSpellTrap: document.getElementById("bot-spelltrap"),
      botDeck: document.getElementById("bot-deck"),
      botGraveyard: document.getElementById("bot-graveyard"),
      botLP: document.getElementById("bot-lp"),
      playerFieldSpell: document.getElementById("player-fieldspell"),
      botFieldSpell: document.getElementById("bot-fieldspell"),
      turnIndicator: document.getElementById("turn-indicator"),
      phaseTrack: document.getElementById("phase-track"),
      actionLog: document.getElementById("action-log-list"),
    };
  }
}

// Attach board methods
Renderer.prototype.renderHand = board.renderHand;
Renderer.prototype.renderField = board.renderField;
Renderer.prototype.renderSpellTrap = board.renderSpellTrap;
Renderer.prototype.renderFieldSpell = board.renderFieldSpell;
Renderer.prototype.updateGYPreview = board.updateGYPreview;
Renderer.prototype.updateExtraDeckPreview = board.updateExtraDeckPreview;
Renderer.prototype.renderGraveyardModal = board.renderGraveyardModal;
Renderer.prototype.renderExtraDeckModal = board.renderExtraDeckModal;

// Attach indicator methods
Renderer.prototype.applyActivationIndicators =
  indicators.applyActivationIndicators;
Renderer.prototype.applyAttackReadyIndicators =
  indicators.applyAttackReadyIndicators;
Renderer.prototype.clearAttackReadyIndicators =
  indicators.clearAttackReadyIndicators;
Renderer.prototype.applyAttackResolutionIndicators =
  indicators.applyAttackResolutionIndicators;
Renderer.prototype.clearAttackResolutionIndicators =
  indicators.clearAttackResolutionIndicators;
Renderer.prototype.applyFlipAnimation = indicators.applyFlipAnimation;
Renderer.prototype.setPlayerFieldTributeable =
  indicators.setPlayerFieldTributeable;
Renderer.prototype.setPlayerFieldSelected = indicators.setPlayerFieldSelected;
Renderer.prototype.clearPlayerFieldTributeable =
  indicators.clearPlayerFieldTributeable;
Renderer.prototype.applyTargetHighlights = indicators.applyTargetHighlights;
Renderer.prototype.clearTargetHighlights = indicators.clearTargetHighlights;
Renderer.prototype.setSelectionDimming = indicators.setSelectionDimming;
Renderer.prototype.applyHandTargetableIndices =
  indicators.applyHandTargetableIndices;
Renderer.prototype.getSelectionCleanupState =
  indicators.getSelectionCleanupState;
Renderer.prototype.applyZoneActivationIndicators =
  indicators.applyZoneActivationIndicators;
Renderer.prototype.decorateActivatableCard = indicators.decorateActivatableCard;
Renderer.prototype.setActivationHint = indicators.setActivationHint;
Renderer.prototype.clearActivationHint = indicators.clearActivationHint;

// Attach preview methods
Renderer.prototype.renderPreview = preview.renderPreview;
Renderer.prototype.bindPreviewForElement = preview.bindPreviewForElement;
Renderer.prototype.createCardElement = preview.createCardElement;

// Attach log methods
Renderer.prototype.log = log.log;
Renderer.prototype.updateTurn = log.updateTurn;
Renderer.prototype.updatePhaseTrack = log.updatePhaseTrack;
Renderer.prototype.updateLP = log.updateLP;

// Attach animation methods
Renderer.prototype.showLpChange = animations.showLpChange;

// Attach binding methods
Renderer.prototype.bindPhaseClick = bindings.bindPhaseClick;
Renderer.prototype.bindCardHover = bindings.bindCardHover;
Renderer.prototype.bindZoneCardClick = bindings.bindZoneCardClick;
Renderer.prototype.bindZoneClick = bindings.bindZoneClick;
Renderer.prototype.bindPlayerHandClick = bindings.bindPlayerHandClick;
Renderer.prototype.bindPlayerFieldClick = bindings.bindPlayerFieldClick;
Renderer.prototype.bindPlayerSpellTrapClick = bindings.bindPlayerSpellTrapClick;
Renderer.prototype.bindPlayerFieldSpellClick =
  bindings.bindPlayerFieldSpellClick;
Renderer.prototype.bindBotFieldClick = bindings.bindBotFieldClick;
Renderer.prototype.bindBotSpellTrapClick = bindings.bindBotSpellTrapClick;
Renderer.prototype.bindBotHandClick = bindings.bindBotHandClick;
Renderer.prototype.bindBotFieldSpellClick = bindings.bindBotFieldSpellClick;
Renderer.prototype.bindPlayerGraveyardClick = bindings.bindPlayerGraveyardClick;
Renderer.prototype.bindBotGraveyardClick = bindings.bindBotGraveyardClick;
Renderer.prototype.bindPlayerExtraDeckClick = bindings.bindPlayerExtraDeckClick;
Renderer.prototype.bindGraveyardModalClose = bindings.bindGraveyardModalClose;
Renderer.prototype.bindExtraDeckModalClose = bindings.bindExtraDeckModalClose;
Renderer.prototype.bindModalOverlayClick = bindings.bindModalOverlayClick;
Renderer.prototype.bindGlobalKeydown = bindings.bindGlobalKeydown;

// Attach base modal methods
Renderer.prototype.toggleModal = modals.toggleModal;
Renderer.prototype.toggleExtraDeckModal = modals.toggleExtraDeckModal;
Renderer.prototype.showConfirmPrompt = modals.showConfirmPrompt;
Renderer.prototype.showNumberPrompt = modals.showNumberPrompt;
Renderer.prototype.showAlert = modals.showAlert;
Renderer.prototype.getSearchModalElements = modals.getSearchModalElements;
Renderer.prototype.showSearchModal = modals.showSearchModal;
Renderer.prototype.showSearchModalVisual = modals.showSearchModalVisual;

// Attach summon modal methods
Renderer.prototype.showSummonModal = summonModals.showSummonModal;
Renderer.prototype.showConditionalSummonPrompt =
  summonModals.showConditionalSummonPrompt;
Renderer.prototype.showTierChoiceModal = summonModals.showTierChoiceModal;
Renderer.prototype.showSpellChoiceModal = summonModals.showSpellChoiceModal;
Renderer.prototype.showPositionChoiceModal =
  summonModals.showPositionChoiceModal;
Renderer.prototype.showSpecialSummonPositionModal =
  summonModals.showSpecialSummonPositionModal;

// Attach selection modal methods
Renderer.prototype.showTargetSelection = selectionModals.showTargetSelection;
Renderer.prototype.showFieldTargetingControls =
  selectionModals.showFieldTargetingControls;
Renderer.prototype.hideFieldTargetingControls =
  selectionModals.hideFieldTargetingControls;
Renderer.prototype.showDestructionNegationPrompt =
  selectionModals.showDestructionNegationPrompt;
Renderer.prototype.showFusionTargetModal =
  selectionModals.showFusionTargetModal;
Renderer.prototype.showFusionMaterialSelection =
  selectionModals.showFusionMaterialSelection;
Renderer.prototype.showCardGridSelectionModal =
  selectionModals.showCardGridSelectionModal;
Renderer.prototype.showIgnitionActivateModal =
  selectionModals.showIgnitionActivateModal;
Renderer.prototype.showShadowHeartCathedralModal =
  selectionModals.showShadowHeartCathedralModal;
Renderer.prototype.showSickleSelectionModal =
  selectionModals.showSickleSelectionModal;
Renderer.prototype.showTieBreakerSelection =
  selectionModals.showTieBreakerSelection;
Renderer.prototype.showMultiSelectModal = selectionModals.showMultiSelectModal;

// Attach trap modal methods
Renderer.prototype.showUnifiedTrapModal = trapModals.showUnifiedTrapModal;
Renderer.prototype.showTrapActivationModal = trapModals.showTrapActivationModal;
Renderer.prototype.showChainResponseModal = trapModals.showChainResponseModal;
Renderer.prototype._getContextDescription = trapModals._getContextDescription;
