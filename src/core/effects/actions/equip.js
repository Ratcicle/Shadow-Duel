/**
 * Equip Actions - equipment handling
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

/**
 * Apply equip action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {Promise<boolean>} Whether equip was successful
 */
export async function applyEquip(action, ctx, targets) {
  const equipCard = ctx.source;
  const player = ctx.player;

  const targetCards = targets[action.targetRef] || [];
  if (!targetCards.length) return false;

  const target = targetCards[0];
  const detachFromPreviousHost = () => {
    const previousHost = equipCard.equippedTo;
    if (!previousHost || previousHost === target) return;

    if (Array.isArray(previousHost.equips)) {
      const idxEquip = previousHost.equips.indexOf(equipCard);
      if (idxEquip > -1) {
        previousHost.equips.splice(idxEquip, 1);
      }
    }

    if (
      typeof equipCard.equipAtkBonus === "number" &&
      equipCard.equipAtkBonus !== 0
    ) {
      previousHost.atk = Math.max(
        0,
        (previousHost.atk || 0) - equipCard.equipAtkBonus
      );
    }
    if (
      typeof equipCard.equipDefBonus === "number" &&
      equipCard.equipDefBonus !== 0
    ) {
      previousHost.def = Math.max(
        0,
        (previousHost.def || 0) - equipCard.equipDefBonus
      );
    }
    if (
      typeof equipCard.equipExtraAttacks === "number" &&
      equipCard.equipExtraAttacks !== 0
    ) {
      const currentExtra = previousHost.extraAttacks || 0;
      const nextExtra = currentExtra - equipCard.equipExtraAttacks;
      previousHost.extraAttacks = Math.max(0, nextExtra);
      const prevMaxAttacks = 1 + (previousHost.extraAttacks || 0);
      previousHost.hasAttacked =
        (previousHost.attacksUsedThisTurn || 0) >= prevMaxAttacks;
    }
    if (equipCard.grantsBattleIndestructible) {
      previousHost.battleIndestructible = false;
    }

    equipCard.equipAtkBonus = 0;
    equipCard.equipDefBonus = 0;
    equipCard.equipExtraAttacks = 0;
    equipCard.grantsBattleIndestructible = false;
    equipCard.grantsCrescentShieldGuard = false;
    equipCard.equippedTo = null;
  };

  if (!target || target.cardKind !== "monster") return false;
  if (target.isFacedown) {
    console.warn("Cannot equip to a facedown monster:", target.name);
    return false;
  }

  detachFromPreviousHost();

  if (this.game && typeof this.game.moveCard === "function") {
    const zone = this.game.getZone(player, "hand");
    if (zone && zone.includes(equipCard)) {
      this.game.moveCard(equipCard, player, "spellTrap", {
        isFacedown: false,
        resetAttackFlags: false,
      });
    }
  }

  equipCard.equippedTo = target;
  if (!Array.isArray(target.equips)) {
    target.equips = [];
  }
  if (!target.equips.includes(equipCard)) {
    target.equips.push(equipCard);
  }

  if (typeof action.atkBonus === "number") {
    equipCard.equipAtkBonus = action.atkBonus;
    target.atk += action.atkBonus;
  }
  if (typeof action.defBonus === "number") {
    equipCard.equipDefBonus = action.defBonus;
    target.def += action.defBonus;
  }
  if (typeof action.extraAttacks === "number" && action.extraAttacks !== 0) {
    equipCard.equipExtraAttacks = action.extraAttacks;
    target.extraAttacks = (target.extraAttacks || 0) + action.extraAttacks;
  }

  if (action.battleIndestructible) {
    equipCard.grantsBattleIndestructible = true;
    target.battleIndestructible = true;
  } else {
    equipCard.grantsBattleIndestructible = false;
  }

  if (action.grantCrescentShieldGuard) {
    equipCard.grantsCrescentShieldGuard = true;
  } else {
    equipCard.grantsCrescentShieldGuard = false;
  }

  const maxAttacksAfterEquip = 1 + (target.extraAttacks || 0);
  target.hasAttacked =
    (target.attacksUsedThisTurn || 0) >= maxAttacksAfterEquip;

  if (this.game && typeof this.game.emit === "function") {
    const targetOwner =
      target.owner === "player" ? this.game.player : this.game.bot;
    await this.game.emit("card_equipped", {
      equipCard,
      equipOwner: player,
      target,
      targetOwner,
    });
  }
  return true;
}

/**
 * Show sickle selection modal (fallback UI helper)
 * @param {Array} candidates - Available candidates
 * @param {number} maxSelect - Max selectable
 * @param {Function} onConfirm - Confirm callback
 * @param {Function} onCancel - Cancel callback
 */
export function showSickleSelectionModal(
  candidates,
  maxSelect,
  onConfirm,
  onCancel
) {
  if (this.ui && typeof this.ui.showSickleSelectionModal === "function") {
    this.ui.showSickleSelectionModal(
      candidates,
      maxSelect,
      onConfirm,
      onCancel
    );
    return;
  }

  // Fallback: no auto-pick, just select up to maxSelect in order (respects manual philosophy)
  const chosen = candidates.slice(0, maxSelect);
  console.log(
    `[HEADLESS] Sickle: Auto-selecting ${chosen.length} Luminarch monsters in order.`
  );
  onConfirm(chosen);
}
