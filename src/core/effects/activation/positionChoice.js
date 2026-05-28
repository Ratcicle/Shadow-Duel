import { isAI } from "../../Player.js";

/**
 * UNIFIED SPECIAL SUMMON POSITION RESOLVER
 * Implements strict semantics for position selection in all Special Summon paths.
 *
 * Semantics:
 * - position undefined or null => treat as "choice" (player modal, bot defaults to "attack")
 * - position === "choice" => allow choice (player modal, bot defaults to "attack")
 * - position === "attack" or "defense" => FORCED position (no modal, no override)
 *
 * @param {Object} card - Card being summoned
 * @param {Object} player - Player summoning the card
 * @param {Object} options - Additional options
 * @param {string} options.position - Explicit position from action: undefined/"choice"/"attack"/"defense"
 * @returns {Promise<string>} - Resolved position ('attack' or 'defense')
 */
export async function chooseSpecialSummonPosition(card, player, options = {}) {
  const actionPosition = options.position;

  // Determine if position is forced or allows choice
  const isForced = actionPosition === "attack" || actionPosition === "defense";
  const allowsChoice = !actionPosition || actionPosition === "choice";

  // FORCED POSITION: return immediately without modal
  if (isForced) {
    this.game?.devLog?.("SS_POSITION", {
      summary: `Forced position ${actionPosition} for ${
        card?.name || "unknown"
      }`,
      player: player?.id,
      card: card?.name,
      actionPosition,
      forced: true,
    });
    this.game?.notify?.("position_chosen", {
      card,
      player,
      position: actionPosition,
      context: "special_summon",
      turn: this.game?.turnCounter,
      phase: this.game?.phase,
    });
    return actionPosition;
  }

  // CHOICE ALLOWED: delegate to the bot's strategy if it provides a hook,
  // otherwise default to "attack". Each archetype owns its own positioning
  // policy; this method must not impose a global heuristic.
  if (isAI(player)) {
    const strategy = player?.strategy;
    let chosen = "attack";
    if (strategy && typeof strategy.chooseSpecialSummonPosition === "function") {
      const fromStrategy = strategy.chooseSpecialSummonPosition(card, {
        game: this.game,
        player,
        actionPosition,
      });
      if (fromStrategy === "attack" || fromStrategy === "defense") {
        chosen = fromStrategy;
      }
    }
    this.game?.devLog?.("SS_POSITION", {
      summary: `Bot chose ${chosen} for ${card?.name || "unknown"}`,
      player: player?.id,
      card: card?.name,
      actionPosition,
      allowsChoice: true,
      viaStrategy: !!strategy?.chooseSpecialSummonPosition,
    });
    this.game?.notify?.("position_chosen", {
      card,
      player,
      position: chosen,
      context: "special_summon",
      turn: this.game?.turnCounter,
      phase: this.game?.phase,
    });
    return chosen;
  }

  // Player gets modal for position choice
  if (this.ui && typeof this.ui.showSpecialSummonPositionModal === "function") {
    return new Promise((resolve) => {
      this.ui.showSpecialSummonPositionModal(card, (choice) => {
        const resolved = choice === "defense" ? "defense" : "attack";
        this.game?.devLog?.("SS_POSITION", {
          summary: `Player chose ${resolved} for ${card?.name || "unknown"}`,
          player: player?.id,
          card: card?.name,
          actionPosition,
          playerChoice: choice,
        });

        // Emit informational event for replay capture (non-blocking)
        this.game?.notify?.("position_chosen", {
          card,
          player,
          position: resolved,
          context: "special_summon",
          turn: this.game?.turnCounter,
          phase: this.game?.phase,
        });

        resolve(resolved);
      });
    });
  }

  // Fallback: default to "attack" if no UI available (offline only)
  this.game?.devLog?.("SS_POSITION", {
    summary: `Fallback to attack for ${card?.name || "unknown"} (no UI)`,
    player: player?.id,
    card: card?.name,
    actionPosition,
    fallback: true,
  });
  this.game?.notify?.("position_chosen", {
    card,
    player,
    position: "attack",
    context: "special_summon",
    turn: this.game?.turnCounter,
    phase: this.game?.phase,
  });
  return "attack";
}
