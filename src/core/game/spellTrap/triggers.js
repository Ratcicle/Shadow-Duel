// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/spellTrap/triggers.js
// Spell/Trap trigger methods for Game class — B.9 extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check and offer trap activations in response to an event.
 * Opens a chain window if activatable traps exist.
 * @param {string} event - The event that triggered this check.
 * @param {Object} eventData - Data associated with the event.
 * @returns {Promise<void>}
 */
export async function checkAndOfferTraps(event, eventData = {}) {
  if (!this.player || this.disableTraps || this.disableChains) return;

  // Evitar reentrância: se já existe um modal de trap aberto, não abrir outro
  if (this.trapPromptInProgress) return;

  // Se o ChainSystem já está resolvendo, não interromper
  if (this.chainSystem?.isChainResolving()) return;

  // Prevenir abrir nova chain window enquanto outra já está aberta
  if (this.chainSystem?.isChainWindowOpen?.()) return;

  this.trapPromptInProgress = true;

  try {
    // Mapear evento para contexto de chain
    const contextType = this._mapEventToChainContext(event);

    // Usar ChainSystem para abrir chain window
    const attacker = eventData.attacker || null;
    const defender = eventData.defender ?? eventData.target ?? null;
    const attackerOwner =
      eventData.attackerOwner ??
      (attacker
        ? attacker.owner === "player"
          ? this.player
          : this.bot
        : null);
    const defenderOwner =
      eventData.defenderOwner ??
      (defender
        ? defender.owner === "player"
          ? this.player
          : this.bot
        : null);

    const context = {
      type: contextType,
      event,
      ...eventData,
      attacker,
      defender,
      target: defender ?? eventData.target ?? null,
      attackerOwner,
      defenderOwner,
      targetOwner: eventData.targetOwner ?? defenderOwner ?? null,
      isOpponentAttack:
        eventData.isOpponentAttack ??
        (attackerOwner && defenderOwner
          ? attackerOwner.id !== defenderOwner.id &&
            defenderOwner.id === "player"
          : false),
      triggerPlayer:
        attackerOwner ||
        eventData.player ||
        (this.turn === "player" ? this.player : this.bot),
    };

    // Verificar se há cartas ativáveis antes de abrir chain window
    const playerActivatable = this.chainSystem.getActivatableCardsInChain(
      this.player,
      context
    );
    const botActivatable = this.chainSystem.getActivatableCardsInChain(
      this.bot,
      context
    );

    if (playerActivatable.length === 0 && botActivatable.length === 0) {
      return; // Nenhuma carta pode responder
    }

    // Abrir chain window através do ChainSystem
    await this.chainSystem.openChainWindow(context);
  } finally {
    this.trapPromptInProgress = false;
    this.testModeEnabled = false;
  }
}

/**
 * Map game events to chain context types.
 * @param {string} event - The event name.
 * @returns {string} Chain context type.
 */
export function _mapEventToChainContext(event) {
  const eventToContext = {
    attack_declared: "attack_declaration",
    after_summon: "summon",
    phase_end: "phase_change",
    phase_start: "phase_change",
    card_activation: "card_activation",
    effect_activation: "effect_activation",
    battle_damage: "battle_damage",
    effect_targeted: "effect_targeted",
  };
  return eventToContext[event] || "card_activation";
}

/**
 * Activates a trap card from the spell/trap zone.
 * @param {Card} card - The trap card to activate.
 * @param {Object} eventData - Context data for the activation.
 * @returns {Promise<Object|void>} Activation result.
 */
export async function activateTrapFromZone(card, eventData = {}) {
  if (!card || card.cardKind !== "trap") return;

  const trapIndex = this.player.spellTrap.indexOf(card);
  if (trapIndex === -1) return;

  const guard = this.guardActionStart({
    actor: this.player,
    kind: "trap_activation",
    allowDuringOpponentTurn: true,
    allowDuringResolving: true,
  });
  if (!guard.ok) return guard;

  // Virar a carta face-up
  card.isFacedown = false;
  this.ui.log(`${this.player.name} ativa ${card.name}!`);

  // Resolver efeitos
  const result = await this.effectEngine.resolveTrapEffects(
    card,
    this.player,
    eventData
  );

  // Se for trap normal, mover para o cemitério após resolver
  if (card.subtype === "normal") {
    this.moveCard(card, this.player, "graveyard", { fromZone: "spellTrap" });
  }
  // Se for continuous, permanece no campo face-up

  this.updateBoard();
  return result;
}
