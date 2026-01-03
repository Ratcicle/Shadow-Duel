/**
 * Combat damage application - centralized damage infliction.
 * Extracted from Game.js as part of B.5 modularization.
 */

/**
 * Apply damage to a player through the centralized damage pipeline.
 * Triggers opponent_damage effects via EffectEngine.
 * Should be used instead of direct player.takeDamage() calls.
 *
 * @param {Object} player - Player taking damage
 * @param {number} amount - Damage amount
 * @param {Object} options - Additional context (cause, sourceCard, etc.)
 */
export function inflictDamage(player, amount, options = {}) {
  if (!player || !amount || amount <= 0) return;

  // Apply the damage to player LP
  player.takeDamage(amount);

  // Trigger opponent_damage effects via EffectEngine
  if (
    this.effectEngine &&
    typeof this.effectEngine.applyDamage === "function"
  ) {
    const opponent = player === this.player ? this.bot : this.player;
    const ctx = {
      player: opponent, // The one whose effects will trigger
      opponent: player, // The one taking damage
      source: options.sourceCard || null,
    };
    const action = {
      type: "damage",
      player: "opponent", // From opponent's perspective
      amount: amount,
      triggerOnly: true, // Don't apply damage again, just trigger effects
    };

    // This will trigger all opponent_damage effects
    this.effectEngine.applyDamage(action, ctx);
  }
}
