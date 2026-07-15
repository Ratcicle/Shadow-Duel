import {
  cardMatchesEventFilters,
  debugTriggerLog,
  matchesLastSummonMethod,
  matchesLastSummonProcedure,
} from "./shared.js";

/**
 * Collects trigger entries for battle_destroy event.
 * @param {Object} payload - Battle destroy event payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectBattleDestroyTriggers(payload) {
  const entries = [];
  const orderRule =
    "attacker owner -> destroyed owner; sources: field/fieldSpell/active spellTrap/equips -> hand -> destroyed card";

  if (!payload || !payload.attacker || !payload.destroyed) {
    return { entries, orderRule };
  }

  const attacker = payload.attacker;
  const destroyed = payload.destroyed;
  const destroyedPosition =
    payload.destroyedPosition || destroyed.position || null;
  const actionContext = payload?.actionContext || null;
  const battleDestroyer = payload.battleDestroyer || attacker || null;
  const battleDestroyers = Array.isArray(payload.battleDestroyers)
    ? payload.battleDestroyers
    : battleDestroyer
      ? [battleDestroyer]
      : [];
  const attackerOwner = payload.attackerOwner || this.getOwnerByCard(attacker);
  const destroyedOwner =
    payload.destroyedOwner || this.getOwnerByCard(destroyed);

  const participants = [
    { owner: attackerOwner, other: destroyedOwner },
    { owner: destroyedOwner, other: attackerOwner },
  ];

  const processedDestroyedCard = new Set();

  for (const side of participants) {
    const owner = side.owner;
    if (!owner) continue;

    const equipSpells = (owner.spellTrap || []).filter(
      (c) => c && c.subtype === "equip" && c.equippedTo,
    );
    const activeSpellTraps = (owner.spellTrap || []).filter(
      (c) =>
        c &&
        c.isFacedown !== true &&
        (c.cardKind === "spell" || c.cardKind === "trap") &&
        (c.subtype === "continuous" || c.subtype === "field"),
    );

    const fieldCards = [
      ...(owner.field || []),
      owner.fieldSpell,
      ...activeSpellTraps,
      ...equipSpells,
    ].filter((card, index, cards) => card && cards.indexOf(card) === index);

    const handCards = owner.hand || [];
    const triggerSources = [...fieldCards, ...handCards];

    // Add destroyed card to trigger sources only once (avoid double processing in mutual destruction)
    if (
      destroyed &&
      destroyedOwner === owner &&
      !triggerSources.includes(destroyed) &&
      !processedDestroyedCard.has(destroyed)
    ) {
      triggerSources.push(destroyed);
      processedDestroyedCard.add(destroyed);
    }

    for (const card of triggerSources) {
      if (!card || !card.effects || !Array.isArray(card.effects)) continue;

      const ctx = {
        source: card,
        player: owner,
        opponent: side.other,
        attacker,
        destroyed,
        attackerOwner,
        destroyedOwner,
        battleDestroyer,
        battleDestroyers,
        destroyedPosition,
        host: card.equippedTo || null,
        actionContext,
      };

      for (const effect of card.effects) {
        if (!effect || effect.timing !== "on_event") continue;
        if (effect.event !== "battle_destroy") continue;

        if (effect.requireZone) {
          const sourceZone = this.findCardZone?.(owner, card) || null;
          if (sourceZone !== effect.requireZone) continue;
        }

        // Check requireFaceup condition
        if (effect.requireFaceup === true && card.isFacedown === true) {
          debugTriggerLog(this,
            `[battle_destroy] Skipping effect on ${card.name}: requireFaceup=true but card is facedown`,
          );
          continue;
        }

        if (
          effect.requireSelfWasSummonedBy &&
          !matchesLastSummonMethod(card, effect.requireSelfWasSummonedBy)
        ) {
          continue;
        }
        if (
          effect.requireSelfSummonProcedure &&
          !matchesLastSummonProcedure(card, effect.requireSelfSummonProcedure)
        ) {
          continue;
        }

        const optCheck = this.checkOncePerTurn(card, owner, effect);
        if (!optCheck.ok) {
          debugTriggerLog(this, optCheck.reason);
          continue;
        }

        const duelCheck = this.checkOncePerDuel(card, owner, effect);
        if (!duelCheck.ok) {
          debugTriggerLog(this, duelCheck.reason);
          continue;
        }

        if (effect.requireSelfAsAttacker && ctx.attacker !== card) {
          continue;
        }
        if (effect.requireSelfAsDestroyed && ctx.destroyed !== card) {
          continue;
        }

        const destroyedCardFilters =
          effect.destroyedCardFilters || effect.requireDestroyedCardFilters;
        if (
          destroyedCardFilters &&
          !cardMatchesEventFilters(this, ctx.destroyed, destroyedCardFilters, {
            sourceOwner: owner,
            eventOwner: ctx.destroyedOwner,
            fromZone: "field",
            toZone: "graveyard",
          })
        ) {
          debugTriggerLog(
            this,
            `[battle_destroy] Skipping ${effect.id}: destroyed card filters did not match ${ctx.destroyed?.name}.`,
          );
          continue;
        }

        if (effect.requireDestroyedIsOpponent) {
          const destroyedOwnerId =
            (ctx.destroyedOwner && ctx.destroyedOwner.id) || ctx.destroyedOwner;
          const opponentId = side.other?.id;
          if (!destroyedOwnerId || destroyedOwnerId !== opponentId) {
            continue;
          }
        }

        const requiredDestroyedPosition =
          effect.requireDestroyedPosition || effect.destroyedPosition;
        if (requiredDestroyedPosition) {
          const allowedPositions = Array.isArray(requiredDestroyedPosition)
            ? requiredDestroyedPosition
            : [requiredDestroyedPosition];
          if (!allowedPositions.includes(ctx.destroyedPosition)) {
            continue;
          }
        }

        if (Array.isArray(effect.targets) && effect.targets.length > 0) {
          const precheckCtx = {
            source: card,
            player: owner,
            opponent: side.other,
            attacker,
            destroyed,
            attackerOwner,
            destroyedOwner,
            battleDestroyer,
            battleDestroyers,
            destroyedPosition,
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
            debugTriggerLog(this,
              `[battle_destroy] Skipping trigger ${effect.id} on ${card.name}: no valid candidates for required target "${unmetRequiredTarget}"`,
            );
            continue;
          }
        }

        if (effect.requireOwnMonsterArchetype) {
          const destroyedCard = ctx.destroyed;
          const destroyedOwnerId =
            (ctx.destroyedOwner && ctx.destroyedOwner.id) || ctx.destroyedOwner;
          const ownerId = owner?.id || owner;
          if (!destroyedCard || destroyedOwnerId !== ownerId) continue;
          if (destroyedCard.cardKind && destroyedCard.cardKind !== "monster")
            continue;
          const required = effect.requireOwnMonsterArchetype;
          const archetype = destroyedCard.archetype;
          const matches = Array.isArray(archetype)
            ? archetype.includes(required)
            : typeof archetype === "string" && archetype.includes(required);
          if (!matches) continue;
        }
        if (effect.requireEquippedAsAttacker) {
          if (!card.equippedTo) continue;
          if (ctx.attacker !== card.equippedTo) continue;
        }
        if (effect.requireSelfAsBattleDestroyer) {
          const battleDestroyers = Array.isArray(ctx.battleDestroyers)
            ? ctx.battleDestroyers
            : ctx.attacker
              ? [ctx.attacker]
              : [];
          if (!battleDestroyers.includes(card)) continue;
        }
        if (effect.requireEquippedAsBattleDestroyer) {
          if (!card.equippedTo) continue;
          const battleDestroyers = Array.isArray(ctx.battleDestroyers)
            ? ctx.battleDestroyers
            : ctx.attacker
              ? [ctx.attacker]
              : [];
          if (!battleDestroyers.includes(card.equippedTo)) continue;
        }

        if (Array.isArray(effect.conditions) && effect.conditions.length > 0) {
          const conditionResult = this.evaluateConditions(effect.conditions, ctx);
          if (!conditionResult?.ok) {
            debugTriggerLog(
              this,
              `[battle_destroy] Skipping ${effect.id}: ${
                conditionResult?.reason || "conditions not met"
              }.`,
            );
            continue;
          }
        }

        const activationContext = this.buildTriggerActivationContext(
          card,
          owner,
        );

        const entry = this.buildTriggerEntry({
          sourceCard: card,
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
      }
    }
  }

  return { entries, orderRule, onComplete: () => this.updatePassiveBuffs() };
}
