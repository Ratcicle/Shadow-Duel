import type {
  TriggerCardFilter,
  TriggerCollectorHost,
  TriggerPlayerReference,
  TriggerRuntimeCard,
  TriggerRuntimePlayer,
  TriggerEffectLike,
  TriggerZone,
} from "../runtime.js";
import type { EventEquipHostExitBinding } from "../../../contracts/events.js";
import type { EffectCondition } from "../../../contracts/effects.js";
import { matchesEventCardPresence, type PresenceCard } from "../../../game/zones/ownership.js";

/** Shared factual gates for one successful Summon, independent of activation. */
export function matchesAfterSummonTrigger(
  effect: {
    readonly summonMethods?: readonly string[];
    readonly summonMethod?: string | readonly string[];
    readonly summonFrom?: string;
    readonly requireSummonedFrom?: string;
    readonly requireSelfAsSummoned?: boolean;
    readonly requireOpponentSummon?: boolean;
    readonly triggerPlayer?: string;
    readonly requirePhase?: string | readonly string[];
    readonly condition?: EffectCondition;
    readonly conditions?: readonly EffectCondition[];
  },
  occurrence: {
    readonly sourceCard: object;
    readonly owner: { readonly id: string; readonly hand?: readonly object[] };
    readonly summonedCard: { readonly archetypes?: readonly string[]; readonly archetype?: string | null } | null | undefined;
    readonly summoner: { readonly id: string } | null | undefined;
    readonly method?: string | null | undefined;
    readonly fromZone?: string | null | undefined;
    readonly sourceZone?: string | null | undefined;
    readonly phase?: string | null | undefined;
  },
  evaluateConditions?: (conditions: readonly EffectCondition[]) => boolean,
): boolean {
  const { sourceCard, owner, summonedCard, summoner, method, fromZone, sourceZone, phase } = occurrence;
  if (effect.triggerPlayer === "self" && summoner?.id !== owner.id) return false;
  if (effect.triggerPlayer === "opponent" && summoner?.id === owner.id) return false;
  if (effect.requireOpponentSummon && (!summoner?.id || summoner.id === owner.id)) return false;
  const methods = effect.summonMethods ?? effect.summonMethod;
  if (methods && !asArray(methods).includes(method)) return false;
  const origin = effect.summonFrom ?? effect.requireSummonedFrom;
  // Legacy payloads without an origin retain the collector's compatibility.
  if (origin && fromZone && origin !== fromZone) return false;
  if (effect.requireSelfAsSummoned && summonedCard !== sourceCard) return false;
  if (effect.requirePhase && !asArray(effect.requirePhase).includes(phase)) return false;
  const condition = effect.condition;
  if (condition && "requires" in condition && condition.requires === "self_in_hand") {
    if (!(sourceZone === "hand" && owner.hand?.includes(sourceCard)) &&
        !(fromZone === "hand" && summonedCard === sourceCard)) return false;
    if (condition.triggerArchetype) {
      const archetypes = summonedCard?.archetypes ?? (summonedCard?.archetype ? [summonedCard.archetype] : []);
      if (!archetypes.includes(condition.triggerArchetype)) return false;
    }
  }
  return !effect.conditions?.length || !evaluateConditions || evaluateConditions(effect.conditions);
}

/** Only the explicit host-bound observer operator can use exit eligibility. */
interface EquipHostExitEffect {
  readonly event?: string;
  readonly eventCardFilters?: { readonly eventCardIsEquippedToSource?: boolean };
}
export function hasEquipHostExitProof(
  card: PresenceCard,
  effect: EquipHostExitEffect,
  binding: EventEquipHostExitBinding<PresenceCard, { readonly id: string }> | null | undefined,
): boolean {
  if (!binding || effect.event !== "card_moved" ||
      effect.eventCardFilters?.eventCardIsEquippedToSource !== true || binding.equip !== card ||
      !binding.equipAfterCleanup || binding.hostBeforeExit.zone !== "field" ||
      binding.equipBeforeExit.zone !== "spellTrap" ||
      binding.equipBeforeExit.controllerId !== binding.equipController.id) return false;
  const before = binding.equipBeforeExit, after = binding.equipAfterCleanup;
  return before.instanceId != null && before.instanceId === after.instanceId &&
    before.cardId === after.cardId && before.duelCardId === after.duelCardId &&
    before.locationVersion + 1 === after.locationVersion &&
    (after.zone === "graveyard" || after.zone === "banished") &&
    (card.instanceId ?? card._instanceId ?? null) === before.instanceId &&
    (card.id ?? null) === before.cardId && (card.duelCardId ?? null) === before.duelCardId;
}

