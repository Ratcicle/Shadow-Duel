import { CHAIN_CONTEXTS } from "./contexts.js";

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

export function effectCanRespondToContext(effect, contextType) {
  return (
    !!contextType &&
    Array.isArray(effect?.canRespondTo) &&
    effect.canRespondTo.includes(contextType)
  );
}

export function effectHasAction(effect, actionType) {
  if (!actionType || !Array.isArray(effect?.actions)) return false;
  return effect.actions.some((action) => action?.type === actionType);
}

export function isSummonNegationResponse(effect) {
  return (
    this.effectCanRespondToContext(effect, "summon_attempt") ||
    this.effectHasAction(effect, "negate_summon_or_activation_and_destroy")
  );
}

export function requiresExplicitSummonResponse(context) {
  return context?.type === "summon" || context?.type === "summon_attempt";
}

export function isExplicitAfterSummonEventResponse(effect, context) {
  return (
    context?.type === "summon" &&
    effect?.timing === "on_event" &&
    effect.event === "after_summon"
  );
}

export function canOfferEffectInChainContext(effect, context) {
  if (!this.requiresExplicitSummonResponse(context)) return true;
  if (context?.type === "summon_attempt") {
    return this.isSummonNegationResponse(effect);
  }
  return (
    this.isExplicitAfterSummonEventResponse(effect, context) ||
    this.effectCanRespondToContext(effect, context?.type)
  );
}

/**
 * Find an activatable effect on a card for the given context
 * @param {Object} card
 * @param {ChainContext} context
 * @returns {Object|null}
 */
