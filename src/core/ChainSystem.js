/**
 * ChainSystem.js
 *
 * Sistema de Chain e Spell Speed para Shadow Duel.
 * Gerencia chain windows, validação de spell speed, e resolução de chains em ordem LIFO.
 *
 * Spell Speed Rules:
 * - Speed 1: Normal Spells, Ignition Effects (only during own Main Phase)
 * - Speed 2: Quick-Play Spells, Normal Traps, Continuous Traps, Quick Effects
 * - Speed 3: Counter Traps (can respond to anything, including Speed 2)
 *
 * Chain Resolution: Last In, First Out (LIFO)
 */

import { isAI } from "./Player.js";

/**
 * Valid chain window contexts where cards can be activated in response
 */
export const CHAIN_CONTEXTS = {
  card_activation: {
    description: "In response to another card's activation",
    allowedSpeeds: [2, 3],
    requiresChainWindow: false,
  },

  attack_declaration: {
    description: "When an attack is declared",
    allowedSpeeds: [2, 3],
    requiresChainWindow: true,
  },

  summon: {
    description: "When a monster is summoned",
    allowedSpeeds: [2, 3],
    requiresChainWindow: true,
  },

  phase_change: {
    description: "During phase transition",
    allowedSpeeds: [2, 3],
    requiresChainWindow: true,
  },

  main_phase_action: {
    description: "During own Main Phase (quick action)",
    allowedSpeeds: [1, 2, 3],
    requiresChainWindow: false,
  },

  battle_damage: {
    description: "When battle damage is about to be inflicted",
    allowedSpeeds: [2, 3],
    requiresChainWindow: true,
  },

  effect_activation: {
    description: "In response to a monster effect activation",
    allowedSpeeds: [2, 3],
    requiresChainWindow: false,
  },

  effect_targeted: {
    description: "When a card effect targets your card",
    allowedSpeeds: [2, 3],
    requiresChainWindow: true,
  },
};

/**
 * @typedef {Object} ChainLink
 * @property {Object} card - The card being activated
 * @property {Object} player - The player activating the card
 * @property {Object} effect - The effect being activated
 * @property {Object} context - Activation context
 * @property {string} zone - Zone the card was activated from (hand, field, spellTrap, graveyard)
 * @property {Object|null} selections - Selected targets (if any)
 * @property {number} chainLevel - Position in chain (1, 2, 3...)
 */

/**
 * @typedef {Object} ChainContext
 * @property {string} type - Context type (from CHAIN_CONTEXTS)
 * @property {Object} [card] - Card that triggered the chain window
 * @property {Object} [player] - Player who triggered the chain window
 * @property {Object} [triggerPlayer] - Player whose action triggered this
 * @property {Object} [attacker] - Attacking monster (for attack_declaration)
 * @property {Object} [target] - Attack target (for attack_declaration)
 * @property {string} [fromPhase] - Previous phase (for phase_change)
 * @property {string} [toPhase] - New phase (for phase_change)
 * @property {string} [method] - Summon method (for summon)
 */

/**
 * Helper to determine if an action was performed by the opponent
 * relative to a card's owner. Checks both explicit flag and owner ID comparison.
 * @param {string|null} actionOwnerId - ID of the player who performed the action
 * @param {string|null} cardOwnerId - ID of the card's owner
 * @param {boolean} isOpponentFlag - Explicit flag indicating opponent action
 * @returns {boolean} True if action was by opponent
 */
function isOpponentAction(actionOwnerId, cardOwnerId, isOpponentFlag) {
  if (isOpponentFlag === true) return true;
  if (!actionOwnerId || !cardOwnerId) return false;
  return actionOwnerId !== cardOwnerId;
}

export default class ChainSystem {
  constructor(game) {
    /** @type {Object} Reference to main Game instance */
    this.game = game;

    /** @type {boolean} Whether a chain window is currently open */
    this.chainWindowOpen = false;

    /** @type {ChainContext|null} Current chain window context */
    this.chainWindowContext = null;

    /** @type {ChainLink[]} Stack of chain links (resolved LIFO) */
    this.chainStack = [];

    /** @type {boolean} Whether chain is currently resolving */
    this.isResolving = false;

    /** @type {Set<Object>} Cards currently being resolved (to prevent re-offering) */
    this.cardsBeingResolved = new Set();

    /** @type {number} Current chain level counter */
    this.currentChainLevel = 0;

    /** @type {boolean} Dev mode logging */
    this.devMode =
      typeof localStorage !== "undefined" &&
      localStorage.getItem("shadow_duel_dev_mode") === "true";
  }

  /**
   * Log message if dev mode is enabled
   * @param {...any} args - Arguments to log
   */
  log(...args) {
    if (this.devMode) {
      console.log("[ChainSystem]", ...args);
    }
  }

  /**
   * Get the UI reference from game
   * @returns {Object|null}
   */
  getUI() {
    return this.game?.ui || this.game?.renderer || null;
  }

  /**
   * Get the opponent of a player
   * @param {Object} player
   * @returns {Object}
   */
  getOpponent(player) {
    if (!this.game) return null;
    return player === this.game.player ? this.game.bot : this.game.player;
  }

  /**
   * Get the current turn player
   * @returns {Object}
   */
  getCurrentTurnPlayer() {
    if (!this.game) return null;
    return this.game.turn === "player" ? this.game.player : this.game.bot;
  }

  /**
   * Get the non-turn player
   * @returns {Object}
   */
  getNonTurnPlayer() {
    if (!this.game) return null;
    return this.game.turn === "player" ? this.game.bot : this.game.player;
  }

  // ============================================================
  // SPELL SPEED VALIDATION
  // ============================================================

