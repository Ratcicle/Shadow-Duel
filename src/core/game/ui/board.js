// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/ui/board.js
// Board rendering and update methods for Game class — B.10 extraction
// ─────────────────────────────────────────────────────────────────────────────

import { inspectZoneNullishCards } from "../zones/invariants.js";

const RENDER_ZONE_NAMES = [
  "hand",
  "field",
  "spellTrap",
  "graveyard",
  "extraDeck",
];

function createRenderZoneList(player, zoneName) {
  return Array.isArray(player?.[zoneName])
    ? player[zoneName].filter((card) => card != null)
    : [];
}

function createPlayerRenderView(player) {
  if (!player) return player;
  const renderPlayer = Object.assign(
    Object.create(Object.getPrototypeOf(player)),
    player,
  );
  for (const zoneName of RENDER_ZONE_NAMES) {
    renderPlayer[zoneName] = createRenderZoneList(player, zoneName);
  }
  return renderPlayer;
}

function reportNullishZoneIssues(game, inspection) {
  if (!game) return;
  game.lastZoneNullishInspection = inspection?.ok === false ? inspection : null;
  if (inspection?.ok !== false) return;
  const detail = {
    summary: `Nullish zone slots detected during ${inspection.context}`,
    context: inspection.context,
    issues: inspection.issues,
  };
  game.devLog?.("ZONE_NULLISH_RENDER", detail);
  game._arenaTracker?.recordProgress?.("zone_nullish_render", game, detail);
  if (game.devModeEnabled) {
    console.error("[Game] Nullish zone slots detected during render", detail);
  }
}

/**
 * Updates the entire board display.
 * Refreshes all zones, LP, phase track, and indicators.
 */
