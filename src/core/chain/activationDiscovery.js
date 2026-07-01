import {
  canActivateQuickSpellFromHand,
  canActivateSetQuickSpell,
  isQuickSpell,
} from "../game/spellTrap/quickSpellRules.js";

function buildQuickSpellChainContext(chainSystem, context, effect, activationZone) {
  const lastLink = chainSystem.getLastChainLink?.();
  return {
    ...(context || {}),
    activationZone,
    effect,
    chainWindowOpen: chainSystem.isChainWindowOpen?.() === true || !!context,
    isChainWindow:
      context?.type !== "main_phase_action" ||
      chainSystem.isChainWindowOpen?.() === true,
    requiredSpellSpeed: chainSystem.getRequiredSpellSpeed?.(context),
    respondingToSpellSpeed: lastLink
      ? chainSystem.getEffectSpellSpeed?.(lastLink.effect, lastLink.card)
      : undefined,
    lastSpellSpeed: lastLink
      ? chainSystem.getEffectSpellSpeed?.(lastLink.effect, lastLink.card)
      : undefined,
  };
}

function buildTrapPlacementOnlyEffect(card) {
  return {
    id: `${card?.id || "trap"}_placement_only_activation`,
    timing: "on_activate",
    speed: 2,
    placementOnly: true,
    actions: [],
  };
}

function canUseTrapPlacementOnlyActivation(card) {
  if (!card || card.cardKind !== "trap" || card.subtype !== "continuous") {
    return false;
  }
  return !(card.effects || []).some(
    (effect) => effect && effect.timing === "on_activate",
  );
}

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
      const responseEffect =
        effect || (canUseTrapPlacementOnlyActivation(card)
          ? buildTrapPlacementOnlyEffect(card)
          : null);
      if (responseEffect) {
        const responseContext =
          this.getEffectChainResponseContext?.(responseEffect, context) ||
          context;
        if (!this.canOfferEffectInChainContext(responseEffect, responseContext))
          continue;
        console.log(
          `[getActivatableCardsInChain] Found effect for ${card.name}:`,
          responseEffect.id,
        );
        const chainCheck = this.canActivateInChain(
          responseEffect,
          card,
          responseContext,
        );
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
          activatable.push({
            card,
            effect: responseEffect,
            zone: "spellTrap",
            context: responseContext,
          });
        }
      } else {
        console.log(
          `[getActivatableCardsInChain] No activatable effect found for ${card.name}`,
        );
      }
    }
  }

  // Check set Quick Spells in spellTrap zone
  if (Array.isArray(player.spellTrap)) {
    for (const card of player.spellTrap) {
      if (!card || card.cardKind !== "spell") continue;
      if (!isQuickSpell(card)) continue;
      if (!card.isFacedown) continue; // Must be set

      if (cardsInChain.has(card)) continue;

      const effect = this.findActivatableEffect(card, context, player);
      if (effect) {
        const responseContext =
          this.getEffectChainResponseContext?.(effect, context) || context;
        if (!this.canOfferEffectInChainContext(effect, responseContext)) continue;
        const quickSpellContext = buildQuickSpellChainContext(
          this,
          responseContext,
          effect,
          "spellTrap",
        );
        const quickCheck = canActivateSetQuickSpell(
          this.game,
          card,
          player,
          quickSpellContext,
        );
        if (!quickCheck.ok) continue;
        const chainCheck = this.canActivateInChain(effect, card, responseContext);
        if (chainCheck.ok) {
          activatable.push({ card, effect, zone: "spellTrap", context: responseContext });
        }
      }
    }
  }

  // Check Quick Spells in hand. They require a legal chain/window context and
  // can never be activated from hand during the opponent's turn.
  if (Array.isArray(player.hand)) {
    for (const card of player.hand) {
      if (!card || card.cardKind !== "spell") continue;
      if (!isQuickSpell(card)) continue;

      // Skip cards already in the current chain
      if (cardsInChain.has(card)) continue;

      const effect = this.findActivatableEffect(card, context, player);
      if (effect) {
        const responseContext =
          this.getEffectChainResponseContext?.(effect, context) || context;
        if (!this.canOfferEffectInChainContext(effect, responseContext)) continue;
        const quickSpellContext = buildQuickSpellChainContext(
          this,
          responseContext,
          effect,
          "hand",
        );
        const quickCheck = canActivateQuickSpellFromHand(
          this.game,
          card,
          player,
          quickSpellContext,
        );
        if (!quickCheck.ok) continue;
        const chainCheck = this.canActivateInChain(effect, card, responseContext);
        if (chainCheck.ok) {
          activatable.push({ card, effect, zone: "hand", context: responseContext });
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
        const responseContext =
          this.getEffectChainResponseContext?.(effect, context) || context;
        if (!this.canOfferEffectInChainContext(effect, responseContext)) continue;
        const chainCheck = this.canActivateInChain(effect, card, responseContext);
        if (chainCheck.ok) {
          activatable.push({ card, effect, zone: "field", context: responseContext });
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