  /**
   * Get the spell speed of an effect
   * @param {Object} effect - The effect to check
   * @param {Object} card - The card containing the effect
   * @returns {number} Spell speed (1, 2, or 3)
   */
  getEffectSpellSpeed(effect, card) {
    // Explicit speed on effect takes priority
    if (effect?.speed !== undefined) {
      return effect.speed;
    }

    // Infer from card type
    if (card?.cardKind === "trap") {
      if (card.subtype === "counter") {
        return 3; // Counter Traps are Speed 3
      }
      return 2; // Normal and Continuous Traps are Speed 2
    }

    if (card?.cardKind === "spell") {
      if (card.subtype === "quick") {
        return 2; // Quick-Play Spells are Speed 2
      }
      return 1; // Normal, Continuous, Field, Equip Spells are Speed 1
    }

    // Monster effects
    if (card?.cardKind === "monster") {
      // Quick effects are Speed 2, others are Speed 1
      if (effect?.isQuickEffect) {
        return 2;
      }
      return 1;
    }

    return 1; // Default to Speed 1
  }

  /**
   * Get the minimum required spell speed to respond in current chain
   * @param {ChainContext} context - Current chain context
   * @returns {number} Minimum required spell speed
   */
  getRequiredSpellSpeed(context) {
    // If chain is empty (Chain Link 1)
    if (this.chainStack.length === 0) {
      // During own Main Phase, Speed 1 is allowed
      if (context?.type === "main_phase_action") {
        return 1;
      }
      // Otherwise, need at least Speed 2
      return 2;
    }

    // Chain Link 2+: Must be at least Speed 2 to chain
    // AND must match or exceed last card's speed
    const lastLink = this.chainStack[this.chainStack.length - 1];
    const lastSpeed = this.getEffectSpellSpeed(lastLink.effect, lastLink.card);

    // Minimum Speed 2 for any chain response (Speed 1 cannot respond)
    return Math.max(2, lastSpeed);
  }

  /**
   * Check if an effect can be activated in current chain context
   * @param {Object} effect - Effect to check
   * @param {Object} card - Card containing the effect
   * @param {ChainContext} context - Current chain context
   * @returns {{ok: boolean, reason?: string}}
   */
  canActivateInChain(effect, card, context) {
    if (!effect || !card) {
      return { ok: false, reason: "Missing effect or card." };
    }

    const effectSpeed = this.getEffectSpellSpeed(effect, card);
    const requiredSpeed = this.getRequiredSpellSpeed(context);

    // Check spell speed requirement
    if (effectSpeed < requiredSpeed) {
      return {
        ok: false,
        reason: `Spell Speed ${effectSpeed} cannot respond to Spell Speed ${requiredSpeed}.`,
      };
    }

    // Check if context allows this speed
    const contextDef = CHAIN_CONTEXTS[context?.type];
    if (contextDef && !contextDef.allowedSpeeds.includes(effectSpeed)) {
      return {
        ok: false,
        reason: `Spell Speed ${effectSpeed} not allowed in ${context?.type} context.`,
      };
    }

    // Check if effect has specific chain response requirements
    if (effect.canRespondTo && Array.isArray(effect.canRespondTo)) {
      if (!effect.canRespondTo.includes(context?.type)) {
        return {
          ok: false,
          reason: `Effect can only respond to: ${effect.canRespondTo.join(
            ", "
          )}`,
        };
      }
    }

    return { ok: true };
  }

  // ============================================================
  // ACTIVATABLE CARDS FILTERING
  // ============================================================

