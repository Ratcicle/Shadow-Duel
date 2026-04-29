/**
 * destruction.js
 *
 * Destruction orchestration extracted from Game.js.
 * Wraps the move-to-graveyard pipeline with protection checks,
 * before-destroy negations, replacement-effect resolution, and
 * material-destroy stat tracking.
 *
 * Methods:
 *  - destroyCard
 */

export async function destroyCard(card, options = {}) {
  const result = await this.runZoneOp(
    "DESTROY_CARD",
    async () => {
      if (!card) {
        return { destroyed: false, reason: "invalid_card" };
      }

      const owner = card.owner === "player" ? this.player : this.bot;
      if (!owner) {
        return { destroyed: false, reason: "missing_owner" };
      }

      const cause = options.cause || options.reason || "effect";
      const sourceCard = options.sourceCard || options.source || null;
      const opponent = options.opponent || this.getOpponent(owner);
      const fromZone =
        options.fromZone ||
        this.effectEngine?.findCardZone?.(owner, card) ||
        null;

      if (!fromZone) {
        return { destroyed: false, reason: "not_in_zone" };
      }

      // Check protection effects before destruction
      if (
        Array.isArray(card.protectionEffects) &&
        card.protectionEffects.length > 0
      ) {
        const protectionType =
          cause === "battle" ? "battle_destruction" : "effect_destruction";

        const activeProtection = card.protectionEffects.find((p) => {
          if (p.type !== protectionType) return false;

          if (p.duration === "while_faceup") {
            return !card.isFacedown;
          }
          if (p.duration === "end_of_turn") {
            return this.turnCounter === p.grantedOnTurn;
          }
          if (typeof p.duration === "number") {
            return this.turnCounter <= p.duration;
          }
          return true;
        });

        if (activeProtection) {
          this.ui?.log?.(
            `${card.name} is protected from destruction by ${
              cause === "battle" ? "battle" : "card effects"
            }!`,
          );
          this.queueVisualFeedback?.({
            kind: "protect",
            targetCard: card,
            targetOwnerId: owner.id,
            targetZone: fromZone,
            tone: "blue",
          });
          return { destroyed: false, reason: "protected", protectionType };
        }
      }

      if (this.effectEngine?.checkBeforeDestroyNegations) {
        const negationResult =
          await this.effectEngine.checkBeforeDestroyNegations(card, {
            source: sourceCard,
            player: owner,
            opponent,
            cause,
            fromZone,
          });
        if (negationResult?.negated) {
          this.queueVisualFeedback?.({
            kind: "negate",
            targetCard: card,
            targetOwnerId: owner.id,
            targetZone: fromZone,
            tone: "blue",
          });
          return { destroyed: false, negated: true };
        }
      }

      const { replaced } = (await this.resolveDestructionWithReplacement(
        card,
        {
          cause,
          sourceCard,
          fromZone,
        },
      )) || { replaced: false };

      if (replaced) {
        return { destroyed: false, replaced: true };
      }

      const destroyVisualSource = this.ui?.captureCardAnimationSource?.(card, {
        ownerId: owner.id,
        zone: fromZone,
      });
      this.queueVisualFeedback?.({
        kind: "destroy",
        sourceCard,
        targetCard: card,
        targetOwnerId: owner.id,
        targetZone: fromZone,
        targetRect: destroyVisualSource?.rect || null,
        tone: cause === "battle" ? "red" : "violet",
      });

      const moveResult = await this.moveCard(card, owner, "graveyard", {
        fromZone: fromZone || undefined,
        wasDestroyed: true,
        destroyCause: cause,
        destroySource: sourceCard,
      });

      if (!moveResult || moveResult.success === false) {
        return {
          destroyed: false,
          reason: moveResult?.reason || "move_failed",
        };
      }

      if (moveResult.needsSelection) {
        return {
          destroyed: true,
          needsSelection: true,
          selectionContract: moveResult.selectionContract,
        };
      }

      return { destroyed: true };
    },
    {
      contextLabel: options.contextLabel || "destroyCard",
      card,
      fromZone: options.fromZone,
      toZone: "graveyard",
    },
  );
  if (result?.destroyed) {
    const sourceCard = options.sourceCard || options.source || null;
    this.recordMaterialDestroyedOpponentMonster(sourceCard, card);
  }
  return result;
}
