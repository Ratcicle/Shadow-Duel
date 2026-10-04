import type { AiCardInput } from "../../contracts/aiState.js";
import type { HandSummonProcedure } from "../../contracts/cards.js";
import { matchesCardFilter } from "../../effects/filters/cardFilters.js";

interface CounterCard {
  counters?: Map<string, number> | object;
  getCounter?(counterType: string): number;
}

interface CounterFieldPlayer<Card> {
  field?: readonly Card[];
  spellTrap?: readonly Card[];
  fieldSpell?: Card | null;
}

/** Public field sources in the same actor-first order as procedural payment. */
export function collectProcedureCounterSources<Card extends AiCardInput>(
  self: CounterFieldPlayer<Card>,
  opponent: CounterFieldPlayer<Card>,
  cost: NonNullable<HandSummonProcedure["counterCost"]>,
  turnCounter: number,
): Card[] {
  const owner = cost.owner || "self";
  const players = owner === "self" ? [self] : owner === "opponent" ? [opponent] : [self, opponent];
  const sources: Card[] = [];
  for (const player of players) for (const zone of cost.zones || ["field"]) {
    const cards = zone === "fieldSpell" ? player.fieldSpell ? [player.fieldSpell] : [] : player[zone] || [];
    for (const card of cards) {
      if (sources.includes(card) || (cost.requireFaceup && card.isFacedown) ||
          getCounterValue(card, cost.counterType) <= 0 ||
          !matchesCardFilter<Card>(card, cost.filters || {}, { turnCounter, getCounter: (entry, type) => getCounterValue(entry, type) })) continue;
      sources.push(card);
    }
  }
  return sources;
}

type LegacyCounterMap = { [key: string]: number | undefined };

export function getCounterCount(
  card: CounterCard | null | undefined,
  counterType = "judgment_marker",
): number {
  if (!card) return 0;
  if (typeof card.getCounter === "function") {
    return card.getCounter(counterType) || 0;
  }
  if (card.counters instanceof Map) {
    return card.counters.get(counterType) || 0;
  }
  if (card.counters && typeof card.counters === "object") {
    return (card.counters as LegacyCounterMap)[counterType] || 0;
  }
  return 0;
}

export function getCounterValue(
  card: CounterCard | null | undefined,
  counterType = "counter",
): number {
  if (!card) return 0;
  const key = counterType || "counter";
  const counters = card.counters;
  if (counters instanceof Map) return counters.get(key) || 0;
  if (counters && typeof counters === "object") {
    const upperKey = typeof key === "string" ? key.toUpperCase() : key;
    return (
      (counters as LegacyCounterMap)[key] ||
      (counters as LegacyCounterMap)[upperKey] ||
      0
    );
  }
  return 0;
}

export function setCounterValue(
  card: CounterCard | null | undefined,
  counterType = "counter",
  value = 0,
): void {
  if (!card) return;
  const key = counterType || "counter";
  const nextValue = Math.max(0, Math.floor(value || 0));
  if (card.counters instanceof Map) {
    card.counters.set(key, nextValue);
    return;
  }
  if (!card.counters || typeof card.counters !== "object") card.counters = {};
  (card.counters as LegacyCounterMap)[key] = nextValue;
}
