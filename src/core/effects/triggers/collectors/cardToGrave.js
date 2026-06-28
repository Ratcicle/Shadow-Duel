import {
  cardMatchesEventFilters,
  debugTriggerLog,
  getCardControllerId,
  matchesLastSummonMethod,
  matchesLastSummonProcedure,
} from "./shared.js";

/**
 * Collects trigger entries for card_to_grave event.
 * @param {Object} payload - Card to grave event payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectCardToGraveTriggers(payload) {
  const entries = [];
  const orderRule =
    "card owner self-source -> card owner field/spell observers -> opponent field/spell observers";

  const { card, player, opponent, fromZone, toZone } = payload || {};
  const actionContext = payload?.actionContext || null;
  const contextLabel = payload?.contextLabel || null;
  if (!card || !player) return { entries, orderRule };

  const resolvedOpponent = opponent || this.game?.getOpponent?.(player);

  const devMode = this.game?.devModeEnabled || false;
  const debugLog = (...args) => {
    if (devMode) debugTriggerLog(this, ...args);
  };

  debugLog(
    `[handleCardToGraveEvent] ${card.name} entered graveyard. card.owner="${card.owner}", ctx.player.id="${player.id}", ctx.opponent.id="${resolvedOpponent?.id}", wasDestroyed=${payload?.wasDestroyed}`,
  );
  debugLog(
    `[handleCardToGraveEvent] ${card.name} entered graveyard from ${fromZone}. Card has ${
      Array.isArray(card.effects) ? card.effects.length : 0
    } effects.`,
  );

  const collectFromSource = (sourceCard, owner, other, sourceZone, effect) => {
    if (!effect || effect.timing !== "on_event") {
      if (devMode) {
          debugLog(`[handleCardToGraveEvent] Skipping effect: not on_event`);
      }
      return;
    }
    if (effect.event !== "card_to_grave") {
      if (devMode) {
        debugLog(
          `[handleCardToGraveEvent] Skipping effect: event is ${effect.event}, not card_to_grave`,
        );
      }
      return;
    }

    const ownEffectWasNegatedAtFieldExit =
      sourceCard === card && payload?.effectsNegatedAtFieldExit === true;
    const allowNegatedFieldExit =
      ownEffectWasNegatedAtFieldExit &&
      effect.allowIfEffectsNegatedAtFieldExit === true;
    if (
      (ownEffectWasNegatedAtFieldExit && !allowNegatedFieldExit) ||
      (!allowNegatedFieldExit && this.isEffectNegated(sourceCard))
    ) {
      debugLog(
        `[handleCardToGraveEvent] ${sourceCard.name} effects are negated, skipping effect.`,
      );
      return;
    }

    const allowedContextLabels = [
      ...(effect.contextLabel ? [effect.contextLabel] : []),
      ...(Array.isArray(effect.contextLabels) ? effect.contextLabels : []),
    ].filter(Boolean);
    if (
      allowedContextLabels.length > 0 &&
      !allowedContextLabels.includes(contextLabel)
    ) {
      debugLog(
        `[handleCardToGraveEvent] Skipping ${effect.id}: contextLabel "${contextLabel}" not in [${allowedContextLabels.join(", ")}].`,
      );
      return;
    }

    if (effect.requireZone && sourceZone !== effect.requireZone) {
      if (devMode) {
        debugLog(
          `[handleCardToGraveEvent] Skipping ${effect.id}: requireZone ${effect.requireZone} but source zone was ${sourceZone}.`,
        );
      }
      return;
    }

    // Check requireFaceup condition (rare case: card destroyed while facedown)
    if (effect.requireFaceup === true && sourceCard.isFacedown === true) {
      debugLog(
        `[card_to_grave] Skipping effect on ${sourceCard.name}: requireFaceup=true but card was facedown`,
      );
      return;
    }

    if (
      effect.eventCardFilters &&
      !cardMatchesEventFilters(this, card, effect.eventCardFilters, {
        sourceCard,
        sourceOwner: owner,
        eventOwner: player,
        fromZone,
        toZone,
        contextLabel,
      })
    ) {
      if (devMode) {
        debugLog(
          `[handleCardToGraveEvent] Skipping ${effect.id}: event card filters did not match ${card.name}.`,
        );
      }
      return;
    }

    debugLog(
      `[handleCardToGraveEvent] Found card_to_grave effect: ${effect.id}`,
    );

    if (effect.requireSelfAsDestroyed && !payload?.wasDestroyed) {
      debugLog(
        `[handleCardToGraveEvent] Skipping ${effect.id}: requires destruction.`,
      );
      return;
    }

    if (effect.requireSelfWasSummonedBy) {
      const lastSummonMethod = sourceCard.lastSummonMethod || null;

      if (!matchesLastSummonMethod(sourceCard, effect.requireSelfWasSummonedBy)) {
        const allowedMethods = Array.isArray(effect.requireSelfWasSummonedBy)
          ? effect.requireSelfWasSummonedBy
          : [effect.requireSelfWasSummonedBy];
        debugLog(
          `[handleCardToGraveEvent] Skipping ${effect.id}: requires last summon method ${allowedMethods.join(
            "/",
          )}, but was "${lastSummonMethod}".`,
        );
        return;
      }
    }

    if (effect.requireSelfSummonProcedure) {
      const lastSummonProcedure = sourceCard.lastSummonProcedure || null;

      if (
        !matchesLastSummonProcedure(
          sourceCard,
          effect.requireSelfSummonProcedure,
        )
      ) {
        const allowedProcedures = Array.isArray(effect.requireSelfSummonProcedure)
          ? effect.requireSelfSummonProcedure
          : [effect.requireSelfSummonProcedure];
        debugLog(
          `[handleCardToGraveEvent] Skipping ${effect.id}: requires summon procedure ${allowedProcedures.join(
            "/",
          )}, but was "${lastSummonProcedure}".`,
        );
        return;
      }
    }

    if (effect.requireDestroyedByOpponent === true) {
      const sourceControllerId = getCardControllerId(payload?.destroySource);
      const opponentId = resolvedOpponent?.id || resolvedOpponent || null;

      if (
        !sourceControllerId ||
        !opponentId ||
        sourceControllerId !== opponentId
      ) {
        debugLog(
          `[handleCardToGraveEvent] Skipping ${effect.id}: destruction source was not controlled by opponent.`,
        );
        return;
      }
    }

    // ✅ Check condition for destruction type (battle vs effect)
    if (effect.condition) {
      const condType = effect.condition.type;
      const destroyCause = payload?.destroyCause;

      if (condType === "destroyed_by_battle") {
        if (destroyCause !== "battle") {
          debugLog(
            `[handleCardToGraveEvent] Skipping ${effect.id}: requires destruction by battle, but cause was "${destroyCause}".`,
          );
          return;
        }
      } else if (condType === "destroyed_by_effect") {
        if (destroyCause !== "effect") {
          debugLog(
            `[handleCardToGraveEvent] Skipping ${effect.id}: requires destruction by effect, but cause was "${destroyCause}".`,
          );
          return;
        }
      } else if (condType === "destroyed_by_battle_or_effect") {
        if (destroyCause !== "battle" && destroyCause !== "effect") {
          debugLog(
            `[handleCardToGraveEvent] Skipping ${effect.id}: requires destruction by battle or effect, but cause was "${destroyCause}".`,
          );
          return;
        }
      }
    }

    const ctx = {
      source: sourceCard,
      player: owner,
      opponent: other,
      eventCard: card,
      movedCard: card,
      eventPlayer: player,
      eventOpponent: resolvedOpponent,
      discardedCard: fromZone === "hand" ? card : null,
      fromZone,
      toZone,
      contextLabel,
      actionContext,
    };

    if (Array.isArray(effect.conditions) && effect.conditions.length > 0) {
      const conditionResult = this.evaluateConditions(effect.conditions, ctx);
      if (!conditionResult?.ok) {
        debugLog(
          `[card_to_grave] Skipping ${effect.id}: ${
            conditionResult?.reason || "conditions not met"
          }.`,
        );
        return;
      }
    }

    const optCheck = this.checkOncePerTurn(sourceCard, owner, effect);
    if (!optCheck.ok) {
      debugLog(
        `[handleCardToGraveEvent] Once per turn check failed: ${optCheck.reason}`,
      );
      return;
    }

    const duelCheck = this.checkOncePerDuel(sourceCard, owner, effect);
    if (!duelCheck.ok) {
      debugLog(
        `[handleCardToGraveEvent] Once per duel check failed: ${duelCheck.reason}`,
      );
      return;
    }

    debugLog(
      `[handleCardToGraveEvent] fromZone check: effect.fromZone="${effect.fromZone}", actual fromZone="${fromZone}"`,
    );

    if (
      effect.fromZone &&
      effect.fromZone !== "any" &&
      effect.fromZone !== fromZone
    ) {
      debugLog(
        `[handleCardToGraveEvent] Skipping: fromZone mismatch (${effect.fromZone} !== ${fromZone})`,
      );
      return;
    }

    debugLog(
      `[card_to_grave] About to resolve targets for ${
        sourceCard.name
      }. Targets definition: ${JSON.stringify(effect.targets)}`,
    );

    // Precheck genérico: triggers que exigem alvos só devem entrar na chain
    // se houver candidatos válidos para todos os targets obrigatórios.
    // Isso evita ativações inválidas como Shadow-Heart Coward sem monstro
    // do oponente em campo.
    if (Array.isArray(effect.targets) && effect.targets.length > 0) {
      const precheckCtx = {
        ...ctx,
        fromZone,
        toZone,
        contextLabel,
        actionContext,
        activationContext: { logTargets: false },
      };
      let unmetRequiredTarget = null;
      for (const targetDef of effect.targets) {
        if (!targetDef) continue;
        const min = Number(targetDef.count?.min ?? 1);
        if (min <= 0) continue;
        const { candidates } = this.selectCandidates(targetDef, precheckCtx);
        if (!candidates || candidates.length < min) {
          unmetRequiredTarget = targetDef.id || targetDef.zone || "target";
          break;
        }
      }
      if (unmetRequiredTarget) {
        debugLog(
          `[card_to_grave] Skipping trigger ${effect.id} on ${sourceCard.name}: no valid candidates for required target "${unmetRequiredTarget}"`,
        );
        return;
      }
    }

    const activationContext = this.buildTriggerActivationContext(
      sourceCard,
      owner,
      sourceZone || this.findCardZone(owner, sourceCard) || toZone || "graveyard",
    );

    const entry = this.buildTriggerEntry({
      sourceCard,
      owner,
      effect,
      ctx,
      activationContext,
      selectionKind: "triggered",
      selectionMessage: "Select target(s) for the triggered effect.",
    });

    if (entry) {
      entries.push(entry);
    }
  };

  if (Array.isArray(card.effects)) {
    const sourceZone = toZone || this.findCardZone(player, card) || "graveyard";
    for (const effect of card.effects) {
      collectFromSource(card, player, resolvedOpponent, sourceZone, effect);
    }
  }

  const observerSides = [
    { owner: player, other: resolvedOpponent },
    { owner: resolvedOpponent, other: player },
  ].filter((side) => side.owner);

  for (const { owner, other } of observerSides) {
    const observerZones = ["field", "spellTrap", "fieldSpell"];
    for (const observerZone of observerZones) {
      const zoneCards =
        observerZone === "fieldSpell"
          ? owner.fieldSpell
            ? [owner.fieldSpell]
            : []
          : Array.isArray(owner[observerZone])
            ? owner[observerZone]
            : [];

      for (const sourceCard of zoneCards) {
        if (!sourceCard || sourceCard === card) continue;
        if (!Array.isArray(sourceCard.effects)) continue;
        if (sourceCard.isFacedown === true) continue;

        const sourceZone =
          this.findCardZone?.(owner, sourceCard) || observerZone;
        for (const effect of sourceCard.effects) {
          if (!effect?.eventCardFilters) continue;
          collectFromSource(sourceCard, owner, other, sourceZone, effect);
        }
      }
    }
  }

  return { entries, orderRule };
}
