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

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function getDestructionProtectionType(cause) {
  return cause === "battle" ? "battle_destruction" : "effect_destruction";
}

function findConditionalDestructionProtection(
  game,
  card,
  owner,
  opponent,
  cause,
  fromZone,
) {
  if (!game || !card || !owner) return null;
  if (!Array.isArray(card.effects)) return null;

  const protectionType = getDestructionProtectionType(cause);
  for (const effect of card.effects) {
    if (!effect || effect.timing !== "passive") continue;
    const passive = effect.passive || {};
    if (passive.type !== "conditional_protection") continue;

    const protectedTypes = asArray(
      passive.protectionType ||
        passive.protectionTypes ||
        effect.protectionType ||
        effect.protectionTypes,
    );
    if (
      protectedTypes.length > 0 &&
      !protectedTypes.includes(protectionType)
    ) {
      continue;
    }

    if (
      (effect.requireFaceup === true || passive.requireFaceup === true) &&
      card.isFacedown
    ) {
      continue;
    }
    if (effect.requireZone && effect.requireZone !== fromZone) {
      continue;
    }

    const conditions = Array.isArray(effect.conditions)
      ? effect.conditions
      : Array.isArray(passive.conditions)
        ? passive.conditions
        : passive.condition
          ? [passive.condition]
          : [];

    if (conditions.length > 0) {
      const conditionResult = game.effectEngine?.evaluateConditions?.(
        conditions,
        {
          source: card,
          player: owner,
          opponent,
          activationZone: fromZone,
          sourceZone: fromZone,
        },
      );
      if (conditionResult && conditionResult.ok === false) {
        continue;
      }
    }

    return { effect, passive, protectionType };
  }

  return null;
}

function getProtectionAuraSources(game) {
  const sources = [];
  for (const sourceOwner of [game?.player, game?.bot]) {
    if (!sourceOwner) continue;
    for (const card of sourceOwner.field || []) {
      sources.push({ card, owner: sourceOwner, zone: "field" });
    }
    if (sourceOwner.fieldSpell) {
      sources.push({
        card: sourceOwner.fieldSpell,
        owner: sourceOwner,
        zone: "fieldSpell",
      });
    }
    for (const card of sourceOwner.spellTrap || []) {
      sources.push({ card, owner: sourceOwner, zone: "spellTrap" });
    }
  }
  return sources;
}

function targetOwnerMatchesRule(game, sourceOwner, targetOwner, ownerRule) {
  if (ownerRule === "any" || ownerRule === "both") return true;
  if (ownerRule === "opponent") {
    return game.getOpponent?.(sourceOwner) === targetOwner;
  }
  return sourceOwner === targetOwner;
}

function targetOwnerMatchesAura(game, sourceOwner, targetOwner, passive) {
  const ownerRules = asArray(
    passive.targetOwners || passive.targetOwner || passive.appliesTo || "self",
  );
  return ownerRules.some((rule) =>
    targetOwnerMatchesRule(game, sourceOwner, targetOwner, rule),
  );
}

function effectSourceIsActive(card, effect, passive, sourceZone) {
  if (!card || !effect || effect.timing !== "passive") return false;
  if (effect.requireZone && effect.requireZone !== sourceZone) return false;
  if (passive.requireZone && passive.requireZone !== sourceZone) return false;
  const requireFaceup =
    effect.requireFaceup === true || passive.requireFaceup === true;
  if (requireFaceup && card.isFacedown) return false;
  return true;
}

