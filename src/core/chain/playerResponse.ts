import { isAI } from "../Player.js";
import { createChainResponseDecisionAdapter } from "../game/decisions/chainResponse.js";
import type {
  ChainActivationCandidate,
  ChainMaybePromise,
  ChainPlayer,
  ChainUiPort,
  FastEffectContextInput,
  FullChainHost,
} from "../contracts/chainRuntime.js";

type PlayerResponseHost = Pick<
  FullChainHost,
  | "activeChainId"
  | "activeResponseAbortController"
  | "game"
  | "getChainSummary"
  | "getLastChainLink"
  | "getUI"
  | "log"
  | "responseTimeoutMs"
>;

/**
 * Human resolver for a Chain response window. Every outcome it produces is a
 * value the broker records: holding the left mouse button, a missing modal and
 * a failing modal all resolve to a pass (`null`) instead of skipping the
 * decision, so live recordings and playback consume the same decision stream.
 */
async function resolveHumanChainResponse(
  host: PlayerResponseHost,
  ui: ChainUiPort,
  activatable: ChainActivationCandidate[],
  context: FastEffectContextInput,
): Promise<ChainActivationCandidate | null> {
  if (ui.isLeftMouseHeldForChainSkip?.() === true) {
    host.log("Left mouse button held - auto-passing chain response");
    return null;
  }
  const showModal = ui.showChainResponseModal;
  if (typeof showModal !== "function") {
    host.log("No Chain response modal available - passing chain response");
    return null;
  }

  host.activeResponseAbortController?.abort?.("response_replaced");
  const controller = new AbortController();
  host.activeResponseAbortController = controller;
  const timeoutMs = Number.isFinite(host.responseTimeoutMs)
    ? Math.max(0, host.responseTimeoutMs)
    : 30000;
  const timeoutId = setTimeout(() => {
    controller.abort("response_timeout");
  }, timeoutMs);
  try {
    return await showModal.call(
      ui,
      activatable,
      context,
      host.getChainSummary?.() || [],
      { signal: controller.signal },
    );
  } catch (error) {
    console.error("[ChainSystem] Chain response modal failed; passing:", error);
    return null;
  } finally {
    clearTimeout(timeoutId);
    if (host.activeResponseAbortController === controller) {
      host.activeResponseAbortController = null;
    }
  }
}

/**
 * Human player choosing a Chain response. The decision always goes through
 * the broker, so replay errors propagate exactly as on the AI path.
 */
export async function playerChooseChainResponse(
  this: PlayerResponseHost,
  player: ChainPlayer,
  activatable: ChainActivationCandidate[],
  context: FastEffectContextInput,
): Promise<ChainActivationCandidate | null> {
  // AI responders are resolved by the bot response policy, never by this UI path.
  if (isAI(player)) {
    this.log(`Player ${player.id} is AI - auto-passing chain response`);
    return null;
  }

  const ui = this.getUI();

  if (!ui) {
    this.log("No UI available for player response");
    return null;
  }

  const resolveHuman = () =>
    resolveHumanChainResponse(this, ui, activatable, context);

  // Phase 4: choosing a response selects only the effect. Cost and target
  // selections belong to the canonical activation transaction.
  const chosenOption = typeof this.game?.requestDecision === "function"
    ? await (this.game.requestDecision({
        kind: "chain_response",
        actor: player,
        candidates: activatable,
        ...createChainResponseDecisionAdapter(this.game, activatable),
        contextSnapshot: {
          type: context?.type || null,
          chainId: this.activeChainId ?? null,
          respondingToLinkId: this.getLastChainLink?.()?.linkId ?? null,
        },
        resolveHuman,
      }) as ChainMaybePromise<ChainActivationCandidate | null>)
    : await resolveHuman();

  return chosenOption ?? null;
}