export function findActivatableEffect(card, context, ownerPlayer = null) {
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
              },
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
                context.isOpponentAttack,
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
                context.isOpponentSummon,
              )
            ) {
              continue;
            }
          }
          if (context?.type === "summon") {
            const summonMethods = effect.summonMethods ?? effect.summonMethod;
            if (summonMethods) {
              const methods = Array.isArray(summonMethods)
                ? summonMethods
                : [summonMethods];
              const contextMethod = context.method || context.summonMethod;
              if (!methods.includes(contextMethod)) {
                continue;
              }
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
                },
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
              String(t).toLowerCase(),
            );
            if (!defender || !requiredTypesNorm.includes(defenderTypeNorm)) {
              console.log(
                `[findActivatableEffect] requireDefenderType mismatch for ${card.name}`,
                {
                  defender: defender?.name,
                  defenderType: defender?.type,
                  requiredTypes,
                },
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
              summonedCard: context.summonedCard || context.card || null,
              summonMethod: context.method || context.summonMethod || null,
              summonFromZone: context.fromZone || null,
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
              },
            );

            const targetResult = this.game.effectEngine.resolveTargets(
              effect.targets,
              ctx,
              null,
            );

            console.log(
              `[findActivatableEffect] Target result for ${card.name}:`,
              {
                ok: targetResult.ok,
                reason: targetResult.reason,
                needsSelection: targetResult.needsSelection,
              },
            );

            if (targetResult.ok === false) {
              this.log(
                `[findActivatableEffect] ${card.name}: targets not available - ${targetResult.reason}`,
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
        if (effect.requireFaceup && card.isFacedown) {
          continue;
        }
        if (effect.timing === "ignition" && card.isFacedown) {
          continue;
        }
        if (
          this.requiresExplicitSummonResponse(context) &&
          !this.canOfferEffectInChainContext(effect, context)
        ) {
          continue;
        }

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
          opponent: cardOwner ? this.game.getOpponent?.(cardOwner) : null,
          activationZone: "spellTrap",
          defender: context.defender || context.target,
          attacker: context.attacker,
          summonedCard: context.summonedCard || context.card || null,
          summonMethod: context.method || context.summonMethod || null,
          summonFromZone: context.fromZone || null,
          attackerOwner: context.attackerOwner,
          defenderOwner: context.defenderOwner,
          activationContext: {
            autoSelectSingleTarget: true,
            logTargets: false,
          },
        };

        if (effect.conditions && this.game?.effectEngine?.evaluateConditions) {
          const condCheck = this.game.effectEngine.evaluateConditions(
            effect.conditions,
            ctx,
          );
          if (!condCheck.ok) {
            continue;
          }
        }

        // Check if targets are available before allowing activation
        if (
          effect.targets &&
          effect.targets.length > 0 &&
          this.game?.effectEngine
        ) {
          const targetResult = this.game.effectEngine.resolveTargets(
            effect.targets,
            ctx,
            null,
          );

          if (targetResult.ok === false) {
            this.log(
              `[findActivatableEffect] ${card.name}: targets not available for on_activate - ${targetResult.reason}`,
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
        if (
          this.requiresExplicitSummonResponse(context) &&
          !this.canOfferEffectInChainContext(effect, context)
        ) {
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
            null,
          );

          if (targetResult.ok === false) {
            this.log(
              `[findActivatableEffect] ${card.name}: targets not available for quick-play - ${targetResult.reason}`,
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
 * @param {Object} player
 * @returns {Object|null}
 */
export function findQuickMonsterEffect(card, context, player) {
  if (!card?.effects || !Array.isArray(card.effects)) return null;

  const effectEngine = this.game?.effectEngine;
  const owner =
    player || (card.owner === "player" ? this.game.player : this.game.bot);
  const opponent = owner ? this.getOpponent(owner) : null;

  for (const effect of card.effects) {
    if (!effect) continue;

    if (!(effect.isQuickEffect || effect.speed === 2)) {
      continue;
    }

    if (
      this.requiresExplicitSummonResponse(context) &&
      !this.canOfferEffectInChainContext(effect, context)
    ) {
      continue;
    }

    if (
      effect.timing === "on_event" &&
      effect.allowManualActivation !== true
    ) {
      continue;
    }

    if (effect.requireZone && effect.requireZone !== "field") {
      continue;
    }

    if (effect.requireFaceup && card.isFacedown) {
      continue;
    }

    if (effect.requirePhase) {
      const allowedPhases = Array.isArray(effect.requirePhase)
        ? effect.requirePhase
        : [effect.requirePhase];
      if (!allowedPhases.includes(this.game?.phase)) {
        continue;
      }
    }

    if (effectEngine?.isEffectNegated && effectEngine.isEffectNegated(card)) {
      continue;
    }

    if (effect.oncePerTurn && effectEngine?.checkOncePerTurn && owner) {
      const optCheck = effectEngine.checkOncePerTurn(card, owner, effect);
      if (!optCheck.ok) {
        continue;
      }
    }

    const ctx = {
      source: card,
      player: owner,
      opponent,
      activationZone: "field",
      activationContext: {
        isPreview: true,
        preview: true,
        autoSelectSingleTarget: true,
        logTargets: false,
      },
      attacker: context?.attacker,
      defender: context?.defender,
      target: context?.target,
    };

    if (effect.conditions && effectEngine?.evaluateConditions) {
      const condCheck = effectEngine.evaluateConditions(
        effect.conditions,
        ctx,
      );
      if (!condCheck.ok) {
        continue;
      }
    }

    if (effect.targets && effect.targets.length > 0 && effectEngine) {
      const targetPreview = effectEngine.resolveTargets(
        effect.targets,
        ctx,
        null,
      );
      if (targetPreview?.ok === false && !targetPreview?.needsSelection) {
        continue;
      }
      const requirements =
        targetPreview?.selectionContract?.requirements || [];
      if (requirements.length === 0 && targetPreview?.needsSelection) {
        continue;
      }
      const impossible = requirements.some((req) => {
        const min = Number(req?.min ?? 0);
        const candidates = Array.isArray(req?.candidates)
          ? req.candidates
          : [];
        return min > 0 && candidates.length < min;
      });
      if (impossible) {
        continue;
      }
    }

    return effect;
  }

  return null;
}
