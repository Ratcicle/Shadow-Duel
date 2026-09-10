import type * as board from "../../ui/renderer/board.js";
import type * as indicators from "../../ui/renderer/indicators.js";
import type * as equipLinks from "../../ui/renderer/equipLinks.js";
import type * as preview from "../../ui/renderer/preview.js";
import type * as log from "../../ui/renderer/log.js";
import type * as animations from "../../ui/renderer/animations.js";
import type * as cardAnimationManager from "../../ui/renderer/cardAnimationManager.js";
import type * as feedbackFx from "../../ui/renderer/feedbackFx.js";
import type * as bindings from "../../ui/renderer/bindings.js";
import type * as modals from "../../ui/renderer/modals.js";
import type * as summonModals from "../../ui/renderer/summonModals.js";
import type * as selectionModals from "../../ui/renderer/selectionModals.js";
import type * as trapModals from "../../ui/renderer/trapModals.js";
import type { UiCard } from "../../ui/renderer/types.js";
/** Serializable geometry shared by the engine and presentation layers. */
export interface UiPoint {
  x: number;
  y: number;
}
export interface UiRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export type VisualTone = "gold" | "red" | "green" | "blue" | "violet";
export type TargetingVisualMode = "hover" | "selected";

export interface ImpactFeedback {
  kind?: string;
  x?: number;
  y?: number;
  tone?: string;
  intensity?: number;
}

/**
 * Engine-to-presentation surface. Each named method keeps the renderer module's
 * checked signature while removing its implementation-only receiver. Generic
 * selection methods are explicit so candidate identity is preserved in callbacks.
 */
