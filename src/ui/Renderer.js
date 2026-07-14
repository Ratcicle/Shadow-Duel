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
import * as cardAnimationManager from "./renderer/cardAnimationManager.js";
import * as feedbackFx from "./renderer/feedbackFx.js";
import * as bindings from "./renderer/bindings.js";
import * as modals from "./renderer/modals.js";
import * as summonModals from "./renderer/summonModals.js";
import * as selectionModals from "./renderer/selectionModals.js";
import * as trapModals from "./renderer/trapModals.js";
import PixiVfxLayer from "./pixi/PixiVfxLayer.js";

export default class Renderer {
  constructor() {
    this.destroyed = false;
    this.leftMouseHeldForChainSkip = false;
    this.chainSkipInputCleanup = null;
    this.activeTrapModalCancel = null;
    this.lpDisplayState = {
      player: {
        displayed: 8000,
        animating: false,
        queue: [],
        floatingPromises: new Set(),
        presentationPromise: null,
      },
      bot: {
        displayed: 8000,
        animating: false,
        queue: [],
        floatingPromises: new Set(),
        presentationPromise: null,
      },
    };
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
    this.bindChainSkipInputTracking();
    this.pixiVfx = new PixiVfxLayer();
    const pixiVfx = this.pixiVfx;
    pixiVfx
      .init(document.getElementById("game-container"))
      .then(() => {
        if (this.destroyed || this.pixiVfx !== pixiVfx) {
          pixiVfx.destroy();
        }
      })
      .catch((error) => {
        console.warn("[Renderer] Pixi VFX layer unavailable.", error);
        if (this.pixiVfx === pixiVfx) {
          this.pixiVfx = null;
        }
        pixiVfx.destroy();
      });
  }

  bindChainSkipInputTracking() {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const setHeld = (held) => {
      this.leftMouseHeldForChainSkip = held === true;
    };

    const isMouseInput = (event) =>
      !event?.pointerType || event.pointerType === "mouse";
    const isLeftButton = (event) => event?.button === 0;

    const handleDown = (event) => {
      if (isMouseInput(event) && isLeftButton(event)) {
        setHeld(true);
      }
    };

    const handleUp = (event) => {
      if (isMouseInput(event) && isLeftButton(event)) {
        setHeld(false);
      }
    };

    const clearHeld = () => setHeld(false);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearHeld();
      }
    };

    const capture = true;
    document.addEventListener("pointerdown", handleDown, capture);
    document.addEventListener("mousedown", handleDown, capture);
    document.addEventListener("pointerup", handleUp, capture);
    document.addEventListener("mouseup", handleUp, capture);
    document.addEventListener("pointercancel", clearHeld, capture);
    window.addEventListener("blur", clearHeld, capture);
    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
      capture,
    );

    this.chainSkipInputCleanup = () => {
      document.removeEventListener("pointerdown", handleDown, capture);
      document.removeEventListener("mousedown", handleDown, capture);
      document.removeEventListener("pointerup", handleUp, capture);
      document.removeEventListener("mouseup", handleUp, capture);
      document.removeEventListener("pointercancel", clearHeld, capture);
      window.removeEventListener("blur", clearHeld, capture);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
        capture,
      );
      clearHeld();
    };
  }

  isLeftMouseHeldForChainSkip() {
    return this.destroyed !== true && this.leftMouseHeldForChainSkip === true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.chainSkipInputCleanup?.();
    this.chainSkipInputCleanup = null;
    this.activeTrapModalCancel?.();
    this.activeTrapModalCancel = null;
    this.clearFloatingCounterTooltip?.();
    this.pixiVfx?.destroy?.();
    this.pixiVfx = null;
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
Renderer.prototype.applyZoneFrameActivationIndicators =
  indicators.applyZoneFrameActivationIndicators;
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
Renderer.prototype.applySpellTrapFlipAnimation =
  indicators.applySpellTrapFlipAnimation;

// Attach preview methods
Renderer.prototype.renderPreview = preview.renderPreview;
Renderer.prototype.bindPreviewForElement = preview.bindPreviewForElement;
Renderer.prototype.createCardElement = preview.createCardElement;
Renderer.prototype.clearFloatingCounterTooltip =
  preview.clearFloatingCounterTooltip;

// Attach log methods
Renderer.prototype.log = log.log;
Renderer.prototype.updateTurn = log.updateTurn;
Renderer.prototype.updatePhaseTrack = log.updatePhaseTrack;
Renderer.prototype.updateLP = log.updateLP;

// Attach animation methods
Renderer.prototype.captureCardRects = animations.captureCardRects;
Renderer.prototype.animateCardLayout = animations.animateCardLayout;
Renderer.prototype.ensureLpDisplayState = animations.ensureLpDisplayState;
Renderer.prototype.getDisplayedLp = animations.getDisplayedLp;
Renderer.prototype.setDisplayedLp = animations.setDisplayedLp;
Renderer.prototype.hasActiveLpPresentation = animations.hasActiveLpPresentation;
Renderer.prototype.waitForLpPresentation = animations.waitForLpPresentation;
Renderer.prototype.showFieldDamageHit = animations.showFieldDamageHit;
Renderer.prototype.showLpDamageSequence = animations.showLpDamageSequence;
Renderer.prototype.animateLpOdometer = animations.animateLpOdometer;
Renderer.prototype.captureCardAnimationSource =
  cardAnimationManager.captureCardAnimationSource;
Renderer.prototype.playQueuedCardAnimations =
  cardAnimationManager.playQueuedCardAnimations;
Renderer.prototype.playAttackLunge = cardAnimationManager.playAttackLunge;
Renderer.prototype.getCardZoneAnchorRect =
  cardAnimationManager.getCardZoneAnchorRect;
Renderer.prototype.playVisualFeedback = feedbackFx.playVisualFeedback;
Renderer.prototype.playBattleImpactImmediate =
  feedbackFx.playBattleImpactImmediate;
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
Renderer.prototype.bindBotExtraDeckClick = bindings.bindBotExtraDeckClick;
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
Renderer.prototype.showDuelStartAnnouncement = modals.showDuelStartAnnouncement;
Renderer.prototype.showGameOverModal = modals.showGameOverModal;
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
