export default class NullChainSystem {
  constructor() {
    this.chainsDisabled = true;
    this.chainWindowOpen = false;
    this.chainStack = [];
    this.chainResolving = false;
    this.currentChainLevel = 0;
  }

  log() {}
  isChainResolving() {
    return this.chainResolving;
  }
  isChainWindowOpen() {
    return this.chainWindowOpen;
  }
  getActivatableCardsInChain() {
    return [];
  }
  getCurrentChainLength() {
    return this.chainStack.length;
  }
  getChainLength() {
    return this.chainStack.length;
  }
  getCurrentChainLevel() {
    return this.currentChainLevel;
  }
  getLastLink() {
    return null;
  }
  getLastChainLink() {
    return null;
  }
  getChainSummary() {
    return [];
  }
  canActivateInChain() {
    return { ok: false, reason: "chains_disabled" };
  }
  async openChainWindow() {
    this.chainWindowOpen = false;
    this.chainResolving = false;
    this.chainStack = [];
    return false;
  }
  async openActivationChain(preparedActivation = {}) {
    return {
      success: true,
      needsSelection: false,
      chainsDisabled: true,
      preparedActivation,
    };
  }
  async openEventWindow() {
    return { success: true, needsSelection: false, chainsDisabled: true };
  }
  createPreparedActivation(input = {}) {
    return { ...input, prepared: true };
  }
  getEffectActivationCosts(effect) {
    return Array.isArray(effect?.activationCosts) ? effect.activationCosts : [];
  }
  getEffectResolutionActions(effect) {
    return Array.isArray(effect?.actions) ? effect.actions : [];
  }
  async offerChainResponse() {
    return { success: false, reason: "chains_disabled" };
  }
  addToChain() {
    return false;
  }
  async resolveChain() {
    this.chainResolving = false;
    this.chainWindowOpen = false;
    this.chainStack = [];
    this.currentChainLevel = 0;
    return false;
  }
  cancelChain() {
    this.chainStack = [];
    this.chainWindowOpen = false;
    this.chainResolving = false;
    this.currentChainLevel = 0;
  }
  reset() {
    this.cancelChain();
  }
}
