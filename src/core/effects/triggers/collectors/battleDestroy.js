import {
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
    "attacker owner -> destroyed owner; sources: field/fieldSpell/equips -> hand -> destroyed card";

  if (!payload || !payload.attacker || !payload.destroyed) {
    return { entries, orderRule };
  }

  const attacker = payload.attacker;
  const destroyed = payload.destroyed;
  const actionContext = payload?.actionContext || null;
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

    const fieldCards = [
      ...(owner.field || []),
      owner.fieldSpell,
      ...equipSpells,
    ].filter(Boolean);

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
        host: card.equippedTo || null,
        actionContext,
      };

      for (const effect of card.effects) {
        if (!effect || effect.timing !== "on_event") continue;
        if (effect.event !== "battle_destroy") continue;

        if (this.isEffectNegated(card)) {
          debugTriggerLog(this, `${card.name} effects are negated, skipping effect.`);
          continue;
        }

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
        if (effect.requireDestroyedIsOpponent) {
          const destroyedOwnerId =
            (ctx.destroyedOwner && ctx.destroyedOwner.id) || ctx.destroyedOwner;
          const opponentId = side.other?.id;
          if (!destroyedOwnerId || destroyedOwnerId !== opponentId) {
            continue;
          }
        }

        if (Array.isArray(effect.targets) && effect.targets.length > 0) {
          const precheckCtx = {
            source: card,
            player: owner,
            opponent: side.other,
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