export function matchesEquipHostExitSourcePresence(
  card: PresenceCard,
  effect: EquipHostExitEffect,
  binding: EventEquipHostExitBinding<PresenceCard, { readonly id: string }> | null | undefined,
  physicalControllerId: string | null,
  physicalZone: string | null,
): boolean {
  return !!binding?.equipAfterCleanup && hasEquipHostExitProof(card, effect, binding) &&
    matchesEventCardPresence(card, binding.equipAfterCleanup, physicalControllerId, physicalZone);
}

/** Event ownership is opt-in; the destination remains the default. */
export function resolveMovementEventOwner(
  effect: TriggerEffectLike,
  fromZone: string | null | undefined,
  fromPlayer: TriggerRuntimePlayer | null | undefined,
  destination: TriggerRuntimePlayer | null | undefined,
): TriggerRuntimePlayer | null {
  return effect.movementTriggerOwnership === "field_exit_controller" &&
    (fromZone === "field" || fromZone === "spellTrap" || fromZone === "fieldSpell")
    ? fromPlayer || null
    : destination || null;
}

/** Locate the physical source independently of the player activating its trigger. */
export function findTriggerSourceLocation(
  host: Pick<TriggerCollectorHost, "game" | "findCardZone">,
  card: TriggerRuntimeCard,
  fallback: TriggerRuntimePlayer,
): { player: TriggerRuntimePlayer; zone: TriggerZone } {
  for (const player of [host.game?.player, host.game?.bot]) {
    if (!player) continue;
    const zone = host.findCardZone(player, card);
    if (zone) return { player, zone };
  }
  return { player: fallback, zone: null };
}

/** Source legality at trigger discovery and before activation commitment. */
export function isTriggerSourceLegal(
  card: TriggerRuntimeCard,
  effect: TriggerEffectLike,
  sourceZone: TriggerZone,
  binding?: EventEquipHostExitBinding | null,
): boolean {
  if (sourceZone === "temporary") return true;
  const sourcePresence = binding && hasEquipHostExitProof(card, effect, binding) ? binding.equipBeforeExit : null;
  const eligibilityZone = sourcePresence?.zone || sourceZone;
  const faceUp = sourcePresence ? sourcePresence.faceUp : card.isFacedown !== true;
  if (effect.requireZone && !matchesZoneFilter(eligibilityZone, effect.requireZone)) {
    return false;
  }
  if (
    Array.isArray(effect.activationZones) &&
    (eligibilityZone === null || !effect.activationZones.includes(eligibilityZone))
  ) {
    return false;
  }
  if (
    (eligibilityZone === "field" || eligibilityZone === "fieldSpell" || eligibilityZone === "spellTrap") &&
    !faceUp
  ) {
    return false;
  }
  return effect.requireFaceup !== true || faceUp;
}

export function getCardControllerId(
  card: TriggerRuntimeCard | null | undefined,
): string | null {
  return card?.controller || card?.owner || null;
}

export function matchesLastSummonMethod(
  card: TriggerRuntimeCard | null | undefined,
  allowed: string | readonly string[] | null | undefined,
): boolean {
  if (!allowed) return true;
  const allowedMethods = Array.isArray(allowed) ? allowed : [allowed];
  return allowedMethods.includes(card?.lastSummonMethod || null);
}