export interface GameUI {
  renderHand: OmitThisParameter<typeof board.renderHand>;
  renderField: OmitThisParameter<typeof board.renderField>;
  renderSpellTrap: OmitThisParameter<typeof board.renderSpellTrap>;
  renderFieldSpell: OmitThisParameter<typeof board.renderFieldSpell>;
  updateGYPreview: OmitThisParameter<typeof board.updateGYPreview>;
  updateExtraDeckPreview: OmitThisParameter<
    typeof board.updateExtraDeckPreview
  >;
  renderGraveyardModal: OmitThisParameter<typeof board.renderGraveyardModal>;
  renderExtraDeckModal: OmitThisParameter<typeof board.renderExtraDeckModal>;
  applyActivationIndicators: OmitThisParameter<
    typeof indicators.applyActivationIndicators
  >;
  applyAttackReadyIndicators: OmitThisParameter<
    typeof indicators.applyAttackReadyIndicators
  >;
  clearAttackReadyIndicators: OmitThisParameter<
    typeof indicators.clearAttackReadyIndicators
  >;
  applyAttackResolutionIndicators: OmitThisParameter<
    typeof indicators.applyAttackResolutionIndicators
  >;
  clearAttackResolutionIndicators: OmitThisParameter<
    typeof indicators.clearAttackResolutionIndicators
  >;
  applyFlipAnimation: OmitThisParameter<typeof indicators.applyFlipAnimation>;
  applySpellTrapFlipAnimation: OmitThisParameter<
    typeof indicators.applySpellTrapFlipAnimation
  >;
  setPlayerFieldTributeable: OmitThisParameter<
    typeof indicators.setPlayerFieldTributeable
  >;
  setPlayerFieldSelected: OmitThisParameter<
    typeof indicators.setPlayerFieldSelected
  >;
  clearPlayerFieldTributeable: OmitThisParameter<
    typeof indicators.clearPlayerFieldTributeable
  >;
  applyTargetHighlights: OmitThisParameter<
    typeof indicators.applyTargetHighlights
  >;
  clearTargetHighlights: OmitThisParameter<
    typeof indicators.clearTargetHighlights
  >;
  setSelectionDimming: OmitThisParameter<typeof indicators.setSelectionDimming>;
  applyHandTargetableIndices: OmitThisParameter<
    typeof indicators.applyHandTargetableIndices
  >;
  getSelectionCleanupState: OmitThisParameter<
    typeof indicators.getSelectionCleanupState
  >;
  syncEquipLinkIndicators: OmitThisParameter<
    typeof equipLinks.syncEquipLinkIndicators
  >;
  renderPreview: OmitThisParameter<typeof preview.renderPreview>;
  log: OmitThisParameter<typeof log.log>;
  updateTurn: OmitThisParameter<typeof log.updateTurn>;
  updatePriorityIndicator: OmitThisParameter<
    typeof log.updatePriorityIndicator
  >;
  updatePhaseTrack: OmitThisParameter<typeof log.updatePhaseTrack>;
  updateLP: OmitThisParameter<typeof log.updateLP>;
  captureCardRects: OmitThisParameter<typeof animations.captureCardRects>;
  animateCardLayout: OmitThisParameter<typeof animations.animateCardLayout>;
  showLpDamageSequence: OmitThisParameter<
    typeof animations.showLpDamageSequence
  >;
  showLpChange: OmitThisParameter<typeof animations.showLpChange>;
  waitForLpPresentation: OmitThisParameter<
    typeof animations.waitForLpPresentation
  >;
  captureCardAnimationSource: OmitThisParameter<
    typeof cardAnimationManager.captureCardAnimationSource
  >;
  playQueuedCardAnimations: OmitThisParameter<
    typeof cardAnimationManager.playQueuedCardAnimations
  >;
  playAttackLunge: OmitThisParameter<
    typeof cardAnimationManager.playAttackLunge
  >;
  playVisualFeedback: OmitThisParameter<typeof feedbackFx.playVisualFeedback>;
  playBattleImpactImmediate: OmitThisParameter<
    typeof feedbackFx.playBattleImpactImmediate
  >;
  bindPhaseClick: OmitThisParameter<typeof bindings.bindPhaseClick>;
  bindCardHover: OmitThisParameter<typeof bindings.bindCardHover>;
  bindPlayerHandClick: OmitThisParameter<typeof bindings.bindPlayerHandClick>;
  bindPlayerFieldClick: OmitThisParameter<typeof bindings.bindPlayerFieldClick>;
  bindPlayerSpellTrapClick: OmitThisParameter<
    typeof bindings.bindPlayerSpellTrapClick
  >;
  bindPlayerFieldSpellClick: OmitThisParameter<
    typeof bindings.bindPlayerFieldSpellClick
  >;
  bindBotFieldClick: OmitThisParameter<typeof bindings.bindBotFieldClick>;
  bindBotSpellTrapClick: OmitThisParameter<
    typeof bindings.bindBotSpellTrapClick
  >;
  bindBotHandClick: OmitThisParameter<typeof bindings.bindBotHandClick>;
  bindBotFieldSpellClick: OmitThisParameter<
    typeof bindings.bindBotFieldSpellClick
  >;
  bindPlayerGraveyardClick: OmitThisParameter<
    typeof bindings.bindPlayerGraveyardClick
  >;
  bindBotGraveyardClick: OmitThisParameter<
    typeof bindings.bindBotGraveyardClick
  >;
  bindPlayerExtraDeckClick: OmitThisParameter<
    typeof bindings.bindPlayerExtraDeckClick
  >;
  bindBotExtraDeckClick: OmitThisParameter<
    typeof bindings.bindBotExtraDeckClick
  >;
  bindGraveyardModalClose: OmitThisParameter<
    typeof bindings.bindGraveyardModalClose
  >;
  bindExtraDeckModalClose: OmitThisParameter<
    typeof bindings.bindExtraDeckModalClose
  >;
  bindModalOverlayClick: OmitThisParameter<
    typeof bindings.bindModalOverlayClick
  >;
  bindGlobalKeydown: OmitThisParameter<typeof bindings.bindGlobalKeydown>;
  toggleModal: OmitThisParameter<typeof modals.toggleModal>;
  toggleExtraDeckModal: OmitThisParameter<typeof modals.toggleExtraDeckModal>;
  showConfirmPrompt: OmitThisParameter<typeof modals.showConfirmPrompt>;
  showNumberPrompt: OmitThisParameter<typeof modals.showNumberPrompt>;
  showAlert: OmitThisParameter<typeof modals.showAlert>;
  showDuelStartAnnouncement: OmitThisParameter<
    typeof modals.showDuelStartAnnouncement
  >;
  showGameOverModal: OmitThisParameter<typeof modals.showGameOverModal>;
  getSearchModalElements: OmitThisParameter<
    typeof modals.getSearchModalElements
  >;
  showSearchModal: OmitThisParameter<typeof modals.showSearchModal>;
  showSearchModalVisual: OmitThisParameter<typeof modals.showSearchModalVisual>;
  showSummonModal: OmitThisParameter<typeof summonModals.showSummonModal>;
  showConditionalSummonPrompt: OmitThisParameter<
    typeof summonModals.showConditionalSummonPrompt
  >;
  showTierChoiceModal: OmitThisParameter<
    typeof summonModals.showTierChoiceModal
  >;
  showSpellChoiceModal: OmitThisParameter<
    typeof summonModals.showSpellChoiceModal
  >;
  showPositionChoiceModal: OmitThisParameter<
    typeof summonModals.showPositionChoiceModal
  >;
  showSpecialSummonPositionModal: OmitThisParameter<
    typeof summonModals.showSpecialSummonPositionModal
  >;
  showTargetSelection: OmitThisParameter<
    typeof selectionModals.showTargetSelection
  >;
  showFieldTargetingControls: OmitThisParameter<
    typeof selectionModals.showFieldTargetingControls
  >;
  hideFieldTargetingControls: OmitThisParameter<
    typeof selectionModals.hideFieldTargetingControls
  >;
  showDestructionNegationPrompt: OmitThisParameter<
    typeof selectionModals.showDestructionNegationPrompt
  >;
  showFusionTargetModal: OmitThisParameter<
    typeof selectionModals.showFusionTargetModal
  >;
  showTriggerOrderModal: OmitThisParameter<
    typeof selectionModals.showTriggerOrderModal
  >;
  showIgnitionActivateModal: OmitThisParameter<
    typeof selectionModals.showIgnitionActivateModal
  >;
  showUnifiedTrapModal: OmitThisParameter<
    typeof trapModals.showUnifiedTrapModal
  >;
  showTrapActivationModal: OmitThisParameter<
    typeof trapModals.showTrapActivationModal
  >;
  isLeftMouseHeldForChainSkip(): boolean;
  showCardGridSelectionModal<T extends UiCard>(
    options: selectionModals.CardGridOptions<T> | null,
  ): void;
  showFusionMaterialSelection<T extends UiCard>(
    materials: readonly T[],
    requirements: readonly selectionModals.MaterialDisplayRequirement[],
    onConfirm: (cards: T[]) => void,
    onCancel?: () => void,
  ): void;
  showShadowHeartCathedralModal<T extends UiCard>(
    cards: readonly T[],
    maxAtk: number,
    counterCount: number,
    callback: (card: T | null) => void,
  ): void;
  showSickleSelectionModal<T extends UiCard>(
    cards: readonly T[],
    maxSelect: number,
    onConfirm: (cards: T[]) => void,
    onCancel?: () => void,
  ): void;
  showTieBreakerSelection<T extends UiCard>(
    options?: selectionModals.TieBreakerOptions<T>,
  ): void;
  showMultiSelectModal<T extends UiCard>(
    cards?: readonly T[],
    range?: selectionModals.MultiSelectRange<T>,
    onConfirm?: (cards: T[]) => void,
  ): void;
  showChainResponseModal<T extends trapModals.TrapCandidate>(
    cards: readonly T[],
    context: trapModals.ChainDisplayContext | null,
    stack?: readonly unknown[],
    options?: { signal?: AbortSignal | null },
  ): Promise<T | null>;
}
