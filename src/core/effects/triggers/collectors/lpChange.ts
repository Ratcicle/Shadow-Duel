import type { CollectedTriggerEventMap } from "../../../contracts/events.js";
import type { TriggerCollectorHost, TriggerEntry, TriggerPackage } from "../runtime.js";
import { debugTriggerLog, isTriggerSourceLegal } from "./shared.js";

/**
 * Collects trigger entries for lp_change events.
 * @param {Object} payload - LP change payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectLpChangeTriggers(
  this: TriggerCollectorHost,
  payload: CollectedTriggerEventMap["lp_change"],
): Promise<TriggerPackage> {
  const entries: TriggerEntry[] = [];
  const orderRule =
    "LP recipient -> opponent; sources: fieldSpell -> field -> spellTrap";

  if (!payload || !payload.player) {
    return { entries, orderRule };
  }

  const lpPlayer = payload.player;
  const opponent = this.game?.getOpponent?.(lpPlayer);
  const participants = [];

  participants.push({ owner: lpPlayer, opponent });
  if (opponent) {
    participants.push({ owner: opponent, opponent: lpPlayer });
  }

  const currentPhase = this.game?.phase;
  const hasValues = typeof payload.before === "number" && typeof payload.after === "number";
  const delta = hasValues ? Number(payload.after) - Number(payload.before) : null;
  const lpGained = Math.max(0, delta ?? payload.lpGained ?? 0);
  const lpLost = Math.max(0, delta === null ? payload.lpLost ?? payload.lpPaid ?? 0 : -delta);
  const lpPaid = Math.min(lpLost, Math.max(0, payload.lpPaid ?? 0));
  const damageAmount = Math.min(lpLost, Math.max(0, payload.damageAmount ?? 0));
  if (lpGained === 0 && lpLost === 0) return { entries, orderRule };
  const before = payload.before ?? null;
  const after = payload.after ?? null;
  const lpChangeSourceCard = payload.sourceCard || null;

  for (const side of participants) {
    const owner = side.owner;
    const other = side.opponent;
    if (!owner) continue;

    const sources = [];
    if (owner.fieldSpell) {
      sources.push(owner.fieldSpell);
    }
    if (Array.isArray(owner.field)) {
      sources.push(...owner.field);
    }
    if (Array.isArray(owner.spellTrap)) {
      sources.push(...owner.spellTrap);
    }

    for (const sourceCard of sources) {
      if (!sourceCard?.effects || !Array.isArray(sourceCard.effects)) continue;

      const sourceZone = this.findCardZone(owner, sourceCard);
      const ctx = {
        ...payload,
        source: sourceCard,
        player: owner,
        opponent: other,
        lpChangePlayer: lpPlayer,
        lpGained,
        lpLost,
        lpPaid,
        damageAmount,
        before,
        after,
        sourceCard: lpChangeSourceCard,
        lpChangeSourceCard,
        currentPhase,
      };

      for (const effect of sourceCard.effects) {
        if (!effect || effect.timing !== "on_event") continue;
        const compatibilityDamage = effect.event === "opponent_damage";
        if (effect.event !== "lp_change" && !compatibilityDamage) continue;
        if (!isTriggerSourceLegal(sourceCard, effect, sourceZone)) continue;

        const triggerPlayer = compatibilityDamage ? "opponent" : effect.triggerPlayer || "any";
        if (triggerPlayer === "self" && owner !== lpPlayer) continue;
        if (triggerPlayer === "opponent" && owner === lpPlayer) continue;

        const kind = compatibilityDamage ? "damage" : effect.lpChangeKind || "gain";
        const amount = kind === "gain" ? lpGained : kind === "loss" ? lpLost : damageAmount;
        if (amount <= 0 || amount < (effect.minAmount ?? (kind === "gain" ? effect.minLpGained : undefined) ?? 0)) continue;

        const sourceFilters =
          effect.lpChangeSourceFilters || effect.sourceCardFilters || null;
        if (
          sourceFilters &&
          !this.cardMatchesFilters(lpChangeSourceCard, sourceFilters)
        ) {
          continue;
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

        if (effect.requirePhase) {
          const allowedPhases = Array.isArray(effect.requirePhase)
            ? effect.requirePhase
            : [effect.requirePhase];
          if (!allowedPhases.includes(currentPhase)) {
            continue;
          }
        }

        const activationContext = {
          ...this.buildTriggerActivationContext(sourceCard, owner, sourceZone),
          triggeredByEvent: "lp_change",
        };

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
