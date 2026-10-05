import type {
  EventCard,
  EventPayloadBase,
  EventPlayer,
  EventTriggerReferenceSnapshots,
} from "../../contracts/events.js";
import type { CanonicalZone } from "../../contracts/zones.js";
import type { ChainCostPayment, PaidCostReferenceValues } from "../../contracts/chainRuntime.js";

/** Paid values do not bind or substitute a card's current physical presence. */
export function getPaidCostReferenceValues(
  payment: ChainCostPayment | null | undefined,
  targetRef: string | null | undefined,
): readonly PaidCostReferenceValues[] | undefined {
  if (payment?.status !== "paid" || !targetRef || !payment.paidReferences ||
      !Object.hasOwn(payment.paidReferences, targetRef)) return undefined;
  return payment.paidReferences[targetRef];
}

const REFERENCE_ZONES = ["field", "spellTrap", "hand", "graveyard", "banished", "deck", "extraDeck"] as const;
const eventEffectOrigins = new WeakMap<object, object>();

/** Register a runtime projection without changing the declarative effect object. */
export function registerEventEffectProjection(original: object, projection: object): void {
  eventEffectOrigins.set(projection, getEventEffectOrigin(original));
}

export function getEventEffectOrigin(effect: object): object {
  return eventEffectOrigins.get(effect) || effect;
}

/** Canonical card aliases already supplied by the corresponding trigger collectors. */
export function buildEventReferenceContext(eventName: string, payload: object, source: object): Record<string, unknown> {
  const context: Record<string, unknown> = { ...payload, source, host: Reflect.get(source, "equippedTo") || null };
  if (eventName === "after_summon") context.summonedCard = Reflect.get(payload, "card");
  if (eventName === "card_moved" || eventName === "card_to_grave" || eventName === "position_change") {
    context.eventCard = Reflect.get(payload, "card");
  }
  if (eventName === "position_change") context.changedCard = Reflect.get(payload, "card");
  if (eventName === "battle_destroy") context.battleDestroyer = Reflect.get(payload, "battleDestroyer") || Reflect.get(payload, "attacker") || null;
  if (eventName === "attack_declared" || eventName === "battle_damage") {
    context.target = Reflect.get(payload, "defender") || Reflect.get(payload, "target") || null;
  }
  if (eventName === "battle_completed") context.target = Reflect.get(payload, "defender");
  if (eventName === "card_equipped") context.target = Reflect.get(payload, "equippedCard");
  return context;
}

type PresenceCard = Pick<EventCard, "id" | "instanceId" | "_instanceId" | "isFacedown" | "locationVersion">;
interface PresencePlayer<Card> {
  readonly id: string;
  readonly field?: readonly Card[];
  readonly spellTrap?: readonly Card[];
  readonly hand?: readonly Card[];
  readonly graveyard?: readonly Card[];
  readonly banished?: readonly Card[];
  readonly deck?: readonly Card[];
  readonly extraDeck?: readonly Card[];
  readonly fieldSpell?: Card | null;
}

function eventCards(value: unknown): EventCard[] {
  const entries: unknown[] = Array.isArray(value) ? value : value == null ? [] : [value];
  return entries.filter((entry): entry is EventCard => typeof entry === "object" && entry !== null &&
    typeof Reflect.get(entry, "name") === "string");
}

export function captureReferencePresence<Card extends PresenceCard>(
  card: Card,
  players: readonly (PresencePlayer<Card> | null | undefined)[],
): (FrozenReferencePresence & { card: Card; zone: CanonicalZone }) | null {
  for (const player of players) {
    if (!player) continue;
    const zone: CanonicalZone | undefined = player.fieldSpell === card ? "fieldSpell" :
      REFERENCE_ZONES.find(candidate => player[candidate]?.includes(card));
    if (!zone) continue;
    const snapshot = {
      card,
      cardInstanceId: card.instanceId ?? card._instanceId ?? card.id ?? null,
      controllerId: player.id,
      zone,
      faceUp: card.isFacedown !== true,
      locationVersion: Number(card.locationVersion ?? 0),
    };
    Object.freeze(snapshot);
    return snapshot;
  }
  return null;
}

interface FrozenReferencePresence {
  readonly card: object;
  readonly cardInstanceId: string | number | null;
  readonly controllerId: string | null;
  readonly zone: string | null;
  readonly faceUp: boolean;
  readonly locationVersion: number;
}

/** Compare source eligibility at event entry with its current physical presence. */
export function matchesFrozenReferencePresence(
  expected: FrozenReferencePresence | null | undefined,
  current: FrozenReferencePresence | null,
): boolean {
  return expected != null && current != null && expected.card === current.card &&
    expected.cardInstanceId === current.cardInstanceId && expected.controllerId === current.controllerId &&
    expected.zone === current.zone && expected.faceUp === current.faceUp &&
    expected.locationVersion === current.locationVersion;
}

/** Capture every contextual reference synchronously, before event effects or decisions yield. */
export function captureEventReferenceSnapshots(
  game: { player?: EventPlayer; bot?: EventPlayer },
  eventName: string,
  payload: EventPayloadBase,
): EventTriggerReferenceSnapshots[] {
  const players = [game.player, game.bot].filter((player): player is EventPlayer => player != null);
  const sources = new Set(players.flatMap(player => [
    ...REFERENCE_ZONES.flatMap(zone => player[zone] || []),
    ...(player.fieldSpell ? [player.fieldSpell] : []),
  ]));
  const snapshots: EventTriggerReferenceSnapshots[] = [];
  for (const source of sources) {
    for (const effect of source.effects || []) {
      if (effect.timing !== "on_event" || effect.event !== eventName) continue;
      const definitions = (effect.targets || []).filter(definition => definition.intent === "reference" && definition.targetFromContext);
      if (definitions.length === 0) continue;
      const context = buildEventReferenceContext(eventName, payload, source);
      const references = definitions.map(definition => {
        const key = definition.targetFromContext;
        const value: unknown = key ? context[key] : null;
        const cards = eventCards(value).map(card => captureReferencePresence(card, players))
          .filter(snapshot => snapshot != null);
        Object.freeze(cards);
        const reference = { targetId: definition.id, cards };
        Object.freeze(reference);
        return reference;
      });
      Object.freeze(references);
      const entry = { source, effect, sourcePresence: captureReferencePresence(source, players), references };
      Object.freeze(entry);
      snapshots.push(entry);
    }
  }
  Object.freeze(snapshots);
  return snapshots;
}
