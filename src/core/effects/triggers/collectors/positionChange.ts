import type { CollectedTriggerEventMap } from "../../../contracts/events.js";
import type { BattlePosition } from "../../../contracts/cards.js";
import type {
  TriggerCardFilter,
  TriggerCollectorHost,
  TriggerEffect,
  TriggerEffectLike,
  TriggerEntry,
  TriggerGamePort,
  TriggerPackage,
  TriggerRuntimeCard,
  TriggerRuntimePlayer,
  TriggerZone,
} from "../runtime.js";
import {
  cardMatchesEventFilters,
  debugTriggerLog,
  matchesOwnerFilter,
  matchesZoneFilter,
} from "./shared.js";

function resolvePlayerForCard(
  game: TriggerGamePort | null | undefined,
  card: TriggerRuntimeCard | null | undefined,
  fallback: TriggerRuntimePlayer | null = null,
): TriggerRuntimePlayer | null {
  if (!game || !card) return fallback;
  if (card.owner === "player") return game.player || fallback;
  if (card.owner === "bot") return game.bot || fallback;
  return fallback;
}

function collectBoardSources(
  owner: TriggerRuntimePlayer | null | undefined,
): TriggerRuntimeCard[] {
  if (!owner) return [];
  const sources: TriggerRuntimeCard[] = [];
  if (Array.isArray(owner.field)) sources.push(...owner.field);
  if (Array.isArray(owner.spellTrap)) sources.push(...owner.spellTrap);
  if (owner.fieldSpell) sources.push(owner.fieldSpell);
  return sources.filter(Boolean);
}

function hasHandPositionChangeTrigger(
  card: TriggerRuntimeCard | null | undefined,
): boolean {
  return (card?.effects || []).some(
    (effect) =>
      effect &&
      effect.timing === "on_event" &&
      effect.event === "position_change" &&
      effect.requireZone &&
      matchesZoneFilter("hand", effect.requireZone),
  );
}

function collectHandPositionChangeSources(
  owner: TriggerRuntimePlayer | null | undefined,
): TriggerRuntimeCard[] {
  if (!owner || !Array.isArray(owner.hand)) return [];
  return owner.hand.filter(hasHandPositionChangeTrigger);
}

interface PositionChangeSource {
  readonly card: TriggerRuntimeCard;
  readonly zone: TriggerZone;
}

function sourceAlreadyListed(
  sources: readonly PositionChangeSource[],
  card: TriggerRuntimeCard,
): boolean {
  return sources.some((entry) => entry.card === card);
}

function matchesPositionFilter(
  actual: string,
  filterValue:
    | BattlePosition
    | readonly BattlePosition[]
    | "any"
    | null
    | undefined,
): boolean {
  if (!filterValue || filterValue === "any") return true;
  const allowed = Array.isArray(filterValue) ? filterValue : [filterValue];
  return allowed.some(position => position === actual);
}

/** Preserve explicit manual provenance instead of inheriting a caller's source. */
export function getPositionChangeProvenance<Card>(payload: {
  readonly sourceCard?: Card | null | undefined;
  readonly source?: Card | null | undefined;
  readonly positionChangedByEffect?: boolean | undefined;
}) {
  const positionChangeSourceCard = payload.positionChangedByEffect === false
    ? null : payload.sourceCard === undefined ? payload.source || null : payload.sourceCard;
  return { positionChangeSourceCard, positionChangedByEffect: positionChangeSourceCard !== null };
}

