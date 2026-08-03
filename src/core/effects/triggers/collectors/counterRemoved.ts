import type {
  CollectedTriggerEventMap,
  CounterRemovedEventPayload,
} from "../../../contracts/events.js";
import type {
  TriggerCollectorHost,
  TriggerEffect,
  TriggerEntry,
  TriggerPackage,
  TriggerRuntimeCard,
  TriggerRuntimePlayer,
} from "../runtime.js";
import {
  cardMatchesEventFilters,
  debugTriggerLog,
  matchesZoneFilter,
} from "./shared.js";

function isBoardZone(zone: string | null | undefined): boolean {
  return zone === "field" || zone === "spellTrap" || zone === "fieldSpell";
}

function collectBoardSources(
  owner: TriggerRuntimePlayer | null | undefined,
): TriggerRuntimeCard[] {
  if (!owner) return [];
  const sources: TriggerRuntimeCard[] = [];
  if (owner.fieldSpell) sources.push(owner.fieldSpell);
  if (Array.isArray(owner.field)) sources.push(...owner.field);
  if (Array.isArray(owner.spellTrap)) sources.push(...owner.spellTrap);
  return sources.filter(Boolean);
}

function toArray(
  value: string | readonly string[] | null | undefined,
): readonly string[] {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  return value;
}

function matchesCounterType(
  effect: TriggerEffect,
  counterType: string,
): boolean {
  const configured = [
    ...toArray(effect.counterType),
    ...toArray(effect.counterTypes),
  ].filter(Boolean);
  return configured.length === 0 || configured.includes(counterType);
}

function getRemovedCardZone(
  payload: CounterRemovedEventPayload,
  index: number,
): string {
  const zones = Array.isArray(payload?.zones) ? payload.zones : [];
  return zones[index] || zones[0] || "field";
}

function removedCardsMatchFilters(
  engine: TriggerCollectorHost,
  effect: TriggerEffect,
  payload: CounterRemovedEventPayload,
  sourceOwner: TriggerRuntimePlayer,
): boolean {
  const filters =
    effect.removedCardFilters ||
    effect.counterCardFilters ||
    effect.eventCardFilters ||
    null;
  if (!filters) return true;

  const removedCards = Array.isArray(payload?.cards)
    ? payload.cards
    : payload?.card
      ? [payload.card]
      : [];
  if (removedCards.length === 0) return false;

  return removedCards.some((card, index) => {
    const eventOwner = engine.getOwnerByCard?.(card) || null;
    return cardMatchesEventFilters(engine, card, filters, {
      sourceOwner,
      eventOwner,
      fromZone: getRemovedCardZone(payload, index),
      toZone: getRemovedCardZone(payload, index),
    });
  });
}

/**
 * Collects trigger entries for counter_removed events.
 * The event is emitted once per removal action that removed one or more
 * counters from cards on the field.
 */
export async function collectCounterRemovedTriggers(
  this: TriggerCollectorHost,
  payload: CollectedTriggerEventMap["counter_removed"],
): Promise<TriggerPackage> {
  const entries: TriggerEntry[] = [];
  const orderRule =
    "counter remover field observers -> opponent field observers";

  if (!payload || !payload.counterType || Number(payload.amount || 0) <= 0) {
    return { entries, orderRule };
  }

  const remover = payload.player || null;
  const removerOpponent =
    payload.opponent ||
    this.game?.getOpponent?.(remover as TriggerRuntimePlayer) ||
    null;
  // Counter helpers preserve the legacy player/bot seat sentinel in partial
  // hosts. The established loop is safe for it (there are no board sources),
  // so correlation remains confined to this compatibility boundary.
  const participants = [
    { owner: remover, opponent: removerOpponent },
    { owner: removerOpponent, opponent: remover },
  ].filter((side) => side.owner != null) as Array<{
    owner: TriggerRuntimePlayer;
    opponent: TriggerRuntimePlayer | null;
  }>;
  const currentPhase = this.game?.phase || null;
  const removedCards = Array.isArray(payload.cards)
    ? payload.cards
    : payload.card
      ? [payload.card]
      : [];

  for (const side of participants) {
    const owner = side.owner;
    const other = side.opponent;
    for (const sourceCard of collectBoardSources(owner)) {
      if (!Array.isArray(sourceCard?.effects)) continue;

      const sourceZone = this.findCardZone?.(owner, sourceCard) || null;
      if (isBoardZone(sourceZone) && sourceCard.isFacedown === true) {
        continue;
      }

      for (const effect of sourceCard.effects) {
        if (!effect || effect.timing !== "on_event") continue;
        if (effect.event !== "counter_removed") continue;

        if (effect.requireFaceup === true && sourceCard.isFacedown === true) {
          continue;
        }

        if (
          effect.requireZone &&
          !matchesZoneFilter(sourceZone, effect.requireZone)
        ) {
          continue;
        }

        if (!matchesCounterType(effect, payload.counterType)) {
          continue;
        }

        const minAmount = Math.max(1, Number(effect.minAmount || 1));
        if (Number(payload.amount || 0) < minAmount) {
          continue;
        }

        if (effect.requireRemovedFromField === true && payload.fromField !== true) {
          continue;
        }

        const triggerPlayer = effect.triggerPlayer || "any";
        if (triggerPlayer === "self" && owner !== remover) continue;
        if (triggerPlayer === "opponent" && owner === remover) continue;

        if (!removedCardsMatchFilters(this, effect, payload, owner)) {
          continue;
        }

        if (effect.requirePhase) {
          const allowedPhases = Array.isArray(effect.requirePhase)
            ? effect.requirePhase
            : [effect.requirePhase];
          if (!allowedPhases.some((phase: string) => phase === currentPhase)) {
            continue;
          }
        }

        const ctx = {
          source: sourceCard,
          player: owner,
          opponent: other,
          eventPlayer: remover,
          eventOpponent: removerOpponent,
          counterType: payload.counterType,
          counterAmount: Number(payload.amount || 0),
          counterRemovedCard: removedCards[0] || null,
          counterRemovedCards: removedCards,
          counterRemovedZones: Array.isArray(payload.zones)
            ? payload.zones
            : [],
          fromField: payload.fromField === true,
          actionContext: payload.actionContext || null,
        };

        const optCheck = this.checkOncePerTurn(sourceCard, owner, effect);
        if (!optCheck.ok) continue;

        const duelCheck = this.checkOncePerDuel(sourceCard, owner, effect);
        if (!duelCheck.ok) continue;

        if (Array.isArray(effect.targets) && effect.targets.length > 0) {
          const precheckCtx = {
            ...ctx,
            activationContext: { logTargets: false },
          };
          let missingTarget = false;
          for (const targetDef of effect.targets) {
            if (!targetDef) continue;
            const min = Number(targetDef.count?.min ?? 1);
            if (min <= 0) continue;
            const { candidates } = this.selectCandidates(targetDef, precheckCtx);
            if (!candidates || candidates.length < min) {
              missingTarget = true;
              break;
            }
          }
          if (missingTarget) continue;
        }

        const activationContext = {
          ...this.buildTriggerActivationContext(sourceCard, owner, sourceZone),
          triggeredByEvent: "counter_removed",
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

        if (entry) entries.push(entry);
      }
    }
  }

  return { entries, orderRule, onComplete: () => this.updatePassiveBuffs() };
}
