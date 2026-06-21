/**
 * Movement Actions - card zone movement
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

import { resolveFieldScopeCards } from "../../actionHandlers/shared.js";

function checkControlCardCondition(condition, ctx) {
  if (!condition || condition.type !== "control_card") return false;

  const player = ctx?.player;
  const cardName = condition.cardName;
  if (!player || !cardName) return false;

  const zoneName = condition.zone || "fieldSpell";
  if (zoneName === "fieldSpell") {
    return player.fieldSpell?.name === cardName;
  }

  const zone = player[zoneName] || [];
  return Array.isArray(zone) && zone.some((card) => card?.name === cardName);
}

function shouldAllowExtraDeckMonsterToHand(action, ctx) {
  if (action.allowExtraDeckMonsterToHand === true) return true;
  if (action.allowExtraDeckMonsterToHandIf) {
    return checkControlCardCondition(action.allowExtraDeckMonsterToHandIf, ctx);
  }
  return false;
}

function getContextTargetCards(targetRef, ctx) {
  if (!targetRef || !ctx) return [];
  const contextTargets = {
    self: ctx.source,
    source: ctx.source,
    destroyed: ctx.destroyed,
    summonedCard: ctx.summonedCard,
    eventCard: ctx.eventCard,
    changedCard: ctx.changedCard,
    movedCard: ctx.movedCard,
    attacker: ctx.attacker,
    defender: ctx.defender,
    target: ctx.target,
    targetedCard: ctx.targetedCard,
    host: ctx.host,
  };
  const target = contextTargets[targetRef];
  if (Array.isArray(target)) return target.filter(Boolean);
  return target ? [target] : [];
}

/**
 * Apply move action - move cards between zones
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {Promise<boolean>} Whether any cards were moved
 */
export async function applyMove(action, ctx, targets) {
  // Resolve targetRef to get the actual cards
  let targetCards = targets?.[action.targetRef] || [];

  if ((!targetCards || targetCards.length === 0) && action.targetScope) {
    targetCards = resolveFieldScopeCards(action.targetScope, ctx, this.game, {
      engine: this,
    });
  }

  if (!targetCards || targetCards.length === 0) {
    targetCards = getContextTargetCards(action.targetRef, ctx);
  }

  if (!targetCards || targetCards.length === 0) {
    return action.allowEmpty === true;
  }

  const toZone = action.to || action.toZone;
  if (!toZone) {
    console.warn("move action missing destination zone:", action);
    return false;
  }

  let moved = false;

  for (const card of targetCards) {
    if (
      toZone === "field" &&
      card.summonRestrict === "shadow_heart_invocation_only"
    ) {
      console.log(
        `${card.name} can only be Special Summoned by "Shadow-Heart Invocation".`
      );
      continue;
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
      action.preservePosition !== true &&
      this.game &&
      destPlayer === this.game.player &&
      typeof this.game.chooseSpecialSummonPosition === "function";

    const defaultFieldPosition =
      toZone === "field" &&
      card.cardKind === "monster" &&
      action.preservePosition !== true
        ? "attack"
        : null;

    const applyMoveWithPosition = async (chosenPosition) => {
      const finalPosition = shouldPromptForPosition
        ? chosenPosition || action.position || defaultFieldPosition || "attack"
        : chosenPosition ?? action.position ?? defaultFieldPosition;
      const isCostMove =
        toZone === "graveyard" &&
        /cost|discard|material|tribute/i.test(
          String(action.contextLabel || action.targetRef || action.reason || ""),
        );
      const contextLabel =
        action.contextLabel || (isCostMove ? "cost" : "applyMove");

      if (this.game && typeof this.game.moveCard === "function") {
        const moveResult = await this.game.moveCard(card, destPlayer, toZone, {
          fromZone: action.fromZone,
          position: finalPosition,
          isFacedown: action.isFacedown,
          resetAttackFlags: action.resetAttackFlags,
          contextLabel,
          sourceCard: ctx?.source || null,
          effectId: ctx?.effect?.id || null,
          movedByEffect: true,
          skipSendToGraveReplacement: action.skipSendToGraveReplacement,
          skipSendToGraveActionReplacement:
            action.skipSendToGraveActionReplacement,
          awaitCardMovedEvent: true,
          awaitCardToGraveEvent: toZone === "graveyard",
          allowExtraDeckMonsterToHand: shouldAllowExtraDeckMonsterToHand(
            action,
            ctx
          ),
        });
        if (moveResult?.success === false) {
          return;
        }
        if (moveResult?.needsSelection && moveResult?.selectionContract) {
          return moveResult;
        }
      } else {
        const fromOwner =
          card.owner === "player" ? this.game.player : this.game.bot;
        const zones = [
          action.fromZone,
          "field",
          "hand",
          "deck",
          "graveyard",
          "spellTrap",
          "extraDeck",
          "banished",
        ].filter(Boolean);
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
        const moveResult = await applyMoveWithPosition(await positionChoice);
        if (moveResult?.needsSelection) return moveResult;
      } else {
        const moveResult = await applyMoveWithPosition(positionChoice);
        if (moveResult?.needsSelection) return moveResult;
      }
    } else {
      const moveResult = await applyMoveWithPosition(action.position);
      if (moveResult?.needsSelection) return moveResult;
    }
  }
  return moved;
}
