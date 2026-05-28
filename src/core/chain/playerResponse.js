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

  // Use existing trap offering system or create new modal
  try {
    if (typeof ui.showChainResponseModal === "function") {
      const timeoutMs = 30000;
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      });
      chosenOption = await Promise.race([
        ui.showChainResponseModal(activatable, context, this.chainStack),
        timeoutPromise,
      ]);
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

  // If player chose a card, get target selections if needed
  if (chosenOption) {
    const selections = await this.getPlayerSelectionsForEffect(
      chosenOption.card,
      chosenOption.effect,
      player,
      context,
    );

    if (
      selections === null &&
      this.effectRequiresTargets(chosenOption.effect)
    ) {
      // Player cancelled target selection, treat as pass
      this.log("Player cancelled target selection");
      return null;
    }

    // Emitir evento para captura de replay
    this.game?.emit?.("chain_response", {
      player,
      responded: true,
      card: chosenOption.card,
      chainLength: this.chainStack?.length || 0,
      triggerCard: context?.card || null,
    });

    return { ...chosenOption, selections };
  }

  // Emitir evento para captura de replay (jogador passou)
  this.game?.emit?.("chain_response", {
    player,
    responded: false,
    card: null,
    chainLength: this.chainStack?.length || 0,
    triggerCard: context?.card || null,
  });

  return null;
}
