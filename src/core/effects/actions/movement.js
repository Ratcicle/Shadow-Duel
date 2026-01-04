/**
 * Movement Actions - card zone movement
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

/**
 * Apply move action - move cards between zones
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {boolean} Whether any cards were moved
 */
export function applyMove(action, ctx, targets) {
  // Resolve targetRef to get the actual cards
  let targetCards = targets[action.targetRef] || [];

  // If targetRef is "self", resolve from ctx.source
  if (action.targetRef === "self" && ctx?.source) {
    targetCards = [ctx.source];
  }

  if (!targetCards || targetCards.length === 0) return false;

  const toZone = action.to || action.toZone;
  if (!toZone) {
    console.warn("move action missing destination zone:", action);
    return false;
  }

  let moved = false;
  let waitingForChoice = false;

  targetCards.forEach((card) => {
    if (
      toZone === "field" &&
      card.summonRestrict === "shadow_heart_invocation_only"
    ) {
      console.log(
        `${card.name} can only be Special Summoned by "Shadow-Heart Invocation".`
      );
      return false;
    }
    if (this.game?.normalizeCardOwnership) {
      this.game.normalizeCardOwnership(card, ctx, {
        action,
        source: ctx?.source,
        contextLabel: "applyMove",
      });
    }
    let destPlayer;
    if (action.player === "self") {
      destPlayer = ctx.player;
    } else if (action.player === "opponent") {
      destPlayer = ctx.opponent;
    } else {
      destPlayer = card.owner === "player" ? this.game.player : this.game.bot;
    }

    const shouldPromptForPosition =
      toZone === "field" &&
      card.cardKind === "monster" &&
      this.game &&
      destPlayer === this.game.player &&
      typeof this.game.chooseSpecialSummonPosition === "function";

    const defaultFieldPosition =
      toZone === "field" && card.cardKind === "monster" ? "attack" : null;

    const applyMoveWithPosition = (chosenPosition) => {
      const finalPosition = shouldPromptForPosition
        ? chosenPosition || action.position || defaultFieldPosition || "attack"
        : chosenPosition ?? action.position ?? defaultFieldPosition;

      if (this.game && typeof this.game.moveCard === "function") {
        this.game.moveCard(card, destPlayer, toZone, {
          position: finalPosition,
          isFacedown: action.isFacedown,
          resetAttackFlags: action.resetAttackFlags,
        });
      } else {
        const fromOwner =
          card.owner === "player" ? this.game.player : this.game.bot;
        const zones = ["field", "hand", "deck", "graveyard", "spellTrap"];
        for (const zoneName of zones) {
          const arr = this.getZone(fromOwner, zoneName);
          const idx = arr ? arr.indexOf(card) : -1;
          if (idx > -1) {
            arr.splice(idx, 1);
            break;
          }
        }

        const destArr = this.getZone(destPlayer, toZone);
        if (!destArr) {
          console.warn("applyMove: unknown destination zone:", toZone);
          return;
        }

        if (finalPosition) {
          card.position = finalPosition;
        }
        if (typeof action.isFacedown === "boolean") {
          card.isFacedown = action.isFacedown;
        }
        if (action.resetAttackFlags) {
          card.hasAttacked = false;
          card.cannotAttackThisTurn = false;
          card.attacksUsedThisTurn = 0;
        }

        card.owner = destPlayer.id;
        destArr.push(card);
      }
      moved = true;

      if (this.game && typeof this.game.updateBoard === "function") {
        this.game.updateBoard();
      }
      if (this.game && typeof this.game.checkWinCondition === "function") {
        this.game.checkWinCondition();
      }

      if (this.ui?.log) {
        this.ui.log(`${card.name} moved to ${toZone}.`);
      }
    };

    if (shouldPromptForPosition) {
      const positionChoice = this.game.chooseSpecialSummonPosition(
        destPlayer,
        card
      );
      if (positionChoice && typeof positionChoice.then === "function") {
        waitingForChoice = true;
        positionChoice.then((resolved) => applyMoveWithPosition(resolved));
      } else {
        applyMoveWithPosition(positionChoice);
      }
    } else {
      applyMoveWithPosition(action.position);
    }
  });
  return moved || waitingForChoice;
}
