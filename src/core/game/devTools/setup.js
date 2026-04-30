/**
 * DevTools Setup for Game
 * Handles: applyManualSetup
 */

/**
 * @this {import('../../Game.js').default}
 */
export function applyManualSetup(definition = {}) {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }
  return applyScenarioSetup.call(this, definition, {
    logMessage: "Dev setup applied.",
  });
}

/**
 * Applies an explicit scenario setup without requiring dev mode.
 * Used by DevTools and the Laboratory setup flow.
 * @this {import('../../Game.js').default}
 */
export function applyScenarioSetup(definition = {}, options = {}) {
  if (!definition || typeof definition !== "object") {
    return { success: false, reason: "Setup must be an object." };
  }

  const warnings = [];
  const setupTurn =
    options.immediateActions === true
      ? Math.max(0, (this.turnCounter || 0) - 1)
      : this.turnCounter;
  const normalizeEntry = (entry) => {
    if (typeof entry === "string") return { name: entry };
    if (entry && typeof entry === "object") return { ...entry };
    return null;
  };

  const placeInZone = (player, entry, zone) => {
    const normalized = normalizeEntry(entry);
    if (!normalized) {
      warnings.push(`Invalid entry for ${zone}.`);
      return;
    }
    const card = this.createCardForOwner(normalized, player, normalized);
    if (!card) {
      warnings.push(`Card "${normalized.name || normalized.id}" not found.`);
      return;
    }

    switch (zone) {
      case "hand":
        player.hand.push(card);
        break;
      case "field":
        if (card.cardKind !== "monster") {
          warnings.push(`${card.name} is not a monster.`);
          return;
        }
        if (player.field.length >= 5) {
          warnings.push("Field is full (max 5 monsters).");
          return;
        }
        this.setMonsterFacing(card, {
          position: normalized.position,
          facedown: normalized.facedown === true,
        });
        card.hasAttacked = false;
        card.attacksUsedThisTurn = 0;
        card.enteredFieldTurn = setupTurn;
        card.summonedTurn = setupTurn;
        card.setTurn = card.isFacedown ? setupTurn : null;
        player.field.push(card);
        break;
      case "spellTrap":
        if (card.cardKind === "monster") {
          warnings.push(`${card.name} cannot be placed in Spell/Trap zone.`);
          return;
        }
        if (player.spellTrap.length >= 5) {
          warnings.push("Spell/Trap zone is full (max 5 cards).");
          return;
        }
        card.isFacedown = normalized.facedown === true;
        card.turnSetOn = normalized.facedown === true ? setupTurn : null;
        player.spellTrap.push(card);
        break;
      case "graveyard":
        player.graveyard.push(card);
        break;
      case "fieldSpell":
        if (card.cardKind !== "spell" || card.subtype !== "field") {
          warnings.push(`${card.name} is not a Field Spell.`);
          return;
        }
        card.isFacedown = normalized.facedown === true;
        player.fieldSpell = card;
        break;
      case "extraDeck":
        player.extraDeck.push(card);
        break;
      case "deck":
        player.deck.push(card);
        break;
      default:
        warnings.push(`Unsupported zone "${zone}".`);
    }
  };

  const resetSide = (player) => {
    player.hand = [];
    player.field = [];
    player.spellTrap = [];
    player.graveyard = [];
    player.fieldSpell = null;
    player.oncePerTurnUsageByName = {};
  };

  const applySide = (player, payload = {}) => {
    if (!payload || typeof payload !== "object") return;

    resetSide(player);

    if (typeof payload.lp === "number" && Number.isFinite(payload.lp)) {
      player.lp = Math.max(0, Math.floor(payload.lp));
    }

    if (Array.isArray(payload.hand)) {
      payload.hand.forEach((entry) => placeInZone(player, entry, "hand"));
    }

    if (Array.isArray(payload.field)) {
      payload.field.forEach((entry) => placeInZone(player, entry, "field"));
    }

    if (Array.isArray(payload.spellTrap)) {
      payload.spellTrap.forEach((entry) =>
        placeInZone(player, entry, "spellTrap")
      );
    }

    if (Array.isArray(payload.graveyard)) {
      payload.graveyard.forEach((entry) =>
        placeInZone(player, entry, "graveyard")
      );
    }

    if (payload.fieldSpell) {
      const fieldSpell = Array.isArray(payload.fieldSpell)
        ? payload.fieldSpell[0]
        : payload.fieldSpell;
      if (fieldSpell) {
        placeInZone(player, fieldSpell, "fieldSpell");
      }
    }

    if (Array.isArray(payload.extraDeck)) {
      player.extraDeck = [];
      payload.extraDeck.forEach((entry) =>
        placeInZone(player, entry, "extraDeck")
      );
    }

    if (Array.isArray(payload.deck)) {
      player.deck = [];
      payload.deck.forEach((entry) => placeInZone(player, entry, "deck"));
    }

    if (Array.isArray(payload.deckTop) && payload.deckTop.length > 0) {
      for (let i = payload.deckTop.length - 1; i >= 0; i--) {
        placeInZone(player, payload.deckTop[i], "deck");
      }
    }
  };

  if (definition.player) {
    applySide(this.player, definition.player);
  }
  if (definition.bot) {
    applySide(this.bot, definition.bot);
  }

  if (typeof definition.turn === "string") {
    this.turn = definition.turn === "bot" ? "bot" : "player";
  }
  if (typeof definition.phase === "string") {
    this.phase = definition.phase;
  }

  this.gameOver = false;
  this.isResolvingEffect = false;
  this.eventResolutionDepth = 0;
  this.pendingSpecialSummon = null;
  this.cancelTargetSelection();
  this.effectEngine?.updatePassiveBuffs();
  if (options.updateBoard !== false) {
    this.updateBoard();
  }
  this.resetOncePerTurnUsage("manual_setup");
  if (this.ui?.log) {
    this.ui.log(options.logMessage || "Scenario setup applied.");
  }
  this.devLog("DEV_SETUP_APPLIED", {
    summary: "Manual setup applied",
    warnings: warnings.length,
  });
  this.assertStateInvariants("applyManualSetup", { failFast: false });
  return { success: true, warnings };
}