  /**
   * Get all cards a player can activate in current chain context
   * @param {Object} player - The player to check
   * @param {ChainContext} context - Current chain context
   * @returns {Array<{card: Object, effect: Object, zone: string}>}
   */
  getActivatableCardsInChain(player, context) {
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
            `[getActivatableCardsInChain] ${card.name}: cannot activate yet (setTurn=${setTurn}, currentTurn=${this.game.turnCounter})`
          );
          continue;
        }

        console.log(
          `[getActivatableCardsInChain] Checking trap ${card.name} for context ${context?.type}`
        );

        const effect = this.findActivatableEffect(card, context, player);
        if (effect) {
          console.log(
            `[getActivatableCardsInChain] Found effect for ${card.name}:`,
            effect.id
          );
          const chainCheck = this.canActivateInChain(effect, card, context);
          console.log(
            `[getActivatableCardsInChain] Chain check for ${card.name}:`,
            chainCheck
          );
          if (chainCheck.ok) {
            // Skip the canActivate check for traps - it's only meant for spells
            // Traps have their own validation in findActivatableEffect
            console.log(
              `[getActivatableCardsInChain] ${card.name} is ACTIVATABLE`
            );
            activatable.push({ card, effect, zone: "spellTrap" });
          }
        } else {
          console.log(
            `[getActivatableCardsInChain] No activatable effect found for ${card.name}`
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
          const chainCheck = this.canActivateInChain(effect, card, context);
          if (chainCheck.ok) {
            const useMainPhaseRules = context?.type === "main_phase_action";
            if (useMainPhaseRules) {
              const canActivate = this.game.effectEngine?.canActivate?.(
                card,
                player
              );
              if (canActivate && canActivate.ok === false) continue;
            }
            activatable.push({ card, effect, zone: "spellTrap" });
          }
        }
      }
    }

    // Check Quick-Play Spells in hand
    // Quick-Play can be activated:
    // - During your own Main Phase (like a normal spell)
    // - During opponent's turn as a response
    // - In response to any chain (Speed 2)
    if (Array.isArray(player.hand)) {
      for (const card of player.hand) {
        if (!card || card.cardKind !== "spell") continue;
        if (card.subtype !== "quick") continue;

        // Skip cards already in the current chain
        if (cardsInChain.has(card)) continue;

        const effect = this.findActivatableEffect(card, context, player);
        if (effect) {
          const chainCheck = this.canActivateInChain(effect, card, context);
          if (chainCheck.ok) {
            const useMainPhaseRules = context?.type === "main_phase_action";
            if (useMainPhaseRules) {
              const canActivate = this.game.effectEngine?.canActivate?.(
                card,
                player
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

        const effect = this.findQuickMonsterEffect(card, context);
        if (effect) {
          const chainCheck = this.canActivateInChain(effect, card, context);
          if (chainCheck.ok) {
            // Apply canActivate check for consistency (same as traps)
            const canActivate = this.game.effectEngine?.canActivate?.(
              card,
              player
            );
            if (!canActivate || canActivate.ok !== false) {
              activatable.push({ card, effect, zone: "field" });
            }
          }
        }
      }
    }

    this.log(
      `Found ${activatable.length} activatable cards for ${player.id} in ${context?.type} context`
    );

    return activatable;
  }

  /**
   * Find an activatable effect on a card for the given context
   * @param {Object} card
   * @param {ChainContext} context
   * @returns {Object|null}
   */
  findActivatableEffect(card, context, ownerPlayer = null) {
    if (!card?.effects || !Array.isArray(card.effects)) return null;

    // Map context type back to event name
    const contextToEvent = {
      attack_declaration: "attack_declared",
      summon: "after_summon",
      phase_change: "phase_end",
      card_activation: "card_activation",
      effect_activation: "effect_activation",
      effect_targeted: "effect_targeted",
      battle_damage: "battle_damage",
    };
    const expectedEvent = contextToEvent[context?.type] || context?.event;

    for (const effect of card.effects) {
      if (!effect) continue;

      // For traps, look for on_activate, on_event, manual, or ignition timing
      if (card.cardKind === "trap") {
        // Check on_event effects (like Mirror Force)
        if (effect.timing === "on_event") {
          // Match the effect's event with the context
          if (effect.event === expectedEvent) {
            // Debug log for attack declaration traps
            if (context?.type === "attack_declaration") {
              console.log(
                `[findActivatableEffect] trap=${card.name} ctx attackers/defenders`,
                {
                  attacker: context.attacker?.name,
                  attackerOwner: context.attackerOwner?.id,
                  defender: context.defender?.name || context.target?.name,
                  defenderOwner:
                    context.defenderOwner?.id || context.targetOwner?.id,
                  cardOwner: ownerPlayer?.id || card.owner,
                  effectEvent: effect.event,
                  expectedEvent,
                }
              );
            }

            // Check additional conditions
            if (
              effect.requireOpponentAttack &&
              context?.type === "attack_declaration"
            ) {
              // Only valid if opponent is attacking (check from card owner's perspective)
              const cardOwnerId = ownerPlayer?.id || card.owner;
              if (
                !isOpponentAction(
                  context.attackerOwner?.id,
                  cardOwnerId,
                  context.isOpponentAttack
                )
              ) {
                continue;
              }
            }
            if (effect.requireOpponentSummon && context?.type === "summon") {
              // Only valid if opponent summoned (check from card owner's perspective)
              const cardOwnerId = ownerPlayer?.id || card.owner;
              if (
                !isOpponentAction(
                  context.player?.id,
                  cardOwnerId,
                  context.isOpponentSummon
                )
              ) {
                continue;
              }
            }
            // Check requireDefenderIsSelf (e.g., Dragon Spirit Sanctuary)
            if (
              effect.requireDefenderIsSelf &&
              context?.type === "attack_declaration"
            ) {
              // Use the checking player as owner fallback because some set traps may miss card.owner
              const inferredOwner =
                ownerPlayer ||
                (card.owner === "player"
                  ? this.game.player
                  : card.owner === "bot"
                  ? this.game.bot
                  : null);
              const ctxDefenderOwner =
                context.defenderOwner ||
                context.targetOwner ||
                (context.defender
                  ? context.defender.owner === "player"
                    ? this.game.player
                    : this.game.bot
                  : null);
              if (ctxDefenderOwner?.id !== inferredOwner?.id) {
                console.log(
                  `[findActivatableEffect] requireDefenderIsSelf mismatch for ${card.name}`,
                  {
                    inferredOwner: inferredOwner?.id,
                    ctxDefenderOwner: ctxDefenderOwner?.id,
                    defender: context.defender?.name || context.target?.name,
                  }
                );
                continue;
              }
            }
            // Check requireDefenderType (e.g., Dragon Spirit Sanctuary)
            if (
              effect.requireDefenderType &&
              context?.type === "attack_declaration"
            ) {
              const defender = context.defender || context.target;
              const requiredTypes = Array.isArray(effect.requireDefenderType)
                ? effect.requireDefenderType
                : [effect.requireDefenderType];
              const defenderTypeNorm = defender?.type
                ? String(defender.type).toLowerCase()
                : null;
              const requiredTypesNorm = requiredTypes.map((t) =>
                String(t).toLowerCase()
              );
              if (!defender || !requiredTypesNorm.includes(defenderTypeNorm)) {
                console.log(
                  `[findActivatableEffect] requireDefenderType mismatch for ${card.name}`,
                  {
                    defender: defender?.name,
                    defenderType: defender?.type,
                    requiredTypes,
                  }
                );
                continue;
              }
            }

            // Check if targets are available before allowing activation
            if (
              effect.targets &&
              effect.targets.length > 0 &&
              this.game?.effectEngine
            ) {
              const cardOwner =
                ownerPlayer ||
                (card.owner === "player"
                  ? this.game.player
                  : card.owner === "bot"
                  ? this.game.bot
                  : null);
              const ctx = {
                source: card,
                player: cardOwner,
                opponent:
                  card.owner === "player" ? this.game.bot : this.game.player,
                defender: context.defender || context.target,
                attacker: context.attacker,
                attackerOwner: context.attackerOwner,
                defenderOwner: context.defenderOwner,
                activationContext: {
                  autoSelectSingleTarget: true,
                  logTargets: true,
                },
              };

              console.log(
                `[findActivatableEffect] Checking targets for ${card.name}:`,
                {
                  defender: ctx.defender?.name,
                  defenderType: ctx.defender?.type,
                  targets: effect.targets.map((t) => ({
                    id: t.id,
                    targetFromContext: t.targetFromContext,
                    type: t.type,
                  })),
                }
              );

              const targetResult = this.game.effectEngine.resolveTargets(
                effect.targets,
                ctx,
                null
              );

              console.log(
                `[findActivatableEffect] Target result for ${card.name}:`,
                {
                  ok: targetResult.ok,
                  reason: targetResult.reason,
                  needsSelection: targetResult.needsSelection,
                }
              );

              if (targetResult.ok === false) {
                this.log(
                  `[findActivatableEffect] ${card.name}: targets not available - ${targetResult.reason}`
                );
                continue;
              }
            }

            return effect;
          }
          continue;
        }

        // Check on_activate, manual, ignition effects
        // These require a valid chain window context to activate
        if (
          effect.timing === "on_activate" ||
          effect.timing === "manual" ||
          effect.timing === "ignition"
        ) {
          // Only allow activation in appropriate contexts:
          // - on_activate: when setting or in response to specific events
          // - manual: only during phase_change/phase_end
          // - ignition: only during main phase actions
          const contextDef = CHAIN_CONTEXTS[context?.type];
          if (!contextDef) continue; // No valid context

          // manual timing only valid at phase_change
          if (effect.timing === "manual" && context?.type !== "phase_change") {
            continue;
          }

          // Check if targets are available before allowing activation
          if (
            effect.targets &&
            effect.targets.length > 0 &&
            this.game?.effectEngine
          ) {
            const cardOwner =
              card.owner === "player" ? this.game.player : this.game.bot;
            const ctx = {
              source: card,
              player: cardOwner,
              opponent:
                card.owner === "player" ? this.game.bot : this.game.player,
              activationContext: {
                autoSelectSingleTarget: true,
                logTargets: false,
              },
            };

            const targetResult = this.game.effectEngine.resolveTargets(
              effect.targets,
              ctx,
              null
            );

            if (targetResult.ok === false) {
              this.log(
                `[findActivatableEffect] ${card.name}: targets not available for on_activate - ${targetResult.reason}`
              );
              continue;
            }
          }

          // ignition timing typically for main phase, but traps can chain
          // Allow if we're in a valid chain window
          if (contextDef.requiresChainWindow || this.chainStack.length > 0) {
            return effect;
          }
        }
      }

      // For quick-play spells
      if (card.cardKind === "spell" && card.subtype === "quick") {
        if (
          effect.timing === "on_play" ||
          effect.timing === "on_activate" ||
          effect.timing === "ignition"
        ) {
          // Check if targets are available before allowing activation
          if (
            effect.targets &&
            effect.targets.length > 0 &&
            this.game?.effectEngine
          ) {
            const cardOwner =
              card.owner === "player" ? this.game.player : this.game.bot;
            const ctx = {
              source: card,
              player: cardOwner,
              opponent:
                card.owner === "player" ? this.game.bot : this.game.player,
              activationContext: {
                autoSelectSingleTarget: true,
                logTargets: false,
              },
            };

            const targetResult = this.game.effectEngine.resolveTargets(
              effect.targets,
              ctx,
              null
            );

            if (targetResult.ok === false) {
              this.log(
                `[findActivatableEffect] ${card.name}: targets not available for quick-play - ${targetResult.reason}`
              );
              continue;
            }
          }
          return effect;
        }
      }
    }

    return null;
  }

  /**
   * Find a quick effect on a monster
   * @param {Object} card
   * @param {ChainContext} context
   * @returns {Object|null}
   */
  findQuickMonsterEffect(card, context) {
    if (!card?.effects || !Array.isArray(card.effects)) return null;

    for (const effect of card.effects) {
      if (!effect) continue;

      if (effect.isQuickEffect || effect.speed === 2) {
        return effect;
      }
    }

    return null;
  }

  // ============================================================
  // CHAIN WINDOW MANAGEMENT
  // ============================================================

  /**
   * Open a chain window for responses
   * @param {ChainContext} context - Context that triggered the chain window
   * @returns {Promise<void>}
   */
  async openChainWindow(context) {
    if (!this.game || this.isResolving) {
      this.log("Cannot open chain window: game missing or chain resolving");
      return;
    }

    this.log(`Opening chain window: ${context?.type}`, context);

    this.chainWindowOpen = true;
    this.chainWindowContext = context;
    this.chainStack = [];
    this.currentChainLevel = 0;

    // If there's a triggering card/effect, add it as Chain Link 1
    if (context?.card && context?.effect && context?.player) {
      const triggerZone =
        context?.zone || this.determineCardZone(context.card, context.player);
      this.addToChain(
        context.card,
        context.player,
        context.effect,
        context,
        null,
        triggerZone
      );
    }

    // Determine priority order
    // Non-turn player gets first response opportunity
    const triggerPlayer = context?.triggerPlayer || this.getCurrentTurnPlayer();
    const respondingPlayer = this.getOpponent(triggerPlayer);

    // Offer response to non-trigger player first
    await this.offerChainResponses(respondingPlayer, triggerPlayer, context);

    // Resolve the chain
    await this.resolveChain();

    // Clean up
    this.chainWindowOpen = false;
    this.chainWindowContext = null;
    this.chainStack = [];
    this.currentChainLevel = 0;
    this.cardsBeingResolved.clear();
  }

  /**
   * Offer chain response opportunities to players
   * @param {Object} firstPlayer - First player to respond
   * @param {Object} secondPlayer - Second player to respond
   * @param {ChainContext} context
   */
  async offerChainResponses(firstPlayer, secondPlayer, context) {
    let consecutivePasses = 0;
    let currentResponder = firstPlayer;

    while (consecutivePasses < 2) {
      const response = await this.offerChainResponse(currentResponder, context);

      if (response) {
        // Player activated something, reset pass counter
        consecutivePasses = 0;

        // Add to chain with the zone from the response
        this.addToChain(
          response.card,
          currentResponder,
          response.effect,
          context,
          response.selections,
          response.zone
        );

        this.log(
          `${currentResponder.id} added ${response.card.name} to chain (Level ${this.currentChainLevel})`
        );
      } else {
        // Player passed
        consecutivePasses++;
        this.log(`${currentResponder.id} passed`);
      }

      // Switch responder
      currentResponder =
        currentResponder === firstPlayer ? secondPlayer : firstPlayer;
    }

    this.log(`Chain building complete with ${this.chainStack.length} links`);
  }

  /**
   * Offer a single chain response opportunity to a player
   * @param {Object} player
   * @param {ChainContext} context
   * @returns {Promise<{card: Object, effect: Object, selections: Object}|null>}
   */
  async offerChainResponse(player, context) {
    if (!player) return null;

    const activatable = this.getActivatableCardsInChain(player, context);

    if (activatable.length === 0) {
      this.log(`${player.id} has no activatable cards`);
      return null;
    }

    // AI logic - use controllerType instead of player.id to support online PvP
    if (isAI(player)) {
      return this.botChooseChainResponse(player, activatable, context);
    }

    // Human player - show UI
    return this.playerChooseChainResponse(player, activatable, context);
  }

  /**
   * Bot AI for choosing chain response
   * @param {Object} player
   * @param {Array} activatable
   * @param {ChainContext} context
   * @returns {Promise<Object|null>}
   */
  async botChooseChainResponse(player, activatable, context) {
    if (!activatable || activatable.length === 0) return null;

    const game = this.game;
    const opponent = this.getOpponent(player);

    // Evaluate each activatable card for strategic value
    const evaluatedOptions = activatable.map((option) => {
      let priority = 0;
      const card = option.card;
      const effect = option.effect;

      // Counter Traps: highest priority against important plays
      if (card.subtype === "counter" || effect?.speed === 3) {
        priority += 100;
      }

      // Mirror Force: High priority when opponent attacks with multiple monsters
      if (
        card.name === "Mirror Force" &&
        context?.type === "attack_declaration"
      ) {
        const opponentAttackMonsters =
          opponent?.field?.filter(
            (m) => m && !m.isFacedown && m.position === "attack"
          ).length || 0;
        priority += 50 + opponentAttackMonsters * 20;
      }

      // Call of the Haunted: Value based on graveyard monsters
      if (card.name === "Call of the Haunted") {
        const graveyardMonsters =
          player?.graveyard?.filter((c) => c.cardKind === "monster").length ||
          0;
        const bestMonsterAtk = Math.max(
          ...(player?.graveyard || [])
            .filter((c) => c.cardKind === "monster")
            .map((c) => c.atk || 0),
          0
        );
        priority +=
          30 +
          Math.min(graveyardMonsters * 5, 25) +
          Math.floor(bestMonsterAtk / 100);
      }

      // Void Mirror Dimension: High priority if we have matching level monsters
      if (card.name === "Void Mirror Dimension" && context?.type === "summon") {
        const summonedLevel = context.card?.level || 0;
        const matchingMonsters =
          player?.hand?.filter(
            (c) => c.cardKind === "monster" && c.level === summonedLevel
          ).length || 0;
        if (matchingMonsters > 0) {
          priority += 60 + matchingMonsters * 10;
        }
      }

      // General trap value: consider game state
      if (card.cardKind === "trap") {
        // Higher priority if we're behind on field presence
        const myFieldCount = player?.field?.filter((m) => m).length || 0;
        const oppFieldCount = opponent?.field?.filter((m) => m).length || 0;
        if (oppFieldCount > myFieldCount) {
          priority += 15;
        }

        // Higher priority if LP is low
        if (player?.lp < 2000) {
          priority += 20;
        }
      }

      if (card.cardKind === "spell" && card.subtype === "quick") {
        priority += 10;
        if (card.name === "Luminarch Holy Shield") {
          if (context?.type === "attack_declaration") {
            priority += 70;
          } else if (context?.type === "battle_damage") {
            priority += 55;
          } else if (context?.type === "effect_targeted") {
            priority += 40;
          } else {
            priority += 25;
          }
          if (player?.lp < 3000) {
            priority += 10;
          }
        }
      }

      return { ...option, priority };
    });

    // Sort by priority (highest first)
    evaluatedOptions.sort((a, b) => b.priority - a.priority);

    // Get best option
    const bestOption = evaluatedOptions[0];

    // Se a melhor opção tem priority <= 0, passar automaticamente
    if (bestOption.priority <= 0) {
      this.log(`Bot passing (best option priority: ${bestOption.priority} - too low)`);
      return null;
    }

    // Activation threshold based on priority
    // High priority (70+): 80% chance to activate
    // Medium priority (40-69): 50% chance to activate
    // Low priority (1-39): 20% chance to activate
    let activationChance = 0.2;
    if (bestOption.priority >= 70) {
      activationChance = 0.8;
    } else if (bestOption.priority >= 40) {
      activationChance = 0.5;
    }

    if (Math.random() < activationChance) {
      this.log(
        `Bot activating ${bestOption.card.name} (priority: ${bestOption.priority})`
      );

      // Get selections if the effect requires targets
      const selections = await this.getBotSelectionsForEffect(
        bestOption.card,
        bestOption.effect,
        player,
        context
      );

      return { ...bestOption, selections };
    }

    this.log(`Bot passing (best option priority: ${bestOption.priority})`)
    return null;
  }

  /**
   * Get bot selections for an effect that requires targets
   * @param {Object} card
   * @param {Object} effect
   * @param {Object} player
   * @param {ChainContext} context
   * @returns {Promise<Object|null>}
   */
  async getBotSelectionsForEffect(card, effect, player, context) {
    if (!effect?.targets || !Array.isArray(effect.targets)) {
      return null;
    }

    const effectEngine = this.game?.effectEngine;
    if (!effectEngine) return null;

    const ctx = {
      source: card,
      player,
      opponent: this.getOpponent(player),
      defender: context?.defender || context?.target,
      attacker: context?.attacker,
      attackerOwner: context?.attackerOwner,
      defenderOwner: context?.defenderOwner,
      activationContext: { autoSelectSingleTarget: true, logTargets: false },
    };

    const targetResult = effectEngine.resolveTargets(effect.targets, ctx, null);
    if (targetResult?.ok === false) {
      return null;
    }

    const baseTargets = targetResult?.targets || {};
    if (!targetResult?.needsSelection) {
      return Object.keys(baseTargets).length > 0 ? baseTargets : null;
    }

    if (
      !targetResult.selectionContract ||
      typeof this.game?.autoSelector?.select !== "function"
    ) {
      return Object.keys(baseTargets).length > 0 ? baseTargets : null;
    }

    const autoResult = this.game.autoSelector.select(
      targetResult.selectionContract,
      { owner: player, activationContext: ctx.activationContext, selectionKind: "target" }
    );

    if (!autoResult?.ok) {
      return Object.keys(baseTargets).length > 0 ? baseTargets : null;
    }

    const resolvedSelections = this.resolveSelectionsToCards(
      autoResult.selections || {},
      targetResult.selectionContract.requirements || [],
      player
    );

    const mergedSelections = {
      ...baseTargets,
      ...resolvedSelections,
    };

    return Object.keys(mergedSelections).length > 0 ? mergedSelections : null;
  }

  /**
   * Select best targets from candidates based on strategy
   * @param {Array} candidates
   * @param {number} count
   * @param {Object} targetDef
   * @returns {Array}
   */
  selectBestTargets(candidates, count, targetDef) {
    if (!candidates || candidates.length === 0) return [];

    // Sort candidates by strategic value
    const sorted = [...candidates].sort((a, b) => {
      // Prefer higher ATK monsters
      const aAtk = a.atk || 0;
      const bAtk = b.atk || 0;
      return bAtk - aAtk;
    });

    return sorted.slice(0, Math.min(count, sorted.length));
  }

  /**
   * Human player choosing chain response via UI
   * @param {Object} player
   * @param {Array} activatable
   * @param {ChainContext} context
   * @returns {Promise<Object|null>}
   */
  async playerChooseChainResponse(player, activatable, context) {
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
    if (typeof ui.showChainResponseModal === "function") {
      chosenOption = await ui.showChainResponseModal(
        activatable,
        context,
        this.chainStack
      );
    } else if (typeof ui.offerTrapActivation === "function") {
      // Fallback: Use existing trap selection if available
      const cards = activatable.map((a) => a.card);
      const result = await ui.offerTrapActivation(
        cards,
        `Respond to ${context?.type || "action"}?`
      );

      if (result && result.card) {
        chosenOption = activatable.find((a) => a.card === result.card) || null;
      }
    }

    // If player chose a card, get target selections if needed
    if (chosenOption) {
      const selections = await this.getPlayerSelectionsForEffect(
        chosenOption.card,
        chosenOption.effect,
        player,
        context
      );

      if (
        selections === null &&
        this.effectRequiresTargets(chosenOption.effect)
      ) {
        // Player cancelled target selection, treat as pass
        this.log("Player cancelled target selection");
        return null;
      }

      return { ...chosenOption, selections };
    }

    return null;
  }

  /**
   * Check if an effect requires target selection
   * @param {Object} effect
   * @returns {boolean}
   */
  effectRequiresTargets(effect) {
    return (
      effect?.targets &&
      Array.isArray(effect.targets) &&
      effect.targets.length > 0
    );
  }

  /**
   * Get player selections for an effect that requires targets
   * @param {Object} card
   * @param {Object} effect
   * @param {Object} player
   * @param {ChainContext} context
   * @returns {Promise<Object|null>}
   */
  async getPlayerSelectionsForEffect(card, effect, player, context) {
    if (!this.effectRequiresTargets(effect)) {
      return {};
    }

    const effectEngine = this.game?.effectEngine;
    const ui = this.getUI();

    if (!effectEngine || !ui) {
      return null;
    }

    // Build context with attack info if available
    const ctx = {
      source: card,
      player,
      opponent: this.getOpponent(player),
      defender: context?.defender || context?.target,
      attacker: context?.attacker,
      attackerOwner: context?.attackerOwner,
      defenderOwner: context?.defenderOwner,
      activationContext: { autoSelectSingleTarget: true },
    };

    // Use resolveTargets to check what selections are needed
    const targetResult = effectEngine.resolveTargets(effect.targets, ctx, null);
    const baseTargets = targetResult.targets || {};

    if (targetResult.ok === false) {
      this.log(`Target resolution failed: ${targetResult.reason}`);
      return null;
    }

    // If targets were auto-resolved (e.g., targetFromContext), return them
    if (!targetResult.needsSelection && targetResult.targets) {
      return targetResult.targets;
    }

    // If selection is needed, show selection UI
    if (targetResult.needsSelection && targetResult.selectionContract) {
      const contract = targetResult.selectionContract;

      // Use the game's target selection system
      if (this.game?.startTargetSelectionSession) {
        return new Promise((resolve) => {
          this.game.startTargetSelectionSession({
            selectionContract: contract,
            message: contract.message || `Select target(s) for ${card.name}`,
            kind: "target",
            allowCancel: true,
            execute: (selections) => {
              // Convert selection keys to actual card references
              const resolvedSelections = this.resolveSelectionsToCards(
                selections,
                contract.requirements,
                player
              );
              // Merge auto-resolved targets (e.g., targetFromContext) so they
              // are preserved alongside player-chosen selections.
              const mergedSelections = {
                ...baseTargets,
                ...resolvedSelections,
              };
              resolve(mergedSelections);
              return { success: true, needsSelection: false };
            },
            onCancel: () => {
              resolve(null);
            },
          });
        });
      }
    }

    // No selection flow available; return any auto-resolved targets we have.
    return baseTargets;
  }

  /**
   * Convert selection keys to actual card references
   * @param {Object} selections - Map of requirement id to selected keys
   * @param {Array} requirements - Selection requirements with candidates
   * @param {Object} player
   * @returns {Object} Map of requirement id to card arrays
   */
  resolveSelectionsToCards(selections, requirements, player) {
    const resolved = {};

    for (const req of requirements || []) {
      const selectedKeys = selections[req.id] || [];
      const cards = [];

      for (const key of selectedKeys) {
        // Find the candidate by key
        const candidate = req.candidates?.find((c) => c.key === key);
        if (candidate?.cardRef) {
          cards.push(candidate.cardRef);
        }
      }

      resolved[req.id] = cards;
    }

    return resolved;
  }

  /**
   * Add a card to the chain stack
   * @param {Object} card
   * @param {Object} player
   * @param {Object} effect
   * @param {ChainContext} context
   * @param {Object} [selections]
   */
  addToChain(card, player, effect, context, selections = null, zone = null) {
    this.currentChainLevel++;

    // Determine activation zone if not provided
    const activationZone = zone || this.determineCardZone(card, player);

    const chainLink = {
      card,
      player,
      effect,
      context,
      zone: activationZone,
      selections,
      chainLevel: this.currentChainLevel,
    };

    this.chainStack.push(chainLink);

    this.log(
      `Chain Link ${this.currentChainLevel}: ${card.name} (${player.id})`
    );

    // Notify UI
    const ui = this.getUI();
    if (ui?.log) {
      ui.log(`Chain Link ${this.currentChainLevel}: ${card.name}`);
    }
  }

  // ============================================================
  // CHAIN RESOLUTION
  // ============================================================

  /**
   * Resolve the chain stack in LIFO order
   * @returns {Promise<void>}
   */
  async resolveChain() {
    if (this.chainStack.length === 0) {
      this.log("No chain to resolve");
      return;
    }

    this.isResolving = true;
    this.log(`Resolving chain with ${this.chainStack.length} links`);

    const ui = this.getUI();

    // Resolve in reverse order (LIFO)
    while (this.chainStack.length > 0) {
      const link = this.chainStack.pop();

      if (!link) continue;

      this.log(`Resolving Chain Link ${link.chainLevel}: ${link.card.name}`);

      if (ui?.log) {
        ui.log(`Resolving: ${link.card.name}`);
      }

      try {
        await this.resolveChainLink(link);
      } catch (error) {
        console.error(
          `[ChainSystem] Error resolving ${link.card.name}:`,
          error
        );
      }
    }

    this.isResolving = false;
    this.log("Chain resolution complete");
  }

  /**
   * Resolve a single chain link
   * @param {ChainLink} link
   * @returns {Promise<void>}
   */
  async resolveChainLink(link) {
    const { card, player, effect, selections } = link;

    if (!card || !player || !effect) {
      this.log("Invalid chain link, skipping");
      return;
    }

    // Track that this card is being resolved (prevents re-offering during resolution)
    this.cardsBeingResolved.add(card);

    const effectEngine = this.game?.effectEngine;
    if (!effectEngine) {
      this.log("No effect engine available");
      this.cardsBeingResolved.delete(card);
      return;
    }

    // Check if the card was removed from the expected zone before resolution
    // Use the zone stored in the chain link, not assumed 'spellTrap'
    const activationZone = link.zone || "spellTrap";
    const cardStillValid = this.isCardStillValid(card, player, activationZone);

    if (!cardStillValid) {
      this.log(
        `${card.name} is no longer valid in ${activationZone}, effect fizzles`
      );
      const ui = this.getUI();
      if (ui?.log) {
        ui.log(`${card.name}'s effect fizzles (card is no longer available).`);
      }
      this.cardsBeingResolved.delete(card);
      return;
    }

    try {
      // Mark trap as face-up when activated (but don't move to GY yet)
      if (card.cardKind === "trap" && card.isFacedown) {
        card.isFacedown = false;
      }
      if (
        card.cardKind === "spell" &&
        card.isFacedown &&
        activationZone === "spellTrap"
      ) {
        card.isFacedown = false;
      }

      // For Quick-Play spells from hand, move to spellTrap zone before resolution
      if (
        card.cardKind === "spell" &&
        card.subtype === "quick" &&
        activationZone === "hand"
      ) {
        const handIdx = player.hand?.indexOf(card);
        if (handIdx !== -1) {
          player.hand.splice(handIdx, 1);
          player.spellTrap = player.spellTrap || [];
          player.spellTrap.push(card);
        }
      }

      // Resolve the effect
      const ctx = {
        source: card,
        player,
        opponent: this.getOpponent(player),
        activationZone: activationZone,
        // Include attack context if available (for traps like Dragon Spirit Sanctuary)
        defender: link.context?.defender || link.context?.target,
        attacker: link.context?.attacker,
        attackerOwner: link.context?.attackerOwner,
        defenderOwner: link.context?.defenderOwner,
        activationContext: {
          chainLevel: link.chainLevel,
          context: link.context,
          autoSelectSingleTarget: true,
          autoSelectTargets: isAI(player),
        },
      };

      // If we have selections, use them directly; otherwise resolve targets
      let resolvedSelections = selections;
      if (!resolvedSelections || Object.keys(resolvedSelections).length === 0) {
        // Resolve targets using the context (this handles targetFromContext)
        const targetResult = effectEngine.resolveTargets(
          effect.targets || [],
          ctx,
          null
        );
        if (targetResult.ok !== false && targetResult.targets) {
          resolvedSelections = targetResult.targets;
        } else if (targetResult.needsSelection) {
          this.log(
            `${card.name} requires selection but none provided, effect may fail`
          );
          resolvedSelections = {};
        }
      }

      // Apply actions
      if (Array.isArray(effect.actions)) {
        try {
          await effectEngine.applyActions(
            effect.actions,
            ctx,
            resolvedSelections || {}
          );
        } catch (error) {
          // Enhanced error logging with chain link context for easier debugging
          const linkContext = {
            cardName: card?.name || "Unknown",
            cardId: card?.id,
            effectId: effect?.id || "unknown",
            effectTiming: effect?.timing,
            chainLevel: link.chainLevel,
            activationZone: activationZone,
            player: player?.id,
            actionsCount: effect.actions?.length || 0,
            actionTypes: effect.actions?.map((a) => a?.type).filter(Boolean),
          };
          console.error(
            `[ChainSystem] Action error resolving chain link:`,
            linkContext,
            error
          );
          this.log(
            `Chain resolution failed for ${linkContext.cardName} (CL${linkContext.chainLevel}):`,
            error.message
          );
        }
      }

      // AFTER resolution: Move non-continuous traps and quick-play spells to graveyard
      if (card.cardKind === "trap" && card.subtype !== "continuous") {
        const idx = player.spellTrap?.indexOf(card);
        if (idx !== -1) {
          player.spellTrap.splice(idx, 1);
          player.graveyard = player.graveyard || [];
          player.graveyard.push(card);
          this.log(`${card.name} sent to graveyard after resolution`);
        }
      }

      // Quick-Play spells also go to graveyard after resolution
      if (card.cardKind === "spell" && card.subtype === "quick") {
        const idx = player.spellTrap?.indexOf(card);
        if (idx !== -1) {
          player.spellTrap.splice(idx, 1);
          player.graveyard = player.graveyard || [];
          player.graveyard.push(card);
          this.log(`${card.name} sent to graveyard after resolution`);
        }
      }

      // Register once per turn usage using the game's method for consistency
      if (effect.oncePerTurn) {
        // Use game's method if available, otherwise fallback to effectEngine
        if (this.game?.registerOncePerTurnUsage) {
          this.game.registerOncePerTurnUsage(card, player, effect);
        } else if (effectEngine?.registerOncePerTurnUsage) {
          effectEngine.registerOncePerTurnUsage(card, player, effect);
        }
      }

      this.game?.updateBoard?.();
    } finally {
      // Always remove from cardsBeingResolved to ensure cleanup
      this.cardsBeingResolved.delete(card);
    }
  }

  /**
   * Check if a card is still valid for resolution
   * @param {Object} card
   * @param {Object} player
   * @param {ChainContext} context
   * @returns {boolean}
   */
  isCardStillValid(card, player, zone) {
    if (!card || !player) return false;

    // Check if card is still in expected zone
    // zone is now passed directly, not extracted from context
    const checkZone = zone || "spellTrap";

    if (checkZone === "spellTrap") {
      return player.spellTrap?.includes(card) === true;
    }
    if (checkZone === "hand") {
      return player.hand?.includes(card) === true;
    }
    if (checkZone === "field") {
      return player.field?.includes(card) === true;
    }
    if (checkZone === "graveyard") {
      return player.graveyard?.includes(card) === true;
    }

    // Unknown zone - assume valid to avoid false fizzles
    return true;
  }

  /**
   * Determine which zone a card is currently in
   * @param {Object} card
   * @param {Object} player
   * @returns {string}
   */
  determineCardZone(card, player) {
    if (!card || !player) return "unknown";

    if (player.hand?.includes(card)) return "hand";
    if (player.field?.includes(card)) return "field";
    if (player.spellTrap?.includes(card)) return "spellTrap";
    if (player.graveyard?.includes(card)) return "graveyard";
    if (player.banished?.includes(card)) return "banished";

    return "unknown";
  }

  // ============================================================
  // UTILITY METHODS
  // ============================================================

  /**
   * Check if a chain window is currently open
   * @returns {boolean}
   */
  isChainWindowOpen() {
    return this.chainWindowOpen;
  }

  /**
   * Get current chain stack length
   * @returns {number}
   */
  getChainLength() {
    return this.chainStack.length;
  }

  /**
   * Get the last card in the chain
   * @returns {Object|null}
   */
  getLastChainLink() {
    if (this.chainStack.length === 0) return null;
    return this.chainStack[this.chainStack.length - 1];
  }

  /**
   * Check if we're in the middle of resolving a chain
   * @returns {boolean}
   */
  isChainResolving() {
    return this.isResolving;
  }

  /**
   * Cancel the current chain (for special effects that negate chains)
   */
  cancelChain() {
    this.log("Chain cancelled");
    this.chainStack = [];
    this.chainWindowOpen = false;
    this.chainWindowContext = null;
    this.isResolving = false;
    this.currentChainLevel = 0;
    this.cardsBeingResolved.clear();
  }

  /**
   * Get a summary of the current chain for UI display
   * @returns {Array<{level: number, cardName: string, playerName: string}>}
   */
  getChainSummary() {
    return this.chainStack.map((link) => ({
      level: link.chainLevel,
      cardName: link.card?.name || "Unknown",
      playerName: link.player?.name || link.player?.id || "Unknown",
    }));
  }
}