/** The event gate is shared by queued triggers and immediate passive observers. */
export function matchesPositionChangeEvent<Card>(
  effect: Pick<TriggerEffectLike, "requireSelfAsChanged" | "fromPosition" | "positionFrom" | "toPosition" |
    "positionTo" | "changedCardOwner" | "eventCardOwner" | "changedCardRequireFaceup" |
    "changedCardRequireFaceupBeforeChange" | "eventCardFilters" | "positionChangedByEffect" |
    "requirePositionChangedByEffect" | "positionChangeSourceFilters" | "positionChangeSourceCardFilters">,
  source: Card,
  changed: Card,
  payload: {
    readonly fromPosition?: string | undefined;
    readonly toPosition?: string | undefined;
    readonly wasFlipped?: boolean | undefined;
    readonly wasFaceupBeforeChange?: boolean | undefined;
    readonly sourceCard?: Card | null | undefined;
    readonly source?: Card | null | undefined;
    readonly positionChangedByEffect?: boolean | undefined;
  },
  context: {
    readonly sourceOwnerId: string;
    readonly changedOwnerId: string;
    readonly changedIsFacedown: boolean;
    readonly matchesEventFilters: (filters: TriggerCardFilter) => boolean;
    readonly matchesSourceFilters: (card: Card | null, filters: TriggerCardFilter) => boolean;
  },
): boolean {
  const { fromPosition, toPosition } = payload;
  if (!fromPosition || !toPosition || fromPosition === toPosition) return false;
  if (effect.requireSelfAsChanged === true && source !== changed) return false;
  if (!matchesPositionFilter(fromPosition, effect.fromPosition || effect.positionFrom)) return false;
  if (!matchesPositionFilter(toPosition, effect.toPosition || effect.positionTo)) return false;
  const owner = effect.changedCardOwner || effect.eventCardOwner;
  if (!matchesOwnerFilter(owner, context.sourceOwnerId, context.changedOwnerId)) return false;
  if (effect.changedCardRequireFaceup === true && context.changedIsFacedown) return false;
  if (effect.changedCardRequireFaceupBeforeChange === true &&
      (payload.wasFaceupBeforeChange === false || payload.wasFlipped === true)) return false;
  if (effect.eventCardFilters && !context.matchesEventFilters(effect.eventCardFilters)) return false;
  const { positionChangeSourceCard } = getPositionChangeProvenance(payload);
  if ((effect.positionChangedByEffect === true || effect.requirePositionChangedByEffect === true) && !positionChangeSourceCard) return false;
  const filters = effect.positionChangeSourceFilters || effect.positionChangeSourceCardFilters;
  return !filters || context.matchesSourceFilters(positionChangeSourceCard, filters);
}

function matchesCardFilters(
  engine: TriggerCollectorHost,
  card: TriggerRuntimeCard | null | undefined,
  filters: TriggerCardFilter | null | undefined,
): boolean {
  if (!filters || Object.keys(filters).length === 0) return true;
  if (!card) return false;
  if (typeof engine.cardMatchesFilters === "function") {
    return engine.cardMatchesFilters(card, filters);
  }
  if (filters.cardKind && card.cardKind !== filters.cardKind) return false;
  if (filters.name && card.name !== filters.name) return false;
  if (filters.cardName && card.name !== filters.cardName) return false;
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  return true;
}

function getCardLockIdentity(
  card: TriggerRuntimeCard | null | undefined,
  game: TriggerGamePort,
): string | number {
  return (
    card?.duelCardId ??
    (card ? game.ensureDuelCardId?.(card) : null) ??
    card?.instanceId ??
    card?._instanceId ??
    card?.uuid ??
    card?.simInstanceId ??
    card?.id ??
    card?.name ??
    "unknown"
  );
}

function buildPerEventCardEffect(
  effect: TriggerEffect,
  eventCard: TriggerRuntimeCard,
  game: TriggerGamePort,
): TriggerEffect {
  if (!effect?.oncePerTurnPerEventCard) return effect;
  const baseName = effect.oncePerTurnName || effect.id || "position_change";
  const eventCardKey = getCardLockIdentity(eventCard, game);
  return {
    ...effect,
    oncePerTurn: true,
    oncePerTurnName: `${baseName}:event_card:${eventCardKey}`,
  };
}

/**
 * Collects trigger entries for battle position changes.
 */
