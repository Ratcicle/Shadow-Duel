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
};

/**
 * @typedef {Object} ChainLink
 * @property {Object} card - The card being activated
 * @property {Object} player - The player activating the card
 * @property {Object} effect - The effect being activated
 * @property {Object} context - Activation context
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

    // Chain Link 2+: Must match or exceed last card's speed
    const lastLink = this.chainStack[this.chainStack.length - 1];
    const lastSpeed = this.getEffectSpellSpeed(lastLink.effect, lastLink.card);

    // Can respond with same or higher speed
    return lastSpeed;
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

    // Check set Trap cards in spellTrap zone
    if (Array.isArray(player.spellTrap)) {
      for (const card of player.spellTrap) {
        if (!card || card.cardKind !== "trap") continue;
        if (!card.isFacedown) continue; // Must be set

        // Check if trap can be activated (was set before this turn)
        // Support both setTurn and turnSetOn properties
        const setTurn = card.setTurn ?? card.turnSetOn ?? null;
        if (setTurn === null || setTurn >= this.game.turnCounter) continue;

        const effect = this.findActivatableEffect(card, context);
        if (effect) {
          const chainCheck = this.canActivateInChain(effect, card, context);
          if (chainCheck.ok) {
            // Check additional activation conditions
            const canActivate = effectEngine?.canActivate?.(card, player);
            if (!canActivate || canActivate.ok !== false) {
              activatable.push({ card, effect, zone: "spellTrap" });
            }
          }
        }
      }
    }

    // Check Quick-Play Spells in hand (can be activated from hand during opponent's turn)
    if (context?.type !== "main_phase_action" || this.game.turn !== player.id) {
      if (Array.isArray(player.hand)) {
        for (const card of player.hand) {
          if (!card || card.cardKind !== "spell") continue;
          if (card.subtype !== "quick") continue;

          const effect = this.findActivatableEffect(card, context);
          if (effect) {
            const chainCheck = this.canActivateInChain(effect, card, context);
            if (chainCheck.ok) {
              activatable.push({ card, effect, zone: "hand" });
            }
          }
        }
      }
    }

    // Check monster quick effects on field
    if (Array.isArray(player.field)) {
      for (const card of player.field) {
        if (!card || card.cardKind !== "monster") continue;
        if (card.isFacedown) continue;

        const effect = this.findQuickMonsterEffect(card, context);
        if (effect) {
          const chainCheck = this.canActivateInChain(effect, card, context);
          if (chainCheck.ok) {
            activatable.push({ card, effect, zone: "field" });
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
  findActivatableEffect(card, context) {
    if (!card?.effects || !Array.isArray(card.effects)) return null;

    // Map context type back to event name
    const contextToEvent = {
      attack_declaration: "attack_declared",
      summon: "after_summon",
      phase_change: "phase_end",
      card_activation: "card_activation",
      effect_activation: "effect_activation",
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
            // Check additional conditions
            if (
              effect.requireOpponentAttack &&
              context?.type === "attack_declaration"
            ) {
              // Only valid if opponent is attacking (check from player's perspective)
              const attackerIsOpponent =
                context.attackerOwner?.id === "bot" ||
                context.isOpponentAttack === true;
              if (!attackerIsOpponent) continue;
            }
            if (effect.requireOpponentSummon && context?.type === "summon") {
              // Only valid if opponent summoned (check from player's perspective)
              const summonerIsOpponent =
                context.player?.id === "bot" ||
                context.isOpponentSummon === true;
              if (!summonerIsOpponent) continue;
            }
            return effect;
          }
          continue;
        }

        // Check on_activate, manual, ignition effects
        if (
          effect.timing === "on_activate" ||
          effect.timing === "manual" ||
          effect.timing === "ignition"
        ) {
          // These can be activated at various times depending on context
          return effect;
        }
      }

      // For quick-play spells
      if (card.cardKind === "spell" && card.subtype === "quick") {
        if (
          effect.timing === "on_play" ||
          effect.timing === "on_activate" ||
          effect.timing === "ignition"
        ) {
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
      this.addToChain(context.card, context.player, context.effect, context);
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

        // Add to chain
        this.addToChain(
          response.card,
          currentResponder,
          response.effect,
          context,
          response.selections
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

    // Bot logic
    if (player.id === "bot") {
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
    // Simple AI: Activate counter traps when available, otherwise pass most of the time
    // TODO: Implement smarter AI based on game state

    // Look for counter traps first (highest priority)
    const counterTrap = activatable.find(
      (a) => a.card.subtype === "counter" || a.effect.speed === 3
    );

    if (counterTrap && Math.random() > 0.3) {
      this.log(`Bot activating counter trap: ${counterTrap.card.name}`);
      return counterTrap;
    }

    // 30% chance to activate other traps
    if (activatable.length > 0 && Math.random() > 0.7) {
      const choice = activatable[0];
      this.log(`Bot activating: ${choice.card.name}`);
      return choice;
    }

    return null;
  }

  /**
   * Human player choosing chain response via UI
   * @param {Object} player
   * @param {Array} activatable
   * @param {ChainContext} context
   * @returns {Promise<Object|null>}
   */
  async playerChooseChainResponse(player, activatable, context) {
    const ui = this.getUI();

    if (!ui) {
      this.log("No UI available for player response");
      return null;
    }

    // Use existing trap offering system or create new modal
    if (typeof ui.showChainResponseModal === "function") {
      return await ui.showChainResponseModal(
        activatable,
        context,
        this.chainStack
      );
    }

    // Fallback: Use existing trap selection if available
    if (typeof ui.offerTrapActivation === "function") {
      const cards = activatable.map((a) => a.card);
      const result = await ui.offerTrapActivation(
        cards,
        `Respond to ${context?.type || "action"}?`
      );

      if (result && result.card) {
        const match = activatable.find((a) => a.card === result.card);
        return match || null;
      }
    }

    // No UI method available, auto-pass
    return null;
  }

  /**
   * Add a card to the chain stack
   * @param {Object} card
   * @param {Object} player
   * @param {Object} effect
   * @param {ChainContext} context
   * @param {Object} [selections]
   */
  addToChain(card, player, effect, context, selections = null) {
    this.currentChainLevel++;

    const chainLink = {
      card,
      player,
      effect,
      context,
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

    const effectEngine = this.game?.effectEngine;
    if (!effectEngine) {
      this.log("No effect engine available");
      return;
    }

    // Check if the card was removed from the field/hand before resolution
    // (e.g., destroyed by a higher chain link)
    const cardStillValid = this.isCardStillValid(card, player, link.context);

    if (!cardStillValid) {
      this.log(`${card.name} is no longer valid, effect fizzles`);
      const ui = this.getUI();
      if (ui?.log) {
        ui.log(`${card.name}'s effect fizzles (card is no longer on field).`);
      }
      return;
    }

    // Move trap to graveyard after activation (if it was set)
    if (card.cardKind === "trap" && card.isFacedown) {
      card.isFacedown = false;

      // Non-continuous traps go to graveyard after resolution
      if (card.subtype !== "continuous") {
        const idx = player.spellTrap?.indexOf(card);
        if (idx !== -1) {
          player.spellTrap.splice(idx, 1);
          player.graveyard = player.graveyard || [];
          player.graveyard.push(card);
        }
      }
    }

    // Resolve the effect
    const ctx = {
      source: card,
      player,
      opponent: this.getOpponent(player),
      activationZone: link.context?.zone || "spellTrap",
      activationContext: {
        chainLevel: link.chainLevel,
        context: link.context,
      },
    };

    // Apply actions
    if (Array.isArray(effect.actions)) {
      try {
        await effectEngine.applyActions(effect.actions, ctx, selections || {});
      } catch (error) {
        console.error(`[ChainSystem] Action error:`, error);
      }
    }

    // Register once per turn usage
    if (effect.oncePerTurn) {
      effectEngine.registerOncePerTurnUsage?.(card, player, effect);
    }

    this.game?.updateBoard?.();
  }

  /**
   * Check if a card is still valid for resolution
   * @param {Object} card
   * @param {Object} player
   * @param {ChainContext} context
   * @returns {boolean}
   */
  isCardStillValid(card, player, context) {
    if (!card || !player) return false;

    // Check if card is still in expected zone
    const zone = context?.zone || "spellTrap";

    if (zone === "spellTrap") {
      return player.spellTrap?.includes(card);
    }
    if (zone === "hand") {
      return player.hand?.includes(card);
    }
    if (zone === "field") {
      return player.field?.includes(card);
    }

    // For graveyard effects, check graveyard
    if (zone === "graveyard") {
      return player.graveyard?.includes(card);
    }

    return true;
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
