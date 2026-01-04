/**
 * Resource Actions - draw, heal, damage
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

/**
 * Apply draw action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @returns {boolean} Whether cards were drawn
 */
export function applyDraw(action, ctx) {
  const targetPlayer = action.player === "opponent" ? ctx.opponent : ctx.player;
  const amount = action.amount ?? 1;
  if (this.game && typeof this.game.drawCards === "function") {
    const result = this.game.drawCards(targetPlayer, amount);
    if (ctx && result && Array.isArray(result.drawn)) {
      ctx.lastDrawnCards = result.drawn.slice();
    }
    return result?.ok || (result?.drawn?.length || 0) > 0;
  }

  for (let i = 0; i < amount; i++) {
    targetPlayer.draw();
  }
  return amount > 0;
}

/**
 * Apply heal action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @returns {boolean} Whether LP was gained
 */
export function applyHeal(action, ctx) {
  const targetPlayer = action.player === "opponent" ? ctx.opponent : ctx.player;
  const amount = action.amount ?? 0;

  // LP gain multiplier is now handled by Player.gainLP() based on passive effects
  targetPlayer.gainLP(amount);
  return amount !== 0;
}

/**
 * Apply heal per archetype monster action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @returns {boolean} Whether LP was gained
 */
export function applyHealPerArchetypeMonster(action, ctx) {
  const targetPlayer = action.player === "opponent" ? ctx.opponent : ctx.player;
  const archetype = action.archetype;
  const amountPerMonster = action.amountPerMonster ?? 0;

  if (!targetPlayer || amountPerMonster <= 0 || !archetype) return false;

  const count = (targetPlayer.field || []).reduce((acc, card) => {
    if (!card || card.cardKind !== "monster" || card.isFacedown) return acc;
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
      ? [card.archetype]
      : [];
    return archetypes.includes(archetype) ? acc + 1 : acc;
  }, 0);

  const totalHeal = count * amountPerMonster;
  if (totalHeal > 0) {
    targetPlayer.gainLP(totalHeal);
    console.log(
      `${targetPlayer.id} gained ${totalHeal} LP from ${count} ${archetype} monster(s).`
    );
    return true;
  }

  return false;
}

/**
 * Apply damage action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @returns {boolean} Whether damage was dealt
 */
export function applyDamage(action, ctx) {
  const targetPlayer = action.player === "self" ? ctx.player : ctx.opponent;
  const amount = action.amount ?? 0;

  // Apply damage to LP only if not in trigger-only mode
  // (inflictDamage from Game already applied the damage)
  if (!action.triggerOnly) {
    targetPlayer.takeDamage(amount);
  }

  // Trigger effects that care about opponent losing LP
  if (amount > 0 && this.game) {
    const damaged =
      targetPlayer.id === "player" ? this.game.player : this.game.bot;
    const other = damaged.id === "player" ? this.game.bot : this.game.player;

    // Check field cards (including spellTrap zone for continuous spells)
    const fieldCards = [
      ...(other.field || []),
      ...(other.spellTrap || []).filter((c) => c && c.subtype === "continuous"),
    ].filter(Boolean);

    for (const card of fieldCards) {
      if (!card?.effects) continue;

      for (const effect of card.effects) {
        if (effect.timing !== "on_event" || effect.event !== "opponent_damage")
          continue;

        const optCheck = this.checkOncePerTurn(card, other, effect);
        if (!optCheck.ok) {
          console.log(optCheck.reason);
          continue;
        }

        const ctx2 = {
          source: card,
          player: other,
          opponent: damaged,
          damageAmount: amount, // Pass damage amount for counter calculation
        };

        // Apply the actual effect actions instead of hardcoding draw
        this.applyActions(effect.actions || [], ctx2, {});
        this.registerOncePerTurnUsage(card, other, effect);

        if (this.game && typeof this.game.updateBoard === "function") {
          this.game.updateBoard();
        }
      }
    }
  }

  return amount !== 0;
}
