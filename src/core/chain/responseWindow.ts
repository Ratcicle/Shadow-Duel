import { isAI } from "../Player.js";
import type {
  ChainActivationCandidate,
  ChainLink,
  ChainMaybePromise,
  ChainOperationResult,
  ChainPlayer,
  ChainResponseNegotiation,
  ChainWindowOptions,
  FastEffectContextInput,
  FullChainHost,
} from "../contracts/chainRuntime.js";
import { FAST_EFFECT_STATES } from "../contracts/chain.js";
import { createChainResponseDecisionAdapter } from "../game/decisions/chainResponse.js";

function isChainOperationPromise(
  value: unknown,
): value is PromiseLike<ChainOperationResult> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof Reflect.get(value, "then") === "function"
  );
}

function cleanupChainWindow(chainSystem: FullChainHost): void {
  chainSystem.log("[ChainSystem] Cleaning up chain window");
  chainSystem.chainWindowOpen = false;
  chainSystem.chainWindowContext = null;
  chainSystem.chainStack = [];
  chainSystem.currentChainLevel = 0;
  chainSystem.activeChainId = null;
  chainSystem.currentResolvingLink = null;
  chainSystem.cardsBeingResolved.clear();
  chainSystem.log("[ChainSystem] Chain window closed successfully");
}

/**
 * Open a chain window for responses
 * @param {ChainContext} context - Context that triggered the chain window
 * @param {Object} options - Explicit priority and prepared activation data
 * @returns {Promise<Object>}
 */
export async function openChainWindow(
  this: FullChainHost,
  context: FastEffectContextInput = {},
  options: ChainWindowOptions = {},
): Promise<ChainOperationResult> {
  if (!this.game || this.isResolving || this.chainWindowOpen) {
    this.log(
      "[ChainSystem] Cannot open chain window: game missing or timing is busy",
    );
    return {
      ok: false,
      success: false,
      chainBuilt: false,
      needsSelection: false,
      reason: "chain_window_busy",
    };
  }

  const selectionGeneration = this.game.selectionAbortGeneration ?? 0;
  const selectionWasAborted = () => (this.game?.selectionAbortGeneration ?? 0) !== selectionGeneration;
  const abortedResult = (): ChainOperationResult => ({
    success: false, ok: false, needsSelection: false, code: "SELECTION_ABORTED",
  });
  const firstPlayer = options.firstPlayer || context.firstPlayer || null;
  const secondPlayer =
    options.secondPlayer || this.getOpponent?.(firstPlayer) || null;
  if (!firstPlayer) {
    return {
      ok: false,
      success: false,
      chainBuilt: false,
      needsSelection: false,
      reason: "missing_initial_priority_player",
    };
  }

  const preparedActivations = Array.isArray(options.preparedActivations)
    ? options.preparedActivations.filter(Boolean)
    : Array.isArray(context.preparedActivations)
      ? context.preparedActivations.filter(Boolean)
      : context.preparedActivation
        ? [context.preparedActivation]
        : [];

  this.log(
    `[ChainSystem] Opening chain window: ${context?.type}`,
    context,
  );

  this.chainWindowOpen = true;
  this.chainWindowContext = context;
  this.chainStack = [];
  this.currentChainLevel = 0;
  this.activeChainId = null;
  this.chainEventCompletions = [];
  this.chainTriggerEffectsOffered = new Map();
  this.resetChainFinalizationState?.("new_chain");

  // Phase 3 will own collection/order; Phase 2 only consumes an ordered list.
  let initialLinkId: ChainLink["linkId"] | null = null;
  for (const preparedActivation of preparedActivations) {
    const rootLink = this.addToChain({
      ...preparedActivation,
      context: {
        ...(context || {}),
        // Prepared triggers carry occurrence-specific runtime values. Keep
        // those values while adding the shared response-window context.
        ...(preparedActivation.context || {}),
      },
    }) as ChainLink;
    if (preparedActivations.length === 1) initialLinkId = rootLink?.linkId ?? null;
    const publication = await this.publishChainLinkActivation?.(rootLink);
    await this.appendActivationTriggerPackages?.(publication, context);
  }

  this.log(
    `[ChainSystem] Offering chain responses (first: ${firstPlayer?.id}, second: ${secondPlayer?.id})`,
  );
  const responseMetadata = await this.offerChainResponses(
    firstPlayer,
    secondPlayer,
    context,
    { initialPasses: options.initialPasses || 0 },
  );
  if (selectionWasAborted()) return abortedResult();
  const chainBuilt = this.chainStack.length > 0;
  const chainId = this.activeChainId;
  const lastLink = this.getLastChainLink?.() || null;
  const lastLinkController = lastLink?.controller || null;
  this.log(
    `[ChainSystem] Chain responses complete, resolving chain (${this.chainStack.length} links)`,
  );

  if (!chainBuilt) {
    cleanupChainWindow(this);
    return {
      ok: true,
      success: true,
      chainBuilt: false,
      chainId: null,
      lastLinkController: null,
      needsSelection: false,
      responses: responseMetadata,
    };
  }

  this.transitionFastEffectState?.(FAST_EFFECT_STATES.RESOLVING_CHAIN, {
    chainId,
    lastLinkController,
    priorityPlayer: null,
    consecutivePasses: responseMetadata?.consecutivePasses || 0,
  });

  let resolutionResult: ChainOperationResult;
  try {
    resolutionResult = (await this.resolveChain()) as ChainOperationResult;
  } catch (error) {
    cleanupChainWindow(this);
    throw error;
  }
  if (selectionWasAborted()) return abortedResult();
  if (resolutionResult?.needsSelection) {
    const pendingResolution =
      this.startPendingChainSelection?.(resolutionResult);
    if (isChainOperationPromise(pendingResolution)) {
      resolutionResult = (await pendingResolution) as ChainOperationResult;
    } else {
      this.log("[ChainSystem] Chain resolution paused for selection");
      return {
        ok: true,
        success: false,
        chainBuilt: true,
        chainId,
        lastLinkController,
        needsSelection: true,
        responses: responseMetadata,
        resolutionResult,
      };
    }
  }
  if (selectionWasAborted()) return abortedResult();
  this.log(`[ChainSystem] Chain resolution complete`);
  const activationResult = initialLinkId === null ? undefined :
    resolutionResult.linkResults?.find(result => result.linkId === initialLinkId);
  if (activationResult) resolutionResult = { ...resolutionResult, activationResult };
  if (this.chainWindowOpen) {
    await this.completeActivationTriggerPackages?.();
    cleanupChainWindow(this);
  }
  return {
    ok: resolutionResult?.success !== false,
    success: resolutionResult?.success !== false,
    chainBuilt: true,
    chainId,
    lastLinkController,
    needsSelection: false,
    responses: responseMetadata,
    resolutionResult,
  };
}

