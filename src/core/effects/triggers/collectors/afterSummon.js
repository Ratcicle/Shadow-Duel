import { debugTriggerLog } from "./shared.js";

/**
 * Collects trigger entries for after_summon event.
 * @param {Object} payload - Summon event payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectAfterSummonTriggers(payload) {
  const entries = [];
  const orderRule =
    "summoner -> opponent; sources: summoned card -> field -> fieldSpell -> spellTrap -> hand";

  if (!payload || !payload.card || !payload.player) {
    return { entries, orderRule };
  }

  const { card, player: summoner, method, fromZone: summonFromZone } = payload;
  const actionContext = payload?.actionContext || null;
  const opponent = this.game?.getOpponent?.(summoner);
  const participants = [];

  if (summoner) {
    participants.push({
      owner: summoner,
      opponent,
      includeSummonedCard: true,
    });
  }
  if (opponent) {
    participants.push({
      owner: opponent,
      opponent: summoner,
      includeSummonedCard: false,
    });
  }

  const currentPhase = this.game?.phase;

  for (const side of participants) {
    const owner = side.owner;
    const other = side.opponent;
    if (!owner) continue;

    const sources = [];
    const addSource = (candidate) => {
      if (candidate && !sources.includes(candidate)) {
        sources.push(candidate);
      }
    };
    if (side.includeSummonedCard && card) {
      addSource(card);
    }
    if (Array.isArray(owner.field)) {
      for (const fieldCard of owner.field) {
        addSource(fieldCard);
      }
    }
    if (owner.fieldSpell) {
      addSource(owner.fieldSpell);
    }
    if (Array.isArray(owner.spellTrap)) {
      for (const spellTrap of owner.spellTrap) {
        addSource(spellTrap);
      }
    }
    if (Array.isArray(owner.hand)) {
      for (const handCard of owner.hand) {
        addSource(handCard);
      }
    }

    for (const sourceCard of sources) {
      if (!sourceCard?.effects || !Array.isArray(sourceCard.effects)) continue;

      const sourceZone = this.findCardZone(owner, sourceCard);
      const isFaceDownOnBoard =
        sourceCard?.isFacedown === true &&
        ["field", "spellTrap", "fieldSpell"].includes(sourceZone);
      const ctx = {
        source: sourceCard,
        player: owner,
        opponent: other,
        summonedCard: card,
        summonMethod: method,
        summonFromZone,
        currentPhase,
        actionContext,
      };

      for (const effect of sourceCard.effects) {
        if (!effect || effect.timing !== "on_event") continue;
        if (effect.event !== "after_summon") continue;

        // Face-down cards on the field cannot activate triggered effects
        if (isFaceDownOnBoard) {
          continue;
        }

        if (this.isEffectNegated(sourceCard)) {
          debugTriggerLog(this,
            `${sourceCard.name} effects are negated, skipping effect.`,
          );
          continue;
        }

        // Check requireFaceup condition
        if (effect.requireFaceup === true && sourceCard.isFacedown === true) {
          debugTriggerLog(this,
            `[after_summon] Skipping effect on ${sourceCard.name}: requireFaceup=true but card is facedown`,
          );
          continue;
        }

        if (sourceZone === "hand") {
          const requiresSelfInHand =
            effect?.condition?.requires === "self_in_hand";
          const isConditionalSummonFromHand = (effect.actions || []).some(
            (a) => a?.type === "conditional_summon_from_hand",
          );
          if (!requiresSelfInHand && !isConditionalSummonFromHand) {
            continue;
          }
        }

        if (effect.requireOpponentSummon === true) {
          const isOpponentSummon = summoner?.id && summoner.id !== owner.id;
          if (!isOpponentSummon) continue;
        }

        const optCheck = this.checkOncePerTurn(sourceCard, owner, effect);
        if (!optCheck.ok) {
          debugTriggerLog(this, optCheck.reason);
          continue;
        }

        const duelCheck = this.checkOncePerDuel(sourceCard, owner, effect);
        if (!duelCheck.ok) {
          debugTriggerLog(this, duelCheck.reason);
          continue;
        }

        const summonMethods = effect.summonMethods ?? effect.summonMethod;
        const summonFrom = effect.summonFrom ?? effect.requireSummonedFrom;
        if (summonMethods) {
          const methods = Array.isArray(summonMethods)
            ? summonMethods
            : [summonMethods];
          if (!methods.includes(method)) {
            continue;
          }
        }

        if (summonFrom && summonFromZone && summonFrom !== summonFromZone) {
          continue;
        }

        if (effect.requireSelfAsSummoned && ctx.summonedCard !== sourceCard) {
          continue;
        }

        if (effect.requirePhase) {
          const allowedPhases = Array.isArray(effect.requirePhase)
            ? effect.requirePhase
            : [effect.requirePhase];
          if (!allowedPhases.includes(currentPhase)) {
            continue;
          }
        }

        if (effect.condition) {
          const conditionMet = this.checkEffectCondition(
            effect.condition,
            sourceCard,
            owner,
            card,
            sourceZone,
            summonFromZone,
          );
          if (!conditionMet) continue;
        }

        if (Array.isArray(effect.conditions) && effect.conditions.length > 0) {
          const conditionResult = this.evaluateConditions(effect.conditions, ctx);
          if (!conditionResult?.ok) {
            debugTriggerLog(this,
              `[after_summon] Skipping ${effect.id}: ${
                conditionResult?.reason || "conditions not met"
              }.`,
            );
            continue;
          }
        }

        if (Array.isArray(effect.targets) && effect.targets.length > 0) {
          const precheckCtx = {
            ...ctx,
            activationContext: {
              ...(ctx.activationContext || {}),
              isPreview: true,
              preview: true,
              logTargets: false,
            },
          };
          const targetPreview = this.resolveTargets(effect.targets, precheckCtx);
          if (targetPreview?.ok === false && !targetPreview?.needsSelection) {
            debugTriggerLog(this,
              `[after_summon] Skipping trigger ${effect.id} on ${sourceCard.name}: ${
                targetPreview.reason || "no valid candidates"
              }`,
            );
            continue;
          }
          const requirements =
            targetPreview?.selectionContract?.requirements || [];
          const impossible = requirements.some((req) => {
            const min = Number(req?.min ?? 0);
            const candidates = Array.isArray(req?.candidates)
              ? req.candidates
              : [];
            return min > 0 && candidates.length < min;
          });
          if (impossible) continue;
        }

        const activationContext = this.buildTriggerActivationContext(
          sourceCard,
          owner,
          sourceZone,
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
      }
    }
  }

  return { entries, orderRule, onComplete: () => this.updatePassiveBuffs() };
}
