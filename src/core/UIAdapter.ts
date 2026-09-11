import type { GameUI } from "./contracts/ui.js";
import type { GameRendererPort } from "./contracts/game.js";

/** No UI decision is made on behalf of a player by these inert methods. */
const UI_FALLBACKS: GameUI = {
  renderHand: () => undefined,
  renderField: () => undefined,
  renderSpellTrap: () => undefined,
  renderFieldSpell: () => undefined,
  updateGYPreview: () => undefined,
  updateExtraDeckPreview: () => undefined,
  renderGraveyardModal: () => undefined,
  renderExtraDeckModal: () => undefined,
  applyActivationIndicators: () => undefined,
  applyAttackReadyIndicators: () => undefined,
  clearAttackReadyIndicators: () => undefined,
  applyAttackResolutionIndicators: () => undefined,
  clearAttackResolutionIndicators: () => undefined,
  applyFlipAnimation: () => Promise.resolve(false),
  applySpellTrapFlipAnimation: () => Promise.resolve(false),
  setPlayerFieldTributeable: () => undefined,
  setPlayerFieldSelected: () => undefined,
  clearPlayerFieldTributeable: () => undefined,
  applyTargetHighlights: () => undefined,
  clearTargetHighlights: () => undefined,
  setSelectionDimming: () => undefined,
  applyHandTargetableIndices: () => undefined,
  getSelectionCleanupState: () => ({
    controlsVisible: false,
    highlightCount: 0,
  }),
  syncEquipLinkIndicators: () => undefined,
  renderPreview: () => undefined,
  log: () => undefined,
  updateTurn: () => undefined,
  updatePriorityIndicator: () => undefined,
  updatePhaseTrack: () => undefined,
  updateLP: () => undefined,
  captureCardRects: () => new Map(),
  animateCardLayout: () => Promise.resolve(false),
  showLpDamageSequence: () => false,
  showLpChange: () => false,
  waitForLpPresentation: () => Promise.resolve(false),
  captureCardAnimationSource: () => null,
  playQueuedCardAnimations: () => Promise.resolve(false),
  playAttackLunge: () => {
    const finished = Promise.resolve(false);
    return {
      contact: finished,
      finished,
      cancel: () => finished,
      then: (...args) => finished.then(...args),
      catch: (...args) => finished.catch(...args),
      finally: (...args) => finished.finally(...args),
    };
  },
  playVisualFeedback: () => undefined,
  playBattleImpactImmediate: () => false,
  bindPhaseClick: () => undefined,
  bindCardHover: () => undefined,
  bindPlayerHandClick: () => undefined,
  bindPlayerFieldClick: () => undefined,
  bindPlayerSpellTrapClick: () => undefined,
  bindPlayerFieldSpellClick: () => undefined,
  bindBotFieldClick: () => undefined,
  bindBotSpellTrapClick: () => undefined,
  bindBotHandClick: () => undefined,
  bindBotFieldSpellClick: () => undefined,
  bindPlayerGraveyardClick: () => undefined,
  bindBotGraveyardClick: () => undefined,
  bindPlayerExtraDeckClick: () => undefined,
  bindBotExtraDeckClick: () => undefined,
  bindGraveyardModalClose: () => undefined,
  bindExtraDeckModalClose: () => undefined,
  bindModalOverlayClick: () => undefined,
  bindGlobalKeydown: () => undefined,
  toggleModal: () => undefined,
  toggleExtraDeckModal: () => undefined,
  showConfirmPrompt: () => false,
  showNumberPrompt: () => null,
  showAlert: () => undefined,
  showDuelStartAnnouncement: () => Promise.resolve(false),
  showGameOverModal: () => undefined,
  getSearchModalElements: () => null,
  showSearchModal: () => undefined,
  showSearchModalVisual: () => undefined,
  showSummonModal: () => undefined,
  showConditionalSummonPrompt: () => Promise.resolve(false),
  showTierChoiceModal: () => Promise.resolve(null),
  showSpellChoiceModal: () => undefined,
  showPositionChoiceModal: () => undefined,
  showSpecialSummonPositionModal: () => undefined,
  showTargetSelection: () => ({ close: () => undefined }),
  showFieldTargetingControls: () => ({
    close: () => undefined,
    updateState: () => undefined,
  }),
  hideFieldTargetingControls: () => undefined,
  showDestructionNegationPrompt: () => undefined,
  showFusionTargetModal: () => undefined,
  showTriggerOrderModal: () => Promise.resolve([]),
  showIgnitionActivateModal: () => undefined,
  showUnifiedTrapModal: () => Promise.resolve(null),
  showTrapActivationModal: () => Promise.resolve(false),
  isLeftMouseHeldForChainSkip: () => false,
  showCardGridSelectionModal: () => undefined,
  showFusionMaterialSelection: () => undefined,
  showShadowHeartCathedralModal: () => undefined,
  showSickleSelectionModal: () => undefined,
  showTieBreakerSelection: () => undefined,
  showMultiSelectModal: () => undefined,
  showChainResponseModal: () => Promise.resolve(null),
};

export function createUIAdapter(
  renderer: GameRendererPort | null | undefined,
): GameUI {
  const base: Pick<
    GameUI,
    "log" | "showConfirmPrompt" | "showNumberPrompt" | "showAlert"
  > = {
    log: (message) => renderer?.log?.(message),
    showConfirmPrompt: (message, options) =>
      renderer?.showConfirmPrompt
        ? renderer.showConfirmPrompt(message, options)
        : false,
    showNumberPrompt: (message, defaultValue) =>
      renderer?.showNumberPrompt
        ? renderer.showNumberPrompt(message, defaultValue)
        : null,
    showAlert: (message) => renderer?.showAlert?.(message),
  };
  const overrides = new Set<PropertyKey>();
  return new Proxy(
    { ...UI_FALLBACKS, ...base },
    {
      get(target, prop) {
        if (prop in base || overrides.has(prop))
          return Reflect.get(target, prop);
        const value: unknown = renderer
          ? Reflect.get(renderer, prop)
          : undefined;
        if (typeof value === "function") return value.bind(renderer);
        return value ?? Reflect.get(target, prop);
      },
      set(target, prop, value: unknown) {
        overrides.add(prop);
        return Reflect.set(target, prop, value);
      },
    },
  );
}

export function createDisposedUIAdapter(): GameUI {
  return createUIAdapter(null);
}