function findConditionalDestructionProtectionAura(
  game,
  card,
  owner,
  cause,
  fromZone,
) {
  if (!game || !card || !owner || cause === "battle") return null;
  const protectionType = getDestructionProtectionType(cause);

  for (const source of getProtectionAuraSources(game)) {
    const sourceCard = source.card;
    const sourceOwner = source.owner;
    if (!sourceCard || !Array.isArray(sourceCard.effects)) continue;

    for (const effect of sourceCard.effects) {
      const passive = effect?.passive || {};
      if (passive.type !== "conditional_destruction_protection_aura") {
        continue;
      }
      if (!effectSourceIsActive(sourceCard, effect, passive, source.zone)) {
        continue;
      }

      const protectedTypes = asArray(
        passive.protectionType ||
          passive.protectionTypes ||
          effect.protectionType ||
          effect.protectionTypes ||
          "effect_destruction",
      );
      if (
        protectedTypes.length > 0 &&
        !protectedTypes.includes(protectionType)
      ) {
        continue;
      }

      const targetZones = asArray(
        passive.targetZones || passive.targetZone || "field",
      );
      if (targetZones.length > 0 && !targetZones.includes(fromZone)) {
        continue;
      }
      if (!targetOwnerMatchesAura(game, sourceOwner, owner, passive)) {
        continue;
      }
      if (passive.targetRequireFaceup === true && card.isFacedown) {
        continue;
      }
      const targetFilters = passive.targetFilters || passive.filters || null;
      if (
        targetFilters &&
        !game.effectEngine?.cardMatchesFilters?.(card, targetFilters)
      ) {
        continue;
      }

      const opponent = game.getOpponent?.(sourceOwner) || null;
      const conditions = Array.isArray(effect.conditions)
        ? effect.conditions
        : Array.isArray(passive.conditions)
          ? passive.conditions
          : passive.condition
            ? [passive.condition]
            : [];
      if (conditions.length > 0) {
        const conditionResult = game.effectEngine?.evaluateConditions?.(
          conditions,
          {
            source: sourceCard,
            player: sourceOwner,
            opponent,
            protectedCard: card,
            protectedOwner: owner,
            activationZone: source.zone,
            sourceZone: source.zone,
          },
        );
        if (conditionResult && conditionResult.ok === false) {
          continue;
        }
      }

      return { sourceCard, sourceOwner, effect, passive, protectionType };
    }
  }

  return null;
}

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
      const sourcePlayer =
        options.sourcePlayer ||
        (sourceCard?.owner === "player"
          ? this.player
          : sourceCard?.owner === "bot"
            ? this.bot
            : sourceCard
              ? opponent
              : null);
      const fromZone =
        options.fromZone ||
        this.effectEngine?.findCardZone?.(owner, card) ||
        null;

      if (!fromZone) {
        return { destroyed: false, reason: "not_in_zone" };
      }

      const battleDestructionPreventionNegated =
        cause === "battle" &&
        typeof this.isBattleDestructionPreventionNegated === "function" &&
        this.isBattleDestructionPreventionNegated(card, {
          owner,
          preventionSourceOwner: owner,
          preventionSourceCard: card,
          fromZone,
        });

      if (cause !== "battle" && sourceCard && sourcePlayer) {
        const immunity = this.effectEngine?.checkImmunity?.(card, sourcePlayer, {
          effectType: "destruction",
          sourceCard,
        });
        if (immunity?.immune) {
          this.ui?.log?.(`${card.name} is unaffected by that card effect.`);
          return { destroyed: false, reason: immunity.reason || "immune" };
        }
      }

      // Check protection effects before destruction
      if (
        !battleDestructionPreventionNegated &&
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

      const conditionalProtection = battleDestructionPreventionNegated
        ? null
        : findConditionalDestructionProtection(
            this,
            card,
            owner,
            opponent,
            cause,
            fromZone,
          );
      if (conditionalProtection) {
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
        return {
          destroyed: false,
          reason: "protected",
          protectionType: conditionalProtection.protectionType,
        };
      }

      const auraProtection = findConditionalDestructionProtectionAura(
        this,
        card,
        owner,
        cause,
        fromZone,
      );
      if (auraProtection) {
        this.ui?.log?.(
          `${card.name} is protected from destruction by ${
            auraProtection.sourceCard?.name || "a card effect"
          }.`,
        );
        this.queueVisualFeedback?.({
          kind: "protect",
          targetCard: card,
          targetOwnerId: owner.id,
          targetZone: fromZone,
          tone: "blue",
        });
        return {
          destroyed: false,
          reason: "protected",
          protectionType: auraProtection.protectionType,
        };
      }

      if (
        !battleDestructionPreventionNegated &&
        this.effectEngine?.checkBeforeDestroyNegations
      ) {
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
          sourcePlayer,
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
        awaitCardToGraveEvent: options.awaitCardToGraveEvent !== false,
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
