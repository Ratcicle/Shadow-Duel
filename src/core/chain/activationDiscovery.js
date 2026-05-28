/**
 * Get all cards a player can activate in current chain context
 * @param {Object} player - The player to check
 * @param {ChainContext} context - Current chain context
 * @returns {Array<{card: Object, effect: Object, zone: string}>}
 */
export function getActivatableCardsInChain(player, context) {
  if (!player || !this.game) return [];

  const activatable = [];
  const effectEngine = this.game.effectEngine;

  // Build a set of cards already in the current chain (to prevent offering them again)
  const cardsInChain = new Set();
  if (Array.isArray(this.chainStack)) {
    for (const link of this.chainStack) {
      if (link?.card) {
        cardsInChain.add(link.card);
      }
    }
  }
  // Also include cards currently being resolved (they've been popped from chainStack)
  if (this.cardsBeingResolved) {
    for (const card of this.cardsBeingResolved) {
      cardsInChain.add(card);
    }
  }

  // Check set Trap cards in spellTrap zone
  if (Array.isArray(player.spellTrap)) {
    for (const card of player.spellTrap) {
      if (!card || card.cardKind !== "trap") continue;
      if (!card.isFacedown) continue; // Must be set

      // Skip cards already in the current chain or being resolved
      if (cardsInChain.has(card)) continue;

      // Check if trap can be activated (was set before this turn)
      // Support both setTurn and turnSetOn properties
      const setTurn = card.setTurn ?? card.turnSetOn ?? null;
      if (setTurn === null || setTurn >= this.game.turnCounter) {
        console.log(
          `[getActivatableCardsInChain] ${card.name}: cannot activate yet (setTurn=${setTurn}, currentTurn=${this.game.turnCounter})`,
        );
        continue;
      }

      console.log(
        `[getActivatableCardsInChain] Checking trap ${card.name} for context ${context?.type}`,
      );

      const effect = this.findActivatableEffect(card, context, player);
      if (effect) {
        if (!this.canOfferEffectInChainContext(effect, context)) continue;
        console.log(
          `[getActivatableCardsInChain] Found effect for ${card.name}:`,
          effect.id,
        );
        const chainCheck = this.canActivateInChain(effect, card, context);
        console.log(
          `[getActivatableCardsInChain] Chain check for ${card.name}:`,
          chainCheck,
        );
        if (chainCheck.ok) {
          // Skip the canActivate check for traps - it's only meant for spells
          // Traps have their own validation in findActivatableEffect
          console.log(
            `[getActivatableCardsInChain] ${card.name} is ACTIVATABLE`,
          );
          activatable.push({ card, effect, zone: "spellTrap" });
        }
      } else {
        console.log(
          `[getActivatableCardsInChain] No activatable effect found for ${card.name}`,
        );
      }
    }
  }

  // Check set Quick-Play Spells in spellTrap zone
  if (Array.isArray(player.spellTrap)) {
    for (const card of player.spellTrap) {
      if (!card || card.cardKind !== "spell") continue;
      if (card.subtype !== "quick") continue;
      if (!card.isFacedown) continue; // Must be set

      if (cardsInChain.has(card)) continue;

      const setTurn = card.setTurn ?? card.turnSetOn ?? null;
      if (setTurn === null || setTurn >= this.game.turnCounter) {
        continue;
      }

      const effect = this.findActivatableEffect(card, context, player);
      if (effect) {
        if (!this.canOfferEffectInChainContext(effect, context)) continue;
        const chainCheck = this.canActivateInChain(effect, card, context);
        if (chainCheck.ok) {
          const useMainPhaseRules = context?.type === "main_phase_action";
          if (useMainPhaseRules) {
            const canActivate = this.game.effectEngine?.canActivate?.(
              card,
              player,
            );
            if (canActivate && canActivate.ok === false) continue;
          }
          activatable.push({ card, effect, zone: "spellTrap" });
        }
      }
    }
  }

  // Check Quick-Play Spells in hand
  // Quick-Play can be activated FROM HAND only:
  // - During your own Main Phase (like a normal spell)
  // - NOT during opponent's turn (must be set on field first)
  // Note: Once set on field, they can be activated as Speed 2 during opponent's turn
  if (Array.isArray(player.hand)) {
    for (const card of player.hand) {
      if (!card || card.cardKind !== "spell") continue;
      if (card.subtype !== "quick") continue;

      // Skip cards already in the current chain
      if (cardsInChain.has(card)) continue;

      // CRITICAL: Quick-Play Spells can only be activated from hand during YOUR OWN turn
      const isPlayerTurn = this.game?.turn === player.id;
      if (!isPlayerTurn) {
        // Quick spells in hand cannot be activated during opponent's turn
        continue;
      }

      const effect = this.findActivatableEffect(card, context, player);
      if (effect) {
        if (!this.canOfferEffectInChainContext(effect, context)) continue;
        const chainCheck = this.canActivateInChain(effect, card, context);
        if (chainCheck.ok) {
          const useMainPhaseRules = context?.type === "main_phase_action";
          if (useMainPhaseRules) {
            const canActivate = this.game.effectEngine?.canActivate?.(
              card,
              player,
            );
            if (canActivate && canActivate.ok === false) continue;
          }
          activatable.push({ card, effect, zone: "hand" });
        }
      }
    }
  }

  // Check monster quick effects on field
  if (Array.isArray(player.field)) {
    for (const card of player.field) {
      if (!card || card.cardKind !== "monster") continue;
      if (card.isFacedown) continue;

      // Skip cards already in the current chain
      if (cardsInChain.has(card)) continue;

      const effect = this.findQuickMonsterEffect(card, context, player);
      if (effect) {
        if (!this.canOfferEffectInChainContext(effect, context)) continue;
        const chainCheck = this.canActivateInChain(effect, card, context);
        if (chainCheck.ok) {
          activatable.push({ card, effect, zone: "field" });
        }
      }
    }
  }

  // Only log when there are activatable cards (reduce log noise)
  if (activatable.length > 0) {
    this.log(
      `Found ${activatable.length} activatable cards for ${player.id} in ${context?.type} context`,
    );
  }

  return activatable;
}
