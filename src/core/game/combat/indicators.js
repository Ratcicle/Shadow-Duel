/**
 * Combat visual indicators - attack ready and resolution markers.
 * Extracted from Game.js as part of B.5 modularization.
 */

/**
 * Update attack ready indicators for player's monsters.
 * Shows which monsters can attack during battle phase.
 */
export function updateAttackIndicators() {
  this.clearAttackReadyIndicators();

  const selectionState = this.selectionState || "idle";
  const hasActiveSelection = selectionState !== "idle";
  if (
    this.turn !== "player" ||
    this.phase !== "battle" ||
    hasActiveSelection ||
    this.isResolvingEffect ||
    this.eventResolutionDepth > 0
  ) {
    return;
  }

  const field = this.player.field || [];
  const readyIndices = [];
  field.forEach((card, index) => {
    if (!card || card.cardKind !== "monster") return;
    const availability = this.getAttackAvailability(card);
    if (!availability.ok) return;
    if (card.isFacedown) return;
    readyIndices.push(index);
  });
  if (this.ui && typeof this.ui.applyAttackReadyIndicators === "function") {
    this.ui.applyAttackReadyIndicators("player", readyIndices);
  }
}

/**
 * Clear all attack ready indicators from the UI.
 */
export function clearAttackReadyIndicators() {
  if (this.ui && typeof this.ui.clearAttackReadyIndicators === "function") {
    this.ui.clearAttackReadyIndicators();
  }
}

/**
 * Apply attack resolution indicators showing attacker and target.
 * @param {Object} attacker - The attacking monster
 * @param {Object|null} target - The target monster (null for direct attack)
 */
export function applyAttackResolutionIndicators(attacker, target) {
  const attackerOwner = attacker?.owner === "player" ? "player" : "bot";
  const attackerField =
    attackerOwner === "player" ? this.player.field : this.bot.field;
  const attackerIndex = attackerField.indexOf(attacker);
  const targetOwner = target?.owner === "player" ? "player" : "bot";
  const targetField =
    targetOwner === "player" ? this.player.field : this.bot.field;
  const targetIndex = target ? targetField.indexOf(target) : -1;

  if (
    this.ui &&
    typeof this.ui.applyAttackResolutionIndicators === "function"
  ) {
    this.ui.applyAttackResolutionIndicators({
      attackerOwner,
      attackerIndex,
      targetOwner,
      targetIndex,
      directAttack: !target,
    });
  }
}

/**
 * Clear attack resolution indicators from the UI.
 */
export function clearAttackResolutionIndicators() {
  if (
    this.ui &&
    typeof this.ui.clearAttackResolutionIndicators === "function"
  ) {
    this.ui.clearAttackResolutionIndicators();
  }
}