export function updateBoard(options = {}) {
  if (this.isDisposed?.()) return Promise.resolve(false);

  const shouldAnimateCards = options.animateCards !== false;
  const shouldAnimateGhosts =
    shouldAnimateCards && options.animateGhosts !== false;
  const shouldAnimateFeedback =
    shouldAnimateCards && options.animateFeedback !== false;
  const canPlayGhosts =
    shouldAnimateGhosts &&
    this.cardAnimationsReady &&
    typeof this.ui.playQueuedCardAnimations === "function";
  const canPlayFeedback =
    shouldAnimateFeedback &&
    this.cardAnimationsReady &&
    typeof this.ui.playVisualFeedback === "function";
  const queuedGhostAnimations =
    canPlayGhosts && Array.isArray(this.pendingCardAnimations)
      ? this.pendingCardAnimations.splice(0)
      : [];
  const queuedVisualFeedback =
    canPlayFeedback && Array.isArray(this.pendingVisualFeedback)
      ? this.pendingVisualFeedback.splice(0)
      : [];
  const presentationPromises = [];

  if (!canPlayGhosts && Array.isArray(this.pendingCardAnimations)) {
    this.pendingCardAnimations.length = 0;
  }
  if (!canPlayFeedback && Array.isArray(this.pendingVisualFeedback)) {
    this.pendingVisualFeedback.length = 0;
  }

  const previousCardRects =
    shouldAnimateCards && typeof this.ui.captureCardRects === "function"
      ? this.ui.captureCardRects()
      : null;

  const renderNow = () => {
    const nullishInspection = inspectZoneNullishCards(this, "updateBoard", {
      zones: RENDER_ZONE_NAMES,
    });
    reportNullishZoneIssues(this, nullishInspection);

    // Update passive effects before rendering
    this.effectEngine?.updatePassiveBuffs();
    if (typeof this.player.updatePassiveEffects === "function") {
      this.player.updatePassiveEffects();
    }
    if (typeof this.bot.updatePassiveEffects === "function") {
      this.bot.updatePassiveEffects();
    }

    const handRenderContext = {
      laboratoryMode: this.laboratoryModeEnabled === true,
      activeTurn: this.turn,
      revealBotHand: this.laboratoryRevealBotHand === true,
    };

    const renderPlayer = createPlayerRenderView(this.player);
    const renderBot = createPlayerRenderView(this.bot);

    this.ui.renderHand(renderPlayer, handRenderContext);
    this.ui.renderField(renderPlayer, { turnCounter: this.turnCounter });
    this.ui.renderFieldSpell(renderPlayer);

    if (typeof this.ui.renderSpellTrap === "function") {
      this.ui.renderSpellTrap(renderPlayer);
      this.ui.renderSpellTrap(renderBot);
    } else {
      console.warn("Renderer missing renderSpellTrap implementation.");
    }

    this.ui.renderHand(renderBot, handRenderContext);
    this.ui.renderField(renderBot, { turnCounter: this.turnCounter });
    this.ui.renderFieldSpell(renderBot);
    this.ui.updateLP(renderPlayer);
    this.ui.updateLP(renderBot);
    this.ui.updatePhaseTrack(this.phase, this);
    this.ui.updateTurn(this.turn === "player" ? this.player : this.bot);
    this.ui.updateGYPreview(renderPlayer);
    this.ui.updateGYPreview(renderBot);

    if (typeof this.ui.updateExtraDeckPreview === "function") {
      this.ui.updateExtraDeckPreview(renderPlayer);
      this.ui.updateExtraDeckPreview(renderBot);
    }

    this.ui.syncEquipLinkIndicators?.();

    if (typeof document !== "undefined") {
      document
        .querySelectorAll(".laboratory-active-side")
        .forEach((el) => el.classList.remove("laboratory-active-side"));
    }
    if (this.laboratoryModeEnabled && typeof document !== "undefined") {
      const activeArea = document.getElementById(
        this.turn === "bot" ? "bot-area" : "player-area",
      );
      activeArea?.classList.add("laboratory-active-side");
    }

    if (this.targetSelection?.usingFieldTargeting) {
      this.highlightTargetCandidates();
    }

    // Highlight cards ready for special summon after rendering
    if (this.pendingSpecialSummon) {
      this.highlightReadySpecialSummon();
    }

    if (
      this.pendingTributeSummonSelection?.active === true &&
      this.pendingTributeSummonSelection.ownerId === "player" &&
      typeof this.ui.setPlayerFieldTributeable === "function"
    ) {
      const tributeable =
        this.pendingTributeSummonSelection.tributeableIndices || [];
      const selected =
        this.pendingTributeSummonSelection.selectedTributes || [];
      this.ui.setPlayerFieldTributeable(tributeable);
      if (typeof this.ui.setPlayerFieldSelected === "function") {
        selected.forEach((index) => this.ui.setPlayerFieldSelected(index, true));
      }
    }

    this.updateActivationIndicators();
    this.updateAttackIndicators();
  };

  renderNow();

  if (
    shouldAnimateCards &&
    previousCardRects &&
    typeof this.ui.animateCardLayout === "function"
  ) {
    const layoutPresentation = this.ui.animateCardLayout(previousCardRects);
    if (layoutPresentation && typeof layoutPresentation.then === "function") {
      presentationPromises.push(layoutPresentation);
    }
  }

  if (queuedGhostAnimations.length > 0) {
    const ghostPresentation = this.ui.playQueuedCardAnimations(
      queuedGhostAnimations,
      options,
    );
    if (ghostPresentation && typeof ghostPresentation.then === "function") {
      presentationPromises.push(ghostPresentation);
    }
  }

  if (queuedVisualFeedback.length > 0) {
    this.ui.playVisualFeedback(queuedVisualFeedback, options);
  }

  this.cardAnimationsReady = true;
  this.pendingBoardPresentationPromise =
    presentationPromises.length > 0
      ? Promise.allSettled(presentationPromises).then(() => true)
      : Promise.resolve(false);
  return this.pendingBoardPresentationPromise;
}

/**
 * Highlights cards in hand ready for pending special summon.
 */
export function highlightReadySpecialSummon() {
  // Find and highlight the card ready for special summon in hand
  if (!this.pendingSpecialSummon) return;
  const indices = [];
  this.player.hand.forEach((card, index) => {
    if (card && card.name === this.pendingSpecialSummon.cardName) {
      indices.push(index);
    }
  });
  if (this.ui && typeof this.ui.applyHandTargetableIndices === "function") {
    this.ui.applyHandTargetableIndices("player", indices);
  }
}
