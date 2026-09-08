import type { SimulatedCardState } from "../../contracts/aiState.js";

type CounterCard = Omit<SimulatedCardState, "counters"> & {
  counters?: Map<string, number> | object;
  getCounter?(counterType: string): number;
};

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
