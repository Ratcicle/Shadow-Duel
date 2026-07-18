import { isAI } from "../Player.js";

/**
 * Human player choosing chain response via UI
 * @param {Object} player
 * @param {Array} activatable
 * @param {ChainContext} context
 * @returns {Promise<Object|null>}
 */
export async function playerChooseChainResponse(player, activatable, context) {
  // 🔧 CRITICAL FIX: Don't show prompts to AI/bots - they should auto-pass
  if (isAI(player)) {
    this.log(`Player ${player.id} is AI - auto-passing chain response`);
    return null;
  }

  const ui = this.getUI();

  if (!ui) {
    this.log("No UI available for player response");
    return null;
  }

  let chosenOption = null;
  const autoPassByMouseHold =
    typeof ui.isLeftMouseHeldForChainSkip === "function" &&
    ui.isLeftMouseHeldForChainSkip() === true;

  // Use existing trap offering system or create new modal
  try {
    if (autoPassByMouseHold) {
      this.log("Left mouse button held - auto-passing chain response");
    } else if (typeof ui.showChainResponseModal === "function") {
      this.activeResponseAbortController?.abort?.("response_replaced");
      const controller = new AbortController();
      this.activeResponseAbortController = controller;
      const timeoutMs = Number.isFinite(this.responseTimeoutMs)
        ? Math.max(0, this.responseTimeoutMs)
        : 30000;
      const timeoutId = setTimeout(() => {
        controller.abort("response_timeout");
      }, timeoutMs);
      try {
        const resolveHuman = () => ui.showChainResponseModal(
          activatable,
          context,
          this.getChainSummary?.() || [],
          { signal: controller.signal },
        );
        chosenOption = typeof this.game?.requestDecision === "function"
          ? await this.game.requestDecision({
              kind: "chain_response",
              actor: player,
              candidates: activatable,
              contextSnapshot: {
                type: context?.type || null,
                chainId: this.activeChainId ?? null,
                respondingToLinkId: this.getLastChainLink?.()?.linkId ?? null,
              },
              resolveHuman,
            })
          : await resolveHuman();
      } finally {
        clearTimeout(timeoutId);
        if (this.activeResponseAbortController === controller) {
          this.activeResponseAbortController = null;
        }
      }
    } else if (typeof ui.offerTrapActivation === "function") {
      const cards = activatable.map((a) => a.card);
      const result = await ui.offerTrapActivation(
        cards,
        `Respond to ${context?.type || "action"}?`,
      );

      if (result && result.card) {
        chosenOption =
          activatable.find((a) => a.card === result.card) || null;
      }
    }
  } catch (error) {
    console.error("[ChainSystem] playerChooseChainResponse failed:", error);
    chosenOption = null;
  }

  // Phase 4: choosing a response selects only the effect. Cost and target
  // selections belong to the canonical activation transaction.
  if (chosenOption) {
    return chosenOption;
  }

  return null;
}
