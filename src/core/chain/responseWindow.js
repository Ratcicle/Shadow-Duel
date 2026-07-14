import { isAI } from "../Player.js";

/**
 * Open a chain window for responses
 * @param {ChainContext} context - Context that triggered the chain window
 * @returns {Promise<void>}
 */
export async function openChainWindow(context) {
  if (!this.game || this.isResolving) {
    this.log(
      "[ChainSystem] Cannot open chain window: game missing or chain resolving",
    );
    return;
  }

  this.log(
    `[ChainSystem] Opening chain window: ${context?.type}`,
    context,
  );

  this.chainWindowOpen = true;
  this.chainWindowContext = context;
  this.chainStack = [];
  this.currentChainLevel = 0;
  this.chainEventCompletions = [];
  this.chainTriggerEffectsOffered = new Map();

  // If there's a triggering card/effect, add it as Chain Link 1
  if (context?.preparedActivation) {
    const rootLink = this.addToChain({
      ...context.preparedActivation,
      context,
    });
    const publication = await this.publishChainLinkActivation?.(rootLink);
    await this.appendActivationTriggerPackages?.(publication, context);
  } else if (
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
  this.log(
    `[ChainSystem] Offering chain responses (first: ${respondingPlayer?.id}, second: ${triggerPlayer?.id})`,
  );
  await this.offerChainResponses(respondingPlayer, triggerPlayer, context);
  this.log(
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
    this.log(`[ChainSystem] Chain resolution paused for selection`);
    return resolutionResult;
  }
  this.log(`[ChainSystem] Chain resolution complete`);
  await this.completeActivationTriggerPackages?.();

  // Clean up
  this.log(`[ChainSystem] Cleaning up chain window`);
  this.chainWindowOpen = false;
  this.chainWindowContext = null;
  this.chainStack = [];
  this.currentChainLevel = 0;
  this.cardsBeingResolved.clear();
  this.log(`[ChainSystem] Chain window closed successfully`);
  if (typeof this.game?.flushPendingChainEvents === "function") {
    const eventFlushResult = await this.game.flushPendingChainEvents({
      reason: "chain_window_closed",
    });
    if (eventFlushResult?.needsSelection) {
      return eventFlushResult;
    }
  }
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
      const preparation = await this.prepareChainResponse(
        response,
        currentResponder,
        response.context || context,
      );
      if (!preparation?.success || !preparation.preparedActivation) {
        this.log(
          `${currentResponder.id} response preparation failed: ${
            preparation?.reason || "unknown reason"
          }`,
        );
        consecutivePasses++;
      } else {
        // Player activated something, reset pass counter
        consecutivePasses = 0;
        const responseLink = this.addToChain(preparation.preparedActivation);
        const publication = await this.publishChainLinkActivation?.(responseLink);
        await this.appendActivationTriggerPackages?.(
          publication,
          response.context || context,
        );

        this.log(
          `${currentResponder.id} added ${response.card.name} to chain (Level ${this.currentChainLevel})`,
        );
      }
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
