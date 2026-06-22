import { isAI } from "../Player.js";

/**
 * Open a chain window for responses
 * @param {ChainContext} context - Context that triggered the chain window
 * @returns {Promise<void>}
 */
export async function openChainWindow(context) {
  if (!this.game || this.isResolving) {
    console.log(
      "[ChainSystem] Cannot open chain window: game missing or chain resolving",
    );
    return;
  }

  console.log(
    `[ChainSystem] Opening chain window: ${context?.type}`,
    context,
  );

  this.chainWindowOpen = true;
  this.chainWindowContext = context;
  this.chainStack = [];
  this.currentChainLevel = 0;

  // If there's a triggering card/effect, add it as Chain Link 1
  if (
    context?.card &&
    context?.effect &&
    context?.player &&
    context.addTriggerToChain !== false &&
    context.skipTriggerLink !== true
  ) {
    const triggerZone =
      context?.zone || this.determineCardZone(context.card, context.player);
    this.addToChain(
      context.card,
      context.player,
      context.effect,
      context,
      null,
      triggerZone,
    );
  }

  // Determine priority order
  // Non-turn player gets first response opportunity
  const triggerPlayer = context?.triggerPlayer || this.getCurrentTurnPlayer();
  const respondingPlayer = this.getOpponent(triggerPlayer);

  // Offer response to non-trigger player first
  console.log(
    `[ChainSystem] Offering chain responses (first: ${respondingPlayer?.id}, second: ${triggerPlayer?.id})`,
  );
  await this.offerChainResponses(respondingPlayer, triggerPlayer, context);
  console.log(
    `[ChainSystem] Chain responses complete, resolving chain (${this.chainStack.length} links)`,
  );

  // Resolve the chain
  const resolutionResult = await this.resolveChain();
  if (resolutionResult?.needsSelection) {
    const pendingResolution =
      this.startPendingChainSelection?.(resolutionResult);
    if (pendingResolution && typeof pendingResolution.then === "function") {
      return await pendingResolution;
    }
    console.log(`[ChainSystem] Chain resolution paused for selection`);
    return resolutionResult;
  }
  console.log(`[ChainSystem] Chain resolution complete`);

  // Clean up
  console.log(`[ChainSystem] Cleaning up chain window`);
  this.chainWindowOpen = false;
  this.chainWindowContext = null;
  this.chainStack = [];
  this.currentChainLevel = 0;
  this.cardsBeingResolved.clear();
  console.log(`[ChainSystem] Chain window closed successfully`);
  return resolutionResult;
}

/**
 * Offer chain response opportunities to players
 * @param {Object} firstPlayer - First player to respond
 * @param {Object} secondPlayer - Second player to respond
 * @param {ChainContext} context
 */
export async function offerChainResponses(firstPlayer, secondPlayer, context) {
  let consecutivePasses = 0;
  let currentResponder = firstPlayer;

  while (consecutivePasses < 2) {
    const response = await this.offerChainResponse(currentResponder, context);

    if (response) {
      // Player activated something, reset pass counter
      consecutivePasses = 0;

      // Add to chain with the zone from the response
      this.addToChain(
        response.card,
        currentResponder,
        response.effect,
        response.context || context,
        response.selections,
        response.zone,
      );

      this.log(
        `${currentResponder.id} added ${response.card.name} to chain (Level ${this.currentChainLevel})`,
      );
    } else {
      // Player passed
      consecutivePasses++;
      this.log(`${currentResponder.id} passed`);
    }

    // Switch responder
    currentResponder =
      currentResponder === firstPlayer ? secondPlayer : firstPlayer;
  }

  this.log(`Chain building complete with ${this.chainStack.length} links`);
}

/**
 * Offer a single chain response opportunity to a player
 * @param {Object} player
 * @param {ChainContext} context
 * @returns {Promise<{card: Object, effect: Object, selections: Object}|null>}
 */
export async function offerChainResponse(player, context) {
  if (!player) return null;

  const activatable = this.getActivatableCardsInChain(player, context);

  if (activatable.length === 0) {
    this.log(`${player.id} has no activatable cards`);
    return null;
  }

  // AI logic - use controllerType instead of player.id to support online PvP
  if (isAI(player)) {
    return this.botChooseChainResponse(player, activatable, context);
  }

  // Human player - show UI
  return this.playerChooseChainResponse(player, activatable, context);
}
