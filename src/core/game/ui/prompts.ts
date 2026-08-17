// ─────────────────────────────────────────────────────────────────────────────
import type Card from "../../Card.js";
import type Player from "../../Player.js";
import type { BattlePosition, BattlePositionInput } from "../../contracts/cards.js";

interface SummonPositionHost {
  effectEngine?: {
    chooseSpecialSummonPosition(
      card: Card | null,
      player: Player,
      options: SummonPositionOptions,
    ): Promise<BattlePosition>;
  };
}

interface SummonPositionOptions {
  position?: BattlePositionInput;
}

// src/core/game/ui/prompts.js
// User prompt/choice methods for Game class — B.10 extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WRAPPER for unified Special Summon position resolver.
 * Delegates to EffectEngine.chooseSpecialSummonPosition for consistent behavior.
 *
 * @param player - Player summoning the card
 * @param card - Card being summoned (optional)
 * @param options - Position options (position: undefined/"choice"/"attack"/"defense")
 * @returns {Promise<string>} - Resolved position ('attack' or 'defense')
 */
export function chooseSpecialSummonPosition(
  this: SummonPositionHost,
  player: Player,
  card: Card | null = null,
  options: SummonPositionOptions = {},
): Promise<BattlePosition> {
  if (
    this.effectEngine &&
    typeof this.effectEngine.chooseSpecialSummonPosition === "function"
  ) {
    return this.effectEngine.chooseSpecialSummonPosition(card, player, options);
  }

  // Fallback if EffectEngine not available
  const actionPosition = options.position;
  if (actionPosition === "attack" || actionPosition === "defense") {
    return Promise.resolve(actionPosition);
  }
  // AI defaults to "attack", human also defaults to "attack" in this fallback
  return Promise.resolve("attack");
}
