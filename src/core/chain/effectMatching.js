import { CHAIN_CONTEXTS } from "./contexts.js";
import { isQuickSpell } from "../game/spellTrap/quickSpellRules.js";

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

export function getCurrentChainActivationContext(context) {
  const lastLink = this.getLastChainLink?.();
  if (!lastLink?.card || !lastLink?.player || !lastLink?.effect) return null;
  const activationType =
    lastLink.card.cardKind === "monster" ? "effect_activation" : "card_activation";
  return {
    ...(context || {}),
    originalContext: context || null,
    type: activationType,
    event: activationType,
    card: lastLink.card,
    player: lastLink.player,
    triggerPlayer: lastLink.player,
    effect: lastLink.effect,
    activationZone: lastLink.zone || null,
    activationAttempt: {
      card: lastLink.card,
      player: lastLink.player,
      effect: lastLink.effect,
      activationZone: lastLink.zone || null,
      negated: lastLink.negated === true,
    },
    respondingToChainLink: lastLink,
    addTriggerToChain: false,
  };
}

export function getEffectChainResponseContext(effect, context) {
  const responseContext = this.getCurrentChainActivationContext?.(context);
  if (!responseContext) return context || null;

  if (this.effectCanRespondToContext?.(effect, responseContext.type)) {
    return responseContext;
  }

  const originalExpectedEvent =
    {
      attack_declaration: "attack_declared",
      battle_step_open: "battle_step_open",
      summon: "after_summon",
      phase_change: "phase_end",
      card_activation: "card_activation",
      effect_activation: "effect_activation",
      effect_targeted: "effect_targeted",
      battle_damage: "battle_damage",
      battle_destroy: "battle_destroy",
    }[context?.type] || context?.event;

  const matchesOriginal =
    effect?.event === originalExpectedEvent ||
    this.effectCanRespondToContext?.(effect, context?.type);
  if (matchesOriginal) return context || null;

  const matchesLastActivation =
    effect?.event === responseContext.event ||
    this.effectCanRespondToContext?.(effect, responseContext.type);
  return matchesLastActivation ? responseContext : context || null;
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

function resolveEffectOwner(chainSystem, card, ownerPlayer = null) {
  if (ownerPlayer) return ownerPlayer;
  if (card?.owner === "player") return chainSystem.game?.player || null;
  if (card?.owner === "bot") return chainSystem.game?.bot || null;
  if (card?.controller === "player") return chainSystem.game?.player || null;
  if (card?.controller === "bot") return chainSystem.game?.bot || null;
  return null;
}

function buildChainPreviewContext(chainSystem, card, effect, context, ownerPlayer) {
  const cardOwner = resolveEffectOwner(chainSystem, card, ownerPlayer);
  const opponent =
    cardOwner && typeof chainSystem.getOpponent === "function"
      ? chainSystem.getOpponent(cardOwner)
      : card?.owner === "player"
        ? chainSystem.game?.bot || null
        : card?.owner === "bot"
          ? chainSystem.game?.player || null
          : null;

  return {
    source: card,
    player: cardOwner,
    opponent,
    effect,
    defender: context?.defender || context?.target,
    target: context?.target || context?.defender || null,
    attacker: context?.attacker,
    destroyed: context?.destroyed || null,
    destroyedOwner: context?.destroyedOwner || null,
    destroyedOwnerId: context?.destroyedOwnerId || null,
    destroyedPosition: context?.destroyedPosition || null,
    battleDestroyer: context?.battleDestroyer || context?.attacker || null,
    battleDestroyers: Array.isArray(context?.battleDestroyers)
      ? context.battleDestroyers
      : [context?.battleDestroyer || context?.attacker].filter(Boolean),
    summonedCard: context?.summonedCard || context?.card || null,
    summonMethod: context?.method || context?.summonMethod || null,
    summonFromZone: context?.fromZone || null,
    attackerOwner: context?.attackerOwner,
    defenderOwner: context?.defenderOwner,
    targetOwner: context?.targetOwner,
    actionContext: context || null,
    activationZone: "spellTrap",
    activationContext: {
      autoSelectSingleTarget: true,
      logTargets: true,
      chainContext: context?.type || null,
      event: context?.event || null,
      context: context || null,
      preview: true,
    },
  };
}

function effectActionsCanResolveInChain(
  chainSystem,
  card,
  effect,
  context,
  ownerPlayer,
) {
  const effectEngine = chainSystem.game?.effectEngine;
  if (typeof effectEngine?.checkActionPreviewRequirements !== "function") {
    return true;
  }

  const actionPreview = effectEngine.checkActionPreviewRequirements(
    effect.actions || [],
    buildChainPreviewContext(chainSystem, card, effect, context, ownerPlayer),
  );

  if (actionPreview?.ok === false) {
    chainSystem.log?.(
      `[findActivatableEffect] ${card.name}: actions not available - ${
        actionPreview.reason || "preview failed"
      }`,
    );
    return false;
  }

  return true;
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
    battle_step_open: "battle_step_open",
    summon: "after_summon",
    phase_change: "phase_end",
    card_activation: "card_activation",
    effect_activation: "effect_activation",
    effect_targeted: "effect_targeted",
    battle_damage: "battle_damage",
    battle_destroy: "battle_destroy",
  };
  const expectedEvent = contextToEvent[context?.type] || context?.event;

  for (const effect of card.effects) {
    if (!effect) continue;

    // For traps, look for on_activate, on_event, manual, or ignition timing
    if (card.cardKind === "trap") {
      // Check on_event effects (like Mirror Force)
      if (effect.timing === "on_event") {
        const activeContext =
          this.getEffectChainResponseContext?.(effect, context) || context;
        const activeExpectedEvent =
          contextToEvent[activeContext?.type] || activeContext?.event;
        // Match the effect's event with the context
        if (
          effect.event === expectedEvent ||
          effect.event === activeExpectedEvent ||
          this.effectCanRespondToContext?.(effect, activeContext?.type)
        ) {
          // Debug log for attack declaration traps
          if (activeContext?.type === "attack_declaration") {
            console.log(
              `[findActivatableEffect] trap=${card.name} ctx attackers/defenders`,
              {
                attacker: activeContext.attacker?.name,
                attackerOwner: activeContext.attackerOwner?.id,
                defender: activeContext.defender?.name || activeContext.target?.name,
                defenderOwner:
                  activeContext.defenderOwner?.id || activeContext.targetOwner?.id,
                cardOwner: ownerPlayer?.id || card.owner,
                effectEvent: effect.event,
                expectedEvent: activeExpectedEvent,
              },
            );
          }

          // Check additional conditions
          if (
            effect.requireOpponentAttack &&
            activeContext?.type === "attack_declaration"
          ) {
            // Only valid if the attacker is an opponent of this card's owner.
            // context.isOpponentAttack is computed from the defender's
            // perspective, so it is not reliable when checking the attacker's
            // own face-down responses.
            const cardOwnerId = ownerPlayer?.id || card.controller || card.owner;
            const attackerOwnerId =
              activeContext.attackerOwner?.id ||
              activeContext.attacker?.controller ||
              activeContext.attacker?.owner ||
              null;
            if (!attackerOwnerId || !cardOwnerId || attackerOwnerId === cardOwnerId) {
              continue;
            }
          }
          if (effect.requireOpponentSummon && activeContext?.type === "summon") {
            // Only valid if opponent summoned (check from card owner's perspective)
            const cardOwnerId = ownerPlayer?.id || card.owner;
            if (
              !isOpponentAction(
                activeContext.player?.id,
                cardOwnerId,
                activeContext.isOpponentSummon,
              )
            ) {
              continue;
            }
          }
          if (activeContext?.type === "summon") {
            const summonMethods = effect.summonMethods ?? effect.summonMethod;
            if (summonMethods) {
              const methods = Array.isArray(summonMethods)
                ? summonMethods
                : [summonMethods];
              const contextMethod = activeContext.method || activeContext.summonMethod;
              if (!methods.includes(contextMethod)) {
                continue;
              }
            }
          }
          const previewCtx = buildChainPreviewContext(
            this,
            card,
            effect,
            activeContext,
            ownerPlayer,
          );
          if (
            Array.isArray(effect.conditions) &&
            effect.conditions.length > 0 &&
            this.game?.effectEngine?.evaluateConditions
          ) {
            const condCheck = this.game.effectEngine.evaluateConditions(
              effect.conditions,
              previewCtx,
            );
            if (!condCheck?.ok) {
              continue;
            }
          }
          if (
            effect.oncePerTurn &&
            ownerPlayer &&
            this.game?.effectEngine?.checkOncePerTurn
          ) {
            const optCheck = this.game.effectEngine.checkOncePerTurn(
              card,
              ownerPlayer,
              effect,
            );
            if (!optCheck.ok) {
              continue;
            }
          }
          if (
            !effectActionsCanResolveInChain(
              this,
              card,
              effect,
              activeContext,
              ownerPlayer,
            )
          ) {
            continue;
          }
          // Check requireDefenderIsSelf (e.g., Dragon Spirit Sanctuary)
          if (
            effect.requireDefenderIsSelf &&
            activeContext?.type === "attack_declaration"
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
              activeContext.defenderOwner ||
              activeContext.targetOwner ||
              (activeContext.defender
                ? activeContext.defender.owner === "player"
                  ? this.game.player
                  : this.game.bot
                : null);
            if (ctxDefenderOwner?.id !== inferredOwner?.id) {
              console.log(
                `[findActivatableEffect] requireDefenderIsSelf mismatch for ${card.name}`,
                {
                  inferredOwner: inferredOwner?.id,
                  ctxDefenderOwner: ctxDefenderOwner?.id,
                  defender: activeContext.defender?.name || activeContext.target?.name,
                },
              );
              continue;
            }
          }
          // Check requireDefenderType (e.g., Dragon Spirit Sanctuary)
          if (
            effect.requireDefender &&
            activeContext?.type === "attack_declaration" &&
            !(activeContext.defender || activeContext.target)
          ) {
            console.log(
              `[findActivatableEffect] requireDefender mismatch for ${card.name}`,
              {
                defender: activeContext.defender?.name || activeContext.target?.name,
              },
            );
            continue;
          }

          if (
            effect.requireDefenderType &&
            activeContext?.type === "attack_declaration"
          ) {
            const defender = activeContext.defender || activeContext.target;
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
            console.log(
              `[findActivatableEffect] Checking targets for ${card.name}:`,
              {
                defender: previewCtx.defender?.name,
                defenderType: previewCtx.defender?.type,
                targets: effect.targets.map((t) => ({
                  id: t.id,
                  targetFromContext: t.targetFromContext,
                  type: t.type,
                })),
              },
            );

            const targetResult = this.game.effectEngine.resolveTargets(
              effect.targets,
              previewCtx,
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

    // For Quick Spells
    if (card.cardKind === "spell" && isQuickSpell(card)) {
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

        const cardOwner =
          ownerPlayer ||
          (card.owner === "player"
            ? this.game.player
            : card.owner === "bot"
              ? this.game.bot
              : null);
        const activationZone = cardOwner?.hand?.includes?.(card)
          ? "hand"
          : "spellTrap";
        const ctx = {
          source: card,
          player: cardOwner,
          opponent: cardOwner ? this.game.getOpponent?.(cardOwner) : null,
          activationZone,
          defender: context?.defender || context?.target,
          attacker: context?.attacker,
          summonedCard: context?.summonedCard || context?.card || null,
          summonMethod: context?.method || context?.summonMethod || null,
          summonFromZone: context?.fromZone || null,
          attackerOwner: context?.attackerOwner,
          defenderOwner: context?.defenderOwner,
          activationContext: {
            isPreview: true,
            preview: true,
            autoSelectSingleTarget: true,
            logTargets: false,
            quickSpellContext: {
              ...(context || {}),
              activationZone,
              effect,
            },
          },
        };

        if (effect.requirePhase) {
          const allowedPhases = Array.isArray(effect.requirePhase)
            ? effect.requirePhase
            : [effect.requirePhase];
          if (!allowedPhases.includes(this.game?.phase)) {
            continue;
          }
        }

        if (effect.conditions && this.game?.effectEngine?.evaluateConditions) {
          const condCheck = this.game.effectEngine.evaluateConditions(
            effect.conditions,
            ctx,
          );
          if (!condCheck.ok) {
            continue;
          }
        }

        if (
          effect.oncePerTurn &&
          cardOwner &&
          this.game?.effectEngine?.checkOncePerTurn
        ) {
          const optCheck = this.game.effectEngine.checkOncePerTurn(
            card,
            cardOwner,
            effect,
          );
          if (!optCheck.ok) {
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
              `[findActivatableEffect] ${card.name}: targets not available for Quick Spell - ${targetResult.reason}`,
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