/**
 * Offer chain response opportunities to players
 * @param {Object} firstPlayer - First player to respond
 * @param {Object} secondPlayer - Second player to respond
 * @param {ChainContext} context
 * @param {Object} options - Initial pass count for phase-transition intent
 * @returns {Promise<Object>} Negotiation metadata
 */
export async function offerChainResponses(
  this: FullChainHost,
  firstPlayer: ChainPlayer,
  secondPlayer: ChainPlayer | null,
  context: FastEffectContextInput,
  options: { initialPasses?: number } = {},
): Promise<ChainResponseNegotiation> {
  const selectionGeneration = this.game?.selectionAbortGeneration ?? 0;
  let consecutivePasses = Math.max(0, Number(options.initialPasses || 0));
  let currentResponder: ChainPlayer | null = firstPlayer;
  let offers = 0;
  let activations = 0;
  let lastActivator = null;

  while (consecutivePasses < 2 && currentResponder) {
    offers += 1;
    this.recordFastEffectPriority?.(currentResponder, "offered", {
      consecutivePasses,
      chainId: this.activeChainId,
      lastLinkController: this.getLastChainLink?.()?.controller || null,
    });
    const response = await this.offerChainResponse(currentResponder, context);
    if ((this.game?.selectionAbortGeneration ?? 0) !== selectionGeneration) break;

    if (response) {
      const preparation = await this.prepareChainResponse(
        response,
        currentResponder,
        response.context || context,
      );
      if ((this.game?.selectionAbortGeneration ?? 0) !== selectionGeneration) break;
      if (!preparation?.success || !preparation.preparedActivation) {
        this.log(
          `${currentResponder.id} response preparation failed: ${
            preparation?.reason || "unknown reason"
          }`,
        );
        consecutivePasses++;
        this.recordFastEffectPriority?.(currentResponder, "pass", {
          consecutivePasses,
          chainId: this.activeChainId,
        });
      } else {
        consecutivePasses = 0;
        const responseLink = this.addToChain(
          preparation.preparedActivation,
        ) as ChainLink;
        activations += 1;
        lastActivator = currentResponder;
        const publication = await this.publishChainLinkActivation?.(responseLink);
        await this.appendActivationTriggerPackages?.(
          publication,
          response.context || context,
        );
        this.recordFastEffectPriority?.(currentResponder, "activate", {
          consecutivePasses,
          chainId: responseLink.chainId,
          linkId: responseLink.linkId,
          lastLinkController: currentResponder,
        });

        this.log(
          `${currentResponder.id} added ${response.card.name} to chain (Level ${this.currentChainLevel})`,
        );
      }
    } else {
      consecutivePasses++;
      this.recordFastEffectPriority?.(currentResponder, "pass", {
        consecutivePasses,
        chainId: this.activeChainId,
        lastLinkController: this.getLastChainLink?.()?.controller || null,
      });
      this.log(`${currentResponder.id} passed`);
    }

    currentResponder =
      currentResponder === firstPlayer ? secondPlayer : firstPlayer;
  }

  this.log(`Chain building complete with ${this.chainStack.length} links`);
  return {
    offers,
    activations,
    consecutivePasses,
    lastActivator,
    chainBuilt: this.chainStack.length > 0,
  };
}

/**
 * Offer a single chain response opportunity to a player
 * @param {Object} player
 * @param {ChainContext} context
 * @returns {Promise<{card: Object, effect: Object, selections: Object}|null>}
 */
export async function offerChainResponse(
  this: FullChainHost,
  player: ChainPlayer | null | undefined,
  context: FastEffectContextInput,
): Promise<ChainActivationCandidate | null> {
  if (!player) return null;

  const activatable = this.getActivatableCardsInChain(player, context);

  if (activatable.length === 0) {
    this.log(`${player.id} has no activatable cards`);
    return null;
  }

  // AI logic - use controllerType instead of player.id to support online PvP
  if (isAI(player)) {
    const resolveAI = () =>
      this.botChooseChainResponse(player, activatable, context);
    return typeof this.game?.requestDecision === "function"
      ? (this.game.requestDecision({
          kind: "chain_response",
          actor: player,
          candidates: activatable,
          ...createChainResponseDecisionAdapter(this.game, activatable),
          contextSnapshot: {
            type: context?.type || null,
            chainId: this.activeChainId ?? null,
            respondingToLinkId: this.getLastChainLink?.()?.linkId ?? null,
          },
          resolveAI,
        }) as ChainMaybePromise<ChainActivationCandidate | null>)
      : resolveAI();
  }

  // Human player - show UI
  return this.playerChooseChainResponse(player, activatable, context);
}