export async function collectPositionChangeTriggers(
  this: TriggerCollectorHost,
  payload: CollectedTriggerEventMap["position_change"],
): Promise<TriggerPackage> {
  const entries: TriggerEntry[] = [];
  const orderRule =
    "changed card owner board observers -> opponent board observers -> hand observers";

  const { card, fromPosition, toPosition } = payload || {};
  if (!card || !fromPosition || !toPosition || fromPosition === toPosition) {
    return { entries, orderRule };
  }

  const changedOwner =
    payload.player || resolvePlayerForCard(this.game, card, null);
  if (!changedOwner) return { entries, orderRule };

  const changedOpponent =
    payload.opponent || this.game?.getOpponent?.(changedOwner) || null;
  const actionContext = payload?.actionContext || null;

  const observerSides = [
    { owner: changedOwner, other: changedOpponent },
    { owner: changedOpponent, other: changedOwner },
  ].filter(
    (side): side is {
      owner: TriggerRuntimePlayer;
      other: TriggerRuntimePlayer | null;
    } => side.owner != null,
  );

  const collectFromSource = (
    sourceCard: TriggerRuntimeCard,
    owner: TriggerRuntimePlayer,
    other: TriggerRuntimePlayer | null,
    sourceZone: TriggerZone,
    effect: TriggerEffect,
  ): void => {
    if (!effect || effect.timing !== "on_event") return;
    if (effect.event !== "position_change") return;

    const isBoardSource =
      sourceZone === "field" ||
      sourceZone === "spellTrap" ||
      sourceZone === "fieldSpell";

    if (isBoardSource && sourceCard.isFacedown === true) return;

    if (effect.requireFaceup === true && sourceCard.isFacedown === true) {
      return;
    }

    if (effect.requireZone && !matchesZoneFilter(sourceZone, effect.requireZone)) {
      return;
    }

    if (!matchesPositionChangeEvent(effect, sourceCard, card, payload, {
      sourceOwnerId: owner.id, changedOwnerId: changedOwner.id,
      changedIsFacedown: card.isFacedown === true,
      matchesEventFilters: filters => cardMatchesEventFilters(this, card, filters, {
        sourceOwner: owner, eventOwner: changedOwner, fromZone: "field", toZone: "field",
      }),
      matchesSourceFilters: (source, filters) => matchesCardFilters(this, source, filters),
    })) return;

    const ctx = {
      source: sourceCard, player: owner, opponent: other,
      eventCard: card, changedCard: card, eventPlayer: changedOwner,
      eventOpponent: changedOpponent, fromPosition, toPosition,
      wasFlipped: payload.wasFlipped === true,
      ...getPositionChangeProvenance(payload),
      effectId: payload.effectId || null, actionContext,
    };
    const effectiveEffect = buildPerEventCardEffect(effect, card, this.game);

    const optCheck = this.checkOncePerTurn(sourceCard, owner, effectiveEffect);
    if (!optCheck.ok) return;

    const duelCheck = this.checkOncePerDuel(sourceCard, owner, effectiveEffect);
    if (!duelCheck.ok) return;

    if (Array.isArray(effect.targets) && effect.targets.length > 0) {
      const precheckCtx = {
        ...ctx,
        activationContext: { logTargets: false },
      };
      for (const targetDef of effect.targets) {
        if (!targetDef) continue;
        const min = Number(targetDef.count?.min ?? 1);
        if (min <= 0) continue;
        const { candidates } = this.selectCandidates(targetDef, precheckCtx);
        if (!candidates || candidates.length < min) {
          return;
        }
      }
    }

    const activationContext = this.buildTriggerActivationContext(
      sourceCard,
      owner,
      sourceZone,
    );

    const entry = this.buildTriggerEntry({
      sourceCard,
      owner,
      effect: effectiveEffect,
      ctx,
      activationContext,
      selectionKind: "triggered",
      selectionMessage: "Select target(s) for the triggered effect.",
    });

    if (entry) entries.push(entry);
  };

  for (const { owner, other } of observerSides) {
    const sourceEntries: PositionChangeSource[] = [];
    for (const sourceCard of collectBoardSources(owner)) {
      if (!sourceCard) continue;
      sourceEntries.push({
        card: sourceCard,
        zone: this.findCardZone?.(owner, sourceCard) || "field",
      });
    }
    for (const sourceCard of collectHandPositionChangeSources(owner)) {
      if (!sourceCard || sourceAlreadyListed(sourceEntries, sourceCard)) {
        continue;
      }
      sourceEntries.push({ card: sourceCard, zone: "hand" });
    }
    for (const { card: sourceCard, zone: sourceZone } of sourceEntries) {
      if (!Array.isArray(sourceCard?.effects)) continue;
      for (const effect of sourceCard.effects) {
        collectFromSource(sourceCard, owner, other, sourceZone, effect);
      }
    }
  }

  return { entries, orderRule };
}