export function matchesLastSummonProcedure(
  card: TriggerRuntimeCard | null | undefined,
  allowed: string | readonly string[] | null | undefined,
): boolean {
  if (!allowed) return true;
  const allowedProcedures = Array.isArray(allowed) ? allowed : [allowed];
  return allowedProcedures.includes(card?.lastSummonProcedure || null);
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [value];
}

export function debugTriggerLog(
  engine: Pick<TriggerCollectorHost, "game"> | null | undefined,
  ...args: unknown[]
): void {
  if (engine?.game?.devModeEnabled) {
    console.log(...args);
  }
}

function isSameCardReference(
  a: TriggerRuntimeCard | number | string | null | undefined,
  b: TriggerRuntimeCard | number | string | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a.instanceId != null && b.instanceId != null) {
    return a.instanceId === b.instanceId;
  }
  return false;
}

export function matchesZoneFilter(
  actualZone: string | null | undefined,
  filterValue: string | readonly string[] | null | undefined,
): boolean {
  if (!filterValue || filterValue === "any") return true;
  return asArray(filterValue).includes(actualZone);
}

export function matchesOwnerFilter(
  filterValue: string | readonly string[] | null | undefined,
  sourceOwner: TriggerPlayerReference | undefined,
  eventOwner: TriggerPlayerReference | undefined,
): boolean {
  if (!filterValue || filterValue === "any") return true;
  const sourceOwnerId =
    typeof sourceOwner === "string" ? sourceOwner : sourceOwner?.id || null;
  const eventOwnerId =
    typeof eventOwner === "string" ? eventOwner : eventOwner?.id || null;
  if (filterValue === "self") return sourceOwnerId === eventOwnerId;
  if (filterValue === "opponent") return sourceOwnerId !== eventOwnerId;
  return asArray(filterValue).includes(eventOwnerId);
}

export function cardMatchesEventFilters(
  engine: Pick<TriggerCollectorHost, "cardMatchesFilters">,
  eventCard: TriggerRuntimeCard | null | undefined,
  filters: TriggerCardFilter | null | undefined,
  context: {
    readonly sourceOwner?: TriggerRuntimePlayer | null;
    readonly eventOwner?: TriggerRuntimePlayer | null | undefined;
    readonly fromZone?: string | null;
    readonly toZone?: string | null | undefined;
    readonly sourceCard?: TriggerRuntimeCard | null;
    readonly contextLabel?: string | null;
    readonly equipHostExitBinding?: EventEquipHostExitBinding | null;
  } = {},
): boolean {
  if (!filters || typeof filters !== "object") return true;
  if (!eventCard) return false;

  if (
    !matchesOwnerFilter(filters.owner, context.sourceOwner, context.eventOwner)
  ) {
    return false;
  }
  if (!matchesZoneFilter(context.fromZone, filters.fromZone)) {
    return false;
  }
  if (!matchesZoneFilter(context.toZone, filters.toZone)) {
    return false;
  }
  if (
    filters.eventCardIsEquippedToSource === true &&
    !(
      (context.equipHostExitBinding != null && context.equipHostExitBinding.equip === context.sourceCard &&
        context.equipHostExitBinding.hostBeforeExit.instanceId != null &&
        context.equipHostExitBinding.hostBeforeExit.instanceId === (eventCard.instanceId ?? eventCard._instanceId ?? null) &&
        context.equipHostExitBinding.hostBeforeExit.cardId === (eventCard.id ?? null) &&
        context.equipHostExitBinding.hostBeforeExit.duelCardId === (eventCard.duelCardId ?? null)) ||
      isSameCardReference(context.sourceCard?.equippedTo, eventCard) ||
      isSameCardReference(context.sourceCard?.equipTarget, eventCard) ||
      isSameCardReference(
        context.sourceCard?.lastEquippedCardLeftField,
        eventCard,
      )
    )
  ) {
    return false;
  }

  const cardFilters = { ...filters };
  delete cardFilters.owner;
  delete cardFilters.fromZone;
  delete cardFilters.toZone;
  delete cardFilters.eventCardIsEquippedToSource;

  return engine.cardMatchesFilters(eventCard, cardFilters);
}
